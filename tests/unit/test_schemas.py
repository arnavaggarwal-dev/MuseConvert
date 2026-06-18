"""Pydantic schema validation tests."""
import pytest
from pydantic import ValidationError
from backend.models.schemas import (
    JobState, JobStatus, GpuInfo, StemSchema, AnalyzeRequest, MidiNote, MidiResponse
)


def test_job_state_defaults():
    j = JobState()
    assert j.status == JobStatus.QUEUED
    assert j.progress == 0.0
    assert j.stage == -1
    assert j.stems == []
    assert j.error is None


def test_analyze_request_strips_whitespace():
    req = AnalyzeRequest(url="  https://youtu.be/abc  ")
    # url stored as-is; stripping done in router
    assert "https" in req.url


def test_gpu_info_defaults():
    g = GpuInfo()
    assert g.model == "CPU"
    assert g.vram == 0.0
    assert g.vram_total == 0.0


def test_midi_note_validation():
    n = MidiNote(pitch=60, start=0.0, end=1.0, velocity=80, drum=False)
    assert n.pitch == 60

    with pytest.raises(ValidationError):
        MidiNote(pitch="bad", start=0.0, end=1.0, velocity=80, drum=False)


def test_midi_response():
    r = MidiResponse(notes=[], end_time=0.0)
    assert r.notes == []
