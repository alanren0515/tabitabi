import { normalizeLocale } from "./i18n.js";

export const SETTINGS_STORAGE_KEY = "tabitabi-settings";
export const PILOT_ACCESS_SESSION_KEY = "tabitabi-pilot-access-v1";
export const DEFAULT_SETTINGS = Object.freeze({ defaultPartySize: 2, saveRecentAnalyses: true, pilotAccessCode: "", locale: "ja" });

export function normalizeSettings(value = {}) {
  const party = Number.parseInt(value?.defaultPartySize, 10);
  return {
    defaultPartySize: Number.isFinite(party) ? Math.min(20, Math.max(1, party)) : DEFAULT_SETTINGS.defaultPartySize,
    saveRecentAnalyses: value?.saveRecentAnalyses !== false,
    pilotAccessCode: normalizePilotAccessCode(value?.pilotAccessCode),
    locale: normalizeLocale(value?.locale)
  };
}

export function settingsFromForm(values = {}) {
  return normalizeSettings({
    defaultPartySize: values.defaultPartySize,
    saveRecentAnalyses: values.saveRecentAnalyses === "on" || values.saveRecentAnalyses === true,
    pilotAccessCode: values.pilotAccessCode,
    locale: values.locale
  });
}

export function pilotAccessHeaders(settings = {}) {
  const code = normalizePilotAccessCode(settings?.pilotAccessCode);
  return code ? { "X-Pilot-Access": code } : {};
}

export function pilotAccessLocked(capabilities = {}, settings = {}) {
  return capabilities?.pilotAccessRequired === true && !normalizePilotAccessCode(settings?.pilotAccessCode);
}

export function pilotAccessRejected(error) {
  return error?.code === "PILOT_ACCESS_REQUIRED";
}

export function settingsWithoutPilotAccess(settings = {}) {
  return normalizeSettings({ ...settings, pilotAccessCode: "" });
}

export function persistentSettings(settings = {}) {
  const normalized = normalizeSettings(settings);
  const { pilotAccessCode: _discarded, ...persistent } = normalized;
  return persistent;
}

export function settingsWithSessionAccess(persistent = {}, sessionStorage) {
  let code = "";
  try { code = sessionStorage?.getItem(PILOT_ACCESS_SESSION_KEY) || ""; } catch {}
  return normalizeSettings({ ...persistent, pilotAccessCode: code });
}

export function savePilotAccessForSession(settings = {}, sessionStorage) {
  const code = normalizePilotAccessCode(settings?.pilotAccessCode);
  if (!sessionStorage) return;
  try {
    if (code) sessionStorage.setItem(PILOT_ACCESS_SESSION_KEY, code);
    else sessionStorage.removeItem(PILOT_ACCESS_SESSION_KEY);
  } catch {}
}

export function loadSettingsFromStorage(localStorage, sessionStorage) {
  let stored = {};
  try { stored = JSON.parse(localStorage?.getItem(SETTINGS_STORAGE_KEY) || "{}"); } catch { stored = {}; }
  const settings = settingsWithSessionAccess(stored, sessionStorage);
  try { localStorage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persistentSettings(settings))); } catch {}
  return settings;
}

function normalizePilotAccessCode(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 256);
}
