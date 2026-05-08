import json

from django.test import TestCase


class ApiSmokeTests(TestCase):
    def test_backend_root_redirects_to_frontend(self):
        response = self.client.get("/")

        self.assertEqual(response.status_code, 302)
        self.assertEqual(response["Location"], "http://127.0.0.1:5173/")

    def test_health_endpoint_reports_ok(self):
        response = self.client.get("/api/health/")

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["database"], "ok")

    def test_settings_and_dashboard_load_with_defaults(self):
        settings_response = self.client.get("/api/libraries/settings/")
        dashboard_response = self.client.get("/api/libraries/dashboard/")

        self.assertEqual(settings_response.status_code, 200)
        self.assertEqual(dashboard_response.status_code, 200)
        self.assertIn("library", settings_response.json())
        self.assertIn("modules", dashboard_response.json())

    def test_settings_validation_returns_clear_error(self):
        response = self.client.post(
            "/api/libraries/settings/save/",
            data=json.dumps({"paper_marks": {"2": "not a number"}}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("Paper marks", response.json()["error"])

    def test_catalog_filters_and_bad_pagination(self):
        filters_response = self.client.get("/api/catalog/filters/")
        bad_page_response = self.client.get("/api/catalog/questions/?page=abc")

        self.assertEqual(filters_response.status_code, 200)
        self.assertIn("topics", filters_response.json())
        self.assertEqual(bad_page_response.status_code, 400)
        self.assertIn("page", bad_page_response.json()["error"])

    def test_exam_validation_errors_are_json(self):
        response = self.client.post(
            "/api/exams/generate/",
            data=json.dumps({"mode": "full_paper", "paper_number": "bad"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn("paper_number", response.json()["error"])

    def test_splitter_index_is_available(self):
        response = self.client.get("/api/splitter/")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["module"], "splitter")
