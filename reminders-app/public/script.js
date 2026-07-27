const listEl = document.getElementById("list");
const statusMessage = document.getElementById("status-message");
const refreshBtn = document.getElementById("refresh-btn");
const hideCompletedCheckbox = document.getElementById("hide-completed");
const filterChips = document.querySelectorAll(".chip");

let allReminders = [];
let activeFilter = "all";

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

function render() {
  let items = allReminders;

  if (activeFilter !== "all") {
    items = items.filter((item) => item.source === activeFilter);
  }

  if (hideCompletedCheckbox.checked) {
    items = items.filter((item) => !item.completed);
  }

  items = [...items].sort((a, b) => {
    if (!a.due && !b.due) return 0;
    if (!a.due) return 1;
    if (!b.due) return -1;
    return new Date(a.due) - new Date(b.due);
  });

  listEl.innerHTML = "";

  if (items.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No hay recordatorios para mostrar.</p>';
    return;
  }

  for (const item of items) {
    listEl.appendChild(buildCard(item));
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
      body: JSON.stringify({ completed: newValue }),
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
