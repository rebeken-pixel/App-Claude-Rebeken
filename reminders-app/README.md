# Recordatorios Unificados

Web app local que muestra en una sola lista tus tareas de **Todoist** y tus
**Apple Reminders** (iCloud), ordenadas por fecha.

Apple no ofrece una API web pública para Reminders, así que esta app usa un
pequeño servidor Node/Express que:

- Llama a la **API REST de Todoist** con tu token personal.
- Se conecta a **iCloud vía CalDAV** (el mismo protocolo que usa la app
  Reminders de Apple) para leer tus listas de recordatorios.

El backend existe para que tus credenciales nunca queden expuestas en el
navegador ni en el repositorio.

## Requisitos

- Node.js 18 o superior.
- Una cuenta de Todoist con un token de API.
- Un Apple ID con verificación en dos pasos activada (necesaria para generar
  contraseñas de app).

## 1. Conseguir las credenciales

**Todoist:** entrá a Todoist en la web → ⚙️ Configuración → Integraciones →
pestaña "Desarrollador" → copiá el "API token".

**iCloud (Reminders):**

1. Andá a [appleid.apple.com](https://appleid.apple.com) e iniciá sesión.
2. En "Inicio de sesión y seguridad" buscá **"Contraseñas de apps"**.
3. Generá una nueva contraseña de app (ej: "Recordatorios Unificados").
4. Copiá la contraseña generada (formato `xxxx-xxxx-xxxx-xxxx`) — **no** es tu
   contraseña habitual de Apple ID.

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

El archivo `.env` está en `.gitignore`: nunca se sube al repositorio.

## 3. Ejecutar

```bash
npm start
```

Abrí [http://localhost:3000](http://localhost:3000) en el navegador.

## Funcionalidad

- Lista combinada de tareas de Todoist y recordatorios de Reminders (de una o
  varias cuentas de iCloud), agrupada por fecha: **Vencidos, Hoy, Mañana,
  Esta semana, Más adelante y Sin fecha** (en ese orden), y ordenada por
  fecha dentro de cada grupo.
- Buscador de texto (por título o notas, sin distinguir mayúsculas ni tildes).
- Filtros por fuente (Todoist / Reminders / Todos).
- Opción para ocultar recordatorios completados.
- Botón de actualizar para volver a consultar todas las fuentes.
- Casillero para marcar un recordatorio como completado (o reabrirlo) desde
  la lista unificada — el cambio se sincroniza con Todoist o iCloud según
  corresponda, no es solo visual.
- Si una fuente o cuenta falla (ej. credenciales inválidas), las demás se
  siguen mostrando y se indica el error correspondiente.
- Botón **"➕ Nuevo recordatorio"** para crear uno con título, notas y fecha
  opcional, eligiendo si se crea en Todoist, en una lista de Reminders de
  iCloud, o en ambos a la vez. Nota: el recordatorio se crea en cada destino
  elegido en ese momento; no queda "enlazado" después — completarlo o editarlo
  en un lado no afecta al otro (salvo el marcado de completado, que si se hace
  desde esta app sí se sincroniza, como se explica abajo).
- Botón ✏️ en cada tarjeta para **editar** título, notas y fecha de un
  recordatorio existente — el cambio se guarda directamente en Todoist o
  iCloud, según corresponda.

## Notas sobre completar recordatorios

- En Todoist, completar una tarea **recurrente** programa su próxima
  ocurrencia (es el comportamiento normal de Todoist), no la borra.
- El servidor no guarda nada en memoria entre pedidos: cada recordatorio de
  iCloud viaja con un pequeño token que el navegador reenvía al completarlo,
  así que reiniciar el servidor (o que un hosting como Render lo duerma y
  despierte) no rompe la posibilidad de marcarlos como completados.

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
