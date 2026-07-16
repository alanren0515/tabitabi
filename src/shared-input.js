const MAX_SHARED_INPUT_LENGTH = 10_000;

export function parseShareTarget(search = "") {
  const params = new URLSearchParams(String(search || ""));
  if (params.get("share") !== "1") return { accepted: false, value: "" };
  const parts = [];
  for (const part of [params.get("title"), params.get("text"), params.get("url")].map(normalizePart).filter(Boolean)) {
    if (parts.includes(part)) continue;
    if (/^https?:\/\//i.test(part) && parts.some((existing) => existing.includes(part))) continue;
    parts.push(part);
  }
  return {
    accepted: parts.length > 0,
    value: parts.join("\n").slice(0, MAX_SHARED_INPUT_LENGTH)
  };
}

export function urlWithoutShareTarget(value) {
  const url = new URL(String(value || ""), "https://tabitabi.invalid/");
  for (const key of ["share", "title", "text", "url"]) url.searchParams.delete(key);
  return `${url.pathname}${url.search}${url.hash}`;
}

function normalizePart(value) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
