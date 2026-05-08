import json
import shutil
from uuid import uuid4
from pathlib import Path

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase

from apps.libraries.models import Library

from .models import MCQImageAsset, MCQOption, MCQOptionBlock, MCQQuestion, MCQQuestionBlock, MCQTag, MCQTopic


class MCQApiTests(TestCase):
    def setUp(self):
        self.test_root = Path(settings.BASE_DIR) / ".test_tmp" / f"mcq_api_{uuid4().hex}"
        self.test_root.mkdir(parents=True, exist_ok=True)
        self.library = Library.objects.create(name="Test Library", root_path=str(self.test_root), is_active=True)
        self.client = Client(SERVER_NAME="127.0.0.1")

    def tearDown(self):
        shutil.rmtree(self.test_root, ignore_errors=True)

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

    def test_question_text_blank_lines_create_separate_paragraph_blocks(self):
        response = self.client.post(
            "/api/mcq/questions/create/",
            data=json.dumps(
                {
                    "title": "Two paragraph question",
                    "question_text": "First paragraph.\n\nSecond paragraph.",
                    "marks": 1,
                    "correct_option": "A",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        question = MCQQuestion.objects.get(title="Two paragraph question")
        self.assertEqual(list(question.blocks.values_list("text", flat=True)), ["First paragraph.", "Second paragraph."])

    def test_create_question_saves_ordered_content_blocks(self):
        response = self.client.post(
            "/api/mcq/questions/create/",
            data=json.dumps(
                {
                    "title": "Block question",
                    "question_blocks": [
                        {"block_type": "text", "text": "A particle moves in a circle."},
                        {"block_type": "equation", "text": "F = \\frac{mv^2}{r}"},
                        {"block_type": "table", "table_data": {"rows": [["quantity", "unit"], ["force", "N"]]}},
                    ],
                    "marks": 1,
                    "correct_option": "A",
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        question = MCQQuestion.objects.get(title="Block question")
        self.assertEqual(list(question.blocks.values_list("block_type", flat=True)), ["text", "equation", "table"])
        self.assertEqual(question.blocks.get(block_type="table").table_data["rows"][1], ["force", "N"])

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

    def test_update_duplicate_and_delete_question(self):
        question = MCQQuestion.objects.create(library=self.library, title="Original")
        MCQQuestionBlock.objects.create(question=question, block_type=MCQQuestionBlock.BlockType.TEXT, text="Original text", order=1)
        option = MCQOption.objects.create(question=question, label="A", is_correct=True, order=1)
        MCQOption.objects.create(question=question, label="B", is_correct=False, order=2)
        MCQOptionBlock.objects.create(option=option, block_type=MCQOptionBlock.BlockType.TEXT, text="Original option", order=1)

        update = self.client.post(
            f"/api/mcq/questions/{question.id}/update/",
            data=json.dumps(
                {
                    "title": "Updated",
                    "question_text": "Updated text",
                    "correct_option": "B",
                    "option_labels": ["A", "B"],
                    "option_texts": {"A": "First", "B": "Second"},
                    "marks": 3,
                }
            ),
            content_type="application/json",
        )
        self.assertEqual(update.status_code, 200)
        question.refresh_from_db()
        self.assertEqual(question.title, "Updated")
        self.assertEqual(question.marks, 3)
        self.assertEqual(question.options.get(label="B").is_correct, True)

        duplicate = self.client.post(f"/api/mcq/questions/{question.id}/duplicate/")
        self.assertEqual(duplicate.status_code, 201)
        duplicate_id = duplicate.json()["id"]
        self.assertTrue(MCQQuestion.objects.filter(id=duplicate_id, title__icontains="copy").exists())

        delete = self.client.post(f"/api/mcq/questions/{duplicate_id}/delete/")
        self.assertEqual(delete.status_code, 200)
        self.assertFalse(MCQQuestion.objects.filter(id=duplicate_id).exists())

    def test_upload_asset_and_create_image_only_question(self):
        upload = self.client.post(
            "/api/mcq/assets/upload/",
            data={
                "asset_type": "question",
                "file": SimpleUploadedFile("circuit.png", b"\x89PNG\r\n\x1a\nfake-image", content_type="image/png"),
            },
        )

        self.assertEqual(upload.status_code, 201)
        asset_payload = upload.json()
        asset = MCQImageAsset.objects.get(id=asset_payload["id"])
        self.assertTrue(Path(asset.file_path).exists())
        self.assertEqual(asset.original_name, "circuit.png")

        response = self.client.post(
            "/api/mcq/questions/create/",
            data=json.dumps(
                {
                    "title": "Image-only circuit question",
                    "question_asset_id": asset.id,
                    "marks": 1,
                    "correct_option": "A",
                    "option_texts": {"A": "Current increases", "B": "Current decreases"},
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        question = MCQQuestion.objects.get(title="Image-only circuit question")
        self.assertEqual(question.blocks.filter(block_type=MCQQuestionBlock.BlockType.IMAGE, asset=asset).count(), 1)
        list_response = self.client.get("/api/mcq/questions/?content_type=image")
        self.assertEqual(list_response.status_code, 200)
        self.assertEqual(list_response.json()["results"][0]["has_images"], True)

    def test_create_question_requires_text_or_image(self):
        response = self.client.post(
            "/api/mcq/questions/create/",
            data=json.dumps({"title": "Empty question", "marks": 1, "correct_option": "A"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("question text or attach a question image", response.json()["error"])

    def test_create_question_with_option_image(self):
        asset_path = self.test_root / "option_graph.png"
        asset_path.write_bytes(b"\x89PNG\r\n\x1a\nfake-option-image")
        asset = MCQImageAsset.objects.create(
            library=self.library,
            asset_type=MCQImageAsset.AssetType.OPTION,
            original_name="option_graph.png",
            file_path=str(asset_path),
            file_size=asset_path.stat().st_size,
        )

        response = self.client.post(
            "/api/mcq/questions/create/",
            data=json.dumps(
                {
                    "title": "Graph option question",
                    "question_text": "Which graph represents uniform acceleration?",
                    "marks": 1,
                    "correct_option": "A",
                    "option_asset_ids": {"A": asset.id},
                }
            ),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 201)
        question = MCQQuestion.objects.get(title="Graph option question")
        option = question.options.get(label="A")
        self.assertEqual(option.blocks.filter(block_type=MCQOptionBlock.BlockType.IMAGE, asset=asset).count(), 1)
        self.assertEqual(response.json()["options"][0]["blocks"][0]["asset"]["original_name"], "option_graph.png")
