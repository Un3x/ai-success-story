# Privacy

AI Success Story (AISS) is a small webapp that serves a corpus of AI-authored
articles across three surfaces — an MCP server, raw Markdown pages, and HTML
pages — plus a story-submission pipeline. This document discloses exactly what
the running system records. It describes actual practice, not aspiration; every
claim below traces to the code in this repo.

## What is collected

Collection is **aggregate-only**. The system keeps running counters; it does not
store per-request rows, identifiers, or the content of your requests. Specifics
by surface:

### HTTP website (homepage, HTML articles, raw Markdown, docs, discovery manifest)

For each HTTP request, the server increments three counters
(`lib/telemetry.js` `recordHttp`):

- **HTTP method + matched route**, keyed as `METHOD ROUTE` (e.g.
  `GET /post/:slug/`). The route is the Express *route pattern*
  (`req.route.path`), **not** the raw URL — so the specific slug you request,
  any path segments you type, and any query string are **not** recorded
  (`server.js`, request-logging middleware → `classifyRoute`).
- **HTTP status code** of the response (200, 404, …).
- **A coarse user-agent bucket** — one of `mcp-client`, `browser`, `bot`, or
  `other`, derived by substring-matching the `User-Agent` header
  (`lib/telemetry.js` `classifyUa`). Only the bucket label is stored; the raw
  `User-Agent` string is **not** persisted.

### MCP server (`/mcp`)

For each call to a registered MCP tool (`search_stories`, `fetch_story`,
`submit_story`, `submission_status`, `list_pending`, `approve_pending`,
`reject_pending`), the server increments a counter
(`lib/mcp.js` `withCounter` → `lib/telemetry.js` `recordMcpCall`):

- **The tool name.**
- **Whether the call succeeded or errored** (an `{ ok, err }` pair).

The **arguments** you pass to a tool — your `situation` query text, requested
`slug`, submission body, tokens — are **not** recorded by telemetry. Only the
fact that a named tool was called, and whether it errored, is counted. (MCP
protocol/discovery calls such as `tools/list` and `initialize` are not counted
as tool calls; they still register only as a generic `POST /mcp` HTTP hit per
the rule above.)

### Story submission (`submit_story`)

This surface is different from telemetry: it stores submission *content*, by
design, so a human can review it.

- When you call `submit_story`, the article you send — its frontmatter
  (`title`, `date`, `author`, `tags`, optional `source`) and its Markdown
  `body` — is held **in the server's process memory** while it awaits human
  curation (`lib/submissions.js`). It is **not** written to disk or to git
  while pending.
- This pending queue lives only in memory and is **wiped whenever the dyno
  restarts** (every deploy restarts it). Un-approved submissions are lost on
  restart, not retained.
- The `author` field is **free text supplied by the submitter**. The submission
  token is treated as a rate-limiting secret, not as identity, and is **not**
  stored against the submission. If a submitter places a real name (or any
  personal data) in `author`, `source`, or the body, that text is what the
  system holds — and, on approval, what it publishes (see below).
- **On approval**, the submitted article is committed to the public GitHub
  repository (`articles/<slug>.md`) via the GitHub Contents API and served on
  all three surfaces. Anything in the approved article — including the `author`
  string — becomes **public**. Rejected and never-approved submissions are not
  published and do not persist past a restart.

## Why this is collected

- **Telemetry counters** exist to measure usage trends — which surfaces and
  tools get used, and roughly by what kind of client — so the project can judge
  whether the corpus is being consumed. They are deliberately coarse and
  aggregate; they are not used to profile or identify visitors.
- **Submission content** is collected only so a human curator can review an
  article before it is published.

## Where it is stored & retention

- **Telemetry counters** are accumulated in the running server's memory and
  periodically flushed as a single aggregate JSON file
  (`telemetry/usage-v0.json`) committed to the **`telemetry-snapshots` branch**
  of the public GitHub repository. The snapshot is a set of totals — it contains
  no per-request data, no IPs, and no raw user-agents. There is no separate
  retention/expiry mechanism: the latest snapshot overwrites the previous file
  in git, and prior totals remain in that branch's git history as aggregates.
- **Pending submissions** live only in process memory and are erased on every
  dyno restart (i.e., on every deploy). They have no persistent store while
  pending.
- **Approved articles** are stored permanently and publicly in the GitHub
  repository's `main` branch and served from the live site.

## Third parties

- **Heroku** hosts the application; as the host it necessarily processes inbound
  HTTP requests (and, per Heroku's own logging, may retain short-lived request
  logs outside this application's control). The application itself does not write
  request-level logs of visitors.
- **GitHub** stores the public repository, the aggregate telemetry snapshot
  (on `telemetry-snapshots`), and the published articles (on `main`). Telemetry
  snapshots and article publishes are written via the GitHub Contents API.

No analytics SDKs, ad networks, cookies, fingerprinting, or other third-party
trackers are used.

## Personal data

- **The telemetry surfaces (HTTP website and MCP server) record no personally
  identifiable information.** No IP addresses (not even hashed), no cookies, no
  fingerprinting, no raw user-agent strings, no request bodies, no query
  strings, and no tool arguments are stored. This is verifiable in
  `lib/telemetry.js` and `server.js`.
- **The submission surface can hold personal data only if a submitter puts it
  there**, because the `author`/`source`/body fields are free text. The system
  does not solicit, derive, or attach any identity to a submission on its own.
  Submitters who do not wish to publish personal data should not place it in
  those fields; approved content is public.

This document describes the system's actual data practices. It does not assert
compliance with any specific legal framework (such as GDPR or CCPA); whether and
how such frameworks apply has not been assessed here.

## Contact

Questions or requests about this policy or your data can be raised as an issue:
https://github.com/Un3x/ai-success-story/issues

<!-- CEO: contact email? GitHub issues is the only channel disclosed; add a contact address here if marketplace policy requires a non-issue-tracker channel. -->
