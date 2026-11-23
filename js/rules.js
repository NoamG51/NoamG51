// The coaching rulebook. Each rule checks the metrics from analyze.js.
//   modes: which shot types it applies to
//   cat:   framing | lighting | angle | pose | polish (fixed in that order)
//   pri:   order within the category (lower first)
//   w:     points taken off the score while the problem is showing
//   who:   who has to act, per mode
//   target(m): optional {x, y} to point at on screen
//   ghost(m):  optional outline to match (see ghost.js)
//
// Thresholds are first guesses. Tune them after trying the app.

import * as G from "./ghost.js";

export const CAT_ORDER = ["framing", "lighting", "angle", "pose", "polish"];
export const CAT_LABEL = { framing: "Framing", lighting: "Lighting", angle: "Angle", pose: "Pose", polish: "Polish" };

const ALL = ["solo", "selfie", "group"];
const PHOTOGRAPHER = { solo: "Photographer", selfie: "You", group: "Phone holder" };
const SUBJECT = { solo: "Subject", selfie: "You", group: "Everyone" };

const headTarget = (m) => (m.mainFace ? { x: m.mainFace.cx, y: m.mainFace.cy } : m.pose ? { x: m.pose.nose.x, y: m.pose.nose.y } : null);

export const RULES = [
  // ---------- Framing ----------
  {
    id: "no_person", modes: ["solo"], cat: "framing", pri: 0, w: 60, who: PHOTOGRAPHER,
    test: (m) => !m.present,
    say: "Get the person in the frame", why: "I can't see anyone yet. Show at least head and shoulders.",
  },
  {
    id: "no_face", modes: ["selfie", "group"], cat: "framing", pri: 0, w: 60, who: PHOTOGRAPHER,
    test: (m) => m.faces.length === 0,
    say: "Bring your face into the frame", why: "I can't see a face yet.",
  },
  {
    id: "level", modes: ALL, cat: "framing", pri: 5, w: 10, who: PHOTOGRAPHER,
    test: (m) => m.tilt && Math.abs(m.tilt.roll) > 4,
    say: "Level the phone", why: "Turn the phone until the line in the middle sits on the marks.",
  },
  {
    id: "head_cut", modes: ["solo"], cat: "framing", pri: 10, w: 20, who: PHOTOGRAPHER,
    test: (m) => m.pose && m.pose.headTop < 0.02,
    target: (m) => ({ x: m.pose.nose.x, y: 0.04 }),
    ghost: G.lowerHead,
    say: "Leave space above the head", why: "The top of the head is cut off. Tilt up a little or step back.",
  },
  {
    id: "edge_face", modes: ["selfie", "group"], cat: "framing", pri: 10, w: 20, who: SUBJECT,
    test: (m) => m.group.edge,
    target: (m) => ({ x: m.group.edgeFace.cx, y: m.group.edgeFace.cy }),
    ghost: G.faceInward,
    say: "Move in from the edge", why: "Faces near the edge get cut off and stretched by the wide lens.",
  },
  {
    id: "knee_crop", modes: ["solo"], cat: "framing", pri: 20, w: 12, who: PHOTOGRAPHER,
    test: (m) => m.pose && (m.pose.kneeCut || m.pose.ankleCut),
    target: () => ({ x: 0.5, y: 0.95 }),
    say: "Don't crop at the knees or feet", why: "Cutting at a joint looks like a mistake. Show the whole feet, or crop mid-thigh.",
  },
  {
    id: "group_gap", modes: ["group"], cat: "framing", pri: 30, w: 10, who: SUBJECT,
    test: (m) => m.group.gap,
    target: (m) => m.group.gapAt,
    say: "Squeeze in, close the gap", why: "There's empty space between people. Get shoulder to shoulder.",
  },
  {
    id: "too_much_sky", modes: ["solo"], cat: "framing", pri: 40, w: 6, who: PHOTOGRAPHER,
    test: (m) => m.pose && m.pose.fullBody && m.pose.headTop > 0.3,
    target: () => ({ x: 0.5, y: 0.12 }),
    ghost: G.raiseBody,
    say: "Tilt down or step closer", why: "There's a lot of empty space above the head.",
  },

  // ---------- Lighting ----------
  {
    id: "backlit", modes: ALL, cat: "lighting", pri: 0, w: 20, who: SUBJECT,
    test: (m) => m.light.face != null && m.light.bg != null && m.light.bg > 0.5 && m.light.face < m.light.bg * 0.58,
    target: headTarget,
    say: "Turn to face the light", why: "The light is behind you, so your face is dark. Turn so the light hits your face.",
  },
  {
    id: "too_dark", modes: ALL, cat: "lighting", pri: 10, w: 15, who: SUBJECT,
    test: (m) => m.light.face != null && m.light.face < 0.2,
    target: headTarget,
    say: "Move toward a window or light", why: "The face is too dark to look good.",
  },
  {
    id: "too_bright", modes: ALL, cat: "lighting", pri: 20, w: 12, who: SUBJECT,
    test: (m) => m.light.face != null && m.light.face > 0.9,
    target: headTarget,
    say: "Step into the shade", why: "The face is washed out by harsh light.",
  },
  {
    id: "side_shadow", modes: ["solo", "selfie"], cat: "lighting", pri: 30, w: 8, who: SUBJECT,
    test: (m) => m.light.side > 0.33 && m.light.face != null && m.light.face > 0.15,
    target: headTarget,
    say: "Turn a little toward the light", why: "One side of the face is in deep shadow.",
  },
  {
    id: "group_uneven", modes: ["group"], cat: "lighting", pri: 30, w: 10, who: SUBJECT,
    test: (m) => m.faces.length >= 2 && m.group.lumRatio > 1.7,
    target: (m) => m.group.darkest && { x: m.group.darkest.cx, y: m.group.darkest.cy },
    say: "Rotate the group toward the light", why: "Someone's face is in shadow. Turn together until everyone is lit evenly.",
  },

  // ---------- Angle ----------
  {
    id: "solo_high_angle", modes: ["solo"], cat: "angle", pri: 0, w: 12, who: PHOTOGRAPHER,
    test: (m) => m.tilt && m.pose && m.pose.fullBody && m.tilt.pitch > 10,
    say: "Lower the phone to waist height", why: "Pointing down from chest height makes legs look shorter. Hold it lower and tilt slightly up.",
  },
  {
    id: "from_below", modes: ["selfie", "group"], cat: "angle", pri: 0, w: 15, who: PHOTOGRAPHER,
    test: (m) => m.tilt && m.tilt.pitch > 8,
    say: "Raise the phone above eye level", why: "Shooting from below the chin is the least flattering angle. Hold it higher and tilt it down a little.",
  },
  {
    id: "selfie_close", modes: ["selfie"], cat: "angle", pri: 10, w: 12, who: PHOTOGRAPHER,
    test: (m) => m.mainFace && m.mainFace.w > 0.55,
    target: headTarget,
    ghost: G.faceSize,
    say: "Hold the phone at arm's length", why: "Too close with the front lens makes the nose look bigger.",
  },
  {
    id: "selfie_far", modes: ["selfie"], cat: "angle", pri: 20, w: 6, who: PHOTOGRAPHER,
    test: (m) => m.mainFace && m.mainFace.w < 0.18,
    target: headTarget,
    ghost: G.faceSize,
    say: "Bring the phone a bit closer", why: "Your face is small in the frame.",
  },
  {
    id: "eyes_low", modes: ["selfie"], cat: "angle", pri: 30, w: 8, who: PHOTOGRAPHER,
    test: (m) => m.mainFace && m.mainFace.eyeY > 0.55,
    target: (m) => ({ x: m.mainFace.cx, y: 0.36 }),
    ghost: G.faceToThird,
    say: "Raise the phone a little", why: "Your eyes should sit near the upper grid line.",
  },
  {
    id: "eyes_high", modes: ["selfie"], cat: "angle", pri: 30, w: 6, who: PHOTOGRAPHER,
    test: (m) => m.mainFace && m.mainFace.box.y0 < 0.03,
    target: (m) => ({ x: m.mainFace.cx, y: 0.05 }),
    ghost: G.faceDown,
    say: "Lower the phone a little", why: "Leave a bit of space above your head.",
  },
  {
    id: "group_sizes", modes: ["group"], cat: "angle", pri: 20, w: 8, who: SUBJECT,
    test: (m) => m.faces.length >= 2 && m.group.sizeRatio > 1.6,
    target: (m) => ({ x: m.group.biggest.cx, y: m.group.biggest.cy }),
    say: "Closest person, lean back a little", why: "One face is much bigger than the others. The marked person is too close to the lens.",
  },
  {
    id: "group_lens", modes: ["group"], cat: "angle", pri: 40, w: 4, who: PHOTOGRAPHER,
    test: (m) => m.faces.length >= 5 && m.group.edge,
    say: "Switch to 0.5x and hold it higher", why: "A big group fits better with the wide lens from above.",
  },

  // ---------- Pose ----------
  {
    id: "arms_straight", modes: ["solo"], cat: "pose", pri: 0, w: 10, who: SUBJECT,
    test: (m) => m.pose && m.pose.armsStraight,
    target: (m) => m.pose.hipMid || m.pose.shMid,
    ghost: G.bendArm,
    say: "Bring your hand to your hip", why: "Arms hanging straight down look stiff. Anything that bends should bend.",
  },
  {
    id: "square_on", modes: ["solo"], cat: "pose", pri: 10, w: 8, who: SUBJECT,
    test: (m) => m.pose && m.pose.hipMid && m.pose.square,
    target: (m) => m.pose.shMid,
    ghost: G.turnBody,
    say: "Turn your body a little", why: "About 30° away from the camera. Keep your face toward it.",
  },
  {
    id: "selfie_square", modes: ["selfie"], cat: "pose", pri: 10, w: 5, who: SUBJECT,
    test: (m) => m.pose && !m.pose.hipMid && m.pose.square,
    target: (m) => m.pose.shMid,
    ghost: G.turnBody,
    say: "Angle your shoulders slightly", why: "A slight turn looks slimmer and more natural. Keep your face to the camera.",
  },
  {
    id: "locked_legs", modes: ["solo"], cat: "pose", pri: 20, w: 8, who: SUBJECT,
    test: (m) => m.pose && m.pose.lockedLegs,
    target: (m) => m.pose.hipMid,
    ghost: G.bendKnee,
    say: "Bend your front knee", why: "Put your weight on your back leg. Locked, even legs look stiff.",
  },

  // ---------- Polish ----------
  {
    id: "eyes_closed", modes: ALL, cat: "polish", pri: 0, w: 6, who: SUBJECT,
    test: (m) => m.anyBlink,
    say: "Eyes open!", why: "Someone's eyes are closed.",
  },
  {
    id: "thirds", modes: ["solo"], cat: "polish", pri: 10, w: 4, who: PHOTOGRAPHER,
    test: (m) => m.pose && Math.abs(m.pose.cx - 0.5) < 0.07,
    target: (m) => ({ x: m.pose.cx < 0.5 ? 1 / 3 : 2 / 3, y: 0.5 }),
    ghost: G.toThirds,
    say: "Line up with a side grid line", why: "Slightly off-center usually looks more natural than dead center.",
  },
];

export function rank(rule) {
  return CAT_ORDER.indexOf(rule.cat) * 100 + rule.pri;
}
