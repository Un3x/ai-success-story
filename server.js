const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const nunjucks = require('nunjucks');

const { loadArticles } = require('./lib/articles.js');
const { buildBm25Index } = require('./lib/search.js');
const { createMcpServer, createStatelessTransport } = require('./lib/mcp.js');
const { createSubmissionsStore, createGithubCommitter } = require('./lib/submissions.js');
const { createTelemetry, classifyUa, classifyRoute, defaultFetchSnapshot } = require('./lib/telemetry.js');
const { PRIMING_SNIPPET } = require('./lib/priming-snippet.js');
const { renderLlmsTxt } = require('./lib/llms-txt.js');
const { renderSkillMd } = require('./lib/skill-md.js');
const { renderMarkdownToHtml } = require('./lib/render.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const ARTICLES_DIR = path.join(ROOT, 'articles');
const VIEWS_DIR = path.join(ROOT, 'views');
const FORMAT_SPEC_PATH = path.join(ROOT, 'format-spec.md');
const SYSTEM_PROMPT_PATH = path.join(ROOT, 'integrations/system-prompt/snippet.md');
const PRIVACY_PATH = path.join(ROOT, 'PRIVACY.md');
const AGENTS_PATH = path.join(ROOT, 'AGENTS.md');

const SUBMIT_TOKEN = process.env.AISS_SUBMIT_TOKEN || '';
const ADMIN_TOKEN = process.env.AISS_ADMIN_TOKEN || '';
const STATS_TOKEN = process.env.AISS_STATS_TOKEN || '';
const GITHUB_PAT = process.env.AISS_GITHUB_PAT || '';
const GITHUB_OWNER = process.env.AISS_GITHUB_OWNER || 'Un3x';
const GITHUB_REPO = process.env.AISS_GITHUB_REPO || 'ai-success-story';
const GITHUB_BRANCH = process.env.AISS_GITHUB_BRANCH || 'main';
const TELEMETRY_BRANCH = process.env.AISS_TELEMETRY_BRANCH || 'telemetry-snapshots';
const TELEMETRY_SNAPSHOT_KEY = process.env.AISS_TELEMETRY_SNAPSHOT_KEY || 'telemetry/usage-v0.json';

function loadCorpus() {
  const { articles, bySlug } = loadArticles(ARTICLES_DIR);
  const index = buildBm25Index(articles);
  return { articles, bySlug, index };
}

let corpusSnapshot = loadCorpus();

const corpus = {
  snapshot() {
    return corpusSnapshot;
  },
};

const githubCommit = createGithubCommitter({
  token: GITHUB_PAT,
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  branch: GITHUB_BRANCH,
});

const telemetryCommit = createGithubCommitter({
  token: GITHUB_PAT,
  owner: GITHUB_OWNER,
  repo: GITHUB_REPO,
  branch: TELEMETRY_BRANCH,
});

const submissions = createSubmissionsStore({ corpus, githubCommit });

const telemetry = createTelemetry({
  githubCommit: telemetryCommit,
  fetchSnapshot: defaultFetchSnapshot({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    branch: TELEMETRY_BRANCH,
    snapshotKey: TELEMETRY_SNAPSHOT_KEY,
  }),
  snapshotKey: TELEMETRY_SNAPSHOT_KEY,
});

const app = express();
app.disable('x-powered-by');
app.set('strict routing', true);

nunjucks.configure(VIEWS_DIR, {
  autoescape: true,
  express: app,
  noCache: process.env.NODE_ENV !== 'production',
});
app.set('view engine', 'njk');

app.use((req, res, next) => {
  res.on('finish', () => {
    const route = classifyRoute(req);
    telemetry.recordHttp({
      route,
      method: req.method,
      status: res.statusCode,
      uaBucket: classifyUa(req.headers['user-agent'], route),
    });
    telemetry.flushIfDue().catch((e) => console.error('telemetry flush failed:', e && e.message ? e.message : e));
  });
  next();
});

function getBaseUrl(req) {
  const envBase = process.env.PUBLIC_BASE_URL;
  if (envBase) return envBase.replace(/\/+$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

app.get('/', (req, res) => {
  const { articles } = corpus.snapshot();
  const posts = articles.map((a) => ({
    slug: a.slug,
    title: a.frontmatter.title,
    date: a.frontmatter.date,
  }));
  res.render('index', { title: 'AI Success Story', posts });
});

app.get('/llms.txt', (req, res) => {
  const { articles } = corpus.snapshot();
  const body = renderLlmsTxt({ articles, baseUrl: getBaseUrl(req) });
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.send(body);
});

app.get('/skill.md', (req, res) => {
  const body = renderSkillMd({ baseUrl: getBaseUrl(req) });
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  res.send(body);
});

app.get('/.well-known/ai-success-story.json', (req, res) => {
  const baseUrl = getBaseUrl(req);
  const manifest = {
    name: 'ai-success-story',
    version: 'v0',
    mcp_endpoint: `${baseUrl}/mcp`,
    format_spec_url: `${baseUrl}/docs/format-spec`,
    consumer_api_spec_url: `${baseUrl}/docs/consumer-api-spec`,
    submit_tool_name: 'submit_story',
    submit_enabled: Boolean(SUBMIT_TOKEN),
    token_request_pointer: 'contact principal out-of-band',
    integration_priming: {
      doc_url: `${baseUrl}/docs/format-spec`,
      snippet: PRIMING_SNIPPET,
      empirically_validated: '2026-05-19',
      note: 'Without this addendum, consumer pick rate is ~0% on relevant queries. With it, full search+fetch+paraphrase+integration. See format-spec.md "For AI integrators" section.',
    },
    integration: {
      system_prompt_url: `${baseUrl}/integration/system-prompt.md`,
    },
    surfaces: {
      html_index: `${baseUrl}/`,
      raw_markdown_pattern: `${baseUrl}/post/{slug}.md`,
      mcp_index_resource: 'aiss://index',
    },
  };
  res.set('Content-Type', 'application/json; charset=utf-8');
  res.send(JSON.stringify(manifest, null, 2));
});

function serveMarkdownDoc(filePath) {
  return (req, res) => {
    fs.access(filePath, fs.constants.R_OK, (err) => {
      if (err) {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      res.set('Content-Type', 'text/markdown; charset=utf-8');
      fs.createReadStream(filePath).pipe(res);
    });
  };
}

app.get('/docs/format-spec', serveMarkdownDoc(FORMAT_SPEC_PATH));
app.get('/docs/format-spec.md', serveMarkdownDoc(FORMAT_SPEC_PATH));
app.get('/docs/consumer-api-spec', serveMarkdownDoc(path.join(ROOT, 'consumer-api-spec.md')));
app.get('/docs/consumer-api-spec.md', serveMarkdownDoc(path.join(ROOT, 'consumer-api-spec.md')));
app.get('/integration/system-prompt.md', serveMarkdownDoc(SYSTEM_PROMPT_PATH));
app.get('/integration/system-prompt', serveMarkdownDoc(SYSTEM_PROMPT_PATH));

app.get('/privacy.md', serveMarkdownDoc(PRIVACY_PATH));
app.get('/agents.md', serveMarkdownDoc(AGENTS_PATH));
app.get('/AGENTS.md', serveMarkdownDoc(AGENTS_PATH));
app.get('/privacy', (req, res) => {
  fs.readFile(PRIVACY_PATH, 'utf8', (err, markdown) => {
    if (err) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.render('doc', { title: 'Privacy — AI Success Story', content: renderMarkdownToHtml(markdown) });
  });
});

app.get('/post/:slug.md', (req, res) => {
  const { bySlug } = corpus.snapshot();
  const article = bySlug.get(req.params.slug);
  if (!article) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  res.set('Content-Type', 'text/markdown; charset=utf-8');
  fs.createReadStream(article.filepath).pipe(res);
});

app.get('/post/:slug/', (req, res) => {
  const { bySlug } = corpus.snapshot();
  const article = bySlug.get(req.params.slug);
  if (!article) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  res.render('article', {
    title: article.frontmatter.title,
    slug: article.slug,
    content: article.html,
  });
});

app.get('/post/:slug', (req, res) => {
  res.redirect(301, `/post/${req.params.slug}/`);
});

function safeTokenEqual(provided, expected) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  // Length-canary run keeps the timing path identical regardless of length match.
  const canary = Buffer.alloc(a.length);
  crypto.timingSafeEqual(a, canary);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

app.get('/stats', (req, res) => {
  if (!STATS_TOKEN) {
    res.status(503).json({ error: 'stats endpoint disabled' });
    return;
  }
  const provided = req.headers['x-aiss-stats-token'];
  if (!safeTokenEqual(provided, STATS_TOKEN)) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.set('Cache-Control', 'no-store');
  res.json(telemetry.snapshot());
});

// MCP — stateless Streamable HTTP. Fresh transport + server per request.
app.use('/mcp', express.json({ limit: '4mb' }));

async function handleMcp(req, res) {
  let transport;
  let mcpServer;
  try {
    transport = createStatelessTransport();
    const caller = req.headers['x-aiss-caller'] === 'internal' ? 'internal' : 'unattributed';
    mcpServer = createMcpServer({
      corpus,
      getBaseUrl: () => getBaseUrl(req),
      submissions,
      submitToken: SUBMIT_TOKEN,
      adminToken: ADMIN_TOKEN,
      telemetry,
      caller,
    });
    res.on('close', () => {
      // Defensive cleanup if the client drops.
      try { transport.close(); } catch (_) { /* noop */ }
      try { mcpServer.close(); } catch (_) { /* noop */ }
    });
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MCP request failed:', err);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal server error' },
        id: null,
      });
    }
  }
}

app.all('/mcp', handleMcp);

app.use((req, res) => {
  res.status(404).type('text/plain').send('Not found');
});

const server = app.listen(PORT, HOST, () => {
  // eslint-disable-next-line no-console
  console.log(`ai-success-story webapp listening on http://${HOST}:${PORT}`);
});

function shutdown(signal) {
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down…`);
  telemetry.shutdownFlush().catch((e) => console.error('telemetry shutdownFlush failed:', e && e.message ? e.message : e));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
