export function safeFatalErrorSummary(reason, type) {
  const error = reason instanceof Error ? reason : null;
  return {
    type,
    name: String(error?.name || "UnknownError").slice(0, 80),
    code: typeof error?.code === "string" ? error.code.slice(0, 80) : null
  };
}

export function installFatalProcessHandlers({
  processImpl = process,
  logger = console,
  close = (done) => done(),
  exit = (code) => processImpl.exit(code),
  schedule = (callback) => setTimeout(callback, 5_000).unref()
} = {}) {
  let terminating = false;
  const terminate = (type, reason) => {
    if (terminating) return;
    terminating = true;
    logger.error("Fatal process error", safeFatalErrorSummary(reason, type));
    schedule(() => exit(1));
    try { close(() => exit(1)); } catch { exit(1); }
  };
  processImpl.once("uncaughtException", (error) => terminate("uncaughtException", error));
  processImpl.once("unhandledRejection", (reason) => terminate("unhandledRejection", reason));
  return terminate;
}
