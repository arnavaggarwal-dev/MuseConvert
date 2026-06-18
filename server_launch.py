"""
Entry point for the PyInstaller-compiled server binary.
Sets AEGIS_WORK_DIR / AEGIS_STATIC_DIR before importing server so paths resolve correctly.
"""
import sys
import os
from pathlib import Path

if getattr(sys, "frozen", False):
    # Running inside a PyInstaller bundle
    _static_dir = Path(sys._MEIPASS)                      # extracted data lives here
    _work_dir   = Path(sys.executable).parent / "work"    # writable, next to .exe
    os.environ.setdefault("AEGIS_STATIC_DIR", str(_static_dir))
    os.environ.setdefault("AEGIS_WORK_DIR",   str(_work_dir))
    _work_dir.mkdir(exist_ok=True, parents=True)

import uvicorn
from server import app  # noqa: E402 — must come after env vars are set

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=7471, log_level="warning")
