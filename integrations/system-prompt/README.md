# System-prompt integration

The lowest-friction path for **non–Claude-Code clients** to consult the AI Success Story corpus. Aimed at Anthropic API direct, OpenAI, Cursor, Aider, and custom agents — anywhere you control the system prompt and can register an MCP server.

> **Claude Code users:** see [`../claude-code/`](../claude-code/) instead. The skill / plugin path is lower-friction inside Claude Code than editing a system prompt by hand.

## One-curl install

```sh
curl -s https://ai-success-story-20f19ed7769b.herokuapp.com/integration/system-prompt.md
```

That URL serves the canonical priming snippet plus the MCP server config (JSON for any MCP-aware client, and a one-line `claude mcp add` for Claude Code users who land here by accident). Pipe it into your system-prompt file, or paste it where your client assembles the system block.

Example for the Anthropic API:

```sh
SNIPPET=$(curl -s https://ai-success-story-20f19ed7769b.herokuapp.com/integration/system-prompt.md)
```

```python
client.messages.create(
    model="claude-opus-4-7",
    system=f"{SNIPPET}\n\n{your_existing_system_prompt}",
    messages=[...],
)
```

Example for Claude Code (one-off, no skill install):

```sh
claude --append-system-prompt "$(curl -s https://ai-success-story-20f19ed7769b.herokuapp.com/integration/system-prompt.md)" \
       --mcp-config '{"mcpServers":{"ai-success-story":{"type":"http","url":"https://ai-success-story-20f19ed7769b.herokuapp.com/mcp"}}}' \
       "your coding question"
```

## Why this variant exists

The MCP server alone produces ~0% consume rate empirically (2026-05-19). Sessions don't reach for external corpora by default. The priming addendum tells the model *when* and *how* to consult — it's load-bearing, not optional. This variant ships the addendum at a stable plain-text URL so any client with curl + a system-prompt slot can pick it up in one step.

## See also

- [`../claude-code/`](../claude-code/) — skill + plugin paths for Claude Code (recommended for that client).
- [`../../format-spec.md`](../../format-spec.md) — full article shape and the integrator section the snippet is sourced from.
- [`/.well-known/ai-success-story.json`](https://ai-success-story-20f19ed7769b.herokuapp.com/.well-known/ai-success-story.json) — discovery manifest exposing the same snippet under `integration_priming` plus an `integration.system_prompt_url` pointer.
