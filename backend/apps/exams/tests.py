import shutil
from contextlib import contextmanager
from uuid import uuid4

from django.conf import settings
from django.test import TestCase
from pypdf import PdfReader, PdfWriter

from apps.exams.models import GeneratedExam
from apps.catalog.models import Question, Topic
from apps.exams.services import combine_question_pdfs, generate_by_question_numbers, generate_by_topic_rows, generate_full_paper, generate_manual_selection, ordered_exam_questions, parse_question_numbers
from apps.libraries.models import Library


class ExamGenerationServiceTests(TestCase):
    @contextmanager
    def temp_workspace(self):
        base = settings.BASE_DIR / ".test_tmp"
        base.mkdir(exist_ok=True)
        path = base / f"exam_{uuid4().hex}"
        path.mkdir()
        try:
            yield path
        finally:
            shutil.rmtree(path, ignore_errors=True)

    def setUp(self):
        self.library = Library.objects.create(
            name="Test Library",
            root_path="C:/TeacherDesk/test_library",
            generated_exams_path="C:/TeacherDesk/test_library/generated_exams",
            is_active=True,
        )
        self.kinematics = Topic.objects.create(subject_code="9702", topic_number=1, name="Kinematics")
        self.dynamics = Topic.objects.create(subject_code="9702", topic_number=2, name="Dynamics")
        self.waves = Topic.objects.create(subject_code="9702", topic_number=3, name="Waves")

    def make_question(self, exam_code: str, question_number: int, marks: int, *topics: Topic) -> Question:
        question = Question.objects.create(
            library=self.library,
            exam_code=exam_code,
            subject_code="9702",
            session="s26",
            component="22",
            paper_number=2,
            question_number=question_number,
            marks=marks,
            source_qp_path=f"C:/source/{exam_code}.pdf",
            source_ms_path=f"C:/source/{exam_code}_ms.pdf",
            split_qp_path=f"C:/split/{exam_code}_Q{question_number}.pdf",
            split_ms_path=f"C:/split/{exam_code}_Q{question_number}_MS.pdf",
            qp_start_page_raw="1",
            ms_start_page_raw="1",
            qp_page_start=1,
            qp_page_end=2,
            ms_page_start=3,
            ms_page_end=3,
        )
        question.topics.set(topics)
        return question

    def create_pdf(self, path: str) -> None:
        writer = PdfWriter()
        writer.add_blank_page(width=595, height=842)
        with open(path, "wb") as file:
            writer.write(file)

    def test_parse_question_numbers_accepts_ranges_and_sorts(self):
        self.assertEqual(parse_question_numbers("2, 4-6, 1"), [1, 2, 4, 5, 6])
        self.assertEqual(parse_question_numbers("6-4"), [4, 5, 6])

    def test_parse_question_numbers_rejects_unclear_text(self):
        with self.assertRaisesMessage(ValueError, "Could not understand"):
            parse_question_numbers("2, Q4")

    def test_full_paper_keeps_each_question_number_once(self):
        for question_number in range(1, 5):
            self.make_question(f"9702_s26_qp_2{question_number}", question_number, 10, self.kinematics)
            self.make_question(f"9702_w26_qp_2{question_number}", question_number, 11, self.dynamics)

        result = generate_full_paper(2, target_marks=45, tolerance=4)
        selected_numbers = [question.question_number for question in result.selected]

        self.assertEqual(len(selected_numbers), len(set(selected_numbers)))
        self.assertEqual(selected_numbers, sorted(selected_numbers))

    def test_question_number_generation_picks_requested_numbers(self):
        self.make_question("9702_s26_qp_21", 1, 8, self.kinematics)
        self.make_question("9702_s26_qp_22", 2, 9, self.dynamics)

        result = generate_by_question_numbers(2, [2])

        self.assertEqual([question.question_number for question in result.selected], [2])
        self.assertEqual(result.warnings, [])

    def test_topic_generation_does_not_duplicate_selected_questions(self):
        first = self.make_question("9702_s26_qp_21", 1, 8, self.kinematics, self.waves)
        second = self.make_question("9702_w26_qp_22", 2, 9, self.kinematics)
        self.make_question("9702_m26_qp_23", 3, 10, self.dynamics)

        result = generate_by_topic_rows(
            2,
            [
                {
                    "required_topics": ["Kinematics"],
                    "allowed_topics": ["Kinematics", "Waves"],
                    "count": 2,
                }
            ],
        )

        self.assertEqual({question.id for question in result.selected}, {first.id, second.id})
        self.assertEqual(len(result.selected), 2)

    def test_manual_generation_preserves_user_order(self):
        first = self.make_question("9702_s26_qp_21", 1, 8, self.kinematics)
        second = self.make_question("9702_s26_qp_22", 2, 9, self.dynamics)

        result = generate_manual_selection([second.id, first.id, second.id])

        self.assertEqual([question.id for question in result.selected], [second.id, first.id])

    def test_generated_pdf_uses_saved_question_order(self):
        with self.temp_workspace() as workspace:
            output_root = workspace / "generated"
            first = self.make_question("9702_s26_qp_21", 1, 8, self.kinematics)
            second = self.make_question("9702_s26_qp_22", 2, 9, self.dynamics)
            first.split_qp_path = str(workspace / "first_qp.pdf")
            first.split_ms_path = str(workspace / "first_ms.pdf")
            first.save(update_fields=["split_qp_path", "split_ms_path"])
            second.split_qp_path = str(workspace / "second_qp.pdf")
            second.split_ms_path = str(workspace / "second_ms.pdf")
            second.save(update_fields=["split_qp_path", "split_ms_path"])
            self.create_pdf(first.split_qp_path)
            self.create_pdf(first.split_ms_path)
            self.create_pdf(second.split_qp_path)
            self.create_pdf(second.split_ms_path)
            exam = GeneratedExam.objects.create(
                library=self.library,
                title="Order Smoke",
                mode=GeneratedExam.Mode.MANUAL,
                total_marks=17,
                settings_snapshot={"question_order": [second.id, first.id]},
            )
            exam.questions.set([first, second])

            outputs = combine_question_pdfs(exam, str(output_root), include_markscheme=True)

            self.assertEqual([question.id for question in ordered_exam_questions(exam)], [second.id, first.id])
            self.assertEqual(len(PdfReader(outputs["exam_pdf_path"]).pages), 2)
            self.assertEqual(len(PdfReader(outputs["markscheme_pdf_path"]).pages), 2)
