import json
import os

from django.http import JsonResponse
from django.urls import path
from django.views.decorators.csrf import csrf_exempt

from apps.catalog.models import Question
from apps.libraries.models import Library

from .models import GeneratedExam
from .services import (
    _row_matches_allowed_topics,
    base_queryset,
    combine_question_pdfs,
    generate_by_question_numbers,
    generate_by_topic_rows,
    generate_full_paper,
    generate_manual_selection,
    ordered_exam_questions,
    parse_question_numbers,
    question_payload,
    result_payload,
)

MODE_ALIASES = {
    "question_numbers": GeneratedExam.Mode.QUESTION_NUMBER,
    "topics": GeneratedExam.Mode.TOPIC,
}


def exam_payload(exam: GeneratedExam) -> dict[str, object]:
    return {
        "id": exam.id,
        "title": exam.title,
        "mode": exam.mode,
        "total_marks": exam.total_marks,
        "question_count": exam.questions.count(),
        "exam_pdf_path": exam.exam_pdf_path,
        "markscheme_pdf_path": exam.markscheme_pdf_path,
        "created_at": exam.created_at.isoformat(),
    }


def index(request):
    return JsonResponse({"module": "exams", "status": "ready"})


@csrf_exempt
def generate(request):
    try:
        payload = json.loads(request.body or "{}")
        mode = payload.get("mode")
        try:
            paper_number = int(payload.get("paper_number") or 0)
        except (TypeError, ValueError):
            return JsonResponse({"error": "paper_number must be a whole number."}, status=400)
        if mode != "manual" and not paper_number:
            return JsonResponse({"error": "paper_number is required."}, status=400)

        if mode == "manual":
            result = generate_manual_selection(payload.get("question_ids") or [])
        elif mode == "full_paper":
            target_marks = payload.get("target_marks")
            try:
                tolerance = int(payload.get("tolerance") or 4)
                parsed_target_marks = int(target_marks) if target_marks else None
            except (TypeError, ValueError):
                return JsonResponse({"error": "target_marks and tolerance must be whole numbers."}, status=400)
            result = generate_full_paper(paper_number, parsed_target_marks, tolerance)
        elif mode == "question_numbers":
            question_numbers = parse_question_numbers(payload.get("question_numbers", ""))
            result = generate_by_question_numbers(paper_number, question_numbers)
        elif mode == "topics":
            result = generate_by_topic_rows(paper_number, payload.get("topic_rows", []))
        else:
            return JsonResponse({"error": "mode must be full_paper, question_numbers, topics, or manual."}, status=400)
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    return JsonResponse(result_payload(result))


@csrf_exempt
def availability(request):
    try:
        payload = json.loads(request.body or "{}")
        try:
            paper_number = int(payload.get("paper_number") or 0)
        except (TypeError, ValueError):
            return JsonResponse({"error": "paper_number must be a whole number."}, status=400)
        mode = payload.get("mode")
        if not paper_number:
            return JsonResponse({"error": "paper_number is required."}, status=400)

        queryset = base_queryset(paper_number)
        if mode == "question_numbers":
            question_numbers = parse_question_numbers(payload.get("question_numbers", ""))
            return JsonResponse(
                {
                    "question_counts": {
                        str(question_number): queryset.filter(question_number=question_number).count()
                        for question_number in question_numbers
                    }
                }
            )

        if mode == "topics":
            rows = payload.get("topic_rows", [])
            row_counts = []
            for row in rows:
                required_topics = [topic for topic in row.get("required_topics", []) if topic]
                allowed_topics = [topic for topic in row.get("allowed_topics", []) if topic]
                count = sum(1 for question in queryset if _row_matches_allowed_topics(question, required_topics, allowed_topics))
                row_counts.append(count)
            return JsonResponse({"topic_row_counts": row_counts})
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    return JsonResponse({"question_counts": {}, "topic_row_counts": []})


@csrf_exempt
def save_draft(request):
    try:
        payload = json.loads(request.body or "{}")
        title = (payload.get("title") or "").strip()
        mode = MODE_ALIASES.get(payload.get("mode"), payload.get("mode"))
        question_ids = payload.get("question_ids") or []
        settings_snapshot = payload.get("settings_snapshot") or {}
        settings_snapshot["question_order"] = [int(question_id) for question_id in question_ids]

        if not title:
            return JsonResponse({"error": "title is required."}, status=400)
        if mode not in {choice.value for choice in GeneratedExam.Mode}:
            return JsonResponse({"error": "mode is invalid."}, status=400)
        if not question_ids:
            return JsonResponse({"error": "At least one question is required."}, status=400)

        library = Library.objects.filter(is_active=True).first() or Library.objects.first()
        if not library:
            return JsonResponse({"error": "No library exists. Run the splitter/import first."}, status=400)

        questions = list(Question.objects.filter(id__in=question_ids))
        if len(questions) != len(set(question_ids)):
            found_ids = {question.id for question in questions}
            missing = [question_id for question_id in question_ids if question_id not in found_ids]
            return JsonResponse({"error": f"Some questions were not found: {missing}"}, status=400)

        exam = GeneratedExam.objects.create(
            library=library,
            title=title,
            mode=mode,
            total_marks=sum(question.marks or 0 for question in questions),
            settings_snapshot=settings_snapshot,
        )
        exam.questions.set(questions)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    return JsonResponse({"ok": True, "exam": exam_payload(exam)})


def list_drafts(request):
    drafts = GeneratedExam.objects.prefetch_related("questions").order_by("-created_at")[:50]
    return JsonResponse({"count": len(drafts), "results": [exam_payload(exam) for exam in drafts]})


@csrf_exempt
def delete_drafts(request):
    if request.method != "POST":
        return JsonResponse({"error": "POST is required."}, status=405)
    try:
        payload = json.loads(request.body or "{}")
        draft_ids = [int(draft_id) for draft_id in payload.get("draft_ids") or []]
        if not draft_ids:
            return JsonResponse({"error": "Select at least one draft to delete."}, status=400)
        deleted_count, _deleted = GeneratedExam.objects.filter(id__in=draft_ids).delete()
    except (TypeError, ValueError):
        return JsonResponse({"error": "draft_ids must contain numeric draft IDs."}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    return JsonResponse({"ok": True, "deleted": deleted_count})


def draft_detail(request, exam_id: int):
    try:
        exam = GeneratedExam.objects.prefetch_related("questions__topics").get(id=exam_id)
    except GeneratedExam.DoesNotExist:
        return JsonResponse({"error": "Draft exam not found."}, status=404)
    questions = ordered_exam_questions(exam)
    payload = exam_payload(exam)
    payload["questions"] = [question_payload(question) for question in questions]
    payload["settings_snapshot"] = exam.settings_snapshot
    return JsonResponse(payload)


@csrf_exempt
def generate_pdfs(request, exam_id: int):
    try:
        payload = json.loads(request.body or "{}")
        output_root = payload.get("output_root")
        if not output_root:
            return JsonResponse({"error": "output_root is required."}, status=400)
        exam = GeneratedExam.objects.get(id=exam_id)
        include_markscheme = bool(payload.get("include_markscheme", True))
        result = combine_question_pdfs(exam, output_root, payload.get("pdf_mask_settings"), include_markscheme)
    except GeneratedExam.DoesNotExist:
        return JsonResponse({"error": "Draft exam not found."}, status=404)
    except ValueError as error:
        return JsonResponse({"error": str(error)}, status=400)
    except json.JSONDecodeError:
        return JsonResponse({"error": "Request body must be valid JSON."}, status=400)

    return JsonResponse({"ok": True, "exam": exam_payload(exam), "outputs": result})


def open_generated_output(request, exam_id: int):
    target = request.GET.get("target", "folder")
    if target not in {"qp", "ms", "folder"}:
        return JsonResponse({"ok": False, "error": "target must be qp, ms, or folder."}, status=400)
    try:
        exam = GeneratedExam.objects.get(id=exam_id)
    except GeneratedExam.DoesNotExist:
        return JsonResponse({"ok": False, "error": "Draft exam not found."}, status=404)
    if target == "qp":
        path = exam.exam_pdf_path
    elif target == "ms":
        path = exam.markscheme_pdf_path
    else:
        path = os.path.dirname(exam.exam_pdf_path or exam.markscheme_pdf_path)

    if not path or not os.path.exists(path):
        return JsonResponse({"ok": False, "error": f"Path not found: {path}"}, status=404)
    os.startfile(path)
    return JsonResponse({"ok": True, "path": path})


urlpatterns = [
    path("", index),
    path("generate/", generate),
    path("availability/", availability),
    path("drafts/", list_drafts),
    path("drafts/delete/", delete_drafts),
    path("drafts/<int:exam_id>/", draft_detail),
    path("drafts/save/", save_draft),
    path("drafts/<int:exam_id>/generate-pdfs/", generate_pdfs),
    path("drafts/<int:exam_id>/open-output/", open_generated_output),
]
