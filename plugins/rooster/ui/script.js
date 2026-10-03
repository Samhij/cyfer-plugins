/** @typedef {{ year: number, week: number }} IsoWeek */

const DAY_NAMES = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
const MS_DAY = 24 * 60 * 60 * 1000;

const weekLabelEl = document.getElementById("weekLabel");
const statusEl = document.getElementById("status");
const daysEl = document.getElementById("days");
const prevBtn = /** @type {HTMLButtonElement} */ (document.getElementById("prevWeek"));
const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById("nextWeek"));
const thisBtn = /** @type {HTMLButtonElement} */ (document.getElementById("thisWeek"));

/** @type {IsoWeek} */
let currentWeek = isoWeekParts(new Date());
/** @type {number | null} */
let studentId = null;
let loadSeq = 0;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * ISO week-year + week (Monday-based), matching Somtoday afspraakitems path params.
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

/**
 * @param {string | undefined} raw
 * @returns {Date | null}
 */
function parseLocalDateTime(raw) {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(raw);
  if (!m) {
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

/** @param {Date} date */
function formatTime(date) {
  return date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

/** @param {Date} date */
function formatShortDate(date) {
  return date.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
}

/** @param {IsoWeek} parts */
function formatWeekRangeLabel(parts) {
  const monday = mondayOfIsoWeek(parts.year, parts.week);
  const friday = new Date(monday);
  friday.setDate(monday.getDate() + 4);
  const range = `${formatShortDate(monday)} – ${formatShortDate(friday)}`;
  return `Week ${parts.week} · ${range}`;
}

/**
 * @param {SomtodayAfspraakItem} item
 */
function subjectOf(item) {
  return item.vak?.naam || item.vak?.afkorting || item.titel || "Les";
}

/**
 * @param {SomtodayAfspraakItem} item
 */
function teacherOf(item) {
  if (Array.isArray(item.docentNamen) && item.docentNamen.length) {
    return item.docentNamen.filter(Boolean).join(", ");
  }
  const abbr = item.additionalObjects?.docentAfkortingen;
  if (typeof abbr === "string" && abbr.trim()) return abbr.trim();
  return "";
}

/**
 * @param {SomtodayAfspraakItem} item
 */
function groupOf(item) {
  if (!Array.isArray(item.lesgroepen) || !item.lesgroepen.length) return "";
  return item.lesgroepen
    .map((g) => g.naam || g.omschrijving)
    .filter(Boolean)
    .join(", ");
}

/**
 * @param {SomtodayAfspraakItem} item
 */
function periodOf(item) {
  if (item.beginLesuur == null) return "";
  if (item.eindLesuur != null && item.eindLesuur !== item.beginLesuur) {
    return `${item.beginLesuur}e–${item.eindLesuur}e uur`;
  }
  return `${item.beginLesuur}e uur`;
}

/**
 * @param {"muted" | "empty" | "error"} kind
 * @param {string} message
 */
function setStatus(kind, message) {
  statusEl.hidden = !message;
  statusEl.className = kind;
  statusEl.textContent = message;
}

function setNavEnabled(enabled) {
  prevBtn.disabled = !enabled;
  nextBtn.disabled = !enabled;
  thisBtn.disabled = !enabled;
}

function updateWeekChrome() {
  weekLabelEl.textContent = formatWeekRangeLabel(currentWeek);
  thisBtn.hidden = isSameWeek(currentWeek, isoWeekParts(new Date()));
}

/**
 * @param {SomtodayAfspraakItem[]} items
 */
function renderDays(items) {
  const monday = mondayOfIsoWeek(currentWeek.year, currentWeek.week);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  /** @type {SomtodayAfspraakItem[][]} */
  const byDay = [[], [], [], [], []];

  for (const item of items) {
    const start = parseLocalDateTime(item.beginDatumTijd);
    if (!start) continue;
    const weekday = (start.getDay() + 6) % 7; // Mon=0 … Sun=6
    if (weekday > 4) continue; // skip weekend
    byDay[weekday].push(item);
  }

  for (const dayItems of byDay) {
    dayItems.sort((a, b) => {
      const ta = parseLocalDateTime(a.beginDatumTijd)?.getTime() ?? 0;
      const tb = parseLocalDateTime(b.beginDatumTijd)?.getTime() ?? 0;
      return ta - tb;
    });
  }

  daysEl.replaceChildren();
  let total = 0;

  for (let i = 0; i < 5; i += 1) {
    const dayDate = new Date(monday);
    dayDate.setDate(monday.getDate() + i);
    const isToday = dayDate.getTime() === today.getTime();
    const dayItems = byDay[i];
    total += dayItems.length;

    const section = document.createElement("section");
    section.className = isToday ? "day today" : "day";

    const heading = document.createElement("div");
    heading.className = "day-heading";
    heading.innerHTML = `<h2>${escapeHtml(DAY_NAMES[i])}</h2><span class="date">${escapeHtml(formatShortDate(dayDate))}</span>`;
    section.appendChild(heading);

    if (dayItems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty day-empty";
      empty.textContent = "Geen lessen";
      section.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "lessons";
      for (const item of dayItems) {
        list.appendChild(renderLesson(item));
      }
      section.appendChild(list);
    }

    daysEl.appendChild(section);
  }

  if (total === 0) {
    setStatus("empty", "Geen lessen deze week.");
  } else {
    setStatus("muted", "");
  }
}

/**
 * @param {SomtodayAfspraakItem} item
 */
function renderLesson(item) {
  const li = document.createElement("li");
  li.className = "lesson";

  const start = parseLocalDateTime(item.beginDatumTijd);
  const end = parseLocalDateTime(item.eindDatumTijd);
  const time =
    start && end
      ? `${formatTime(start)}–${formatTime(end)}`
      : start
        ? formatTime(start)
        : "—";
  const period = periodOf(item);
  const teacher = teacherOf(item);
  const location = (item.locatie || "").trim();
  const group = groupOf(item);

  const metaParts = [teacher, location, group].filter(Boolean);

  li.innerHTML = `
    <div class="lesson-time">
      <span>${escapeHtml(time)}</span>
      ${period ? `<span class="lesson-period">${escapeHtml(period)}</span>` : ""}
    </div>
    <p class="lesson-subject">${escapeHtml(subjectOf(item))}</p>
    ${metaParts.length ? `<p class="lesson-meta">${escapeHtml(metaParts.join(" · "))}</p>` : ""}
  `;
  return li;
}

async function loadWeek() {
  const seq = ++loadSeq;
  updateWeekChrome();
  setNavEnabled(false);
  setStatus("muted", "Laden…");
  daysEl.replaceChildren();

  if (!studentId) {
    setStatus("error", "Geen leerling gevonden in de sessie.");
    setNavEnabled(true);
    return;
  }

  try {
    const path =
      `/rest/v1/afspraakitems/${studentId}/jaar/${currentWeek.year}/week/${currentWeek.week}` +
      "?additional=docentAfkortingen";
    /** @type {SomtodayListResponse<SomtodayAfspraakItem>} */
    const data = await cyfers.fetch(path);
    if (seq !== loadSeq) return;
    renderDays(data?.items ?? []);
  } catch (error) {
    if (seq !== loadSeq) return;
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    setStatus("error", message);
    daysEl.replaceChildren();
  } finally {
    if (seq === loadSeq) setNavEnabled(true);
  }
}

async function main() {
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

  try {
    const context = await cyfers.getContext();
    studentId = context.students?.[0]?.id ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Context laden mislukt.";
    setStatus("error", message);
    weekLabelEl.textContent = "Rooster";
    return;
  }

  await loadWeek();
}

main();
