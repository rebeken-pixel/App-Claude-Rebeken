const API_BASE = "https://api.todoist.com/rest/v2";

async function getTodoistTasks() {
  const token = process.env.TODOIST_API_TOKEN;
  if (!token) {
    throw new Error(
      "Falta TODOIST_API_TOKEN en el archivo .env (Configuración > Integraciones > Desarrollador en Todoist)."
    );
  }

  const headers = { Authorization: `Bearer ${token}` };

  const [tasksRes, projectsRes] = await Promise.all([
    fetch(`${API_BASE}/tasks`, { headers }),
    fetch(`${API_BASE}/projects`, { headers }),
  ]);

  if (!tasksRes.ok) {
    throw new Error(`Todoist respondió con estado ${tasksRes.status} al pedir tareas.`);
  }
  if (!projectsRes.ok) {
    throw new Error(`Todoist respondió con estado ${projectsRes.status} al pedir proyectos.`);
  }

  const tasks = await tasksRes.json();
  const projects = await projectsRes.json();
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
