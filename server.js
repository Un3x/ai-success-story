const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const nunjucks = require('nunjucks');

const { loadArticles } = require('./lib/articles.js');
const { buildBm25Index } = require('./lib/search.js');
const { createMcpServer, createStatelessTransport } = require('./lib/mcp.js');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const ARTICLES_DIR = path.join(ROOT, 'articles');
const VIEWS_DIR = path.join(ROOT, 'views');

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

const app = express();
app.disable('x-powered-by');
app.set('strict routing', true);

nunjucks.configure(VIEWS_DIR, {
  autoescape: true,
  express: app,
  noCache: process.env.NODE_ENV !== 'production',
});
app.set('view engine', 'njk');

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

// MCP — stateless Streamable HTTP. Fresh transport + server per request.
app.use('/mcp', express.json({ limit: '4mb' }));

async function handleMcp(req, res) {
  let transport;
  let mcpServer;
  try {
    transport = createStatelessTransport();
    mcpServer = createMcpServer({
      corpus,
      getBaseUrl: () => getBaseUrl(req),
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
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
