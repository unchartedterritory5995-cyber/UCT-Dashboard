# PR: first-call ratchet: new action families cannot silently displace existing capabilities

Owner directive (11-11): "Ensure new action families cannot silently displace existing capabilities." Until now, every family re-merge needed a hand-made "first calls, master vs merged" table (in→out rows, e.g. `evidence/wordsonly-fill/v2-first-calls.md`) to catch displacement. This PR turns that method into a permanent CI rail.

Files:
- `app/src/agent/qa/firstCallRatchet.test.js` (the rail)
- `app/src/agent/qa/firstCallRatchet.baseline.json` (the baseline: ids only, no request text)

## What it measures

The rail uses the same method as the wordsonly-fill evidence dump. Each request is routed through **v1** (`routeManifest`) and **v2** (`routeManifestV2`) exactly as the first call is built: the charts ctx (`surface: charts`, createIndicator, manageIndicators), the production `limit` / `routingThreshold` budget, lexicon typo readings, `routingNames(null)`, the catalog registered, and the case's own `recentActions` / `after`. A request is **IN** when at least one of its expected plans is fully inside the first call's manifest.

The sets are every set that has an expectation:

| set | expectation |
|---|---|
| NLM-1 dev paraphrases | `needs` |
| NL-1 `corpus.json`, `dev-nl1.json` (each turn, no history), `heldout-v1.json`, `heldout-v2.json` | `expect.ops` / `expect.alt` |
| agentExec widget / list / name / door / journal / search held-out, and widget / widget2 / list / journal tune | the action the reach test measures (`widget.setOption` / `chart.setSetting` / `widget.sendToJournal`) |

That gives **789 requests with an expectation**.

Not included:
- The lookbehind regex-equivalence corpus (`noLookbehind/baseline.json corpus.routing`). It has no expected action, so it has nothing to ratchet.
- agentExec held-out rounds 3–6. They carry no single per-set expected action.

Held-out sets are recorded by id only. Neither the rail nor the baseline holds any request text.

Ids:
- NL: `<file>:<case id>[#turn]`
- NLM-1: `nlm1-dev[i]`
- agentExec: `<set>[i]:<row>` (the index makes rows that share a coverage row unique; a test asserts that ids are unique)

## The rule (shrink-only; nothing grows silently)

- **An id the baseline holds as IN that is now OUT fails the rail.** The rail fails for v1 and for v2 separately. Each displaced id is listed with its set, router, expected action(s) and the groups the first call selected.
- **A request that is now IN but not in the baseline passes.** It is printed as "newly IN — NOT added". The baseline is never grown automatically.
- **A baseline id whose request no longer exists fails.** Ids are not allowed to disappear quietly either.

## Updating the baseline (legitimately)

Update the baseline only when a request is deliberately moved out of the first call, or when you are accepting newly IN ids, and only with the Lead's / AUDIT's OK, which you record in the PR that changes the baseline. Regenerate from master only:

```
git fetch origin
# in a worktree whose app/ is exactly origin/master (this rail's two files aside)
cd app
UPDATE_FIRST_CALL_RATCHET=1 npx vitest run src/agent/qa/firstCallRatchet.test.js
```

The regen has three guards:
- It is **refused when `CI` is set**. Verified: `CI=1 UPDATE_FIRST_CALL_RATCHET=1` fails, and the file is left byte-identical.
- It is **refused unless `git diff --name-only origin/master -- app/` is empty** (the rail's own test and baseline excluded), whether the differences are committed or not. A branch can never be the source.
- It is refused if request ids are not unique.

The baseline header records `generatedFrom: origin/master`, `masterSha`, the date, the regen command, and the counts.

## Baseline (this PR)

Generated from origin/master `8660b436159c80e733ab094f32dc9750ba36e5db`:

| router | IN | of |
|---|---:|---:|
| v1 | **643** | 789 |
| v2 | **676** | 789 |

These match the counts the wordsonly-fill evidence reported (v1 ≈ 643, v2 676).

## Runtime

Measured locally on Windows (Node, vitest 4.0.18), three runs of the file alone with `CI=1`:

| run | vitest `Duration` | routing work (1,578 first calls) |
|---|---:|---:|
| 1 | 7.53 s | 996 ms |
| 2 | 8.60 s | 1,385 ms |
| 3 | 7.98 s | 1,009 ms |

Most of the wall time is the import / transform of the catalog and routing modules, which the shard already pays for in other files. The `tests` phase reports 3–4 ms because the routing runs at collection time.

The rail is deterministic: no network, no model, no clock.

## CI

The file lives under `app/src/agent`, so `AGENT_VITEST_PATHS` (`src/agent …`) picks it up in agent-ci's four browser shards, and the master deploy gate picks it up through `vitest run src/agent`.

Shard checks:
- `vitest list src/agent --filesOnly` lists it once.
- `node scripts/vitest-shard-plan.mjs 4` puts it in shard 4.
- `python tools/vitest_shards.py --prove` reports `PARTITION PROVED: 4721 files, 4 shards, union = full, no overlap, none missing`.

## Mutants (each restored with `git checkout -- app/src/agent/routing.js`; tree clean after each)

### (a) Grow an ordinary fill group by one action

Change: `alerts.actions` gains `news.latest`. The rail goes **RED: 16 displaced**.
- 6 are v1: `corpus.json:mi-05`, `heldout-v1.json:h-ref-10`, `heldout-v2.json:h2-data-04`, `h2-data-11`, `h2-typo-08`, `nlm1-dev[90]`.
- 10 are v2: the same six, plus collateral displacement of other families by the grown group: `agentExec widget held-out[3]:C3-172` (widget.setOption), `agentExec widget tune[14]:C3-148` (widget.setOption), `heldout-v1.json:h-screen-08` (screener.run), `heldout-v2.json:h2-ref-02` (news.latest).

Each line names the expected action and the selected groups. For example, `… [v1] · expected news.latest · groups data,agent`.

### (b) Make a wordsOnly group non-wordsOnly

Change: `compareGroups` loses `wordsOnly: true`. The rail goes **RED: 4 displaced**: `nlm1-dev[128]`, `[129]`, `[130]`, `[131]` (v1, expected `agent.undo`). In each, the first call now carries `compareGroups` as filler and `undo` is cut.

The same change on `watchlistShow` is also **RED: 1 displaced**: `agentExec widget tune[14]:C3-148` (v2, widget.setOption; `watchlistShow` back in the fill).

### (c) AUDIT: drop one action from its group

Change: `widget.sendToJournal` is removed from `boardEdit.actions`, so it falls back by domain to `workspace`. The rail goes **RED: 3 displaced**, all v2:
- `agentExec journal held-out2[1]:C3-156` (expected widget.sendToJournal)
- `agentExec widget held-out[3]:C3-172`
- `agentExec widget tune[14]:C3-148`

The same run also exercised the no-silent-growth path. It printed 4 newly-IN ids (`agentExec journal tune2[2]:C3-163` [v1], `heldout-v2.json:h2-screen-02`, `agentExec widget tune[5]:C3-166`, `agentExec widget tune[15]:C3-151` [v2]), marked "NOT added", and the baseline file was unchanged.

## Also run (this branch)

These files ran together: the 4 count pins (agentRouting, agentScreener, agentNl1Selection, agentIndicatorsM2), `src/noRegexLookbehind.test.js`, `nlm1Routing`, and the ratchet. Result: **7 files, 153/153 passed** (14.35 s). The shard partition proof is in the CI section above. There are no lookbehind regexes in the new code.

<!-- agent-ci-required validation 5b: non-agent branch that only merges master (own diff: docs only) — expect success, no Agent run. Close unmerged. -->
