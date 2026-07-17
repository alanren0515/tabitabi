export async function sendEvent(fetchImpl, payload, headers = {}) {
  try {
    const response = await fetchImpl("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(payload),
      keepalive: true
    });
    return response?.ok === true;
  } catch {
    return false;
  }
}
