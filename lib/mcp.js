const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { searchStories } = require('./search.js');

const PART_ORDER = ['frontmatter', 'setup', 'attempt', 'signal', 'why_it_worked'];
const PART_ENUM = z.enum(PART_ORDER);

const SPEC_VERSION = 'v0';
const INDEX_TTL_MS = 60 * 60 * 1000; // 1h

function applyAtomicContextGuardrail(requestedParts) {
  // When `parts` is omitted (undefined), return all + no forcing.
  if (!requestedParts) {
    return {
      returned: PART_ORDER.slice(),
      forced: [],
      reason: 'none',
    };
  }

  const requested = new Set(requestedParts);
  const requires = new Set(requested);

  // Rule: if any of {attempt, signal, why_it_worked} ∈ set → force setup.
  if (requires.has('attempt') || requires.has('signal') || requires.has('why_it_worked')) {
    requires.add('setup');
  }
  // Rule: if attempt ∈ set → force signal.
  if (requires.has('attempt')) {
    requires.add('signal');
  }

  const returned = PART_ORDER.filter((p) => requires.has(p));
  const forced = returned.filter((p) => !requested.has(p));
  const reason = forced.length > 0 ? 'atomic_context' : 'none';
  return { returned, forced, reason };
}

function buildFetchStoryResponse(article, requestedParts, canonicalUrl) {
  const { returned, forced, reason } = applyAtomicContextGuardrail(requestedParts);

  const out = {
    slug: article.slug,
    returned_parts: returned,
    forced_parts: forced,
    forced_parts_reason: reason,
    canonical_url: canonicalUrl,
    _version: SPEC_VERSION,
  };

  for (const part of returned) {
    if (part === 'frontmatter') {
      out.frontmatter = article.frontmatter;
    } else {
      out[part] = article.sections[part];
    }
  }
  return out;
}

function buildIndexManifest({ articles, baseUrl }) {
  const now = new Date();
  const validUntil = new Date(now.getTime() + INDEX_TTL_MS);
  return {
    version: SPEC_VERSION,
    generated_at: now.toISOString(),
    valid_until: validUntil.toISOString(),
    count: articles.length,
    stories: articles.map((a) => ({
      slug: a.slug,
      title: a.frontmatter.title,
      author: a.frontmatter.author,
      date: a.frontmatter.date,
      tags: a.frontmatter.tags,
      canonical_url: `${baseUrl}/post/${a.slug}/`,
    })),
  };
}

function canonicalUrlForRawMd(baseUrl, slug) {
  return `${baseUrl}/post/${slug}.md`;
}

function jsonContent(payload) {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function createMcpServer({ corpus, getBaseUrl, submissions, submitToken, adminToken }) {
  const server = new McpServer(
    {
      name: 'ai-success-story',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );

  server.registerTool(
    'search_stories',
    {
      title: 'search_stories',
      description:
        "Find success stories whose Setup matches a described situation. Returns ranked slugs with an extractive 'why_relevant' sentence so you can decide whether to fetch. Pass canonical token forms (no stemming).",
      inputSchema: {
        situation: z
          .string()
          .min(8, 'situation must be 8+ chars; one to three sentences describing task / tools / constraint.')
          .max(600)
          .describe('Natural-language description of the situation: task, tools, constraint. One to three sentences.'),
        tags: z
          .array(z.string())
          .max(6)
          .optional()
          .describe('Optional tag filter. Soft boost on ranking, never a hard filter.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Maximum number of results (default 5, max 10).'),
      },
    },
    async ({ situation, tags, limit }) => {
      const lim = typeof limit === 'number' ? limit : 5;
      const { articles, index } = corpus.snapshot();
      const { results, unknown_tags } = searchStories({
        articles,
        situation,
        tags,
        limit: lim,
        index,
      });
      const payload = { results, unknown_tags, _version: SPEC_VERSION };
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    'fetch_story',
    {
      title: 'fetch_story',
      description:
        "Retrieve a story by slug, in full (omit `parts`) or a subset. Server enforces the atomic-context guardrail: requesting `attempt`/`signal`/`why_it_worked` will force `setup` (and `signal` for `attempt`). `forced_parts` and `forced_parts_reason` make this observable.",
      inputSchema: {
        slug: z
          .string()
          .regex(/^[a-z0-9-]+$/, 'slug must match ^[a-z0-9-]+$')
          .describe('Story slug as returned by search_stories or listed in aiss://index.'),
        parts: z
          .array(PART_ENUM)
          .min(1, 'omit `parts` to mean "everything"; empty arrays are not allowed.')
          .refine((arr) => new Set(arr).size === arr.length, 'parts must be unique')
          .optional()
          .describe('Optional. Omit to get the full article. Provide a non-empty subset to get just those parts plus any forced companions.'),
      },
    },
    async ({ slug, parts }) => {
      const { bySlug } = corpus.snapshot();
      const article = bySlug.get(slug);
      if (!article) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `No story with slug '${slug}'. Use search_stories or read aiss://index for valid slugs.`,
            },
          ],
        };
      }
      const baseUrl = getBaseUrl();
      const canonicalUrl = canonicalUrlForRawMd(baseUrl, slug);
      const payload = buildFetchStoryResponse(article, parts, canonicalUrl);
      return {
        content: [{ type: 'text', text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    },
  );

  if (submissions) {
    const tokenGate = (provided, expected, who) => {
      if (!expected) {
        return { ok: false, message: `${who} disabled on this deployment (token not configured)` };
      }
      if (typeof provided !== 'string' || provided !== expected) {
        return { ok: false, message: 'invalid token' };
      }
      return { ok: true };
    };

    server.registerTool(
      'submit_story',
      {
        title: 'submit_story',
        description:
          "Submit a success-story article for human curation. Bearer-gated by a shared submission token (request out-of-band; not identity, only rate-limiting). Body is validated against the format spec at /docs/format-spec — exact H2 sections (Setup, Attempt, Signal, Why it worked) in order, 150–600 words, frontmatter {title, date, author, tags}. Returns {status: 'queued' | 'rejected', submission_id, errors?}. Poll submission_status with the id to track curation.",
        inputSchema: {
          token: z.string().min(1).describe('Shared submission token (out-of-band).'),
          frontmatter: z
            .object({
              title: z.string(),
              date: z.string(),
              author: z.string(),
              tags: z.array(z.string()),
              source: z.string().optional(),
            })
            .describe('Article frontmatter. title ≤70 chars, date YYYY-MM-DD not in future, author 1–60 chars, tags 3–6 lowercase kebab-case.'),
          body: z
            .string()
            .min(1)
            .describe('Article body in Markdown. Must contain exactly four H2 sections in order: Setup, Attempt, Signal, Why it worked. 150–600 words. No HTML tags.'),
        },
      },
      async ({ token, frontmatter, body }) => {
        const gate = tokenGate(token, submitToken, 'submit_story');
        if (!gate.ok) {
          const payload = {
            status: 'rejected',
            errors: [{ code: 'AUTH_TOKEN_INVALID', rule: gate.message }],
          };
          return { isError: true, ...jsonContent(payload) };
        }
        const result = submissions.submit({ frontmatter, body });
        return jsonContent(result);
      },
    );

    server.registerTool(
      'submission_status',
      {
        title: 'submission_status',
        description:
          "Public read. Look up a submission by id; returns {state: 'pending' | 'approved' | 'rejected' | 'unknown', details?}. Pending queue lives in process memory — dyno restart wipes it (resubmit if status becomes 'unknown' after a deploy).",
        inputSchema: {
          submission_id: z.string().min(1).describe('Submission id returned by submit_story.'),
        },
      },
      async ({ submission_id }) => {
        return jsonContent(submissions.status(submission_id));
      },
    );

    server.registerTool(
      'list_pending',
      {
        title: 'list_pending',
        description:
          'Admin-only. List submissions awaiting curation. Gated by the admin token. Returns oldest-first.',
        inputSchema: {
          admin_token: z.string().min(1).describe('Admin token (out-of-band).'),
        },
      },
      async ({ admin_token }) => {
        const gate = tokenGate(admin_token, adminToken, 'list_pending');
        if (!gate.ok) {
          return { isError: true, ...jsonContent({ error: gate.message }) };
        }
        return jsonContent({ pending: submissions.listPending() });
      },
    );

    server.registerTool(
      'approve_pending',
      {
        title: 'approve_pending',
        description:
          'Admin-only. Promote a pending submission to a published article by committing articles/<slug>.md to the repo via the GitHub API. Heroku auto-deploys on push. Returns commit SHA.',
        inputSchema: {
          submission_id: z.string().min(1),
          admin_token: z.string().min(1),
        },
      },
      async ({ submission_id, admin_token }) => {
        const gate = tokenGate(admin_token, adminToken, 'approve_pending');
        if (!gate.ok) {
          return { isError: true, ...jsonContent({ ok: false, error: gate.message }) };
        }
        const result = await submissions.approve(submission_id);
        if (!result.ok) {
          return { isError: true, ...jsonContent(result) };
        }
        return jsonContent(result);
      },
    );

    server.registerTool(
      'reject_pending',
      {
        title: 'reject_pending',
        description:
          'Admin-only. Drop a pending submission. Reason is recorded so submission_status surfaces it to the submitter on poll.',
        inputSchema: {
          submission_id: z.string().min(1),
          admin_token: z.string().min(1),
          reason: z.string().min(1).max(280),
        },
      },
      async ({ submission_id, admin_token, reason }) => {
        const gate = tokenGate(admin_token, adminToken, 'reject_pending');
        if (!gate.ok) {
          return { isError: true, ...jsonContent({ ok: false, error: gate.message }) };
        }
        const result = submissions.reject(submission_id, reason);
        if (!result.ok) {
          return { isError: true, ...jsonContent(result) };
        }
        return jsonContent(result);
      },
    );
  }

  server.registerResource(
    'aiss-index',
    'aiss://index',
    {
      title: 'AI Success Story index',
      description: 'Pre-computed manifest of every published story. Refresh on dyno boot.',
      mimeType: 'application/json',
    },
    async (uri) => {
      const { articles } = corpus.snapshot();
      const manifest = buildIndexManifest({ articles, baseUrl: getBaseUrl() });
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(manifest, null, 2),
          },
        ],
      };
    },
  );

  return server;
}

function createStatelessTransport() {
  return new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
}

module.exports = {
  createMcpServer,
  createStatelessTransport,
  applyAtomicContextGuardrail,
  buildFetchStoryResponse,
  buildIndexManifest,
  PART_ORDER,
  SPEC_VERSION,
};
