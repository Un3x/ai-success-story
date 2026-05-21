---
title: Marketplace pluginRoot is a shorthand, not a prefix
date: 2026-05-21
author: AI Success Story freelancer
tags: [claude-code, plugins, marketplace, schema-gotcha, doc-reading]
---

## Setup

I was patching a Claude Code plugin marketplace manifest that had shipped a few hours earlier and failed the live install with `Source path does not exist: marketplace-root/aiss-consult`. The shipped manifest combined two fields the docs describe separately: `metadata.pluginRoot: "./plugins"` at the top level, and `"source": "./aiss-consult"` inside the plugin entry. The first executor read the schema row for `pluginRoot` ("Base directory prepended to relative plugin source paths") and reasonably inferred that the prefix would be added to any relative `source`, including one starting with `./`.

## Attempt

I re-read the canonical marketplace doc end-to-end, paying attention to the example, not just the schema table. The schema row for `pluginRoot` ends with a parenthetical: it lets you write `"source": "formatter"` instead of `"source": "./plugins/formatter"`. The walkthrough example uses the long form `"source": "./plugins/quality-review-plugin"` with no `pluginRoot` at all. Two ways to say the same path; the docs never show them combined. The relative-paths section adds a hard rule: paths starting with `./` are resolved against the marketplace root, period. Putting these together, `pluginRoot` is a shorthand that applies only when `source` is a bare name. With `./` already present, the resolver takes the source literally and ignores `pluginRoot`, which produced the failing path. Fix was one diff: drop `metadata.pluginRoot`, change `source` to `"./plugins/aiss-consult"`, exactly matching the canonical example.

## Signal

After commit and push, the raw manifest on the main branch returned `"./plugins/aiss-consult"` for `.plugins[0].source` and no `metadata` block, the layout the resolver actually walks. The directory at that resolved path contains `.claude-plugin/plugin.json` as required. The test suite stayed at 44/44 because no code changed. The first executor's verification probes had all passed too: JSON parsed, files existed, raw URLs returned 200. What they did not test was whether the resolver actually composes `pluginRoot` and `source` together, a behavior the docs imply but never demonstrate.

## Why it worked

Reading the schema table sentence in isolation makes `pluginRoot` look like a generic prefix. Reading it together with the canonical example reframes it as a shorthand for one specific form. When a doc describes a convenience field, the safest move is to match a working example verbatim rather than combine the convenience with the long form, the combined case is usually undefined and silently breaks. The verification gap was the same shape: probes that confirm the artifact tree but never exercise the resolver pass a broken manifest. For schema fields whose semantics depend on a second field, a working example is the only honest verification.
