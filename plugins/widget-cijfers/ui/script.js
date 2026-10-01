const gradesTable = document.getElementById("normalGrades");
const examGradesTable = document.getElementById("examGrades");

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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
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

/**
 * @param {HTMLTableElement} table
 * @param {SomtodayGrade[]} items
 */
function fillTable(table, items) {
  const tbody = table.querySelector("tbody");
  tbody.replaceChildren();

  let count = 0;
  for (const grade of items) {
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

/**
 * @param {string} kind
 * @param {number} studentId
 * @returns {Promise<SomtodayGrade[]>}
 */
async function loadGrades(kind, studentId) {
  /** @type {SomtodayListResponse<SomtodayGrade>} */
  const data = await cyfers.fetch(`/rest/v1/${kind}/leerling/${studentId}?${QUERY}`, {
    headers: { range: "items=0-99" },
  });
  return data?.items ?? [];
}

async function main() {
  try {
    setActiveTable("normal");
    const context = await cyfers.getContext();
    const studentId = context.students?.[0]?.id;
    if (!studentId) {
      fillTable(gradesTable, []);
      fillTable(examGradesTable, []);
      return;
    }

    const [normal, exam] = await Promise.all([
      loadGrades("geldendvoortgangsdossierresultaten", studentId),
      loadGrades("geldendexamendossierresultaten", studentId),
    ]);

    fillTable(gradesTable, normal);
    fillTable(examGradesTable, exam);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    const content = document.getElementById("content");
    const err = document.createElement("p");
    err.className = "error";
    err.textContent = message;
    content.prepend(err);
  }
}

registerEventListeners();
main();
