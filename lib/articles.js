const fs = require('node:fs');
const path = require('node:path');
const matter = require('gray-matter');
const { renderMarkdownToHtml } = require('./render.js');
const { tokenize } = require('./tokenize.js');

const SECTION_KEYS = ['setup', 'attempt', 'signal', 'why_it_worked'];

const HEADING_TO_KEY = {
  'setup': 'setup',
  'attempt': 'attempt',
  'signal': 'signal',
  'why it worked': 'why_it_worked',
};

function splitBodyIntoSections(body) {
  const lines = body.split(/\r?\n/);
  const sections = { setup: '', attempt: '', signal: '', why_it_worked: '' };
  let currentKey = null;
  const buffers = { setup: [], attempt: [], signal: [], why_it_worked: [] };

  for (const line of lines) {
    const m = line.match(/^##\s+(.+?)\s*$/);
    if (m) {
      const heading = m[1].trim().toLowerCase();
      const key = HEADING_TO_KEY[heading];
      if (key) {
        currentKey = key;
        continue;
      }
    }
    if (currentKey) {
      buffers[currentKey].push(line);
    }
  }

  for (const key of SECTION_KEYS) {
    sections[key] = buffers[key].join('\n').trim();
  }
  return sections;
}

function extractSentences(text) {
  if (!text) return [];
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (!collapsed) return [];
  const out = [];
  const re = /[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g;
  let match;
  while ((match = re.exec(collapsed)) !== null) {
    const s = match[0].trim();
    if (s) out.push(s);
  }
  return out;
}

function loadArticles(articlesDir) {
  const files = fs
    .readdirSync(articlesDir)
    .filter((f) => f.endsWith('.md'))
    .sort();

  const articles = [];
  for (const filename of files) {
    const filepath = path.join(articlesDir, filename);
    const raw = fs.readFileSync(filepath, 'utf8');
    const slug = filename.replace(/\.md$/, '');
    const parsed = matter(raw);
    const fm = parsed.data || {};
    const sections = splitBodyIntoSections(parsed.content || '');
    const html = renderMarkdownToHtml(parsed.content || '');

    const setupTokens = tokenize(sections.setup);
    const attemptTokens = tokenize(sections.attempt);
    const titleTokens = tokenize(fm.title || '');
    const tagTokens = Array.isArray(fm.tags) ? fm.tags.flatMap((t) => tokenize(String(t))) : [];

    const setupSentences = extractSentences(sections.setup);
    const attemptSentences = extractSentences(sections.attempt);

    const dateStr = fm.date instanceof Date
      ? fm.date.toISOString().slice(0, 10)
      : (typeof fm.date === 'string' ? fm.date : '');

    const article = {
      slug,
      filename,
      filepath,
      raw,
      frontmatter: {
        title: fm.title || slug,
        date: dateStr,
        author: fm.author || '',
        tags: Array.isArray(fm.tags) ? fm.tags.map(String) : [],
        ...(fm.source ? { source: String(fm.source) } : {}),
      },
      sections,
      html,
      tokens: {
        setup: setupTokens,
        attempt: attemptTokens,
        title: titleTokens,
        tags: tagTokens,
      },
      sentences: {
        setup: setupSentences,
        attempt: attemptSentences,
      },
    };
    articles.push(article);
  }

  // newest first by date desc, slug asc tiebreak
  articles.sort((a, b) => {
    if (a.frontmatter.date < b.frontmatter.date) return 1;
    if (a.frontmatter.date > b.frontmatter.date) return -1;
    return a.slug.localeCompare(b.slug);
  });

  const bySlug = new Map(articles.map((a) => [a.slug, a]));
  return { articles, bySlug };
}

module.exports = {
  loadArticles,
  tokenize,
  extractSentences,
  splitBodyIntoSections,
  SECTION_KEYS,
};
