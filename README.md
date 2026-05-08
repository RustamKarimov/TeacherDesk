# TeacherDesk

TeacherDesk is a local-first teaching workload tool. The first module set focuses on Cambridge AS/A Level Physics past papers: importing a manifest, splitting question papers and mark schemes, browsing a question bank, and generating custom exams.

## Project Shape

- `backend/` - Django API and processing modules.
- `frontend/` - React + Vite + TypeScript interface.
- `local_library/` - default local file workspace for source papers, split questions, generated exams, and manifests.
- `docs/` - architecture notes and implementation decisions.

## First Milestone

The first build establishes:

- Library-based local storage.
- Manifest import and validation contracts.
- Cambridge filename parsing as the first configurable preset.
- Question Bank folder layout by subject, paper, and question number.
- Review states for split PDFs that need manual cleanup.
- A reusable UI shell based on the selected sidebar/table/preview design.

## Default Question Bank Layout

```text
local_library/
  QuestionBank/
    9702/
      _index/
      _registry/
      Paper2/
        Q1/
          Questions/
          MarkSchemes/
      Paper4/
        Q5/
          Questions/
          MarkSchemes/
```

## Development

## Daily Start

For normal local use on Windows, double-click:

```text
Start TeacherDesk.bat
```

The launcher checks backend/frontend dependencies, applies database migrations, starts Django on `http://127.0.0.1:8000/`, starts React on `http://127.0.0.1:5173/`, waits briefly for both servers, and opens the app in your browser.

Keep the two server windows open while using TeacherDesk. When finished, close those windows or double-click:

```text
Stop TeacherDesk.bat
```

The stop file closes local processes listening on ports `8000` and `5173`.

## Manual Development

Install backend dependencies and start the API server:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

The backend runs at `http://127.0.0.1:8000/`. Opening that address redirects to the React app when the frontend server is running. The API health endpoint is:

```text
http://127.0.0.1:8000/api/health/
```

Install frontend dependencies and start the React interface:

```powershell
cd frontend
npm install
npm run dev
```

The frontend runs at `http://127.0.0.1:5173/`.

The frontend uses `http://127.0.0.1:8000` as the default API server. To point it somewhere else, create `frontend/.env.local`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
```

The initial settings use SQLite for easy local testing. PostgreSQL-ready settings can be enabled through environment variables:

```env
DB_ENGINE=django.db.backends.postgresql
POSTGRES_DB=teacherdesk
POSTGRES_USER=teacherdesk
POSTGRES_PASSWORD=teacherdesk
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
```

## Verification

Useful checks before sharing a build:

```powershell
cd backend
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py test apps.libraries apps.exams apps.splitter

cd ..\frontend
npm run build
```
