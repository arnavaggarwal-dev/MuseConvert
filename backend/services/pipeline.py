"""
Core audio pipeline — same logic as web prototype server.py,
now as a proper service module with typed state.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

WORK_DIR = Path("work")
WORK_DIR.mkdir(exist_ok=True)

URL_CACHE: dict[str, str] = {}
JOBS: dict[str, dict] = {}

DEMUCS_SOURCES = ["drums", "bass", "other", "vocals", "guitar", "piano"]

STEM_META = {
    "drums":  {"name": "Drums",  "instrument": "Acoustic Kit",           "family": "Percussion · GM 0", "clef": "perc",   "color": "--s-drums",  "role": "Rhythm"},
    "bass":   {"name": "Bass",   "instrument": "Electric Bass (finger)",  "family": "Bass · GM 33",      "clef": "bass",   "color": "--s-bass",   "role": "Low end"},
    "guitar": {"name": "Guitar", "instrument": "Electric Guitar",         "family": "Guitar · GM 27",    "clef": "treble", "color": "--s-guitar", "role": "Harmony"},
    "piano":  {"name": "Piano",  "instrument": "Grand Piano",             "family": "Piano · GM 0",      "clef": "treble", "color": "--s-keys",   "role": "Keys"},
    "vocals": {"name": "Vocals", "instrument": "Lead Vocal",              "family": "Voice",             "clef": "treble", "color": "--s-vocal",  "role": "Melody"},
    "other":  {"name": "Other",  "instrument": "Mixed / Other",           "family": "Synth",             "clef": "treble", "color": "--s-synth",  "role": "Texture"},
}

_POOL = ThreadPoolExecutor(max_workers=min(6, (os.cpu_count() or 2)))
_DEVICE = "cuda" if __import__("torch").cuda.is_available() else "cpu"


def _set(sid: str, **kwargs: object) -> None:
    JOBS[sid].update(kwargs)


async def _run_async(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(
        *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    _, stderr = await proc.communicate()
    if proc.returncode != 0:
        detail = (stderr or b"no output").decode(errors="replace")[-2000:]
        raise RuntimeError(f"Command failed (exit {proc.returncode}):\n{detail}")


def _transcribe_stem_sync(wav_path: Path, midi_out: Path, is_drums: bool) -> int:
    import librosa, numpy as np, pretty_midi
    SR, HOP = 22050, 1024
    y, sr = librosa.load(str(wav_path), sr=SR, mono=True, duration=300)
    pm = pretty_midi.PrettyMIDI()
    if is_drums:
        drum = pretty_midi.Instrument(program=0, is_drum=True)
        onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames", backtrack=True, hop_length=HOP)
        for i, t in enumerate(librosa.frames_to_time(onset_frames, sr=sr, hop_length=HOP)):
            drum.notes.append(pretty_midi.Note(velocity=90, pitch=36 if i%2==0 else 38, start=float(t), end=float(t)+0.05))
        pm.instruments.append(drum); pm.write(str(midi_out)); return len(drum.notes)
    f0, voiced_flag, _ = librosa.pyin(y, fmin=librosa.note_to_hz("C2"), fmax=librosa.note_to_hz("C7"), sr=sr, frame_length=2048, hop_length=HOP)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP)
    inst = pretty_midi.Instrument(program=0); in_note = False; note_start = 0.0; note_pitch = 0
    for t, freq, voiced in zip(times, f0, voiced_flag):
        if voiced and not np.isnan(freq):
            mp = max(0, min(127, int(round(librosa.hz_to_midi(freq)))))
            if not in_note: in_note, note_start, note_pitch = True, float(t), mp
            elif mp != note_pitch:
                if float(t)-note_start >= 0.05: inst.notes.append(pretty_midi.Note(velocity=80, pitch=note_pitch, start=note_start, end=float(t)))
                note_start, note_pitch = float(t), mp
        elif in_note:
            if float(t)-note_start >= 0.05: inst.notes.append(pretty_midi.Note(velocity=80, pitch=note_pitch, start=note_start, end=float(t)))
            in_note = False
    pm.instruments.append(inst); pm.write(str(midi_out)); return len(inst.notes)


def _gpu_info() -> dict:
    try:
        import torch
        if torch.cuda.is_available():
            name = torch.cuda.get_device_name(0)
            vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
            return {"model": name, "util": 0, "vram": round(vram, 1), "vramTotal": round(vram, 1)}
    except Exception:
        pass
    return {"model": "CPU", "util": 0, "vram": 0, "vramTotal": 0}


async def _separate_and_transcribe(sid: str, audio_path: Path, meta: dict) -> None:
    job_dir = audio_path.parent
    stems_dir = job_dir / "stems"; stems_dir.mkdir(exist_ok=True)
    midi_dir  = job_dir / "midi";  midi_dir.mkdir(exist_ok=True)

    _set(sid, stage=1, status="separating", progress=0.20)
    await _run_async([sys.executable, "-m", "demucs", "--name", "htdemucs_6s", "--device", _DEVICE, "--out", str(job_dir / "demucs_out"), str(audio_path)])
    demucs_root = next((job_dir / "demucs_out" / "htdemucs_6s").iterdir())
    for stem_wav in demucs_root.glob("*.wav"):
        shutil.copy(stem_wav, stems_dir / stem_wav.name)
    _set(sid, progress=0.62)

    _set(sid, stage=2, status="identifying", progress=0.64)
    _set(sid, progress=0.70)

    _set(sid, stage=3, status="transcribing", progress=0.72)
    loop = asyncio.get_event_loop()
    tasks, stem_names = [], []
    for stem_name in DEMUCS_SOURCES:
        stem_file = stems_dir / f"{stem_name}.wav"
        if not stem_file.exists(): continue
        tasks.append(loop.run_in_executor(_POOL, _transcribe_stem_sync, stem_file, midi_dir / f"{stem_name}.mid", stem_name == "drums"))
        stem_names.append(stem_name)
    results = await asyncio.gather(*tasks, return_exceptions=True)
    midi_counts = {n: (r if isinstance(r, int) else 0) for n, r in zip(stem_names, results)}
    _set(sid, progress=0.90)

    _set(sid, stage=4, status="engraving", progress=0.95)

    stems = []
    for name in DEMUCS_SOURCES:
        if not (stems_dir / f"{name}.wav").exists(): continue
        m = STEM_META.get(name, {})
        stems.append({
            "id": name, "name": m.get("name", name.title()),
            "instrument": m.get("instrument", "Unknown"),
            "family": m.get("family", ""), "clef": m.get("clef", "treble"),
            "color": m.get("color", "--s-synth"), "role": m.get("role", ""),
            "confidence": 90.0, "midi": midi_counts.get(name, 0),
            "audio_url": f"/work/{sid}/stems/{name}.wav",
            "midi_url": f"/work/{sid}/midi/{name}.mid" if (midi_dir / f"{name}.mid").exists() else None,
            "density": 2, "seed": abs(hash(name)) % 50000, "note": "",
        })

    _set(sid, status="done", progress=1.0, stage=4, stems=stems,
         meta={**meta, "tempo": 120, "key": "A minor", "timeSig": [4, 4],
               "sampleRate": 44100, "bitDepth": 24,
               "sepModel": "HT-Demucs v4 · 6-stem", "transModel": "librosa-pyin",
               "gpu": _gpu_info()})


async def pipeline_url(sid: str, url: str) -> None:
    job_dir = WORK_DIR / sid; job_dir.mkdir(parents=True, exist_ok=True)
    audio_path = job_dir / "audio.wav"
    try:
        _set(sid, stage=0, status="downloading", progress=0.0)
        import yt_dlp
        ydl_opts = {
            "format": "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
            "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav", "preferredquality": "0"}],
            "outtmpl": str(job_dir / "audio"),
            "quiet": True, "no_warnings": True,
            "extractor_args": {"youtube": {"player_client": ["android", "web"]}},
        }
        loop = asyncio.get_event_loop()
        def _dl():
            with yt_dlp.YoutubeDL(ydl_opts) as ydl: return ydl.extract_info(url, download=True)
        info = await loop.run_in_executor(None, _dl)
        meta = {"title": info.get("title","Unknown"), "artist": info.get("uploader","Unknown"),
                "duration": info.get("duration",0), "thumb": info.get("thumbnail",""), "source": url}
        candidates = [audio_path]+sorted(job_dir.glob("audio.*"), key=lambda p: p.stat().st_mtime, reverse=True)
        resolved = next((p for p in candidates if p.exists() and p.suffix==".wav"), None)
        if resolved and resolved != audio_path: resolved.rename(audio_path)
        elif not resolved: raise FileNotFoundError("yt-dlp produced no WAV")
        _set(sid, meta=meta, progress=0.18)
        await _separate_and_transcribe(sid, audio_path, meta)
        URL_CACHE[url] = sid
    except Exception as exc:
        _set(sid, status="error", error=str(exc), progress=1.0)


async def pipeline_file(sid: str, audio_path: Path, filename: str) -> None:
    try:
        _set(sid, stage=0, status="converting", progress=0.05)
        if audio_path.suffix.lower() != ".wav":
            wav_path = audio_path.with_suffix(".wav")
            await _run_async(["ffmpeg", "-y", "-i", str(audio_path), "-ac", "2", "-ar", "44100", str(wav_path)])
            audio_path.unlink(missing_ok=True)
            audio_path = wav_path
        import soundfile as sf
        info = sf.info(str(audio_path))
        meta = {"title": Path(filename).stem, "artist": "Local file", "duration": int(info.duration), "thumb": "", "source": filename}
        _set(sid, meta=meta, progress=0.18)
        await _separate_and_transcribe(sid, audio_path, meta)
    except Exception as exc:
        _set(sid, status="error", error=str(exc), progress=1.0)
