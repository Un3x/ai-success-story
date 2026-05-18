# Lifecycle — IAM Workflow Conventions

Operational reference for IAM-managed projects. The CEO follows this; freelancer briefings cite it; the user can audit against it.

## Framework conventions

These conventions apply across all template and derived files in an IAM-managed project.

### Audience tagging (C1)

`setup.md` is dual-audience: parts are imperative instructions for the setup-runner, parts are descriptive handoff for the CEO. Every section in `setup.md` carries an explicit audience tag at the top, with exactly two values:

- `Audience: setup-runner` — imperative; describes actions the runner takes.
- `Audience: CEO` — descriptive / handoff; describes what the CEO should expect or do once setup is complete.

Other template files are single-audience (CEO at runtime) and do not need per-section tags.

### Path resolution (C2)

**All paths in templates and derived files resolve from the project root.** In an instantiated IAM project:

- `vision.md` lives at the project root.
- `state.md` lives at the project root.
- `CLAUDE.md` (the derived CEO instance) lives at the project root.
- `lifecycle.md` and `setup.md` may live under `templates/` or be promoted to the project root; references inside `CLAUDE.md` and other files always assume root.

Before Step 4 of `setup.md` runs, `vision.md` and `state.md` exist only under `templates/` as their initial form. Step 4 promotes them to the project root. After setup, the `templates/` copies of `vision.md` and `state.md` are no longer the operational instances.

### Slot delimiter (C3)

Slots — placeholders that the setup-runner substitutes with project-specific values — use Mustache-style `{{X}}` delimiters. Examples: `{{PROJECT}}`, `{{DATE}}`.

**Rule: slots are the only `{{...}}` tokens; nothing else uses double braces.**

The square-bracket form `[X]` remains free for use as prose, documentation reference, or rhetorical placeholder. For example, the CEO template's generation footer mentions `{{PROJECT}}` as a documentation reference; this is not a slot marker at runtime and is not substituted.

## Task anatomy

Every task in IAM has:
- A **one-liner** (the user's original phrasing)
- A **pitch** (CEO's proper framing using strategic memory)
- A **scope** (defined by scoping freelancer, validated by CEO)
- An **execution plan** (which freelancers, in what order, with what budget)
- A **success metric** (deliverable check + impact score on parent priority)
- A **staleness budget** (default 14 days; CEO can propose different at creation)

## Default phases

`Pitch → Scope → Validate → Execute → Review → Report`

**Per-task adjustments are normal:**
- Add **Research** before Scope when the problem space is unclear
- Add **Spike** before Execute when uncertainty is high
- Add **User-test** after Review when changes affect user experience
- Skip **Review** for trivial, low-risk tasks (CEO judgment, document the call)

## Separation rule

Within any single task: **scoper ≠ executor ≠ reviewer**. Always.

Within a phase, multiple agents in parallel are fine (e.g., two reviewers reviewing different aspects). Between phases, agents are always different.

This dodges role-collapse and self-rationalization.

## Freelancer briefing format

Every freelancer spawn receives:

1. **Task scope** — precise, written
2. **Strategic context** — relevant excerpts from `vision.md` (not the whole file)
3. **Tool / file pointers** — what to read, what to query, what tools they have
4. **Expected output format** — what the freelancer must return
5. **Budget / timebox** — how much effort the CEO has authorized

Freelancers are **stateless and ephemeral**. They don't know prior work. They get briefed fresh on every spawn. The CEO holds the history.

## Spawn mechanism

A freelancer is spawned via a single call to Claude Code's `Agent` tool. The CEO supplies the full briefing (per `## Freelancer briefing format` above) as the `prompt` parameter, a short `description` (3–5 words), and `subagent_type: general-purpose`. Each call instantiates a fresh, stateless agent with no memory of prior runs; the tool returns the freelancer's output as a single message, which the CEO synthesizes into the report.

The CEO does not invent a spawn mechanism — `Agent` is the harness primitive. Briefing content is governed by the section above; this section only documents the operational mapping.

## Reporting format (every closed task)

The CEO writes a Linear comment containing:

- **What had to be done** — the brief
- **What was done** — the deliverable
- **Why** — the reasoning
- **Measured signal** — raw automated data with sources (MCP queries, analytics deltas, error rates, PR/commit metrics)
- **Judged impact** — interpretation; must cite measured signal; states confidence

If automated signal doesn't exist for an aspect, the CEO names the proxy and its limitations explicitly.

## Triggers

- **Metric-reached** — CEO re-evaluates priorities. Three default options: cheap-win extension, ladder up to a new metric, close the priority.
- **Staleness elapsed** — CEO surfaces the task in the next report with three default options: extend the budget, re-scope, cut.
- **User override** — always wins, takes effect immediately. CEO halts running freelancers if user says stop.

## Decisions

Significant strategic decisions go into Linear comments tagged with a `decision` label, or into a dedicated `decisions.md` if/when volume warrants. Not every task is a decision — only those affecting vision, priorities, or major scope.

## Approval gates

- **Scope validation** — CEO decides (launch / cut) per task, citing economic state
- **Next-task proposals** — user decides per CEO's report
- **Vision / state edits** — user only; CEO proposes
- **Metric definitions** — proposed by CEO at task creation; user can override

## Honest constraints

- The CEO is not autonomous; it runs when invoked
- Triggers don't fire on their own without scheduled invocations
- Cross-session memory depends on disciplined Linear writes
- Some impact is genuinely difficult to measure; the proxy must be named, not avoided
