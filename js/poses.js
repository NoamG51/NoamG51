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

  // ---- Couples (two people; A on the left, B on the right) ----
  { id: "c_side_hug", name: "Side by side, arms around each other", how: "Stand close, inside arms around each other's waist, outside hands relaxed. Lean your heads in a little.", modes: ["couple"], prop: null,
    people: [
      { at: [-0.5, 0], spec: { turn: 0.8, head: 0.05, L: { arm: [34, 68], foreLen: 0.95 }, R: { arm: [8, 4] } } },
      { at: [0.5, 0.06], scale: 0.93, spec: { turn: 0.8, head: -0.06, R: { arm: [34, 68], foreLen: 0.95 }, L: { arm: [8, 4] } } } ] },
  { id: "c_back_hug", name: "Hug from behind", how: "One stands behind and wraps their arms around the other's waist. Rest your chin near their shoulder.", modes: ["couple"], prop: null,
    people: [
      { at: [-0.18, -0.12], spec: { turn: 0.85, head: 0.12, L: { arm: [6, -62] }, R: { arm: [6, -62] } } },
      { at: [0.12, 0.05], scale: 0.93, spec: { turn: 0.85, head: -0.04, L: { arm: [10, -40] }, R: { arm: [10, -40] } } } ] },
  { id: "c_walk", name: "Walk hand in hand", how: "Hold hands and walk slowly toward the camera, chatting. Burst mode catches the best step.", modes: ["couple"], prop: null,
    people: [
      { at: [-0.6, 0], spec: { turn: 0.9, L: { arm: [28, 12] }, R: { arm: [-12, -8], leg: [10, -4] }, } },
      { at: [0.6, 0.05], scale: 0.93, spec: { turn: 0.9, R: { arm: [28, 12] }, L: { arm: [-12, -8], leg: [-8, 14], shinLen: 0.85 } } } ] },
  { id: "c_forehead", name: "Forehead to forehead", how: "Face each other, hands on each other's waist, and gently touch foreheads. Eyes closed or smiling.", modes: ["couple"], prop: null,
    people: [
      { at: [-0.48, 0], spec: { turn: 0.3, lean: 9, head: 0.16, L: { arm: [40, 50] }, R: { arm: [6, 4] } } },
      { at: [0.48, 0.05], scale: 0.93, spec: { turn: 0.3, lean: -9, head: -0.16, R: { arm: [40, 50] }, L: { arm: [6, 4] } } } ] },
  { id: "c_head_shoulder", name: "Head on the shoulder", how: "Stand side by side; one rests their head on the other's shoulder, who puts an arm around them.", modes: ["couple"], prop: null,
    people: [
      { at: [-0.32, 0], spec: { turn: 0.85, L: { arm: [62, 100], upperLen: 0.62, foreLen: 0.38 }, R: { arm: [8, 4] } } },
      { at: [0.32, 0.12], scale: 0.9, spec: { turn: 0.85, lean: -6, head: -0.16, R: { arm: [10, -30] }, L: { arm: [8, 4] } } } ] },
  { id: "c_back_to_back", name: "Back to back", how: "Stand back to back, arms crossed, and look at the camera with a grin.", modes: ["couple"], prop: null,
    people: [
      { at: [-0.24, 0], spec: { turn: 0.35, head: -0.06, L: { arm: [14, -90], foreLen: 0.4 }, R: { arm: [14, 90], foreLen: 0.4 } } },
      { at: [0.24, 0.04], scale: 0.93, spec: { turn: 0.35, head: 0.06, L: { arm: [14, 90], foreLen: 0.4 }, R: { arm: [14, -90], foreLen: 0.4 } } } ] },
  { id: "c_hold_hands", name: "Face each other, holding hands", how: "Stand an arm's length apart, hold both hands and smile at each other, not the camera.", modes: ["couple"], prop: null,
    people: [
      { at: [-0.62, 0], spec: { turn: 0.35, L: { arm: [32, 42] }, R: { arm: [-32, -42] } } },
      { at: [0.62, 0.05], scale: 0.93, spec: { turn: 0.35, R: { arm: [32, 42] }, L: { arm: [-32, -42] } } } ] },
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
    extra = (Array.isArray(list) ? list : []).filter((p) => p && p.id && (p.kp || p.people));
  } catch {}
}

const numKeys = (kp) => Object.fromEntries(Object.entries(kp).map(([k, v]) => [Number(k), v]));

// Build all people of a pose in one shared frame: origin = average of their
// hip centres, 1 unit = their average torso length (same as normalizeGroup).
function buildPeople(p) {
  if (p.spec) return [buildPose(p.spec)];
  if (p.kp) return [numKeys(p.kp)];
  if (p.people && p.people[0] && p.people[0].spec) {
    const raw = p.people.map((q) => {
      const kp = buildPose(q.spec), sc = q.scale ?? 1, [ax, ay] = q.at || [0, 0];
      const out = {};
      for (const [j, v] of Object.entries(kp)) out[j] = { x: ax + v.x * sc, y: ay + v.y * sc };
      return { kp: out, at: [ax, ay], sc };
    });
    const cx = raw.reduce((s, r) => s + r.at[0], 0) / raw.length, cy = raw.reduce((s, r) => s + r.at[1], 0) / raw.length;
    const ms = raw.reduce((s, r) => s + r.sc, 0) / raw.length;
    return raw.map((r) => {
      const out = {};
      for (const [j, v] of Object.entries(r.kp)) out[j] = { x: (v.x - cx) / ms, y: (v.y - cy) / ms };
      return out;
    });
  }
  return (p.people || []).map(numKeys);
}

// Every pose as { ...meta, people: [kp, ...], kp (first person) }.
let cache = null, cacheN = -1;
export function allPoses() {
  if (cache && cacheN === extra.length) return cache;
  cache = [...POSES, ...extra.map((p) => ({ modes: p.people ? ["couple"] : ["solo"], prop: null, ...p }))].map((p) => {
    const people = buildPeople(p);
    return { ...p, people, kp: people[0] };
  });
  cacheN = extra.length;
  return cache;
}

// ---- Normalizing detected people ----
const vis = (p) => p && (p.visibility ?? 1) >= 0.5;

// One person → anchor (hip centre), torso length, upperOnly. In aspect-corrected units.
function personFrame(lm, aspect) {
  if (!lm || !vis(lm[11]) || !vis(lm[12])) return null;
  const X = (p) => p.x * aspect, Y = (p) => p.y;
  const sh = { x: (X(lm[11]) + X(lm[12])) / 2, y: (Y(lm[11]) + Y(lm[12])) / 2 };
  const hipsOk = vis(lm[23]) && vis(lm[24]);
  let anchor, scale;
  if (hipsOk) {
    anchor = { x: (X(lm[23]) + X(lm[24])) / 2, y: (Y(lm[23]) + Y(lm[24])) / 2 };
    scale = Math.hypot(sh.x - anchor.x, sh.y - anchor.y);
  } else {
    const d = Math.hypot(X(lm[0]) - sh.x, Y(lm[0]) - sh.y); // nose to shoulders ≈ 0.5 torso
    scale = d / LEN.neck;
    anchor = { x: sh.x, y: sh.y + scale };
  }
  return scale > 0.01 ? { anchor, scale, upperOnly: !hipsOk } : null;
}

function toUnits(lm, aspect, anchor, scale) {
  const kp = {};
  for (const j of JOINTS) if (vis(lm[j])) kp[j] = { x: (lm[j].x * aspect - anchor.x) / scale, y: (lm[j].y - anchor.y) / scale };
  return kp;
}

// Several people → shared frame. People are sorted left to right.
export function normalizeGroup(lms, aspect) {
  const list = lms.map((lm) => ({ lm, f: personFrame(lm, aspect) })).filter((q) => q.f).sort((a, b) => a.f.anchor.x - b.f.anchor.x);
  if (!list.length) return null;
  const anchor = { x: list.reduce((s, q) => s + q.f.anchor.x, 0) / list.length, y: list.reduce((s, q) => s + q.f.anchor.y, 0) / list.length };
  const scale = list.reduce((s, q) => s + q.f.scale, 0) / list.length;
  return {
    anchor, scale, upperOnly: list.some((q) => q.f.upperOnly),
    lms: list.map((q) => q.lm),
    people: list.map((q) => toUnits(q.lm, aspect, anchor, scale)),
    own: list.map((q) => toUnits(q.lm, aspect, q.f.anchor, q.f.scale)), // each person in their own frame
  };
}
export const normalize = (lm, aspect) => {
  const g = normalizeGroup([lm], aspect);
  return g && { kp: g.people[0], anchor: g.anchor, scale: g.scale, upperOnly: g.upperOnly };
};

// Average distance between two skeletons over the joints both have.
export function poseDistance(a, b, joints) {
  let s = 0, n = 0;
  for (const j of joints) {
    if (!a[j] || !b[j]) continue;
    s += Math.hypot(a[j].x - b[j].x, a[j].y - b[j].y); n++;
  }
  return n >= 4 ? s / n : Infinity;
}
const groupDistance = (A, B, joints) => A.reduce((s, kp, i) => s + poseDistance(kp, B[i], joints), 0) / A.length;

// Largest single-joint error: one arm in the wrong place shouldn't count as a match.
function maxJointError(A, B, joints) {
  let mx = 0;
  A.forEach((kp, i) => { for (const j of joints) if (kp[j] && B[i][j]) mx = Math.max(mx, Math.hypot(kp[j].x - B[i][j].x, kp[j].y - B[i][j].y)); });
  return mx;
}

// Mirror a skeleton left-right (so "hand on LEFT hip" also matches the right).
export function mirror(kp) {
  const swap = { 11: 12, 12: 11, 13: 14, 14: 13, 15: 16, 16: 15, 23: 24, 24: 23, 25: 26, 26: 25, 27: 28, 28: 27, 0: 0 };
  const out = {};
  for (const [j, p] of Object.entries(kp)) out[swap[j]] = { x: -p.x, y: p.y };
  return out;
}
const mirrorGroup = (people) => people.map(mirror).reverse();

// Best library match for the people in view, placed on them.
// Returns { pose, people (target kps, maybe mirrored), dist, norm, matched } or null.
export function suggest(lms, aspect, mode, { exclude = [], prop = undefined, only = null } = {}) {
  const n = normalizeGroup(lms, aspect);
  if (!n) return null;
  const joints = n.upperOnly ? UPPER : JOINTS;
  let best = null;
  for (const pose of allPoses()) {
    if (only) { if (pose.id !== only) continue; }
    else {
      if (!pose.modes.includes(mode) || exclude.includes(pose.id)) continue;
      if (prop !== undefined && pose.prop !== prop) continue;
    }
    if (pose.people.length !== n.people.length) continue;
    for (const people of [pose.people, mirrorGroup(pose.people)]) {
      const d = groupDistance(n.people, people, joints);
      if (!best || d < best.dist) best = { pose, people, dist: d };
    }
  }
  if (!best) return null;
  return { ...best, norm: n, matched: isMatch(best.dist, n, best.people, joints) };
}

// A pose counts as matched when it's close on average, no joint is far off,
// and (for one person) it's clearly not just standing stiffly.
function isMatch(dist, n, target, joints) {
  if (maxJointError(n.people, target, joints) > 0.38) return false;
  if (n.people.length === 1) return dist < 0.16 && dist < poseDistance(n.own[0], NEUTRAL, joints) * 0.6;
  return dist < 0.18;
}

// Target kps → landmark-style arrays (normalized image coords) for drawing.
export function placePeople(people, anchor, scale, aspect) {
  return people.map((kp) => {
    const out = [];
    for (let i = 0; i < 33; i++) out.push({ x: 0, y: 0, visibility: 0 });
    for (const [j, p] of Object.entries(kp)) out[j] = { x: (anchor.x + p.x * scale) / aspect, y: anchor.y + p.y * scale, visibility: 1 };
    return out;
  });
}
export const placeOnPerson = (kp, norm, aspect) => placePeople([kp], norm.anchor, norm.scale, aspect)[0];

// Which joints are furthest from the target (to highlight).
export function worstJoints(cur, kp, k = 2) {
  return Object.keys(kp).map(Number)
    .filter((j) => cur[j])
    .map((j) => [j, Math.hypot(cur[j].x - kp[j].x, cur[j].y - kp[j].y)])
    .filter(([, d]) => d > 0.18)
    .sort((a, b) => b[1] - a[1]).slice(0, k).map(([j]) => j);
}

// ---- "Ghost in the frame": where a picked pose should sit before anyone is in it ----
// Returns { anchor, scale } in aspect-corrected units: the outline fills ~60% of
// the frame height, centred, in the upper part of the frame.
export function framePlacement(pose, aspect) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const kp of pose.people) for (const [j, p] of Object.entries(kp)) {
    const top = Number(j) === 0 ? p.y - 0.35 : p.y;
    minX = Math.min(minX, p.x - 0.15); maxX = Math.max(maxX, p.x + 0.15);
    minY = Math.min(minY, top); maxY = Math.max(maxY, p.y);
  }
  const H = 0.6, TOP = 0.12; // leaves room for the checklist at the bottom of the screen
  let scale = H / (maxY - minY);
  if ((maxX - minX) * scale > 0.9 * aspect) scale = (0.9 * aspect) / (maxX - minX);
  const anchor = { x: 0.5 * aspect - ((minX + maxX) / 2) * scale, y: TOP + (H - (maxY - minY) * scale) / 2 - minY * scale };
  return { anchor, scale };
}

// How well the people in view fill a frame-placed outline.
// phase: "enter" | "closer" | "back" | "shift" | "pose" | "matched"
export function fitToFrame(lms, aspect, pose, place) {
  const n = normalizeGroup(lms, aspect);
  const need = pose.people.length;
  if (!n || n.people.length < need) return { phase: "enter", people: pose.people };
  if (n.people.length > need) { n.people = n.people.slice(0, need); n.lms = n.lms.slice(0, need); n.own = n.own.slice(0, need); }
  const ratio = n.scale / place.scale;
  const off = { x: (n.anchor.x - place.anchor.x) / place.scale, y: (n.anchor.y - place.anchor.y) / place.scale };
  const joints = n.upperOnly ? UPPER : JOINTS;
  let people = pose.people, dist = groupDistance(n.people, people, joints);
  const m = mirrorGroup(pose.people), dm = groupDistance(n.people, m, joints);
  if (dm < dist) { people = m; dist = dm; }
  const base = { norm: n, people, dist, ratio, off };
  if (ratio < 0.8) return { ...base, phase: "closer" };
  if (ratio > 1.25) return { ...base, phase: "back" };
  if (Math.hypot(off.x, off.y) > 0.5) return { ...base, phase: "shift" };
  return { ...base, phase: isMatch(dist, n, people, joints) ? "matched" : "pose" };
}
