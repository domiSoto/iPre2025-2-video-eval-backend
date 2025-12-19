# iPre2025-2-video-eval-backend

## Descripción del proyecto

Backend para la evaluación automática de videos y materiales de presentación (PDF, PPTX, etc.) usando modelos de IA. 

Este servicio expone endpoints HTTP para:
- Subir videos y archivos de presentación.
- Transcribir y dividir contenido en fragmentos (jobs en la carpeta `jobs/`).
- Enviar el contenido a modelos de IA para generar evaluaciones y reportes.
- Consultar el estado de los procesos y descargar resultados.

Está pensado para integrarse con un frontend de iPre2025, pero se puede usar de forma independiente vía API.

## Requisitos e instalación

1. **Requisitos previos**
	 - Node.js >= 18
	 - PostgreSQL accesible (local o remoto)

2. **Clonar el repositorio**

```bash
git clone https://github.com/domiSoto/iPre2025-2-video-eval-backend.git
cd iPre2025-2-video-eval-backend
```

3. **Instalar dependencias**

```bash
npm install
```

4. **Configurar variables de entorno**

Crea un archivo `.env` en la raíz del proyecto con al menos:

```env
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=tu_nombre_de_BDD
DATABASE_URL=postgres://usuario:password@host:puerto/basedatos

API_KEY=tu_clave_de_modelo
API_URL=url_del_endpoint_de_modelo
```

En este caso especifico se utilizo una API KEY de Open Router por lo que la API URL es https://openrouter.ai/api/v1/chat/completions

5. **Ejecutar migraciones de base de datos**

```bash
npm run migrate
```

o usando Sequelize CLI y la configuración específica:

```bash
npm run sequelize:migrate
```

6. **Levantar el servidor**

```bash
node server.js
```

El servidor quedará escuchando en `http://localhost:3000`.

## Dependencias principales

Las dependencias más relevantes del proyecto (ver `package.json`):

- `express`: framework HTTP principal para definir las rutas del backend.
- `cors`: habilita CORS para permitir peticiones desde el frontend.
- `dotenv`: carga variables de entorno desde `.env`.
- `multer`: manejo de subida de archivos (videos, PDFs, PPTX, etc.).
- `axios` / `node-fetch` / `undici`: para realizar llamadas HTTP a APIs externas (modelos de IA, etc.).
- `pdf-parse`: lectura y extracción de texto desde archivos PDF.
- `pptx-parser`, `pptx2json`: utilidades para procesar presentaciones PPTX.
- `pg`, `sequelize`: acceso y mapeo a PostgreSQL, migraciones y modelos.

Scripts útiles definidos en `package.json`:

- `npm start`: inicia el servidor (`server.js`).
- `npm run start:dev`: inicia el servidor en modo desarrollo.
- `npm run migrate`: corre las migraciones definidas en `migrations/`.
- `npm run sequelize:migrate`: corre las migraciones definidas en `sequelize_migrations/` con la configuración de `config/config.cjs`.

## Estructura del proyecto

Resumen de las carpetas y archivos principales:

- `server.js`: punto de entrada del backend Express. Configura CORS, JSON, subida de archivos con `multer` y monta las rutas principales.

- `routes/`
	- `video_routes.js`: rutas relacionadas con videos (subida, manejo de jobs de video, etc.).
	- `evaluate_routes.js`: endpoints para evaluar contenido (videos, transcripciones, presentaciones) usando modelos de IA.
	- `upload_routes.js`: rutas genéricas de subida de archivos.
	- `workspace_routes.js`: operaciones sobre el workspace (gestión de archivos, exploración, etc.).
	- `dashboard_routes.js`: endpoints para el dashboard (estadísticas, listados de jobs, etc.).

- `jobs/`
	- Carpeta donde se almacenan los trabajos (jobs) generados al subir y procesar archivos.
	- Cada subcarpeta de job contiene un `metadata.json`, un directorio `chunks/` con fragmentos del video/archivo, y `transcripts/` con transcripciones en `.srt`.

- `lib/db.js`
	- Configuración y helpers para la conexión a PostgreSQL mediante `pg` / `sequelize`.

- `migrations/`
	- `001_create_tables.sql`: script SQL inicial para crear las tablas necesarias.
	- `run_migrations.js`: script Node para ejecutar las migraciones definidas aquí.

- `sequelize_migrations/`
	- Migraciones gestionadas con `sequelize-cli` (por ejemplo, `20251024-create-tables.cjs`).

- `config/config.cjs`
	- Configuración de conexión a base de datos para `sequelize-cli` (ambientes development, test, production).

- Scripts varios en la raíz (`automate-video.js`, `evaluate_video.cjs`, `upload-video.js`, etc.)
	- Scripts principales para cargar videos, evaluar archivos de forma batch, etc.
