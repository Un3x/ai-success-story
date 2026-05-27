// Porter stemmer ported from Martin Porter's 1980 reference algorithm
// (public domain; reference JS port at tartarus.org/martin/PorterStemmer/js.txt).
// Stopword list is NLTK's English minimal-subset (high-frequency function words only).

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'at', 'by',
  'for', 'with', 'about', 'to', 'from', 'in', 'on',
  'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did',
  'this', 'that', 'these', 'those',
  'i', 'you', 'my', 'your', 'it', 'its',
]);

const step2list = {
  ational: 'ate', tional: 'tion', enci: 'ence', anci: 'ance', izer: 'ize',
  bli: 'ble', alli: 'al', entli: 'ent', eli: 'e', ousli: 'ous',
  ization: 'ize', ation: 'ate', ator: 'ate', alism: 'al', iveness: 'ive',
  fulness: 'ful', ousness: 'ous', aliti: 'al', iviti: 'ive', biliti: 'ble',
  logi: 'log',
};

const step3list = {
  icate: 'ic', ative: '', alize: 'al', iciti: 'ic', ical: 'ic',
  ful: '', ness: '',
};

const c = '[^aeiou]';
const v = '[aeiouy]';
const C = c + '[^aeiouy]*';
const V = v + '[aeiou]*';

const mgr0 = new RegExp('^(' + C + ')?' + V + C);
const meq1 = new RegExp('^(' + C + ')?' + V + C + '(' + V + ')?$');
const mgr1 = new RegExp('^(' + C + ')?' + V + C + V + C);
const s_v = new RegExp('^(' + C + ')?' + v);

function porterStem(w) {
  if (w.length < 3) return w;

  let stem;
  let suffix;
  let firstch;
  let re;
  let re2;
  let re3;
  let re4;

  firstch = w.substring(0, 1);
  if (firstch === 'y') w = firstch.toUpperCase() + w.substring(1);

  // Step 1a
  re = /^(.+?)(ss|i)es$/;
  re2 = /^(.+?)([^s])s$/;
  if (re.test(w)) w = w.replace(re, '$1$2');
  else if (re2.test(w)) w = w.replace(re2, '$1$2');

  // Step 1b
  re = /^(.+?)eed$/;
  re2 = /^(.+?)(ed|ing)$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    re = mgr0;
    if (re.test(fp[1])) {
      re = /.$/;
      w = w.replace(re, '');
    }
  } else if (re2.test(w)) {
    const fp = re2.exec(w);
    stem = fp[1];
    re2 = s_v;
    if (re2.test(stem)) {
      w = stem;
      re2 = /(at|bl|iz)$/;
      re3 = new RegExp('([^aeiouylsz])\\1$');
      re4 = new RegExp('^' + C + v + '[^aeiouwxy]$');
      if (re2.test(w)) w = w + 'e';
      else if (re3.test(w)) {
        re = /.$/;
        w = w.replace(re, '');
      } else if (re4.test(w)) w = w + 'e';
    }
  }

  // Step 1c
  re = /^(.+?)y$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    stem = fp[1];
    re = s_v;
    if (re.test(stem)) w = stem + 'i';
  }

  // Step 2
  re = /^(.+?)(ational|tional|enci|anci|izer|bli|alli|entli|eli|ousli|ization|ation|ator|alism|iveness|fulness|ousness|aliti|iviti|biliti|logi)$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    stem = fp[1];
    suffix = fp[2];
    re = mgr0;
    if (re.test(stem)) w = stem + step2list[suffix];
  }

  // Step 3
  re = /^(.+?)(icate|ative|alize|iciti|ical|ful|ness)$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    stem = fp[1];
    suffix = fp[2];
    re = mgr0;
    if (re.test(stem)) w = stem + step3list[suffix];
  }

  // Step 4
  re = /^(.+?)(al|ance|ence|er|ic|able|ible|ant|ement|ment|ent|ou|ism|ate|iti|ous|ive|ize)$/;
  re2 = /^(.+?)(s|t)(ion)$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    stem = fp[1];
    re = mgr1;
    if (re.test(stem)) w = stem;
  } else if (re2.test(w)) {
    const fp = re2.exec(w);
    stem = fp[1] + fp[2];
    re2 = mgr1;
    if (re2.test(stem)) w = stem;
  }

  // Step 5
  re = /^(.+?)e$/;
  if (re.test(w)) {
    const fp = re.exec(w);
    stem = fp[1];
    re = mgr1;
    re2 = meq1;
    re3 = new RegExp('^' + C + v + '[^aeiouwxy]$');
    if (re.test(stem) || (re2.test(stem) && !re3.test(stem))) w = stem;
  }

  re = /ll$/;
  re2 = mgr1;
  if (re.test(w) && re2.test(w)) {
    re = /.$/;
    w = w.replace(re, '');
  }

  if (firstch === 'y') w = firstch.toLowerCase() + w.substring(1);
  return w;
}

function tokenize(text) {
  if (!text) return [];
  const folded = text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  const out = [];
  for (const raw of folded.split(/[^a-z0-9]+/)) {
    if (!raw) continue;
    if (STOPWORDS.has(raw)) continue;
    out.push(porterStem(raw));
  }
  return out;
}

module.exports = {
  tokenize,
  porterStem,
  STOPWORDS,
};
