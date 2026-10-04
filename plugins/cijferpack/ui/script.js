/**
 * Cijferpack — FIFA/FC-inspired grade pack opening (Cyfers-branded art).
 *
 * Grades API mirrors widget-cijfers:
 *   GET /rest/v1/geldendvoortgangsdossierresultaten/leerling/{id}
 *   GET /rest/v1/geldendexamendossierresultaten/leerling/{id}
 * with Range items=0-99 (up to 100 per endpoint; combined for the pack).
 *
 * Sequencing rules (hardened):
 * - Single-flight open / replay (no re-entrancy)
 * - One AbortController covers shake → reveals → continue waits
 * - All delays are abortable; already-aborted signals reject immediately
 * - hardReset() clears DOM classes, particles, RAF, and pending continue
 */

const QUERY = [
  "type=Toetskolom",
  "type=DeeltoetsKolom",
  "type=Werkstukcijferkolom",
  "type=Advieskolom",
  "additional=vaknaam",
  "additional=resultaatkolom",
  "additional=naamalternatiefniveau",
  "additional=vakuuid",
  "additional=lichtinguuid",
  "sort=desc-datumInvoer",
].join("&");

/** Max items requested per dossier endpoint (Somtoday Range paging). */
const PAGE_SIZE = 100;

const TIER_LABELS = {
  bronze: "Brons",
  silver: "Zilver",
  gold: "Goud",
  special: "Speciaal",
};

/** Timing inspired by pack-open pacing (ms). */
const TIMING = {
  shakeSoft: 450,
  shakeMid: 550,
  shakeHard: 700,
  burstHold: 420,
  bronzeHold: 700,
  silverHold: 900,
  goldBeat: 900,
  goldHold: 1400,
  specialBeat: 1400,
  specialHold: 2200,
  autoAdvanceBronze: 450,
  autoAdvanceSilver: 650,
  autoAdvanceGold: 900,
  /** Reduced-motion: still paint each step, never zero-length. */
  reducedStep: 160,
  reducedContinue: 280,
  /** Absolute safety so requireTap can never hang forever. */
  continueSafetyMax: 45000,
};

/** @typedef {"idle" | "opening" | "revealing" | "gallery"} Phase */

/** @type {PackCard[]} */
let packCards = [];
/** @type {Phase} */
let phase = "idle";
/** @type {AbortController | null} */
let runAbort = null;
/** @type {ContinueGate | null} */
let continueGate = null;
let prefersReducedMotion = false;
/** @type {MediaQueryList | null} */
let motionQuery = null;
/** @type {number | null} */
let fxRaf = null;
/** @type {{ x: number, y: number, vx: number, vy: number, life: number, color: string, size: number }[]} */
let particles = [];
/** Generation bump cancels stale async tails after reset. */
let runGeneration = 0;

const el = {
  theater: /** @type {HTMLElement} */ (document.getElementById("theater")),
  subtitle: /** @type {HTMLElement} */ (document.getElementById("subtitle")),
  status: /** @type {HTMLElement} */ (document.getElementById("status")),
  intro: /** @type {HTMLElement} */ (document.getElementById("intro")),
  reveal: /** @type {HTMLElement} */ (document.getElementById("reveal")),
  gallery: /** @type {HTMLElement} */ (document.getElementById("gallery")),
  openBtn: /** @type {HTMLButtonElement} */ (document.getElementById("openBtn")),
  replayBtn: /** @type {HTMLButtonElement} */ (document.getElementById("replayBtn")),
  skipBtn: /** @type {HTMLButtonElement} */ (document.getElementById("skipBtn")),
  continueBtn: /** @type {HTMLButtonElement} */ (document.getElementById("continueBtn")),
  pack: /** @type {HTMLButtonElement} */ (document.getElementById("pack")),
  packCount: /** @type {HTMLElement} */ (document.getElementById("packCount")),
  introTagline: /** @type {HTMLElement} */ (document.getElementById("introTagline")),
  flash: /** @type {HTMLElement} */ (document.getElementById("flash")),
  chromatic: /** @type {HTMLElement} */ (document.getElementById("chromatic")),
  beams: /** @type {HTMLElement} */ (document.getElementById("beams")),
  walkoutWash: /** @type {HTMLElement} */ (document.getElementById("walkoutWash")),
  revealHost: /** @type {HTMLElement} */ (document.getElementById("revealCardHost")),
  revealProgress: /** @type {HTMLElement} */ (document.getElementById("revealProgress")),
  tierCall: /** @type {HTMLElement} */ (document.getElementById("tierCall")),
  galleryGrid: /** @type {HTMLElement} */ (document.getElementById("galleryGrid")),
  galleryMeta: /** @type {HTMLElement} */ (document.getElementById("galleryMeta")),
  canvas: /** @type {HTMLCanvasElement} */ (document.getElementById("fxCanvas")),
};

const ctx2d = el.canvas.getContext("2d");

/**
 * @typedef {{
 *   subject: string,
 *   score: string,
 *   numeric: number | null,
 *   date: string,
 *   teacher: string | null,
 *   source: "voortgang" | "examen",
 *   tier: "bronze" | "silver" | "gold" | "special",
 * }} PackCard
 */

/** Abortable continue / auto-advance waiter (single active gate). */
class ContinueGate {
  constructor() {
    /** @type {(() => void) | null} */
    this._resolve = null;
    /** @type {((reason?: unknown) => void) | null} */
    this._reject = null;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this._timer = null;
    /** @type {(() => void) | null} */
    this._onTap = null;
    /** @type {(() => void) | null} */
    this._onAbort = null;
    /** @type {AbortSignal | null} */
    this._signal = null;
    this._settled = true;
  }

  get pending() {
    return !this._settled;
  }

  /** Cancel without resolving — rejects waiters so awaiters cannot hang. */
  clear() {
    if (!this._settled) {
      const rej = this._reject;
      this._teardown(false);
      rej?.(new DOMException("Aborted", "AbortError"));
      return;
    }
    this._teardown(false);
  }

  /** Resolve if waiting (advance). */
  dismiss() {
    if (this._settled) return;
    const resolve = this._resolve;
    this._teardown(false);
    resolve?.();
  }

  /**
   * @param {number} autoMs
   * @param {boolean} requireTap
   * @param {AbortSignal} signal
   */
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

      this._onTap = () => this.dismiss();
      this._onAbort = () => {
        if (this._settled) return;
        const rej = this._reject;
        this._teardown(false);
        rej?.(new DOMException("Aborted", "AbortError"));
      };

      el.continueBtn.hidden = false;
      el.continueBtn.disabled = false;
      try {
        el.continueBtn.focus({ preventScroll: true });
      } catch {
        /* focus can fail if panel not visible yet */
      }
      el.continueBtn.addEventListener("click", this._onTap);
      signal.addEventListener("abort", this._onAbort, { once: true });

      const ms = requireTap
        ? TIMING.continueSafetyMax
        : Math.max(0, autoMs);
      this._timer = setTimeout(() => this.dismiss(), ms);
    });
  }

  /**
   * @param {boolean} _unused
   */
  _teardown(_unused) {
    if (this._timer != null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._onTap) {
      el.continueBtn.removeEventListener("click", this._onTap);
      this._onTap = null;
    }
    if (this._onAbort && this._signal) {
      this._signal.removeEventListener("abort", this._onAbort);
      this._onAbort = null;
    }
    this._signal = null;
    this._resolve = null;
    this._reject = null;
    this._settled = true;
    el.continueBtn.hidden = true;
    el.continueBtn.disabled = false;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Always waits (abortable). Use for reduced-motion short steps too.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
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

/**
 * Drama sleep: full timing, or a short real delay under reduced motion.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function sleep(ms, signal) {
  if (prefersReducedMotion) {
    return delay(Math.min(ms, TIMING.reducedStep), signal);
  }
  return delay(ms, signal);
}

function isAbortError(err) {
  return err instanceof DOMException && err.name === "AbortError";
}

function setStatus(message, isError = false) {
  if (!message) {
    el.status.hidden = true;
    el.status.textContent = "";
    el.status.classList.remove("error");
    return;
  }
  el.status.hidden = false;
  el.status.textContent = message;
  el.status.classList.toggle("error", isError);
}

function resizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { clientWidth: w, clientHeight: h } = el.theater;
  el.canvas.width = Math.max(1, Math.floor(w * dpr));
  el.canvas.height = Math.max(1, Math.floor(h * dpr));
  if (ctx2d) ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function stopFxLoop() {
  if (fxRaf != null) cancelAnimationFrame(fxRaf);
  fxRaf = null;
  particles = [];
  if (ctx2d) {
    ctx2d.clearRect(0, 0, el.canvas.width, el.canvas.height);
  }
}

function tickFx() {
  if (!ctx2d) return;
  const w = el.theater.clientWidth;
  const h = el.theater.clientHeight;
  ctx2d.clearRect(0, 0, w, h);
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += 0.04;
    p.life -= 0.016;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx2d.globalAlpha = Math.min(1, p.life);
    ctx2d.fillStyle = p.color;
    ctx2d.beginPath();
    ctx2d.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx2d.fill();
  }
  ctx2d.globalAlpha = 1;
  if (particles.length) {
    fxRaf = requestAnimationFrame(tickFx);
  } else {
    fxRaf = null;
  }
}

/**
 * @param {number} count
 * @param {"burst" | "sparks" | "gold" | "special"} kind
 */
function spawnBurst(count, kind = "burst") {
  if (prefersReducedMotion || !ctx2d) return;
  resizeCanvas();
  const cx = el.theater.clientWidth / 2;
  const cy = el.theater.clientHeight * 0.42;
  const palette =
    kind === "special"
      ? ["#ff4d2e", "#ffc4a0", "#3d7cff", "#fff", "#ff6ac8"]
      : kind === "gold"
        ? ["#ffe566", "#ffb020", "#fff8e0", "#ff8a20"]
        : kind === "sparks"
          ? ["#ffe566", "#fff", "#e8b87a"]
          : ["#ffe566", "#ff6a35", "#fff", "#e8b87a", "#7ab0ff"];

  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = kind === "special" ? 4 + Math.random() * 9 : 2.5 + Math.random() * 7;
    particles.push({
      x: cx + (Math.random() - 0.5) * 40,
      y: cy + (Math.random() - 0.5) * 40,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (kind === "special" ? 2 : 0.5),
      life: 0.7 + Math.random() * 0.9,
      color: palette[i % palette.length],
      size: kind === "special" ? 2 + Math.random() * 3.5 : 1.2 + Math.random() * 2.4,
    });
  }
  if (fxRaf == null) fxRaf = requestAnimationFrame(tickFx);
}

function triggerFlash(hard = false) {
  el.flash.classList.remove("is-on");
  void el.flash.offsetWidth;
  el.flash.classList.add("is-on");
  if (hard) {
    el.chromatic.classList.remove("is-on");
    void el.chromatic.offsetWidth;
    el.chromatic.classList.add("is-on");
  }
}

function setTheaterShake(mode) {
  el.theater.classList.remove("is-shaking", "is-shaking-hard");
  if (!mode || prefersReducedMotion) return;
  void el.theater.offsetWidth;
  el.theater.classList.add(mode === "hard" ? "is-shaking-hard" : "is-shaking");
}

function clearBeams() {
  el.beams.className = "beams";
  el.walkoutWash.className = "walkout-wash";
  el.tierCall.hidden = true;
  el.tierCall.className = "reveal-tier-call";
  el.tierCall.textContent = "";
}

/**
 * @param {PackCard["tier"]} tier
 */
function armRarityFx(tier) {
  clearBeams();
  if (tier === "bronze") return;
  el.beams.classList.add("is-on", `tier-${tier}`);
  if (tier === "gold" || tier === "special") {
    el.walkoutWash.classList.add("is-on", `tier-${tier}`);
    el.tierCall.hidden = false;
    el.tierCall.textContent = tier === "special" ? "SPECIAAL" : "GOUD";
    el.tierCall.classList.add(`tier-${tier}`);
  }
}

/** @param {SomtodayGrade} grade */
function subjectOf(grade) {
  const vak = grade.additionalObjects?.vaknaam;
  if (typeof vak === "string" && vak) return vak;
  if (vak && typeof vak === "object") return vak.naam || vak.afkorting || "Vak";
  return grade.vak?.naam || grade.vak?.afkorting || "Vak";
}

/** @param {SomtodayGrade} grade */
function scoreOf(grade) {
  const value =
    grade.label ||
    grade.formattedResultaat ||
    grade.geldendResultaat ||
    grade.resultaat ||
    grade.geldendResultaatCijferInvoer ||
    grade.cijfer;
  if (value == null || value === "") return null;
  return String(value);
}

/** @param {string} score */
function numericOf(score) {
  const normalized = score.replace(",", ".").trim();
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

/** @param {SomtodayGrade} grade */
function dateOf(grade) {
  const raw = grade.datumInvoer || grade.datumInvoerEerstePoging || grade.datumInvoerTweedePoging;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Teacher is not a stable field on geldend resultaten; probe common shapes.
 * @param {SomtodayGrade} grade
 */
function teacherOf(grade) {
  const g = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (grade));
  const candidates = [
    g.docent,
    g.medewerker,
    g.beoordelaar,
    grade.additionalObjects?.docent,
    grade.additionalObjects?.medewerker,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
    if (c && typeof c === "object") {
      const o = /** @type {{ naam?: string; afkorting?: string }} */ (c);
      if (o.naam) return o.naam;
      if (o.afkorting) return o.afkorting;
    }
  }
  return null;
}

/**
 * @param {string} score
 * @param {number | null} numeric
 * @param {SomtodayGrade} grade
 * @returns {PackCard["tier"]}
 */
function tierOf(score, numeric, grade) {
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

/**
 * Display "rating" badge — maps numeric grade into a FUT-like 40–99 band.
 * @param {PackCard} card
 */
function ratingOf(card) {
  if (card.numeric != null) {
    const clamped = Math.max(1, Math.min(10, card.numeric));
    return String(Math.round(40 + clamped * 5.9));
  }
  if (card.tier === "special") return "94";
  if (card.tier === "gold") return "86";
  if (card.tier === "silver") return "72";
  return "58";
}

/**
 * @param {SomtodayGrade} grade
 * @param {"voortgang" | "examen"} source
 * @returns {PackCard | null}
 */
function toCard(grade, source) {
  const score = scoreOf(grade);
  if (!score) return null;
  const numeric = numericOf(score);
  return {
    subject: subjectOf(grade) || "Vak",
    score,
    numeric,
    date: dateOf(grade),
    teacher: teacherOf(grade),
    source,
    tier: tierOf(score, numeric, grade),
  };
}

/**
 * Normalize a card before render — never throw on partial data.
 * @param {Partial<PackCard> | null | undefined} card
 * @returns {PackCard | null}
 */
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

/**
 * @template T
 * @param {T[]} items
 */
function shuffle(items) {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * Bias drama: keep some high tiers toward the end (walkout feel).
 * @param {PackCard[]} cards
 */
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

/**
 * @param {string} kind
 * @param {number} studentId
 * @returns {Promise<SomtodayGrade[]>}
 */
async function loadGrades(kind, studentId) {
  /** @type {SomtodayListResponse<SomtodayGrade>} */
  const data = await cyfers.fetch(`/rest/v1/${kind}/leerling/${studentId}?${QUERY}`, {
    headers: { range: `items=0-${PAGE_SIZE - 1}` },
  });
  return data?.items ?? [];
}

/**
 * @param {PackCard} card
 * @param {{ faceUp?: boolean, compact?: boolean }} [opts]
 */
function buildCardElement(card, opts = {}) {
  const safe = normalizeCard(card);
  if (!safe) {
    const empty = document.createElement("article");
    empty.className = "grade-card tier-bronze";
    empty.innerHTML = `<div class="face face-front"><p class="card-meta">—</p></div>`;
    return empty;
  }

  const root = document.createElement("article");
  root.className = `grade-card tier-${safe.tier}`;
  root.setAttribute("aria-label", `${safe.subject}: ${safe.score}`);

  const teacherLine = safe.teacher
    ? `<p class="card-meta">${escapeHtml(safe.teacher)}</p>`
    : "";
  const sourceLabel = safe.source === "examen" ? "Examen" : "Voortgang";
  const tierLabel = TIER_LABELS[safe.tier] || "Kaart";

  root.innerHTML = `
    <div class="face face-back" aria-hidden="true"></div>
    <div class="face face-front">
      <div class="card-rating-block">
        <div class="card-rating">${escapeHtml(ratingOf(safe))}</div>
        <div class="card-chem">
          <span class="card-tier">${escapeHtml(tierLabel)}</span>
          <span class="card-source-pill">${sourceLabel}</span>
        </div>
      </div>
      <div class="card-portrait">
        <div class="card-score-hero">${escapeHtml(safe.score)}</div>
      </div>
      <div class="card-footer">
        <h3 class="card-subject">${escapeHtml(safe.subject)}</h3>
        <p class="card-meta">${escapeHtml(safe.date)}</p>
        ${teacherLine}
      </div>
      <div class="card-shine" aria-hidden="true"></div>
    </div>
  `;

  // Gallery uses CSS (face-back hidden, face-front unrotated) — never rotateY the root
  // or the front face disappears while the back is display:none.
  if (opts.faceUp && !opts.compact) {
    root.classList.add("is-face-up");
  }
  return root;
}

/**
 * Strip transient animation classes so the next state starts clean.
 * @param {HTMLElement} node
 */
function clearCardMotion(node) {
  node.classList.remove(
    "is-enter",
    "is-walkout",
    "is-await",
    "is-flipping",
    "is-hero",
    "is-face-up",
  );
  node.style.removeProperty("transform");
  node.style.removeProperty("opacity");
  node.style.removeProperty("filter");
}

/**
 * @param {"intro" | "reveal" | "gallery"} name
 */
function showStage(name) {
  el.intro.hidden = name !== "intro";
  el.reveal.hidden = name !== "reveal";
  el.gallery.hidden = name !== "gallery";
  el.theater.dataset.phase = name;
  el.theater.classList.toggle("phase-intro", name === "intro");
  el.theater.classList.toggle("phase-reveal", name === "reveal");
  el.theater.classList.toggle("phase-gallery", name === "gallery");
}

function setIntroControlsEnabled(enabled) {
  const on = Boolean(enabled) && packCards.length > 0;
  el.openBtn.disabled = !on;
  el.pack.disabled = !on;
}

/**
 * Full cleanup: abort run, kill timers/RAF/particles, reset DOM chrome.
 * @param {{ keepPhase?: Phase }} [opts]
 */
function hardReset(opts = {}) {
  runGeneration += 1;
  if (runAbort) {
    try {
      runAbort.abort();
    } catch {
      /* ignore */
    }
  }
  runAbort = null;
  continueGate?.clear();
  continueGate = null;

  stopFxLoop();
  clearBeams();
  el.theater.classList.remove("is-shaking", "is-shaking-hard");
  el.pack.classList.remove("is-shake-soft", "is-shake-mid", "is-shake-hard", "is-burst");
  el.flash.classList.remove("is-on");
  el.chromatic.classList.remove("is-on");
  el.revealHost.replaceChildren();
  el.revealProgress.textContent = "";
  el.continueBtn.hidden = true;
  el.continueBtn.disabled = false;
  el.continueBtn.textContent = "Tik om door te gaan";
  el.skipBtn.hidden = true;

  if (opts.keepPhase) {
    phase = opts.keepPhase;
  }
}

function renderGallery() {
  el.galleryGrid.replaceChildren();
  const counts = { special: 0, gold: 0, silver: 0, bronze: 0 };
  for (const raw of packCards) {
    const card = normalizeCard(raw);
    if (!card) continue;
    counts[card.tier] += 1;
    el.galleryGrid.appendChild(buildCardElement(card, { compact: true }));
  }
  el.galleryMeta.textContent =
    `${packCards.length} kaarten · ` +
    `${counts.special} speciaal · ${counts.gold} goud · ${counts.silver} zilver · ${counts.bronze} brons`;
}

/**
 * @param {number} autoMs
 * @param {boolean} requireTap
 * @param {AbortSignal} signal
 */
async function waitContinue(autoMs, requireTap, signal) {
  if (!continueGate) continueGate = new ContinueGate();

  if (prefersReducedMotion) {
    el.continueBtn.textContent = el.continueBtn.textContent || "Tik om door te gaan";
    await continueGate.wait(TIMING.reducedContinue, false, signal);
    return;
  }

  await continueGate.wait(autoMs, requireTap, signal);
}

/**
 * @param {PackCard} card
 * @param {number} index
 * @param {AbortSignal} signal
 * @param {number} generation
 */
async function revealOne(card, index, signal, generation) {
  if (signal.aborted || generation !== runGeneration) {
    throw new DOMException("Aborted", "AbortError");
  }

  const safe = normalizeCard(card);
  if (!safe) return;

  el.revealHost.replaceChildren();
  clearBeams();
  continueGate?.clear();

  const node = buildCardElement(safe);
  el.revealHost.appendChild(node);
  el.revealProgress.textContent = `Kaart ${index + 1} van ${packCards.length}`;

  const intense = safe.tier === "gold" || safe.tier === "special";
  const walkout = safe.tier === "special";

  el.continueBtn.textContent =
    index === packCards.length - 1 ? "Naar overzicht" : "Tik om door te gaan";

  if (prefersReducedMotion) {
    armRarityFx(safe.tier);
    clearCardMotion(node);
    node.classList.add("is-face-up");
    await waitContinue(TIMING.reducedContinue, false, signal);
    return;
  }

  // Rise from pack (back face)
  void node.offsetWidth;
  if (walkout) {
    node.classList.add("is-walkout");
    armRarityFx("special");
    spawnBurst(55, "special");
    setTheaterShake("hard");
    triggerFlash(true);
  } else {
    node.classList.add("is-enter");
  }

  await sleep(walkout ? 900 : 420, signal);
  if (generation !== runGeneration) throw new DOMException("Aborted", "AbortError");

  // Beat pause before flip — the FIFA "is it…?" moment
  if (intense) {
    armRarityFx(safe.tier);
    node.classList.remove("is-enter", "is-walkout");
    void node.offsetWidth;
    node.classList.add("is-await");
    spawnBurst(safe.tier === "special" ? 40 : 24, safe.tier === "special" ? "special" : "gold");
    const beat = safe.tier === "special" ? TIMING.specialBeat : TIMING.goldBeat;
    await sleep(beat, signal);
    node.classList.remove("is-await");
  } else if (safe.tier === "silver") {
    el.beams.className = "beams is-on tier-silver";
    await sleep(220, signal);
  }

  if (generation !== runGeneration) throw new DOMException("Aborted", "AbortError");

  // Flip — one animation at a time (no stacked is-flipping + is-hero)
  clearCardMotion(node);
  void node.offsetWidth;
  node.classList.add("is-flipping");
  if (intense) {
    triggerFlash(safe.tier === "special");
    spawnBurst(safe.tier === "special" ? 48 : 28, safe.tier === "special" ? "special" : "gold");
    setTheaterShake(safe.tier === "special" ? "hard" : "soft");
  } else {
    spawnBurst(12, "sparks");
  }

  await sleep(850, signal);
  if (generation !== runGeneration) throw new DOMException("Aborted", "AbortError");

  // Lock face-up with a stable class (animation fill-mode can't fight the next keyframes)
  clearCardMotion(node);
  node.classList.add("is-face-up", "is-hero");

  const hold =
    safe.tier === "special"
      ? TIMING.specialHold
      : safe.tier === "gold"
        ? TIMING.goldHold
        : safe.tier === "silver"
          ? TIMING.silverHold
          : TIMING.bronzeHold;

  await sleep(Math.min(hold, 600), signal);

  const requireTap = safe.tier === "special" || safe.tier === "gold";
  const auto =
    safe.tier === "special"
      ? TIMING.autoAdvanceGold + 800
      : safe.tier === "gold"
        ? TIMING.autoAdvanceGold
        : safe.tier === "silver"
          ? TIMING.autoAdvanceSilver
          : TIMING.autoAdvanceBronze;

  await waitContinue(auto, requireTap, signal);
}

/**
 * @param {AbortSignal} signal
 * @param {number} generation
 */
async function runRevealSequence(signal, generation) {
  phase = "revealing";
  showStage("reveal");
  el.skipBtn.hidden = false;
  el.pack.classList.remove("is-shake-soft", "is-shake-mid", "is-shake-hard", "is-burst");

  for (let i = 0; i < packCards.length; i += 1) {
    if (signal.aborted || generation !== runGeneration) {
      throw new DOMException("Aborted", "AbortError");
    }
    await revealOne(packCards[i], i, signal, generation);
  }

  finishToGallery(generation);
}

/**
 * @param {number} [generation]
 */
function finishToGallery(generation) {
  if (generation != null && generation !== runGeneration) return;

  continueGate?.clear();
  continueGate = null;
  runAbort = null;
  el.skipBtn.hidden = true;
  clearBeams();
  stopFxLoop();
  el.theater.classList.remove("is-shaking", "is-shaking-hard");
  el.flash.classList.remove("is-on");
  el.chromatic.classList.remove("is-on");
  el.revealHost.replaceChildren();
  renderGallery();
  showStage("gallery");
  phase = "gallery";
  el.subtitle.textContent = `${packCards.length} cijfers geopend`;
  setIntroControlsEnabled(false);
}

async function openPack() {
  // Single-flight: ignore mash-clicks / dual pack+CTA activation
  if (phase !== "idle" || !packCards.length) return;

  phase = "opening";
  setIntroControlsEnabled(false);
  setStatus("");
  el.introTagline.textContent = "Pakket trilt…";

  const generation = runGeneration + 1;
  runGeneration = generation;
  const ac = new AbortController();
  runAbort = ac;
  const { signal } = ac;
  continueGate = new ContinueGate();

  try {
    if (!prefersReducedMotion) {
      el.pack.classList.add("is-shake-soft");
      spawnBurst(16, "sparks");
      await sleep(TIMING.shakeSoft, signal);
      el.pack.classList.remove("is-shake-soft");
      el.pack.classList.add("is-shake-mid");
      setTheaterShake("soft");
      spawnBurst(28, "burst");
      await sleep(TIMING.shakeMid, signal);
      el.pack.classList.remove("is-shake-mid");
      el.pack.classList.add("is-shake-hard");
      setTheaterShake("hard");
      spawnBurst(40, "gold");
      el.introTagline.textContent = "OPEN!";
      await sleep(TIMING.shakeHard, signal);
      el.pack.classList.remove("is-shake-hard");
      el.pack.classList.add("is-burst");
      triggerFlash(true);
      spawnBurst(70, "special");
      await sleep(TIMING.burstHold, signal);
    } else {
      el.pack.classList.add("is-burst");
      await delay(TIMING.reducedStep, signal);
    }

    if (generation !== runGeneration) return;
    await runRevealSequence(signal, generation);
  } catch (err) {
    if (isAbortError(err)) {
      // Skip / hardReset / Herladen — land on board if we still own this run
      if (generation === runGeneration && phase !== "idle") {
        finishToGallery(generation);
      }
      return;
    }
    const message = err instanceof Error ? err.message : "Openen mislukt.";
    setStatus(message, true);
    resetToIntro();
  }
}

function resetToIntro() {
  hardReset();
  showStage("intro");
  phase = "idle";
  const ready = packCards.length > 0;
  setIntroControlsEnabled(ready);
  el.subtitle.textContent = ready
    ? `${packCards.length} cijfers klaar om te trekken`
    : "Geen cijfers gevonden";
  el.introTagline.textContent = ready ? "Tik op het pakket of open hieronder" : "Geen pakket";
  el.packCount.textContent =
    packCards.length === 1 ? "1 kaart" : `${packCards.length} kaarten`;
}

function replayPack() {
  // Only from end board; abort any stray work then reshuffle
  if (phase !== "gallery" && phase !== "idle") return;
  packCards = dramatizeOrder(packCards.filter((c) => normalizeCard(c)));
  resetToIntro();
}

function registerEvents() {
  const startOpen = () => {
    void openPack();
  };

  el.openBtn.addEventListener("click", startOpen);
  el.pack.addEventListener("click", () => {
    if (phase !== "idle" || el.pack.disabled) return;
    startOpen();
  });

  el.replayBtn.addEventListener("click", () => {
    if (el.replayBtn.disabled) return;
    el.replayBtn.disabled = true;
    try {
      replayPack();
    } finally {
      // Re-enable after reset lands on intro (button is in gallery, hidden)
      queueMicrotask(() => {
        el.replayBtn.disabled = false;
      });
    }
  });

  el.skipBtn.addEventListener("click", () => {
    if (phase !== "revealing" && phase !== "opening") return;
    runAbort?.abort();
  });

  window.addEventListener("resize", () => {
    if (particles.length) resizeCanvas();
  });

  // Pagehide covers iframe teardown / Herladen navigation
  window.addEventListener("pagehide", () => {
    hardReset({ keepPhase: "idle" });
  });
}

/**
 * @param {SomtodayGrade[]} normal
 * @param {SomtodayGrade[]} exam
 */
function buildPackFromGrades(normal, exam) {
  /** @type {PackCard[]} */
  const cards = [];
  for (const g of normal) {
    const c = toCard(g, "voortgang");
    if (c) cards.push(c);
  }
  for (const g of exam) {
    const c = toCard(g, "examen");
    if (c) cards.push(c);
  }
  return dramatizeOrder(cards);
}

async function main() {
  motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  prefersReducedMotion = motionQuery.matches;
  const onMotionChange = () => {
    prefersReducedMotion = motionQuery?.matches ?? false;
  };
  if (typeof motionQuery.addEventListener === "function") {
    motionQuery.addEventListener("change", onMotionChange);
  } else if (typeof motionQuery.addListener === "function") {
    motionQuery.addListener(onMotionChange);
  }

  resizeCanvas();
  registerEvents();
  showStage("intro");
  phase = "idle";
  setIntroControlsEnabled(false);

  try {
    const context = await cyfers.getContext();
    const studentId = context.students?.[0]?.id;
    if (!studentId) {
      el.subtitle.textContent = "Geen leerling gevonden";
      el.packCount.textContent = "0 kaarten";
      el.introTagline.textContent = "Geen pakket";
      setStatus("Geen leerling in je sessie.", true);
      return;
    }

    // One endpoint failing must not wipe the other dossier
    const [normalResult, examResult] = await Promise.allSettled([
      loadGrades("geldendvoortgangsdossierresultaten", studentId),
      loadGrades("geldendexamendossierresultaten", studentId),
    ]);

    const normal = normalResult.status === "fulfilled" ? normalResult.value : [];
    const exam = examResult.status === "fulfilled" ? examResult.value : [];
    const loadErrors = [normalResult, examResult]
      .filter((r) => r.status === "rejected")
      .map((r) => (r.status === "rejected" && r.reason instanceof Error ? r.reason.message : "Laden mislukt"));

    if (normalResult.status === "rejected" && examResult.status === "rejected") {
      el.subtitle.textContent = "Laden mislukt";
      el.introTagline.textContent = "Laden mislukt";
      el.packCount.textContent = "0 kaarten";
      setStatus(loadErrors[0] || "Laden mislukt.", true);
      return;
    }

    packCards = buildPackFromGrades(normal, exam);

    const pagedHint =
      normal.length >= PAGE_SIZE || exam.length >= PAGE_SIZE
        ? ` (max. ${PAGE_SIZE} per dossier via API-paginering)`
        : "";

    if (!packCards.length) {
      el.subtitle.textContent = "Geen cijfers gevonden";
      el.packCount.textContent = "0 kaarten";
      el.introTagline.textContent = "Geen pakket";
      setStatus(
        loadErrors.length
          ? `Geen cijfers om te openen. (${loadErrors[0]})`
          : "Er zijn nog geen cijfers om te openen.",
      );
      return;
    }

    if (loadErrors.length) {
      setStatus(`Een deel van de cijfers kon niet geladen worden. ${loadErrors[0]}`);
    }

    el.subtitle.textContent = `${packCards.length} cijfers klaar om te trekken${pagedHint}`;
    el.packCount.textContent =
      packCards.length === 1 ? "1 kaart" : `${packCards.length} kaarten`;
    el.introTagline.textContent = "Tik op het pakket of open hieronder";
    setIntroControlsEnabled(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    el.subtitle.textContent = "Laden mislukt";
    el.introTagline.textContent = "Laden mislukt";
    el.packCount.textContent = "0 kaarten";
    setStatus(message, true);
    setIntroControlsEnabled(false);
  }
}

main();
