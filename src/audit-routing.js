export function isScreenshotAuditSource(value) {
  return /_screenshot$/.test(String(value || ""));
}

export function auditLaunchPath(testCase = {}) {
  if (isScreenshotAuditSource(testCase.sourceType)) return "/?audit=1";
  return `/?audit=1&share=1&text=${encodeURIComponent(String(testCase.query || ""))}`;
}
