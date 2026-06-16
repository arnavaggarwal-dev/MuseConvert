# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all
from pathlib import Path

ROOT = Path(SPECPATH)

datas = [
    (str(ROOT / 'index.html'), '.'),
    (str(ROOT / 'css'),        'css'),
    (str(ROOT / 'js'),         'js'),
]
binaries = []
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.loops', 'uvicorn.loops.auto',
    'uvicorn.protocols', 'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.httptools_impl',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.protocols.websockets.wsproto_impl',
    'uvicorn.lifespan', 'uvicorn.lifespan.on', 'uvicorn.lifespan.off',
    'starlette', 'starlette.staticfiles', 'starlette.routing',
    'starlette.middleware', 'starlette.responses',
    'librosa', 'librosa.core', 'librosa.feature',
    'librosa.beat', 'librosa.onset',
    'pretty_midi', 'soundfile', 'yt_dlp',
    'demucs', 'demucs.pretrained', 'demucs.apply', 'demucs.audio',
    'torch', 'sklearn', 'scipy', 'scipy.signal', 'scipy.ndimage',
]

for pkg in ('librosa', 'demucs', 'yt_dlp'):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

a = Analysis(
    [str(ROOT / 'server_launch.py')],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='server_launch',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# Name must be 'server_dist' — electron-builder copies dist/server_dist/ into resources
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='server_dist',
)
