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

/* —— Raw Somtoday REST shapes ——
 * Derived from NONtoday/leerling-source store mappers + Cyfers live usage.
 * See somtoday-login/docs/somtoday-api/.
 */

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

/** `GET /rest/v1/leerlingen` / `GET /rest/v1/leerlingen/{id}` item (`RLeerling`). */
export type SomtodayStudent = SomtodayEntity & {
  UUID?: string;
  /** Rare; live responses use `UUID`. */
  uuid?: string;
  roepnaam?: string;
  /** Wire / account payloads may use either spelling. */
  tussenvoegsel?: string;
  voorvoegsel?: string;
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

/** Nested afspraak type on roosters (`/rest/v1/afspraken`). */
export type SomtodayAfspraakType = SomtodayEntity & {
  naam?: string;
  omschrijving?: string;
  standaardKleur?: number;
  categorie?: string;
  activiteit?: string;
  presentieRegistratieDefault?: boolean;
  actief?: boolean;
};

/** `GET /rest/v1/afspraken` item (codegen; rooster UI uses afspraakitems). */
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
 * From NONtoday/leerling-source (`RAfspraakItem` / `SAfspraakItem`).
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

export type SomtodayHerhaalDag =
  | "MAANDAG"
  | "DINSDAG"
  | "WOENSDAG"
  | "DONDERDAG"
  | "VRIJDAG"
  | "ZATERDAG"
  | "ZONDAG"
  | "DAG"
  | "WERKDAG"
  | string;

/** Recurrence block on afspraakitems / KWT acties (`RHerhalendeAfspraak`). */
export type SomtodayHerhalendeAfspraak = SomtodayEntity & {
  beginDatum?: string;
  eindDatum?: string;
  maxHerhalingen?: number;
  type?: "NIET_HERHALEN" | "DAGELIJKS" | "WEKELIJKS" | "MAANDELIJKS" | string;
  skip?: number;
  cyclus?: number;
  afspraakHerhalingDagen?: SomtodayHerhaalDag[];
};

export type SomtodayKwtInschrijfStatus =
  | "ONBEPAALD"
  | "NIET"
  | "WEL"
  | "DEFINITIEF"
  | "VERLOPEN"
  | string;

/** One KWT choice inside `kwtInfo.afspraakActies` (`RAfspraakActie`). */
export type SomtodayAfspraakActie = SomtodayEntity & {
  titel?: string;
  omschrijving?: string;
  toegestaan?: boolean;
  beschikbarePlaatsen?: number;
  locatie?: string;
  docentNamen?: string[];
  ingeschreven?: boolean;
  inschrijfBeginDatum?: string;
  inschrijfEindDatum?: string;
  beginDatumTijd?: string;
  eindDatumTijd?: string;
  uitvoerbareActie?: string;
  vak?: SomtodayVak;
  herhalendeAfspraak?: SomtodayHerhalendeAfspraak;
};

/** KWT block on `$type === "participatie.live.RKWTAfspraakItem"`. */
export type SomtodayKwtInfo = {
  minimumAantalKeuzes?: number;
  maximumAantalKeuzes?: number;
  afspraakActies?: SomtodayAfspraakActie[];
  inschrijfStatus?: SomtodayKwtInschrijfStatus;
  kwtSysteem?: "SOMTODAY" | "ZERMELO" | string;
};

/**
 * `GET /rest/v1/afspraakitems/{studentId}/jaar/{isoYear}/week/{isoWeek}` item
 * (`RAfspraakItem` — leerling-source afspraak-model).
 *
 * - Envelope: `{ items?: SomtodayAfspraakItem[], statusNotifications?: … }`.
 * - Cancelled lessons stay in `items`; look for `statusNotifications` /
 *   item `status` `"4007"`, and/or `wijzigingOmschrijving` like `"Les vervalt"`.
 * - `jaar` / `week` are ISO week-year and ISO week number (Monday-based).
 * - `vak` and `lesgroepen` are top-level (unlike `/rest/v1/afspraken`).
 * - Teachers: wire field `docentNamen` (leerling maps this to `medewerkers`).
 * - Timestamps are often local-wall ISO without timezone (`YYYY-MM-DDTHH:mm:ss`).
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
  herhalendeAfspraak?: SomtodayHerhalendeAfspraak;
  bijlagen?: unknown[];
  aantalToekomstigeHerhalingen?: number;
  /** Present when `$type` is the KWT live variant (or nested equivalently). */
  kwtInfo?: SomtodayKwtInfo;
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
  /** `Absent` | `Telaat` | `Verwijderd` in leerling-source. */
  absentieSoort?: string;
  afkorting?: string;
  omschrijving?: string;
  geoorloofd?: boolean;
  kiesbaarDoorVerzorger?: boolean;
  verzorgerMagTijdstipKiezen?: boolean;
  verzorgerEinddatumVerplicht?: boolean;
  standaardAfgehandeld?: boolean;
  vestiging?: SomtodayEntity & { naam?: string; UUID?: string; uuid?: string };
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

export type SomtodayHuiswerkType = "LESSTOF" | "HUISWERK" | "TOETS" | "GROTE_TOETS" | string;

export type SomtodayStudiewijzerItem = SomtodayEntity & {
  onderwerp?: string;
  huiswerkType?: SomtodayHuiswerkType;
  omschrijving?: string;
  toetsSoort?: { naam?: string; [key: string]: unknown };
  inleverperiodes?: boolean;
  lesmateriaal?: boolean;
  projectgroepen?: boolean;
  bijlagen?: unknown[];
  externeMaterialen?: unknown[];
  inlevermomenten?: Array<{
    startGeldigheid?: string;
    eindGeldigheid?: string;
    [key: string]: unknown;
  }>;
  tonen?: boolean;
  notitie?: string;
  notitieZichtbaarVoorLeerling?: boolean;
  tijdsindicatie?: string;
  leerdoelen?: string;
};

/** `GET /rest/v1/studiewijzeritemafspraaktoekenningen` item. */
export type SomtodayStudiewijzerItemAfspraakToekenning = SomtodayEntity & {
  datumTijd?: string;
  aangemaaktOpDatumTijd?: string;
  sortering?: number;
  studiewijzerItem?: SomtodayStudiewijzerItem;
  /**
   * Sometimes present top-level; leerling primarily reads
   * `additionalObjects.lesgroep`.
   */
  lesgroep?: SomtodayLesgroep;
  additionalObjects?: {
    leerlingen?: { items?: SomtodayStudent[] };
    /** Wire key used by leerling: `swigemaaktVinkjes`. */
    swigemaaktVinkjes?: { items?: SomtodaySwiGemaakt[] };
    lesgroep?: SomtodayLesgroep;
    leerlingenMetInleveringStatus?: {
      items?: Array<{
        leerlingId?: number;
        status?: "TE_BEOORDELEN" | "IN_BEHANDELING" | "AKKOORD" | "HEROPEND" | string;
        verzendDatum?: string;
      }>;
    };
    leerlingProjectgroep?: { items?: unknown[] };
    studiewijzerId?: number | string;
    [key: string]: unknown;
  };
};

/** Same envelope fields as afspraak-toekenning; week items use `weeknummer` query. */
export type SomtodayStudiewijzerItemDagToekenning = SomtodayStudiewijzerItemAfspraakToekenning;
export type SomtodayStudiewijzerItemWeekToekenning = SomtodayStudiewijzerItemAfspraakToekenning;

/** `PUT /rest/v1/swigemaakt/cou` body / response (`RswiGemaakt`). */
export type SomtodaySwiGemaakt = SomtodayEntity & {
  leerling?: SomtodayEntity;
  swiToekenningId?: number;
  gemaakt?: boolean;
};

/**
 * Per-student feature flags from
 * `GET /rest/v1/account/me?additional=restricties`
 * (`REloRestricties` under `additionalObjects.restricties.items`).
 */
export type SomtodayEloRestricties = {
  leerlingId?: number;
  mobieleAppAan?: boolean;
  studiewijzerAan?: boolean;
  berichtenVerzendenAan?: boolean;
  leermiddelenAan?: boolean;
  adviezenTokenAan?: boolean;
  opmerkingRapportCijferTonenAan?: boolean;
  periodeGemiddeldeTonenResultaatAan?: boolean;
  rapportGemiddeldeTonenResultaatAan?: boolean;
  rapportCijferTonenResultaatAan?: boolean;
  toetssoortgemiddeldenAan?: boolean;
  seResultaatAan?: boolean;
  stamgroepLeerjaarAan?: boolean;
  emailWijzigenAan?: boolean;
  mobielWijzigenAan?: boolean;
  wachtwoordWijzigenAan?: boolean;
  absentiesBekijkenAan?: boolean;
  absentieConstateringBekijkenAan?: boolean;
  absentieMaatregelBekijkenAan?: boolean;
  absentieMeldingBekijkenAan?: boolean;
  berichtenBekijkenAan?: boolean;
  cijfersBekijkenAan?: boolean;
  huiswerkBekijkenAan?: boolean;
  huiswerkWelNietInOrdeTonenAan?: boolean;
  nieuwsBekijkenAan?: boolean;
  pasfotoLeerlingTonenAan?: boolean;
  pasfotoMedewerkerTonenAan?: boolean;
  profielBekijkenAan?: boolean;
  roosterBekijkenAan?: boolean;
  roosterBeschikbaarIcalAan?: boolean;
  vakkenBekijkenAan?: boolean;
  lesurenVerbergenSettingAan?: boolean;
  magAbsentiemeldingMaken?: boolean;
};

/**
 * `GET /rest/v1/account/me` (`RAccount`) — bare object, not a list.
 * Use `?additional=restricties` (and optionally `impersonated`, `adres`).
 */
export type SomtodayAccount = SomtodayEntity & {
  gebruikersnaam?: string;
  accountPermissions?: unknown[];
  /** `RLeerling` or `RVerzorger` — check `persoon.links[0].type`. */
  persoon?: SomtodayStudent | SomtodayEntity;
  additionalObjects?: {
    restricties?: { items?: SomtodayEloRestricties[] };
    impersonated?: boolean;
    adres?: {
      straat?: string;
      huisnummer?: string | number;
      plaatsnaam?: string;
      postcode?: string;
      telefoonnummer?: string;
      isBuitenlandsAdres?: boolean;
      land?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

/**
 * `GET /rest/v1/medewerkers/ontvangers?additional=vakkenDocentVoorLeerling`
 * (`RMedewerker`).
 */
export type SomtodayMedewerker = SomtodayEntity & {
  afkorting?: string;
  achternaam?: string;
  geslacht?: string;
  voorvoegsel?: string;
  voorletters?: string;
  roepnaam?: string;
  additionalObjects?: {
    vakkenDocentVoorLeerling?: { items?: SomtodayVak[] };
    [key: string]: unknown;
  };
};

export type SomtodayBoodschapPrioriteit = "URGENT" | "HOOG" | "NORMAAL" | "LAAG" | string;

export type SomtodayBoodschapCorrespondent = {
  $type?: string;
  naam?: string;
  sorteerNaam?: string;
  initialen?: string;
  vakken?: SomtodayVak[];
  /** Client-synthesised when correspondent payload is missing. */
  isSomtodayAutomatischBericht?: boolean;
};

export type SomtodayBoodschap = SomtodayEntity & {
  startPublicatie?: string;
  verzendDatum?: string;
  wijzigingsDatum?: string;
  draft?: boolean;
  onderwerp?: string;
  inhoud?: string;
  mimeType?: string;
  prioriteit?: SomtodayBoodschapPrioriteit;
  notificatieType?: string;
  /** Wire spelling uses *bijlages* (with e), not bijlagen. */
  bijlages?: unknown[];
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

/** `GET /rest/v1/boodschappen/conversaties` item (`RBoodschapConversatie`). */
export type SomtodayBoodschapConversatie = {
  $type?: string;
  boodschappen?: SomtodayBoodschap[];
  /** ISO timestamp of oldest unread message — unread marker for the thread. */
  datumOudsteOngelezenBoodschap?: string;
  toekenningVanInleverperiode?: unknown;
};

export type SomtodayListResponse<T> = {
  items?: T[];
  /** Envelope-level tips; cancellation may also sit on each item. */
  statusNotifications?: SomtodayStatusNotification[];
};

/**
 * `GET /rest/v1/vakanties/leerling/{studentId}` item (`participatie.RVakantie`).
 *
 * From leerling-source `vakantie-model` (`naam`, `beginDatum`, `eindDatum`):
 * - Envelope is `{ items?: SomtodayVakantie[] }`.
 * - `naam` is the display label (e.g. `"Herfstvakantie"`).
 * - `beginDatum` / `eindDatum` are inclusive whole-day timestamps (often with
 *   offset). Use the calendar date part; do not convert via UTC (that can
 *   shift the day).
 */
export type SomtodayVakantie = SomtodayEntity & {
  naam?: string;
  beginDatum?: string;
  eindDatum?: string;
};

/**
 * `GET /rest/v1/resultaatpublicatiemomenten/volgende/leerling/{studentId}`
 *
 * Next delayed-grade publication moment (“uitgesteld publiceren”). Bare object
 * — not wrapped in `items`. **Not called by leerling-source** in the examined
 * snapshot; used by Cyfers pack-opening. Live shape often has `$type`
 * `resultaten.RVolgendePublicatieMoment` with primary field `value`.
 */
export type SomtodayResultaatPublicatieMoment = SomtodayEntity & {
  /** Next reveal timestamp (ISO). */
  value?: string;
  /** Defensive fallbacks seen on related Somtoday datetime fields. */
  datumTijd?: string;
  publicatieDatumTijd?: string;
  tijdstip?: string;
  beginDatumTijd?: string;
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
