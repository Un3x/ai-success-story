const MarkdownIt = require('markdown-it');

const md = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: false,
  breaks: false,
});

function renderMarkdownToHtml(markdown) {
  if (!markdown) return '';
  return md.render(markdown);
}

module.exports = { renderMarkdownToHtml };
