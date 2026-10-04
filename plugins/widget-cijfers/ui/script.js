/** @type {HTMLTableElement} */
const gradesTable = /** @type {HTMLTableElement} */ (document.getElementById("normalGrades"));
/** @type {HTMLTableElement} */
const examGradesTable = /** @type {HTMLTableElement} */ (document.getElementById("examGrades"));
/** @type {HTMLSelectElement} */
const yearPick = /** @type {HTMLSelectElement} */ (document.getElementById("yearPick"));
/** @type {HTMLElement} */
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));

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
  "sort=desc-geldendResultaatCijferInvoer",
].join("&");

/**
 * Past-year per-subject query — matches Somtoday/NONtoday vakresultaten.
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

const state = {
  /** @type {number | null} */
  studentId: null,
  /** @type {SomtodayPlaatsing[]} */
  plaatsingen: [],
  /** @type {string | null} */
  plaatsingKey: null,
  plaatsingHuidig: true,
  loadSeq: 0,
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Path key for plaatsing-scoped APIs — Somtoday/NONtoday uses UUID, not numeric link id.
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

function setStatus(message, kind = "muted") {
  statusEl.hidden = !message;
  statusEl.className = kind;
  statusEl.textContent = message || "";
}

function setActiveTable(which) {
  const showNormal = which === "normal";
  gradesTable.hidden = !showNormal;
  examGradesTable.hidden = showNormal;
  document.getElementById("showNormalGrades").classList.toggle("primary", showNormal);
  document.getElementById("showExamGrades").classList.toggle("primary", !showNormal);
}

function registerEventListeners() {
  document.getElementById("showNormalGrades").addEventListener("click", () => {
    setActiveTable("normal");
  });

  document.getElementById("showExamGrades").addEventListener("click", () => {
    setActiveTable("exam");
  });

  yearPick.addEventListener("change", () => {
    const next = yearPick.value || null;
    state.plaatsingKey = next;
    const selected = state.plaatsingen.find((p) => plaatsingKeyOf(p) === next);
    state.plaatsingHuidig = Boolean(selected?.huidig);
    void loadGrades();
  });
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
function dateOf(grade) {
  const raw = grade.datumInvoer || grade.datumInvoerEerstePoging || grade.datumInvoerTweedePoging;
  if (!raw) return "—";
  return new Date(raw).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** @param {SomtodayGrade} grade */
function isGradeColumn(grade) {
  if (!grade?.type) return true;
  return GRADE_COLUMN_TYPES.has(grade.type);
}

/**
 * @param {HTMLTableElement} table
 * @param {SomtodayGrade[]} items
 */
function fillTable(table, items) {
  const tbody = table.querySelector("tbody");
  tbody.replaceChildren();

  let count = 0;
  for (const grade of items) {
    if (!isGradeColumn(grade)) continue;
    const score = scoreOf(grade);
    if (!score) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(subjectOf(grade))}</td><td>${escapeHtml(score)}</td><td>${escapeHtml(dateOf(grade))}</td>`;
    tbody.appendChild(tr);
    count += 1;
  }

  if (count === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="3" class="muted">Geen cijfers gevonden.</td>`;
    tbody.appendChild(tr);
  }
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
 * @returns {Promise<SomtodayVakGemiddelde[]>}
 */
async function fetchVakgemiddelden(plaatsingKey) {
  /** @type {SomtodayVakGemiddelden} */
  const data = await cyfers.fetch(`/rest/v1/vakkeuzes/plaatsing/${encodeURIComponent(plaatsingKey)}/vakgemiddelden`);
  return Array.isArray(data?.gemiddelden) ? data.gemiddelden : [];
}

/**
 * Discover vak + lichting UUIDs from vakgemiddelden.
 * Live shape: `vakkeuze.vak.UUID` + `vakkeuze.lichting.UUID`
 * (fallback: `relevanteCijferLichting`).
 * @param {SomtodayVakGemiddelde[]} items
 */
function subjectsFromGemiddelden(items) {
  /** @type {Map<string, { vakUuid: string, lichtingUuid: string, name: string }>} */
  const byKey = new Map();
  for (const item of items) {
    const vk = item.vakkeuze;
    if (!vk) continue;
    const vak = vk.vak;
    const lichting = vk.lichting || vk.relevanteCijferLichting;
    const vakUuid = vak?.UUID || vak?.uuid || "";
    const lichtingUuid = lichting?.UUID || lichting?.uuid || "";
    if (!vakUuid || !lichtingUuid) continue;
    const key = `${vakUuid}:${lichtingUuid}`;
    if (byKey.has(key)) continue;
    byKey.set(key, {
      vakUuid,
      lichtingUuid,
      name: vak?.naam || vak?.afkorting || "Vak",
    });
  }
  return [...byKey.values()];
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
 * Past year: no bulk individual-grade list — discover subjects, then fetch
 * voortgang + examen vakresultaten per subject.
 * @param {number} studentId
 * @param {string} plaatsingKey
 */
async function loadPastYearGrades(studentId, plaatsingKey) {
  const averages = await fetchVakgemiddelden(plaatsingKey);
  const subjects = subjectsFromGemiddelden(averages);
  /** @type {SomtodayGrade[]} */
  const normal = [];
  /** @type {SomtodayGrade[]} */
  const exam = [];
  let failures = 0;

  await mapPool(subjects, SUBJECT_CONCURRENCY, async (subject) => {
    const [progress, exams] = await Promise.allSettled([
      fetchVakresultaten("geldendvoortgangsdossierresultaten", studentId, subject.vakUuid, subject.lichtingUuid, plaatsingKey),
      fetchVakresultaten("geldendexamendossierresultaten", studentId, subject.vakUuid, subject.lichtingUuid, plaatsingKey),
    ]);
    if (progress.status === "rejected" && exams.status === "rejected") {
      failures += 1;
      return;
    }
    if (progress.status === "rejected" || exams.status === "rejected") failures += 1;
    if (progress.status === "fulfilled") {
      for (const g of progress.value) {
        if (!g.vak && subject.name) g.vak = { naam: subject.name };
        normal.push(g);
      }
    }
    if (exams.status === "fulfilled") {
      for (const g of exams.value) {
        if (!g.vak && subject.name) g.vak = { naam: subject.name };
        exam.push(g);
      }
    }
  });

  if (!subjects.length) return { normal, exam, partial: false };
  if (!normal.length && !exam.length && failures === subjects.length) {
    throw new Error("Kon geen cijfers laden voor dit schooljaar.");
  }
  return { normal, exam, partial: failures > 0 };
}

async function loadGrades() {
  const seq = ++state.loadSeq;
  const key = state.plaatsingKey;
  const studentId = state.studentId;
  if (!key || studentId == null) {
    fillTable(gradesTable, []);
    fillTable(examGradesTable, []);
    setStatus("Geen plaatsing geselecteerd.");
    return;
  }

  yearPick.disabled = true;
  setStatus("Cijfers laden…", "muted");
  try {
    /** @type {SomtodayGrade[]} */
    let normal;
    /** @type {SomtodayGrade[]} */
    let exam;
    let partial = false;

    if (state.plaatsingHuidig) {
      const [n, e] = await Promise.all([
        loadDossierGrades("geldendvoortgangsdossierresultaten", studentId),
        loadDossierGrades("geldendexamendossierresultaten", studentId),
      ]);
      normal = n;
      exam = e;
    } else {
      const past = await loadPastYearGrades(studentId, key);
      normal = past.normal;
      exam = past.exam;
      partial = past.partial;
    }

    if (seq !== state.loadSeq) return;

    const byDateDesc = (/** @type {SomtodayGrade} */ a, /** @type {SomtodayGrade} */ b) => {
      const ta = Date.parse(a.datumInvoer || a.datumInvoerEerstePoging || "") || 0;
      const tb = Date.parse(b.datumInvoer || b.datumInvoerEerstePoging || "") || 0;
      return tb - ta;
    };
    fillTable(gradesTable, normal.slice().sort(byDateDesc));
    fillTable(examGradesTable, exam.slice().sort(byDateDesc));
    setStatus(partial ? "Niet alle vakken konden worden geladen; je ziet een deel van de cijfers." : "");
  } catch (error) {
    if (seq !== state.loadSeq) return;
    fillTable(gradesTable, []);
    fillTable(examGradesTable, []);
    setStatus(error instanceof Error ? error.message : "Cijfers laden mislukt.", "error");
  } finally {
    if (seq === state.loadSeq) renderYearPick();
  }
}

async function main() {
  try {
    setActiveTable("normal");
    setStatus("Cijfers laden…", "muted");
    const context = await cyfers.getContext();
    const studentId = context.students?.[0]?.id;
    state.studentId = studentId ?? null;
    if (!studentId) {
      fillTable(gradesTable, []);
      fillTable(examGradesTable, []);
      setStatus("Geen leerling gevonden.");
      return;
    }

    state.plaatsingen = await loadPlaatsingen(studentId);
    const current = state.plaatsingen.find((p) => p.huidig) || state.plaatsingen[0] || null;
    state.plaatsingKey = current ? plaatsingKeyOf(current) : null;
    state.plaatsingHuidig = Boolean(current?.huidig);
    renderYearPick();

    if (!state.plaatsingKey) {
      fillTable(gradesTable, []);
      fillTable(examGradesTable, []);
      setStatus("Geen plaatsingen gevonden.");
      return;
    }

    await loadGrades();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    setStatus(message, "error");
    fillTable(gradesTable, []);
    fillTable(examGradesTable, []);
  }
}

registerEventListeners();
main();
