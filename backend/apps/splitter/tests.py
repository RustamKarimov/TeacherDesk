from pathlib import Path
import shutil
from contextlib import contextmanager
from uuid import uuid4

from django.conf import settings
from django.test import TestCase
from openpyxl import Workbook
from pypdf import PdfReader, PdfWriter

from apps.catalog.models import Question
from apps.splitter.services import build_split_plan, import_and_split_manifest, validate_manifest


class SplitterPdfServiceTests(TestCase):
    @contextmanager
    def temp_workspace(self):
        base = settings.BASE_DIR / ".test_tmp"
        base.mkdir(exist_ok=True)
        path = base / f"splitter_{uuid4().hex}"
        path.mkdir()
        try:
            yield str(path)
        finally:
            shutil.rmtree(path, ignore_errors=True)

    def create_pdf(self, path: Path, pages: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        writer = PdfWriter()
        for _index in range(pages):
            writer.add_blank_page(width=595, height=842)
        with path.open("wb") as file:
            writer.write(file)

    def create_manifest(self, path: Path, rows: list[dict[str, object]]) -> None:
        workbook = Workbook()
        sheet = workbook.active
        sheet.append(
            [
                "exam_code",
                "question_number",
                "qp_start_page",
                "ms_start_page",
                "Mark",
                "T1",
                "T2",
                "T3",
                "topic_1",
                "topic_2",
                "topic_3",
            ]
        )
        for row in rows:
            sheet.append(
                [
                    row["exam_code"],
                    row["question_number"],
                    row["qp_start_page"],
                    row["ms_start_page"],
                    row.get("Mark", 5),
                    row.get("T1", 1),
                    None,
                    None,
                    row.get("topic_1", "Kinematics"),
                    None,
                    None,
                ]
            )
        topic_sheet = workbook.create_sheet("Topics")
        topic_sheet.append(["number", "name"])
        topic_sheet.append([1, "Kinematics"])
        workbook.save(path)

    def create_source_pair(self, source_root: Path, exam_code: str, pages: int = 6) -> None:
        self.create_pdf(source_root / f"{exam_code}.pdf", pages)
        self.create_pdf(source_root / f"{exam_code.replace('_qp_', '_ms_')}.pdf", pages)

    def test_starred_boundary_marks_current_and_next_question_for_review(self):
        with self.temp_workspace() as temp_dir:
            root = Path(temp_dir)
            source_root = root / "source"
            manifest_path = root / "manifest.xlsx"
            exam_code = "9702_s26_qp_22"
            self.create_source_pair(source_root, exam_code)
            self.create_manifest(
                manifest_path,
                [
                    {"exam_code": exam_code, "question_number": 2, "qp_start_page": "1", "ms_start_page": "1"},
                    {"exam_code": exam_code, "question_number": 3, "qp_start_page": "3*", "ms_start_page": "3"},
                    {"exam_code": exam_code, "question_number": 4, "qp_start_page": "5", "ms_start_page": "5"},
                ],
            )

            report = validate_manifest(str(manifest_path), str(source_root))

            self.assertTrue(report["ok"])
            self.assertEqual(report["summary"]["starred_boundaries"], 1)
            self.assertEqual(report["summary"]["review_required_items"], 2)

    def test_import_splits_expected_page_ranges_and_review_notes(self):
        with self.temp_workspace() as temp_dir:
            root = Path(temp_dir)
            source_root = root / "source"
            output_root = root / "library"
            manifest_path = root / "manifest.xlsx"
            exam_code = "9702_s26_qp_22"
            self.create_source_pair(source_root, exam_code, pages=6)
            self.create_manifest(
                manifest_path,
                [
                    {"exam_code": exam_code, "question_number": 2, "qp_start_page": "1", "ms_start_page": "1"},
                    {"exam_code": exam_code, "question_number": 3, "qp_start_page": "3*", "ms_start_page": "3"},
                    {"exam_code": exam_code, "question_number": 4, "qp_start_page": "5", "ms_start_page": "5"},
                ],
            )

            result = import_and_split_manifest(str(manifest_path), str(source_root), output_root=str(output_root))

            self.assertTrue(result["ok"])
            q2 = Question.objects.get(exam_code=exam_code, question_number=2)
            q3 = Question.objects.get(exam_code=exam_code, question_number=3)
            q4 = Question.objects.get(exam_code=exam_code, question_number=4)
            self.assertEqual((q2.qp_page_start, q2.qp_page_end), (1, 2))
            self.assertEqual((q3.qp_page_start, q3.qp_page_end), (3, 5))
            self.assertEqual((q4.qp_page_start, q4.qp_page_end), (5, 6))
            self.assertEqual(q2.qp_review_status, Question.ReviewStatus.NOT_REQUIRED)
            self.assertEqual(q3.qp_review_status, Question.ReviewStatus.NEEDS_REVIEW)
            self.assertEqual(q4.qp_review_status, Question.ReviewStatus.NEEDS_REVIEW)
            self.assertIn("beginning of Q4", q3.review_reason)
            self.assertIn("end of Q3", q4.review_reason)
            self.assertEqual(len(PdfReader(q3.split_qp_path).pages), 3)
            self.assertEqual(len(PdfReader(q4.split_qp_path).pages), 2)

    def test_split_plan_respects_skip_and_overwrite_for_existing_files(self):
        with self.temp_workspace() as temp_dir:
            root = Path(temp_dir)
            source_root = root / "source"
            output_root = root / "library"
            manifest_path = root / "manifest.xlsx"
            exam_code = "9702_s26_qp_22"
            self.create_source_pair(source_root, exam_code, pages=4)
            self.create_manifest(
                manifest_path,
                [
                    {"exam_code": exam_code, "question_number": 1, "qp_start_page": "1", "ms_start_page": "1"},
                    {"exam_code": exam_code, "question_number": 2, "qp_start_page": "3", "ms_start_page": "3"},
                ],
            )
            import_and_split_manifest(str(manifest_path), str(source_root), output_root=str(output_root))

            skip_plan = build_split_plan(str(manifest_path), str(source_root), output_root=str(output_root), existing_pdf_strategy="skip")
            overwrite_plan = build_split_plan(str(manifest_path), str(source_root), output_root=str(output_root), existing_pdf_strategy="overwrite")

            self.assertEqual(skip_plan["summary"]["files_to_skip_existing"], 4)
            self.assertEqual(skip_plan["summary"]["files_to_overwrite"], 0)
            self.assertEqual(overwrite_plan["summary"]["files_to_skip_existing"], 0)
            self.assertEqual(overwrite_plan["summary"]["files_to_overwrite"], 4)

    def test_validation_reports_exact_row_for_backwards_page_ranges(self):
        with self.temp_workspace() as temp_dir:
            root = Path(temp_dir)
            source_root = root / "source"
            manifest_path = root / "manifest.xlsx"
            exam_code = "9702_s26_qp_22"
            self.create_source_pair(source_root, exam_code, pages=5)
            self.create_manifest(
                manifest_path,
                [
                    {"exam_code": exam_code, "question_number": 1, "qp_start_page": "3", "ms_start_page": "1"},
                    {"exam_code": exam_code, "question_number": 2, "qp_start_page": "2", "ms_start_page": "3"},
                ],
            )

            report = validate_manifest(str(manifest_path), str(source_root))

            self.assertFalse(report["ok"])
            messages = [issue["message"] for issue in report["issues"]]
            self.assertTrue(any("page starts go backwards" in message and "Q2" in message for message in messages))
