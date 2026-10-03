/**
 * Cijferpack — FIFA-style grade pack opening.
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

/** @type {PackCard[]} */
let packCards = [];
/** @type {AbortController | null} */
let revealAbort = null;
let prefersReducedMotion = false;

const el = {
  subtitle: /** @type {HTMLElement} */ (document.getElementById("subtitle")),
  status: /** @type {HTMLElement} */ (document.getElementById("status")),
  intro: /** @type {HTMLElement} */ (document.getElementById("intro")),
  reveal: /** @type {HTMLElement} */ (document.getElementById("reveal")),
  gallery: /** @type {HTMLElement} */ (document.getElementById("gallery")),
  openBtn: /** @type {HTMLButtonElement} */ (document.getElementById("openBtn")),
  replayBtn: /** @type {HTMLButtonElement} */ (document.getElementById("replayBtn")),
  skipBtn: /** @type {HTMLButtonElement} */ (document.getElementById("skipBtn")),
  pack: /** @type {HTMLElement} */ (document.getElementById("pack")),
  packCount: /** @type {HTMLElement} */ (document.getElementById("packCount")),
  flash: /** @type {HTMLElement} */ (document.getElementById("flash")),
  particles: /** @type {HTMLElement} */ (document.getElementById("particles")),
  revealHost: /** @type {HTMLElement} */ (document.getElementById("revealCardHost")),
  revealProgress: /** @type {HTMLElement} */ (document.getElementById("revealProgress")),
  galleryGrid: /** @type {HTMLElement} */ (document.getElementById("galleryGrid")),
  galleryMeta: /** @type {HTMLElement} */ (document.getElementById("galleryMeta")),
};

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
  const kolom = grade.additionalObjects?.resultaatkolom;
  if (kolom && typeof kolom === "object" && typeof kolom.omschrijving === "string") {
    // Not a teacher — keep for meta only via omschrijving elsewhere.
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
  // Unknown labels: mid tier so they still look pack-worthy
  return "silver";
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
 * Fisher–Yates shuffle (pack drama); stable enough for a session.
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
 * @param {{ flipping?: boolean, revealed?: boolean, compact?: boolean }} [opts]
 */
function buildCardElement(card, opts = {}) {
  const root = document.createElement("article");
  root.className = `grade-card tier-${card.tier}`;
  root.setAttribute("aria-label", `${card.subject}: ${card.score}`);

  const teacherLine = card.teacher
    ? `<p class="card-meta">${escapeHtml(card.teacher)}</p>`
    : "";
  const sourceLine =
    card.source === "examen" ? `<p class="card-meta">Examen</p>` : "";

  root.innerHTML = `
    <div class="face face-back" aria-hidden="true"></div>
    <div class="face face-front">
      <span class="card-tier">${TIER_LABELS[card.tier]}</span>
      <div class="card-score">${escapeHtml(card.score)}</div>
      <div>
        <h3 class="card-subject">${escapeHtml(card.subject)}</h3>
        <p class="card-meta">${escapeHtml(card.date)}</p>
        ${teacherLine}
        ${sourceLine}
      </div>
      <div class="card-shine" aria-hidden="true"></div>
    </div>
  `;

  if (opts.revealed || opts.compact) {
    root.style.transform = "rotateY(180deg)";
  }
  return root;
}

function spawnParticles(count = 28) {
  if (prefersReducedMotion) return;
  el.particles.replaceChildren();
  for (let i = 0; i < count; i += 1) {
    const p = document.createElement("span");
    p.className = "particle";
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 140;
    p.style.left = "50%";
    p.style.top = "50%";
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    p.style.animation = `particle-fly ${0.7 + Math.random() * 0.5}s ease-out forwards`;
    p.style.animationDelay = `${Math.random() * 0.15}s`;
    const colors = ["#ffe566", "#ff6a35", "#fff", "#e8b87a"];
    p.style.background = colors[i % colors.length];
    el.particles.appendChild(p);
  }
}

function showStage(name) {
  el.intro.hidden = name !== "intro";
  el.reveal.hidden = name !== "reveal";
  el.gallery.hidden = name !== "gallery";
  el.replayBtn.hidden = name === "intro";
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
 * @param {AbortSignal} signal
 */
async function revealOne(card, signal) {
  el.revealHost.replaceChildren();
  const node = buildCardElement(card);
  el.revealHost.appendChild(node);

  const intense = card.tier === "gold" || card.tier === "special";
  if (intense) spawnParticles(intense && card.tier === "special" ? 36 : 22);

  // Force reflow before flip class
  void node.offsetWidth;
  if (prefersReducedMotion) {
    node.style.transform = "rotateY(180deg)";
  } else {
    node.classList.add("is-flipping");
    if (intense) {
      el.flash.classList.remove("is-on");
      void el.flash.offsetWidth;
      el.flash.classList.add("is-on");
    }
  }

  const hold = card.tier === "special" ? 1100 : card.tier === "gold" ? 900 : 650;
  await sleep(hold, signal);
}

/**
 * @param {AbortSignal} signal
 */
async function runRevealSequence(signal) {
  showStage("reveal");
  el.skipBtn.hidden = false;

  const burstCount = Math.min(3, packCards.length);
  // Short multi-card burst for the first few, then one-by-one
  if (!prefersReducedMotion && burstCount > 1) {
    el.revealProgress.textContent = "Pack opens…";
    el.revealHost.replaceChildren();
    for (let i = 0; i < burstCount; i += 1) {
      const mini = buildCardElement(packCards[i]);
      mini.style.position = "absolute";
      mini.style.left = "50%";
      mini.style.top = "50%";
      mini.style.marginLeft = `calc(var(--card-w) / -2 + ${(i - 1) * 18}px)`;
      mini.style.marginTop = `calc(var(--card-h) / -2 + ${(i - 1) * 10}px)`;
      mini.style.zIndex = String(10 - i);
      mini.classList.add("is-burst-in");
      el.revealHost.appendChild(mini);
      await sleep(120, signal);
    }
    await sleep(480, signal);
  }

  for (let i = 0; i < packCards.length; i += 1) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    el.revealProgress.textContent = `Kaart ${i + 1} van ${packCards.length}`;
    await revealOne(packCards[i], signal);
  }

  finishToGallery();
}

function finishToGallery() {
  revealAbort = null;
  el.skipBtn.hidden = true;
  renderGallery();
  showStage("gallery");
  el.subtitle.textContent = `${packCards.length} cijfers geopend`;
}

async function openPack() {
  if (!packCards.length) return;

  el.openBtn.disabled = true;
  el.pack.classList.add("is-ready");

  if (!prefersReducedMotion) {
    el.pack.classList.add("is-shaking");
    spawnParticles(18);
    await sleep(1100);
    el.pack.classList.remove("is-shaking");
    el.pack.classList.add("is-burst");
    el.flash.classList.add("is-on");
    spawnParticles(40);
    await sleep(500);
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
  el.pack.classList.remove("is-shaking", "is-burst");
  el.flash.classList.remove("is-on");
  el.particles.replaceChildren();
  el.revealHost.replaceChildren();
  showStage("intro");
  el.openBtn.disabled = packCards.length === 0;
  el.subtitle.textContent =
    packCards.length > 0
      ? `${packCards.length} cijfers klaar om te trekken`
      : "Geen cijfers gevonden";
  el.packCount.textContent =
    packCards.length === 1 ? "1 kaart" : `${packCards.length} kaarten`;
  if (packCards.length > 0) el.pack.classList.add("is-ready");
}

function registerEvents() {
  el.openBtn.addEventListener("click", () => {
    openPack().catch((error) => {
      const message = error instanceof Error ? error.message : "Openen mislukt.";
      setStatus(message, true);
      resetToIntro();
    });
  });

  el.replayBtn.addEventListener("click", () => {
    packCards = shuffle(packCards);
    resetToIntro();
  });

  el.skipBtn.addEventListener("click", () => {
    revealAbort?.abort();
  });
}

async function main() {
  prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  registerEvents();
  showStage("intro");

  try {
    const context = await cyfers.getContext();
    const studentId = context.students?.[0]?.id;
    if (!studentId) {
      el.subtitle.textContent = "Geen leerling gevonden";
      el.packCount.textContent = "0 kaarten";
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

    packCards = shuffle(cards);

    const pagedHint =
      normal.length >= PAGE_SIZE || exam.length >= PAGE_SIZE
        ? ` (max. ${PAGE_SIZE} per dossier via API-paginering)`
        : "";

    if (!packCards.length) {
      el.subtitle.textContent = "Geen cijfers gevonden";
      el.packCount.textContent = "0 kaarten";
      setStatus("Er zijn nog geen cijfers om te openen.");
      return;
    }

    el.subtitle.textContent = `${packCards.length} cijfers klaar om te trekken${pagedHint}`;
    el.packCount.textContent =
      packCards.length === 1 ? "1 kaart" : `${packCards.length} kaarten`;
    el.pack.classList.add("is-ready");
    el.openBtn.disabled = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    el.subtitle.textContent = "Laden mislukt";
    setStatus(message, true);
  }
}

main();
