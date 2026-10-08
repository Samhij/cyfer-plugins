/**
 * Berichten — inbox, verzonden, concepten, nieuw bericht en reactie.
 *
 * API flow from NONtoday/leerling-source + project research note
 * (somtoday-message-teacher.md). Local drafts use cyfers.storage only.
 */

/** @typedef {'inbox' | 'sent' | 'drafts'} TabId */

/**
 * @typedef {{
 *   id: string,
 *   kind: 'new' | 'reply',
 *   onderwerp: string,
 *   inhoud: string,
 *   ontvangerIds: number[],
 *   ontvangerLabels: string[],
 *   reactieOpId: number | null,
 *   conversatieKey: string | null,
 *   updatedAt: string,
 * }} Draft
 */

/**
 * @typedef {{
 *   id: number,
 *   onderwerp: string,
 *   inhoud: string,
 *   verzendDatum: string | null,
 *   verzondenDoorGebruiker: boolean,
 *   notificatieType: string | null,
 *   automatischeSomtodayBoodschap: boolean,
 *   verzenderNaam: string,
 *   ontvangerNamen: string[],
 * }} Boodschap
 */

/**
 * @typedef {{
 *   key: string,
 *   onderwerp: string,
 *   unread: boolean,
 *   markeerId: number | null,
 *   boodschappen: Boodschap[],
 *   preview: string,
 *   when: string | null,
 *   counterpart: string,
 *   hasReceived: boolean,
 *   hasSent: boolean,
 * }} Conversatie
 */

/**
 * @typedef {{
 *   id: number,
 *   label: string,
 *   search: string,
 *   vakken: string,
 * }} Ontvanger
 */

const DRAFTS_KEY = "drafts";

const CONVERSATIE_ADDITIONAL = [
  "verzondenDoorGebruiker",
  "verzenderCorrespondent",
  "ontvangerCorrespondenten",
  "aantalExtraOntvangers",
  "actiefVoorGebruiker",
].map((k) => `additional=${encodeURIComponent(k)}`).join("&");

const subtitleEl = document.getElementById("subtitle");
const statusEl = document.getElementById("status");
const permissionEl = document.getElementById("permission");
const appEl = document.getElementById("app");
const listEl = document.getElementById("list");
const detailEl = document.getElementById("detail");
const composeEl = document.getElementById("compose");
const composeForm = /** @type {HTMLFormElement} */ (document.getElementById("composeForm"));
const composeTitle = document.getElementById("composeTitle");
const composeError = document.getElementById("composeError");
const listSearch = /** @type {HTMLInputElement | null} */ (document.getElementById("listSearch"));
const recipientSearch = /** @type {HTMLInputElement} */ (document.getElementById("recipientSearch"));
const recipientChips = document.getElementById("recipientChips");
const recipientResults = document.getElementById("recipientResults");
const composeSubject = /** @type {HTMLInputElement} */ (document.getElementById("composeSubject"));
const composeBody = /** @type {HTMLTextAreaElement} */ (document.getElementById("composeBody"));
const composeBtn = /** @type {HTMLButtonElement} */ (document.getElementById("composeBtn"));
const refreshBtn = /** @type {HTMLButtonElement} */ (document.getElementById("refreshBtn"));
const saveDraftBtn = /** @type {HTMLButtonElement} */ (document.getElementById("saveDraftBtn"));
const sendBtn = /** @type {HTMLButtonElement} */ (document.getElementById("sendBtn"));
const composeClose = /** @type {HTMLButtonElement} */ (document.getElementById("composeClose"));

/** @type {TabId} */
let activeTab = "inbox";
/** @type {Conversatie[]} */
let conversaties = [];
/** @type {Draft[]} */
let drafts = [];
/** @type {Ontvanger[]} */
let ontvangers = [];
/** @type {string | null} */
let selectedKey = null;
/** @type {Draft | null} */
let editingDraft = null;
/** @type {Map<number, Ontvanger>} */
let selectedRecipients = new Map();
/** Client-side list filter (no Somtoday search endpoint in leerling-source). */
let listQuery = "";
let canView = false;
let canSend = false;
let loadSeq = 0;
let sendBusy = false;
let ontvangersLoaded = false;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * @param {unknown} links
 * @returns {number | null}
 */
function selfLinkId(links) {
  if (!Array.isArray(links) || links.length === 0) return null;
  const self = links.find((l) => l && typeof l === "object" && /** @type {{rel?: string}} */ (l).rel === "self") || links[0];
  if (!self || typeof self !== "object") return null;
  const id = /** @type {{id?: number|string}} */ (self).id;
  if (id == null || id === "") return null;
  const n = Number(id);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string | null | undefined} raw
 */
function formatDateTime(raw) {
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return String(raw);
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

/**
 * @param {string} text
 * @param {number} max
 */
function truncate(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

/**
 * Strip script/style and event handlers — same approach as huiswerk `sanitizeDescription`.
 * Somtoday message `inhoud` is HTML (div/br/p/…); never inject raw API HTML.
 * @param {string} html
 */
function sanitizeMessageHtml(html) {
  const raw = String(html || "").trim();
  if (!raw) return "";
  const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html");
  const root = doc.body.firstElementChild;
  if (!root) return escapeHtml(raw);

  root.querySelectorAll("script, style, iframe, object, embed, link, meta").forEach((el) => el.remove());
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
 * Plain text for list previews (strip tags from Somtoday HTML inhoud).
 * @param {string} value
 */
function toPlainPreview(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (!/<[a-z][\s\S]*>/i.test(raw)) {
    return raw.replace(/\s+/g, " ").trim();
  }
  const doc = new DOMParser().parseFromString(`<div>${raw}</div>`, "text/html");
  const text = doc.body.textContent || "";
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Render message body: sanitize HTML from Somtoday, or escape plain-text compose bodies.
 * @param {string} inhoud
 */
function formatMessageBodyHtml(inhoud) {
  const raw = String(inhoud || "");
  if (!raw.trim()) return "";
  if (/<[a-z][\s\S]*>/i.test(raw)) {
    return sanitizeMessageHtml(raw);
  }
  // Plain text (our compose/reply path) — keep newlines readable.
  return escapeHtml(raw).replaceAll("\n", "<br>");
}

/**
 * @param {string} value
 */
function foldSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * @param {unknown} person
 */
function personLabel(person) {
  if (!person || typeof person !== "object") return "";
  const p = /** @type {Record<string, unknown>} */ (person);
  const parts = [p.roepnaam, p.voorletters, p.voorvoegsel, p.achternaam]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
  let label = parts.join(" ");
  const afkorting = typeof p.afkorting === "string" ? p.afkorting.trim() : "";
  if (!label && afkorting) label = afkorting;
  if (!label && typeof p.naam === "string" && p.naam.trim()) label = p.naam.trim();
  if (label && afkorting && !label.toLowerCase().includes(afkorting.toLowerCase())) {
    label = `${label} (${afkorting})`;
  }
  return label;
}

/**
 * Search haystack matching leerling-source `zoekNaam` (naam + afkorting, accent-fold).
 * @param {unknown} person
 * @param {string} label
 */
function personSearchText(person, label) {
  if (!person || typeof person !== "object") return foldSearch(label);
  const p = /** @type {Record<string, unknown>} */ (person);
  const bits = [
    label,
    p.roepnaam,
    p.voorletters,
    typeof p.voorletters === "string" ? p.voorletters.replaceAll(".", "") : "",
    p.voorvoegsel,
    p.achternaam,
    p.afkorting,
    p.naam,
  ]
    .map((x) => (typeof x === "string" ? x : ""))
    .filter(Boolean);
  return foldSearch(bits.join(" "));
}

/**
 * @param {unknown} additional
 * @param {string} key
 */
function additionalValue(additional, key) {
  if (!additional || typeof additional !== "object") return undefined;
  return /** @type {Record<string, unknown>} */ (additional)[key];
}

/**
 * @param {unknown} raw
 * @returns {Boodschap | null}
 */
function mapBoodschap(raw) {
  if (!raw || typeof raw !== "object") return null;
  const b = /** @type {Record<string, unknown>} */ (raw);
  const id = selfLinkId(b.links);
  if (id == null) return null;

  const additional = b.additionalObjects;
  const verzondenDoorGebruiker = Boolean(additionalValue(additional, "verzondenDoorGebruiker"));
  const verzender = additionalValue(additional, "verzenderCorrespondent");
  const ontvangersRaw = additionalValue(additional, "ontvangerCorrespondenten");
  /** @type {string[]} */
  let ontvangerNamen = [];
  if (Array.isArray(ontvangersRaw)) {
    ontvangerNamen = ontvangersRaw.map(personLabel).filter(Boolean);
  } else if (ontvangersRaw && typeof ontvangersRaw === "object") {
    const items = /** @type {{items?: unknown[]}} */ (ontvangersRaw).items;
    if (Array.isArray(items)) ontvangerNamen = items.map(personLabel).filter(Boolean);
  }

  const actief = additionalValue(additional, "actiefVoorGebruiker");
  if (actief === false) return null;

  return {
    id,
    onderwerp: typeof b.onderwerp === "string" ? b.onderwerp : "(geen onderwerp)",
    inhoud: typeof b.inhoud === "string" ? b.inhoud : "",
    verzendDatum: typeof b.verzendDatum === "string" ? b.verzendDatum : null,
    verzondenDoorGebruiker,
    notificatieType: typeof b.notificatieType === "string" ? b.notificatieType : null,
    automatischeSomtodayBoodschap: Boolean(b.automatischeSomtodayBoodschap),
    verzenderNaam: personLabel(verzender) || (verzondenDoorGebruiker ? "Jij" : "Onbekend"),
    ontvangerNamen,
  };
}

/**
 * @param {unknown} raw
 * @returns {Conversatie | null}
 */
function mapConversatie(raw) {
  if (!raw || typeof raw !== "object") return null;
  const c = /** @type {Record<string, unknown>} */ (raw);
  const rawMsgs = Array.isArray(c.boodschappen) ? c.boodschappen : [];
  /** @type {Boodschap[]} */
  const boodschappen = [];
  for (const item of rawMsgs) {
    const mapped = mapBoodschap(item);
    if (mapped) boodschappen.push(mapped);
  }
  if (boodschappen.length === 0) return null;

  // Newest first from API; keep chronological for display.
  const byDate = [...boodschappen].sort((a, b) => {
    const ta = a.verzendDatum ? Date.parse(a.verzendDatum) : 0;
    const tb = b.verzendDatum ? Date.parse(b.verzendDatum) : 0;
    return ta - tb;
  });
  const newest = byDate[byDate.length - 1];
  const first = byDate[0];
  const key = String(newest.id);
  const hasReceived = byDate.some((m) => !m.verzondenDoorGebruiker);
  const hasSent = byDate.some((m) => m.verzondenDoorGebruiker);
  const counterpart = hasReceived
    ? byDate.filter((m) => !m.verzondenDoorGebruiker).map((m) => m.verzenderNaam).find(Boolean)
      || newest.verzenderNaam
    : newest.ontvangerNamen[0] || "Docent";

  return {
    key,
    onderwerp: first.onderwerp || newest.onderwerp,
    unread: typeof c.datumOudsteOngelezenBoodschap === "string" && Boolean(c.datumOudsteOngelezenBoodschap),
    markeerId: newest.id,
    boodschappen: byDate,
    preview: truncate(toPlainPreview(newest.inhoud), 120),
    when: newest.verzendDatum,
    counterpart: counterpart || "—",
    hasReceived,
    hasSent,
  };
}

/**
 * Reply rules from leerling-source `kanReagerenOpBoodschap`.
 * @param {Boodschap} msg
 */
function canReplyTo(msg) {
  if (!canSend) return false;
  if (msg.verzondenDoorGebruiker) return false;
  if (msg.automatischeSomtodayBoodschap) return false;
  if (msg.notificatieType === "Mededeling") return false;
  return true;
}

/**
 * @param {string | null} text
 * @param {"muted"|"error"|null} [kind]
 */
function setStatus(text, kind = "muted") {
  if (!statusEl) return;
  if (!text) {
    statusEl.hidden = true;
    statusEl.textContent = "";
    statusEl.className = "muted";
    return;
  }
  statusEl.hidden = false;
  statusEl.textContent = text;
  statusEl.className = kind === "error" ? "error" : "muted";
}

/**
 * @param {TabId} tab
 */
function setTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab").forEach((btn) => {
    const isActive = btn.getAttribute("data-tab") === tab;
    btn.classList.toggle("is-active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  selectedKey = null;
  renderList();
  renderDetail();
}

/**
 * @returns {string}
 */
function currentListQuery() {
  return foldSearch(listQuery);
}

/**
 * Match against onderwerp, plain inhoud, and sender / counterpart names.
 * @param {Conversatie} conv
 * @param {string} q
 */
function conversatieMatchesQuery(conv, q) {
  if (!q) return true;
  const parts = [
    conv.onderwerp,
    conv.counterpart,
    conv.preview,
    ...conv.boodschappen.flatMap((m) => [
      m.onderwerp,
      toPlainPreview(m.inhoud),
      m.verzenderNaam,
      ...m.ontvangerNamen,
    ]),
  ];
  return foldSearch(parts.join(" ")).includes(q);
}

/**
 * @param {Draft} draft
 * @param {string} q
 */
function draftMatchesQuery(draft, q) {
  if (!q) return true;
  const parts = [
    draft.onderwerp,
    toPlainPreview(draft.inhoud),
    ...draft.ontvangerLabels,
  ];
  return foldSearch(parts.join(" ")).includes(q);
}

/**
 * @returns {Conversatie[]}
 */
function filteredConversaties() {
  const q = currentListQuery();
  /** @type {Conversatie[]} */
  let items = [];
  if (activeTab === "inbox") items = conversaties.filter((c) => c.hasReceived);
  else if (activeTab === "sent") items = conversaties.filter((c) => c.hasSent);
  else return [];
  return q ? items.filter((c) => conversatieMatchesQuery(c, q)) : items;
}

/**
 * @returns {Draft[]}
 */
function filteredDrafts() {
  const sorted = drafts
    .slice()
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const q = currentListQuery();
  return q ? sorted.filter((d) => draftMatchesQuery(d, q)) : sorted;
}

function renderList() {
  if (!listEl) return;

  if (activeTab === "drafts") {
    if (drafts.length === 0) {
      listEl.innerHTML = `<p class="empty">Nog geen concepten. Sla een concept op vanuit Nieuw bericht.</p>`;
      return;
    }
    const visible = filteredDrafts();
    if (visible.length === 0) {
      listEl.innerHTML = `<p class="empty">Geen concepten die overeenkomen met je zoekopdracht.</p>`;
      return;
    }
    listEl.innerHTML = visible
      .map((d) => {
        const active = selectedKey === `draft:${d.id}` ? " is-active" : "";
        const meta = d.kind === "reply"
          ? "Reactie · concept"
          : `${d.ontvangerLabels.join(", ") || "Geen ontvanger"} · concept`;
        return `<button type="button" class="thread-btn${active}" data-draft-id="${escapeHtml(d.id)}">
            <span class="thread-subject">${escapeHtml(d.onderwerp || "(geen onderwerp)")}</span>
            <span class="thread-meta">${escapeHtml(meta)}</span>
            <span class="thread-preview">${escapeHtml(truncate(toPlainPreview(d.inhoud), 100) || "Leeg concept")}</span>
          </button>`;
      })
      .join("");
    listEl.querySelectorAll("[data-draft-id]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedKey = `draft:${btn.getAttribute("data-draft-id")}`;
        renderList();
        renderDetail();
      });
    });
    return;
  }

  const tabEmpty =
    activeTab === "inbox"
      ? conversaties.every((c) => !c.hasReceived)
      : conversaties.every((c) => !c.hasSent);
  if (tabEmpty) {
    listEl.innerHTML = `<p class="empty">${
      activeTab === "inbox" ? "Geen ontvangen berichten." : "Nog geen verzonden berichten."
    }</p>`;
    return;
  }

  const items = filteredConversaties();
  if (items.length === 0) {
    listEl.innerHTML = `<p class="empty">Geen berichten die overeenkomen met je zoekopdracht.</p>`;
    return;
  }

  listEl.innerHTML = items
    .map((c) => {
      const active = selectedKey === c.key ? " is-active" : "";
      const unread = c.unread ? " is-unread" : "";
      const dot = c.unread ? `<span class="unread-dot" aria-hidden="true"></span>` : "";
      return `<button type="button" class="thread-btn${active}${unread}" data-conv-key="${escapeHtml(c.key)}">
          <span class="thread-subject">${dot}${escapeHtml(c.onderwerp)}</span>
          <span class="thread-meta">${escapeHtml(c.counterpart)} · ${escapeHtml(formatDateTime(c.when))}</span>
          <span class="thread-preview">${escapeHtml(c.preview || "")}</span>
        </button>`;
    })
    .join("");

  listEl.querySelectorAll("[data-conv-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.getAttribute("data-conv-key");
      selectedKey = key;
      renderList();
      renderDetail();
      const conv = conversaties.find((c) => c.key === key);
      if (conv?.unread && conv.markeerId != null) {
        markGelezen(conv.markeerId).catch(() => {});
      }
    });
  });
}

function renderDetail() {
  if (!detailEl) return;

  if (activeTab === "drafts") {
    const draftId = selectedKey?.startsWith("draft:") ? selectedKey.slice(6) : null;
    const draft = draftId ? drafts.find((d) => d.id === draftId) : null;
    if (!draft) {
      detailEl.className = "detail empty";
      detailEl.innerHTML = `<p class="muted">Selecteer een concept om te bewerken of te versturen.</p>`;
      return;
    }
    detailEl.className = "detail";
    const aan = draft.kind === "reply"
      ? "Reactie op bestaand gesprek"
      : escapeHtml(draft.ontvangerLabels.join(", ") || "Geen ontvanger");
    detailEl.innerHTML = `
      <div class="detail-head">
        <h2>${escapeHtml(draft.onderwerp || "(geen onderwerp)")}</h2>
        <p class="meta">${aan} · bijgewerkt ${escapeHtml(formatDateTime(draft.updatedAt))}</p>
      </div>
      <div class="message">
        <div class="message-body">${formatMessageBodyHtml(draft.inhoud || "")}</div>
      </div>
      <div class="draft-actions">
        <div class="draft-actions-row">
          <button type="button" id="draftDelete">Verwijderen</button>
          <button type="button" id="draftEdit">Bewerken</button>
          <button type="button" class="primary" id="draftSend" ${canSend ? "" : "disabled"}>Versturen</button>
        </div>
      </div>`;
    document.getElementById("draftDelete")?.addEventListener("click", () => {
      void removeDraft(draft.id);
    });
    document.getElementById("draftEdit")?.addEventListener("click", () => {
      openComposeFromDraft(draft);
    });
    document.getElementById("draftSend")?.addEventListener("click", () => {
      void sendDraft(draft);
    });
    return;
  }

  const conv = conversaties.find((c) => c.key === selectedKey);
  if (!conv) {
    detailEl.className = "detail empty";
    detailEl.innerHTML = `<p class="muted">Selecteer een gesprek om te lezen${canSend ? " of te beantwoorden" : ""}.</p>`;
    return;
  }

  const replyTarget = [...conv.boodschappen].reverse().find((m) => canReplyTo(m)) || null;
  const messagesHtml = conv.boodschappen
    .map((m) => {
      const mine = m.verzondenDoorGebruiker ? " is-mine" : "";
      const from = m.verzondenDoorGebruiker ? "Jij" : m.verzenderNaam;
      return `<article class="message${mine}">
        <div class="message-top">
          <span class="message-from">${escapeHtml(from)}</span>
          <span class="message-date">${escapeHtml(formatDateTime(m.verzendDatum))}</span>
        </div>
        <div class="message-body">${formatMessageBodyHtml(m.inhoud)}</div>
      </article>`;
    })
    .join("");

  let replyHtml = "";
  if (!canSend) {
    replyHtml = `<p class="muted">Je mag geen berichten versturen vanaf dit account.</p>`;
  } else if (replyTarget) {
    replyHtml = `
      <form class="reply-box" id="replyForm">
        <label>
          <span>Antwoord</span>
          <textarea id="replyBody" rows="4" required placeholder="Schrijf je antwoord…"></textarea>
        </label>
        <p id="replyError" class="error" hidden></p>
        <div class="reply-actions">
          <button type="button" id="replyDraft">Concept opslaan</button>
          <button type="submit" class="primary">Versturen</button>
        </div>
      </form>`;
  } else {
    replyHtml = `<p class="muted">Op dit gesprek kun je niet reageren.</p>`;
  }

  detailEl.className = "detail";
  detailEl.innerHTML = `
    <div class="detail-head">
      <h2>${escapeHtml(conv.onderwerp)}</h2>
      <p class="meta">${escapeHtml(conv.counterpart)} · ${conv.boodschappen.length} bericht${conv.boodschappen.length === 1 ? "" : "en"}</p>
    </div>
    <div class="message-stack">${messagesHtml}</div>
    ${replyHtml}`;

  const replyForm = /** @type {HTMLFormElement | null} */ (document.getElementById("replyForm"));
  if (replyForm && replyTarget) {
    replyForm.addEventListener("submit", (event) => {
      event.preventDefault();
      void sendReply(replyTarget.id, /** @type {HTMLTextAreaElement} */ (document.getElementById("replyBody")).value);
    });
    document.getElementById("replyDraft")?.addEventListener("click", () => {
      const inhoud = /** @type {HTMLTextAreaElement} */ (document.getElementById("replyBody")).value.trim();
      void upsertDraft({
        id: `reply-${conv.key}`,
        kind: "reply",
        onderwerp: `Re: ${conv.onderwerp}`,
        inhoud,
        ontvangerIds: [],
        ontvangerLabels: [conv.counterpart],
        reactieOpId: replyTarget.id,
        conversatieKey: conv.key,
        updatedAt: new Date().toISOString(),
      }).then(() => {
        setStatus("Concept opgeslagen.");
        setTab("drafts");
        selectedKey = `draft:reply-${conv.key}`;
        renderList();
        renderDetail();
      });
    });
  }
}

/**
 * @param {number} boodschapId
 */
async function markGelezen(boodschapId) {
  await cyfers.fetch(`/rest/v1/boodschappen/conversatie/${boodschapId}/markeerGelezen`, {
    method: "POST",
    body: {},
  });
  const conv = conversaties.find((c) => c.markeerId === boodschapId || c.key === String(boodschapId));
  if (conv) conv.unread = false;
  renderList();
}

async function loadDrafts() {
  try {
    const raw = await cyfers.storage.get(DRAFTS_KEY);
    if (!raw) {
      drafts = [];
      return;
    }
    const parsed = JSON.parse(raw);
    drafts = Array.isArray(parsed) ? /** @type {Draft[]} */ (parsed) : [];
  } catch {
    drafts = [];
  }
}

async function persistDrafts() {
  await cyfers.storage.set(DRAFTS_KEY, JSON.stringify(drafts));
}

/**
 * @param {Draft} draft
 */
async function upsertDraft(draft) {
  const idx = drafts.findIndex((d) => d.id === draft.id);
  if (idx >= 0) drafts[idx] = draft;
  else drafts.push(draft);
  await persistDrafts();
}

/**
 * @param {string} id
 */
async function removeDraft(id) {
  drafts = drafts.filter((d) => d.id !== id);
  await persistDrafts();
  if (selectedKey === `draft:${id}`) selectedKey = null;
  renderList();
  renderDetail();
  setStatus("Concept verwijderd.");
}

function clearComposeError() {
  if (!composeError) return;
  composeError.hidden = true;
  composeError.textContent = "";
}

/**
 * @param {string} message
 */
function showComposeError(message) {
  if (!composeError) return;
  composeError.hidden = false;
  composeError.textContent = message;
}

function renderRecipientChips() {
  if (!recipientChips) return;
  if (selectedRecipients.size === 0) {
    recipientChips.innerHTML = "";
    return;
  }
  recipientChips.innerHTML = [...selectedRecipients.values()]
    .map(
      (o) => `<span class="chip">${escapeHtml(o.label)}
        <button type="button" data-remove-id="${o.id}" aria-label="Verwijder ${escapeHtml(o.label)}">×</button>
      </span>`,
    )
    .join("");
  recipientChips.querySelectorAll("[data-remove-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRecipients.delete(Number(btn.getAttribute("data-remove-id")));
      renderRecipientChips();
    });
  });
}

/**
 * @param {string} query
 * @param {{ allowEmpty?: boolean }} [opts]
 */
function renderRecipientResults(query, opts = {}) {
  if (!recipientResults) return;
  const q = foldSearch(query);
  if (!q && !opts.allowEmpty) {
    recipientResults.hidden = true;
    recipientResults.innerHTML = "";
    return;
  }
  if (!ontvangersLoaded) {
    recipientResults.hidden = false;
    recipientResults.innerHTML = `<p class="muted" style="margin:0.35rem">Docenten laden…</p>`;
    return;
  }
  const available = ontvangers.filter((o) => !selectedRecipients.has(o.id));
  const matches = (q ? available.filter((o) => o.search.includes(q)) : available).slice(0, 12);
  if (matches.length === 0) {
    recipientResults.hidden = false;
    recipientResults.innerHTML = `<p class="muted" style="margin:0.35rem">${
      ontvangers.length === 0 ? "Geen docenten beschikbaar." : "Geen docenten gevonden."
    }</p>`;
    return;
  }
  recipientResults.hidden = false;
  recipientResults.innerHTML = matches
    .map(
      (o) => `<button type="button" class="recipient-option" data-add-id="${o.id}">
        ${escapeHtml(o.label)}
        ${o.vakken ? `<span class="sub">${escapeHtml(o.vakken)}</span>` : ""}
      </button>`,
    )
    .join("");
  recipientResults.querySelectorAll("[data-add-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.getAttribute("data-add-id"));
      const found = ontvangers.find((o) => o.id === id);
      if (found) {
        selectedRecipients.set(id, found);
        renderRecipientChips();
        recipientSearch.value = "";
        recipientResults.hidden = true;
        recipientResults.innerHTML = "";
      }
    });
  });
}

async function ensureOntvangers() {
  if (ontvangersLoaded) return;
  const data = /** @type {any} */ (
    await cyfers.fetch("/rest/v1/medewerkers/ontvangers?additional=vakkenDocentVoorLeerling", {
      headers: { range: "items=0-499" },
    })
  );
  const items = Array.isArray(data?.items)
    ? data.items
    : Array.isArray(data?.content)
      ? data.content
      : Array.isArray(data)
        ? data
        : [];
  /** @type {Ontvanger[]} */
  const mapped = [];
  for (const item of items) {
    const id = selfLinkId(item?.links);
    if (id == null) continue;
    const label = personLabel(item) || `Docent ${id}`;
    const vakkenRaw = item?.additionalObjects?.vakkenDocentVoorLeerling;
    /** @type {string[]} */
    let vakNamen = [];
    if (Array.isArray(vakkenRaw?.items)) {
      vakNamen = vakkenRaw.items
        .map((/** @type {any} */ v) => (typeof v?.naam === "string" ? v.naam : typeof v?.afkorting === "string" ? v.afkorting : ""))
        .filter(Boolean);
    } else if (Array.isArray(vakkenRaw)) {
      vakNamen = vakkenRaw
        .map((/** @type {any} */ v) => (typeof v?.naam === "string" ? v.naam : typeof v?.afkorting === "string" ? v.afkorting : ""))
        .filter(Boolean);
    }
    mapped.push({
      id,
      label,
      search: foldSearch(`${personSearchText(item, label)} ${vakNamen.join(" ")}`),
      vakken: vakNamen.join(", "),
    });
  }
  ontvangers = mapped.sort((a, b) => a.label.localeCompare(b.label, "nl"));
  ontvangersLoaded = true;
}

function resetComposeForm() {
  editingDraft = null;
  selectedRecipients = new Map();
  composeSubject.value = "";
  composeBody.value = "";
  recipientSearch.value = "";
  if (recipientResults) {
    recipientResults.hidden = true;
    recipientResults.innerHTML = "";
  }
  renderRecipientChips();
  clearComposeError();
  if (composeTitle) composeTitle.textContent = "Nieuw bericht";
  composeSubject.disabled = false;
  recipientSearch.disabled = false;
}

/**
 * @param {Draft} draft
 */
async function openComposeFromDraft(draft) {
  if (!canSend && draft.kind === "new") {
    setStatus("Je mag geen berichten versturen.", "error");
    return;
  }
  editingDraft = draft;
  if (draft.kind === "reply") {
    // Reply drafts edit inline via concept tab send/edit → open as new-style only for new.
    // For reply drafts, put inhoud into a dedicated compose-like flow using the form
    // without recipients.
    await openComposeSheet({
      title: "Concept bewerken",
      subject: draft.onderwerp,
      body: draft.inhoud,
      subjectLocked: true,
      recipientsLocked: true,
      recipientIds: [],
      recipientLabels: draft.ontvangerLabels,
    });
    return;
  }
  await openComposeSheet({
    title: "Concept bewerken",
    subject: draft.onderwerp,
    body: draft.inhoud,
    subjectLocked: false,
    recipientsLocked: false,
    recipientIds: draft.ontvangerIds,
    recipientLabels: draft.ontvangerLabels,
  });
}

/**
 * @param {{
 *   title?: string,
 *   subject?: string,
 *   body?: string,
 *   subjectLocked?: boolean,
 *   recipientsLocked?: boolean,
 *   recipientIds?: number[],
 *   recipientLabels?: string[],
 * }} [opts]
 */
async function openComposeSheet(opts = {}) {
  if (!canSend) {
    setStatus("Je mag geen berichten versturen vanaf dit account.", "error");
    return;
  }
  clearComposeError();
  try {
    await ensureOntvangers();
  } catch (err) {
    showComposeError(err instanceof Error ? err.message : "Ontvangers laden mislukt.");
  }

  if (composeTitle) composeTitle.textContent = opts.title || "Nieuw bericht";
  composeSubject.value = opts.subject || "";
  composeBody.value = opts.body || "";
  composeSubject.disabled = Boolean(opts.subjectLocked);
  recipientSearch.disabled = Boolean(opts.recipientsLocked);

  selectedRecipients = new Map();
  const ids = opts.recipientIds || [];
  const labels = opts.recipientLabels || [];
  ids.forEach((id, i) => {
    const known = ontvangers.find((o) => o.id === id);
    selectedRecipients.set(id, known || {
      id,
      label: labels[i] || `Docent ${id}`,
      search: "",
      vakken: "",
    });
  });
  renderRecipientChips();
  if (composeEl) {
    composeEl.hidden = false;
    composeEl.removeAttribute("hidden");
  }
  composeBody.focus();
}

function closeCompose() {
  if (composeEl) {
    composeEl.hidden = true;
    composeEl.setAttribute("hidden", "");
  }
  resetComposeForm();
}

async function saveComposeAsDraft() {
  const onderwerp = composeSubject.value.trim();
  const inhoud = composeBody.value.trim();
  if (!onderwerp && !inhoud && selectedRecipients.size === 0) {
    showComposeError("Niets om op te slaan.");
    return;
  }
  const id = editingDraft?.id || `new-${Date.now()}`;
  /** @type {Draft} */
  const draft = {
    id,
    kind: editingDraft?.kind === "reply" ? "reply" : "new",
    onderwerp: onderwerp || "(geen onderwerp)",
    inhoud,
    ontvangerIds: [...selectedRecipients.keys()],
    ontvangerLabels: [...selectedRecipients.values()].map((o) => o.label),
    reactieOpId: editingDraft?.reactieOpId ?? null,
    conversatieKey: editingDraft?.conversatieKey ?? null,
    updatedAt: new Date().toISOString(),
  };
  await upsertDraft(draft);
  closeCompose();
  setStatus("Concept opgeslagen.");
  setTab("drafts");
  selectedKey = `draft:${id}`;
  renderList();
  renderDetail();
}

/**
 * @param {Draft} draft
 */
async function sendDraft(draft) {
  if (!canSend) {
    setStatus("Je mag geen berichten versturen.", "error");
    return;
  }
  if (draft.kind === "reply") {
    if (draft.reactieOpId == null) {
      setStatus("Dit concept mist een bericht om op te reageren.", "error");
      return;
    }
    if (!draft.inhoud.trim()) {
      setStatus("Schrijf eerst een antwoord.", "error");
      return;
    }
    await sendReply(draft.reactieOpId, draft.inhoud, draft.id);
    return;
  }
  editingDraft = draft;
  selectedRecipients = new Map();
  draft.ontvangerIds.forEach((id, i) => {
    selectedRecipients.set(id, {
      id,
      label: draft.ontvangerLabels[i] || `Docent ${id}`,
      search: "",
      vakken: "",
    });
  });
  composeSubject.value = draft.onderwerp === "(geen onderwerp)" ? "" : draft.onderwerp;
  composeBody.value = draft.inhoud;
  await submitNewMessage(draft.id);
}

/**
 * @param {string | null} [draftIdToClear]
 */
async function submitNewMessage(draftIdToClear = null) {
  if (sendBusy) return;
  clearComposeError();
  const onderwerp = composeSubject.value.trim();
  const inhoud = composeBody.value.trim();
  if (selectedRecipients.size === 0) {
    showComposeError("Kies minstens één docent.");
    return;
  }
  if (!onderwerp) {
    showComposeError("Onderwerp is verplicht.");
    return;
  }
  if (!inhoud) {
    showComposeError("Bericht is verplicht.");
    return;
  }
  if (onderwerp.length > 1024) {
    showComposeError("Onderwerp mag maximaal 1024 tekens zijn.");
    return;
  }

  sendBusy = true;
  if (sendBtn) sendBtn.disabled = true;
  try {
    await cyfers.fetch("/rest/v1/verstuurdbericht/nieuw?alsConversatieBoodschap=true", {
      method: "POST",
      body: {
        onderwerp,
        inhoud,
        ontvangers: [...selectedRecipients.keys()].map((id) => ({
          links: [{ id, rel: "self", type: "medewerker.RMedewerkerPrimer" }],
        })),
      },
    });
    const clearId = draftIdToClear || editingDraft?.id;
    if (clearId) {
      drafts = drafts.filter((d) => d.id !== clearId);
      await persistDrafts();
    }
    closeCompose();
    setStatus("Bericht verstuurd.");
    await refreshConversaties();
    setTab("sent");
  } catch (err) {
    showComposeError(err instanceof Error ? err.message : "Versturen mislukt.");
  } finally {
    sendBusy = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

/**
 * @param {number} reactieOpId
 * @param {string} inhoudRaw
 * @param {string | null} [draftIdToClear]
 */
async function sendReply(reactieOpId, inhoudRaw, draftIdToClear = null) {
  const inhoud = String(inhoudRaw || "").trim();
  const replyError = document.getElementById("replyError");
  if (!inhoud) {
    if (replyError) {
      replyError.hidden = false;
      replyError.textContent = "Schrijf eerst een antwoord.";
    } else {
      setStatus("Schrijf eerst een antwoord.", "error");
    }
    return;
  }
  try {
    await cyfers.fetch("/rest/v1/verstuurdbericht/reactie?alsConversatieBoodschap=true", {
      method: "POST",
      body: {
        inhoud,
        reactieOp: {
          links: [{ id: reactieOpId, rel: "self", type: "berichten.RBoodschap" }],
        },
      },
    });
    if (draftIdToClear) {
      drafts = drafts.filter((d) => d.id !== draftIdToClear);
      await persistDrafts();
    }
    setStatus("Antwoord verstuurd.");
    await refreshConversaties();
    // Keep selection if possible
    renderList();
    renderDetail();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Versturen mislukt.";
    if (replyError) {
      replyError.hidden = false;
      replyError.textContent = message;
    } else {
      setStatus(message, "error");
    }
  }
}

/**
 * @returns {Promise<{bekijken: boolean, verzenden: boolean}>}
 */
async function loadRestricties() {
  const data = /** @type {any} */ (
    await cyfers.fetch("/rest/v1/account/me?additional=restricties")
  );
  const items = data?.additionalObjects?.restricties?.items;
  if (!Array.isArray(items) || items.length === 0) {
    // If restricties missing, fail closed for view/send.
    return { bekijken: false, verzenden: false };
  }
  // Prefer matching current student when multiple; else first true-ish entry.
  const ctx = await cyfers.getContext();
  const studentId = ctx.students?.[0]?.id ?? null;
  let row = items[0];
  if (studentId != null) {
    const match = items.find((/** @type {any} */ r) => Number(r?.leerlingId) === Number(studentId));
    if (match) row = match;
  }
  return {
    bekijken: Boolean(row?.berichtenBekijkenAan),
    verzenden: Boolean(row?.berichtenVerzendenAan),
  };
}

async function refreshConversaties() {
  const data = /** @type {any} */ (
    await cyfers.fetch(`/rest/v1/boodschappen/conversaties?${CONVERSATIE_ADDITIONAL}`)
  );
  const items = Array.isArray(data?.items) ? data.items : [];
  /** @type {Conversatie[]} */
  const mapped = [];
  for (const item of items) {
    const conv = mapConversatie(item);
    if (conv) mapped.push(conv);
  }
  mapped.sort((a, b) => {
    const ta = a.when ? Date.parse(a.when) : 0;
    const tb = b.when ? Date.parse(b.when) : 0;
    return tb - ta;
  });
  conversaties = mapped;
}

function showPermissionState() {
  if (!permissionEl || !appEl) return;
  appEl.hidden = true;
  composeBtn.hidden = true;
  permissionEl.hidden = false;
  if (!canView && !canSend) {
    permissionEl.innerHTML = `
      <h2>Geen toegang tot berichten</h2>
      <p class="muted">Je schoolaccount mag berichten niet bekijken of versturen.
      Vraag je school als je denkt dat dit een fout is.</p>`;
    if (subtitleEl) subtitleEl.textContent = "Niet beschikbaar";
    return;
  }
  if (!canView) {
    if (canSend) {
      // Compose-only: inbox API blocked by school, but send may still work.
      appEl.hidden = false;
      permissionEl.hidden = true;
      composeBtn.hidden = false;
      if (subtitleEl) subtitleEl.textContent = "Alleen versturen";
      setTab("drafts");
      return;
    }
    permissionEl.innerHTML = `
      <h2>Berichten bekijken niet toegestaan</h2>
      <p class="muted">Je mag de inbox niet openen volgens de rechten van je schoolaccount.</p>`;
    if (subtitleEl) subtitleEl.textContent = "Niet beschikbaar";
    return;
  }
}

async function boot() {
  const seq = ++loadSeq;
  setStatus("Laden…");
  try {
    await loadDrafts();
    const rights = await loadRestricties();
    if (seq !== loadSeq) return;
    canView = rights.bekijken;
    canSend = rights.verzenden;

    if (!canView) {
      setStatus("");
      showPermissionState();
      return;
    }

    if (permissionEl) permissionEl.hidden = true;
    if (appEl) appEl.hidden = false;
    composeBtn.hidden = !canSend;
    if (subtitleEl) {
      subtitleEl.textContent = canSend
        ? "Inbox, verzonden en concepten"
        : "Alleen lezen — versturen staat uit";
    }

    await refreshConversaties();
    if (seq !== loadSeq) return;
    setStatus("");
    renderList();
    renderDetail();
  } catch (err) {
    if (seq !== loadSeq) return;
    setStatus(err instanceof Error ? err.message : "Laden mislukt.", "error");
    if (subtitleEl) subtitleEl.textContent = "Fout";
  }
}

// —— Events ——

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = /** @type {TabId} */ (btn.getAttribute("data-tab") || "inbox");
    setTab(tab);
  });
});

listSearch?.addEventListener("input", () => {
  listQuery = listSearch.value || "";
  renderList();
  // Clear detail if the selected item is no longer visible.
  if (activeTab === "drafts") {
    const draftId = selectedKey?.startsWith("draft:") ? selectedKey.slice(6) : null;
    if (draftId && !filteredDrafts().some((d) => d.id === draftId)) {
      selectedKey = null;
      renderDetail();
    }
  } else if (selectedKey && !filteredConversaties().some((c) => c.key === selectedKey)) {
    selectedKey = null;
    renderDetail();
  }
});

refreshBtn?.addEventListener("click", () => {
  void boot();
});

composeBtn?.addEventListener("click", () => {
  resetComposeForm();
  void openComposeSheet();
});

composeClose?.addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  closeCompose();
});

composeEl?.addEventListener("click", (event) => {
  if (event.target === composeEl) closeCompose();
});

saveDraftBtn?.addEventListener("click", () => {
  void saveComposeAsDraft();
});

composeForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  if (editingDraft?.kind === "reply" && editingDraft.reactieOpId != null) {
    void sendReply(editingDraft.reactieOpId, composeBody.value, editingDraft.id).then(() => {
      closeCompose();
      setTab("inbox");
    });
    return;
  }
  void submitNewMessage();
});

recipientSearch?.addEventListener("input", () => {
  renderRecipientResults(recipientSearch.value, { allowEmpty: false });
});

recipientSearch?.addEventListener("focus", () => {
  void (async () => {
    try {
      await ensureOntvangers();
    } catch (err) {
      showComposeError(err instanceof Error ? err.message : "Ontvangers laden mislukt.");
      return;
    }
    renderRecipientResults(recipientSearch.value, { allowEmpty: true });
  })();
});

recipientSearch?.addEventListener("keydown", (event) => {
  // Prevent Enter in the search field from submitting the compose form.
  if (event.key === "Enter") {
    event.preventDefault();
    const first = recipientResults?.querySelector("[data-add-id]");
    if (first instanceof HTMLElement) first.click();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && composeEl && !composeEl.hidden) {
    closeCompose();
  }
});

// Ensure compose starts closed even if CSS previously fought [hidden].
closeCompose();
void boot();
