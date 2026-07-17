const PUBLIC_ROUTES = Object.freeze({
  "/privacy": "privacy",
  "/terms": "terms"
});

export function viewFromPathname(pathname = "/") {
  return PUBLIC_ROUTES[String(pathname || "").replace(/\/$/, "") || "/"] || "home";
}

export function pathnameForView(view = "home") {
  return Object.entries(PUBLIC_ROUTES).find(([, routeView]) => routeView === view)?.[0] || "/";
}

export function isPublicDocumentView(view) {
  return view === "privacy" || view === "terms";
}
