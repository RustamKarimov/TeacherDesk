import mimetypes
import os
import json

from django.http import FileResponse
from django.http import JsonResponse
from django.db.models import Q
from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.clickjacking import xframe_options_exempt

from .models import Question, Topic


def _status_label(status: str) -> str:
    return {
        Question.ReviewStatus.NOT_REQUIRED: "Not required",
        Question.ReviewStatus.NEEDS_REVIEW: "Needs review",
        Question.ReviewStatus.REVIEWED: "Reviewed",
    }.get(status, status)


def _question_payload(question: Question) -> dict[str, object]:
    topics = list(question.topics.values_list("name", flat=True))
    return {
        "id": question.id,
        "paper": f"Paper{question.paper_number}",
        "paper_number": question.paper_number,
        "question": f"Q{question.question_number}",
        "question_number": question.question_number,
        "exam": question.exam_code,
        "component": question.component,
        "session": question.session,
        "topics": topics,
        "marks": question.marks,
        "qp_status": _status_label(question.qp_review_status),
        "ms_status": _status_label(question.ms_review_status),
        "qp_status_value": question.qp_review_status,
        "ms_status_value": question.ms_review_status,
        "review_reason": question.review_reason,
        "split_qp_path": question.split_qp_path,
        "split_ms_path": question.split_ms_path,
        "qp_pages": [question.qp_page_start, question.qp_page_end],
        "ms_pages": [question.ms_page_start, question.ms_page_end],
        "updated_at": question.updated_at.isoformat(),
    }


def _reason_sentences(reason: str) -> list[str]:
    normalized = " ".join(reason.split())
    if not normalized:
        return []
    return [part if part.endswith(".") else f"{part}." for part in normalized.split(". ") if part]


def _normalize_document_reason(label: str, sentence: str) -> str | None:
    if sentence.startswith(f"{label} needs review:"):
        return sentence
    if sentence.startswith(label):
        detail = sentence[len(label):].strip()
        if not detail:
            return f"{label} needs review."
        if detail.lower().startswith("needs review"):
            return sentence
        detail = detail[0].lower() + detail[1:]
        return f"{label} needs review: {detail}"
    return None


def _document_review_reasons(question: Question, label: str) -> list[str]:
    reasons = []
    for sentence in _reason_sentences(question.review_reason):
        normalized = _normalize_document_reason(label, sentence)
        if normalized and normalized not in reasons:
            reasons.append(normalized)
    return reasons


def _manual_review_reasons(question: Question) -> list[str]:
    manual_reasons = []
    for sentence in _reason_sentences(question.review_reason):
        if _normalize_document_reason("Question paper", sentence) or _normalize_document_reason("Mark scheme", sentence):
            continue
        if sentence not in manual_reasons:
            manual_reasons.append(sentence)
    return manual_reasons


def _refresh_review_reason(question: Question, update_fields: list[str]) -> None:
    reasons = []
    if question.qp_review_status == Question.ReviewStatus.NEEDS_REVIEW:
        reasons.extend(_document_review_reasons(question, "Question paper") or ["Question paper needs review: manual review requested."])
    if question.ms_review_status == Question.ReviewStatus.NEEDS_REVIEW:
        reasons.extend(_document_review_reasons(question, "Mark scheme") or ["Mark scheme needs review: manual review requested."])
    if reasons:
        reasons.extend(_manual_review_reasons(question))

    next_reason = " ".join(reasons)
    if question.review_reason != next_reason:
        question.review_reason = next_reason
        if "review_reason" not in update_fields:
            update_fields.append("review_reason")


def index(request):
    return JsonResponse({"module": "catalog", "status": "ready"})


def questions(request):
    queryset = Question.objects.prefetch_related("topics").order_by("paper_number", "question_number", "exam_code")
    paper = request.GET.get("paper")
    question_number = request.GET.get("question_number")
    topics = [topic for topic in request.GET.getlist("topic") if topic]
    topic_mode = request.GET.get("topic_mode", "any")
    review_status = request.GET.get("review_status")
    search = request.GET.get("search")
    try:
        page = max(int(request.GET.get("page") or 1), 1)
        page_size = min(max(int(request.GET.get("page_size") or 50), 10), 100)
    except ValueError:
        return JsonResponse({"error": "page and page_size must be whole numbers."}, status=400)

    if paper:
        queryset = queryset.filter(paper_number=paper)
    if question_number:
        queryset = queryset.filter(question_number=question_number)
    if topics:
        if topic_mode == "all":
            for topic in topics:
                queryset = queryset.filter(topics__name=topic)
        else:
            queryset = queryset.filter(topics__name__in=topics)
    if review_status:
        queryset = queryset.filter(qp_review_status=review_status) | queryset.filter(ms_review_status=review_status)
    if search:
        queryset = queryset.filter(
            Q(exam_code__icontains=search)
            | Q(component__icontains=search)
            | Q(session__icontains=search)
            | Q(topics__name__icontains=search)
        )

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


def filters(request):
    queryset = Question.objects.prefetch_related("topics").all()
    paper = request.GET.get("paper")
    question_number = request.GET.get("question_number")
    topics = [topic for topic in request.GET.getlist("topic") if topic]
    topic_mode = request.GET.get("topic_mode", "any")
    review_status = request.GET.get("review_status")
    search = request.GET.get("search")

    if paper:
        queryset = queryset.filter(paper_number=paper)
    if question_number:
        queryset = queryset.filter(question_number=question_number)
    if topics:
        if topic_mode == "all":
            for topic in topics:
                queryset = queryset.filter(topics__name=topic)
        else:
            queryset = queryset.filter(topics__name__in=topics)
    if review_status:
        queryset = queryset.filter(qp_review_status=review_status) | queryset.filter(ms_review_status=review_status)
    if search:
        queryset = queryset.filter(
            Q(exam_code__icontains=search)
            | Q(component__icontains=search)
            | Q(session__icontains=search)
            | Q(topics__name__icontains=search)
        )
    queryset = queryset.distinct()

    question_ids = queryset.values("id")
    papers = list(queryset.order_by("paper_number").values_list("paper_number", flat=True).distinct())
    question_numbers = list(queryset.order_by("question_number").values_list("question_number", flat=True).distinct())
    available_topics = list(
        Topic.objects.filter(question__id__in=question_ids).order_by("topic_number", "name").distinct().values("topic_number", "name")
    )
    return JsonResponse(
        {
            "papers": papers,
            "question_numbers": question_numbers,
            "topics": available_topics,
            "review_statuses": [
                {"value": Question.ReviewStatus.NEEDS_REVIEW, "label": "Needs review"},
                {"value": Question.ReviewStatus.REVIEWED, "label": "Reviewed"},
                {"value": Question.ReviewStatus.NOT_REQUIRED, "label": "Not required"},
            ],
        }
    )


def mark_reviewed(request, question_id: int):
    document_type = request.GET.get("document_type", "both")
    if document_type not in {"qp", "ms", "both"}:
        return JsonResponse({"error": "document_type must be qp, ms, or both."}, status=400)
    try:
        question = Question.objects.get(id=question_id)
    except Question.DoesNotExist:
        return JsonResponse({"error": "Question not found."}, status=404)
    if document_type in {"qp", "both"}:
        question.qp_review_status = Question.ReviewStatus.REVIEWED
    if document_type in {"ms", "both"}:
        question.ms_review_status = Question.ReviewStatus.REVIEWED
    update_fields = ["qp_review_status", "ms_review_status", "updated_at"]
    _refresh_review_reason(question, update_fields)
    question.save(update_fields=update_fields)
    return JsonResponse(_question_payload(question))


def set_review_status(request, question_id: int):
    document_type = request.GET.get("document_type", "both")
    status = request.GET.get("status", "")
    allowed_statuses = {choice.value for choice in Question.ReviewStatus}

    if document_type not in {"qp", "ms", "both"}:
        return JsonResponse({"error": "document_type must be qp, ms, or both."}, status=400)
    if status not in allowed_statuses:
        return JsonResponse({"error": "status must be not_required, needs_review, or reviewed."}, status=400)

    try:
        question = Question.objects.get(id=question_id)
    except Question.DoesNotExist:
        return JsonResponse({"error": "Question not found."}, status=404)
    update_fields = ["updated_at"]
    if document_type in {"qp", "both"}:
        question.qp_review_status = status
        update_fields.append("qp_review_status")
    if document_type in {"ms", "both"}:
        question.ms_review_status = status
        update_fields.append("ms_review_status")

    _refresh_review_reason(question, update_fields)
    question.save(update_fields=update_fields)
    return JsonResponse(_question_payload(question))


@csrf_exempt
def update_metadata(request, question_id: int):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    try:
        question = Question.objects.prefetch_related("topics").get(id=question_id)
    except Question.DoesNotExist:
        return JsonResponse({"error": "Question not found."}, status=404)

    update_fields = ["updated_at"]

    if "marks" in payload:
        raw_marks = payload.get("marks")
        if raw_marks in {"", None}:
            question.marks = None
        else:
            try:
                marks = int(raw_marks)
            except (TypeError, ValueError):
                return JsonResponse({"error": "marks must be a whole number."}, status=400)
            if marks < 0:
                return JsonResponse({"error": "marks cannot be negative."}, status=400)
            question.marks = marks
        update_fields.append("marks")

    allowed_statuses = {choice.value for choice in Question.ReviewStatus}
    for field_name, attribute in (("qp_review_status", "qp_review_status"), ("ms_review_status", "ms_review_status")):
        if field_name in payload:
            status = payload.get(field_name)
            if status not in allowed_statuses:
                return JsonResponse({"error": f"{field_name} must be not_required, needs_review, or reviewed."}, status=400)
            setattr(question, attribute, status)
            update_fields.append(attribute)

    if "review_reason" in payload:
        question.review_reason = str(payload.get("review_reason") or "").strip()
        update_fields.append("review_reason")

    _refresh_review_reason(question, update_fields)
    question.save(update_fields=list(dict.fromkeys(update_fields)))

    if "topics" in payload:
        topic_names = payload.get("topics") or []
        if not isinstance(topic_names, list) or not all(isinstance(topic, str) for topic in topic_names):
            return JsonResponse({"error": "topics must be a list of topic names."}, status=400)

        topics = list(Topic.objects.filter(subject_code=question.subject_code, name__in=topic_names))
        found_names = {topic.name for topic in topics}
        missing_names = [topic_name for topic_name in topic_names if topic_name not in found_names]
        if missing_names:
            return JsonResponse({"error": f"Unknown topic(s): {missing_names}. Use topics already present in the library."}, status=400)
        question.topics.set(topics)

    question.refresh_from_db()
    return JsonResponse(_question_payload(question))


@csrf_exempt
def delete_questions(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)

    try:
        payload = json.loads(request.body or "{}")
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    question_ids = payload.get("question_ids") or []
    if not isinstance(question_ids, list) or not question_ids:
        return JsonResponse({"error": "question_ids must be a non-empty list."}, status=400)

    try:
        normalized_ids = sorted({int(question_id) for question_id in question_ids})
    except (TypeError, ValueError):
        return JsonResponse({"error": "question_ids must contain only numeric IDs."}, status=400)

    queryset = Question.objects.filter(id__in=normalized_ids)
    found_ids = set(queryset.values_list("id", flat=True))
    missing_ids = [question_id for question_id in normalized_ids if question_id not in found_ids]
    delete_ms_files = bool(payload.get("delete_ms_files"))
    qp_paths = list(queryset.values_list("split_qp_path", flat=True))
    ms_paths = list(queryset.values_list("split_ms_path", flat=True)) if delete_ms_files else []
    deleted_count = queryset.count()
    queryset.delete()

    deleted_qp_files = 0
    deleted_ms_files = 0
    failed_qp_files = []
    failed_ms_files = []
    for path in sorted({path for path in qp_paths if path}):
        try:
            if os.path.exists(path):
                os.remove(path)
                deleted_qp_files += 1
        except OSError as error:
            failed_qp_files.append({"path": path, "error": str(error)})

    if delete_ms_files:
        for path in sorted({path for path in ms_paths if path}):
            try:
                if os.path.exists(path):
                    os.remove(path)
                    deleted_ms_files += 1
            except OSError as error:
                failed_ms_files.append({"path": path, "error": str(error)})

    return JsonResponse(
        {
            "ok": True,
            "deleted_count": deleted_count,
            "missing_ids": missing_ids,
            "deleted_qp_files": deleted_qp_files,
            "deleted_ms_files": deleted_ms_files,
            "failed_qp_files": failed_qp_files,
            "failed_ms_files": failed_ms_files,
        }
    )


@xframe_options_exempt
def question_file(request, question_id: int, document_type: str):
    if document_type not in {"qp", "ms"}:
        return JsonResponse({"error": "document_type must be qp or ms."}, status=400)
    try:
        question = Question.objects.get(id=question_id)
    except Question.DoesNotExist:
        return JsonResponse({"error": "Question not found."}, status=404)
    path = question.split_ms_path if document_type == "ms" else question.split_qp_path
    if not path or not os.path.exists(path):
        return JsonResponse({"error": f"File not found: {path}"}, status=404)
    content_type = mimetypes.guess_type(path)[0] or "application/pdf"
    return FileResponse(open(path, "rb"), content_type=content_type)


def open_question_file(request, question_id: int):
    document_type = request.GET.get("document_type", "qp")
    if document_type not in {"qp", "ms"}:
        return JsonResponse({"ok": False, "error": "document_type must be qp or ms."}, status=400)
    try:
        question = Question.objects.get(id=question_id)
    except Question.DoesNotExist:
        return JsonResponse({"ok": False, "error": "Question not found."}, status=404)
    path = question.split_ms_path if document_type == "ms" else question.split_qp_path
    if not path or not os.path.exists(path):
        return JsonResponse({"ok": False, "error": f"File not found: {path}"}, status=404)
    os.startfile(path)
    return JsonResponse({"ok": True, "path": path})


def open_question_folder(request, question_id: int):
    document_type = request.GET.get("document_type", "qp")
    if document_type not in {"qp", "ms"}:
        return JsonResponse({"ok": False, "error": "document_type must be qp or ms."}, status=400)
    try:
        question = Question.objects.get(id=question_id)
    except Question.DoesNotExist:
        return JsonResponse({"ok": False, "error": "Question not found."}, status=404)
    path = question.split_ms_path if document_type == "ms" else question.split_qp_path
    folder = os.path.dirname(path)
    if not folder or not os.path.isdir(folder):
        return JsonResponse({"ok": False, "error": f"Folder not found: {folder}"}, status=404)
    os.startfile(folder)
    return JsonResponse({"ok": True, "path": folder})


urlpatterns = [
    path("", index),
    path("questions/", questions),
    path("questions/<int:question_id>/mark-reviewed/", mark_reviewed),
    path("questions/<int:question_id>/review-status/", set_review_status),
    path("questions/<int:question_id>/metadata/", update_metadata),
    path("questions/delete/", delete_questions),
    path("questions/<int:question_id>/file/<str:document_type>/", question_file),
    path("questions/<int:question_id>/open-file/", open_question_file),
    path("questions/<int:question_id>/open-folder/", open_question_folder),
    path("filters/", filters),
]
