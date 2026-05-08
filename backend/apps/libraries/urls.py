import json
from pathlib import Path

from django.conf import settings as django_settings
from django.http import JsonResponse
from django.urls import path
from django.views.decorators.csrf import csrf_exempt

from apps.catalog.models import Question, Topic
from apps.exams.models import GeneratedExam

from .models import AppSettings, Library


DEFAULT_PAPER_MARKS = {"1": 40, "2": 60, "3": 40, "4": 100, "5": 30}
DEFAULT_MASK_SETTINGS = {
    "qp_header_enabled": False,
    "qp_footer_enabled": False,
    "ms_header_enabled": False,
    "ms_footer_enabled": False,
    "qp_header_mm": 18,
    "qp_footer_mm": 16,
    "ms_header_mm": 10,
    "ms_footer_mm": 22,
}
DEFAULT_APP_PREFERENCES = {
    "splitter": {
        "existing_pdf_strategy": "skip",
        "changed_page_strategy": "flag",
        "metadata_strategy": "update",
    },
    "question_bank": {
        "page_size": 10,
        "topic_match_mode": "any",
    },
    "exam_generator": {
        "default_paper": "2",
        "default_mode": "full_paper",
        "allowed_over_target": 4,
        "include_markscheme": True,
    },
}


def merged_preferences(raw_preferences: dict | None) -> dict[str, object]:
    raw_preferences = raw_preferences or {}
    return {
        section: {**defaults, **raw_preferences.get(section, {})}
        for section, defaults in DEFAULT_APP_PREFERENCES.items()
    }


def active_library() -> Library:
    library = Library.objects.filter(is_active=True).first() or Library.objects.first()
    if library:
        return library
    root_path = str(django_settings.TEACHERDESK_LIBRARY_ROOT)
    return Library.objects.create(
        name="Cambridge Physics Library",
        root_path=root_path,
        generated_exams_path=str(Path(root_path) / "generated_exams"),
        is_active=True,
    )


def get_settings() -> AppSettings:
    library = active_library()
    generated_path = library.generated_exams_path
    if generated_path and not Path(generated_path).is_absolute():
        generated_path = str(Path(library.root_path) / generated_path)
    settings, _ = AppSettings.objects.get_or_create(
        library=library,
        defaults={
            "default_output_root": library.root_path,
            "default_generated_exams_root": generated_path,
            "paper_marks": DEFAULT_PAPER_MARKS,
            "pdf_mask_settings": DEFAULT_MASK_SETTINGS,
            "app_preferences": DEFAULT_APP_PREFERENCES,
        },
    )
    changed_fields = []
    if settings.default_generated_exams_root and not Path(settings.default_generated_exams_root).is_absolute():
        settings.default_generated_exams_root = str(Path(library.root_path) / settings.default_generated_exams_root)
        changed_fields.append("default_generated_exams_root")
    if not settings.paper_marks:
        settings.paper_marks = DEFAULT_PAPER_MARKS
        changed_fields.append("paper_marks")
    if not settings.pdf_mask_settings:
        settings.pdf_mask_settings = DEFAULT_MASK_SETTINGS
        changed_fields.append("pdf_mask_settings")
    if not settings.app_preferences:
        settings.app_preferences = DEFAULT_APP_PREFERENCES
        changed_fields.append("app_preferences")
    if changed_fields:
        settings.save(update_fields=[*changed_fields, "updated_at"])
    return settings


def settings_payload(settings: AppSettings) -> dict[str, object]:
    return {
        "library": {
            "id": settings.library.id,
            "name": settings.library.name,
            "root_path": settings.library.root_path,
        },
        "default_manifest_path": settings.default_manifest_path,
        "default_source_root": settings.default_source_root,
        "default_output_root": settings.default_output_root,
        "default_generated_exams_root": settings.default_generated_exams_root,
        "paper_marks": {**DEFAULT_PAPER_MARKS, **(settings.paper_marks or {})},
        "pdf_mask_settings": {**DEFAULT_MASK_SETTINGS, **(settings.pdf_mask_settings or {})},
        "app_preferences": merged_preferences(settings.app_preferences),
    }


def index(request):
    return JsonResponse({"module": "libraries", "status": "ready"})


def app_settings(request):
    return JsonResponse(settings_payload(get_settings()))


def dashboard(request):
    settings = get_settings()
    library = settings.library
    questions = Question.objects.filter(library=library)
    drafts = GeneratedExam.objects.filter(library=library)
    review_queue = questions.filter(qp_review_status=Question.ReviewStatus.NEEDS_REVIEW) | questions.filter(ms_review_status=Question.ReviewStatus.NEEDS_REVIEW)
    qp_review_count = questions.filter(qp_review_status=Question.ReviewStatus.NEEDS_REVIEW).count()
    ms_review_count = questions.filter(ms_review_status=Question.ReviewStatus.NEEDS_REVIEW).count()
    paper_coverage = [
        {
            "paper": paper,
            "questions": questions.filter(paper_number=paper).count(),
            "review_flags": questions.filter(paper_number=paper, qp_review_status=Question.ReviewStatus.NEEDS_REVIEW).count()
            + questions.filter(paper_number=paper, ms_review_status=Question.ReviewStatus.NEEDS_REVIEW).count(),
        }
        for paper in sorted(set(questions.values_list("paper_number", flat=True)))
    ]
    paths = {
        "manifest": settings.default_manifest_path,
        "source": settings.default_source_root,
        "question_bank": settings.default_output_root,
        "generated_exams": settings.default_generated_exams_root,
    }
    return JsonResponse(
        {
            "library": {
                "name": library.name,
                "root_path": library.root_path,
            },
            "modules": {
                "splitter": {
                    "title": "Splitter",
                    "summary": "Create question and mark scheme PDFs from manifest rows.",
                    "primary": questions.count(),
                    "primary_label": "questions indexed",
                    "secondary": len(set(questions.values_list("exam_code", flat=True))),
                    "secondary_label": "exam files",
                },
                "question_bank": {
                    "title": "Question Bank",
                    "summary": "Browse, preview, filter, and review split questions.",
                    "primary": questions.count(),
                    "primary_label": "questions",
                    "secondary": questions.filter(qp_review_status=Question.ReviewStatus.NEEDS_REVIEW).count()
                    + questions.filter(ms_review_status=Question.ReviewStatus.NEEDS_REVIEW).count(),
                    "secondary_label": "review flags",
                },
                "exam_generator": {
                    "title": "Exam Generator",
                    "summary": "Build drafts and generate combined QP/MS PDFs.",
                    "primary": drafts.count(),
                    "primary_label": "saved drafts",
                    "secondary": drafts.exclude(exam_pdf_path="").count(),
                    "secondary_label": "generated exams",
                },
                "settings": {
                    "title": "Settings",
                    "summary": "Manage local folders, paper marks, and PDF masks.",
                    "primary": Topic.objects.filter(question__library=library).distinct().count(),
                    "primary_label": "topics",
                    "secondary": len(settings.paper_marks or {}),
                    "secondary_label": "paper totals",
                },
            },
            "paths": paths,
            "review_counts": {
                "all": qp_review_count + ms_review_count,
                "qp": qp_review_count,
                "ms": ms_review_count,
            },
            "folder_health": [
                {"label": "Manifest", "path": paths["manifest"], "ready": bool(paths["manifest"] and Path(paths["manifest"]).exists())},
                {"label": "Source papers", "path": paths["source"], "ready": bool(paths["source"] and Path(paths["source"]).exists())},
                {"label": "Question bank", "path": paths["question_bank"], "ready": bool(paths["question_bank"] and Path(paths["question_bank"]).exists())},
                {"label": "Generated exams", "path": paths["generated_exams"], "ready": bool(paths["generated_exams"] and Path(paths["generated_exams"]).exists())},
            ],
            "review_queue": [
                {
                    "id": question.id,
                    "exam": question.exam_code,
                    "paper": f"Paper{question.paper_number}",
                    "question": f"Q{question.question_number}",
                    "marks": question.marks,
                    "qp_status": question.qp_review_status,
                    "ms_status": question.ms_review_status,
                }
                for question in review_queue.distinct().order_by("paper_number", "question_number", "exam_code")[:200]
            ],
            "recent_drafts": [
                {
                    "id": draft.id,
                    "title": draft.title,
                    "mode": draft.mode,
                    "marks": draft.total_marks,
                    "questions": draft.questions.count(),
                    "generated": bool(draft.exam_pdf_path),
                    "paper": draft.questions.order_by("paper_number").values_list("paper_number", flat=True).first(),
                    "created_at": draft.created_at.isoformat(),
                }
                for draft in drafts.order_by("-created_at")[:5]
            ],
            "paper_coverage": paper_coverage,
        }
    )


@csrf_exempt
def save_app_settings(request):
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    settings = get_settings()
    library = settings.library
    library_payload = payload.get("library") or {}
    library_changed_fields = []
    if "name" in library_payload:
        library.name = library_payload.get("name") or library.name
        library_changed_fields.append("name")
    if "root_path" in library_payload:
        library.root_path = library_payload.get("root_path") or library.root_path
        library_changed_fields.append("root_path")
    if library_changed_fields:
        library.save(update_fields=[*library_changed_fields, "updated_at"])
    for field in ("default_manifest_path", "default_source_root", "default_output_root", "default_generated_exams_root"):
        if field in payload:
            setattr(settings, field, payload.get(field) or "")
    if "paper_marks" in payload:
        try:
            settings.paper_marks = {str(key): int(value or 0) for key, value in payload.get("paper_marks", {}).items()}
        except (TypeError, ValueError):
            return JsonResponse({"error": "Paper marks must be whole numbers."}, status=400)
    if "pdf_mask_settings" in payload:
        mask_settings = {**DEFAULT_MASK_SETTINGS, **payload.get("pdf_mask_settings", {})}
        for key in ("qp_header_enabled", "qp_footer_enabled", "ms_header_enabled", "ms_footer_enabled"):
            mask_settings[key] = bool(mask_settings.get(key))
        try:
            for key in ("qp_header_mm", "qp_footer_mm", "ms_header_mm", "ms_footer_mm"):
                mask_settings[key] = int(mask_settings.get(key) or 0)
        except (TypeError, ValueError):
            return JsonResponse({"error": "PDF mask margins must be whole numbers in millimetres."}, status=400)
        settings.pdf_mask_settings = mask_settings
    if "app_preferences" in payload:
        preferences = merged_preferences(payload.get("app_preferences", {}))
        splitter = preferences["splitter"]
        question_bank = preferences["question_bank"]
        exam_generator = preferences["exam_generator"]
        splitter["existing_pdf_strategy"] = splitter["existing_pdf_strategy"] if splitter["existing_pdf_strategy"] in {"skip", "overwrite"} else "skip"
        splitter["changed_page_strategy"] = splitter["changed_page_strategy"] if splitter["changed_page_strategy"] in {"flag", "overwrite", "keep_both"} else "flag"
        splitter["metadata_strategy"] = splitter["metadata_strategy"] if splitter["metadata_strategy"] in {"update", "keep"} else "update"
        question_bank["page_size"] = int(question_bank.get("page_size") or 10)
        if question_bank["page_size"] not in {10, 20, 50, 100}:
            question_bank["page_size"] = 10
        question_bank["topic_match_mode"] = question_bank["topic_match_mode"] if question_bank["topic_match_mode"] in {"any", "all"} else "any"
        exam_generator["default_paper"] = str(exam_generator.get("default_paper") or "2")
        exam_generator["default_mode"] = exam_generator["default_mode"] if exam_generator["default_mode"] in {"full_paper", "question_numbers", "topics", "manual"} else "full_paper"
        exam_generator["allowed_over_target"] = int(exam_generator.get("allowed_over_target") or 0)
        exam_generator["include_markscheme"] = bool(exam_generator.get("include_markscheme"))
        settings.app_preferences = preferences
    settings.save()
    return JsonResponse({"ok": True, "settings": settings_payload(settings)})


urlpatterns = [
    path("", index),
    path("dashboard/", dashboard),
    path("settings/", app_settings),
    path("settings/save/", save_app_settings),
]
