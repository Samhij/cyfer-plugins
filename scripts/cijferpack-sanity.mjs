/**
 * Headless sanity checks for cijferpack pure helpers / sequencing contracts.
 * Run: node scripts/cijferpack-sanity.mjs
 *
 * Mirrors plugins/cijferpack/ui/script.js logic (keep in sync when helpers change).
 */

function shuffle(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function dramatizeOrder(cards) {
  const shuffled = shuffle(cards);
  if (shuffled.length < 4) return shuffled;
  const highs = shuffled.filter((c) => c.tier === "gold" || c.tier === "special");
  const rest = shuffled.filter((c) => c.tier !== "gold" && c.tier !== "special");
  if (!highs.length) return shuffled;
  const early = rest.slice(0, Math.max(0, rest.length - 1));
  const mid = rest.slice(Math.max(0, rest.length - 1));
  return [...shuffle(early), ...shuffle(mid), ...shuffle(highs)];
}

function normalizeCard(card) {
  if (!card || typeof card !== "object") return null;
  const score = card.score != null && String(card.score).trim() ? String(card.score) : null;
  if (!score) return null;
  const tier =
    card.tier === "bronze" ||
    card.tier === "silver" ||
    card.tier === "gold" ||
    card.tier === "special"
      ? card.tier
      : "silver";
  const numeric =
    typeof card.numeric === "number" && Number.isFinite(card.numeric) ? card.numeric : null;
  return {
    subject: card.subject && String(card.subject).trim() ? String(card.subject) : "Vak",
    score,
    numeric,
    date: card.date && String(card.date).trim() ? String(card.date) : "—",
    teacher: card.teacher && String(card.teacher).trim() ? String(card.teacher) : null,
    source: card.source === "examen" ? "examen" : "voortgang",
    tier,
  };
}

function tierOf(score, numeric, grade = {}) {
  const upper = score.trim().toUpperCase();
  if (
    (numeric != null && numeric >= 9) ||
    upper === "U" ||
    upper === "UITSTEKEND" ||
    upper === "EXCELLENT"
  ) {
    return "special";
  }
  if ((numeric != null && numeric >= 8) || upper === "G" || upper === "GOED") {
    return "gold";
  }
  if (
    (numeric != null && numeric >= 6.5) ||
    grade.isVoldoende === true ||
    upper === "V" ||
    upper === "VOLD" ||
    upper === "VOLDAAN"
  ) {
    return "silver";
  }
  if (numeric != null) return "bronze";
  return "silver";
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(() => {
      if (signal) signal.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal) signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Minimal ContinueGate contract used by the plugin. */
class ContinueGate {
  constructor() {
    this._resolve = null;
    this._reject = null;
    this._timer = null;
    this._onAbort = null;
    this._signal = null;
    this._settled = true;
  }

  clear() {
    if (!this._settled) {
      const rej = this._reject;
      this._teardown();
      rej?.(new DOMException("Aborted", "AbortError"));
      return;
    }
    this._teardown();
  }

  dismiss() {
    if (this._settled) return;
    const resolve = this._resolve;
    this._teardown();
    resolve?.();
  }

  wait(autoMs, requireTap, signal) {
    this.clear();
    this._settled = false;
    this._signal = signal;
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        this._settled = true;
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }
      this._resolve = resolve;
      this._reject = reject;
      this._onAbort = () => {
        if (this._settled) return;
        const rej = this._reject;
        this._teardown();
        rej?.(new DOMException("Aborted", "AbortError"));
      };
      signal.addEventListener("abort", this._onAbort, { once: true });
      const ms = requireTap ? 50 : Math.max(0, autoMs);
      this._timer = setTimeout(() => this.dismiss(), ms);
    });
  }

  _teardown() {
    if (this._timer != null) clearTimeout(this._timer);
    this._timer = null;
    if (this._onAbort && this._signal) {
      this._signal.removeEventListener("abort", this._onAbort);
    }
    this._onAbort = null;
    this._signal = null;
    this._resolve = null;
    this._reject = null;
    this._settled = true;
  }
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed += 1;
  } else {
    console.log("ok:", msg);
  }
}

// --- normalizeCard ---
assert(normalizeCard(null) === null, "normalize null → null");
assert(normalizeCard({}) === null, "normalize empty → null");
assert(normalizeCard({ score: "8.5", tier: "nope" }).tier === "silver", "bad tier → silver");
assert(normalizeCard({ score: "9", subject: "" }).subject === "Vak", "empty subject → Vak");
assert(normalizeCard({ score: "7", numeric: NaN }).numeric === null, "NaN numeric → null");

// --- tierOf ---
assert(tierOf("9.0", 9) === "special", "9 → special");
assert(tierOf("8.0", 8) === "gold", "8 → gold");
assert(tierOf("6.5", 6.5) === "silver", "6.5 → silver");
assert(tierOf("5.0", 5) === "bronze", "5 → bronze");
assert(tierOf("G", null) === "gold", "G → gold");

// --- dramatizeOrder: highs at end when enough cards ---
const sample = [
  { tier: "special", score: "9" },
  { tier: "bronze", score: "5" },
  { tier: "gold", score: "8" },
  { tier: "silver", score: "7" },
  { tier: "bronze", score: "4" },
  { tier: "silver", score: "6.5" },
];
for (let i = 0; i < 20; i += 1) {
  const ordered = dramatizeOrder(sample);
  const lastTwo = ordered.slice(-2);
  const highCount = lastTwo.filter((c) => c.tier === "gold" || c.tier === "special").length;
  assert(highCount >= 1, `dramatize run ${i}: at least one high in last two`);
  assert(ordered.length === sample.length, `dramatize run ${i}: length preserved`);
}

// --- delay abort (already aborted) ---
{
  const ac = new AbortController();
  ac.abort();
  let rejected = false;
  try {
    await delay(1000, ac.signal);
  } catch (e) {
    rejected = e?.name === "AbortError";
  }
  assert(rejected, "delay rejects when signal already aborted");
}

// --- delay abort mid-wait ---
{
  const ac = new AbortController();
  const p = delay(5000, ac.signal);
  setTimeout(() => ac.abort(), 10);
  let rejected = false;
  try {
    await p;
  } catch (e) {
    rejected = e?.name === "AbortError";
  }
  assert(rejected, "delay rejects on mid-wait abort");
}

// --- ContinueGate: already-aborted signal ---
{
  const gate = new ContinueGate();
  const ac = new AbortController();
  ac.abort();
  let rejected = false;
  try {
    await gate.wait(100, false, ac.signal);
  } catch (e) {
    rejected = e?.name === "AbortError";
  }
  assert(rejected, "ContinueGate rejects when signal already aborted");
}

// --- ContinueGate: clear rejects pending (no hang) ---
{
  const gate = new ContinueGate();
  const ac = new AbortController();
  const p = gate.wait(60_000, true, ac.signal);
  queueMicrotask(() => gate.clear());
  let rejected = false;
  try {
    await p;
  } catch (e) {
    rejected = e?.name === "AbortError";
  }
  assert(rejected, "ContinueGate.clear rejects pending waiter");
}

// --- ContinueGate: dismiss resolves ---
{
  const gate = new ContinueGate();
  const ac = new AbortController();
  const p = gate.wait(60_000, true, ac.signal);
  queueMicrotask(() => gate.dismiss());
  await p;
  assert(true, "ContinueGate.dismiss resolves pending waiter");
}

// --- single-flight phase machine sketch ---
{
  let phase = "idle";
  const open = async () => {
    if (phase !== "idle") return "blocked";
    phase = "opening";
    return "opened";
  };
  assert((await open()) === "opened", "first open allowed");
  assert((await open()) === "blocked", "second open blocked while busy");
  phase = "idle";
  assert((await open()) === "opened", "open allowed again after idle");
}

if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nAll cijferpack sanity checks passed.");
