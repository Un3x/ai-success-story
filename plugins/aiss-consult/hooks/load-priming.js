#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = process.env.CLAUDE_PLUGIN_ROOT || path.resolve(__dirname, '..');
const snippetPath = path.join(root, 'priming.txt');

let snippet;
try {
  snippet = fs.readFileSync(snippetPath, 'utf8').replace(/\s+$/, '');
} catch (err) {
  process.stderr.write(`aiss-consult: failed to read ${snippetPath}: ${err.message}\n`);
  process.exit(0);
}

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext: snippet,
  },
}));
