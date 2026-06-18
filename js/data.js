/* ============================================================
   OVERTONE — project datasets (realistic content)
   diatonic absolute = octave*7 + stepIndex(C=0..B=6)
   ============================================================ */
const DIA = { C:0, D:1, E:2, F:3, G:4, A:5, B:6 };
function dabs(step, oct){ return oct*7 + DIA[step]; }

// key signatures — generated from circle of fifths, covers all 30 standard keys
// Sharp order (FCGDAEB) and flat order (BEADGCF) are music-theory constants
const _SHARP_ORDER = ['F','C','G','D','A','E','B'];
const _FLAT_ORDER  = ['B','E','A','D','G','C','F'];
const _FIFTHS = {
  // major keys
  'C major':0,'G major':1,'D major':2,'A major':3,'E major':4,'B major':5,
  'F# major':6,'C# major':7,
  'F major':-1,'Bb major':-2,'Eb major':-3,'Ab major':-4,'Db major':-5,'Gb major':-6,'Cb major':-7,
  // minor keys (same accidentals as relative major)
  'A minor':0,'E minor':1,'B minor':2,'F# minor':3,'C# minor':4,'G# minor':5,
  'D# minor':6,'A# minor':7,
  'D minor':-1,'G minor':-2,'C minor':-3,'F minor':-4,'Bb minor':-5,'Eb minor':-6,'Ab minor':-7,
};
const KEYSIG = {};
Object.entries(_FIFTHS).forEach(([key, n]) => {
  KEYSIG[key] = n > 0
    ? { sharps: _SHARP_ORDER.slice(0, n), flats: [] }
    : { sharps: [], flats: _FLAT_ORDER.slice(0, -n) };
});

const PROJECTS = {};
