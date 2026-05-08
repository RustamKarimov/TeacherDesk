from django.db import models

from apps.libraries.models import Library


class MCQTopic(models.Model):
    library = models.ForeignKey(Library, on_delete=models.CASCADE, related_name="mcq_topics")
    name = models.CharField(max_length=160)
    description = models.TextField(blank=True)
    color = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("name",)
        unique_together = ("library", "name")

    def __str__(self) -> str:
        return self.name


class MCQSubtopic(models.Model):
    topic = models.ForeignKey(MCQTopic, on_delete=models.CASCADE, related_name="subtopics")
    name = models.CharField(max_length=180)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("topic__name", "name")
        unique_together = ("topic", "name")

    def __str__(self) -> str:
        return f"{self.topic.name} - {self.name}"


class MCQTag(models.Model):
    library = models.ForeignKey(Library, on_delete=models.CASCADE, related_name="mcq_tags")
    name = models.CharField(max_length=80)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("name",)
        unique_together = ("library", "name")

    def __str__(self) -> str:
        return self.name


class MCQImageAsset(models.Model):
    class AssetType(models.TextChoices):
        QUESTION = "question", "Question image"
        OPTION = "option", "Option image"
        TABLE_CELL = "table_cell", "Table cell image"
        OTHER = "other", "Other"

    library = models.ForeignKey(Library, on_delete=models.CASCADE, related_name="mcq_assets")
    asset_type = models.CharField(max_length=30, choices=AssetType.choices, default=AssetType.OTHER)
    original_name = models.CharField(max_length=220)
    file_path = models.CharField(max_length=600)
    width = models.PositiveIntegerField(null=True, blank=True)
    height = models.PositiveIntegerField(null=True, blank=True)
    file_size = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ("-created_at", "original_name")

    def __str__(self) -> str:
        return self.original_name


class MCQQuestion(models.Model):
    class ReviewStatus(models.TextChoices):
        DRAFT = "draft", "Draft"
        READY = "ready", "Ready"
        NEEDS_REVIEW = "needs_review", "Needs review"
        VERIFIED = "verified", "Verified"
        ARCHIVED = "archived", "Archived"

    class LayoutPreset(models.TextChoices):
        STANDARD = "standard", "Standard text with options below"
        IMAGE_ABOVE = "image_above", "Image above options"
        TEXT_IMAGE_SIDE = "text_image_side", "Text and image side by side"
        IMAGE_ONLY = "image_only", "Image-only question"
        OPTION_GRID = "option_grid", "Image option grid"
        TABLE_OPTIONS = "table_options", "Table options"
        COMPACT = "compact", "Compact exam style"

    class OptionLayout(models.TextChoices):
        SINGLE = "single", "Single column"
        TWO_COLUMN = "two_column", "Two columns"
        FOUR_COLUMN = "four_column", "Four columns"
        GRID = "grid", "Image grid"
        TABLE = "table", "Table"

    library = models.ForeignKey(Library, on_delete=models.CASCADE, related_name="mcq_questions")
    title = models.CharField(max_length=220, blank=True)
    subject = models.CharField(max_length=80, default="Physics")
    syllabus = models.CharField(max_length=40, default="9702")
    exam_code = models.CharField(max_length=120, blank=True)
    paper_code = models.CharField(max_length=40, blank=True)
    session = models.CharField(max_length=40, blank=True)
    year = models.PositiveIntegerField(null=True, blank=True)
    variant = models.CharField(max_length=20, blank=True)
    source = models.CharField(max_length=180, blank=True)
    source_question_number = models.CharField(max_length=30, blank=True)
    marks = models.PositiveIntegerField(default=1)
    time_estimate_seconds = models.PositiveIntegerField(null=True, blank=True)
    difficulty = models.CharField(max_length=40, blank=True)
    review_status = models.CharField(max_length=30, choices=ReviewStatus.choices, default=ReviewStatus.DRAFT)
    notes = models.TextField(blank=True)
    teacher_notes = models.TextField(blank=True)
    layout_preset = models.CharField(max_length=40, choices=LayoutPreset.choices, default=LayoutPreset.STANDARD)
    option_layout = models.CharField(max_length=40, choices=OptionLayout.choices, default=OptionLayout.SINGLE)
    layout_settings = models.JSONField(default=dict, blank=True)
    topics = models.ManyToManyField(MCQTopic, blank=True, related_name="questions")
    subtopics = models.ManyToManyField(MCQSubtopic, blank=True, related_name="questions")
    tags = models.ManyToManyField(MCQTag, blank=True, related_name="questions")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "-created_at")

    def __str__(self) -> str:
        return self.title or f"MCQ {self.pk}"


class MCQQuestionBlock(models.Model):
    class BlockType(models.TextChoices):
        TEXT = "text", "Text"
        IMAGE = "image", "Image"
        TABLE = "table", "Table"
        NOTE = "note", "Note"
        MIXED = "mixed", "Mixed"

    question = models.ForeignKey(MCQQuestion, on_delete=models.CASCADE, related_name="blocks")
    block_type = models.CharField(max_length=20, choices=BlockType.choices)
    text = models.TextField(blank=True)
    asset = models.ForeignKey(MCQImageAsset, null=True, blank=True, on_delete=models.SET_NULL, related_name="question_blocks")
    table_data = models.JSONField(default=dict, blank=True)
    order = models.PositiveIntegerField(default=0)
    settings = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("order", "id")


class MCQOption(models.Model):
    question = models.ForeignKey(MCQQuestion, on_delete=models.CASCADE, related_name="options")
    label = models.CharField(max_length=8)
    is_correct = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)
    layout_settings = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("order", "label")
        unique_together = ("question", "label")

    def __str__(self) -> str:
        return f"{self.question_id} {self.label}"


class MCQOptionBlock(models.Model):
    class BlockType(models.TextChoices):
        TEXT = "text", "Text"
        IMAGE = "image", "Image"
        EQUATION = "equation", "Equation"

    option = models.ForeignKey(MCQOption, on_delete=models.CASCADE, related_name="blocks")
    block_type = models.CharField(max_length=20, choices=BlockType.choices)
    text = models.TextField(blank=True)
    asset = models.ForeignKey(MCQImageAsset, null=True, blank=True, on_delete=models.SET_NULL, related_name="option_blocks")
    order = models.PositiveIntegerField(default=0)
    settings = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ("order", "id")


class MCQExam(models.Model):
    class Mode(models.TextChoices):
        FULL_PAPER = "full_paper", "Full paper"
        TOPIC = "topic", "Topic based"
        MANUAL = "manual", "Manual selection"

    library = models.ForeignKey(Library, on_delete=models.CASCADE, related_name="mcq_exams")
    title = models.CharField(max_length=220)
    mode = models.CharField(max_length=30, choices=Mode.choices)
    total_marks = models.PositiveIntegerField(default=0)
    settings_snapshot = models.JSONField(default=dict, blank=True)
    student_pdf_path = models.CharField(max_length=600, blank=True)
    teacher_pdf_path = models.CharField(max_length=600, blank=True)
    answer_key_pdf_path = models.CharField(max_length=600, blank=True)
    metadata_report_path = models.CharField(max_length=600, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ("-updated_at", "-created_at")

    def __str__(self) -> str:
        return self.title


class MCQExamQuestion(models.Model):
    exam = models.ForeignKey(MCQExam, on_delete=models.CASCADE, related_name="exam_questions")
    question = models.ForeignKey(MCQQuestion, on_delete=models.CASCADE, related_name="exam_links")
    order = models.PositiveIntegerField(default=0)
    marks = models.PositiveIntegerField(default=1)
    option_order = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ("order", "id")
        unique_together = ("exam", "question")
