/* ============================================================
   OVERTONE — canvas waveform + timeline grid
   ============================================================ */
function wrng(seed){ let s=(seed*9301+49297)%233280; return ()=> (s=(s*9301+49297)%233280)/233280; }

// character envelopes per instrument family
function charFor(id){
  if (/drum|perc|timp/.test(id)) return { kind:"transient", base:0.12, spike:1.0 };
  if (/bass|cb|tbn/.test(id))     return { kind:"smooth", base:0.55, spike:0.25, lp:0.85 };
  if (/pad|keys|hn|string|vln|vla|vc|harp/.test(id)) return { kind:"sustain", base:0.42, spike:0.4, lp:0.6 };
  if (/vocal/.test(id))           return { kind:"vox", base:0.3, spike:0.7, lp:0.4 };
  return { kind:"mid", base:0.35, spike:0.7, lp:0.4 };
}

function drawWaveform(canvas, stem, opts){
  const dpr = Math.min(2, window.devicePixelRatio||1);
  const W = opts.width, H = opts.height;
  canvas.width = W*dpr; canvas.height = H*dpr;
  canvas.style.width = W+"px"; canvas.style.height = H+"px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,W,H);
  const css = getComputedStyle(document.documentElement);
  const col = css.getPropertyValue(stem.color).trim() || "#9ab";
  const ch = charFor(stem.id);
  const mid = H/2, maxA = H/2 - 3;
  const rnd = wrng(stem.seed*7+3);
  const pxStep = 2;
  const n = Math.ceil(W/pxStep);
  // envelope: song structure — intro/verse/chorus dynamics across width
  const samples = new Float32Array(n);
  let prev = ch.base;
  const beatPx = opts.beatPx || 18;
  for (let i=0;i<n;i++){
    const x = i*pxStep;
    const songPos = x / W;
    // section dynamics
    let sect = 0.55 + 0.45*Math.sin(songPos*Math.PI*3.0 - 0.6);   // builds/drops
    sect = Math.max(0.18, sect);
    if (stem.removed) sect *= 0.0;
    let v;
    if (ch.kind==="transient"){
      const beatPhase = (x % (beatPx*2)) / (beatPx*2);
      const hit = beatPhase < 0.06 ? 1 : (beatPhase<0.5 && ((x/(beatPx))|0)%2? 0.4:0.12);
      v = (hit*ch.spike + rnd()*0.18) * sect;
    } else {
      const target = ch.base + (rnd()-0.5)*ch.spike;
      prev = prev*(ch.lp||0.5) + target*(1-(ch.lp||0.5));
      v = Math.abs(prev) * sect * (0.7+0.6*rnd());
    }
    samples[i] = Math.max(0.02, Math.min(1, v));
  }
  // fill waveform — real peaks take priority over procedural
  ctx.fillStyle = col;
  ctx.beginPath();
  if (opts.peaks && opts.peaks.length > 0) {
    const P = opts.peaks, Pn = P.length;
    ctx.globalAlpha = stem.muted ? 0.28 : 0.92;
    for (let i = 0; i < W; i++) {
      const pi = Math.min(Pn - 1, Math.floor(i / W * Pn));
      const a = P[pi] * maxA;
      ctx.rect(i, mid - a, 1.4, a * 2);
    }
  } else {
    ctx.globalAlpha = stem.muted ? 0.28 : 1;
    for (let i=0;i<n;i++){ const x=i*pxStep, a=samples[i]*maxA; ctx.rect(x, mid-a, pxStep-0.6, a*2); }
    ctx.globalAlpha = stem.muted ? 0.16 : 0.92;
  }
  ctx.fill();
  // center line
  ctx.globalAlpha = 0.5; ctx.strokeStyle = col; ctx.lineWidth=0.6;
  ctx.beginPath(); ctx.moveTo(0,mid); ctx.lineTo(W,mid); ctx.stroke();
  ctx.globalAlpha = 1;
}

// timeline ruler: bar numbers + beat ticks; drawn as DOM for crispness
function buildRuler(rulerEl, totalBars, barPx, beats){
  rulerEl.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let b=0;b<totalBars;b++){
    const x = b*barPx;
    const tick = document.createElement("div");
    tick.className = "rk bar";
    tick.style.left = x+"px";
    if (b%4===0){
      const lab = document.createElement("span"); lab.className="rk-lab"; lab.textContent=(b+1); tick.appendChild(lab);
      tick.classList.add("major");
    }
    frag.appendChild(tick);
    // beat subticks
    for (let bt=1; bt<beats; bt++){
      const st=document.createElement("div"); st.className="rk beat"; st.style.left=(x+bt*(barPx/beats))+"px"; frag.appendChild(st);
    }
  }
  rulerEl.appendChild(frag);
}

// beat grid behind lanes (vertical lines)
function drawGrid(canvas, totalBars, barPx, beats, H){
  const dpr = Math.min(2, window.devicePixelRatio||1);
  const W = totalBars*barPx;
  canvas.width=W*dpr; canvas.height=H*dpr; canvas.style.width=W+"px"; canvas.style.height=H+"px";
  const ctx=canvas.getContext("2d"); ctx.scale(dpr,dpr); ctx.clearRect(0,0,W,H);
  for (let b=0;b<totalBars;b++){
    const x=b*barPx;
    ctx.strokeStyle = b%4===0 ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.035)";
    ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(x+0.5,0); ctx.lineTo(x+0.5,H); ctx.stroke();
    for (let bt=1;bt<beats;bt++){ const bx=x+bt*(barPx/beats); ctx.strokeStyle="rgba(255,255,255,0.018)"; ctx.beginPath(); ctx.moveTo(bx+0.5,0); ctx.lineTo(bx+0.5,H); ctx.stroke(); }
  }
}
