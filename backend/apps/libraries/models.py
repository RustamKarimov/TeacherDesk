from django.db import models


class Library(models.Model):
    name = models.CharField(max_length=120)
    root_path = models.CharField(max_length=500)
    source_papers_path = models.CharField(max_length=500, default="source_papers")
    question_bank_path = models.CharField(max_length=500, default="QuestionBank")
    generated_exams_path = models.CharField(max_length=500, default="generated_exams")
    manifests_path = models.CharField(max_length=500, default="manifests")
    naming_preset = models.CharField(max_length=80, default="cambridge")
    is_active = models.BooleanField(default=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return self.name


class AppSettings(models.Model):
    library = models.OneToOneField(Library, on_delete=models.CASCADE, related_name="settings")
    default_manifest_path = models.CharField(max_length=500, blank=True)
    default_source_root = models.CharField(max_length=500, blank=True)
    default_output_root = models.CharField(max_length=500, blank=True)
    default_generated_exams_root = models.CharField(max_length=500, blank=True)
    paper_marks = models.JSONField(default=dict, blank=True)
    pdf_mask_settings = models.JSONField(default=dict, blank=True)
    app_preferences = models.JSONField(default=dict, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"Settings for {self.library.name}"
