/** @typedef {{ year: number, week: number }} IsoWeek */

/**
 * @typedef {{
 *   item: SomtodayAfspraakItem,
 *   startMin: number,
 *   endMin: number,
 *   column: number,
 *   columnCount: number,
 * }} LaidOutLesson
 */

const DAY_NAMES = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag"];
const MS_DAY = 24 * 60 * 60 * 1000;
/** Fallback day window when the week has no timed lessons (minutes from midnight). */
const DEFAULT_START_MIN = 8 * 60;
const DEFAULT_END_MIN = 16 * 60;
/** Pixels per hour on the shared timeline. */
const PX_PER_HOUR = 96;
/** Minimum visible card height so short slots stay readable. */
const MIN_CARD_PX = 48;
/** Refresh the “nu” line / current-lesson highlight this often. */
const NOW_TICK_MS = 60_000;

const weekLabelEl = document.getElementById("weekLabel");
const statusEl = document.getElementById("status");
const scheduleEl = document.getElementById("schedule");
const prevBtn = /** @type {HTMLButtonElement} */ (document.getElementById("prevWeek"));
const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById("nextWeek"));
const thisBtn = /** @type {HTMLButtonElement} */ (document.getElementById("thisWeek"));

/** @type {IsoWeek} */
let currentWeek = isoWeekParts(new Date());
/** @type {number | null} */
let studentId = null;
let loadSeq = 0;
/** @type {number} */
let trackStartMin = DEFAULT_START_MIN;
/** @type {number} */
let trackEndMin = DEFAULT_END_MIN;
/** @type {HTMLElement | null} */
let nowLineEl = null;
/** @type {HTMLUListElement | null} */
let todayLessonsListEl = null;
/** @type {number | null} */
let nowTimer = null;

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
function minutesFromMidnight(date) {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

/** @param {Date} date */
function formatTime(date) {
  return date.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
}

/** @param {number} minutes */
function formatHourLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
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

/** Somtoday status code: lesson/appointment cancelled (“uitgevallen”). */
const STATUS_CANCELLED = "4007";
const CANCEL_LABEL_RE = /uitgevallen|vervalt|valt\s*uit/i;

/**
 * @param {SomtodayAfspraakItem} item
 */
function subjectOf(item) {
  return item.vak?.naam || item.vak?.afkorting || item.titel || "Les";
}

/**
 * Cancelled lessons stay in the afspraakitems array with normal times; detect
 * via statusNotifications / status `"4007"` or wijzigingOmschrijving text.
 * @param {SomtodayAfspraakItem} item
 */
function isLessonCancelled(item) {
  if (!item) return false;
  if (String(item.status ?? "") === STATUS_CANCELLED) return true;
  const wijziging = typeof item.wijzigingOmschrijving === "string" ? item.wijzigingOmschrijving.trim() : "";
  if (wijziging && CANCEL_LABEL_RE.test(wijziging)) return true;
  if (Array.isArray(item.statusNotifications)) {
    for (const note of item.statusNotifications) {
      if (!note) continue;
      if (String(note.status ?? "") === STATUS_CANCELLED) return true;
      if (typeof note.message === "string" && CANCEL_LABEL_RE.test(note.message)) return true;
    }
  }
  return false;
}

/**
 * Label for cancelled badge — prefer Somtoday’s change text.
 * @param {SomtodayAfspraakItem} item
 */
function cancellationLabel(item) {
  const wijziging = typeof item.wijzigingOmschrijving === "string" ? item.wijzigingOmschrijving.trim() : "";
  if (wijziging) return wijziging;
  if (Array.isArray(item.statusNotifications)) {
    for (const note of item.statusNotifications) {
      if (note && String(note.status ?? "") === STATUS_CANCELLED && typeof note.message === "string") {
        const msg = note.message.trim();
        if (msg) return msg;
      }
    }
  }
  return "Uitgevallen";
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
 * Classic calendar overlap packing: assign leftmost free column, then split
 * width evenly across the max column count in each overlapping cluster.
 * @param {SomtodayAfspraakItem[]} items
 * @returns {LaidOutLesson[]}
 */
function layoutOverlappingLessons(items) {
  /** @type {LaidOutLesson[]} */
  const events = [];

  for (const item of items) {
    const start = parseLocalDateTime(item.beginDatumTijd);
    const end = parseLocalDateTime(item.eindDatumTijd);
    if (!start) continue;
    let startMin = minutesFromMidnight(start);
    let endMin = end ? minutesFromMidnight(end) : startMin + 45;
    if (endMin <= startMin) endMin = startMin + 15;
    events.push({
      item,
      startMin,
      endMin,
      column: 0,
      columnCount: 1,
    });
  }

  events.sort((a, b) => {
    if (a.startMin !== b.startMin) return a.startMin - b.startMin;
    if (a.endMin !== b.endMin) return b.endMin - a.endMin;
    // Active lessons before cancelled so replacements keep the primary column.
    return Number(isLessonCancelled(a.item)) - Number(isLessonCancelled(b.item));
  });

  /** @type {number[]} end minute of the last event placed in each column */
  const columnEnds = [];

  for (const ev of events) {
    let col = -1;
    for (let c = 0; c < columnEnds.length; c += 1) {
      if (columnEnds[c] <= ev.startMin) {
        col = c;
        break;
      }
    }
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(ev.endMin);
    } else {
      columnEnds[col] = ev.endMin;
    }
    ev.column = col;
  }

  // Cluster by transitive overlap so concurrent groups share one columnCount.
  /** @type {LaidOutLesson[][]} */
  const clusters = [];
  /** @type {LaidOutLesson[]} */
  let active = [];

  for (const ev of events) {
    active = active.filter((other) => other.endMin > ev.startMin);
    if (active.length === 0) {
      clusters.push([ev]);
    } else {
      clusters[clusters.length - 1].push(ev);
    }
    active.push(ev);
  }

  for (const cluster of clusters) {
    const columnCount = Math.max(...cluster.map((e) => e.column)) + 1;
    for (const ev of cluster) {
      ev.columnCount = columnCount;
    }
  }

  return events;
}

/**
 * Snap timeline bounds to whole hours around the week's lessons.
 * @param {LaidOutLesson[][]} byDay
 */
function timelineBounds(byDay) {
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const day of byDay) {
    for (const ev of day) {
      if (ev.startMin < minStart) minStart = ev.startMin;
      if (ev.endMin > maxEnd) maxEnd = ev.endMin;
    }
  }
  if (!Number.isFinite(minStart) || !Number.isFinite(maxEnd)) {
    return { startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN };
  }
  const startMin = Math.max(0, Math.floor(minStart / 60) * 60);
  let endMin = Math.min(24 * 60, Math.ceil(maxEnd / 60) * 60);
  if (endMin <= startMin) endMin = startMin + 60;
  return { startMin, endMin };
}

/**
 * @param {number} startMin
 * @param {number} endMin
 */
function renderHoursAxis(startMin, endMin) {
  const axis = document.createElement("div");
  axis.className = "hours-axis";
  axis.setAttribute("aria-hidden", "true");

  for (let t = startMin; t <= endMin; t += 60) {
    const label = document.createElement("div");
    label.className = "hour-label";
    label.style.top = `${((t - startMin) / 60) * PX_PER_HOUR}px`;
    label.textContent = formatHourLabel(t);
    axis.appendChild(label);
  }

  return axis;
}

/**
 * @param {HTMLElement} track
 * @param {number} startMin
 * @param {number} endMin
 */
function appendHourLines(track, startMin, endMin) {
  for (let t = startMin; t <= endMin; t += 60) {
    const line = document.createElement("div");
    line.className = "hour-line";
    line.style.top = `${((t - startMin) / 60) * PX_PER_HOUR}px`;
    track.appendChild(line);
  }
}

/**
 * @param {number} nowMin
 * @param {number} startMin
 * @param {number} endMin
 */
function isLessonCurrent(nowMin, startMin, endMin) {
  return nowMin >= startMin && nowMin < endMin;
}

/**
 * @param {LaidOutLesson} laid
 * @param {number} dayStartMin
 */
function renderLesson(laid, dayStartMin) {
  const { item, startMin, endMin, column, columnCount } = laid;
  const cancelled = isLessonCancelled(item);
  const li = document.createElement("li");
  li.className = cancelled ? "lesson lesson-cancelled" : "lesson";
  li.dataset.start = String(startMin);
  li.dataset.end = String(endMin);
  if (cancelled) {
    li.dataset.cancelled = "1";
    li.setAttribute("aria-label", `${subjectOf(item)} — ${cancellationLabel(item)}`);
  }

  const top = ((startMin - dayStartMin) / 60) * PX_PER_HOUR;
  const rawHeight = ((endMin - startMin) / 60) * PX_PER_HOUR;
  const height = Math.max(rawHeight, MIN_CARD_PX);
  const widthPct = 100 / columnCount;
  const leftPct = column * widthPct;

  li.style.top = `${top}px`;
  li.style.height = `${height}px`;
  li.style.left = `calc(${leftPct}% + 2px)`;
  li.style.width = `calc(${widthPct}% - 4px)`;

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
  const cancelBadge = cancelled
    ? `<span class="lesson-badge">${escapeHtml(cancellationLabel(item))}</span>`
    : "";

  li.innerHTML = `
    <div class="lesson-time">
      <span>${escapeHtml(time)}</span>
      ${period ? `<span class="lesson-period">${escapeHtml(period)}</span>` : ""}
      ${cancelBadge}
    </div>
    <p class="lesson-subject">${escapeHtml(subjectOf(item))}</p>
    ${metaParts.length ? `<p class="lesson-meta">${escapeHtml(metaParts.join(" · "))}</p>` : ""}
  `;
  return li;
}

function updateNowIndicator() {
  const now = new Date();
  const nowMin = minutesFromMidnight(now);

  if (todayLessonsListEl) {
    for (const li of todayLessonsListEl.querySelectorAll(".lesson")) {
      const el = /** @type {HTMLElement} */ (li);
      const start = Number(el.dataset.start);
      const end = Number(el.dataset.end);
      const current = isLessonCurrent(nowMin, start, end);
      el.classList.toggle("lesson-current", current);
      // Keep cancelled styling across phase refreshes.
      if (el.dataset.cancelled === "1") el.classList.add("lesson-cancelled");
    }
  }

  if (!nowLineEl) return;

  const inRange = nowMin >= trackStartMin && nowMin <= trackEndMin;
  nowLineEl.hidden = !inRange;
  if (inRange) {
    nowLineEl.style.top = `${((nowMin - trackStartMin) / 60) * PX_PER_HOUR}px`;
    nowLineEl.setAttribute("aria-label", `Nu ${formatTime(now)}`);
  }
}

function stopNowTimer() {
  if (nowTimer != null) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
}

function startNowTimer() {
  stopNowTimer();
  updateNowIndicator();
  nowTimer = window.setInterval(updateNowIndicator, NOW_TICK_MS);
}

/**
 * @param {SomtodayAfspraakItem[]} items
 */
function renderSchedule(items) {
  const monday = mondayOfIsoWeek(currentWeek.year, currentWeek.week);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const viewingCurrentWeek = isSameWeek(currentWeek, isoWeekParts(today));

  /** @type {SomtodayAfspraakItem[][]} */
  const rawByDay = [[], [], [], [], []];

  for (const item of items) {
    const start = parseLocalDateTime(item.beginDatumTijd);
    if (!start) continue;
    const weekday = (start.getDay() + 6) % 7; // Mon=0 … Sun=6
    if (weekday > 4) continue;
    rawByDay[weekday].push(item);
  }

  /** @type {LaidOutLesson[][]} */
  const byDay = rawByDay.map((dayItems) => layoutOverlappingLessons(dayItems));
  const bounds = timelineBounds(byDay);
  trackStartMin = bounds.startMin;
  trackEndMin = bounds.endMin;
  const trackHeight = ((trackEndMin - trackStartMin) / 60) * PX_PER_HOUR;

  scheduleEl.replaceChildren();
  scheduleEl.style.setProperty("--track-height", `${trackHeight}px`);
  nowLineEl = null;
  todayLessonsListEl = null;
  stopNowTimer();

  const body = document.createElement("div");
  body.className = "schedule-body";

  const gutter = document.createElement("div");
  gutter.className = "hours-gutter";
  const gutterHead = document.createElement("div");
  gutterHead.className = "hours-gutter-head";
  gutter.appendChild(gutterHead);
  const axisWrap = document.createElement("div");
  axisWrap.className = "hours-axis-wrap";
  axisWrap.style.height = `${trackHeight}px`;
  axisWrap.appendChild(renderHoursAxis(trackStartMin, trackEndMin));
  gutter.appendChild(axisWrap);
  body.appendChild(gutter);

  const daysEl = document.createElement("div");
  daysEl.className = "days";
  daysEl.id = "days";

  let total = 0;
  let showNowIndicator = false;

  for (let i = 0; i < 5; i += 1) {
    const dayDate = new Date(monday);
    dayDate.setDate(monday.getDate() + i);
    const isToday = viewingCurrentWeek && dayDate.getTime() === today.getTime();
    const dayItems = byDay[i];
    total += dayItems.length;

    const section = document.createElement("section");
    section.className = isToday ? "day today" : "day";

    const heading = document.createElement("div");
    heading.className = "day-heading";
    heading.innerHTML = `<h2>${escapeHtml(DAY_NAMES[i])}</h2><span class="date">${escapeHtml(formatShortDate(dayDate))}</span>`;
    section.appendChild(heading);

    const track = document.createElement("div");
    track.className = "day-track";
    track.style.height = `${trackHeight}px`;
    appendHourLines(track, trackStartMin, trackEndMin);

    if (dayItems.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty day-empty";
      empty.textContent = "Geen lessen";
      track.appendChild(empty);
    } else {
      const list = document.createElement("ul");
      list.className = "lessons";
      for (const laid of dayItems) {
        list.appendChild(renderLesson(laid, trackStartMin));
      }
      track.appendChild(list);
      if (isToday) todayLessonsListEl = list;
    }

    if (isToday) {
      const nowLine = document.createElement("div");
      nowLine.className = "now-line";
      nowLine.setAttribute("role", "presentation");
      track.appendChild(nowLine);
      nowLineEl = nowLine;
      showNowIndicator = true;
    }

    section.appendChild(track);
    daysEl.appendChild(section);
  }

  body.appendChild(daysEl);
  scheduleEl.appendChild(body);

  if (showNowIndicator) startNowTimer();

  if (total === 0) {
    setStatus("empty", "Geen lessen deze week.");
  } else {
    setStatus("muted", "");
  }
}

async function loadWeek() {
  const seq = ++loadSeq;
  updateWeekChrome();
  setNavEnabled(false);
  setStatus("muted", "Laden…");
  scheduleEl.replaceChildren();
  stopNowTimer();
  nowLineEl = null;
  todayLessonsListEl = null;

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
    renderSchedule(data?.items ?? []);
  } catch (error) {
    if (seq !== loadSeq) return;
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    setStatus("error", message);
    scheduleEl.replaceChildren();
    stopNowTimer();
    nowLineEl = null;
    todayLessonsListEl = null;
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
