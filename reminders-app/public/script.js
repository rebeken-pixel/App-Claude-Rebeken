const listEl = document.getElementById("list");
const statusMessage = document.getElementById("status-message");
const refreshBtn = document.getElementById("refresh-btn");
const hideCompletedCheckbox = document.getElementById("hide-completed");
const filterChips = document.querySelectorAll(".chip");

const newReminderBtn = document.getElementById("new-reminder-btn");
const newReminderForm = document.getElementById("new-reminder-form");
const newReminderCancelBtn = document.getElementById("new-reminder-cancel");
const newReminderSubmitBtn = document.getElementById("new-reminder-submit");
const newReminderError = document.getElementById("new-reminder-error");
const newTitleInput = document.getElementById("new-title");
const newNotesInput = document.getElementById("new-notes");
const newDueInput = document.getElementById("new-due");
const targetTodoistCheckbox = document.getElementById("target-todoist");
const targetIcloudCheckbox = document.getElementById("target-icloud");
const todoistProjectSelect = document.getElementById("todoist-project");
const icloudListSelect = document.getElementById("icloud-list");

let allReminders = [];
let activeFilter = "all";
let newReminderOptionsLoaded = false;

filterChips.forEach((chip) => {
  chip.addEventListener("click", () => {
    filterChips.forEach((c) => c.classList.remove("chip--active"));
    chip.classList.add("chip--active");
    activeFilter = chip.dataset.filter;
    render();
  });
});

hideCompletedCheckbox.addEventListener("change", render);
refreshBtn.addEventListener("click", loadReminders);

newReminderBtn.addEventListener("click", openNewReminderForm);
newReminderCancelBtn.addEventListener("click", closeNewReminderForm);
targetTodoistCheckbox.addEventListener("change", () => {
  todoistProjectSelect.disabled = !targetTodoistCheckbox.checked;
});
targetIcloudCheckbox.addEventListener("change", () => {
  icloudListSelect.disabled = !targetIcloudCheckbox.checked;
});
newReminderForm.addEventListener("submit", submitNewReminder);

async function openNewReminderForm() {
  newReminderForm.hidden = false;
  newReminderBtn.hidden = true;
  newTitleInput.focus();

  if (newReminderOptionsLoaded) return;

  try {
    const response = await fetch("/api/new-reminder-options");
    const data = await response.json();

    todoistProjectSelect.innerHTML = "";
    for (const project of data.todoistProjects) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = project.name;
      todoistProjectSelect.appendChild(option);
    }
    if (data.todoistProjects.length === 0) {
      const option = document.createElement("option");
      option.textContent = "Inbox (por defecto)";
      todoistProjectSelect.appendChild(option);
    }

    icloudListSelect.innerHTML = "";
    for (const list of data.icloudLists) {
      const option = document.createElement("option");
      option.value = list.id;
      option.textContent = list.label;
      icloudListSelect.appendChild(option);
    }

    if (data.icloudLists.length === 0) {
      targetIcloudCheckbox.checked = false;
      targetIcloudCheckbox.disabled = true;
      icloudListSelect.disabled = true;
    } else {
      todoistProjectSelect.disabled = !targetTodoistCheckbox.checked;
      icloudListSelect.disabled = !targetIcloudCheckbox.checked;
    }

    newReminderOptionsLoaded = true;
  } catch (err) {
    console.error(err);
    showNewReminderError("No se pudieron cargar los proyectos/listas disponibles.");
  }
}

function closeNewReminderForm() {
  newReminderForm.hidden = true;
  newReminderBtn.hidden = false;
  newReminderForm.reset();
  targetTodoistCheckbox.checked = true;
  targetIcloudCheckbox.checked = !targetIcloudCheckbox.disabled;
  hideNewReminderError();
}

async function submitNewReminder(event) {
  event.preventDefault();
  hideNewReminderError();

  const title = newTitleInput.value.trim();
  if (!title) {
    showNewReminderError("El título es obligatorio.");
    return;
  }

  if (!targetTodoistCheckbox.checked && !targetIcloudCheckbox.checked) {
    showNewReminderError("Elegí al menos un destino (Todoist y/o Reminders).");
    return;
  }

  const body = {
    title,
    notes: newNotesInput.value.trim(),
    due: newDueInput.value || null,
    targets: {
      todoist: targetTodoistCheckbox.checked,
      todoistProjectId: targetTodoistCheckbox.checked ? todoistProjectSelect.value || null : null,
      icloudListId: targetIcloudCheckbox.checked ? icloudListSelect.value || null : null,
    },
  };

  newReminderSubmitBtn.disabled = true;
  newReminderSubmitBtn.textContent = "Agregando...";

  try {
    const response = await fetch("/api/reminders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `El servidor respondió con estado ${response.status}`);
    }

    closeNewReminderForm();

    if (data.warnings && data.warnings.length) {
      showStatus(data.warnings.join(" · "), "error");
    }

    await loadReminders();
  } catch (err) {
    console.error(err);
    showNewReminderError(err.message);
  } finally {
    newReminderSubmitBtn.disabled = false;
    newReminderSubmitBtn.textContent = "Agregar";
  }
}

function showNewReminderError(message) {
  newReminderError.textContent = message;
  newReminderError.hidden = false;
}

function hideNewReminderError() {
  newReminderError.hidden = true;
}

async function loadReminders() {
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Actualizando...";
  hideStatus();

  try {
    const response = await fetch("/api/reminders");
    if (!response.ok) {
      throw new Error(`El servidor respondió con estado ${response.status}`);
    }
    const data = await response.json();

    const errors = [];
    const items = [];

    if (data.todoist.ok) {
      items.push(...data.todoist.items);
    } else {
      errors.push(`Todoist: ${data.todoist.error}`);
    }

    if (data.icloud.ok) {
      items.push(...data.icloud.items);
      if (data.icloud.warnings && data.icloud.warnings.length) {
        errors.push(...data.icloud.warnings.map((warning) => `Reminders (iCloud) — ${warning}`));
      }
    } else {
      errors.push(`Reminders (iCloud): ${data.icloud.error}`);
    }

    allReminders = items;

    if (errors.length) {
      showStatus(errors.join(" · "), "error");
    }

    render();
  } catch (err) {
    console.error(err);
    showStatus("No se pudo conectar con el servidor local. ¿Está corriendo `npm start`?", "error");
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "🔄 Actualizar";
  }
}

const DUE_BUCKET_ORDER = ["vencidos", "hoy", "manana", "esta-semana", "mas-adelante", "sin-fecha"];
const DUE_BUCKET_LABELS = {
  vencidos: "⚠️ Vencidos",
  hoy: "📅 Hoy",
  manana: "➡️ Mañana",
  "esta-semana": "🗓️ Esta semana",
  "mas-adelante": "📆 Más adelante",
  "sin-fecha": "🗂️ Sin fecha",
};

function getDueBucket(item) {
  if (!item.due) return "sin-fecha";

  const due = new Date(item.due);
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const diffDays = Math.round((dueDay - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "vencidos";
  if (diffDays === 0) return "hoy";
  if (diffDays === 1) return "manana";
  if (diffDays <= 7) return "esta-semana";
  return "mas-adelante";
}

function render() {
  let items = allReminders;

  if (activeFilter !== "all") {
    items = items.filter((item) => item.source === activeFilter);
  }

  if (hideCompletedCheckbox.checked) {
    items = items.filter((item) => !item.completed);
  }

  const groups = new Map();
  for (const item of items) {
    const bucket = getDueBucket(item);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(item);
  }

  for (const bucketItems of groups.values()) {
    bucketItems.sort((a, b) => new Date(a.due || 0) - new Date(b.due || 0));
  }

  listEl.innerHTML = "";

  const hasAny = DUE_BUCKET_ORDER.some((key) => (groups.get(key) || []).length > 0);
  if (!hasAny) {
    listEl.innerHTML = '<p class="empty-state">No hay recordatorios para mostrar.</p>';
    return;
  }

  for (const bucketKey of DUE_BUCKET_ORDER) {
    const bucketItems = groups.get(bucketKey);
    if (!bucketItems || bucketItems.length === 0) continue;

    const section = document.createElement("section");
    section.className = "reminders-group";

    const heading = document.createElement("h2");
    heading.className = `reminders-group__heading reminders-group__heading--${bucketKey}`;
    heading.textContent = `${DUE_BUCKET_LABELS[bucketKey]} (${bucketItems.length})`;
    section.appendChild(heading);

    const cardsWrap = document.createElement("div");
    cardsWrap.className = "reminders-group__cards";
    for (const item of bucketItems) {
      cardsWrap.appendChild(buildCard(item));
    }
    section.appendChild(cardsWrap);

    listEl.appendChild(section);
  }
}

function buildCard(item) {
  const card = document.createElement("article");
  card.className = `reminder-card${item.completed ? " reminder-card--completed" : ""}`;

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "reminder-card__checkbox";
  checkbox.checked = item.completed;
  checkbox.title = item.completed ? "Marcar como pendiente" : "Marcar como completado";
  checkbox.addEventListener("change", () => toggleCompleted(item, checkbox));
  card.appendChild(checkbox);

  const dot = document.createElement("span");
  dot.className = `reminder-card__source reminder-card__source--${item.source}`;
  card.appendChild(dot);

  const body = document.createElement("div");
  body.className = "reminder-card__body";

  const title = document.createElement("h3");
  title.className = "reminder-card__title";
  title.textContent = item.title;
  body.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "reminder-card__meta";

  const badge = document.createElement("span");
  badge.className = `reminder-card__badge reminder-card__badge--${item.source}`;
  badge.textContent = item.source === "todoist" ? "Todoist" : "Reminders";
  meta.appendChild(badge);

  const list = document.createElement("span");
  list.textContent = item.listName;
  meta.appendChild(list);

  if (item.due) {
    const due = document.createElement("span");
    due.textContent = "📅 " + formatDate(item.due, item.isAllDay);
    meta.appendChild(due);
  } else if (item.dueLabel) {
    const due = document.createElement("span");
    due.textContent = "📅 " + item.dueLabel;
    meta.appendChild(due);
  }

  body.appendChild(meta);
  card.appendChild(body);
  return card;
}

async function toggleCompleted(item, checkbox) {
  const newValue = checkbox.checked;
  checkbox.disabled = true;

  try {
    const response = await fetch(`/api/reminders/${encodeURIComponent(item.id)}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: newValue, syncToken: item.syncToken }),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || `El servidor respondió con estado ${response.status}`);
    }

    item.completed = newValue;
    render();
  } catch (err) {
    console.error(err);
    checkbox.checked = !newValue;
    showStatus(`No se pudo actualizar "${item.title}": ${err.message}`, "error");
  } finally {
    checkbox.disabled = false;
  }
}

function formatDate(isoString, isAllDay) {
  const date = new Date(isoString);
  const options = isAllDay
    ? { day: "numeric", month: "short", year: "numeric" }
    : { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" };
  return date.toLocaleString("es-UY", options);
}

function showStatus(message, type) {
  statusMessage.textContent = message;
  statusMessage.hidden = false;
  statusMessage.classList.toggle("status-message--info", type === "info");
}

function hideStatus() {
  statusMessage.hidden = true;
}

loadReminders();
