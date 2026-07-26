require("dotenv").config();

const express = require("express");
const path = require("path");

const { getTodoistTasks } = require("./src/todoist");
const { getIcloudReminders } = require("./src/icloudReminders");

const app = express();
const PORT = process.env.PORT || 3000;

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

app.listen(PORT, () => {
  console.log(`Reminders app escuchando en http://localhost:${PORT}`);
});
