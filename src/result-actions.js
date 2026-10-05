function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

export function actionHref(action) {
  if (action?.type === "phone" && /^tel:[+\d()\-]+$/i.test(String(action.url || ""))) return action.url;
  return safeExternalUrl(action?.url);
}

// Render all result-page destinations through the same safety boundary.
// Example destinations are local buttons, never callable or navigable links.
export function resultLinkHtml({ href, labelHtml, className, id, actionType, reservationProvider, example = false }) {
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const attributes = [["class", className], ["id", id], ["data-action-type", actionType], ["data-reservation-provider", reservationProvider]]
    .filter(([, value]) => value).map(([name, value]) => ` ${name}="${escape(value)}"`).join("");
  if (example) return `<button type="button" data-example-action aria-describedby="example-action-status"${attributes}>${labelHtml}</button>`;
  const destination = actionHref({ type: href?.startsWith("tel:") ? "phone" : "external", url: href });
  return `<a href="${escape(destination)}"${attributes}${destination.startsWith("tel:") ? "" : ' target="_blank" rel="noreferrer"'}>${labelHtml}</a>`;
}

function mapHref(restaurant = {}) {
  return safeExternalUrl(restaurant.mapSearchUrl || restaurant.googleMapsUri || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${restaurant.name || ""} ${restaurant.address || ""}`.trim())}`);
}

function actionCopy(type, href, label = "") {
  if (type === "phone") return { type, href, label, headingKey: "result.actionPhoneHeading", buttonKey: "result.actionPhone" };
  if (type === "map") return { type, href, label, headingKey: "result.actionMapHeading", buttonKey: "result.actionMap" };
  if (type === "official_website") return { type, href, label, headingKey: "result.actionOfficialHeading", buttonKey: "result.actionOfficial" };
  if (type === "external") return { type, href, label, headingKey: "result.actionExternalHeading", buttonKey: "result.actionExternal" };
  return { type: "open_booking_source", href, label, headingKey: "result.actionBookingHeading", buttonKey: "result.actionBooking" };
}

// This is deliberately UI-independent so the primary action's link, event type,
// title, and button label always come from one resolution path.
export function resultActionCopy(action, restaurant = {}) {
  const href = actionHref(action);
  if (action && href !== "#") {
    const type = action.type;
    if (type === "phone" && href.startsWith("tel:")) return actionCopy("phone", href, action.label);
    if (["map", "open_map"].includes(type) || action.provider === "google_maps") return actionCopy("map", href, action.label);
    if (type === "official_website") return actionCopy("official_website", href, action.label);
    if (["discover_platform", "external"].includes(type) || type === "phone") return actionCopy("external", href, action.label);
    return actionCopy("open_booking_source", href, action.label);
  }

  const phoneHref = actionHref({ type: "phone", url: `tel:${restaurant.phone || ""}` });
  if (restaurant.phone && phoneHref !== "#") return actionCopy("phone", phoneHref);
  return actionCopy("map", mapHref(restaurant));
}
