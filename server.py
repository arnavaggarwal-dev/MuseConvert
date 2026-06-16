"""
Aegis Score Studio — local processing backend
Run: uvicorn server:app --port 7471 --reload
"""
from __future__ import annotations
import asyncio, uuid, shutil, sys, os, time, traceback, threading, math
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

# Store all AI model weights in models/ next to server.py (visible, portable)
_MODELS_DIR = Path(__file__).parent / "models"
_MODELS_DIR.mkdir(exist_ok=True)
os.environ.setdefault("TORCH_HOME", str(_MODELS_DIR))

def _bg_update_ytdlp():
    """Silently update yt-dlp in background on startup — YouTube API changes frequently."""
    try:
        import subprocess
        subprocess.run([sys.executable, "-m", "pip", "install", "-U", "yt-dlp", "-q"],
                       capture_output=True, timeout=120)
    except Exception:
        pass

threading.Thread(target=_bg_update_ytdlp, daemon=True).start()

from fastapi import FastAPI, BackgroundTasks, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="AegisScore")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

WORK_DIR = Path(os.environ.get("AEGIS_WORK_DIR", "work"))
WORK_DIR.mkdir(exist_ok=True, parents=True)

URL_CACHE: dict[str, str] = {}   # url → sid
JOBS: dict[str, dict] = {}

# Rebuild URL_CACHE from persisted sessions on startup
def _rebuild_cache():
    import json as _json
    for sf in WORK_DIR.glob("*/session.json"):
        try:
            j = _json.loads(sf.read_text(encoding="utf-8"))
            if j.get("status") == "done":
                src = j.get("meta", {}).get("source", "")
                if src.startswith("http"):
                    URL_CACHE[src] = sf.parent.name
                JOBS[sf.parent.name] = j
        except Exception:
            pass

_rebuild_cache()

DEMUCS_SOURCES = ["drums", "bass", "other", "vocals", "guitar", "piano"]

STEM_META = {
    "drums":  {"name": "Drums",  "instrument": "Acoustic Kit",          "family": "Percussion · GM 0", "clef": "perc",   "color": "--s-drums",  "role": "Rhythm"},
    "bass":   {"name": "Bass",   "instrument": "Electric Bass (finger)", "family": "Bass · GM 33",      "clef": "bass",   "color": "--s-bass",   "role": "Low end"},
    "guitar": {"name": "Guitar", "instrument": "Electric Guitar",        "family": "Guitar · GM 27",    "clef": "treble", "color": "--s-guitar", "role": "Harmony"},
    "piano":  {"name": "Piano",  "instrument": "Grand Piano",            "family": "Piano · GM 0",      "clef": "treble", "color": "--s-keys",   "role": "Keys"},
    "vocals": {"name": "Vocals", "instrument": "Lead Vocal",             "family": "Voice",             "clef": "treble", "color": "--s-vocal",  "role": "Melody"},
    "other":  {"name": "Other",  "instrument": "Mixed / Other",          "family": "Synth",             "clef": "treble", "color": "--s-synth",  "role": "Texture"},
}


def _classify_stem_sync(stem_name: str, wav_path: Path, midi_path: Path) -> dict:
    """Detect silence, classify 'other' stem, set clef from actual MIDI pitch range."""
    import librosa, numpy as np
    SR = 22050

    base = dict(STEM_META.get(stem_name, {}))  # start from defaults

    try:
        y, _ = librosa.load(str(wav_path), sr=SR, mono=True, duration=60)
        rms = float(np.sqrt(np.mean(y ** 2)))

        # Silence — stem physically absent / near-zero
        if rms < 0.0015:
            base["removed"] = True
            return base
        base["removed"] = False

        # ── Clef from actual MIDI pitch range (beats hardcoded clef) ──────────
        if stem_name != "drums" and midi_path.exists():
            try:
                import pretty_midi
                pm = pretty_midi.PrettyMIDI(str(midi_path))
                pitches = [n.pitch for inst in pm.instruments for n in inst.notes]
                if pitches:
                    median_p = float(np.median(pitches))
                    base["clef"] = "bass" if median_p < 52 else "treble"
            except Exception:
                pass

        # ── "other" stem: identify from spectral features ─────────────────────
        if stem_name == "other":
            centroid  = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=SR)))
            bandwidth = float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=SR)))
            zcr       = float(np.mean(librosa.feature.zero_crossing_rate(y)))
            y_harm    = librosa.effects.harmonic(y=y)
            harmonic  = float(np.mean(y_harm ** 2)) / max(1e-9, float(np.mean(y ** 2)))

            if centroid < 400:
                base.update({"name": "Cello",        "instrument": "Cello",         "family": "Low Strings · GM 42", "clef": "bass",   "color": "--s-bass",   "role": "Low end"})
            elif centroid < 900 and harmonic > 0.4:
                base.update({"name": "Viola",        "instrument": "Viola",         "family": "Strings · GM 41",     "clef": "treble", "color": "--s-synth",  "role": "Harmony"})
            elif centroid < 1800 and harmonic > 0.5:
                base.update({"name": "Strings",      "instrument": "String Ensemble","family": "Strings · GM 48",    "clef": "treble", "color": "--s-synth",  "role": "Texture"})
            elif centroid < 1600 and zcr < 0.04:
                base.update({"name": "Pad",          "instrument": "Synth Pad",     "family": "Pad · GM 88",         "clef": "treble", "color": "--s-synth",  "role": "Texture"})
            elif centroid < 2400 and harmonic > 0.35:
                base.update({"name": "Brass",        "instrument": "Brass Section", "family": "Brass · GM 61",       "clef": "treble", "color": "--s-synth",  "role": "Harmony"})
            elif centroid > 3500 and zcr < 0.06:
                base.update({"name": "Flute",        "instrument": "Flute",         "family": "Woodwind · GM 73",    "clef": "treble", "color": "--s-synth",  "role": "Melody"})
            elif zcr > 0.10:
                base.update({"name": "Synth Lead",   "instrument": "Synth Lead",    "family": "Synth · GM 80",       "clef": "treble", "color": "--s-synth",  "role": "Texture"})
            else:
                base.update({"name": "Keys / Other", "instrument": "Electric Piano","family": "Keys · GM 4",         "clef": "treble", "color": "--s-keys",   "role": "Texture"})

        # ── Acoustic guitar vs electric heuristic ─────────────────────────────
        elif stem_name == "guitar":
            centroid = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=SR)))
            zcr      = float(np.mean(librosa.feature.zero_crossing_rate(y)))
            if centroid < 1200 and zcr < 0.05:
                base.update({"name": "Acoustic Guitar", "instrument": "Acoustic Guitar", "family": "Guitar · GM 25"})

    except Exception:
        pass

    return base

# ThreadPoolExecutor — safe on Windows (no spawn/pickle issues unlike ProcessPool)
_POOL = ThreadPoolExecutor(max_workers=min(6, (os.cpu_count() or 2)))


# ── Models ────────────────────────────────────────────────────────────────────
class AnalyzeRequest(BaseModel):
    url: str
    force: bool = False


# ── Helpers ───────────────────────────────────────────────────────────────────
def _set(sid: str, **kwargs):
    JOBS[sid].update(kwargs)
    # Persist completed/failed jobs to disk so they survive a server restart
    if kwargs.get("status") in ("done", "error"):
        try:
            import json as _json
            (WORK_DIR / sid / "session.json").write_text(
                _json.dumps(JOBS[sid], default=str), encoding="utf-8"
            )
        except Exception:
            pass


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


# GM program per stem for correct MuseScore instrument assignment
_STEM_PROGRAM = {
    "bass":   33,  # Electric Bass (finger)
    "guitar": 25,  # Acoustic Guitar (nylon) — overridden to 27 (clean electric) if classified
    "piano":  0,   # Acoustic Grand Piano
    "vocals": 52,  # Choir Aahs
    "other":  48,  # String Ensemble 1
}


def _transcribe_stem_sync(wav_path: Path, midi_out: Path, is_drums: bool, tempo: float = 120.0) -> tuple:
    """Runs in thread pool. Returns (note_count, confidence_pct)."""
    import librosa
    import numpy as np
    import pretty_midi

    job_dir = wav_path.parent.parent
    SR = 22050
    HOP = 2048
    stem_name = wav_path.stem
    _log(job_dir, f"--- MIDI TRANSCRIPTION: {stem_name} ---")

    if is_drums:
        y, sr = librosa.load(str(wav_path), sr=SR, mono=True, duration=300)
        pm = pretty_midi.PrettyMIDI(initial_tempo=float(tempo))
        drum = pretty_midi.Instrument(program=0, is_drum=True, name="Drums")
        onset_frames = librosa.onset.onset_detect(y=y, sr=sr, units="frames",
                                                   backtrack=True, hop_length=HOP)
        onset_times = librosa.frames_to_time(onset_frames, sr=sr, hop_length=HOP)
        for i, t in enumerate(onset_times):
            drum.notes.append(pretty_midi.Note(velocity=90,
                pitch=36 if i % 2 == 0 else 38, start=float(t), end=float(t) + 0.12))
        pm.instruments.append(drum)
        pm.write(str(midi_out))
        _log(job_dir, f"  method:     onset_detect (drums)",
                      f"  onsets:     {len(onset_frames)}",
                      f"  notes_out:  {len(drum.notes)}")
        return len(drum.notes), 70.0

    if "bass" in stem_name:
        fmin, fmax = librosa.note_to_hz("C1"), librosa.note_to_hz("C5")
        fmin_name, fmax_name = "C1", "C5"
    elif "guitar" in stem_name:
        fmin, fmax = librosa.note_to_hz("E2"), librosa.note_to_hz("E7")
        fmin_name, fmax_name = "E2", "E7"
    else:
        fmin, fmax = librosa.note_to_hz("C2"), librosa.note_to_hz("C7")
        fmin_name, fmax_name = "C2", "C7"

    # omnizart: multi-instrument neural transcription — best for orchestral/ensemble audio
    if stem_name == "other" and _OMNIZART_AVAIL:
        try:
            import subprocess as _sp
            _log(job_dir, f"  method:     omnizart (multi-instrument)")
            # CLI: omnizart music transcribe <wav> -o <outdir>
            # outputs <outdir>/<wav_stem>.mid — matches midi_out path exactly
            _proc = _sp.run(
                [_OMNIZART_PYTHON, "-m", "omnizart", "music", "transcribe",
                 str(wav_path), "-o", str(midi_out.parent)],
                capture_output=True, timeout=900
            )
            if _proc.returncode == 0 and midi_out.exists():
                import pretty_midi as _pm_omni
                _pm_check = _pm_omni.PrettyMIDI(str(midi_out))
                note_count = sum(len(i.notes) for i in _pm_check.instruments)
                _log(job_dir,
                     f"  notes_out:  {note_count}",
                     f"  tracks:     {len(_pm_check.instruments)}",
                     *[f"    [{i.program:3d}] {i.name or 'unnamed'}: {len(i.notes)} notes"
                       for i in _pm_check.instruments])
                return note_count, 88.0
            else:
                _log(job_dir,
                     f"  omnizart exit {_proc.returncode} — falling back",
                     _proc.stderr.decode(errors="replace")[-400:])
        except Exception as exc:
            _log(job_dir, f"  omnizart error: {exc} — falling back to basic-pitch")

    # basic-pitch: polyphonic neural transcription (best quality, requires pip install basic-pitch)
    if _BASIC_PITCH_AVAIL:
        try:
            from basic_pitch.inference import predict as _bp_predict
            _log(job_dir, f"  method:     basic-pitch  fmin={fmin_name} fmax={fmax_name}")
            model_arg = _BP_MODEL if _BP_MODEL is not None else None
            predict_kwargs = dict(
                minimum_note_length=150.0,
                minimum_frequency=fmin,
                maximum_frequency=fmax,
                onset_threshold=0.5,
                frame_threshold=0.35,
                melodia_trick=True,
            )
            if model_arg is not None:
                model_out, midi_data, _ = _bp_predict(str(wav_path), model_arg, **predict_kwargs)
            else:
                model_out, midi_data, _ = _bp_predict(str(wav_path), **predict_kwargs)
            # Rewrite with correct tempo + instrument program so MuseScore imports cleanly
            pm_out = pretty_midi.PrettyMIDI(initial_tempo=float(tempo))
            prog = _STEM_PROGRAM.get(stem_name, 0)
            for inst in midi_data.instruments:
                if not inst.is_drum:
                    inst.program = prog
                    inst.name = stem_name.title()
            pm_out.instruments = midi_data.instruments
            pm_out.write(str(midi_out))
            note_count = sum(len(inst.notes) for inst in pm_out.instruments)
            note_probs = model_out.get("note")
            if note_probs is not None and note_probs.size > 0:
                conf = float(np.mean(np.max(note_probs, axis=-1))) * 100.0
            else:
                conf = 50.0
            _log(job_dir, f"  notes_out:  {note_count}", f"  confidence: {conf:.1f}%")
            return note_count, round(conf, 1)
        except Exception as exc:
            _log(job_dir, f"  basic-pitch error: {exc} — falling back to CQT")

    # CQT-based polyphonic transcription — works on separated orchestral stems, no extra deps
    _log(job_dir, f"  method:     CQT-poly  fmin={fmin_name} ({fmin:.1f} Hz)  fmax={fmax_name} ({fmax:.1f} Hz)")
    y, sr = librosa.load(str(wav_path), sr=SR, mono=True, duration=300)

    fmin_midi = max(0, int(round(librosa.hz_to_midi(fmin))))
    fmax_midi = min(127, int(round(librosa.hz_to_midi(fmax))))
    n_bins = max(1, fmax_midi - fmin_midi)
    fmin_hz = float(librosa.midi_to_hz(fmin_midi))

    C = np.abs(librosa.cqt(y, sr=sr, hop_length=HOP,
                            n_bins=n_bins, bins_per_octave=12, fmin=fmin_hz))

    flat = C.ravel()
    if flat.max() < 1e-7:
        _log(job_dir, "  WARNING: silent stem")
        pm = pretty_midi.PrettyMIDI(initial_tempo=float(tempo))
        pm.instruments.append(pretty_midi.Instrument(program=_STEM_PROGRAM.get(stem_name, 0), name=stem_name.title()))
        pm.write(str(midi_out))
        return 0, 0.0

    # Per-frame max energy; global floor at 75th percentile of nonzero values
    frame_max = C.max(axis=0)
    global_floor = float(np.percentile(flat[flat > 0], 75))

    times = librosa.frames_to_time(np.arange(C.shape[1]), sr=sr, hop_length=HOP)
    MAX_POLY = 3 if "bass" in stem_name else 5  # bass usually monophonic/duophonic
    MIN_DUR  = 0.08

    pm = pretty_midi.PrettyMIDI(initial_tempo=float(tempo))
    inst = pretty_midi.Instrument(program=_STEM_PROGRAM.get(stem_name, 0), name=stem_name.title())
    active: dict[int, float] = {}  # midi_pitch -> start_time

    for fi in range(C.shape[1]):
        t = float(times[fi])
        col = C[:, fi]
        col_max = float(frame_max[fi])

        if col_max < global_floor * 0.2:
            # Silent frame — close all open notes
            for mp, s in list(active.items()):
                if t - s >= MIN_DUR:
                    inst.notes.append(pretty_midi.Note(70, mp, s, t))
            active.clear()
            continue

        # Find pitches above 45 % of this frame's peak AND above global floor
        col_norm = col / col_max
        cands = np.where((col_norm > 0.45) & (col > global_floor * 0.3))[0]
        if len(cands) > MAX_POLY:
            cands = cands[np.argsort(col[cands])[-MAX_POLY:]]
        on_now = set(int(fmin_midi + b) for b in cands if fmin_midi + int(b) <= 127)

        # Close notes that stopped
        for mp in list(active.keys()):
            if mp not in on_now:
                s = active.pop(mp)
                if t - s >= MIN_DUR:
                    inst.notes.append(pretty_midi.Note(70, mp, s, t))
        # Open new notes
        for mp in on_now:
            if mp not in active:
                active[mp] = t

    # Close remaining open notes at end of file
    end_t = float(times[-1])
    for mp, s in active.items():
        if end_t - s >= MIN_DUR:
            inst.notes.append(pretty_midi.Note(70, mp, s, end_t))

    pm.instruments.append(inst)
    pm.write(str(midi_out))
    n_notes = len(inst.notes)

    loud_frames = int(np.sum(frame_max >= global_floor * 0.2))
    conf = float(loud_frames / max(1, C.shape[1])) * 100.0
    _log(job_dir,
         f"  notes_out:  {n_notes}",
         f"  loud_frames:{loud_frames}/{C.shape[1]} ({conf:.1f}%)",
         f"  cqt_bins:   {n_bins}")
    return n_notes, round(conf, 1)


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

try:
    import logging as _lg; _rl = _lg.getLogger(); _prev = _rl.level; _rl.setLevel(_lg.ERROR)
    import basic_pitch  # noqa: F401
    _BASIC_PITCH_AVAIL = True
    _rl.setLevel(_prev)
except ImportError:
    _BASIC_PITCH_AVAIL = False

# omnizart requires Python ≤ 3.9 — may live in a separate venv.
# Point OMNIZART_PYTHON at that venv's python.exe to enable it.
_OMNIZART_PYTHON = os.environ.get("OMNIZART_PYTHON", sys.executable)
try:
    import subprocess as _sp_omni_check
    _r = _sp_omni_check.run(
        [_OMNIZART_PYTHON, "-c", "import omnizart"],
        capture_output=True, timeout=15)
    _OMNIZART_AVAIL = (_r.returncode == 0)
except Exception:
    _OMNIZART_AVAIL = False

# Preload basic-pitch ONNX model once at startup — avoids 5× reload per session
_BP_MODEL = None
if _BASIC_PITCH_AVAIL:
    try:
        import logging as _lg2; _rl2 = _lg2.getLogger(); _p2 = _rl2.level; _rl2.setLevel(_lg2.ERROR)
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import Model as _BPModel
        _BP_MODEL = _BPModel(ICASSP_2022_MODEL_PATH)
        _rl2.setLevel(_p2)
    except Exception:
        pass


# ── Debug logger ──────────────────────────────────────────────────────────────
def _log(job_dir: Path, *lines: str):
    """Append timestamped lines to work/{sid}/debug.log."""
    log_path = job_dir / "debug.log"
    ts = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(log_path, "a", encoding="utf-8") as f:
        for line in lines:
            f.write(f"[{ts}] {line}\n")


def _analyze_audio_sync(wav_path: Path, job_dir: Path) -> dict:
    """Detect BPM, key, time sig, sample rate, bit depth. Runs in thread pool."""
    import librosa, numpy as np, soundfile as sf

    _log(job_dir, "=== AUDIO ANALYSIS ===", f"file: {wav_path.name}")

    info = sf.info(str(wav_path))
    sample_rate = info.samplerate
    bit_depth = {"PCM_16": 16, "PCM_24": 24, "PCM_32": 32, "FLOAT": 32}.get(info.subtype, 16)
    _log(job_dir,
         f"format:      {info.subtype} ({bit_depth}-bit)",
         f"sample_rate: {sample_rate} Hz",
         f"duration:    {info.duration:.2f} s  ({info.duration/60:.1f} min)",
         f"channels:    {info.channels}")

    SR = 22050
    y, _ = librosa.load(str(wav_path), sr=SR, mono=True, duration=180)

    # Tempo + time sig — beat_this (ISMIR 2024) → madmom → librosa
    beat_frames = np.array([])
    tempo = 120
    time_sig = [4, 4]
    _beat_method = "?"

    try:
        from beat_this.inference import File2Beats
        _log(job_dir, "tempo_method: beat_this (ISMIR 2024)")
        f2b = File2Beats(checkpoint_path="final0", device=_DEVICE, dbn=False)
        _bt_beats, _bt_db = f2b(str(wav_path))
        beat_times = np.array(_bt_beats, dtype=float)
        db_arr    = np.array(_bt_db,    dtype=float)
        if len(beat_times) >= 4:
            intervals = np.diff(beat_times)
            med = float(np.median(intervals))
            tempo = max(40, min(250, int(round(60.0 / med if med > 0 else 120.0))))
            beat_frames = librosa.time_to_frames(beat_times, sr=SR)
        if len(db_arr) >= 3:
            bpb_list = []
            for k in range(len(db_arr) - 1):
                n = int(np.sum((beat_times >= db_arr[k]) & (beat_times < db_arr[k+1])))
                if 2 <= n <= 8:
                    bpb_list.append(n)
            if bpb_list:
                bpb = int(round(float(np.median(bpb_list))))
                time_sig = [bpb if bpb in (3, 4, 5, 6, 7) else 4, 4]
        _beat_method = "beat_this"
        _log(job_dir,
             f"tempo:       {tempo} BPM",
             f"beats:       {len(beat_times)}  downbeats: {len(db_arr)}",
             f"time_sig:    {time_sig[0]}/{time_sig[1]}  (from downbeats)")
    except Exception as exc:
        _log(job_dir, f"beat_this failed ({exc}), trying madmom")
        try:
            import madmom
            from madmom.features.beats import RNNBeatProcessor, BeatTrackingProcessor
            _log(job_dir, "tempo_method: madmom RNNBeatProcessor")
            proc = RNNBeatProcessor()(str(wav_path))
            beat_times = BeatTrackingProcessor(fps=100)(proc)
            if len(beat_times) >= 4:
                intervals = np.diff(beat_times)
                med = float(np.median(intervals))
                tempo = max(40, min(250, int(round(60.0 / med if med > 0 else 120.0))))
                beat_frames = librosa.time_to_frames(beat_times, sr=SR)
            _beat_method = "madmom"
            _log(job_dir, f"tempo:       {tempo} BPM  beats: {len(beat_times)}")
        except Exception as exc2:
            _log(job_dir, f"madmom failed ({exc2}), using librosa")
            tempo_raw, beat_frames = librosa.beat.beat_track(y=y, sr=SR)
            tempo = max(40, min(250, int(round(float(tempo_raw)))))
            _beat_method = "librosa"
            _log(job_dir, f"tempo:       {tempo} BPM  (librosa)")

    # Time sig autocorrelation fallback (when beat_this didn't set it via downbeats)
    if _beat_method != "beat_this" and len(beat_frames) >= 8:
        try:
            oenv = librosa.onset.onset_strength(y=y, sr=SR)
            bf = beat_frames[beat_frames < len(oenv)]
            strengths = oenv[bf] - oenv[bf].mean()
            ac = np.correlate(strengths, strengths, mode='full')[len(strengths) - 1:]
            if len(ac) > 4:
                ac3, ac4 = float(ac[3]), float(ac[4])
                if ac3 > ac4 * 1.15:
                    time_sig = [3, 4]
            _log(job_dir, f"time_sig:    {time_sig[0]}/{time_sig[1]}  (autocorrelation)")
        except Exception as exc:
            _log(job_dir, f"time_sig_error: {exc}")

    # Key — Krumhansl-Schmuckler over CQT chroma
    major_prof = np.array([6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88])
    minor_prof = np.array([6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17])
    chroma = librosa.feature.chroma_cqt(y=y, sr=SR).mean(axis=1)
    note_names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
    best_key, best_r = "C major", -2.0
    all_scores: list[tuple[float, str]] = []
    for i in range(12):
        r_maj = float(np.corrcoef(chroma, np.roll(major_prof, i))[0, 1])
        r_min = float(np.corrcoef(chroma, np.roll(minor_prof, i))[0, 1])
        all_scores.append((r_maj, f"{note_names[i]} major"))
        all_scores.append((r_min, f"{note_names[i]} minor"))
        if r_maj > best_r: best_r, best_key = r_maj, f"{note_names[i]} major"
        if r_min > best_r: best_r, best_key = r_min, f"{note_names[i]} minor"
    top5 = sorted(all_scores, reverse=True)[:5]
    _log(job_dir, f"key_detected: {best_key}  (r={best_r:.4f})")
    for r, k in top5:
        _log(job_dir, f"  {r:+.4f}  {k}{' <-- CHOSEN' if k == best_key else ''}")

    # Spectrum — 40 log-spaced energy bins for UI visualizer (0–100 scale)
    spectrum: list[float] = []
    try:
        S = np.abs(librosa.stft(y, n_fft=2048, hop_length=512))
        freq_energy = np.log1p(S.mean(axis=1))
        if freq_energy.max() > 0:
            freq_energy = freq_energy / freq_energy.max() * 100.0
        indices = np.linspace(0, len(freq_energy) - 1, 40)
        spectrum = [float(max(0.0, min(100.0, np.interp(ix, np.arange(len(freq_energy)), freq_energy))))
                    for ix in indices]
    except Exception:
        pass

    _log(job_dir, "=== ANALYSIS DONE ===")
    return {"tempo": tempo, "key": best_key, "timeSig": time_sig,
            "sampleRate": sample_rate, "bitDepth": bit_depth, "spectrum": spectrum}


# ── Shared separation + transcription logic ────────────────────────────────────
async def _separate_and_transcribe(sid: str, audio_path: Path, meta: dict):
    job_dir = audio_path.parent
    stems_dir = job_dir / "stems"
    midi_dir = job_dir / "midi"
    stems_dir.mkdir(exist_ok=True)
    midi_dir.mkdir(exist_ok=True)

    # Stage 1: Demucs + audio analysis in parallel
    _set(sid, stage=1, status="separating", progress=0.20)
    _log(job_dir, "=== SEPARATION ===", f"device: {_DEVICE}", f"model:  htdemucs_6s")
    py = sys.executable
    loop = asyncio.get_running_loop()
    analysis_fut = loop.run_in_executor(_POOL, _analyze_audio_sync, audio_path, job_dir)

    # Smooth progress 20%→60% while demucs runs (subprocess gives no callbacks)
    # htdemucs_6s: CPU ~3.5× realtime, GPU ~0.7× realtime
    _dur = meta.get("duration", 120)
    _est = max(30.0, _dur * (0.8 if _DEVICE == "cuda" else 3.5))
    async def _sep_progress():
        _t0 = time.time()
        while True:
            _frac = min(0.97, 1.0 - math.exp(-2.5 * (time.time() - _t0) / _est))
            _set(sid, progress=0.20 + _frac * 0.40)
            await asyncio.sleep(2)
    _prog_task = asyncio.create_task(_sep_progress())
    try:
        await _run_async([py, "-m", "demucs",
                          "--name", "htdemucs_6s",
                          "--device", _DEVICE,
                          "--out", str(job_dir / "demucs_out"),
                          str(audio_path)])
    finally:
        _prog_task.cancel()
        try: await _prog_task
        except asyncio.CancelledError: pass

    demucs_root = next((job_dir / "demucs_out" / "htdemucs_6s").iterdir())
    stem_sizes = {}
    for stem_wav in demucs_root.glob("*.wav"):
        shutil.copy(stem_wav, stems_dir / stem_wav.name)
        stem_sizes[stem_wav.stem] = stem_wav.stat().st_size
    analysis = await analysis_fut
    _log(job_dir, "stems_separated:",
         *[f"  {k}: {v/1024:.0f} KB" for k, v in sorted(stem_sizes.items())])
    _set(sid, progress=0.62)

    # Stage 2: Instrument ID
    _set(sid, stage=2, status="identifying", progress=0.64)
    _set(sid, progress=0.70)

    # Stage 3: MIDI — sequential (ONNX not safe for concurrent CPU inference)
    _set(sid, stage=3, status="transcribing", progress=0.72)
    stem_queue = [(n, stems_dir / f"{n}.wav") for n in DEMUCS_SOURCES
                  if (stems_dir / f"{n}.wav").exists()]
    midi_counts, midi_confs = {}, {}
    _n_stems = max(len(stem_queue), 1)
    for i, (stem_name, stem_file) in enumerate(stem_queue):
        try:
            r = await loop.run_in_executor(
                _POOL, _transcribe_stem_sync,
                stem_file, midi_dir / f"{stem_name}.mid", stem_name == "drums",
                float(analysis.get("tempo", 120)))
            if isinstance(r, tuple):
                midi_counts[stem_name], midi_confs[stem_name] = r[0], r[1]
            else:
                midi_counts[stem_name] = int(r); midi_confs[stem_name] = 90.0
        except Exception as exc:
            midi_counts[stem_name] = 0; midi_confs[stem_name] = 0.0
            _log(job_dir, f"MIDI_ERROR [{stem_name}]: {exc}")
        _set(sid, progress=0.72 + (i + 1) / _n_stems * 0.18)

    # Dynamic classification — silence filter + instrument ID
    stem_classifications: dict[str, dict] = {}
    for stem_name, stem_file in stem_queue:
        try:
            cls = await loop.run_in_executor(
                _POOL, _classify_stem_sync,
                stem_name, stem_file, midi_dir / f"{stem_name}.mid")
            stem_classifications[stem_name] = cls
        except Exception as exc:
            _log(job_dir, f"CLASSIFY_ERROR [{stem_name}]: {exc}")
            stem_classifications[stem_name] = {}

    # Stage 4: Engraving stub
    _set(sid, stage=4, status="engraving", progress=0.95)

    # Build stem list — merge dynamic classification over STEM_META defaults
    stems = []
    for name in DEMUCS_SOURCES:
        if not (stems_dir / f"{name}.wav").exists():
            continue
        m   = STEM_META.get(name, {})
        cls = stem_classifications.get(name, {})
        if cls.get("removed"):
            _log(job_dir, f"STEM_REMOVED [{name}]: silent — skipped")
            continue
        stem_name_disp = cls.get("name")       or m.get("name",       name.title())
        stem_inst      = cls.get("instrument") or m.get("instrument", "Unknown")
        stem_family    = cls.get("family")     or m.get("family",     "")
        stem_clef      = cls.get("clef")       or m.get("clef",       "treble")

        # ── Multi-track split: omnizart outputs separate tracks per instrument ─────
        # Trigger: >1 instrument track with distinct GM programs and ≥10 notes each
        _split_done = False
        midi_file = midi_dir / f"{name}.mid"
        if midi_file.exists() and name == "other":
            try:
                import pretty_midi as _pm_mt, re as _re_mt
                _pm_mt_obj = _pm_mt.PrettyMIDI(str(midi_file))
                _valid_tracks = [i for i in _pm_mt_obj.instruments if len(i.notes) >= 10]
                _distinct_progs = len({i.program for i in _valid_tracks if not i.is_drum})
                if _distinct_progs >= 2 or (len(_valid_tracks) >= 2):
                    _split_done = True
                    _log(job_dir, f"MULTI_TRACK_SPLIT [{name}]: {len(_valid_tracks)} tracks")
                    for _tidx, _tinst in enumerate(_valid_tracks):
                        _safe_id = _re_mt.sub(r"[^a-z0-9]+", "_",
                                              (_tinst.name or f"track_{_tidx}").lower()
                                              ).strip("_")[:18] or f"track_{_tidx}"
                        _tid = f"{name}_{_safe_id}"
                        _pm_single = _pm_mt.PrettyMIDI(
                            initial_tempo=float(analysis.get("tempo", 120)))
                        _pm_single.instruments.append(_tinst)
                        _pm_single.write(str(midi_dir / f"{_tid}.mid"))
                        if _tinst.is_drum:
                            _tn, _tf, _tc = "Drums", "Percussion", "percussion"
                        else:
                            _tn, _tf, _tc = _gm_program_meta(_tinst.program)
                        _tname = _tinst.name or _tn
                        stems.append({
                            "id": _tid, "name": _tname,
                            "instrument": _tn, "family": _tf, "clef": _tc,
                            "color": m.get("color", "--s-synth"), "role": "",
                            "confidence": midi_confs.get(name, 0.0),
                            "midi": len(_tinst.notes),
                            "audio_url": f"/work/{sid}/stems/{name}.wav",
                            "midi_url":  f"/work/{sid}/midi/{_tid}.mid",
                            "density": 3, "seed": hash(_tid) % 50 + 1, "note": "",
                        })
            except Exception as _mte:
                _log(job_dir, f"MULTI_TRACK_SPLIT_ERROR [{name}]: {_mte}")
                _split_done = False

        # ── Grand-staff split: if MIDI spans bass+treble registers, emit two staves ──
        # Trigger: >12% of notes below E3 (MIDI 52) AND >12% above E3
        if not _split_done and midi_file.exists():
            try:
                import pretty_midi as _pm_split
                _pm_s = _pm_split.PrettyMIDI(str(midi_file))
                _all_p = [n.pitch for inst in _pm_s.instruments for n in inst.notes]
                if len(_all_p) >= 20:
                    _n_bass   = sum(1 for p in _all_p if p < 52)
                    _n_treble = sum(1 for p in _all_p if p >= 52)
                    _frac_b   = _n_bass   / len(_all_p)
                    _frac_t   = _n_treble / len(_all_p)
                    if _frac_b > 0.12 and _frac_t > 0.12:
                        # Write split MIDI files
                        for _sfx, _pred, _clef_s in [
                            ("_high", lambda p: p >= 52, "treble"),
                            ("_low",  lambda p: p <  52, "bass"),
                        ]:
                            _pm_out = _pm_split.PrettyMIDI(
                                initial_tempo=float(analysis.get("tempo", 120)))
                            for _inst in _pm_s.instruments:
                                _ni = _pm_split.Instrument(
                                    program=_inst.program,
                                    is_drum=_inst.is_drum,
                                    name=_inst.name)
                                _ni.notes = [n for n in _inst.notes if _pred(n.pitch)]
                                if _ni.notes:
                                    _pm_out.instruments.append(_ni)
                            if _pm_out.instruments:
                                _pm_out.write(str(midi_dir / f"{name}{_sfx}.mid"))
                        if (midi_dir / f"{name}_high.mid").exists() and \
                           (midi_dir / f"{name}_low.mid").exists():
                            _split_done = True
                            _lbl_hi = stem_name_disp + " (Treble)"
                            _lbl_lo = stem_name_disp + " (Bass)"
                            _log(job_dir, f"GRAND_STAFF_SPLIT [{name}]: "
                                          f"{_n_bass} bass / {_n_treble} treble notes")
                            stems.append({
                                "id": f"{name}_high", "name": _lbl_hi,
                                "instrument": stem_inst, "family": stem_family,
                                "clef": "treble", "color": m.get("color", "--s-synth"),
                                "role": m.get("role", ""), "confidence": midi_confs.get(name, 0.0),
                                "midi": _n_treble,
                                "audio_url": f"/work/{sid}/stems/{name}.wav",
                                "midi_url":  f"/work/{sid}/midi/{name}_high.mid",
                                "density": 3, "seed": hash(name + "_high") % 50 + 1, "note": "",
                            })
                            stems.append({
                                "id": f"{name}_low", "name": _lbl_lo,
                                "instrument": stem_inst, "family": stem_family,
                                "clef": "bass", "color": m.get("color", "--s-synth"),
                                "role": m.get("role", ""), "confidence": midi_confs.get(name, 0.0),
                                "midi": _n_bass,
                                "audio_url": f"/work/{sid}/stems/{name}.wav",
                                "midi_url":  f"/work/{sid}/midi/{name}_low.mid",
                                "density": 3, "seed": hash(name + "_low") % 50 + 1, "note": "",
                            })
            except Exception as _se:
                _log(job_dir, f"SPLIT_ERROR [{name}]: {_se}")

        if not _split_done:
            stems.append({
                "id":         name,
                "name":       stem_name_disp,
                "instrument": stem_inst,
                "family":     stem_family,
                "clef":       stem_clef,
                "color":      m.get("color", "--s-synth"),
                "role":       m.get("role",  ""),
                "confidence": midi_confs.get(name, 0.0),
                "midi":       midi_counts.get(name, 0),
                "audio_url":  f"/work/{sid}/stems/{name}.wav",
                "midi_url":   f"/work/{sid}/midi/{name}.mid" if midi_file.exists() else None,
                "density": 3, "seed": hash(name) % 50 + 1, "note": "",
            })

    final_meta = {**meta,
                  "tempo":      analysis["tempo"],
                  "key":        analysis["key"],
                  "timeSig":    analysis["timeSig"],
                  "sampleRate": analysis["sampleRate"],
                  "bitDepth":   analysis["bitDepth"],
                  "spectrum":   analysis.get("spectrum", []),
                  "sepModel":   "HT-Demucs v4 · 6-stem",
                  "transModel": ("omnizart + basic-pitch" if _OMNIZART_AVAIL and _BASIC_PITCH_AVAIL
                                 else "omnizart" if _OMNIZART_AVAIL
                                 else "Spotify basic-pitch" if _BASIC_PITCH_AVAIL
                                 else "CQT-poly (librosa)"),
                  "gpu":        _gpu_info()}
    _log(job_dir,
         "=== FINAL SUMMARY ===",
         f"title:       {meta.get('title','?')}",
         f"artist:      {meta.get('artist','?')}",
         f"duration:    {meta.get('duration',0):.1f} s",
         f"tempo:       {analysis['tempo']} BPM",
         f"key:         {analysis['key']}",
         f"time_sig:    {analysis['timeSig'][0]}/{analysis['timeSig'][1]}",
         f"sample_rate: {analysis['sampleRate']} Hz",
         f"bit_depth:   {analysis['bitDepth']}-bit",
         f"device:      {_DEVICE}",
         "midi_counts:",
         *[f"  {k}: {v} notes" for k, v in sorted(midi_counts.items())],
         "=== PIPELINE DONE ===")

    # ── Human-readable detection log ──────────────────────────────────────────
    try:
        lines = [
            "═══════════════════════════════════════════════════",
            "  AEGIS SCORE STUDIO — Detection Report",
            "═══════════════════════════════════════════════════",
            f"  Title      : {meta.get('title','?')}",
            f"  Artist     : {meta.get('artist','?')}",
            f"  Duration   : {meta.get('duration',0):.1f} s",
            f"  Source     : {meta.get('source','?')}",
            "",
            "── Audio Analysis ─────────────────────────────────",
            f"  BPM        : {analysis['tempo']}",
            f"  Key        : {analysis['key']}",
            f"  Time Sig   : {analysis['timeSig'][0]}/{analysis['timeSig'][1]}",
            f"  Sample Rate: {analysis['sampleRate']} Hz",
            f"  Bit Depth  : {analysis['bitDepth']}-bit",
            "",
            "── Models Used ────────────────────────────────────",
            f"  Separation : HT-Demucs v4 · 6-stem",
            f"  Transcribe : {'omnizart (other) + basic-pitch (melodic)' if _OMNIZART_AVAIL and _BASIC_PITCH_AVAIL else 'omnizart' if _OMNIZART_AVAIL else 'Spotify basic-pitch (ONNX)' if _BASIC_PITCH_AVAIL else 'CQT-poly (librosa)'}",
            f"  Beat Track : beat_this ISMIR-2024",
            f"  Device     : {_DEVICE.upper()}",
            "",
            "── Detected Stems ─────────────────────────────────",
        ]
        for s in stems:
            cls = stem_classifications.get(s["id"], {})
            status = "✓ kept" if not s.get("removed") else "✗ removed (silent)"
            lines += [
                f"  [{s['id'].upper():6}]  {s['name']:18} {status}",
                f"           Instrument : {s['instrument']}",
                f"           Family     : {s['family']}",
                f"           Clef       : {s['clef']}",
                f"           MIDI notes : {s['midi']}",
                f"           Confidence : {s['confidence']:.0f}%",
            ]
            if s["id"] == "other":
                lines.append(f"           Detected as: {s['name']} (spectral classification)")
            midi_file = job_dir / "midi" / f"{s['id']}.mid"
            if midi_file.exists() and not s.get("removed"):
                try:
                    import pretty_midi as _pm_log
                    _pm_obj = _pm_log.PrettyMIDI(str(midi_file))
                    _all_notes = sorted(
                        [n for inst in _pm_obj.instruments for n in inst.notes],
                        key=lambda n: n.start,
                    )
                    if _all_notes:
                        lines.append(f"           Detected notes ({len(_all_notes)}):")
                        _MAX = 200
                        for _n in _all_notes[:_MAX]:
                            _name = _pm_log.note_number_to_name(_n.pitch)
                            _dur  = _n.end - _n.start
                            lines.append(
                                f"             {_name:4}  t={_n.start:7.2f}s"
                                f"  dur={_dur:.2f}s  vel={_n.velocity}"
                            )
                        if len(_all_notes) > _MAX:
                            lines.append(f"             ... +{len(_all_notes) - _MAX} more")
                except Exception:
                    pass
            lines.append("")
        for stem_name_r in DEMUCS_SOURCES:
            cls_r = stem_classifications.get(stem_name_r, {})
            if cls_r.get("removed") and not any(s["id"] == stem_name_r for s in stems):
                lines.append(f"  [{stem_name_r.upper():6}]  (silent — removed from score)")
        lines += [
            "",
            "═══════════════════════════════════════════════════",
        ]
        (job_dir / "detection_log.txt").write_text("\n".join(lines), encoding="utf-8")
    except Exception as _le:
        _log(job_dir, f"detection_log write error: {_le}")

    _set(sid, status="done", progress=1.0, stage=4, stems=stems, meta=final_meta)


# ── Web MIDI fetch (fast path) ───────────────────────────────────────────────
_GM_PROGRAM_MAP = [
    (8,   "Piano",          "Keys",       "treble"),
    (16,  "Chromatic Perc", "Percussion", "treble"),
    (24,  "Organ",          "Keys",       "treble"),
    (32,  "Guitar",         "Strings",    "treble"),
    (40,  "Bass",           "Bass",       "bass"),
    (48,  "Strings",        "Strings",    "treble"),
    (56,  "Ensemble",       "Strings",    "treble"),
    (64,  "Brass",          "Brass",      "treble"),
    (72,  "Reed",           "Woodwind",   "treble"),
    (80,  "Pipe",           "Woodwind",   "treble"),
    (88,  "Synth Lead",     "Synth",      "treble"),
    (96,  "Synth Pad",      "Synth",      "treble"),
    (104, "Synth Effects",  "Synth",      "treble"),
    (112, "Ethnic",         "World",      "treble"),
    (120, "Percussive",     "Percussion", "treble"),
    (128, "Sound Effects",  "Other",      "treble"),
]

def _gm_program_meta(program: int) -> tuple:
    for ceil, name, family, clef in _GM_PROGRAM_MAP:
        if program < ceil:
            return name, family, clef
    return "Other", "Other", "treble"


def _try_fetch_midi_sync(title: str, artist: str, job_dir: Path):
    """Search bitmidi.com then freemidi.org for a matching MIDI. Blocking. Returns Path or None."""
    import urllib.parse, urllib.request, json, re as _re2

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "text/html,application/xhtml+xml,*/*",
    }

    def _get(url, timeout=8):
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", errors="replace")

    def _save(url, dest: Path, timeout=15):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                dest.write_bytes(r.read())
            return dest.exists() and dest.stat().st_size > 200
        except Exception:
            return False

    raw = f"{artist} {title}".strip()
    # Strip feat/remix/video annotations that confuse search
    clean = _re2.sub(r"\s*[\(\[【【][^\)\]】]*[\)\]】]", "", raw).strip()[:60]

    # ── bitmidi.com ──────────────────────────────────────────────────────────
    try:
        html = _get(f"https://bitmidi.com/search?q={urllib.parse.quote_plus(clean)}")
        m = _re2.search(r'<script id="__NEXT_DATA__"[^>]*>(.+?)</script>', html, _re2.S)
        if m:
            data = json.loads(m.group(1))
            results = data.get("props", {}).get("pageProps", {}).get("results", [])
            if results:
                slug = results[0].get("slug") or str(results[0].get("id", ""))
                if slug:
                    page = _get(f"https://bitmidi.com/{slug}")
                    dm = _re2.search(r'"(https://bitmidi\.com/uploads/[^"]+\.mid)"', page)
                    if dm:
                        out = job_dir / "fetched.mid"
                        if _save(dm.group(1), out):
                            return out
                    dm2 = _re2.search(r'href="(/uploads/[^"]+\.mid)"', page)
                    if dm2:
                        out = job_dir / "fetched.mid"
                        if _save("https://bitmidi.com" + dm2.group(1), out):
                            return out
    except Exception:
        pass

    # ── freemidi.org ─────────────────────────────────────────────────────────
    try:
        html = _get(f"https://freemidi.org/search?s={urllib.parse.quote_plus(clean)}")
        lm = _re2.search(r'href="(https?://freemidi\.org/download[^"]+)"', html)
        if lm:
            page = _get(lm.group(1))
            gm = _re2.search(r'href="(https?://freemidi\.org/getter[^"]+)"', page)
            if not gm:
                gm = _re2.search(r'"(https?://[^"]+\.mid)"', page)
            if gm:
                out = job_dir / "fetched.mid"
                if _save(gm.group(1), out):
                    return out
    except Exception:
        pass

    return None


async def _pipeline_fetched_midi(sid: str, midi_path: Path, audio_path: Path, meta: dict):
    """Fast-path: use a web-fetched MIDI, skip Demucs + transcription."""
    import pretty_midi, re as _re3
    job_dir = midi_path.parent
    stems_dir = job_dir / "stems"
    midi_dir  = job_dir / "midi"
    stems_dir.mkdir(exist_ok=True)
    midi_dir.mkdir(exist_ok=True)
    loop = asyncio.get_running_loop()

    _log(job_dir, "=== FAST PATH: WEB MIDI ===", f"file: {midi_path.name}")
    # Stage 1 slot: audio analysis (replaces Demucs)
    _set(sid, stage=1, status="separating", progress=0.22)
    analysis = await loop.run_in_executor(_POOL, _analyze_audio_sync, audio_path, job_dir)
    # Stage 2 slot: instrument ID (instant — we read it from MIDI program numbers)
    _set(sid, stage=2, status="identifying", progress=0.62)
    pm = pretty_midi.PrettyMIDI(str(midi_path))
    tempo = float(analysis.get("tempo", 120))
    _set(sid, progress=0.70)

    # Original audio as single "mix" track for WAV playback
    shutil.copy(audio_path, stems_dir / "mix.wav")
    stems = [{
        "id": "mix", "name": "Mix (Audio)", "instrument": "Full Mix",
        "family": "Audio", "clef": "treble", "color": "--s-synth", "role": "Playback",
        "confidence": 100.0, "midi": 0,
        "audio_url": f"/work/{sid}/stems/mix.wav",
        "midi_url":  None,
        "density": 0, "seed": 1, "note": "Web-fetched MIDI · stem isolation N/A",
    }]
    midi_counts: dict = {}
    used_ids: dict = {}

    # Stage 3 slot: MIDI import (replaces transcription)
    _set(sid, stage=3, status="transcribing", progress=0.72)
    for inst in pm.instruments:
        if not inst.notes:
            continue
        raw_id = _re3.sub(r"[^a-z0-9]+", "_",
                          (inst.name or "track").lower()).strip("_")[:20] or "track"
        n = used_ids.get(raw_id, 0)
        used_ids[raw_id] = n + 1
        stem_id = raw_id if n == 0 else f"{raw_id}_{n}"

        if inst.is_drum:
            inst_name, family, clef = "Drums", "Percussion", "percussion"
        else:
            inst_name, family, clef = _gm_program_meta(inst.program)

        pm_out = pretty_midi.PrettyMIDI(initial_tempo=tempo)
        inst_copy = pretty_midi.Instrument(
            program=inst.program, is_drum=inst.is_drum,
            name=inst.name or inst_name)
        inst_copy.notes = list(inst.notes)
        pm_out.instruments.append(inst_copy)
        pm_out.write(str(midi_dir / f"{stem_id}.mid"))

        stems.append({
            "id":         stem_id,
            "name":       inst.name or inst_name,
            "instrument": inst_name,
            "family":     family,
            "clef":       clef,
            "color":      "--s-synth",
            "role":       "",
            "confidence": 100.0,
            "midi":       len(inst.notes),
            "audio_url":  None,
            "midi_url":   f"/work/{sid}/midi/{stem_id}.mid",
            "density": 3, "seed": hash(stem_id) % 50 + 1, "note": "",
        })
        midi_counts[stem_id] = len(inst.notes)

    if len(stems) <= 1:
        raise ValueError("Fetched MIDI has no playable tracks")

    _set(sid, stage=4, status="engraving", progress=0.92)

    final_meta = {**meta,
                  "tempo":      analysis["tempo"],
                  "key":        analysis["key"],
                  "timeSig":    analysis["timeSig"],
                  "sampleRate": analysis["sampleRate"],
                  "bitDepth":   analysis["bitDepth"],
                  "spectrum":   analysis.get("spectrum", []),
                  "sepModel":   "Web fetch · no stem separation",
                  "transModel": "bitmidi.com / freemidi.org",
                  "gpu":        _gpu_info()}

    _log(job_dir,
         "=== FAST PATH DONE ===",
         f"tracks:  {len(stems)-1}",
         f"tempo:   {analysis['tempo']} BPM",
         f"key:     {analysis['key']}",
         *[f"  {k}: {v} notes" for k, v in sorted(midi_counts.items())])

    try:
        dlines = [
            "═══════════════════════════════════════════════════",
            "  AEGIS SCORE STUDIO — Detection Report (Web MIDI)",
            "═══════════════════════════════════════════════════",
            f"  Title      : {meta.get('title','?')}",
            f"  Artist     : {meta.get('artist','?')}",
            f"  Duration   : {meta.get('duration',0):.1f} s",
            f"  Source     : {meta.get('source','?')}",
            "",
            "── Audio Analysis ─────────────────────────────────",
            f"  BPM        : {analysis['tempo']}",
            f"  Key        : {analysis['key']}",
            f"  Time Sig   : {analysis['timeSig'][0]}/{analysis['timeSig'][1]}",
            f"  Sample Rate: {analysis['sampleRate']} Hz",
            f"  Bit Depth  : {analysis['bitDepth']}-bit",
            "",
            "── Pipeline ───────────────────────────────────────",
            "  MIDI source: Fetched from web (bitmidi.com / freemidi.org)",
            "  Separation : Skipped — stem isolation unavailable",
            "  Transcribe : Skipped — using web MIDI",
            "",
            "── MIDI Tracks ────────────────────────────────────",
        ]
        for s in stems[1:]:
            dlines += [
                f"  [{s['id'][:6].upper():6}]  {s['name']:20}  {s['midi']} notes",
                f"           Instrument : {s['instrument']}",
                f"           Family     : {s['family']}",
                "",
            ]
        dlines.append("═══════════════════════════════════════════════════")
        (job_dir / "detection_log.txt").write_text("\n".join(dlines), encoding="utf-8")
    except Exception as _le:
        _log(job_dir, f"detection_log write error: {_le}")

    _set(sid, status="done", progress=1.0, stage=4, stems=stems, meta=final_meta)


# ── Background pipeline: URL ──────────────────────────────────────────────────
async def pipeline_url(sid: str, url: str):
    job_dir = WORK_DIR / sid
    job_dir.mkdir(parents=True, exist_ok=True)
    audio_path = job_dir / "audio.wav"

    try:
        _log(job_dir, "=== PIPELINE START (URL) ===", f"sid: {sid}", f"url: {url}")
        _set(sid, stage=0, status="downloading", progress=0.0)
        import yt_dlp
        ydl_opts = {
            "format": "bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio/best",
            "postprocessors": [{"key": "FFmpegExtractAudio",
                                "preferredcodec": "wav", "preferredquality": "0"}],
            "outtmpl": str(job_dir / "audio"),
            "quiet": True,
            "no_warnings": True,
            # ios+mweb = current yt-dlp defaults; android+web as fallbacks
            "extractor_args": {"youtube": {"player_client": ["ios", "mweb", "android", "web"]}},
            "noplaylist": True,
            "extractor_retries": 5,
            "fragment_retries": 10,
            "retries": 5,
        }
        loop = asyncio.get_running_loop()
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
        _log(job_dir,
             f"download_ok: {meta['title']}",
             f"uploader:    {meta['artist']}",
             f"duration:    {meta['duration']} s")
        _set(sid, meta=meta, progress=0.18)

        # ── Fast path: try fetching existing MIDI (silent, part of normal flow) ──
        fetched = await loop.run_in_executor(
            None, _try_fetch_midi_sync, meta["title"], meta.get("artist", ""), job_dir)
        if fetched:
            _log(job_dir, f"midi_fetch_ok: {fetched.name} ({fetched.stat().st_size} bytes)")
            await _pipeline_fetched_midi(sid, fetched, audio_path, meta)
            URL_CACHE[url] = sid
            return

        _log(job_dir, "midi_fetch: none found — running full pipeline")
        await _separate_and_transcribe(sid, audio_path, meta)
        URL_CACHE[url] = sid

    except Exception as exc:
        err_str = str(exc)
        _log(job_dir, f"PIPELINE ERROR: {exc}", traceback.format_exc())
        # Friendlier messages for common failures
        _lower = err_str.lower()
        if "sign in" in _lower or "age" in _lower or "confirm your age" in _lower:
            err_str = "Age-restricted video — YouTube requires sign-in. Try a different video."
        elif "private" in _lower:
            err_str = "Private video — not accessible."
        elif "unavailable" in _lower or "removed" in _lower:
            err_str = "Video unavailable or removed by uploader."
        elif "ffmpeg" in _lower:
            err_str = "ffmpeg not found on PATH — required for audio conversion."
        _set(sid, status="error", error=err_str)


# ── Background pipeline: local file ──────────────────────────────────────────
async def pipeline_file(sid: str, audio_path: Path, filename: str):
    job_dir = audio_path.parent
    try:
        _log(job_dir, "=== PIPELINE START (FILE) ===", f"sid: {sid}", f"file: {filename}")
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
        _log(job_dir, f"file_ok: {filename}  duration={int(info.duration)}s")
        _set(sid, meta=meta, progress=0.18)
        await _separate_and_transcribe(sid, audio_path, meta)

    except Exception as exc:
        _log(job_dir, f"PIPELINE ERROR: {exc}", traceback.format_exc())
        _set(sid, status="error", error=str(exc))


# ── Routes ────────────────────────────────────────────────────────────────────
@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest, bg: BackgroundTasks):
    url = req.url.strip()
    if not req.force:
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


@app.post("/api/resume/{sid}")
async def resume(sid: str, bg: BackgroundTasks):
    """Resume processing of a session whose audio.wav is already on disk."""
    job_dir = WORK_DIR / sid
    audio_path = job_dir / "audio.wav"
    if not audio_path.exists():
        raise HTTPException(404, "no audio found for this session")
    if JOBS.get(sid, {}).get("status") in ("separating", "transcribing", "done"):
        return {"session_id": sid, "status": JOBS[sid]["status"]}
    import soundfile as sf
    info = sf.info(str(audio_path))
    meta = {"title": sid[:8], "artist": "Local file", "duration": int(info.duration),
            "thumb": "", "source": "resumed"}
    JOBS[sid] = {"status": "queued", "progress": 0.18, "stage": 0,
                 "meta": meta, "stems": [], "error": None}
    bg.add_task(_separate_and_transcribe, sid, audio_path, meta)
    return {"session_id": sid}


@app.get("/api/status/{sid}")
async def status(sid: str):
    job = JOBS.get(sid)
    if not job:
        # Server restarted — try reading persisted session from disk
        session_file = WORK_DIR / sid / "session.json"
        if session_file.exists():
            try:
                import json as _json
                job = _json.loads(session_file.read_text(encoding="utf-8"))
                JOBS[sid] = job  # reload into memory
            except Exception:
                raise HTTPException(404, "session not found")
        else:
            raise HTTPException(404, "session not found")
    return JSONResponse(job)


@app.get("/api/detection_log/{sid}")
async def get_detection_log(sid: str):
    log_path = WORK_DIR / sid / "detection_log.txt"
    if not log_path.exists():
        raise HTTPException(404, "log not found")
    from fastapi.responses import PlainTextResponse
    return PlainTextResponse(log_path.read_text(encoding="utf-8"))


@app.get("/api/midi/{sid}/{stem_name}")
async def get_midi_notes(sid: str, stem_name: str):
    midi_path = WORK_DIR / sid / "midi" / f"{stem_name}.mid"
    if not midi_path.exists():
        raise HTTPException(404, "MIDI not found")
    try:
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
    except Exception as exc:
        raise HTTPException(422, f"MIDI parse error: {exc}")


app.mount("/work", StaticFiles(directory=str(WORK_DIR)), name="work")
app.mount("/", StaticFiles(directory=os.environ.get("AEGIS_STATIC_DIR", "."), html=True), name="static")
