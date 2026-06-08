"""Persist a completed pipeline job to SQLite."""
from __future__ import annotations

from backend.db.database import SessionLocal
from backend.db.models import Session as DbSession, Stem as DbStem


def save_session(sid: str, job: dict) -> None:
    meta = job.get("meta", {})
    db = SessionLocal()
    try:
        existing = db.query(DbSession).filter(DbSession.id == sid).first()
        if existing:
            return
        row = DbSession(
            id=sid,
            source=meta.get("source", ""),
            title=meta.get("title", ""),
            artist=meta.get("artist", ""),
            duration=meta.get("duration", 0.0),
            thumb=meta.get("thumb", ""),
            tempo=meta.get("tempo", 120),
            key=meta.get("key", "A minor"),
            time_sig=meta.get("timeSig", [4, 4]),
            status="done",
        )
        for s in job.get("stems", []):
            row.stems.append(DbStem(
                stem_id=s.get("id", ""),
                name=s.get("name", ""),
                instrument=s.get("instrument", ""),
                clef=s.get("clef", "treble"),
                color=s.get("color", ""),
                role=s.get("role", ""),
                confidence=s.get("confidence", 0.0),
                midi_count=s.get("midi", 0),
                audio_path=s.get("audio_url", ""),
                midi_path=s.get("midi_url", "") or "",
            ))
        db.add(row); db.commit()
    finally:
        db.close()
