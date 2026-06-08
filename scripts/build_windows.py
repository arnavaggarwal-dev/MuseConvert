"""
PyInstaller build script for Windows.
Run: python scripts/build_windows.py
Output: dist/AegisScoreStudio.exe
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent

PYINSTALLER_ARGS = [
    sys.executable, "-m", "PyInstaller",
    "--name", "AegisScoreStudio",
    "--onefile",
    "--windowed",
    "--icon", str(ROOT / "assets" / "icons" / "app.ico"),
    # Bundle QML files
    "--add-data", f"{ROOT / 'frontend'};frontend",
    "--add-data", f"{ROOT / 'assets'};assets",
    # Hidden imports for PySide6 QML
    "--hidden-import", "PySide6.QtQml",
    "--hidden-import", "PySide6.QtQuick",
    "--hidden-import", "PySide6.QtCore",
    "--hidden-import", "PySide6.QtWidgets",
    "--hidden-import", "PySide6.QtMultimedia",
    # Backend
    "--hidden-import", "uvicorn.logging",
    "--hidden-import", "uvicorn.loops",
    "--hidden-import", "uvicorn.loops.auto",
    "--hidden-import", "uvicorn.protocols",
    "--hidden-import", "uvicorn.protocols.http",
    "--hidden-import", "uvicorn.protocols.http.auto",
    "--hidden-import", "uvicorn.protocols.websockets.auto",
    "--hidden-import", "uvicorn.lifespan.on",
    str(ROOT / "main.py"),
]

subprocess.check_call(PYINSTALLER_ARGS)
print("Build complete → dist/AegisScoreStudio.exe")
