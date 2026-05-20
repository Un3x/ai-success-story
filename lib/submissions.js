const crypto = require('node:crypto');
const { validateSubmission, deriveSlug } = require('./validation.js');

const STATES = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  UNKNOWN: 'unknown',
};

function serializeFrontmatter(fm) {
  const lines = ['---'];
  lines.push(`title: ${fm.title}`);
  lines.push(`date: ${fm.date}`);
  lines.push(`author: ${fm.author}`);
  const tagList = fm.tags.map((t) => t).join(', ');
  lines.push(`tags: [${tagList}]`);
  if (typeof fm.source === 'string' && fm.source.length > 0) {
    lines.push(`source: ${fm.source}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function buildArticleMarkdown({ frontmatter, body }) {
  const fm = serializeFrontmatter(frontmatter);
  const trimmedBody = body.replace(/^\s+/, '').replace(/\s+$/, '');
  return `${fm}\n\n${trimmedBody}\n`;
}

function createSubmissionsStore({ corpus, githubCommit, now } = {}) {
  const submissions = new Map();
  const pendingOrder = [];
  const _now = typeof now === 'function' ? now : () => new Date();

  function existingSlugs() {
    const { bySlug } = corpus.snapshot();
    return new Set(bySlug.keys());
  }

  function pendingSlugs() {
    const out = new Set();
    for (const id of pendingOrder) {
      const sub = submissions.get(id);
      if (sub && sub.state === STATES.PENDING) out.add(sub.slug);
    }
    return out;
  }

  function suggestAlternateSlug(baseSlug) {
    const taken = new Set([...existingSlugs(), ...pendingSlugs()]);
    for (let i = 2; i < 100; i++) {
      const candidate = `${baseSlug}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    return `${baseSlug}-${crypto.randomBytes(3).toString('hex')}`;
  }

  function submit({ frontmatter, body }) {
    const validation = validateSubmission({ frontmatter, body });
    const errors = validation.errors.slice();

    let slug = '';
    if (frontmatter && typeof frontmatter.title === 'string') {
      slug = deriveSlug(frontmatter.title);
      if (slug.length === 0) {
        errors.push({
          code: 'SLUG_EMPTY',
          rule: 'title must yield at least one ASCII alphanumeric character',
        });
      } else {
        const taken = new Set([...existingSlugs(), ...pendingSlugs()]);
        if (taken.has(slug)) {
          const suggestion = suggestAlternateSlug(slug);
          errors.push({
            code: 'SLUG_COLLISION',
            rule: `slug '${slug}' already exists; rename the title or retry with a distinguishing word (suggestion: '${suggestion}')`,
            offending_substring: slug,
          });
        }
      }
    }

    if (errors.length > 0) {
      const id = `sub_${crypto.randomBytes(8).toString('hex')}`;
      const rec = {
        id,
        state: STATES.REJECTED,
        slug: slug || null,
        frontmatter: frontmatter || null,
        body: typeof body === 'string' ? body : null,
        errors,
        created_at: _now().toISOString(),
        rejected_at: _now().toISOString(),
        rejection_reason: 'prefilter_validation_failed',
      };
      submissions.set(id, rec);
      return { status: 'rejected', submission_id: id, errors };
    }

    const id = `sub_${crypto.randomBytes(8).toString('hex')}`;
    const rec = {
      id,
      state: STATES.PENDING,
      slug,
      frontmatter,
      body,
      errors: [],
      created_at: _now().toISOString(),
    };
    submissions.set(id, rec);
    pendingOrder.push(id);
    return { status: 'queued', submission_id: id };
  }

  function status(submissionId) {
    const rec = submissions.get(submissionId);
    if (!rec) return { state: STATES.UNKNOWN };
    const out = { state: rec.state };
    const details = {};
    if (rec.slug) details.slug = rec.slug;
    if (rec.created_at) details.created_at = rec.created_at;
    if (rec.state === STATES.REJECTED) {
      if (rec.rejection_reason) details.reason = rec.rejection_reason;
      if (rec.errors && rec.errors.length) details.errors = rec.errors;
      if (rec.rejected_at) details.rejected_at = rec.rejected_at;
    }
    if (rec.state === STATES.APPROVED) {
      if (rec.commit_sha) details.commit_sha = rec.commit_sha;
      if (rec.approved_at) details.approved_at = rec.approved_at;
      if (rec.published_path) details.published_path = rec.published_path;
    }
    if (Object.keys(details).length > 0) out.details = details;
    return out;
  }

  function listPending() {
    const items = [];
    for (const id of pendingOrder) {
      const rec = submissions.get(id);
      if (!rec || rec.state !== STATES.PENDING) continue;
      items.push({
        submission_id: rec.id,
        slug: rec.slug,
        title: rec.frontmatter.title,
        author: rec.frontmatter.author,
        date: rec.frontmatter.date,
        tags: rec.frontmatter.tags,
        created_at: rec.created_at,
      });
    }
    return items;
  }

  async function approve(submissionId) {
    const rec = submissions.get(submissionId);
    if (!rec) return { ok: false, error: 'unknown_submission' };
    if (rec.state !== STATES.PENDING) {
      return { ok: false, error: `submission is ${rec.state}, not pending` };
    }
    const taken = existingSlugs();
    if (taken.has(rec.slug)) {
      rec.state = STATES.REJECTED;
      rec.rejection_reason = 'slug_collision_at_approve';
      rec.rejected_at = _now().toISOString();
      rec.errors = [
        {
          code: 'SLUG_COLLISION',
          rule: `slug '${rec.slug}' was claimed by another article before approval`,
          offending_substring: rec.slug,
        },
      ];
      return { ok: false, error: 'slug_collision_at_approve' };
    }

    if (typeof githubCommit !== 'function') {
      return { ok: false, error: 'github_commit_not_configured' };
    }

    const markdown = buildArticleMarkdown({ frontmatter: rec.frontmatter, body: rec.body });
    const publishedPath = `articles/${rec.slug}.md`;
    const message = `publish: ${rec.slug} (submission ${rec.id})`;
    let commitResult;
    try {
      commitResult = await githubCommit({ path: publishedPath, content: markdown, message });
    } catch (e) {
      return { ok: false, error: `github_commit_failed: ${e.message || e}` };
    }
    if (!commitResult || !commitResult.sha) {
      return { ok: false, error: 'github_commit_no_sha' };
    }

    rec.state = STATES.APPROVED;
    rec.approved_at = _now().toISOString();
    rec.commit_sha = commitResult.sha;
    rec.published_path = publishedPath;
    return { ok: true, sha: commitResult.sha, path: publishedPath };
  }

  function reject(submissionId, reason) {
    const rec = submissions.get(submissionId);
    if (!rec) return { ok: false, error: 'unknown_submission' };
    if (rec.state !== STATES.PENDING) {
      return { ok: false, error: `submission is ${rec.state}, not pending` };
    }
    rec.state = STATES.REJECTED;
    rec.rejection_reason = typeof reason === 'string' && reason.length > 0 ? reason : 'rejected_by_curator';
    rec.rejected_at = _now().toISOString();
    return { ok: true };
  }

  return {
    submit,
    status,
    listPending,
    approve,
    reject,
    _internal: { submissions, pendingOrder },
  };
}

function createGithubCommitter({ token, owner, repo, branch, fetchImpl, committer } = {}) {
  if (!token || !owner || !repo) return null;
  const _fetch = fetchImpl || globalThis.fetch;
  const _branch = branch || 'main';
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ai-success-story-webapp',
  };
  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function fetchExistingSha(path) {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}?ref=${encodeURIComponent(_branch)}`;
    const res = await _fetch(url, { method: 'GET', headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GitHub GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json().catch(() => null);
    return json && typeof json.sha === 'string' ? json.sha : null;
  }

  async function putOnce({ path, content, message, sha }) {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`;
    const body = {
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: _branch,
    };
    if (typeof sha === 'string' && sha.length > 0) body.sha = sha;
    if (committer && committer.name && committer.email) {
      body.committer = { name: committer.name, email: committer.email };
    }
    const res = await _fetch(url, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return res;
  }

  return async function commit({ path, content, message }) {
    let sha = await fetchExistingSha(path);
    let res = await putOnce({ path, content, message, sha });
    if (res.status === 409 || res.status === 422) {
      // Stale or missing sha: re-fetch and retry once.
      sha = await fetchExistingSha(path);
      res = await putOnce({ path, content, message, sha });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const shaStatus = sha ? 'sha-present' : 'sha-absent';
      throw new Error(`GitHub PUT ${path} → ${res.status} (${shaStatus}): ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    return { sha: json.commit && json.commit.sha };
  };
}

module.exports = {
  createSubmissionsStore,
  createGithubCommitter,
  buildArticleMarkdown,
  serializeFrontmatter,
  STATES,
};
