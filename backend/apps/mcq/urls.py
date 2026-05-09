import json
import mimetypes
from pathlib import Path
from uuid import uuid4

from django.db.models import Count, Q
from django.http import FileResponse, JsonResponse
from django.urls import path
from django.views.decorators.csrf import csrf_exempt

from apps.libraries.urls import active_library

from .models import (
    MCQExam,
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


def _asset_payload(asset: MCQImageAsset) -> dict[str, object]:
    return {
        "id": asset.id,
        "asset_type": asset.asset_type,
        "asset_type_label": asset.get_asset_type_display(),
        "original_name": asset.original_name,
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
        "name": topic.name,
        "description": topic.description,
        "color": topic.color,
        "is_active": topic.is_active,
        "subtopics": [{"id": subtopic.id, "name": subtopic.name} for subtopic in topic.subtopics.all()],
        "question_count": getattr(topic, "question_count", topic.questions.count()),
    }


def _option_payload(option: MCQOption) -> dict[str, object]:
    blocks = []
    for block in option.blocks.all():
        blocks.append(
            {
                "id": block.id,
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
        "label": option.label,
        "is_correct": option.is_correct,
        "order": option.order,
        "layout_settings": option.layout_settings,
        "blocks": blocks,
    }


def _question_payload(question: MCQQuestion, include_detail: bool = False) -> dict[str, object]:
    topics = list(question.topics.values("id", "name"))
    subtopics = list(question.subtopics.values("id", "name", "topic_id"))
    tags = list(question.tags.values("id", "name"))
    options = list(question.options.all())
    has_images = question.blocks.filter(asset__isnull=False).exists() or MCQOptionBlock.objects.filter(option__question=question, asset__isnull=False).exists()
    has_tables = question.blocks.filter(block_type=MCQQuestionBlock.BlockType.TABLE).exists() or question.option_layout == MCQQuestion.OptionLayout.TABLE
    has_equations = question.blocks.filter(text__contains="$").exists() or MCQOptionBlock.objects.filter(option__question=question, text__contains="$").exists()
    correct_option = next((option.label for option in options if option.is_correct), "")
    payload = {
        "id": question.id,
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
                "layout_settings": question.layout_settings,
                "blocks": [
                    {
                        "id": block.id,
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
    difficulty = request.GET.get("difficulty", "").strip()
    review_status = request.GET.get("review_status", "").strip()
    content_type = request.GET.get("content_type", "").strip()
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
    if tag:
        queryset = queryset.filter(tags__name=tag)
    if difficulty:
        queryset = queryset.filter(difficulty=difficulty)
    if review_status:
        queryset = queryset.filter(review_status=review_status)
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
    return JsonResponse(
        {
            "topics": [_topic_payload(topic) for topic in topics],
            "tags": list(MCQTag.objects.filter(library=library).values("id", "name")),
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
    asset_root = Path(library.root_path) / "mcq_assets"
    asset_root.mkdir(parents=True, exist_ok=True)
    safe_name = f"{uuid4().hex}{extension}"
    output_path = asset_root / safe_name
    with output_path.open("wb") as destination:
        for chunk in uploaded.chunks():
            destination.write(chunk)
    asset = MCQImageAsset.objects.create(
        library=library,
        asset_type=asset_type,
        original_name=original_name,
        file_path=str(output_path),
        file_size=output_path.stat().st_size,
    )
    return JsonResponse(_asset_payload(asset), status=201)


def asset_file(request, asset_id: int):
    try:
        asset = MCQImageAsset.objects.get(id=asset_id, library=active_library())
    except MCQImageAsset.DoesNotExist:
        return JsonResponse({"error": "Image asset not found."}, status=404)
    path = Path(asset.file_path)
    if not path.exists():
        return JsonResponse({"error": f"Image file not found: {asset.file_path}"}, status=404)
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
    question.source_question_number = str(payload.get("source_question_number") or "").strip()
    question.marks = validated["marks"]
    question.time_estimate_seconds = payload.get("time_estimate_seconds") or None
    question.difficulty = str(payload.get("difficulty") or "").strip()
    question.review_status = validated["review_status"]
    question.layout_preset = validated["layout_preset"]
    question.option_layout = validated["option_layout"]
    question.layout_settings = payload.get("layout_settings") if isinstance(payload.get("layout_settings"), dict) else {}
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
    for index, label in enumerate(option_labels):
        normalized_label = str(label or "").strip().upper()[:8]
        if not normalized_label:
            continue
        table_cells = option_table_rows.get(normalized_label)
        layout_settings = {}
        if isinstance(table_cells, list):
            layout_settings = {
                "table_headers": [str(header) for header in option_table_headers],
                "table_cells": [str(cell) for cell in table_cells],
            }
        option = MCQOption.objects.create(
            question=question,
            label=normalized_label,
            order=index + 1,
            is_correct=normalized_label == correct_label,
            layout_settings=layout_settings,
        )
        option_text = str((payload.get("option_texts") or {}).get(normalized_label, "")).strip()
        if isinstance(table_cells, list) and not option_text:
            option_text = " | ".join(str(cell).strip() for cell in table_cells if str(cell).strip())
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
    question = MCQQuestion(library=library)
    _apply_question_payload(question, payload, validated)

    return JsonResponse(_question_payload(question, include_detail=True), status=201)


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
    _apply_question_payload(question, payload, validated)
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


urlpatterns = [
    path("", index),
    path("dashboard/", dashboard),
    path("questions/", questions),
    path("questions/create/", create_question),
    path("questions/<int:question_id>/", question_detail),
    path("questions/<int:question_id>/update/", update_question),
    path("questions/<int:question_id>/duplicate/", duplicate_question),
    path("questions/<int:question_id>/delete/", delete_question),
    path("assets/", assets),
    path("assets/upload/", upload_asset),
    path("assets/<int:asset_id>/file/", asset_file),
    path("metadata/", metadata),
    path("metadata/topics/save/", save_topic),
    path("metadata/topics/<int:topic_id>/delete/", delete_topic),
    path("metadata/subtopics/save/", save_subtopic),
    path("metadata/tags/save/", save_tag),
]
