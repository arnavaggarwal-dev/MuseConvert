"""
Aegis Score Studio — desktop entry point
Launches PySide6 window + embedded FastAPI backend on a background thread.
"""
from __future__ import annotations

import sys
import threading
import uvicorn
from PySide6.QtWidgets import QApplication
from PySide6.QtQml import QQmlApplicationEngine
from PySide6.QtCore import QUrl, Qt

from backend.api.app import create_app
from backend.bridge import AppBridge


def _run_backend(host: str = "127.0.0.1", port: int = 7471) -> None:
    fastapi_app = create_app()
    uvicorn.run(fastapi_app, host=host, port=port, log_level="warning")


def main() -> int:
    # High-DPI + QML style
    QApplication.setHighDpiScaleFactorRoundingPolicy(
        Qt.HighDpiScaleFactorRoundingPolicy.PassThrough
    )
    app = QApplication(sys.argv)
    app.setApplicationName("Aegis Score Studio")
    app.setOrganizationName("AegisAudio")
    app.setApplicationVersion("0.1.0")

    # Start backend
    backend_thread = threading.Thread(
        target=_run_backend, daemon=True, name="aegis-backend"
    )
    backend_thread.start()

    # QML engine
    engine = QQmlApplicationEngine()
    bridge = AppBridge(parent=app)
    engine.rootContext().setContextProperty("AppBridge", bridge)
    engine.load(QUrl("frontend/qml/views/MainWindow.qml"))

    if not engine.rootObjects():
        return 1

    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
