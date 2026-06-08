"""FastAPI app factory — same pipeline logic as web prototype, now IPC-only."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from backend.api.routers import analyze, upload, status, midi_notes


def create_app() -> FastAPI:
    app = FastAPI(title="AegisScore-Desktop", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:7471", "app://aegis"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(analyze.router, prefix="/api")
    app.include_router(upload.router,  prefix="/api")
    app.include_router(status.router,  prefix="/api")
    app.include_router(midi_notes.router, prefix="/api")

    work_dir = Path("work")
    work_dir.mkdir(exist_ok=True)
    app.mount("/work", StaticFiles(directory=str(work_dir)), name="work")

    return app
