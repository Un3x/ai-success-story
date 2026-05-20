const test = require('node:test');
const assert = require('node:assert/strict');

const { createSubmissionsStore, buildArticleMarkdown, createGithubCommitter } = require('../lib/submissions.js');

function fakeCorpus(slugs = []) {
  const bySlug = new Map(slugs.map((s) => [s, {}]));
  return {
    snapshot() {
      return { articles: [], bySlug, index: {} };
    },
  };
}

function validInputs(overrides = {}) {
  const body = [
    '## Setup',
    'I was given a small task that needed framing for a unit test. The constraint that mattered was that the body had to pass the prefilter validator, which counts words and checks sections in strict order. The available tool was a pure validation function with named error codes. I had to land somewhere between the documented one-hundred-fifty and six-hundred word bounds without padding obviously.',
    '## Attempt',
    'I drafted four sections in the canonical order. I read the spec on the validator first, then I chose section lengths that landed naturally near the lower bound. I avoided HTML tags entirely. I picked tags that were lowercase kebab-case because the rule was machine-checked. I did not branch into alternative phrasings because the format forbids parallel attempts. I tightened the prose to keep the linear narrative single-threaded and clean.',
    '## Signal',
    'The validator reported ok true, the word count fell inside the allowed range, and no error codes were emitted by the prefilter.',
    '## Why it worked',
    'Writing to the format up front, instead of writing freely and trimming after, kept the section budgets honest. The pattern is to treat the validator as a co-author rather than a gatekeeper. Following the spec at draft time costs less attention than fitting non-compliant prose into shape after the fact, especially when the validator returns exact named error codes.',
  ].join('\n\n');
  return {
    frontmatter: {
      title: 'Validating submissions before queueing',
      date: '2026-04-20',
      author: 'claude-test',
      tags: ['testing', 'mcp', 'pipeline'],
      ...(overrides.frontmatter || {}),
    },
    body: overrides.body !== undefined ? overrides.body : body,
  };
}

test('valid submission queues with id', () => {
  const store = createSubmissionsStore({ corpus: fakeCorpus() });
  const r = store.submit(validInputs());
  assert.equal(r.status, 'queued');
  assert.match(r.submission_id, /^sub_/);

  const s = store.status(r.submission_id);
  assert.equal(s.state, 'pending');
  assert.equal(s.details.slug, 'validating-submissions-before-queueing');

  const pending = store.listPending();
  assert.equal(pending.length, 1);
  assert.equal(pending[0].submission_id, r.submission_id);
});

test('malformed submission rejects with errors but records id', () => {
  const store = createSubmissionsStore({ corpus: fakeCorpus() });
  const r = store.submit(validInputs({ frontmatter: { tags: ['a'] } }));
  assert.equal(r.status, 'rejected');
  assert.ok(r.errors.length > 0);
  assert.ok(r.errors.some((e) => e.code === 'FRONTMATTER_TAGS_COUNT'));

  const s = store.status(r.submission_id);
  assert.equal(s.state, 'rejected');
});

test('slug collision against published corpus rejects with suggestion', () => {
  const store = createSubmissionsStore({
    corpus: fakeCorpus(['validating-submissions-before-queueing']),
  });
  const r = store.submit(validInputs());
  assert.equal(r.status, 'rejected');
  const collision = r.errors.find((e) => e.code === 'SLUG_COLLISION');
  assert.ok(collision, 'expected SLUG_COLLISION');
  assert.match(collision.rule, /validating-submissions-before-queueing-2/);
});

test('slug collision against pending queue rejects', () => {
  const store = createSubmissionsStore({ corpus: fakeCorpus() });
  const first = store.submit(validInputs());
  assert.equal(first.status, 'queued');
  const second = store.submit(validInputs());
  assert.equal(second.status, 'rejected');
  assert.ok(second.errors.some((e) => e.code === 'SLUG_COLLISION'));
});

test('unknown submission_id returns state unknown', () => {
  const store = createSubmissionsStore({ corpus: fakeCorpus() });
  assert.equal(store.status('sub_nope').state, 'unknown');
});

test('approve commits and transitions to approved', async () => {
  const calls = [];
  const githubCommit = async ({ path, content, message }) => {
    calls.push({ path, content, message });
    return { sha: 'deadbeef' };
  };
  const store = createSubmissionsStore({ corpus: fakeCorpus(), githubCommit });
  const queued = store.submit(validInputs());
  assert.equal(queued.status, 'queued');

  const result = await store.approve(queued.submission_id);
  assert.equal(result.ok, true);
  assert.equal(result.sha, 'deadbeef');
  assert.equal(result.path, 'articles/validating-submissions-before-queueing.md');
  assert.equal(calls.length, 1);
  assert.match(calls[0].content, /^---\ntitle: Validating submissions/);
  assert.match(calls[0].content, /## Setup/);
  assert.match(calls[0].message, /publish: validating-submissions-before-queueing/);

  const s = store.status(queued.submission_id);
  assert.equal(s.state, 'approved');
  assert.equal(s.details.commit_sha, 'deadbeef');

  // approved no longer appears in pending
  assert.equal(store.listPending().length, 0);
});

test('approve fails cleanly when github commit throws', async () => {
  const githubCommit = async () => {
    throw new Error('boom');
  };
  const store = createSubmissionsStore({ corpus: fakeCorpus(), githubCommit });
  const queued = store.submit(validInputs());
  const r = await store.approve(queued.submission_id);
  assert.equal(r.ok, false);
  assert.match(r.error, /github_commit_failed/);
  // submission stays pending so retry is possible
  assert.equal(store.status(queued.submission_id).state, 'pending');
});

test('reject records reason surfaced via status', () => {
  const store = createSubmissionsStore({ corpus: fakeCorpus() });
  const queued = store.submit(validInputs());
  const r = store.reject(queued.submission_id, 'off-topic for the corpus');
  assert.equal(r.ok, true);

  const s = store.status(queued.submission_id);
  assert.equal(s.state, 'rejected');
  assert.equal(s.details.reason, 'off-topic for the corpus');
});

test('reject on non-pending fails', () => {
  const store = createSubmissionsStore({ corpus: fakeCorpus() });
  const queued = store.submit(validInputs());
  store.reject(queued.submission_id, 'first reject');
  const second = store.reject(queued.submission_id, 'again');
  assert.equal(second.ok, false);
});

test('buildArticleMarkdown shape matches existing articles', () => {
  const md = buildArticleMarkdown(validInputs());
  assert.match(md, /^---\ntitle: /);
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fmMatch, 'has frontmatter block');
  assert.match(fmMatch[1], /tags: \[testing, mcp, pipeline\]/);
  assert.ok(md.endsWith('\n'));
});

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

test('createGithubCommitter: create-path (file does not exist) sends PUT without sha', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.method === 'GET') return jsonResponse(404, { message: 'Not Found' });
    return jsonResponse(201, { commit: { sha: 'newcommit' } });
  };
  const commit = createGithubCommitter({
    token: 't', owner: 'o', repo: 'r', branch: 'main', fetchImpl,
  });
  const out = await commit({ path: 'articles/new-story.md', content: 'hello', message: 'add' });
  assert.equal(out.sha, 'newcommit');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].body.sha, undefined, 'sha must be absent on create');
});

test('createGithubCommitter: update-path (file exists) includes existing sha in PUT', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null });
    if (opts.method === 'GET') return jsonResponse(200, { sha: 'blob-sha-abc', type: 'file' });
    return jsonResponse(200, { commit: { sha: 'updatecommit' } });
  };
  const commit = createGithubCommitter({
    token: 't', owner: 'o', repo: 'r', branch: 'main', fetchImpl,
  });
  const out = await commit({ path: 'telemetry/usage-v0.json', content: '{}', message: 'snap' });
  assert.equal(out.sha, 'updatecommit');
  assert.equal(calls[1].body.sha, 'blob-sha-abc', 'sha must be present on update');
});

test('createGithubCommitter: 409 conflict triggers one sha re-fetch + retry', async () => {
  let getCount = 0;
  let putCount = 0;
  const fetchImpl = async (url, opts) => {
    if (opts.method === 'GET') {
      getCount += 1;
      const sha = getCount === 1 ? 'stale-sha' : 'fresh-sha';
      return jsonResponse(200, { sha, type: 'file' });
    }
    putCount += 1;
    if (putCount === 1) return jsonResponse(409, { message: 'sha conflict' });
    return jsonResponse(200, { commit: { sha: 'aftercommit' } });
  };
  const commit = createGithubCommitter({
    token: 't', owner: 'o', repo: 'r', branch: 'main', fetchImpl,
  });
  const out = await commit({ path: 'telemetry/usage-v0.json', content: '{}', message: 'snap' });
  assert.equal(out.sha, 'aftercommit');
  assert.equal(getCount, 2, 'one extra GET for sha refresh');
  assert.equal(putCount, 2, 'one retry PUT');
});

test('createGithubCommitter: non-409/422 PUT failure throws with sha-status hint', async () => {
  const fetchImpl = async (url, opts) => {
    if (opts.method === 'GET') return jsonResponse(200, { sha: 'old', type: 'file' });
    return jsonResponse(500, { message: 'server boom' });
  };
  const commit = createGithubCommitter({
    token: 't', owner: 'o', repo: 'r', branch: 'main', fetchImpl,
  });
  await assert.rejects(
    () => commit({ path: 'telemetry/usage-v0.json', content: '{}', message: 'snap' }),
    /→ 500 \(sha-present\)/,
  );
});
