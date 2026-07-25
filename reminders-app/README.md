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

Editá `.env` y completá:

```
TODOIST_API_TOKEN=tu_token_de_todoist
ICLOUD_APPLE_ID=tu_correo@icloud.com
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
```

El archivo `.env` está en `.gitignore`: nunca se sube al repositorio.

## 3. Ejecutar

```bash
npm start
```

Abrí [http://localhost:3000](http://localhost:3000) en el navegador.

## Funcionalidad

- Lista combinada de tareas de Todoist y recordatorios de Reminders,
  ordenada por fecha de vencimiento.
- Filtros por fuente (Todoist / Reminders / Todos).
- Opción para ocultar recordatorios completados.
- Botón de actualizar para volver a consultar ambas fuentes.
- Si una de las dos fuentes falla (ej. credenciales inválidas), la otra se
  sigue mostrando y se indica el error correspondiente.

## Notas de seguridad

Esta app está pensada para correr **localmente, para uso personal**. El
servidor no tiene autenticación propia: si lo exponés en una red pública o
lo desplegás en un servicio en la nube, cualquiera que acceda a la URL vería
tus recordatorios. No subas tu archivo `.env` ni compartas tus tokens.
