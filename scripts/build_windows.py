"""
Aegis Score Studio — Windows portable build script.

Usage:
    python scripts/build_windows.py [--zip] [--skip-deps-check]

Output:
    dist/AegisScoreStudio/          ← run AegisScoreStudio.exe from here
    dist/AegisScoreStudio.zip       ← (with --zip) portable archive

Notes:
- Uses --onedir (NOT --onefile) because PySide6 QML plugins cannot be
  reliably packed into a single executable on Windows.
- torch / demucs / librosa are large (~4 GB). First run downloads models.
- The exe expects ffmpeg.exe on PATH or in its own directory.
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT     = Path(__file__).resolve().parent.parent
DIST_DIR = ROOT / "dist"
BUILD_DIR = ROOT / "build"
OUT_DIR  = DIST_DIR / "AegisScoreStudio"
OUT_ZIP  = DIST_DIR / "AegisScoreStudio.zip"
ICON     = ROOT / "assets" / "icons" / "app.ico"
SPEC_FILE = ROOT / "AegisScoreStudio.spec"


def _pyside6_path() -> Path:
    import PySide6
    return Path(PySide6.__file__).parent


def _check_deps() -> None:
    required = ["PyInstaller", "PySide6", "fastapi", "uvicorn"]
    missing = []
    for pkg in required:
        try:
            __import__(pkg.replace("-", "_").lower())
        except ImportError:
            missing.append(pkg)
    if missing:
        print(f"[build] Missing packages: {missing}")
        print(f"[build] Run: pip install {' '.join(missing)}")
        sys.exit(1)


def _create_placeholder_icon() -> None:
    """Create a minimal valid .ico if none exists."""
    if ICON.exists():
        return
    ICON.parent.mkdir(parents=True, exist_ok=True)
    # 1x1 px ICO (minimal valid format)
    ico_bytes = bytes([
        0,0,1,0,1,0,1,1,0,0,1,0,32,0,40,0,0,0,22,0,0,0,40,0,0,0,
        1,0,0,0,2,0,0,0,1,0,32,0,0,0,0,0,4,0,0,0,0,0,0,0,0,0,0,0,
        0,0,0,0,0,0,0,0,30,89,159,255,0,0,0,0,
    ])
    ICON.write_bytes(ico_bytes)
    print(f"[build] Created placeholder icon at {ICON}")


def _write_spec() -> None:
    ps6 = _pyside6_path()
    qml_src = str(ps6 / "qml").replace("\\", "/")
    app_qml  = str(ROOT / "frontend").replace("\\", "/")
    assets   = str(ROOT / "assets").replace("\\", "/")

    spec = f"""# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files

# Collect PySide6 properly
pyside6_datas, pyside6_binaries, pyside6_hiddenimports = collect_all('PySide6')

block_cipher = None

a = Analysis(
    ['{str(ROOT / "main.py").replace(chr(92), "/")}'],
    pathex=['{str(ROOT).replace(chr(92), "/")}'],
    binaries=pyside6_binaries,
    datas=[
        ('{app_qml}',  'frontend'),
        ('{assets}',   'assets'),
        ('{qml_src}',  'PySide6/qml'),
        *pyside6_datas,
    ],
    hiddenimports=[
        *pyside6_hiddenimports,
        'PySide6.QtQml',
        'PySide6.QtQuick',
        'PySide6.QtQuickControls2',
        'PySide6.QtCore',
        'PySide6.QtWidgets',
        'PySide6.QtGui',
        'PySide6.QtNetwork',
        'PySide6.QtMultimedia',
        'uvicorn',
        'uvicorn.logging',
        'uvicorn.loops',
        'uvicorn.loops.auto',
        'uvicorn.loops.asyncio',
        'uvicorn.protocols',
        'uvicorn.protocols.http',
        'uvicorn.protocols.http.auto',
        'uvicorn.protocols.http.h11_impl',
        'uvicorn.protocols.websockets',
        'uvicorn.protocols.websockets.auto',
        'uvicorn.lifespan',
        'uvicorn.lifespan.on',
        'fastapi',
        'sqlalchemy',
        'sqlalchemy.dialects.sqlite',
        'sqlalchemy.orm',
        'aiofiles',
        'backend',
        'backend.api',
        'backend.api.routers',
        'backend.db',
        'backend.services',
        'backend.models',
    ],
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'PIL'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name='AegisScoreStudio',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=['Qt6*.dll', 'python3*.dll'],
    console=False,
    disable_windowed_traceback=False,
    icon='{str(ICON).replace(chr(92), "/")}',
)

coll = COLLECT(
    exe, a.binaries, a.zipfiles, a.datas,
    strip=False,
    upx=True,
    upx_exclude=['Qt6*.dll', 'python3*.dll'],
    name='AegisScoreStudio',
)
"""
    SPEC_FILE.write_text(spec, encoding="utf-8")
    print(f"[build] Wrote {SPEC_FILE.name}")


def _run_pyinstaller() -> None:
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--clean",
        "--noconfirm",
        str(SPEC_FILE),
    ]
    print("[build] Running PyInstaller…")
    subprocess.check_call(cmd, cwd=ROOT)


def _write_launcher_bat() -> None:
    """Convenience launcher next to the exe."""
    bat = OUT_DIR / "Launch Aegis Score Studio.bat"
    bat.write_text(
        '@echo off\r\nstart "" "%~dp0AegisScoreStudio.exe"\r\n',
        encoding="utf-8"
    )


def _write_readme() -> None:
    readme = OUT_DIR / "README.txt"
    readme.write_text(
        "Aegis Score Studio\n"
        "==================\n"
        "Run AegisScoreStudio.exe to start.\n\n"
        "Requirements:\n"
        "  - ffmpeg.exe must be on PATH or placed in this folder.\n"
        "  - Internet connection for YouTube download.\n"
        "  - GPU optional; CPU fallback available.\n\n"
        "First run downloads Demucs model weights (~800 MB).\n",
        encoding="utf-8"
    )


def _zip_output() -> None:
    print(f"[build] Zipping {OUT_DIR} → {OUT_ZIP}")
    with zipfile.ZipFile(OUT_ZIP, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for f in OUT_DIR.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(DIST_DIR))
    size_mb = OUT_ZIP.stat().st_size / 1_000_000
    print(f"[build] ZIP created: {OUT_ZIP} ({size_mb:.0f} MB)")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Aegis Score Studio portable exe")
    parser.add_argument("--zip",            action="store_true", help="Create ZIP archive of dist folder")
    parser.add_argument("--skip-deps-check",action="store_true", help="Skip dependency check")
    args = parser.parse_args()

    if not args.skip_deps_check:
        _check_deps()

    _create_placeholder_icon()
    _write_spec()
    _run_pyinstaller()
    _write_launcher_bat()
    _write_readme()

    print(f"\n[build] ✓ Done → {OUT_DIR}")
    print(f"[build]   Exe:  {OUT_DIR / 'AegisScoreStudio.exe'}")
    size_mb = sum(f.stat().st_size for f in OUT_DIR.rglob("*") if f.is_file()) / 1_000_000
    print(f"[build]   Size: {size_mb:.0f} MB")

    if args.zip:
        _zip_output()


if __name__ == "__main__":
    main()
