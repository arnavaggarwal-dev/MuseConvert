"""Pydantic v2 schemas — shared contracts between FastAPI and QML bridge."""
from __future__ import annotations

from enum import StrEnum
from typing import Any
from pydantic import BaseModel, Field


class JobStatus(StrEnum):
    QUEUED      = "queued"
    DOWNLOADING = "downloading"
    CONVERTING  = "converting"
    SEPARATING  = "separating"
    IDENTIFYING = "identifying"
    TRANSCRIBING= "transcribing"
    ENGRAVING   = "engraving"
    DONE        = "done"
    ERROR       = "error"


class GpuInfo(BaseModel):
    model: str = "CPU"
    util: float = 0.0
    vram: float = 0.0
    vram_total: float = 0.0


class StemSchema(BaseModel):
    id: str
    name: str
    instrument: str
    family: str
    clef: str
    color: str
    role: str
    confidence: float
    midi: int
    audio_url: str
    midi_url: str | None
    density: int = 2
    seed: int = 0
    note: str = ""


class JobMeta(BaseModel):
    title: str = ""
    artist: str = ""
    duration: float = 0.0
    thumb: str = ""
    source: str = ""
    tempo: int = 120
    key: str = "A minor"
    time_sig: list[int] = Field(default_factory=lambda: [4, 4])
    sample_rate: int = 44100
    bit_depth: int = 24
    sep_model: str = ""
    trans_model: str = ""
    gpu: GpuInfo = Field(default_factory=GpuInfo)


class JobState(BaseModel):
    status: JobStatus = JobStatus.QUEUED
    progress: float = 0.0
    stage: int = -1
    meta: JobMeta = Field(default_factory=JobMeta)
    stems: list[StemSchema] = Field(default_factory=list)
    error: str | None = None


class AnalyzeRequest(BaseModel):
    url: str


class MidiNote(BaseModel):
    pitch: int
    start: float
    end: float
    velocity: int
    drum: bool


class MidiResponse(BaseModel):
    notes: list[MidiNote]
    end_time: float
