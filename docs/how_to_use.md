# TeacherDesk Quick Guide

TeacherDesk is a local-first teaching tool. The database and generated records are managed by the app, while your source papers, split PDFs, generated exams, and local library stay on your computer.

## Daily Start

1. Open:
   `D:\Programming\School Projects\CambridgeProjects\TeacherDesk`
2. Double-click:
   `Start TeacherDesk.bat`
3. Wait until the browser opens:
   `http://127.0.0.1:5173/`
4. Keep the backend and frontend server windows open while using TeacherDesk.

## Daily Stop

Double-click:
`Stop TeacherDesk.bat`

If the browser page is still visible after stopping, that is normal. Refreshing the page should fail until TeacherDesk is started again.

## Dashboard

Use the dashboard as the project home page. It shows:

- question bank totals
- review flags
- saved and generated exams
- local folder status
- quick access to each module

## Splitter

Use Splitter when adding or updating past papers.

1. Select the manifest Excel file.
2. Select the source papers folder.
3. Select the output question bank folder.
4. Choose split behavior:
   - Skip existing: keep existing PDFs.
   - Overwrite: recreate existing PDFs.
   - Regenerate changed: update PDFs whose page ranges changed.
   - Keep both: store a new version without replacing the old file.
5. Click `Check & preview`.
6. Read validation notes carefully.
7. Click `Start splitting`.

If you corrected page numbers in the manifest and want the corrected PDFs to be produced, use `Overwrite` or `Regenerate changed`.

## Question Bank

Use Question Bank to browse, preview, and edit split questions.

You can:

- filter by paper, question number, topic, exam code, and review status
- preview question PDFs and mark schemes
- edit marks, topics, review status, and review notes
- mark question PDFs or mark schemes as reviewed
- delete question PDFs, with an option to delete related mark scheme PDFs too
- add selected questions to the Exam Generator

Questions split from starred page boundaries are marked for review because the first or last page may contain content from an adjacent question.

## Exam Generator

Use Exam Generator to create draft exams and export PDFs.

Modes:

- Full paper: selects one question for each available question number and tries to stay near the target mark.
- Question numbers: generates from specific question numbers such as `2, 4-6`.
- By topic: selects questions matching required topics, with optional allowed-topic limits.
- Manual / From Question Bank: uses questions you selected manually.

After previewing:

1. Review the selected question list.
2. Save the draft if needed.
3. Generate PDFs.
4. Open the question paper, mark scheme, or output folder directly from the PDF output panel.

Generated exams are stored in a separate folder named after the exam title inside the selected output folder.

## Settings

Settings stores the default values used by the other modules.

Each module can still override settings for a specific run, but new runs should start from the defaults saved here.

Typical settings include:

- default manifest path
- default source papers folder
- default question bank folder
- generated exams folder
- splitter behavior defaults
- exam generator defaults
- header/footer mask defaults

## If Something Does Not Open

1. Run `Stop TeacherDesk.bat`.
2. Run `Start TeacherDesk.bat`.
3. Open `http://127.0.0.1:5173/`.
4. If the backend page opens at `http://127.0.0.1:8000/`, it should redirect to the frontend.
5. If a PDF or folder button does nothing, check that the file path still exists on your computer.

## Developer Checks

From `D:\Programming\School Projects\CambridgeProjects\TeacherDesk\backend`:

```powershell
.\.venv\Scripts\python.exe manage.py check
.\.venv\Scripts\python.exe manage.py makemigrations --check --dry-run
.\.venv\Scripts\python.exe manage.py test apps.libraries apps.exams apps.splitter
```

From `D:\Programming\School Projects\CambridgeProjects\TeacherDesk\frontend`:

```powershell
npm run build
```
