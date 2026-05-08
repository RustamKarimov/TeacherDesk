from django.contrib import admin

from .models import (
    MCQExam,
    MCQExamQuestion,
    MCQImageAsset,
    MCQOption,
    MCQOptionBlock,
    MCQQuestion,
    MCQQuestionBlock,
    MCQSubtopic,
    MCQTag,
    MCQTopic,
)


admin.site.register(MCQTopic)
admin.site.register(MCQSubtopic)
admin.site.register(MCQTag)
admin.site.register(MCQImageAsset)
admin.site.register(MCQQuestion)
admin.site.register(MCQQuestionBlock)
admin.site.register(MCQOption)
admin.site.register(MCQOptionBlock)
admin.site.register(MCQExam)
admin.site.register(MCQExamQuestion)
