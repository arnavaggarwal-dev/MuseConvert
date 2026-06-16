/* ============================================================
   export.js — MusicXML / MuseScore (.mscz) / PDF score export + File menu
   ============================================================ */

function toggleFileMenu(e) {
  e && e.stopPropagation();
  const dd = document.getElementById('dd-file');
  const open = dd.classList.toggle('open');
  if (open) _populateExportStemSel();
}

document.addEventListener('click', () => {
  document.getElementById('dd-file')?.classList.remove('open');
});

function _populateExportStemSel() {
  const p = typeof P === 'function' ? P() : null;
  const sel = document.getElementById('exp-stem-sel');
  if (!sel) return;
  sel.innerHTML = '';
  if (!p) { sel.innerHTML = '<option value="">No project</option>'; return; }
  // Drums have no pitched MIDI (pyin can't transcribe percussion) — skip them
  const exportable = p.stems.filter(s => s.id !== 'drums' && s.name.toLowerCase() !== 'drums');
  if (!exportable.length) { sel.innerHTML = '<option value="">No pitched tracks</option>'; return; }
  exportable.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  });
  if (typeof STATE !== 'undefined' && STATE.sel && STATE.sel !== 'drums') sel.value = STATE.sel;
}

// ── Key sig fifths table ──────────────────────────────────────────────────────
const _KEY_5THS = {
  'C major':0,'G major':1,'D major':2,'A major':3,'E major':4,'B major':5,
  'F# major':6,'C# major':7,'F major':-1,'Bb major':-2,'Eb major':-3,
  'Ab major':-4,'Db major':-5,'Gb major':-6,'Cb major':-7,
  'A minor':0,'E minor':1,'B minor':2,'F# minor':3,'C# minor':4,'G# minor':5,
  'D# minor':6,'A# minor':7,'D minor':-1,'G minor':-2,'C minor':-3,
  'F minor':-4,'Bb minor':-5,'Eb minor':-6,'Ab minor':-7,
};

function _escXml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── MusicXML 3.1 builder ──────────────────────────────────────────────────────
function _buildMusicXML(stem, project) {
  const tempo = project.tempo || 120;
  const [beatsPerBar, beatUnit] = project.timeSig || [4, 4];
  const secPerBeat = 60 / tempo;
  const barSecs = beatsPerBar * secPerBeat;
  const DIVS = 480;

  const _STEPS = ['C','C','D','D','E','F','F','G','G','A','A','B'];
  const _ALTER = [0,  1,  0,  1,  0,  0,  1,  0,  1,  0,  1,  0];

  function _pitch(midi) {
    const pc = ((midi % 12) + 12) % 12;
    return { step: _STEPS[pc], alter: _ALTER[pc], oct: Math.floor(midi / 12) - 1 };
  }

  function qz(secs) { return Math.round(secs / secPerBeat / 0.25) * 0.25; } // snap to 16th-beat grid

  const notes = [...(stem.midiNotes || [])].sort((a, b) => a.start - b.start);
  const last = notes[notes.length - 1];
  const totalBarsXml = last ? Math.ceil(last.end / barSecs) + 1 : 1;
  const fifths = _KEY_5THS[project.key] ?? 0;
  const mode   = (project.key || '').includes('minor') ? 'minor' : 'major';
  const clefSign = stem.clef === 'bass' ? 'F' : 'G';
  const clefLine = stem.clef === 'bass' ? 4 : 2;

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" ` +
    `"http://www.musicxml.org/dtds/partwise.dtd">\n` +
    `<score-partwise version="3.1">\n` +
    `  <work><work-title>${_escXml(project.title)}</work-title></work>\n` +
    `  <identification><encoding><software>AegisScore</software>` +
    `<encoding-date>${new Date().toISOString().slice(0,10)}</encoding-date></encoding></identification>\n` +
    `  <part-list><score-part id="P1"><part-name>${_escXml(stem.name)}</part-name>` +
    `<score-instrument id="P1-I1"><instrument-name>${_escXml(stem.instrument || stem.name)}</instrument-name>` +
    `</score-instrument></score-part></part-list>\n  <part id="P1">`;

  for (let bar = 0; bar < totalBarsXml; bar++) {
    const t0 = bar * barSecs, t1 = t0 + barSecs;
    const bn = notes.filter(n => n.start < t1 && n.end > t0);

    xml += `\n    <measure number="${bar + 1}">`;
    if (bar === 0) {
      xml += `\n      <attributes>` +
        `<divisions>${DIVS}</divisions>` +
        `<key><fifths>${fifths}</fifths><mode>${mode}</mode></key>` +
        `<time><beats>${beatsPerBar}</beats><beat-type>${beatUnit}</beat-type></time>` +
        `<clef><sign>${clefSign}</sign><line>${clefLine}</line></clef></attributes>`;
      xml += `\n      <direction placement="above">` +
        `<direction-type><metronome><beat-unit>quarter</beat-unit>` +
        `<per-minute>${tempo}</per-minute></metronome></direction-type>` +
        `<sound tempo="${tempo}"/></direction>`;
    }

    if (bn.length === 0) {
      xml += `\n      <note><rest measure="yes"/><duration>${DIVS * beatsPerBar}</duration><type>whole</type></note>`;
    } else {
      // Group simultaneous notes into chords (within one 16th of each other)
      const evts = bn.map(n => ({
        startB: Math.max(0, Math.min(qz(n.start - t0), beatsPerBar - 0.25)),
        endB:   Math.min(beatsPerBar, Math.max(qz(n.end - t0), 0.25)),
        pitch:  n.pitch,
      })).filter(e => e.endB > e.startB).sort((a, b) => a.startB - b.startB);

      const chords = [];
      for (const e of evts) {
        const prev = chords[chords.length - 1];
        if (prev && e.startB < prev.startB + 0.125) {
          prev.pitches.push(e.pitch);
          prev.endB = Math.max(prev.endB, e.endB);
        } else {
          if (prev && prev.endB > e.startB) prev.endB = e.startB;
          chords.push({ startB: e.startB, endB: e.endB, pitches: [e.pitch] });
        }
      }
      chords.forEach(c => {
        const uniq = [...new Set(c.pitches)];
        c.pitches = stem.clef === 'bass' ? [Math.min(...uniq)] : uniq.slice(0, 4);
      });

      let pos = 0;
      for (const c of chords) {
        if (c.startB > pos + 0.124) {
          const sn = _snapNote(c.startB - pos, beatsPerBar - pos);
          const d = Math.round(sn.b * DIVS);
          xml += `\n      <note><rest/><duration>${d}</duration>` +
            (sn.dots ? `<dot/>` : '') + `<type>${sn.t}</type></note>`;
          pos = Math.round((pos + sn.b) * 1000) / 1000;
        }
        pos = c.startB;
        const durB = Math.max(0.25, Math.min(c.endB - c.startB, beatsPerBar - pos));
        const sn   = _snapNote(durB, beatsPerBar - pos);
        const nd   = Math.round(sn.b * DIVS);
        const firstPitch = c.pitches[0];
        const pp = _pitch(firstPitch);
        // First note in chord (no <chord/> tag)
        xml += `\n      <note><pitch><step>${pp.step}</step>` +
          (pp.alter ? `<alter>${pp.alter}</alter>` : '') +
          `<octave>${pp.oct}</octave></pitch>` +
          `<duration>${nd}</duration><voice>1</voice>` +
          (sn.dots ? `<dot/>` : '') + `<type>${sn.t}</type></note>`;
        // Additional pitches in chord (with <chord/> tag)
        for (let i = 1; i < c.pitches.length; i++) {
          const pp2 = _pitch(c.pitches[i]);
          xml += `\n      <note><chord/><pitch><step>${pp2.step}</step>` +
            (pp2.alter ? `<alter>${pp2.alter}</alter>` : '') +
            `<octave>${pp2.oct}</octave></pitch>` +
            `<duration>${nd}</duration><voice>1</voice>` +
            (sn.dots ? `<dot/>` : '') + `<type>${sn.t}</type></note>`;
        }
        pos = Math.round((pos + sn.b) * 1000) / 1000;
      }

      if (pos < beatsPerBar - 0.124) {
        const sn = _snapNote(beatsPerBar - pos, beatsPerBar - pos);
        const d  = Math.round(sn.b * DIVS);
        xml += `\n      <note><rest/><duration>${d}</duration>` +
          (sn.dots ? `<dot/>` : '') + `<type>${sn.t}</type></note>`;
      }
    }
    xml += '\n    </measure>';
  }

  xml += '\n  </part>\n</score-partwise>';
  return xml;
}

// ── MuseScore 3 native format (.mscz = zip containing .mscx) ─────────────────

const _TPC_SHARP = [14, 21, 16, 23, 18, 13, 20, 15, 22, 17, 24, 19];
const _TPC_FLAT  = [14,  9, 16, 11, 18, 13,  8, 15, 10, 17, 12, 19];
const _GM_PROG   = { bass: 33, other: 40, vocals: 52, guitar: 25, piano: 0 };

// Valid note durations in beats, largest first
const _NOTE_VALS = [
  {b:4,   t:'whole',   dots:0},
  {b:3,   t:'half',    dots:1},
  {b:2,   t:'half',    dots:0},
  {b:1.5, t:'quarter', dots:1},
  {b:1,   t:'quarter', dots:0},
  {b:0.75,t:'eighth',  dots:1},
  {b:0.5, t:'eighth',  dots:0},
  {b:0.375,t:'16th',   dots:1},
  {b:0.25,t:'16th',    dots:0},
  {b:0.125,t:'32nd',   dots:0},
];

// Snap db beats to nearest valid note value ≤ maxB
function _snapNote(db, maxB = 8) {
  db = Math.max(0.125, db);
  const cands = _NOTE_VALS.filter(v => v.b <= maxB + 0.001);
  if (!cands.length) return _NOTE_VALS[_NOTE_VALS.length - 1];
  return cands.reduce((best, v) => Math.abs(v.b - db) < Math.abs(best.b - db) ? v : best);
}

// Decompose a beat-duration into a sequence of valid note values
function _decompose(db, maxFirstB = 8) {
  const parts = [];
  let rem = Math.max(0, Math.round(db * 1000) / 1000);
  let first = true;
  for (let guard = 0; rem >= 0.124 && guard < 24; guard++) {
    const s = _snapNote(rem, first ? maxFirstB : rem);
    parts.push(s);
    rem = Math.round((rem - s.b) * 1000) / 1000;
    first = false;
  }
  return parts;
}

function _buildMscx(stem, project) {
  const tempo  = project.tempo || 120;
  const [sigN, sigD] = project.timeSig || [4, 4];
  const BPS    = tempo / 60;                     // beats per second
  const barSecs = sigN / BPS;
  const GRID   = 0.25;                           // 16th-note quantisation grid (beats)
  const fifths = _KEY_5THS[project.key] ?? 0;
  const TPC    = fifths < 0 ? _TPC_FLAT : _TPC_SHARP;
  const prog   = _GM_PROG[stem.id] ?? 0;
  const clef   = stem.clef === 'bass' ? 'F' : 'G';

  function qz(beats) { return Math.round(beats / GRID) * GRID; }

  function chordXml(type, dots, pitches) {
    let s = `          <Chord><durationType>${type}</durationType>`;
    if (dots) s += `<dots>${dots}</dots>`;
    pitches.forEach(p => {
      const pc = ((p % 12) + 12) % 12;
      s += `<Note><pitch>${p}</pitch><tpc>${TPC[pc]}</tpc></Note>`;
    });
    return s + `</Chord>\n`;
  }

  function restXml(type, dots) {
    return `          <Rest><durationType>${type}</durationType>${dots ? `<dots>${dots}</dots>` : ''}</Rest>\n`;
  }

  const allNotes = [...(stem.midiNotes || [])].sort((a, b) => a.start - b.start);
  const last = allNotes[allNotes.length - 1];
  const totalMeasures = last ? Math.ceil(last.end / barSecs) + 1 : 1;

  let x  = `<?xml version="1.0" encoding="UTF-8"?>\n<museScore version="3.01">\n  <Score>\n`;
  x += `    <Division>480</Division>\n    <Style/>\n`;
  x += `    <metaTag name="title">${_escXml(project.title)}</metaTag>\n`;
  x += `    <Part>\n      <Staff id="1"/>\n      <trackName>${_escXml(stem.name)}</trackName>\n`;
  x += `      <Instrument>\n        <trackName>${_escXml(stem.name)}</trackName>\n`;
  x += `        <Channel><program value="${prog}"/></Channel>\n      </Instrument>\n    </Part>\n`;
  x += `    <Staff id="1">\n`;

  for (let m = 0; m < totalMeasures; m++) {
    const t0 = m * barSecs, t1 = t0 + barSecs;
    const mn = allNotes.filter(n => n.start < t1 && n.end > t0);

    x += `      <Measure>\n        <voice>\n`;
    if (m === 0) {
      x += `          <KeySig><accidental>${fifths}</accidental></KeySig>\n`;
      x += `          <TimeSig><sigN>${sigN}</sigN><sigD>${sigD}</sigD></TimeSig>\n`;
      x += `          <Clef><subtype>${clef}</subtype></Clef>\n`;
      x += `          <Tempo><tempo>${(tempo / 60).toFixed(6)}</tempo></Tempo>\n`;
    }

    if (mn.length === 0) {
      x += `          <Rest><durationType>measure</durationType><duration>${sigN}/${sigD}</duration></Rest>\n`;
    } else {
      // Convert to beat offsets relative to measure start, quantise to grid
      const evts = mn.map(n => ({
        startB: Math.max(0, Math.min(qz((n.start - t0) * BPS), sigN - GRID)),
        endB:   Math.min(sigN, Math.max(qz((n.end   - t0) * BPS), GRID)),
        pitch:  n.pitch,
      })).filter(e => e.endB > e.startB);

      evts.sort((a, b) => a.startB - b.startB);

      // Group simultaneous notes (within GRID/2) into chords, clip overlapping ends
      const chords = [];
      for (const e of evts) {
        const prev = chords[chords.length - 1];
        if (prev && e.startB < prev.startB + GRID / 2) {
          prev.pitches.push(e.pitch);
          prev.endB = Math.max(prev.endB, e.endB);
        } else {
          if (prev && prev.endB > e.startB) prev.endB = e.startB;
          chords.push({ startB: e.startB, endB: e.endB, pitches: [e.pitch] });
        }
      }

      // Reduce polyphony: bass → lowest pitch only; others → up to 4 unique pitches
      chords.forEach(c => {
        const uniq = [...new Set(c.pitches)];
        c.pitches = stem.clef === 'bass' ? [Math.min(...uniq)] : uniq.slice(0, 4);
      });

      // Render chords with proper rests filling all gaps
      let pos = 0;
      for (const c of chords) {
        if (c.startB > pos + GRID / 2) {
          _decompose(c.startB - pos, sigN - pos).forEach(r => { x += restXml(r.t, r.dots); });
        }
        pos = c.startB;
        const durB = Math.max(GRID, Math.min(c.endB - c.startB, sigN - pos));
        const sn   = _snapNote(durB, sigN - pos);
        x += chordXml(sn.t, sn.dots, c.pitches);
        pos += sn.b;
        pos  = Math.round(pos * 1000) / 1000;
      }

      // Fill tail of measure with rests
      if (pos < sigN - GRID / 2) {
        _decompose(sigN - pos, sigN - pos).forEach(r => { x += restXml(r.t, r.dots); });
      }
    }

    x += `        </voice>\n      </Measure>\n`;
  }

  x += `    </Staff>\n  </Score>\n</museScore>`;
  return x;
}

// CRC-32 for ZIP
function _crc32(u8arr) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < u8arr.length; i++) {
    crc ^= u8arr[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Pack a single file into a ZIP blob (stored, no compression)
function _makeMscz(innerFilename, xmlStr) {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(innerFilename);
  const data = enc.encode(xmlStr);
  const crc = _crc32(data);

  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const LFH = 30 + nameBytes.length;        // local file header size
  const CDH = 46 + nameBytes.length;        // central directory header size
  const total = LFH + data.length + CDH + 22;

  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let p = 0;

  const w32 = n => { v.setUint32(p, n, true); p += 4; };
  const w16 = n => { v.setUint16(p, n, true); p += 2; };
  const wB  = arr => { u8.set(arr, p); p += arr.length; };

  // Local file header
  w32(0x04034B50); w16(20); w16(0); w16(0); // sig, ver, flags, method=stored
  w16(dosTime); w16(dosDate);
  w32(crc); w32(data.length); w32(data.length);
  w16(nameBytes.length); w16(0);
  wB(nameBytes); wB(data);

  const cdOff = p; // start of central directory

  // Central directory header
  w32(0x02014B50); w16(20); w16(20); w16(0); w16(0);
  w16(dosTime); w16(dosDate);
  w32(crc); w32(data.length); w32(data.length);
  w16(nameBytes.length); w16(0); w16(0); w16(0); w16(0);
  w32(0); w32(0); // external attrs, local header offset
  wB(nameBytes);

  const cdSize = p - cdOff;

  // End of central directory
  w32(0x06054B50); w16(0); w16(0); w16(1); w16(1);
  w32(cdSize); w32(cdOff); w16(0);

  return new Blob([buf], { type: 'application/octet-stream' });
}

// ── Download helper ───────────────────────────────────────────────────────────
function _downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
}

// ── Public export entry point ─────────────────────────────────────────────────
async function exportScore(fmt) {
  document.getElementById('dd-file')?.classList.remove('open');
  const p = typeof P === 'function' ? P() : null;
  if (!p) { alert('No project open.'); return; }
  const stemId = document.getElementById('exp-stem-sel')?.value || p.stems.find(s => s.id !== 'drums')?.id;
  const stem = p.stems.find(s => s.id === stemId);
  if (!stem) return;

  if (stem.id === 'drums' || stem.name.toLowerCase() === 'drums') {
    alert('Drums track has no pitched MIDI data — choose a different track.'); return;
  }

  // Lazy-load if midiNotes was never initialized (undefined = never attempted)
  if (stem.midiNotes === undefined) {
    const sid = typeof STATE !== 'undefined' ? STATE.liveSid : null;
    if (sid && stem.midi_url) {
      try {
        const r = await fetch(`/api/midi/${sid}/${stem.id}`);
        if (r.ok) { const d = await r.json(); stem.midiNotes = d.notes || []; }
        else stem.midiNotes = [];
      } catch(_) { stem.midiNotes = []; }
    } else {
      stem.midiNotes = [];
    }
  }
  // midiNotes is now always defined — [] means no detected notes (export with rests)
  if (stem.midiNotes === undefined) {
    alert(`Cannot export "${stem.name}" — process a song first.`); return;
  }

  if (fmt === 'musicxml') {
    const xml = _buildMusicXML(stem, p);
    _downloadBlob(
      new Blob([xml], { type: 'application/vnd.recordare.musicxml+xml' }),
      `${p.title} - ${stem.name}.musicxml`
    );

  } else if (fmt === 'musescore') {
    const mscx = _buildMscx(stem, p);
    const safeName = `${p.title} - ${stem.name}`.replace(/[/\\:*?"<>|]/g, '_');
    const blob = _makeMscz(`${safeName}.mscx`, mscx);
    _downloadBlob(blob, `${safeName}.mscz`);

  } else if (fmt === 'pdf') {
    const row = [...document.querySelectorAll('#score-systems .staff-row')]
      .find(r => r.dataset.stem === stemId);
    const liveSvg = row?.querySelector('svg');

    let svgStr;
    if (liveSvg) {
      const clone = liveSvg.cloneNode(true);
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      bg.setAttribute('x', 0); bg.setAttribute('y', 0);
      bg.setAttribute('width', clone.getAttribute('width'));
      bg.setAttribute('height', clone.getAttribute('height'));
      bg.setAttribute('fill', '#ffffff');
      clone.insertBefore(bg, clone.firstChild);
      svgStr = new XMLSerializer().serializeToString(clone);
    }

    const stemInfo = `${stem.name} &nbsp;·&nbsp; ${_escXml(p.key)} &nbsp;·&nbsp; ${p.tempo} BPM &nbsp;·&nbsp; ${(p.timeSig || [4,4]).join('/')}`;
    const barLabel = `Bars ${(p.barOffset || 0) + 1}–${(p.barOffset || 0) + p.bars}`;
    const imgTag = svgStr
      ? `<img src="data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgStr)))}" style="width:100%;max-width:1200px;display:block;margin:0 auto;" />`
      : '<p style="color:red">Score not rendered.</p>';

    const pw = window.open('', '_blank', 'width=960,height=720');
    if (!pw) { alert('Pop-up blocked — allow pop-ups for PDF export'); return; }
    pw.document.write(`<!DOCTYPE html><html><head>
      <title>${_escXml(p.title)} — ${_escXml(stem.name)}</title>
      <style>
        * { margin:0; padding:0; box-sizing:border-box; }
        body { background:white; font-family:'Times New Roman',serif; padding:24px; }
        h1 { text-align:center; font-size:20px; margin-bottom:4px; }
        .sub { text-align:center; font-size:12px; color:#555; margin-bottom:6px; }
        .bar-lbl { text-align:center; font-size:11px; color:#888; margin-bottom:16px; }
        .btn { display:block; margin:16px auto; padding:8px 28px; font-size:13px; cursor:pointer; }
        @media print { .btn { display:none; } @page { size:A4 landscape; margin:1.5cm; } }
      </style>
    </head><body>
      <h1>${_escXml(p.title)}</h1>
      <div class="sub">${stemInfo}</div>
      <div class="bar-lbl">${barLabel}</div>
      ${imgTag}
      <button class="btn" onclick="window.print()">Print / Save as PDF</button>
    </body></html>`);
    pw.document.close();
  }
}
