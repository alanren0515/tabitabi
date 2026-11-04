// Diagnostic for the same metadata-only endpoint used by flyctl secrets list.
// Never request show_secrets, inspect a successful REST body, or forward redirects.
import { REQUIRED_FLY_SECRETS } from "../server/fly-remote-audit.mjs";

const ERROR_TERMS = new Set("authorization forbidden unauthorized permission denied read write create delete control secrets token command macaroon app organization scope feature enabled disabled supported unsupported expired invalid legacy migrate migration preview requires only not new authenticated authentication access value values flyv1 resource user deploy error failed cache config parse decode missing cannot restricted endpoint".split(" "));

export function safeDiagnosticTerms(text) {
  return [...new Set((String(text || "").toLowerCase().match(/[a-z]+/g) || []).filter(word => ERROR_TERMS.has(word)))].slice(0, 32);
}

function authorizationHeader(token) {
  let value = String(token || "").trim();
  if (!value || /[\r\n]/.test(value)) throw new Error("Invalid credential format");
  value = value.replace(/^Bearer\s+/i, "");
  const macaroon = /^FlyV1\s+/.test(value) || /^fm(?:1r|1a|2)_/.test(value);
  value = value.replace(/^FlyV1\s+/, "");
  return `${macaroon ? "FlyV1" : "Bearer"} ${value}`;
}

export async function probeFlySecretMetadata({ app, env = process.env, fetchImpl = fetch }) {
  const token = env.FLY_ACCESS_TOKEN || env.FLY_API_TOKEN;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(app || "") || !token) return { httpStatus: null, access: "not_checked" };
  try {
    const response = await fetchImpl(`https://api.machines.dev/v1/apps/${app}/secrets`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: authorizationHeader(token) }
    });
    const httpStatus = response.status;
    if (httpStatus === 403 || httpStatus === 401) {
      const error = await boundedJson(response, 8192);
      // Fixed vocabulary only: never relay arbitrary error text or identifiers.
      const reasonTerms = safeDiagnosticTerms(JSON.stringify(error || {}));
      return { httpStatus, access: "denied", reasonTerms };
    }
    await response.body?.cancel().catch(() => {});
    return { httpStatus, access: [401, 403].includes(httpStatus) ? "denied" : response.ok ? "accepted" : "unavailable" };
  } catch {
    return { httpStatus: null, access: "unavailable" };
  }
}

export async function probeFlyGraphqlSecretMetadata({ app, env = process.env, fetchImpl = fetch }) {
  const token = env.FLY_ACCESS_TOKEN || env.FLY_API_TOKEN;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(app || "") || !token) return { httpStatus: null, access: "not_checked" };
  try {
    const response = await fetchImpl("https://api.fly.io/graphql", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: authorizationHeader(token), "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query MonitorSecretMetadata($appName: String!) { app(name: $appName) { secrets { name digest createdAt } } }", variables: { appName: app } })
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      return { httpStatus: response.status, access: [401, 403].includes(response.status) ? "denied" : "unavailable" };
    }
    const payload = await boundedJson(response, 65536);
    const secrets = payload?.data?.app?.secrets;
    if (payload?.errors?.length || !Array.isArray(secrets) || secrets.some(secret => typeof secret?.name !== "string" || typeof secret?.digest !== "string")) {
      return { httpStatus: response.status, access: "query_failed" };
    }
    const names = new Set(secrets.map(secret => secret.name));
    // This proves metadata readability only, never a Deployed status.
    return { httpStatus: response.status, access: "accepted", secretCount: secrets.length,
      requiredNamesPresent: REQUIRED_FLY_SECRETS.every(name => names.has(name)) };
  } catch { return { httpStatus: null, access: "unavailable" }; }
}

async function boundedJson(response, maximumBytes) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let length = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) { await reader.cancel(); return null; }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch { return null; }
  finally { reader.releaseLock(); }
}
