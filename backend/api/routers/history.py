"""Session history — CRUD over SQLite."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.db.database import get_db
from backend.db.models import Session as DbSession

router = APIRouter()


@router.get("/history")
def list_history(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.query(DbSession).order_by(DbSession.created_at.desc()).limit(limit).all()
    return [
        {"id": r.id, "title": r.title, "artist": r.artist, "source": r.source,
         "duration": r.duration, "created_at": r.created_at.isoformat(),
         "stem_count": len(r.stems)}
        for r in rows
    ]


@router.delete("/history/{sid}")
def delete_session(sid: str, db: Session = Depends(get_db)):
    row = db.query(DbSession).filter(DbSession.id == sid).first()
    if row:
        db.delete(row); db.commit()
    return {"ok": True}
