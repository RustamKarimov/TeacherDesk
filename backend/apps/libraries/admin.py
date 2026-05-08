from django.contrib import admin

from .models import AppSettings, Library


@admin.register(Library)
class LibraryAdmin(admin.ModelAdmin):
    list_display = ("name", "root_path", "naming_preset", "is_active", "last_used_at")
    search_fields = ("name", "root_path")


@admin.register(AppSettings)
class AppSettingsAdmin(admin.ModelAdmin):
    list_display = ("library", "updated_at")
