# Recordatorios Unificados

Web app local que muestra en una sola lista tus tareas de **Todoist**, tus
**Apple Reminders** (iCloud) y tus tareas de **Microsoft To Do**, ordenadas
por fecha. Microsoft To Do es opcional — la app funciona igual sin conectarlo.

Apple no ofrece una API web pública para Reminders, así que esta app usa un
pequeño servidor Node/Express que:

- Llama a la **API REST de Todoist** con tu token personal.
- Se conecta a **iCloud vía CalDAV** (el mismo protocolo que usa la app
  Reminders de Apple) para leer tus listas de recordatorios.
- Llama a **Microsoft Graph** (API de Microsoft To Do) usando OAuth, si
  conectaste tu cuenta de Microsoft desde el botón de la app.

El backend existe para que tus credenciales nunca queden expuestas en el
navegador ni en el repositorio.

## Requisitos

- Node.js 18 o superior.
- Una cuenta de Todoist con un token de API.
- Un Apple ID con verificación en dos pasos activada (necesaria para generar
  contraseñas de app).
- (Opcional) Una cuenta de Microsoft y una app registrada en Entra ID, si
  querés sumar Microsoft To Do.

## 1. Conseguir las credenciales

**Todoist:** entrá a Todoist en la web → ⚙️ Configuración → Integraciones →
pestaña "Desarrollador" → copiá el "API token".

**iCloud (Reminders):**

1. Andá a [appleid.apple.com](https://appleid.apple.com) e iniciá sesión.
2. En "Inicio de sesión y seguridad" buscá **"Contraseñas de apps"**.
3. Generá una nueva contraseña de app (ej: "Recordatorios Unificados").
4. Copiá la contraseña generada (formato `xxxx-xxxx-xxxx-xxxx`) — **no** es tu
   contraseña habitual de Apple ID.

**Microsoft To Do (opcional):**

1. Andá a [entra.microsoft.com](https://entra.microsoft.com) e iniciá sesión
   con tu cuenta de Microsoft.
2. **"App registrations"** → **"+ New registration"**.
3. Nombre libre (ej. "Recordatorios unificados"), **Supported account
   types** → "Accounts in any organizational directory and personal
   Microsoft accounts", **Redirect URI** → tipo "Web",
   `http://localhost:3000/auth/microsoft/callback` (agregá también la URL
   de Render si vas a desplegarlo ahí — ver más abajo).
4. **Register**. Guardá el **Application (client) ID** y el **Directory
   (tenant) ID** que aparecen en la página.
5. **"Certificates & secrets"** → **"+ New client secret"** → copiá el
   **"Value"** apenas se genera (después no se puede volver a ver).
6. **"API permissions"** → **"+ Add a permission"** → **Microsoft Graph** →
   **Delegated permissions** → tildá `Tasks.ReadWrite` y `offline_access` →
   **Add permissions**. No hace falta "Grant admin consent": estos permisos
   no lo requieren, cada usuario los autoriza para sí mismo al iniciar sesión.

## 2. Configurar el proyecto

```bash
cd reminders-app
npm install
cp .env.example .env
```

Editá `.env` y completá, para una sola cuenta de iCloud:

```
TODOIST_API_TOKEN=tu_token_de_todoist
ICLOUD_APPLE_ID=tu_correo@icloud.com
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

O, para combinar **varias cuentas de iCloud** (ej. personal + trabajo), usá
`ICLOUD_ACCOUNTS` en su lugar (tiene prioridad sobre `ICLOUD_APPLE_ID` /
`ICLOUD_APP_PASSWORD` si está definida):

```
TODOIST_API_TOKEN=tu_token_de_todoist
ICLOUD_ACCOUNTS=personal@icloud.com:xxxx-xxxx-xxxx-xxxx,trabajo@icloud.com:yyyy-yyyy-yyyy-yyyy
```

Cada cuenta necesita su propia contraseña de app (repetí el paso anterior una
vez por Apple ID). Los recordatorios de cada cuenta se muestran identificados
con su nombre de usuario en el nombre de la lista (ej. "personal · Hogar").

Si vas a usar Microsoft To Do, completá además:

```
MS_CLIENT_ID=el_application_client_id
MS_CLIENT_SECRET=el_secreto_que_generaste
MS_TENANT_ID=el_directory_tenant_id
MS_REDIRECT_URI=http://localhost:3000/auth/microsoft/callback
```

El archivo `.env` está en `.gitignore`: nunca se sube al repositorio.

## 3. Ejecutar

```bash
npm start
```

Abrí [http://localhost:3000](http://localhost:3000) en el navegador.

Si completaste las variables de Microsoft, hacé clic en **"🔗 Conectar
Microsoft"** (arriba a la derecha) e iniciá sesión — te va a pedir
autorizar el acceso a tus tareas, y después te trae de vuelta a la app ya
conectada. "Desconectar Microsoft" simplemente olvida esa conexión en tu
navegador (no borra nada de tu cuenta de Microsoft).

## Funcionalidad

- Lista combinada de tareas de Todoist, recordatorios de Reminders (de una o
  varias cuentas de iCloud) y, si conectaste tu cuenta, tareas de Microsoft
  To Do — agrupada por fecha: **Vencidos, Hoy, Mañana, Esta semana, Más
  adelante y Sin fecha** (en ese orden), y ordenada por fecha dentro de cada
  grupo.
- Buscador de texto (por título o notas, sin distinguir mayúsculas ni tildes).
- Filtros por fuente (Todoist / Reminders / Microsoft / Todos) y opción para
  ocultar recordatorios completados — ambos se recuerdan entre sesiones
  (guardados en el navegador con `localStorage`), así no hay que
  reconfigurarlos cada vez que abrís la app.
- Botón de actualizar para volver a consultar todas las fuentes.
- Casillero para marcar un recordatorio como completado (o reabrirlo) desde
  la lista unificada — el cambio se sincroniza con Todoist, iCloud o
  Microsoft To Do según corresponda, no es solo visual.
- Si una fuente o cuenta falla (ej. credenciales inválidas), las demás se
  siguen mostrando y se indica el error correspondiente.
- Botón **"➕ Nuevo recordatorio"** para crear uno con título, notas y fecha
  opcional, eligiendo si se crea en Todoist, en una lista de Reminders de
  iCloud, en Microsoft To Do, o en cualquier combinación de las tres. Nota:
  el recordatorio se crea en cada destino elegido en ese momento; no queda
  "enlazado" después — completarlo o editarlo en un lado no afecta al otro
  (salvo el marcado de completado, que si se hace desde esta app sí se
  sincroniza, como se explica abajo).
- Botón ✏️ en cada tarjeta para **editar** título, notas y fecha de un
  recordatorio existente — el cambio se guarda directamente en Todoist,
  iCloud o Microsoft To Do, según corresponda.

## Notas sobre completar recordatorios

- En Todoist, completar una tarea **recurrente** programa su próxima
  ocurrencia (es el comportamiento normal de Todoist), no la borra.
- El servidor no guarda nada en memoria entre pedidos: cada recordatorio de
  iCloud viaja con un pequeño token que el navegador reenvía al completarlo,
  así que reiniciar el servidor (o que un hosting como Render lo duerma y
  despierte) no rompe la posibilidad de marcarlos como completados.
- La conexión con Microsoft funciona igual: el servidor tampoco guarda tu
  sesión de Microsoft — el token que permite renovar el acceso queda
  guardado en el `localStorage` de tu navegador (no en el servidor). Si
  cambiás de navegador o de dispositivo, o borrás los datos del sitio,
  hace falta volver a conectar con el botón "Conectar Microsoft".

## Desplegar en Render (gratis)

Si querés acceder desde el celular sin dejar tu computadora prendida, podés
alojar este mismo servidor en [Render](https://render.com), que tiene un
plan gratuito.

1. Subí este repositorio a GitHub (ya lo está) e iniciá sesión en Render con
   tu cuenta de GitHub.
2. **New +** → **Web Service** → elegí el repositorio `App-Claude-Rebeken`.
3. Configurá:
   - **Root Directory**: `reminders-app` (la app vive en una subcarpeta del repo).
   - **Runtime**: Node.
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free.
4. En la sección **Environment Variables**, agregá las mismas variables que
   tenés en tu `.env` local: `TODOIST_API_TOKEN`, `ICLOUD_APPLE_ID` /
   `ICLOUD_APP_PASSWORD` (o `ICLOUD_ACCOUNTS`), y **además** `APP_USERNAME` /
   `APP_PASSWORD` (ver sección de abajo — son obligatorias para no dejar la
   app abierta a cualquiera en internet). No hace falta poner `PORT`: Render
   lo define solo.
5. **Create Web Service**. Render instala, arranca, y te da una URL pública
   tipo `https://recordatorios-unificados.onrender.com`.
6. Desde el celular, abrí esa URL en el navegador, iniciá sesión con el
   usuario/contraseña que configuraste, y usá "Agregar a pantalla de inicio"
   para tener un ícono como el de una app.

**Si además usás Microsoft To Do**, hay dos ajustes extra:

- En Render, agregá `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_TENANT_ID`, y
  `MS_REDIRECT_URI` apuntando a tu URL de Render (ej.
  `https://recordatorios-unificados.onrender.com/auth/microsoft/callback`),
  no a `localhost`.
- En Entra ID → tu app → **"Authentication"**, agregá esa misma URL de
  Render como un segundo **Redirect URI** (podés tener varios: uno para
  `localhost` y otro para Render).

El plan gratis "duerme" el servicio tras ~15 minutos sin uso; la primera
vez que lo abrís después de eso tarda unos 30-50 segundos en responder,
después anda normal. Cada vez que se hace `git push` a `main`, Render
vuelve a desplegar automáticamente.

## Notas de seguridad

Esta app corre sin autenticación **por defecto**, pensada para uso local en
tu propia compu. Si la desplegás en un hosting público (Render u otro),
**configurá `APP_USERNAME` y `APP_PASSWORD`** en las variables de entorno:
sin esas dos, cualquiera que encuentre la URL vería (y podría modificar) tus
recordatorios. Con ellas configuradas, el navegador te va a pedir usuario y
contraseña antes de mostrar nada. No subas tu archivo `.env` ni compartas
tus tokens o esas credenciales.
