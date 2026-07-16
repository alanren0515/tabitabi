# Production deployment

The app is a single Node.js service that serves the frontend and keeps all provider keys on the server. It can run on any container host that supports HTTPS and environment variables.

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

The container runs as the unprivileged `node` user. `GET /healthz` is a liveness check. `GET /readyz` returns HTTP 200 only when live screenshot extraction and Google Places are configured; OpenAI fallback and Hot Pepper remain optional and are reported only as booleans. The Docker health check uses `/readyz`, and neither endpoint returns keys.

The image creates `/app/data` as a writable directory for privacy-minimized event and provider-health JSONL records. The service enforces a 30-day default retention window plus 50,000-line and 10 MB caps per file, pruning atomically on startup traffic and periodically thereafter. Configure `LOG_RETENTION_DAYS`, `EVENT_LOG_MAX_LINES`, `EVENT_LOG_MAX_BYTES`, `SOURCE_LOG_MAX_LINES`, and `SOURCE_LOG_MAX_BYTES` only when a documented deployment policy requires different limits. Container filesystems are commonly ephemeral; attach a persistent volume only if operational history must survive a restart. The app does not require persistence to serve user requests.

## Before public traffic

1. Terminate TLS at the hosting platform.
2. Store keys in the platform secret manager.
   If `PILOT_ACCESS_CODE` is used, generate a long random value and distribute it only to pilot participants. It is a lightweight shared gate, not an account system.
3. Set `TRUST_PROXY=true` only if the proxy is controlled by the hosting platform.
4. Confirm Google Places daily quotas remain at 100 Text Search and 100 Place Details requests.
   The application defaults `DAILY_PLACES_SEARCH_LIMIT` and `DAILY_PLACES_DETAILS_LIMIT` to 90, leaving ten console-quota calls for diagnosis. `DAILY_VISION_REQUEST_LIMIT` also defaults to 90. Counters persist in `/app/data/daily-budget.json`, reset on the next Tokyo calendar day, and are consumed only before an upstream call; Places cache hits do not consume another application-budget unit.
5. Add a stable production egress IP restriction to the Google key when the host provides one.
6. Review provider dashboards after the first real users and lower rate limits if abuse appears.
7. Keep outbound DNS and HTTP egress controls enabled. The public-webpage endpoint rejects private/reserved DNS results, unsafe redirects, non-HTML responses, and bodies over 512 KB, but production network policy should remain the final SSRF boundary.

## Browser security boundary

The Node service sends one shared security-header policy on static and API responses. Its Content Security Policy permits only same-origin scripts, workers and API requests, plus Google Fonts and the required Hot Pepper attribution image. It blocks framing, plugins, camera, microphone, geolocation and browser payment access. Configure HSTS at the HTTPS termination layer rather than in this HTTP-aware application process.

Static serving uses an explicit application-shell allowlist: the two HTML/PWA entry files, `sw.js`, approved `assets/` image types, and flat JavaScript/CSS modules under `src/`. Repository files such as `.env.local`, `server/`, `eval/`, `output/`, tests and documentation are never exposed through a fallback file path, even during local or LAN audit mode.

## PWA cache boundary

Serve production traffic over HTTPS so the browser can register `sw.js`. The service worker pre-caches only the static application shell and bypasses `/api`, cross-origin requests, restaurant data, share-query values, and third-party responses. Increment `CACHE_NAME` in `sw.js` whenever a deployed shell change must invalidate an earlier cache. Offline users can open the shell and local browser data, but new restaurant analysis intentionally remains unavailable until connectivity returns.
