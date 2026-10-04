(() => {
  "use strict";

  /**
   * @typedef {"brons" | "zilver" | "goud" | "zeldzaam" | "totw" | "icoon"} Tier
   * @typedef {{
   *   key: string,
   *   subject: string,
   *   abbr: string,
   *   grade: number | null,
   *   label: string | null,
   *   display: string,
   *   ovr: number,
   *   tier: Tier,
   *   weight: number | null,
   *   period: number | null,
   *   date: Date | null,
   *   description: string,
   *   kind: string,
   *   attempt: number,
   *   firstAttempt: string | null,
   *   comeback: boolean,
   *   exam: boolean,
   *   niveau: string,
   * }} GradeCard
   * @typedef {{
   *   id: string,
   *   name: string,
   *   short: string,
   *   foil: string,
   *   blurb: string,
   *   size: number,
   *   pick: (pool: GradeCard[], choice?: string) => GradeCard[],
   * }} PackDef
   * @typedef {{ packs: number, walkouts: number, best: { subject: string, display: string, ovr: number, tier: Tier } | null }} Stats
   */

  const PAGE_SIZE = 100;
  const MAX_PAGES = 5;
  /** Concurrent subject fetches for past-year vakresultaten. */
  const SUBJECT_CONCURRENCY = 4;
  /** Current-year dossier list — individual toets columns only. */
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
   * Average column types are requested then filtered client-side so pack cards
   * stay individual results (not periode-/rapport-/SE-gemiddelden).
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
  /** Column types treated as real grades (pack cards), not averages. */
  const GRADE_COLUMN_TYPES = new Set([
    "Toetskolom",
    "DeeltoetsKolom",
    "SamengesteldeToetsKolom",
    "Werkstukcijferkolom",
    "Advieskolom",
    "RapportCijferKolom",
    "RapportToetskolom",
  ]);

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /** Global animation time multiplier. */
  const SPEED = reducedMotion ? 0.35 : 1;
  /** Hype level (see hypeOf) from which a card gets a full walkout. */
  const WALKOUT_HYPE = 4;

  /** @type {Record<Tier, { label: string, tag: string, rank: number, color: string, flash: string, particles: string[] }>} */
  const TIERS = {
    brons: { label: "Brons", tag: "Brons", rank: 0, color: "#d08a4e", flash: "#ffd9b8", particles: ["#f0b27a", "#c3824a", "#ffe0bf"] },
    zilver: { label: "Zilver", tag: "Zilver", rank: 1, color: "#dfe6ee", flash: "#f2f6fa", particles: ["#ffffff", "#c9d2db", "#9aa6b2"] },
    goud: { label: "Goud", tag: "Goud", rank: 2, color: "#ffd54a", flash: "#fff0b8", particles: ["#fff3a6", "#ffd54a", "#e0a82e"] },
    zeldzaam: { label: "Zeldzaam goud", tag: "Zeldzaam", rank: 3, color: "#ffc61a", flash: "#fff1a0", particles: ["#fff7c2", "#ffd23f", "#ff9f1a", "#ffffff"] },
    totw: { label: "Toets van de Week", tag: "TOTW", rank: 4, color: "#ff9f1a", flash: "#ffc56b", particles: ["#ffcf4a", "#ff8a00", "#ffffff", "#ffe08a"] },
    icoon: { label: "Icoon", tag: "Icoon", rank: 5, color: "#fff4cf", flash: "#ffffff", particles: ["#ffffff", "#fff1b8", "#ffd76a", "#9be7ff", "#ff9bd6"] },
  };
  /** @type {Tier[]} */
  const TIER_ORDER = ["icoon", "totw", "zeldzaam", "goud", "zilver", "brons"];

  /** Label results (G / V / O …) mapped onto the 1–100 card scale. */
  const LABEL_OVR = {
    u: 95, uitmuntend: 95, zg: 92, "zeer goed": 92, g: 82, goed: 82,
    rv: 72, "ruim voldoende": 72, v: 65, voldoende: 65, m: 50, matig: 50,
    o: 40, onvoldoende: 40, zs: 25, s: 30, slecht: 30,
  };

  const TYPE_LABELS = {
    Toetskolom: "Toets",
    DeeltoetsKolom: "Deeltoets",
    SamengesteldeToetsKolom: "Samengestelde toets",
    Werkstukcijferkolom: "Werkstuk",
    Advieskolom: "Advies",
    RapportCijferKolom: "Rapportcijfer",
    RapportToetskolom: "Rapporttoets",
  };

  /** @type {[RegExp, string][]} */
  const GLYPHS = [
    [/wiskunde|rekenen/i, "∑"],
    [/natuurkunde/i, "Ω"],
    [/scheikunde/i, "H₂O"],
    [/economie|bedrijfs/i, "€"],
    [/muziek/i, "♪"],
    [/informatica/i, "</>"],
    [/grieks/i, "ΑΩ"],
  ];

  /* —— DOM —— */

  const $ = (/** @type {string} */ id) => /** @type {HTMLElement} */ (document.getElementById(id));
  const els = {
    app: $("app"),
    summary: $("summary"),
    status: $("status"),
    countdown: $("countdown"),
    store: $("store"),
    club: $("club"),
    tabStore: /** @type {HTMLButtonElement} */ ($("tabStore")),
    tabClub: /** @type {HTMLButtonElement} */ ($("tabClub")),
    clubCount: $("clubCount"),
    soundToggle: /** @type {HTMLButtonElement} */ ($("soundToggle")),
    refresh: /** @type {HTMLButtonElement} */ ($("refresh")),
    studentPick: /** @type {HTMLSelectElement} */ ($("studentPick")),
    yearPick: /** @type {HTMLSelectElement} */ ($("yearPick")),
    clubGrid: $("clubGrid"),
    clubFilters: $("clubFilters"),
    clubSort: /** @type {HTMLSelectElement} */ ($("clubSort")),
    clubShowMissing: /** @type {HTMLInputElement} */ ($("clubShowMissing")),
    clubReset: /** @type {HTMLButtonElement} */ ($("clubReset")),
    clubProgressText: $("clubProgressText"),
    clubBar: $("clubBar"),
    stage: $("stage"),
    stageContent: $("stageContent"),
    stageTitle: $("stageTitle"),
    stageProgress: $("stageProgress"),
    stageSound: /** @type {HTMLButtonElement} */ ($("stageSound")),
    skipBtn: /** @type {HTMLButtonElement} */ ($("skipBtn")),
    closeBtn: /** @type {HTMLButtonElement} */ ($("closeBtn")),
    hint: $("stageHint"),
    live: $("live"),
    flash: $("flash"),
    fx: /** @type {HTMLCanvasElement} */ ($("fx")),
    detail: $("detail"),
    detailCard: $("detailCard"),
    detailTitle: $("detailTitle"),
    detailTier: $("detailTier"),
    detailList: $("detailList"),
    detailClose: /** @type {HTMLButtonElement} */ ($("detailClose")),
    detailBackdrop: $("detailBackdrop"),
  };

  /* —— Helpers —— */

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  const rand = (/** @type {number} */ a, /** @type {number} */ b) => a + Math.random() * (b - a);
  const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => Math.min(hi, Math.max(lo, v));

  /** @template T @param {T[]} list @returns {T[]} */
  function shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  function hashString(text) {
    let h = 5381;
    for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function formatGrade(value) {
    if (value >= 10) return "10";
    return value.toLocaleString("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function formatDate(date, long = false) {
    if (!date) return "—";
    return date.toLocaleDateString("nl-NL", long
      ? { day: "numeric", month: "long", year: "numeric" }
      : { day: "2-digit", month: "2-digit" });
  }

  /** Fire-and-forget a phase promise without leaking AbortError rejections. */
  function quiet(promise) {
    promise.catch(() => {});
  }

  /* —— Grade normalisation —— */

  function parseNumber(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (typeof value !== "string") return null;
    const text = value.trim().replace(",", ".");
    if (!/^\d{1,3}(\.\d+)?$/.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }

  /** @param {SomtodayGrade} g */
  function numericGrade(g) {
    for (const candidate of [g.cijfer, g.geldendResultaat, g.formattedResultaat, g.resultaat, g.geldendResultaatCijferInvoer]) {
      const n = parseNumber(candidate);
      if (n != null && n >= 1 && n <= 10) return n;
    }
    return null;
  }

  /** @param {SomtodayGrade} g */
  function subjectInfo(g) {
    const vak = g.additionalObjects?.vaknaam;
    let name = "";
    let abbr = "";
    if (typeof vak === "string") name = vak;
    else if (vak && typeof vak === "object") {
      name = vak.naam || "";
      abbr = vak.afkorting || "";
    }
    name = name || g.vak?.naam || g.vak?.afkorting || "Vak";
    abbr = abbr || g.vak?.afkorting || deriveAbbr(name);
    return { name, abbr: abbr.toUpperCase().slice(0, 5) };
  }

  function deriveAbbr(name) {
    const words = String(name).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "VAK";
    const tail = words.slice(1).find((w) => w.length <= 2);
    if (tail) return (words[0].slice(0, 3) + tail).toUpperCase();
    if (words.length > 1) return words.map((w) => w[0]).join("").slice(0, 3).toUpperCase();
    return words[0].slice(0, 3).toUpperCase();
  }

  /** @param {SomtodayGrade} g */
  function descriptionOf(g) {
    const kolom = g.additionalObjects?.resultaatkolom;
    const fromKolom = typeof kolom === "string" ? kolom : kolom?.omschrijving || kolom?.naam || "";
    return (g.omschrijving || fromKolom || g.toetscode || "").trim();
  }

  function parseDate(raw) {
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** @param {number} ovr @returns {Tier} */
  function tierFor(ovr) {
    if (ovr >= 100) return "icoon";
    if (ovr >= 90) return "totw";
    if (ovr >= 80) return "zeldzaam";
    if (ovr >= 70) return "goud";
    if (ovr >= 55) return "zilver";
    return "brons";
  }

  /**
   * Escalation level that drives shake, light, sound and walkout length.
   * 0 brons · 1 zilver · 2 goud · 3 zeldzaam · 4 zeldzaam 85+ · 5 TOTW · 6 icoon
   * @param {GradeCard} card
   */
  function hypeOf(card) {
    const rank = TIERS[card.tier].rank;
    if (rank < 3) return rank;
    if (rank === 3) return card.ovr >= 85 ? 4 : 3;
    return rank + 1;
  }

  /**
   * @param {SomtodayGrade} g
   * @param {"voortgang" | "examen"} source
   * @returns {GradeCard | null}
   */
  function normalize(g, source) {
    const grade = numericGrade(g);
    let label = null;
    let ovr;
    if (grade != null) {
      ovr = clamp(Math.round(grade * 10 + 1e-9), 10, 100);
    } else {
      const raw = String(g.label || g.labelAfkorting || g.formattedResultaat || g.resultaat || "").trim();
      if (!raw) return null;
      const mapped = LABEL_OVR[raw.toLowerCase()];
      if (mapped == null && g.isVoldoende == null) return null;
      label = raw.length > 4 ? (g.labelAfkorting || raw.slice(0, 3)) : raw;
      ovr = mapped ?? (g.isVoldoende ? 65 : 40);
    }

    const { name, abbr } = subjectInfo(g);
    const date = parseDate(g.datumInvoer || g.datumInvoerTweedePoging || g.datumInvoerEerstePoging);
    const description = descriptionOf(g);
    const display = grade != null ? formatGrade(grade) : String(label);
    const linkId = g.links?.find((l) => l.id != null)?.id;
    const key = linkId != null
      ? `r${linkId}`
      : `h${hashString(`${name}|${description}|${date?.toISOString() ?? ""}|${display}|${g.volgnummer ?? ""}`)}`;

    const first = g.formattedEerstePoging ? String(g.formattedEerstePoging) : null;
    const firstNum = g.cijferEerstePoging ?? parseNumber(first);
    const attempt = g.datumInvoerTweedePoging || (first && first !== display) ? 2 : 1;
    const weight = typeof g.weging === "number" ? g.weging : parseNumber(g.weging);

    return {
      key,
      subject: name,
      abbr,
      grade,
      label,
      display,
      ovr,
      tier: tierFor(ovr),
      weight,
      period: typeof g.periode === "number" ? g.periode : null,
      date,
      description,
      kind: (g.toetssoort || "").trim() || TYPE_LABELS[g.type || ""] || "Toets",
      attempt,
      firstAttempt: attempt === 2 ? first : null,
      comeback: attempt === 2 && grade != null && typeof firstNum === "number" && firstNum < grade,
      exam: source === "examen",
      niveau: typeof g.additionalObjects?.naamalternatiefniveau === "string" ? g.additionalObjects.naamalternatiefniveau : "",
    };
  }

  /**
   * Path key for vakgemiddelden — Somtoday uses plaatsing UUID (not numeric link id).
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
   * @param {number} studentId
   * @returns {Promise<SomtodayPlaatsing[]>}
   */
  async function fetchPlaatsingen(studentId) {
    /** @type {SomtodayListResponse<SomtodayPlaatsing>} */
    const data = /** @type {any} */ (await cyfers.fetch(`/rest/v1/plaatsingen?leerling=${studentId}`));
    const items = Array.isArray(data?.items) ? data.items : [];
    return sortPlaatsingen(items.filter((p) => plaatsingKeyOf(p)));
  }

  /**
   * @param {string} dossier
   * @param {number} studentId
   * @returns {Promise<SomtodayGrade[]>}
   */
  async function fetchDossier(dossier, studentId) {
    /** @type {SomtodayGrade[]} */
    const all = [];
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      /** @type {SomtodayListResponse<SomtodayGrade>} */
      const data = /** @type {any} */ (await cyfers.fetch(`/rest/v1/${dossier}/leerling/${studentId}?${QUERY}`, {
        headers: { range: `items=${from}-${from + PAGE_SIZE - 1}` },
      }));
      const items = Array.isArray(data?.items) ? data.items : [];
      all.push(...items);
      if (items.length < PAGE_SIZE) break;
    }
    return all;
  }

  /**
   * @param {SomtodayGrade[]} items
   * @param {"voortgang" | "examen"} source
   * @param {Map<string, GradeCard>} byKey
   * @param {{ name?: string, abbr?: string } | null} [subjectHint]
   */
  function mergeGrades(items, source, byKey, subjectHint = null) {
    for (const raw of items) {
      if (raw?.type && !GRADE_COLUMN_TYPES.has(raw.type)) continue;
      const card = normalize(raw, source);
      if (!card) continue;
      if (subjectHint?.name) card.subject = subjectHint.name;
      if (subjectHint?.abbr) card.abbr = subjectHint.abbr;
      const existing = byKey.get(card.key);
      if (existing) {
        if (card.exam) existing.exam = true;
        continue;
      }
      byKey.set(card.key, card);
    }
  }

  /**
   * Pack UX needs individual result cards (walkouts, "nieuwe cijfers", weights).
   * Current plaatsing: per-result dossier list endpoints.
   * @param {number} studentId
   */
  async function loadCardsFromDossier(studentId) {
    const [progress, exams] = await Promise.allSettled([
      fetchDossier("geldendvoortgangsdossierresultaten", studentId),
      fetchDossier("geldendexamendossierresultaten", studentId),
    ]);
    if (progress.status === "rejected" && exams.status === "rejected") throw progress.reason;

    /** @type {Map<string, GradeCard>} */
    const byKey = new Map();
    if (progress.status === "fulfilled") mergeGrades(progress.value, "voortgang", byKey);
    if (exams.status === "fulfilled") mergeGrades(exams.value, "examen", byKey);
    return { cards: [...byKey.values()], partial: progress.status === "rejected" || exams.status === "rejected" };
  }

  /**
   * @template T, R
   * @param {T[]} items
   * @param {number} concurrency
   * @param {(item: T, index: number) => Promise<R>} fn
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
        out[i] = await fn(items[i], i);
      }
    });
    await Promise.all(workers);
    return out;
  }

  /**
   * Discover vak + lichting UUIDs from a plaatsing’s vakgemiddelden response.
   * Live shape: `gemiddelden[].vakkeuze.vak.UUID` + `vakkeuze.lichting.UUID`
   * (fallback: `relevanteCijferLichting`).
   * @param {SomtodayVakGemiddelde[]} items
   */
  function subjectsFromGemiddelden(items) {
    /** @type {Map<string, { vakUuid: string, lichtingUuid: string, name: string, abbr: string }>} */
    const byKey = new Map();
    for (const item of items) {
      const vk = item.vakkeuze;
      if (!vk) continue;
      const vak = vk.vak;
      const lichting = vk.lichting || vk.relevanteCijferLichting;
      const vakUuid = vak?.UUID || vak?.uuid || "";
      const lichtingUuid = lichting?.UUID || lichting?.uuid || "";
      if (!vakUuid || !lichtingUuid) continue;
      const name = vak?.naam || vak?.afkorting || "Vak";
      const key = `${vakUuid}:${lichtingUuid}`;
      if (byKey.has(key)) continue;
      byKey.set(key, {
        vakUuid,
        lichtingUuid,
        name,
        abbr: (vak?.afkorting || deriveAbbr(name)).toUpperCase().slice(0, 5),
      });
    }
    return [...byKey.values()];
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
   * Historical (and non-current) years: no bulk individual-grade list exists.
   * Discover subjects via vakgemiddelden, then fetch voortgang + examen
   * vakresultaten per subject and flatten into pack cards.
   * @param {number} studentId
   * @param {string} plaatsingKey
   */
  async function loadCardsFromVakresultaten(studentId, plaatsingKey) {
    /** @type {SomtodayVakGemiddelden} */
    const averages = /** @type {any} */ (
      await cyfers.fetch(`/rest/v1/vakkeuzes/plaatsing/${encodeURIComponent(plaatsingKey)}/vakgemiddelden`)
    );
    const subjects = subjectsFromGemiddelden(Array.isArray(averages?.gemiddelden) ? averages.gemiddelden : []);
    if (!subjects.length) return { cards: [], partial: false };

    /** @type {Map<string, GradeCard>} */
    const byKey = new Map();
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
      const hint = { name: subject.name, abbr: subject.abbr };
      if (progress.status === "fulfilled") mergeGrades(progress.value, "voortgang", byKey, hint);
      if (exams.status === "fulfilled") mergeGrades(exams.value, "examen", byKey, hint);
    });

    if (!byKey.size && failures === subjects.length) {
      throw new Error("Kon geen cijfers laden voor dit schooljaar.");
    }
    return { cards: [...byKey.values()], partial: failures > 0 };
  }

  /**
   * @param {number} studentId
   * @param {{ key: string, huidig: boolean } | null} plaatsing
   */
  async function loadCards(studentId, plaatsing) {
    if (plaatsing && !plaatsing.huidig) {
      return loadCardsFromVakresultaten(studentId, plaatsing.key);
    }
    // Current (or unknown) year: dossier list already returns individual results.
    return loadCardsFromDossier(studentId);
  }

  /* —— Packs —— */

  const byOvrDesc = (/** @type {GradeCard} */ a, /** @type {GradeCard} */ b) => b.ovr - a.ovr || (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);
  const byDateDesc = (/** @type {GradeCard} */ a, /** @type {GradeCard} */ b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0);

  /** Random pick where higher grades are much more likely (rare-pack odds). */
  function weightedPick(pool, count, power) {
    const left = pool.slice();
    const out = [];
    while (out.length < count && left.length) {
      const weights = left.map((c) => Math.pow(c.ovr / 50, power));
      let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
      let index = 0;
      while (index < left.length - 1 && roll > weights[index]) {
        roll -= weights[index];
        index += 1;
      }
      out.push(left.splice(index, 1)[0]);
    }
    return out;
  }

  /** @type {PackDef[]} */
  const PACKS = [
    {
      id: "nieuw",
      name: "Nieuwe cijfers",
      short: "Nieuw",
      foil: "nieuw",
      blurb: "Je nieuwste, nog niet geopende cijfers",
      size: 12,
      pick: (pool) => pool.filter((c) => !state.seen.has(c.key)).sort(byDateDesc).slice(0, 12),
    },
    {
      id: "starter",
      name: "Starterspack",
      short: "Starter",
      foil: "brons",
      blurb: "3 willekeurige cijfers",
      size: 3,
      pick: (pool) => shuffle(pool).slice(0, 3),
    },
    {
      id: "goud",
      name: "Gouden pack",
      short: "Goud",
      foil: "goud",
      blurb: "6 cijfers · minstens 1 goud of hoger",
      size: 6,
      pick: (pool) => {
        const golds = shuffle(pool.filter((c) => c.ovr >= 70));
        const first = golds[0] ?? pool.slice().sort(byOvrDesc)[0];
        return [first, ...shuffle(pool.filter((c) => c !== first)).slice(0, 5)];
      },
    },
    {
      id: "zeldzaam",
      name: "Zeldzame pack",
      short: "Zeldzaam",
      foil: "zeldzaam",
      blurb: "8 cijfers · hoge cijfers vallen vaker",
      size: 8,
      pick: (pool) => weightedPick(pool, 8, 4),
    },
    {
      id: "ultimate",
      name: "Ultimate pack",
      short: "Ultimate",
      foil: "ultimate",
      blurb: "15 cijfers · je 3 beste gegarandeerd",
      size: 15,
      pick: (pool) => {
        const top = pool.slice().sort(byOvrDesc).slice(0, 3);
        return [...top, ...shuffle(pool.filter((c) => !top.includes(c))).slice(0, 12)];
      },
    },
    {
      id: "vak",
      name: "Vakpack",
      short: "Vak",
      foil: "vak",
      blurb: "Alle cijfers van één vak",
      size: 24,
      pick: (pool, choice) => pool.filter((c) => c.subject === choice).sort(byDateDesc).slice(0, 24),
    },
  ];

  /* —— State —— */

  const state = {
    /** @type {CyfersStudent[]} */
    students: [],
    /** @type {number | null} */
    studentId: null,
    /** @type {SomtodayPlaatsing[]} */
    plaatsingen: [],
    /** @type {string | null} */
    plaatsingKey: null,
    plaatsingHuidig: true,
    /** @type {GradeCard[]} */
    cards: [],
    /** @type {Set<string>} */
    seen: new Set(),
    /** @type {Stats} */
    stats: { packs: 0, walkouts: 0, best: null },
    loading: true,
    loadSeq: 0,
    view: /** @type {"store" | "club"} */ ("store"),
    clubFilter: /** @type {"alle" | Tier} */ ("alle"),
    vakChoice: "",
    sound: true,
    resetArmedUntil: 0,
    /** @type {Date | null} */
    momentAt: null,
    momentLabel: "",
    /** @type {"idle" | "loading" | "ready" | "empty" | "live" | "error"} */
    momentStatus: "idle",
    momentSeq: 0,
    /** @type {number | null} */
    countdownTimer: null,
    /** After hitting zero, nudge grades once per moment. */
    zeroHandledFor: "",
  };

  /* —— Audio (Web Audio synthesis, no files) —— */

  const audio = (() => {
    /** @type {AudioContext | null} */
    let ctx = null;
    /** @type {GainNode | null} */
    let master = null;
    /** @type {AudioBuffer | null} */
    let noiseBuf = null;
    /** @type {Set<AudioScheduledSourceNode>} */
    const live = new Set();

    function ensure() {
      if (!state.sound) return null;
      if (!ctx) {
        const AC = window.AudioContext || /** @type {any} */ (window).webkitAudioContext;
        if (!AC) return null;
        try {
          ctx = new AC();
        } catch {
          return null;
        }
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.ratio.value = 4;
        master = ctx.createGain();
        master.gain.value = 0.6;
        master.connect(comp);
        comp.connect(ctx.destination);
        const length = ctx.sampleRate * 2;
        noiseBuf = ctx.createBuffer(1, length, ctx.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }

    function track(src) {
      live.add(src);
      src.onended = () => live.delete(src);
    }

    /** Envelope on a gain node; returns end time. */
    function envelope(g, t0, attack, hold, release, peak) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
      g.gain.setValueAtTime(Math.max(0.0002, peak), t0 + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
      return t0 + attack + hold + release;
    }

    function tone({ type = "sine", freq = 440, to = 0, attack = 0.005, hold = 0, release = 0.3, gain = 0.2, delay = 0, lowpass = 0 }) {
      const c = ensure();
      if (!c || !master) return;
      const t0 = c.currentTime + delay;
      const osc = c.createOscillator();
      osc.type = /** @type {OscillatorType} */ (type);
      osc.frequency.setValueAtTime(freq, t0);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t0 + attack + hold + release);
      const g = c.createGain();
      const end = envelope(g, t0, attack, hold, release, gain);
      /** @type {AudioNode} */
      let node = osc;
      if (lowpass) {
        const f = c.createBiquadFilter();
        f.type = "lowpass";
        f.frequency.value = lowpass;
        osc.connect(f);
        node = f;
      }
      node.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(end + 0.05);
      track(osc);
    }

    function noise({ filter = "bandpass", freq = 1000, to = 0, q = 1, attack = 0.01, hold = 0, release = 0.3, gain = 0.2, delay = 0 }) {
      const c = ensure();
      if (!c || !master || !noiseBuf) return;
      const t0 = c.currentTime + delay;
      const src = c.createBufferSource();
      src.buffer = noiseBuf;
      src.loop = true;
      const f = c.createBiquadFilter();
      f.type = /** @type {BiquadFilterType} */ (filter);
      f.Q.value = q;
      f.frequency.setValueAtTime(freq, t0);
      if (to) f.frequency.exponentialRampToValueAtTime(to, t0 + attack + hold + release);
      const g = c.createGain();
      const end = envelope(g, t0, attack, hold, release, gain);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(t0, Math.random());
      src.stop(end + 0.05);
      track(src);
    }

    const NOTE = (/** @type {number} */ semis) => 523.25 * Math.pow(2, semis / 12);

    return {
      ensure,
      stopAll() {
        for (const src of live) {
          try {
            src.stop();
          } catch {
            /* already stopped */
          }
        }
        live.clear();
      },
      suspend() {
        if (ctx && ctx.state === "running") ctx.suspend().catch(() => {});
      },
      resume() {
        if (ctx && ctx.state === "suspended" && state.sound) ctx.resume().catch(() => {});
      },
      close() {
        this.stopAll();
        if (ctx) ctx.close().catch(() => {});
        ctx = null;
        master = null;
      },
      ui() {
        tone({ type: "triangle", freq: 660, to: 990, release: 0.08, gain: 0.07 });
      },
      whoosh(delay = 0) {
        noise({ freq: 350, to: 3200, q: 0.9, attack: 0.18, release: 0.32, gain: 0.28, delay });
      },
      thud() {
        tone({ freq: 150, to: 42, release: 0.38, gain: 0.55 });
        noise({ filter: "lowpass", freq: 420, release: 0.14, gain: 0.25 });
      },
      rumble(seconds, intensity) {
        noise({ filter: "lowpass", freq: 140, to: 320, attack: 0.05, hold: seconds, release: 0.2, gain: 0.18 + intensity * 0.3 });
        tone({ freq: 48 + intensity * 14, attack: 0.05, hold: seconds, release: 0.2, gain: 0.12 + intensity * 0.18 });
        noise({ freq: 2600, q: 3, attack: 0.02, hold: seconds, release: 0.1, gain: 0.03 + intensity * 0.05 });
      },
      tear() {
        noise({ filter: "highpass", freq: 1400, to: 5200, attack: 0.004, release: 0.34, gain: 0.38 });
        for (let i = 0; i < 7; i += 1) noise({ freq: rand(2000, 6000), q: 4, release: 0.04, gain: 0.18, delay: i * 0.035 + rand(0, 0.02) });
      },
      boom(hype) {
        tone({ freq: 120, to: 28, release: 1.1 + hype * 0.15, gain: 0.75 });
        noise({ filter: "lowpass", freq: 900, to: 90, release: 0.9 + hype * 0.1, gain: 0.32 });
        if (hype >= 3) {
          [0, 4, 7, 12].forEach((s, i) => tone({ freq: NOTE(s + 12), attack: 0.02, release: 1.3, gain: 0.035, delay: 0.05 + i * 0.05 }));
        }
      },
      drum(hype) {
        tone({ freq: 95, to: 38, release: 0.5, gain: 0.6 + hype * 0.04 });
        noise({ freq: 220, q: 0.8, release: 0.16, gain: 0.3 });
        noise({ filter: "highpass", freq: 6000, release: 0.25, gain: 0.05 });
      },
      shimmer(delay = 0) {
        [12, 16, 19, 24, 28].forEach((s, i) => tone({ freq: NOTE(s), attack: 0.01, release: 0.55, gain: 0.04, delay: delay + i * 0.045 }));
      },
      chime(rank) {
        const chords = [[0, 4], [0, 4, 7], [0, 4, 7, 12], [0, 4, 7, 12, 16], [-5, 0, 4, 7, 12, 16], [-12, 0, 4, 7, 12, 16, 19, 24]];
        const notes = chords[clamp(rank, 0, chords.length - 1)];
        notes.forEach((s, i) => {
          tone({ type: "triangle", freq: NOTE(s), attack: 0.01, release: 0.9 + rank * 0.15, gain: 0.08, delay: i * (0.07 - rank * 0.006) });
        });
        if (rank >= 3) tone({ type: "sawtooth", freq: NOTE(-12), attack: 0.05, hold: 0.25, release: 1.2, gain: 0.06, lowpass: 1400 });
      },
      crowd(seconds, hype) {
        const g = 0.07 + hype * 0.025;
        noise({ freq: 700, q: 0.5, attack: 1.2, hold: seconds, release: 1.6, gain: g });
        noise({ freq: 1600, q: 0.7, attack: 1.6, hold: seconds, release: 1.4, gain: g * 0.6 });
      },
      roar(hype) {
        noise({ freq: 900, q: 0.4, attack: 0.08, hold: 0.6, release: 2.2, gain: 0.12 + hype * 0.04 });
      },
      fanfare() {
        const seq = [[-5, 0.0], [0, 0.16], [4, 0.32], [7, 0.48], [12, 0.7]];
        for (const [s, d] of seq) {
          tone({ type: "sawtooth", freq: NOTE(s), attack: 0.02, hold: d === 0.7 ? 0.7 : 0.08, release: d === 0.7 ? 1.1 : 0.14, gain: 0.09, delay: d, lowpass: 2600 });
          tone({ type: "square", freq: NOTE(s - 12), attack: 0.02, hold: 0.06, release: 0.18, gain: 0.03, delay: d, lowpass: 1200 });
        }
      },
      tick() {
        tone({ type: "square", freq: 1500, release: 0.025, gain: 0.03 });
      },
      deal() {
        noise({ freq: 3200, q: 1.4, release: 0.07, gain: 0.12 });
      },
    };
  })();

  /* —— Particles (canvas) —— */

  const fx = (() => {
    const canvas = els.fx;
    const g = /** @type {CanvasRenderingContext2D} */ (canvas.getContext("2d"));
    const MAX = 1400;
    let w = 0;
    let h = 0;
    let raf = 0;
    let last = 0;
    /** @type {any[]} */
    const parts = [];
    /** @type {Set<any>} */
    const emitters = new Set();

    function resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(p) {
      if (parts.length >= MAX) parts.splice(0, parts.length - MAX + 1);
      parts.push(p);
    }

    function particle(o, colors) {
      const angle = (o.angle ?? -Math.PI / 2) + rand(-(o.spread ?? Math.PI * 2) / 2, (o.spread ?? Math.PI * 2) / 2);
      const speed = rand((o.speed ?? 6) * 0.35, o.speed ?? 6);
      const life = rand((o.life ?? 900) * 0.6, o.life ?? 900);
      return {
        x: o.x + rand(-(o.jitter ?? 0), o.jitter ?? 0),
        y: o.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        max: life,
        size: rand((o.size ?? 2.4) * 0.5, o.size ?? 2.4),
        color: colors[Math.floor(Math.random() * colors.length)],
        shape: o.shape ?? "spark",
        gravity: o.gravity ?? 0.1,
        drag: o.drag ?? 0.975,
        rot: rand(0, Math.PI * 2),
        vr: rand(-0.25, 0.25),
      };
    }

    function start() {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }

    function loop(now) {
      const dt = Math.min(48, now - last);
      last = now;
      const k = dt / 16.67;

      for (const e of emitters) {
        e.acc += (e.rate * dt) / 1000;
        while (e.acc >= 1) {
          e.acc -= 1;
          spawn(particle({ ...e, x: typeof e.x === "function" ? e.x() : e.x, y: typeof e.y === "function" ? e.y() : e.y }, e.colors));
        }
      }

      g.clearRect(0, 0, w, h);
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0 || p.y > h + 40) {
          parts[i] = parts[parts.length - 1];
          parts.pop();
          continue;
        }
        const drag = Math.pow(p.drag, k);
        p.vx *= drag;
        p.vy = p.vy * drag + p.gravity * k;
        p.x += p.vx * k;
        p.y += p.vy * k;
        p.rot += p.vr * k;
        const alpha = clamp(p.life / p.max, 0, 1);

        if (p.shape === "confetti") {
          g.globalCompositeOperation = "source-over";
          g.globalAlpha = Math.min(1, alpha * 1.6);
          g.fillStyle = p.color;
          g.save();
          g.translate(p.x, p.y);
          g.rotate(p.rot);
          g.fillRect(-p.size * 1.6, -p.size * 0.7, p.size * 3.2, p.size * 1.4);
          g.restore();
        } else if (p.shape === "dot") {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = alpha;
          g.fillStyle = p.color;
          g.beginPath();
          g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          g.fill();
        } else {
          g.globalCompositeOperation = "lighter";
          g.globalAlpha = alpha;
          g.strokeStyle = p.color;
          g.lineWidth = p.size;
          g.lineCap = "round";
          g.beginPath();
          g.moveTo(p.x, p.y);
          g.lineTo(p.x - p.vx * 2.6, p.y - p.vy * 2.6);
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";

      if (parts.length || emitters.size) raf = requestAnimationFrame(loop);
      else {
        raf = 0;
        g.clearRect(0, 0, w, h);
      }
    }

    return {
      resize,
      get width() { return w; },
      get height() { return h; },
      burst(o) {
        const count = Math.round((o.count ?? 60) * (reducedMotion ? 0.3 : 1));
        for (let i = 0; i < count; i += 1) spawn(particle(o, o.colors));
        start();
      },
      confetti(colors) {
        const count = reducedMotion ? 50 : 220;
        for (let i = 0; i < count; i += 1) {
          spawn(particle({ x: rand(0, w), y: rand(-60, -10), angle: Math.PI / 2, spread: 0.8, speed: 4, gravity: 0.06, drag: 0.99, life: 4200, size: 5, shape: "confetti" }, colors));
        }
        start();
      },
      emitter(o) {
        const e = { ...o, acc: 0 };
        emitters.add(e);
        start();
        return () => emitters.delete(e);
      },
      stopEmitters() {
        emitters.clear();
      },
      clear() {
        emitters.clear();
        parts.length = 0;
        if (raf) cancelAnimationFrame(raf);
        raf = 0;
        g.clearRect(0, 0, w, h);
      },
    };
  })();

  /* —— Phase: cancellable, hurry-able sequencing —— */

  class AbortErr extends Error {
    constructor(reason) {
      super("Afgebroken");
      this.name = "AbortError";
      this.reason = reason;
    }
  }

  const isAbort = (err) => err instanceof AbortErr;

  /**
   * Every timer, animation and click-wait of one stage step is registered
   * here, so close/skip/replay can tear everything down in one call.
   */
  class Phase {
    constructor() {
      this.dead = false;
      this.reason = "";
      /** Once set, every current and future job completes instantly. */
      this.fast = false;
      /** @type {Set<{ hurry: () => void, cancel: () => void, fail: (e: Error) => void }>} */
      this.jobs = new Set();
      /** @type {(() => void) | null} */
      this.awaiting = null;
    }

    /** @param {(done: (v?: any) => void) => { hurry: () => void, cancel: () => void }} start */
    job(start) {
      if (this.dead) return Promise.reject(new AbortErr(this.reason));
      return new Promise((resolve, reject) => {
        const job = { hurry: () => {}, cancel: () => {}, fail: (/** @type {Error} */ e) => { if (this.jobs.delete(job)) reject(e); } };
        this.jobs.add(job);
        const ctl = start((v) => {
          if (this.jobs.delete(job)) resolve(v);
        });
        job.hurry = ctl.hurry;
        job.cancel = ctl.cancel;
        if (this.fast) job.hurry();
      });
    }

    wait(ms) {
      return this.job((done) => {
        const t = setTimeout(done, Math.max(0, ms * SPEED));
        return { hurry: () => { clearTimeout(t); done(); }, cancel: () => clearTimeout(t) };
      });
    }

    /**
     * @param {Element} el
     * @param {Keyframe[]} frames
     * @param {KeyframeAnimationOptions & { duration?: number, delay?: number }} [opts]
     */
    animate(el, frames, opts = {}) {
      return this.job((done) => {
        const anim = el.animate(frames, {
          fill: "forwards",
          easing: "ease",
          ...opts,
          duration: Math.max(1, (opts.duration ?? 300) * SPEED),
          delay: (opts.delay ?? 0) * SPEED,
        });
        anim.finished.then(() => done(anim), () => {});
        return {
          hurry: () => { try { anim.finish(); } catch { done(anim); } },
          cancel: () => { try { anim.cancel(); } catch { /* gone */ } },
        };
      });
    }

    /** @param {number} ms @param {(t: number) => void} onFrame */
    tween(ms, onFrame) {
      return this.job((done) => {
        const begin = performance.now();
        const total = Math.max(1, ms * SPEED);
        let raf = 0;
        const step = (now) => {
          const t = Math.min(1, (now - begin) / total);
          onFrame(t);
          if (t >= 1) done();
          else raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return { hurry: () => { cancelAnimationFrame(raf); onFrame(1); done(); }, cancel: () => cancelAnimationFrame(raf) };
      });
    }

    waitAdvance() {
      return this.job((done) => {
        this.awaiting = () => done();
        return { hurry: () => {}, cancel: () => {} };
      }).finally(() => {
        this.awaiting = null;
      });
    }

    advance() {
      const fn = this.awaiting;
      if (!fn) return false;
      this.awaiting = null;
      fn();
      return true;
    }

    hurry() {
      for (const job of [...this.jobs]) job.hurry();
    }

    rush() {
      this.fast = true;
      this.hurry();
    }

    abort(reason) {
      if (this.dead) return;
      this.dead = true;
      this.reason = reason;
      this.awaiting = null;
      const err = new AbortErr(reason);
      for (const job of [...this.jobs]) {
        job.cancel();
        job.fail(err);
      }
      this.jobs.clear();
    }
  }

  /* —— Rendering: cards & packs —— */

  /** @param {GradeCard} card */
  function glyphFor(card) {
    for (const [re, glyph] of GLYPHS) if (re.test(card.subject)) return glyph;
    return card.abbr.slice(0, 3);
  }

  /** @param {GradeCard} card */
  function statsFor(card) {
    return [
      ["CIJ", String(card.ovr)],
      ["WEG", card.weight != null ? String(card.weight) : "–"],
      ["PER", card.period != null ? String(card.period) : "–"],
      ["POG", String(card.attempt)],
      ["DAT", card.date ? formatDate(card.date) : "–"],
      ["SRT", card.kind.slice(0, 4).toUpperCase()],
    ];
  }

  /**
   * @param {GradeCard} card
   * @param {{ size?: "sm" | "md" | "lg" | "xl", faceDown?: boolean, isNew?: boolean, rating?: string }} [opts]
   */
  function cardEl(card, opts = {}) {
    const el = document.createElement("div");
    const hype = hypeOf(card);
    el.className = `fut-card tier-${card.tier} size-${opts.size ?? "md"}${opts.faceDown ? " is-down" : ""}${hype >= 3 ? " is-shiny" : ""}`;
    el.dataset.key = card.key;
    const rating = opts.rating ?? card.display;
    const glyph = glyphFor(card);
    const stats = statsFor(card)
      .map(([k, v]) => `<span><b>${escapeHtml(v)}</b><em>${k}</em></span>`)
      .join("");
    const ribbon = opts.isNew
      ? `<div class="fc-ribbon">NIEUW</div>`
      : card.comeback
        ? `<div class="fc-ribbon">COMEBACK</div>`
        : "";
    el.innerHTML = `
      <div class="fc-inner">
        <div class="fc-face fc-front">
          <div class="fc-pattern"></div>
          ${ribbon}
          <div class="fc-left">
            <div class="fc-rating${rating.length > 3 ? " is-long" : ""}">${escapeHtml(rating)}</div>
            <div class="fc-pos">${escapeHtml(card.abbr)}</div>
            <div class="fc-chip">×${escapeHtml(card.weight ?? "–")}</div>
            ${card.period != null ? `<div class="fc-chip">P${escapeHtml(card.period)}</div>` : ""}
            ${card.exam ? `<div class="fc-chip is-exam" title="Examendossier">EX</div>` : ""}
          </div>
          <div class="fc-portrait"><span class="fc-glyph${glyph.length > 2 ? " is-long" : ""}">${escapeHtml(glyph)}</span></div>
          <div class="fc-name">${escapeHtml(card.subject)}</div>
          <div class="fc-desc">${escapeHtml(card.description || card.kind)}</div>
          <div class="fc-stats">${stats}</div>
          <div class="fc-tag">${escapeHtml(TIERS[card.tier].tag)}</div>
          <div class="fc-shine"></div>
        </div>
        <div class="fc-face fc-back">
          <div class="fc-back-crest">C</div>
          <div class="fc-back-mark">CYFERS</div>
        </div>
      </div>`;
    return el;
  }

  function missingCardEl() {
    const el = document.createElement("div");
    el.className = "fut-card size-sm is-down card-missing";
    el.innerHTML = `<div class="fc-inner"><div class="fc-face fc-front"></div><div class="fc-face fc-back"><div class="fc-back-crest">?</div><div class="fc-back-mark">NOG DICHT</div></div></div>`;
    return el;
  }

  /** @param {PackDef} pack @param {number} count */
  function packEl(pack, count) {
    const el = document.createElement("div");
    el.className = `pack foil-${pack.foil}`;
    el.innerHTML = `
      <div class="pack-body">
        <div class="pack-emblem"><span>C</span></div>
        <div class="pack-label">${escapeHtml(pack.short)}</div>
        <div class="pack-count">${count} ${count === 1 ? "kaart" : "kaarten"}</div>
      </div>
      <div class="pack-top"></div>
      <div class="pack-seam"></div>`;
    return el;
  }

  /* —— Next resultaatpublicatiemoment countdown —— */

  /**
   * Pull a usable Date from the volgende-moment payload.
   * Live shape (`resultaten.RVolgendePublicatieMoment`): `{ value: "<ISO>" }`.
   * `cyfers.fetch` already unwraps the host proxy to that body (`result.data`).
   * Fallbacks keep older / related field names working if Somtoday varies.
   * @param {unknown} raw
   * @returns {{ at: Date | null, label: string }}
   */
  function parsePublicatieMoment(raw) {
    if (raw == null || raw === "") return { at: null, label: "" };
    if (typeof raw === "string") return { at: parseDate(raw), label: "" };
    if (typeof raw !== "object") return { at: null, label: "" };
    /** @type {Record<string, unknown>} */
    const obj = /** @type {any} */ (raw);
    if (Array.isArray(obj.items) && obj.items.length) return parsePublicatieMoment(obj.items[0]);
    const label = typeof obj.naam === "string" ? obj.naam.trim() : "";
    for (const key of [
      "value",
      "datumTijd",
      "publicatieDatumTijd",
      "tijdstip",
      "beginDatumTijd",
      "datum",
    ]) {
      const at = parseDate(obj[key]);
      if (at) return { at, label };
    }
    return { at: null, label };
  }

  /** @param {number} studentId */
  async function fetchNextMoment(studentId) {
    /** @type {SomtodayResultaatPublicatieMoment | null} */
    const data = /** @type {any} */ (
      await cyfers.fetch(`/rest/v1/resultaatpublicatiemomenten/volgende/leerling/${studentId}`)
    );
    return parsePublicatieMoment(data);
  }

  function stopCountdownTick() {
    if (state.countdownTimer != null) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
  }

  function startCountdownTick() {
    stopCountdownTick();
    state.countdownTimer = window.setInterval(() => {
      paintCountdown();
    }, 1000);
  }

  function pad2(n) {
    return String(Math.max(0, n)).padStart(2, "0");
  }

  /** @param {Date} at */
  function formatMomentWhen(at) {
    return at.toLocaleString("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  /**
   * @param {number} totalMs
   * @returns {{ days: number, hours: number, minutes: number, seconds: number }}
   */
  function splitRemaining(totalMs) {
    const sec = Math.max(0, Math.floor(totalMs / 1000));
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    return { days, hours, minutes, seconds };
  }

  function paintCountdown() {
    const el = els.countdown;
    const onStore = state.view === "store";
    // Countdown / live reveal is only meaningful for the current school year.
    if (!state.plaatsingHuidig || !onStore || state.momentStatus === "idle" || state.momentStatus === "loading") {
      el.hidden = true;
      return;
    }

    el.hidden = false;
    el.classList.remove("is-urgent", "is-critical", "is-live", "is-empty");

    if (state.momentStatus === "empty" || state.momentStatus === "error" || !state.momentAt) {
      el.classList.add("is-empty");
      el.innerHTML = `
        <p class="reveal-cd-kicker">Cijferreveal</p>
        <p class="reveal-cd-empty">Geen moment gepland</p>
        <p class="reveal-cd-meta">Je school publiceert cijfers direct, of er staat nog geen publicatiemoment klaar.</p>`;
      return;
    }

    const now = Date.now();
    const target = state.momentAt.getTime();
    const remaining = target - now;
    const when = formatMomentWhen(state.momentAt);
    const labelBit = state.momentLabel ? ` · ${escapeHtml(state.momentLabel)}` : "";

    if (remaining <= 0) {
      el.classList.add("is-live");
      el.innerHTML = `
        <p class="reveal-cd-kicker">Cijferreveal</p>
        <p class="reveal-cd-empty">Nu — nieuwe cijfers kunnen binnenkomen</p>
        <p class="reveal-cd-meta">Het publicatiemoment is bereikt${labelBit}. Packs vernieuwen…</p>`;
      const key = state.momentAt.toISOString();
      if (state.zeroHandledFor !== key) {
        state.zeroHandledFor = key;
        void onCountdownZero();
      }
      return;
    }

    const parts = splitRemaining(remaining);
    if (remaining <= 60_000) el.classList.add("is-critical");
    else if (remaining <= 3_600_000) el.classList.add("is-urgent");

    const units = [
      ["dagen", parts.days, parts.days > 0 || remaining >= 86400_000],
      ["uur", parts.hours, true],
      ["min", parts.minutes, true],
      ["sec", parts.seconds, true],
    ].filter(([, , show]) => show);

    const digits = units
      .map(([label, value], i) => {
        const sep = i < units.length - 1 ? `<span class="reveal-cd-sep" aria-hidden="true">:</span>` : "";
        return `<div class="reveal-cd-unit"><strong>${pad2(/** @type {number} */ (value))}</strong><span>${label}</span></div>${sep}`;
      })
      .join("");

    el.innerHTML = `
      <p class="reveal-cd-kicker">Volgende cijferreveal</p>
      <div class="reveal-cd-digits" aria-label="${parts.days} dagen ${parts.hours} uur ${parts.minutes} minuten ${parts.seconds} seconden">${digits}</div>
      <p class="reveal-cd-meta">Om <strong>${escapeHtml(when)}</strong>${labelBit}</p>`;
  }

  async function onCountdownZero() {
    if (state.studentId == null) return;
    await refreshMoment(state.studentId);
    if (!run && !state.loading) await load();
    setStatus("Publicatiemoment bereikt — nieuwe cijfers kunnen nu beschikbaar zijn.", "muted");
  }

  /** @param {number} studentId */
  async function refreshMoment(studentId) {
    const seq = ++state.momentSeq;
    state.momentStatus = "loading";
    paintCountdown();
    try {
      const { at, label } = await fetchNextMoment(studentId);
      if (seq !== state.momentSeq) return;
      state.momentAt = at;
      state.momentLabel = label;
      if (!at) {
        state.momentStatus = "empty";
        stopCountdownTick();
      } else if (at.getTime() <= Date.now()) {
        // Already past (e.g. just published) — show live UI without re-triggering grade reload.
        state.momentStatus = "ready";
        state.zeroHandledFor = at.toISOString();
        startCountdownTick();
      } else {
        state.momentStatus = "ready";
        state.zeroHandledFor = "";
        startCountdownTick();
      }
    } catch {
      if (seq !== state.momentSeq) return;
      state.momentAt = null;
      state.momentLabel = "";
      state.momentStatus = "empty";
      stopCountdownTick();
    }
    paintCountdown();
  }

  /* —— Store —— */

  function packCards(pack) {
    if (!state.cards.length) return [];
    return pack.pick(state.cards, state.vakChoice).filter(Boolean);
  }

  function subjectsList() {
    const counts = new Map();
    for (const c of state.cards) counts.set(c.subject, (counts.get(c.subject) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "nl"));
  }

  function renderStore() {
    const frag = document.createDocumentFragment();

    if (state.loading && !state.cards.length) {
      els.store.replaceChildren();
      return;
    }

    if (!state.cards.length) {
      const p = document.createElement("p");
      p.className = "empty store-empty";
      p.textContent = "Nog geen cijfers gevonden. Zodra er cijfers in Somtoday staan, kun je hier packs openen.";
      els.store.replaceChildren(p);
      return;
    }

    const stats = document.createElement("div");
    stats.className = "store-stats";
    const best = state.stats.best;
    stats.innerHTML = `
      <span>Packs geopend: <strong>${state.stats.packs}</strong></span>
      <span>Walkouts: <strong>${state.stats.walkouts}</strong></span>
      <span>Beste trekking ooit: <strong>${best ? `${escapeHtml(best.subject)} ${escapeHtml(best.display)}` : "—"}</strong></span>`;
    frag.appendChild(stats);

    const subjects = subjectsList();
    if (!state.vakChoice || !subjects.some(([s]) => s === state.vakChoice)) state.vakChoice = subjects[0]?.[0] ?? "";

    for (const pack of PACKS) {
      const unseen = pack.id === "nieuw" ? state.cards.filter((c) => !state.seen.has(c.key)).length : 0;
      const count = pack.id === "nieuw"
        ? Math.min(unseen, pack.size)
        : pack.id === "vak"
          ? Math.min(pack.size, subjects.find(([s]) => s === state.vakChoice)?.[1] ?? 0)
          : Math.min(pack.size, state.cards.length);
      const disabled = count === 0;

      const tile = document.createElement("article");
      tile.className = `pack-tile${disabled ? " is-disabled" : ""}`;
      tile.dataset.pack = pack.id;

      const art = document.createElement("button");
      art.type = "button";
      art.className = "pack-art-btn";
      art.dataset.open = pack.id;
      art.disabled = disabled;
      art.setAttribute("aria-label", `${pack.name} openen`);
      art.appendChild(packEl(pack, count || pack.size));

      const info = document.createElement("div");
      info.className = "pack-info";
      const blurb = pack.id === "nieuw" && disabled ? "Geen nieuwe cijfers — alles is al geopend" : pack.blurb;
      info.innerHTML = `<h3>${escapeHtml(pack.name)}</h3><p class="muted">${escapeHtml(blurb)}</p>`;

      if (pack.id === "vak") {
        const select = document.createElement("select");
        select.setAttribute("aria-label", "Vak kiezen");
        select.dataset.vakSelect = "1";
        for (const [subject, n] of subjects) {
          const opt = document.createElement("option");
          opt.value = subject;
          opt.textContent = `${subject} (${n})`;
          opt.selected = subject === state.vakChoice;
          select.appendChild(opt);
        }
        info.appendChild(select);
      }

      const open = document.createElement("button");
      open.type = "button";
      open.className = "primary";
      open.dataset.open = pack.id;
      open.disabled = disabled;
      open.textContent = "Openen";
      info.appendChild(open);

      tile.append(art, info);
      if (pack.id === "nieuw" && unseen > 0) {
        const badge = document.createElement("span");
        badge.className = "pack-badge";
        badge.textContent = String(unseen);
        badge.setAttribute("aria-label", `${unseen} nieuwe cijfers`);
        tile.appendChild(badge);
      }
      frag.appendChild(tile);
    }
    els.store.replaceChildren(frag);
  }

  /* —— Club —— */

  function renderClub() {
    const total = state.cards.length;
    const owned = state.cards.filter((c) => state.seen.has(c.key));
    const pct = total ? Math.round((owned.length / total) * 100) : 0;
    els.clubProgressText.innerHTML = `<strong>${owned.length}</strong> van ${total} cijfers verzameld (${pct}%)`;
    els.clubBar.style.width = `${pct}%`;
    els.clubCount.textContent = total ? `${owned.length}/${total}` : "";

    const filters = [["alle", "Alle", ""], ...TIER_ORDER.map((t) => [t, TIERS[t].label, TIERS[t].color])];
    els.clubFilters.innerHTML = filters
      .map(([id, label, color]) => {
        const n = id === "alle" ? owned.length : owned.filter((c) => c.tier === id).length;
        const dot = color ? `<span class="chip-dot" style="--dot:${color}"></span>` : "";
        return `<button type="button" data-filter="${id}" aria-pressed="${state.clubFilter === id}">${dot}${escapeHtml(label)} ${n}</button>`;
      })
      .join("");

    const sort = els.clubSort.value;
    const showMissing = els.clubShowMissing.checked;
    let list = state.cards.filter((c) => state.clubFilter === "alle" || c.tier === state.clubFilter);
    if (!showMissing) list = list.filter((c) => state.seen.has(c.key));
    list.sort((a, b) => {
      const ownedDiff = Number(state.seen.has(b.key)) - Number(state.seen.has(a.key));
      if (ownedDiff) return ownedDiff;
      if (sort === "date") return byDateDesc(a, b);
      if (sort === "subject") return a.subject.localeCompare(b.subject, "nl") || b.ovr - a.ovr;
      return byOvrDesc(a, b);
    });

    if (!list.length) {
      const p = document.createElement("p");
      p.className = "empty";
      p.textContent = owned.length ? "Geen kaarten in deze selectie." : "Je club is nog leeg. Open een pack in de winkel!";
      els.clubGrid.replaceChildren(p);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const card of list) {
      if (state.seen.has(card.key)) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "card-btn";
        btn.dataset.card = card.key;
        btn.setAttribute("aria-label", `${card.subject} ${card.display}, ${TIERS[card.tier].label}`);
        btn.appendChild(cardEl(card, { size: "sm" }));
        frag.appendChild(btn);
      } else {
        const wrap = document.createElement("div");
        wrap.setAttribute("aria-label", "Nog niet geopend");
        wrap.appendChild(missingCardEl());
        frag.appendChild(wrap);
      }
    }
    els.clubGrid.replaceChildren(frag);
  }

  /* —— Summary / tabs / status —— */

  function setStatus(message, kind = "muted") {
    els.status.hidden = !message;
    els.status.className = kind;
    els.status.textContent = message;
  }

  function renderSummary() {
    if (state.loading) {
      els.summary.textContent = "Cijfers laden…";
      return;
    }
    const total = state.cards.length;
    const unseen = state.cards.filter((c) => !state.seen.has(c.key)).length;
    const year = state.plaatsingen.find((p) => plaatsingKeyOf(p) === state.plaatsingKey);
    const yearLabel = year ? plaatsingLabelOf(year) : "";
    if (!total) {
      els.summary.textContent = yearLabel ? `Geen cijfers gevonden voor ${yearLabel}` : "Geen cijfers gevonden";
      return;
    }
    if (state.plaatsingHuidig) {
      els.summary.textContent = `${total} cijfers in je dossier · ${unseen} nog niet geopend`;
    } else {
      els.summary.textContent = `${total} cijfers · ${yearLabel} · ${unseen} nog niet geopend`;
    }
  }

  function setView(view) {
    state.view = view;
    const store = view === "store";
    els.store.hidden = !store;
    els.club.hidden = store;
    els.tabStore.classList.toggle("primary", store);
    els.tabClub.classList.toggle("primary", !store);
    els.tabStore.setAttribute("aria-selected", String(store));
    els.tabClub.setAttribute("aria-selected", String(!store));
    paintCountdown();
    if (!store) renderClub();
  }

  function renderSound() {
    for (const btn of [els.soundToggle, els.stageSound]) {
      btn.textContent = state.sound ? "Geluid aan" : "Geluid uit";
      btn.setAttribute("aria-pressed", String(state.sound));
    }
  }

  function renderAll() {
    renderSummary();
    renderYearPick();
    renderStore();
    renderClub();
    els.refresh.disabled = state.loading;
  }

  /* —— Persistence (cyfers.storage → host file under plugin-storage/, per student) —— */

  const seenKey = () => `seen:${state.studentId}:${state.plaatsingKey || "unknown"}`;
  const statsKey = () => `stats:${state.studentId}:${state.plaatsingKey || "unknown"}`;
  /** Pre-schooljaar keys (current year only) — migrate once into scoped keys. */
  const legacySeenKey = () => `seen:${state.studentId}`;
  const legacyStatsKey = () => `stats:${state.studentId}`;

  async function loadPersisted() {
    let [seenRaw, statsRaw] = await Promise.all([
      cyfers.storage.get(seenKey()).catch(() => null),
      cyfers.storage.get(statsKey()).catch(() => null),
    ]);
    // Migrate unscoped club progress into the current plaatsing bucket.
    if (state.plaatsingHuidig && seenRaw == null && statsRaw == null) {
      const [legacySeen, legacyStats] = await Promise.all([
        cyfers.storage.get(legacySeenKey()).catch(() => null),
        cyfers.storage.get(legacyStatsKey()).catch(() => null),
      ]);
      seenRaw = legacySeen;
      statsRaw = legacyStats;
    }
    try {
      const list = seenRaw ? JSON.parse(seenRaw) : [];
      state.seen = new Set(Array.isArray(list) ? list.map(String) : []);
    } catch {
      state.seen = new Set();
    }
    try {
      const parsed = statsRaw ? JSON.parse(statsRaw) : null;
      state.stats = {
        packs: Number(parsed?.packs) || 0,
        walkouts: Number(parsed?.walkouts) || 0,
        best: parsed?.best && typeof parsed.best === "object" ? parsed.best : null,
      };
    } catch {
      state.stats = { packs: 0, walkouts: 0, best: null };
    }
  }

  function persist() {
    const known = new Set(state.cards.map((c) => c.key));
    const seen = [...state.seen].filter((k) => known.has(k) || !state.cards.length);
    cyfers.storage.set(seenKey(), JSON.stringify(seen)).catch(() => {});
    cyfers.storage.set(statsKey(), JSON.stringify(state.stats)).catch(() => {});
  }

  /* —— Loading —— */

  async function load() {
    const seq = ++state.loadSeq;
    state.loading = true;
    setStatus("");
    renderAll();
    try {
      if (!state.students.length) {
        const ctx = await cyfers.getContext();
        state.students = ctx.students ?? [];
        renderStudentPick();
      }
      if (state.studentId == null) state.studentId = state.students[0]?.id ?? null;
      if (state.studentId == null) throw new Error("Geen leerling gevonden voor dit account.");

      const studentId = state.studentId;
      state.plaatsingen = await fetchPlaatsingen(studentId);
      if (!state.plaatsingen.length) throw new Error("Geen plaatsingen gevonden voor deze leerling.");

      let selected = state.plaatsingen.find((p) => plaatsingKeyOf(p) === state.plaatsingKey) || null;
      if (!selected) {
        selected = state.plaatsingen.find((p) => p.huidig) || state.plaatsingen[0];
        state.plaatsingKey = plaatsingKeyOf(selected);
      }
      state.plaatsingHuidig = Boolean(selected.huidig);
      renderYearPick();

      await loadPersisted();
      const plaatsing = { key: state.plaatsingKey, huidig: state.plaatsingHuidig };
      const [{ cards, partial }] = await Promise.all([
        loadCards(studentId, plaatsing),
        state.plaatsingHuidig ? refreshMoment(studentId) : Promise.resolve(),
      ]);
      if (seq !== state.loadSeq) return;
      state.cards = cards;
      if (!state.plaatsingHuidig) {
        state.momentAt = null;
        state.momentLabel = "";
        state.momentStatus = "idle";
        stopCountdownTick();
      }
      if (partial) setStatus("Niet alle cijfers konden worden geladen; je ziet een deel van je dossier.");
    } catch (error) {
      if (seq !== state.loadSeq) return;
      state.cards = [];
      setStatus(error instanceof Error ? error.message : "Cijfers laden mislukt.", "error");
    } finally {
      if (seq === state.loadSeq) {
        state.loading = false;
        renderAll();
        paintCountdown();
      }
    }
  }

  function renderYearPick() {
    if (!state.plaatsingen.length) {
      els.yearPick.innerHTML = `<option value="">Geen schooljaren</option>`;
      els.yearPick.disabled = true;
      return;
    }
    els.yearPick.innerHTML = state.plaatsingen
      .map((p) => {
        const key = plaatsingKeyOf(p);
        const selected = key === state.plaatsingKey ? " selected" : "";
        return `<option value="${escapeHtml(key)}"${selected}>${escapeHtml(plaatsingLabelOf(p))}</option>`;
      })
      .join("");
    els.yearPick.disabled = state.loading;
  }

  function renderStudentPick() {
    els.studentPick.hidden = state.students.length < 2;
    els.studentPick.innerHTML = state.students
      .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
      .join("");
  }

  /* —— Stage sequencing —— */

  /**
   * @typedef {{
   *   id: number,
   *   pack: PackDef,
   *   choice: string,
   *   cards: GradeCard[],
   *   best: GradeCard,
   *   newKeys: Set<string>,
   *   phase: Phase,
   *   step: "intro" | "reveal" | "board",
   *   committed: boolean,
   *   opener: Element | null,
   * }} Run
   */

  /** @type {Run | null} */
  let run = null;
  let runSeq = 0;

  /** Every pack card, ascending by rating so the biggest pull comes last. */
  function revealQueue(cards) {
    return cards.slice().sort(byOvrDesc).reverse();
  }

  /**
   * Animate the rating number from 1,0 up to the real grade (cancellable via Phase).
   * @param {Phase} p
   * @param {HTMLElement} ratingEl
   * @param {GradeCard} card
   * @param {number} [scale=1]
   */
  async function tickUpRating(p, ratingEl, card, scale = 1) {
    if (card.grade == null) return;
    let lastTick = 0;
    const target = card.grade;
    await p.tween(1000 * scale, (t) => {
      const eased = 1 - Math.pow(1 - t, 3);
      ratingEl.textContent = formatGrade(1 + (target - 1) * eased);
      const now = performance.now();
      if (t < 1 && now - lastTick > 70) {
        lastTick = now;
        audio.tick();
      }
    });
    ratingEl.textContent = card.display;
    ratingEl.classList.toggle("is-long", card.display.length > 3);
  }

  function setHint(text) {
    els.hint.textContent = text;
  }

  function announce(text) {
    els.live.textContent = text;
  }

  function startOpen(packId) {
    if (run || state.loading) return;
    const pack = PACKS.find((p) => p.id === packId);
    if (!pack) return;
    const cards = packCards(pack);
    if (!cards.length) return;

    audio.ensure();
    audio.ui();
    const sorted = cards.slice().sort(byOvrDesc);
    /** @type {Run} */
    const r = {
      id: ++runSeq,
      pack,
      choice: state.vakChoice,
      cards,
      best: sorted[0],
      newKeys: new Set(cards.filter((c) => !state.seen.has(c.key)).map((c) => c.key)),
      phase: new Phase(),
      step: "intro",
      committed: false,
      opener: document.activeElement,
    };
    run = r;

    els.app.inert = true;
    els.stage.hidden = false;
    els.stage.dataset.mood = "";
    els.stageContent.classList.remove("is-board");
    els.stageContent.replaceChildren();
    els.stageTitle.textContent = pack.id === "vak" ? `Vakpack · ${r.choice}` : pack.name;
    els.stageProgress.textContent = "";
    els.skipBtn.hidden = false;
    fx.resize();
    els.stage.focus({ preventScroll: true });

    void play(r);
  }

  /** @param {Run} r */
  async function play(r) {
    try {
      await intro(r);
      await highlights(r);
    } catch (err) {
      if (!isAbort(err)) console.error(err);
    }
    if (run !== r) return;
    void showBoard(r);
  }

  function skip() {
    if (!run || run.step === "board") return;
    run.phase.abort("skip");
  }

  function closeStage() {
    const r = run;
    if (!r) return;
    run = null;
    r.phase.abort("close");
    closeDetail();
    fx.clear();
    audio.stopAll();
    els.flash.getAnimations().forEach((a) => a.cancel());
    els.stageContent.getAnimations().forEach((a) => a.cancel());
    els.stageContent.replaceChildren();
    els.stage.hidden = true;
    els.app.inert = false;
    setHint("");
    announce("");
    renderAll();
    const back = r.opener instanceof HTMLElement && r.opener.isConnected ? r.opener : document.querySelector(`[data-open="${r.pack.id}"]`);
    if (back instanceof HTMLElement) back.focus({ preventScroll: true });
  }

  /** @param {Phase} p @param {string} color @param {number} hype */
  async function flash(p, color, hype) {
    els.flash.style.setProperty("--flash", color);
    audio.boom(hype);
    await p.animate(els.flash, [{ opacity: 0 }, { opacity: 1 }], { duration: 130, easing: "ease-out" });
    await p.wait(90 + hype * 45);
    quiet(p.animate(els.flash, [{ opacity: 1 }, { opacity: 0 }], { duration: 700 + hype * 80, easing: "ease-in" }));
  }

  /** @param {number} amp @param {number} steps */
  function shakeFrames(amp, steps) {
    /** @type {Keyframe[]} */
    const frames = [{ transform: "translate(0,0) rotate(0)" }];
    for (let i = 0; i < steps; i += 1) {
      frames.push({ transform: `translate(${rand(-amp, amp).toFixed(1)}px, ${rand(-amp * 0.6, amp * 0.6).toFixed(1)}px) rotate(${rand(-amp * 0.4, amp * 0.4).toFixed(2)}deg)` });
    }
    frames.push({ transform: "translate(0,0) rotate(0)" });
    return frames;
  }

  /** @param {Phase} p @param {number} amp */
  function shakeStage(p, amp) {
    quiet(p.animate(els.stageContent, shakeFrames(amp, 8), { duration: 420, easing: "linear", fill: "none" }));
  }

  /** @param {Run} r */
  async function intro(r) {
    const p = r.phase;
    const hype = hypeOf(r.best);
    const tier = TIERS[r.best.tier];

    const scene = document.createElement("div");
    scene.className = "pack-scene";
    scene.style.setProperty("--ray", tier.color);
    scene.innerHTML = `<div class="pack-rays"></div><div class="pack-beam"></div><div class="pedestal"></div>`;
    const float = document.createElement("div");
    float.className = "pack-float";
    const pack = packEl(r.pack, r.cards.length);
    pack.style.setProperty("--leak", tier.color);
    float.appendChild(pack);
    scene.appendChild(float);
    els.stageContent.replaceChildren(scene);

    const rays = /** @type {HTMLElement} */ (scene.querySelector(".pack-rays"));
    const beam = /** @type {HTMLElement} */ (scene.querySelector(".pack-beam"));
    const seam = /** @type {HTMLElement} */ (pack.querySelector(".pack-seam"));
    const top = /** @type {HTMLElement} */ (pack.querySelector(".pack-top"));

    audio.whoosh();
    await p.animate(pack, [
      { transform: "translateY(-110vh) rotate(-16deg) scale(0.8)", opacity: 0 },
      { offset: 0.72, transform: "translateY(3vh) rotate(3deg) scale(1.03)", opacity: 1 },
      { transform: "none", opacity: 1 },
    ], { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)" });
    audio.thud();
    const box = pack.getBoundingClientRect();
    fx.burst({ x: box.left + box.width / 2, y: box.bottom, count: 40, colors: ["#ffffff", "#cfd8ea"], angle: -Math.PI / 2, spread: Math.PI * 0.9, speed: 5, gravity: 0.15, life: 700, shape: "dot", size: 2 });

    float.classList.add("is-idle");
    setHint("Klik op het pack om het te openen");
    await p.waitAdvance();
    setHint("");
    float.classList.remove("is-idle");

    // Charge-up: shake bursts escalate with the best card in the pack (the "tease").
    const bursts = 2 + (hype >= 4 ? 1 : 0) + (hype >= 6 ? 1 : 0);
    for (let i = 0; i < bursts; i += 1) {
      const strength = (i + 1) / bursts;
      const amp = (5 + hype * 1.6) * (0.55 + strength * 0.75);
      audio.rumble(0.42, clamp(0.25 + strength * 0.5 + hype * 0.04, 0, 1));
      quiet(p.animate(rays, [{ opacity: (strength - 0.3) * 0.5 }, { opacity: strength * (0.35 + hype * 0.09) }], { duration: 420 }));
      quiet(p.animate(seam, [{ opacity: strength * 0.4 }, { opacity: Math.min(1, strength * (0.5 + hype * 0.1)) }], { duration: 420 }));
      if (hype >= 4 && i === bursts - 1) {
        shakeStage(p, 3 + hype);
        const b = pack.getBoundingClientRect();
        fx.burst({ x: b.left + b.width / 2, y: b.top + b.height * 0.16, count: 30 + hype * 10, colors: tier.particles, speed: 7, gravity: 0.08, life: 800 });
      }
      await p.animate(pack, shakeFrames(amp, 12), { duration: 460, easing: "linear", fill: "none" });
      await p.wait(Math.max(80, 230 - i * 50));
    }

    // Tear the top strip off and let the light pour out.
    audio.tear();
    const b = pack.getBoundingClientRect();
    quiet(p.animate(top, [
      { transform: "none", opacity: 1 },
      { transform: "translate(45%, -170%) rotate(32deg)", opacity: 0 },
    ], { duration: 650, easing: "cubic-bezier(.3,.6,.4,1)" }));
    quiet(p.animate(beam, [{ transform: "scaleY(0)", opacity: 0 }, { transform: "scaleY(1)", opacity: 0.95 }], { duration: 380, easing: "ease-out" }));
    fx.burst({ x: b.left + b.width / 2, y: b.top + b.height * 0.15, count: 60 + hype * 25, colors: tier.particles, angle: -Math.PI / 2, spread: Math.PI * 0.8, speed: 9 + hype, gravity: 0.12, life: 1100 });
    await p.animate(pack, [{ transform: "scale(1)" }, { transform: "scale(1.08) translateY(-2%)" }], { duration: 420, easing: "ease-out" });

    // Like FUT: once the pack is torn, its contents are yours even if you close early.
    commitRun(r);
    els.stage.dataset.mood = r.best.tier;
    await flash(p, tier.flash, hype);
    els.stageContent.replaceChildren();
  }

  /** @param {Run} r */
  async function highlights(r) {
    const p = r.phase;
    r.step = "reveal";
    const list = revealQueue(r.cards);
    for (let i = 0; i < list.length; i += 1) {
      const card = list[i];
      els.stageProgress.textContent = list.length > 1 ? `${i + 1} / ${list.length}` : "";
      els.stage.dataset.mood = card.tier;
      fx.stopEmitters();
      const view = hypeOf(card) >= WALKOUT_HYPE ? await walkout(p, card, r) : await quickReveal(p, card, r);
      announce(`${card.subject}: ${card.display} — ${TIERS[card.tier].label}`);
      setHint(i < list.length - 1 ? "Klik voor de volgende kaart" : "Klik voor het packoverzicht");
      await p.waitAdvance();
      setHint("");
      fx.stopEmitters();
      audio.whoosh();
      await p.animate(view, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateX(-12vw) scale(0.9)" }], { duration: 320, easing: "ease-in" });
      els.stageContent.replaceChildren();
    }
  }

  /**
   * @param {GradeCard} card
   * @param {number} hype
   */
  function walkoutSteps(card, hype) {
    const steps = [
      { label: "Vak", value: card.abbr, caption: card.subject, shape: "" },
      { label: card.exam ? "Examendossier" : "Toets", value: card.kind, caption: [card.period != null ? `Periode ${card.period}` : "", formatDate(card.date, true)].filter((s) => s && s !== "—").join(" · "), shape: "shape-badge" },
      { label: "Weging", value: card.weight != null ? `×${card.weight}` : "×?", caption: card.description || "", shape: "shape-crest" },
    ];
    return hype >= 5 ? steps : [steps[0], steps[2]];
  }

  /**
   * @param {Phase} p
   * @param {GradeCard} card
   * @param {Run} r
   */
  async function walkout(p, card, r) {
    const hype = hypeOf(card);
    const tier = TIERS[card.tier];
    const slow = hype >= 6 ? 1.3 : 1;

    const view = document.createElement("div");
    view.className = "walkout";
    view.style.setProperty("--wo", tier.color);
    view.innerHTML = `
      <div class="wo-flare"></div>
      <div class="wo-beam"></div>
      <div class="wo-halo"></div>
      <div class="wo-callout"></div>
      <div class="wo-slot"><div class="wo-ring"></div></div>
      <div class="wo-banner">
        <div class="wo-banner-tier">${escapeHtml(tier.label)}</div>
        <div class="wo-banner-name">${escapeHtml(card.subject)} · ${escapeHtml(card.display)}</div>
        <div class="wo-banner-sub">${escapeHtml([card.description, card.niveau].filter(Boolean).join(" · "))}</div>
      </div>`;
    els.stageContent.replaceChildren(view);
    const q = (/** @type {string} */ s) => /** @type {HTMLElement} */ (view.querySelector(s));
    const slot = q(".wo-slot");
    const ring = q(".wo-ring");

    const steps = walkoutSteps(card, hype);
    audio.crowd(2.2 * steps.length + 2, hype);
    fx.emitter({
      x: () => fx.width / 2 + rand(-fx.width * 0.12, fx.width * 0.12),
      y: () => fx.height + 10,
      rate: 35 + hype * 18,
      colors: tier.particles,
      angle: -Math.PI / 2,
      spread: 0.5,
      speed: 9,
      gravity: -0.02,
      drag: 0.985,
      life: 1600,
      size: 2.2,
    });

    quiet(p.animate(q(".wo-beam"), [{ opacity: 0 }, { opacity: 0.85 }], { duration: 900 }));
    await p.animate(q(".wo-flare"), [{ opacity: 0, transform: "scale(0.4)" }, { opacity: 0.9, transform: "scale(1)" }], { duration: 800, easing: "ease-out" });

    for (const step of steps) {
      const el = document.createElement("div");
      el.className = "wo-step";
      const long = step.value.length > 4;
      el.innerHTML = `
        <div class="wo-label">${escapeHtml(step.label)}</div>
        <div class="wo-emblem ${step.shape}${long ? " is-long" : ""}">${escapeHtml(step.value)}</div>
        <div class="wo-caption">${escapeHtml(step.caption)}</div>`;
      slot.replaceChildren(ring, el);
      audio.drum(hype);
      audio.shimmer(0.08);
      await p.animate(el, [
        { transform: "scale(2.6) rotateY(-540deg)", opacity: 0, filter: "blur(16px)" },
        { offset: 0.75, transform: "scale(0.94) rotateY(12deg)", opacity: 1, filter: "blur(0px)" },
        { transform: "scale(1) rotateY(0deg)", opacity: 1, filter: "blur(0px)" },
      ], { duration: 900 * slow, easing: "cubic-bezier(.2,.7,.2,1)" });
      fx.burst({ x: fx.width / 2, y: fx.height / 2, count: 26 + hype * 6, colors: tier.particles, speed: 6, gravity: 0.05, life: 700, size: 2 });
      await p.wait(850 * slow);
      await p.animate(el, [{ opacity: 1, transform: "scale(1)" }, { opacity: 0, transform: "scale(0.6) translateY(-6vh)", filter: "blur(6px)" }], { duration: 260, easing: "ease-in" });
    }

    // The card itself.
    const isNumeric = card.grade != null;
    const c = cardEl(card, { size: "xl", faceDown: true, isNew: r.newKeys.has(card.key), rating: isNumeric ? "1,0" : card.display });
    slot.replaceChildren(ring, c);
    const inner = /** @type {HTMLElement} */ (c.querySelector(".fc-inner"));
    const ratingEl = /** @type {HTMLElement} */ (c.querySelector(".fc-rating"));
    audio.whoosh();
    await p.animate(c, [
      { transform: "translateY(45vh) scale(0.25)", opacity: 0 },
      { transform: "translateY(0) scale(1)", opacity: 1 },
    ], { duration: 700, easing: "cubic-bezier(.2,.9,.25,1)" });
    await p.wait(250 * slow);
    audio.whoosh();
    await p.animate(inner, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(1080deg)" }], { duration: 1300 * slow, easing: "cubic-bezier(.15,.6,.2,1)" });

    // Landing impact.
    audio.boom(hype);
    audio.roar(hype);
    shakeStage(p, 6 + hype);
    quiet(p.animate(ring, [{ opacity: 1, transform: "scale(0.6)" }, { opacity: 0, transform: "scale(3.2)" }], { duration: 900, easing: "ease-out" }));
    quiet(p.animate(q(".wo-halo"), [{ opacity: 0 }, { opacity: 1 }], { duration: 500 }));
    const cb = c.getBoundingClientRect();
    fx.burst({ x: cb.left + cb.width / 2, y: cb.top + cb.height / 2, count: 160 + hype * 40, colors: tier.particles, speed: 13 + hype, gravity: 0.1, life: 1500, size: 2.8 });

    await tickUpRating(p, ratingEl, card, slow);
    audio.chime(tier.rank);

    const callout = q(".wo-callout");
    callout.textContent = hype >= 6 ? "ICOON!" : hype >= 5 ? "TOETS VAN DE WEEK!" : "WALKOUT!";
    quiet(p.animate(callout, [
      { opacity: 0, transform: "scale(2.2)", letterSpacing: "0.6em" },
      { opacity: 1, transform: "scale(1)", letterSpacing: "0.04em" },
    ], { duration: 550, easing: "cubic-bezier(.2,.8,.2,1)" }));
    await p.animate(q(".wo-banner"), [{ opacity: 0, transform: "translateY(20px)" }, { opacity: 1, transform: "none" }], { duration: 450 });

    if (hype >= 6) {
      audio.fanfare();
      fx.confetti(tier.particles);
      for (let i = 0; i < 3; i += 1) {
        await p.wait(320);
        fx.burst({ x: rand(fx.width * 0.15, fx.width * 0.85), y: rand(fx.height * 0.15, fx.height * 0.45), count: 90, colors: tier.particles, speed: 8, gravity: 0.07, life: 1300, shape: "dot", size: 2.4 });
        audio.drum(3);
      }
    }
    return view;
  }

  /**
   * @param {Phase} p
   * @param {GradeCard} card
   * @param {Run} r
   */
  async function quickReveal(p, card, r) {
    const hype = hypeOf(card);
    const tier = TIERS[card.tier];
    const isNumeric = card.grade != null;

    const view = document.createElement("div");
    view.className = "reveal";
    view.style.setProperty("--wo", tier.color);
    view.innerHTML = `
      <div class="wo-halo"></div>
      <div class="wo-slot"></div>
      <div class="wo-banner">
        <div class="wo-banner-tier">${escapeHtml(tier.label)}</div>
        <div class="wo-banner-name">${escapeHtml(card.subject)} · ${escapeHtml(card.display)}</div>
        <div class="wo-banner-sub">${escapeHtml(card.description)}</div>
      </div>`;
    els.stageContent.replaceChildren(view);
    const slot = /** @type {HTMLElement} */ (view.querySelector(".wo-slot"));
    const c = cardEl(card, { size: "xl", faceDown: true, isNew: r.newKeys.has(card.key), rating: isNumeric ? "1,0" : card.display });
    slot.appendChild(c);
    const inner = /** @type {HTMLElement} */ (c.querySelector(".fc-inner"));
    const ratingEl = /** @type {HTMLElement} */ (c.querySelector(".fc-rating"));

    audio.whoosh();
    await p.animate(c, [
      { transform: "translateY(35vh) rotate(-6deg) scale(0.7)", opacity: 0 },
      { transform: "none", opacity: 1 },
    ], { duration: 560, easing: "cubic-bezier(.2,.85,.25,1)" });
    await p.wait(260 + hype * 140);

    audio.deal();
    const flip = p.animate(inner, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(360deg)" }], { duration: 620, easing: "cubic-bezier(.3,.7,.2,1)" });
    quiet(flip);
    await p.wait(300);
    const cb = c.getBoundingClientRect();
    fx.burst({ x: cb.left + cb.width / 2, y: cb.top + cb.height / 2, count: 40 + hype * 30, colors: tier.particles, speed: 6 + hype * 2, gravity: 0.1, life: 1000 });
    quiet(p.animate(view.querySelector(".wo-halo"), [{ opacity: 0 }, { opacity: 0.4 + hype * 0.15 }], { duration: 450 }));
    await flip;
    await tickUpRating(p, ratingEl, card, 0.75);
    audio.chime(tier.rank);
    await p.animate(/** @type {HTMLElement} */ (view.querySelector(".wo-banner")), [{ opacity: 0, transform: "translateY(16px)" }, { opacity: 1, transform: "none" }], { duration: 380 });
    return view;
  }

  /** @param {Run} r */
  function commitRun(r) {
    if (r.committed) return;
    r.committed = true;
    for (const c of r.cards) state.seen.add(c.key);
    state.stats.packs += 1;
    state.stats.walkouts += r.cards.filter((c) => hypeOf(c) >= WALKOUT_HYPE).length;
    const best = r.best;
    if (!state.stats.best || best.ovr > state.stats.best.ovr) {
      state.stats.best = { subject: best.subject, display: best.display, ovr: best.ovr, tier: best.tier };
    }
    persist();
  }

  /** @param {Run} r */
  async function showBoard(r) {
    r.phase.abort("board");
    const p = new Phase();
    r.phase = p;
    r.step = "board";
    commitRun(r);

    fx.stopEmitters();
    audio.stopAll();
    els.flash.getAnimations().forEach((a) => a.cancel());
    els.flash.style.opacity = "0";
    setHint("");
    els.skipBtn.hidden = true;
    els.stageProgress.textContent = "";
    els.stage.dataset.mood = r.best.tier;
    els.stageContent.classList.add("is-board");

    const sorted = r.cards.slice().sort(byOvrDesc);
    const [best, ...rest] = sorted;
    const numeric = r.cards.filter((c) => c.grade != null);
    const avg = numeric.length ? numeric.reduce((s, c) => s + (c.grade ?? 0), 0) / numeric.length : null;
    const value = r.cards.reduce((s, c) => s + c.ovr, 0);
    const tierCounts = TIER_ORDER.map((t) => [t, r.cards.filter((c) => c.tier === t).length]).filter(([, n]) => n);

    const board = document.createElement("div");
    board.className = "board";
    board.innerHTML = `
      <header class="board-head">
        <h2>Packoverzicht</h2>
        <div class="board-chips">
          <span class="board-chip">Packwaarde <strong>${value}</strong></span>
          ${avg != null ? `<span class="board-chip">Gemiddelde <strong>${formatGrade(avg)}</strong></span>` : ""}
          <span class="board-chip"><strong>${r.newKeys.size}</strong> nieuw</span>
          ${tierCounts.map(([t, n]) => `<span class="board-chip"><span class="chip-dot" style="--dot:${TIERS[t].color}"></span> ${escapeHtml(TIERS[t].label)} <strong>${n}</strong></span>`).join("")}
        </div>
      </header>
      <div class="board-best"><span class="board-best-label">Beste trekking</span></div>
      <div class="board-grid"></div>
      <div class="board-actions">
        <button type="button" class="primary" data-action="again">Nog een openen</button>
        <button type="button" data-action="store">Naar winkel</button>
        <button type="button" data-action="club">Mijn club</button>
      </div>`;

    /** @param {GradeCard} card @param {"lg" | "md"} size */
    const tile = (card, size) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "card-btn";
      btn.dataset.card = card.key;
      btn.setAttribute("aria-label", `${card.subject} ${card.display}, ${TIERS[card.tier].label}`);
      btn.appendChild(cardEl(card, { size, faceDown: true, isNew: r.newKeys.has(card.key) }));
      return btn;
    };
    const bestBtn = tile(best, "lg");
    /** @type {HTMLElement} */ (board.querySelector(".board-best")).appendChild(bestBtn);
    const grid = /** @type {HTMLElement} */ (board.querySelector(".board-grid"));
    const restBtns = rest.map((c) => tile(c, "md"));
    grid.append(...restBtns);
    if (!rest.length) grid.remove();

    const again = /** @type {HTMLButtonElement} */ (board.querySelector('[data-action="again"]'));
    if (packCards(r.pack).length === 0) {
      again.disabled = true;
      again.textContent = r.pack.id === "nieuw" ? "Geen nieuwe cijfers meer" : "Nog een openen";
    }

    els.stageContent.replaceChildren(board);
    els.stageContent.scrollTop = 0;
    announce(`Packoverzicht: ${r.cards.length} kaarten, beste ${best.subject} ${best.display}`);

    const order = [bestBtn, ...restBtns];
    for (const btn of order) /** @type {HTMLElement} */ (btn.firstElementChild).style.opacity = "0";

    try {
      const flips = [];
      for (let i = 0; i < order.length; i += 1) {
        const cardNode = /** @type {HTMLElement} */ (order[i].firstElementChild);
        const inner = /** @type {HTMLElement} */ (cardNode.querySelector(".fc-inner"));
        const card = sorted[i];
        const flip = (async () => {
          await p.animate(cardNode, [{ opacity: 0, transform: "translateY(26px) scale(0.92)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });
          await p.animate(inner, [{ transform: "rotateY(180deg)" }, { transform: "rotateY(360deg)" }], { duration: 420, easing: "cubic-bezier(.3,.7,.2,1)" });
          if (p.fast) return;
          audio.deal();
          if (hypeOf(card) >= 3) {
            const b = cardNode.getBoundingClientRect();
            fx.burst({ x: b.left + b.width / 2, y: b.top + b.height / 2, count: 18 + hypeOf(card) * 6, colors: TIERS[card.tier].particles, speed: 5, gravity: 0.08, life: 700, size: 2 });
          }
        })();
        quiet(flip);
        flips.push(flip);
        await p.wait(i === 0 ? 380 : 90);
      }
      await Promise.all(flips);
    } catch (err) {
      if (!isAbort(err)) console.error(err);
    }
    if (run !== r || p.dead) return;
    for (const btn of order) {
      const cardNode = /** @type {HTMLElement} */ (btn.firstElementChild);
      cardNode.classList.remove("is-down");
      cardNode.style.opacity = "";
    }
    again.focus({ preventScroll: true });
  }

  /* —— Detail —— */

  /** @param {GradeCard} card */
  function openDetail(card) {
    const rows = [
      ["Vak", card.subject],
      ["Cijfer", card.display],
      ["Omschrijving", card.description || "—"],
      ["Soort", card.kind],
      ["Weging", card.weight != null ? `×${card.weight}` : "—"],
      ["Periode", card.period != null ? String(card.period) : "—"],
      ["Datum", formatDate(card.date, true)],
      ["Poging", card.attempt === 2 ? `Herkansing${card.firstAttempt ? ` (eerst ${card.firstAttempt})` : ""}` : "Eerste poging"],
      ["Dossier", card.exam ? "Examendossier" : "Voortgangsdossier"],
    ];
    if (card.niveau) rows.push(["Niveau", card.niveau]);
    els.detailTitle.textContent = `${card.subject} · ${card.display}`;
    els.detailTier.textContent = `${TIERS[card.tier].label}${card.comeback ? " · Comeback" : ""}`;
    els.detailList.innerHTML = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("");
    els.detailCard.replaceChildren(cardEl(card, { size: "lg" }));
    els.detail.hidden = false;
    els.detailClose.focus({ preventScroll: true });
  }

  /** @type {Element | null} */
  let detailOpener = null;

  function closeDetail() {
    if (els.detail.hidden) return;
    els.detail.hidden = true;
    els.detailCard.replaceChildren();
    if (detailOpener instanceof HTMLElement && detailOpener.isConnected) detailOpener.focus({ preventScroll: true });
    detailOpener = null;
  }

  function cardByKey(key) {
    return state.cards.find((c) => c.key === key) ?? run?.cards.find((c) => c.key === key) ?? null;
  }

  /* —— Events —— */

  els.store.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    const btn = target.closest("[data-open]");
    if (btn instanceof HTMLButtonElement && !btn.disabled) startOpen(btn.dataset.open);
  });

  els.store.addEventListener("change", (event) => {
    const target = /** @type {HTMLElement} */ (event.target);
    if (target instanceof HTMLSelectElement && target.dataset.vakSelect) {
      state.vakChoice = target.value;
      renderStore();
      /** @type {HTMLElement | null} */ (els.store.querySelector("[data-vak-select]"))?.focus();
    }
  });

  els.tabStore.addEventListener("click", () => setView("store"));
  els.tabClub.addEventListener("click", () => setView("club"));
  els.refresh.addEventListener("click", () => {
    if (!run) void load();
  });

  els.studentPick.addEventListener("change", () => {
    if (run) return;
    state.studentId = Number(els.studentPick.value);
    state.plaatsingKey = null;
    state.plaatsingen = [];
    void load();
  });

  els.yearPick.addEventListener("change", () => {
    if (run || state.loading) return;
    const next = els.yearPick.value || null;
    if (!next || next === state.plaatsingKey) return;
    state.plaatsingKey = next;
    void load();
  });

  function toggleSound() {
    state.sound = !state.sound;
    if (!state.sound) audio.stopAll();
    else {
      audio.ensure();
      audio.ui();
    }
    renderSound();
    cyfers.storage.set("sound", state.sound ? "on" : "off").catch(() => {});
  }
  els.soundToggle.addEventListener("click", toggleSound);
  els.stageSound.addEventListener("click", toggleSound);

  els.clubFilters.addEventListener("click", (event) => {
    const btn = /** @type {HTMLElement} */ (event.target).closest("[data-filter]");
    if (!(btn instanceof HTMLElement)) return;
    state.clubFilter = /** @type {any} */ (btn.dataset.filter);
    renderClub();
  });
  els.clubSort.addEventListener("change", renderClub);
  els.clubShowMissing.addEventListener("change", renderClub);

  els.clubReset.addEventListener("click", () => {
    const now = Date.now();
    if (now > state.resetArmedUntil) {
      state.resetArmedUntil = now + 4000;
      els.clubReset.textContent = "Zeker weten? Klik nogmaals";
      window.setTimeout(() => {
        if (Date.now() >= state.resetArmedUntil) els.clubReset.textContent = "Verzameling wissen";
      }, 4100);
      return;
    }
    state.resetArmedUntil = 0;
    els.clubReset.textContent = "Verzameling wissen";
    state.seen = new Set();
    state.stats = { packs: 0, walkouts: 0, best: null };
    persist();
    renderAll();
  });

  function onCardClick(event) {
    const btn = /** @type {HTMLElement} */ (event.target).closest("[data-card]");
    if (!(btn instanceof HTMLElement)) return false;
    if (btn.querySelector(".fut-card.is-down")) return false;
    const card = cardByKey(btn.dataset.card);
    if (!card) return false;
    detailOpener = btn;
    openDetail(card);
    return true;
  }

  els.clubGrid.addEventListener("click", onCardClick);

  els.stage.addEventListener("click", (event) => {
    if (!run) return;
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest(".stage-hud")) return;
    if (run.step === "board") {
      const action = target.closest("[data-action]");
      if (action instanceof HTMLButtonElement) {
        handleBoardAction(action.dataset.action);
        return;
      }
      if (onCardClick(event)) return;
      run.phase.rush();
      return;
    }
    if (!run.phase.advance()) run.phase.hurry();
  });

  function handleBoardAction(action) {
    const r = run;
    if (!r) return;
    if (action === "again") {
      const packId = r.pack.id;
      const choice = r.choice;
      closeStage();
      state.vakChoice = choice;
      startOpen(packId);
    } else if (action === "store") {
      closeStage();
      setView("store");
    } else if (action === "club") {
      closeStage();
      setView("club");
      els.tabClub.focus({ preventScroll: true });
    }
  }

  els.skipBtn.addEventListener("click", skip);
  els.closeBtn.addEventListener("click", closeStage);

  els.detailClose.addEventListener("click", closeDetail);
  els.detailBackdrop.addEventListener("click", closeDetail);

  document.addEventListener("keydown", (event) => {
    if (!els.detail.hidden) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDetail();
      }
      return;
    }
    if (!run) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (run.step === "board") closeStage();
      else skip();
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      const target = /** @type {HTMLElement} */ (event.target);
      if (target instanceof HTMLButtonElement || target instanceof HTMLSelectElement) return;
      event.preventDefault();
      if (event.repeat) return;
      if (run.step === "board") run.phase.rush();
      else if (!run.phase.advance()) run.phase.hurry();
    }
  });

  window.addEventListener("resize", () => {
    if (run) fx.resize();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) audio.suspend();
    else audio.resume();
  });

  window.addEventListener("pagehide", () => {
    if (run) {
      run.phase.abort("close");
      run = null;
    }
    stopCountdownTick();
    fx.clear();
    audio.close();
  });

  /* —— Boot —— */

  async function init() {
    renderSound();
    renderAll();
    const sound = await cyfers.storage.get("sound").catch(() => null);
    state.sound = sound !== "off";
    renderSound();
    await load();
  }

  void init();
})();
