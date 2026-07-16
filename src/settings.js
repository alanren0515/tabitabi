export const SETTINGS_STORAGE_KEY = "tabitabi-settings";
export const DEFAULT_SETTINGS = Object.freeze({ defaultPartySize: 2, reservationName: "", defaultPhoneScript: "standard", saveRecentAnalyses: true, pilotAccessCode: "" });

export function normalizeSettings(value = {}) {
  const party = Number.parseInt(value?.defaultPartySize, 10);
  return {
    defaultPartySize: Number.isFinite(party) ? Math.min(20, Math.max(1, party)) : DEFAULT_SETTINGS.defaultPartySize,
    reservationName: normalizeReservationName(value?.reservationName),
    defaultPhoneScript: ["standard", "short", "easy"].includes(value?.defaultPhoneScript) ? value.defaultPhoneScript : DEFAULT_SETTINGS.defaultPhoneScript,
    saveRecentAnalyses: value?.saveRecentAnalyses !== false,
    pilotAccessCode: normalizePilotAccessCode(value?.pilotAccessCode)
  };
}

export function settingsFromForm(values = {}) {
  return normalizeSettings({
    defaultPartySize: values.defaultPartySize,
    reservationName: values.reservationName,
    defaultPhoneScript: values.defaultPhoneScript,
    saveRecentAnalyses: values.saveRecentAnalyses === "on" || values.saveRecentAnalyses === true,
    pilotAccessCode: values.pilotAccessCode
  });
}

export function pilotAccessHeaders(settings = {}) {
  const code = normalizePilotAccessCode(settings?.pilotAccessCode);
  return code ? { "X-Pilot-Access": code } : {};
}

function normalizePilotAccessCode(value) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 256);
}

function normalizeReservationName(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}
