/** @typedef {{ year: number, week: number }} IsoWeek */

/**
 * @typedef {{
 *   id: string,
 *   kind: "afspraak" | "dag" | "week",
 *   dayKey: string | null,
 *   title: string,
 *   type: string,
 *   descriptionHtml: string,
 *   subject: string,
 *   studiewijzer: string,
 *   sortering: number,
 * }} HomeworkItem
 */

const DAY_NAMES = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
const MS_DAY = 24 * 60 * 60 * 1000;
const DONE_STORAGE_KEY = "done-ids";

const weekLabelEl = document.getElementById("weekLabel");
const statusEl = document.getElementById("status");
const calendarEl = document.getElementById("calendar");
const weekStripEl = document.getElementById("weekStrip");
const weekListEl = document.getElementById("weekList");
const prevBtn = /** @type {HTMLButtonElement} */ (document.getElementById("prevWeek"));
const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById("nextWeek"));
const thisBtn = /** @type {HTMLButtonElement} */ (document.getElementById("thisWeek"));

const detailEl = document.getElementById("detail");
const detailBackdrop = document.getElementById("detailBackdrop");
const detailTitle = document.getElementById("detailTitle");
const detailMeta = document.getElementById("detailMeta");
const detailType = document.getElementById("detailType");
const detailBody = document.getElementById("detailBody");
const detailToggle = /** @type {HTMLButtonElement} */ (document.getElementById("detailToggle"));
const detailClose = document.getElementById("detailClose");

/** @type {IsoWeek} */
let currentWeek = isoWeekParts(new Date());
/** @type {number | null} */
let studentId = null;
let loadSeq = 0;
/** @type {Map<string, HomeworkItem>} */
let itemsById = new Map();
/** @type {Set<string>} */
let doneIds = new Set();
/** @type {HomeworkItem | null} */
let openItem = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * ISO week-year + week (Monday-based), matching rooster / Somtoday jaarWeek.
 * @param {Date} date
 * @returns {IsoWeek}
 */
function isoWeekParts(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const year = utc.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / MS_DAY + 1) / 7);
  return { year, week };
}

/**
 * Monday 00:00 local for an ISO week.
 * @param {number} year
 * @param {number} week
 */
function mondayOfIsoWeek(year, week) {
  const jan4 = new Date(year, 0, 4);
  const day = jan4.getDay() || 7;
  const mondayWeek1 = new Date(jan4);
  mondayWeek1.setDate(jan4.getDate() - day + 1);
  const monday = new Date(mondayWeek1);
  monday.setDate(mondayWeek1.getDate() + (week - 1) * 7);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

/**
 * @param {IsoWeek} parts
 * @param {number} delta
 * @returns {IsoWeek}
 */
function shiftWeek(parts, delta) {
  const monday = mondayOfIsoWeek(parts.year, parts.week);
  monday.setDate(monday.getDate() + delta * 7);
  return isoWeekParts(monday);
}

function isSameWeek(a, b) {
  return a.year === b.year && a.week === b.week;
}

/** @param {Date} date */
function formatShortDate(date) {
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/** @param {Date} date */
function formatDayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** @param {IsoWeek} parts */
function formatWeekRangeLabel(parts) {
  const monday = mondayOfIsoWeek(parts.year, parts.week);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  return `Week ${parts.week} · ${formatShortDate(monday)} – ${formatShortDate(friday)}`;
}

/**
 * @param {string | undefined} raw
 * @returns {Date | null}
 */
function parseLocalDateTime(raw) {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) {
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (dateOnly) {
      return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    }
    const fallback = new Date(raw);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] || 0),
  );
}

/** @param {unknown} entity */
function entityId(entity) {
  if (!entity || typeof entity !== "object") return null;
  const links = /** @type {{ links?: { id?: number | string }[] }} */ (entity).links;
  const id = links && links[0] && links[0].id;
  return id == null ? null : String(id);
}

/** @param {string} type */
function typeLabel(type) {
  switch (String(type || "").toUpperCase()) {
    case "GROTE_TOETS":
      return "Grote toets";
    case "TOETS":
      return "Toets";
    case "HUISWERK":
      return "Huiswerk";
    case "":
      return "Opdracht";
    default:
      return String(type)
        .toLowerCase()
        .replaceAll("_", " ")
        .replace(/^\w/, (c) => c.toUpperCase());
  }
}

/**
 * Strip script/style and keep a limited HTML subset for omschrijving.
 * @param {string} html
 */
function sanitizeDescription(html) {
  const raw = String(html || "").trim();
  if (!raw) return "";
  const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return escapeHtml(raw);

  root.querySelectorAll("script, style, iframe, object, embed").forEach((el) => el.remove());
  root.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      const value = attr.value || "";
      if (name.startsWith("on") || name === "style") {
        el.removeAttribute(attr.name);
        return;
      }
      if ((name === "href" || name === "src") && /^\s*javascript:/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return root.innerHTML.trim();
}

/**
 * @param {any} raw
 * @param {"afspraak" | "dag" | "week"} kind
 * @returns {HomeworkItem | null}
 */
function normalizeItem(raw, kind) {
  if (!raw || typeof raw !== "object") return null;
  const id = entityId(raw);
  if (!id) return null;

  const item = raw.studiewijzerItem || {};
  const lesgroep = raw.lesgroep || {};
  const vak = lesgroep.vak || {};
  const studiewijzer = raw.studiewijzer || {};

  const subject =
    vak.naam ||
    vak.afkorting ||
    lesgroep.naam ||
    studiewijzer.naam ||
    "Vak";

  const when = parseLocalDateTime(raw.datumTijd || raw.datum);
  const dayKey = kind === "week" ? null : when ? formatDayKey(when) : null;

  return {
    id: `${kind}:${id}`,
    kind,
    dayKey,
    title: item.onderwerp || "Zonder titel",
    type: item.huiswerkType || "",
    descriptionHtml: sanitizeDescription(item.omschrijving || ""),
    subject: String(subject),
    studiewijzer: String(studiewijzer.naam || ""),
    sortering: Number(raw.sortering) || 0,
  };
}

/**
 * @param {unknown} data
 * @param {"afspraak" | "dag" | "week"} kind
 * @returns {HomeworkItem[]}
 */
function itemsFromResponse(data, kind) {
  const list =
    data && typeof data === "object" && Array.isArray(/** @type {any} */ (data).items)
      ? /** @type {any} */ (data).items
      : Array.isArray(data)
        ? data
        : [];
  /** @type {HomeworkItem[]} */
  const out = [];
  for (const row of list) {
    const normalized = normalizeItem(row, kind);
    if (normalized) out.push(normalized);
  }
  return out;
}

async function loadDoneIds() {
  try {
    const raw = await cyfers.storage.get(DONE_STORAGE_KEY);
    if (!raw) {
      doneIds = new Set();
      return;
    }
    const parsed = JSON.parse(raw);
    doneIds = new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch {
    doneIds = new Set();
  }
}

async function persistDoneIds() {
  await cyfers.storage.set(DONE_STORAGE_KEY, JSON.stringify([...doneIds]));
}

function setStatus(message, isError) {
  if (!message) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.className = "muted";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = isError ? "error" : "muted";
}

/**
 * @param {HomeworkItem} item
 */
function itemButtonHtml(item) {
  const done = doneIds.has(item.id);
  const badge = item.type ? `<span class="hw-badge">${escapeHtml(typeLabel(item.type))}</span>` : "";
  return `
    <li>
      <button type="button" class="hw-item${done ? " is-done" : ""}" data-id="${escapeHtml(item.id)}">
        <span class="hw-subject">${escapeHtml(item.subject)}</span>
        <span class="hw-title">${escapeHtml(item.title)}</span>
        ${badge}
      </button>
    </li>
  `;
}

/**
 * @param {HomeworkItem[]} dayItems
 * @param {HomeworkItem[]} weekItems
 */
function renderCalendar(dayItems, weekItems) {
  const monday = mondayOfIsoWeek(currentWeek.year, currentWeek.week);
  const todayKey = formatDayKey(new Date());
  /** @type {Map<string, HomeworkItem[]>} */
  const byDay = new Map();
  for (let i = 0; i < 5; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    byDay.set(formatDayKey(d), []);
  }
  for (const item of dayItems) {
    if (!item.dayKey || !byDay.has(item.dayKey)) continue;
    byDay.get(item.dayKey).push(item);
  }

  const dayHtml = DAY_NAMES.map((name, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = formatDayKey(d);
    const list = (byDay.get(key) || []).slice().sort((a, b) => {
      if (doneIds.has(a.id) !== doneIds.has(b.id)) return doneIds.has(a.id) ? 1 : -1;
      return a.sortering - b.sortering || a.title.localeCompare(b.title, "nl");
    });
    const body =
      list.length === 0
        ? `<p class="hw-empty">Geen huiswerk</p>`
        : `<ul class="hw-list">${list.map(itemButtonHtml).join("")}</ul>`;
    return `
      <section class="day${key === todayKey ? " is-today" : ""}" aria-label="${escapeHtml(name)}">
        <div class="day-heading">
          <h2 class="day-name">${escapeHtml(name)}</h2>
          <span class="day-date">${escapeHtml(formatShortDate(d))}</span>
        </div>
        ${body}
      </section>
    `;
  }).join("");

  calendarEl.innerHTML = dayHtml;

  if (weekItems.length === 0) {
    weekStripEl.hidden = true;
    weekListEl.innerHTML = "";
  } else {
    weekStripEl.hidden = false;
    const sorted = weekItems.slice().sort((a, b) => {
      if (doneIds.has(a.id) !== doneIds.has(b.id)) return doneIds.has(a.id) ? 1 : -1;
      return a.sortering - b.sortering || a.title.localeCompare(b.title, "nl");
    });
    weekListEl.innerHTML = sorted.map(itemButtonHtml).join("");
  }
}

/**
 * @param {HomeworkItem} item
 */
function openDetail(item) {
  openItem = item;
  detailMeta.textContent = [item.subject, item.studiewijzer].filter(Boolean).join(" · ");
  detailTitle.textContent = item.title;
  detailType.textContent = typeLabel(item.type);
  if (item.descriptionHtml) {
    detailBody.innerHTML = item.descriptionHtml;
    detailBody.classList.remove("detail-empty");
  } else {
    detailBody.innerHTML = `<p class="detail-empty">Geen omschrijving.</p>`;
  }
  const done = doneIds.has(item.id);
  detailToggle.textContent = done ? "Markeer als open" : "Markeer als gedaan";
  detailEl.hidden = false;
}

function closeDetail() {
  openItem = null;
  detailEl.hidden = true;
}

async function toggleDone() {
  if (!openItem) return;
  if (doneIds.has(openItem.id)) doneIds.delete(openItem.id);
  else doneIds.add(openItem.id);
  try {
    await persistDoneIds();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Kon status niet opslaan.", true);
  }
  detailToggle.textContent = doneIds.has(openItem.id) ? "Markeer als open" : "Markeer als gedaan";
  const dayItems = [...itemsById.values()].filter((i) => i.kind !== "week");
  const weekItems = [...itemsById.values()].filter((i) => i.kind === "week");
  renderCalendar(dayItems, weekItems);
}

/**
 * @param {IsoWeek} week
 * @param {number} sid
 */
function buildQuery(week, sid) {
  const jaarWeek = `${week.year}~${String(week.week).padStart(2, "0")}`;
  const params = new URLSearchParams({
    jaarWeek,
    geenDifferentiatieOfGedifferentieerdVoorLeerling: String(sid),
  });
  return params.toString();
}

async function loadWeek() {
  const seq = ++loadSeq;
  weekLabelEl.textContent = formatWeekRangeLabel(currentWeek);
  setStatus("Huiswerk laden…", false);
  calendarEl.innerHTML = "";
  weekStripEl.hidden = true;
  weekListEl.innerHTML = "";
  thisBtn.disabled = isSameWeek(currentWeek, isoWeekParts(new Date()));

  if (studentId == null) {
    setStatus("Geen leerling gevonden in de sessie.", true);
    return;
  }

  const qs = buildQuery(currentWeek, studentId);
  const monday = mondayOfIsoWeek(currentWeek.year, currentWeek.week);
  const weekQs = new URLSearchParams({
    begintNaOfOp: formatDayKey(monday),
    weeknummer: String(currentWeek.week),
    geenDifferentiatieOfGedifferentieerdVoorLeerling: String(studentId),
  }).toString();

  try {
    const [afspraak, dag, week] = await Promise.all([
      cyfers.fetch(`/rest/v1/studiewijzeritemafspraaktoekenningen?${qs}`),
      cyfers.fetch(`/rest/v1/studiewijzeritemdagtoekenningen?${qs}`),
      cyfers.fetch(`/rest/v1/studiewijzeritemweektoekenningen?${weekQs}`),
    ]);
    if (seq !== loadSeq) return;

    const dayItems = [
      ...itemsFromResponse(afspraak, "afspraak"),
      ...itemsFromResponse(dag, "dag"),
    ];
    const weekItems = itemsFromResponse(week, "week");

    itemsById = new Map([...dayItems, ...weekItems].map((item) => [item.id, item]));
    renderCalendar(dayItems, weekItems);
    setStatus("", false);
  } catch (err) {
    if (seq !== loadSeq) return;
    itemsById = new Map();
    calendarEl.innerHTML = "";
    setStatus(err instanceof Error ? err.message : "Laden mislukt.", true);
  }
}

function onListClick(event) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const btn = target.closest("button.hw-item");
  if (!btn) return;
  const id = btn.getAttribute("data-id");
  if (!id) return;
  const item = itemsById.get(id);
  if (item) openDetail(item);
}

prevBtn.addEventListener("click", () => {
  currentWeek = shiftWeek(currentWeek, -1);
  loadWeek();
});
nextBtn.addEventListener("click", () => {
  currentWeek = shiftWeek(currentWeek, 1);
  loadWeek();
});
thisBtn.addEventListener("click", () => {
  currentWeek = isoWeekParts(new Date());
  loadWeek();
});

calendarEl.addEventListener("click", onListClick);
weekListEl.addEventListener("click", onListClick);
detailBackdrop.addEventListener("click", closeDetail);
detailClose.addEventListener("click", closeDetail);
detailToggle.addEventListener("click", () => {
  toggleDone().catch(() => {});
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !detailEl.hidden) closeDetail();
});

async function main() {
  await loadDoneIds();
  const ctx = await cyfers.getContext();
  const student = ctx.students && ctx.students[0];
  studentId = student && typeof student.id === "number" ? student.id : null;
  await loadWeek();
}

main().catch((err) => {
  setStatus(err instanceof Error ? err.message : "Kon niet starten.", true);
});
