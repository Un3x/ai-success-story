const KNOWN_ROUTES = new Set([
  '/',
  '/post/:slug/',
  '/post/:slug.md',
  '/post/:slug',
  '/mcp',
  '/.well-known/ai-success-story.json',
  '/docs/format-spec',
  '/docs/format-spec.md',
  '/docs/consumer-api-spec',
  '/docs/consumer-api-spec.md',
  '/privacy',
  '/privacy.md',
  '/agents.md',
  '/AGENTS.md',
  '/stats',
]);

const MCP_UA_PATTERNS = ['claude-user', 'anthropic', 'mcp', 'modelcontextprotocol'];
const BOT_UA_PATTERNS = [
  'bot',
  'crawler',
  'spider',
  'curl',
  'wget',
  'headlesschrome',
  'slackbot',
  'facebookexternalhit',
  'discordbot',
];

function classifyUa(uaString, routePath) {
  if (routePath === '/mcp') return 'mcp-client';
  if (typeof uaString !== 'string' || uaString.length === 0) return 'other';
  const ua = uaString.toLowerCase();
  for (const p of MCP_UA_PATTERNS) {
    if (ua.includes(p)) return 'mcp-client';
  }
  for (const p of BOT_UA_PATTERNS) {
    if (ua.includes(p)) return 'bot';
  }
  if (ua.includes('mozilla/')) return 'browser';
  return 'other';
}

function classifyRoute(req) {
  const matched = req && req.route && typeof req.route.path === 'string' ? req.route.path : null;
  if (matched && KNOWN_ROUTES.has(matched)) return matched;
  if (matched === '/mcp') return '/mcp';
  if (req && req.baseUrl === '/mcp') return '/mcp';
  return 'other';
}

function emptySnapshotPayload({ since, snapshotKey }) {
  return {
    version: 'v0',
    snapshot_key: snapshotKey,
    window: {
      since,
      now: since,
      last_persisted_at: null,
      last_persist_failed_at: null,
    },
    http: {
      by_route: {},
      by_ua_bucket: {},
    },
    mcp: {
      by_tool: {},
      total_calls: 0,
    },
  };
}

function defaultFetchSnapshot({ owner, repo, branch, snapshotKey }) {
  if (!owner || !repo) return async () => null;
  const url = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch || 'main')}/${snapshotKey.split('/').map(encodeURIComponent).join('/')}`;
  return async function fetchSnapshot() {
    const res = await fetch(url, { headers: { 'User-Agent': 'ai-success-story-webapp' } });
    if (!res.ok) {
      throw new Error(`fetch snapshot ${res.status}`);
    }
    const text = await res.text();
    return JSON.parse(text);
  };
}

function createTelemetry({
  githubCommit,
  fetchSnapshot,
  now,
  snapshotKey = 'telemetry/usage-v0.json',
  flushIntervalMs,
  flushMutationCeiling,
  logger,
} = {}) {
  const _now = typeof now === 'function' ? now : () => new Date();
  const _logger = logger || console;
  const INTERVAL_MS = typeof flushIntervalMs === 'number'
    ? flushIntervalMs
    : (parseInt(process.env.TELEMETRY_FLUSH_INTERVAL_MS, 10) || 5 * 60 * 1000);
  const CEILING = typeof flushMutationCeiling === 'number'
    ? flushMutationCeiling
    : (parseInt(process.env.TELEMETRY_FLUSH_MUTATION_CEILING, 10) || 50);

  const bootIso = _now().toISOString();
  let state = emptySnapshotPayload({ since: bootIso, snapshotKey });

  let mutationsSinceFlush = 0;
  let lastFlushAt = Date.now();
  let flushInFlight = null;
  let resumed = false;

  async function resumeFromRepo() {
    if (typeof fetchSnapshot !== 'function') {
      resumed = true;
      return;
    }
    try {
      const remote = await fetchSnapshot();
      if (remote && remote.version === 'v0' && remote.http && remote.mcp) {
        state = {
          version: 'v0',
          snapshot_key: snapshotKey,
          window: {
            since: (remote.window && remote.window.since) || bootIso,
            now: bootIso,
            last_persisted_at: (remote.window && remote.window.last_persisted_at) || null,
            last_persist_failed_at: (remote.window && remote.window.last_persist_failed_at) || null,
          },
          http: {
            by_route: { ...(remote.http.by_route || {}) },
            by_ua_bucket: { ...(remote.http.by_ua_bucket || {}) },
          },
          mcp: {
            by_tool: { ...(remote.mcp.by_tool || {}) },
            total_calls: typeof remote.mcp.total_calls === 'number' ? remote.mcp.total_calls : 0,
          },
        };
      }
    } catch (e) {
      _logger.warn(`telemetry: cold-start fetch failed (${e && e.message ? e.message : e}); starting from zero`);
    }
    resumed = true;
  }

  function recordHttp({ route, method, status, uaBucket }) {
    const r = typeof route === 'string' && route.length > 0 ? route : 'other';
    const m = typeof method === 'string' ? method : 'GET';
    const s = String(status || 0);
    const bucket = typeof uaBucket === 'string' && uaBucket.length > 0 ? uaBucket : 'other';
    const key = `${m} ${r}`;
    const byRoute = state.http.by_route;
    if (!byRoute[key]) byRoute[key] = {};
    byRoute[key][s] = (byRoute[key][s] || 0) + 1;
    const byUa = state.http.by_ua_bucket;
    byUa[bucket] = (byUa[bucket] || 0) + 1;
    mutationsSinceFlush += 1;
  }

  function recordMcpCall({ tool, ok }) {
    const t = typeof tool === 'string' && tool.length > 0 ? tool : 'unknown';
    const byTool = state.mcp.by_tool;
    if (!byTool[t]) byTool[t] = { ok: 0, err: 0 };
    if (ok) byTool[t].ok += 1; else byTool[t].err += 1;
    state.mcp.total_calls += 1;
    mutationsSinceFlush += 1;
  }

  function snapshot() {
    state.window.now = _now().toISOString();
    return {
      version: state.version,
      snapshot_key: state.snapshot_key,
      window: { ...state.window },
      http: {
        by_route: { ...state.http.by_route },
        by_ua_bucket: { ...state.http.by_ua_bucket },
      },
      mcp: {
        by_tool: { ...state.mcp.by_tool },
        total_calls: state.mcp.total_calls,
      },
    };
  }

  function isDue() {
    if (mutationsSinceFlush <= 0) return false;
    if (mutationsSinceFlush >= CEILING) return true;
    const elapsed = Date.now() - lastFlushAt;
    return elapsed >= INTERVAL_MS;
  }

  async function performFlush() {
    if (typeof githubCommit !== 'function') {
      mutationsSinceFlush = 0;
      lastFlushAt = Date.now();
      return { ok: false, error: 'no_committer' };
    }
    const payload = snapshot();
    payload.window.last_persisted_at = _now().toISOString();
    const content = `${JSON.stringify(payload, null, 2)}\n`;
    const message = `telemetry: usage snapshot ${payload.window.last_persisted_at}`;
    const mutationsAtAttempt = mutationsSinceFlush;
    try {
      const res = await githubCommit({ path: snapshotKey, content, message });
      state.window.last_persisted_at = payload.window.last_persisted_at;
      state.window.last_persist_failed_at = null;
      mutationsSinceFlush = Math.max(0, mutationsSinceFlush - mutationsAtAttempt);
      lastFlushAt = Date.now();
      return { ok: true, sha: res && res.sha };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      _logger.warn(`telemetry: flush failed path=${snapshotKey} mutations=${mutationsAtAttempt} err=${msg}`);
      state.window.last_persist_failed_at = _now().toISOString();
      mutationsSinceFlush = Math.max(0, mutationsSinceFlush - mutationsAtAttempt);
      lastFlushAt = Date.now();
      return { ok: false, error: msg };
    }
  }

  function flushIfDue() {
    if (!resumed) return Promise.resolve({ ok: false, error: 'not_resumed' });
    if (flushInFlight) return flushInFlight;
    if (!isDue()) return Promise.resolve({ ok: true, skipped: true });
    flushInFlight = performFlush().finally(() => { flushInFlight = null; });
    return flushInFlight;
  }

  async function shutdownFlush() {
    if (flushInFlight) {
      try { await flushInFlight; } catch (_) { /* noop */ }
    }
    if (mutationsSinceFlush <= 0) return { ok: true, skipped: true };
    flushInFlight = performFlush().finally(() => { flushInFlight = null; });
    return flushInFlight;
  }

  const ready = resumeFromRepo();

  return {
    recordHttp,
    recordMcpCall,
    snapshot,
    flushIfDue,
    shutdownFlush,
    ready,
    _internal: { isDue: () => isDue(), state: () => state },
  };
}

module.exports = {
  createTelemetry,
  classifyUa,
  classifyRoute,
  defaultFetchSnapshot,
};
