import { createHash } from "node:crypto";

export class VisionConcurrencyError extends Error {
  constructor() {
    super("Too many vision requests are already in progress");
    this.name = "VisionConcurrencyError";
    this.code = "VISION_BUSY";
    this.status = 429;
  }
}

export function imageContentFingerprint(imageDataUrl) {
  const comma = typeof imageDataUrl === "string" ? imageDataUrl.indexOf(",") : -1;
  if (comma < 0) throw new TypeError("A validated image data URL is required");
  const bytes = Buffer.from(imageDataUrl.slice(comma + 1).replace(/\s/g, ""), "base64");
  return createHash("sha256").update(bytes).digest("hex");
}

export function createVisionConcurrencyGate({ limit = 2 } = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("limit must be a positive integer");
  let active = 0;
  return {
    async run(loader) {
      if (active >= limit) throw new VisionConcurrencyError();
      active += 1;
      try {
        return await loader();
      } finally {
        active -= 1;
      }
    },
    active: () => active
  };
}
