const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { PRIMING_SNIPPET_MD } = require('../lib/priming-snippet.js');

const PLUGIN_ROOT = path.resolve(__dirname, '..', 'plugins', 'aiss-consult');
const BUNDLED_SNIPPET = path.join(PLUGIN_ROOT, 'priming.txt');
const HOOK_SCRIPT = path.join(PLUGIN_ROOT, 'hooks', 'load-priming.js');
const HOOKS_JSON = path.join(PLUGIN_ROOT, 'hooks', 'hooks.json');

test('plugin priming.txt matches lib/priming-snippet.js PRIMING_SNIPPET_MD', () => {
  const bundled = fs.readFileSync(BUNDLED_SNIPPET, 'utf8').replace(/\s+$/, '');
  assert.equal(
    bundled,
    PRIMING_SNIPPET_MD,
    'plugins/aiss-consult/priming.txt drifted from lib/priming-snippet.js PRIMING_SNIPPET_MD — regenerate by writing PRIMING_SNIPPET_MD into priming.txt',
  );
});

test('plugin SessionStart hook script emits additionalContext matching PRIMING_SNIPPET_MD', () => {
  const stdout = execFileSync('node', [HOOK_SCRIPT], {
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT },
    encoding: 'utf8',
  });
  const payload = JSON.parse(stdout);
  assert.equal(payload.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.equal(payload.hookSpecificOutput.additionalContext, PRIMING_SNIPPET_MD);
});

test('plugin hooks.json declares SessionStart hook pointing at load-priming.js', () => {
  const hooks = JSON.parse(fs.readFileSync(HOOKS_JSON, 'utf8'));
  assert.ok(Array.isArray(hooks.hooks.SessionStart), 'expected hooks.SessionStart array');
  const entries = hooks.hooks.SessionStart.flatMap((g) => g.hooks || []);
  const cmds = entries.map((h) => h.command);
  assert.ok(
    cmds.some((c) => c && c.includes('load-priming.js')),
    `expected a SessionStart hook command referencing load-priming.js; got ${JSON.stringify(cmds)}`,
  );
});
