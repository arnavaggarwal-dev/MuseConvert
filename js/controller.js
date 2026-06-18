/* ============================================================
   OVERTONE — application controller
   ============================================================ */
/* v2 */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

const ICONS = {
  drums:'<path d="M3 9c0 1.7 4 3 9 3s9-1.3 9-3-4-3-9-3-9 1.3-9 3Z"/><path d="M3 9v5c0 1.7 4 3 9 3s9-1.3 9-3V9"/><path d="M7 12l-3 8M17 12l3 8"/>',
  bass:'<circle cx="6" cy="18" r="3"/><path d="M9 18V4l11-2v3L9 7"/>',
  guitar:'<circle cx="7" cy="16" r="4"/><path d="M7 16 18 5l3 1-1 3"/><path d="m14 9 1 1"/>',
  synth:'<rect x="2" y="6" width="20" height="12" rx="1.5"/><path d="M6 6v8M10 6v8M14 6v8M18 6v8"/>',
  keys:'<rect x="2" y="5" width="20" height="14" rx="1.5"/><path d="M7 5v9M12 5v9M17 5v9M2 14h20"/>',
  vocal:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  strings:'<path d="M11 2c-1 4-1 14 0 20M13 2c1 4 1 14 0 20"/><path d="M9 6h6M9 18h6"/><circle cx="12" cy="12" r="9"/>',
  brass:'<circle cx="7" cy="12" r="5"/><path d="M12 12h6l2-3v6l-2-3M12 9v6"/>',
  wood:'<path d="M5 4v16a2 2 0 0 0 4 0V4Z"/><circle cx="7" cy="9" r="1"/><circle cx="7" cy="13" r="1"/><circle cx="7" cy="17" r="1"/>',
  perc:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/>',
  harp:'<path d="M4 3v18M20 3C12 3 6 9 6 21"/><path d="M9 5v12M13 7v9M17 9v6"/>',
};
function iconFor(stem){
  const id=stem.id, f=(stem.family||"")+id;
  if(/drum|perc/.test(id))return ICONS.drums;
  if(/timp/.test(id))return ICONS.perc;
  if(/bass|^cb$/.test(id))return ICONS.bass;
  if(/guitar/.test(id))return ICONS.guitar;
  if(/synth/.test(id))return ICONS.synth;
  if(/key|pno|piano|pad/.test(id))return ICONS.keys;
  if(/vocal/.test(id))return ICONS.vocal;
  if(/vln|vla|vc|string/.test(id))return ICONS.strings;
  if(/hn|tpt|tbn|brass/.test(id))return ICONS.brass;
  if(/fl|ob|cl|bsn|wood/.test(id))return ICONS.wood;
  if(/harp/.test(id))return ICONS.harp;
  return ICONS.synth;
}
function svgIco(path,cls){ return `<svg viewBox="0 0 24 24" class="${cls||'ico-stroke'}">${path}</svg>`; }
const _api = p => (window.__API__ || '') + p;

/* ---------------- STATE ---------------- */
const STATE = {
  pkey:null, scene:"empty", sel:null,
  playing:false, pos:0 /*bars*/, muted:new Set(), solo:new Set(),
  itab:"instrument", zoom:1, barPx:16, showWave:true, showGrid:true,
  url:"", liveProject:null, liveSid:null,
  focusStem:null,
  playMode:"wav",  // "wav" | "midi"
};
let raf=null, lastT=0, _progScrollLeft=-1;
const P = ()=>STATE.liveProject || PROJECTS[STATE.pkey] || null;
function totalBars(){ const p=P(); if(!p) return 0; return Math.ceil(p.duration*p.tempo/60/p.timeSig[0]); }
function _calcBars(){ return Math.max(4, Math.min(32, Math.floor((document.getElementById("score-systems")?.clientWidth||800)/120))); }

// ── SVG staff cache — avoids re-rendering notation on scroll/mute/zoom ──────
let _staffCacheVer = 0;
const _staffCache = new Map(); // "${ver}|${stemId}|${barOffset}|${key}" → SVGElement
function _cachedStaff(s, p) {
  const key = `${_staffCacheVer}|${s.id}|${p.barOffset}|${p.key}`;
  if (_staffCache.has(key)) return _staffCache.get(key).cloneNode(true);
  const svg = renderStaff(s, p, {salt:0});
  _staffCache.set(key, svg);
  if (_staffCache.size > 300) _staffCache.delete(_staffCache.keys().next().value); // LRU evict
  return svg.cloneNode(true);
}
function _invalidateStaffCache() { _staffCacheVer++; _staffCache.clear(); }

/* ---------------- TOP / SUB META ---------------- */
function renderMeta(){
  const p=P(); if(!p) return;
  if(document.activeElement!==$("#omni-input")) $("#omni-input").value = p.source?.startsWith("http") ? p.source : "";
  $("#crumb-title").textContent=p.title;
  $("#crumb-sep").style.display="";
  $("#sbar-dot").style.background="var(--good)";
  $("#sbar-model").textContent=p.sepModel.split(" · ")[0];
  const midiTot=p.stems.reduce((a,s)=>a+s.midi,0);
  $("#sbar-stems").textContent=p.stems.length+" stems · "+midiTot.toLocaleString()+" MIDI events";
  $("#sbar-fmt").textContent=`${p.sampleRate/1000} kHz · ${p.bitDepth}-bit`;
  $("#sub-meta").innerHTML =
    `<span><span class="k">tempo</span> <b>${p.tempo}</b></span>`+
    `<span><span class="k">key</span> <b>${p.key}</b></span>`+
    `<span><span class="k">sig</span> <b>${p.timeSig.join("/")}</b></span>`+
    `<span><span class="k">stems</span> <b>${p.stems.length}</b></span>`+
    `<span><span class="k">dur</span> <b>${fmtTime(p.duration)}</b></span>`;
  $("#st-tempo").innerHTML=`${p.tempo} <small>BPM</small>`;
  $("#st-sig").textContent=p.timeSig.join("/");
  $("#st-key").textContent=p.key.replace(" minor"," min").replace(" major"," maj");
}

/* ---------------- LEFT ---------------- */
function renderLeft(){
  const p=P();
  if(!p){
    $("#nav-count").textContent="";
    $("#nav-tree").innerHTML='<div class="nav-empty-msg">No project open</div>';
    return;
  }
  $("#nav-count").textContent=p.stems.length;
  $("#nav-tree").innerHTML=
    `<div class="proj-title-row">${p.title}</div>`+
    p.stems.map(s=>`<div class="trow indent${s.id===STATE.sel?' active':''}" data-stem="${s.id}">
      <span class="swatch" style="background:var(${s.color})"></span>
      <span class="nm">${s.name}</span>
      <span class="meta">${Math.round(s.confidence)}%</span>
    </div>`).join("");
}

/* ---------------- SCORE ---------------- */
function renderScore(){
  const p=P(); if(!p) return;
  const tb=totalBars();
  $("#score-title").innerHTML=`<h1>${p.title}</h1>
    <div class="sub"><span><b>${p.artist}</b></span><span>${p.key}</span><span>♩ = ${p.tempo}</span><span>${p.timeSig.join("/")}</span><span>${p.transModel}</span></div>`;
  const wrap=$("#score-systems"); wrap.innerHTML="";
  const solo=STATE.solo.size>0;
  p.stems.forEach(s=>{
    const row=document.createElement("div");
    row.className="staff-row"+(s.id===STATE.sel?" sel":"");
    row.dataset.stem=s.id;
    const dim = s.removed || STATE.muted.has(s.id) || (solo && !STATE.solo.has(s.id));
    row.style.opacity = dim? .34 : 1;
    const cc = confColor(s.confidence);
    row.innerHTML=`<div class="staff-label">
        <div class="sl-top"><span class="sl-dot" style="background:var(${s.color})"></span><span class="sl-name">${s.name}</span></div>
        <div class="sl-sub"><span>${clefName(s.clef)}</span><span class="conf-mini"><i style="background:${cc}"></i>${s.confidence.toFixed(1)}%</span>${s.removed?'<span style="color:var(--bad)">muted</span>':''}</div>
      </div><div class="staff-svg-wrap"></div>`;
    const svg=_cachedStaff(s,p);
    row.querySelector(".staff-svg-wrap").appendChild(svg);
    wrap.appendChild(row);
  });
  // bar nav
  const nav=document.getElementById("score-nav");
  const lbl=document.getElementById("score-nav-label");
  const prev=document.getElementById("score-prev");
  const next=document.getElementById("score-next");
  if(nav){ nav.style.display=tb>p.bars?"flex":"none"; }
  if(lbl){ lbl.textContent=`Bars ${p.barOffset+1}–${Math.min(p.barOffset+p.bars,tb)}`; }
  if(prev){ prev.disabled=p.barOffset<=0; }
  if(next){ next.disabled=p.barOffset+p.bars>=tb; }
  applyZoom();
}
function scoreNavStep(dir){
  const p=P(); if(!p) return;
  const tb=totalBars();
  p.barOffset=Math.max(0,Math.min(tb-p.bars, p.barOffset+dir*p.bars));
  renderScore();
}
function clefName(c){return {treble:"Treble",bass:"Bass",alto:"Alto",perc:"Perc"}[c]||c;}

/* ---------------- TIMELINE ---------------- */
function renderTimeline(){
  const p=P(); if(!p) return; const beats=p.timeSig[0]; const tb=totalBars(); const bpx=STATE.barPx;
  // gutter
  const solo=STATE.solo.size>0;
  $("#gutter").innerHTML=p.stems.map(s=>{
    const m=STATE.muted.has(s.id), so=STATE.solo.has(s.id);
    return `<div class="gutter-track" data-stem="${s.id}">
      <div class="gt-color" style="background:var(${s.color})"></div>
      <div class="gt-main"><div class="gt-name">${s.name}${s.removed?' <span style="font-size:9px;color:var(--bad);font-family:var(--mono)">REMOVED</span>':''}</div>
        <div class="gt-sub">${s.midi?s.midi+' notes':'—'} · ${Math.round(s.confidence)}%</div></div>
      <div class="gt-btns"><span class="smbtn m ${m?'on':''}" data-mute="${s.id}">M</span><span class="smbtn s ${so?'on':''}" data-solo="${s.id}">S</span></div>
    </div>`;
  }).join("");
  // ruler + grid
  buildRuler($("#ruler"), tb, bpx, beats);
  const laneH=46;
  const grid=$("#grid-canvas");
  drawGrid(grid, tb, bpx, beats, p.stems.length*laneH);
  grid.style.display=STATE.showGrid?"block":"none";
  // lanes — reuse existing canvas elements when stem list + dimensions unchanged
  const lanes=$("#lanes");
  const W=tb*bpx;
  $("#lanes-wrap").style.width=W+"px";
  $("#ruler").style.width=W+"px";
  $("#lane-col").style.width=W+"px";
  const sb=$("#lane-scroll").offsetHeight-$("#lane-scroll").clientHeight;
  $("#gutter-foot").style.height=Math.max(0,sb)+"px";
  const existingLanes=[...lanes.children];
  const stemIds=p.stems.map(s=>s.id).join(",");
  const existingIds=existingLanes.map(l=>l.dataset.stem).join(",");
  if(stemIds!==existingIds) lanes.innerHTML=""; // stem structure changed — full rebuild
  p.stems.forEach((s,i)=>{
    let lane=lanes.children[i];
    let cv;
    if(!lane){
      lane=document.createElement("div"); lane.className="lane"; lane.dataset.stem=s.id;
      cv=document.createElement("canvas"); lane.appendChild(cv);
      lanes.appendChild(lane);
    } else {
      cv=lane.querySelector("canvas");
    }
    if(STATE.showWave){
      const peaks=AudioEngine.hasStem(s.id)?AudioEngine.getPeaks(s.id):null;
      drawWaveform(cv,{...s,muted:STATE.muted.has(s.id)||(solo&&!STATE.solo.has(s.id))},{width:W,height:laneH,beatPx:bpx/beats,peaks});
      cv.style.display="";
    } else {
      cv.style.display="none";
    }
  });
  positionPlayhead();
}

/* ---------------- INSPECTOR ---------------- */
function renderInspector(){
  const p=P(); if(!p) return; const s=p.stems.find(x=>x.id===STATE.sel)||p.stems[0];
  const body=$("#insp-body");
  if(STATE.itab==="instrument") body.innerHTML=inspInstrument(p,s);
  else if(STATE.itab==="quality") body.innerHTML=inspQuality(p,s);
  else body.innerHTML=inspExport(p,s);
}
function inspInstrument(p,s){
  const cc=confColor(s.confidence), ct=confTag(s.confidence);
  const q=s.quality||{snr:24+ (s.confidence-80)*0.4, bleed:100-s.confidence, artifacts:(100-s.confidence)/3, separation:s.confidence};
  return `
  <div class="isec">
    <div class="inst-card">
      <div class="inst-top">
        <div class="inst-ico" style="background:var(${s.color})">${svgIco(iconFor(s),'')}</div>
        <div><div class="inst-name">${s.name}</div><div class="inst-fam">${s.family}</div></div>
      </div>
      <div class="bigconf"><span class="num" style="color:${cc}">${s.confidence.toFixed(1)}</span><span class="pct">% match</span>
        <span class="tag" style="color:${cc};background:${cc}1f">${ct}</span></div>
      <div style="font-size:11.5px;color:var(--t-2);line-height:1.5">${s.note}</div>
    </div>
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<path d="M3 12h4l3-9 4 18 3-9h4"/>')}</span>Stem quality</div>
    ${metric("Source separation",q.separation,"%",confColor(q.separation))}
    ${metric("Signal-to-noise",Math.min(100,q.snr/40*100),q.snr.toFixed(1)+" dB",'var(--good)')}
    ${metric("Spectral bleed",q.bleed,q.bleed.toFixed(1)+"%",'var(--warn)',true)}
    ${metric("Artifacts",q.artifacts*5,q.artifacts.toFixed(1)+"%",'var(--bad)',true)}
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>')}</span>Transcription</div>
    <div class="metric"><div class="ml"><span class="k">MIDI events</span><span class="v">${s.midi.toLocaleString()}</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Register</span><span class="v">${regName(s)}</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Polyphony</span><span class="v">${/key|pno|pad|harp|guitar/.test(s.id)?'poly':'mono'}</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Role</span><span class="v">${s.role||'—'}</span></div></div>
  </div>`;
}
function inspQuality(p,s){
  const bars=p.spectrum.map((h,i)=>`<div class="fb" style="height:${Math.max(4,h)}%;opacity:${0.55+h/160}"></div>`).join("");
  const overall=p.stems.reduce((a,x)=>a+x.confidence,0)/p.stems.length;
  return `
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<path d="M2 12h2l3-8 4 16 3-12 2 6h6"/>')}</span>Spectral content<span class="more">FFT 4096</span></div>
    <div class="spectrum">${bars}</div>
    <div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:9.5px;color:var(--t-3);margin-top:4px"><span>20 Hz</span><span>1 kHz</span><span>20 kHz</span></div>
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>')}</span>Separation summary</div>
    ${metric("Overall confidence",overall,overall.toFixed(1)+"%",confColor(overall))}
  </div>
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<path d="M3 3v18h18"/><rect x="7" y="10" width="3" height="8"/><rect x="13" y="6" width="3" height="12"/>')}</span>Per-stem confidence</div>
    ${p.stems.map(x=>`<div class="metric" data-stem="${x.id}" style="cursor:default">
      <div class="ml"><span class="k" style="display:flex;align-items:center;gap:6px"><span class="swatch" style="width:8px;height:8px;border-radius:2px;background:var(${x.color})"></span>${x.name}</span><span class="v" style="color:${confColor(x.confidence)}">${x.confidence.toFixed(1)}%</span></div>
      <div class="track"><i style="width:${x.confidence}%;background:${confColor(x.confidence)}"></i></div></div>`).join("")}
  </div>`;
}
function inspExport(p,s){
  const fmts=[["MIDI",".mid","All stems · type 1"],["MusicXML",".xml","Notation · score"],["PDF",".pdf","Engraved sheet"],["WAV",".wav","Stem bounce"],["Stems","ZIP","6× isolated"],["Ableton",".als","Live set"]];
  return `
  <div class="isec">
    <div class="isec-h"><span class="ico">${svgIco('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>')}</span>Export format</div>
    <div class="exp-formats">${fmts.map((f,i)=>`<div class="exp-fmt ${i===0?'sel':''}" data-fmt="${f[0]}">
      ${i===0?`<span class="ef-check">${svgIco('<path d="M20 6 9 17l-5-5"/>')}</span>`:''}
      <span class="ef-ext">${f[1]}</span><span class="ef-d">${f[2]}</span></div>`).join("")}</div>
  </div>
  <div class="isec">
    <div class="isec-h">Options</div>
    <div class="metric"><div class="ml"><span class="k">Quantize to grid</span><span class="v" style="color:var(--good)">1/16 · on</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Include velocity</span><span class="v" style="color:var(--good)">on</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Tempo map</span><span class="v">${p.tempoMap.length} points</span></div></div>
    <div class="metric"><div class="ml"><span class="k">Range</span><span class="v">Full · bars 1–${totalBars()}</span></div></div>
  </div>
  <div class="isec">
    <div class="isec-h">Stems to include</div>
    ${p.stems.map(x=>`<div class="metric" style="margin-bottom:8px"><div class="ml"><span class="k" style="display:flex;align-items:center;gap:7px">
      <span style="width:14px;height:14px;border-radius:4px;border:1px solid var(--acc-line);background:${x.removed?'transparent':'var(--acc)'};display:grid;place-items:center">${x.removed?'':svgIco('<path d="M20 6 9 17l-5-5"/>')}</span>${x.name}</span>
      <span class="v">${x.midi||'—'}</span></div></div>`).join("")}
    <button class="exp-btn" id="do-export">Export ${p.stems.filter(x=>!x.removed).length} stems <span class="kbd">⌘E</span></button>
  </div>`;
}
function metric(k,pct,v,col,inverse){
  return `<div class="metric"><div class="ml"><span class="k">${k}</span><span class="v">${v}</span></div>
    <div class="track"><i style="width:${Math.max(2,Math.min(100,pct))}%;background:${col}"></i></div></div>`;
}

/* ---------------- helpers ---------------- */
function confColor(c){ return c>=90?'var(--good)':c>=78?'var(--warn)':'var(--bad)'; }
function confTag(c){ return c>=95?'Certain':c>=88?'High':c>=78?'Probable':'Ambiguous'; }
function regName(s){ if(!s.reg)return'—'; const names=["C","D","E","F","G","A","B"]; const f=d=>names[((d%7)+7)%7]+(Math.floor(d/7)); return f(s.reg[0])+"–"+f(s.reg[1]); }
function fmtTime(sec){ const m=Math.floor(sec/60),s=Math.floor(sec%60); return m+":"+String(s).padStart(2,"0"); }
function fmtSize(p){ return ((p.duration*p.sampleRate*p.bitDepth*2)/8/1e6).toFixed(0)+"MB"; }

/* ---------------- ZOOM ---------------- */
function applyZoom(){
  $("#score-paper").style.transform=`scale(${STATE.zoom})`;
  $("#score-paper").style.transformOrigin="top left";
  $("#zoom-val").textContent=Math.round(STATE.zoom*100)+"%";
  $("#sbar-zoom").textContent=Math.round(STATE.zoom*100)+"%";
}

/* ---------------- PLAYBACK ---------------- */
function positionPlayhead(){
  const bpx=STATE.barPx;
  $("#playhead").style.left=(STATE.pos*bpx)+"px";
  const p=P();
  if(!p){
    $("#tc-bars").textContent="001"; $("#tc-beat").textContent="1";
    $("#tc-tick").textContent="00"; $("#tc-time").textContent="0:00.0";
    return;
  }
  const beats=p.timeSig[0];
  const bar=Math.floor(STATE.pos)+1, beat=Math.floor((STATE.pos%1)*beats)+1, tick=Math.floor(((STATE.pos%1)*beats%1)*100);
  $("#tc-bars").textContent=String(bar).padStart(3,"0");
  $("#tc-beat").textContent=beat;
  $("#tc-tick").textContent=String(tick).padStart(2,"0");
  const secs=STATE.pos*beats*60/p.tempo;
  $("#tc-time").textContent=fmtTime(secs)+"."+String(Math.floor((secs%1)*10));
}
function tick(t){
  if(!STATE.playing){ raf=null; return; }
  const p=P(); if(!p){ STATE.playing=false; raf=null; return; }
  const beats=p.timeSig[0], bps=p.tempo/60/beats;
  const eng = _activeEngine();
  if(eng.isLoaded()){
    STATE.pos=eng.currentSecs()*bps;
  } else {
    if(!lastT) lastT=t;
    STATE.pos+=bps*(t-lastT)/1000;
  }
  lastT=t;
  if(STATE.pos>=totalBars()){ STATE.pos=0; }
  positionPlayhead();
  // auto-follow score to playhead
  if(p && STATE.playing){
    const bar=Math.floor(STATE.pos);
    if(bar < p.barOffset || bar >= p.barOffset + p.bars){
      p.barOffset=Math.max(0, Math.min(totalBars()-p.bars, Math.floor(bar/p.bars)*p.bars));
      renderScore();
    }
  }
  if(STATE.focusStem){
    const secs=eng.isLoaded()?eng.currentSecs():barsToSecs(STATE.pos);
    const fph=document.getElementById("focus-ph");
    if(fph) fph.style.left=Math.min(100,secs/Math.max(1,p.duration)*100)+"%";
  }
  const sc=$("#lane-scroll"), x=STATE.pos*STATE.barPx;
  if(x>sc.scrollLeft+sc.clientWidth-120||x<sc.scrollLeft){
    _progScrollLeft=x-120; sc.scrollLeft=x-120;
  }
  raf=requestAnimationFrame(tick);
}
function barsToSecs(bars){ const p=P(); if(!p) return 0; return bars*p.timeSig[0]*60/p.tempo; }
function _activeEngine(){ return STATE.playMode==="midi" ? MidiEngine : AudioEngine; }
function setPlaying(v){
  STATE.playing=v; lastT=0;
  $("#play-ico").innerHTML = v?'<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>':'<path d="M7 4l13 8-13 8z"/>';
  const eng = _activeEngine();
  if(v){ if(eng.isLoaded()) eng.start(barsToSecs(STATE.pos)); if(!raf) raf=requestAnimationFrame(tick); }
  else { eng.stop(); }
}

/* ---------------- FOCUS TRACK ---------------- */
function openFocusTrack(stemId){
  const p=P(); if(!p) return;
  const s=p.stems.find(x=>x.id===stemId); if(!s) return;
  STATE.focusStem=stemId;
  STATE.solo=new Set([stemId]);
  _activeEngine().setSolo([stemId]);
  document.getElementById("focus-dot").style.background="var("+s.color+")";
  document.getElementById("focus-name").textContent=s.name;
  document.getElementById("focus-info").textContent=s.instrument+(s.midi?" · "+s.midi+" notes":"");
  const wrap=document.getElementById("focus-wave-wrap");
  const cv=document.getElementById("focus-wave-cv");
  const W=wrap.clientWidth||Math.max(600,window.innerWidth-32);
  cv.width=W; cv.height=80;
  cv.style.width=W+"px"; cv.style.height="80px";
  const focusPeaks = AudioEngine.hasStem(stemId) ? AudioEngine.getPeaks(stemId) : null;
  drawWaveform(cv,{...s,muted:false},{width:W,height:80,beatPx:STATE.barPx/p.timeSig[0],peaks:focusPeaks});
  document.getElementById("ov-focus").classList.add("show");
  renderTimeline();
}
function closeFocusTrack(){
  STATE.focusStem=null;
  STATE.solo=new Set();
  _activeEngine().setSolo([]);
  document.getElementById("ov-focus").classList.remove("show");
  renderTimeline();
}

/* ---------------- SELECTION ---------------- */
function selectStem(id){
  const p=P(); if(!p) return; STATE.sel=id; const s=p.stems.find(x=>x.id===id);
  $$(".staff-row").forEach(r=>r.classList.toggle("sel",r.dataset.stem===id));
  $$(".gutter-track").forEach(r=>r.style.background=r.dataset.stem===id?"var(--bg-3)":"");
  $$('#nav-tree .trow.indent').forEach(r=>r.classList.toggle("active",r.dataset.stem===id));
  $("#sbar-sel").textContent=(s?s.name:"")+" selected";
  if(STATE.itab!=="export") renderInspector();
}

/* ---------------- SCENES ---------------- */
const SCENES={
  empty:{pill:["","Ready — no project"],ovr:"ov-empty",sbar:"Idle"},
  loading:{pill:["work","Opening…"],ovr:"ov-load",sbar:"Loading"},
  processing:{pill:["work","Processing…"],ovr:"ov-proc",sbar:"Analyzing"},
  error:{pill:["err","Analysis failed"],ovr:"ov-error",sbar:"Error"},
  success:{pill:["ok","Analysis complete"],ovr:null,sbar:"Ready"},
};
function setScene(scene){
  STATE.scene=scene; document.body.dataset.scene=scene;
  if(scene==="processing" && STATE.focusStem) closeFocusTrack();
  $$(".overlay").forEach(o=>o.classList.remove("show"));
  if(scene==="empty"){
    STATE.pos=0; positionPlayhead();
    $("#crumb-title").textContent=""; $("#crumb-sep").style.display="none";
    $("#sub-meta").innerHTML="";
    $("#st-tempo").textContent="—"; $("#st-sig").textContent="—"; $("#st-key").textContent="—";
    $("#sbar-model").textContent="—"; $("#sbar-stems").textContent="—"; $("#sbar-sel").textContent="—";
    $("#sbar-dot").style.background="var(--t-3)"; $("#sbar-fmt").textContent="";
    $("#nav-tree").innerHTML='<div class="nav-empty-msg">No project open</div>';
    $("#nav-count").textContent="";
  }
  const cfg=SCENES[scene];
  if(cfg.ovr) $("#"+cfg.ovr).classList.add("show");
  const pill=$("#scene-pill"); pill.className="pill "+(cfg.pill[0]||"");
  $("#scene-pill-t").textContent=cfg.pill[1];
  $("#crumb-dot").style.background = scene==="error"?"var(--bad)":scene==="success"?"var(--good)":scene==="empty"?"var(--t-3)":"var(--warn)";
  $("#sbar-scene").textContent=cfg.sbar;
  if(scene==="processing") runProcessing();
  if(scene==="error") fillErrorLog();
  if(scene==="loading"){ setTimeout(()=>{ if(STATE.scene==="loading") setScene("success"); },900); }
}
function loadProject(key,scene){
  STATE.pkey=key; const p=P();
  if(!p){ setScene("empty"); return; }
  STATE.sel=p.stems.find(s=>!s.removed)?.id||p.stems[0].id;
  STATE.muted=new Set(); STATE.solo=new Set(); STATE.pos=p.barOffset||5;
  document.body.dataset.project=key;
  $("#proc-tt").textContent=p.title; $("#proc-ts").textContent=`${p.artist} · ${fmtTime(p.duration)} · ${p.sampleRate/1000} kHz/${p.bitDepth}-bit`;
  $("#proc-thumb").style.background=p.thumb;
  renderAll();
  setScene(scene||"success");
  selectStem(STATE.sel);
  _saveSession(); // save on project open
}
function renderAll(){
  if(!P()) return;
  if(STATE.focusStem && !P().stems.find(s=>s.id===STATE.focusStem)) closeFocusTrack();
  renderMeta(); renderLeft(); renderScore(); renderTimeline(); renderInspector(); positionPlayhead();
}

let _activePoll = null;

/* processing animation */
const PSTAGES=[
  {n:"Fetch & decode audio",ic:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'},
  {n:"Source separation (Demucs)",ic:'<path d="M3 12h4l3-9 4 18 3-9h4"/>'},
  {n:"Instrument identification",ic:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'},
  {n:"MIDI transcription",ic:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M11 4v16M15 4v16"/>'},
  {n:"Notation engraving",ic:'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/>'},
];
let procTimer=null;
function _renderProcStages(prog, stageIdx){
  $$("#proc-stages .pstage").forEach((ps,i)=>{
    ps.className="pstage "+(i<stageIdx?"done":i===stageIdx?"active":"pending");
    const meta=ps.querySelector(".pst-meta");
    const ic=ps.querySelector(".pst-ic");
    if(i<stageIdx){ ic.innerHTML=svgIco('<path d="M20 6 9 17l-5-5"/>'); meta.textContent="done"; }
    else if(i===stageIdx){ ic.innerHTML='<span class="spinner"></span>'; meta.textContent=["48kHz","6 sources","12 classes","quantizing","layout"][i]||"…"; }
    else { ic.innerHTML=svgIco(PSTAGES[i].ic); meta.textContent="queued"; }
  });
  const pct=Math.round(prog*100);
  $("#proc-pct").textContent=pct+"%";
  $("#proc-bar-i").style.width=pct+"%";
}
async function runProcessing(){
  clearInterval(_activePoll); _activePoll = null;
  clearInterval(procTimer);
  const host=$("#proc-stages");
  host.innerHTML=PSTAGES.map((s,i)=>`<div class="pstage pending" data-i="${i}">
    <span class="pst-ic">${svgIco(s.ic)}</span><span class="pst-name">${s.n}</span><span class="pst-meta"></span></div>`).join("");
  $("#proc-pct").textContent="0%"; $("#proc-bar-i").style.width="0%";
  // reset title unless local file already set it
  if(!STATE.url.startsWith("local:")){ $("#proc-tt").textContent="Fetching…"; $("#proc-ts").textContent=""; }

  // Try real backend; fall back to demo simulation if unavailable
  if(STATE.url && STATE.url.startsWith("http")){
    try {
      const r = await fetch(_api("/api/analyze"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({url:STATE.url,force:!!STATE._forceReanalyze})});
      if(!r.ok) throw new Error("Server "+r.status);
      const {session_id} = await r.json();
      flash("Analyzing…  session "+session_id.slice(0,8));

      _activePoll = setInterval(async ()=>{
        if(STATE.scene!=="processing"){ clearInterval(_activePoll); _activePoll=null; return; }
        let job;
        try {
          const _sr = await fetch(_api(`/api/status/${session_id}`));
          if(_sr.status===404){
            const _rr = await fetch(_api(`/api/resume/${session_id}`),{method:"POST"});
            if(_rr.ok){ flash("Resuming from cached audio…"); return; }
            clearInterval(_activePoll); _activePoll=null;
            fillErrorLog("Session lost — please resubmit URL");
            setScene("error"); return;
          }
          job = await _sr.json();
        }
        catch(_){ return; }

        if(job.status==="error"){
          clearInterval(_activePoll); _activePoll=null;
          fillErrorLog(job.error||"Unknown error");
          setScene("error");
          return;
        }

        if(job.meta?.title && job.meta.title!=="Unknown"){
          $("#proc-tt").textContent=job.meta.title;
          const dur=job.meta.duration?` · ${fmtTime(job.meta.duration)}`:"";
          const art=job.meta.artist&&job.meta.artist!=="Unknown"?job.meta.artist:"";
          $("#proc-ts").textContent=art+dur;
        }
        const prog = job.progress||0;
        const si   = job.stage>=0 ? job.stage : 0;
        _renderProcStages(prog, si);
        $("#proc-eta").textContent = prog>=1?"Finalizing…":"Processing locally…";

        if(job.status==="done"){
          clearInterval(_activePoll); _activePoll=null;
          const m = job.meta||{};
          const stems = (job.stems||[]).map(s=>({
            ...s,
            density: s.density||2,
            seed: typeof s.seed==='number' ? s.seed : (s.id.split('').reduce((a,c)=>a*31+c.charCodeAt(0),1)&0x7fffffff)%50000,
            reg: s.reg||null,
            audio_url: s.audio_url ? _api(s.audio_url) : s.audio_url,
            midi_url:  s.midi_url  ? _api(s.midi_url)  : s.midi_url,
          }));
          STATE.liveProject = {
            id:"live", kind:"live",
            title: m.title||"Untitled", artist: m.artist||"", album:"", source: STATE.url,
            thumb: m.thumb ? `url("${m.thumb}") center/cover` : "linear-gradient(135deg,oklch(0.4 0.12 260),oklch(0.5 0.1 200))",
            duration: m.duration||180, tempo: m.tempo||120, tempoMap:[[0,m.tempo||120]],
            key: m.key||"A minor", timeSig: m.timeSig||[4,4],
            sampleRate: m.sampleRate||44100, bitDepth: m.bitDepth||24,
            sepModel: m.sepModel||"HT-Demucs v4", transModel: m.transModel||"librosa-pyin",
            gpu: m.gpu||{model:"CPU",util:0,vram:0,vramTotal:0},
            bars:_calcBars(), barOffset:0,
            stems, diagnostics:[], spectrum: m.spectrum||[],
          };
          STATE.pkey="live";
          STATE.liveSid=session_id;
          STATE.sel=stems.find(s=>!s.removed)?.id||stems[0]?.id||null;
          if(stems.length){
            flash("Loading score…");
            await _loadMidiNotes(session_id, STATE.liveProject.stems);
          }
          // persist to recent + save session for cross-reload restore
          if (m.title && STATE.url?.startsWith("http")) {
            _pushRecent({ url: STATE.url, title: m.title, artist: m.artist || "", thumb: m.thumb || "", sid: session_id });
          }
          MidiEngine.reload(STATE.liveProject.stems);
          _invalidateStaffCache();
          renderAll();
          setTimeout(()=>{ if(STATE.scene==="processing") setScene("success"); },300);
          if(stems.length){
            AudioEngine.loadFromSession(stems,(p,id,ok)=>{ if(!ok) flash("Failed: "+id); })
              .then(()=>flash("Audio ready · Space to play"));
          }
        }
      }, 800);
      return;
    } catch(e){
      flash("Server not reachable — demo mode");
    }
  }

  // Demo simulation (no server)
  const dur=[1.0,2.6,1.2,1.8,1.0]; const tot=dur.reduce((a,b)=>a+b);
  const t0=performance.now();
  const tickP=()=>{
    if(STATE.scene!=="processing"){clearInterval(procTimer);return;}
    const el=(performance.now()-t0)/1000;
    const prog=Math.min(1,el/tot);
    let acc=0,active=0;
    for(let i=0;i<dur.length;i++){ acc+=dur[i]; if(el<acc){active=i;break;} active=dur.length; }
    _renderProcStages(prog,active);
    $("#proc-eta").textContent= prog>=1?"Finalizing…":("~"+Math.ceil((tot-el))+"s remaining");
    if(prog>=1){ clearInterval(procTimer); setTimeout(()=>{ if(STATE.scene==="processing") setScene("success"); },650); }
  };
  procTimer=setInterval(tickP,80); tickP();
}
function fillErrorLog(msg){
  const ts=new Date().toTimeString().slice(0,8);
  $("#err-log").innerHTML=[
    `<span style="color:var(--t-3)">${ts}</span> yt-extract: resolving stream manifest…`,
    `<span style="color:var(--t-3)">${ts}</span> <span class="ln-warn">WARN</span> 3 of 4 formats unavailable`,
    `<span style="color:var(--t-3)">${ts}</span> <span class="ln-err">ERROR</span> ${msg||"HTTP 403 — signature cipher rejected"}`,
    `<span style="color:var(--t-3)">${ts}</span> pipeline halted · 0 stems written`,
  ].join("<br/>");
}

/* ---------------- CONTEXT MENU ---------------- */
function showCtx(x,y,items){
  const ctx=$("#ctx");
  ctx.innerHTML=items.map(it=>{
    if(it.sep)return'<div class="ctx-sep"></div>';
    if(it.label)return`<div class="ctx-label">${it.label}</div>`;
    return`<div class="ctx-item ${it.danger?'danger':''}" data-act="${it.act||''}"><span class="ci-ic">${it.ic?svgIco(it.ic):''}</span>${it.t}${it.k?`<span class="ci-k">${it.k}</span>`:''}</div>`;
  }).join("");
  ctx.style.left=Math.min(x,innerWidth-230)+"px"; ctx.style.top=Math.min(y,innerHeight-260)+"px";
  ctx.classList.add("show");
}
function hideCtx(){ $("#ctx").classList.remove("show"); }

/* ---------------- COMMAND PALETTE ---------------- */
const CMDS=[
  {g:"States",t:"Show empty state",ic:'<rect x="3" y="3" width="18" height="18" rx="2"/>',act:()=>setScene("empty")},
  {g:"States",t:"Simulate new analysis (processing)",ic:'<path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',act:()=>setScene("processing")},
  {g:"States",t:"Show error state",ic:'<path d="M12 9v4M12 17h.01"/>',act:()=>setScene("error")},
  {g:"Transport",t:"Play / Pause",k:"Space",ic:'<path d="M7 4l13 8-13 8z"/>',act:()=>setPlaying(!STATE.playing)},
  {g:"Transport",t:"Return to start",ic:'<path d="M19 5v14L8 12z"/>',act:()=>{STATE.pos=0;positionPlayhead();}},
  {g:"Export",t:"Export all stems as MIDI",k:"⌘E",ic:'<path d="M21 15v4M7 10l5 5 5-5M12 15V3"/>',act:()=>flash("Exported "+P().stems.length+" stems → MIDI")},
  {g:"View",t:"Toggle waveforms",ic:'<path d="M2 12h2l3-8 4 16 3-12 2 6h6"/>',act:()=>{$("#tg-wave").click();}},
];
function openCmdk(){ $("#cmdk").classList.add("show"); $("#cmdk-input").value=""; renderCmdk(""); $("#cmdk-input").focus(); }
function closeCmdk(){ $("#cmdk").classList.remove("show"); }
let cmdkSel=0, cmdkFiltered=[];
function renderCmdk(q){
  cmdkFiltered=CMDS.filter(c=>(c.t+c.g).toLowerCase().includes(q.toLowerCase()));
  cmdkSel=0;
  const groups={};
  cmdkFiltered.forEach(c=>{(groups[c.g]=groups[c.g]||[]).push(c);});
  let html="",idx=0;
  for(const g in groups){ html+=`<div class="cmdk-grp">${g}</div>`;
    groups[g].forEach(c=>{ html+=`<div class="cmdk-item ${idx===0?'sel':''}" data-idx="${idx}"><span class="cmi-ic">${svgIco(c.ic)}</span><span class="cmi-t">${c.t}</span>${c.s?`<span class="cmi-s">${c.s}</span>`:''}${c.k?`<span class="kbd">${c.k}</span>`:''}</div>`; idx++; }); }
  $("#cmdk-list").innerHTML=html||'<div class="cmdk-grp">No results</div>';
}
function runCmdk(i){ const c=cmdkFiltered[i]; if(c){ closeCmdk(); c.act(); } }

/* ---------------- FLASH ---------------- */
let flashT=null;
function flash(msg){ $("#flash-t").textContent=msg; $("#flash").classList.add("show"); clearTimeout(flashT); flashT=setTimeout(()=>$("#flash").classList.remove("show"),2200); }

/* ---------------- MIDI NOTE LOADER ---------------- */
async function _loadMidiNotes(sid, stems){
  // Pre-init to [] so export knows "fetched but empty" vs "never attempted"
  stems.forEach(s => { if(s.midi_url && s.clef!=="perc") s.midiNotes = s.midiNotes || []; });
  await Promise.allSettled(stems.map(async s => {
    if(!s.midi_url || s.clef==="perc") return;
    try {
      const r = await fetch(_api(`/api/midi/${sid}/${s.id}`));
      if(r.ok){ const d=await r.json(); s.midiNotes=d.notes||[]; }
      // non-OK → keep [] so export still works (score will show rests)
    } catch(_){}
  }));
}

/* ---------------- LOCAL FILE UPLOAD ---------------- */
async function submitLocalFile(file){
  if(STATE.scene==="processing") return;
  clearInterval(_activePoll); _activePoll=null;
  STATE.liveProject=null;
  STATE.url="local:"+file.name;
  setScene("processing");
  $("#proc-tt").textContent=file.name;
  $("#proc-ts").textContent=(file.size/1e6).toFixed(1)+" MB · local file";

  const fd=new FormData();
  fd.append("file",file);
  let sid;
  try {
    const r=await fetch(_api("/api/upload"),{method:"POST",body:fd});
    if(!r.ok) throw new Error("Upload failed "+r.status);
    ({session_id:sid}=await r.json());
  } catch(e) {
    fillErrorLog("Upload failed: "+e.message);
    setScene("error");
    return;
  }

  flash("Uploading… session "+sid.slice(0,8));
  _activePoll=setInterval(async()=>{
    if(STATE.scene!=="processing"){clearInterval(_activePoll);_activePoll=null;return;}
    let job;
    try{job=await fetch(_api(`/api/status/${sid}`)).then(x=>x.json());}catch(_){return;}

    if(job.status==="error"){
      clearInterval(_activePoll);_activePoll=null;
      fillErrorLog(job.error||"Unknown error");
      setScene("error");
      return;
    }

    const prog=job.progress||0, si=job.stage>=0?job.stage:0;
    _renderProcStages(prog,si);
    $("#proc-eta").textContent=prog>=1?"Finalizing…":"Processing locally…";
    if(job.status==="done"){
      clearInterval(_activePoll);_activePoll=null;
      const m=job.meta||{};
      const stems=(job.stems||[]).map(s=>({
        ...s,
        density:s.density||2,
        seed:typeof s.seed==='number'?s.seed:(s.id.split('').reduce((a,c)=>a*31+c.charCodeAt(0),1)&0x7fffffff)%50000,
        reg:s.reg||null,
        audio_url: s.audio_url ? _api(s.audio_url) : s.audio_url,
        midi_url:  s.midi_url  ? _api(s.midi_url)  : s.midi_url,
      }));
      STATE.liveProject={
        id:"live",kind:"live",
        title:m.title||file.name,artist:m.artist||"Local file",album:"",source:file.name,
        thumb:"linear-gradient(135deg,oklch(0.4 0.12 260),oklch(0.5 0.1 200))",
        duration:m.duration||0,tempo:m.tempo||120,tempoMap:[[0,m.tempo||120]],
        key:m.key||"A minor",timeSig:m.timeSig||[4,4],
        sampleRate:m.sampleRate||44100,bitDepth:m.bitDepth||24,
        sepModel:m.sepModel||"HT-Demucs v4",transModel:m.transModel||"librosa-pyin",
        gpu:m.gpu||{model:"CPU",util:0,vram:0,vramTotal:0},
        bars:8,barOffset:0,stems,diagnostics:[],spectrum:m.spectrum||[],
      };
      STATE.pkey="live";
      STATE.liveSid=sid;
      STATE.sel=stems.find(s=>!s.removed)?.id||stems[0]?.id||null;
      if(stems.length){
        flash("Loading score…");
        await _loadMidiNotes(sid, STATE.liveProject.stems);
      }
      MidiEngine.reload(STATE.liveProject.stems);
      _invalidateStaffCache();
      renderAll();
      setTimeout(()=>{if(STATE.scene==="processing")setScene("success");},300);
      if(stems.length){
        AudioEngine.loadFromSession(stems,(p,id,ok)=>{if(!ok)flash("Failed: "+id);})
          .then(()=>flash("Audio ready · Space to play"));
      }
    }
  },800);
}

/* ---------------- URL SUBMIT (global so opener + omnibox + empty input all use it) ---------------- */
function submitUrl(url, force=false){
  if(STATE.scene==="processing") return;
  STATE.url=(url||"").trim();
  STATE._forceReanalyze=force;
  STATE.liveProject=null;
  setScene("processing");
}

/* ---------------- SESSION PERSISTENCE ────────────────────── */
const _LS_SESSION = "aegis_session_v2";

function _saveSession() {
  const p = P(), sid = STATE.liveSid;
  if (!p || !sid) return;
  const slim = {
    ...p,
    stems: p.stems.map(({ midiNotes, ...s }) => s),
    spectrum: [], diagnostics: [],
  };
  try { localStorage.setItem(_LS_SESSION, JSON.stringify({ sid, project: slim, ts: Date.now() })); } catch(_){}
}

async function _tryRestoreSession() {
  try {
    const raw = localStorage.getItem(_LS_SESSION);
    if (!raw) return false;
    const { sid, project, ts } = JSON.parse(raw);
    if (!sid || !project) return false;
    if (Date.now() - ts > 7 * 24 * 3600 * 1000) return false;  // 7-day TTL
    const r = await fetch(_api(`/api/status/${sid}`));
    if (!r.ok) return false;
    const job = await r.json();
    if (job.status !== "done") return false;
    // Merge freshest stems from server (in case file paths changed)
    const stems = (job.stems || project.stems || []).map(s => ({
      ...s,
      density: s.density || 2,
      seed: typeof s.seed === "number" ? s.seed : 1,
      reg: s.reg || null,
      audio_url: s.audio_url ? _api(s.audio_url) : s.audio_url,
      midi_url:  s.midi_url  ? _api(s.midi_url)  : s.midi_url,
    }));
    STATE.liveProject = { ...project, stems };
    STATE.pkey = "live";
    STATE.liveSid = sid;
    STATE.sel = stems.find(s => !s.removed)?.id || stems[0]?.id || null;
    flash("Restoring session…");
    if (stems.length) {
      await _loadMidiNotes(sid, STATE.liveProject.stems);
      MidiEngine.reload(STATE.liveProject.stems);
    }
    renderAll();
    setScene("success");
    flash("Session restored — audio loading…");
    if (stems.length) {
      AudioEngine.loadFromSession(stems, (_, id, ok) => { if (!ok) flash("Audio failed: " + id); })
        .then(() => flash("Audio ready · Space to play"));
    }
    return true;
  } catch(_) { return false; }
}

async function _openRecentSession(entry) {
  if (!entry) return;
  setPlaying(false);
  clearInterval(_activePoll); _activePoll = null;
  STATE.url = entry.url || "";
  if (entry.sid) {
    setScene("loading");
    try {
      const r = await fetch(_api(`/api/status/${entry.sid}`));
      if (r.ok) {
        const job = await r.json();
        if (job.status === "done") {
          const m = job.meta || {};
          const stems = (job.stems || []).map(s => ({
            ...s, density: s.density||2,
            seed: typeof s.seed==="number"?s.seed:1, reg: s.reg||null,
            audio_url: s.audio_url ? _api(s.audio_url) : s.audio_url,
            midi_url:  s.midi_url  ? _api(s.midi_url)  : s.midi_url,
          }));
          STATE.liveProject = {
            id:"live", kind:"live",
            title: m.title||entry.title||"Untitled",
            artist: m.artist||entry.artist||"",
            album:"", source: entry.url||"",
            thumb: m.thumb?`url("${m.thumb}") center/cover`
                         :"linear-gradient(135deg,oklch(0.4 0.12 260),oklch(0.5 0.1 200))",
            duration: m.duration||180, tempo: m.tempo||120,
            tempoMap:[[0,m.tempo||120]],
            key: m.key||"A minor", timeSig: m.timeSig||[4,4],
            sampleRate: m.sampleRate||44100, bitDepth: m.bitDepth||24,
            sepModel: m.sepModel||"HT-Demucs v4", transModel: m.transModel||"basic-pitch",
            gpu: m.gpu||{model:"CPU",util:0,vram:0,vramTotal:0},
            bars:_calcBars(), barOffset:0,
            stems, diagnostics:[], spectrum: m.spectrum||[],
          };
          STATE.pkey="live"; STATE.liveSid=entry.sid;
          STATE.sel=stems.find(s=>!s.removed)?.id||stems[0]?.id||null;
          flash("Loading score…");
          if (stems.length) {
            await _loadMidiNotes(entry.sid, STATE.liveProject.stems);
            MidiEngine.reload(STATE.liveProject.stems);
          }
          _invalidateStaffCache(); renderAll(); setScene("success");
          flash("Restored — audio loading…");
          AudioEngine.loadFromSession(stems, (_,id,ok)=>{ if(!ok) flash("Audio: "+id+" failed"); })
            .then(()=>flash("Audio ready · Space to play"));
          _saveSession();
          return;
        }
      }
    } catch(_) {}
  }
  if (entry.url) submitUrl(entry.url);
  else flash("Cannot open: no URL stored");
}

/* ---------------- EVENTS ---------------- */
function bind(){
  // File picker wired to hidden input
  $("#file-picker").addEventListener("change",e=>{
    const f=e.target.files?.[0];
    if(f) submitLocalFile(f);
    e.target.value="";
  });

  // Drag-drop audio — visual feedback + handler
  let _dragLeaveTimer = null;
  document.addEventListener("dragenter", e=>{ e.preventDefault(); document.body.classList.add("drag-over"); clearTimeout(_dragLeaveTimer); });
  document.addEventListener("dragover",  e=>{ e.preventDefault(); e.dataTransfer.dropEffect="copy"; clearTimeout(_dragLeaveTimer); });
  document.addEventListener("dragleave", e=>{ _dragLeaveTimer=setTimeout(()=>document.body.classList.remove("drag-over"),80); });
  document.addEventListener("drop",e=>{
    e.preventDefault();
    document.body.classList.remove("drag-over");
    const f=e.dataTransfer.files?.[0];
    if(!f) return;
    if(f.type.startsWith("audio/")||f.type.startsWith("video/")||/\.(mp3|wav|flac|aac|ogg|m4a|mp4|webm)$/i.test(f.name)){
      submitLocalFile(f);
    } else {
      flash("Drop an audio or video file");
    }
  });

  document.addEventListener("click",e=>{
    const t=e.target;
    const mb=t.closest("[data-menubar]"); if(mb){
      const act=mb.dataset.menubar;
      if(act==="analyze"){
        const p=P();
        if(p && STATE.url){ submitUrl(STATE.url, true); }         // re-run AI pipeline on same URL
        else if(p){ flash("Drop a file or paste a URL to re-analyze"); $("#omni-input")?.focus(); }
        else { setScene("empty"); }
      }
      else if(act==="score"){ document.querySelector('.tab[data-tab="score"]')?.click(); }
      else if(act==="view"){ openCmdk(); }
      return;
    }
    const load=t.closest("[data-load]"); if(load){ loadProject(load.dataset.load, load.dataset.load && SCENES[load.dataset.load]?undefined:undefined); return; }
    const stemEl=t.closest("[data-stem]");
    const mute=t.closest("[data-mute]"); if(mute){ e.stopPropagation(); toggleMute(mute.dataset.mute); return; }
    const solo=t.closest("[data-solo]"); if(solo){ e.stopPropagation(); toggleSolo(solo.dataset.solo); return; }
    if(stemEl&&!t.closest(".gt-btns")){ selectStem(stemEl.dataset.stem); return; }
    // tabs
    const tab=t.closest(".tab"); if(tab){ $$(".tab").forEach(x=>x.classList.toggle("active",x===tab)); if(tab.dataset.tab!=="score") flash(tab.textContent.trim()+" view — score is the active mock"); return; }
    const itab=t.closest(".insp-tab"); if(itab){ STATE.itab=itab.dataset.itab; $$(".insp-tab").forEach(x=>x.classList.toggle("active",x===itab)); renderInspector(); return; }
    const stool=t.closest(".stool"); if(stool&&stool.dataset.tool){ $$(".stool").forEach(x=>x.classList.remove("active")); stool.classList.add("active"); return; }
    const fmt=t.closest(".exp-fmt"); if(fmt){ $$(".exp-fmt").forEach(x=>x.classList.remove("sel")); fmt.classList.add("sel"); return; }
    if(t.closest("#do-export")){
      const p=P(); const fmt=($(".exp-fmt.sel .ef-ext")||{}).textContent||".mid";
      const activeSt=p.stems.filter(s=>!s.removed);
      if(fmt===".mid" && STATE.liveSid && activeSt.some(s=>s.midi_url)){
        activeSt.filter(s=>s.midi_url).forEach((s,i)=>{
          setTimeout(()=>{ const a=document.createElement("a"); a.href=s.midi_url; a.download=s.id+".mid"; document.body.appendChild(a); a.click(); document.body.removeChild(a); }, i*250);
        });
        flash("Downloading "+activeSt.filter(s=>s.midi_url).length+" MIDI files…");
      } else if(fmt===".wav" && STATE.liveSid && activeSt.some(s=>s.audio_url)){
        activeSt.filter(s=>s.audio_url).forEach((s,i)=>{
          setTimeout(()=>{ const a=document.createElement("a"); a.href=s.audio_url; a.download=s.id+".wav"; document.body.appendChild(a); a.click(); document.body.removeChild(a); }, i*250);
        });
        flash("Downloading "+activeSt.filter(s=>s.audio_url).length+" stem WAVs…");
      } else {
        flash("Exported "+activeSt.length+" stems → "+(fmt||".mid"));
      }
      return;
    }
    // ctx actions
    const ca=t.closest(".ctx-item"); if(ca){ handleCtxAct(ca.dataset.act); hideCtx(); return; }
    // cmdk item
    const ci=t.closest(".cmdk-item"); if(ci&&ci.dataset.idx!=null){ runCmdk(+ci.dataset.idx); return; }
    if(t.closest("#btn-cmdk")){ openCmdk(); return; }
    if(t.id==="cmdk"){ closeCmdk(); return; }
    // crumb title click → project actions menu
    if(t.closest("#crumb-title")){
      const p=P(); if(!p) return;
      const r=t.closest("#crumb-title").getBoundingClientRect();
      showCtx(r.left, r.bottom+4, [
        { label: p.title },
        { t:"Export stems as MIDI", ic:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
          act:"flash:proj-export" },
        { t:"Export stems as WAV",  ic:'<path d="M2 12h2l3-8 4 16 3-12 2 6h6"/>',
          act:"flash:proj-export-wav" },
        { t:"Detection log",        ic:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
          act:"proj:log" },
        { sep:true },
        { t:"Re-analyze",           ic:'<path d="M12 2v4M2 12h4"/>',
          act:"proj:reanalyze" },
        { t:"Close project",        ic:'<path d="M18 6L6 18M6 6l12 12"/>', danger:1,
          act:"proj:close" },
      ]); return;
    }
    // scene pill menu
    if(t.closest("#scene-pill")){ const r=t.closest("#scene-pill").getBoundingClientRect(); showCtx(r.left,r.bottom+4,[
      {label:"Application states"},
      {t:"Success / loaded",ic:'<path d="M20 6 9 17l-5-5"/>',act:"sc:success"},
      {t:"Empty",ic:'<rect x="3" y="3" width="18" height="18" rx="2"/>',act:"sc:empty"},
      {t:"Processing",ic:'<path d="M12 2v4M2 12h4"/>',act:"sc:processing"},
      {t:"Error",ic:'<path d="M12 9v4M12 17h.01"/>',act:"sc:error"},
    ]); return; }
    hideCtx();
    // transport
    if(t.closest("#tp-play")) setPlaying(!STATE.playing);
    if(t.closest("#tp-stop")){ setPlaying(false); STATE.pos=P()?.barOffset||0; positionPlayhead(); }
    if(t.closest("#tp-start")){ STATE.pos=0; positionPlayhead(); $("#lane-scroll").scrollLeft=0; }
    if(t.closest("#tp-loop")) t.closest("#tp-loop").classList.toggle("on");
    // toggles
    if(t.closest("#tg-wave")){ STATE.showWave=!STATE.showWave; $("#tg-wave").classList.toggle("on",STATE.showWave); renderTimeline(); }
    if(t.closest("#tg-beat")){ STATE.showGrid=!STATE.showGrid; $("#tg-beat").classList.toggle("on",STATE.showGrid); $("#grid-canvas").style.display=STATE.showGrid?"block":"none"; }
    if(t.closest("#tg-tempo")){ t.closest("#tg-tempo").classList.toggle("on"); flash("Tempo map "+(t.closest("#tg-tempo").classList.contains("on")?"shown":"hidden")); }
    if(t.closest("#zoom-in")){ STATE.zoom=Math.min(2,STATE.zoom+0.1); applyZoom(); }
    if(t.closest("#zoom-out")){ STATE.zoom=Math.max(0.6,STATE.zoom-0.1); applyZoom(); }
    if(t.closest("#err-retry")){ setScene("processing"); }
    if(t.closest("#err-dismiss")){ setScene("success"); }
    if(t.closest("#err-file")){ $("#file-picker").click(); }
    if(t.closest(".er")){ const er=t.closest(".er"); loadProject(er.dataset.load,"processing"); return; }
    if(t.closest("#empty-go")){ const v=$("#empty-input").value.trim(); if(v){ submitUrl(v); } return; }
  });
  // double-click gutter track or lane → focus player
  document.addEventListener("dblclick",e=>{
    const gt=e.target.closest(".gutter-track, .lane");
    if(!gt) return;
    e.preventDefault(); e.stopPropagation();
    const id=gt.dataset.stem; if(!id) return;
    if(id===STATE.focusStem) closeFocusTrack();
    else openFocusTrack(id);
  });
  // focus panel controls
  document.getElementById("focus-close").addEventListener("click",closeFocusTrack);
  document.getElementById("focus-wave-wrap").addEventListener("click",e=>{
    const p=P(); if(!p) return;
    const rect=e.currentTarget.getBoundingClientRect();
    const secs=Math.max(0,(e.clientX-rect.left)/rect.width)*p.duration;
    STATE.pos=secs*p.tempo/60/p.timeSig[0];
    const fph=document.getElementById("focus-ph");
    if(fph) fph.style.left=Math.min(100,secs/Math.max(1,p.duration)*100)+"%";
    positionPlayhead();
    if(STATE.playing){ const eng=_activeEngine(); eng.stop(); eng.start(secs); }
  });

  // lane seek — ignore native horizontal scrollbar (lives below clientHeight)
  $("#lane-scroll").addEventListener("mousedown",ev=>{
    if(ev.target.closest(".playhead"))return;
    const sc=ev.currentTarget;
    if(ev.offsetY >= sc.clientHeight) return; // click is in native scrollbar area
    const wrap=$("#lanes-wrap"); const rect=wrap.getBoundingClientRect();
    const x=ev.clientX-rect.left; STATE.pos=Math.max(0,x/STATE.barPx); positionPlayhead();
    if(STATE.playing){ const eng=_activeEngine(); eng.stop(); eng.start(barsToSecs(STATE.pos)); }
  });
  // ruler seek
  $("#ruler").addEventListener("mousedown",e=>{ const r=e.currentTarget.getBoundingClientRect(); STATE.pos=Math.max(0,(e.clientX-r.left)/STATE.barPx); positionPlayhead(); });
  // synced vertical scroll between gutter & lanes
  const gv=$("#gutter-scroll"), lv=$("#lanes-vscroll"); let syncing=false;
  lv.addEventListener("scroll",()=>{ if(syncing)return; syncing=true; gv.scrollTop=lv.scrollTop; syncing=false; });
  gv.addEventListener("scroll",()=>{ if(syncing)return; syncing=true; lv.scrollTop=gv.scrollTop; syncing=false; });
  // timeline horizontal scroll → sync score barOffset
  // During playback tick() sets sc.scrollLeft programmatically — skip those events,
  // only react to genuine user drags of the scrollbar.
  let _scoreScrollRAF=null;
  // _progScrollLeft is module-scoped (declared above tick) — shared with tick()
  $("#lane-scroll").addEventListener("scroll",()=>{
    const p=P(); if(!p) return;
    const sl=$("#lane-scroll").scrollLeft;
    if(Math.abs(sl-_progScrollLeft)<2) return; // tick()-driven scroll, ignore
    if(_scoreScrollRAF) cancelAnimationFrame(_scoreScrollRAF);
    _scoreScrollRAF=requestAnimationFrame(()=>{
      const bar=Math.floor($("#lane-scroll").scrollLeft/STATE.barPx);
      const newOff=Math.max(0,Math.min(totalBars()-p.bars,bar));
      if(newOff!==p.barOffset){ p.barOffset=newOff; renderScore(); }
    });
  });
  // context menus
  document.addEventListener("contextmenu",e=>{
    const g=e.target.closest("[data-stem]");
    if(g){ e.preventDefault(); const id=g.dataset.stem; const s=P().stems.find(x=>x.id===id); selectStem(id);
      showCtx(e.clientX,e.clientY,[
        {label:s.name},
        {t:"Solo this stem",ic:'<circle cx="12" cy="12" r="3"/>',k:"S",act:"solo:"+id},
        {t:STATE.muted.has(id)?"Unmute":"Mute",ic:'<path d="M11 5 6 9H2v6h4l5 4z"/>',k:"M",act:"mute:"+id},
        {sep:1},
        {t:"Open in piano roll",ic:'<rect x="3" y="4" width="18" height="16" rx="2"/>',act:"flash:Piano roll"},
        {t:"Re-identify instrument",ic:'<path d="M21 12a9 9 0 1 1-3-6.7"/>',act:"flash:Re-running identification…"},
        {t:"Export stem…",ic:'<path d="M12 3v12M7 10l5 5 5-5"/>',k:"⌘E",act:"flash:Export "+s.name},
        {sep:1},
        {t:"Delete stem",ic:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',danger:1,act:"flash:Stem removed"},
      ]); return; }
    if(e.target.closest(".staff-row")||e.target.closest("#score-paper")){ e.preventDefault();
      showCtx(e.clientX,e.clientY,[
        {label:"Score"},
        {t:"Insert note",ic:'<circle cx="7" cy="18" r="3"/><path d="M10 18V4l9-2"/>',k:"N",act:"flash:Note input"},
        {t:"Change clef",ic:'<path d="M9 18V5l12-2"/>',act:"flash:Clef menu"},
        {t:"Add dynamic",ic:'<path d="M3 12h18"/>',act:"flash:Dynamic"},
        {sep:1},
        {t:"Toggle concert pitch",ic:'<path d="M12 2v20"/>',act:"flash:Concert pitch"},
        {t:"Print score…",ic:'<rect x="6" y="9" width="12" height="7"/><path d="M6 9V3h12v6"/>',k:"⌘P",act:"flash:Printing…"},
      ]); return; }
  });
  // omnibox enter
  $("#omni-input").addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.target.blur(); submitUrl(e.target.value); }});
  $("#omni-input").addEventListener("blur",e=>{ STATE.url=(e.target.value||"").trim(); });
  $("#empty-input").addEventListener("keydown",e=>{ if(e.key==="Enter") submitUrl(e.target.value); });
  // cmdk input
  $("#cmdk-input").addEventListener("input",e=>renderCmdk(e.target.value));
  $("#cmdk-input").addEventListener("keydown",e=>{
    const items=$$(".cmdk-item");
    if(e.key==="ArrowDown"){ e.preventDefault(); cmdkSel=Math.min(items.length-1,cmdkSel+1); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); cmdkSel=Math.max(0,cmdkSel-1); }
    else if(e.key==="Enter"){ runCmdk(cmdkSel); return; }
    else return;
    items.forEach((it,i)=>it.classList.toggle("sel",i===cmdkSel));
    items[cmdkSel]?.scrollIntoView({block:"nearest"});
  });
  // global keys
  document.addEventListener("keydown",e=>{
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"){ e.preventDefault(); openCmdk(); return; }
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="e"){ e.preventDefault(); if(P()) flash("Exported "+P().stems.filter(s=>!s.removed).length+" stems → MIDI"); return; }
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="l"){ e.preventDefault(); $("#omni-input").focus(); $("#omni-input").select(); return; }
    if(e.key==="Escape"){ closeCmdk(); hideCtx(); if(STATE.focusStem) closeFocusTrack(); }
    if(e.target.tagName==="INPUT")return;
    if(e.code==="Space"){ e.preventDefault(); setPlaying(!STATE.playing); }
    if(e.key==="m"&&STATE.sel) toggleMute(STATE.sel);
    if(e.key==="s"&&STATE.sel) toggleSolo(STATE.sel);
    if(e.key==="+"||e.key==="="){ STATE.zoom=Math.min(2,STATE.zoom+0.1); applyZoom(); }
    if(e.key==="-"){ STATE.zoom=Math.max(0.6,STATE.zoom-0.1); applyZoom(); }
    // arrow select stem
    if(e.key==="ArrowDown"||e.key==="ArrowUp"){ if(!P()) return; const st=P().stems; let i=st.findIndex(s=>s.id===STATE.sel); i=(i+(e.key==="ArrowDown"?1:-1)+st.length)%st.length; selectStem(st[i].id); }
  });
  // hover hints on transport
  document.addEventListener("mouseover",e=>{ const h=e.target.closest("[title]"); });
}
function handleCtxAct(act){
  if(!act)return;
  if(act.startsWith("sc:")) setScene(act.slice(3));
  else if(act.startsWith("pj:")) loadProject(act.slice(3));
  else if(act.startsWith("solo:")) toggleSolo(act.slice(5));
  else if(act.startsWith("mute:")) toggleMute(act.slice(5));
  else if(act==="flash:proj-export"){
    const p=P(); if(!p) return;
    const activeSt=p.stems.filter(s=>!s.removed&&s.midi_url);
    if(activeSt.length){ activeSt.forEach((s,i)=>setTimeout(()=>{const a=document.createElement("a");a.href=s.midi_url;a.download=s.id+".mid";document.body.appendChild(a);a.click();document.body.removeChild(a);},i*250)); flash("Downloading "+activeSt.length+" MIDI files…"); }
    else flash("No MIDI data yet — analyze first");
  }
  else if(act==="flash:proj-export-wav"){
    const p=P(); if(!p) return;
    const activeSt=p.stems.filter(s=>!s.removed&&s.audio_url);
    if(activeSt.length){ activeSt.forEach((s,i)=>setTimeout(()=>{const a=document.createElement("a");a.href=s.audio_url;a.download=s.id+".wav";document.body.appendChild(a);a.click();document.body.removeChild(a);},i*250)); flash("Downloading "+activeSt.length+" stems…"); }
    else flash("No stem audio yet");
  }
  else if(act==="proj:log"){
    const sid=STATE.liveSid; if(!sid){flash("No active session");return;}
    fetch(_api(`/api/detection_log/${sid}`)).then(r=>r.ok?r.text():Promise.reject()).then(txt=>{
      const w=window.open("","_blank","width=600,height=500");
      w.document.write(`<pre style="font:13px/1.6 monospace;background:#0a0a0c;color:#ccc;padding:16px;margin:0">${txt.replace(/</g,"&lt;")}</pre>`);
    }).catch(()=>flash("Detection log not found"));
  }
  else if(act==="proj:reanalyze"){
    if(STATE.url) submitUrl(STATE.url, true);
    else flash("No URL — drop a file to re-analyze");
  }
  else if(act==="proj:close"){
    setPlaying(false);
    STATE.liveProject=null; STATE.liveSid=null; STATE.pkey=null;
    try{ localStorage.removeItem(_LS_SESSION); }catch(_){}
    setScene("empty");
  }
  else if(act.startsWith("flash:")) flash(act.slice(6));
  else if(act.startsWith("ri:")){
    const [,op,idxStr] = act.split(":");
    const idx = parseInt(idxStr);
    const list = _recentSessions();
    const entry = list[idx];
    if(!entry) return;
    if(op==="open"){
      _openRecentSession(entry);
    } else if(op==="delete"){
      list.splice(idx, 1);
      try{ localStorage.setItem(_LS_RECENT, JSON.stringify(list)); }catch(_){}
      _renderOpenerRecent();
      flash("Removed from recents");
    } else if(op==="dupe"){
      const copy = { ...entry, title: entry.title + " (copy)" };
      list.splice(idx + 1, 0, copy);
      try{ localStorage.setItem(_LS_RECENT, JSON.stringify(list)); }catch(_){}
      _renderOpenerRecent();
      flash("Duplicated project entry");
    } else if(op==="export"){
      // Re-open the project and go straight to export
      const sid_raw = localStorage.getItem(_LS_SESSION);
      if(sid_raw){
        try{
          const { sid, project } = JSON.parse(sid_raw);
          if(sid && project){
            const activeSt = (project.stems||[]).filter(s=>!s.removed&&s.midi_url);
            if(activeSt.length){
              activeSt.forEach((s,i)=>setTimeout(()=>{
                const a=document.createElement("a"); a.href=s.midi_url; a.download=s.id+".mid";
                document.body.appendChild(a); a.click(); document.body.removeChild(a);
              }, i*250));
              flash("Downloading "+activeSt.length+" MIDI files…");
              return;
            }
          }
        }catch(_){}
      }
      // Fallback: load the project then export
      document.getElementById("po-url").value = entry.url;
      _openerGo();
      flash("Open the project first, then use Export");
    }
  }
}
// Light redraw: only update opacity + selection classes, no SVG rebuild
function _lightRedrawScore() {
  const p=P(); if(!p) return;
  const solo=STATE.solo.size>0;
  $$('#score-systems .staff-row').forEach(row=>{
    const s=p.stems.find(x=>x.id===row.dataset.stem); if(!s) return;
    const dim=s.removed||STATE.muted.has(s.id)||(solo&&!STATE.solo.has(s.id));
    row.style.opacity=dim?.34:1;
    row.classList.toggle('sel',s.id===STATE.sel);
  });
}

// Light redraw: update waveform muted tint + M/S button states, no DOM rebuild
function _lightRedrawTimeline() {
  const p=P(); if(!p) return;
  const beats=p.timeSig[0], bpx=STATE.barPx, tb=totalBars();
  const W=tb*bpx, laneH=46, solo=STATE.solo.size>0;
  $$('#lanes .lane').forEach(lane=>{
    const s=p.stems.find(x=>x.id===lane.dataset.stem); if(!s) return;
    const cv=lane.querySelector('canvas'); if(!cv) return;
    if(STATE.showWave){
      const peaks=AudioEngine.hasStem(s.id)?AudioEngine.getPeaks(s.id):null;
      drawWaveform(cv,{...s,muted:STATE.muted.has(s.id)||(solo&&!STATE.solo.has(s.id))},{width:W,height:laneH,beatPx:bpx/beats,peaks});
    }
  });
  $$('.gutter-track').forEach(gt=>{
    const id=gt.dataset.stem;
    gt.querySelector('[data-mute]')?.classList.toggle('on',STATE.muted.has(id));
    gt.querySelector('[data-solo]')?.classList.toggle('on',STATE.solo.has(id));
    gt.style.background=id===STATE.sel?'var(--bg-3)':'';
  });
}

function toggleMute(id){
  STATE.muted.has(id)?STATE.muted.delete(id):STATE.muted.add(id);
  if(STATE.playMode==="midi"){
    MidiEngine.setMute(id, STATE.muted.has(id));
    if(STATE.playing){ MidiEngine.stop(); MidiEngine.start(barsToSecs(STATE.pos)); }
  } else {
    AudioEngine.setMute(id, STATE.muted.has(id));
  }
  _lightRedrawScore(); _lightRedrawTimeline(); selectStem(STATE.sel);
}
function toggleSolo(id){
  STATE.solo.has(id)?STATE.solo.delete(id):STATE.solo.add(id);
  if(STATE.playMode==="midi"){
    MidiEngine.setSolo([...STATE.solo]);
    if(STATE.playing){ MidiEngine.stop(); MidiEngine.start(barsToSecs(STATE.pos)); }
  } else {
    AudioEngine.setSolo([...STATE.solo]);
  }
  _lightRedrawScore(); _lightRedrawTimeline();
}

/* ---------------- PROJECT OPENER ────────────────────── */
const _LS_RECENT = "aegis_recent_v1";

function _recentSessions() {
  try { return JSON.parse(localStorage.getItem(_LS_RECENT) || "[]"); } catch(_){ return []; }
}
function _pushRecent(entry) {
  const list = _recentSessions().filter(x => x.url !== entry.url).slice(0, 9);
  list.unshift(entry);
  try { localStorage.setItem(_LS_RECENT, JSON.stringify(list)); } catch(_){}
}

function _renderOpenerRecent() {
  const list = _recentSessions();
  const el = document.getElementById("po-recent-list");
  if (!el) return;
  if (!list.length) { el.innerHTML = '<div class="po-no-recent">No recent sessions yet.</div>'; return; }
  el.innerHTML = list.map((s, i) => `
    <div class="po-recent-item" data-po-recent="${i}">
      <div class="po-ri-thumb" style="background:${s.thumb||'var(--bg-3)'}"></div>
      <div style="flex:1;min-width:0">
        <div class="po-ri-title">${s.title||'Untitled'}</div>
        <div class="po-ri-sub">${s.artist||''} · ${s.url||''}</div>
      </div>
      <button class="po-ri-more" data-po-more="${i}" title="More options">⋯</button>
    </div>`).join("");
}

function _bindOpener() {
  // nav tabs
  document.querySelectorAll(".po-navitem").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".po-navitem").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.po;
      document.querySelectorAll(".po-panel").forEach(p => p.classList.remove("active"));
      document.getElementById("po-panel-" + tab)?.classList.add("active");
      if (tab === "recent") _renderOpenerRecent();
    });
  });

  // URL input enter
  const urlInp = document.getElementById("po-url");
  urlInp?.addEventListener("keydown", e => {
    if (e.key === "Enter") _openerGo();
  });

  // Go button
  document.getElementById("po-go-btn")?.addEventListener("click", _openerGo);

  // Drop zone inside opener
  const dz = document.getElementById("po-drop-zone");
  if (dz) {
    dz.addEventListener("click", e => {
      if (!e.target.classList.contains("po-browse-btn")) document.getElementById("file-picker").click();
    });
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag-over"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag-over"));
    dz.addEventListener("drop", e => {
      e.preventDefault(); dz.classList.remove("drag-over");
      const f = e.dataTransfer.files?.[0];
      if (f) submitLocalFile(f);
    });
  }

  // recent list: click item = open directly; click ⋯ button = ctx menu
  document.getElementById("po-recent-list")?.addEventListener("click", e => {
    // ⋯ more button
    const more = e.target.closest("[data-po-more]");
    if (more) {
      e.stopPropagation();
      const idx = +more.dataset.poMore;
      const entry = _recentSessions()[idx];
      if (!entry) return;
      const r = more.getBoundingClientRect();
      showCtx(Math.max(0, r.right - 210), r.bottom + 4, [
        { label: entry.title || "Project" },
        { t:"Export MIDI", ic:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',               act:`ri:export:${idx}` },
        { t:"Duplicate",   ic:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>', act:`ri:dupe:${idx}` },
        { sep:true },
        { t:"Remove from list", ic:'<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', danger:1, act:`ri:delete:${idx}` },
      ]);
      return;
    }
    // click anywhere on item = open immediately
    const item = e.target.closest("[data-po-recent]");
    if (!item) return;
    const idx = +item.dataset.poRecent;
    const entry = _recentSessions()[idx];
    if (!entry) return;
    _openRecentSession(entry);
  });
}

function _openerGo() {
  const val = (document.getElementById("po-url")?.value || "").trim();
  if (val) submitUrl(val);
}

/* ---------------- INIT ---------------- */
function boot(){
  bind();
  _bindOpener();
  setScene("empty");
  // Show recent sessions tab by default if any exist
  if(_recentSessions().length){
    document.querySelector('.po-navitem[data-po="recent"]')?.click();
  }
  // Recompute visible bars on window resize
  window.addEventListener("resize", ()=>{
    const p=P(); if(!p) return;
    p.bars=_calcBars();
    _invalidateStaffCache(); renderScore();
  });
  // WAV / MIDI mode toggle
  document.getElementById("tp-mode")?.addEventListener("click", ()=>{
    if(STATE.playing) setPlaying(false);
    STATE.playMode = STATE.playMode==="midi" ? "wav" : "midi";
    const btn = document.getElementById("tp-mode");
    const isMidi = STATE.playMode==="midi";
    btn.textContent = isMidi ? "MIDI" : "WAV";
    btn.classList.toggle("on", isMidi);
    if(isMidi){ const p=P(); if(p) MidiEngine.load(p.stems); }
    flash(isMidi ? "MIDI synth mode — plays note synthesis" : "WAV mode — plays separated stems");
  });
  // Auto-save on app close / page unload
  window.addEventListener("beforeunload", _saveSession);
}

document.fonts && document.fonts.ready.then(()=>{ renderScore(); });
boot();
