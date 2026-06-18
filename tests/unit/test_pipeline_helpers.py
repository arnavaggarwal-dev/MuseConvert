"""Unit tests for pipeline utility functions — no audio I/O needed."""
import pytest
from pathlib import Path
from backend.db.database import init_db
from backend.db.models import Session as DbSession, Stem as DbStem
from backend.services.pipeline import STEM_META, DEMUCS_SOURCES, _gpu_info


def test_stem_meta_all_sources():
    """Every demucs source must have metadata."""
    for src in DEMUCS_SOURCES:
        assert src in STEM_META, f"Missing STEM_META entry for: {src}"


def test_stem_meta_required_keys():
    required = {"name", "instrument", "family", "clef", "color", "role"}
    for src, meta in STEM_META.items():
        missing = required - meta.keys()
        assert not missing, f"{src} missing keys: {missing}"


def test_gpu_info_returns_dict():
    info = _gpu_info()
    assert isinstance(info, dict)
    assert "model" in info
    assert "vram" in info
    assert "vramTotal" in info
    assert info["vram"] >= 0
    assert info["vramTotal"] >= 0


def test_db_init(tmp_path, monkeypatch):
    """DB init creates tables without error."""
    import backend.db.database as db_mod
    monkeypatch.setattr(db_mod, "DB_PATH", tmp_path / "test.db")
    monkeypatch.setattr(db_mod, "_ENGINE",
        __import__("sqlalchemy").create_engine(f"sqlite:///{tmp_path}/test.db",
            connect_args={"check_same_thread": False}))
    from backend.db.models import Base
    Base.metadata.create_all(bind=db_mod._ENGINE)
    # Should not raise


def test_demucs_sources_order():
    """Separation order matches expected 6-stem model."""
    assert DEMUCS_SOURCES == ["drums", "bass", "other", "vocals", "guitar", "piano"]
