from django.contrib import admin

from .models import GeneratedExam


@admin.register(GeneratedExam)
class GeneratedExamAdmin(admin.ModelAdmin):
    list_display = ("title", "library", "mode", "total_marks", "created_at")
    list_filter = ("mode",)
    search_fields = ("title",)
