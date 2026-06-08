/**
 * StaffCanvas — QtQuick Canvas port of notation.js
 * Renders a 5-line staff with real MIDI notes or seeded fake notes.
 *
 * Required properties:
 *   stemData  : object  { id, name, clef, color, midiNotes[], density, seed }
 *   tempo     : int
 *   timeSig   : int[2]
 *   bars      : int
 */
import QtQuick 2.15

Canvas {
    id: root

    required property var    stemData
    required property int    tempo
    required property var    timeSig
    required property int    bars

    property real stemColor: "#60a5fa"

    readonly property int SP         : 9          // staff space px
    readonly property int STAFF_TOP  : 28         // y of top line
    readonly property int FIRST_PAD  : 72         // clef + keysig + timesig width
    readonly property int NOTE_PAD_L : 14
    readonly property int NOTE_PAD_R : 12
    readonly property int BAR_W      : timeSig[0] === 3 ? 128 : 162

    implicitWidth:  FIRST_PAD + BAR_W * bars + 8
    implicitHeight: 90

    onStemDataChanged:  requestPaint()
    onTempoChanged:     requestPaint()
    onTimeSigChanged:   requestPaint()

    onPaint: {
        const ctx = getContext("2d")
        ctx.clearRect(0, 0, width, height)
        _drawStaff(ctx)
        _drawClef(ctx)
        _drawTimeSig(ctx)
        _drawBarlines(ctx)

        if (stemData && stemData.midiNotes && stemData.midiNotes.length > 0)
            _drawRealNotes(ctx, stemData.midiNotes)
        else
            _drawFakeNotes(ctx)
    }

    // ── Staff lines ──────────────────────────────────────────────────────────
    function _drawStaff(ctx) {
        ctx.strokeStyle = "#2d3a52"
        ctx.lineWidth = 1
        for (let i = 0; i < 5; i++) {
            const y = STAFF_TOP + i * SP
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width - 4, y); ctx.stroke()
        }
    }

    // ── Barlines ─────────────────────────────────────────────────────────────
    function _drawBarlines(ctx) {
        for (let b = 0; b <= bars; b++) {
            const x = FIRST_PAD + b * BAR_W
            ctx.strokeStyle = b === bars ? "#4a5568" : "#2d3a52"
            ctx.lineWidth   = b === bars ? 2 : 1
            ctx.beginPath(); ctx.moveTo(x, STAFF_TOP); ctx.lineTo(x, STAFF_TOP + 4*SP); ctx.stroke()
        }
    }

    // ── Clef (simplified rects — Bravura font not guaranteed on all OSes) ───
    function _drawClef(ctx) {
        const clef = stemData ? stemData.clef : "treble"
        ctx.fillStyle = "#94a3b8"
        ctx.font = "bold 11px monospace"
        ctx.textAlign = "left"
        if (clef === "bass") {
            ctx.fillText("𝄢", 6, STAFF_TOP + SP * 1.5 + 4)
        } else if (clef === "perc") {
            ctx.fillRect(8,  STAFF_TOP + SP,     4, SP * 2)
            ctx.fillRect(14, STAFF_TOP + SP,     4, SP * 2)
        } else {
            ctx.fillText("𝄞", 4, STAFF_TOP + SP * 3 + 4)
        }
    }

    // ── Time signature digits ────────────────────────────────────────────────
    function _drawTimeSig(ctx) {
        ctx.fillStyle = "#94a3b8"
        ctx.font = "bold 16px monospace"
        ctx.textAlign = "center"
        const tx = 58
        ctx.fillText(timeSig[0], tx, STAFF_TOP + SP * 1.2)
        ctx.fillText(timeSig[1], tx, STAFF_TOP + SP * 3.2)
    }

    // ── MIDI → diatonic position helpers ─────────────────────────────────────
    readonly property var CHROM_DIA: [0,0,1,1,2,3,3,4,4,5,5,6]

    function midiToDia(pitch) {
        return Math.floor(pitch / 12) * 7 + CHROM_DIA[pitch % 12]
    }

    // clef bottom-line diatonic reference
    function _clefBottom() {
        const clef = stemData ? stemData.clef : "treble"
        if (clef === "bass")  return 18   // G2
        if (clef === "alto")  return 24   // C3
        return 30                          // E4
    }
    function _clefMid() {
        const clef = stemData ? stemData.clef : "treble"
        if (clef === "bass")  return 22
        if (clef === "alto")  return 28
        return 34
    }

    function _yForDia(dia) {
        const bottom = _clefBottom()
        return STAFF_TOP + 4 * SP - (dia - bottom) * (SP / 2)
    }

    // ── Draw one notehead ────────────────────────────────────────────────────
    function _drawNote(ctx, x, dia, filled, color) {
        const y = _yForDia(dia)
        const up = dia < _clefMid()
        ctx.strokeStyle = color
        ctx.fillStyle   = color
        ctx.lineWidth   = 1.6

        // notehead ellipse
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(-0.35)
        ctx.beginPath()
        ctx.ellipse(0, 0, 5.2, 3.8, 0, 0, 2 * Math.PI)
        if (filled) ctx.fill(); else ctx.stroke()
        ctx.restore()

        // stem
        const stemLen = SP * 3.2
        const sx = up ? x + 4.6 : x - 4.6
        const sy1 = up ? y - 1 : y + 1
        const sy2 = up ? y - stemLen : y + stemLen
        ctx.lineWidth = 1.4
        ctx.beginPath(); ctx.moveTo(sx, sy1); ctx.lineTo(sx, sy2); ctx.stroke()

        // ledger lines
        const top = _clefBottom() + 8
        const bot = _clefBottom()
        if (dia > top) {
            for (let d = top + 2; d <= dia; d += 2) {
                const ly = _yForDia(d)
                ctx.lineWidth = 1.2
                ctx.beginPath(); ctx.moveTo(x-8, ly); ctx.lineTo(x+8, ly); ctx.stroke()
            }
        } else if (dia < bot) {
            for (let d = bot - 2; d >= dia; d -= 2) {
                const ly = _yForDia(d)
                ctx.lineWidth = 1.2
                ctx.beginPath(); ctx.moveTo(x-8, ly); ctx.lineTo(x+8, ly); ctx.stroke()
            }
        }
    }

    // ── Draw rest symbol ─────────────────────────────────────────────────────
    function _drawRest(ctx, x, v, color) {
        ctx.fillStyle = color
        ctx.strokeStyle = color
        const my = STAFF_TOP + 2 * SP
        if (v <= 1) {
            ctx.fillRect(x - 5, my - SP - 3, 10, 4)
        } else if (v === 2) {
            ctx.fillRect(x - 5, my + 1, 10, 4)
        } else if (v === 4) {
            ctx.lineWidth = 1.5
            ctx.beginPath(); ctx.moveTo(x, my - 8); ctx.lineTo(x+5, my+2); ctx.lineTo(x-2, my+7); ctx.stroke()
        } else {
            ctx.lineWidth = 1.3
            ctx.beginPath(); ctx.arc(x, my, 3, 0, Math.PI * 2); ctx.stroke()
        }
    }

    // ── Real MIDI rendering ──────────────────────────────────────────────────
    function _drawRealNotes(ctx, midiNotes) {
        const color = stemColor
        const bps   = tempo / 60
        const beats = timeSig[0]

        // Quantize to 1/16 grid
        function qz(b) { return Math.round(b * 4) / 4 }

        const events = []
        for (let i = 0; i < midiNotes.length; i++) {
            const n = midiNotes[i]
            if (n.drum) continue
            const bs = qz(n.start * bps)
            if (bs >= bars * beats) continue
            events.push({ bs, dia: midiToDia(n.pitch) })
        }

        // Sort, deduplicate per slot (highest pitch wins)
        const slotMap = {}
        for (let i = 0; i < events.length; i++) {
            const e = events[i]
            const bar = Math.floor(e.bs / beats)
            const slot = Math.round((e.bs - bar * beats) * 4)
            const key = bar + ":" + slot
            if (!slotMap[key] || e.dia > slotMap[key].dia)
                slotMap[key] = { bar, slot, dia: e.dia }
        }

        ctx.lineWidth = 1.4
        for (const key in slotMap) {
            const e = slotMap[key]
            const usable = BAR_W - NOTE_PAD_L - NOTE_PAD_R
            const mx = FIRST_PAD + e.bar * BAR_W + NOTE_PAD_L
            const x = mx + (e.slot / (beats * 4)) * usable
            _drawNote(ctx, x, e.dia, true, color)
        }
    }

    // ── Seeded fake notes (demo projects without MIDI) ───────────────────────
    function _rng(seed) {
        let s = (seed * 2654435761) % 2147483647
        return function() { s = (s * 16807) % 2147483647; return s / 2147483647 }
    }

    function _drawFakeNotes(ctx) {
        if (!stemData) return
        const color = stemColor
        const beats = timeSig[0]
        const rnd   = _rng((stemData.seed || 1) + 0)
        const clef  = stemData.clef || "treble"
        if (clef === "perc") { _drawFakeDrums(ctx, beats, rnd, color); return }

        const lo = _clefBottom() + 2
        const hi = _clefBottom() + 12
        let cur  = Math.round((lo + hi) / 2)

        for (let m = 0; m < bars; m++) {
            const usable = BAR_W - NOTE_PAD_L - NOTE_PAD_R
            const mx     = FIRST_PAD + m * BAR_W + NOTE_PAD_L
            const density = stemData.density || 2
            const noteCount = density + Math.floor(rnd() * 2)
            for (let n = 0; n < noteCount; n++) {
                const x = mx + (n / noteCount) * usable + 8
                const step = rnd() < 0.6 ? (rnd()<0.5?1:-1) : (rnd()<0.5?2:-2)
                cur = Math.max(lo, Math.min(hi, cur + step))
                _drawNote(ctx, x, cur, true, color)
            }
        }
    }

    function _drawFakeDrums(ctx, beats, rnd, color) {
        const yHat   = _yForDia(_clefBottom() + 10)
        const ySnare = _yForDia(_clefBottom() + 4)
        const yKick  = _yForDia(_clefBottom())
        for (let m = 0; m < bars; m++) {
            const usable = BAR_W - NOTE_PAD_L - NOTE_PAD_R
            const mx     = FIRST_PAD + m * BAR_W + NOTE_PAD_L
            for (let b = 0; b < beats * 2; b++) {
                const x = mx + (b / (beats * 2)) * usable + 8
                // hihat X
                ctx.strokeStyle = color; ctx.lineWidth = 1.6
                ctx.beginPath(); ctx.moveTo(x-3,yHat-3); ctx.lineTo(x+3,yHat+3); ctx.stroke()
                ctx.beginPath(); ctx.moveTo(x-3,yHat+3); ctx.lineTo(x+3,yHat-3); ctx.stroke()
                // snare on backbeats
                if (beats>=4 && (b===2||b===6)) {
                    ctx.fillStyle=color; ctx.beginPath()
                    ctx.ellipse(x,ySnare,4.8,3.5,-0.4,0,2*Math.PI); ctx.fill()
                }
                // kick
                if (b===0||(rnd()<0.15&&b%2===0)) {
                    ctx.fillStyle=color; ctx.beginPath()
                    ctx.ellipse(x,yKick,4.8,3.5,-0.4,0,2*Math.PI); ctx.fill()
                }
            }
        }
    }
}
