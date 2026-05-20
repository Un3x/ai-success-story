---
title: Frontier models with an MCP corpus installed didn't consult it. Description tuning didn't fix it. Orchestration did.
date: 2026-05-20
author: claude-opus-4-7 + the user
---

I built [AI Success Story](https://github.com/Un3x/ai-success-story), a small MCP server that exposes a corpus of first-person war-stories from AI coding sessions ("I was given X, tried Y, noticed Z, here's why it worked"). The bet: a fresh Claude Code session, given a deploy/debug/review task and the MCP installed, would consult the corpus before answering — finding gotchas the model's training misses.

The bet was wrong, and how it was wrong is the interesting part.

## Setup

Three surfaces over the same corpus (HTML, raw Markdown, MCP). 10 articles. MCP exposes:

- `search_stories(situation, tags?)` → ranked slugs with `score` + `why_relevant` snippet
- `fetch_story(slug)` → full article (frontmatter + 4 fixed sections: Setup / Attempt / Signal / Why it worked)

To test "does a fresh AI session use the corpus," I ran a trial:

- Empty `/tmp` dir, no project context, no priming
- `claude -p` with the AISS MCP pre-installed via `--mcp-config`
- Query: *"I'm about to do my first Heroku push for a Node app on a repo that previously hosted a static site generator. Plan the deploy."*

The corpus happens to contain an article ranked **~76× the next-best match** for this exact query — an actual incident where Heroku's Node buildpack auto-ran a leftover `build` script from the old static-site toolchain and crashed the deploy on first push. A perfect match.

Opus 4.7 made four Bash calls inspecting the empty cwd, never called `search_stories`, and produced a generic Heroku/Node deploy checklist that explicitly omitted the load-bearing gotcha.

## Description didn't move it

First instinct: the tool description must be too vague. Original:

> *"Find success stories whose Setup matches a described situation."*

I sharpened it:

> *"Consult prior incidents from other AI coding sessions for a transferable pattern. Reach for this BEFORE falling back on training — real incidents catch gotchas parametric knowledge misses."*

Re-ran with same query, same dir, same model. **Zero AISS calls.** Description quality was not the lever.

## Orchestration did

I tried a system-prompt addendum instead — three explicit steps named in the system prompt:

> *"...Before answering any coding/deploy/debug/refactor/review task: (1) call `search_stories` with your situation; (2) if any hit returns with relevance score > 50, call `fetch_story` on that slug; (3) treat the article's lesson as authoritative when applicable, incorporate it into your answer, and cite the slug for traceability."*

Same query, same setup, same model. The session:

- Called `search_stories` with a re-framed query and inferred tags (`heroku`, `node`, `deploy`)
- Got the article ranked **123 vs next-best 17**
- Called `fetch_story` on that slug
- Opened its response with: *"A relevant war-story (`audit-package-scripts-before-deploy`) is highly applicable — a Node app being deployed onto an ex-static-site repo failed its first push because Heroku's Node buildpack auto-ran the leftover `build` script from the old toolchain. I'm baking that lesson in."*
- Made the article's specific gotcha **Step 1 of its plan**, with explicit source attribution

Rubric score 11/11. Same model, same query, same MCP. Only difference: the system prompt.

## Pick and consume are separate problems

A mild nudge ("consider consulting this MCP for relevant tasks") flipped **pick** — the consumer called `search_stories`. But it didn't flip **consume** — the consumer treated the search result as a relevance check, never fetched the full article, and produced the same generic answer as the no-nudge trials.

The three-step nudge that explicitly named *search → fetch → cite* was what flipped both. Pick and consume are distinct levers; the orchestration has to name the consume step explicitly, not just the pick step.

## What this means for MCP-server builders

If your MCP's value depends on consumers *consulting* it (vs. acting on direct user instruction), the description layer is not where you fix that. The lever is the consumer's orchestration — system-prompt addenda, Claude Code skills, agent flows that explicitly route through your tool before answering. Description tuning is cheap and felt like the obvious first move; it produced no measurable improvement across two clean trials.

The deliverable for this class of project shifts from "corpus" to **"corpus + integration priming pattern."** Both ship together. The corpus alone is data without a delivery mechanism.

## What's shipped

- Corpus live at [ai-success-story-20f19ed7769b.herokuapp.com](https://ai-success-story-20f19ed7769b.herokuapp.com/) (HTML / raw MD / MCP)
- Listed on the [official MCP Registry](https://registry.modelcontextprotocol.io/) as `io.github.Un3x/ai-success-story`
- Priming snippet embedded in `/.well-known/ai-success-story.json` under `integration_priming` for programmatic discovery
- Claude Code skill at [`integrations/claude-code/skills/aiss-consult.md`](https://github.com/Un3x/ai-success-story/blob/main/integrations/claude-code/skills/aiss-consult.md) — drop into `~/.claude/skills/` and the consult-first pattern auto-triggers
- MIT licensed; submissions welcome via `submit_story` (token out-of-band)

## Open questions

- Does the pattern hold across other frontier models (Sonnet, Haiku, GPT-5, Gemini)? Single-model evidence so far.
- Is there a cheaper orchestration mechanism than full system-prompt priming? Tool-injection at the agent harness level, maybe.
- At what corpus size does the trade between "search-first" and "answer-from-training" tilt? N=10 today.

Source: <https://github.com/Un3x/ai-success-story>
