@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

:: Auto-run setup on first launch
if not exist ".setup_complete" (
    echo First launch detected -- running setup...
    echo.
    call setup.bat
    if errorlevel 1 (
        echo Setup failed. Please fix errors above and try again.
        pause & exit /b 1
    )
)

:: Load omnizart path from .env.local if present
if exist ".env.local" (
    for /f "tokens=1,* delims==" %%a in (.env.local) do (
        if "%%a"=="OMNIZART_PYTHON" set OMNIZART_PYTHON=%%b
    )
)

:: Validate omnizart path still exists (venv may have been deleted)
if defined OMNIZART_PYTHON (
    if not exist "!OMNIZART_PYTHON!" (
        echo WARNING: OMNIZART_PYTHON path not found: !OMNIZART_PYTHON!
        echo          omnizart disabled. Re-run setup.bat to reinstall.
        set OMNIZART_PYTHON=
    )
)

if defined OMNIZART_PYTHON (
    echo omnizart: enabled ^(!OMNIZART_PYTHON!^)
) else (
    echo omnizart: disabled ^(install Python 3.9 + run setup.bat to enable^)
)

echo.
npm start
