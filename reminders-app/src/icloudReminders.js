const { DAVClient } = require("tsdav");
const ICAL = require("ical.js");

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
    const objects = await client.fetchCalendarObjects({ calendar: list });

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

module.exports = { getIcloudReminders };
