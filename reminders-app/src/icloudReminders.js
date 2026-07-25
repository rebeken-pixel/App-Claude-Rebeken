const { DAVClient } = require("tsdav");
const ICAL = require("ical.js");

async function getIcloudReminders() {
  const username = process.env.ICLOUD_APPLE_ID;
  const password = process.env.ICLOUD_APP_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "Faltan ICLOUD_APPLE_ID / ICLOUD_APP_PASSWORD en el archivo .env (usá una contraseña de app generada en appleid.apple.com)."
    );
  }

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
          id: `icloud-${vtodo.getFirstPropertyValue("uid")}`,
          source: "icloud",
          title: vtodo.getFirstPropertyValue("summary") || "(Sin título)",
          notes: vtodo.getFirstPropertyValue("description") || "",
          due,
          dueLabel: null,
          isAllDay: dueProp ? dueProp.getFirstValue().isDate : true,
          listName: list.displayName || "Recordatorios",
          completed: status === "COMPLETED",
          priority: vtodo.getFirstPropertyValue("priority") || 0,
        });
      }
    }
  }

  return reminders;
}

module.exports = { getIcloudReminders };
