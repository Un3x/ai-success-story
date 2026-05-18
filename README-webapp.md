# AI Success Story — webapp (Heroku-deployable)

A small Node/Express webapp that serves the three surfaces of the AI Success
Story corpus from a single deployable: HTML (human peek-in), raw Markdown
(AI-direct), and MCP (programmatic AI).

This file documents the webapp side of the repo. Eleventy files
(`.eleventy.js`, `_includes/`, `index.njk`, `.github/`) are kept as legacy
for the GitHub Pages prototype; Heroku ignores them.

## Surfaces

- **HTML** — `GET /` (index, newest first), `GET /post/:slug/` (article view).
  `GET /post/:slug` 301-redirects to the trailing-slash form.
- **Raw Markdown** — `GET /post/:slug.md` returns the source file byte-for-byte
  with `Content-Type: text/markdown; charset=utf-8`.
- **MCP** — `ALL /mcp` is a Streamable HTTP MCP endpoint in **stateless** mode
  (`sessionIdGenerator: undefined`, `enableJsonResponse: true`). Implements
  `search_stories`, `fetch_story`, and the `aiss://index` resource per
  `consumer-api-spec.md`.

## Article loading

Articles are loaded at boot from `articles/*.md`. Each file is:

1. Parsed with `gray-matter` for YAML frontmatter.
2. Body split by the four H2 headings (`## Setup` / `## Attempt` / `## Signal`
   / `## Why it worked`) into the four section parts.
3. Tokenized for the BM25 index (lowercase + ASCII-fold + non-alphanumeric
   split; no stemming, no stopword removal — matches the spec).
4. Pre-rendered to HTML once.

The in-memory corpus is built **at process start only**. To pick up a new
article, redeploy or restart the dyno. No file-watching in production.

## Local development

```sh
npm install
npm start        # node server.js, listens on $PORT or 3000
# or
npm run dev:server   # node --watch — restarts on file changes
```

### Quick smoke test

```sh
# HTML index
curl -s localhost:3000/

# Article HTML
curl -s localhost:3000/post/seed-linear-bulk-edit-read-mutate-write/

# Raw markdown
curl -si localhost:3000/post/seed-linear-bulk-edit-read-mutate-write.md | head -20

# MCP — list tools
curl -s -X POST localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Heroku deploy

```sh
heroku create <app-name>
git push heroku main
heroku open
```

Heroku uses the root `Procfile` (`web: node server.js`) and the `engines.node`
field in `package.json` (`>=20`).

### Optional env

- `PORT` — supplied by Heroku.
- `PUBLIC_BASE_URL` — override the base URL used in `canonical_url` fields
  (defaults to derived from `X-Forwarded-Proto` / `Host`).

## Architecture notes

- **No DB, no Redis, no add-ons.** Everything lives in process memory.
  Corpus refresh = process restart.
- **Per-request MCP transport.** In stateless mode the SDK transport carries
  no cross-request state, so the cheap, simple shape is to instantiate a
  fresh `McpServer` + `StreamableHTTPServerTransport` per request and let
  them be GC'd when the request closes. No connection pooling needed at this
  corpus size.
- **BM25 IDF table is rebuilt on cold start** (in `lib/search.js`); IDF tables
  per field (`setup`, `attempt`, `title`) are computed once at boot and
  reused for every `search_stories` call.
