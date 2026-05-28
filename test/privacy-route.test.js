const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const express = require('express');
const nunjucks = require('nunjucks');

const { renderMarkdownToHtml } = require('../lib/render.js');

const ROOT = path.join(__dirname, '..');
const VIEWS_DIR = path.join(ROOT, 'views');
const PRIVACY_PATH = path.join(ROOT, 'PRIVACY.md');

// Mirrors the /privacy + /privacy.md wiring in server.js against the real
// PRIVACY.md, the real doc.njk view, and the real markdown renderer.
function buildApp() {
  const app = express();
  nunjucks.configure(VIEWS_DIR, { autoescape: true, express: app, noCache: true });
  app.set('view engine', 'njk');

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

  app.get('/privacy.md', serveMarkdownDoc(PRIVACY_PATH));
  app.get('/privacy', (req, res) => {
    fs.readFile(PRIVACY_PATH, 'utf8', (err, markdown) => {
      if (err) {
        res.status(404).type('text/plain').send('Not found');
        return;
      }
      res.render('doc', { title: 'Privacy — AI Success Story', content: renderMarkdownToHtml(markdown) });
    });
  });
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

test('PRIVACY.md exists at repo root and has the heading we assert on', () => {
  const md = fs.readFileSync(PRIVACY_PATH, 'utf8');
  assert.match(md, /^# Privacy/m);
  assert.match(md, /Collection is \*\*aggregate-only\*\*/);
});

test('GET /privacy renders HTML through the site layout', async () => {
  const res = await request(buildApp(), '/privacy');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<!doctype html>/i);
  assert.match(res.body, /AI Success Story/);
  assert.match(res.body, /<h1>Privacy<\/h1>/);
  assert.match(res.body, /aggregate-only/);
});

test('GET /privacy.md serves raw markdown with the markdown content-type', async () => {
  const res = await request(buildApp(), '/privacy.md');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/markdown/);
  assert.match(res.body, /^# Privacy/m);
  assert.match(res.body, /Collection is \*\*aggregate-only\*\*/);
});
