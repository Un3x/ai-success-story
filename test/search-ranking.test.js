const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { loadArticles, tokenize } = require('../lib/articles.js');
const { buildBm25Index, searchStories } = require('../lib/search.js');
const { porterStem, STOPWORDS } = require('../lib/tokenize.js');

const ARTICLES_DIR = path.join(__dirname, '..', 'articles');

const CONFIDENCE_HIGH = 50;
const CONFIDENCE_MEDIUM = 25;

let corpus;
function getCorpus() {
  if (!corpus) {
    const { articles } = loadArticles(ARTICLES_DIR);
    const index = buildBm25Index(articles);
    corpus = { articles, index };
  }
  return corpus;
}

function topResults(situation, limit = 5) {
  const { articles, index } = getCorpus();
  const { results } = searchStories({ articles, situation, tags: [], limit, index });
  return results;
}

// ---------- Porter stemmer canonical pairs ----------

test('porter: canonical exact-stem pairs', () => {
  // Canonical Porter outputs. Stems are not always real English words; that is by design.
  const pairs = [
    ['running', 'run'],
    ['restarts', 'restart'],
    ['restarted', 'restart'],
    ['deploys', 'deploi'], // Porter step 1c rewrites trailing y→i after consonant+vowel
    ['deployed', 'deploi'],
    ['freelancers', 'freelanc'],
    ['queues', 'queue'],
    ['caches', 'cach'],
    ['agents', 'agent'],
    ['plugins', 'plugin'],
    ['fetches', 'fetch'],
    ['fetched', 'fetch'],
    ['testing', 'test'],
    ['tested', 'test'],
  ];
  for (const [input, expected] of pairs) {
    assert.equal(porterStem(input), expected, `${input} → ${expected}`);
  }
});

test('porter: morphological variants collapse to a shared stem (the load-bearing property)', () => {
  // The point of stemming is collision, not English spelling. Pairs that *should*
  // route to the same stem so a query matches an article that uses the variant.
  const groups = [
    ['restart', 'restarts', 'restarted'],
    ['deploy', 'deploys', 'deployed'],
    ['freelancer', 'freelancers'],
    ['queue', 'queues'],
    ['plugin', 'plugins'],
  ];
  for (const group of groups) {
    const stems = new Set(group.map(porterStem));
    assert.equal(stems.size, 1, `${JSON.stringify(group)} → multiple stems ${JSON.stringify([...stems])}`);
  }
});

test('porter: known edge case — deployment does NOT collide with deploy/deploys', () => {
  // Documented Porter wart: step-4 strips -ment, leaving 'deploy', which is not re-run
  // through step-1c. So 'deployment' → 'deploy' but 'deploys' → 'deploi'. Caller cost
  // is a missed collision in deployment-vs-deploys queries. Shipping the canonical
  // algorithm rather than patching the corpus-specific wart, per brief honest-limit.
  assert.equal(porterStem('deployment'), 'deploy');
  assert.equal(porterStem('deploys'), 'deploi');
  assert.notEqual(porterStem('deployment'), porterStem('deploys'));
});

test('porter: short words are returned untouched', () => {
  assert.equal(porterStem('a'), 'a');
  assert.equal(porterStem('it'), 'it');
  assert.equal(porterStem('cat'), 'cat');
});

// ---------- Tokenizer: stopwords + stemming ----------

test('tokenize: drops minimal stopwords before stemming', () => {
  const toks = tokenize('the deploys are broken in production');
  // 'the', 'are', 'in' are stopwords; 'deploys'→'deploi', 'broken'→'broken', 'production'→'product'
  assert.deepEqual(toks, ['deploi', 'broken', 'product']);
});

test('tokenize: morphological variants tokenize to the same stem', () => {
  assert.deepEqual(tokenize('restart'), tokenize('restarts'));
  assert.deepEqual(tokenize('deploy'), tokenize('deploys'));
});

test('tokenize: non-stopword high-IDF words survive', () => {
  // The NLTK minimal subset deliberately keeps 'not', 'against', 'between' — needed for debugging vocabulary.
  const toks = tokenize('not against between');
  for (const must of ['not', 'against', 'between']) {
    assert.ok(toks.some((t) => t.startsWith(must.slice(0, 3))), `expected stem of "${must}" in ${JSON.stringify(toks)}`);
  }
});

test('tokenize: NLTK minimal subset stopword count is fixed', () => {
  // The AI-36 scope writeup names "33-word minimal NLTK subset" but enumerates 40
  // words verbatim. The list is the operational artifact; the count is documentary.
  // Locking the exact size so future drift is visible.
  assert.equal(STOPWORDS.size, 40);
});

// ---------- AI-35 14-query regression battery ----------
//
// Pre-stemming baseline (from AI-35 findings comment) preserved per-query in `baseline`.
// Assertions only gate on the structural properties we want to defend going forward;
// the baseline-comment is for human review of drift, not for assertion.

const BATTERY = [
  {
    n: 1,
    situation: 'Heroku in-memory state wiped on deploy',
    canonical_slug: null, // coverage gap — article does not exist
    kind: 'gap',
    baseline_top: 'read-comments-on-recent-decisions @ 52.4 (pre-stem)',
  },
  {
    n: 2,
    situation: 'Agent tool freelancer reads project files when I expected isolation',
    canonical_slug: 'agent-tool-freelancers-share-my-filesystem-when-i-expected-isolation',
    kind: 'hit',
    baseline_top: '82.7 (pre-stem)',
  },
  {
    n: 3,
    situation: 'Submit a plugin to a marketplace via PR',
    canonical_slug: 'curated-github-catalogs-can-be-read-only-mirrors-not-pr-targets',
    kind: 'hit',
    baseline_top: '80.0 (pre-stem)',
  },
  {
    n: 4,
    situation: 'Plugin install not injecting system-prompt priming',
    canonical_slug: 'plugin-install-does-not-deliver-priming-when-the-body-is-in-skills',
    kind: 'hit',
    baseline_top: '98.2 (pre-stem)',
  },
  {
    n: 5,
    situation: 'WebFetch returned empty SPA shell from a deployed site',
    canonical_slug: null, // canonical article reverted in commit 00e7eb0
    kind: 'gap',
    baseline_top: 'follow-hrefs-not-typed-urls @ 53.3 spurious (pre-stem)',
  },
  {
    n: 6,
    situation: 'My server loses data on restart',
    canonical_slug: null, // synonym paraphrase of #1 — no article exists; Option B/C territory
    kind: 'paraphrase',
    baseline_top: 'pushback-twice @ 42.9 (pre-stem)',
  },
  {
    n: 7,
    situation: 'Subagent modifying files outside its work dir',
    canonical_slug: 'agent-tool-freelancers-share-my-filesystem-when-i-expected-isolation',
    kind: 'paraphrase', // true-synonym subagent↔freelancer; expect Option B/C to close
    baseline_top: 'tied @ 34.7 (pre-stem)',
  },
  {
    n: 8,
    situation: 'Drift between two copies of the same content',
    canonical_slug: null,
    kind: 'partial',
    baseline_top: 'pushback-twice @ 26.5 (pre-stem)',
  },
  {
    n: 9,
    situation: 'Ruby expression breaks because of a sentinel return',
    canonical_slug: 'separate-side-effect-from-control-flow-return',
    kind: 'hit',
    baseline_top: '97.2 (pre-stem)',
  },
  {
    n: 10,
    situation: 'Rails structural bug, but the file currently looks fine',
    canonical_slug: 'check-git-diff-before-structural-diagnosis',
    kind: 'partial',
    baseline_top: '32.2 (pre-stem)',
  },
  {
    n: 11,
    situation: 'Reviewing a path-prefixed static site',
    canonical_slug: 'follow-hrefs-not-typed-urls',
    kind: 'hit',
    baseline_top: '58.1 (pre-stem)',
  },
  {
    n: 12,
    situation: 'I fabricated an example in the middle of an argument',
    canonical_slug: 'spot-your-own-fabricated-example',
    kind: 'partial',
    baseline_top: '32.9 (pre-stem)',
  },
  {
    n: 13,
    situation: 'How do I bake sourdough bread?',
    canonical_slug: null,
    kind: 'negative',
    baseline_top: '17.1 (pre-stem)',
  },
  {
    n: 14,
    situation: 'What is the capital of France?',
    canonical_slug: null,
    kind: 'negative',
    baseline_top: '16.0 (pre-stem)',
  },
];

// Hits: canonical article must appear top-3. Score-magnitude assertion is loose
// (>= CONFIDENCE_MEDIUM) because post-stemming compression means not every
// obvious-fit clears 50 — that is the documented partial-fix shape per AI-36 Q2.
for (const tc of BATTERY.filter((t) => t.kind === 'hit')) {
  test(`battery #${tc.n} [hit]: ${tc.situation}`, () => {
    const top = topResults(tc.situation, 5);
    const top3Slugs = top.slice(0, 3).map((r) => r.slug);
    assert.ok(
      top3Slugs.includes(tc.canonical_slug),
      `expected ${tc.canonical_slug} in top-3, got ${JSON.stringify(top3Slugs)} (baseline: ${tc.baseline_top})`,
    );
    const canonicalScore = top.find((r) => r.slug === tc.canonical_slug).score;
    assert.ok(
      canonicalScore >= CONFIDENCE_MEDIUM,
      `expected score >= ${CONFIDENCE_MEDIUM}, got ${canonicalScore}`,
    );
  });
}

// Negatives: SCORE_FLOOR=10 should drop them entirely or leave them strictly
// below MEDIUM. A negative that surfaces above MEDIUM would mean the floor is
// too low or the corpus has stemming-induced false positives.
for (const tc of BATTERY.filter((t) => t.kind === 'negative')) {
  test(`battery #${tc.n} [negative]: ${tc.situation}`, () => {
    const top = topResults(tc.situation, 5);
    if (top.length === 0) return; // floor dropped everything — ideal
    for (const r of top) {
      assert.ok(
        r.score < CONFIDENCE_MEDIUM,
        `negative query surfaced ${r.slug} @ ${r.score} (>= ${CONFIDENCE_MEDIUM})`,
      );
    }
  });
}

// Gap/paraphrase/partial: no strict assertion. These are documented misses or
// vocabulary-mismatch failures the cheap-wins bundle is not expected to close.
// Test serves as observed-distribution telemetry — failure shape lives in the
// stdout, not in the assertion.
for (const tc of BATTERY.filter((t) => ['gap', 'paraphrase', 'partial'].includes(t.kind))) {
  test(`battery #${tc.n} [${tc.kind}]: ${tc.situation}`, (t) => {
    const top = topResults(tc.situation, 3);
    const summary = top.length === 0
      ? 'empty'
      : top.map((r) => `${r.slug}@${r.score}`).join(' | ');
    t.diagnostic(`baseline: ${tc.baseline_top}`);
    t.diagnostic(`observed: ${summary}`);
    if (tc.canonical_slug) {
      const found = top.find((r) => r.slug === tc.canonical_slug);
      t.diagnostic(`canonical (${tc.canonical_slug}): ${found ? `top-${top.indexOf(found) + 1} @ ${found.score}` : 'not in top-3'}`);
    }
  });
}
