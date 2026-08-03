require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const path = require("path");

const {
  getTodoistTasks,
  setTodoistTaskCompleted,
  getTodoistProjects,
  createTodoistTask,
  updateTodoistTask,
} = require("./src/todoist");
const {
  getIcloudReminders,
  setIcloudReminderCompleted,
  getIcloudReminderLists,
  createIcloudReminder,
  updateIcloudReminder,
  getIcloudCalendarEvents,
} = require("./src/icloudReminders");
const {
  isMicrosoftConfigured,
  getAuthorizeUrl,
  exchangeCodeForTokens,
  getMicrosoftTasks,
  setMicrosoftTaskCompleted,
  updateMicrosoftTask,
  getMicrosoftTaskLists,
  createMicrosoftTask,
} = require("./src/microsoftTodo");

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

function getMsRefreshToken(req) {
  return req.header("X-MS-Refresh-Token") || req.body?.msRefreshToken || null;
}

app.use(requireLogin);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/auth/microsoft/login", (req, res) => {
  if (!isMicrosoftConfigured()) {
    return res
      .status(400)
      .send("Falta configurar MS_CLIENT_ID, MS_CLIENT_SECRET y MS_REDIRECT_URI en el .env.");
  }
  res.redirect(getAuthorizeUrl());
});

app.get("/auth/microsoft/callback", async (req, res) => {
  const { code, error, error_description: errorDescription } = req.query;

  if (error) {
    return res.status(400).send(`Error de Microsoft: ${errorDescription || error}`);
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    res.send(`<!doctype html>
<html lang="es">
<body>
  <script>
    localStorage.setItem("msRefreshToken", ${JSON.stringify(tokens.refresh_token)});
    window.location.href = "/";
  </script>
  Conectado con Microsoft. Redirigiendo...
</body>
</html>`);
  } catch (err) {
    res.status(500).send(`Error al conectar con Microsoft: ${err.message}`);
  }
});

app.get("/api/reminders", async (req, res) => {
  const msRefreshToken = getMsRefreshToken(req);

  const [todoist, icloud, mstodo, icloudEvents] = await Promise.allSettled([
    getTodoistTasks(),
    getIcloudReminders(),
    msRefreshToken ? getMicrosoftTasks(msRefreshToken) : Promise.resolve(null),
    getIcloudCalendarEvents(),
  ]);

  const response = {
    todoist:
      todoist.status === "fulfilled"
        ? { ok: true, items: todoist.value }
        : { ok: false, error: todoist.reason.message },
    icloud:
      icloud.status === "fulfilled"
        ? { ok: true, items: icloud.value.items, warnings: icloud.value.errors }
        : { ok: false, error: icloud.reason.message },
    icloudEvents:
      icloudEvents.status === "fulfilled"
        ? { ok: true, items: icloudEvents.value.items, warnings: icloudEvents.value.errors }
        : { ok: false, error: icloudEvents.reason.message },
  };

  if (msRefreshToken) {
    response.mstodo =
      mstodo.status === "fulfilled"
        ? { ok: true, items: mstodo.value.items, refreshToken: mstodo.value.refreshToken }
        : { ok: false, error: mstodo.reason.message };
  }

  res.json(response);
});

app.post("/api/reminders/:id/complete", async (req, res) => {
  const { id } = req.params;
  const completed = req.body?.completed !== false;

  try {
    if (id.startsWith("todoist-")) {
      await setTodoistTaskCompleted(id.slice("todoist-".length), completed);
      return res.json({ ok: true });
    }
    if (id.startsWith("icloud-")) {
      await setIcloudReminderCompleted(req.body?.syncToken, completed);
      return res.json({ ok: true });
    }
    if (id.startsWith("mstodo-")) {
      const result = await setMicrosoftTaskCompleted(
        getMsRefreshToken(req),
        req.body?.syncToken,
        completed
      );
      return res.json({ ok: true, msRefreshToken: result.refreshToken });
    }
    return res.status(404).json({ ok: false, error: "Recordatorio desconocido." });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.put("/api/reminders/:id", async (req, res) => {
  const { id } = req.params;
  const { title, notes, due, syncToken } = req.body || {};

  if (title !== undefined && !title.trim()) {
    return res.status(400).json({ ok: false, error: "El título no puede quedar vacío." });
  }

  try {
    if (id.startsWith("todoist-")) {
      await updateTodoistTask(id.slice("todoist-".length), { title, notes, due });
      return res.json({ ok: true });
    }
    if (id.startsWith("icloud-")) {
      await updateIcloudReminder(syncToken, { title, notes, due });
      return res.json({ ok: true });
    }
    if (id.startsWith("mstodo-")) {
      const result = await updateMicrosoftTask(getMsRefreshToken(req), syncToken, {
        title,
        notes,
        due,
      });
      return res.json({ ok: true, msRefreshToken: result.refreshToken });
    }
    return res.status(404).json({ ok: false, error: "Recordatorio desconocido." });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get("/api/new-reminder-options", async (req, res) => {
  const msRefreshToken = getMsRefreshToken(req);

  const [todoistProjects, icloudLists, mstodoLists] = await Promise.allSettled([
    getTodoistProjects(),
    getIcloudReminderLists(),
    getMicrosoftTaskLists(msRefreshToken),
  ]);

  res.json({
    todoistProjects: todoistProjects.status === "fulfilled" ? todoistProjects.value : [],
    icloudLists: icloudLists.status === "fulfilled" ? icloudLists.value : [],
    mstodoLists: mstodoLists.status === "fulfilled" ? mstodoLists.value.lists : [],
    msRefreshToken: mstodoLists.status === "fulfilled" ? mstodoLists.value.refreshToken : null,
  });
});

app.post("/api/reminders", async (req, res) => {
  const { title, notes, due, targets } = req.body || {};

  if (!title || !title.trim()) {
    return res.status(400).json({ ok: false, error: "El título es obligatorio." });
  }
  if (!targets || (!targets.todoist && !targets.icloudListId && !targets.mstodoListId)) {
    return res
      .status(400)
      .json({ ok: false, error: "Elegí al menos un destino (Todoist, Reminders y/o Microsoft To Do)." });
  }

  const requestedCount =
    (targets.todoist ? 1 : 0) + (targets.icloudListId ? 1 : 0) + (targets.mstodoListId ? 1 : 0);
  const errors = [];
  let msRefreshToken = null;

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

  if (targets.mstodoListId) {
    try {
      const result = await createMicrosoftTask(getMsRefreshToken(req), {
        listId: targets.mstodoListId,
        title,
        notes,
        due,
      });
      msRefreshToken = result.refreshToken;
    } catch (err) {
      errors.push(`Microsoft To Do: ${err.message}`);
    }
  }

  if (errors.length === requestedCount) {
    return res.status(500).json({ ok: false, error: errors.join(" · ") });
  }

  res.json({ ok: true, warnings: errors, msRefreshToken });
});

app.listen(PORT, () => {
  console.log(`Reminders app escuchando en http://localhost:${PORT}`);
});
