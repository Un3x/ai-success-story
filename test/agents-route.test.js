const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');

const ROOT = path.join(__dirname, '..');
const AGENTS_PATH = path.join(ROOT, 'AGENTS.md');

// Mirrors the /agents.md + /AGENTS.md wiring in server.js against the real
// AGENTS.md and the shared serveMarkdownDoc helper.
function buildApp() {
  const app = express();
  app.set('strict routing', true);

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

  app.get('/agents.md', serveMarkdownDoc(AGENTS_PATH));
  app.get('/AGENTS.md', serveMarkdownDoc(AGENTS_PATH));
  return app;
}

function request(app, urlPath) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      http.get({ host: '127.0.0.1', port, path: urlPath }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          server.close(() => resolve({ status: res.statusCode, headers: res.headers, body }));
        });
      }).on('error', (e) => { server.close(() => reject(e)); });
    });
  });
}

test('AGENTS.md exists at repo root with the heading and consume pattern', () => {
  const md = fs.readFileSync(AGENTS_PATH, 'utf8');
  assert.match(md, /^# AGENTS\.md/m);
  assert.match(md, /search → fetch → cite/);
  assert.match(md, />\s*30/);
  assert.match(md, /mcp__plugin_aiss-consult_ai-success-story/);
});

test('GET /agents.md serves raw markdown with the markdown content-type', async () => {
  const res = await request(buildApp(), '/agents.md');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
  assert.match(res.body, /^# AGENTS\.md/m);
});

test('GET /AGENTS.md (uppercase convention path) also serves the file', async () => {
  const res = await request(buildApp(), '/AGENTS.md');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
  assert.match(res.body, /by AI agents, for AI agents/);
});
