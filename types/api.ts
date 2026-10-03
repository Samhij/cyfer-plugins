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

/** Injected `window.cyfers` / global `cyfers` bridge. */
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
  order: number;
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

/**
 * `GET /rest/v1/afspraakitems/{studentId}/jaar/{isoYear}/week/{isoWeek}` item.
 *
 * Assumptions (inferred from NONtoday leerling app + community clients; not a
 * live-checked Cyfers session):
 * - Response envelope is `{ items?: SomtodayAfspraakItem[] }` (optional
 *   `statusNotifications` ignored by plugins).
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
};
