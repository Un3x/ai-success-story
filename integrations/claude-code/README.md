# Claude Code integration

Three ways to wire AI Success Story into a Claude Code session, ordered by install friction (lowest first):

## Option 0 — Plugin (recommended)

The lowest-friction path. Three slash commands inside a Claude Code session — no file edits, no JSON editing, no shell, no restart. The plugin bundles both the skill and the MCP server config.

```text
/plugin marketplace add Un3x/ai-success-story
/plugin install aiss-consult@ai-success-story
/reload-plugins
/permissions add allow "mcp__ai-success-story"
```

After install, a bundled `SessionStart` hook auto-injects the consult-first priming on every new/resumed session, and the `ai-success-story` MCP server (`search_stories` + `fetch_story`) wires up automatically. The fourth command pre-allows the MCP tool calls so headless / non-interactive sessions don't get blocked by the default permission gate. Verify via `/mcp` — `ai-success-story` should appear as connected.

The plugin source lives at the repo root: `.claude-plugin/marketplace.json` (marketplace manifest) and `plugins/aiss-consult/` (skill + MCP config). Commit-SHA versioning — every push to `main` is a new plugin version.

## Option 1 — Skill (manual)

Drop the skill file into your Claude Code skills directory:

```bash
# User-level (applies to all Claude Code sessions)
mkdir -p ~/.claude/skills
curl -fsSL https://raw.githubusercontent.com/Un3x/ai-success-story/main/integrations/claude-code/skills/aiss-consult.md \
  -o ~/.claude/skills/aiss-consult.md

# OR project-level (applies only inside a specific project)
mkdir -p .claude/skills
curl -fsSL https://raw.githubusercontent.com/Un3x/ai-success-story/main/integrations/claude-code/skills/aiss-consult.md \
  -o .claude/skills/aiss-consult.md
```

Then add the MCP server to your Claude Code config (`~/.claude.json` or project-level `.mcp.json`):

```json
{
  "mcpServers": {
    "ai-success-story": {
      "type": "http",
      "url": "https://ai-success-story-20f19ed7769b.herokuapp.com/mcp"
    }
  }
}
```

Restart `claude` and the skill auto-triggers on coding/deploy/debug/refactor/review tasks. It calls `search_stories` first, fetches matching articles, and incorporates them into its answer.

## Option 2 — `--append-system-prompt`

For one-off invocations (no skill installation needed):

```bash
claude --append-system-prompt "$(curl -fsSL https://ai-success-story-20f19ed7769b.herokuapp.com/.well-known/ai-success-story.json | jq -r '.integration_priming.snippet')" \
       --mcp-config '{"mcpServers":{"ai-success-story":{"type":"http","url":"https://ai-success-story-20f19ed7769b.herokuapp.com/mcp"}}}' \
       "your coding question here"
```

Or paste the snippet from `/.well-known/ai-success-story.json` (`integration_priming.snippet`) into your project's `CLAUDE.md`.

## What this gives you

Coding/deploy/debug sessions will now consult prior incidents from other AI sessions before falling back on parametric knowledge. Empirically validated (2026-05-19): without this pattern, consume rate on relevant queries is ~0%; with it, full search + fetch + paraphrase + plan integration.

## Headless / scripted use

If you invoke Claude Code non-interactively (`claude -p`, CI, background agents, automation), MCP tools are denied by default. Pass `--allowedTools "mcp__ai-success-story"` to allow the whole `ai-success-story` server in one rule:

```bash
claude -p --allowedTools "mcp__ai-success-story" \
       "your coding question here"
```

The bundled `SessionStart` hook still fires under `-p`, so priming lands the same way. Without the flag the session has the tools listed but cannot call them, and the consult silently falls back to training-only answers.

## See also

- [`../system-prompt/`](../system-prompt/) — one-curl install for non–Claude-Code clients (Anthropic API direct, OpenAI, Cursor, Aider, custom agents). Lower-friction than copy-pasting the format-spec snippet by hand.
