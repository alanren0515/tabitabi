import { classifyFlyCliError } from "./fly-cli-runtime.mjs";

export function buildRemotePilotFailureEvidence({ app, revision, repositoryClean, error, now = new Date() }) {
  const failure = classifyFlyCliError(error, { remotePilot: true });
  return {
    schemaVersion: 2,
    source: "fly-audit-error",
    generatedAt: now.toISOString(),
    app,
    auditRevision: revision,
    repositoryClean,
    gatePassed: false,
    errorCategory: failure.category,
    error: failure.message
  };
}
