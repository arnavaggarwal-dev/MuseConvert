from __future__ import annotations

import uuid
from fastapi import APIRouter, BackgroundTasks
from backend.models.schemas import AnalyzeRequest, JobState, JobStatus
from backend.services.pipeline import JOBS, URL_CACHE, pipeline_url

router = APIRouter()


@router.post("/analyze")
async def analyze(req: AnalyzeRequest, bg: BackgroundTasks):
    url = req.url.strip()
    cached = URL_CACHE.get(url)
    if cached and JOBS.get(cached, {}).get("status") == JobStatus.DONE:
        return {"session_id": cached, "cached": True}
    sid = str(uuid.uuid4())
    JOBS[sid] = JobState().model_dump()
    bg.add_task(pipeline_url, sid, url)
    return {"session_id": sid}
