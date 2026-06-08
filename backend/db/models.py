"""SQLAlchemy 2.x ORM models."""
from __future__ import annotations

from datetime import datetime
from sqlalchemy import String, Float, Integer, Boolean, ForeignKey, DateTime, JSON
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Session(Base):
    __tablename__ = "sessions"

    id:         Mapped[str]      = mapped_column(String(36), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    source:     Mapped[str]      = mapped_column(String(2048))
    title:      Mapped[str]      = mapped_column(String(512), default="")
    artist:     Mapped[str]      = mapped_column(String(512), default="")
    duration:   Mapped[float]    = mapped_column(Float, default=0.0)
    thumb:      Mapped[str]      = mapped_column(String(2048), default="")
    tempo:      Mapped[int]      = mapped_column(Integer, default=120)
    key:        Mapped[str]      = mapped_column(String(32), default="A minor")
    time_sig:   Mapped[list]     = mapped_column(JSON, default=lambda: [4, 4])
    status:     Mapped[str]      = mapped_column(String(32), default="done")

    stems: Mapped[list[Stem]] = relationship("Stem", back_populates="session", cascade="all, delete-orphan")


class Stem(Base):
    __tablename__ = "stems"

    id:          Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id:  Mapped[str] = mapped_column(String(36), ForeignKey("sessions.id"))
    stem_id:     Mapped[str] = mapped_column(String(32))   # "drums", "bass", …
    name:        Mapped[str] = mapped_column(String(128))
    instrument:  Mapped[str] = mapped_column(String(256))
    clef:        Mapped[str] = mapped_column(String(16))
    color:       Mapped[str] = mapped_column(String(32))
    role:        Mapped[str] = mapped_column(String(64))
    confidence:  Mapped[float] = mapped_column(Float)
    midi_count:  Mapped[int]   = mapped_column(Integer, default=0)
    audio_path:  Mapped[str]   = mapped_column(String(1024), default="")
    midi_path:   Mapped[str]   = mapped_column(String(1024), default="")
    muted:       Mapped[bool]  = mapped_column(Boolean, default=False)

    session: Mapped[Session] = relationship("Session", back_populates="stems")
