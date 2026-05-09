from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("mcq", "0003_portable_uuid_assets"),
    ]

    operations = [
        migrations.AddField(
            model_name="mcqquestion",
            name="content_json",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="mcqquestion",
            name="content_html",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="mcqquestion",
            name="content_text",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="mcqoption",
            name="content_json",
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name="mcqoption",
            name="content_html",
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name="mcqoption",
            name="content_text",
            field=models.TextField(blank=True),
        ),
    ]
