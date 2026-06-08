from __future__ import annotations

from fastapi import APIRouter, HTTPException
from backend.models.schemas import MidiResponse
from backend.services.pipeline import WORK_DIR

router = APIRouter()


@router.get("/midi/{sid}/{stem_name}", response_model=MidiResponse)
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
