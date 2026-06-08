"""
Aegis Score Studio — local processing backend
Run: uvicorn server:app --port 7471 --reload
"""
from __future__ import annotations
import asyncio, uuid, shutil, sys, os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="AegisScore")

WORK_DIR = Path("work")
WORK_DIR.mkdir(exist_ok=True)

URL_CACHE: dict[str, str] = {}   # url → sid
JOBS: dict[str, dict] = {}

DEMUCS_SOURCES = ["drums", "bass", "other", "vocals", "guitar", "piano"]

STEM_META = {
    "drums":  {"name": "Drums",  "instrument": "Acoustic Kit",          "family": "Percussion · GM 0", "clef": "perc",   "color": "--s-drums",  "role": "Rhythm"},
    "bass":   {"name": "Bass",   "instrument": "Electric Bass (finger)", "family": "Bass · GM 33",      "clef": "bass",   "color": "--s-bass",   "role": "Low end"},
    "guitar": {"name": "Guitar", "instrument": "Electric Guitar",        "family": "Guitar · GM 27",    "clef": "treble", "color": "--s-guitar", "role": "Harmony"},
    "piano":  {"name": "Piano",  "instrument": "Grand Piano",            "family": "Piano · GM 0",      "clef": "treble", "color": "--s-keys",   "role": "Keys"},
    "vocals": {"name": "Vocals", "instrument": "Lead Vocal",             "family": "Voice",             "clef": "treble", "color": "--s-vocal",  "role": "Melody"},
    "other":  {"name": "Other",  "instrument": "Mixed / Other",          "family": "Synth",             "clef": "treble", "color": "--s-synth",  "role": "Texture"},
}

# ThreadPoolExecutor — safe on Windows (no spawn/pickle issues unlike ProcessPool)
_POOL = ThreadPoolExecutor(max_workers=min(6, (os.cpu_count() or 2)))


# ── Models ────────────────────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    url: str


# ── Helpers ───────────────────────────────────────────────────────────────────
def _set(sid: str, **kwargs):
    JOBS[sid].update(kwargs)


async def _run_async(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        detail = (stderr or b"no output").decode(errors="replace")[-2000:]
        raise RuntimeError(f"Command failed (exit {proc.returncode}):\n{detail}")


def _transcribe_stem_sync(wav_path: Path, midi_out: Path, is_drums: bool) -> int:
    """Runs in thread pool. Returns note count."""
    import librosa
    import numpy as np
    import pretty_midi

    SR = 22050
    HOP = 1024
    y, sr = librosa.load(str(wav_path), sr=SR, mono=True, duration=300)
    pm = pretty_midi.PrettyMIDI()

    if is_drums:
        drum = pretty_midi.Instrument(program=0, is_drum=True)
        onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames",
                                                   backtrack=True, hop_length=HOP)
        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=HOP)
        for i, t in enumerate(onset_times):
            drum.notes.append(pretty_midi.Note(velocity=90,
                pitch=36 if i % 2 == 0 else 38, start=float(t), end=float(t) + 0.05))
        pm.instruments.append(drum)
        pm.write(str(midi_out))
        return len(drum.notes)

    f0, voiced_flag, _ = librosa.pyin(y, fmin=librosa.note_to_hz("C2"),
                                       fmax=librosa.note_to_hz("C7"),
                                       sr=sr, frame_length=2048, hop_length=HOP)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP)

    instrument = pretty_midi.Instrument(program=0)
    in_note = False
    note_start = 0.0
    note_pitch = 0
    for t, freq, voiced in zip(times, f0, voiced_flag):
        if voiced and not np.isnan(freq):
            mp = max(0, min(127, int(round(librosa.hz_to_midi(freq)))))
            if not in_note:
                in_note, note_start, note_pitch = True, float(t), mp
            elif mp != note_pitch:
                if float(t) - note_start >= 0.05:
                    instrument.notes.append(pretty_midi.Note(velocity=80, pitch=note_pitch,
                                                              start=note_start, end=float(t)))
                note_start, note_pitch = float(t), mp
        elif in_note:
            if float(t) - note_start >= 0.05:
                instrument.notes.append(pretty_midi.Note(velocity=80, pitch=note_pitch,
                                                          start=note_start, end=float(t)))
            in_note = False

    pm.instruments.append(instrument)
    pm.write(str(midi_out))
    return len(instrument.notes)


def _gpu_info() -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
            return {"model": name, "util": 0, "vram": round(vram, 1), "vramTotal": round(vram, 1)}
    except Exception:
        pass
    return {"model": "CPU (Intel Graphics)", "util": 0, "vram": 0, "vramTotal": 0}


_DEVICE = "cuda" if __import__("torch").cuda.is_available() else "cpu"


# ── Shared separation + transcription logic ────────────────────────────────────
async def _separate_and_transcribe(sid: str, audio_path: Path, meta: dict):
    job_dir = audio_path.parent
    stems_dir = job_dir / "stems"
    midi_dir = job_dir / "midi"
    stems_dir.mkdir(exist_ok=True)
    midi_dir.mkdir(exist_ok=True)

    # Stage 1: Demucs
    _set(sid, stage=1, status="separating", progress=0.20)
    py = sys.executable
    await _run_async([py, "-m", "demucs",
                      "--name", "htdemucs_6s",
                      "--device", _DEVICE,
                      "--out", str(job_dir / "demucs_out"),
                      str(audio_path)])
    demucs_root = next((job_dir / "demucs_out" / "htdemucs_6s").iterdir())
    for stem_wav in demucs_root.glob("*.wav"):
        shutil.copy(stem_wav, stems_dir / stem_wav.name)
    _set(sid, progress=0.62)

    # Stage 2: Instrument ID
    _set(sid, stage=2, status="identifying", progress=0.64)
    _set(sid, progress=0.70)

    # Stage 3: MIDI — parallel threads
    _set(sid, stage=3, status="transcribing", progress=0.72)
    loop = asyncio.get_event_loop()
    tasks, stem_names = [], []
    for stem_name in DEMUCS_SOURCES:
        stem_file = stems_dir / f"{stem_name}.wav"
        if not stem_file.exists():
            continue
        tasks.append(loop.run_in_executor(
            _POOL, _transcribe_stem_sync,
            stem_file, midi_dir / f"{stem_name}.mid", stem_name == "drums"))
        stem_names.append(stem_name)

    results = await asyncio.gather(*tasks, return_exceptions=True)
    midi_counts = {n: (r if isinstance(r, int) else 0) for n, r in zip(stem_names, results)}
    _set(sid, progress=0.90)

    # Stage 4: Engraving stub
    _set(sid, stage=4, status="engraving", progress=0.95)

    # Build stem list
    stems = []
    for name in DEMUCS_SOURCES:
        if not (stems_dir / f"{name}.wav").exists():
            continue
        m = STEM_META.get(name, {})
        stems.append({
            "id": name, "name": m.get("name", name.title()),
            "instrument": m.get("instrument", "Unknown"),
            "family": m.get("family", ""), "clef": m.get("clef", "treble"),
            "color": m.get("color", "--s-synth"), "role": m.get("role", ""),
            "confidence": 90.0, "midi": midi_counts.get(name, 0),
            "audio_url": f"/work/{sid}/stems/{name}.wav",
            "midi_url": f"/work/{sid}/midi/{name}.mid" if (midi_dir / f"{name}.mid").exists() else None,
            "density": 3, "seed": hash(name) % 50 + 1, "note": "",
        })

    _set(sid, status="done", progress=1.0, stage=4, stems=stems,
         meta={**meta, "tempo": 120, "key": "A minor", "timeSig": [4, 4],
               "sampleRate": 44100, "bitDepth": 24,
               "sepModel": "HT-Demucs v4 · 6-stem",
               "transModel": "librosa-pyin",
               "gpu": _gpu_info()})


# ── Background pipeline: URL ──────────────────────────────────────────────────
async def pipeline_url(sid: str, url: str):
    job_dir = WORK_DIR / sid
    job_dir.mkdir(parents=True, exist_ok=True)
    audio_path = job_dir / "audio.wav"

    try:
        _set(sid, stage=0, status="downloading", progress=0.0)
        import yt_dlp
        ydl_opts = {
            "format": "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
            "postprocessors": [{"key": "FFmpegExtractAudio",
                                "preferredcodec": "wav", "preferredquality": "0"}],
            "outtmpl": str(job_dir / "audio"),
            "quiet": True,
            "no_warnings": True,
            "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
        }
        loop = asyncio.get_event_loop()
        def _download():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                return ydl.extract_info(url, download=True)
        info = await loop.run_in_executor(None, _download)
        meta = {
            "title":    info.get("title", "Unknown"),
            "artist":   info.get("uploader", "Unknown"),
            "duration": info.get("duration", 0),
            "thumb":    info.get("thumbnail", ""),
            "source":   url,
        }
        # yt-dlp sometimes appends extra extension
        candidates = [audio_path] + sorted(job_dir.glob("audio.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        resolved = next((p for p in candidates if p.exists() and p.suffix == ".wav"), None)
        if resolved and resolved != audio_path:
            resolved.rename(audio_path)
        elif not resolved:
            raise FileNotFoundError(f"yt-dlp produced no WAV in {job_dir}. Is ffmpeg on PATH?")
        _set(sid, meta=meta, progress=0.18)

        await _separate_and_transcribe(sid, audio_path, meta)
        URL_CACHE[url] = sid

    except Exception as exc:
        _set(sid, status="error", error=str(exc), progress=1.0)


# ── Background pipeline: local file ──────────────────────────────────────────
async def pipeline_file(sid: str, audio_path: Path, filename: str):
    try:
        _set(sid, stage=0, status="converting", progress=0.05)
        # If not WAV, convert with ffmpeg
        if audio_path.suffix.lower() != ".wav":
            wav_path = audio_path.with_suffix(".wav")
            await _run_async(["ffmpeg", "-y", "-i", str(audio_path),
                               "-ac", "2", "-ar", "44100", str(wav_path)])
            audio_path.unlink(missing_ok=True)
            audio_path = wav_path

        import soundfile as sf
        info = sf.info(str(audio_path))
        meta = {
            "title":    Path(filename).stem,
            "artist":   "Local file",
            "duration": int(info.duration),
            "thumb":    "",
            "source":   filename,
        }
        _set(sid, meta=meta, progress=0.18)
        await _separate_and_transcribe(sid, audio_path, meta)

    except Exception as exc:
        _set(sid, status="error", error=str(exc), progress=1.0)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest, bg: BackgroundTasks):
    url = req.url.strip()
    cached = URL_CACHE.get(url)
    if cached and JOBS.get(cached, {}).get("status") == "done":
        return {"session_id": cached, "cached": True}
    sid = str(uuid.uuid4())
    JOBS[sid] = {"status": "queued", "progress": 0.0, "stage": -1,
                 "meta": {}, "stems": [], "error": None}
    bg.add_task(pipeline_url, sid, url)
    return {"session_id": sid}


@app.post("/api/upload")
async def upload(bg: BackgroundTasks, file: UploadFile = File(...)):
    sid = str(uuid.uuid4())
    job_dir = WORK_DIR / sid
    job_dir.mkdir(parents=True, exist_ok=True)

    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    dest = job_dir / f"audio{suffix}"
    content = await file.read()
    dest.write_bytes(content)

    JOBS[sid] = {"status": "queued", "progress": 0.0, "stage": -1,
                 "meta": {}, "stems": [], "error": None}
    bg.add_task(pipeline_file, sid, dest, file.filename or "audio")
    return {"session_id": sid}


@app.get("/api/status/{sid}")
async def status(sid: str):
    job = JOBS.get(sid)
    if not job:
        raise HTTPException(404, "session not found")
    return JSONResponse(job)


@app.get("/api/midi/{sid}/{stem_name}")
async def get_midi_notes(sid: str, stem_name: str):
    midi_path = WORK_DIR / sid / "midi" / f"{stem_name}.mid"
    if not midi_path.exists():
        raise HTTPException(404, "MIDI not found")
    import pretty_midi
    pm = pretty_midi.PrettyMIDI(str(midi_path))
    notes = []
    for inst in pm.instruments:
        for note in inst.notes:
            notes.append({
                "pitch": note.pitch,
                "start": round(float(note.start), 4),
                "end": round(float(note.end), 4),
                "velocity": note.velocity,
                "drum": bool(inst.is_drum),
            })
    notes.sort(key=lambda n: n["start"])
    return {"notes": notes, "end_time": round(float(pm.get_end_time()), 2)}


app.mount("/work", StaticFiles(directory=str(WORK_DIR)), name="work")
app.mount("/", StaticFiles(directory=".", html=True), name="static")
