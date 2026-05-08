from django.db import models

from apps.catalog.models import Question
from apps.libraries.models import Library


class GeneratedExam(models.Model):
    class Mode(models.TextChoices):
        FULL_PAPER = "full_paper", "Full paper"
        TOPIC = "topic", "Topic based"
        QUESTION_NUMBER = "question_number", "Question number based"
        MANUAL = "manual", "Manual selection"

    library = models.ForeignKey(Library, on_delete=models.CASCADE, related_name="generated_exams")
    title = models.CharField(max_length=180)
    mode = models.CharField(max_length=30, choices=Mode.choices)
    total_marks = models.PositiveIntegerField(default=0)
    questions = models.ManyToManyField(Question, blank=True)
    settings_snapshot = models.JSONField(default=dict, blank=True)
    exam_pdf_path = models.CharField(max_length=500, blank=True)
    markscheme_pdf_path = models.CharField(max_length=500, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.title
