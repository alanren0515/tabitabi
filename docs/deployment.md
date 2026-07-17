# Production deployment

The app is a single Node.js service that serves the frontend and keeps all provider keys on the server. Production use requires an HTTPS endpoint and a host that can inject environment variables. Do not expose the Node HTTP port directly to pilot or public internet traffic.

## Hosting decision for the first pilot

**Selected host: Fly.io in Tokyo (`nrt`).** Deploy the existing Dockerfile as one continuously running `shared-cpu-1x` Machine with 512 MB RAM, attach a 1 GB Fly Volume at `/app/data`, and keep exactly one Machine. Current list pricing is about USD 3.19/month for the Machine plus USD 0.15/month for the volume when running for a full month. A shared IPv4 address is included and the first ten single-hostname managed certificates are free. This is cheaper than the previous Railway USD 5 minimum while preserving the single-instance and local-volume assumptions.

**Domain decision: use `tabitabi-jp.fly.dev` for the closed pilot.** Fly automatically supplies the app-name-based `fly.dev` hostname and HTTPS. Do not buy a custom domain before the pilot proves value. After 20 live inputs and 10 valid feedback records pass the pilot gate, register a short branded domain and attach it with a Fly-managed certificate.

The checked-in [`fly.toml`](../fly.toml) fixes the production region, one 512 MB Machine, HTTPS redirect, `/readyz` health check and `/app/data` volume mount. The provisional app name is globally scoped; if `tabitabi-jp` is unavailable at creation time, choose the nearest available name and update both `app` and the generated-domain reference in this document.

**Why not Railway or Render for this phase:** Railway's current Hobby minimum is USD 5/month. Render's free web service does not preserve pilot metrics, while a paid web service plus persistent disk costs more than this Fly configuration. Both remain viable fallbacks if Fly capacity or account setup becomes a problem.

Official references checked on 2026-07-17: [Fly.io resource pricing](https://fly.io/docs/about/pricing/) and [Fly.io custom domains](https://fly.io/docs/networking/custom-domain/).

This decision is for the first closed pilot, not a claim that Railway is the permanent production platform. Before public launch, re-evaluate data residency, backup requirements, traffic volume, and whether the local JSONL store should move to shared managed storage.

### Fly.io setup values

- App config: deploy the checked-in `fly.toml` and `Dockerfile`.
- Region: `nrt` (Tokyo).
- Machines: exactly `1`, `shared-cpu-1x`, 512 MB RAM.
- Persistent volume: create `tabitabi_data` as 1 GB in `nrt`; mount at `/app/data`.
- Health check: `/readyz`.
- Public URL: `https://tabitabi-jp.fly.dev` unless the globally unique app name changes.
- Secrets: use `fly secrets set`; never upload `.env.local`.
- Initial cost guardrail: Google quotas at 100 search/detail calls per day and application limits at their current 90-call defaults.

## Required environment variables

- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
- `QWEN_VISION_MODEL=qwen3.6-flash`
- `GOOGLE_MAPS_API_KEY`
- `PORT` when assigned by the host

Optional:

- `OPENAI_API_KEY` for the quality fallback
- `HOTPEPPER_API_KEY` for listing enrichment
- `PILOT_ACCESS_CODE` for a closed pilot; when set, participants enter the same value in Settings and the browser sends it only to protected same-origin APIs
- `TRUST_PROXY=true` only when the service is behind a trusted reverse proxy that overwrites `X-Forwarded-For`

Never copy `.env.local` into an image or commit it. The included `.dockerignore` excludes all local environment files, runtime metrics, screenshots, tests, and development artifacts.

## Build and run

```bash
docker build -t tabitabi .
docker run --rm -p 4173:4173 --env-file .env.local tabitabi
```

Initial Fly deployment, after installing `flyctl` and signing in:

```bash
fly apps create tabitabi-jp --org personal
fly volumes create tabitabi_data --region nrt --size 1
fly secrets set \
  DASHSCOPE_API_KEY=... \
  DASHSCOPE_BASE_URL=https://dashscope-intl.aliyuncs.com/compatible-mode/v1 \
  QWEN_VISION_MODEL=qwen3.6-flash \
  GOOGLE_MAPS_API_KEY=... \
  HOTPEPPER_API_KEY=... \
  PILOT_ACCESS_CODE=...
fly deploy
fly checks list
```

Enter secret values only in the terminal prompt or command invocation on the local machine. Never paste them into a task message, screenshot, committed shell script or deployment log.

The container runs as the unprivileged `node` user. `GET /healthz` is a liveness check. `GET /readyz` returns HTTP 200 only when live screenshot extraction and Google Places are configured; OpenAI fallback and Hot Pepper remain optional and are reported only as booleans. The Docker health check uses `/readyz`, and neither endpoint returns keys.

Unhandled promise rejections and uncaught exceptions are treated as fatal: the service logs only a bounded error type/name/code summary, closes the listener, and exits with status 1. Configure the container platform to restart failed instances and investigate repeated restarts; the process must not continue after an unknown fatal state.

The image creates `/app/data` as a writable directory for privacy-minimized event and provider-health JSONL records. The service enforces a 30-day default retention window plus 50,000-line and 10 MB caps per file, pruning atomically on startup traffic and periodically thereafter. Configure `LOG_RETENTION_DAYS`, `EVENT_LOG_MAX_LINES`, `EVENT_LOG_MAX_BYTES`, `SOURCE_LOG_MAX_LINES`, and `SOURCE_LOG_MAX_BYTES` only when a documented deployment policy requires different limits. Container filesystems are commonly ephemeral; attach a persistent volume only if operational history must survive a restart. The app does not require persistence to serve user requests.

If pilot metrics must survive host loss, back up the complete `data/` volume (including `events.jsonl`, `source-metrics.jsonl`, and `daily-budget.json`) with encrypted, access-controlled volume snapshots. Use the same or shorter retention period as the live data, test restoring to a non-production directory, and preserve ownership for the unprivileged `node` user. Do not selectively merge JSONL files from multiple instances.

Run exactly one application instance for this MVP. Rate limits and request caches are in memory, while the daily budget is a local file; multiple replicas would create independent rate-limit/cache state and unsafe concurrent budget accounting. Horizontal scaling requires shared atomic rate-limit, cache, budget, and event stores before adding replicas.

## Before public traffic

1. Terminate TLS at a trusted hosting-platform proxy and redirect all HTTP traffic to HTTPS. HSTS should be configured at that layer after the production hostname is final.
2. Store keys in the platform secret manager.
   If `PILOT_ACCESS_CODE` is used, generate a long random value and distribute it only to pilot participants. It is a lightweight shared gate, not an account system.
3. Set `TRUST_PROXY=true` only if the service is reachable exclusively through a controlled proxy that removes any client-supplied `X-Forwarded-For` and writes the authoritative client address. Otherwise leave it `false`; trusting an append-only or publicly forgeable header defeats IP rate limits.
4. Confirm Google Places daily quotas remain at 100 Text Search and 100 Place Details requests.
   The application defaults `DAILY_PLACES_SEARCH_LIMIT` and `DAILY_PLACES_DETAILS_LIMIT` to 90, leaving ten console-quota calls for diagnosis. `DAILY_VISION_REQUEST_LIMIT` also defaults to 90. Counters persist in `/app/data/daily-budget.json`, reset on the next Tokyo calendar day, and are consumed only before an upstream call; Places cache hits do not consume another application-budget unit.
5. Add a stable production egress IP restriction to the Google key when the host provides one.
6. Review provider dashboards after the first real users and lower rate limits if abuse appears.
7. Keep outbound DNS and HTTP egress controls enabled. The public-webpage endpoint rejects private/reserved DNS results, unsafe redirects, non-HTML responses, and bodies over 512 KB, but production network policy should remain the final SSRF boundary.

## Browser security boundary

The Node service sends one shared security-header policy on static and API responses. Its Content Security Policy permits only same-origin scripts, styles, fonts, workers and API requests, plus the required Hot Pepper attribution image. It blocks framing, plugins, camera, microphone, geolocation and browser payment access. Configure HSTS at the HTTPS termination layer rather than in this HTTP-aware application process.

Static serving uses an explicit application-shell allowlist: the two HTML/PWA entry files, `sw.js`, approved `assets/` image types, and flat JavaScript/CSS modules under `src/`. Repository files such as `.env.local`, `server/`, `eval/`, `output/`, tests and documentation are never exposed through a fallback file path, even during local or LAN audit mode.

## PWA cache boundary

Serve production traffic over HTTPS so the browser can register `sw.js`. The service worker pre-caches only the static application shell and bypasses `/api`, cross-origin requests, restaurant data, share-query values, and third-party responses. Increment `CACHE_NAME` in `sw.js` whenever a deployed shell change must invalidate an earlier cache. Offline users can open the shell and local browser data, but new restaurant analysis intentionally remains unavailable until connectivity returns.
