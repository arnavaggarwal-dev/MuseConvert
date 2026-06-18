/* ============================================================
   OVERTONE — SVG notation renderer
   Draws real 5-line staves: clef (Bravura), key sig, time sig,
   proportional onset-positioned noteheads, stems, beams, ledgers.
   ============================================================ */
const SVGNS = "http://www.w3.org/2000/svg";
const SP = 9;                 // staff space (px)
const STAFF_TOP = 30;         // y of top line
const STAFF_H = SP * 4;

// SMuFL (Bravura) codepoints
const SMUFL = {
  trebleClef: "\uE050", bassClef: "\uE062", altoClef: "\uE05C", percClef: "\uE069",
  sharp: "\uE262", flat: "\uE260", natural: "\uE261",
  restWhole: "\uE4E3", restHalf: "\uE4E4", restQuarter: "\uE4E5", restEighth: "\uE4E6", restSixteenth: "\uE4E7",
};

function el(tag, attrs, parent){
  const n = document.createElementNS(SVGNS, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}

// seeded RNG
function rng(seed){ let s = seed * 2654435761 % 2147483647; return ()=> (s = s*16807 % 2147483647) / 2147483647; }

const CLEF_REF = { // diatonic value at staff line i=4 (bottom line) + middle-line diatonic
  treble: { bottom: 30, glyph: SMUFL.trebleClef, gy: STAFF_TOP + 3*SP, mid: 34 }, // bottom E4, mid B4
  bass:   { bottom: 18, glyph: SMUFL.bassClef,   gy: STAFF_TOP + 1*SP, mid: 22 }, // bottom G2, mid D3
  alto:   { bottom: 24, glyph: SMUFL.altoClef,   gy: STAFF_TOP + 2*SP, mid: 28 }, // bottom F3, mid C4
};

function yForDia(d, clef){
  const ref = CLEF_REF[clef] || CLEF_REF.treble;
  return STAFF_TOP + 4*SP - (d - ref.bottom) * (SP/2);
}

// ---- build a measure's rhythm given beats & density ----
function buildRhythm(beats, density, rnd){
  // duration pools (value, weight) per density. value: 1=whole,2=half,4=qtr,8=8th,16=16th; dotted via .d=1.5x
  const pools = {
    1: [[2,3],[4,2],[3,1]/*dotted half (3 beats)*/],
    2: [[4,4],[2,2],[8,1]],
    3: [[8,5],[4,3],[16,1]],
    4: [[16,5],[8,4],[4,1]],
  };
  const pool = pools[density] || pools[2];
  const beatsOf = (v)=> v===3 ? 3 : (4/v);
  const out = []; let rem = beats; let guard = 0;
  while (rem > 0.001 && guard++ < 64){
    // weighted pick that fits
    const cands = pool.filter(p => beatsOf(p[0]) <= rem + 0.001);
    const cand = cands.length ? cands : [[ Math.max(4, Math.round(4/rem)) ,1]];
    let tot = cand.reduce((a,c)=>a+c[1],0), r = rnd()*tot, pick = cand[0][0];
    for (const c of cand){ r -= c[1]; if (r<=0){ pick=c[0]; break; } }
    const b = beatsOf(pick);
    const rest = rnd() < 0.10 && out.length>0;
    out.push({ v: pick===3?2:pick, dot: pick===3, beats: b, rest });
    rem -= b;
  }
  return out;
}

// ---- generate pitched notes for a stem across measures ----
function genNotes(stem, beats, bars, rnd){
  const measures = [];
  const [lo, hi] = stem.reg || [28, 38];
  let cur = Math.round((lo+hi)/2);
  for (let m=0; m<bars; m++){
    const rh = buildRhythm(beats, stem.density, rnd);
    let onset = 0;
    const notes = rh.map(r=>{
      let dia = cur;
      if (!r.rest){
        // random walk: mostly steps, sometimes leaps
        const roll = rnd();
        let step = roll < 0.55 ? (rnd()<0.5?1:-1)
                 : roll < 0.8  ? (rnd()<0.5?2:-2)
                 : roll < 0.93 ? (rnd()<0.5?3:-3) : (rnd()<0.5?4:-4);
        dia = cur + step;
        if (dia < lo) dia = lo + (lo-dia);
        if (dia > hi) dia = hi - (dia-hi);
        dia = Math.max(lo, Math.min(hi, dia));
        cur = dia;
      }
      const n = { dia, v:r.v, dot:r.dot, beats:r.beats, rest:r.rest, onset };
      onset += r.beats;
      return n;
    });
    measures.push(notes);
  }
  return measures;
}

// drum pattern generator (perc clef): kick/snare/hihat
function genDrums(beats, bars, rnd){
  const measures = [];
  for (let m=0; m<bars; m++){
    const ev = [];
    const eighths = beats*2;
    for (let e=0; e<eighths; e++){
      const beatPos = e/2;
      // hihat on every eighth
      ev.push({ kind:"hat", onset:beatPos, beats:0.5, v:8 });
      // kick on beat 1, and "and of 2"/3 with variation
      if (e===0 || (beats>=4 && e===4) || (rnd()<0.12 && e%2===0)) ev.push({ kind:"kick", onset:beatPos, beats:0.5, v:8 });
      // snare on beats 2 & 4 (backbeat) for 4/4
      if (beats>=4 && (e===2*2 || e===6 - (6-4))) {} // placeholder
    }
    // backbeat snare
    if (beats>=4){ ev.push({kind:"snare",onset:1,beats:1,v:4}); ev.push({kind:"snare",onset:3,beats:1,v:4});
      if (rnd()<0.4) ev.push({kind:"snareghost",onset:2.75,beats:0.25,v:16}); }
    else { ev.push({kind:"snare",onset:1,beats:1,v:4}); }
    measures.push(ev);
  }
  return measures;
}

// draw a single notehead+stem; returns {x, stemX, stemEndY, up, flagged}
function drawNote(g, x, n, clef, color, beats){
  const filled = n.v >= 4;
  const y = yForDia(n.dia, clef);
  const up = n.dia < (CLEF_REF[clef]||CLEF_REF.treble).mid;
  const nhW = 5.4, nhH = 3.9;
  // ledger lines
  drawLedgers(g, x, n.dia, clef);
  // accidental (sharp ♯ / flat ♭ / natural ♮) — drawn before notehead
  if (n.acc) {
    const accGlyph = n.acc === 'sharp' ? SMUFL.sharp : n.acc === 'flat' ? SMUFL.flat : SMUFL.natural;
    el("text",{x:x-10,y:y+3.5,class:"smufl",fill:"var(--t-0)","font-size":17,"opacity":"0.9"},g).textContent = accGlyph;
  }
  if (n.v === 1){ // whole note
    el("ellipse",{cx:x,cy:y,rx:nhW,ry:nhH,fill:"none",stroke:color,"stroke-width":1.7,transform:`rotate(-12 ${x} ${y})`},g);
  } else {
    el("ellipse",{cx:x,cy:y,rx:nhW,ry:nhH,fill:filled?color:"none",stroke:color,"stroke-width":filled?0:1.7,transform:`rotate(-22 ${x} ${y})`},g);
  }
  if (n.dot){ el("circle",{cx:x+nhW+4,cy:y- (Math.round((n.dia))%2===0? SP/2 : 0),r:1.5,fill:color},g); }
  let stemX=null, stemEndY=null;
  if (n.v >= 2){
    const len = SP*3.3;
    stemX = up ? x + nhW - 0.4 : x - nhW + 0.4;
    stemEndY = up ? y - len : y + len;
    el("line",{x1:stemX,y1:up?y-1:y+1,x2:stemX,y2:stemEndY,stroke:color,"stroke-width":1.5},g);
  }
  return { x, y, stemX, stemEndY, up, flagged:n.v>=8, v:n.v, beats:n.beats };
}

function drawLedgers(g, x, dia, clef){
  const topLineDia = (CLEF_REF[clef]||CLEF_REF.treble).bottom + 8; // i=0 line = bottom+8
  const botLineDia = (CLEF_REF[clef]||CLEF_REF.treble).bottom;
  if (dia > topLineDia){
    for (let d = topLineDia+2; d <= dia; d+=2){ const ly=yForDia(d,clef); el("line",{x1:x-8,y1:ly,x2:x+8,y2:ly,stroke:"var(--line-strong)","stroke-width":1.3},g); }
  } else if (dia < botLineDia){
    for (let d = botLineDia-2; d >= dia; d-=2){ const ly=yForDia(d,clef); el("line",{x1:x-8,y1:ly,x2:x+8,y2:ly,stroke:"var(--line-strong)","stroke-width":1.3},g); }
  }
}

function drawFlagOrBeam(g, group, color){
  // group: array of drawn-note refs sharing a beam. If single -> flag.
  if (group.length === 1){
    const nt = group[0];
    if (!nt.flagged || nt.stemX==null) return;
    const x = nt.stemX, y = nt.stemEndY, up = nt.up;
    const dir = up ? 1 : -1;
    el("path",{ d:`M${x},${y} q ${7*1},${dir*4} ${5},${dir*11}`, fill:"none", stroke:color, "stroke-width":2.4, "stroke-linecap":"round"},g);
    if (group[0].v>=16) el("path",{ d:`M${x},${y+dir*5} q ${7},${dir*4} ${5},${dir*10}`, fill:"none", stroke:color, "stroke-width":2.4,"stroke-linecap":"round"},g);
    return;
  }
  // beam: connect stem ends. choose common direction = majority up?
  const ups = group.filter(n=>n.up).length;
  const up = ups >= group.length/2;
  // recompute stem ends to common direction baseline
  const slopeY = (n)=> n.stemEndY;
  const xs = group.map(n=>n.stemX);
  const ys = group.map(n=>n.stemEndY);
  const x0 = xs[0], x1 = xs[xs.length-1];
  const y0 = ys[0], y1 = ys[ys.length-1];
  const beamW = 3.4;
  // primary beam (polygon)
  el("line",{x1:x0,y1:y0,x2:x1,y2:y1,stroke:color,"stroke-width":beamW,"stroke-linecap":"butt"},g);
  // secondary beam for sixteenths
  const has16 = group.some(n=>n.v>=16);
  if (has16){
    const off = up ? 6 : -6;
    el("line",{x1:x0,y1:y0+off,x2:x1,y2:y1+off,stroke:color,"stroke-width":beamW,"stroke-linecap":"butt"},g);
  }
}

// ---- MIDI → notation helpers ----

// [diaStep(0-6), alteration(-1/0/1)] for each pitch class — two spellings
const _SPELL_SHARP = [[0,0],[0,1],[1,0],[1,1],[2,0],[3,0],[3,1],[4,0],[4,1],[5,0],[5,1],[6,0]];
const _SPELL_FLAT  = [[0,0],[1,-1],[1,0],[2,-1],[2,0],[3,0],[4,-1],[4,0],[5,-1],[5,0],[6,-1],[6,0]];
const _STEPS = 'CDEFGAB';

// Returns {dia, acc: 'sharp'|'flat'|'natural'|null}
// Chooses enharmonic spelling (C#/Db etc.) based on key signature, then compares
// the note's actual alteration to what the key sig implies for that diatonic step.
function _midiNoteInfo(pitch, ks) {
  const pc  = ((pitch % 12) + 12) % 12;
  const oct = Math.floor(pitch / 12) - 1;
  const ksSharps = (ks && ks.sharps) || [];
  const ksFlats  = (ks && ks.flats)  || [];
  const isAltered = !!_SPELL_SHARP[pc][1]; // true for C#/Db, D#/Eb, F#/Gb, G#/Ab, A#/Bb

  let diaStep, noteAcc;
  if (!isAltered) {
    diaStep = _SPELL_SHARP[pc][0]; noteAcc = 0;
  } else {
    const sharpBase = _STEPS[_SPELL_SHARP[pc][0]]; // e.g. 'C' for C#
    const flatBase  = _STEPS[_SPELL_FLAT[pc][0]];  // e.g. 'D' for Db
    if      (ksSharps.includes(sharpBase)) { diaStep=_SPELL_SHARP[pc][0]; noteAcc=1;  }
    else if (ksFlats.includes(flatBase))   { diaStep=_SPELL_FLAT[pc][0];  noteAcc=-1; }
    else if (ksFlats.length > 0)           { diaStep=_SPELL_FLAT[pc][0];  noteAcc=-1; }
    else                                   { diaStep=_SPELL_SHARP[pc][0]; noteAcc=1;  }
  }

  const stepName  = _STEPS[diaStep];
  const keySigAcc = ksSharps.includes(stepName) ? 1 : ksFlats.includes(stepName) ? -1 : 0;
  const displayAcc = noteAcc === keySigAcc ? null
    : noteAcc === 0 ? 'natural' : noteAcc === 1 ? 'sharp' : 'flat';

  return { dia: oct * 7 + diaStep, acc: displayAcc };
}

// Keep for any legacy callers
function midiToDia(pitch){ return _midiNoteInfo(pitch, null).dia; }

function _qz(b, grid=0.25){ return Math.round(b/grid)*grid; }
function _beatDurToV(db){
  if(db>=3.5) return {v:1,dot:false};
  if(db>=2.5) return {v:2,dot:true};
  if(db>=1.75) return {v:2,dot:false};
  if(db>=1.2)  return {v:4,dot:true};
  if(db>=0.85) return {v:4,dot:false};
  if(db>=0.6)  return {v:8,dot:true};
  if(db>=0.35) return {v:8,dot:false};
  return {v:16,dot:false};
}

function buildMeasuresFromMidi(midiNotes, beats, bars, tempo, barOffset, keySig){
  const bps = tempo / 60;
  const off = (barOffset || 0) * beats;
  // 8th-note grid: notes 0.5 beats apart minimum → ~17px spacing, no visual collision
  const GRID = 0.5;
  const SLOTS = beats * 2;
  const MIN_REST = 1.0; // suppress rests shorter than a quarter note

  const events = midiNotes
    .filter(n => !n.drum)
    .map(n => {
      const info = _midiNoteInfo(n.pitch, keySig);
      return {
        beatStart: _qz(n.start * bps, GRID) - off,
        beatDur:   Math.max(GRID, _qz((n.end - n.start) * bps, GRID)),
        dia:       info.dia,
        acc:       info.acc,
      };
    })
    .filter(n => n.beatStart >= 0 && n.beatStart < bars * beats);

  const grid = Array.from({length:bars}, ()=>Array(SLOTS).fill(null));
  events.forEach(n => {
    const bar = Math.floor(n.beatStart / beats);
    if(bar < 0 || bar >= bars) return;
    const slot = Math.round((n.beatStart - bar*beats) / GRID);
    if(slot < 0 || slot >= SLOTS) return;
    // keep highest pitch per slot (most audible note wins)
    if(!grid[bar][slot] || n.dia > grid[bar][slot].dia)
      grid[bar][slot] = { dia:n.dia, acc:n.acc, beatDur:n.beatDur };
  });

  return grid.map(row => {
    const notes = [];
    let pos = 0;
    const barAccShown = new Set();
    for(let s=0; s<SLOTS; s++){
      const bp = s * GRID;
      if(pos > bp + 0.001) continue;
      const evt = row[s];
      if(evt){
        // only insert rest if the gap is big enough to show without overlap
        if(bp > pos + 0.001){
          const gap = bp - pos;
          if(gap >= MIN_REST){ const rv=_beatDurToV(gap); notes.push({dia:34,v:rv.v,dot:rv.dot,beats:gap,rest:true,onset:pos}); }
        }
        const nv=_beatDurToV(evt.beatDur); const ad=Math.min(evt.beatDur, beats-bp);
        const accKey = evt.dia % 7;
        const showAcc = evt.acc && !barAccShown.has(accKey) ? evt.acc : null;
        if (evt.acc) barAccShown.add(accKey);
        notes.push({dia:evt.dia, acc:showAcc, v:nv.v, dot:nv.dot, beats:ad, rest:false, onset:bp});
        pos = bp + ad;
      }
    }
    // trailing rest: only if remainder >= 1 beat
    if(pos < beats - 0.001){
      const gap = beats - pos;
      if(gap >= MIN_REST){ const rv=_beatDurToV(gap); notes.push({dia:34,v:rv.v,dot:rv.dot,beats:gap,rest:true,onset:pos}); }
    }
    return notes.length ? notes : [{dia:34,v:1,dot:false,beats:beats,rest:true,onset:0}];
  });
}

// ---- main: render one staff system into an SVG ----
function renderStaff(stem, project, opts){
  const beats = project.timeSig[0];
  const bars = project.bars;
  const clef = stem.clef === "perc" ? "treble" : stem.clef;
  const mW = beats === 3 ? 132 : 168;
  const notePadL = 16, notePadR = 14;

  // pre-compute header width so firstPad is always wide enough
  // clef ends ~x42; key sig: 8.5px/sharp, 8px/flat; time sig: 24px + gap
  const ks = KEYSIG[project.key] || {sharps:[],flats:[]};
  const kEndX = 44 + ks.sharps.length * 8.5 + ks.flats.length * 8;
  const tsX   = Math.max(kEndX + 6, 60);
  const firstPad = Math.max(78, Math.ceil(tsX + 28)); // 28 = time sig glyph width + gap

  const totalW = firstPad + mW*bars + 8;
  // bass clef needs extra vertical room (E1 open string lands at y≈107)
  const height = clef === 'bass' ? 148 : 96;
  const svg = el("svg",{ width: totalW, height, viewBox:`0 0 ${totalW} ${height}`, class:"staff-svg" });
  const css = getComputedStyle(document.documentElement);
  const color = css.getPropertyValue(stem.color).trim() || "#9ab";

  // staff lines
  const lineG = el("g",{},svg);
  for (let i=0;i<5;i++){ const y=STAFF_TOP+i*SP; el("line",{x1:0,y1:y,x2:totalW-4,y2:y,stroke:"var(--line)","stroke-width":1},lineG); }

  // clef
  const clefGlyph = stem.clef==="perc" ? SMUFL.percClef : (CLEF_REF[clef]||CLEF_REF.treble).glyph;
  const clefGy = stem.clef==="perc" ? STAFF_TOP+2*SP : (CLEF_REF[clef]||CLEF_REF.treble).gy;
  el("text",{x:10,y:clefGy,class:"smufl",fill:"var(--t-1)","font-size":34},svg).textContent = clefGlyph;

  // key signature (sharps/flats)
  let kx = 44;
  const accDia = (name)=>{
    const base = clef==="bass"? {F:dabs("F",3),C:dabs("C",3),G:dabs("G",3),A:dabs("A",2),E:dabs("E",3),B:dabs("B",2),D:dabs("D",3)}
               : clef==="alto"? {F:dabs("F",4),C:dabs("C",4),G:dabs("G",4),A:dabs("A",3),E:dabs("E",4),B:dabs("B",3),D:dabs("D",4)}
               :               {F:dabs("F",5),C:dabs("C",5),G:dabs("G",5),A:dabs("A",4),E:dabs("E",5),B:dabs("B",4),D:dabs("D",5)};
    return base[name];
  };
  if (stem.clef!=="perc"){
    ks.sharps.forEach(s=>{ const y=yForDia(accDia(s),clef); el("text",{x:kx,y:y+3.2,class:"smufl",fill:"var(--t-1)","font-size":22},svg).textContent=SMUFL.sharp; kx+=8.5; });
    ks.flats.forEach(s=>{ const y=yForDia(accDia(s),clef); el("text",{x:kx,y:y+3.2,class:"smufl",fill:"var(--t-1)","font-size":22},svg).textContent=SMUFL.flat; kx+=8; });
  }

  // time signature (use pre-computed tsX so it always lands before firstPad)
  el("text",{x:tsX,y:STAFF_TOP+SP*1.05+1,class:"smufl ts",fill:"var(--t-0)","font-size":24,"text-anchor":"middle"},svg).textContent = tsNum(project.timeSig[0]);
  el("text",{x:tsX,y:STAFF_TOP+SP*3.05+1,class:"smufl ts",fill:"var(--t-0)","font-size":24,"text-anchor":"middle"},svg).textContent = tsNum(project.timeSig[1]);

  // barlines
  for (let b=0;b<=bars;b++){ const x=firstPad+b*mW; el("line",{x1:x,y1:STAFF_TOP,x2:x,y2:STAFF_TOP+4*SP,stroke:b===bars?"var(--line-strong)":"var(--line)","stroke-width":b===bars?2:1},svg); }

  const rnd = rng(stem.seed + (opts&&opts.salt||0));

  if (stem.clef === "perc"){
    renderDrums(svg, beats, bars, firstPad, mW, notePadL, notePadR, color, rnd);
    return svg;
  }

  const measures = (stem.midiNotes && stem.midiNotes.length > 0)
    ? buildMeasuresFromMidi(stem.midiNotes, beats, bars, project.tempo || 120, project.barOffset || 0, ks)
    : genNotes(stem, beats, bars, rnd);
  const noteG = el("g",{},svg);

  measures.forEach((notes, mi)=>{
    const mx = firstPad + mi*mW + notePadL;
    const usable = mW - notePadL - notePadR;
    // draw + collect for beaming
    const drawn = [];
    notes.forEach(n=>{
      const x = mx + (n.onset/beats)*usable;
      if (n.rest){ drawRest(noteG, x, n, clef); drawn.push({rest:true}); return; }
      const d = drawNote(noteG, x, n, clef, color, beats);
      drawn.push(d);
    });
    // beam grouping: consecutive flagged notes within same beat
    let group = [];
    const flush = ()=>{ if(group.length){ drawFlagOrBeam(noteG, group, color); group=[]; } };
    let i=0;
    notes.forEach((n,idx)=>{
      const d = drawn[idx];
      if (n.rest || !d || !d.flagged){ flush(); return; }
      const beatIndex = Math.floor(n.onset);
      if (group.length){
        const prevBeat = Math.floor(notes[group._lastIdx].onset);
        if (beatIndex !== prevBeat){ flush(); }
      }
      group.push(d); group._lastIdx = idx;
    });
    flush();
  });

  // selection highlight token (first measure phrase marker) – subtle slur on melodic stems
  return svg;
}

function tsNum(n){ // map digit to Bravura time sig glyph
  const map={0:"\uE080",1:"\uE081",2:"\uE082",3:"\uE083",4:"\uE084",5:"\uE085",6:"\uE086",7:"\uE087",8:"\uE088",9:"\uE089"};
  return map[n]||String(n);
}

function drawRest(g, x, n, clef){
  const glyph = n.v<=1?SMUFL.restWhole : n.v===2?SMUFL.restHalf : n.v===4?SMUFL.restQuarter : n.v===8?SMUFL.restEighth : SMUFL.restSixteenth;
  const y = STAFF_TOP + 2*SP + (n.v<=2? (n.v===1?-SP:-SP+1) : SP*0.0);
  el("text",{x:x-3,y:STAFF_TOP+2*SP+ (n.v===1?-1:2),class:"smufl",fill:"var(--t-2)","font-size":24},g).textContent=glyph;
}

function renderDrums(svg, beats, bars, firstPad, mW, padL, padR, color, rnd){
  const g = el("g",{},svg);
  const hatDia = dabs("A",5);   // above staff (x notehead)
  const snareDia = dabs("C",5); // middle-ish
  const kickDia = dabs("F",4);  // bottom space
  const yHat = yForDia(hatDia,"treble"), ySn = yForDia(snareDia,"treble"), yKk = yForDia(kickDia,"treble");
  const measures = genDrums(beats, bars, rnd);
  measures.forEach((ev, mi)=>{
    const mx = firstPad + mi*mW + padL;
    const usable = mW - padL - padR;
    // beam the hats per beat
    const hats = ev.filter(e=>e.kind==="hat").sort((a,b)=>a.onset-b.onset);
    // hat x noteheads
    hats.forEach(h=>{ const x=mx+(h.onset/beats)*usable; drawX(g,x,yHat,color); el("line",{x1:x+0.2,y1:yHat,x2:x+0.2,y2:yHat-SP*3,stroke:color,"stroke-width":1.4},g); });
    // beam across hats in groups of beat
    const byBeat={};
    hats.forEach(h=>{ const b=Math.floor(h.onset); (byBeat[b]=byBeat[b]||[]).push(h); });
    Object.values(byBeat).forEach(grp=>{ if(grp.length>1){ const x0=mx+(grp[0].onset/beats)*usable+0.2, x1=mx+(grp[grp.length-1].onset/beats)*usable+0.2; el("line",{x1:x0,y1:yHat-SP*3,x2:x1,y2:yHat-SP*3,stroke:color,"stroke-width":3},g);} });
    // snares & kicks
    ev.filter(e=>e.kind==="snare").forEach(s=>{ const x=mx+(s.onset/beats)*usable; el("ellipse",{cx:x,cy:ySn,rx:5,ry:3.7,fill:color,transform:`rotate(-22 ${x} ${ySn})`},g); el("line",{x1:x-4.6,y1:ySn,x2:x-4.6,y2:ySn+SP*3,stroke:color,"stroke-width":1.5},g); });
    ev.filter(e=>e.kind==="snareghost").forEach(s=>{ const x=mx+(s.onset/beats)*usable; el("ellipse",{cx:x,cy:ySn,rx:3.4,ry:2.6,fill:"none",stroke:color,"stroke-width":1.3,opacity:0.7,transform:`rotate(-22 ${x} ${ySn})`},g); });
    ev.filter(e=>e.kind==="kick").forEach(k=>{ const x=mx+(k.onset/beats)*usable; el("ellipse",{cx:x,cy:yKk,rx:5,ry:3.7,fill:color,transform:`rotate(-22 ${x} ${yKk})`},g); el("line",{x1:x+4.6,y1:yKk,x2:x+4.6,y2:yKk-SP*3,stroke:color,"stroke-width":1.5},g); });
  });
}

function drawX(g,x,y,color){
  el("line",{x1:x-3.4,y1:y-3.4,x2:x+3.4,y2:y+3.4,stroke:color,"stroke-width":1.8,"stroke-linecap":"round"},g);
  el("line",{x1:x-3.4,y1:y+3.4,x2:x+3.4,y2:y-3.4,stroke:color,"stroke-width":1.8,"stroke-linecap":"round"},g);
}
