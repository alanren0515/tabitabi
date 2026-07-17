# Production deployment

The app is a single Node.js service that serves the frontend and keeps all provider keys on the server. Production use requires an HTTPS endpoint and a host that can inject environment variables. Do not expose the Node HTTP port directly to pilot or public internet traffic.

## Hosting decision for the first pilot

**Selected host: Fly.io in Tokyo (`nrt`).** Deploy the existing Dockerfile as one `shared-cpu-1x` Machine with 512 MB RAM, attach a 1 GB Fly Volume at `/app/data`, and keep exactly one Machine. The Machine automatically stops when idle and starts on the next request. Fly.io does not charge CPU or RAM while it is stopped; a full month of continuously running Tokyo compute is approximately USD 4.18. The 1 GB volume is USD 0.15/month, and a stopped Machine's root filesystem is also billed by provisioned GB, so the idle fixed cost is not only the volume charge. Snapshots and outbound traffic can add usage charges. This remains below Railway's USD 5 minimum only when actual running time is limited by autostop.

**Domain decision: use `tabitabi-jp.fly.dev` for the closed pilot.** Fly automatically supplies the app-name-based `fly.dev` hostname and HTTPS. Do not buy a custom domain before the pilot proves value. After 20 live inputs and 10 valid feedback records pass the pilot gate, register a short branded domain and attach it with a Fly-managed certificate.

The checked-in [`fly.toml`](../fly.toml) fixes the production region, one 512 MB Machine, idle autostop with request-driven autostart, HTTPS redirect, `/readyz` health check and `/app/data` volume mount. The first request after an idle period may experience a short cold start. The provisional app name is globally scoped; if `tabitabi-jp` is unavailable at creation time, choose the nearest available name and update both `app` and the generated-domain reference in this document.

**Why not Railway or Render for this phase:** Railway's current Hobby minimum is USD 5/month. Render's free web service does not preserve pilot metrics, while a paid web service plus persistent disk costs more than this Fly configuration. Both remain viable fallbacks if Fly capacity or account setup becomes a problem.

Official references checked on 2026-07-17: [Fly.io resource pricing](https://fly.io/docs/about/pricing/) and [Fly.io custom domains](https://fly.io/docs/networking/custom-domain/).

This decision is for the first closed pilot, not a claim that Railway is the permanent production platform. Before public launch, re-evaluate data residency, backup requirements, traffic volume, and whether the local JSONL store should move to shared managed storage.

### Fly.io setup values

- App config: deploy the checked-in `fly.toml` and `Dockerfile`.
- Region: `nrt` (Tokyo).
- Machines: exactly `1`, `shared-cpu-1x`, 512 MB RAM.
- Idle policy: stop the Machine when idle, keep zero Machines permanently running, and automatically start it on the next request.
- Persistent volume: create `tabitabi_data` as 1 GB in `nrt`; mount at `/app/data`.
- Snapshots: daily automatic snapshots retained for 7 days; verify with `fly volumes snapshots list <volume-id>` after deployment.
- Health check: `/readyz`.
- Public URL: `https://tabitabi-jp.fly.dev` unless the globally unique app name changes.
- Secrets: use `fly secrets set`; never upload `.env.local`.
- Initial cost guardrail: Google quotas at 100 search/detail calls per day; application limits are 90 search/detail calls, 60 new vision analyses, 60 Qwen attempts and 10 OpenAI fallback attempts per Tokyo day.

## Required environment variables

- `DASHSCOPE_API_KEY`
- `DASHSCOPE_BASE_URL`
- `QWEN_VISION_MODEL=qwen3.6-flash`
- `GOOGLE_MAPS_API_KEY`
- `PILOT_ACCESS_CODE`
- `PUBLIC_OPERATOR_NAME`
- `PUBLIC_CONTACT_EMAIL`
- `PORT` when assigned by the host

Optional:

- `OPENAI_API_KEY` for the quality fallback
- `HOTPEPPER_API_KEY` for listing enrichment
- `TRUST_PROXY=true` only when the service is behind a trusted reverse proxy that overwrites `X-Forwarded-For`

Never copy `.env.local` into an image or commit it. The included `.dockerignore` excludes all local environment files, runtime metrics, screenshots, tests, and development artifacts.

## Build and run

```bash
docker build -t tabitabi .
docker run --rm -p 4173:4173 --env-file .env.local tabitabi
```

Before creating or changing any paid Fly resource, run the local release preflight:

```bash
npm run release:preflight
```

The command checks required configuration, provider budget caps, Fly's checked-in Tokyo/idle lifecycle/VM/HTTPS/health/volume/snapshot settings, the pinned container base and the current release evidence. It prints only boolean check names and repair hints, never secret values. This is a static local check: it cannot prove the remote Machine or Volume count. A failure is a hard stop for deployment.

Initial Fly deployment, after installing `flyctl` and signing in:

```bash
openssl rand -base64 32
fly apps create tabitabi-jp --org personal
fly volumes create tabitabi_data --region nrt --size 1
fly secrets import --stage -a tabitabi-jp
# Paste NAME=value lines for the required variables, then press Control-D.
fly deploy --ha=false
fly scale count 1 -a tabitabi-jp
fly machine list -a tabitabi-jp
fly volumes list -a tabitabi-jp
fly checks list
```

Do not continue until `fly machine list` shows exactly one Tokyo Machine with the configured 512 MB shape and `fly volumes list` shows exactly one Tokyo `tabitabi_data` Volume. This remote-state check is a hard gate because local `fly.toml` cannot prove existing Fly resources.

After the Machine has started and the health check is passing, run the read-only automated equivalent:

```bash
npm run release:fly-audit
```

It reads only Fly's JSON status output and fails unless there is exactly one started `nrt` shared 1-CPU/512 MB Machine, exactly one created 1 GB `tabitabi_data` Volume attached and mounted at `/app/data` with scheduled snapshots retained for 7 days, and every health check belongs to that Machine and is passing. Warning or missing fields fail closed. It never creates, scales, restarts or deletes resources. A passing remote audit does not replace the direct provider-free `/readyz` smoke because Fly's reported check timestamp can be stale.

After deployment, first run the provider-free smoke test. It checks liveness, readiness, capabilities, privacy and terms without calling Qwen or Google Places. It can wake an auto-stopped Fly Machine and therefore may incur a small amount of Fly compute/network usage:

```bash
TABITABI_BASE_URL=https://tabitabi-jp.fly.dev npm run release:smoke
```

Then run one explicitly authorized live provider smoke with a non-private test screenshot. This consumes one Qwen request, one Google Places Text Search request and one Place Details request:

```bash
TABITABI_BASE_URL=https://tabitabi-jp.fly.dev \
SMOKE_LIVE=true \
SMOKE_SCREENSHOT_PATH=/absolute/path/to/test.png \
npm run release:smoke
```

`TABITABI_BASE_URL` is mandatory and must exactly match the `fly.dev` origin derived from the committed `app` value in `fly.toml`; arbitrary origin overrides and redirects are rejected. If the globally unique app name changes, update and review `fly.toml` before running the smoke test. The script reads `PILOT_ACCESS_CODE` from the process environment or local `.env.local`, sends it only to protected same-origin endpoints, and never prints the code or screenshot contents. Do not run the live smoke repeatedly; if the daily application budget is already exhausted, wait for the next Tokyo calendar day.

Use the random output as `PILOT_ACCESS_CODE`; production readiness rejects codes shorter than 24 characters. Do not reuse an account password. Before inviting users, restore the latest volume snapshot to a temporary replacement volume once and verify the JSONL files are readable; this is a recovery drill, not a second continuously billed Machine.

Use `fly secrets import` through standard input so secret values do not become shell-history command arguments. Never paste them into a task message, screenshot, committed shell script or deployment log. The first deploy must use `--ha=false`; Fly can otherwise create two Machines by default. After every deploy, verify `fly machine list` still shows exactly one Machine.

The container runs as the unprivileged `node` user. `GET /healthz` is a liveness check. In production, `GET /readyz` returns HTTP 200 only when live screenshot extraction, Google Places, the invite access code, public operator name, and public contact email are configured; OpenAI fallback and Hot Pepper remain optional and are reported only as booleans. The Docker health check uses `/readyz`, and neither endpoint returns keys.

Unhandled promise rejections and uncaught exceptions are treated as fatal: the service logs only a bounded error type/name/code summary, closes the listener, and exits with status 1. Configure the container platform to restart failed instances and investigate repeated restarts; the process must not continue after an unknown fatal state.

The image creates `/app/data` as a writable directory for privacy-minimized event and provider-health JSONL records. The service enforces a 30-day default retention window plus 50,000-line and 10 MB caps per file, pruning atomically on startup traffic and periodically thereafter. Configure `LOG_RETENTION_DAYS`, `EVENT_LOG_MAX_LINES`, `EVENT_LOG_MAX_BYTES`, `SOURCE_LOG_MAX_LINES`, and `SOURCE_LOG_MAX_BYTES` only when a documented deployment policy requires different limits. Container filesystems are commonly ephemeral; attach a persistent volume only if operational history must survive a restart. The app does not require persistence to serve user requests.

If pilot metrics must survive host loss, back up the complete `data/` volume (including `events.jsonl`, `source-metrics.jsonl`, and `daily-budget.json`) with encrypted, access-controlled volume snapshots. Use the same or shorter retention period as the live data, test restoring to a non-production directory, and preserve ownership for the unprivileged `node` user. Do not selectively merge JSONL files from multiple instances.

Run exactly one application instance for this MVP. Rate limits and request caches are in memory, while the daily budget is a local file; multiple replicas would create independent rate-limit/cache state and unsafe concurrent budget accounting. Horizontal scaling requires shared atomic rate-limit, cache, budget, and event stores before adding replicas.

## Before public traffic

1. Terminate TLS at a trusted hosting-platform proxy and redirect all HTTP traffic to HTTPS. HSTS should be configured at that layer after the production hostname is final.
2. Store keys in the platform secret manager.
   If `PILOT_ACCESS_CODE` is used, generate a long random value and distribute it only to pilot participants. It is a lightweight shared gate, not an account system.
3. Fly.io deployments use the Fly Proxy-provided `Fly-Client-IP` header. Set `TRUST_PROXY=true` on other hosts only if the service is reachable exclusively through a controlled proxy that removes any client-supplied `X-Forwarded-For` and writes the authoritative client address. Otherwise leave it `false`; trusting an append-only or publicly forgeable header defeats IP rate limits.
4. Confirm Google Places daily quotas remain at 100 Text Search and 100 Place Details requests.
   The application defaults `DAILY_PLACES_SEARCH_LIMIT` and `DAILY_PLACES_DETAILS_LIMIT` to 90, leaving ten console-quota calls for diagnosis. Vision is separately capped at `DAILY_VISION_REQUEST_LIMIT=60`, `DAILY_QWEN_ATTEMPT_LIMIT=60`, and `DAILY_OPENAI_FALLBACK_LIMIT=10`. Counters persist in `/app/data/daily-budget.json`, reset on the next Tokyo calendar day, and are consumed only before an upstream call. Exact-image and Places cache hits do not consume another provider budget unit. Deployment preflight fails if any ceiling is raised beyond the reviewed maximum.

   In addition, a client may submit at most four screenshot analyses per minute and twenty per true rolling 24 hours. At most four screenshot bodies may be received and decoded concurrently, and only two uncached model jobs may run concurrently. Identical decoded image bytes share a ten-minute in-memory result cache and concurrent duplicates are coalesced. Images over 8 MB, 20 million pixels, or 10,000 px on either edge are rejected before a provider call. Model output defaults to 1,200 tokens and cannot exceed 1,800 through environment configuration. A corrupt daily-budget file fails closed and stops new paid calls until it is repaired.
5. Add a stable production egress IP restriction to the Google key when the host provides one.
6. Review provider dashboards after the first real users and lower rate limits if abuse appears.
7. Keep outbound DNS and HTTP egress controls enabled. The public-webpage endpoint rejects private/reserved DNS results, unsafe redirects, non-HTML responses, and bodies over 512 KB, but production network policy should remain the final SSRF boundary.

## Browser security boundary

The Node service sends one shared security-header policy on static and API responses. Its Content Security Policy permits only same-origin scripts, styles, fonts, workers and API requests, plus the required Hot Pepper attribution image. It blocks framing, plugins, camera, microphone, geolocation and browser payment access. Configure HSTS at the HTTPS termination layer rather than in this HTTP-aware application process.

Static serving uses an explicit application-shell allowlist: the two HTML/PWA entry files, `sw.js`, approved `assets/` image types, and flat JavaScript/CSS modules under `src/`. Repository files such as `.env.local`, `server/`, `eval/`, `output/`, tests and documentation are never exposed through a fallback file path, even during local or LAN audit mode.

## PWA cache boundary

Serve production traffic over HTTPS so the browser can register `sw.js`. The service worker pre-caches only the static application shell and bypasses `/api`, cross-origin requests, restaurant data, share-query values, and third-party responses. Increment `CACHE_NAME` in `sw.js` whenever a deployed shell change must invalidate an earlier cache. Offline users can open the shell and local browser data, but new restaurant analysis intentionally remains unavailable until connectivity returns.
