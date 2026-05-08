from collections import defaultdict
from pathlib import Path

from django.core.management.base import BaseCommand
from pypdf import PdfReader

from apps.catalog.models import Question
from apps.splitter.services import _iter_manifest_records, _range_for_row, build_starred_boundary_reviews


DEFAULT_MANIFEST = r"D:\Programming\School Projects\CambridgeProjects\ExamGenerator\data\past_paper_info.xlsx"
DEFAULT_SOURCE_ROOT = r"D:\Programming\School Projects\CambridgeProjects\ExamGenerator\source_papers\9702"


class Command(BaseCommand):
    help = "Recompute review statuses from starred manifest boundaries and clear false page-range-change review flags."

    def add_arguments(self, parser):
        parser.add_argument("--manifest", default=DEFAULT_MANIFEST)
        parser.add_argument("--source-root", default=DEFAULT_SOURCE_ROOT)

    def handle(self, *args, **options):
        records, _topics = _iter_manifest_records(options["manifest"])
        source_root = Path(options["source_root"])
        grouped = defaultdict(list)
        for record in records:
            grouped[record["exam_code"]].append(record)

        page_ranges = {}
        review_required, review_notes = build_starred_boundary_reviews(grouped)
        for exam_code, exam_rows in grouped.items():
            exam_rows.sort(key=lambda item: int(item["question_number"]))
            qp_total_pages = len(PdfReader(str(source_root / f"{exam_code}.pdf")).pages)
            ms_total_pages = len(PdfReader(str(source_root / f"{exam_rows[0]['ms_exam_code']}.pdf")).pages)

            for index, record in enumerate(exam_rows):
                question_number = int(record["question_number"])
                qp_start, qp_end = _range_for_row(exam_rows, index, "qp_start_page", "qp_starred", qp_total_pages)
                ms_start, ms_end = _range_for_row(exam_rows, index, "ms_start_page", "ms_starred", ms_total_pages)
                page_ranges[(exam_code, question_number)] = (qp_start, qp_end, ms_start, ms_end)

        updated = 0
        qp_needs = 0
        ms_needs = 0
        for question in Question.objects.all():
            qp_status = (
                Question.ReviewStatus.NEEDS_REVIEW
                if (question.exam_code, question.question_number, "QP") in review_required
                else Question.ReviewStatus.NOT_REQUIRED
            )
            ms_status = (
                Question.ReviewStatus.NEEDS_REVIEW
                if (question.exam_code, question.question_number, "MS") in review_required
                else Question.ReviewStatus.NOT_REQUIRED
            )
            if question.qp_review_status == Question.ReviewStatus.REVIEWED and qp_status == Question.ReviewStatus.NEEDS_REVIEW:
                qp_status = Question.ReviewStatus.REVIEWED
            if question.ms_review_status == Question.ReviewStatus.REVIEWED and ms_status == Question.ReviewStatus.NEEDS_REVIEW:
                ms_status = Question.ReviewStatus.REVIEWED

            reasons = []
            if qp_status == Question.ReviewStatus.NEEDS_REVIEW:
                reasons.extend(review_notes.get((question.exam_code, question.question_number, "QP"), []))
                qp_needs += 1
            if ms_status == Question.ReviewStatus.NEEDS_REVIEW:
                reasons.extend(review_notes.get((question.exam_code, question.question_number, "MS"), []))
                ms_needs += 1

            ranges = page_ranges.get((question.exam_code, question.question_number))
            if ranges:
                question.qp_page_start, question.qp_page_end, question.ms_page_start, question.ms_page_end = ranges
            question.qp_review_status = qp_status
            question.ms_review_status = ms_status
            question.review_reason = " ".join(reasons)
            question.save(
                update_fields=[
                    "qp_review_status",
                    "ms_review_status",
                    "review_reason",
                    "qp_page_start",
                    "qp_page_end",
                    "ms_page_start",
                    "ms_page_end",
                    "updated_at",
                ]
            )
            updated += 1

        self.stdout.write(self.style.SUCCESS(f"Updated {updated} questions. QP needs review: {qp_needs}. MS needs review: {ms_needs}."))
