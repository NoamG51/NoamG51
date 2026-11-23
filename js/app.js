import { FilesetResolver, PoseLandmarker, FaceLandmarker } from "../vendor/mediapipe/vision_bundle.mjs";
import { poseMetrics, faceMetrics, computeMetrics, LightMeter, TiltSensor } from "./analyze.js";
import { RULES, CAT_LABEL, rank } from "./rules.js";
import { SKELETON } from "./ghost.js";
import { Quest, FIX_XP, FIX_CHEER, QUEST_NAME } from "./quest.js";

const $ = (id) => document.getElementById(id);
const WASM = new URL("../vendor/mediapipe/wasm", import.meta.url).href;
const POSE_MODEL = new URL("../models/pose_landmarker_lite.task", import.meta.url).href;
const FACE_MODEL = new URL("../models/face_landmarker.task", import.meta.url).href;

const JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];

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
  auto: true,
  quest: new Quest(),
  questItems: new Map(), // rule id -> { rule, done, doneAt, xp }
};
const GATE = new Set(["no_person", "no_face"]); // must clear first; not part of the checklist

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
  renderPlayer();
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
    renderPlayer();
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
  S.questItems.delete(S.tip.id);
  S.tip = null;
  updateTip(performance.now());
});
$("shutter").addEventListener("click", () => capture());

$("auto-btn").addEventListener("click", () => {
  S.auto = !S.auto;
  $("auto-btn").setAttribute("aria-pressed", String(S.auto));
});

function resetCoaching() {
  S.ruleState.clear(); S.skipped.clear(); S.active = []; S.questItems.clear();
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
  S.metrics = computeMetrics({ mode: S.mode, pose, faces, meter: S.meter, tilt: S.tilt.read(), aspect });
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
  trackQuest(active, now);

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
  const score = Math.round(S.score ?? 0);
  $("score").textContent = String(score);
  $("shutter").setAttribute("aria-label", `Take photo. Score ${score}`);
  renderQuest();
}

// ---------------- Quest (game layer) ----------------
function trackQuest(active, now) {
  const ids = new Set(active.map((r) => r.id));
  for (const r of active) {
    if (GATE.has(r.id) || S.skipped.has(r.id)) continue;
    const q = S.questItems.get(r.id);
    if (!q) S.questItems.set(r.id, { rule: r, done: false, doneAt: 0, xp: 0 });
    else if (q.done) q.done = false;            // came back: open again, no extra XP later
  }
  for (const [id, q] of S.questItems) {
    if (q.done || ids.has(id)) continue;
    q.done = true; q.doneAt = now;
    if (!q.xp) {
      q.xp = FIX_XP[q.rule.cat] || 5;
      const lv = S.quest.addXP(q.xp);
      toast(`+${q.xp} XP · ${FIX_CHEER[q.rule.cat]}`);
      if (lv) toast(`Level ${lv} · ${S.quest.title}!`, true);
      renderPlayer();
    }
  }
}

let questSig = "";
function renderQuest() {
  const items = [...S.questItems.values()];
  const done = items.filter((q) => q.done).sort((a, b) => a.doneAt - b.doneAt);
  const open = items.filter((q) => !q.done).sort((a, b) => rank(a.rule) - rank(b.rule));
  const gate = S.active.find((r) => GATE.has(r.id));
  const now = S.tip && open.find((q) => q.rule === S.tip);

  const rows = [];
  if (gate) rows.push({ kind: "hint", text: gate.id === "no_face" ? "Get your face in the frame to start the quest" : "Get someone in the frame to start the quest" });
  else {
    done.slice(-1).forEach((q) => rows.push({ kind: "done", text: q.rule.say, pts: `+${q.xp}` }));
    if (now) rows.push({ kind: "now", text: now.rule.say, why: now.rule.why, pts: `+${FIX_XP[now.rule.cat] || 5}` });
    open.filter((q) => q !== now).slice(0, now ? 1 : 2).forEach((q) => rows.push({ kind: "open", text: q.rule.say, pts: `+${FIX_XP[q.rule.cat] || 5}` }));
    if (!open.length) rows.push({ kind: "clear", text: S.auto ? "All clear! Hold still…" : "All clear! Take the shot" });
  }
  const count = gate ? "" : `${done.length} / ${items.length}`;
  const sig = JSON.stringify([QUEST_NAME[S.mode], count, rows]);
  if (sig === questSig) return;
  questSig = sig;

  $("quest-name").textContent = `Quest: ${QUEST_NAME[S.mode]}`;
  $("quest-count").textContent = count;
  const ul = $("quest-list"); ul.innerHTML = "";
  for (const r of rows) {
    const li = document.createElement("li");
    li.className = r.kind;
    if (r.kind === "hint" || r.kind === "clear") { li.textContent = r.text; ul.appendChild(li); continue; }
    const box = document.createElement("span"); box.className = "box"; box.textContent = r.kind === "done" ? "✓" : "";
    const txt = document.createElement("span"); txt.className = "txt";
    if (r.kind === "now") {
      const say = document.createElement("span"); say.className = "say"; say.textContent = r.text;
      const why = document.createElement("span"); why.className = "why"; why.textContent = r.why;
      txt.append(say, why);
    } else txt.textContent = r.text;
    const pts = document.createElement("span"); pts.className = "pts"; pts.textContent = r.pts;
    li.append(box, txt, pts);
    ul.appendChild(li);
  }
  $("tip-skip").hidden = !now;
}

function renderPlayer() {
  const q = S.quest;
  $("lvl-num").textContent = String(q.level);
  $("lvl-title").textContent = q.title;
  $("lvl-sub").textContent = `${MODE_NAME[S.mode]} quest`;
  $("xp-fill").style.width = `${(q.into / q.size) * 100}%`;
  $("xpbar").setAttribute("aria-valuemax", String(q.size));
  $("xpbar").setAttribute("aria-valuenow", String(q.into));
  $("xp-text").textContent = `${q.into} / ${q.size} XP`;
  $("xp-next").textContent = `Next: Level ${q.level + 1}`;
  const st = q.streak;
  $("streak").hidden = !st;
  $("streak-text").textContent = `${st}-day streak`;
}

// Pop-up messages, one after another.
const toasts = [];
let toastBusy = false;
function toast(text, pink) {
  toasts.push({ text, pink });
  if (!toastBusy) nextToast();
}
function nextToast() {
  const t = toasts.shift();
  if (!t) { toastBusy = false; return; }
  toastBusy = true;
  const el = $("toast");
  el.textContent = t.text;
  el.className = "toast" + (t.pink ? " pink" : "");
  void el.offsetWidth;
  el.classList.add("go");
  setTimeout(nextToast, 1800);
}

// ---------------- Auto-capture ----------------
function updateAutoCapture(now) {
  const auto = S.auto;
  const blocking = S.active.some((r) => r.cat === "framing" || r.id === "eyes_closed");
  const ready = auto && $("viewer").hidden && S.metrics.present && !blocking && (S.score ?? 0) >= 85 && now > S.cooldownUntil;
  $("shutter").classList.toggle("ready", ready);
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
  const review = buildReview();
  const res = S.quest.photo(review.score);
  review.xp = res.xp; review.levelUp = res.levelUp; review.streak = res.streakUp ? S.quest.streak : 0;
  S.questItems.clear(); questSig = "";
  renderPlayer();
  c.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    S.photos.push({ blob, url, score: review.score, mode: S.mode, at: new Date(), review });
    renderGalleryBtn();
    openViewer(S.photos.length - 1);
  }, "image/jpeg", 0.92);
}

// Snapshot of the coaching at the moment the photo was taken.
function buildReview() {
  const m = S.metrics || { present: false, faces: [], light: {}, group: {} };
  const score = Math.round(S.score ?? 0);
  const clamp = (v) => Math.min(1, Math.max(0, v));
  const fixes = S.active.slice(0, 5).map((r) => {
    let t = null;
    try { t = r.target ? r.target(m) : null; } catch {}
    const ok = t && isFinite(t.x) && isFinite(t.y);
    return { cat: r.cat, say: r.say, why: r.why, who: r.who[S.mode] || "", x: ok ? clamp(t.x) : null, y: ok ? clamp(t.y) : null };
  });
  const cats = new Set(S.active.map((r) => r.cat));
  const working = [];
  if (m.present && !cats.has("framing")) working.push(S.mode === "group" ? "Everyone fits in the frame" : "Well framed");
  if (m.light && m.light.face != null && !cats.has("lighting")) working.push("Good light on the face");
  if (!cats.has("angle") && (m.tilt || m.mainFace)) working.push("Flattering camera angle");
  if (m.pose && !cats.has("pose") && S.mode !== "group") working.push("Relaxed, natural pose");
  if (m.faces && m.faces.length && !m.anyBlink) working.push(m.faces.length > 1 ? "Everyone's eyes are open" : "Eyes open");

  const pct = (v) => (v == null ? null : Math.round(v * 100));
  const readouts = [];
  if (m.light && m.light.face != null) readouts.push({ label: "Face brightness", value: pct(m.light.face) + "%", flag: m.light.face < 0.2 || m.light.face > 0.9 });
  if (m.light && m.light.bg != null) readouts.push({ label: "Background", value: pct(m.light.bg) + "%", flag: cats.has("lighting") && S.active.some((r) => r.id === "backlit") });
  if (m.light && m.light.side) readouts.push({ label: "Side shadow", value: pct(m.light.side) + "%", flag: m.light.side > 0.33 });
  if (m.tilt) readouts.push({ label: "Tilt", value: Math.abs(m.tilt.roll).toFixed(1) + "°", flag: Math.abs(m.tilt.roll) > 4 });
  if (S.mode !== "solo" && m.faces) readouts.push({ label: "Faces", value: String(m.faces.length), flag: false });

  const summary = !m.present ? "No one was in the shot."
    : score >= 85 ? "Great shot. Nothing major to fix."
    : score >= 70 ? "Good shot. A small fix would make it better."
    : score >= 50 ? "Okay shot. A few easy fixes below."
    : "Needs work. Start with fix 1.";
  return { score, fixes, working: working.slice(0, 4), readouts, summary };
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

const MODE_NAME = { solo: "Solo", selfie: "Selfie", group: "Group selfie" };
function openViewer(i) {
  S.viewIdx = i;
  const p = S.photos[i], r = p.review;
  $("viewer-img").src = p.url;
  $("viewer-meta").textContent = `Photo ${i + 1} of ${S.photos.length}`;
  if (window.speechSynthesis) speechSynthesis.cancel();
  hideCountdown(); S.countdownAt = 0; S.goodSince = 0;

  // Score + summary
  $("review-score").textContent = String(r.score);
  $("review-ring-fill").style.strokeDashoffset = String(207.35 * (1 - r.score / 100));
  document.querySelector(".review-ring").classList.toggle("great", r.score >= 85);
  $("review-kicker").textContent = MODE_NAME[p.mode];
  $("review-summary").textContent = r.summary;
  $("review-xp").textContent = r.xp ? `+${r.xp} XP` + (r.levelUp ? ` · Level ${r.levelUp}!` : "") + (r.streak ? ` · ${r.streak}-day streak` : "") : "";
  const prev = S.photos[i - 1], delta = $("review-delta");
  if (prev) {
    const d = r.score - prev.score;
    delta.textContent = d === 0 ? "Same as last photo" : `${d > 0 ? "▲ +" : "▼ "}${d} vs last photo`;
    delta.className = "review-delta " + (d > 0 ? "up" : d < 0 ? "down" : "");
  } else { delta.textContent = ""; delta.className = "review-delta"; }

  // Fixes, numbered on the photo too
  const ol = $("review-fixes"); ol.innerHTML = "";
  const markers = $("review-markers"); markers.innerHTML = "";
  if (!r.fixes.length) {
    const li = document.createElement("li"); li.className = "review-empty"; li.textContent = "Nothing to fix. Nice one.";
    ol.appendChild(li);
  }
  const placed = [];
  r.fixes.forEach((f, k) => {
    const li = document.createElement("li");
    li.innerHTML = '<span class="num"></span><div class="body"><span class="cat"></span><span class="say"></span><span class="why"></span></div>';
    li.querySelector(".num").textContent = String(k + 1);
    li.querySelector(".cat").textContent = CAT_LABEL[f.cat] + (f.who ? " · " + f.who : "");
    li.querySelector(".say").textContent = f.say;
    li.querySelector(".why").textContent = f.why;
    ol.appendChild(li);
    if (f.x != null) {
      let x = f.x, y = f.y;
      // Spread markers that point at the same spot.
      while (placed.some((q) => Math.abs(q.x - x) < 0.06 && Math.abs(q.y - y) < 0.05)) x = x > 0.85 ? x - 0.08 : x + 0.08;
      placed.push({ x, y });
      const mk = document.createElement("span");
      mk.className = "r-marker"; mk.textContent = String(k + 1);
      mk.style.left = x * 100 + "%"; mk.style.top = y * 100 + "%";
      markers.appendChild(mk);
    }
  });

  // What's working
  const ul = $("review-working"); ul.innerHTML = "";
  r.working.forEach((t) => { const li = document.createElement("li"); li.textContent = t; ul.appendChild(li); });
  $("review-working-block").hidden = !r.working.length;

  // Readings
  const chips = $("review-readouts"); chips.innerHTML = "";
  r.readouts.forEach((c) => {
    const s = document.createElement("span"); s.className = "chip" + (c.flag ? " flag" : "");
    s.append(c.label + " "); const b = document.createElement("b"); b.textContent = c.value; s.appendChild(b);
    chips.appendChild(s);
  });
  chips.parentElement.hidden = !r.readouts.length;

  // Session strip
  const strip = $("viewer-strip"); strip.innerHTML = "";
  S.photos.forEach((ph, j) => {
    const b = document.createElement("button");
    b.type = "button"; b.style.backgroundImage = `url("${ph.url}")`;
    b.setAttribute("aria-label", `Photo ${j + 1}, score ${ph.score}`);
    if (j === i) b.setAttribute("aria-current", "true");
    const sc = document.createElement("span"); sc.textContent = String(ph.score); b.appendChild(sc);
    b.addEventListener("click", () => openViewer(j));
    strip.appendChild(b);
  });
  $("viewer").hidden = false;
  document.querySelector(".viewer-scroll").scrollTop = 0;
}
$("viewer-retake").addEventListener("click", closeViewer);
function closeViewer() { $("viewer").hidden = true; }

// ---------------- Speech (built into the phone, free) ----------------
function primeSpeech() {
  try { if (window.speechSynthesis) speechSynthesis.speak(new SpeechSynthesisUtterance("")); } catch {}
}
function speak(text, force) {
  if (!S.voice || !window.speechSynthesis || !$("viewer").hidden) return;
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
  // Face brackets (selfie and group), kept faint
  if (m && S.mode !== "solo") {
    for (const f of m.faces) {
      const [ax, ay] = P(f.box.x0, f.box.y0), [bx, by] = P(f.box.x1, f.box.y1);
      const x0 = Math.min(ax, bx), x1 = Math.max(ax, bx), y0 = ay, y1 = by, k = Math.min(16, (x1 - x0) / 4);
      ctx.strokeStyle = f.blink > 0.55 ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.45)"; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, y0 + k); ctx.lineTo(x0, y0); ctx.lineTo(x0 + k, y0);
      ctx.moveTo(x1 - k, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + k);
      ctx.moveTo(x1, y1 - k); ctx.lineTo(x1, y1); ctx.lineTo(x1 - k, y1);
      ctx.moveTo(x0 + k, y1); ctx.lineTo(x0, y1); ctx.lineTo(x0, y1 - k);
      ctx.stroke();
    }
  }
  // Ghost outline for the current tip, or a soft target ring
  if (m && S.tip && now >= S.niceUntil) {
    let g = null, t = null;
    try { g = S.tip.ghost ? S.tip.ghost(m) : null; } catch {}
    if (g) drawGhost(g, P, m, now);
    else {
      try { t = S.tip.target ? S.tip.target(m) : null; } catch {}
      if (t && isFinite(t.x) && isFinite(t.y)) {
        const [x, y] = P(Math.min(1, Math.max(0, t.x)), Math.min(1, Math.max(0, t.y)));
        drawPending(x, y, now);
      }
    }
  }
  // Level: shown only while the phone is tilted, then "Level ✓" briefly.
  const tilt = S.tilt.read();
  if (tilt) drawLevel(tilt, W, r, now);
}

function drawLevel(tilt, W, r, now) {
  const off = Math.abs(tilt.roll);
  if (off > 1.5) { S.levelTiltedAt = now; S.levelOkAt = 0; }
  else if (S.levelTiltedAt && !S.levelOkAt) S.levelOkAt = now;
  if (!S.levelTiltedAt) return;                       // never tilted: stay hidden
  const fade = S.levelOkAt ? 1 - (now - S.levelOkAt - 700) / 500 : 1;
  if (fade <= 0) { S.levelTiltedAt = 0; S.levelOkAt = 0; return; }

  const level = off <= 1.5;
  const color = level ? "#3ee6b0" : "#ffffff";
  const cx = W / 2, cy = r.y + r.h * 0.42;
  const len = Math.min(W, r.h) * 0.24;
  const ang = (-tilt.roll * Math.PI) / 180;

  ctx.save();
  ctx.globalAlpha = Math.min(1, fade);
  ctx.translate(cx, cy);
  ctx.shadowColor = "rgba(0,0,0,0.55)"; ctx.shadowBlur = 6;
  ctx.lineCap = "round";

  // Fixed target: faint track with bracket marks at both ends.
  ctx.strokeStyle = level ? color : "rgba(255,255,255,0.45)";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 6]);
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = color; ctx.lineWidth = 3;
  for (const sx of [-1, 1]) {
    const x = sx * (len + 10);
    ctx.beginPath();
    ctx.moveTo(x - sx * 10, -12); ctx.lineTo(x, -12); ctx.lineTo(x, 12); ctx.lineTo(x - sx * 10, 12);
    ctx.stroke();
  }

  // Moving line: the real horizon.
  ctx.save();
  ctx.rotate(ang);
  ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-len, 0); ctx.lineTo(len, 0); ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Curved arrows: which way the line has to turn to reach the marks.
  if (!level) {
    const R = len + 30, dir = ang > 0 ? -1 : 1;
    ctx.strokeStyle = "#fff"; ctx.fillStyle = "#fff"; ctx.lineWidth = 3;
    for (const base of [0, Math.PI]) {
      const a0 = base + ang, a1 = a0 + dir * 0.3;   // fixed-length arc, always visible
      ctx.beginPath(); ctx.arc(0, 0, R, Math.min(a0, a1), Math.max(a0, a1)); ctx.stroke();
      const hx = Math.cos(a1) * R, hy = Math.sin(a1) * R;
      const t = a1 + (dir * Math.PI) / 2;                 // tangent, pointing along the turn
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(t) * 11, hy + Math.sin(t) * 11);
      ctx.lineTo(hx + Math.cos(t + 2.4) * 11, hy + Math.sin(t + 2.4) * 11);
      ctx.lineTo(hx + Math.cos(t - 2.4) * 11, hy + Math.sin(t - 2.4) * 11);
      ctx.closePath(); ctx.fill();
    }
  }

  // Label
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.font = "500 13px Manrope, system-ui, sans-serif";
  ctx.fillText(level ? "Level ✓" : `Turn until the line sits on the marks · ${Math.round(off)}°`, 0, 40);
  ctx.restore();
}

// A joint or spot that still has to move: glow + hollow ring.
function drawPending(x, y, now) {
  const pulse = 1 + 0.18 * Math.sin(now / 200);
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,95,162,0.3)";
  ctx.beginPath(); ctx.arc(x, y, 19 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#ff5fa2"; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}
function drawDot(x, y, r) {
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function drawGhost(g, P, m, now) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round";
  ctx.setLineDash([2, 8]);
  ctx.shadowColor = "rgba(0,0,0,0.5)"; ctx.shadowBlur = 4;

  if (g.lm) {
    const lm = g.lm, ok = (i) => (lm[i].visibility ?? 1) >= 0.5;
    ctx.beginPath();
    for (const [a, b] of SKELETON) {
      if (!ok(a) || !ok(b)) continue;
      ctx.moveTo(...P(lm[a].x, lm[a].y)); ctx.lineTo(...P(lm[b].x, lm[b].y));
    }
    ctx.stroke();
    const [s1x, s1y] = P(lm[11].x, lm[11].y), [s2x, s2y] = P(lm[12].x, lm[12].y);
    const headR = Math.max(14, Math.hypot(s1x - s2x, s1y - s2y) * 0.32);
    const [hx, hy] = P(lm[0].x, lm[0].y - 0.01);
    ctx.beginPath(); ctx.arc(hx, hy, headR, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;

    const cur = m.pose && m.pose.lm;
    const near = (i) => {
      if (!cur) return false;
      const [ax, ay] = P(cur[i].x, cur[i].y), [bx, by] = P(lm[i].x, lm[i].y);
      return Math.hypot(ax - bx, ay - by) < 20;
    };
    for (const i of JOINTS) {
      if (!ok(i)) continue;
      const [x, y] = P(lm[i].x, lm[i].y);
      if (g.focus.includes(i) && !near(i)) drawPending(x, y, now);
      else drawDot(x, y, g.focus.includes(i) ? 5 : 3.5);
    }
    if (g.focus.includes(0)) {
      if (near(0)) drawDot(hx, hy, 5); else drawPending(hx, hy, now);
    }
  }

  if (g.faceBox) {
    const b = g.faceBox;
    const [ax, ay] = P(b.x0, b.y0), [bx, by] = P(b.x1, b.y1);
    const x0 = Math.min(ax, bx), w = Math.abs(bx - ax), y0 = ay, h = by - ay;
    ctx.beginPath();
    ctx.ellipse(x0 + w / 2, y0 + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    const f = S.tip.id === "edge_face" ? m.group.edgeFace : m.mainFace;
    const [cx, cy] = P((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    if (f) {
      const [fx, fy] = P(f.cx, f.cy);
      if (Math.hypot(fx - cx, fy - cy) < 20 && Math.abs(f.w - (b.x1 - b.x0)) < 0.04) drawDot(cx, cy, 5);
      else drawPending(cx, cy, now);
    }
  }
  ctx.restore();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden && window.speechSynthesis) speechSynthesis.cancel();
});

// Test hook: open with ?debug to reach app state from the browser console.
if (new URLSearchParams(location.search).has("debug")) window.__poseCoach = { S, draw, renderHud, computeMetrics, poseMetrics, RULES, trackQuest, renderPlayer };

// Start screen: show the player's level and streak if they've played before.
(function renderStartPlayer() {
  const q = S.quest, el = $("start-player");
  if (!q.st.xp) return;
  const badge = document.createElement("span"); badge.className = "lvl-badge"; badge.textContent = String(q.level);
  const txt = document.createElement("span"); txt.className = "lvl-text";
  const t1 = document.createElement("span"); t1.className = "lvl-title"; t1.textContent = q.title;
  const t2 = document.createElement("span"); t2.className = "lvl-sub"; t2.textContent = `${q.st.xp} XP · best photo ${q.st.best}`;
  txt.append(t1, t2);
  el.append(badge, txt);
  if (q.streak) {
    const st = document.createElement("span"); st.className = "streak"; st.textContent = `${q.streak}-day streak`;
    el.appendChild(st);
  }
})();
