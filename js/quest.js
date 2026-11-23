// Pose Quest: XP, levels and a daily streak, saved in this browser only.

const KEY = "poseQuest.v1";
const LEVEL_SIZE = 300;
const TITLES = ["Newbie", "Snapper", "Framer", "Pose Pro", "Light Chaser", "Cover Star", "Legend"];

export const FIX_XP = { framing: 10, lighting: 15, angle: 10, pose: 20, polish: 5 };
export const FIX_CHEER = { framing: "Framed!", lighting: "Light nailed!", angle: "Great angle!", pose: "Pose matched!", polish: "Looking sharp!" };
export const QUEST_NAME = { solo: "The Natural", selfie: "Best Angle", group: "Squad Goals" };

function load() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || "null");
    if (v && typeof v.xp === "number") return { xp: v.xp, streak: v.streak || 0, lastDay: v.lastDay || null, photos: v.photos || 0, best: v.best || 0 };
  } catch {}
  return { xp: 0, streak: 0, lastDay: null, photos: 0, best: 0 };
}
function save(st) { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} }

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export class Quest {
  constructor() { this.st = load(); }

  get level() { return 1 + Math.floor(this.st.xp / LEVEL_SIZE); }
  get title() { return TITLES[Math.min(this.level - 1, TITLES.length - 1)]; }
  get into() { return this.st.xp % LEVEL_SIZE; }
  get size() { return LEVEL_SIZE; }
  get streak() {
    // A streak only counts if the last photo was today or yesterday.
    if (!this.st.lastDay) return 0;
    const y = new Date(); y.setDate(y.getDate() - 1);
    return this.st.lastDay === dayKey(new Date()) || this.st.lastDay === dayKey(y) ? this.st.streak : 0;
  }

  // Returns the new level if this pushed you up one, else null.
  addXP(n) {
    const before = this.level;
    this.st.xp += Math.max(0, Math.round(n));
    save(this.st);
    return this.level > before ? this.level : null;
  }

  // Called once per photo. Returns { xp, streakUp, levelUp }.
  photo(score) {
    const today = dayKey(new Date());
    const y = new Date(); y.setDate(y.getDate() - 1);
    let streakUp = false;
    if (this.st.lastDay !== today) {
      this.st.streak = this.st.lastDay === dayKey(y) ? this.st.streak + 1 : 1;
      this.st.lastDay = today;
      streakUp = true;
    }
    this.st.photos += 1;
    this.st.best = Math.max(this.st.best, score);
    const xp = Math.round(score / 5) + (score >= 85 ? 25 : 0);
    const levelUp = this.addXP(xp);
    return { xp, streakUp, levelUp };
  }
}
