from __future__ import annotations

import uuid
from pathlib import Path
from fastapi import APIRouter, BackgroundTasks, UploadFile, File
from backend.models.schemas import JobState
from backend.services.pipeline import JOBS, WORK_DIR, pipeline_file

router = APIRouter()


@router.post("/upload")
async def upload(bg: BackgroundTasks, file: UploadFile = File(...)):
    sid = str(uuid.uuid4())
    job_dir = WORK_DIR / sid
    job_dir.mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    dest = job_dir / f"audio{suffix}"
    dest.write_bytes(await file.read())
    JOBS[sid] = JobState().model_dump()
    bg.add_task(pipeline_file, sid, dest, file.filename or "audio")
    return {"session_id": sid}
