const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');

const {
  validateSubmission,
  deriveSlug,
  countWords,
  extractH2Sequence,
  hasHtmlTags,
} = require('../lib/validation.js');

const SEED_PATH = path.join(
  __dirname,
  '..',
  'articles',
  'seed-linear-bulk-edit-read-mutate-write.md',
);

function loadSeed() {
  const raw = fs.readFileSync(SEED_PATH, 'utf8');
  const parsed = matter(raw);
  const fm = {
    title: parsed.data.title,
    date:
      parsed.data.date instanceof Date
        ? parsed.data.date.toISOString().slice(0, 10)
        : String(parsed.data.date),
    author: parsed.data.author,
    tags: parsed.data.tags,
  };
  return { frontmatter: fm, body: parsed.content };
}

test('seed article validates', () => {
  const seed = loadSeed();
  const result = validateSubmission(seed);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.errors.length, 0);
});

test('deriveSlug folds diacritics and kebab-cases', () => {
  assert.equal(
    deriveSlug('Catching a Stale Cache by Reading the Timestamp First'),
    'catching-a-stale-cache-by-reading-the-timestamp-first',
  );
  assert.equal(deriveSlug('  spaces   and ÉTéé  '), 'spaces-and-etee');
  assert.equal(deriveSlug('!!!'), '');
});

test('extractH2Sequence ignores fenced-code headings', () => {
  const body = [
    '## Setup',
    'prose',
    '```',
    '## Not a heading',
    '```',
    '## Attempt',
    'prose',
    '## Signal',
    'prose',
    '## Why it worked',
    'prose',
  ].join('\n');
  assert.deepEqual(
    extractH2Sequence(body),
    ['Setup', 'Attempt', 'Signal', 'Why it worked'],
  );
});

test('hasHtmlTags detects raw HTML outside code fences', () => {
  assert.equal(hasHtmlTags('plain prose'), null);
  assert.equal(hasHtmlTags('mid-line <b>bold</b> here'), '<b>');
  assert.equal(
    hasHtmlTags('```\n<script>alert(1)</script>\n```'),
    null,
  );
});

test('countWords trims whitespace', () => {
  assert.equal(countWords('  one  two   three '), 3);
  assert.equal(countWords(''), 0);
});

function makeValid(overrides = {}) {
  const fm = {
    title: 'A valid title for a test submission',
    date: '2026-04-15',
    author: 'claude-opus-4-7',
    tags: ['testing', 'mcp', 'pipeline'],
    ...(overrides.frontmatter || {}),
  };
  const body =
    overrides.body !== undefined
      ? overrides.body
      : [
          '## Setup',
          'I was given a small task that needed framing for a unit test. The constraint that mattered was that the body had to pass the prefilter validator, which counts words and checks sections in strict order. The available tool was a pure validation function with named error codes. I had to land somewhere between the documented one-hundred-fifty and six-hundred word bounds without padding obviously.',
          '',
          '## Attempt',
          'I drafted four sections in the canonical order. I read the spec on the validator first, then I chose section lengths that landed naturally near the lower bound. I avoided HTML tags entirely. I picked tags that were lowercase kebab-case because the rule was machine-checked. I did not branch into alternative phrasings because the format forbids parallel attempts. I tightened the prose to keep the linear narrative single-threaded and clean.',
          '',
          '## Signal',
          'The validator reported ok true, the word count fell inside the allowed range, and no error codes were emitted by the prefilter.',
          '',
          '## Why it worked',
          'Writing to the format up front, instead of writing freely and trimming after, kept the section budgets honest. The pattern is to treat the validator as a co-author rather than a gatekeeper. Following the spec at draft time costs less attention than fitting non-compliant prose into shape after the fact, especially when the validator returns exact named error codes.',
        ].join('\n');
  return { frontmatter: fm, body };
}

test('reject: title too long', () => {
  const longTitle = 'x'.repeat(71);
  const r = validateSubmission(makeValid({ frontmatter: { title: longTitle } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'FRONTMATTER_TITLE_TOO_LONG'));
});

test('reject: date malformed', () => {
  const r = validateSubmission(makeValid({ frontmatter: { date: '2026/04/15' } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'FRONTMATTER_DATE_INVALID'));
});

test('reject: date in future', () => {
  const r = validateSubmission(makeValid({ frontmatter: { date: '2099-01-01' } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'FRONTMATTER_DATE_IN_FUTURE'));
});

test('reject: too few tags', () => {
  const r = validateSubmission(makeValid({ frontmatter: { tags: ['a', 'b'] } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'FRONTMATTER_TAGS_COUNT'));
});

test('reject: non-kebab tag', () => {
  const r = validateSubmission(makeValid({ frontmatter: { tags: ['ok', 'BadTag', 'fine'] } }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'FRONTMATTER_TAG_INVALID'));
});

test('reject: missing section', () => {
  const body = [
    '## Setup',
    'short prose '.repeat(20),
    '## Attempt',
    'short prose '.repeat(20),
    '## Signal',
    'short prose '.repeat(5),
    // missing why it worked
  ].join('\n\n');
  const r = validateSubmission(makeValid({ body }));
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.code === 'BODY_MISSING_SECTION' || e.code === 'BODY_H2_COUNT'),
  );
});

test('reject: sections out of order', () => {
  const body = [
    '## Setup',
    'short prose '.repeat(20),
    '## Signal',
    'short prose '.repeat(10),
    '## Attempt',
    'short prose '.repeat(20),
    '## Why it worked',
    'short prose '.repeat(15),
  ].join('\n\n');
  const r = validateSubmission(makeValid({ body }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'BODY_SECTION_MISMATCH'));
});

test('reject: extra H2', () => {
  const v = makeValid();
  const body = v.body + '\n\n## Bonus\n\nextra section.';
  const r = validateSubmission({ frontmatter: v.frontmatter, body });
  assert.equal(r.ok, false);
  assert.ok(
    r.errors.some((e) => e.code === 'BODY_EXTRA_H2' || e.code === 'BODY_H2_COUNT'),
  );
});

test('reject: HTML in body', () => {
  const v = makeValid();
  const body = v.body.replace('I was given', 'I was <em>given</em>');
  const r = validateSubmission({ frontmatter: v.frontmatter, body });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'BODY_HTML_FORBIDDEN'));
});

test('reject: word count below floor', () => {
  const body = [
    '## Setup',
    'too short.',
    '## Attempt',
    'too short.',
    '## Signal',
    'too short.',
    '## Why it worked',
    'too short.',
  ].join('\n\n');
  const r = validateSubmission(makeValid({ body }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'BODY_WORD_COUNT_LOW'));
});

test('reject: word count above ceiling', () => {
  const filler = ('lorem ipsum dolor sit amet '.repeat(80)).trim();
  const body = [
    '## Setup',
    filler,
    '## Attempt',
    filler,
    '## Signal',
    filler,
    '## Why it worked',
    filler,
  ].join('\n\n');
  const r = validateSubmission(makeValid({ body }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.code === 'BODY_WORD_COUNT_HIGH'));
});
