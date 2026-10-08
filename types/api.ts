/**
 * Plugin-facing Cyfers / Somtoday types.
 *
 * Source of truth for plugin authors (this repo) and for the host app
 * (somtoday-login vendors a copy under vendor/cyfer-plugin-types/).
 */

export type CyfersStudent = {
  id: number;
  uuid: string | null;
  href: string | null;
  name: string;
  studentNumber: string | null;
  email: string | null;
};

export type CyfersContext = {
  schoolName: string;
  tenant: string | null;
  schoolYear: string | null;
  students: CyfersStudent[];
};

export type CyfersFetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
};

/**
 * Injected `window.cyfers` / global `cyfers` bridge.
 *
 * `storage` is a per-plugin string KV map persisted by the Cyfers host as a JSON
 * file under the app userData directory (`plugin-storage/<plugin-id>.json`).
 */
export type CyfersSdk = {
  getContext(): Promise<CyfersContext>;
  fetch(path: string, init?: CyfersFetchInit): Promise<unknown>;
  storage: {
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<unknown>;
    remove(key: string): Promise<unknown>;
  };
};

export type PluginKind = "page" | "widget";

export type PluginNav = {
  label: string;
  icon: string;
  /**
   * Deprecated / ignored for sidebar order. Cyfers lets the user set plugin
   * order in the host app; do not set this in new manifests.
   */
  order?: number;
};

/** Shape of `manifest.json` (validated by the Cyfers host on install). */
export type PluginManifest = {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  kind: PluginKind;
  entry: string;
  nav: PluginNav;
  permissions: {
    api: string[];
  };
};

/* —— Raw Somtoday REST shapes (live-checked) —— */

export type SomtodayLink = {
  id?: number | string;
  rel?: string;
  type?: string;
  href?: string;
};

export type SomtodayPermission = {
  full?: string;
  type?: string;
  operations?: string[];
  instances?: string[];
};

/** Common envelope on most Somtoday entities. */
export type SomtodayEntity = {
  $type?: string;
  links?: SomtodayLink[];
  permissions?: SomtodayPermission[];
  additionalObjects?: Record<string, unknown>;
};

/** `GET /rest/v1/leerlingen` / `GET /rest/v1/leerlingen/{id}` item. */
export type SomtodayStudent = SomtodayEntity & {
  UUID?: string;
  /** Rare; live responses use `UUID`. */
  uuid?: string;
  roepnaam?: string;
  tussenvoegsel?: string;
  achternaam?: string;
  leerlingnummer?: number | string;
  email?: string;
  geboortedatum?: string;
  geslacht?: string;
  mobielNummer?: string;
  pasfotoUrl?: string;
};

/** `GET /rest/v1/schooljaren/huidig` (single object, not wrapped in `items`). */
export type SomtodaySchooljaar = SomtodayEntity & {
  naam?: string;
  vanafDatum?: string;
  totDatum?: string;
  isHuidig?: boolean;
};

/**
 * Raw Somtoday geldend voortgangs-/examendossier resultaat.
 * Prefer label / formattedResultaat / cijfer for display — geldendResultaat is often absent.
 */
export type SomtodayGrade = SomtodayEntity & {
  type?: string;
  resultaat?: string;
  geldendResultaat?: string | number;
  geldendResultaatCijferInvoer?: string | number;
  cijfer?: number;
  cijferEerstePoging?: number;
  label?: string;
  labelAfkorting?: string;
  formattedResultaat?: string;
  formattedEerstePoging?: string;
  isLabel?: boolean;
  isCijfer?: boolean;
  isVoldoende?: boolean;
  isVoldoendeEerstePoging?: boolean;
  periode?: number;
  volgnummer?: number;
  toetscode?: string;
  toetssoort?: string;
  weging?: number;
  herkansing?: string;
  omschrijving?: string;
  datumInvoer?: string;
  datumInvoerEerstePoging?: string;
  datumInvoerTweedePoging?: string;
  vak?: { naam?: string; afkorting?: string };
  additionalObjects?: {
    vaknaam?: string | { naam?: string; afkorting?: string };
    resultaatkolom?: string | { naam?: string; omschrijving?: string };
    naamalternatiefniveau?: string;
    vakuuid?: string;
    lichtinguuid?: string;
    [key: string]: unknown;
  };
};

/** `GET /rest/v1/vakken` item. */
export type SomtodayVak = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  afkorting?: string;
};

/** Nested afspraak type on roosters. */
export type SomtodayAfspraakType = SomtodayEntity & {
  naam?: string;
  omschrijving?: string;
  standaardKleur?: number;
  categorie?: string;
  activiteit?: string;
  presentieRegistratieDefault?: boolean;
  actief?: boolean;
};

/** `GET /rest/v1/afspraken` item. */
export type SomtodayAfspraak = SomtodayEntity & {
  beginDatumTijd?: string;
  eindDatumTijd?: string;
  beginLesuur?: number;
  eindLesuur?: number;
  titel?: string;
  omschrijving?: string;
  locatie?: string;
  afspraakStatus?: string;
  presentieRegistratieVerplicht?: boolean;
  presentieRegistratieVerwerkt?: boolean;
  bijlagen?: unknown[];
  afspraakType?: SomtodayAfspraakType;
  vestiging?: SomtodayEntity & { naam?: string; afkorting?: string; UUID?: string };
  additionalObjects?: {
    vak?: SomtodayVak;
    docentAfkortingen?: string;
    [key: string]: unknown;
  };
};

/**
 * Afspraak item type from the student schedule endpoint.
 * Observed in NONtoday/leerling-source (`RAfspraakItem`).
 */
export type SomtodayAfspraakItemType =
  | "INDIVIDUEEL"
  | "ROOSTER"
  | "PRIVE"
  | "BESCHERMD"
  | "EXTERN"
  | "OUDERAVOND"
  | "EXAMEN"
  | "ROOSTERTOETS"
  | "ONBEKEND"
  | string;

/** Per-item or envelope status tip from Somtoday (e.g. cancelled lesson). */
export type SomtodayStatusNotification = {
  status?: string;
  message?: string;
};

/**
 * `GET /rest/v1/afspraakitems/{studentId}/jaar/{isoYear}/week/{isoWeek}` item.
 *
 * Assumptions (inferred from NONtoday leerling app + community clients; not a
 * live-checked Cyfers session):
 * - Response envelope is `{ items?: SomtodayAfspraakItem[], statusNotifications?: … }`.
 * - Cancelled lessons stay in `items` with normal times; look for
 *   `statusNotifications` status `"4007"`, and/or `wijzigingOmschrijving`
 *   like `"Les vervalt"` (normal lessons often use status `"2002"`).
 * - `jaar` / `week` are ISO week-year and ISO week number (Monday-based).
 * - `vak` and `lesgroepen` are top-level (unlike `/rest/v1/afspraken`, which
 *   often nests vak under `additionalObjects`).
 * - Teacher names: `docentNamen`; with `?additional=docentAfkortingen` the
 *   abbreviations may also appear under `additionalObjects.docentAfkortingen`.
 * - Timestamps are local-wall ISO strings without timezone (`YYYY-MM-DDTHH:mm:ss`).
 */
export type SomtodayAfspraakItem = SomtodayEntity & {
  uniqueIdentifier?: string;
  afspraakItemType?: SomtodayAfspraakItemType;
  beginDatumTijd?: string;
  eindDatumTijd?: string;
  beginLesuur?: number;
  eindLesuur?: number;
  titel?: string;
  omschrijving?: string;
  locatie?: string;
  vak?: SomtodayVak;
  lesgroepen?: SomtodayLesgroep[];
  /** Teacher display names (official leerling client). */
  docentNamen?: string[];
  bijlagen?: unknown[];
  aantalToekomstigeHerhalingen?: number;
  /**
   * Business status code on some payloads (e.g. `"2002"` normal,
   * `"4001"` inschrijven niet mogelijk). Cancellation is `"4007"` when present.
   */
  status?: string;
  /** Live-schedule change blurb, e.g. `"Les vervalt"`. */
  wijzigingOmschrijving?: string;
  /** Per-item tips; cancelled lessons include status `"4007"`. */
  statusNotifications?: SomtodayStatusNotification[];
  additionalObjects?: {
    docentAfkortingen?: string;
    [key: string]: unknown;
  };
};

export type SomtodayAbsentieReden = SomtodayEntity & {
  absentieSoort?: string;
  afkorting?: string;
  omschrijving?: string;
  geoorloofd?: boolean;
};

/** `GET /rest/v1/absentiemeldingen` item. */
export type SomtodayAbsentieMelding = SomtodayEntity & {
  beginDatumTijd?: string;
  eindDatumTijd?: string;
  beginLesuur?: number;
  eindLesuur?: number;
  datumTijdInvoer?: string;
  afgehandeld?: boolean;
  leerling?: SomtodayStudent;
  absentieReden?: SomtodayAbsentieReden;
};

export type SomtodayLesgroep = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  omschrijving?: string;
  schooljaar?: SomtodaySchooljaar;
};

/** `GET /rest/v1/studiewijzers` item. */
export type SomtodayStudiewijzer = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
  magBewerken?: boolean;
  vestiging?: SomtodayEntity & { naam?: string; afkorting?: string; UUID?: string };
  lesgroep?: SomtodayLesgroep;
  eigenaar?: unknown;
};

export type SomtodayStudiewijzerItem = SomtodayEntity & {
  onderwerp?: string;
  huiswerkType?: string;
  omschrijving?: string;
  inleverperiodes?: boolean;
  lesmateriaal?: boolean;
  projectgroepen?: boolean;
  bijlagen?: unknown[];
  externeMaterialen?: unknown[];
  inlevermomenten?: unknown[];
  tonen?: boolean;
  notitieZichtbaarVoorLeerling?: boolean;
  leerdoelen?: string;
};

/** `GET /rest/v1/studiewijzeritemafspraaktoekenningen` item. */
export type SomtodayStudiewijzerItemAfspraakToekenning = SomtodayEntity & {
  datumTijd?: string;
  aangemaaktOpDatumTijd?: string;
  sortering?: number;
  studiewijzerItem?: SomtodayStudiewijzerItem;
  lesgroep?: SomtodayLesgroep;
};

/** `GET /rest/v1/account` item. */
export type SomtodayAccount = SomtodayEntity & {
  gebruikersnaam?: string;
  accountPermissions?: unknown[];
  persoon?: SomtodayStudent;
};

export type SomtodayBoodschapCorrespondent = {
  $type?: string;
  naam?: string;
  sorteerNaam?: string;
  initialen?: string;
  vakken?: SomtodayVak[];
};

export type SomtodayBoodschap = SomtodayEntity & {
  startPublicatie?: string;
  verzendDatum?: string;
  wijzigingsDatum?: string;
  draft?: boolean;
  onderwerp?: string;
  inhoud?: string;
  additionalObjects?: {
    aantalExtraOntvangers?: number;
    verzondenDoorGebruiker?: boolean;
    ontvangerCorrespondenten?: { $type?: string; items?: SomtodayBoodschapCorrespondent[] };
    verzenderCorrespondent?: SomtodayBoodschapCorrespondent;
    actiefVoorGebruiker?: boolean;
    isOuderavondUitnodiging?: boolean;
    [key: string]: unknown;
  };
};

/** `GET /rest/v1/boodschappen/conversaties` item. */
export type SomtodayBoodschapConversatie = {
  $type?: string;
  boodschappen?: SomtodayBoodschap[];
  toekenningVanInleverperiode?: unknown;
};

export type SomtodayListResponse<T> = {
  items?: T[];
  /** Envelope-level tips (NONtoday); cancellation may also sit on each item. */
  statusNotifications?: SomtodayStatusNotification[];
};

/**
 * `GET /rest/v1/vakanties/leerling/{studentId}` item (`participatie.RVakantie`).
 *
 * Documented in NONtoday/somtoday-api-docs (README → Vakanties):
 * - Envelope is `{ items?: SomtodayVakantie[] }`.
 * - `naam` is the display label (e.g. `"Herfstvakantie"`).
 * - `beginDatum` / `eindDatum` are inclusive whole-day timestamps with offset
 *   (e.g. `"2023-10-16T00:00:00.000+02:00"`). Use the calendar date part;
 *   do not convert via UTC (that can shift the day).
 */
export type SomtodayVakantie = SomtodayEntity & {
  naam?: string;
  beginDatum?: string;
  eindDatum?: string;
};

/**
 * `GET /rest/v1/resultaatpublicatiemomenten/volgende/leerling/{studentId}`
 *
 * Next delayed-grade publication moment for a student (Somtoday “uitgesteld
 * publiceren”). Singular object — not wrapped in `items`.
 *
 * Live-checked shape (`$type`: `resultaten.RVolgendePublicatieMoment`):
 * - Primary timestamp is `value` (ISO string, often with offset).
 * - `cyfers.fetch` returns this object directly (host proxy unwraps
 *   `{ ok, status, data }` → `data`).
 * - Empty / no schedule: null body, missing `value`, or non-OK proxy status
 *   (schools on “direct publiceren”).
 * - Optional `naam` / older datetime field names kept as defensive fallbacks.
 */
export type SomtodayResultaatPublicatieMoment = SomtodayEntity & {
  /** Next reveal timestamp (ISO). Live field on `RVolgendePublicatieMoment`. */
  value?: string;
  /** Older / related Somtoday datetime names — parsers may check these. */
  datumTijd?: string;
  publicatieDatumTijd?: string;
  tijdstip?: string;
  beginDatumTijd?: string;
  /** Optional label (e.g. one-off extra publicatiemoment). */
  naam?: string;
};

/**
 * `GET /rest/v1/plaatsingen?leerling={studentId}` item (`RPlaatsing`).
 *
 * Path key for vakgemiddelden is the plaatsing UUID (NONtoday leerling app),
 * not the numeric `links[].id`. Prefer `UUID` / `uuid`; fall back to self-link id.
 */
export type SomtodayPlaatsing = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  /** True for the student’s current placement — default dropdown selection. */
  huidig?: boolean;
  leerjaar?: number;
  stamgroepnaam?: string;
  opleidingsnaam?: string;
  vanafDatum?: string;
  totDatum?: string;
  schooljaar?: SomtodaySchooljaar;
  leerling?: SomtodayStudent | SomtodayEntity;
  vestiging?: SomtodayEntity & {
    naam?: string;
    afkorting?: string;
    UUID?: string;
    uuid?: string;
  };
};

/** Nested lichting on a vakkeuze (`RLichting`) — UUID feeds vakresultaten paths. */
export type SomtodayLichting = SomtodayEntity & {
  UUID?: string;
  uuid?: string;
  naam?: string;
};

/**
 * Nested subject choice on vakgemiddelden (`RVakkeuze`).
 *
 * Per-subject individual grades for a past plaatsing come from
 * `…/vakresultaten/{studentId}/vak/{vak.UUID}/lichting/{lichting.UUID}`.
 * Prefer `lichting` (live NONtoday / takeout shape); fall back to
 * `relevanteCijferLichting` when present.
 */
export type SomtodayVakkeuze = SomtodayEntity & {
  vrijstelling?: boolean;
  vak?: SomtodayVak;
  leerling?: SomtodayStudent | SomtodayEntity;
  /** Primary lichting UUID source for vakresultaten. */
  lichting?: SomtodayLichting;
  relevanteCijferLichting?: SomtodayLichting;
};

/**
 * One subject average inside `RLeerlingVakGemiddelden.gemiddelden`
 * (`RLeerlingVakGemiddelde`). Result fields reuse `SomtodayGrade` shapes.
 */
export type SomtodayVakGemiddelde = SomtodayEntity & {
  vakkeuze?: SomtodayVakkeuze;
  vakAnderNiveau?: string;
  niveauOmschrijving?: string;
  afwijkendNiveauOmschrijving?: string;
  voortgangsdossierResultaat?: SomtodayGrade;
  voortgangsdossierResultaatAfwijkend?: SomtodayGrade;
  examendossierResultaat?: SomtodayGrade;
};

/**
 * `GET /rest/v1/vakkeuzes/plaatsing/{plaatsingUuid}/vakgemiddelden`
 * (`RLeerlingVakGemiddelden`) — singular object, not wrapped in `items`.
 */
export type SomtodayVakGemiddelden = SomtodayEntity & {
  gemiddelden?: SomtodayVakGemiddelde[];
  voortgangsdossierGemiddelde?: number;
};
