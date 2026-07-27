const { DAVClient } = require("tsdav");
const ICAL = require("ical.js");

// Recuerda de qué cuenta/URL/etag viene cada recordatorio para poder
// reescribirlo (marcar completado) sin tener que rehacer todo el descubrimiento
// de CalDAV. Se repuebla en cada GET /api/reminders.
const objectCache = new Map();

function parseAccounts() {
  const raw = process.env.ICLOUD_ACCOUNTS;

  if (raw && raw.trim()) {
    return raw
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [username, password] = entry.split(":").map((part) => part.trim());
        return { username, password };
      });
  }

  const username = process.env.ICLOUD_APPLE_ID;
  const password = process.env.ICLOUD_APP_PASSWORD;
  if (username && password) {
    return [{ username, password }];
  }

  return [];
}

async function fetchAccountReminders({ username, password }) {
  const client = new DAVClient({
    serverUrl: "https://caldav.icloud.com",
    credentials: { username, password },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  await client.login();

  const calendars = await client.fetchCalendars();
  const reminderLists = calendars.filter((calendar) =>
    (calendar.components || []).includes("VTODO")
  );

  const accountLabel = username.split("@")[0];
  const reminders = [];

  for (const list of reminderLists) {
    const objects = await client.fetchCalendarObjects({
      calendar: list,
      filters: [
        {
          "comp-filter": {
            _attributes: { name: "VCALENDAR" },
            "comp-filter": { _attributes: { name: "VTODO" } },
          },
        },
      ],
    });

    for (const object of objects) {
      if (!object.data) continue;

      let vtodos;
      try {
        const jcalData = ICAL.parse(object.data);
        const component = new ICAL.Component(jcalData);
        vtodos = component.getAllSubcomponents("vtodo");
      } catch (err) {
        continue;
      }

      for (const vtodo of vtodos) {
        const status = vtodo.getFirstPropertyValue("status");
        const dueProp = vtodo.getFirstProperty("due");
        const due = dueProp ? dueProp.getFirstValue().toJSDate().toISOString() : null;
        const id = `icloud-${username}-${vtodo.getFirstPropertyValue("uid")}`;

        objectCache.set(id, {
          username,
          url: object.url,
          etag: object.etag,
          data: object.data,
        });

        reminders.push({
          id,
          source: "icloud",
          title: vtodo.getFirstPropertyValue("summary") || "(Sin título)",
          notes: vtodo.getFirstPropertyValue("description") || "",
          due,
          dueLabel: null,
          isAllDay: dueProp ? dueProp.getFirstValue().isDate : true,
          listName: `${accountLabel} · ${list.displayName || "Recordatorios"}`,
          completed: status === "COMPLETED",
          priority: vtodo.getFirstPropertyValue("priority") || 0,
        });
      }
    }
  }

  return reminders;
}

async function getIcloudReminders() {
  const accounts = parseAccounts();

  if (accounts.length === 0) {
    throw new Error(
      "Falta configurar al menos una cuenta de iCloud en .env (ICLOUD_ACCOUNTS, o ICLOUD_APPLE_ID/ICLOUD_APP_PASSWORD)."
    );
  }

  const results = await Promise.allSettled(accounts.map(fetchAccountReminders));

  const items = [];
  const errors = [];

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      items.push(...result.value);
    } else {
      errors.push(`${accounts[index].username}: ${result.reason.message}`);
    }
  });

  if (items.length === 0 && errors.length > 0) {
    throw new Error(errors.join(" · "));
  }

  return { items, errors };
}

async function setIcloudReminderCompleted(id, completed) {
  const cached = objectCache.get(id);
  if (!cached) {
    throw new Error(
      "No se encontró ese recordatorio en la última carga; actualizá la página e intentá de nuevo."
    );
  }

  const account = parseAccounts().find((acc) => acc.username === cached.username);
  if (!account) {
    throw new Error(`La cuenta ${cached.username} ya no está configurada en .env.`);
  }

  const client = new DAVClient({
    serverUrl: "https://caldav.icloud.com",
    credentials: account,
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
  await client.login();

  const jcalData = ICAL.parse(cached.data);
  const component = new ICAL.Component(jcalData);
  const vtodo = component.getFirstSubcomponent("vtodo");

  if (completed) {
    vtodo.updatePropertyWithValue("status", "COMPLETED");
    vtodo.updatePropertyWithValue("percent-complete", 100);
    vtodo.updatePropertyWithValue("completed", ICAL.Time.now());
  } else {
    vtodo.removeProperty("status");
    vtodo.removeProperty("percent-complete");
    vtodo.removeProperty("completed");
  }

  const updatedData = component.toString();

  await client.updateCalendarObject({
    calendarObject: { url: cached.url, etag: cached.etag, data: updatedData },
  });

  cached.data = updatedData;
}

module.exports = { getIcloudReminders, setIcloudReminderCompleted };
