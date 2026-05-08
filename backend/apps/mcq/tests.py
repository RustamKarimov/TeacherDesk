import json

from django.test import Client, TestCase

from apps.libraries.models import Library

from .models import MCQOption, MCQQuestion, MCQQuestionBlock, MCQTag, MCQTopic


class MCQApiTests(TestCase):
    def setUp(self):
        self.library = Library.objects.create(name="Test Library", root_path="C:/TeacherDesk/test", is_active=True)
        self.client = Client(SERVER_NAME="127.0.0.1")

    def test_dashboard_loads_for_empty_bank(self):
        response = self.client.get("/api/mcq/dashboard/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["summary"]["questions"], 0)

    def test_create_text_question_with_options(self):
        response = self.client.post(
            "/api/mcq/questions/create/",
            data=json.dumps(
                {
                    "title": "Kinetic energy check",
                    "question_text": "A particle has speed $v$. What is its kinetic energy?",
                    "marks": 1,
                    "correct_option": "B",
                    "option_texts": {
                        "A": "$mv$",
                        "B": "$\\frac{1}{2}mv^2$",
                        "C": "$ma$",
                        "D": "$mgh$",
                    },
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        question = MCQQuestion.objects.get(title="Kinetic energy check")
        self.assertEqual(question.marks, 1)
        self.assertEqual(question.blocks.filter(block_type=MCQQuestionBlock.BlockType.TEXT).count(), 1)
        self.assertEqual(question.options.count(), 4)
        self.assertEqual(MCQOption.objects.get(question=question, label="B").is_correct, True)

    def test_question_list_reports_equation_content(self):
        question = MCQQuestion.objects.create(library=self.library, title="Equation question")
        MCQQuestionBlock.objects.create(question=question, block_type=MCQQuestionBlock.BlockType.TEXT, text="Use $F = ma$.", order=1)

        response = self.client.get("/api/mcq/questions/")

        self.assertEqual(response.status_code, 200)
        first = response.json()["results"][0]
        self.assertEqual(first["title"], "Equation question")
        self.assertEqual(first["has_equations"], True)

    def test_create_question_saves_metadata_and_layout(self):
        topic = MCQTopic.objects.create(library=self.library, name="Kinematics")
        tag = MCQTag.objects.create(library=self.library, name="calculation")

        response = self.client.post(
            "/api/mcq/questions/create/",
            data=json.dumps(
                {
                    "title": "Projectile check",
                    "question_text": "A projectile moves horizontally.",
                    "marks": 2,
                    "correct_option": "C",
                    "option_labels": ["A", "B", "C", "D", "E"],
                    "option_texts": {"C": "$s = ut + \\frac{1}{2}at^2$"},
                    "review_status": "ready",
                    "layout_preset": "text_image_side",
                    "option_layout": "two_column",
                    "topic_ids": [topic.id],
                    "tag_ids": [tag.id],
                    "difficulty": "Medium",
                    "year": 2023,
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        question = MCQQuestion.objects.get(title="Projectile check")
        self.assertEqual(question.options.count(), 5)
        self.assertEqual(question.review_status, "ready")
        self.assertEqual(question.option_layout, "two_column")
        self.assertEqual(list(question.topics.values_list("name", flat=True)), ["Kinematics"])
        self.assertEqual(list(question.tags.values_list("name", flat=True)), ["calculation"])
