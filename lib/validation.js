const TITLE_MIN = 1;
const TITLE_MAX = 70;
const AUTHOR_MIN = 1;
const AUTHOR_MAX = 60;
const TAGS_MIN = 3;
const TAGS_MAX = 6;
const BODY_WORDS_MIN = 150;
const BODY_WORDS_MAX = 600;

const REQUIRED_SECTIONS = ['Setup', 'Attempt', 'Signal', 'Why it worked'];
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function err(code, rule, offending_substring) {
  const out = { code, rule };
  if (offending_substring !== undefined) out.offending_substring = offending_substring;
  return out;
}

function deriveSlug(title) {
  if (typeof title !== 'string') return '';
  const folded = title
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const cleaned = folded.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned;
}

function todayUtcIso() {
  return new Date().toISOString().slice(0, 10);
}

function countWords(text) {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function extractH2Sequence(body) {
  const lines = body.split(/\r?\n/);
  const headings = [];
  let inFence = false;
  let fenceMarker = null;
  for (const line of lines) {
    const fence = line.match(/^(\s{0,3})(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[2][0];
      } else if (line.trim().startsWith(fenceMarker.repeat(3))) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) headings.push(m[1].trim());
  }
  return headings;
}

function hasHtmlTags(text) {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = null;
  const re = /<\/?[A-Za-z][^>]*>/;
  for (const line of lines) {
    const fence = line.match(/^(\s{0,3})(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[2][0];
      } else if (line.trim().startsWith(fenceMarker.repeat(3))) {
        inFence = false;
        fenceMarker = null;
      }
      continue;
    }
    if (inFence) continue;
    const m = line.match(re);
    if (m) return m[0];
  }
  return null;
}

function validateFrontmatter(fm, errors) {
  if (!fm || typeof fm !== 'object') {
    errors.push(err('FRONTMATTER_MISSING', 'frontmatter object required'));
    return;
  }

  const { title, date, author, tags } = fm;

  if (typeof title !== 'string' || title.length < TITLE_MIN) {
    errors.push(err('FRONTMATTER_TITLE_MISSING', 'title required, 1–70 chars'));
  } else if (title.length > TITLE_MAX) {
    errors.push(err('FRONTMATTER_TITLE_TOO_LONG', `title must be ≤ ${TITLE_MAX} chars`, title));
  }

  if (typeof date !== 'string' || !DATE_RE.test(date)) {
    errors.push(err('FRONTMATTER_DATE_INVALID', 'date must be YYYY-MM-DD', String(date ?? '')));
  } else {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      errors.push(err('FRONTMATTER_DATE_INVALID', 'date must be a real calendar date', date));
    } else if (date > todayUtcIso()) {
      errors.push(err('FRONTMATTER_DATE_IN_FUTURE', 'date must not be in the future', date));
    }
  }

  if (typeof author !== 'string' || author.trim().length < AUTHOR_MIN) {
    errors.push(err('FRONTMATTER_AUTHOR_MISSING', 'author required, 1–60 chars'));
  } else if (author.length > AUTHOR_MAX) {
    errors.push(err('FRONTMATTER_AUTHOR_TOO_LONG', `author must be ≤ ${AUTHOR_MAX} chars`, author));
  }

  if (!Array.isArray(tags)) {
    errors.push(err('FRONTMATTER_TAGS_MISSING', `tags must be an array of ${TAGS_MIN}–${TAGS_MAX} kebab-case strings`));
  } else {
    if (tags.length < TAGS_MIN || tags.length > TAGS_MAX) {
      errors.push(err('FRONTMATTER_TAGS_COUNT', `tags must have ${TAGS_MIN}–${TAGS_MAX} entries`));
    }
    for (const t of tags) {
      if (typeof t !== 'string' || !KEBAB_RE.test(t)) {
        errors.push(err('FRONTMATTER_TAG_INVALID', 'tag must be lowercase kebab-case', String(t)));
      }
    }
  }
}

function validateBody(body, errors) {
  if (typeof body !== 'string' || body.trim().length === 0) {
    errors.push(err('BODY_EMPTY', 'body required'));
    return;
  }

  const html = hasHtmlTags(body);
  if (html) {
    errors.push(err('BODY_HTML_FORBIDDEN', 'plain Markdown only — no HTML tags', html));
  }

  const headings = extractH2Sequence(body);

  if (headings.length !== REQUIRED_SECTIONS.length) {
    errors.push(err(
      'BODY_H2_COUNT',
      `body must contain exactly ${REQUIRED_SECTIONS.length} H2 sections`,
      headings.join(' | '),
    ));
  }

  for (let i = 0; i < REQUIRED_SECTIONS.length; i++) {
    const expected = REQUIRED_SECTIONS[i];
    const actual = headings[i];
    if (actual === undefined) {
      errors.push(err('BODY_MISSING_SECTION', `missing required H2 '${expected}' at position ${i + 1}`));
    } else if (actual !== expected) {
      errors.push(err(
        'BODY_SECTION_MISMATCH',
        `H2 at position ${i + 1} must be exactly '${expected}'`,
        actual,
      ));
    }
  }

  const extras = headings.filter((h) => !REQUIRED_SECTIONS.includes(h));
  for (const extra of extras) {
    errors.push(err('BODY_EXTRA_H2', `extraneous H2 '${extra}' — only the four required sections allowed`, extra));
  }

  const wc = countWords(body);
  if (wc < BODY_WORDS_MIN) {
    errors.push(err('BODY_WORD_COUNT_LOW', `body must be ${BODY_WORDS_MIN}–${BODY_WORDS_MAX} words (got ${wc})`));
  } else if (wc > BODY_WORDS_MAX) {
    errors.push(err('BODY_WORD_COUNT_HIGH', `body must be ${BODY_WORDS_MIN}–${BODY_WORDS_MAX} words (got ${wc})`));
  }
}

function validateSubmission({ frontmatter, body }) {
  const errors = [];
  validateFrontmatter(frontmatter, errors);
  validateBody(body, errors);
  return { ok: errors.length === 0, errors };
}

module.exports = {
  validateSubmission,
  deriveSlug,
  countWords,
  extractH2Sequence,
  hasHtmlTags,
  REQUIRED_SECTIONS,
  TITLE_MAX,
  AUTHOR_MAX,
  TAGS_MIN,
  TAGS_MAX,
  BODY_WORDS_MIN,
  BODY_WORDS_MAX,
};
