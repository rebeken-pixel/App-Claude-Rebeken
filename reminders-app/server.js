require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");

const {
  getTodoistTasks,
  setTodoistTaskCompleted,
  getTodoistProjects,
  createTodoistTask,
} = require("./src/todoist");
const {
  getIcloudReminders,
  setIcloudReminderCompleted,
  getIcloudReminderLists,
  createIcloudReminder,
} = require("./src/icloudReminders");

const app = express();
const PORT = process.env.PORT || 3000;

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function requireLogin(req, res, next) {
  const username = process.env.APP_USERNAME;
  const password = process.env.APP_PASSWORD;

  // Sin APP_USERNAME/APP_PASSWORD configurados, no se exige login (pensado
  // para uso local en tu propia compu). Configuralos antes de exponer la
  // app en un hosting público (ver README).
  if (!username || !password) {
    return next();
  }

  const [scheme, encoded] = (req.headers.authorization || "").split(" ");

  if (scheme === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    const user = decoded.slice(0, separatorIndex);
    const pass = decoded.slice(separatorIndex + 1);

    if (safeEqual(user, username) && safeEqual(pass, password)) {
      return next();
    }
  }

  res.set("WWW-Authenticate", 'Basic realm="Recordatorios Unificados"');
  res.status(401).send("Autenticación requerida.");
}

app.use(requireLogin);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/reminders", async (req, res) => {
  const [todoist, icloud] = await Promise.allSettled([
    getTodoistTasks(),
    getIcloudReminders(),
  ]);

  res.json({
    todoist:
      todoist.status === "fulfilled"
        ? { ok: true, items: todoist.value }
        : { ok: false, error: todoist.reason.message },
    icloud:
      icloud.status === "fulfilled"
        ? { ok: true, items: icloud.value.items, warnings: icloud.value.errors }
        : { ok: false, error: icloud.reason.message },
  });
});

app.post("/api/reminders/:id/complete", async (req, res) => {
  const { id } = req.params;
  const completed = req.body?.completed !== false;

  try {
    if (id.startsWith("todoist-")) {
      await setTodoistTaskCompleted(id.slice("todoist-".length), completed);
    } else if (id.startsWith("icloud-")) {
      await setIcloudReminderCompleted(req.body?.syncToken, completed);
    } else {
      return res.status(404).json({ ok: false, error: "Recordatorio desconocido." });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/new-reminder-options", async (req, res) => {
  const [todoistProjects, icloudLists] = await Promise.allSettled([
    getTodoistProjects(),
    getIcloudReminderLists(),
  ]);

  res.json({
    todoistProjects: todoistProjects.status === "fulfilled" ? todoistProjects.value : [],
    icloudLists: icloudLists.status === "fulfilled" ? icloudLists.value : [],
  });
});

app.post("/api/reminders", async (req, res) => {
  const { title, notes, due, targets } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ ok: false, error: "El título es obligatorio." });
  }
  if (!targets || (!targets.todoist && !targets.icloudListId)) {
    return res
      .status(400)
      .json({ ok: false, error: "Elegí al menos un destino (Todoist y/o Reminders)." });
  }

  const requestedCount = (targets.todoist ? 1 : 0) + (targets.icloudListId ? 1 : 0);
  const errors = [];

  if (targets.todoist) {
    try {
      await createTodoistTask({ title, notes, due, projectId: targets.todoistProjectId });
    } catch (err) {
      errors.push(`Todoist: ${err.message}`);
    }
  }

  if (targets.icloudListId) {
    try {
      await createIcloudReminder({ listId: targets.icloudListId, title, notes, due });
    } catch (err) {
      errors.push(`Reminders (iCloud): ${err.message}`);
    }
  }

  if (errors.length === requestedCount) {
    return res.status(500).json({ ok: false, error: errors.join(" · ") });
  }

  res.json({ ok: true, warnings: errors });
});

app.listen(PORT, () => {
  console.log(`Reminders app escuchando en http://localhost:${PORT}`);
});
