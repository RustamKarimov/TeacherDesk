import uuid

from django.db import migrations, models


UUID_MODELS = [
    "MCQTopic",
    "MCQSubtopic",
    "MCQTag",
    "MCQImageAsset",
    "MCQQuestion",
    "MCQQuestionBlock",
    "MCQOption",
    "MCQOptionBlock",
    "MCQExam",
    "MCQExamQuestion",
]


def populate_uuids(apps, schema_editor):
    for model_name in UUID_MODELS:
        model = apps.get_model("mcq", model_name)
        for item in model.objects.filter(uuid__isnull=True):
            item.uuid = uuid.uuid4()
            item.save(update_fields=["uuid"])


class Migration(migrations.Migration):

    dependencies = [
        ("mcq", "0002_alter_mcqquestionblock_block_type"),
    ]

    operations = [
        migrations.AddField(
            model_name="mcqtopic",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqsubtopic",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqtag",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqimageasset",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqimageasset",
            name="relative_path",
            field=models.CharField(blank=True, max_length=500),
        ),
        migrations.AddField(
            model_name="mcqquestion",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqquestionblock",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqoption",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqoptionblock",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqexam",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqexamquestion",
            name="uuid",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="mcqexamquestion",
            name="correct_option_uuid",
            field=models.UUIDField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="mcqexamquestion",
            name="snapshot",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.RunPython(populate_uuids, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="mcqtopic",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqsubtopic",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqtag",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqimageasset",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqquestion",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqquestionblock",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqoption",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqoptionblock",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqexam",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
        migrations.AlterField(
            model_name="mcqexamquestion",
            name="uuid",
            field=models.UUIDField(default=uuid.uuid4, editable=False, unique=True),
        ),
    ]
