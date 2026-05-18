const { tokenize } = require('./articles.js');

const K1 = 1.2;
const B = 0.75;

const FIELD_WEIGHTS = {
  setup: 3.0,
  attempt: 1.5,
  title: 2.0,
};

const TAG_OVERLAP_WEIGHT = 1.0;
const PARAM_TAG_BOOST = 0.5;

const SCORE_FLOOR = 0.1;
const CONFIDENCE_HIGH = 2.0;
const CONFIDENCE_MEDIUM = 0.5;

function buildBm25Index(articles) {
  const fields = ['setup', 'attempt', 'title'];
  const index = {};
  for (const field of fields) {
    const docs = articles.map((a) => a.tokens[field] || []);
    const lengths = docs.map((d) => d.length);
    const totalLen = lengths.reduce((s, n) => s + n, 0);
    const avgdl = docs.length > 0 ? totalLen / docs.length : 0;

    const docFreq = new Map();
    for (const doc of docs) {
      const seen = new Set(doc);
      for (const tok of seen) {
        docFreq.set(tok, (docFreq.get(tok) || 0) + 1);
      }
    }

    const termFreqs = docs.map((doc) => {
      const tf = new Map();
      for (const t of doc) tf.set(t, (tf.get(t) || 0) + 1);
      return tf;
    });

    const N = docs.length;
    const idf = new Map();
    for (const [term, df] of docFreq.entries()) {
      // BM25 IDF (with the +1 smoothing variant; standard Robertson-Spärck-Jones)
      const v = Math.log(1 + (N - df + 0.5) / (df + 0.5));
      idf.set(term, v);
    }

    index[field] = { lengths, avgdl, termFreqs, idf, N };
  }
  return index;
}

function bm25Score(queryTokens, docIdx, field, index) {
  const { lengths, avgdl, termFreqs, idf } = index[field];
  const dl = lengths[docIdx];
  if (dl === 0) return 0;
  const tf = termFreqs[docIdx];
  let score = 0;
  for (const term of queryTokens) {
    const f = tf.get(term) || 0;
    if (f === 0) continue;
    const idfV = idf.get(term) || 0;
    const denom = f + K1 * (1 - B + B * (dl / (avgdl || 1)));
    score += idfV * ((f * (K1 + 1)) / denom);
  }
  return score;
}

function scoreArticle(article, articleIdx, queryTokens, paramTags, index) {
  const setupS = bm25Score(queryTokens, articleIdx, 'setup', index) * FIELD_WEIGHTS.setup;
  const attemptS = bm25Score(queryTokens, articleIdx, 'attempt', index) * FIELD_WEIGHTS.attempt;
  const titleS = bm25Score(queryTokens, articleIdx, 'title', index) * FIELD_WEIGHTS.title;

  const articleTagSet = new Set((article.frontmatter.tags || []).map((t) => String(t).toLowerCase()));
  const querySet = new Set(queryTokens);
  let tagOverlap = 0;
  for (const t of articleTagSet) {
    if (querySet.has(t)) tagOverlap++;
  }
  const tagOverlapS = tagOverlap * TAG_OVERLAP_WEIGHT;

  let paramTagS = 0;
  if (Array.isArray(paramTags) && paramTags.length > 0) {
    for (const pt of paramTags) {
      if (articleTagSet.has(String(pt).toLowerCase())) paramTagS += PARAM_TAG_BOOST;
    }
  }

  return setupS + attemptS + titleS + tagOverlapS + paramTagS;
}

function confidenceLabel(score) {
  if (score >= CONFIDENCE_HIGH) return 'high';
  if (score >= CONFIDENCE_MEDIUM) return 'medium';
  return 'low';
}

function sentenceScore(sentence, queryTokens) {
  const toks = tokenize(sentence);
  if (toks.length === 0) return 0;
  const tf = new Map();
  for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
  // Simple TF-only scoring with query-token coverage bonus.
  let s = 0;
  const seen = new Set();
  for (const q of queryTokens) {
    const f = tf.get(q) || 0;
    if (f > 0) {
      s += f;
      seen.add(q);
    }
  }
  // Tiny normalization so very long sentences don't dominate purely on length.
  return s / Math.sqrt(toks.length);
}

function truncateAtWordBoundary(text, max) {
  if (text.length <= max) return text;
  // leave room for the trailing ellipsis
  const room = max - 1;
  const slice = text.slice(0, room);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return cut.trimEnd() + '…';
}

function pickWhyRelevant(article, queryTokens) {
  const setupSents = article.sentences.setup;
  const attemptSents = article.sentences.attempt;

  const scored = [];
  for (const s of setupSents) scored.push({ sentence: s, source: 'setup', score: sentenceScore(s, queryTokens) });
  for (const s of attemptSents) scored.push({ sentence: s, source: 'attempt', score: sentenceScore(s, queryTokens) });

  if (scored.length === 0) return '';

  // Sort by score desc; ties prefer setup; secondary tiebreak: shorter sentence first to favour fitting.
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.source !== b.source) return a.source === 'setup' ? -1 : 1;
    return a.sentence.length - b.sentence.length;
  });

  const top = scored[0];
  const topScore = top.score;

  // Spec rule: within ±5% of top score, prefer Setup over Attempt.
  if (topScore > 0) {
    const tieBand = topScore * 0.05;
    const tied = scored.filter((c) => Math.abs(c.score - topScore) <= tieBand);
    const setupCandidates = tied.filter((c) => c.source === 'setup');
    if (setupCandidates.length > 0) {
      // Prefer setup in ties.
      // Resort the tied bucket: setup first, then by score desc.
      tied.sort((a, b) => {
        if (a.source !== b.source) return a.source === 'setup' ? -1 : 1;
        return b.score - a.score;
      });
      scored[0] = tied[0];
    }
  }

  // First try: highest-scoring sentence whose length ≤ 200 returned verbatim.
  const topPick = scored[0];
  if (topPick.sentence.length <= 200) return topPick.sentence;

  // Otherwise: highest-scoring sentence ≤ 200 chars (search down the list).
  const fitting = scored.find((c) => c.sentence.length <= 200);
  if (fitting) return fitting.sentence;

  // No fitting sentence: truncate the absolute top-scoring one at word boundary.
  return truncateAtWordBoundary(topPick.sentence, 200);
}

function searchStories({ articles, situation, tags, limit, index }) {
  const queryTokens = tokenize(situation);
  const allArticleTags = new Set();
  for (const a of articles) {
    for (const t of a.frontmatter.tags || []) allArticleTags.add(String(t).toLowerCase());
  }

  const unknownTags = [];
  const knownParamTags = [];
  if (Array.isArray(tags)) {
    for (const t of tags) {
      const norm = String(t).toLowerCase();
      if (allArticleTags.has(norm)) knownParamTags.push(norm);
      else unknownTags.push(String(t));
    }
  }

  const scored = articles.map((a, i) => ({
    article: a,
    score: scoreArticle(a, i, queryTokens, knownParamTags, index),
  }));

  // Drop below floor.
  const filtered = scored.filter((r) => r.score >= SCORE_FLOOR);

  // Sort: score desc, date desc, slug asc.
  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.article.frontmatter.date !== b.article.frontmatter.date) {
      return a.article.frontmatter.date < b.article.frontmatter.date ? 1 : -1;
    }
    return a.article.slug.localeCompare(b.article.slug);
  });

  const top = filtered.slice(0, limit);

  const results = top.map(({ article, score }) => ({
    slug: article.slug,
    title: article.frontmatter.title,
    author: article.frontmatter.author,
    date: article.frontmatter.date,
    tags: article.frontmatter.tags,
    score: Number(score.toFixed(4)),
    confidence: confidenceLabel(score),
    why_relevant: pickWhyRelevant(article, queryTokens),
  }));

  return { results, unknown_tags: unknownTags };
}

module.exports = {
  buildBm25Index,
  searchStories,
  confidenceLabel,
  pickWhyRelevant,
};
