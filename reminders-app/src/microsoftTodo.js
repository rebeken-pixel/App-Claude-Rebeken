const { encodeToken, decodeToken } = require("./syncToken");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const SCOPES =
  "openid offline_access https://graph.microsoft.com/Tasks.ReadWrite https://graph.microsoft.com/User.Read";

function getConfig() {
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  const redirectUri = process.env.MS_REDIRECT_URI;
  const tenant = process.env.MS_TENANT_ID || "common";

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Falta configurar MS_CLIENT_ID, MS_CLIENT_SECRET y MS_REDIRECT_URI en el .env (ver README para el registro en Entra ID)."
    );
  }

  return { clientId, clientSecret, redirectUri, tenant };
}

function isMicrosoftConfigured() {
  return Boolean(
    process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET && process.env.MS_REDIRECT_URI
  );
}

function getAuthorizeUrl() {
  const { clientId, redirectUri, tenant } = getConfig();

  const url = new URL(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("prompt", "select_account");

  return url.toString();
}

async function requestToken(bodyParams) {
  const { tenant } = getConfig();

  const response = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyParams,
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Microsoft respondió con estado ${response.status}: ${data.error_description || data.error || "error desconocido"}`
    );
  }

  return data;
}

async function exchangeCodeForTokens(code) {
  const { clientId, clientSecret, redirectUri } = getConfig();

  return requestToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      scope: SCOPES,
    })
  );
}

async function refreshAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error("No conectaste tu cuenta de Microsoft To Do todavía.");
  }

  const { clientId, clientSecret, redirectUri } = getConfig();

  const tokens = await requestToken(
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      redirect_uri: redirectUri,
      scope: SCOPES,
    })
  );

  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || refreshToken,
  };
}

async function graphFetch(accessToken, path, options = {}) {
  const response = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Microsoft To Do respondió con estado ${response.status}: ${text.slice(0, 200)}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function graphFetchAllPages(accessToken, path) {
  let url = `${GRAPH_BASE}${path}`;
  const results = [];

  while (url) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Microsoft To Do respondió con estado ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    results.push(...(data.value || []));
    url = data["@odata.nextLink"] || null;
  }

  return results;
}

function toDueIso(dueDateTime) {
  if (!dueDateTime || !dueDateTime.dateTime) return null;
  const raw = dueDateTime.dateTime;
  const iso = raw.endsWith("Z") ? raw : `${raw}Z`;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toGraphDueDateTime(due) {
  return due ? { dateTime: `${due}T00:00:00.0000000`, timeZone: "UTC" } : null;
}

async function getMicrosoftTasks(refreshToken) {
  if (!refreshToken) {
    throw new Error("No conectaste tu cuenta de Microsoft To Do todavía.");
  }

  const { accessToken, refreshToken: newRefreshToken } = await refreshAccessToken(refreshToken);

  const lists = await graphFetchAllPages(accessToken, "/me/todo/lists");
  const items = [];

  for (const list of lists) {
    const tasks = await graphFetchAllPages(accessToken, `/me/todo/lists/${list.id}/tasks`);

    for (const task of tasks) {
      items.push({
        id: `mstodo-${list.id}-${task.id}`,
        source: "mstodo",
        title: task.title || "(Sin título)",
        notes: (task.body && task.body.content) || "",
        due: toDueIso(task.dueDateTime),
        dueLabel: null,
        isAllDay: true,
        listName: list.displayName || "Microsoft To Do",
        completed: task.status === "completed",
        priority: task.importance === "high" ? 1 : task.importance === "low" ? 4 : 3,
        syncToken: encodeToken({ listId: list.id, taskId: task.id }),
      });
    }
  }

  return { items, refreshToken: newRefreshToken };
}

async function setMicrosoftTaskCompleted(refreshToken, syncToken, completed) {
  if (!syncToken) {
    throw new Error("Falta el token de la tarea; actualizá la página e intentá de nuevo.");
  }

  const { listId, taskId } = decodeToken(syncToken);
  const { accessToken, refreshToken: newRefreshToken } = await refreshAccessToken(refreshToken);

  await graphFetch(accessToken, `/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify({ status: completed ? "completed" : "notStarted" }),
  });

  return { refreshToken: newRefreshToken };
}

async function updateMicrosoftTask(refreshToken, syncToken, { title, notes, due }) {
  if (!syncToken) {
    throw new Error("Falta el token de la tarea; actualizá la página e intentá de nuevo.");
  }

  const { listId, taskId } = decodeToken(syncToken);
  const { accessToken, refreshToken: newRefreshToken } = await refreshAccessToken(refreshToken);

  const body = {};
  if (title !== undefined) body.title = title;
  if (notes !== undefined) body.body = { content: notes || "", contentType: "text" };
  if (due !== undefined) body.dueDateTime = toGraphDueDateTime(due);

  await graphFetch(accessToken, `/me/todo/lists/${listId}/tasks/${taskId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

  return { refreshToken: newRefreshToken };
}

async function getMicrosoftTaskLists(refreshToken) {
  if (!refreshToken) {
    return { lists: [], refreshToken: null };
  }

  const { accessToken, refreshToken: newRefreshToken } = await refreshAccessToken(refreshToken);
  const lists = await graphFetchAllPages(accessToken, "/me/todo/lists");

  return {
    lists: lists.map((list) => ({
      id: encodeToken({ listId: list.id }),
      label: list.displayName || "Microsoft To Do",
    })),
    refreshToken: newRefreshToken,
  };
}

async function createMicrosoftTask(refreshToken, { listId, title, notes, due }) {
  if (!listId) {
    throw new Error("Falta elegir una lista de Microsoft To Do.");
  }

  const { listId: rawListId } = decodeToken(listId);
  const { accessToken, refreshToken: newRefreshToken } = await refreshAccessToken(refreshToken);

  const body = { title };
  if (notes) body.body = { content: notes, contentType: "text" };
  const dueDateTime = toGraphDueDateTime(due);
  if (dueDateTime) body.dueDateTime = dueDateTime;

  await graphFetch(accessToken, `/me/todo/lists/${rawListId}/tasks`, {
    method: "POST",
    body: JSON.stringify(body),
  });

  return { refreshToken: newRefreshToken };
}

module.exports = {
  isMicrosoftConfigured,
  getAuthorizeUrl,
  exchangeCodeForTokens,
  getMicrosoftTasks,
  setMicrosoftTaskCompleted,
  updateMicrosoftTask,
  getMicrosoftTaskLists,
  createMicrosoftTask,
};
