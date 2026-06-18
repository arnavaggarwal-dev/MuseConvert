#!/usr/bin/env python3
"""
Aegis Score Studio — build script
Produces: dist/Aegis Score Studio Setup.exe  (Windows NSIS installer)

Usage:
  python build.py          # full build (PyInstaller server + Electron installer)
  python build.py --electron-only  # skip PyInstaller, requires Python on target

Steps:
  1. Verify / fix setuptools so PyInstaller works
  2. PyInstaller: server_launch.py -> dist/server_dist/server_launch.exe
  3. electron-builder: bundles Electron + server_dist -> dist/*.exe installer
"""

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.resolve()


# ── Helpers ───────────────────────────────────────────────────────────────────

def run(cmd, **kwargs):
    cmd_str = " ".join(str(c) for c in cmd)
    print(f"\n>>> {cmd_str}")
    subprocess.run(cmd, check=True, **kwargs)


def run_py(*args):
    run([sys.executable, *args])


# ── Step 1: Fix setuptools / pkg_resources ────────────────────────────────────

def ensure_pyinstaller():
    # setuptools >= 80 dropped pkg_resources; PyInstaller (via altgraph) needs it
    try:
        import pkg_resources  # noqa: F401
        import PyInstaller    # noqa: F401
        print("[1] setuptools + PyInstaller OK")
        return
    except ModuleNotFoundError:
        pass

    print("[1] Fixing setuptools (pinning <80 for pkg_resources) ...")
    run_py("-m", "pip", "install", "setuptools<80", "--quiet")
    print("[1] Installing / upgrading PyInstaller ...")
    run_py("-m", "pip", "install", "pyinstaller", "--upgrade", "--quiet")
    print("[1] Done.")


# ── Step 2: PyInstaller ───────────────────────────────────────────────────────

HIDDEN = [
    # uvicorn lazy imports
    "uvicorn.logging",
    "uvicorn.loops", "uvicorn.loops.auto",
    "uvicorn.protocols", "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.wsproto_impl",
    "uvicorn.lifespan", "uvicorn.lifespan.on", "uvicorn.lifespan.off",
    # starlette / fastapi
    "starlette", "starlette.staticfiles", "starlette.routing",
    "starlette.middleware", "starlette.responses",
    # audio + ML
    "librosa", "librosa.core", "librosa.feature", "librosa.beat",
    "librosa.onset", "librosa.decompose", "librosa.effects",
    "pretty_midi", "soundfile", "yt_dlp",
    "demucs", "demucs.pretrained", "demucs.apply", "demucs.audio",
    "torchaudio", "torch", "sklearn",
    "scipy", "scipy.signal", "scipy.ndimage",
]

COLLECT_ALL = ["librosa", "demucs", "torchaudio", "yt_dlp"]

STATIC_DATA = [
    ("index.html", "."),
    ("css",        "css"),
    ("js",         "js"),
    ("assets",     "assets"),
]


def _data_flag(src, dst):
    sep = ";" if sys.platform == "win32" else ":"
    return f"--add-data={src}{sep}{dst}"


def build_server_exe():
    print("[2] Building server_launch.exe with PyInstaller ...")
    out_dir = ROOT / "dist" / "server_dist"

    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--onedir",
        "--name",    "server_launch",
        "--distpath", str(ROOT / "dist"),
        "--workpath", str(ROOT / "build_pyinstaller"),
        "--specpath", str(ROOT),
        "--noconsole",             # no shell window — Electron reads stdout/stderr via pipe
    ]

    for h in HIDDEN:
        cmd += ["--hidden-import", h]

    for pkg in COLLECT_ALL:
        cmd += ["--collect-all", pkg]

    for src, dst in STATIC_DATA:
        p = ROOT / src
        if p.exists():
            cmd.append(_data_flag(str(p), dst))
        else:
            print(f"  [warn] skipping missing: {src}")

    cmd.append(str(ROOT / "server_launch.py"))
    run(cmd, cwd=ROOT)
    print(f"[2] server_launch.exe → {out_dir}")


# ── Step 3: Update package.json extraResources ────────────────────────────────

def patch_package_json():
    print("[3] Patching package.json extraResources ...")
    pkg_path = ROOT / "package.json"
    pkg = json.loads(pkg_path.read_text(encoding="utf-8"))

    pkg.setdefault("build", {})
    pkg["build"]["extraResources"] = [
        {
            "from": "dist/server_dist",
            "to":   "server_dist",
            "filter": ["**/*"]
        }
    ]

    # Ensure icon path exists or drop it
    win_cfg = pkg["build"].get("win", {})
    icon_path = ROOT / win_cfg.get("icon", "NONE")
    if not icon_path.exists():
        print(f"  [warn] icon not found ({icon_path.name}) — removing from config")
        win_cfg.pop("icon", None)
        pkg["build"]["win"] = win_cfg

    pkg_path.write_text(json.dumps(pkg, indent=2), encoding="utf-8")
    print("[3] Done.")


# ── Step 4: electron-builder ──────────────────────────────────────────────────

def build_electron():
    print("[4] Running electron-builder ...")
    # npm is a .cmd on Windows
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    run([npm, "run", "build"], cwd=ROOT)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Build Aegis Score Studio")
    parser.add_argument("--electron-only", action="store_true",
                        help="Skip PyInstaller — target machine needs Python installed")
    args = parser.parse_args()

    print("=" * 62)
    print("  Aegis Score Studio — Build Script")
    print("=" * 62)

    if args.electron_only:
        print("\n[MODE] electron-only (Python required on target)")
        pkg_path = ROOT / "package.json"
        pkg = json.loads(pkg_path.read_text(encoding="utf-8"))
        pkg["build"].pop("extraResources", None)
        pkg_path.write_text(json.dumps(pkg, indent=2), encoding="utf-8")
        build_electron()
    else:
        print("\n[MODE] full (self-contained — bundles Python + all deps)")
        print("       Expected output size: 2–4 GB (torch + demucs + librosa)\n")
        ensure_pyinstaller()
        build_server_exe()
        patch_package_json()
        build_electron()

    dist = ROOT / "dist"
    installer = next(dist.glob("*.exe"), None)
    if installer:
        size_mb = installer.stat().st_size / 1024 / 1024
        print(f"\n{'='*62}")
        print(f"  Done!  {installer.name}  ({size_mb:.0f} MB)")
        print(f"  Path:  {installer}")
        print(f"{'='*62}")
    else:
        print(f"\nBuild complete. Output in: {dist}")


if __name__ == "__main__":
    main()
