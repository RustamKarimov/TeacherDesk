from django.contrib import admin
from django.shortcuts import redirect
from django.urls import include, path

from .health import health


def teacherdesk_root(request):
    return redirect("http://127.0.0.1:5173/")


urlpatterns = [
    path("", teacherdesk_root),
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/libraries/", include("apps.libraries.urls")),
    path("api/catalog/", include("apps.catalog.urls")),
    path("api/splitter/", include("apps.splitter.urls")),
    path("api/exams/", include("apps.exams.urls")),
]
