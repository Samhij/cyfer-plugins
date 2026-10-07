/**
 * Ambient globals for plain HTML/JS plugins (JSDoc + IDE autocomplete).
 * Included via the repo-root jsconfig.json — do not ship inside plugin zips.
 */

import type {
  CyfersContext as _CyfersContext,
  CyfersSdk as _CyfersSdk,
  CyfersStudent as _CyfersStudent,
  PluginKind as _PluginKind,
  PluginManifest as _PluginManifest,
  PluginNav as _PluginNav,
  SomtodayAbsentieMelding as _SomtodayAbsentieMelding,
  SomtodayAbsentieReden as _SomtodayAbsentieReden,
  SomtodayAccount as _SomtodayAccount,
  SomtodayAfspraak as _SomtodayAfspraak,
  SomtodayAfspraakItem as _SomtodayAfspraakItem,
  SomtodayAfspraakItemType as _SomtodayAfspraakItemType,
  SomtodayAfspraakType as _SomtodayAfspraakType,
  SomtodayBoodschap as _SomtodayBoodschap,
  SomtodayBoodschapConversatie as _SomtodayBoodschapConversatie,
  SomtodayBoodschapCorrespondent as _SomtodayBoodschapCorrespondent,
  SomtodayEntity as _SomtodayEntity,
  SomtodayGrade as _SomtodayGrade,
  SomtodayLesgroep as _SomtodayLesgroep,
  SomtodayLink as _SomtodayLink,
  SomtodayListResponse as _SomtodayListResponse,
  SomtodayPermission as _SomtodayPermission,
  SomtodayPlaatsing as _SomtodayPlaatsing,
  SomtodayResultaatPublicatieMoment as _SomtodayResultaatPublicatieMoment,
  SomtodaySchooljaar as _SomtodaySchooljaar,
  SomtodayStatusNotification as _SomtodayStatusNotification,
  SomtodayStudent as _SomtodayStudent,
  SomtodayStudiewijzer as _SomtodayStudiewijzer,
  SomtodayStudiewijzerItem as _SomtodayStudiewijzerItem,
  SomtodayStudiewijzerItemAfspraakToekenning as _SomtodayStudiewijzerItemAfspraakToekenning,
  SomtodayLichting as _SomtodayLichting,
  SomtodayVak as _SomtodayVak,
  SomtodayVakGemiddelde as _SomtodayVakGemiddelde,
  SomtodayVakGemiddelden as _SomtodayVakGemiddelden,
  SomtodayVakantie as _SomtodayVakantie,
  SomtodayVakkeuze as _SomtodayVakkeuze,
} from "./api";

declare global {
  type CyfersStudent = _CyfersStudent;
  type CyfersContext = _CyfersContext;
  type PluginKind = _PluginKind;
  type PluginNav = _PluginNav;
  type PluginManifest = _PluginManifest;
  type SomtodayLink = _SomtodayLink;
  type SomtodayPermission = _SomtodayPermission;
  type SomtodayEntity = _SomtodayEntity;
  type SomtodayStudent = _SomtodayStudent;
  type SomtodaySchooljaar = _SomtodaySchooljaar;
  type SomtodayGrade = _SomtodayGrade;
  type SomtodayVak = _SomtodayVak;
  type SomtodayAfspraakType = _SomtodayAfspraakType;
  type SomtodayAfspraak = _SomtodayAfspraak;
  type SomtodayAfspraakItemType = _SomtodayAfspraakItemType;
  type SomtodayAfspraakItem = _SomtodayAfspraakItem;
  type SomtodayStatusNotification = _SomtodayStatusNotification;
  type SomtodayAbsentieReden = _SomtodayAbsentieReden;
  type SomtodayAbsentieMelding = _SomtodayAbsentieMelding;
  type SomtodayLesgroep = _SomtodayLesgroep;
  type SomtodayStudiewijzer = _SomtodayStudiewijzer;
  type SomtodayStudiewijzerItem = _SomtodayStudiewijzerItem;
  type SomtodayStudiewijzerItemAfspraakToekenning = _SomtodayStudiewijzerItemAfspraakToekenning;
  type SomtodayAccount = _SomtodayAccount;
  type SomtodayBoodschapCorrespondent = _SomtodayBoodschapCorrespondent;
  type SomtodayBoodschap = _SomtodayBoodschap;
  type SomtodayBoodschapConversatie = _SomtodayBoodschapConversatie;
  type SomtodayListResponse<T> = _SomtodayListResponse<T>;
  type SomtodayResultaatPublicatieMoment = _SomtodayResultaatPublicatieMoment;
  type SomtodayPlaatsing = _SomtodayPlaatsing;
  type SomtodayLichting = _SomtodayLichting;
  type SomtodayVakkeuze = _SomtodayVakkeuze;
  type SomtodayVakGemiddelde = _SomtodayVakGemiddelde;
  type SomtodayVakGemiddelden = _SomtodayVakGemiddelden;
  type SomtodayVakantie = _SomtodayVakantie;

  /** Injected by the Cyfers host — do not ship your own SDK script. */
  const cyfers: _CyfersSdk;
}

export {};
