require("dotenv").config();

const express = require("express");
const path = require("path");

const { getTodoistTasks, setTodoistTaskCompleted } = require("./src/todoist");
const { getIcloudReminders, setIcloudReminderCompleted } = require("./src/icloudReminders");

const app = express();
const PORT = process.env.PORT || 3000;

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
      await setIcloudReminderCompleted(id, completed);
    } else {
      return res.status(404).json({ ok: false, error: "Recordatorio desconocido." });
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Reminders app escuchando en http://localhost:${PORT}`);
});
