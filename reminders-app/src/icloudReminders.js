const { DAVClient } = require("tsdav");
const ICAL = require("ical.js");

// Recuerda de qué cuenta/URL/etag viene cada recordatorio para poder
// reescribirlo (marcar completado) sin tener que rehacer todo el descubrimiento
// de CalDAV. Se repuebla en cada GET /api/reminders.
const objectCache = new Map();

// Recuerda a qué cuenta/URL de CalDAV corresponde cada lista de Reminders
// ofrecida en el formulario de "nuevo recordatorio". Se repuebla cada vez
// que se piden las listas disponibles.
const listCache = new Map();
let listIdCounter = 0;

function buildClient(account) {
  return new DAVClient({
    serverUrl: "https://caldav.icloud.com",
    credentials: account,
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });
}

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

async function fetchAccountReminders(account) {
  const { username } = account;
  const client = buildClient(account);

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

  const client = buildClient(account);
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

async function getIcloudReminderLists() {
  const accounts = parseAccounts();
  if (accounts.length === 0) return [];

  const results = await Promise.allSettled(
    accounts.map(async (account) => {
      const client = buildClient(account);
      await client.login();
      const calendars = await client.fetchCalendars();
      return calendars
        .filter((calendar) => (calendar.components || []).includes("VTODO"))
        .map((calendar) => ({
          username: account.username,
          url: calendar.url,
          displayName: calendar.displayName || "Recordatorios",
        }));
    })
  );

  listCache.clear();
  const lists = [];

  results.forEach((result) => {
    if (result.status !== "fulfilled") return;
    for (const list of result.value) {
      const id = `list-${listIdCounter++}`;
      listCache.set(id, list);
      lists.push({ id, label: `${list.username.split("@")[0]} · ${list.displayName}` });
    }
  });

  return lists;
}

async function createIcloudReminder({ listId, title, notes, due }) {
  const list = listCache.get(listId);
  if (!list) {
    throw new Error(
      "Esa lista de Reminders ya no está disponible; volvé a abrir el formulario e intentá de nuevo."
    );
  }

  const account = parseAccounts().find((acc) => acc.username === list.username);
  if (!account) {
    throw new Error(`La cuenta ${list.username} ya no está configurada en .env.`);
  }

  const client = buildClient(account);
  await client.login();

  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@recordatorios-unificados`;

  const vcalendar = new ICAL.Component("vcalendar");
  vcalendar.updatePropertyWithValue("prodid", "-//Recordatorios Unificados//ES");
  vcalendar.updatePropertyWithValue("version", "2.0");

  const vtodo = new ICAL.Component("vtodo");
  vtodo.updatePropertyWithValue("uid", uid);
  vtodo.updatePropertyWithValue("summary", title);
  vtodo.updatePropertyWithValue("dtstamp", ICAL.Time.now());
  if (notes) {
    vtodo.updatePropertyWithValue("description", notes);
  }
  if (due) {
    const dueTime = ICAL.Time.fromJSDate(new Date(due), false);
    dueTime.isDate = true;
    vtodo.updatePropertyWithValue("due", dueTime);
  }
  vcalendar.addSubcomponent(vtodo);

  await client.createCalendarObject({
    calendar: { url: list.url },
    iCalString: vcalendar.toString(),
    filename: `${uid}.ics`,
  });
}

module.exports = {
  getIcloudReminders,
  setIcloudReminderCompleted,
  getIcloudReminderLists,
  createIcloudReminder,
};
