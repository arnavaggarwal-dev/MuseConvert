@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo.
echo ============================================================
echo   Aegis Score Studio -- First-Time Setup
echo ============================================================
echo.

:: ── 0. Prerequisites check ───────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js not found.
    echo        Download from https://nodejs.org ^(LTS^)
    pause & exit /b 1
)
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python not found on PATH.
    echo        Download Python 3.11+ from https://python.org
    pause & exit /b 1
)

for /f "tokens=2" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo System Python: %PYVER%

where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo WARNING: ffmpeg not found -- audio conversion will fail.
    echo          Download from https://ffmpeg.org and add to PATH.
    echo          Continuing anyway...
    echo.
)

:: ── 1. npm dependencies ──────────────────────────────────────────────────────
echo [1/5] Installing Node.js dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed.
    pause & exit /b 1
)
echo       Done.
echo.

:: ── 2. Main Python dependencies (system Python, 3.10+) ──────────────────────
echo [2/5] Installing main Python dependencies...
echo       ^(fastapi, demucs, librosa, basic-pitch, yt-dlp, etc.^)
python -m pip install --upgrade pip -q
python -m pip install ^
    fastapi ^
    "uvicorn[standard]" ^
    yt-dlp ^
    "demucs>=4.0.1" ^
    torch ^
    torchaudio ^
    "librosa>=0.10.0" ^
    "pretty-midi>=0.2.10" ^
    "soundfile>=0.12.1" ^
    python-multipart ^
    basic-pitch ^
    beat-this
if errorlevel 1 (
    echo WARNING: Some packages may have failed. Check output above.
    echo          The app may still work without optional packages.
)
echo       Done.
echo.

:: ── 3. omnizart isolated environment ────────────────────────────────────────
echo [3/5] Setting up omnizart ^(orchestral AI^)
echo.
echo       Requires: Python 3.9 64-bit ^(TensorFlow needs 64-bit^)
echo       omnizart's dependency madmom can't compile on Windows,
echo       so we install omnizart --no-deps and supply its real deps manually.
echo.

set OMNI_PY=
set OMNI_ENV=C:\omnizart_env

:: Check 64-bit Python 3.9 via common install paths (prefer explicit paths over py launcher
:: because py launcher may return 32-bit installs which TensorFlow rejects)
for %%p in (
    "C:\Python39\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python39\python.exe"
    "C:\Program Files\Python39\python.exe"
) do (
    if "!OMNI_PY!"=="" (
        if exist %%p (
            :: Verify it's 64-bit
            %%p -c "import struct; exit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>&1
            if not errorlevel 1 set OMNI_PY=%%p
        )
    )
)

:: Try py launcher as fallback (may or may not be 64-bit)
if "!OMNI_PY!"=="" (
    py -3.9 --version >nul 2>&1
    if not errorlevel 1 (
        py -3.9 -c "import struct; exit(0 if struct.calcsize('P')*8==64 else 1)" >nul 2>&1
        if not errorlevel 1 set OMNI_PY=py -3.9
    )
)

if "!OMNI_PY!"=="" (
    echo       64-bit Python 3.9 NOT FOUND.
    echo.
    echo       omnizart DISABLED. To enable orchestral AI transcription:
    echo         1. Download Python 3.9.13 64-bit installer:
    echo            https://www.python.org/downloads/release/python-3913/
    echo            ^(scroll to Files ^> Windows installer ^(64-bit^)^)
    echo         2. Install to C:\Python39  ^(don't replace system Python^)
    echo         3. Re-run setup.bat
    echo.
    echo       App still works -- uses basic-pitch for all stems instead.
    goto :skip_omnizart
)

echo       Found 64-bit Python 3.9: !OMNI_PY!
echo.

if exist "!OMNI_ENV!\Scripts\python.exe" (
    echo       omnizart env already exists. Delete !OMNI_ENV! to reinstall.
    goto :download_models
)

echo       Creating virtual environment at !OMNI_ENV! ...
!OMNI_PY! -m venv !OMNI_ENV!
if errorlevel 1 ( echo ERROR: venv creation failed. & goto :skip_omnizart )

echo       Upgrading pip...
"!OMNI_ENV!\Scripts\python.exe" -m pip install --upgrade pip -q

echo       Installing omnizart dependencies ^(skipping madmom -- Windows incompatible^)...
echo       This downloads TensorFlow ~500 MB, may take 10+ min...
"!OMNI_ENV!\Scripts\pip.exe" install ^
    "numpy<2.0" ^
    "tensorflow>=2.3,<2.14" ^
    librosa ^
    scipy ^
    mir_eval ^
    pretty_midi ^
    h5py ^
    click ^
    colorama ^
    pyyaml
if errorlevel 1 (
    echo ERROR: Dependency install failed. Check output above.
    rmdir /s /q "!OMNI_ENV!"
    goto :skip_omnizart
)

echo       Installing omnizart ^(no-deps -- madmom excluded^)...
"!OMNI_ENV!\Scripts\pip.exe" install omnizart --no-deps
if errorlevel 1 (
    echo ERROR: omnizart install failed.
    rmdir /s /q "!OMNI_ENV!"
    goto :skip_omnizart
)

echo       Installing remaining omnizart deps ^(jsonschema, sherpa-onnx, tf-keras, etc.^)...
"!OMNI_ENV!\Scripts\pip.exe" install jsonschema tqdm Pillow matplotlib sherpa-onnx tf-keras
if errorlevel 1 (
    echo WARNING: Some optional deps failed. omnizart may still work.
)

:download_models
echo.
echo [4/5] Pre-loading omnizart music model ^(auto-downloads ~300 MB on first use^)...
"!OMNI_ENV!\Scripts\python.exe" -c "from omnizart.music import app; print('omnizart ready')" 2>nul
if errorlevel 1 (
    echo WARNING: omnizart import check failed. Will retry on first transcription.
)

echo       omnizart ready.
goto :done_omnizart

:skip_omnizart
echo       Skipping omnizart setup.

:done_omnizart
echo.

:: ── 4. Write .env so launch script knows paths ───────────────────────────────
echo [5/5] Writing launch configuration...

if exist "C:\omnizart_env\Scripts\python.exe" (
    echo OMNIZART_PYTHON=C:\omnizart_env\Scripts\python.exe> .env.local
    echo       omnizart path saved to .env.local
) else (
    if exist .env.local del .env.local
    echo       No omnizart env -- .env.local not written.
)

:: Mark setup complete
echo %date% %time%> .setup_complete

echo.
echo ============================================================
echo   Setup complete!
echo   Run "Launch Aegis.bat" to start the app.
echo ============================================================
echo.
pause
