import { resolve, sep } from "node:path";

export function resolveStaticFile(root, requestUrl = "/", options = {}) {
  let rawPath;
  try {
    rawPath = decodeURIComponent(String(requestUrl).split("?")[0]);
  } catch {
    return { ok: false, status: 400, error: "Invalid URL encoding" };
  }

  if (rawPath.includes("\0")) {
    return { ok: false, status: 400, error: "Invalid URL path" };
  }

  const relativePath = rawPath === "/" ? "index.html" : rawPath.replace(/^\/+/, "");
  const filePath = resolve(root, relativePath);
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return { ok: false, status: 403, error: "Forbidden" };
  }
  if (!publicStaticPath(rawPath, options)) return { ok: false, status: 404, error: "Not found" };
  return { ok: true, filePath };
}

function publicStaticPath(rawPath, { allowAuditEntry = false } = {}) {
  if (["/", "/index.html", "/manifest.webmanifest", "/sw.js"].includes(rawPath)) return true;
  if (allowAuditEntry && rawPath === "/audit.html") return true;
  if (/^\/assets\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|svg|webp|ico)$/.test(rawPath)) return true;
  return /^\/src\/[a-zA-Z0-9_-]+\.(?:js|css)$/.test(rawPath);
}
