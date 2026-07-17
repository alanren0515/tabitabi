import test from "node:test";
import assert from "node:assert/strict";
import { isPublicDocumentView, pathnameForView, viewFromPathname } from "../src/client-routes.js";

test("maps standalone privacy and terms paths to document views", () => {
  assert.equal(viewFromPathname("/privacy"), "privacy");
  assert.equal(viewFromPathname("/privacy/"), "privacy");
  assert.equal(viewFromPathname("/terms"), "terms");
  assert.equal(viewFromPathname("/unknown"), "home");
  assert.equal(pathnameForView("privacy"), "/privacy");
  assert.equal(pathnameForView("terms"), "/terms");
  assert.equal(pathnameForView("saved"), "/");
  assert.equal(isPublicDocumentView("privacy"), true);
  assert.equal(isPublicDocumentView("home"), false);
});
