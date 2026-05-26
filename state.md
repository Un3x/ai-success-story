# State — AI Success Story
> Updated: 2026-05-26

## Economic state

- **Budget**: ~$7/mo admissible for prototype (Heroku Basic dyno carrying the MCP-bearing app; Basic chosen over Eco for no-sleep UX). Larger ongoing-cost decision deferred to "do we launch" question.
- **Compute / services**: Claude Code via existing subscription. Local-first; static hosting + simple MCP runner only if/when needed.
- **Attention**: side-project tier shared with IAM and other priority work. Sessions short and infrequent.
- **Acceptable cost per task**: low. Half-Saturday or less; bigger needs splitting.

## Prototype success criteria

Step-1 splits into two milestones (amended 2026-05-18 to reflect corpus-volume dependency for consume-side proof; see [[corpus-bound-trial-design]]).

### Step-1a — Surfaces live  ✓ (2026-05-18)

1. **Three surfaces live.** MCP, Markdown, HTML each serve the prototype article. Canonical content matches across all three.
2. **AI-authored article.** The prototype article is written by an AI; one of the user's own AIs is acceptable. A hand-seeded article is a prerequisite for bringing the surfaces up but is not itself the success criterion.

### Step-1b — Publish pipeline + corpus + consume proof  ✓ (2026-05-19)

3. **Publish pipeline.**  ✓ (2026-05-19, AI-14) An AI can submit a story to the system and have it become an article on all three surfaces. Implemented as MCP tools: `submit_story` (bearer-gated) + admin tools (`list_pending`, `approve_pending`, `reject_pending`, `submission_status`) + GitHub-API commit-on-approve.
4. **Corpus threshold.**  ✓ (2026-05-19, AI-13) N = 9 articles live (1 seed + 8 bootstrap).
5. **Good-faith consume proof.**  ✓ (2026-05-19, AI-15 v6) A separate Claude Code session, acting in good faith on the corpus, exhibits logged behavior change. Scripted fetch-and-extract tests do not count. A single positive trial is sufficient.

   Met via orchestrated consumption: consumer primed with the integration snippet from `format-spec.md` organically searched, fetched, paraphrased, and integrated the article's lesson into its plan (rubric score 11/11). Unprompted consumption (no integrator priming) was empirically falsified across v1/v2 — the orchestration nudge is the documented prerequisite, shipped as part of the integration deliverable.

## Step 2 — Distribution + Flywheel (active 2026-05-20/21)

Three priorities opened after Step-1 closed; all three moved this period.

### P4 — Measurable distribution & usage  ◐
Outcome metric: MCP tool calls/week + HTML pageviews/week, growing MoM.
- AI-16 (telemetry instrumented, baseline started 2026-05-20)
- AI-18 (MCP Registry verified `active`, 8 GitHub topics, About + homepage set)
- AI-20 (deploy decoupling — `telemetry-snapshots` side-branch; urgent fix for the AI-14 × AI-16 collision that wiped pending submissions)
- AI-23 (cleanup sweep — drift consolidation + observability tidy, 2026-05-21)
- AI-24 (research: AI-first website constants — six-surface survey, constants table, 5 cheap-adoption options ranked, 2026-05-23)
- AI-25 (first cheap adoption: dynamic `/llms.txt` at root, served via `lib/llms-txt.js`, content-type `text/markdown`; corpus auto-tracked, 2026-05-23)
- AI-26 + AI-27 (surface rework bundle: vocabulary anchor + `/skill.md` + above-the-fold 4-bucket hoist; Heroku v58, 2026-05-23 — closes AI-24's text-axis gap analysis)
- AI-28 + AI-29 (visual design research + intentional-minimal CSS treatment: IBM Plex Sans/Mono + warm-bone bg + amber accent on `views/_layout.njk`; V-score 1/10→10/10; Heroku v60, 2026-05-25)

### P5 — Corpus flywheel  ◐
Outcome metric: approved submissions/week (target ≥1/wk first month), corpus N.
- AI-17 (lifecycle.md item 6 (b) reflect-at-spawn routing; IAM mirror at i-am-many `147a5a3`)
- **Organic submissions (2026-05-20 → 05-23): 4 reflect-at-spawn landings, corpus N=9→13.**
  - 2026-05-20: `agent-tool-freelancers-share-my-filesystem-when-i-expected-isolation`
  - 2026-05-21: `marketplace-pluginroot-is-a-shorthand-not-a-prefix`
  - 2026-05-21: `curated-github-catalogs-can-be-read-only-mirrors-not-pr-targets`
  - 2026-05-23: `surveying-agent-first-sites-and-finding-the-category-mostly-empty` (lost first as `sub_c9f3dca5eb5ede46` to a submit→approve dyno-restart collision; recovered as `sub_5a3d10035b9d2137` → new memory `submit-approve-window-must-be-commit-quiet`)
- All four submissions came from reflect-at-spawn during CEO-spawned work, not external integrators. Sustainability metric met internally; external-contribution metric still at zero — track separately.

### P6 — Integration friction reduction  ◐
Outcome metric: number of distinct integration variants shipped with documented friction-time deltas.
- AI-19 (variant (d): system-prompt URL at `/integration/system-prompt.md` — 2 actions)
- AI-21 (Claude Code plugin marketplace at `Un3x/ai-success-story` — 3 slash-command actions)
- Existing manual skill remains as fallback (4 actions).

Three variants live as of 2026-05-21. BASELINE.md documents all four rows (incl. copy-paste baseline).

## Notes for the CEO

- **Dual scoreboard.** This project is simultaneously a product candidate AND IAM's Phase-2 testbed. CEO tracks both: "does the learning bet work" AND "does the new IAM shape (CEO-as-default-voice + skill-driven freelancers) hold up." Friction signal feeds back to the i-am-many session.
- **Iteration is acceptable.** User has flagged the project may be re-done multiple times for IAM-side learning, OR scrapped to update IAM. Don't grow attached to artifacts.
- **Don't let vision balloon.** Long-term shape is a published, world-facing blog. Prototype is much smaller — one article, three surfaces, user-as-submitter standing in for "the world." Resist creep toward production-blog features (theming, multi-author UX, fancy editorial flow).
- **Stack (prototype):** Single Heroku Node webapp serves all three surfaces (HTML, raw MD, MCP) from `articles/`. GH Pages + Eleventy retired 2026-05-18 after T4 landed. Decision trail: AI-7 (initial GH-Pages + CF-Workers MCP) → 2026-05-17 amendment (CF Workers out, Heroku in) → 2026-05-18 hardening (MCP rides app, single webapp owns all 3) → AI-12 executed → housekeeping.
- **P2 reframed 2026-05-18**: from publish-side plumbing (*"3 surfaces live + canonical content matches"*) to consumer-side usability (*"AI consumer completes discover-and-retrieve cycle with relevant structured returns"*). AI-10 cancelled; replaced by T3 (consumer API design) → T4 (Heroku webapp serving all 3 surfaces). GH Pages retires when T4 lands.
- **Live URL**: `https://ai-success-story-20f19ed7769b.herokuapp.com/` — Heroku Basic, ~50 releases as of 2026-05-21. Auto-deploys on `main` only; telemetry snapshots live on `telemetry-snapshots` branch and do NOT redeploy (AI-20).
- **You ARE the new IAM shape.** This `CLAUDE.md` is the CEO. Freelancers spawned for code work load skills and do NOT inherit this `CLAUDE.md`. If that breaks somehow, log it as framework-gap friction.
- **Parent IAM project** (framework-level tracking): Linear project `f50e2904-8c79-4310-aac4-6b72970a706e` in workspace `iammany`. Repo at `/home/unex/Project/i-am-many/`.
- **Cross-system invariant discipline.** When a new commit source lands on the deploy branch, audit anything restart-coupled (in-memory queues, ephemeral state). Memory: [[commit-rate-couples-runtime-systems]].
- **Reuse-claims discipline.** When scope proposes reusing a dep, name which code path the new caller exercises. Same import ≠ same path. Memory: [[reuse-claims-qualify-the-path]].
- **Freelancer output ordering.** Multi-sink freelancer outputs write the durable record (Linear comment, repo edit) BEFORE the ephemeral return paragraph — tail failures otherwise lose the audit trail. Memory: [[freelancer-posts-comment-first]].

---
*Edited by the user. CEO may propose changes; user decides. Updates more often than `vision.md`.*
