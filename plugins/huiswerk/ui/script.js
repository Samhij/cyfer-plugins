/** @typedef {{ year: number, week: number }} IsoWeek */

/**
 * @typedef {{
 *   id: string,
 *   toekenningId: number,
 *   kind: "afspraak" | "dag" | "week",
 *   dayKey: string | null,
 *   title: string,
 *   type: string,
 *   descriptionHtml: string,
 *   subject: string,
 *   studiewijzer: string,
 *   sortering: number,
 *   gemaakt: boolean,
 * }} HomeworkItem
 */

const DAY_NAMES = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
const MS_DAY = 24 * 60 * 60 * 1000;

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
/** @type {HomeworkItem | null} */
let openItem = null;
let toggleBusy = false;

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
  const links = /** @type {{ links?: { id?: number | string, rel?: string }[] }} */ (entity).links;
  if (!Array.isArray(links) || links.length === 0) return null;
  const self = links.find((l) => l && l.rel === "self") || links[0];
  return self && self.id != null ? Number(self.id) : null;
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
    case "LESSTOF":
      return "Lesstof";
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
 * Official Leerling client reads gemaakt from additionalObjects.swigemaaktVinkjes.
 * @param {any} raw
 * @param {number} sid
 */
function readGemaakt(raw, sid) {
  const wrap = raw && raw.additionalObjects && raw.additionalObjects.swigemaaktVinkjes;
  const list = wrap && Array.isArray(wrap.items) ? wrap.items : [];
  const match = list.find((row) => {
    const leerling = row && row.leerling;
    const id = entityId(leerling);
    return id != null && id === sid;
  });
  return Boolean(match && match.gemaakt);
}

/**
 * @param {any} raw
 * @param {"afspraak" | "dag" | "week"} kind
 * @param {number} sid
 * @returns {HomeworkItem | null}
 */
function normalizeItem(raw, kind, sid) {
  if (!raw || typeof raw !== "object") return null;
  const toekenningId = entityId(raw);
  if (toekenningId == null || Number.isNaN(toekenningId)) return null;

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
    id: `${kind}:${toekenningId}`,
    toekenningId,
    kind,
    dayKey,
    title: item.onderwerp || "Zonder titel",
    type: item.huiswerkType || "",
    descriptionHtml: sanitizeDescription(item.omschrijving || ""),
    subject: String(subject),
    studiewijzer: String(studiewijzer.naam || ""),
    sortering: Number(raw.sortering) || 0,
    gemaakt: readGemaakt(raw, sid),
  };
}

/**
 * @param {unknown} data
 * @param {"afspraak" | "dag" | "week"} kind
 * @param {number} sid
 * @returns {HomeworkItem[]}
 */
function itemsFromResponse(data, kind, sid) {
  const list =
    data && typeof data === "object" && Array.isArray(/** @type {any} */ (data).items)
      ? /** @type {any} */ (data).items
      : Array.isArray(data)
        ? data
        : [];
  /** @type {HomeworkItem[]} */
  const out = [];
  for (const row of list) {
    const normalized = normalizeItem(row, kind, sid);
    if (normalized) out.push(normalized);
  }
  return out;
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
  const badge = item.type ? `<span class="hw-badge">${escapeHtml(typeLabel(item.type))}</span>` : "";
  return `
    <li>
      <button type="button" class="hw-item${item.gemaakt ? " is-done" : ""}" data-id="${escapeHtml(item.id)}">
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
      if (a.gemaakt !== b.gemaakt) return a.gemaakt ? 1 : -1;
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
      if (a.gemaakt !== b.gemaakt) return a.gemaakt ? 1 : -1;
      return a.sortering - b.sortering || a.title.localeCompare(b.title, "nl");
    });
    weekListEl.innerHTML = sorted.map(itemButtonHtml).join("");
  }
}

function refreshOpenDetailToggle() {
  if (!openItem) return;
  detailToggle.disabled = toggleBusy;
  detailToggle.textContent = openItem.gemaakt ? "Markeer als open" : "Markeer als gedaan";
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
  refreshOpenDetailToggle();
  detailEl.hidden = false;
}

function closeDetail() {
  openItem = null;
  detailEl.hidden = true;
}

/**
 * Official Somtoday Leerling client: PUT /rest/v1/swigemaakt/cou
 * (NONtoday/leerling-source HuiswerkState.toggleAfgevinkt).
 * @param {HomeworkItem} item
 * @param {boolean} gemaakt
 */
async function putGemaakt(item, gemaakt) {
  if (studentId == null) throw new Error("Geen leerling gevonden.");
  const result = await cyfers.fetch("/rest/v1/swigemaakt/cou", {
    method: "PUT",
    body: {
      leerling: {
        links: [
          {
            id: studentId,
            rel: "self",
            type: "leerling.RLeerlingPrimer",
          },
        ],
      },
      swiToekenningId: item.toekenningId,
      gemaakt,
    },
  });
  const next =
    result && typeof result === "object" && "gemaakt" in /** @type {object} */ (result)
      ? Boolean(/** @type {{ gemaakt?: boolean }} */ (result).gemaakt)
      : gemaakt;
  return next;
}

async function toggleDone() {
  if (!openItem || toggleBusy || studentId == null) return;
  toggleBusy = true;
  refreshOpenDetailToggle();
  const target = !openItem.gemaakt;
  try {
    const next = await putGemaakt(openItem, target);
    openItem.gemaakt = next;
    itemsById.set(openItem.id, openItem);
    const dayItems = [...itemsById.values()].filter((i) => i.kind !== "week");
    const weekItems = [...itemsById.values()].filter((i) => i.kind === "week");
    renderCalendar(dayItems, weekItems);
    setStatus("", false);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : "Afvinken mislukt.", true);
  } finally {
    toggleBusy = false;
    refreshOpenDetailToggle();
  }
}

/**
 * Mirror official `_buildHuiswerkRequest` query shape (minus unused additionals).
 * @param {Record<string, string | number>} weekParam
 * @param {number} sid
 */
function buildQuery(weekParam, sid) {
  const params = new URLSearchParams();
  params.set("geenDifferentiatieOfGedifferentieerdVoorLeerling", String(sid));
  for (const [key, value] of Object.entries(weekParam)) {
    params.set(key, String(value));
  }
  // Official client always requests swigemaaktVinkjes to know gedaan-state.
  params.append("additional", "swigemaaktVinkjes");
  params.append("additional", "lesgroep");
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

  const jaarWeek = `${currentWeek.year}~${String(currentWeek.week).padStart(2, "0")}`;
  const dayQs = buildQuery({ jaarWeek }, studentId);
  const weekQs = buildQuery({ weeknummer: currentWeek.week }, studentId);

  try {
    const [afspraak, dag, week] = await Promise.all([
      cyfers.fetch(`/rest/v1/studiewijzeritemafspraaktoekenningen?${dayQs}`),
      cyfers.fetch(`/rest/v1/studiewijzeritemdagtoekenningen?${dayQs}`),
      cyfers.fetch(`/rest/v1/studiewijzeritemweektoekenningen?${weekQs}`),
    ]);
    if (seq !== loadSeq) return;

    const dayItems = [
      ...itemsFromResponse(afspraak, "afspraak", studentId),
      ...itemsFromResponse(dag, "dag", studentId),
    ];
    const weekItems = itemsFromResponse(week, "week", studentId);

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
  const ctx = await cyfers.getContext();
  const student = ctx.students && ctx.students[0];
  studentId = student && typeof student.id === "number" ? student.id : null;
  await loadWeek();
}

main().catch((err) => {
  setStatus(err instanceof Error ? err.message : "Kon niet starten.", true);
});
