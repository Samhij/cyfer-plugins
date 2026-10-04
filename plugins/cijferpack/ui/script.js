/**
 * Cijferpack — FIFA/FC-inspired grade pack opening (Cyfers-branded art).
 *
 * Grades API mirrors widget-cijfers:
 *   GET /rest/v1/geldendvoortgangsdossierresultaten/leerling/{id}
 *   GET /rest/v1/geldendexamendossierresultaten/leerling/{id}
 * with Range items=0-99 (up to 100 per endpoint; combined for the pack).
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
};

/** @type {PackCard[]} */
let packCards = [];
/** @type {AbortController | null} */
let revealAbort = null;
/** @type {(() => void) | null} */
let continueResolve = null;
let prefersReducedMotion = false;
/** @type {number | null} */
let fxRaf = null;
/** @type {{ x: number, y: number, vx: number, vy: number, life: number, color: string, size: number }[]} */
let particles = [];

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function sleep(ms, signal) {
  if (prefersReducedMotion) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
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
  return new Date(raw).toLocaleDateString("nl-NL", {
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
    subject: subjectOf(grade),
    score,
    numeric,
    date: dateOf(grade),
    teacher: teacherOf(grade),
    source,
    tier: tierOf(score, numeric, grade),
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
  // Sprinkle: most commons first, finish with highs
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
 * @param {{ revealed?: boolean, compact?: boolean }} [opts]
 */
function buildCardElement(card, opts = {}) {
  const root = document.createElement("article");
  root.className = `grade-card tier-${card.tier}`;
  root.setAttribute("aria-label", `${card.subject}: ${card.score}`);

  const teacherLine = card.teacher
    ? `<p class="card-meta">${escapeHtml(card.teacher)}</p>`
    : "";
  const sourceLabel = card.source === "examen" ? "Examen" : "Voortgang";

  root.innerHTML = `
    <div class="face face-back" aria-hidden="true"></div>
    <div class="face face-front">
      <div class="card-rating-block">
        <div class="card-rating">${escapeHtml(ratingOf(card))}</div>
        <div class="card-chem">
          <span class="card-tier">${TIER_LABELS[card.tier]}</span>
          <span class="card-source-pill">${sourceLabel}</span>
        </div>
      </div>
      <div class="card-portrait">
        <div class="card-score-hero">${escapeHtml(card.score)}</div>
      </div>
      <div class="card-footer">
        <h3 class="card-subject">${escapeHtml(card.subject)}</h3>
        <p class="card-meta">${escapeHtml(card.date)}</p>
        ${teacherLine}
      </div>
      <div class="card-shine" aria-hidden="true"></div>
    </div>
  `;

  if (opts.revealed || opts.compact) {
    root.style.transform = "rotateY(180deg)";
  }
  return root;
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

function hideContinue() {
  el.continueBtn.hidden = true;
  if (continueResolve) {
    const r = continueResolve;
    continueResolve = null;
    r();
  }
}

/**
 * Wait for continue tap, or auto-advance after ms (unless requireTap).
 * @param {number} autoMs
 * @param {boolean} requireTap
 * @param {AbortSignal} signal
 */
function waitContinue(autoMs, requireTap, signal) {
  if (prefersReducedMotion) return Promise.resolve();

  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;

    const finish = () => {
      if (settled) return;
      settled = true;
      continueResolve = null;
      el.continueBtn.hidden = true;
      el.continueBtn.removeEventListener("click", onTap);
      signal.removeEventListener("abort", onAbort);
      if (timer != null) clearTimeout(timer);
      resolve();
    };

    const onAbort = () => {
      if (settled) return;
      settled = true;
      continueResolve = null;
      el.continueBtn.hidden = true;
      el.continueBtn.removeEventListener("click", onTap);
      if (timer != null) clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };

    const onTap = () => finish();

    continueResolve = finish;
    el.continueBtn.hidden = false;
    el.continueBtn.focus({ preventScroll: true });
    el.continueBtn.addEventListener("click", onTap);
    signal.addEventListener("abort", onAbort, { once: true });

    if (!requireTap) {
      timer = setTimeout(finish, autoMs);
    }
  });
}

function renderGallery() {
  el.galleryGrid.replaceChildren();
  const counts = { special: 0, gold: 0, silver: 0, bronze: 0 };
  for (const card of packCards) {
    counts[card.tier] += 1;
    el.galleryGrid.appendChild(buildCardElement(card, { compact: true }));
  }
  el.galleryMeta.textContent =
    `${packCards.length} kaarten · ` +
    `${counts.special} speciaal · ${counts.gold} goud · ${counts.silver} zilver · ${counts.bronze} brons`;
}

/**
 * @param {PackCard} card
 * @param {number} index
 * @param {AbortSignal} signal
 */
async function revealOne(card, index, signal) {
  el.revealHost.replaceChildren();
  clearBeams();
  hideContinue();

  const node = buildCardElement(card);
  el.revealHost.appendChild(node);
  el.revealProgress.textContent = `Kaart ${index + 1} van ${packCards.length}`;

  const intense = card.tier === "gold" || card.tier === "special";
  const walkout = card.tier === "special";

  if (prefersReducedMotion) {
    armRarityFx(card.tier);
    node.style.transform = "rotateY(180deg)";
    await waitContinue(200, false, signal);
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

  // Beat pause before flip — the FIFA "is it…?" moment
  if (intense) {
    armRarityFx(card.tier);
    node.classList.add("is-await");
    spawnBurst(card.tier === "special" ? 40 : 24, card.tier === "special" ? "special" : "gold");
    const beat = card.tier === "special" ? TIMING.specialBeat : TIMING.goldBeat;
    await sleep(beat, signal);
    node.classList.remove("is-await");
  } else if (card.tier === "silver") {
    el.beams.classList.add("is-on");
    await sleep(220, signal);
  }

  // Flip
  node.classList.remove("is-enter", "is-walkout");
  void node.offsetWidth;
  node.classList.add("is-flipping");
  if (intense) {
    triggerFlash(card.tier === "special");
    spawnBurst(card.tier === "special" ? 48 : 28, card.tier === "special" ? "special" : "gold");
    setTheaterShake(card.tier === "special" ? "hard" : "soft");
  } else {
    spawnBurst(12, "sparks");
  }

  await sleep(850, signal);
  node.classList.add("is-hero");

  const hold =
    card.tier === "special"
      ? TIMING.specialHold
      : card.tier === "gold"
        ? TIMING.goldHold
        : card.tier === "silver"
          ? TIMING.silverHold
          : TIMING.bronzeHold;

  await sleep(Math.min(hold, 600), signal);

  const requireTap = card.tier === "special" || card.tier === "gold";
  const auto =
    card.tier === "special"
      ? TIMING.autoAdvanceGold + 800
      : card.tier === "gold"
        ? TIMING.autoAdvanceGold
        : card.tier === "silver"
          ? TIMING.autoAdvanceSilver
          : TIMING.autoAdvanceBronze;

  el.continueBtn.textContent =
    index === packCards.length - 1 ? "Naar overzicht" : "Tik om door te gaan";
  await waitContinue(auto, requireTap, signal);
}

/**
 * @param {AbortSignal} signal
 */
async function runRevealSequence(signal) {
  showStage("reveal");
  el.skipBtn.hidden = false;
  el.pack.classList.remove("is-shake-soft", "is-shake-mid", "is-shake-hard", "is-burst");

  for (let i = 0; i < packCards.length; i += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    await revealOne(packCards[i], i, signal);
  }

  finishToGallery();
}

function finishToGallery() {
  revealAbort = null;
  hideContinue();
  el.skipBtn.hidden = true;
  clearBeams();
  stopFxLoop();
  el.theater.classList.remove("is-shaking", "is-shaking-hard");
  renderGallery();
  showStage("gallery");
  el.subtitle.textContent = `${packCards.length} cijfers geopend`;
}

async function openPack() {
  if (!packCards.length) return;

  el.openBtn.disabled = true;
  el.pack.disabled = true;
  el.introTagline.textContent = "Pakket trilt…";

  if (!prefersReducedMotion) {
    el.pack.classList.add("is-shake-soft");
    spawnBurst(16, "sparks");
    await sleep(TIMING.shakeSoft);
    el.pack.classList.remove("is-shake-soft");
    el.pack.classList.add("is-shake-mid");
    setTheaterShake("soft");
    spawnBurst(28, "burst");
    await sleep(TIMING.shakeMid);
    el.pack.classList.remove("is-shake-mid");
    el.pack.classList.add("is-shake-hard");
    setTheaterShake("hard");
    spawnBurst(40, "gold");
    el.introTagline.textContent = "OPEN!";
    await sleep(TIMING.shakeHard);
    el.pack.classList.remove("is-shake-hard");
    el.pack.classList.add("is-burst");
    triggerFlash(true);
    spawnBurst(70, "special");
    await sleep(TIMING.burstHold);
  } else {
    el.pack.classList.add("is-burst");
  }

  revealAbort?.abort();
  revealAbort = new AbortController();
  try {
    await runRevealSequence(revealAbort.signal);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      finishToGallery();
      return;
    }
    throw err;
  }
}

function resetToIntro() {
  revealAbort?.abort();
  revealAbort = null;
  hideContinue();
  clearBeams();
  stopFxLoop();
  el.theater.classList.remove("is-shaking", "is-shaking-hard");
  el.pack.classList.remove("is-shake-soft", "is-shake-mid", "is-shake-hard", "is-burst");
  el.flash.classList.remove("is-on");
  el.chromatic.classList.remove("is-on");
  el.revealHost.replaceChildren();
  showStage("intro");
  const ready = packCards.length > 0;
  el.openBtn.disabled = !ready;
  el.pack.disabled = !ready;
  el.subtitle.textContent = ready
    ? `${packCards.length} cijfers klaar om te trekken`
    : "Geen cijfers gevonden";
  el.introTagline.textContent = ready ? "Tik op het pakket of open hieronder" : "Geen pakket";
  el.packCount.textContent =
    packCards.length === 1 ? "1 kaart" : `${packCards.length} kaarten`;
}

function registerEvents() {
  const startOpen = () => {
    openPack().catch((error) => {
      const message = error instanceof Error ? error.message : "Openen mislukt.";
      setStatus(message, true);
      resetToIntro();
    });
  };

  el.openBtn.addEventListener("click", startOpen);
  el.pack.addEventListener("click", () => {
    if (!el.pack.disabled) startOpen();
  });

  el.replayBtn.addEventListener("click", () => {
    packCards = dramatizeOrder(packCards);
    resetToIntro();
  });

  el.skipBtn.addEventListener("click", () => {
    revealAbort?.abort();
  });

  window.addEventListener("resize", () => {
    if (particles.length) resizeCanvas();
  });
}

async function main() {
  prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  resizeCanvas();
  registerEvents();
  showStage("intro");

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

    const [normal, exam] = await Promise.all([
      loadGrades("geldendvoortgangsdossierresultaten", studentId),
      loadGrades("geldendexamendossierresultaten", studentId),
    ]);

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

    packCards = dramatizeOrder(cards);

    const pagedHint =
      normal.length >= PAGE_SIZE || exam.length >= PAGE_SIZE
        ? ` (max. ${PAGE_SIZE} per dossier via API-paginering)`
        : "";

    if (!packCards.length) {
      el.subtitle.textContent = "Geen cijfers gevonden";
      el.packCount.textContent = "0 kaarten";
      el.introTagline.textContent = "Geen pakket";
      setStatus("Er zijn nog geen cijfers om te openen.");
      return;
    }

    el.subtitle.textContent = `${packCards.length} cijfers klaar om te trekken${pagedHint}`;
    el.packCount.textContent =
      packCards.length === 1 ? "1 kaart" : `${packCards.length} kaarten`;
    el.introTagline.textContent = "Tik op het pakket of open hieronder";
    el.openBtn.disabled = false;
    el.pack.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    el.subtitle.textContent = "Laden mislukt";
    el.introTagline.textContent = "Laden mislukt";
    setStatus(message, true);
  }
}

main();
