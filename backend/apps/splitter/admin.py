from django.contrib import admin

from .models import ManifestImport


@admin.register(ManifestImport)
class ManifestImportAdmin(admin.ModelAdmin):
    list_display = ("name", "library", "status", "row_count", "error_count", "warning_count", "created_at")
    list_filter = ("status",)
    search_fields = ("name", "file_path")
