const { DAVClient } = require("tsdav");
const ICAL = require("ical.js");

// El servidor no guarda nada en memoria entre pedidos (para poder correr en
// hostings que duermen/reinician el proceso, como el plan gratis de Render).
// En cambio, cada recordatorio de iCloud viaja con un "syncToken" opaco
// (cuenta + URLs de CalDAV codificadas en base64) que el navegador guarda y
// reenvía cuando hace falta reescribir ese recordatorio.
function encodeToken(payload) {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeToken(token) {
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch (err) {
    throw new Error("Token inválido o vencido; actualizá la página e intentá de nuevo.");
  }
}

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

function findAccount(username) {
  const account = parseAccounts().find((acc) => acc.username === username);
  if (!account) {
    throw new Error(`La cuenta ${username} ya no está configurada en .env.`);
  }
  return account;
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

        const syncToken = encodeToken({
          username,
          calendarUrl: list.url,
          objectUrl: object.url,
        });

        reminders.push({
          id: `icloud-${username}-${vtodo.getFirstPropertyValue("uid")}`,
          source: "icloud",
          title: vtodo.getFirstPropertyValue("summary") || "(Sin título)",
          notes: vtodo.getFirstPropertyValue("description") || "",
          due,
          dueLabel: null,
          isAllDay: dueProp ? dueProp.getFirstValue().isDate : true,
          listName: `${accountLabel} · ${list.displayName || "Recordatorios"}`,
          completed: status === "COMPLETED",
          priority: vtodo.getFirstPropertyValue("priority") || 0,
          syncToken,
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

async function setIcloudReminderCompleted(syncToken, completed) {
  if (!syncToken) {
    throw new Error("Falta el token del recordatorio; actualizá la página e intentá de nuevo.");
  }

  const { username, calendarUrl, objectUrl } = decodeToken(syncToken);
  const account = findAccount(username);

  const client = buildClient(account);
  await client.login();

  const [object] = await client.fetchCalendarObjects({
    calendar: { url: calendarUrl },
    objectUrls: [objectUrl],
  });

  if (!object || !object.data) {
    throw new Error(
      "No se encontró ese recordatorio en iCloud; puede que ya no exista. Actualizá la página."
    );
  }

  const jcalData = ICAL.parse(object.data);
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
    calendarObject: { url: object.url, etag: object.etag, data: updatedData },
  });
}

async function updateIcloudReminder(syncToken, { title, notes, due }) {
  if (!syncToken) {
    throw new Error("Falta el token del recordatorio; actualizá la página e intentá de nuevo.");
  }

  const { username, calendarUrl, objectUrl } = decodeToken(syncToken);
  const account = findAccount(username);

  const client = buildClient(account);
  await client.login();

  const [object] = await client.fetchCalendarObjects({
    calendar: { url: calendarUrl },
    objectUrls: [objectUrl],
  });

  if (!object || !object.data) {
    throw new Error(
      "No se encontró ese recordatorio en iCloud; puede que ya no exista. Actualizá la página."
    );
  }

  const jcalData = ICAL.parse(object.data);
  const component = new ICAL.Component(jcalData);
  const vtodo = component.getFirstSubcomponent("vtodo");

  if (title !== undefined) {
    vtodo.updatePropertyWithValue("summary", title);
  }

  if (notes !== undefined) {
    if (notes) {
      vtodo.updatePropertyWithValue("description", notes);
    } else {
      vtodo.removeProperty("description");
    }
  }

  if (due !== undefined) {
    if (due) {
      const dueTime = ICAL.Time.fromJSDate(new Date(due), false);
      dueTime.isDate = true;
      vtodo.updatePropertyWithValue("due", dueTime);
    } else {
      vtodo.removeProperty("due");
    }
  }

  const updatedData = component.toString();

  await client.updateCalendarObject({
    calendarObject: { url: object.url, etag: object.etag, data: updatedData },
  });
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
          id: encodeToken({ username: account.username, url: calendar.url }),
          label: `${account.username.split("@")[0]} · ${calendar.displayName || "Recordatorios"}`,
        }));
    })
  );

  const lists = [];
  results.forEach((result) => {
    if (result.status === "fulfilled") lists.push(...result.value);
  });

  return lists;
}

async function createIcloudReminder({ listId, title, notes, due }) {
  if (!listId) {
    throw new Error("Falta elegir una lista de Reminders.");
  }

  const { username, url } = decodeToken(listId);
  const account = findAccount(username);

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
    calendar: { url },
    iCalString: vcalendar.toString(),
    filename: `${uid}.ics`,
  });
}

module.exports = {
  getIcloudReminders,
  setIcloudReminderCompleted,
  getIcloudReminderLists,
  createIcloudReminder,
  updateIcloudReminder,
};
