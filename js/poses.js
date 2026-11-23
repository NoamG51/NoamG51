// Pose library: proven poses from portrait-photography practice, stored as
// body skeletons (no photos). Each pose is described with joint angles and
// turned into MediaPipe-style keypoints by buildPose(). More poses can be
// added from photos with tools/add-poses.html; those land in data/poses.json.
//
// Coordinates: origin at the middle of the hips, 1 unit = torso length
// (shoulder line to hip line), x to the right of the image, y down.
// The person faces the camera, so their LEFT side (MediaPipe 11, 13, 15,
// 23, 25, 27) is on the RIGHT of the image (+x).
//
// Angles are degrees from "hanging straight down". Positive = outward,
// away from the body's centre line; negative = inward / across the body.
// 180 = straight up.

export const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const UPPER = [0, 11, 12, 13, 14, 15, 16];

const LEN = { upperArm: 0.62, forearm: 0.55, thigh: 0.95, shin: 0.9, neck: 0.5 };

function seg(from, angleDeg, len, side) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: from.x + side * Math.sin(a) * len, y: from.y + Math.cos(a) * len };
}

// spec: {
//   turn: 1 = square to camera, 0.6 = about 50° turned
//   lean: torso tilt in degrees (+ = top leans to image right)
//   head: sideways head offset (torso units)
//   L / R: { arm: [upper, fore], leg: [thigh, shin], thighLen, shinLen }
//   hip: hip-line drop on the L side (+ = left hip lower; weight shift)
// }
export function buildPose(spec) {
  const turn = spec.turn ?? 1, lean = ((spec.lean ?? 0) * Math.PI) / 180;
  const up = { x: Math.sin(lean), y: -Math.cos(lean) };
  const across = { x: Math.cos(lean), y: Math.sin(lean) };
  const shMid = { x: up.x, y: up.y };
  const shHalf = 0.4 * turn, hipHalf = 0.25 * (0.4 + 0.6 * turn);
  const hipDrop = spec.hip ?? 0;
  const P = {};
  P[11] = { x: shMid.x + across.x * shHalf, y: shMid.y + across.y * shHalf };
  P[12] = { x: shMid.x - across.x * shHalf, y: shMid.y - across.y * shHalf };
  P[23] = { x: hipHalf, y: hipDrop / 2 };
  P[24] = { x: -hipHalf, y: -hipDrop / 2 };
  P[0] = { x: shMid.x + up.x * LEN.neck + (spec.head ?? 0), y: shMid.y + up.y * LEN.neck };
  const limb = (sideKey, side, s, e, w, h, k, a) => {
    const o = spec[sideKey] || {};
    const arm = o.arm || [6, 4], leg = o.leg || [3, 0];
    P[e] = seg(P[s], arm[0], LEN.upperArm * (o.upperLen ?? 1), side);
    P[w] = seg(P[e], arm[1], LEN.forearm * (o.foreLen ?? 1), side);
    P[k] = seg(P[h], leg[0], LEN.thigh * (o.thighLen ?? 1), side);
    P[a] = seg(P[k], leg[1], LEN.shin * (o.shinLen ?? 1), side);
  };
  limb("L", 1, 11, 13, 15, 23, 25, 27);
  limb("R", -1, 12, 14, 16, 24, 26, 28);
  return P;
}

// The library. `modes` = where it's offered; `prop` = what the scene needs.
export const POSES = [
  // ---- Standing, no props ----
  { id: "hand_hip", name: "Hand on hip", how: "One hand on your hip, elbow pointing out. Weight on the other leg.", modes: ["solo"], prop: null,
    spec: { turn: 0.8, hip: 0.05, L: { arm: [32, -38] }, R: { arm: [8, 4] , leg: [-3, 5] } } },
  { id: "pockets", name: "Hands in pockets", how: "Both hands in your front pockets, elbows slightly out, shoulders relaxed.", modes: ["solo"], prop: null,
    spec: { turn: 0.85, L: { arm: [28, -38] }, R: { arm: [28, -38], leg: [-4, 4] } } },
  { id: "crossed_arms", name: "Arms crossed", how: "Cross your arms loosely, not tight. Turn a little and smile with your eyes.", modes: ["solo", "selfie"], prop: null,
    spec: { turn: 0.85, L: { arm: [12, -95] }, R: { arm: [12, -80] } } },
  { id: "back_leg", name: "Weight on the back leg", how: "Shift your weight back and bend the front knee across a little.", modes: ["solo"], prop: null,
    spec: { turn: 0.7, lean: -3, hip: -0.06, L: { arm: [10, 2] }, R: { arm: [6, 10], leg: [-14, 12] } } },
  { id: "walk", name: "Walk toward the camera", how: "Walk slowly toward the camera and let your arms swing. Burst mode catches the best step.", modes: ["solo"], prop: null,
    spec: { turn: 0.9, L: { arm: [-14, -8], leg: [-8, 14], shinLen: 0.85 }, R: { arm: [18, 14], leg: [10, -4] } } },
  { id: "over_shoulder", name: "Look over your shoulder", how: "Turn your body away, then look back at the camera over your shoulder.", modes: ["solo", "selfie"], prop: null,
    spec: { turn: 0.5, head: 0.12, L: { arm: [4, 2] }, R: { arm: [4, 2] } } },
  { id: "hair", name: "Hand in your hair", how: "Run one hand into your hair, elbow up. Keep the other arm loose.", modes: ["solo", "selfie"], prop: null,
    spec: { turn: 0.85, head: -0.04, L: { arm: [150, -115] }, R: { arm: [8, 4] } } },
  { id: "collar", name: "Fix your collar", how: "Hold your collar or jacket with one hand, as if adjusting it.", modes: ["solo", "selfie"], prop: null,
    spec: { turn: 0.85, R: { arm: [10, -143] }, L: { arm: [8, 4] } } },
  { id: "ankles", name: "Cross your ankles", how: "Stand with your ankles crossed and your weight on the back foot.", modes: ["solo"], prop: null,
    spec: { turn: 0.85, L: { arm: [10, -20], leg: [-9, -3] }, R: { arm: [8, 4], leg: [6, -5] } } },
  { id: "chin", name: "Hand near your chin", how: "Rest your chin lightly on your hand, elbow down. Don't press your face.", modes: ["selfie"], prop: null,
    spec: { turn: 0.9, R: { arm: [-25, -172], foreLen: 1.15 }, L: { arm: [8, 4] } } },
  { id: "shoulder_turn", name: "Turn your shoulder in", how: "Turn your shoulders 45° and bring the near shoulder toward the camera.", modes: ["selfie", "solo"], prop: null,
    spec: { turn: 0.6, head: 0.05, L: { arm: [4, 0] }, R: { arm: [6, 2] } } },

  // ---- With something to lean on or sit on ----
  { id: "lean_wall", name: "Lean on a wall", how: "Lean your shoulder on the wall, cross the front leg over and hook a thumb in your pocket.", modes: ["solo"], prop: "wall",
    spec: { turn: 0.75, lean: 9, L: { arm: [6, 0] }, R: { arm: [20, -25], leg: [-12, 0] } } },
  { id: "lean_fence", name: "Lean on a fence or rail", how: "Rest one forearm on the rail, elbow out, and put your weight on that side.", modes: ["solo"], prop: "rail",
    spec: { turn: 0.8, lean: 8, L: { arm: [58, 75], foreLen: 0.45 }, R: { arm: [8, 4], leg: [-8, 6] } } },
  { id: "sit_steps", name: "Sit on steps", how: "Sit with one foot a step lower, elbows resting on your knees.", modes: ["solo"], prop: "steps",
    spec: { turn: 0.9, L: { arm: [14, -28], leg: [16, -3], thighLen: 0.35, shinLen: 0.8 }, R: { arm: [14, -28], leg: [14, 4], thighLen: 0.35, shinLen: 1.05 } } },
  { id: "sit_edge", name: "Sit on a ledge", how: "Sit on the edge, legs loose, hands resting beside you on the ledge.", modes: ["solo"], prop: "ledge",
    spec: { turn: 0.9, L: { arm: [24, 4], leg: [12, -4], thighLen: 0.35 }, R: { arm: [24, 4], leg: [10, 6], thighLen: 0.35 } } },
];

// Standing stiffly: arms hanging, square to the camera. Never suggested; used so
// a pose only counts as "matched" when you're clearly closer to it than to this.
const NEUTRAL = buildPose({ turn: 1, L: { arm: [5, 0], leg: [3, 0] }, R: { arm: [5, 0], leg: [3, 0] } });

// ---- Extra poses extracted from photos (tools/add-poses.html) ----
let extra = [];
export async function loadExtraPoses() {
  try {
    const r = await fetch(new URL("../data/poses.json", import.meta.url));
    if (!r.ok) return;
    const list = await r.json();
    extra = (Array.isArray(list) ? list : []).filter((p) => p && p.id && p.kp);
  } catch {}
}

// Every pose as { ...meta, kp } with kp[joint] = {x, y} in torso units.
export function allPoses() {
  return [
    ...POSES.map((p) => ({ ...p, kp: buildPose(p.spec) })),
    ...extra.map((p) => ({ modes: ["solo"], prop: null, ...p, kp: Object.fromEntries(Object.entries(p.kp).map(([k, v]) => [Number(k), v])) })),
  ];
}

// ---- Normalizing a detected pose ----
const vis = (p) => p && (p.visibility ?? 1) >= 0.5;

// Turn MediaPipe landmarks (normalized image coords) into torso units.
// Returns { kp, anchor, scale, upperOnly } or null.
export function normalize(lm, aspect) {
  if (!lm || !vis(lm[11]) || !vis(lm[12])) return null;
  const X = (p) => p.x * aspect, Y = (p) => p.y;
  const sh = { x: (X(lm[11]) + X(lm[12])) / 2, y: (Y(lm[11]) + Y(lm[12])) / 2 };
  const hipsOk = vis(lm[23]) && vis(lm[24]);
  let anchor, scale;
  if (hipsOk) {
    anchor = { x: (X(lm[23]) + X(lm[24])) / 2, y: (Y(lm[23]) + Y(lm[24])) / 2 };
    scale = Math.hypot(sh.x - anchor.x, sh.y - anchor.y);
  } else {
    // Upper body only: estimate torso length from nose-to-shoulders (≈ 0.5 torso).
    const d = Math.hypot(X(lm[0]) - sh.x, Y(lm[0]) - sh.y);
    scale = d / LEN.neck;
    anchor = { x: sh.x, y: sh.y + scale };
  }
  if (!(scale > 0.01)) return null;
  const kp = {};
  for (const j of JOINTS) {
    if (!vis(lm[j])) continue;
    kp[j] = { x: (X(lm[j]) - anchor.x) / scale, y: (Y(lm[j]) - anchor.y) / scale };
  }
  return { kp, anchor, scale, upperOnly: !hipsOk };
}

// Average distance between two skeletons over the joints both have.
export function poseDistance(a, b, joints) {
  let s = 0, n = 0;
  for (const j of joints) {
    if (!a[j] || !b[j]) continue;
    s += Math.hypot(a[j].x - b[j].x, a[j].y - b[j].y); n++;
  }
  return n >= 4 ? s / n : Infinity;
}

// Mirror a skeleton left-right (so "hand on LEFT hip" also matches the right).
export function mirror(kp) {
  const swap = { 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23, 25: 26, 26: 25, 27: 28, 28: 27, 0: 0 };
  const out = {};
  for (const [j, p] of Object.entries(kp)) out[swap[j]] = { x: -p.x, y: p.y };
  return out;
}

// Best library match for the person right now.
// Returns { pose, kp (possibly mirrored), dist, matched } or null.
export function suggest(lm, aspect, mode, { exclude = [], prop = undefined, only = null } = {}) {
  const n = normalize(lm, aspect);
  if (!n) return null;
  const joints = n.upperOnly ? UPPER : JOINTS;
  let best = null;
  for (const pose of allPoses()) {
    if (only) { if (pose.id !== only) continue; }
    else {
      if (!pose.modes.includes(mode) || exclude.includes(pose.id)) continue;
      if (prop !== undefined && pose.prop !== prop) continue;
    }
    for (const kp of [pose.kp, mirror(pose.kp)]) {
      const d = poseDistance(n.kp, kp, joints);
      if (!best || d < best.dist) best = { pose, kp, dist: d };
    }
  }
  if (!best) return null;
  const dNeutral = poseDistance(n.kp, NEUTRAL, joints);
  return { ...best, norm: n, matched: best.dist < 0.16 && best.dist < dNeutral * 0.6 };
}

// Library pose → landmark-style array placed on the person, for drawing.
export function placeOnPerson(kp, norm, aspect) {
  const out = [];
  for (let i = 0; i < 33; i++) out.push({ x: 0, y: 0, visibility: 0 });
  for (const [j, p] of Object.entries(kp)) {
    out[j] = { x: (norm.anchor.x + p.x * norm.scale) / aspect, y: norm.anchor.y + p.y * norm.scale, visibility: 1 };
  }
  return out;
}

// Which joints are furthest from the target (to highlight).
export function worstJoints(norm, kp, k = 2) {
  return Object.keys(kp).map(Number)
    .filter((j) => norm.kp[j])
    .map((j) => [j, Math.hypot(norm.kp[j].x - kp[j].x, norm.kp[j].y - kp[j].y)])
    .filter(([, d]) => d > 0.18)
    .sort((a, b) => b[1] - a[1]).slice(0, k).map(([j]) => j);
}
