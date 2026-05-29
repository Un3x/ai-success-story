const test = require('node:test');
const assert = require('node:assert/strict');

const { createTelemetry, classifyUa, classifyRoute, defaultFetchSnapshot } = require('../lib/telemetry.js');

const silentLogger = { warn: () => {}, error: () => {}, log: () => {} };

test('classifyUa returns mcp-client for /mcp route regardless of UA', () => {
  assert.equal(classifyUa('Mozilla/5.0', '/mcp'), 'mcp-client');
  assert.equal(classifyUa('', '/mcp'), 'mcp-client');
});

test('classifyUa buckets known UA patterns', () => {
  assert.equal(classifyUa('Claude-User/1.0', '/'), 'mcp-client');
  assert.equal(classifyUa('anthropic-mcp-cli', '/'), 'mcp-client');
  assert.equal(classifyUa('Googlebot/2.1', '/'), 'bot');
  assert.equal(classifyUa('curl/8.0', '/'), 'bot');
  assert.equal(classifyUa('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', '/'), 'browser');
  assert.equal(classifyUa('weird-thing/1', '/'), 'other');
  assert.equal(classifyUa('', '/'), 'other');
  assert.equal(classifyUa(undefined, '/'), 'other');
});

test('classifyRoute uses req.route.path for known routes; others fall back to "other"', () => {
  assert.equal(classifyRoute({ route: { path: '/' } }), '/');
  assert.equal(classifyRoute({ route: { path: '/post/:slug/' } }), '/post/:slug/');
  assert.equal(classifyRoute({ route: { path: '/post/:slug.md' } }), '/post/:slug.md');
  assert.equal(classifyRoute({ route: { path: '/stats' } }), '/stats');
  assert.equal(classifyRoute({ route: { path: '/unknown-thing' } }), 'other');
  assert.equal(classifyRoute({}), 'other');
  assert.equal(classifyRoute({ baseUrl: '/mcp' }), '/mcp');
});

test('recordHttp + recordMcpCall increment counters as expected', async () => {
  const telemetry = createTelemetry({ logger: silentLogger });
  await telemetry.ready;
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  telemetry.recordHttp({ route: '/post/:slug/', method: 'GET', status: 404, uaBucket: 'bot' });
  telemetry.recordMcpCall({ tool: 'search_stories', ok: true });
  telemetry.recordMcpCall({ tool: 'search_stories', ok: false });
  telemetry.recordMcpCall({ tool: 'fetch_story', ok: true });

  const snap = telemetry.snapshot();
  assert.equal(snap.http.by_route['GET /']['200'], 2);
  assert.equal(snap.http.by_route['GET /post/:slug/']['404'], 1);
  assert.equal(snap.http.by_ua_bucket.browser, 2);
  assert.equal(snap.http.by_ua_bucket.bot, 1);
  assert.equal(snap.mcp.by_tool.search_stories.ok, 1);
  assert.equal(snap.mcp.by_tool.search_stories.err, 1);
  assert.equal(snap.mcp.by_tool.fetch_story.ok, 1);
  assert.equal(snap.mcp.total_calls, 3);
});

test('recordMcpCall buckets by_caller: internal marker → internal, unmarked → unattributed', async () => {
  const telemetry = createTelemetry({ logger: silentLogger });
  await telemetry.ready;
  telemetry.recordMcpCall({ tool: 'search_stories', ok: true, caller: 'internal' });
  telemetry.recordMcpCall({ tool: 'search_stories', ok: false, caller: 'internal' });
  telemetry.recordMcpCall({ tool: 'search_stories', ok: true });
  telemetry.recordMcpCall({ tool: 'search_stories', ok: true, caller: 'external' });

  const snap = telemetry.snapshot();
  const t = snap.mcp.by_tool.search_stories;
  // Flat ok/err totals stay intact (aggregate of all buckets) so /stats and the
  // AI-49 historical cumulative read are unaffected.
  assert.equal(t.ok, 3);
  assert.equal(t.err, 1);
  // internal marker buckets as internal.
  assert.equal(t.by_caller.internal.ok, 1);
  assert.equal(t.by_caller.internal.err, 1);
  // Absent marker AND any non-"internal" value both bucket as unattributed
  // (never "external" — we can only prove internal; see Amendment 1).
  assert.equal(t.by_caller.unattributed.ok, 2);
  assert.equal(t.by_caller.unattributed.err, 0);
  // The "external" label must not appear anywhere in the data.
  assert.ok(!('external' in t.by_caller));
});

test('by_caller survives cold-start resume round-trip and stays additive', async () => {
  const remote = {
    version: 'v0',
    snapshot_key: 'telemetry/usage-v0.json',
    window: { since: '2026-05-01T00:00:00.000Z', now: '2026-05-19T00:00:00.000Z', last_persisted_at: '2026-05-19T00:00:00.000Z' },
    http: { by_route: {}, by_ua_bucket: {} },
    mcp: {
      by_tool: {
        search_stories: { ok: 5, err: 0, by_caller: { internal: { ok: 3, err: 0 }, unattributed: { ok: 2, err: 0 } } },
      },
      total_calls: 5,
    },
  };
  const fetchSnapshot = async () => remote;
  const telemetry = createTelemetry({ fetchSnapshot, logger: silentLogger });
  await telemetry.ready;
  // Resumed buckets are preserved.
  assert.equal(telemetry.snapshot().mcp.by_tool.search_stories.by_caller.internal.ok, 3);
  // A new post-resume call increments both flat and bucketed counters.
  telemetry.recordMcpCall({ tool: 'search_stories', ok: true, caller: 'internal' });
  const snap = telemetry.snapshot();
  assert.equal(snap.mcp.by_tool.search_stories.ok, 6);
  assert.equal(snap.mcp.by_tool.search_stories.by_caller.internal.ok, 4);
  assert.equal(snap.mcp.by_tool.search_stories.by_caller.unattributed.ok, 2);
});

test('legacy snapshot without by_caller resumes and gains the sub-bucket on first call', async () => {
  const legacyRemote = {
    version: 'v0',
    snapshot_key: 'telemetry/usage-v0.json',
    window: { since: '2026-05-01T00:00:00.000Z', now: '2026-05-19T00:00:00.000Z', last_persisted_at: '2026-05-19T00:00:00.000Z' },
    http: { by_route: {}, by_ua_bucket: {} },
    mcp: { by_tool: { fetch_story: { ok: 9, err: 1 } }, total_calls: 10 },
  };
  const fetchSnapshot = async () => legacyRemote;
  const telemetry = createTelemetry({ fetchSnapshot, logger: silentLogger });
  await telemetry.ready;
  // Legacy per-tool object has no by_caller — must not throw on read.
  assert.equal(telemetry.snapshot().mcp.by_tool.fetch_story.ok, 9);
  assert.equal(telemetry.snapshot().mcp.by_tool.fetch_story.by_caller, undefined);
  // First post-resume call creates by_caller without losing the legacy totals.
  telemetry.recordMcpCall({ tool: 'fetch_story', ok: true, caller: 'internal' });
  const t = telemetry.snapshot().mcp.by_tool.fetch_story;
  assert.equal(t.ok, 10);
  assert.equal(t.by_caller.internal.ok, 1);
});

test('flushIfDue is throttled: not due until ceiling or interval reached', async () => {
  const calls = [];
  const githubCommit = async ({ path, content, message }) => {
    calls.push({ path, content, message });
    return { sha: 'aaaa' };
  };
  const telemetry = createTelemetry({
    githubCommit,
    flushIntervalMs: 60_000,
    flushMutationCeiling: 3,
    logger: silentLogger,
  });
  await telemetry.ready;
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r1 = await telemetry.flushIfDue();
  assert.equal(r1.skipped, true, 'first flush should be skipped: under ceiling, under interval');
  assert.equal(calls.length, 0);

  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r2 = await telemetry.flushIfDue();
  assert.equal(r2.ok, true);
  assert.equal(calls.length, 1, 'reaching ceiling fires one commit');
  assert.match(calls[0].path, /telemetry\/usage-v0\.json/);
});

test('concurrent flushIfDue invocations coalesce into a single commit', async () => {
  let calls = 0;
  let resolveCommit;
  const commitPromise = new Promise((res) => { resolveCommit = res; });
  const githubCommit = async () => {
    calls += 1;
    await commitPromise;
    return { sha: 'bbbb' };
  };
  const telemetry = createTelemetry({
    githubCommit,
    flushIntervalMs: 0,
    flushMutationCeiling: 1,
    logger: silentLogger,
  });
  await telemetry.ready;
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });

  const p1 = telemetry.flushIfDue();
  const p2 = telemetry.flushIfDue();
  const p3 = telemetry.flushIfDue();
  assert.equal(p1, p2, 'concurrent flush returns same in-flight promise');
  assert.equal(p2, p3);
  resolveCommit({ sha: 'bbbb' });
  await Promise.all([p1, p2, p3]);
  assert.equal(calls, 1, 'only one underlying commit fired');
});

test('flush failure resets in-flight flag so next attempt is allowed', async () => {
  let attempts = 0;
  const githubCommit = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('network down');
    return { sha: 'cccc' };
  };
  const telemetry = createTelemetry({
    githubCommit,
    flushIntervalMs: 0,
    flushMutationCeiling: 1,
    logger: silentLogger,
  });
  await telemetry.ready;
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r1 = await telemetry.flushIfDue();
  assert.equal(r1.ok, false);

  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r2 = await telemetry.flushIfDue();
  assert.equal(r2.ok, true);
  assert.equal(attempts, 2);
});

test('flush failure does NOT cause retry storm: cadence trigger resets', async () => {
  let attempts = 0;
  const githubCommit = async () => {
    attempts += 1;
    throw new Error('GitHub PUT telemetry/usage-v0.json → 422 (sha-absent): sha missing');
  };
  const telemetry = createTelemetry({
    githubCommit,
    flushIntervalMs: 60_000,
    flushMutationCeiling: 50,
    logger: silentLogger,
  });
  await telemetry.ready;
  // Pump 100 mutations past the ceiling — should fire ONCE, fail, then back off.
  for (let i = 0; i < 100; i++) {
    telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  }
  // First flush call: ceiling tripped, attempts the commit, fails.
  const r1 = await telemetry.flushIfDue();
  assert.equal(r1.ok, false);
  assert.equal(attempts, 1, 'one commit attempt fired');

  // Simulate ~30 subsequent requests in the same window — each calls flushIfDue.
  // After the failure, mutationsSinceFlush is reset to 0 and lastFlushAt is now,
  // so isDue() must return false — NO further commit attempts should fire.
  for (let i = 0; i < 30; i++) {
    const r = await telemetry.flushIfDue();
    assert.equal(r.skipped, true, `request ${i}: must skip, not re-attempt`);
  }
  assert.equal(attempts, 1, 'no retry storm: still only one commit attempt');

  // Continued mutations re-arm the ceiling trigger; the next ceiling hit fires
  // exactly one more attempt (the back-off is mutation-count based, not exponential).
  for (let i = 0; i < 60; i++) {
    telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  }
  const r2 = await telemetry.flushIfDue();
  assert.equal(r2.ok, false);
  assert.equal(attempts, 2, 'second ceiling hit fires exactly one more attempt');
});

test('flush failure preserves in-memory counters so next success captures full window', async () => {
  let attempts = 0;
  const captured = [];
  const githubCommit = async ({ content }) => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient 422');
    captured.push(JSON.parse(content));
    return { sha: 'eeee' };
  };
  const telemetry = createTelemetry({
    githubCommit,
    flushIntervalMs: 0,
    flushMutationCeiling: 1,
    logger: silentLogger,
  });
  await telemetry.ready;
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r1 = await telemetry.flushIfDue();
  assert.equal(r1.ok, false);
  // Even though the flush failed, in-memory counters survive.
  assert.equal(telemetry.snapshot().http.by_route['GET /']['200'], 2);

  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r2 = await telemetry.flushIfDue();
  assert.equal(r2.ok, true);
  // The successful commit captures everything since the last success (all 3).
  assert.equal(captured[0].http.by_route['GET /']['200'], 3);
});

test('last_persist_failed_at is set on flush failure and cleared on next success', async () => {
  let attempts = 0;
  const githubCommit = async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient 422');
    return { sha: 'ffff' };
  };
  const telemetry = createTelemetry({
    githubCommit,
    flushIntervalMs: 0,
    flushMutationCeiling: 1,
    logger: silentLogger,
  });
  await telemetry.ready;
  assert.equal(telemetry.snapshot().window.last_persist_failed_at, null, 'starts null');

  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r1 = await telemetry.flushIfDue();
  assert.equal(r1.ok, false);
  const afterFail = telemetry.snapshot().window.last_persist_failed_at;
  assert.equal(typeof afterFail, 'string', 'set to ISO timestamp after failure');
  assert.match(afterFail, /^\d{4}-\d{2}-\d{2}T/);

  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r2 = await telemetry.flushIfDue();
  assert.equal(r2.ok, true);
  assert.equal(telemetry.snapshot().window.last_persist_failed_at, null, 'cleared after next success');
});

test('last_persist_failed_at survives cold-start resume round-trip', async () => {
  const remote = {
    version: 'v0',
    snapshot_key: 'telemetry/usage-v0.json',
    window: {
      since: '2026-05-01T00:00:00.000Z',
      now: '2026-05-19T00:00:00.000Z',
      last_persisted_at: '2026-05-19T00:00:00.000Z',
      last_persist_failed_at: '2026-05-20T12:00:00.000Z',
    },
    http: { by_route: {}, by_ua_bucket: {} },
    mcp: { by_tool: {}, total_calls: 0 },
  };
  const fetchSnapshot = async () => remote;
  const telemetry = createTelemetry({ fetchSnapshot, logger: silentLogger });
  await telemetry.ready;
  assert.equal(telemetry.snapshot().window.last_persist_failed_at, '2026-05-20T12:00:00.000Z');
});

test('cold-start resume from legacy snapshot (no last_persist_failed_at) yields null, not undefined', async () => {
  const legacyRemote = {
    version: 'v0',
    snapshot_key: 'telemetry/usage-v0.json',
    window: { since: '2026-05-01T00:00:00.000Z', now: '2026-05-19T00:00:00.000Z', last_persisted_at: '2026-05-19T00:00:00.000Z' },
    http: { by_route: {}, by_ua_bucket: {} },
    mcp: { by_tool: {}, total_calls: 0 },
  };
  const fetchSnapshot = async () => legacyRemote;
  const telemetry = createTelemetry({ fetchSnapshot, logger: silentLogger });
  await telemetry.ready;
  const snap = telemetry.snapshot();
  assert.equal(snap.window.last_persist_failed_at, null);
  assert.ok('last_persist_failed_at' in snap.window, 'key is present on resumed snapshot');
});

test('cold-start fetch failure falls back to zero counters without throwing', async () => {
  const fetchSnapshot = async () => { throw new Error('404 from raw.githubusercontent'); };
  const telemetry = createTelemetry({
    fetchSnapshot,
    logger: silentLogger,
  });
  await telemetry.ready;
  const snap = telemetry.snapshot();
  assert.equal(snap.mcp.total_calls, 0);
  assert.deepEqual(snap.http.by_route, {});
  assert.deepEqual(snap.mcp.by_tool, {});
});

test('cold-start fetch resumes counters from the remote snapshot', async () => {
  const remote = {
    version: 'v0',
    snapshot_key: 'telemetry/usage-v0.json',
    window: { since: '2026-05-01T00:00:00.000Z', now: '2026-05-19T00:00:00.000Z', last_persisted_at: '2026-05-19T00:00:00.000Z' },
    http: { by_route: { 'GET /': { '200': 42 } }, by_ua_bucket: { browser: 42 } },
    mcp: { by_tool: { search_stories: { ok: 7, err: 1 } }, total_calls: 8 },
  };
  const fetchSnapshot = async () => remote;
  const telemetry = createTelemetry({ fetchSnapshot, logger: silentLogger });
  await telemetry.ready;
  const snap = telemetry.snapshot();
  assert.equal(snap.window.since, '2026-05-01T00:00:00.000Z');
  assert.equal(snap.http.by_route['GET /']['200'], 42);
  assert.equal(snap.mcp.by_tool.search_stories.ok, 7);
  assert.equal(snap.mcp.total_calls, 8);
});

test('defaultFetchSnapshot builds raw URL containing the configured branch segment', async () => {
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        version: 'v0',
        snapshot_key: 'telemetry/usage-v0.json',
        window: { since: '2026-05-20T00:00:00.000Z', now: '2026-05-20T00:00:00.000Z', last_persisted_at: null },
        http: { by_route: {}, by_ua_bucket: {} },
        mcp: { by_tool: {}, total_calls: 0 },
      }),
    };
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const fetchSnapshot = defaultFetchSnapshot({
      owner: 'Un3x',
      repo: 'ai-success-story',
      branch: 'telemetry-snapshots',
      snapshotKey: 'telemetry/usage-v0.json',
    });
    await fetchSnapshot();
    assert.equal(seen.length, 1);
    assert.match(seen[0], /\/Un3x\/ai-success-story\/telemetry-snapshots\/telemetry\/usage-v0\.json$/);
    assert.doesNotMatch(seen[0], /\/main\//, 'must not target main branch when branch arg is telemetry-snapshots');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('defaultFetchSnapshot honors custom branch arg end-to-end through createTelemetry resume', async () => {
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        version: 'v0',
        snapshot_key: 'telemetry/usage-v0.json',
        window: { since: '2026-05-01T00:00:00.000Z', now: '2026-05-19T00:00:00.000Z', last_persisted_at: '2026-05-19T00:00:00.000Z' },
        http: { by_route: { 'GET /': { '200': 11 } }, by_ua_bucket: { browser: 11 } },
        mcp: { by_tool: {}, total_calls: 0 },
      }),
    };
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    const fetchSnapshot = defaultFetchSnapshot({
      owner: 'Un3x',
      repo: 'ai-success-story',
      branch: 'telemetry-snapshots',
      snapshotKey: 'telemetry/usage-v0.json',
    });
    const telemetry = createTelemetry({ fetchSnapshot, logger: silentLogger });
    await telemetry.ready;
    assert.equal(seen.length, 1);
    assert.match(seen[0], /\/telemetry-snapshots\//);
    const snap = telemetry.snapshot();
    assert.equal(snap.http.by_route['GET /']['200'], 11, 'resumed counters from the side-branch snapshot');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('shutdownFlush commits even when not due, when mutations are pending', async () => {
  const calls = [];
  const githubCommit = async (x) => { calls.push(x); return { sha: 'dddd' }; };
  const telemetry = createTelemetry({
    githubCommit,
    flushIntervalMs: 60_000,
    flushMutationCeiling: 1000,
    logger: silentLogger,
  });
  await telemetry.ready;
  telemetry.recordHttp({ route: '/', method: 'GET', status: 200, uaBucket: 'browser' });
  const r = await telemetry.shutdownFlush();
  assert.equal(r.ok, true);
  assert.equal(calls.length, 1);
});
