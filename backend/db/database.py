"""DB engine + session factory."""
from __future__ import annotations

from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend.db.models import Base

DB_PATH = Path("aegis.db")
_ENGINE = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=_ENGINE, autocommit=False, autoflush=False)


def init_db() -> None:
    Base.metadata.create_all(bind=_ENGINE)


def get_db():
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
