import json

from django.db.models import Count, Q
from django.http import JsonResponse
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


@csrf_exempt
def create_question(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    library = active_library()
    try:
        marks = max(int(payload.get("marks") or 1), 0)
    except (TypeError, ValueError):
        return JsonResponse({"error": "marks must be a whole number."}, status=400)

    question = MCQQuestion.objects.create(
        library=library,
        title=str(payload.get("title") or "").strip(),
        subject=str(payload.get("subject") or "Physics").strip() or "Physics",
        syllabus=str(payload.get("syllabus") or "9702").strip() or "9702",
        exam_code=str(payload.get("exam_code") or "").strip(),
        paper_code=str(payload.get("paper_code") or "").strip(),
        session=str(payload.get("session") or "").strip(),
        year=payload.get("year") or None,
        source=str(payload.get("source") or "").strip(),
        marks=marks,
        difficulty=str(payload.get("difficulty") or "").strip(),
        review_status=payload.get("review_status") or MCQQuestion.ReviewStatus.DRAFT,
        layout_preset=payload.get("layout_preset") or MCQQuestion.LayoutPreset.STANDARD,
        option_layout=payload.get("option_layout") or MCQQuestion.OptionLayout.SINGLE,
        notes=str(payload.get("notes") or "").strip(),
        teacher_notes=str(payload.get("teacher_notes") or "").strip(),
    )

    text = str(payload.get("question_text") or "").strip()
    if text:
        MCQQuestionBlock.objects.create(question=question, block_type=MCQQuestionBlock.BlockType.TEXT, text=text, order=1)

    option_labels = payload.get("option_labels") or ["A", "B", "C", "D"]
    if not isinstance(option_labels, list) or not option_labels:
        option_labels = ["A", "B", "C", "D"]
    correct_label = str(payload.get("correct_option") or "").strip().upper()
    for index, label in enumerate(option_labels):
        normalized_label = str(label or "").strip().upper()[:8]
        if not normalized_label:
            continue
        option = MCQOption.objects.create(
            question=question,
            label=normalized_label,
            order=index + 1,
            is_correct=normalized_label == correct_label,
        )
        option_text = str((payload.get("option_texts") or {}).get(normalized_label, "")).strip()
        if option_text:
            MCQOptionBlock.objects.create(option=option, block_type=MCQOptionBlock.BlockType.TEXT, text=option_text, order=1)

    return JsonResponse(_question_payload(question, include_detail=True), status=201)


urlpatterns = [
    path("", index),
    path("dashboard/", dashboard),
    path("questions/", questions),
    path("questions/create/", create_question),
    path("questions/<int:question_id>/", question_detail),
    path("metadata/", metadata),
]
