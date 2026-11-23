// Ghost outlines: the target pose or position, built from the person's
// current landmarks so the outline sits right on top of them.
// Each function returns one of:
//   { lm, focus }   a full target skeleton; `focus` = joints that must move
//   { faceBox }     a target face position (selfie / group)
//   null            nothing to draw

export const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

const copy = (lm) => lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 }));
const setX = (lm, i, x) => { lm[i] = { ...lm[i], x }; };

// Which side of the image has more room: +1 = right (larger x), -1 = left.
const roomSide = (m) => (m.pose.cx < 0.5 ? 1 : -1);
// Of a left/right pair, the index whose point is on the given image side.
const onSide = (lm, a, b, side) => ((lm[a].x - lm[b].x) * side > 0 ? a : b);

// Hand on hip: elbow out at ~40°, wrist on the hip, on the side with more room.
export function bendArm(m) {
  const p = m.pose;
  if (!p || !p.hipMid) return null;
  const a = m.aspect, lm = copy(p.lm);
  const s = onSide(lm, 11, 12, roomSide(m));
  const e = s === 11 ? 13 : 14, w = s === 11 ? 15 : 16, h = s === 11 ? 23 : 24;
  const dir = Math.sign(lm[s].x - p.shMid.x) || roomSide(m);
  const U = Math.hypot((lm[e].x - lm[s].x) * a, lm[e].y - lm[s].y) || 0.12;
  const ang = (42 * Math.PI) / 180;
  lm[e] = { x: lm[s].x + (dir * U * Math.sin(ang)) / a, y: lm[s].y + U * Math.cos(ang), visibility: 1 };
  lm[w] = { x: lm[h].x + dir * 0.015, y: lm[h].y - 0.01, visibility: 1 };
  return { lm, focus: [e, w] };
}

// Turned ~30°: shoulders and hips narrower, arms follow their shoulder.
export function turnBody(m) {
  const p = m.pose;
  if (!p) return null;
  const lm = copy(p.lm);
  const narrow = (i, j, k, chains) => {
    const mx = (lm[i].x + lm[j].x) / 2;
    [[i, chains[0]], [j, chains[1]]].forEach(([idx, chain]) => {
      const nx = mx + (lm[idx].x - mx) * k, dx = nx - lm[idx].x;
      setX(lm, idx, nx);
      chain.forEach((c) => setX(lm, c, lm[c].x + dx));
    });
  };
  narrow(11, 12, 0.78, [[13, 15], [14, 16]]);
  if (p.hipMid) narrow(23, 24, 0.85, [[], []]);
  return { lm, focus: [11, 12] };
}

// Weight on the back leg: front knee bends in toward the other leg.
export function bendKnee(m) {
  const p = m.pose;
  if (!p || !p.hipMid) return null;
  const a = m.aspect, lm = copy(p.lm);
  const k = onSide(lm, 25, 26, roomSide(m));
  const h = k === 25 ? 23 : 24;
  const L = Math.hypot((lm[k].x - lm[h].x) * a, lm[k].y - lm[h].y) || 0.2;
  const toward = Math.sign(p.hipMid.x - lm[k].x) || -roomSide(m);
  lm[k] = { x: lm[k].x + (toward * 0.28 * L) / a, y: lm[k].y - 0.012, visibility: 1 };
  return { lm, focus: [k] };
}

// Whole body moved (the photographer reframes to match).
function shifted(m, dx, dy) {
  const p = m.pose;
  if (!p) return null;
  const lm = p.lm.map((q) => ({ x: q.x + dx, y: q.y + dy, visibility: q.visibility ?? 1 }));
  return { lm, focus: [0] };
}
export const lowerHead = (m) => m.pose && shifted(m, 0, 0.07 - m.pose.headTop);
export const raiseBody = (m) => m.pose && shifted(m, 0, 0.12 - m.pose.headTop);
export const toThirds = (m) => m.pose && shifted(m, (m.pose.cx < 0.5 ? 1 / 3 : 2 / 3) - m.pose.cx, 0);

// Face targets.
function faceAt(f, cx, cy, w) {
  const h = (f.h / f.w) * w;
  return { faceBox: { x0: cx - w / 2, x1: cx + w / 2, y0: cy - h / 2, y1: cy + h / 2 } };
}
export const faceSize = (m) => m.mainFace && faceAt(m.mainFace, m.mainFace.cx, m.mainFace.cy, 0.38);
export const faceToThird = (m) => m.mainFace && faceAt(m.mainFace, m.mainFace.cx, m.mainFace.cy + (0.36 - m.mainFace.eyeY), m.mainFace.w);
export const faceDown = (m) => m.mainFace && faceAt(m.mainFace, m.mainFace.cx, m.mainFace.cy + (0.06 - m.mainFace.box.y0), m.mainFace.w);
export function faceInward(m) {
  const f = m.group.edgeFace;
  if (!f) return null;
  const half = f.w / 2;
  const cx = Math.min(0.92 - half, Math.max(0.08 + half, f.cx));
  const cy = Math.max(f.cy, 0.05 + f.h / 2);
  return faceAt(f, cx, cy, f.w);
}
