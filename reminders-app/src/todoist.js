const API_BASE = "https://api.todoist.com/api/v1";

async function fetchAllPages(path, headers) {
  const results = [];
  let cursor = null;

  do {
    const url = new URL(`${API_BASE}/${path}`);
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Todoist respondió con estado ${response.status} al pedir ${path}.`);
    }

    const data = await response.json();
    results.push(...data.results);
    cursor = data.next_cursor;
  } while (cursor);

  return results;
}

async function getTodoistTasks() {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    throw new Error(
      "Falta TODOIST_API_TOKEN en el archivo .env (Configuración > Integraciones > Desarrollador en Todoist)."
    );
  }

  const headers = { Authorization: `Bearer ${token}` };

  const [tasks, projects] = await Promise.all([
    fetchAllPages("tasks", headers),
    fetchAllPages("projects", headers),
  ]);

  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  return tasks.map((task) => ({
    id: `todoist-${task.id}`,
    source: "todoist",
    title: task.content,
    notes: task.description || "",
    due: task.due ? task.due.datetime || task.due.date : null,
    dueLabel: task.due ? task.due.string : null,
    isAllDay: task.due ? !task.due.datetime : true,
    listName: projectNameById.get(task.project_id) || "Sin proyecto",
    priority: task.priority,
    completed: false,
    url: task.url,
  }));
}

module.exports = { getTodoistTasks };
