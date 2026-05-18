# State — AI Success Story
> Updated: 2026-05-18

## Economic state

- **Budget**: ~$5/mo admissible for prototype (Heroku Eco dyno carrying the MCP-bearing app). Larger ongoing-cost decision deferred to "do we launch" question.
- **Compute / services**: Claude Code via existing subscription. Local-first; static hosting + simple MCP runner only if/when needed.
- **Attention**: side-project tier shared with IAM and other priority work. Sessions short and infrequent.
- **Acceptable cost per task**: low. Half-Saturday or less; bigger needs splitting.

## Prototype success criteria

Step-1 success is met when ALL of the following hold (clarified 2026-05-16):

1. **Three surfaces live.** MCP, Markdown, HTML each serve the prototype article. Canonical content matches across all three.
2. **AI-authored article.** The prototype article is written by an AI; one of the user's own AIs is acceptable. A hand-seeded article is a prerequisite for bringing the surfaces up but is not itself the success criterion.
3. **Good-faith consume proof.** A separate Claude Code session, acting in good faith on the AI-authored article, exhibits logged behavior change. Scripted fetch-and-extract tests do not count. A single positive trial is sufficient for prototype.

## Notes for the CEO

- **Dual scoreboard.** This project is simultaneously a product candidate AND IAM's Phase-2 testbed. CEO tracks both: "does the learning bet work" AND "does the new IAM shape (CEO-as-default-voice + skill-driven freelancers) hold up." Friction signal feeds back to the i-am-many session.
- **Iteration is acceptable.** User has flagged the project may be re-done multiple times for IAM-side learning, OR scrapped to update IAM. Don't grow attached to artifacts.
- **Don't let vision balloon.** Long-term shape is a published, world-facing blog. Prototype is much smaller — one article, three surfaces, user-as-submitter standing in for "the world." Resist creep toward production-blog features (theming, multi-author UX, fancy editorial flow).
- **Stack (prototype):** GitHub Pages live for static (HTML + raw MD); decided AI-7, deployed AI-8. MCP surface rides the eventual Heroku app deploy (user-driven) — amended from original CF-Workers choice 2026-05-17, sequencing hardened 2026-05-18 (MCP not standalone). Three-surface success bar gates on the Heroku deploy.
- **P2 reframed 2026-05-18**: from publish-side plumbing (*"3 surfaces live + canonical content matches"*) to consumer-side usability (*"AI consumer completes discover-and-retrieve cycle with relevant structured returns"*). AI-10 cancelled; replaced by T3 (consumer API design) → T4 (Heroku webapp serving all 3 surfaces). GH Pages retires when T4 lands.
- **You ARE the new IAM shape.** This `CLAUDE.md` is the CEO. Freelancers spawned for code work load skills and do NOT inherit this `CLAUDE.md`. If that breaks somehow, log it as framework-gap friction.
- **Parent IAM project** (framework-level tracking): Linear project `f50e2904-8c79-4310-aac4-6b72970a706e` in workspace `iammany`. Repo at `/home/unex/Project/i-am-many/`.

---
*Edited by the user. CEO may propose changes; user decides. Updates more often than `vision.md`.*
