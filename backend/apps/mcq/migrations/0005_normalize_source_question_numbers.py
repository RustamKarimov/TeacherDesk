from django.db import migrations


def normalize_source_question_numbers(apps, schema_editor):
    question_model = apps.get_model("mcq", "MCQQuestion")
    for question in question_model.objects.exclude(source_question_number=""):
        value = str(question.source_question_number or "").strip()
        if not value:
            continue
        if value.lower().startswith("q"):
            value = value[1:].lstrip(" -")
        normalized = f"Q{value}" if value else ""
        if normalized != question.source_question_number:
            question.source_question_number = normalized
            question.save(update_fields=["source_question_number"])


class Migration(migrations.Migration):

    dependencies = [
        ("mcq", "0004_rich_content_fields"),
    ]

    operations = [
        migrations.RunPython(normalize_source_question_numbers, migrations.RunPython.noop),
    ]
