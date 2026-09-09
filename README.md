# HorizonDB Fleet Intelligence

HorizonDB Fleet Intelligence is a customer-ready spatial and semantic operations
sample built with FastAPI, Psycopg 3, React, and Vite. One workflow demonstrates:

- PostGIS stores origin, destination, and current shipment positions as SRID
  4326 points and serves them to a Leaflet world map.
- HorizonDB's built-in `default-embedding` model creates 1,536-dimensional
  vectors through the `azure_ai` model registry.
- PostGIS `ST_DWithin` constrains retrieval to a map-selected search radius.
- pgvector cosine distance (`<=>`) and spatial distance produce a hybrid rank.
- DiskANN accelerates cosine search with 4-bit spherical quantization and
  advanced filtered-search settings.
- HorizonDB's built-in `default-chat` model writes grounded shipment answers
  from the same Psycopg-backed semantic search used by the API.

The repository includes 24 realistic global shipments. Only a HorizonDB
connection is required because semantic search and assistant answers both use
models managed by the database service.

## User Interface

The React console combines a shipment list, interactive Leaflet map, map-selected
search radius, and a grounded agent panel. Search results expose semantic score,
distance, and hybrid score as inspectable evidence.

## Technical Demo

The [customer demo package](demo/README.md) contains the final narrated video and
the presentation deck. Internal research, source captures, narration, and video
production files are deliberately excluded from Git.

## Architecture

```mermaid
flowchart LR
    Browser[React + Leaflet] -->|REST| API[FastAPI]
    API --> Agent[Grounded shipment assistant]
    Agent --> Tool[spatial-semantic search tool]
    API --> Repo[Psycopg repository]
    Tool --> Repo
    Repo --> DB[(Azure HorizonDB)]
    DB --> Chat[azure_ai.generate + default-chat]
    DB --> PostGIS[PostGIS points]
    DB --> AzureAI[azure_ai embeddings]
    DB --> Vector[pgvector + SQ DiskANN]
```

The agent calls one typed search tool. That tool embeds the question inside
HorizonDB, uses PostGIS to apply the optional radius, retrieves candidates with
spherical-quantized DiskANN, and reranks them with a 72% semantic and 28% spatial
score. Only matched rows are passed to `azure_ai.generate` as grounding context.

## Repository Layout

| Path | Purpose |
| --- | --- |
| `backend/app/main.py` | FastAPI application and REST routes |
| `backend/app/agent.py` | Grounded HorizonDB chat and shipment search orchestration |
| `backend/app/tools.py` | Typed spatial-semantic tool invoked by the agent |
| `backend/app/repository.py` | Async Psycopg, PostGIS projection, and vector search |
| `backend/app/setup_database.py` | Idempotent schema, seed, model verification, embedding, and index setup |
| `database/schema.sql` | HorizonDB extensions and relational/vector schema |
| `frontend/src` | React operations console, Leaflet map, and agent chat |

## Run Locally

The sample has a Python backend and a React frontend. You will run both from
source in two terminals. No prebuilt application is required.

### 1. Install Python and Node.js

#### Windows

1. Download and install [Python for Windows](https://www.python.org/downloads/windows/).
  Choose Python 3.11 or newer and enable **Add Python to PATH** in the
  installer.
2. Download and install the LTS version of
  [Node.js](https://nodejs.org/en/download). Node.js also installs the `npm`
  command used by the frontend.
3. Close and reopen VS Code after both installations finish.

Open **Terminal > New Terminal** in VS Code. The terminal should say
PowerShell. Run these commands one line at a time:

```powershell
py --version
node --version
npm --version
```

#### macOS

1. Download and install [Python for macOS](https://www.python.org/downloads/macos/).
  Choose Python 3.11 or newer and run the downloaded installer package.
2. Download and install the LTS version of
  [Node.js](https://nodejs.org/en/download). Choose the macOS installer.
  Node.js also installs `npm`.
3. Close and reopen VS Code after both installations finish.

Open **Terminal > New Terminal** in VS Code. Run these commands one line at a
time:

```bash
python3 --version
node --version
npm --version
```

For either operating system, Python must be 3.11 or newer and Node.js must be
20.19 or newer. If a command is not found, restart VS Code. If it is still
unavailable, reinstall that tool and make sure its PATH option is enabled.

### 2. Gather the Azure settings

The application requires live Azure services. Have these values ready before
continuing:

- An Azure HorizonDB host, database name, user, and password.
- Access to the built-in `default-chat` and `default-embedding` HorizonDB model
  aliases.

Ask your Azure administrator for any values you do not have. Do not put keys
or passwords in files that will be committed to source control.

### 3. Open the project folder

Download or clone this repository. In VS Code, select **File > Open Folder**
and choose the `horizondb-fleet-intelligence` folder. Then select **Terminal > New Terminal**.
The terminal prompt should end with `horizondb-fleet-intelligence`; the commands below assume
you are in that folder.

### 4. Set up the Python backend

Run the block for your operating system. These commands create a private
Python environment in `backend/.venv`, install the backend packages, and copy
the settings template. You only need to do this once.

#### Windows PowerShell

```powershell
Set-Location backend
py -m venv .venv
.\.venv\Scripts\python -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

#### macOS Terminal

```bash
cd backend
python3 -m venv .venv
./.venv/bin/python -m pip install -e ".[dev]"
cp .env.example .env
```

You do not need to activate the virtual environment. The remaining commands
call the project's private Python installation directly.

### 5. Add the Azure settings

In the VS Code Explorer, open `backend/.env`. Replace the placeholder text on
the right side of each `=` with your Azure values:

```dotenv
AZURE_PG_HOST=your-horizondb-host
AZURE_PG_NAME=your-database-name
AZURE_PG_USER=your-database-user
AZURE_PG_PASSWORD=your-database-password
AZURE_PG_PORT=5432
AZURE_PG_SSLMODE=require

EMBEDDING_MODEL_ALIAS=default-embedding
CHAT_MODEL_ALIAS=default-chat
```

Keep the connection-pool values already in the file. The `backend/.env` file
is ignored by Git. As an alternative to the individual `AZURE_PG_*` values,
advanced users can set `DATABASE_URL` to a complete PostgreSQL connection
string.

### 6. Prepare the database

Stay in the `backend` folder and run the command for your operating system.

#### Windows PowerShell

```powershell
.\.venv\Scripts\python -m app.setup_database
```

#### macOS Terminal

```bash
./.venv/bin/python -m app.setup_database
```

The first run can take a few minutes. It enables the database extensions,
creates the schema, loads 24 sample shipments, generates embeddings, and
builds the DiskANN index. Wait for this confirmation:

```text
Fleet Intelligence ready: 24 shipments, 24 HorizonDB model embeddings, primary DiskANN index: ready
```

You can run the setup command again safely. It updates the database without
duplicating the sample shipments.

### 7. Start the backend

In the same terminal, run the command for your operating system.

#### Windows PowerShell

```powershell
.\.venv\Scripts\python -m app.server
```

#### macOS Terminal

```bash
./.venv/bin/python -m app.server
```

Wait until the terminal says Uvicorn is running on
`http://127.0.0.1:8000`. Leave this terminal open. You can verify the backend
by opening `http://127.0.0.1:8000/docs` in a browser.

### 8. Start the frontend

In VS Code, select **Terminal > New Terminal** to open a second terminal. It
should start in the `horizon-ship` folder. Run the block for your operating
system.

#### Windows PowerShell

```powershell
Set-Location frontend
npm install
npm run dev
```

#### macOS Terminal

```bash
cd frontend
npm install
npm run dev
```

The `npm install` command downloads the frontend packages. You only need to
run it the first time, or after the packages in `package.json` change. Leave
this second terminal open.

### 9. Open and stop the application

Open `http://127.0.0.1:5173` in a browser. Vite sends `/api` requests to the
backend on port 8000, so both terminals must remain running while you use the
application. Set `VITE_API_URL` only when the API runs at a different address.

To stop the application, click inside each terminal and press **Ctrl+C**. On
Windows, type `Y` and press **Enter** if PowerShell asks you to confirm.

### 10. Run the application again later

You do not need to recreate the Python environment, reinstall packages, or
prepare the database each time. Open two terminals in the `horizon-ship`
folder and run the commands for your operating system.

#### Windows PowerShell

Terminal 1:

```powershell
Set-Location backend
.\.venv\Scripts\python -m app.server
```

Terminal 2:

```powershell
Set-Location frontend
npm run dev
```

#### macOS Terminal

Terminal 1:

```bash
cd backend
./.venv/bin/python -m app.server
```

Terminal 2:

```bash
cd frontend
npm run dev
```

### Common first-run fixes

- If the frontend cannot connect, make sure the backend terminal is still
  running and `http://127.0.0.1:8000/docs` opens successfully.
- If the backend reports missing configuration or authentication failures,
  check the values in `backend/.env` and rerun the database setup command.
- If PowerShell says scripts are disabled when you run `npm`, use `npm.cmd`
  in place of `npm`, such as `npm.cmd run dev`.
- If port 8000 or 5173 is already in use, stop the older backend or frontend
  process with **Ctrl+C**, then run the command again.

## Runtime Requirements

The application has one runtime configuration: HorizonDB provides PostGIS, DiskANN
search over built-in embeddings, and grounded answers through
`azure_ai.generate`. FastAPI fails at startup when the database connection is
missing, either model alias is unavailable, any shipment lacks an embedding,
or the primary DiskANN index is unavailable.

## Spatial-Semantic Search

The search tool creates the query vector inside HorizonDB, applies an optional
PostGIS radius, and keeps vector distance in the candidate `ORDER BY ... LIMIT`
so DiskANN serves candidate retrieval:

```sql
WITH query_vector AS (
    SELECT azure_openai.create_embeddings(
        'default-embedding',
        'delayed electronics from Asia'
    )::pg_catalog.vector(1536) AS embedding
)
SELECT
    shipment.shipment_number,
    shipment.title,
  ST_Distance(shipment.current_position::geography, :center) / 1000 AS distance_km,
  1 - (shipment.embedding <=> query_vector.embedding) AS cosine_similarity
FROM horizon_ship.shipments AS shipment
CROSS JOIN query_vector
WHERE ST_DWithin(shipment.current_position::geography, :center, :radius_meters)
ORDER BY shipment.embedding <=> query_vector.embedding
LIMIT 100;
```

The primary index uses HorizonDB's spherical quantization preview:

```sql
CREATE INDEX shipments_embedding_diskann_idx
    ON horizon_ship.shipments
    USING diskann (embedding vector_cosine_ops)
    WITH (
        spherical_quantized = true,
        sq_bits = 4,
        sq_training_samples = 25000
    );
```

Filtered requests enable DiskANN strict iterative search and the filter hook in
a transaction-local scope before executing the query.

## API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Database, extension, embedding, and AI model readiness |
| `GET` | `/api/shipments` | List shipments with optional status/text filters |
| `GET` | `/api/shipments/stats` | Fleet counts by status |
| `GET` | `/api/shipments/{number}` | Shipment details and PostGIS coordinates |
| `GET` | `/api/explain/last` | Last literalized SQL statement and text execution plan |
| `POST` | `/api/search` | Direct spatial-semantic search with optional location/radius |
| `POST` | `/api/chat` | Agent answer plus grounded, scored shipment rows |

## Execution Plans

Every runtime `SELECT` is preceded by:

```sql
EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT TEXT)
```

The backend separately retains the list-all plan and the spatial-semantic plan
that produced the current search results, together with SQL rendered using
PostgreSQL literals. The compact execution-plan icon beside the count is always
available and selects the plan matching the displayed rows. It is the only
control that opens the plan window.

The plan pane has Text and Graph tabs. The graph preserves parent-child plan
structure so bitmap combinations, index scans, and their conditions can be read
as one flow. It also exposes HorizonDB `DiskANNFilteredScan`, strategy, and
collected TID diagnostics. The assistant status selector uses the same status
colors as shipment markers, and its rerun control executes the last prompt with
the current status, ETA window, and spatial scope. The query and plan panes can
be resized with the divider or its arrow-key controls.

Result badges show cosine similarity as `cos 0.63`, not as a percentage or
probability. Shipment embeddings are generated from title, description, origin,
destination, current location, status, and metadata. The ETA calendar applies a
center date plus or minus the selected number of days using the
`shipments_eta_idx` B-tree index when selected by the planner, and can be cleared
independently. In the SQL pane, prompt, status, ETA, point coordinates, and
radius literals use distinct highlights so user inputs can be followed through
the query.

Reading `/api/explain/last` does not run a database query and therefore does not
replace the captured plan.

`EXPLAIN ANALYZE` executes its statement. The application then executes the
same statement to obtain rows, so this demonstration mode intentionally runs
each `SELECT` twice, including model-backed statements.

## Optional Validation

To run the automated checks, first open a terminal in the `backend` folder.

Windows PowerShell:

```powershell
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\python -m ruff check app tests
```

macOS Terminal:

```bash
./.venv/bin/python -m pytest -q
./.venv/bin/python -m ruff check app tests
```

Then open a terminal in the `frontend` folder. These commands are the same on
Windows and macOS:

```bash
npm run build
npm run lint
```

The application does not require a frontend environment file for the default
local development ports.