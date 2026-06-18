from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from backend.services.pipeline import JOBS

router = APIRouter()


@router.get("/status/{sid}")
async def status(sid: str):
    job = JOBS.get(sid)
    if not job:
        raise HTTPException(404, "session not found")
    return JSONResponse(job)
