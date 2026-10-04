/** @type {HTMLTableElement} */
const gradesTable = /** @type {HTMLTableElement} */ (document.getElementById("normalGrades"));
/** @type {HTMLTableElement} */
const examGradesTable = /** @type {HTMLTableElement} */ (document.getElementById("examGrades"));
/** @type {HTMLSelectElement} */
const yearPick = /** @type {HTMLSelectElement} */ (document.getElementById("yearPick"));
/** @type {HTMLElement} */
const statusEl = /** @type {HTMLElement} */ (document.getElementById("status"));

const state = {
  /** @type {number | null} */
  studentId: null,
  /** @type {SomtodayPlaatsing[]} */
  plaatsingen: [],
  /** @type {string | null} */
  plaatsingKey: null,
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
 * Path key for vakgemiddelden — Somtoday/NONtoday uses UUID, not numeric link id.
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
    state.plaatsingKey = yearPick.value || null;
    void loadGemiddelden();
  });
}

/** @param {SomtodayGrade | undefined} grade */
function scoreOf(grade) {
  if (!grade) return null;
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

/** @param {SomtodayVakGemiddelde} item */
function subjectOf(item) {
  const vak = item.vakkeuze?.vak;
  return vak?.naam || vak?.afkorting || "Vak";
}

/**
 * @param {HTMLTableElement} table
 * @param {{ subject: string, score: string | null, niveau: string }[]} rows
 */
function fillTable(table, rows) {
  const tbody = table.querySelector("tbody");
  tbody.replaceChildren();

  let count = 0;
  for (const row of rows) {
    if (!row.score) continue;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${escapeHtml(row.subject)}</td><td>${escapeHtml(row.score)}</td><td>${escapeHtml(row.niveau || "—")}</td>`;
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
 * @param {string} plaatsingKey
 * @returns {Promise<SomtodayVakGemiddelde[]>}
 */
async function fetchVakgemiddelden(plaatsingKey) {
  /** @type {SomtodayVakGemiddelden} */
  const data = await cyfers.fetch(`/rest/v1/vakkeuzes/plaatsing/${encodeURIComponent(plaatsingKey)}/vakgemiddelden`);
  return Array.isArray(data?.gemiddelden) ? data.gemiddelden : [];
}

async function loadGemiddelden() {
  const seq = ++state.loadSeq;
  const key = state.plaatsingKey;
  if (!key) {
    fillTable(gradesTable, []);
    fillTable(examGradesTable, []);
    setStatus("Geen plaatsing geselecteerd.");
    return;
  }

  yearPick.disabled = true;
  setStatus("Cijfers laden…", "muted");
  try {
    const items = await fetchVakgemiddelden(key);
    if (seq !== state.loadSeq) return;

    const sorted = items.slice().sort((a, b) => subjectOf(a).localeCompare(subjectOf(b), "nl"));
    const normal = sorted.map((item) => ({
      subject: subjectOf(item),
      score: scoreOf(item.voortgangsdossierResultaat || item.voortgangsdossierResultaatAfwijkend),
      niveau: item.niveauOmschrijving || item.afwijkendNiveauOmschrijving || "",
    }));
    const exam = sorted.map((item) => ({
      subject: subjectOf(item),
      score: scoreOf(item.examendossierResultaat),
      niveau: item.niveauOmschrijving || "",
    }));

    fillTable(gradesTable, normal);
    fillTable(examGradesTable, exam);
    setStatus("");
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
    renderYearPick();

    if (!state.plaatsingKey) {
      fillTable(gradesTable, []);
      fillTable(examGradesTable, []);
      setStatus("Geen plaatsingen gevonden.");
      return;
    }

    await loadGemiddelden();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    setStatus(message, "error");
    fillTable(gradesTable, []);
    fillTable(examGradesTable, []);
  }
}

registerEventListeners();
main();
