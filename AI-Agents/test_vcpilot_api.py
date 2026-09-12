from dataclasses import replace

from fastapi.testclient import TestClient

from vcpilot_api import Settings, clean_extracted_text, create_app


def test_clean_extracted_text_preserves_arabic_and_money():
    assert clean_extracted_text("  مرحبا\u00a0\n\n\n$ 1,000 ") == "مرحبا\n\n$ 1,000"


def test_health_endpoint():
    app = create_app(replace(Settings.from_env(), mock_mode=True))
    health = TestClient(app).get("/health").json()
    assert health["status"] == "ok"
    assert health["mock_mode"] is True


def test_missing_file_uses_the_api_error_format():
    response = TestClient(create_app()).post("/api/v1/analyze-pitch-deck")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "validation_error"
