import threading
import uuid
import os
from pathlib import Path
from tkinter import Tk
from tkinter import filedialog

from django.db import close_old_connections
from django.http import JsonResponse
from django.urls import path

from .services import import_and_split_manifest
from .services import build_split_plan
from .services import validate_manifest


SAMPLE_MANIFEST_PATH = r"D:\Programming\School Projects\CambridgeProjects\ExamGenerator\data\past_paper_info.xlsx"
SAMPLE_SOURCE_ROOT = r"D:\Programming\School Projects\CambridgeProjects\ExamGenerator\source_papers\9702"
SAMPLE_OUTPUT_ROOT = r"D:\Programming\School Projects\CambridgeProjects\TeacherDesk\local_library"
JOBS: dict[str, dict[str, object]] = {}


def index(request):
    return JsonResponse({"module": "splitter", "status": "ready"})


def validate_sample(request):
    manifest_path = request.GET.get("manifest_path", SAMPLE_MANIFEST_PATH)
    source_root = request.GET.get("source_root", SAMPLE_SOURCE_ROOT)
    return JsonResponse(validate_manifest(manifest_path, source_root))


def split_sample(request):
    manifest_path = request.GET.get("manifest_path", SAMPLE_MANIFEST_PATH)
    source_root = request.GET.get("source_root", SAMPLE_SOURCE_ROOT)
    output_root = request.GET.get("output_root", SAMPLE_OUTPUT_ROOT)
    overwrite = request.GET.get("overwrite", "false").lower() == "true"
    existing_pdf_strategy = request.GET.get("existing_pdf_strategy", "skip")
    changed_page_strategy = request.GET.get("changed_page_strategy", "flag")
    metadata_strategy = request.GET.get("metadata_strategy", "update")
    dry_run = request.GET.get("dry_run", "false").lower() == "true"
    return JsonResponse(
        import_and_split_manifest(
            manifest_path,
            source_root,
            output_root=output_root,
            overwrite=overwrite,
            existing_pdf_strategy=existing_pdf_strategy,
            changed_page_strategy=changed_page_strategy,
            metadata_strategy=metadata_strategy,
            dry_run=dry_run,
        )
    )


def plan_split(request):
    manifest_path = request.GET.get("manifest_path", SAMPLE_MANIFEST_PATH)
    source_root = request.GET.get("source_root", SAMPLE_SOURCE_ROOT)
    output_root = request.GET.get("output_root", SAMPLE_OUTPUT_ROOT)
    existing_pdf_strategy = request.GET.get("existing_pdf_strategy", "skip")
    changed_page_strategy = request.GET.get("changed_page_strategy", "flag")
    metadata_strategy = request.GET.get("metadata_strategy", "update")
    return JsonResponse(
        build_split_plan(
            manifest_path,
            source_root,
            output_root=output_root,
            existing_pdf_strategy=existing_pdf_strategy,
            changed_page_strategy=changed_page_strategy,
            metadata_strategy=metadata_strategy,
        )
    )


def start_split_job(request):
    manifest_path = request.GET.get("manifest_path", SAMPLE_MANIFEST_PATH)
    source_root = request.GET.get("source_root", SAMPLE_SOURCE_ROOT)
    output_root = request.GET.get("output_root", SAMPLE_OUTPUT_ROOT)
    overwrite = request.GET.get("overwrite", "false").lower() == "true"
    existing_pdf_strategy = request.GET.get("existing_pdf_strategy", "skip")
    changed_page_strategy = request.GET.get("changed_page_strategy", "flag")
    metadata_strategy = request.GET.get("metadata_strategy", "update")
    job_id = str(uuid.uuid4())
    JOBS[job_id] = {
        "id": job_id,
        "status": "queued",
        "progress": {
            "processed_files": 0,
            "total_files": 0,
            "split_question_pdfs": 0,
            "split_markscheme_pdfs": 0,
            "skipped_existing_files": 0,
            "current": {},
        },
        "result": None,
        "error": None,
    }

    def update_progress(progress):
        JOBS[job_id]["progress"] = progress

    def run_job():
        close_old_connections()
        JOBS[job_id]["status"] = "running"
        try:
            result = import_and_split_manifest(
                manifest_path,
                source_root,
                output_root=output_root,
                overwrite=overwrite,
                existing_pdf_strategy=existing_pdf_strategy,
                changed_page_strategy=changed_page_strategy,
                metadata_strategy=metadata_strategy,
                progress_callback=update_progress,
            )
            JOBS[job_id]["result"] = result
            JOBS[job_id]["status"] = "completed" if result.get("ok") else "failed"
        except Exception as exc:  # noqa: BLE001
            JOBS[job_id]["error"] = str(exc)
            JOBS[job_id]["status"] = "failed"
        finally:
            close_old_connections()

    threading.Thread(target=run_job, daemon=True).start()
    return JsonResponse(JOBS[job_id])


def split_job_status(request, job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return JsonResponse({"error": f"Unknown split job: {job_id}"}, status=404)
    return JsonResponse(job)


def _dialog_root():
    root = Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    return root


def browse_manifest(request):
    initial_dir = request.GET.get("initial_dir") or str(Path(SAMPLE_MANIFEST_PATH).parent)
    root = _dialog_root()
    try:
        selected = filedialog.askopenfilename(
            parent=root,
            title="Select manifest Excel file",
            initialdir=initial_dir,
            filetypes=[("Excel files", "*.xlsx *.xls"), ("All files", "*.*")],
        )
    finally:
        root.destroy()
    return JsonResponse({"selected_path": selected, "cancelled": not bool(selected)})


def browse_folder(request):
    initial_dir = request.GET.get("initial_dir") or SAMPLE_OUTPUT_ROOT
    title = request.GET.get("title") or "Select folder"
    root = _dialog_root()
    try:
        selected = filedialog.askdirectory(parent=root, title=title, initialdir=initial_dir)
    finally:
        root.destroy()
    return JsonResponse({"selected_path": selected, "cancelled": not bool(selected)})


def open_output_folder(request):
    output_root = request.GET.get("output_root", SAMPLE_OUTPUT_ROOT)
    folder = Path(output_root)
    if not folder.exists():
        return JsonResponse({"ok": False, "error": f"Folder not found: {folder}"}, status=404)
    os.startfile(str(folder))
    return JsonResponse({"ok": True, "path": str(folder)})


urlpatterns = [
    path("", index),
    path("validate-sample/", validate_sample),
    path("plan-split/", plan_split),
    path("split-sample/", split_sample),
    path("split-jobs/start/", start_split_job),
    path("split-jobs/<str:job_id>/", split_job_status),
    path("browse/manifest/", browse_manifest),
    path("browse/folder/", browse_folder),
    path("open-output-folder/", open_output_folder),
]
