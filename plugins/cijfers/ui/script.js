/** @type {HTMLSelectElement} */
const yearPick = /** @type {HTMLSelectElement} */ (document.getElementById("yearPick"));
/** @type {HTMLElement} */
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));
/** @type {HTMLElement} */
const subtitleEl = /** @type {HTMLElement} */ (document.getElementById("subtitle"));
/** @type {HTMLElement} */
const latestList = /** @type {HTMLElement} */ (document.getElementById("latestList"));
/** @type {HTMLElement} */
const subjectList = /** @type {HTMLElement} */ (document.getElementById("subjectList"));
/** @type {HTMLElement} */
const combinedAverage = /** @type {HTMLElement} */ (document.getElementById("combinedAverage"));
/** @type {HTMLElement} */
const combinedValue = /** @type {HTMLElement} */ (document.getElementById("combinedValue"));
/** @type {HTMLElement} */
const mainView = /** @type {HTMLElement} */ (document.getElementById("mainView"));
/** @type {HTMLElement} */
const detailView = /** @type {HTMLElement} */ (document.getElementById("detailView"));
/** @type {HTMLElement} */
const detailTitle = /** @type {HTMLElement} */ (document.getElementById("detailTitle"));
/** @type {HTMLElement} */
const detailAvg = /** @type {HTMLElement} */ (document.getElementById("detailAvg"));
/** @type {HTMLElement} */
const detailStatus = /** @type {HTMLElement} */ (document.getElementById("detailStatus"));
/** @type {HTMLElement} */
const detailGrades = /** @type {HTMLElement} */ (document.getElementById("detailGrades"));

const SUBJECT_CONCURRENCY = 4;

/** Current-year dossier list — individual toets columns. */
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
  "sort=desc-geldendResultaatCijferInvoer",
].join("&");

/**
 * Past-year / per-subject query — matches Somtoday leerling-source vakresultaten.
 * Average column types are requested then filtered client-side.
 */
const VAK_QUERY = [
  "additional=vaknaam",
  "additional=resultaatkolom",
  "additional=heeftalternatiefniveau",
  "additional=naamalternatiefniveau",
  "additional=naamstandaardniveau",
  "additional=leerjaar",
  "additional=periodeAfkorting",
  "type=Toetskolom",
  "type=SamengesteldeToetsKolom",
  "type=Werkstukcijferkolom",
  "type=Advieskolom",
  "type=PeriodeGemiddeldeKolom",
  "type=RapportGemiddeldeKolom",
  "type=RapportCijferKolom",
  "type=RapportToetskolom",
  "type=SEGemiddeldeKolom",
  "type=ToetssoortGemiddeldeKolom",
  "sort=desc-geldendResultaatCijferInvoer",
].join("&");

/** Real grade columns (not periode-/rapport-/SE-/toetssoort-gemiddelden). */
const GRADE_COLUMN_TYPES = new Set([
  "Toetskolom",
  "DeeltoetsKolom",
  "SamengesteldeToetsKolom",
  "Werkstukcijferkolom",
  "Advieskolom",
  "RapportCijferKolom",
  "RapportToetskolom",
]);

/**
 * @typedef {{
 *   dossier: "voortgang" | "examen",
 *   grade: SomtodayGrade,
 * }} TaggedGrade
 */

/**
 * @typedef {{
 *   vakUuid: string,
 *   lichtingUuid: string,
 *   name: string,
 *   voortgangAvg: string | null,
 *   examenAvg: string | null,
 *   voortgangNumeric: number | null,
 *   examenNumeric: number | null,
 *   raw: SomtodayVakGemiddelde,
 * }} SubjectRow
 */

/**
 * @typedef {{
 *   avg: number | null,
 *   totalWeight: number,
 * }} CalcStats
 */

/** @returns {{ voortgang: CalcStats, examen: CalcStats }} */
function emptyCalcByDossier() {
  return {
    voortgang: { avg: null, totalWeight: 0 },
    examen: { avg: null, totalWeight: 0 },
  };
}

const state = {
  /** @type {number | null} */
  studentId: null,
  /** @type {SomtodayPlaatsing[]} */
  plaatsingen: [],
  /** @type {string | null} */
  plaatsingKey: null,
  plaatsingHuidig: true,
  /** @type {"latest" | "subjects"} */
  tab: "latest",
  /** @type {TaggedGrade[]} */
  latest: [],
  /** @type {SubjectRow[]} */
  subjects: [],
  /** @type {number | null} */
  combinedAvg: null,
  /** @type {SubjectRow | null} */
  activeSubject: null,
  /** @type {"voortgang" | "examen"} */
  calcDossier: "voortgang",
  /** @type {{ voortgang: CalcStats, examen: CalcStats }} */
  calcByDossier: emptyCalcByDossier(),
  loadSeq: 0,
  detailSeq: 0,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Path key for plaatsing-scoped APIs — leerling-source uses UUID, not numeric link id.
 * @param {SomtodayPlaatsing} plaatsing
 */
function plaatsingKeyOf(plaatsing) {
  const uuid = plaatsing.UUID || plaatsing.uuid;
  if (uuid) return String(uuid);
  const selfId = plaatsing.links?.find((l) => l.rel === "self" && l.id != null)?.id;
  return selfId != null ? String(selfId) : "";
}

/** @param {SomtodayPlaatsing} plaatsing */
function plaatsingLabelOf(plaatsing) {
  const year = plaatsing.schooljaar?.naam?.trim();
  if (year) return year;
  if (plaatsing.leerjaar != null) return `Leerjaar ${plaatsing.leerjaar}`;
  return "Schooljaar";
}

/** @param {SomtodayPlaatsing[]} items */
function sortPlaatsingen(items) {
  return items.slice().sort((a, b) => {
    const ta = a.vanafDatum ? Date.parse(a.vanafDatum) : NaN;
    const tb = b.vanafDatum ? Date.parse(b.vanafDatum) : NaN;
    if (Number.isFinite(tb) && Number.isFinite(ta) && tb !== ta) return tb - ta;
    return plaatsingLabelOf(b).localeCompare(plaatsingLabelOf(a), "nl");
  });
}

/**
 * @param {HTMLElement} el
 * @param {string} message
 * @param {string} [kind]
 */
function setStatusOn(el, message, kind = "muted") {
  el.hidden = !message;
  el.className = kind;
  el.textContent = message || "";
}

function setStatus(message, kind = "muted") {
  setStatusOn(statusEl, message, kind);
}

function setDetailStatus(message, kind = "muted") {
  setStatusOn(detailStatus, message, kind);
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

/** @param {SomtodayGrade} grade */
function numericScoreOf(grade) {
  if (grade.isLabel === true) return null;
  const candidates = [grade.cijfer, grade.geldendResultaatCijferInvoer, grade.geldendResultaat, grade.resultaat];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && c.trim()) {
      const n = Number(c.replace(",", "."));
      if (Number.isFinite(n)) return n;
    }
  }
  const formatted = grade.formattedResultaat || grade.label;
  if (typeof formatted === "string" && formatted.trim()) {
    const n = Number(formatted.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

/** @param {SomtodayGrade} grade */
function dateRawOf(grade) {
  return grade.datumInvoer || grade.datumInvoerEerstePoging || grade.datumInvoerTweedePoging || "";
}

/** @param {SomtodayGrade} grade */
function dateOf(grade) {
  const raw = dateRawOf(grade);
  if (!raw) return "—";
  return new Date(raw).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** @param {SomtodayGrade} grade */
function columnTitleOf(grade) {
  const kolom = grade.additionalObjects?.resultaatkolom;
  if (typeof kolom === "string" && kolom) return kolom;
  if (kolom && typeof kolom === "object") return kolom.naam || kolom.omschrijving || "";
  return grade.omschrijving || grade.toetscode || grade.toetssoort || "";
}

/** @param {SomtodayGrade} grade */
function isGradeColumn(grade) {
  if (!grade?.type) return true;
  return GRADE_COLUMN_TYPES.has(grade.type);
}

/** @param {SomtodayGrade | undefined} result */
function avgDisplayOf(result) {
  if (!result) return null;
  return scoreOf(result);
}

/** @param {SomtodayGrade | undefined} result */
function avgNumericOf(result) {
  if (!result) return null;
  return numericScoreOf(result);
}

function formatNumber(n, digits = 1) {
  return n.toLocaleString("nl-NL", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function isFailScore(score) {
  const n = typeof score === "number" ? score : Number(String(score).replace(",", "."));
  return Number.isFinite(n) && n < 5.5;
}

/**
 * @param {number} studentId
 * @returns {Promise<SomtodayPlaatsing[]>}
 */
async function loadPlaatsingen(studentId) {
  /** @type {SomtodayListResponse<SomtodayPlaatsing>} */
  const data = await cyfers.fetch(`/rest/v1/plaatsingen?leerling=${studentId}`);
  const items = Array.isArray(data?.items) ? data.items : [];
  return sortPlaatsingen(items.filter((p) => plaatsingKeyOf(p)));
}

/**
 * @param {string} kind
 * @param {number} studentId
 * @returns {Promise<SomtodayGrade[]>}
 */
async function loadDossierGrades(kind, studentId) {
  /** @type {SomtodayListResponse<SomtodayGrade>} */
  const data = await cyfers.fetch(`/rest/v1/${kind}/leerling/${studentId}?${QUERY}`, {
    headers: { range: "items=0-99" },
  });
  return data?.items ?? [];
}

/**
 * @param {string} plaatsingKey
 * @returns {Promise<SomtodayVakGemiddelden>}
 */
async function fetchVakgemiddelden(plaatsingKey) {
  return /** @type {SomtodayVakGemiddelden} */ (
    await cyfers.fetch(`/rest/v1/vakkeuzes/plaatsing/${encodeURIComponent(plaatsingKey)}/vakgemiddelden`)
  );
}

/**
 * @param {SomtodayVakGemiddelde[]} items
 * @returns {SubjectRow[]}
 */
function subjectsFromGemiddelden(items) {
  /** @type {SubjectRow[]} */
  const rows = [];
  for (const item of items) {
    const vk = item.vakkeuze;
    if (!vk) continue;
    const vak = vk.vak;
    const lichting = vk.lichting || vk.relevanteCijferLichting;
    const vakUuid = vak?.UUID || vak?.uuid || "";
    const lichtingUuid = lichting?.UUID || lichting?.uuid || "";
    if (!vakUuid || !lichtingUuid) continue;
    const name = vak?.naam || vak?.afkorting || "Vak";
    rows.push({
      vakUuid,
      lichtingUuid,
      name,
      voortgangAvg: avgDisplayOf(item.voortgangsdossierResultaat),
      examenAvg: avgDisplayOf(item.examendossierResultaat),
      voortgangNumeric: avgNumericOf(item.voortgangsdossierResultaat),
      examenNumeric: avgNumericOf(item.examendossierResultaat),
      raw: item,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, "nl"));
  return rows;
}

/**
 * @template T, R
 * @param {T[]} items
 * @param {number} concurrency
 * @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapPool(items, concurrency, fn) {
  /** @type {R[]} */
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * @param {string} dossier
 * @param {number} studentId
 * @param {string} vakUuid
 * @param {string} lichtingUuid
 * @param {string} plaatsingKey
 * @returns {Promise<SomtodayGrade[]>}
 */
async function fetchVakresultaten(dossier, studentId, vakUuid, lichtingUuid, plaatsingKey) {
  const path =
    `/rest/v1/${dossier}/vakresultaten/${studentId}` +
    `/vak/${encodeURIComponent(vakUuid)}` +
    `/lichting/${encodeURIComponent(lichtingUuid)}` +
    `?${VAK_QUERY}&plaatsingUuid=${encodeURIComponent(plaatsingKey)}`;
  /** @type {SomtodayListResponse<SomtodayGrade> | SomtodayGrade[]} */
  const data = /** @type {any} */ (await cyfers.fetch(path));
  if (Array.isArray(data)) return data;
  return Array.isArray(data?.items) ? data.items : [];
}

/**
 * @param {SomtodayGrade[]} items
 * @param {"voortgang" | "examen"} dossier
 * @returns {TaggedGrade[]}
 */
function tagGrades(items, dossier) {
  /** @type {TaggedGrade[]} */
  const out = [];
  for (const grade of items) {
    if (!isGradeColumn(grade)) continue;
    if (!scoreOf(grade)) continue;
    out.push({ dossier, grade });
  }
  return out;
}

/**
 * Past year: discover subjects, then fetch voortgang + examen vakresultaten.
 * @param {number} studentId
 * @param {string} plaatsingKey
 * @param {SubjectRow[]} subjects
 */
async function loadPastYearGrades(studentId, plaatsingKey, subjects) {
  /** @type {TaggedGrade[]} */
  const latest = [];
  let failures = 0;

  await mapPool(subjects, SUBJECT_CONCURRENCY, async (subject) => {
    const [progress, exams] = await Promise.allSettled([
      fetchVakresultaten(
        "geldendvoortgangsdossierresultaten",
        studentId,
        subject.vakUuid,
        subject.lichtingUuid,
        plaatsingKey,
      ),
      fetchVakresultaten(
        "geldendexamendossierresultaten",
        studentId,
        subject.vakUuid,
        subject.lichtingUuid,
        plaatsingKey,
      ),
    ]);
    if (progress.status === "rejected" && exams.status === "rejected") {
      failures += 1;
      return;
    }
    if (progress.status === "rejected" || exams.status === "rejected") failures += 1;
    if (progress.status === "fulfilled") {
      for (const g of progress.value) {
        if (!g.vak && subject.name) g.vak = { naam: subject.name };
        latest.push(...tagGrades([g], "voortgang"));
      }
    }
    if (exams.status === "fulfilled") {
      for (const g of exams.value) {
        if (!g.vak && subject.name) g.vak = { naam: subject.name };
        latest.push(...tagGrades([g], "examen"));
      }
    }
  });

  if (subjects.length && !latest.length && failures === subjects.length) {
    throw new Error("Kon geen cijfers laden voor dit schooljaar.");
  }
  return { latest, partial: failures > 0 };
}

function byDateDesc(/** @type {TaggedGrade} */ a, /** @type {TaggedGrade} */ b) {
  const ta = Date.parse(dateRawOf(a.grade)) || 0;
  const tb = Date.parse(dateRawOf(b.grade)) || 0;
  return tb - ta;
}

function renderYearPick() {
  if (!state.plaatsingen.length) {
    yearPick.innerHTML = `<option value="">Geen schooljaren</option>`;
    yearPick.disabled = true;
    return;
  }
  yearPick.innerHTML = state.plaatsingen
    .map((p) => {
      const key = plaatsingKeyOf(p);
      const label = plaatsingLabelOf(p);
      const selected = key === state.plaatsingKey ? " selected" : "";
      return `<option value="${escapeHtml(key)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
  yearPick.disabled = false;
}

function setTab(tab) {
  state.tab = tab;
  const latestTab = document.getElementById("tab-latest");
  const subjectsTab = document.getElementById("tab-subjects");
  const panelLatest = document.getElementById("panel-latest");
  const panelSubjects = document.getElementById("panel-subjects");
  const isLatest = tab === "latest";
  latestTab?.classList.toggle("is-active", isLatest);
  subjectsTab?.classList.toggle("is-active", !isLatest);
  latestTab?.setAttribute("aria-selected", String(isLatest));
  subjectsTab?.setAttribute("aria-selected", String(!isLatest));
  if (panelLatest) panelLatest.hidden = !isLatest;
  if (panelSubjects) panelSubjects.hidden = isLatest;
}

/**
 * @param {TaggedGrade} item
 * @param {{ showSubject?: boolean }} [opts]
 */
function gradeRowHtml(item, opts = {}) {
  const { dossier, grade } = item;
  const score = scoreOf(grade) || "—";
  const title = columnTitleOf(grade);
  const weight = grade.weging != null && Number.isFinite(Number(grade.weging)) ? Number(grade.weging) : null;
  const badgeClass = dossier === "examen" ? "badge-examen" : "badge-voortgang";
  const badgeLabel = dossier === "examen" ? "Examen" : "Voortgang";
  const fail = isFailScore(numericScoreOf(grade) ?? score);
  const subjectLine = opts.showSubject !== false
    ? `<div class="grade-subject">${escapeHtml(subjectOf(grade))}</div>`
    : "";
  const metaBits = [
    `<span class="badge ${badgeClass}">${badgeLabel}</span>`,
    `<span>${escapeHtml(dateOf(grade))}</span>`,
  ];
  if (title) metaBits.push(`<span>${escapeHtml(title)}</span>`);
  if (weight != null) metaBits.push(`<span>×${escapeHtml(String(weight))}</span>`);

  return `
    <article class="grade-row${dossier === "examen" ? " is-examen" : ""}">
      <div class="grade-main">
        ${subjectLine}
        <div class="grade-meta">${metaBits.join("")}</div>
      </div>
      <div class="grade-score${fail ? " is-fail" : ""}">${escapeHtml(score)}</div>
    </article>
  `;
}

function renderLatest() {
  if (!state.latest.length) {
    latestList.innerHTML = `<p class="empty-row">Geen cijfers gevonden.</p>`;
    return;
  }
  latestList.innerHTML = state.latest.map((item) => gradeRowHtml(item)).join("");
}

function renderSubjects() {
  if (!state.subjects.length) {
    subjectList.innerHTML = `<p class="empty-row">Geen vakken gevonden.</p>`;
    combinedAverage.hidden = true;
    return;
  }

  subjectList.innerHTML = state.subjects
    .map((s, index) => {
      const parts = [];
      if (s.voortgangAvg) {
        parts.push(`
          <div class="subject-avg-item">
            <span class="subject-avg-label">Voortgang</span>
            <span class="subject-avg-value${isFailScore(s.voortgangNumeric ?? s.voortgangAvg) ? " is-fail" : ""}">${escapeHtml(s.voortgangAvg)}</span>
          </div>
        `);
      }
      if (s.examenAvg) {
        parts.push(`
          <div class="subject-avg-item">
            <span class="subject-avg-label">Examen</span>
            <span class="subject-avg-value${isFailScore(s.examenAvg) ? " is-fail" : ""}">${escapeHtml(s.examenAvg)}</span>
          </div>
        `);
      }
      if (!parts.length) {
        parts.push(`
          <div class="subject-avg-item">
            <span class="subject-avg-label">Gemiddelde</span>
            <span class="subject-avg-value">—</span>
          </div>
        `);
      }
      return `
        <button type="button" class="subject-row" data-subject-index="${index}">
          <span class="subject-name">${escapeHtml(s.name)}</span>
          <span class="subject-avgs">${parts.join("")}</span>
        </button>
      `;
    })
    .join("");

  if (state.combinedAvg != null) {
    combinedAverage.hidden = false;
    combinedValue.textContent = formatNumber(state.combinedAvg, 1);
    combinedValue.classList.toggle("is-fail", isFailScore(state.combinedAvg));
  } else {
    combinedAverage.hidden = true;
  }
}

function showMain() {
  mainView.hidden = false;
  detailView.hidden = true;
  state.activeSubject = null;
  state.calcByDossier = emptyCalcByDossier();
  state.calcDossier = "voortgang";
}

/**
 * @param {SomtodayGrade[]} grades
 * @returns {CalcStats}
 */
function weightedStats(grades) {
  let sum = 0;
  let totalWeight = 0;
  for (const g of grades) {
    if (!isGradeColumn(g)) continue;
    const score = numericScoreOf(g);
    if (score == null) continue;
    const w = g.weging != null && Number.isFinite(Number(g.weging)) ? Number(g.weging) : 1;
    if (w <= 0) continue;
    sum += score * w;
    totalWeight += w;
  }
  if (totalWeight <= 0) return { avg: null, totalWeight: 0 };
  return { avg: sum / totalWeight, totalWeight };
}

/** @param {CalcStats} stats */
function dossierUsable(stats) {
  return stats.avg != null && stats.totalWeight > 0;
}

/**
 * Prefer voortgang when usable; otherwise examen; otherwise leave current if still usable.
 */
function pickDefaultCalcDossier() {
  const v = state.calcByDossier.voortgang;
  const e = state.calcByDossier.examen;
  if (dossierUsable(v)) return "voortgang";
  if (dossierUsable(e)) return "examen";
  if (v.avg != null) return "voortgang";
  if (e.avg != null) return "examen";
  return "voortgang";
}

function syncCalcDossierToggle() {
  const toggle = document.getElementById("calcDossier");
  if (!toggle) return;
  const vOk = dossierUsable(state.calcByDossier.voortgang) || state.calcByDossier.voortgang.avg != null;
  const eOk = dossierUsable(state.calcByDossier.examen) || state.calcByDossier.examen.avg != null;
  const show = vOk && eOk;
  toggle.hidden = !show;

  for (const btn of toggle.querySelectorAll(".dossier-btn")) {
    const dossier = /** @type {"voortgang" | "examen"} */ (btn.getAttribute("data-dossier"));
    const ok = dossier === "voortgang" ? vOk : eOk;
    btn.disabled = !ok;
    btn.classList.toggle("is-active", dossier === state.calcDossier);
  }

  const intro = document.getElementById("calcIntro");
  if (intro) {
    const label = state.calcDossier === "examen" ? "examen" : "voortgang";
    intro.textContent =
      `Op basis van je ${label}gemiddelde en het totale gewicht van die cijfers. ` +
      "Alleen numerieke cijfers tellen mee.";
  }
}

/** @param {"voortgang" | "examen"} dossier */
function setCalcDossier(dossier) {
  const stats = state.calcByDossier[dossier];
  if (!dossierUsable(stats) && stats.avg == null) return;
  state.calcDossier = dossier;
  syncCalcDossierToggle();
  updateCalculators();
}

/**
 * @param {SubjectRow} subject
 */
async function openSubject(subject) {
  const seq = ++state.detailSeq;
  state.activeSubject = subject;
  mainView.hidden = true;
  detailView.hidden = false;
  detailTitle.textContent = subject.name;
  const avgParts = [];
  if (subject.voortgangAvg) avgParts.push(`Voortgang ${subject.voortgangAvg}`);
  if (subject.examenAvg) avgParts.push(`Examen ${subject.examenAvg}`);
  detailAvg.textContent = avgParts.length ? avgParts.join(" · ") : "Geen gemiddelde";
  detailGrades.innerHTML = `<p class="empty-row muted">Cijfers laden…</p>`;
  setDetailStatus("");

  state.calcByDossier = {
    voortgang: { avg: subject.voortgangNumeric, totalWeight: 0 },
    examen: { avg: subject.examenNumeric, totalWeight: 0 },
  };
  state.calcDossier = pickDefaultCalcDossier();
  syncCalcDossierToggle();
  updateCalculators();

  const studentId = state.studentId;
  const plaatsingKey = state.plaatsingKey;
  if (studentId == null || !plaatsingKey) {
    detailGrades.innerHTML = `<p class="empty-row">Geen plaatsing geselecteerd.</p>`;
    return;
  }

  try {
    const [progress, exams] = await Promise.allSettled([
      fetchVakresultaten(
        "geldendvoortgangsdossierresultaten",
        studentId,
        subject.vakUuid,
        subject.lichtingUuid,
        plaatsingKey,
      ),
      fetchVakresultaten(
        "geldendexamendossierresultaten",
        studentId,
        subject.vakUuid,
        subject.lichtingUuid,
        plaatsingKey,
      ),
    ]);
    if (seq !== state.detailSeq) return;

    /** @type {TaggedGrade[]} */
    const rows = [];
    if (progress.status === "fulfilled") {
      rows.push(...tagGrades(progress.value, "voortgang"));
      const stats = weightedStats(progress.value);
      state.calcByDossier.voortgang = {
        avg: stats.avg ?? subject.voortgangNumeric,
        totalWeight: stats.totalWeight,
      };
    }
    if (exams.status === "fulfilled") {
      rows.push(...tagGrades(exams.value, "examen"));
      const stats = weightedStats(exams.value);
      state.calcByDossier.examen = {
        avg: stats.avg ?? subject.examenNumeric,
        totalWeight: stats.totalWeight,
      };
    }
    if (progress.status === "rejected" && exams.status === "rejected") {
      throw new Error("Kon cijfers voor dit vak niet laden.");
    }
    if (progress.status === "rejected" || exams.status === "rejected") {
      setDetailStatus("Niet alle dossiers konden worden geladen.", "muted");
    }

    state.calcDossier = pickDefaultCalcDossier();
    syncCalcDossierToggle();

    rows.sort(byDateDesc);
    if (!rows.length) {
      detailGrades.innerHTML = `<p class="empty-row">Geen cijfers voor dit vak.</p>`;
    } else {
      detailGrades.innerHTML = rows.map((item) => gradeRowHtml(item, { showSubject: false })).join("");
    }
    updateCalculators();
  } catch (error) {
    if (seq !== state.detailSeq) return;
    detailGrades.innerHTML = `<p class="empty-row">Geen cijfers geladen.</p>`;
    setDetailStatus(error instanceof Error ? error.message : "Laden mislukt.", "error");
  }
}

function parseInputNumber(/** @type {HTMLInputElement} */ input) {
  const raw = input.value.trim().replace(",", ".");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function updateCalculators() {
  const newResult = document.getElementById("newAvgResult");
  const neededResult = document.getElementById("neededResult");
  if (!newResult || !neededResult) return;

  const stats = state.calcByDossier[state.calcDossier];
  const avg = stats.avg;
  const weightTotal = stats.totalWeight;
  const dossierLabel = state.calcDossier === "examen" ? "examen" : "voortgang";

  if (avg == null || weightTotal <= 0) {
    const msg =
      avg == null
        ? `Geen numeriek ${dossierLabel}gemiddelde beschikbaar.`
        : "Geen wegingen gevonden — rekenhulp niet mogelijk.";
    newResult.textContent = msg;
    newResult.className = "calc-result is-error";
    neededResult.textContent = msg;
    neededResult.className = "calc-result is-error";
    return;
  }

  const grade = parseInputNumber(/** @type {HTMLInputElement} */ (document.getElementById("newGrade")));
  const newWeight = parseInputNumber(/** @type {HTMLInputElement} */ (document.getElementById("newWeight")));
  if (grade != null && newWeight != null && newWeight > 0) {
    const next = (avg * weightTotal + grade * newWeight) / (weightTotal + newWeight);
    newResult.textContent = `Nieuw gemiddelde: ${formatNumber(next, 2)}`;
    newResult.className = "calc-result";
  } else {
    newResult.textContent = `Huidig: ${formatNumber(avg, 2)} (gewicht ${formatNumber(weightTotal, 1)})`;
    newResult.className = "calc-result muted";
  }

  const desired = parseInputNumber(/** @type {HTMLInputElement} */ (document.getElementById("desiredAvg")));
  const neededWeight = parseInputNumber(/** @type {HTMLInputElement} */ (document.getElementById("neededWeight")));
  if (desired != null && neededWeight != null && neededWeight > 0) {
    const needed = (desired * (weightTotal + neededWeight) - avg * weightTotal) / neededWeight;
    let note = "";
    if (needed < 1) note = " (lager dan 1)";
    else if (needed > 10) note = " (hoger dan 10 — niet haalbaar)";
    neededResult.textContent = `Benodigd cijfer: ${formatNumber(needed, 2)}${note}`;
    neededResult.className = needed > 10 || needed < 1 ? "calc-result is-error" : "calc-result";
  } else {
    neededResult.textContent = `Huidig: ${formatNumber(avg, 2)} (gewicht ${formatNumber(weightTotal, 1)})`;
    neededResult.className = "calc-result muted";
  }
}

async function loadAll() {
  const seq = ++state.loadSeq;
  const key = state.plaatsingKey;
  const studentId = state.studentId;
  if (!key || studentId == null) {
    state.latest = [];
    state.subjects = [];
    state.combinedAvg = null;
    renderLatest();
    renderSubjects();
    setStatus("Geen plaatsing geselecteerd.");
    subtitleEl.textContent = "Geen plaatsing";
    return;
  }

  yearPick.disabled = true;
  setStatus("Cijfers laden…", "muted");
  subtitleEl.textContent = "Laden…";

  try {
    const averagesPayload = await fetchVakgemiddelden(key);
    if (seq !== state.loadSeq) return;

    const averages = Array.isArray(averagesPayload?.gemiddelden) ? averagesPayload.gemiddelden : [];
    state.subjects = subjectsFromGemiddelden(averages);
    state.combinedAvg =
      typeof averagesPayload?.voortgangsdossierGemiddelde === "number"
        ? averagesPayload.voortgangsdossierGemiddelde
        : null;

    /** @type {TaggedGrade[]} */
    let latest = [];
    let partial = false;

    if (state.plaatsingHuidig) {
      const [n, e] = await Promise.all([
        loadDossierGrades("geldendvoortgangsdossierresultaten", studentId),
        loadDossierGrades("geldendexamendossierresultaten", studentId),
      ]);
      if (seq !== state.loadSeq) return;
      latest = [...tagGrades(n, "voortgang"), ...tagGrades(e, "examen")];
    } else {
      const past = await loadPastYearGrades(studentId, key, state.subjects);
      if (seq !== state.loadSeq) return;
      latest = past.latest;
      partial = past.partial;
    }

    latest.sort(byDateDesc);
    state.latest = latest;

    const selected = state.plaatsingen.find((p) => plaatsingKeyOf(p) === key);
    subtitleEl.textContent = selected ? plaatsingLabelOf(selected) : "Schooljaar";
    renderLatest();
    renderSubjects();
    setStatus(partial ? "Niet alle vakken konden worden geladen; je ziet een deel van de cijfers." : "");
  } catch (error) {
    if (seq !== state.loadSeq) return;
    state.latest = [];
    state.subjects = [];
    state.combinedAvg = null;
    renderLatest();
    renderSubjects();
    setStatus(error instanceof Error ? error.message : "Cijfers laden mislukt.", "error");
    subtitleEl.textContent = "Fout bij laden";
  } finally {
    if (seq === state.loadSeq) renderYearPick();
  }
}

function registerEventListeners() {
  document.getElementById("tab-latest")?.addEventListener("click", () => {
    if (!detailView.hidden) showMain();
    setTab("latest");
  });
  document.getElementById("tab-subjects")?.addEventListener("click", () => {
    if (!detailView.hidden) showMain();
    setTab("subjects");
  });

  document.getElementById("refreshBtn")?.addEventListener("click", () => {
    void loadAll();
  });

  document.getElementById("backBtn")?.addEventListener("click", () => {
    showMain();
    setTab("subjects");
  });

  yearPick.addEventListener("change", () => {
    const next = yearPick.value || null;
    state.plaatsingKey = next;
    const selected = state.plaatsingen.find((p) => plaatsingKeyOf(p) === next);
    state.plaatsingHuidig = Boolean(selected?.huidig);
    showMain();
    void loadAll();
  });

  subjectList.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const btn = target.closest("[data-subject-index]");
    if (!btn) return;
    const index = Number(btn.getAttribute("data-subject-index"));
    const subject = state.subjects[index];
    if (subject) void openSubject(subject);
  });

  for (const id of ["newGrade", "newWeight", "desiredAvg", "neededWeight"]) {
    document.getElementById(id)?.addEventListener("input", updateCalculators);
  }

  document.getElementById("calcDossier")?.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const btn = target.closest(".dossier-btn");
    if (!btn || !(btn instanceof HTMLButtonElement) || btn.disabled) return;
    const dossier = btn.getAttribute("data-dossier");
    if (dossier === "voortgang" || dossier === "examen") setCalcDossier(dossier);
  });

  document.getElementById("calcNewAvg")?.addEventListener("submit", (e) => e.preventDefault());
  document.getElementById("calcNeeded")?.addEventListener("submit", (e) => e.preventDefault());
}

async function main() {
  try {
    setTab("latest");
    setStatus("Cijfers laden…", "muted");
    const context = await cyfers.getContext();
    const studentId = context.students?.[0]?.id;
    state.studentId = studentId ?? null;
    if (!studentId) {
      setStatus("Geen leerling gevonden.");
      subtitleEl.textContent = "Geen leerling";
      return;
    }

    state.plaatsingen = await loadPlaatsingen(studentId);
    const current = state.plaatsingen.find((p) => p.huidig) || state.plaatsingen[0] || null;
    state.plaatsingKey = current ? plaatsingKeyOf(current) : null;
    state.plaatsingHuidig = Boolean(current?.huidig);
    renderYearPick();

    if (!state.plaatsingKey) {
      setStatus("Geen plaatsingen gevonden.");
      subtitleEl.textContent = "Geen plaatsingen";
      return;
    }

    await loadAll();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    setStatus(message, "error");
    subtitleEl.textContent = "Fout bij laden";
  }
}

registerEventListeners();
main();
