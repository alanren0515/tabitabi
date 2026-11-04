// Diagnostic for the same metadata-only endpoint used by flyctl secrets list.
// Never request show_secrets, inspect a response body, or forward redirects.
export async function probeFlySecretMetadata({ app, env = process.env, fetchImpl = fetch }) {
  const token = env.FLY_ACCESS_TOKEN || env.FLY_API_TOKEN;
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(app || "") || !token) return { httpStatus: null, access: "not_checked" };
  try {
    const response = await fetchImpl(`https://api.machines.dev/v1/apps/${app}/secrets`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { Authorization: `Bearer ${token}` }
    });
    const httpStatus = response.status;
    await response.body?.cancel().catch(() => {});
    return { httpStatus, access: [401, 403].includes(httpStatus) ? "denied" : response.ok ? "accepted" : "unavailable" };
  } catch {
    return { httpStatus: null, access: "unavailable" };
  }
}
