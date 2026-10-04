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

const MS_DAY = 24 * 60 * 60 * 1000;
/** Fallback day window when today has no timed lessons (minutes from midnight). */
const DEFAULT_START_MIN = 8 * 60;
const DEFAULT_END_MIN = 16 * 60;
/** Pixels per hour for Overview widgets (fits time + subject + meta). */
const PX_PER_HOUR = 72;
/** Minimum visible card height so short slots stay readable. */
const MIN_CARD_PX = 48;
const NOW_TICK_MS = 60_000;

const dateLabelEl = document.getElementById("dateLabel");
const statusEl = document.getElementById("status");
const scheduleEl = document.getElementById("schedule");

/** @type {number | null} */
let studentId = null;
/** @type {LaidOutLesson[]} */
let laidLessons = [];
/** @type {number} */
let trackStartMin = DEFAULT_START_MIN;
/** @type {number} */
let trackEndMin = DEFAULT_END_MIN;
/** @type {HTMLElement | null} */
let nowLineEl = null;
/** @type {HTMLUListElement | null} */
let lessonsListEl = null;
/** @type {number | null} */
let nowTimer = null;
/** Last auto-scroll focus key — skip re-centering until the active slot changes. */
/** @type {string | null} */
let lastFocusKey = null;
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
function formatDateLabel(date) {
  const text = date.toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * @param {Date} a
 * @param {Date} b
 */
function isSameLocalDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
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
function periodOf(item) {
  if (item.beginLesuur == null) return "";
  if (item.eindLesuur != null && item.eindLesuur !== item.beginLesuur) {
    return `${item.beginLesuur}e–${item.eindLesuur}e`;
  }
  return `${item.beginLesuur}e`;
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

/**
 * Classic calendar overlap packing (same approach as rooster).
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

  /** @type {number[]} */
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
 * @param {LaidOutLesson[]} events
 */
function timelineBounds(events) {
  if (!events.length) {
    return { startMin: DEFAULT_START_MIN, endMin: DEFAULT_END_MIN };
  }
  let minStart = Infinity;
  let maxEnd = -Infinity;
  for (const ev of events) {
    if (ev.startMin < minStart) minStart = ev.startMin;
    if (ev.endMin > maxEnd) maxEnd = ev.endMin;
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
 * @param {LaidOutLesson} laid
 * @returns {"past" | "current" | "future"}
 */
function lessonPhase(nowMin, laid) {
  if (nowMin >= laid.endMin) return "past";
  if (nowMin >= laid.startMin && nowMin < laid.endMin) return "current";
  return "future";
}

/**
 * @param {LaidOutLesson} laid
 * @param {number} dayStartMin
 */
function renderLesson(laid, dayStartMin) {
  const { item, startMin, endMin, column, columnCount } = laid;
  const cancelled = isLessonCancelled(item);
  const li = document.createElement("li");
  li.className = cancelled ? "lesson lesson-future lesson-cancelled" : "lesson lesson-future";
  li.dataset.start = String(startMin);
  li.dataset.end = String(endMin);
  li.dataset.column = String(column);
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
  const metaParts = [teacher, location].filter(Boolean);
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

/**
 * @param {LaidOutLesson} laid
 * @returns {HTMLElement | null}
 */
function lessonElement(laid) {
  if (!lessonsListEl) return null;
  for (const li of lessonsListEl.querySelectorAll(".lesson")) {
    const el = /** @type {HTMLElement} */ (li);
    if (
      Number(el.dataset.start) === laid.startMin &&
      Number(el.dataset.end) === laid.endMin &&
      Number(el.dataset.column) === laid.column
    ) {
      return el;
    }
  }
  return null;
}

/**
 * Prefer a live (non-cancelled) lesson when several overlap.
 * @param {LaidOutLesson[]} candidates
 * @returns {LaidOutLesson | null}
 */
function preferLiveLesson(candidates) {
  if (!candidates.length) return null;
  return candidates.find((laid) => !isLessonCancelled(laid.item)) ?? candidates[0];
}

/**
 * Pick what the scroll viewport should center on.
 * @param {number} nowMin
 * @returns {{ key: string, el: HTMLElement | null }}
 */
function resolveScrollFocus(nowMin) {
  const ongoing = preferLiveLesson(
    laidLessons.filter((laid) => lessonPhase(nowMin, laid) === "current"),
  );
  if (ongoing) {
    return {
      key: `current:${ongoing.startMin}:${ongoing.endMin}:${ongoing.column}`,
      el: lessonElement(ongoing),
    };
  }

  const upcoming = preferLiveLesson(laidLessons.filter((laid) => laid.startMin > nowMin));
  if (upcoming) {
    return {
      key: `next:${upcoming.startMin}:${upcoming.endMin}:${upcoming.column}`,
      el: lessonElement(upcoming),
    };
  }

  if (nowLineEl && !nowLineEl.hidden) {
    return { key: "now", el: nowLineEl };
  }

  return { key: "top", el: null };
}

/**
 * Vertically center `el` inside the schedule scroll area.
 * @param {HTMLElement} el
 */
function centerInSchedule(el) {
  const scroller = scheduleEl;
  if (!scroller || scroller.clientHeight <= 0) return;
  const scrollerRect = scroller.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const elCenter = elRect.top + elRect.height / 2;
  const viewCenter = scrollerRect.top + scroller.clientHeight / 2;
  const nextTop = scroller.scrollTop + (elCenter - viewCenter);
  const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTop = Math.min(Math.max(0, nextTop), maxTop);
}

/**
 * Auto-scroll on first paint and when the active slot changes — not every minute tick.
 * @param {boolean} [force]
 */
function scrollScheduleToFocus(force = false) {
  if (!laidLessons.length) return;
  const nowMin = minutesFromMidnight(new Date());
  const focus = resolveScrollFocus(nowMin);
  if (!force && focus.key === lastFocusKey) return;
  lastFocusKey = focus.key;

  if (focus.key === "top" || !focus.el) {
    scheduleEl.scrollTop = 0;
    return;
  }
  centerInSchedule(focus.el);
}

/** Refresh past/current/future classes and the nu-line position. */
function updateNowIndicator() {
  const now = new Date();
  const nowMin = minutesFromMidnight(now);

  if (lessonsListEl) {
    for (const li of lessonsListEl.querySelectorAll(".lesson")) {
      const el = /** @type {HTMLElement} */ (li);
      const start = Number(el.dataset.start);
      const end = Number(el.dataset.end);
      const phase = lessonPhase(nowMin, {
        item: /** @type {SomtodayAfspraakItem} */ ({}),
        startMin: start,
        endMin: end,
        column: 0,
        columnCount: 1,
      });
      el.classList.remove("lesson-past", "lesson-current", "lesson-future");
      el.classList.add(`lesson-${phase}`);
      // Keep cancelled styling across phase refreshes.
      if (el.dataset.cancelled === "1") el.classList.add("lesson-cancelled");
    }
  }

  if (nowLineEl) {
    const inRange = nowMin >= trackStartMin && nowMin <= trackEndMin;
    nowLineEl.hidden = !inRange;
    if (inRange) {
      nowLineEl.style.top = `${((nowMin - trackStartMin) / 60) * PX_PER_HOUR}px`;
      nowLineEl.setAttribute("aria-label", `Nu ${formatTime(now)}`);
    }
  }
}

function stopNowTimer() {
  if (nowTimer != null) {
    clearInterval(nowTimer);
    nowTimer = null;
  }
}

function onNowTick() {
  updateNowIndicator();
  // Re-center only when current / next / nu focus identity changes.
  scrollScheduleToFocus(false);
}

function startNowTimer() {
  stopNowTimer();
  updateNowIndicator();
  nowTimer = window.setInterval(onNowTick, NOW_TICK_MS);
}

/**
 * @param {SomtodayAfspraakItem[]} items
 * @param {Date} today
 */
function renderSchedule(items, today) {
  const dayItems = items.filter((item) => {
    const start = parseLocalDateTime(item.beginDatumTijd);
    return start != null && isSameLocalDay(start, today);
  });

  laidLessons = layoutOverlappingLessons(dayItems);
  const bounds = timelineBounds(laidLessons);
  trackStartMin = bounds.startMin;
  trackEndMin = bounds.endMin;
  const trackHeight = ((trackEndMin - trackStartMin) / 60) * PX_PER_HOUR;

  scheduleEl.replaceChildren();
  scheduleEl.style.setProperty("--track-height", `${trackHeight}px`);
  nowLineEl = null;
  lessonsListEl = null;
  lastFocusKey = null;
  scheduleEl.scrollTop = 0;

  if (laidLessons.length === 0) {
    setStatus("empty", "Geen lessen vandaag.");
    return;
  }

  setStatus("muted", "");

  const body = document.createElement("div");
  body.className = "schedule-body";

  const axisWrap = document.createElement("div");
  axisWrap.className = "hours-axis-wrap";
  axisWrap.style.height = `${trackHeight}px`;
  axisWrap.appendChild(renderHoursAxis(trackStartMin, trackEndMin));
  body.appendChild(axisWrap);

  const track = document.createElement("div");
  track.className = "day-track";
  track.style.height = `${trackHeight}px`;
  appendHourLines(track, trackStartMin, trackEndMin);

  const list = document.createElement("ul");
  list.className = "lessons";
  for (const laid of laidLessons) {
    list.appendChild(renderLesson(laid, trackStartMin));
  }
  track.appendChild(list);
  lessonsListEl = list;

  const nowLine = document.createElement("div");
  nowLine.className = "now-line";
  nowLine.setAttribute("role", "presentation");
  track.appendChild(nowLine);
  nowLineEl = nowLine;

  body.appendChild(track);
  scheduleEl.appendChild(body);
  startNowTimer();
  // Layout first so getBoundingClientRect sees real card positions.
  requestAnimationFrame(() => {
    scrollScheduleToFocus(true);
  });
}

async function loadToday() {
  const seq = ++loadSeq;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  dateLabelEl.textContent = formatDateLabel(today);
  setStatus("muted", "Laden…");
  scheduleEl.replaceChildren();
  stopNowTimer();
  nowLineEl = null;
  lessonsListEl = null;
  laidLessons = [];

  if (!studentId) {
    setStatus("error", "Geen leerling gevonden in de sessie.");
    return;
  }

  const { year, week } = isoWeekParts(today);

  try {
    const path =
      `/rest/v1/afspraakitems/${studentId}/jaar/${year}/week/${week}` +
      "?additional=docentAfkortingen";
    /** @type {SomtodayListResponse<SomtodayAfspraakItem>} */
    const data = await cyfers.fetch(path);
    if (seq !== loadSeq) return;
    renderSchedule(data?.items ?? [], today);
  } catch (error) {
    if (seq !== loadSeq) return;
    const message = error instanceof Error ? error.message : "Laden mislukt.";
    setStatus("error", message);
    scheduleEl.replaceChildren();
  }
}

async function main() {
  try {
    const context = await cyfers.getContext();
    studentId = context.students?.[0]?.id ?? null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Context laden mislukt.";
    setStatus("error", message);
    dateLabelEl.textContent = "Vandaag";
    return;
  }

  await loadToday();
}

main();
