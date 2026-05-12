from fastapi.testclient import TestClient

from api.main import app


client = TestClient(app)


def test_health_endpoint_returns_200_and_required_keys():
    r = client.get("/api/admin/patterns/health")
    assert r.status_code == 200
    body = r.json()
    for key in ("detector_count", "stored_detections_total", "registered_detectors",
                "stored_by_pattern", "stored_by_status", "schema_version"):
        assert key in body
