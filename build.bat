@echo off
cd /d "%~dp0"

echo [1/3] Checking PyInstaller...
python -m PyInstaller --version >nul 2>&1
if errorlevel 1 (
    echo Installing PyInstaller...
    pip install pyinstaller
)

echo [2/3] Bundling Python server...
python -m PyInstaller server_launch.spec --noconfirm --distpath dist
if errorlevel 1 ( echo PyInstaller failed & pause & exit /b 1 )

echo [3/3] Building Electron installer...
npm run build
if errorlevel 1 ( echo electron-builder failed & pause & exit /b 1 )

echo.
echo Done! Installer is in dist\
pause
