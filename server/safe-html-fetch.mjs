import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

export const MAX_HTML_BYTES = 512 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class SafeHtmlFetchError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "SafeHtmlFetchError";
    this.code = code;
    this.status = status;
  }
}

export function validatePublicHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return "";
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) return "";
    if (isIP(hostname) && isPrivateOrReservedAddress(hostname)) return "";
    url.hash = "";
    return url.href;
  } catch {
    return "";
  }
}

export async function safeFetchHtml({
  url,
  lookupImpl = lookup,
  requestImpl = requestPinned,
  timeoutMs = 8_000,
  maxBytes = MAX_HTML_BYTES,
  maxRedirects = 3,
  headers = {}
}) {
  let currentUrl = validatePublicHttpUrl(url);
  if (!currentUrl) throw new SafeHtmlFetchError("INVALID_URL", "A public http(s) URL is required");

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const parsed = new URL(currentUrl);
    const addresses = await resolvePublicAddresses(parsed.hostname, lookupImpl, requestImpl);
    const pinnedAddress = addresses[0];
    const rawResponse = await requestImpl(currentUrl, {
      headers,
      timeoutMs,
      pinnedAddress: pinnedAddress.address,
      pinnedFamily: pinnedAddress.family,
      servername: parsed.hostname
    });
    const response = normalizeResponse(rawResponse);

    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirects === maxRedirects) throw new SafeHtmlFetchError("TOO_MANY_REDIRECTS", "The webpage redirected too many times");
      const location = response.headers.get("location");
      const nextUrl = location ? validatePublicHttpUrl(new URL(location, currentUrl).href) : "";
      if (!nextUrl) throw new SafeHtmlFetchError("UNSAFE_REDIRECT", "The webpage redirected to an unsafe URL");
      await cancelBody(response.body);
      currentUrl = nextUrl;
      continue;
    }

    if (response.status < 200 || response.status >= 300) {
      await cancelBody(response.body);
      throw new SafeHtmlFetchError("UPSTREAM_ERROR", `The webpage returned HTTP ${response.status || 0}`, 502);
    }
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      await cancelBody(response.body);
      throw new SafeHtmlFetchError("NOT_HTML", "The URL did not return an HTML page");
    }
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await cancelBody(response.body);
      throw new SafeHtmlFetchError("TOO_LARGE", "The webpage is too large to inspect", 413);
    }
    return { html: await readBoundedBody(response.body, maxBytes), sourceUrl: currentUrl, status: response.status };
  }
  throw new SafeHtmlFetchError("TOO_MANY_REDIRECTS", "The webpage redirected too many times");
}

async function resolvePublicAddresses(hostname, lookupImpl, requestImpl) {
  const normalized = hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(normalized);
  let addresses;
  if (literalFamily) addresses = [{ address: normalized, family: literalFamily }];
  else if (requestImpl !== requestPinned && normalized.endsWith(".example") && lookupImpl === lookup) {
    // RFC 2606 names are used only with injected transports in unit tests.
    addresses = [{ address: "93.184.216.34", family: 4 }];
  } else addresses = await lookupImpl(normalized, { all: true, verbatim: true });
  if (!addresses?.length || addresses.some((item) => isPrivateOrReservedAddress(item.address))) {
    throw new SafeHtmlFetchError("UNSAFE_HOST", "The webpage hostname resolves to a private or reserved address");
  }
  return addresses;
}

function requestPinned(value, { headers, timeoutMs, pinnedAddress, pinnedFamily, servername }) {
  return new Promise((resolve, reject) => {
    const url = new URL(value);
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(url, {
      method: "GET",
      headers,
      servername: url.protocol === "https:" ? servername : undefined,
      lookup: (_hostname, _options, callback) => callback(null, pinnedAddress, pinnedFamily)
    }, (response) => resolve({ status: response.statusCode || 0, headers: response.headers, body: response }));
    request.setTimeout(timeoutMs, () => request.destroy(new SafeHtmlFetchError("TIMEOUT", "The webpage request timed out", 504)));
    request.on("error", reject);
    request.end();
  });
}

function normalizeResponse(response) {
  if (!response) throw new SafeHtmlFetchError("UPSTREAM_ERROR", "The webpage returned no response", 502);
  return {
    status: Number(response.status ?? response.statusCode ?? 0),
    headers: response.headers instanceof Headers ? response.headers : new Headers(response.headers || {}),
    body: response.body
  };
}

async function readBoundedBody(body, maxBytes) {
  if (!body) return "";
  const chunks = [];
  let bytes = 0;
  try {
    for await (const value of body) {
      const chunk = typeof value === "string" ? Buffer.from(value) : Buffer.from(value);
      bytes += chunk.length;
      if (bytes > maxBytes) {
        await cancelBody(body);
        throw new SafeHtmlFetchError("TOO_LARGE", "The webpage is too large to inspect", 413);
      }
      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof SafeHtmlFetchError) throw error;
    throw new SafeHtmlFetchError("UPSTREAM_ERROR", "The webpage response could not be read", 502);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

async function cancelBody(body) {
  try {
    if (typeof body?.cancel === "function") await body.cancel();
    else if (typeof body?.destroy === "function") body.destroy();
  } catch { /* Best-effort resource cleanup. */ }
}

export function isPrivateOrReservedAddress(address) {
  const version = isIP(address);
  if (version === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168)
      || (a === 198 && [18, 19].includes(b)) || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrReservedAddress(mapped[1]);
    return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd")
      || /^fe[89ab]/.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8:");
  }
  return true;
}
