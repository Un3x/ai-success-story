# BASELINE — AI-success-story usage instrumentation

## Day-1 state

- **Date of first deploy carrying P4.T1 instrumentation**: 2026-05-20
- **Commit SHA**: _filled at commit time; see git log for `telemetry: ...` commit_
- **Persisted state file**: `telemetry/usage-v0.json`
- **Initial counter values**: all zero (forward-only — see Backfill note)

## What is measured

### HTTP routes

- `/` — homepage HTML index
- `/post/:slug/` — article HTML
- `/post/:slug.md` — raw Markdown
- `/post/:slug` — 301 redirect to trailing slash (counted separately)
- `/mcp` — MCP Streamable HTTP endpoint (all methods)
- `/.well-known/ai-success-story.json` — discovery manifest
- `/docs/format-spec`, `/docs/format-spec.md`, `/docs/consumer-api-spec`, `/docs/consumer-api-spec.md` — spec docs
- `/stats` — this endpoint (self-measured)
- `other` — 404s and unmatched routes

Per-route counters are keyed `METHOD ROUTE` (e.g. `GET /post/:slug/`) and bucketed by HTTP status code.

### MCP tool calls

- `search_stories`, `fetch_story` (consumer surface)
- `submit_story`, `submission_status` (publish surface)
- `list_pending`, `approve_pending`, `reject_pending` (admin)
- Each tool tracked as `{ ok, err }` pair (`err` = handler returned `isError: true` or threw).
- **MCP protocol/discovery methods (`tools/list`, `resources/list`, `initialize`, etc.) are NOT counted in `mcp.by_tool`.** Only `tools/call` invocations of the registered tools above increment the counters. Discovery hits still register as `POST /mcp` in `http.by_route` (so the route counter is a superset of the tool counter).

### UA buckets

- `mcp-client` — UA contains `Claude-User`, `Anthropic`, `mcp`, `ModelContextProtocol`, OR the request matched `/mcp`
- `browser` — UA contains `Mozilla/`
- `bot` — UA contains `bot`, `crawler`, `spider`, `curl`, `wget`, `HeadlessChrome`, `Slackbot`, `facebookexternalhit`, `Discordbot`
- `other` — empty UA, anything unmatched

## What is NOT measured (privacy floor)

- No query strings, no MCP tool arguments, no request bodies
- No IPs (not even hashed)
- No cookies, no fingerprinting
- No raw UA strings (only the bucket label is persisted)
- Route classification uses the matched Express pattern (`req.route.path`), not `req.url` / `req.originalUrl`, so user-supplied path segments and query strings cannot leak into the snapshot

## Persistence + flush cadence

- Snapshot lives at `telemetry/usage-v0.json` in this repo, committed via the GitHub Contents API (same path as the publish pipeline).
- Flush fires when **either** ≥ 5 minutes since last flush AND ≥ 1 mutation, **or** ≥ 50 mutations since last flush. Plus best-effort flush on SIGTERM.
- Tunable via `TELEMETRY_FLUSH_INTERVAL_MS` and `TELEMETRY_FLUSH_MUTATION_CEILING` env vars.
- On boot, the process fetches the snapshot from `raw.githubusercontent.com` and resumes counts. Network/parse failure logs a warning and falls back to zero — boot is never blocked.

## How to read `/stats`

```
curl -H "X-AISS-Stats-Token: $AISS_STATS_TOKEN" https://<deployment>/stats
```

- Missing header / wrong header → 401.
- `AISS_STATS_TOKEN` env var unset on the deployment → 503 (endpoint disabled).
- Returns JSON; no HTML view (by design — keeps the surface narrow).

## Known limitations

1. **UA bucketing is coarse.** Bots with browser-style UAs land in `browser`. Headless Chromium without the `HeadlessChrome` token leaks into `browser`. Acceptable for trend-lines; not for fraud detection.
2. **Up to 5 minutes of counters can be lost on an unexpected crash** (SIGTERM flush handles graceful Heroku restarts).
3. **`/post/:slug` (no trailing slash) counts only the redirect hop**; the destination is a separate inbound to `/post/:slug/`.
4. **Backfill: forward-only.** No mining of Logplex history (Heroku retains ~1500 lines / 1 week — too lossy to baseline against).
5. **A failed GitHub commit drops that flush window's mutations from the persistent snapshot** but the in-memory counters keep growing; the next successful flush captures everything since the last successful one. A long network outage paired with a dyno restart loses the unsaved window — accepted at prototype scale.
6. **Flush failures reset the cadence trigger** (`mutationsSinceFlush` and `lastFlushAt`) so a sustained failure does not produce one PUT attempt per request. Worst case the snapshot stops landing for `flushIntervalMs` × N cycles. Single `warn` log per failure makes this externally visible.

## Operational env vars

| Var | Purpose | Required? |
|---|---|---|
| `AISS_STATS_TOKEN` | Bearer token for `GET /stats` | Yes, to enable the endpoint |
| `AISS_GITHUB_PAT` | Shared with the publish pipeline; used to commit the snapshot | Yes, to enable persistence |
| `AISS_GITHUB_OWNER`, `AISS_GITHUB_REPO`, `AISS_GITHUB_BRANCH` | Snapshot commit target | Defaults to `Un3x/ai-success-story@main` |
| `AISS_TELEMETRY_SNAPSHOT_KEY` | Path of the snapshot file in-repo | Default `telemetry/usage-v0.json` |
| `TELEMETRY_FLUSH_INTERVAL_MS` | Flush time floor in ms | Default 300000 (5 min) |
| `TELEMETRY_FLUSH_MUTATION_CEILING` | Flush burst ceiling | Default 50 |
