"""
AppBridge — Qt object exposed to QML via setContextProperty.
QML calls methods here; signals fire back to QML reactively.
All heavy work delegated to FastAPI backend via HTTP (localhost).
"""
from __future__ import annotations

import json
import urllib.request
import urllib.parse
from PySide6.QtCore import QObject, Signal, Slot, Property, QTimer


BACKEND = "http://127.0.0.1:7471"


def _post(path: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        BACKEND + path, data=data,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read())


def _get(path: str) -> dict:
    with urllib.request.urlopen(BACKEND + path, timeout=10) as r:
        return json.loads(r.read())


class AppBridge(QObject):
    # Signals → QML
    sessionStarted  = Signal(str)           # session_id
    progressChanged = Signal(float, int, str)  # progress, stage, status
    analysisReady   = Signal("QVariant")    # full job dict
    errorOccurred   = Signal(str)

    def __init__(self, parent=None):
        super().__init__(parent)
        self._sid: str | None = None
        self._poll_timer = QTimer(self)
        self._poll_timer.setInterval(800)
        self._poll_timer.timeout.connect(self._poll)

    # ── QML-callable slots ────────────────────────────────────────────────────

    @Slot(str)
    def analyzeUrl(self, url: str) -> None:
        try:
            resp = _post("/api/analyze", {"url": url.strip()})
            self._sid = resp["session_id"]
            self.sessionStarted.emit(self._sid)
            self._poll_timer.start()
        except Exception as e:
            self.errorOccurred.emit(str(e))

    @Slot(str)
    def openLocalFile(self, path: str) -> None:
        """QML passes native file path; bridge uploads to backend."""
        import urllib.request
        # multipart upload
        boundary = "AegisBoundary42"
        with open(path, "rb") as f:
            file_data = f.read()
        filename = path.split("/")[-1].split("\\")[-1]
        body = (
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; "
            f"filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request(
            BACKEND + "/api/upload", data=body,
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                resp = json.loads(r.read())
            self._sid = resp["session_id"]
            self.sessionStarted.emit(self._sid)
            self._poll_timer.start()
        except Exception as e:
            self.errorOccurred.emit(str(e))

    @Slot(str, str, result="QVariant")
    def getMidiNotes(self, sid: str, stem_id: str) -> dict:
        try:
            return _get(f"/api/midi/{sid}/{stem_id}")
        except Exception:
            return {"notes": [], "end_time": 0.0}

    @Slot()
    def cancelSession(self) -> None:
        self._poll_timer.stop()
        self._sid = None

    # ── Polling ───────────────────────────────────────────────────────────────

    def _poll(self) -> None:
        if not self._sid:
            self._poll_timer.stop()
            return
        try:
            job = _get(f"/api/status/{self._sid}")
        except Exception:
            return
        self.progressChanged.emit(
            job.get("progress", 0.0),
            job.get("stage", -1),
            job.get("status", ""),
        )
        if job.get("status") in ("done", "error"):
            self._poll_timer.stop()
            if job["status"] == "done":
                job["session_id"] = self._sid
                self.analysisReady.emit(job)
            else:
                self.errorOccurred.emit(job.get("error") or "Unknown error")
