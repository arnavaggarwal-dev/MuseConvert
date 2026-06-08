/* ============================================================
   OVERTONE — project datasets (realistic content)
   diatonic absolute = octave*7 + stepIndex(C=0..B=6)
   ============================================================ */
const DIA = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
function dabs(step, oct){ return oct*7 + DIA[step]; }

// key signatures -> which diatonic steps are sharp/flat (for accidental glyphs)
const KEYSIG = {
  "F# minor": { sharps:["F","C","G"], flats:[] },
  "D major":  { sharps:["F","C"], flats:[] },
  "A minor":  { sharps:[], flats:[] },
  "Bb major": { sharps:[], flats:["B","E"] },
};

const PROJECTS = {

  /* ---------------- HERO: band track ---------------- */
  band: {
    id:"band", kind:"band",
    title:"Midnight Cartography",
    artist:"Neon Tide",
    album:"Atlas of Sleep · 2025",
    source:"youtube.com/watch?v=k7Qm2x9LpZ4",
    thumb:"linear-gradient(135deg, oklch(0.5 0.16 290), oklch(0.45 0.14 245) 60%, oklch(0.55 0.13 30))",
    duration:218.4, tempo:122, tempoMap:[[0,122],[64,122],[112,118],[160,122]],
    key:"F# minor", timeSig:[4,4], sampleRate:48000, bitDepth:24,
    sepModel:"HT-Demucs v4 · 6-stem", transModel:"OvertoneNet-MIDI 2.3",
    gpu:{ model:"RTX 4090", util:14, vram:6.2, vramTotal:24 },
    bars:8, barOffset:33,
    stems:[
      { id:"drums", name:"Drums", instrument:"Acoustic Kit", family:"Percussion · GM 0",
        clef:"perc", color:"--s-drums", confidence:99.1, midi:412, role:"Rhythm",
        quality:{ snr:31.4, bleed:2.1, artifacts:0.8, separation:98.7 },
        density:4, seed:11, note:"Tight pocket · ghost notes on snare" },
      { id:"bass", name:"Bass", instrument:"Electric Bass (finger)", family:"Bass · GM 33",
        clef:"bass", color:"--s-bass", confidence:97.4, midi:96, role:"Low end",
        reg:[dabs("E",1),dabs("D",3)], density:2, seed:7, note:"Root–fifth, syncopated" },
      { id:"guitar", name:"Elec. Guitar", instrument:"Clean Strat", family:"Guitar · GM 27",
        clef:"treble", color:"--s-guitar", confidence:91.2, midi:188, role:"Harmony",
        reg:[dabs("G",3),dabs("E",5)], density:3, seed:23, note:"Arpeggiated, light chorus" },
      { id:"synth", name:"Lead Synth", instrument:"Analog Saw Lead", family:"Synth Lead · GM 81",
        clef:"treble", color:"--s-synth", confidence:93.0, midi:142, role:"Melody",
        reg:[dabs("D",4),dabs("A",5)], density:3, seed:41, note:"Detuned, portamento" },
      { id:"keys", name:"Keys / Pad", instrument:"Warm Poly Pad", family:"Synth Pad · GM 89",
        clef:"treble", color:"--s-keys", confidence:88.6, midi:74, role:"Texture",
        reg:[dabs("F",3),dabs("C",5)], density:1, seed:5, note:"Sustained triads, slow swell" },
      { id:"vocal", name:"Vocals", instrument:"Lead Vocal", family:"Voice", removed:true,
        clef:"treble", color:"--s-vocal", confidence:95.7, midi:0, role:"Removed",
        reg:[dabs("A",3),dabs("E",5)], density:2, seed:13, note:"Isolated & muted by request" },
    ],
    diagnostics:[
      { sev:"ok",   t:"Vocal isolation clean", s:"No residual lead vocal in instrumental sum.", v:"−42 dB" },
      { sev:"warn", t:"Guitar/keys spectral overlap", s:"Bands 2–4 kHz contend; minor bleed on bar 47.", v:"6.8%" },
      { sev:"ok",   t:"Transient preservation high", s:"Drum attacks retained through separation.", v:"98.7%" },
      { sev:"info", t:"Tempo drift detected", s:"Ritardando across bars 28–30, mapped automatically.", v:"−4 BPM" },
      { sev:"ok",   t:"MIDI quantize confidence", s:"Onset grid locked to 1/16 at 122 BPM.", v:"96.1%" },
    ],
    spectrum:[8,17,28,42,61,73,68,55,47,52,44,38,31,36,27,22,18,24,15,11,14,9,7,12,6,5,8,4,3,5,2,3],
  },

  /* ---------------- MASSIVE: orchestral ---------------- */
  orchestra: {
    id:"orchestra", kind:"orchestra",
    title:"Aurora Borealis Suite — Mvt. II",
    artist:"E. Halvorsen · Oslo Phil.",
    album:"Northern Lights · Live 2024",
    source:"youtube.com/watch?v=A3v8Nq1RtY0",
    thumb:"linear-gradient(135deg, oklch(0.5 0.13 200), oklch(0.55 0.13 150) 55%, oklch(0.6 0.12 80))",
    duration:512.0, tempo:88, tempoMap:[[0,72],[40,88],[300,96],[440,80]],
    key:"D major", timeSig:[3,4], sampleRate:96000, bitDepth:24,
    sepModel:"OrchSep-XL · 14-source", transModel:"OvertoneNet-MIDI 2.3 · poly",
    gpu:{ model:"RTX 4090", util:71, vram:18.9, vramTotal:24 },
    bars:6, barOffset:51,
    stems:[
      { id:"vln1", name:"Violin I", instrument:"Strings", family:"Strings · divisi a2", clef:"treble", color:"--s-strings", confidence:84.2, midi:266, reg:[dabs("G",4),dabs("E",6)], density:4, seed:3, note:"Soaring theme, legato" },
      { id:"vln2", name:"Violin II", instrument:"Strings", family:"Strings", clef:"treble", color:"--s-strings", confidence:81.5, midi:240, reg:[dabs("D",4),dabs("B",5)], density:3, seed:9, note:"Inner harmony" },
      { id:"vla", name:"Viola", instrument:"Strings", family:"Strings", clef:"alto", color:"--s-strings", confidence:78.9, midi:198, reg:[dabs("C",3),dabs("E",5)], density:3, seed:14, note:"Counter-melody" },
      { id:"vc", name:"Cello", instrument:"Strings", family:"Strings", clef:"bass", color:"--s-strings", confidence:86.1, midi:176, reg:[dabs("C",2),dabs("A",3)], density:2, seed:6, note:"Pedal + arco swells" },
      { id:"cb", name:"Contrabass", instrument:"Strings", family:"Strings · 8vb", clef:"bass", color:"--s-strings", confidence:88.4, midi:88, reg:[dabs("E",1),dabs("D",3)], density:1, seed:2, note:"Foundation" },
      { id:"fl", name:"Flute", instrument:"Woodwind", family:"Woodwind · a2", clef:"treble", color:"--s-wood", confidence:79.2, midi:154, reg:[dabs("D",5),dabs("C",7)], density:4, seed:21, note:"Doubling Vln I 8va" },
      { id:"ob", name:"Oboe", instrument:"Woodwind", family:"Woodwind", clef:"treble", color:"--s-wood", confidence:72.6, midi:120, reg:[dabs("B",4),dabs("F",6)], density:2, seed:33, note:"Plaintive solo, bars 12–18" },
      { id:"cl", name:"Clarinet", instrument:"Woodwind", family:"Woodwind · in Bb", clef:"treble", color:"--s-wood", confidence:74.8, midi:138, reg:[dabs("E",3),dabs("C",6)], density:3, seed:28, note:"Arpeggiated figures" },
      { id:"bsn", name:"Bassoon", instrument:"Woodwind", family:"Woodwind", clef:"bass", color:"--s-wood", confidence:76.0, midi:104, reg:[dabs("B",1),dabs("E",4)], density:2, seed:18, note:"Tenor line" },
      { id:"hn", name:"Horns", instrument:"Brass", family:"Brass · F, a4", clef:"treble", color:"--s-brass", confidence:69.3, midi:96, reg:[dabs("C",3),dabs("G",4)], density:1, seed:44, note:"Sustained pads, low conf." },
      { id:"tpt", name:"Trumpets", instrument:"Brass", family:"Brass · C, a2", clef:"treble", color:"--s-brass", confidence:71.1, midi:78, reg:[dabs("G",3),dabs("D",5)], density:1, seed:37, note:"Fanfare, bar 22" },
      { id:"tbn", name:"Trombones", instrument:"Brass", family:"Brass · a3", clef:"bass", color:"--s-brass", confidence:73.5, midi:64, reg:[dabs("E",2),dabs("C",4)], density:1, seed:12, note:"Chorale" },
      { id:"timp", name:"Timpani", instrument:"Percussion", family:"Perc · D–A", clef:"bass", color:"--s-perc", confidence:90.7, midi:42, reg:[dabs("D",2),dabs("A",2)], density:1, seed:8, note:"Rolls + accents" },
      { id:"harp", name:"Harp", instrument:"Plucked", family:"Plucked · pedal D", clef:"treble", color:"--s-keys", confidence:80.4, midi:212, reg:[dabs("C",3),dabs("F",6)], density:4, seed:50, note:"Glissandi, arpeggios" },
    ],
    diagnostics:[
      { sev:"warn", t:"Brass separation degraded", s:"Horn/trombone overlap in 200–500 Hz; 14-source limit.", v:"69.3%" },
      { sev:"warn", t:"Divisi strings under-resolved", s:"Vln I a2 collapsed to single source above 4 kHz.", v:"a2→1" },
      { sev:"ok",   t:"Timpani transients isolated", s:"Pitched percussion cleanly extracted.", v:"90.7%" },
      { sev:"info", t:"96 kHz source", s:"High-res input improved upper-partial recovery.", v:"96 kHz" },
      { sev:"err",  t:"Oboe solo masked", s:"Bars 14–16 below detection floor under tutti.", v:"−38 dB" },
      { sev:"info", t:"Reverb tail (hall)", s:"RT60 ≈ 2.4 s folded into wet residual stem.", v:"2.4 s" },
    ],
    spectrum:[14,26,41,58,72,79,74,68,71,64,58,61,53,48,55,44,49,38,42,33,37,29,31,24,27,19,22,15,12,9,7,5],
  },

  /* ---------------- SMALL: solo piano ---------------- */
  piano: {
    id:"piano", kind:"piano",
    title:"Gymnopédie No. 1",
    artist:"Erik Satie",
    album:"Trois Gymnopédies · 1888 · Public Domain",
    source:"youtube.com/watch?v=S-Xm7s9d0kE",
    thumb:"linear-gradient(135deg, oklch(0.5 0.06 80), oklch(0.45 0.05 60) 60%, oklch(0.4 0.04 40))",
    duration:198.0, tempo:70, tempoMap:[[0,70]],
    key:"D major", timeSig:[3,4], sampleRate:44100, bitDepth:16,
    sepModel:"Solo bypass · no separation", transModel:"OvertoneNet-MIDI 2.3 · piano",
    gpu:{ model:"RTX 4090", util:4, vram:1.8, vramTotal:24 },
    bars:6, barOffset:5, grand:true,
    stems:[
      { id:"pno_r", name:"Piano — R.H.", instrument:"Grand Piano", family:"Keyboard · GM 0", clef:"treble", color:"--s-keys", confidence:99.6, midi:96, reg:[dabs("F",4),dabs("A",5)], density:1, seed:1, note:"Lent et douloureux — melody" },
      { id:"pno_l", name:"Piano — L.H.", instrument:"Grand Piano", family:"Keyboard · GM 0", clef:"bass", color:"--s-keys", confidence:99.4, midi:148, reg:[dabs("D",2),dabs("B",3)], density:2, seed:4, note:"Bass note + chord, ¾ accompaniment" },
    ],
    diagnostics:[
      { sev:"ok",   t:"Single-source — direct transcription", s:"No separation needed; raw-to-MIDI path used.", v:"100%" },
      { sev:"ok",   t:"Pedal events recovered", s:"Sustain (CC64) inferred from decay envelopes.", v:"24 events" },
      { sev:"ok",   t:"Voicing detected", s:"3-voice polyphony tracked across both hands.", v:"3 voices" },
      { sev:"info", t:"Dynamics: pp–mp", s:"Velocity range compressed; gentle reading.", v:"18–54" },
    ],
    spectrum:[6,12,22,34,28,20,15,18,11,9,13,7,6,10,5,4,7,3,5,2,4,2,3,1,2,1,2,1,1,1,1,1],
  },
};
