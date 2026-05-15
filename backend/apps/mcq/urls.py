import json
import hashlib
import mimetypes
import os
import random
import re
import shutil
import subprocess
import tempfile
from functools import lru_cache
from html import escape
from pathlib import Path
from uuid import uuid4

from django.conf import settings
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
from matplotlib.mathtext import math_to_image

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


def _strip_math_delimiters(value: object) -> str:
    text = str(value or "").strip()
    if text.startswith("$$") and text.endswith("$$") and len(text) >= 4:
        return text[2:-2].strip()
    if text.startswith("$") and text.endswith("$") and len(text) >= 2:
        return text[1:-1].strip()
    return text


def _is_math_only(value: object) -> bool:
    text = str(value or "").strip()
    if not text:
        return False
    if (text.startswith("$") and text.endswith("$")) or (text.startswith("$$") and text.endswith("$$")):
        return True
    latex_markers = ("\\frac", "\\sqrt", "\\pm", "\\mathrm", "\\theta", "\\Delta", "\\pi", "\\sum", "\\int", "^", "_")
    return any(marker in text for marker in latex_markers) and not re.search(r"[A-Za-z]{3,}\s+[A-Za-z]{3,}", text.replace("\\mathrm", ""))


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


def _math_image_path(library, latex: str) -> Path | None:
    clean = _strip_math_delimiters(latex)
    if not clean:
        return None
    folder = Path(tempfile.gettempdir()) / "teacherdesk_math"
    folder.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha1(clean.encode("utf-8")).hexdigest()[:20]
    output = folder / f"eq_{digest}.png"
    if output.exists():
        return output
    try:
        math_to_image(f"${clean}$", str(output), dpi=220, format="png")
    except Exception:
        try:
            math_to_image(clean, str(output), dpi=220, format="png")
        except Exception:
            return None
    return output if output.exists() else None


def _math_flowable(library, latex: str, max_width: float, max_height: float = 28, h_align: str = "LEFT"):
    path = _math_image_path(library, latex)
    if not path:
        return None
    try:
        image = RLImage(str(path))
        ratio = image.imageHeight / image.imageWidth if image.imageWidth else 1
        image.drawWidth = min(max_width, image.imageWidth * 0.28)
        image.drawHeight = image.drawWidth * ratio
        if image.drawHeight > max_height:
            image.drawHeight = max_height
            image.drawWidth = image.drawHeight / ratio
        image.hAlign = h_align
        return image
    except Exception:
        return None


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


def _image_flowable(asset: MCQImageAsset | None, width_percent: float = 100, max_height: float = 160, h_align: str = "CENTER", available_width: float = CONTENT_WIDTH):
    if not asset:
        return None
    path = _asset_disk_path(asset)
    if not path.exists():
        return None
    width = min(max(float(width_percent or 100), 5), 180) / 100 * available_width
    try:
        image = RLImage(str(path))
        ratio = image.imageHeight / image.imageWidth if image.imageWidth else 1
        image.drawWidth = min(width, available_width)
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
        plain_text = _rich_inline_plain(content)
        if _is_math_only(plain_text):
            math_image = _math_flowable(question.library, plain_text, max_width=CONTENT_WIDTH, max_height=34, h_align={"center": "CENTER", "right": "RIGHT"}.get(str(attrs.get("textAlign") or "left"), "LEFT"))
            if math_image:
                return [math_image, Spacer(1, 4)]
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


def _rich_inline_plain(nodes: list[object]) -> str:
    parts: list[str] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("type") == "text":
            parts.append(str(node.get("text") or ""))
        elif node.get("type") == "hardBreak":
            parts.append("\n")
        else:
            parts.append(_rich_inline_plain(node.get("content", []) if isinstance(node.get("content"), list) else []))
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


def _option_text_flowable(option: MCQOption, text: str, styles: dict[str, ParagraphStyle], max_width: float):
    if _is_math_only(text):
        math_image = _math_flowable(option.question.library, text, max_width=max_width, max_height=22, h_align="LEFT")
        if math_image:
            return math_image
    return Paragraph(_paragraph_text(text or ""), styles["option"])


def _option_flowables(
    option: MCQOption,
    styles: dict[str, ParagraphStyle],
    teacher: bool,
    display_label: str,
    layout_config: dict[str, object],
    cell_width: float,
) -> list[object]:
    parts: list[object] = []
    correct = " (correct)" if teacher and option.is_correct else ""
    label_placement = str(layout_config.get("label_placement") or "inline")
    placement = str(layout_config.get("placement") or "top")
    sizing = str(layout_config.get("sizing") or "individual")
    content_align = str(layout_config.get("content_align") or "left").upper()
    h_align = {"LEFT": "LEFT", "CENTER": "CENTER", "RIGHT": "RIGHT"}.get(content_align, "LEFT")
    text_blocks = [block for block in option.blocks.all() if block.text]
    image_blocks = [block for block in option.blocks.all() if block.asset_id]
    text = option.content_text or " ".join(block.text for block in text_blocks)
    label = Paragraph(f"<b>{display_label}{'.' if label_placement == 'inline' else ''}</b>{correct}", styles["option"])
    text_flowable = _option_text_flowable(option, text, styles, max_width=max(cell_width - 18, 20)) if text else None
    image_flowables: list[object] = []
    for block in image_blocks:
        settings = block.settings if isinstance(block.settings, dict) else {}
        align = str(settings.get("align") or "center").upper()
        image = _image_flowable(
            block.asset,
            settings.get("width", 100),
            max_height=float(settings.get("height") or 145),
            h_align={"LEFT": "LEFT", "RIGHT": "RIGHT"}.get(align, "CENTER"),
            available_width=max(cell_width - 18, 20),
        )
        if image:
            if sizing == "same_height" and image.drawHeight:
                target_height = min(72, float(settings.get("height") or 72))
                ratio = image.drawWidth / image.drawHeight if image.drawHeight else 1
                image.drawHeight = target_height
                image.drawWidth = min(target_height * ratio, max(cell_width - 18, 20))
            elif sizing == "same_width":
                ratio = image.drawHeight / image.drawWidth if image.drawWidth else 1
                image.drawWidth = max(cell_width - 18, 20)
                image.drawHeight = image.drawWidth * ratio
            elif sizing == "same_size":
                image.drawWidth = max(cell_width - 18, 20)
                image.drawHeight = 86
            image_flowables.append(image)
    if label_placement == "above":
        parts.append(label)
    elif text_flowable and not _is_math_only(text):
        parts.append(Paragraph(f"<b>{display_label}.</b>{correct} {_paragraph_text(text or '')}", styles["option"]))
        text_flowable = None
    else:
        parts.append(label)
    if placement == "middle" and image_flowables and text_flowable:
        side = Table([[image_flowables, [text_flowable]]], colWidths=[cell_width * 0.44, cell_width * 0.48], hAlign=h_align)
        side.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 4)]))
        parts.append(side)
    else:
        if placement == "top":
            parts.extend(image_flowables)
        if text_flowable:
            parts.append(text_flowable)
        if placement == "bottom":
            parts.extend(image_flowables)
        if placement == "middle" and image_flowables and not text_flowable:
            parts.extend(image_flowables)
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
            asset_ids = option.layout_settings.get("table_cell_asset_ids", [])
            cell_width = CONTENT_WIDTH / max(len(headers) + 1, 2)
            for index, value in enumerate(option.layout_settings.get("table_cells", [])):
                cell_parts: list[object] = []
                if str(value).strip():
                    math_cell = _math_flowable(option.question.library, value, max_width=cell_width, max_height=24, h_align="CENTER") if _is_math_only(value) else None
                    cell_parts.append(math_cell or Paragraph(_paragraph_text(value), styles["body"]))
                if isinstance(asset_ids, list) and index < len(asset_ids) and asset_ids[index]:
                    asset = MCQImageAsset.objects.filter(id=asset_ids[index], library=question.library).first()
                    image = _image_flowable(asset, 100, max_height=70, h_align="CENTER", available_width=cell_width)
                    if image:
                        cell_parts.append(image)
                cells.append(cell_parts or Paragraph("", styles["body"]))
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
    layout_config = question.layout_settings.get("option_image_layout", {}) if isinstance(question.layout_settings, dict) else {}
    cell_width = CONTENT_WIDTH / columns
    cells = [_option_flowables(option, styles, teacher, label, layout_config, cell_width) for label, option in options]
    rows = [cells[index:index + columns] for index in range(0, len(cells), columns)]
    while rows and len(rows[-1]) < columns:
        rows[-1].append("")
    placement = str(layout_config.get("placement") or "top")
    valign = {"top": "TOP", "middle": "MIDDLE", "bottom": "BOTTOM"}.get(placement, "TOP")
    table = Table(rows, colWidths=[cell_width] * columns, hAlign="LEFT")
    table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), valign), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
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
        if not (isinstance(question.layout_settings, dict) and question.layout_settings.get("options_embedded")):
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


def _browser_executable() -> str | None:
    candidates = [
        os.environ.get("TEACHERDESK_BROWSER_PATH", ""),
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        shutil.which("chrome") or "",
        shutil.which("msedge") or "",
    ]
    return next((path for path in candidates if path and Path(path).exists()), None)


def _asset_uri(asset: MCQImageAsset | None) -> str:
    if not asset:
        return ""
    path = _asset_disk_path(asset)
    if not path.exists():
        return ""
    return path.resolve().as_uri()


def _html_math_text(value: object) -> str:
    return escape(str(value or "")).replace("\n", "<br>")


@lru_cache(maxsize=1)
def _katex_print_assets() -> tuple[str, str, str]:
    frontend_root = Path(settings.BASE_DIR).parent / "frontend" / "node_modules" / "katex" / "dist"
    css_path = frontend_root / "katex.min.css"
    js_path = frontend_root / "katex.min.js"
    auto_render_path = frontend_root / "contrib" / "auto-render.min.js"
    try:
        font_uri = (frontend_root / "fonts").resolve().as_uri() + "/"
        css = css_path.read_text(encoding="utf-8").replace("url(fonts/", f"url({font_uri}")
        return (
            css,
            js_path.read_text(encoding="utf-8"),
            auto_render_path.read_text(encoding="utf-8"),
        )
    except OSError:
        return ("", "", "")


def _rich_node_html(node: dict[str, object], question: MCQQuestion) -> str:
    node_type = node.get("type")
    content = node.get("content") if isinstance(node.get("content"), list) else []
    children = "".join(_rich_node_html(child, question) for child in content if isinstance(child, dict))
    attrs = node.get("attrs") if isinstance(node.get("attrs"), dict) else {}
    align = str(attrs.get("textAlign") or "")
    style = f" style=\"text-align:{escape(align)}\"" if align in {"left", "center", "right"} else ""
    if node_type == "doc":
        return children
    if node_type == "paragraph":
        return f"<p{style}>{children}</p>"
    if node_type == "heading":
        level = min(max(int(attrs.get("level") or 2), 1), 3)
        return f"<h{level}{style}>{children}</h{level}>"
    if node_type == "bulletList":
        return f"<ul>{children}</ul>"
    if node_type == "orderedList":
        list_type = str(attrs.get("type") or "1")
        css_type = {"a": "lower-alpha", "A": "upper-alpha", "i": "lower-roman", "I": "upper-roman"}.get(list_type, "decimal")
        return f"<ol style=\"list-style-type:{css_type}\">{children}</ol>"
    if node_type == "listItem":
        return f"<li>{children}</li>"
    if node_type == "hardBreak":
        return "<br>"
    if node_type == "image":
        asset = _rich_src_asset(attrs.get("src"), question.library)
        src = _asset_uri(asset)
        if not src:
            return ""
        width = attrs.get("width") or 100
        width_text = str(width)
        width_css = width_text if width_text.endswith("%") or width_text.endswith("px") else f"{width_text}%"
        fit = "cover" if attrs.get("data-fit") == "cover" else "contain"
        image_align = attrs.get("data-align") if attrs.get("data-align") in {"left", "right"} else "center"
        return f"<img class=\"a4-question-image fit-{fit} align-{image_align}\" style=\"width:{escape(width_css)}\" src=\"{src}\" alt=\"{escape(str(attrs.get('alt') or 'Question image'))}\">"
    if node_type == "table":
        is_option_group = bool(attrs.get("optionGroup"))
        classes = ["mcq-preview-table", "rich-table"]
        data_attrs = ""
        style_attr = ""
        if is_option_group:
            classes.append("embedded-option-table")
            data_attrs += ' data-mcq-option-group="true"'
            option_layout = str(attrs.get("optionLayout") or "")
            if option_layout:
                classes.append(f"layout-{escape(option_layout)}")
                data_attrs += f' data-option-layout="{escape(option_layout)}"'
            if attrs.get("optionBorders") is False or attrs.get("optionBorders") == "false":
                classes.append("no-borders")
                data_attrs += ' data-option-borders="false"'
            if attrs.get("optionHeaders") is False or attrs.get("optionHeaders") == "false":
                classes.append("hide-headers")
            for key, prefix in (("letterPlacement", "letter"), ("letterAlign", "letter-align"), ("contentAlign", "content-align"), ("cellPadding", "padding")):
                value = str(attrs.get(key) or "")
                if value:
                    classes.append(f"{prefix}-{escape(value)}")
            if attrs.get("optionGap") not in {None, ""}:
                style_attr = f' style="--mcq-option-gap:{escape(str(attrs.get("optionGap")))}px"'
        return f"<table class=\"{' '.join(classes)}\"{data_attrs}{style_attr}><tbody>{children}</tbody></table>"
    if node_type == "tableRow":
        return f"<tr>{children}</tr>"
    if node_type == "tableHeader":
        return f"<th>{children}</th>"
    if node_type == "tableCell":
        return f"<td>{children}</td>"
    if node_type == "text":
        text = _html_math_text(node.get("text") or "")
        marks = node.get("marks") if isinstance(node.get("marks"), list) else []
        if any(isinstance(mark, dict) and mark.get("type") == "bold" for mark in marks):
            text = f"<strong>{text}</strong>"
        if any(isinstance(mark, dict) and mark.get("type") == "italic" for mark in marks):
            text = f"<em>{text}</em>"
        if any(isinstance(mark, dict) and mark.get("type") == "underline" for mark in marks):
            text = f"<u>{text}</u>"
        return f"<span>{text}</span>"
    return children


def _question_content_html(question: MCQQuestion) -> str:
    if isinstance(question.content_json, dict) and question.content_json.get("content"):
        return _rich_node_html(question.content_json, question)
    parts = []
    for block in question.blocks.all():
        if block.block_type == MCQQuestionBlock.BlockType.IMAGE:
            src = _asset_uri(block.asset)
            if src:
                width = block.settings.get("width", 100) if isinstance(block.settings, dict) else 100
                parts.append(f"<img class=\"a4-question-image\" style=\"width:{escape(str(width))}%\" src=\"{src}\" alt=\"{escape(block.asset.original_name if block.asset else 'Question image')}\">")
        elif block.block_type == MCQQuestionBlock.BlockType.TABLE:
            rows = block.table_data.get("rows", []) if isinstance(block.table_data, dict) else []
            cells = "".join("<tr>" + "".join(f"<td>{_html_math_text(cell)}</td>" for cell in row) + "</tr>" for row in rows)
            parts.append(f"<table class=\"mcq-preview-table\"><tbody>{cells}</tbody></table>")
        elif block.text:
            parts.append(f"<p>{_html_math_text(block.text)}</p>")
    return "".join(parts) or "<p>No question content saved.</p>"


def _option_html(option: MCQOption, display_label: str, teacher: bool, layout: dict[str, object]) -> str:
    placement = str(layout.get("placement") or "top")
    label_placement = str(layout.get("label_placement") or "inline")
    text_blocks = [block for block in option.blocks.all() if block.text]
    image_blocks = [block for block in option.blocks.all() if block.asset_id]
    text = option.content_text or " ".join(block.text for block in text_blocks)
    label = f"<b>{escape(display_label)}{'.' if label_placement == 'inline' else ''}</b>"
    if teacher and option.is_correct:
        label += " <span class=\"correct-word\">correct</span>"
    image_html = ""
    for block in image_blocks:
        settings = block.settings if isinstance(block.settings, dict) else {}
        src = _asset_uri(block.asset)
        if not src:
            continue
        width = settings.get("width", 100)
        height = settings.get("height", 0)
        fit = "cover" if settings.get("fit") == "cover" else "contain"
        align = settings.get("align") if settings.get("align") in {"left", "right"} else "center"
        offset_x = settings.get("offset_x", 0)
        offset_y = settings.get("offset_y", 0)
        style = f"width:{escape(str(width))}%;"
        if height:
            style += f"height:{escape(str(height))}px;"
        if offset_x or offset_y:
            style += f"transform:translate({escape(str(offset_x))}px,{escape(str(offset_y))}px);"
        image_html += f"<img class=\"a4-option-image fit-{fit} align-{align}\" style=\"{style}\" src=\"{src}\" alt=\"{escape(block.asset.original_name if block.asset else 'Option image')}\">"
    text_html = f"<span class=\"option-text-fragment\">{_html_math_text(text)}</span>" if text else ""
    if placement == "middle" and image_html:
        content = f"<span class=\"option-media-middle\">{image_html}<span>{text_html}</span></span>"
    else:
        content = f"{image_html if placement == 'top' else ''}{text_html}{image_html if placement == 'bottom' else ''}"
    if not content:
        content = "<span class=\"option-text-fragment\">Answer option</span>"
    return f"<span>{label}<span class=\"option-body\">{content}</span></span>"


def _table_options_html(question: MCQQuestion, options: list[tuple[str, MCQOption]], teacher: bool, layout: dict[str, object]) -> str:
    first = next((option for _, option in options if option.layout_settings.get("table_cells")), None)
    headers = first.layout_settings.get("table_headers", []) if first else []
    show_headers = layout.get("table_headers", True)
    show_borders = layout.get("table_borders", True)
    head = ""
    if show_headers:
        head = "<thead><tr><th></th>" + "".join(f"<th>{_html_math_text(header)}</th>" for header in headers) + "</tr></thead>"
    rows = []
    for display_label, option in options:
        asset_ids = option.layout_settings.get("table_cell_asset_ids", [])
        cells_html = []
        for index, value in enumerate(option.layout_settings.get("table_cells", [])):
            cell_parts = []
            if str(value).strip():
                cell_parts.append(f"<span>{_html_math_text(value)}</span>")
            if isinstance(asset_ids, list) and index < len(asset_ids) and asset_ids[index]:
                asset = MCQImageAsset.objects.filter(id=asset_ids[index], library=question.library).first()
                src = _asset_uri(asset)
                if src:
                    cell_parts.append(f"<img src=\"{src}\" alt=\"{escape(asset.original_name if asset else 'Table cell image')}\">")
            cells_html.append(f"<td><span class=\"mcq-table-cell-content\">{''.join(cell_parts)}</span></td>")
        cells = "".join(cells_html)
        rows.append(f"<tr class=\"{'correct' if teacher and option.is_correct else ''}\"><th>{escape(display_label)}</th>{cells}</tr>")
    return f"<table class=\"mcq-answer-table-preview {'no-borders' if not show_borders else ''} {'hide-headers' if not show_headers else ''}\">{head}<tbody>{''.join(rows)}</tbody></table>"


def _options_html(question: MCQQuestion, options: list[tuple[str, MCQOption]], teacher: bool) -> str:
    layout = question.layout_settings.get("option_image_layout", {}) if isinstance(question.layout_settings, dict) else {}
    if isinstance(question.layout_settings, dict) and question.layout_settings.get("options_embedded"):
        return ""
    if question.option_layout == MCQQuestion.OptionLayout.TABLE:
        return _table_options_html(question, options, teacher, layout)
    placement = str(layout.get("placement") or "top")
    sizing = str(layout.get("sizing") or "individual")
    label = str(layout.get("label_placement") or "inline")
    label_align = str(layout.get("label_align") or "center")
    align = str(layout.get("content_align") or "left")
    option_items = "".join(_option_html(option, display_label, teacher, layout) for display_label, option in options)
    return f"<div class=\"option-preview-grid layout-{escape(question.option_layout)} option-images-{escape(sizing)} label-{escape(label)} label-align-{escape(label_align)} align-{escape(align)} image-place-{escape(placement)}\">{option_items}</div>"


def _html_tokens(value: object, title: str, variant: int, mode: str) -> str:
    token_values = {
        "title": title,
        "variant": str(variant),
        "mode": mode,
        "date": timezone.localdate().isoformat(),
    }

    def replace(match):
        token = match.group(1)
        if token == "page":
            return "<span class=\"page-number-token\"></span>"
        if token == "pages":
            return "<span class=\"page-count-token\"></span>"
        return escape(token_values.get(token, match.group(0)))

    return re.sub(r"\{(title|variant|mode|date|page|pages)\}", replace, str(value or ""))


def _html_header_footer(header_footer: dict[str, object] | None, title: str, variant: int, mode: str) -> str:
    header_footer = header_footer or {}
    sections = []
    for area in ("header", "footer"):
        config = header_footer.get(area, {}) if isinstance(header_footer.get(area, {}), dict) else {}
        cells = []
        for position in ("left", "center", "right"):
            text = _html_tokens(config.get(position, ""), title, variant, mode)
            cells.append(f"<span class=\"print-{position}\">{text}</span>")
        if any(config.get(position) for position in ("left", "center", "right")):
            sections.append(f"<div class=\"print-{area}\">{''.join(cells)}</div>")
    return "".join(sections)


def _mcq_exam_html(title: str, question_groups: list[tuple[MCQQuestion, list[tuple[str, MCQOption]]]], include_metadata: bool, metadata_position: str, teacher: bool, header_footer: dict[str, object] | None, variant: int, mode: str, paper_style_override: dict[str, object] | None = None) -> str:
    header_footer = header_footer or {}
    katex_css, katex_js, auto_render_js = _katex_print_assets()
    questions = []
    for index, (question, options) in enumerate(question_groups, start=1):
        question_layout = question.layout_settings if isinstance(question.layout_settings, dict) else {}
        paper_style = question_layout.get("paper_style", {}) if isinstance(question_layout.get("paper_style", {}), dict) else {}
        if isinstance(paper_style_override, dict):
            paper_style = {**paper_style, **{key: value for key, value in paper_style_override.items() if value not in (None, "")}}
        font_family = str(paper_style.get("font_family") or "Calibri")
        font_size = float(paper_style.get("font_size_pt") or 11)
        equation_scale = float(paper_style.get("equation_scale") or 1)
        option_gap = float(paper_style.get("option_gap_px") or 6)
        number_weight = int(paper_style.get("question_number_weight") or 700)
        section_style = (
            f"--mcq-print-font-size:{font_size}pt;"
            f"--mcq-print-font-family:{escape(font_family)};"
            f"--mcq-equation-scale:{equation_scale};"
            f"--mcq-option-gap:{option_gap}px;"
            f"--mcq-question-number-font-weight:{number_weight};"
        )
        metadata = f"{question.exam_code or 'manual'} {question.source_question_number or f'Q{index}'}"
        meta_above = f"<div class=\"source-meta\">{escape(metadata)}</div>" if include_metadata and metadata_position == "above" else ""
        meta_below = f"<div class=\"source-meta\">Source: {escape(metadata)}</div>" if include_metadata and metadata_position == "below" else ""
        teacher_note = f"<div class=\"teacher-preview-note\">Correct answer: {escape(next((label for label, option in options if option.is_correct), 'not set'))}</div>" if teacher else ""
        questions.append(
            f"<section class=\"mcq-print-question\" style=\"{section_style}\">{meta_above}<div class=\"paper-question-row\"><span class=\"paper-question-number\">{index}</span><div class=\"paper-question-body\"><div class=\"question-block-preview rich-preview-content\">{_question_content_html(question)}</div>{meta_below}{_options_html(question, options, teacher)}{teacher_note}</div></div></section>"
        )
    return f"""<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>{escape(title)}</title>
<style>
{katex_css}
@page {{ size: A4; margin: 18mm; }}
body {{ margin: 0; background: white; color: #111827; font-family: Calibri, "Segoe UI", Arial, sans-serif; font-size: 11pt; line-height: 1.35; }}
h1 {{ font-size: 14pt; margin: 0 0 14px; }}
p {{ margin: 0 0 9px; }}
.mcq-print-question {{ break-inside: avoid; page-break-inside: avoid; margin: 0 0 18px; font-family: var(--mcq-print-font-family, Calibri, "Segoe UI", Arial, sans-serif); font-size: var(--mcq-print-font-size, 11pt); }}
.paper-question-row {{ display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 14px; align-items: start; }}
.paper-question-number {{ text-align: right; font-weight: var(--mcq-question-number-font-weight, 700); }}
.question-block-preview {{ display: grid; gap: 12px; }}
.rich-preview-content {{ overflow-wrap: anywhere; }}
.rich-preview-content ul,.rich-preview-content ol {{ margin: 0 0 10px 20px; padding: 0; }}
.a4-question-image {{ display: block; max-width: 100%; object-fit: contain; margin: 16px auto; border: 0; }}
.a4-question-image.align-left {{ margin-left: 0; margin-right: auto; }}
.a4-question-image.align-right {{ margin-left: auto; margin-right: 0; }}
.option-preview-grid {{ display: grid; gap: var(--mcq-option-gap, 6px); margin-top: 20px; align-items: stretch; }}
.option-preview-grid.layout-two_column,.option-preview-grid.layout-grid {{ grid-template-columns: repeat(2, minmax(0, 1fr)); }}
.option-preview-grid.layout-four_column {{ grid-template-columns: repeat(4, minmax(0, 1fr)); }}
.option-preview-grid > span {{ display: grid; align-content: start; align-items: start; min-width: 0; min-height: 1.8em; padding: 2px 0; }}
.option-preview-grid > span b,.option-text-fragment {{ display: inline-block; margin-right: 5px; }}
.option-preview-grid.label-inline > span {{ grid-template-columns: auto minmax(0, 1fr); column-gap: 5px; }}
.option-preview-grid.label-inline > span b {{ grid-column: 1; }}
.option-preview-grid.label-inline > span .option-body {{ grid-column: 2; }}
.option-body {{ display: grid; gap: 4px; min-width: 0; align-content: start; justify-items: start; }}
.option-preview-grid.label-above > span {{ display: grid; gap: 4px; justify-items: start; }}
.option-preview-grid.label-above > span b {{ display: block; width: 100%; margin: 0; }}
.option-preview-grid.label-align-left > span b {{ text-align: left; }}
.option-preview-grid.label-align-center > span b {{ text-align: center; }}
.option-preview-grid.label-align-right > span b {{ text-align: right; }}
.option-preview-grid.align-center .option-body {{ text-align: center; justify-items: center; }}
.option-preview-grid.align-right .option-body {{ text-align: right; justify-items: end; }}
.option-preview-grid.image-place-middle .option-body {{ align-self: stretch; display: flex; flex-direction: column; justify-content: center; }}
.option-preview-grid.image-place-bottom .option-body {{ align-self: stretch; display: flex; flex-direction: column; justify-content: flex-end; }}
.option-media-middle {{ display: inline-flex; align-items: center; gap: 8px; max-width: 100%; vertical-align: middle; }}
.a4-option-image {{ display: block; max-width: none; object-fit: contain; margin: 6px auto; }}
.a4-option-image.align-left {{ margin-left: 0; margin-right: auto; }}
.a4-option-image.align-right {{ margin-left: auto; margin-right: 0; }}
.option-media-middle .a4-option-image {{ margin: 0; max-width: 45%; }}
.option-preview-grid.option-images-same_height .a4-option-image {{ width: auto !important; height: 72px !important; }}
.option-preview-grid.option-images-same_width .a4-option-image {{ width: 100% !important; height: auto; }}
.option-preview-grid.option-images-same_size .a4-option-image {{ width: 100% !important; height: 86px !important; object-fit: contain; }}
.mcq-preview-table,.mcq-answer-table-preview {{ width: 100%; border-collapse: collapse; margin: 8px 0; }}
.mcq-preview-table th,.mcq-preview-table td,.mcq-answer-table-preview th,.mcq-answer-table-preview td {{ border: 1px solid #111827; padding: 7px 8px; text-align: center; vertical-align: middle; }}
.mcq-preview-table.embedded-option-table {{ table-layout: auto; }}
.mcq-preview-table.embedded-option-table.no-borders th,.mcq-preview-table.embedded-option-table.no-borders td {{ border-color: transparent; }}
.mcq-preview-table.embedded-option-table.letter-align-left td:nth-child(odd),.mcq-preview-table.embedded-option-table.letter-align-left th:nth-child(odd) {{ text-align: left; }}
.mcq-preview-table.embedded-option-table.letter-align-center td:nth-child(odd),.mcq-preview-table.embedded-option-table.letter-align-center th:nth-child(odd) {{ text-align: center; }}
.mcq-preview-table.embedded-option-table.letter-align-right td:nth-child(odd),.mcq-preview-table.embedded-option-table.letter-align-right th:nth-child(odd) {{ text-align: right; }}
.mcq-preview-table.embedded-option-table.content-align-left td:nth-child(even),.mcq-preview-table.embedded-option-table.content-align-left th:nth-child(even) {{ text-align: left; }}
.mcq-preview-table.embedded-option-table.content-align-center td:nth-child(even),.mcq-preview-table.embedded-option-table.content-align-center th:nth-child(even) {{ text-align: center; }}
.mcq-preview-table.embedded-option-table.content-align-right td:nth-child(even),.mcq-preview-table.embedded-option-table.content-align-right th:nth-child(even) {{ text-align: right; }}
.mcq-preview-table.embedded-option-table td,.mcq-preview-table.embedded-option-table th {{ overflow-wrap: normal; word-break: normal; }}
.mcq-preview-table.embedded-option-table td:nth-child(odd),.mcq-preview-table.embedded-option-table th:nth-child(odd) {{ width: 32px; white-space: nowrap; font-weight: 800; }}
.mcq-preview-table.embedded-option-table td:nth-child(even),.mcq-preview-table.embedded-option-table th:nth-child(even) {{ padding-left: calc(6px + var(--mcq-option-gap, 0px)); }}
.mcq-preview-table.embedded-option-table.layout-four_column td:nth-child(even),.mcq-preview-table.embedded-option-table.layout-four_column th:nth-child(even) {{ white-space: nowrap; }}
.mcq-answer-table-preview.no-borders th,.mcq-answer-table-preview.no-borders td {{ border-color: transparent; }}
.mcq-table-cell-content {{ display: grid; gap: 4px; justify-items: center; align-items: center; }}
.mcq-table-cell-content img {{ display: block; max-width: 100%; max-height: 80px; object-fit: contain; }}
.print-header,.print-footer {{ position: fixed; left: 0; right: 0; display: grid; grid-template-columns: 1fr 1fr 1fr; color: #4b5563; font-size: 8pt; z-index: 2; }}
.print-header {{ top: -10mm; }}
.print-footer {{ bottom: -10mm; }}
.print-left {{ text-align: left; }}
.print-center {{ text-align: center; }}
.print-right {{ text-align: right; }}
.page-number-token::after {{ content: counter(page); }}
.page-count-token::after {{ content: counter(pages); }}
.source-meta {{ color: #6b7280; font-size: 8pt; margin-bottom: 4px; }}
.katex {{ font-size: calc(1em * var(--mcq-equation-scale, 1)); white-space: nowrap; }}
.katex-display {{ margin: 8px 0; }}
.teacher-preview-note {{ margin-top: 10px; color: #065f46; font-weight: 700; }}
.correct-word {{ color: #065f46; font-size: 8pt; }}
</style>
</head>
<body>{_html_header_footer(header_footer, title, variant, mode)}<h1>{escape(title)}</h1>{''.join(questions)}
<script>{katex_js}</script>
<script>{auto_render_js}</script>
<script>
if (window.renderMathInElement) {{
  renderMathInElement(document.body, {{
    delimiters: [
      {{left: "$$", right: "$$", display: true}},
      {{left: "$", right: "$", display: false}}
    ],
    throwOnError: false,
    strict: "ignore"
  }});
}}
</script>
</body>
</html>"""


def _make_pdf_browser(path: Path, title: str, question_groups: list[tuple[MCQQuestion, list[tuple[str, MCQOption]]]], include_metadata: bool, metadata_position: str, teacher: bool = False, header_footer: dict[str, object] | None = None, variant: int = 1, mode: str = "", paper_style_override: dict[str, object] | None = None) -> bool:
    browser = _browser_executable()
    if not browser:
        return False
    path = path.resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    html_path = path.with_suffix(".html")
    user_data = Path(tempfile.mkdtemp(prefix="teacherdesk_chrome_"))
    html_path.write_text(_mcq_exam_html(title, question_groups, include_metadata, metadata_position, teacher, header_footer, variant, mode, paper_style_override), encoding="utf-8")
    try:
        completed = subprocess.run(
            [
                browser,
                "--headless",
                "--disable-gpu",
                "--disable-gpu-sandbox",
                "--disable-software-rasterizer",
                "--disable-dev-shm-usage",
                "--no-sandbox",
                "--no-first-run",
                "--disable-extensions",
                f"--user-data-dir={user_data}",
                "--print-to-pdf-no-header",
                f"--print-to-pdf={path}",
                html_path.resolve().as_uri(),
            ],
            check=False,
            capture_output=True,
            timeout=90,
        )
        return completed.returncode == 0 and path.exists() and path.stat().st_size > 0
    finally:
        shutil.rmtree(user_data, ignore_errors=True)


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
    paper_style_override = payload.get("paper_style") if isinstance(payload.get("paper_style"), dict) else {}

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
            options_embedded = isinstance(question.layout_settings, dict) and question.layout_settings.get("options_embedded")
            if shuffle_options and not options_embedded:
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
        if not _make_pdf_browser(student_path, f"{title}{suffix}", question_groups, include_metadata, metadata_position, teacher=False, header_footer=header_footer, variant=variant_index, mode=mode, paper_style_override=paper_style_override):
            _make_pdf(student_path, f"{title}{suffix}", question_groups, include_metadata, metadata_position, teacher=False, header_footer=header_footer, variant=variant_index, mode=mode)
        if not _make_pdf_browser(teacher_path, f"{title}{suffix} - Teacher", question_groups, include_metadata, metadata_position, teacher=True, header_footer=header_footer, variant=variant_index, mode=mode, paper_style_override=paper_style_override):
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
