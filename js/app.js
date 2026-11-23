import { FilesetResolver, PoseLandmarker, FaceLandmarker } from "../vendor/mediapipe/vision_bundle.mjs";
import { poseMetrics, faceMetrics, computeMetrics, LightMeter, TiltSensor } from "./analyze.js";
import { RULES, CAT_LABEL, rank } from "./rules.js";

const $ = (id) => document.getElementById(id);
const WASM = new URL("../vendor/mediapipe/wasm", import.meta.url).href;
const POSE_MODEL = new URL("../models/pose_landmarker_lite.task", import.meta.url).href;
const FACE_MODEL = new URL("../models/face_landmarker.task", import.meta.url).href;

const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];

const S = {
  mode: "solo",
  facing: "environment",
  stream: null,
  pose: null, face: null,
  poseRes: null, faceRes: null,
  lastVideoTime: -1, lastDetect: 0, frame: 0,
  meter: new LightMeter(), lastLight: 0,
  tilt: new TiltSensor(),
  metrics: null,
  ruleState: new Map(), skipped: new Set(), active: [],
  tip: null, tipShownAt: 0, niceUntil: 0,
  score: null,
  voice: false, lastSpoken: "", lastSpeakAt: 0,
  goodSince: 0, countdownAt: 0, cooldownUntil: 0,
  photos: [], viewIdx: 0,
  running: false,
};

// ---------------- Start ----------------
$("start-btn").addEventListener("click", start);

async function start() {
  const btn = $("start-btn"), status = $("start-status");
  btn.disabled = true; status.className = "status";
  S.mode = document.querySelector('input[name="start-mode"]:checked').value;
  S.facing = S.mode === "solo" ? "environment" : "user";
  S.voice = S.mode === "solo";
  primeSpeech();
  S.tilt.start(); // asks for motion permission on iPhone; fine if refused

  try {
    status.textContent = "Opening camera…";
    await openCamera();
    status.textContent = "Loading the coach (about 25 MB the first time)…";
    await loadModels();
  } catch (e) {
    console.error(e);
    btn.disabled = false;
    status.className = "status err";
    status.textContent = e && e.name === "NotAllowedError"
      ? "Camera access was blocked. Allow the camera for this site in your browser settings, then try again."
      : e && e.name === "NotFoundError"
        ? "No camera found on this device."
        : "Couldn't start: " + (e && e.message ? e.message : e);
    stopCamera();
    return;
  }
  $("start").hidden = true;
  $("cam").hidden = false;
  setModeUI();
  setVoiceUI();
  resizeOverlay();
  S.running = true;
  requestAnimationFrame(loop);
}

async function loadModels() {
  const fileset = await FilesetResolver.forVisionTasks(WASM);
  const make = async (Cls, opts) => {
    try { return await Cls.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: "GPU" } }); }
    catch { return await Cls.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: "CPU" } }); }
  };
  [S.pose, S.face] = await Promise.all([
    make(PoseLandmarker, { baseOptions: { modelAssetPath: POSE_MODEL }, runningMode: "VIDEO", numPoses: 1 }),
    make(FaceLandmarker, { baseOptions: { modelAssetPath: FACE_MODEL }, runningMode: "VIDEO", numFaces: 6, outputFaceBlendshapes: true }),
  ]);
}

async function openCamera() {
  stopCamera();
  const video = $("video");
  S.stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: S.facing }, width: { ideal: 1920 }, height: { ideal: 1920 } },
  });
  video.srcObject = S.stream;
  await video.play().catch(() => {});
  if (!video.videoWidth) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
  const settings = S.stream.getVideoTracks()[0].getSettings();
  if (settings.facingMode) S.facing = settings.facingMode;
  $("cam").classList.toggle("mirror", S.facing === "user");
  S.lastVideoTime = -1;
}

function stopCamera() {
  if (S.stream) S.stream.getTracks().forEach((t) => t.stop());
  S.stream = null;
}

// ---------------- Mode / controls ----------------
document.querySelectorAll(".seg button").forEach((b) =>
  b.addEventListener("click", async () => {
    if (b.dataset.mode === S.mode) return;
    S.mode = b.dataset.mode;
    resetCoaching();
    setModeUI();
    const want = S.mode === "solo" ? "environment" : "user";
    if (want !== S.facing) { S.facing = want; await openCamera().catch(console.error); }
  }),
);
function setModeUI() {
  document.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === S.mode)));
}
$("flip-btn").addEventListener("click", async () => {
  S.facing = S.facing === "user" ? "environment" : "user";
  await openCamera().catch(console.error);
});
$("voice-btn").addEventListener("click", () => {
  S.voice = !S.voice;
  setVoiceUI();
  if (S.voice && S.tip) speak(S.tip.say, true);
  else if (!S.voice) window.speechSynthesis && speechSynthesis.cancel();
});
function setVoiceUI() { $("voice-btn").setAttribute("aria-pressed", String(S.voice)); }
$("tip-skip").addEventListener("click", () => {
  if (!S.tip) return;
  S.skipped.add(S.tip.id);
  S.tip = null;
  updateTip(performance.now());
});
$("shutter").addEventListener("click", () => capture());

function resetCoaching() {
  S.ruleState.clear(); S.skipped.clear(); S.active = [];
  S.tip = null; S.goodSince = 0; S.countdownAt = 0;
  S.poseRes = null; S.faceRes = null;
  hideCountdown();
}

// ---------------- Main loop ----------------
function loop() {
  if (!S.running) return;
  const video = $("video");
  const now = performance.now();
  if (video.readyState >= 2 && video.currentTime !== S.lastVideoTime && now - S.lastDetect >= 60) {
    S.lastVideoTime = video.currentTime;
    S.lastDetect = now;
    detect(video, now);
  }
  draw(now);
  requestAnimationFrame(loop);
}

function detect(video, now) {
  const usesPose = S.mode !== "group";
  S.frame++;
  try {
    if (usesPose && S.frame % 2 === 0) S.poseRes = S.pose.detectForVideo(video, now);
    else S.faceRes = S.face.detectForVideo(video, now);
  } catch (e) { console.warn(e); return; }
  if (now - S.lastLight > 250) { S.meter.update(video); S.lastLight = now; }

  const aspect = video.videoWidth / video.videoHeight;
  const pose = usesPose ? poseMetrics(S.poseRes && S.poseRes.landmarks && S.poseRes.landmarks[0], aspect) : null;
  let faces = faceMetrics(S.faceRes);
  if (S.mode !== "group" && faces.length > 1) faces = [faces.sort((a, b) => b.w - a.w)[0]];
  S.metrics = computeMetrics({ mode: S.mode, pose, faces, meter: S.meter, tilt: S.tilt.read() });
  evaluate(now);
}

// ---------------- Rules → tip ----------------
function evaluate(now) {
  const m = S.metrics;
  const active = [];
  for (const r of RULES) {
    if (!r.modes.includes(S.mode)) continue;
    let fail = false;
    try { fail = !!r.test(m); } catch { fail = false; }
    const st = S.ruleState.get(r.id) || { fail: 0, pass: 0, on: false };
    if (fail) { st.fail++; st.pass = 0; if (st.fail >= 3) st.on = true; }
    else { st.pass++; st.fail = 0; if (st.pass >= 4) st.on = false; }
    S.ruleState.set(r.id, st);
    if (st.on) active.push(r);
  }
  active.sort((a, b) => rank(a) - rank(b));
  S.active = active;

  const penalty = active.reduce((s, r) => s + r.w, 0);
  const target = Math.max(0, 100 - penalty);
  S.score = S.score == null ? target : S.score + (target - S.score) * 0.25;

  updateTip(now);
  updateAutoCapture(now);
  renderHud();
}

function updateTip(now) {
  const open = S.active.filter((r) => !S.skipped.has(r.id));
  const best = open[0] || null;
  const cur = S.tip;
  if (cur) {
    const stillOn = open.includes(cur);
    if (!stillOn) {
      if (!S.skipped.has(cur.id)) S.niceUntil = now + 900;
      setTip(best, now);
    } else if (best && best !== cur && now - S.tipShownAt > 2000 && rank(best) < rank(cur)) {
      setTip(best, now);
    }
  } else if (best && now > S.niceUntil) {
    setTip(best, now);
  }
}

function setTip(rule, now) {
  S.tip = rule; S.tipShownAt = now;
  if (rule) speak(rule.say);
}

function renderHud() {
  const now = performance.now();
  const tip = $("tip");
  const score = Math.round(S.score ?? 0);
  if (now < S.niceUntil) {
    tip.className = "tip nice";
    $("tip-who").textContent = "✓ Nice";
    $("tip-cat").textContent = "";
    $("tip-say").textContent = "That's fixed";
    $("tip-why").textContent = "";
    $("tip-skip").hidden = true;
  } else if (S.tip) {
    tip.className = "tip";
    $("tip-who").textContent = S.tip.who[S.mode] || "";
    $("tip-cat").textContent = CAT_LABEL[S.tip.cat];
    $("tip-say").textContent = S.tip.say;
    $("tip-why").textContent = S.tip.why;
    $("tip-skip").hidden = false;
  } else {
    tip.className = "tip good";
    $("tip-who").textContent = "Looking good";
    $("tip-cat").textContent = "";
    $("tip-say").textContent = $("auto-cap").checked ? "Hold still…" : "Take the shot";
    $("tip-why").textContent = S.skipped.size ? `${S.skipped.size} skipped tip${S.skipped.size > 1 ? "s" : ""} hidden` : "";
    $("tip-skip").hidden = true;
  }
  const C = 125.66;
  $("ring-fill").style.strokeDashoffset = String(C * (1 - score / 100));
  $("ring-fill").style.stroke = score >= 85 ? "var(--ok)" : "var(--accent)";
  $("score").textContent = String(score);
}

// ---------------- Auto-capture ----------------
function updateAutoCapture(now) {
  const auto = $("auto-cap").checked;
  const blocking = S.active.some((r) => r.cat === "framing" || r.id === "eyes_closed");
  const ready = auto && S.metrics.present && !blocking && (S.score ?? 0) >= 85 && now > S.cooldownUntil;
  $("shutter").classList.toggle("armed", ready);
  if (!ready) { S.goodSince = 0; if (S.countdownAt) { S.countdownAt = 0; hideCountdown(); } return; }
  if (!S.goodSince) S.goodSince = now;
  if (!S.countdownAt && now - S.goodSince > 600) S.countdownAt = now;
  if (S.countdownAt) {
    const left = 3 - Math.floor((now - S.countdownAt) / 1000);
    if (left <= 0) { hideCountdown(); S.countdownAt = 0; S.goodSince = 0; capture(); }
    else showCountdown(left);
  }
}
function showCountdown(n) { const el = $("countdown"); el.hidden = false; el.textContent = String(n); }
function hideCountdown() { $("countdown").hidden = true; }

// ---------------- Capture & photos ----------------
function capture() {
  const video = $("video");
  if (!video.videoWidth) return;
  S.cooldownUntil = performance.now() + 4000;
  const c = document.createElement("canvas");
  c.width = video.videoWidth; c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  const f = $("flash"); f.classList.remove("go"); void f.offsetWidth; f.classList.add("go");
  const score = Math.round(S.score ?? 0);
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    S.photos.push({ blob, url, score, mode: S.mode, at: new Date() });
    renderGalleryBtn();
  }, "image/jpeg", 0.92);
}

function renderGalleryBtn() {
  const btn = $("gallery-btn");
  const last = S.photos[S.photos.length - 1];
  btn.style.backgroundImage = last ? `url("${last.url}")` : "";
  btn.disabled = !last;
  $("gallery-count").textContent = S.photos.length ? String(S.photos.length) : "";
}
renderGalleryBtn();

$("gallery-btn").addEventListener("click", () => { if (S.photos.length) openViewer(S.photos.length - 1); });
$("viewer-close").addEventListener("click", closeViewer);
$("viewer-delete").addEventListener("click", () => {
  const p = S.photos[S.viewIdx];
  if (!p) return;
  URL.revokeObjectURL(p.url);
  S.photos.splice(S.viewIdx, 1);
  renderGalleryBtn();
  if (!S.photos.length) closeViewer(); else openViewer(Math.min(S.viewIdx, S.photos.length - 1));
});
$("viewer-save").addEventListener("click", async () => {
  const p = S.photos[S.viewIdx];
  if (!p) return;
  const name = `pose-coach-${p.at.toISOString().replace(/[:.]/g, "-")}.jpg`;
  const file = new File([p.blob], name, { type: "image/jpeg" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  const a = document.createElement("a");
  a.href = p.url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
});

function openViewer(i) {
  S.viewIdx = i;
  const p = S.photos[i];
  $("viewer-img").src = p.url;
  $("viewer-meta").textContent = `Score ${p.score} · ${p.mode === "group" ? "Group" : p.mode === "selfie" ? "Selfie" : "Solo"} · ${i + 1} of ${S.photos.length}`;
  const strip = $("viewer-strip"); strip.innerHTML = "";
  S.photos.forEach((ph, j) => {
    const b = document.createElement("button");
    b.type = "button"; b.style.backgroundImage = `url("${ph.url}")`;
    b.setAttribute("aria-label", `Photo ${j + 1}, score ${ph.score}`);
    if (j === i) b.setAttribute("aria-current", "true");
    b.addEventListener("click", () => openViewer(j));
    strip.appendChild(b);
  });
  $("viewer").hidden = false;
}
function closeViewer() { $("viewer").hidden = true; }

// ---------------- Speech (built into the phone, free) ----------------
function primeSpeech() {
  try { if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {}
}
function speak(text, force) {
  if (!S.voice || !window.speechSynthesis) return;
  const now = performance.now();
  if (!force && (text === S.lastSpoken && now - S.lastSpeakAt < 8000)) return;
  if (!force && now - S.lastSpeakAt < 2500) return;
  S.lastSpoken = text; S.lastSpeakAt = now;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05;
  speechSynthesis.speak(u);
}

// ---------------- Drawing ----------------
const overlay = $("overlay");
const ctx = overlay.getContext("2d");
function resizeOverlay() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  overlay.width = Math.round(overlay.clientWidth * dpr);
  overlay.height = Math.round(overlay.clientHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeOverlay);

// Where the video actually sits inside the element (object-fit: contain).
function contentRect() {
  const v = $("video"), W = overlay.clientWidth, H = overlay.clientHeight;
  const vw = v.videoWidth || 1, vh = v.videoHeight || 1;
  const s = Math.min(W / vw, H / vh);
  const w = vw * s, h = vh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function draw(now) {
  const W = overlay.clientWidth, H = overlay.clientHeight;
  ctx.clearRect(0, 0, W, H);
  const r = contentRect();
  const mirror = S.facing === "user";
  const P = (nx, ny) => [r.x + (mirror ? 1 - nx : nx) * r.w, r.y + ny * r.h];

  // Thirds grid
  ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1;
  ctx.beginPath();
  for (const t of [1 / 3, 2 / 3]) {
    ctx.moveTo(r.x + r.w * t, r.y); ctx.lineTo(r.x + r.w * t, r.y + r.h);
    ctx.moveTo(r.x, r.y + r.h * t); ctx.lineTo(r.x + r.w, r.y + r.h * t);
  }
  ctx.stroke();

  const m = S.metrics;
  // Skeleton
  if (m && m.pose) {
    const lm = m.pose.lm;
    ctx.strokeStyle = "rgba(255,255,255,0.55)"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
    ctx.beginPath();
    for (const [a, b] of SKELETON) {
      if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) continue;
      ctx.moveTo(...P(lm[a].x, lm[a].y)); ctx.lineTo(...P(lm[b].x, lm[b].y));
    }
    ctx.stroke();
  }
  // Face brackets (group and selfie)
  if (m && S.mode !== "solo") {
    for (const f of m.faces) {
      const [ax, ay] = P(f.box.x0, f.box.y0), [bx, by] = P(f.box.x1, f.box.y1);
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = ay, y1 = by, k = Math.min(16, (x1 - x0) / 4);
      ctx.strokeStyle = f.blink > 0.55 ? "#f0a04b" : "rgba(255,255,255,0.75)"; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + k); ctx.lineTo(x0, y0); ctx.lineTo(x0 + k, y0);
      ctx.moveTo(x1 - k, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + k);
      ctx.moveTo(x1, y1 - k); ctx.lineTo(x1, y1); ctx.lineTo(x1 - k, y1);
      ctx.moveTo(x0 + k, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - k);
      ctx.stroke();
    }
  }
  // Target marker for the current tip
  if (m && S.tip && S.tip.target) {
    let t = null;
    try { t = S.tip.target(m); } catch {}
    if (t && isFinite(t.x) && isFinite(t.y)) {
      const [x, y] = P(Math.min(1, Math.max(0, t.x)), Math.min(1, Math.max(0, t.y)));
      const pulse = 1 + 0.15 * Math.sin(now / 180);
      ctx.fillStyle = "rgba(240,160,75,0.25)";
      ctx.beginPath(); ctx.arc(x, y, 26 * pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#f0a04b";
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
    }
  }
  // Level indicator
  const tilt = S.tilt.read();
  if (tilt) {
    const cx = W / 2, cy = H / 2, len = Math.min(W, H) * 0.18;
    const level = Math.abs(tilt.roll) < 2;
    ctx.save(); ctx.translate(cx, cy);
    ctx.strokeStyle = "rgba(255,255,255,0.35)"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-len - 14, 0); ctx.lineTo(-len, 0); ctx.moveTo(len, 0); ctx.lineTo(len + 14, 0); ctx.stroke();
    ctx.rotate((-tilt.roll * Math.PI) / 180);
    ctx.strokeStyle = level ? "#5cc48a" : "rgba(255,255,255,0.9)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
    ctx.restore();
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && window.speechSynthesis) speechSynthesis.cancel();
});
