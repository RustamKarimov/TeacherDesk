from django.db import models

from apps.libraries.models import Library


class Topic(models.Model):
    subject_code = models.CharField(max_length=20)
    topic_number = models.PositiveIntegerField(null=True, blank=True)
    name = models.CharField(max_length=160)
    source = models.CharField(max_length=80, default="manifest")

    class Meta:
        unique_together = ("subject_code", "topic_number", "name")
        ordering = ("subject_code", "topic_number", "name")

    def __str__(self) -> str:
        return f"{self.subject_code} - {self.name}"


class Question(models.Model):
    class ReviewStatus(models.TextChoices):
        NOT_REQUIRED = "not_required", "Not required"
        NEEDS_REVIEW = "needs_review", "Needs review"
        REVIEWED = "reviewed", "Reviewed"

    library = models.ForeignKey(Library, on_delete=models.CASCADE, related_name="questions")
    exam_code = models.CharField(max_length=120)
    subject_code = models.CharField(max_length=20)
    session = models.CharField(max_length=20)
    component = models.CharField(max_length=20)
    paper_number = models.PositiveIntegerField()
    question_number = models.PositiveIntegerField()
    marks = models.PositiveIntegerField(null=True, blank=True)
    topics = models.ManyToManyField(Topic, blank=True)

    source_qp_path = models.CharField(max_length=500)
    source_ms_path = models.CharField(max_length=500, blank=True)
    split_qp_path = models.CharField(max_length=500, blank=True)
    split_ms_path = models.CharField(max_length=500, blank=True)

    qp_start_page_raw = models.CharField(max_length=20)
    ms_start_page_raw = models.CharField(max_length=20, blank=True)
    qp_page_start = models.PositiveIntegerField(null=True, blank=True)
    qp_page_end = models.PositiveIntegerField(null=True, blank=True)
    ms_page_start = models.PositiveIntegerField(null=True, blank=True)
    ms_page_end = models.PositiveIntegerField(null=True, blank=True)
    qp_review_status = models.CharField(max_length=20, choices=ReviewStatus.choices, default=ReviewStatus.NOT_REQUIRED)
    ms_review_status = models.CharField(max_length=20, choices=ReviewStatus.choices, default=ReviewStatus.NOT_REQUIRED)
    review_reason = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ("library", "exam_code", "question_number")
        ordering = ("paper_number", "question_number", "session", "component")

    def __str__(self) -> str:
        return f"{self.exam_code} Q{self.question_number}"
