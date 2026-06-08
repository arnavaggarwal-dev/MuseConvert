"""Integration tests for FastAPI routes — no real audio processing."""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, AsyncMock
from backend.api.app import create_app


@pytest.fixture(scope="module")
def client():
    app = create_app()
    return TestClient(app)


def test_analyze_returns_session_id(client):
    with patch("backend.services.pipeline.pipeline_url", new_callable=AsyncMock):
        resp = client.post("/api/analyze", json={"url": "https://youtu.be/test"})
    assert resp.status_code == 200
    data = resp.json()
    assert "session_id" in data
    assert len(data["session_id"]) == 36  # UUID


def test_status_404_unknown_session(client):
    resp = client.get("/api/status/00000000-0000-0000-0000-000000000000")
    assert resp.status_code == 404


def test_status_returns_job_after_analyze(client):
    with patch("backend.services.pipeline.pipeline_url", new_callable=AsyncMock):
        resp = client.post("/api/analyze", json={"url": "https://youtu.be/xyz"})
    sid = resp.json()["session_id"]
    status = client.get(f"/api/status/{sid}")
    assert status.status_code == 200
    data = status.json()
    assert data["status"] in ("queued", "downloading", "done", "error")


def test_midi_404_nonexistent(client):
    resp = client.get("/api/midi/fakesid/drums")
    assert resp.status_code == 404


def test_history_returns_list(client):
    resp = client.get("/api/history")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_upload_no_file(client):
    resp = client.post("/api/upload")
    assert resp.status_code == 422   # unprocessable — no file field
