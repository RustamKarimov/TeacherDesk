from django.contrib import admin

from .models import Question, Topic


@admin.register(Topic)
class TopicAdmin(admin.ModelAdmin):
    list_display = ("subject_code", "topic_number", "name", "source")
    search_fields = ("name", "subject_code")


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ("exam_code", "question_number", "paper_number", "marks", "qp_review_status", "ms_review_status")
    list_filter = ("paper_number", "qp_review_status", "ms_review_status")
    search_fields = ("exam_code",)
