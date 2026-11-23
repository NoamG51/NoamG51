// Turns raw MediaPipe results, a light sample and the phone's tilt into
// simple numbers the rules can check. All coordinates are normalized 0–1
// in the camera frame (not mirrored).

const seen = (p, t = 0.5) =>
  !!p && (p.visibility ?? 1) >= t && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;

// Angle at b (degrees) for the joint a-b-c, correcting for the frame's aspect.
function angleAt(a, b, c, aspect) {
  const v1x = (a.x - b.x) * aspect, v1y = a.y - b.y;
  const v2x = (c.x - b.x) * aspect, v2y = c.y - b.y;
  const m = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!m) return 180;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / m));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function poseMetrics(lm, aspect) {
  if (!lm || lm.length < 29) return null;
  const g = (i) => lm[i];
  const lSh = g(11), rSh = g(12), nose = g(0);
  if (!seen(lSh, 0.5) || !seen(rSh, 0.5)) return null;

  const shMid = { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2 };
  const hipsSeen = seen(g(23), 0.5) && seen(g(24), 0.5);
  const hipMid = hipsSeen ? { x: (g(23).x + g(24).x) / 2, y: (g(23).y + g(24).y) / 2 } : null;
  const shW = Math.hypot((lSh.x - rSh.x) * aspect, lSh.y - rSh.y);

  // Head: estimated from nose-to-shoulder distance.
  const d = Math.max(0.01, shMid.y - nose.y);
  const headTop = nose.y - 0.65 * d;
  const headW = Math.max(0.02, (shW * 0.5) / aspect);
  const headBox = { x0: nose.x - headW / 2, x1: nose.x + headW / 2, y0: headTop, y1: nose.y + d * 0.35 };

  const anklesSeen = seen(g(27), 0.5) && seen(g(28), 0.5);
  const fullBody = anklesSeen && g(27).y < 0.99 && g(28).y < 0.99;
  const kneeCut = !anklesSeen && [g(25), g(26)].some((k) => (k.visibility ?? 1) > 0.5 && k.y > 0.88 && k.y < 1.04);
  const ankleCut = !fullBody && [g(27), g(28)].some((a) => (a.visibility ?? 1) > 0.4 && a.y > 0.96 && a.y < 1.06);

  const armStraight = (right) => {
    const s = g(right ? 12 : 11), e = g(right ? 14 : 13), w = g(right ? 16 : 15);
    if (!seen(e, 0.5) || !seen(w, 0.5)) return false;
    const down = w.y > e.y && e.y > s.y;
    const nearBody = hipMid ? Math.abs(w.x - hipMid.x) * aspect < shW * 0.95 : true;
    return angleAt(s, e, w, aspect) > 158 && down && nearBody;
  };
  const armsStraight = armStraight(false) && armStraight(true);

  let square;
  if (hipMid) {
    const torso = Math.max(0.01, hipMid.y - shMid.y);
    square = shW / torso > 0.72; // ~0.8 facing the camera, ~0.65 when turned 30°
  } else {
    const zd = Math.abs((lSh.z ?? 0) - (rSh.z ?? 0));
    square = zd / Math.max(shW, 0.01) < 0.1;
  }

  let lockedLegs = false;
  if (fullBody && hipsSeen) {
    const kl = angleAt(g(23), g(25), g(27), aspect);
    const kr = angleAt(g(24), g(26), g(28), aspect);
    lockedLegs = kl > 171 && kr > 171 && Math.abs(g(27).y - g(28).y) < 0.025 && Math.abs(g(23).y - g(24).y) < 0.02;
  }

  const cx = hipMid ? (shMid.x + hipMid.x) / 2 : shMid.x;
  return { nose, shMid, hipMid, headTop, headBox, fullBody, kneeCut, ankleCut, armsStraight, square, lockedLegs, cx, lm };
}

export function faceMetrics(res) {
  if (!res || !res.faceLandmarks) return [];
  return res.faceLandmarks.map((lm, i) => {
    let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
    for (const p of lm) {
      if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
    }
    // Landmarks stop at the hairline; extend the box up to roughly the top of the head.
    const h = y1 - y0;
    const box = { x0, y0: y0 - h * 0.25, x1, y1 };
    let blink = 0;
    const cats = res.faceBlendshapes && res.faceBlendshapes[i] && res.faceBlendshapes[i].categories;
    if (cats) for (const c of cats) if (c.categoryName === "eyeBlinkLeft" || c.categoryName === "eyeBlinkRight") blink = Math.max(blink, c.score);
    return {
      box, w: x1 - x0, h: box.y1 - box.y0,
      cx: (x0 + x1) / 2, cy: (box.y0 + box.y1) / 2,
      eyeY: (lm[33].y + lm[263].y) / 2,
      blink,
    };
  });
}

// Keeps a tiny grayscale copy of the frame for light readings.
export class LightMeter {
  constructor() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.lum = null; this.w = 0; this.h = 0;
  }
  update(video) {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const w = 64, h = Math.max(1, Math.round((64 * vh) / vw));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.ctx.drawImage(video, 0, 0, w, h);
    const d = this.ctx.getImageData(0, 0, w, h).data;
    const lum = new Float32Array(w * h);
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    this.lum = lum; this.w = w; this.h = h;
  }
  mean(box) {
    if (!this.lum) return null;
    const { w, h, lum } = this;
    const x0 = Math.max(0, Math.floor(box.x0 * w)), x1 = Math.min(w, Math.ceil(box.x1 * w));
    const y0 = Math.max(0, Math.floor(box.y0 * h)), y1 = Math.min(h, Math.ceil(box.y1 * h));
    let s = 0, n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { s += lum[y * w + x]; n++; }
    return n ? s / n : null;
  }
  meanOutside(boxes) {
    if (!this.lum) return null;
    const { w, h, lum } = this;
    let s = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x + 0.5) / w, ny = (y + 0.5) / h;
      if (boxes.some((b) => nx >= b.x0 && nx <= b.x1 && ny >= b.y0 && ny <= b.y1)) continue;
      s += lum[y * w + x]; n++;
    }
    return n ? s / n : null;
  }
}

const grow = (b, k) => {
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, hw = ((b.x1 - b.x0) / 2) * k, hh = ((b.y1 - b.y0) / 2) * k;
  return { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh };
};

export function computeMetrics({ mode, pose, faces, meter, tilt, aspect = 1 }) {
  const sorted = faces.slice().sort((a, b) => b.w - a.w);
  const mainFace = sorted[0] || null;
  const subjectBox = mainFace ? mainFace.box : pose ? pose.headBox : null;

  const light = { face: null, bg: null, side: 0, perFace: [] };
  if (subjectBox && meter.lum) {
    light.face = meter.mean(subjectBox);
    const excl = (faces.length ? faces.map((f) => grow(f.box, 1.6)) : [grow(subjectBox, 1.6)]);
    light.bg = meter.meanOutside(excl);
    const midX = (subjectBox.x0 + subjectBox.x1) / 2;
    const inner = { y0: subjectBox.y0 + (subjectBox.y1 - subjectBox.y0) * 0.25, y1: subjectBox.y1 };
    const L = meter.mean({ x0: subjectBox.x0, x1: midX, ...inner });
    const R = meter.mean({ x0: midX, x1: subjectBox.x1, ...inner });
    if (L != null && R != null && L + R > 0.05) light.side = Math.abs(L - R) / (L + R);
    light.perFace = faces.map((f) => meter.mean(f.box));
  }

  const group = { edge: false, edgeFace: null, sizeRatio: 1, biggest: null, gap: false, gapAt: null, darkest: null, lumRatio: 1 };
  if (faces.length >= 2) {
    const byX = faces.slice().sort((a, b) => a.cx - b.cx);
    for (const f of faces) if (f.box.x0 < 0.04 || f.box.x1 > 0.96 || f.box.y0 < 0.02) { group.edge = true; group.edgeFace = f; }
    const ws = faces.map((f) => f.w);
    group.sizeRatio = Math.max(...ws) / Math.max(0.001, Math.min(...ws));
    group.biggest = sorted[0];
    const avgW = ws.reduce((a, b) => a + b, 0) / ws.length;
    for (let i = 1; i < byX.length; i++) {
      const gap = byX[i].box.x0 - byX[i - 1].box.x1;
      if (gap > avgW * 1.2) { group.gap = true; group.gapAt = { x: (byX[i].box.x0 + byX[i - 1].box.x1) / 2, y: (byX[i].cy + byX[i - 1].cy) / 2 }; }
    }
    const lums = light.perFace.filter((v) => v != null);
    if (lums.length >= 2) {
      group.lumRatio = Math.max(...lums) / Math.max(0.02, Math.min(...lums));
      const di = light.perFace.indexOf(Math.min(...lums));
      group.darkest = faces[di] || null;
    }
  } else if (faces.length === 1) {
    const f = faces[0];
    if (f.box.x0 < 0.04 || f.box.x1 > 0.96 || f.box.y0 < 0.02) { group.edge = true; group.edgeFace = f; }
  }

  const anyBlink = faces.some((f) => f.blink > 0.55);
  return { mode, aspect, pose, faces, mainFace, light, group, tilt, anyBlink, present: !!(pose || faces.length) };
}

// Phone tilt from the motion sensor. iOS reports gravity with the opposite
// sign to Android, so flip it to one convention.
export class TiltSensor {
  constructor() {
    this.roll = null; this.pitch = null; this.gx = 0; this.gy = 0; this.gz = 0; this.ready = false;
    this.flip = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) ? -1 : 1;
    this.onMotion = this.onMotion.bind(this);
  }
  async start() {
    try {
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        const r = await DeviceMotionEvent.requestPermission();
        if (r !== "granted") return false;
      }
      window.addEventListener("devicemotion", this.onMotion);
      return true;
    } catch { return false; }
  }
  onMotion(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const k = 0.15; // low-pass filter
    this.gx += (a.x * this.flip - this.gx) * k;
    this.gy += (a.y * this.flip - this.gy) * k;
    this.gz += (a.z * this.flip - this.gz) * k;
    const mag = Math.hypot(this.gx, this.gy, this.gz);
    if (mag < 5) return;
    // Portrait use only: roll = rotation in the screen plane, pitch = top of phone tipping back (+) or forward (-).
    this.roll = (Math.atan2(this.gx, this.gy) * 180) / Math.PI;
    this.pitch = (Math.atan2(this.gz, Math.hypot(this.gx, this.gy)) * 180) / Math.PI;
    this.ready = Math.abs(this.roll) < 45; // ignore when held sideways
  }
  read() { return this.ready ? { roll: this.roll, pitch: this.pitch } : null; }
}
