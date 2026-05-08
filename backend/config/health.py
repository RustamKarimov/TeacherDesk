from pathlib import Path

from django.db import connection
from django.http import JsonResponse

from apps.libraries.urls import get_settings


def health(request):
    settings = get_settings()
    paths = {
        "manifest": settings.default_manifest_path,
        "source_papers": settings.default_source_root,
        "question_bank": settings.default_output_root,
        "generated_exams": settings.default_generated_exams_root,
    }

    database_ok = True
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except Exception:  # noqa: BLE001 - health endpoint should report the failure, not crash.
        database_ok = False

    return JsonResponse(
        {
            "ok": database_ok,
            "database": "ok" if database_ok else "error",
            "library": {
                "name": settings.library.name,
                "root_path": settings.library.root_path,
            },
            "paths": [
                {"key": key, "path": path, "exists": bool(path and Path(path).exists())}
                for key, path in paths.items()
            ],
        }
    )
