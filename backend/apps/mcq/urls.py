import json
import mimetypes
import os
import random
import re
from html import escape
from pathlib import Path
from uuid import uuid4

from django.db.models import Count, Q
from django.http import FileResponse, JsonResponse
from django.urls import path
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Image as RLImage
from reportlab.platypus import KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.pdfgen.canvas import Canvas

from apps.libraries.urls import active_library, get_settings

from .models import (
    MCQExam,
    MCQExamQuestion,
    MCQImageAsset,
    MCQOption,
    MCQOptionBlock,
    MCQQuestion,
    MCQQuestionBlock,
    MCQSubtopic,
    MCQTag,
    MCQTopic,
)


ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
def _normalize_source_question_number(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    if text.lower().startswith("q"):
        text = text[1:].lstrip(" -")
    return f"Q{text}" if text else ""


def _duplicate_question_response(existing: MCQQuestion) -> JsonResponse:
    return JsonResponse(
        {
            "error": (
                f"A question already exists for exam code '{existing.exam_code}' and "
                f"original question '{existing.source_question_number}'."
            ),
            "code": "duplicate_question",
            "existing": {
                "id": existing.id,
                "title": existing.title,
                "exam_code": existing.exam_code,
                "source_question_number": existing.source_question_number,
            },
        },
        status=409,
    )


def _find_duplicate_question(library, exam_code: str, source_question_number: str, exclude_id: int | None = None) -> MCQQuestion | None:
    if not exam_code or not source_question_number:
        return None
    queryset = MCQQuestion.objects.filter(
        library=library,
        exam_code__iexact=exam_code,
        source_question_number__iexact=source_question_number,
    )
    if exclude_id:
        queryset = queryset.exclude(id=exclude_id)
    return queryset.first()


def _asset_disk_path(asset: MCQImageAsset) -> Path:
    if asset.relative_path:
        return Path(asset.library.root_path) / asset.relative_path
    return Path(asset.file_path)


def _asset_payload(asset: MCQImageAsset) -> dict[str, object]:
    return {
        "id": asset.id,
        "uuid": str(asset.uuid),
        "asset_type": asset.asset_type,
        "asset_type_label": asset.get_asset_type_display(),
        "original_name": asset.original_name,
        "relative_path": asset.relative_path,
        "file_path": asset.file_path,
        "file_size": asset.file_size,
        "width": asset.width,
        "height": asset.height,
        "created_at": asset.created_at.isoformat(),
        "preview_url": f"/api/mcq/assets/{asset.id}/file/",
    }


def _topic_payload(topic: MCQTopic) -> dict[str, object]:
    return {
        "id": topic.id,
        "uuid": str(topic.uuid),
        "name": topic.name,
        "description": topic.description,
        "color": topic.color,
        "is_active": topic.is_active,
        "subtopics": [{"id": subtopic.id, "uuid": str(subtopic.uuid), "name": subtopic.name} for subtopic in topic.subtopics.all()],
        "question_count": getattr(topic, "question_count", topic.questions.count()),
    }


def _option_payload(option: MCQOption) -> dict[str, object]:
    blocks = []
    for block in option.blocks.all():
        blocks.append(
            {
                "id": block.id,
                "uuid": str(block.uuid),
                "block_type": block.block_type,
                "text": block.text,
                "asset_id": block.asset_id,
                "asset": _asset_payload(block.asset) if block.asset else None,
                "order": block.order,
                "settings": block.settings,
            }
        )
    return {
        "id": option.id,
        "uuid": str(option.uuid),
        "label": option.label,
        "is_correct": option.is_correct,
        "order": option.order,
        "content_json": option.content_json,
        "content_html": option.content_html,
        "content_text": option.content_text,
        "layout_settings": option.layout_settings,
        "blocks": blocks,
    }


def _question_payload(question: MCQQuestion, include_detail: bool = False) -> dict[str, object]:
    topics = [{"id": topic.id, "uuid": str(topic.uuid), "name": topic.name} for topic in question.topics.all()]
    subtopics = [{"id": subtopic.id, "uuid": str(subtopic.uuid), "name": subtopic.name, "topic_id": subtopic.topic_id} for subtopic in question.subtopics.all()]
    tags = [{"id": tag.id, "uuid": str(tag.uuid), "name": tag.name} for tag in question.tags.all()]
    options = list(question.options.all())
    has_images = question.blocks.filter(asset__isnull=False).exists() or MCQOptionBlock.objects.filter(option__question=question, asset__isnull=False).exists()
    has_tables = question.blocks.filter(block_type=MCQQuestionBlock.BlockType.TABLE).exists() or question.option_layout == MCQQuestion.OptionLayout.TABLE
    has_equations = question.blocks.filter(text__contains="$").exists() or MCQOptionBlock.objects.filter(option__question=question, text__contains="$").exists()
    correct_option = next((option.label for option in options if option.is_correct), "")
    payload = {
        "id": question.id,
        "uuid": str(question.uuid),
        "title": question.title,
        "subject": question.subject,
        "syllabus": question.syllabus,
        "exam_code": question.exam_code,
        "paper_code": question.paper_code,
        "session": question.session,
        "year": question.year,
        "variant": question.variant,
        "source": question.source,
        "source_question_number": question.source_question_number,
        "marks": question.marks,
        "difficulty": question.difficulty,
        "review_status": question.review_status,
        "review_status_label": question.get_review_status_display(),
        "layout_preset": question.layout_preset,
        "layout_preset_label": question.get_layout_preset_display(),
        "option_layout": question.option_layout,
        "option_layout_label": question.get_option_layout_display(),
        "topics": topics,
        "subtopics": subtopics,
        "tags": tags,
        "option_count": len(options),
        "correct_option": correct_option,
        "has_images": has_images,
        "has_tables": has_tables,
        "has_equations": has_equations,
        "updated_at": question.updated_at.isoformat(),
    }
    if include_detail:
        payload.update(
            {
                "notes": question.notes,
                "teacher_notes": question.teacher_notes,
                "content_json": question.content_json,
                "content_html": question.content_html,
                "content_text": question.content_text,
                "layout_settings": question.layout_settings,
                "blocks": [
                    {
                        "id": block.id,
                        "uuid": str(block.uuid),
                        "block_type": block.block_type,
                        "text": block.text,
                        "asset_id": block.asset_id,
                        "asset": _asset_payload(block.asset) if block.asset else None,
                        "table_data": block.table_data,
                        "order": block.order,
                        "settings": block.settings,
                    }
                    for block in question.blocks.all()
                ],
                "options": [_option_payload(option) for option in options],
            }
        )
    return payload


def index(request):
    return JsonResponse({"module": "mcq", "status": "ready"})


def dashboard(request):
    library = active_library()
    questions = MCQQuestion.objects.filter(library=library)
    exams = MCQExam.objects.filter(library=library)
    ready_questions = questions.filter(review_status__in=[MCQQuestion.ReviewStatus.READY, MCQQuestion.ReviewStatus.VERIFIED])
    needs_review = questions.filter(review_status=MCQQuestion.ReviewStatus.NEEDS_REVIEW)
    return JsonResponse(
        {
            "summary": {
                "questions": questions.count(),
                "ready_verified": ready_questions.count(),
                "needs_review": needs_review.count(),
                "generated_papers": exams.exclude(student_pdf_path="").count(),
                "assets": MCQImageAsset.objects.filter(library=library).count(),
                "topics": MCQTopic.objects.filter(library=library).count(),
            },
            "recent_questions": [_question_payload(question) for question in questions.prefetch_related("topics", "subtopics", "tags", "options")[:8]],
            "recent_exams": [
                {
                    "id": exam.id,
                    "uuid": str(exam.uuid),
                    "title": exam.title,
                    "mode": exam.mode,
                    "mode_label": exam.get_mode_display(),
                    "question_count": exam.exam_questions.count(),
                    "total_marks": exam.total_marks,
                    "has_pdf": bool(exam.student_pdf_path),
                    "updated_at": exam.updated_at.isoformat(),
                }
                for exam in exams[:8]
            ],
            "coverage": {
                "text": questions.filter(blocks__block_type=MCQQuestionBlock.BlockType.TEXT).distinct().count(),
                "image": questions.filter(Q(blocks__asset__isnull=False) | Q(options__blocks__asset__isnull=False)).distinct().count(),
                "table": questions.filter(Q(blocks__block_type=MCQQuestionBlock.BlockType.TABLE) | Q(option_layout=MCQQuestion.OptionLayout.TABLE)).distinct().count(),
                "equation": questions.filter(Q(blocks__text__contains="$") | Q(options__blocks__text__contains="$")).distinct().count(),
            },
        }
    )


def questions(request):
    library = active_library()
    queryset = (
        MCQQuestion.objects.filter(library=library)
        .prefetch_related("topics", "subtopics", "tags", "blocks", "options", "options__blocks")
        .order_by("-updated_at")
    )
    search = request.GET.get("search", "").strip()
    topic = request.GET.get("topic", "").strip()
    tag = request.GET.get("tag", "").strip()
    topic_ids = [value for value in request.GET.getlist("topic_id") if str(value).strip()]
    tag_ids = [value for value in request.GET.getlist("tag_id") if str(value).strip()]
    difficulty = request.GET.get("difficulty", "").strip()
    review_status = request.GET.get("review_status", "").strip()
    content_type = request.GET.get("content_type", "").strip()
    exam_code = request.GET.get("exam_code", "").strip()
    session = request.GET.get("session", "").strip()
    year = request.GET.get("year", "").strip()
    try:
        page = max(int(request.GET.get("page") or 1), 1)
        page_size = min(max(int(request.GET.get("page_size") or 10), 10), 100)
    except ValueError:
        return JsonResponse({"error": "page and page_size must be whole numbers."}, status=400)

    if search:
        queryset = queryset.filter(
            Q(title__icontains=search)
            | Q(exam_code__icontains=search)
            | Q(source__icontains=search)
            | Q(topics__name__icontains=search)
            | Q(subtopics__name__icontains=search)
            | Q(tags__name__icontains=search)
            | Q(blocks__text__icontains=search)
            | Q(options__blocks__text__icontains=search)
        )
    if topic:
        queryset = queryset.filter(topics__name=topic)
    if topic_ids:
        queryset = queryset.filter(topics__id__in=topic_ids)
    if tag:
        queryset = queryset.filter(tags__name=tag)
    if tag_ids:
        queryset = queryset.filter(tags__id__in=tag_ids)
    if difficulty:
        queryset = queryset.filter(difficulty=difficulty)
    if review_status:
        queryset = queryset.filter(review_status=review_status)
    if exam_code:
        queryset = queryset.filter(exam_code=exam_code)
    if session:
        queryset = queryset.filter(session=session)
    if year:
        try:
            queryset = queryset.filter(year=int(year))
        except ValueError:
            return JsonResponse({"error": "year must be a whole number."}, status=400)
    if content_type == "image":
        queryset = queryset.filter(Q(blocks__asset__isnull=False) | Q(options__blocks__asset__isnull=False))
    elif content_type == "table":
        queryset = queryset.filter(Q(blocks__block_type=MCQQuestionBlock.BlockType.TABLE) | Q(option_layout=MCQQuestion.OptionLayout.TABLE))
    elif content_type == "equation":
        queryset = queryset.filter(Q(blocks__text__contains="$") | Q(options__blocks__text__contains="$"))

    queryset = queryset.distinct()
    count = queryset.count()
    start = (page - 1) * page_size
    end = start + page_size
    return JsonResponse(
        {
            "count": count,
            "page": page,
            "page_size": page_size,
            "page_count": max((count + page_size - 1) // page_size, 1),
            "results": [_question_payload(question) for question in queryset[start:end]],
        }
    )


def question_detail(request, question_id: int):
    try:
        question = (
            MCQQuestion.objects.prefetch_related("topics", "subtopics", "tags", "blocks", "options", "options__blocks")
            .get(id=question_id, library=active_library())
        )
    except MCQQuestion.DoesNotExist:
        return JsonResponse({"error": "MCQ question not found."}, status=404)
    return JsonResponse(_question_payload(question, include_detail=True))


def metadata(request):
    library = active_library()
    topics = MCQTopic.objects.filter(library=library).prefetch_related("subtopics").annotate(question_count=Count("questions", distinct=True))
    tags = MCQTag.objects.filter(library=library).annotate(question_count=Count("questions", distinct=True)).order_by("-question_count", "name")
    return JsonResponse(
        {
            "topics": [_topic_payload(topic) for topic in topics],
            "tags": [{"id": tag.id, "uuid": str(tag.uuid), "name": tag.name, "question_count": tag.question_count} for tag in tags],
            "difficulties": list(
                MCQQuestion.objects.filter(library=library)
                .exclude(difficulty="")
                .order_by("difficulty")
                .values_list("difficulty", flat=True)
                .distinct()
            ),
            "review_statuses": [{"value": value, "label": label} for value, label in MCQQuestion.ReviewStatus.choices],
            "layout_presets": [{"value": value, "label": label} for value, label in MCQQuestion.LayoutPreset.choices],
            "option_layouts": [{"value": value, "label": label} for value, label in MCQQuestion.OptionLayout.choices],
            "exam_codes": list(
                MCQQuestion.objects.filter(library=library)
                .exclude(exam_code="")
                .order_by("exam_code")
                .values_list("exam_code", flat=True)
                .distinct()
            ),
            "sessions": list(
                MCQQuestion.objects.filter(library=library)
                .exclude(session="")
                .order_by("session")
                .values_list("session", flat=True)
                .distinct()
            ),
            "years": list(
                MCQQuestion.objects.filter(library=library, year__isnull=False)
                .order_by("-year")
                .values_list("year", flat=True)
                .distinct()
            ),
        }
    )


def assets(request):
    library = active_library()
    queryset = MCQImageAsset.objects.filter(library=library)
    asset_type = request.GET.get("asset_type", "").strip()
    search = request.GET.get("search", "").strip()
    if asset_type:
        queryset = queryset.filter(asset_type=asset_type)
    if search:
        queryset = queryset.filter(original_name__icontains=search)
    return JsonResponse({"results": [_asset_payload(asset) for asset in queryset[:200]]})


@csrf_exempt
def upload_asset(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    uploaded = request.FILES.get("file")
    if not uploaded:
        return JsonResponse({"error": "No file was uploaded."}, status=400)
    original_name = Path(uploaded.name).name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_IMAGE_EXTENSIONS:
        return JsonResponse({"error": f"Unsupported image type: {extension or 'unknown'}."}, status=400)
    library = active_library()
    asset_type = request.POST.get("asset_type", MCQImageAsset.AssetType.QUESTION)
    if asset_type not in {choice.value for choice in MCQImageAsset.AssetType}:
        asset_type = MCQImageAsset.AssetType.OTHER
    year_folder = str(timezone.localdate().year)
    relative_folder = Path("mcq") / "assets" / "images" / year_folder
    asset_root = Path(library.root_path) / relative_folder
    asset_root.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid4().hex}{extension}"
    output_path = asset_root / safe_name
    relative_path = (relative_folder / safe_name).as_posix()
    with output_path.open("wb") as destination:
        for chunk in uploaded.chunks():
            destination.write(chunk)
    asset = MCQImageAsset.objects.create(
        library=library,
        asset_type=asset_type,
        original_name=original_name,
        relative_path=relative_path,
        file_path=str(output_path),
        file_size=output_path.stat().st_size,
    )
    return JsonResponse(_asset_payload(asset), status=201)


def asset_file(request, asset_id: int):
    try:
        asset = MCQImageAsset.objects.get(id=asset_id, library=active_library())
    except MCQImageAsset.DoesNotExist:
        return JsonResponse({"error": "Image asset not found."}, status=404)
    path = _asset_disk_path(asset)
    if not path.exists():
        return JsonResponse({"error": f"Image file not found: {asset.relative_path or asset.file_path}"}, status=404)
    return FileResponse(path.open("rb"), content_type=mimetypes.guess_type(path.name)[0] or "application/octet-stream")


@csrf_exempt
def save_topic(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    library = active_library()
    name = str(payload.get("name") or "").strip()
    if not name:
        return JsonResponse({"error": "Topic name is required."}, status=400)
    topic_id = payload.get("id")
    topic = MCQTopic.objects.filter(id=topic_id, library=library).first() if topic_id else None
    if not topic:
        topic = MCQTopic(library=library)
    if MCQTopic.objects.filter(library=library, name__iexact=name).exclude(id=topic.id).exists():
        return JsonResponse({"error": f'Topic "{name}" already exists.'}, status=400)
    topic.name = name
    topic.description = str(payload.get("description") or "").strip()
    topic.color = str(payload.get("color") or "").strip()[:20]
    topic.is_active = bool(payload.get("is_active", True))
    topic.save()
    return JsonResponse(_topic_payload(MCQTopic.objects.prefetch_related("subtopics").annotate(question_count=Count("questions", distinct=True)).get(id=topic.id)))


@csrf_exempt
def delete_topic(request, topic_id: int):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    library = active_library()
    try:
        topic = MCQTopic.objects.get(id=topic_id, library=library)
    except MCQTopic.DoesNotExist:
        return JsonResponse({"error": "Topic not found."}, status=404)
    if topic.questions.exists():
        return JsonResponse({"error": "This topic is used by questions. Remove it from questions before deleting."}, status=400)
    topic.delete()
    return JsonResponse({"ok": True})


@csrf_exempt
def save_subtopic(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    name = str(payload.get("name") or "").strip()
    if not name:
        return JsonResponse({"error": "Subtopic name is required."}, status=400)
    try:
        topic = MCQTopic.objects.get(id=payload.get("topic_id"), library=active_library())
    except MCQTopic.DoesNotExist:
        return JsonResponse({"error": "Parent topic not found."}, status=404)
    subtopic_id = payload.get("id")
    subtopic = MCQSubtopic.objects.filter(id=subtopic_id, topic=topic).first() if subtopic_id else None
    if not subtopic:
        subtopic = MCQSubtopic(topic=topic)
    if MCQSubtopic.objects.filter(topic=topic, name__iexact=name).exclude(id=subtopic.id).exists():
        return JsonResponse({"error": f'Subtopic "{name}" already exists for this topic.'}, status=400)
    subtopic.name = name
    subtopic.description = str(payload.get("description") or "").strip()
    subtopic.is_active = bool(payload.get("is_active", True))
    subtopic.save()
    return JsonResponse({"id": subtopic.id, "name": subtopic.name, "topic_id": topic.id})


@csrf_exempt
def save_tag(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)
    library = active_library()
    name = str(payload.get("name") or "").strip()
    if not name:
        return JsonResponse({"error": "Tag name is required."}, status=400)
    tag_id = payload.get("id")
    tag = MCQTag.objects.filter(id=tag_id, library=library).first() if tag_id else None
    if not tag:
        tag = MCQTag(library=library)
    if MCQTag.objects.filter(library=library, name__iexact=name).exclude(id=tag.id).exists():
        return JsonResponse({"error": f'Tag "{name}" already exists.'}, status=400)
    tag.name = name
    tag.save()
    return JsonResponse({"id": tag.id, "name": tag.name})


def _validate_question_payload(payload: dict[str, object]) -> tuple[dict[str, object] | None, JsonResponse | None]:
    try:
        marks = max(int(payload.get("marks") or 1), 0)
    except (TypeError, ValueError):
        return None, JsonResponse({"error": "marks must be a whole number."}, status=400)

    try:
        year = int(payload["year"]) if payload.get("year") not in {"", None} else None
    except (TypeError, ValueError):
        return None, JsonResponse({"error": "year must be a whole number."}, status=400)

    allowed_review_statuses = {choice.value for choice in MCQQuestion.ReviewStatus}
    review_status = payload.get("review_status") or MCQQuestion.ReviewStatus.DRAFT
    if review_status not in allowed_review_statuses:
        return None, JsonResponse({"error": "review_status is not valid."}, status=400)

    allowed_layout_presets = {choice.value for choice in MCQQuestion.LayoutPreset}
    layout_preset = payload.get("layout_preset") or MCQQuestion.LayoutPreset.STANDARD
    if layout_preset not in allowed_layout_presets:
        return None, JsonResponse({"error": "layout_preset is not valid."}, status=400)

    allowed_option_layouts = {choice.value for choice in MCQQuestion.OptionLayout}
    option_layout = payload.get("option_layout") or MCQQuestion.OptionLayout.SINGLE
    if option_layout not in allowed_option_layouts:
        return None, JsonResponse({"error": "option_layout is not valid."}, status=400)

    return {
        "marks": marks,
        "year": year,
        "review_status": review_status,
        "layout_preset": layout_preset,
        "option_layout": option_layout,
    }, None


def _validate_question_content(payload: dict[str, object], library) -> JsonResponse | None:
    text = str(payload.get("question_text") or "").strip()
    asset_id = payload.get("question_asset_id")
    question_blocks = payload.get("question_blocks") or []
    layout_settings = payload.get("layout_settings") if isinstance(payload.get("layout_settings"), dict) else {}
    rich_text = str(layout_settings.get("rich_text") or "").strip()
    rich_content = layout_settings.get("rich_content") if isinstance(layout_settings.get("rich_content"), dict) else {}
    has_block_content = False
    if isinstance(question_blocks, list):
        for block in question_blocks:
            if not isinstance(block, dict):
                continue
            if str(block.get("text") or "").strip() or block.get("asset_id") or block.get("table_data"):
                has_block_content = True
                break
    has_rich_content = bool(rich_text or rich_content.get("content"))
    if not text and not asset_id and not has_block_content and not has_rich_content:
        return JsonResponse({"error": "Add question text or attach a question image before saving."}, status=400)
    if asset_id and not MCQImageAsset.objects.filter(id=asset_id, library=library).exists():
        return JsonResponse({"error": "The selected question image could not be found in the active library."}, status=400)
    if isinstance(question_blocks, list):
        for block in question_blocks:
            if not isinstance(block, dict):
                continue
            block_asset_id = block.get("asset_id")
            if block_asset_id and not MCQImageAsset.objects.filter(id=block_asset_id, library=library).exists():
                return JsonResponse({"error": "One selected question block image could not be found in the active library."}, status=400)
    option_asset_ids = payload.get("option_asset_ids") or {}
    if isinstance(option_asset_ids, dict):
        for label, option_asset_id in option_asset_ids.items():
            if option_asset_id and not MCQImageAsset.objects.filter(id=option_asset_id, library=library).exists():
                return JsonResponse({"error": f"The selected image for option {label} could not be found in the active library."}, status=400)
    return None


def _apply_question_payload(question: MCQQuestion, payload: dict[str, object], validated: dict[str, object]) -> MCQQuestion:
    question.title = str(payload.get("title") or "").strip()
    question.subject = str(payload.get("subject") or "Physics").strip() or "Physics"
    question.syllabus = str(payload.get("syllabus") or "9702").strip() or "9702"
    question.exam_code = str(payload.get("exam_code") or "").strip()
    question.paper_code = str(payload.get("paper_code") or "").strip()
    question.session = str(payload.get("session") or "").strip()
    question.year = validated["year"]
    question.variant = str(payload.get("variant") or "").strip()
    question.source = str(payload.get("source") or "").strip()
    question.source_question_number = _normalize_source_question_number(payload.get("source_question_number"))
    question.marks = validated["marks"]
    question.time_estimate_seconds = payload.get("time_estimate_seconds") or None
    question.difficulty = str(payload.get("difficulty") or "").strip()
    question.review_status = validated["review_status"]
    layout_settings = payload.get("layout_settings") if isinstance(payload.get("layout_settings"), dict) else {}
    question.content_json = layout_settings.get("rich_content") if isinstance(layout_settings.get("rich_content"), dict) else {}
    question.content_html = str(layout_settings.get("rich_html") or "")
    question.content_text = str(layout_settings.get("rich_text") or "")
    question.layout_preset = validated["layout_preset"]
    question.option_layout = validated["option_layout"]
    question.layout_settings = layout_settings
    question.notes = str(payload.get("notes") or "").strip()
    question.teacher_notes = str(payload.get("teacher_notes") or "").strip()
    question.save()

    question.blocks.all().delete()
    question_blocks = payload.get("question_blocks") or []
    order = 1
    if isinstance(question_blocks, list) and question_blocks:
        allowed_block_types = {choice.value for choice in MCQQuestionBlock.BlockType}
        for block in question_blocks:
            if not isinstance(block, dict):
                continue
            block_type = str(block.get("block_type") or MCQQuestionBlock.BlockType.TEXT)
            if block_type not in allowed_block_types:
                block_type = MCQQuestionBlock.BlockType.TEXT
            asset = None
            if block.get("asset_id"):
                asset = MCQImageAsset.objects.filter(id=block.get("asset_id"), library=question.library).first()
            text_value = str(block.get("text") or "").strip()
            table_data = block.get("table_data") if isinstance(block.get("table_data"), dict) else {}
            if text_value or asset or table_data:
                MCQQuestionBlock.objects.create(question=question, block_type=block_type, text=text_value, asset=asset, table_data=table_data, order=order)
                order += 1
    else:
        text = str(payload.get("question_text") or "").strip()
        for paragraph in [part.strip() for part in text.split("\n\n") if part.strip()]:
            MCQQuestionBlock.objects.create(question=question, block_type=MCQQuestionBlock.BlockType.TEXT, text=paragraph, order=order)
            order += 1
        question_asset_id = payload.get("question_asset_id")
        if question_asset_id:
            asset = MCQImageAsset.objects.filter(id=question_asset_id, library=question.library).first()
            if asset:
                MCQQuestionBlock.objects.create(question=question, block_type=MCQQuestionBlock.BlockType.IMAGE, asset=asset, order=order)

    question.options.all().delete()
    option_labels = payload.get("option_labels") or ["A", "B", "C", "D"]
    if not isinstance(option_labels, list) or not option_labels:
        option_labels = ["A", "B", "C", "D"]
    correct_label = str(payload.get("correct_option") or "").strip().upper()
    option_table = payload.get("option_table") if isinstance(payload.get("option_table"), dict) else {}
    option_table_headers = option_table.get("headers") if isinstance(option_table.get("headers"), list) else []
    option_table_rows = option_table.get("rows") if isinstance(option_table.get("rows"), dict) else {}
    option_table_cell_asset_ids = option_table.get("cell_asset_ids") if isinstance(option_table.get("cell_asset_ids"), dict) else {}
    for index, label in enumerate(option_labels):
        normalized_label = str(label or "").strip().upper()[:8]
        if not normalized_label:
            continue
        table_cells = option_table_rows.get(normalized_label)
        layout_settings = {}
        if isinstance(table_cells, list):
            table_cell_assets = option_table_cell_asset_ids.get(normalized_label)
            layout_settings = {
                "table_headers": [str(header) for header in option_table_headers],
                "table_cells": [str(cell) for cell in table_cells],
                "table_cell_asset_ids": table_cell_assets if isinstance(table_cell_assets, list) else [],
            }
        option_text = str((payload.get("option_texts") or {}).get(normalized_label, "")).strip()
        if isinstance(table_cells, list) and not option_text:
            option_text = " | ".join(str(cell).strip() for cell in table_cells if str(cell).strip())
        option = MCQOption.objects.create(
            question=question,
            label=normalized_label,
            order=index + 1,
            is_correct=normalized_label == correct_label,
            content_text=option_text,
            layout_settings=layout_settings,
        )
        option_blocks = (payload.get("option_blocks") or {}).get(normalized_label)
        if isinstance(option_blocks, list):
            block_order = 1
            for block in option_blocks:
                if not isinstance(block, dict):
                    continue
                block_type = str(block.get("block_type") or MCQOptionBlock.BlockType.TEXT)
                if block_type not in {choice.value for choice in MCQOptionBlock.BlockType}:
                    block_type = MCQOptionBlock.BlockType.TEXT
                asset = None
                if block.get("asset_id"):
                    asset = MCQImageAsset.objects.filter(id=block.get("asset_id"), library=question.library).first()
                text_value = str(block.get("text") or "").strip()
                settings = block.get("settings") if isinstance(block.get("settings"), dict) else {}
                if text_value or asset:
                    MCQOptionBlock.objects.create(option=option, block_type=block_type, text=text_value, asset=asset, order=block_order, settings=settings)
                    block_order += 1
        elif option_text:
            MCQOptionBlock.objects.create(option=option, block_type=MCQOptionBlock.BlockType.TEXT, text=option_text, order=1)
        if not isinstance(option_blocks, list):
            option_asset_id = (payload.get("option_asset_ids") or {}).get(normalized_label)
            if option_asset_id:
                asset = MCQImageAsset.objects.filter(id=option_asset_id, library=question.library).first()
                if asset:
                    MCQOptionBlock.objects.create(option=option, block_type=MCQOptionBlock.BlockType.IMAGE, asset=asset, order=2 if option_text else 1)

    library = question.library
    topic_ids = payload.get("topic_ids") or []
    subtopic_ids = payload.get("subtopic_ids") or []
    tag_ids = payload.get("tag_ids") or []
    question.topics.set(MCQTopic.objects.filter(library=library, id__in=topic_ids))
    question.subtopics.set(MCQSubtopic.objects.filter(topic__library=library, id__in=subtopic_ids))
    question.tags.set(MCQTag.objects.filter(library=library, id__in=tag_ids))
    return question


@csrf_exempt
def create_question(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    validated, error = _validate_question_payload(payload)
    if error:
        return error
    library = active_library()
    content_error = _validate_question_content(payload, library)
    if content_error:
        return content_error
    exam_code = str(payload.get("exam_code") or "").strip()
    source_question_number = _normalize_source_question_number(payload.get("source_question_number"))
    duplicate = _find_duplicate_question(library, exam_code, source_question_number)
    overwrite_duplicate = payload.get("duplicate_strategy") == "overwrite"
    if duplicate and not overwrite_duplicate:
        return _duplicate_question_response(duplicate)
    question = duplicate if duplicate and overwrite_duplicate else MCQQuestion(library=library)
    _apply_question_payload(question, payload, validated)
    response_payload = _question_payload(question, include_detail=True)
    if duplicate and overwrite_duplicate:
        response_payload["overwritten"] = True

    return JsonResponse(response_payload, status=200 if duplicate and overwrite_duplicate else 201)


@csrf_exempt
def update_question(request, question_id: int):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)
    try:
        library = active_library()
        question = MCQQuestion.objects.get(id=question_id, library=library)
    except MCQQuestion.DoesNotExist:
        return JsonResponse({"error": "MCQ question not found."}, status=404)
    validated, error = _validate_question_payload(payload)
    if error:
        return error
    content_error = _validate_question_content(payload, library)
    if content_error:
        return content_error
    exam_code = str(payload.get("exam_code") or "").strip()
    source_question_number = _normalize_source_question_number(payload.get("source_question_number"))
    duplicate = _find_duplicate_question(library, exam_code, source_question_number, exclude_id=question.id)
    overwrite_duplicate = payload.get("duplicate_strategy") == "overwrite"
    if duplicate and not overwrite_duplicate:
        return _duplicate_question_response(duplicate)
    target = duplicate if duplicate and overwrite_duplicate else question
    _apply_question_payload(target, payload, validated)
    if duplicate and overwrite_duplicate:
        question.delete()
    response_payload = _question_payload(target, include_detail=True)
    if duplicate and overwrite_duplicate:
        response_payload["overwritten"] = True
    return JsonResponse(response_payload)


@csrf_exempt
def quick_update_question(request, question_id: int):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)
    library = active_library()
    try:
        question = MCQQuestion.objects.get(id=question_id, library=library)
    except MCQQuestion.DoesNotExist:
        return JsonResponse({"error": "MCQ question not found."}, status=404)

    update_fields = []
    if "marks" in payload:
        try:
            question.marks = max(int(payload.get("marks") or 0), 0)
        except (TypeError, ValueError):
            return JsonResponse({"error": "marks must be a whole number."}, status=400)
        update_fields.append("marks")

    if "review_status" in payload:
        allowed_review_statuses = {choice.value for choice in MCQQuestion.ReviewStatus}
        review_status = str(payload.get("review_status") or "").strip()
        if review_status not in allowed_review_statuses:
            return JsonResponse({"error": "review_status is not valid."}, status=400)
        question.review_status = review_status
        update_fields.append("review_status")

    if update_fields:
        update_fields.append("updated_at")
        question.save(update_fields=update_fields)

    if "topic_ids" in payload:
        topic_ids = payload.get("topic_ids") or []
        question.topics.set(MCQTopic.objects.filter(library=library, id__in=topic_ids))

    return JsonResponse(_question_payload(question, include_detail=True))


@csrf_exempt
def duplicate_question(request, question_id: int):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        source = (
            MCQQuestion.objects.prefetch_related("topics", "subtopics", "tags", "blocks", "options", "options__blocks")
            .get(id=question_id, library=active_library())
        )
    except MCQQuestion.DoesNotExist:
        return JsonResponse({"error": "MCQ question not found."}, status=404)
    duplicate = MCQQuestion.objects.create(
        library=source.library,
        title=f"{source.title or 'Untitled question'} copy",
        subject=source.subject,
        syllabus=source.syllabus,
        exam_code=source.exam_code,
        paper_code=source.paper_code,
        session=source.session,
        year=source.year,
        variant=source.variant,
        source=source.source,
        source_question_number=source.source_question_number,
        marks=source.marks,
        time_estimate_seconds=source.time_estimate_seconds,
        difficulty=source.difficulty,
        review_status=MCQQuestion.ReviewStatus.DRAFT,
        notes=source.notes,
        teacher_notes=source.teacher_notes,
        content_json=source.content_json,
        content_html=source.content_html,
        content_text=source.content_text,
        layout_preset=source.layout_preset,
        option_layout=source.option_layout,
        layout_settings=source.layout_settings,
    )
    duplicate.topics.set(source.topics.all())
    duplicate.subtopics.set(source.subtopics.all())
    duplicate.tags.set(source.tags.all())
    for block in source.blocks.all():
        MCQQuestionBlock.objects.create(
            question=duplicate,
            block_type=block.block_type,
            text=block.text,
            asset=block.asset,
            table_data=block.table_data,
            order=block.order,
            settings=block.settings,
        )
    for option in source.options.all():
        new_option = MCQOption.objects.create(
            question=duplicate,
            label=option.label,
            is_correct=option.is_correct,
            order=option.order,
            content_json=option.content_json,
            content_html=option.content_html,
            content_text=option.content_text,
            layout_settings=option.layout_settings,
        )
        for block in option.blocks.all():
            MCQOptionBlock.objects.create(
                option=new_option,
                block_type=block.block_type,
                text=block.text,
                asset=block.asset,
                order=block.order,
                settings=block.settings,
            )
    return JsonResponse(_question_payload(duplicate, include_detail=True), status=201)


@csrf_exempt
def delete_question(request, question_id: int):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        question = MCQQuestion.objects.get(id=question_id, library=active_library())
    except MCQQuestion.DoesNotExist:
        return JsonResponse({"error": "MCQ question not found."}, status=404)
    question.delete()
    return JsonResponse({"ok": True})


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", value.strip())
    return cleaned.strip("_") or "mcq_exam"


def _exam_output_folder(title: str) -> Path:
    settings = get_settings()
    root = Path(settings.default_generated_exams_root or settings.library.generated_exams_path or settings.library.root_path).expanduser().resolve()
    base = root / _safe_filename(title)
    folder = base
    counter = 2
    while folder.exists():
        folder = root / f"{base.name}_{counter}"
        counter += 1
    folder.mkdir(parents=True, exist_ok=True)
    return folder


PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT = A4
PDF_MARGIN = 18 * mm
CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2


def _latex_to_readable(value: str) -> str:
    text = str(value or "")
    replacements = {
        "\\pm": "±",
        "\\times": "×",
        "\\cdot": "·",
        "\\theta": "θ",
        "\\Delta": "Δ",
        "\\pi": "π",
        "\\rightarrow": "→",
        "\\left": "",
        "\\right": "",
        "\\mathrm": "",
    }
    for source, target in replacements.items():
        text = text.replace(source, target)
    text = re.sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"(\1)/(\2)", text)
    text = re.sub(r"\\sqrt\{([^{}]+)\}", r"√(\1)", text)
    text = re.sub(r"\\vec\{([^{}]+)\}", r"\1⃗", text)
    text = re.sub(r"\{([^{}]+)\}", r"\1", text)
    superscripts = str.maketrans("0123456789+-=()", "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁼⁽⁾")
    subscripts = str.maketrans("0123456789+-=()", "₀₁₂₃₄₅₆₇₈₉₊₋₌₍₎")
    text = re.sub(r"\^\{([^{}]+)\}", lambda match: match.group(1).translate(superscripts), text)
    text = re.sub(r"_\{([^{}]+)\}", lambda match: match.group(1).translate(subscripts), text)
    text = re.sub(r"\^([A-Za-z0-9+\-=()])", lambda match: match.group(1).translate(superscripts), text)
    text = re.sub(r"_([A-Za-z0-9+\-=()])", lambda match: match.group(1).translate(subscripts), text)
    return text.strip()


def _paragraph_text(value: object) -> str:
    text = escape(str(value or ""))
    text = re.sub(
        r"\$\$([^$]+)\$\$|\$([^$]+)\$",
        lambda match: f"<font name='Helvetica-Oblique'>{escape(_latex_to_readable(match.group(1) or match.group(2)))}</font>",
        text,
    )
    return text.replace("\n", "<br/>")


def _pdf_styles():
    base = getSampleStyleSheet()
    body = ParagraphStyle("TeacherDeskBody", parent=base["BodyText"], fontName="Helvetica", fontSize=11, leading=14, spaceAfter=6)
    meta = ParagraphStyle("TeacherDeskMeta", parent=body, fontSize=7.5, leading=9, textColor=colors.HexColor("#6b7280"), spaceAfter=4)
    title = ParagraphStyle("TeacherDeskTitle", parent=body, fontName="Helvetica-Bold", fontSize=14, leading=18, spaceAfter=12)
    option = ParagraphStyle("TeacherDeskOption", parent=body, leftIndent=0, spaceAfter=4)
    key = ParagraphStyle("TeacherDeskKey", parent=body, fontSize=9, leading=12)
    return {"body": body, "meta": meta, "title": title, "option": option, "key": key}


def _rich_src_asset(src: object, library) -> MCQImageAsset | None:
    match = re.search(r"/api/mcq/assets/(\d+)/file/", str(src or ""))
    if not match:
        return None
    return MCQImageAsset.objects.filter(id=int(match.group(1)), library=library).first()


def _image_flowable(asset: MCQImageAsset | None, width_percent: float = 100, max_height: float = 160, h_align: str = "CENTER"):
    if not asset:
        return None
    path = _asset_disk_path(asset)
    if not path.exists():
        return None
    width = min(max(float(width_percent or 100), 5), 180) / 100 * CONTENT_WIDTH
    try:
        image = RLImage(str(path))
        ratio = image.imageHeight / image.imageWidth if image.imageWidth else 1
        image.drawWidth = min(width, CONTENT_WIDTH)
        image.drawHeight = image.drawWidth * ratio
        if image.drawHeight > max_height:
            image.drawHeight = max_height
            image.drawWidth = image.drawHeight / ratio
        image.hAlign = h_align
        return image
    except Exception:
        return None


def _rich_node_flowables(node: dict[str, object], question: MCQQuestion, styles: dict[str, ParagraphStyle]) -> list[object]:
    node_type = node.get("type")
    content = node.get("content") if isinstance(node.get("content"), list) else []
    if node_type == "doc":
        flowables: list[object] = []
        for child in content:
            if isinstance(child, dict):
                flowables.extend(_rich_node_flowables(child, question, styles))
        return flowables
    if node_type in {"paragraph", "heading"}:
        text = _rich_inline_text(content)
        if not text.strip():
            return [Spacer(1, 4)]
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        align_map = {"center": TA_CENTER, "right": TA_RIGHT, "left": TA_LEFT}
        style = ParagraphStyle(
            f"TDParagraph{id(node)}",
            parent=styles["body"],
            alignment=align_map.get(str(attrs.get("textAlign") or "left"), TA_LEFT),
            fontName="Helvetica-Bold" if node_type == "heading" else "Helvetica",
        )
        return [Paragraph(text, style)]
    if node_type == "image":
        attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
        asset = _rich_src_asset(attrs.get("src"), question.library)
        align = str(attrs.get("data-align") or "center").upper()
        width = float(attrs.get("width") or 100)
        image = _image_flowable(asset, width, max_height=230, h_align={"LEFT": "LEFT", "RIGHT": "RIGHT"}.get(align, "CENTER"))
        return [image, Spacer(1, 6)] if image else []
    if node_type == "table":
        rows = []
        for row in content:
            if not isinstance(row, dict):
                continue
            cells = []
            for cell in row.get("content", []) if isinstance(row.get("content"), list) else []:
                cells.append(Paragraph(_rich_inline_text(cell.get("content", []) if isinstance(cell, dict) else []), styles["body"]))
            if cells:
                rows.append(cells)
        if not rows:
            return []
        table = Table(rows, hAlign="LEFT")
        table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
        return [table, Spacer(1, 8)]
    flowables = []
    for child in content:
        if isinstance(child, dict):
            flowables.extend(_rich_node_flowables(child, question, styles))
    return flowables


def _rich_inline_text(nodes: list[object]) -> str:
    parts: list[str] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") == "text":
            text = _paragraph_text(node.get("text") or "")
            marks = node.get("marks") if isinstance(node.get("marks"), list) else []
            if any(isinstance(mark, dict) and mark.get("type") == "bold" for mark in marks):
                text = f"<b>{text}</b>"
            if any(isinstance(mark, dict) and mark.get("type") == "italic" for mark in marks):
                text = f"<i>{text}</i>"
            parts.append(text)
        elif node.get("type") == "hardBreak":
            parts.append("<br/>")
        else:
            parts.append(_rich_inline_text(node.get("content", []) if isinstance(node.get("content"), list) else []))
    return "".join(parts)


def _question_content_flowables(question: MCQQuestion, styles: dict[str, ParagraphStyle]) -> list[object]:
    if isinstance(question.content_json, dict) and question.content_json.get("content"):
        flowables = _rich_node_flowables(question.content_json, question, styles)
        if flowables:
            return flowables
    flowables: list[object] = []
    for block in question.blocks.all():
        if block.block_type == MCQQuestionBlock.BlockType.IMAGE:
            image = _image_flowable(block.asset, block.settings.get("width", 100) if isinstance(block.settings, dict) else 100, max_height=230)
            if image:
                flowables.extend([image, Spacer(1, 6)])
        elif block.block_type == MCQQuestionBlock.BlockType.TABLE:
            rows = block.table_data.get("rows", []) if isinstance(block.table_data, dict) else []
            if rows:
                table = Table([[Paragraph(_paragraph_text(cell), styles["body"]) for cell in row] for row in rows], hAlign="LEFT")
                table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.black), ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
                flowables.extend([table, Spacer(1, 8)])
        elif block.text:
            flowables.append(Paragraph(_paragraph_text(block.text), styles["body"]))
    return flowables or [Paragraph("[No question text saved]", styles["body"])]


def _option_flowables(option: MCQOption, styles: dict[str, ParagraphStyle], teacher: bool, display_label: str) -> list[object]:
    parts: list[object] = []
    correct = " ✓" if teacher and option.is_correct else ""
    text_blocks = [block for block in option.blocks.all() if block.text]
    image_blocks = [block for block in option.blocks.all() if block.asset_id]
    text = option.content_text or " ".join(block.text for block in text_blocks)
    paragraph = Paragraph(f"<b>{display_label}.</b>{correct} {_paragraph_text(text or '')}", styles["option"])
    parts.append(paragraph)
    for block in image_blocks:
        settings = block.settings if isinstance(block.settings, dict) else {}
        align = str(settings.get("align") or "center").upper()
        image = _image_flowable(block.asset, settings.get("width", 100), max_height=float(settings.get("height") or 145), h_align={"LEFT": "LEFT", "RIGHT": "RIGHT"}.get(align, "CENTER"))
        if image:
            parts.append(image)
    return parts


def _options_flowable(question: MCQQuestion, options: list[tuple[str, MCQOption]], styles: dict[str, ParagraphStyle], teacher: bool):
    if question.option_layout == MCQQuestion.OptionLayout.TABLE:
        first = next((option for _, option in options if option.layout_settings.get("table_cells")), None)
        headers = first.layout_settings.get("table_headers", []) if first else []
        show_headers = question.layout_settings.get("option_image_layout", {}).get("table_headers", True)
        show_borders = question.layout_settings.get("option_image_layout", {}).get("table_borders", True)
        rows: list[list[object]] = []
        if show_headers:
            rows.append([Paragraph("", styles["body"])] + [Paragraph(f"<b>{_paragraph_text(header)}</b>", styles["body"]) for header in headers])
        for display_label, option in options:
            cells = [Paragraph(f"<b>{display_label}</b>", styles["body"])]
            for value in option.layout_settings.get("table_cells", []):
                cells.append(Paragraph(_paragraph_text(value), styles["body"]))
            rows.append(cells)
        table = Table(rows, hAlign="LEFT", repeatRows=1 if show_headers else 0)
        commands = [("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("FONTSIZE", (0, 0), (-1, -1), 9)]
        if show_borders:
            commands.append(("GRID", (0, 0), (-1, -1), 0.5, colors.black))
        table.setStyle(TableStyle(commands))
        return table

    columns = 1
    if question.option_layout == MCQQuestion.OptionLayout.TWO_COLUMN:
        columns = 2
    elif question.option_layout in {MCQQuestion.OptionLayout.FOUR_COLUMN, MCQQuestion.OptionLayout.GRID}:
        columns = 4
    cells = [_option_flowables(option, styles, teacher, label) for label, option in options]
    rows = [cells[index:index + columns] for index in range(0, len(cells), columns)]
    while rows and len(rows[-1]) < columns:
        rows[-1].append("")
    table = Table(rows, colWidths=[CONTENT_WIDTH / columns] * columns, hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    return table


def _tokens(text: str, title: str, variant: int, mode: str, page: int, pages: int) -> str:
    return str(text or "").format(title=title, variant=variant, mode=mode, page=page, pages=pages, date=timezone.localdate().isoformat())


class HeaderFooterCanvas(Canvas):
    def __init__(self, *args, header_footer: dict[str, object] | None = None, title: str = "", variant: int = 1, mode: str = "", **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []
        self.header_footer = header_footer or {}
        self.doc_title = title
        self.variant = variant
        self.mode = mode

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        page_count = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_header_footer(page_count)
            super().showPage()
        super().save()

    def _draw_header_footer(self, page_count: int):
        page = self._pageNumber
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#4b5563"))
        positions = {
            "left": (PDF_MARGIN, TA_LEFT),
            "center": (PDF_PAGE_WIDTH / 2, TA_CENTER),
            "right": (PDF_PAGE_WIDTH - PDF_MARGIN, TA_RIGHT),
        }
        for area, y in (("header", PDF_PAGE_HEIGHT - 10 * mm), ("footer", 10 * mm)):
            config = self.header_footer.get(area, {}) if isinstance(self.header_footer.get(area, {}), dict) else {}
            for key, (x, alignment) in positions.items():
                value = _tokens(str(config.get(key, "")), self.doc_title, self.variant, self.mode, page, page_count)
                if not value:
                    continue
                self.drawString(x, y, value) if alignment == TA_LEFT else self.drawCentredString(x, y, value) if alignment == TA_CENTER else self.drawRightString(x, y, value)


def _make_pdf(path: Path, title: str, question_groups: list[tuple[MCQQuestion, list[tuple[str, MCQOption]]]], include_metadata: bool, metadata_position: str, teacher: bool = False, header_footer: dict[str, object] | None = None, variant: int = 1, mode: str = ""):
    styles = _pdf_styles()
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=PDF_MARGIN, leftMargin=PDF_MARGIN, topMargin=18 * mm, bottomMargin=18 * mm)
    story: list[object] = [Paragraph(_paragraph_text(title), styles["title"])]
    for index, (question, options) in enumerate(question_groups, start=1):
        metadata = f"{question.exam_code or 'manual'} {question.source_question_number or f'Q{index}'}"
        question_parts: list[object] = []
        if include_metadata and metadata_position == "above":
            question_parts.append(Paragraph(_paragraph_text(metadata), styles["meta"]))
        content = _question_content_flowables(question, styles)
        content_table = Table([[Paragraph(f"<b>{index}</b>", styles["body"]), content]], colWidths=[18, CONTENT_WIDTH - 18])
        content_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
        question_parts.append(content_table)
        if include_metadata and metadata_position == "below":
            question_parts.append(Paragraph(f"Source: {_paragraph_text(metadata)}", styles["meta"]))
        question_parts.append(Spacer(1, 5))
        question_parts.append(_options_flowable(question, options, styles, teacher))
        question_parts.append(Spacer(1, 12))
        story.append(KeepTogether(question_parts))
    doc.build(story, canvasmaker=lambda *args, **kwargs: HeaderFooterCanvas(*args, header_footer=header_footer, title=title, variant=variant, mode=mode, **kwargs))


def _make_answer_key_pdf(path: Path, title: str, question_groups: list[tuple[MCQQuestion, list[tuple[str, MCQOption]]]], header_footer: dict[str, object] | None = None, variant: int = 1, mode: str = ""):
    styles = _pdf_styles()
    doc = SimpleDocTemplate(str(path), pagesize=A4, rightMargin=PDF_MARGIN, leftMargin=PDF_MARGIN, topMargin=18 * mm, bottomMargin=18 * mm)
    rows = [[Paragraph("<b>Q</b>", styles["key"]), Paragraph("<b>Answer</b>", styles["key"]), Paragraph("<b>Source</b>", styles["key"]), Paragraph("<b>Topics</b>", styles["key"])]]
    for index, (question, options) in enumerate(question_groups, start=1):
        correct = next((display_label for display_label, option in options if option.is_correct), "-")
        topics = ", ".join(topic.name for topic in question.topics.all()) or "-"
        rows.append([Paragraph(str(index), styles["key"]), Paragraph(correct, styles["key"]), Paragraph(_paragraph_text(f"{question.exam_code or '-'} {question.source_question_number or '-'}"), styles["key"]), Paragraph(_paragraph_text(topics), styles["key"])])
    table = Table(rows, colWidths=[28, 52, 150, CONTENT_WIDTH - 230])
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#cbd5e1")), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e5f4f2")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story = [Paragraph(_paragraph_text(f"{title} - Answer key"), styles["title"]), table]
    doc.build(story, canvasmaker=lambda *args, **kwargs: HeaderFooterCanvas(*args, header_footer=header_footer, title=title, variant=variant, mode=mode, **kwargs))


def _eligible_mcq_questions(review_pool: str):
    queryset = MCQQuestion.objects.filter(library=active_library()).prefetch_related("topics", "tags", "blocks", "blocks__asset", "options", "options__blocks", "options__blocks__asset")
    if review_pool != "all":
        queryset = queryset.filter(review_status__in=[MCQQuestion.ReviewStatus.READY, MCQQuestion.ReviewStatus.VERIFIED])
    return list(queryset)


def _pick_full_mcq(questions: list[MCQQuestion], count: int) -> list[MCQQuestion]:
    grouped: dict[str, list[MCQQuestion]] = {}
    for question in questions:
        key = question.source_question_number or str(question.id)
        grouped.setdefault(key, []).append(question)
    ordered_keys = sorted(grouped, key=lambda value: int(re.search(r"\d+", value).group()) if re.search(r"\d+", value) else 9999)
    return [random.choice(grouped[key]) for key in ordered_keys[:count]]


def _pick_topic_rows(questions: list[MCQQuestion], rows: list[dict[str, object]]) -> tuple[list[MCQQuestion], list[dict[str, object]]]:
    selected: list[MCQQuestion] = []
    warnings: list[dict[str, object]] = []
    used: set[int] = set()
    for index, row in enumerate(rows, start=1):
        topic_ids = {int(value) for value in row.get("topic_ids", []) if str(value).isdigit()}
        tag_ids = {int(value) for value in row.get("tag_ids", []) if str(value).isdigit()}
        try:
            count = max(int(row.get("count") or 1), 1)
        except (TypeError, ValueError):
            count = 1
        matches = [
            question for question in questions
            if question.id not in used
            and topic_ids.issubset({topic.id for topic in question.topics.all()})
            and tag_ids.issubset({tag.id for tag in question.tags.all()})
        ]
        random.shuffle(matches)
        picked = matches[:count]
        selected.extend(picked)
        used.update(question.id for question in picked)
        if len(picked) < count:
            warnings.append({"row": index, "requested": count, "available": len(matches), "message": "Not enough matching questions."})
    return selected, warnings


@csrf_exempt
def generate_exam(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    title = str(payload.get("title") or "MCQ exam").strip() or "MCQ exam"
    mode = str(payload.get("mode") or MCQExam.Mode.FULL_PAPER)
    review_pool = str(payload.get("review_pool") or "ready")
    include_metadata = bool(payload.get("include_metadata"))
    metadata_position = "below" if payload.get("metadata_position") == "below" else "above"
    shuffle_questions = bool(payload.get("shuffle_questions"))
    shuffle_options = bool(payload.get("shuffle_options"))
    variants = min(max(int(payload.get("variants") or 1), 1), 10)
    question_count = min(max(int(payload.get("question_count") or 40), 1), 100)
    header_footer = payload.get("header_footer") if isinstance(payload.get("header_footer"), dict) else {}

    questions = _eligible_mcq_questions(review_pool)
    warnings: list[dict[str, object]] = []
    if mode == MCQExam.Mode.MANUAL:
        raw_ids = [int(value) for value in payload.get("selected_question_ids", []) if str(value).isdigit()]
        selected = [question for question in questions if question.id in raw_ids]
        selected.sort(key=lambda question: raw_ids.index(question.id))
    elif mode == MCQExam.Mode.TOPIC:
        selected, warnings = _pick_topic_rows(questions, payload.get("topic_rows") if isinstance(payload.get("topic_rows"), list) else [])
    else:
        mode = MCQExam.Mode.FULL_PAPER
        selected = _pick_full_mcq(questions, question_count)
    if not selected:
        return JsonResponse({"error": "No questions matched these generator settings."}, status=400)

    try:
        output_folder = _exam_output_folder(title)
    except PermissionError as error:
        return JsonResponse({"error": f"TeacherDesk cannot write to the generated exams folder: {error}"}, status=400)
    exam = MCQExam.objects.create(
        library=active_library(),
        title=title,
        mode=mode,
        total_marks=sum(question.marks for question in selected),
        settings_snapshot=payload,
    )
    for index, question in enumerate(selected, start=1):
        MCQExamQuestion.objects.create(exam=exam, question=question, order=index, marks=question.marks)

    variant_payloads = []
    for variant_index in range(1, variants + 1):
        variant_questions = list(selected)
        if shuffle_questions:
            random.shuffle(variant_questions)
        question_groups = []
        answer_order = []
        for question in variant_questions:
            options = list(question.options.all())
            if shuffle_options:
                random.shuffle(options)
            display_options = [(chr(65 + option_index), option) for option_index, option in enumerate(options)]
            question_groups.append((question, display_options))
            answer_order.append({
                "question_id": question.id,
                "option_order": [{"display_label": display_label, "option_uuid": str(option.uuid), "original_label": option.label} for display_label, option in display_options],
                "correct": next((display_label for display_label, option in display_options if option.is_correct), ""),
            })
        suffix = f"_V{variant_index}" if variants > 1 else ""
        student_path = output_folder / f"{_safe_filename(title)}{suffix}_Student.pdf"
        teacher_path = output_folder / f"{_safe_filename(title)}{suffix}_Teacher.pdf"
        key_path = output_folder / f"{_safe_filename(title)}{suffix}_Answer_Key.pdf"
        _make_pdf(student_path, f"{title}{suffix}", question_groups, include_metadata, metadata_position, teacher=False, header_footer=header_footer, variant=variant_index, mode=mode)
        _make_pdf(teacher_path, f"{title}{suffix} - Teacher", question_groups, include_metadata, metadata_position, teacher=True, header_footer=header_footer, variant=variant_index, mode=mode)
        _make_answer_key_pdf(key_path, f"{title}{suffix}", question_groups, header_footer=header_footer, variant=variant_index, mode=mode)
        variant_payloads.append({"variant": variant_index, "student_pdf": str(student_path), "teacher_pdf": str(teacher_path), "answer_key_pdf": str(key_path), "answer_order": answer_order})
    first = variant_payloads[0]
    exam.student_pdf_path = first["student_pdf"]
    exam.teacher_pdf_path = first["teacher_pdf"]
    exam.answer_key_pdf_path = first["answer_key_pdf"]
    exam.save(update_fields=["student_pdf_path", "teacher_pdf_path", "answer_key_pdf_path", "updated_at"])
    return JsonResponse(
        {
            "id": exam.id,
            "title": exam.title,
            "output_folder": str(output_folder),
            "question_count": len(selected),
            "total_marks": exam.total_marks,
            "variants": variant_payloads,
            "warnings": warnings,
        },
        status=201,
    )


@csrf_exempt
def open_exam_folder(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)
    folder = Path(str(payload.get("folder") or "")).expanduser()
    if not folder.exists() or not folder.is_dir():
        return JsonResponse({"error": f"Folder not found: {folder}"}, status=404)
    os.startfile(str(folder))
    return JsonResponse({"opened": True, "folder": str(folder)})


urlpatterns = [
    path("", index),
    path("dashboard/", dashboard),
    path("questions/", questions),
    path("questions/create/", create_question),
    path("questions/<int:question_id>/", question_detail),
    path("questions/<int:question_id>/quick-update/", quick_update_question),
    path("questions/<int:question_id>/update/", update_question),
    path("questions/<int:question_id>/duplicate/", duplicate_question),
    path("questions/<int:question_id>/delete/", delete_question),
    path("exams/generate/", generate_exam),
    path("exams/open-folder/", open_exam_folder),
    path("assets/", assets),
    path("assets/upload/", upload_asset),
    path("assets/<int:asset_id>/file/", asset_file),
    path("metadata/", metadata),
    path("metadata/topics/save/", save_topic),
    path("metadata/topics/<int:topic_id>/delete/", delete_topic),
    path("metadata/subtopics/save/", save_subtopic),
    path("metadata/tags/save/", save_tag),
]
