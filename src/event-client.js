export async function sendEvent(fetchImpl, payload) {
  try {
    const response = await fetchImpl("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true
    });
    return response?.ok === true;
  } catch {
    return false;
  }
}
