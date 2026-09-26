---
id: H-07
title: Migration and coexistence — the legacy parity matrix, the persisted-key ledger, and the gates that end a dual run
role: Cross-pod synthesizer (Group H) — migration / coexistence
wave: 3
group: H
category: synthesis
scope: TERMINAL-CURRENT (the live /calendar surface) beside TERMINAL-NEXT, read from origin/master 2e0598bfa; plus read-only cross-repo verification of morning-wire and uct-sunday-scan
confidence: 🟢 for code-resident mechanisms and persisted keys (every one re-derived at origin/master this pass) · 🟡 for the retirement base rate (n=3) · 🔴 for anything about how a member moves between two surfaces, which nothing in this estate records
evidence_ceiling: No Railway access and none attempted, so every flag state is unread and named as such. No production read, no browser, no test run. Whether a store holds rows is unmeasured except where a sibling already measured it. And the load-bearing behavioural question — does a member actually return to TERMINAL-CURRENT for anything — is unmeasurable from here: item 14's hand-off map records surface-to-surface transitions as watched by nothing, anywhere (workflow-library.md:1286 H11).
sources: 10-roadmap/coexistence-current-mechanisms.md (D-08) · 01-existing-system/terminal-current-map.md (D-09) · 10-roadmap/rollout-rollback.md (item 37, same H-07 role) · 05-product-strategy/capability-matrix/capability-matrix.md (item 9) · 05-product-strategy/non-goals.md (NG-08) · 04-workflows/{workflow-library.md,jobs-to-be-done.md} · 10-roadmap/mvp.md · 12-decisions/DECISION_CARDS_2026-09-26.md CARD 25 · origin/master (api/, app/src/, tools/, docs/)
uct_relevance: high
status: draft
date: 2026-09-26
---

# Migration and coexistence (gate item 26)

## 0. HOW TO READ THIS FILE

### 0.1 ⛔⛔ THE VOCABULARY, AND IT IS NOT A PEDANTRY

* **TERMINAL-CURRENT** is the shipped surface at route `/calendar`, display-named "UCT Terminal" since 2026-09-01.
* **TERMINAL-NEXT** is the product this programme is designing. It has no route, no door and no flag at `origin/master`.
* ⛔ **The rename was DISPLAY-ONLY and the plumbing is unchanged.** Re-verified this pass at `origin/master`: the route is still `/calendar` (`app/src/App.jsx:537`) with `/calendar/mystocks` (`:538`), the Zone D door **key** is still `calendar` while only its label reads "UCT Terminal" (`app/src/pages/dashboard/doors.js:22` — `{ key: 'calendar', label: 'UCT Terminal', to: '/calendar', icon: 'calendar' }`), the widget **type key** is still `calendar` (`app/src/widgets/registry.js:565`, bound at `app/src/pages/charts/WidgetHost.jsx:71`), and every `/api/calendar/*` path is unchanged.
* ⭐ **So searching the code for "terminal" finds the label, or the monitor service, and never the feature.** The one `TERMINAL_NEXT`-shaped thing on master is a separate Railway service for *reporting on this programme* (`api/routers/terminal_next_reports.py`, flag `TERMINAL_NEXT_MONITOR_ENABLED`), which is not a member surface and is not TERMINAL-NEXT.

⚠️ **One sibling-facing note, because it changes what this file is.** Neither item 13 nor item 14 ever states the display-name/plumbing distinction — they refer to the surface only as `/calendar` throughout. **This file is the first place in the programme's workflow and roadmap tiers that writes the distinction down beside a migration instruction**, which is precisely where getting it wrong would cost a key.

### 0.2 WHAT THIS FILE OWNS, AND THE FOUR SIBLINGS IT MUST NOT RESTATE

| Sibling | Owns | What I take from it, and never re-derive |
|---|---|---|
| **D-08** `10-roadmap/coexistence-current-mechanisms.md` | The mechanism inventory and the priced coexistence options | Its eight precedents, its touch-point edit list, its inbound-dependency map, its option pricing. ⛔ I **rule**; I do not re-price. |
| **D-09** `01-existing-system/terminal-current-map.md` | The capability map of TERMINAL-CURRENT | The capability spine my parity matrix's rows sit on |
| **item 37** `10-roadmap/rollout-rollback.md` | Rungs **S0–S4** and rollback **tiers 0–5** | ⭐ **Same H-07 role writes both** (`MASTER_CHECKLIST.md:32`, `:43`), so this is one authority writing its other half, not a second one. I cite `rollout-rollback.md:308-315` for the tiers and `:514-642` for the rungs and **never restate either table.** |
| **item 9** `05-product-strategy/capability-matrix/capability-matrix.md` | The outward coverage ledger and the **COVERED · GAP · STRUCTURAL BREAK-OUT** cell vocabulary (`:305-332`) | The vocabulary, adopted verbatim and pointed inward (§3) |

⭐ **What is left, and it is genuinely unclaimed.** Item 37 names items 23, 24, 25, 27–29, 36 and 37 in its scope disclaimers and **never names item 26**; it contains no occurrence of TERMINAL-CURRENT, coexistence, migration, dual-running, a persisted-preference-key rename, or the retirement of any surface. So the whole territory of *two products on one site, and how a dual run ends* is this file's, outright.

### 0.3 ⛔ TEN THINGS THIS FILE MAY NOT DO

1. ⛔ **It may not type a count.** Every number is derived and §9 prints the command that produced it.
2. ⛔⛔ **Before writing that TERMINAL-CURRENT lacks something, or that TERMINAL-NEXT must build it, it greps `origin/master`.** §1.1 is what that rule caught, and §8 lists everything I nearly wrote and then found already shipping. **A migration plan that promises to build what already exists is this document's most expensive possible error**, and this programme has paid for that class twice today already (item 14's two withdrawals, `workflow-library.md:1205`; CARD 24).
3. ⛔ **It does not trust the capability ledger.** Measured 2026-09-26 over seven re-derived cells: five understated, **one overstated** (`cap_universe.json` recorded 3,742, actual **3,640**), two exact (`capability-ledger.md:18`, re-derived at `capability-matrix.md:114-119`). **A ledger cell is a dated measurement whose error has no reliable sign**, and its characteristic failure is COVERAGE — silence — not accuracy.
4. ⛔ **Three states, never two: ABSENT · ADMIN-MOUNTED (or operator-only) · MEMBER-SERVING.** And **a fourth fact is independent of all three and never inferred from any of them: does the store actually hold rows?** That fourth fact decides two rows in §3 and it is the only reason §3 needs a fourth verdict value (§3.2).
5. ⛔ **It never asserts a flag state.** There is no Railway access on this pass and none was attempted. A code default is not a flag state. Every flag is named and marked **unread**.
6. ⛔ **No execution or order management** (`GOVERNING_PRINCIPLES.md` §13; NG-01..NG-03). A step needing a funded brokerage account is a **STRUCTURAL BREAK-OUT**, never a migration gap.
7. ⛔ **One paid tier.** The entitlement axis is a binary (`OWNER_SEED_FACTS.md:61`; CARD 17). ⛔ **There is no tier-staged migration in this file, and a cohort is not a tier** (`rollout-rollback.md:506-507`).
8. ⛔ **Costs and usage are DE-SCOPED by the owner**, verbatim 2026-09-26: *"Dont worry aobut anything else on costs or uses"* (CARD 25 §5). ⚠️ **Licensing is NOT** — cleared for data already accessed (CARD 26), open for any new source. A migration that changes no source raises no new licensing question, and §3 says so per row rather than carrying a licensing column that would be uniformly empty.
9. ⛔ **Two products, two populations.** UCT Intelligence is ~26 accounts, **13** with any page-view row, six of those roster admins; the Whop Discord (~750 paying) is a separate product outside this boundary (CARD 25 §3). §7 reckons with the 13 honestly instead of designing a cohort ladder for it.
10. ⛔ **No key rename.** NG-08, classed **PERMANENT** (`non-goals.md:99`). §4 is the ledger that makes that rule operable rather than merely stated.

### 0.4 ⭐⭐ WHY THIS ITEM MATTERS MORE THAN ITS TITLE, AND WHAT THAT DOES TO ITS SHAPE

**Owner, verbatim, 2026-09-26: "the goal is to aggreagte all the best features so someone can only use our site instead of the others."** (`DECISION_CARDS_2026-09-26.md:674`, CARD 25.)

⛔⛔ **Read that sentence against a dual run and it says something item 26 would otherwise never have to answer.** CARD 25 §1's arithmetic is *"any capability a competitor has and we lack is a reason a member keeps another tab open."* **A member who must go back to TERMINAL-CURRENT for one thing is keeping a tab open too.** The tab is ours, which changes who is embarrassed and changes nothing else: the work is still split across two surfaces, the member still holds the split in their head, and the thesis still fails for that task.

⭐ **So coexistence that never ends is a permanent internal break-out, and that is the finding that shapes this whole file.** Two consequences:

1. **The parity matrix in §3 is a coverage ledger pointed inward**, using item 9's own three-value vocabulary (`capability-matrix.md:305-332`) so the two ledgers can be read side by side without a second taxonomy.
2. **Coexistence needs an END CONDITION written at the same time as its beginning**, and the end condition is the parity matrix closing. A dual run with no stated end is not a migration strategy; it is a second product nobody decided to ship.

⚠️ **And the thesis has a documented dissent I am carrying rather than resolving**, because it constrains the method and not the goal: item 9 records both deep-dive pods arguing that feature-count parity is an anti-pattern (`capability-matrix.md:53-63`, anti-patterns N5/N7). ⭐ **Both survive here for the same reason they survive there: the unit is a task a member leaves to do, never a feature.** That is why §3's rows are capabilities-with-a-task and not a feature grid, and why §3 carries a verdict that lets a row be **retired rather than carried** (§3.2).

### 0.5 ⛔ THE UNIT, SAID ONCE SO NOBODY QUOTES A NUMBER WITHOUT IT

Item 9 records that the owner has not settled whether *"all the best features"* counts **jobs** or **features** (`capability-matrix.md:269-303`), and it built for both. **This file counts neither.** Its unit is **a row of TERMINAL-CURRENT's own surface that a migration must either carry, replace, or deliberately retire** — which is a third unit, and it is the only one under which the question *"is the dual run over"* has an answer. ⭐ **A parity matrix counted in jobs would close while a persisted key was still orphaned; counted in features it would never close at all.** Every number in §3 is a row count of that unit and says so.

### 0.6 THE DERIVING COMMANDS AND THE TWO SHAs

Every UCT-side fact below is read from `origin/master`, never from this worktree's working tree, which is a docs branch on an older master.

```bash
cd /c/Users/Patrick/uct-worktrees/terminal-research
git rev-parse HEAD origin/master
# de6b29face489869bc358a676309359d103ea668   (this docs branch)
# 2e0598bfa514303fe542c4473bd2f89470d04ec2   (origin/master — the authority)
```

⛔ **And one warning about my own instrument, because it nearly cost this file a false headline.** A compound-alternation `git grep -nE 'path="/calendar|path="/r/calendar' origin/master -- app/src/App.jsx` returned **only** the `/r/calendar` line, and I briefly had "the `/calendar` route no longer exists" in draft. The enumerate-then-filter form found all five:

```bash
git show origin/master:app/src/App.jsx | grep -nE '<Route path=' | grep -i calendar
# 495:  <Route path="/r/calendar" element={<CalendarRender />} />
# 537:  <Route path="/calendar" element={<Calendar />} />
# 538:  <Route path="/calendar/mystocks" element={<MyStocksHub />} />
# 636:  <Route path="calendar" element={<CalendarSurface />} />        <- the JOURNAL's, not ours (§3.4)
# 652:  <Route path="/journal-2-0/calendar/:date" element={<J2DayDetailPage />} />
```

⭐ **The rule this file follows as a result, and it generalises past this one command: enumerate the population, then filter it. Never make a compound pattern the census itself.** Two greps over the same blob for the same literal disagreed, and the one I ran first under-reported — `lesson_an_instrument_can_reproduce_its_own_blind_spot`, paid for again at no cost only because a second method ran.

---

## 1. HEADLINE — five findings, and the first one changes the plan

### 1.1 ⭐⭐ THE PER-USER COHORT IS NOT A GAP ANY MORE. IT SHIPS, IT IS IN PRODUCTION, AND THREE PROGRAMME DOCUMENTS SAY OTHERWISE

**OBSERVATION.** D-08's §6.2 is titled *"⭐ What does NOT exist — the gap for Stage 3"* and states: *"There is **no per-user, server-side feature flag or beta-cohort mechanism.** 'Selected members opt in' … cannot be expressed today"*, concluding *"Stage 3 (selected members) is the only stage that requires something new"* (`coexistence-current-mechanisms.md:529-540`). Item 37 carries the same finding forward as **S2 — "⛔ ABSENT today; the only rung that needs a build"** (`rollout-rollback.md:560`). Item 9, landed today, records `user_tags` as *"written and read by no gate"* — *"item 10's only **absent·absent** row"* (`capability-matrix.md` BRK-07).

⛔⛔ **All three are wrong at `origin/master`, and the artifact that makes them wrong is 347 lines long with its own operator CLI.**

**EVIDENCE.**
* `api/services/rollout.py` (**347 lines**, derived below) — *"S12 — ROLLOUT COHORTS."* A per-user cohort store over `user_tags` under a declared `ROLLOUT_PREFIX = "rollout:"`, with `tag_for`, `cohort_user_ids`, **`includes(user_id, cohort)`** — the per-user request-time read — `cohorts_for`, `seed_cohort_from_role`, **`assign_cohort`**, `seed_cohort_all_members`, **`remove_from_cohort`**, and `role_user_ids` kept *"ONLY so the no-op proof has an oracle"*.
* Its module header names exactly the gap D-08 named, in D-08's own terms: *"This app gates features four ways and NOT ONE OF THEM CAN NAME A PERSON: an env flag (whole service), a compiled constant (whole bundle, or a hash of the browser), a role check (`role == 'admin'`, app-wide), and a plan/entitlement (one subscription tier). The finest grain any of them reaches is 'every admin'."*
* **Owner-approved scope, dated after D-08 was written:** *"(owner, 2026-09-12)"*, two migrations, the second *"S7 flags become tag assignments; delete the bespoke role checks"*.
* **It is seeded at boot in production code** — `api/main.py:3451-3455` calls `_rollout.ensure_s7_dark_seeded()`, and `api/main.py:3433` records the swap in a comment: *"dark projections now read `user_tags` instead of `users.role = 'admin'`"*.
* **Seven alert-taxonomy projections gate on it** (derived below), each via `rollout.cohort_user_ids(rollout.S7_DARK)`.
* ⭐⭐ **And there is a second, unrelated cohort already in production, which proves the mechanism generalised past the feature it was built for:** `api/services/wisdom/publish/adapters/askai.py:55` — `return bool(rollout.includes(str(user_id), COHORT))` with `COHORT = "wisdom-askai"`.
* ⭐ **The operator door exists too, and it is not a hand-typed INSERT:** `tools/rollout_cohort.py` (**147 lines**), *"READ-ONLY UNLESS `--apply`"*, with `list`/`show`/`add`/`remove`/`seed-role`/`seed-all`. Its header records why: *"The owner's standing instruction, 2026-09-12: 'Do not write tag rows by hand from the shell.' Before this, widening a cohort meant exactly that — and the first migration's packet described widening as 'a tag assignment' while providing nothing that assigned one. A documented workaround is not a recovery path."*

```bash
git show origin/master:api/services/rollout.py | wc -l                      # 347
git show origin/master:tools/rollout_cohort.py | wc -l                      # 147
git grep -l 'S7_DARK' origin/master -- api/services/alert_taxonomy | grep -v test | wc -l   # 7
git show origin/master:api/services/auth_db.py | sed -n '17,24p'            # users: 6 columns, no toolkit/cohort/beta
git grep -nE 'toolkit|cohort|\bbeta\b' origin/master -- api/services/auth_db.py   # (empty)
```

**INTERPRETATION — and the precision matters more than the headline, because half of item 37's S2 build list is still real.** Item 37 lists four things S2 needs (`rollout-rollback.md:565-577`). Measured against master:

| S2's build item | State at `origin/master` |
|---|---|
| 1. `has_tag(user_id, tag)` | ⭐ **SHIPS**, as `rollout.includes(user_id, cohort)`, with a live per-request caller (`askai.py:55`) |
| 2. One dependency **beside** `require_paid`, never replacing it | ⚠️ **ABSENT as a reusable dependency.** The one live per-request gate composes it inline inside a service function, not as a FastAPI `Depends`. The *pattern* is fully worked; the shared primitive is not extracted. |
| 3. One field on `_access_payload` (e.g. `"cohorts": [...]`) | ⛔ **ABSENT.** Derived: `_access_payload` (`api/routers/auth.py:271`) carries `trial`, `paid_equiv`, `billing`, `hub_preview_enabled`, `research_technical_tab_enabled`, `research_flow_tab_enabled` — **every gate-shaped field is an env read, and no field names a cohort.** So the server can gate on a cohort today and **the client cannot know it is in one.** |
| 4. `TERMINAL_NEXT_ENABLED` kept as the master kill switch | ⛔ **Does not exist.** `git grep -n 'TERMINAL_NEXT_ENABLED' origin/master -- api app/src` is empty; the only `TERMINAL_NEXT`-prefixed flag in the ledger is `TERMINAL_NEXT_MONITOR_ENABLED`, which selects a *separate service's* start command and *"must never be set on web"*. |

⭐⭐ **So the honest sentence, which is neither D-08's nor item 37's:** **the cohort's store, its per-user read, its assignment and narrowing functions, its fail-closed contract and its operator CLI all ship and are in production use for two unrelated features; what is absent is a reusable request-time dependency and a client-visible `cohorts` field.** A TERMINAL-NEXT cohort is therefore **`python tools/rollout_cohort.py add --cohort terminal-next --user <id> --apply`**, plus a gate function copied from a worked template — **not a migration, not a schema change, and not a build.**

⭐ **The template is worth naming because it is complete.** `askai.py`'s `enabled_for` composes, in this order: kill switch read **first and per call** → an identity or off → `rollout.includes(user_id, COHORT)` → and `except Exception: log.exception(...); return False`. It sits **beside** `require_paid` rather than replacing it, exactly as item 37 asks. Copying it is a function, not a design.

**⛔ THE PROPERTY THAT MAKES THIS SAFE FOR A MIGRATION, AND IT IS WRITTEN INTO THE MODULE AS AN OWNER RULING.** `rollout.py`'s header: *"AN EMPTY COHORT MEANS NO MEMBERS. NEVER A FALLBACK TO ADMINS … THE DANGEROUS ALTERNATIVE IS THE COMFORTABLE ONE. 'Empty ⇒ fall back to admins' would preserve today's behaviour with no seeding step — and it would put a SECOND AUTHORITY on who is in a cohort."* And the ordering: *"the kill switch is evaluated FIRST, so `FLAG=false` beats any membership. Without that, turning a feature off would mean emptying a table."* ⭐ **That last clause is the one a migration needs most**, and it is the same rule as `feedback_kill_switch_never_a_delete`: stopping a dual run must never be a DELETE against member data.

**CONFIDENCE.** 🟢 — read end to end at `origin/master`: the module, the CLI, the boot seeding call site, the seven projection call sites, the live per-request caller, and the `users` schema that still has no cohort column.

**RECOMMENDATION.** ⛔ **Do not build a cohort mechanism, do not add a column to `users`, and do not put the cohort in `user_preferences`.** The third is the trap with a live hazard attached: `POST /api/auth/preferences` accepts a `{key, value}` from any authenticated caller, so a preference-backed cohort is **member-self-grantable** (`rollout-rollback.md:233-237`, and the endpoint's own comment at `api/routers/auth.py:2079-2081`: *"`joystick_hub.enabled: true` is a VALID value — a member who posts it still turns the hub on for themselves … do not read it as the gate"*). ⭐ D-08 offered the preference-backed flag as candidate 1 for exactly this purpose (`:543`); **it is now the wrong answer and the right one already ships.**

### 1.2 ⭐⭐ THE PERSISTED-KEY HAZARD IS NOW TWO-SIDED, THE NEW SIDE IS LOUD INSTEAD OF SILENT, AND IT SHIPPED A PRODUCTION FAILURE TWENTY-FIVE HOURS BEFORE THIS SENTENCE

**OBSERVATION.** D-08 established the silent half correctly and it still holds: a renamed preference key is *"simply a key with no rows"* — the read returns `undefined`, the component falls back to its coded default, and the member's saved view is gone with no error (`coexistence-current-mechanisms.md:238-251`, verified end to end from component → hook → endpoint → SQL → schema). **That is NG-08's mechanical basis and nothing about it has changed.**

⛔⛔ **What has changed is that a second, opposite failure mode now exists, and a migration can hit it by ADDING a key rather than renaming one.** `api/routers/auth.py` now carries `_PREFERENCE_KEYS`, a server-side **allow-list** of every preference key the endpoint will accept, and an unknown key is a **400 in the member's face**.

**EVIDENCE.**
```bash
git show origin/master:api/routers/auth.py | sed -n '/^_PREFERENCE_KEYS = {/,/^}/p' | grep -cE '^\s+"'   # 48
git show origin/master:tests/test_preference_key_validation.py | grep -cE '^def test'                    # 10
```
The endpoint's own comment states the rail and the contract (`api/routers/auth.py:2085-2090`):
> *"⭐ THE KEY LIST IS DERIVED, NOT INVENTED. Every name below is a key the shipped client actually writes through this endpoint, resolved from the call sites by `tests/test_preference_key_validation.py`, which re-derives the same set from `app/src/**` on every run and fails if the client grows a key this list lacks. ⛔ A key added to the client WITHOUT a row here is a 400 in a member's face, so that rail is the thing that must stay green — not this comment."*

⛔⛔ **And it has already failed three times in six days, with the newest one live for part of today.** All three are recorded as ⚰️ notes inside the allow-list itself:

| When | What shipped without its row | Member-visible result |
|---|---|---|
| #157, #171, #182, **9/20 → 9/23** | `screener_column_presets`, `screener_favorite_screens`, `screener_preset_chips` | *"a member's column presets, favourite screens and chosen preset chips all answered 400 'Unknown preference key' in production for **2–5 days** while every page test stayed green"* |
| `9a8c7163c`, **9/25** | `watchlist_perf_cols` | *"every write 400'd 'Unknown preference key' in production while the page tests were green"* |
| #193, **live 2026-09-26 01:18 CT**, measured ~14:00Z | `notebook_daily_template` | *"every choice answered 400 'Unknown preference key' in production"* |

**⛔⛔ THE MECHANISM BY WHICH THIS GATE GETS SKIPPED IS WRITTEN OUT IN THE THIRD INCIDENT'S OWN NOTE, AND IT IS STRUCTURAL, NOT CARELESS:**
> *"`test_every_key_the_client_writes_is_still_accepted` was red on master the whole time; **the landing ran only the Python rails its own diff touched, and this one reads a JS writer.** Run it before any `setPref(` lands."*

**INTERPRETATION.** ⭐⭐ **The gate is a Python test triggered by a JavaScript change.** A diff that adds `setPref('tnext_view', v)` touches no Python file, so "run the rails your diff touches" — a correct and universally-followed convention — runs everything except the one rail that can catch it. Every page test stays green because a page test mocks the endpoint. **The person who breaks it cannot see the gate from where they are standing**, which is why it has been skipped three times by three different landings and will be skipped a fourth time unless the gate is named in the migration plan rather than in the test suite. §5's **MG-4** is that naming, and §5.9 explains why it is the gate I expect to be skipped.

⭐ **One correction to my brief's own framing, which I record because it would have made §4 half a ledger.** The instruction I was given is *"any migration that changes a key needs a READ-FALLBACK SHIM in the same commit — write the new key, read both."* **That is correct and it is now only half the requirement.** The other half: **a new key needs its `_PREFERENCE_KEYS` row in the same commit too**, or the shim's write side 400s and the member's choices never persist at all — which reads to a member as "the new surface forgets everything", i.e. indistinguishable from the rename failure it was built to prevent. §4.3 states the contract with both halves.

**CONFIDENCE.** 🟢 — the allow-list, the rail's test names and all three incident notes read directly at `origin/master`.

### 1.3 ⭐⭐ "KEEP A REVERSIBLE BACKUP AND DROP IT AFTER THIRTY GREEN DAYS" HAS A MEASURED BASE RATE IN THIS REPO, AND IT IS ONE IN THREE

**OBSERVATION.** The precedent I was handed — and D-08's, and CLAUDE.md's — is that this repo migrates by keeping the old thing as a reversible backup and dropping it after a documented window. **That is accurate about how migrations START and wrong about how they END.** Master records all three of this repo's scheduled retirement countdowns coming due, and **two of the three were overturned by evidence at the countdown, not completed.**

**EVIDENCE — `docs/runbooks/options-flow-status.md`, the "External — other workstreams" table, verbatim:**

| Countdown | Verdict at `origin/master` | The evidence that decided it |
|---|---|---|
| Retire `api/routers/trades.py` | ✅ **DONE-VERIFIED** | *"Already retired by `24ee463bc` (2026-08-09, 'retire the /api/trades router past its documented window'). The file is ABSENT, `data/trades.json` is ABSENT, no `api/` module imports it, and `app/src` has zero callers."* Confirmed: `git ls-tree origin/master -- api/routers/trades.py data/trades.json` returns nothing. |
| Retire `j2_playbook_entries` | ⛔ **PARKED — DO NOT DROP** | *"**12 code refs**, and `api/services/journal_two/account_purge.py:40` lists it in the purge set. **Dropping it breaks account deletion.** Evidence overturns the retirement."* Confirmed: the table name sits in `_DIRECT_USER_TABLES` in `account_purge.py`. |
| Retire `GET /api/tweets/tape` | ⛔ **PARKED — DO NOT RETIRE** | *"**It has a live caller.** `app/src/hooks/useTapeFeed.js:11` fetches it. ⚠️ **CLAUDE.md is wrong**: it states `useTapeFeed.js` was DELETED with zero callers."* |

**INTERPRETATION — and this is the single most transferable thing in this file.**

⭐⭐ **The mechanism in both overturns is the same and it is not carelessness: the kept backup acquired a NEW consumer during the very window that was supposed to prove it unneeded.** `j2_playbook_entries` was kept as a read-only backup of migrated Playbook rows; then account-deletion compliance work enumerated every table carrying a `user_id` and added it to the purge set. It is no longer a backup. **It is live infrastructure that happens to hold stale rows**, and the thing that would have told you is not the migration's own record — it is a fresh census of consumers taken *at the countdown*.

⛔⛔ **And the schedule that was overturned is STILL WRITTEN IN THE CODE, uncorrected.** `api/services/journal_two/db.py:2152-2157`, the migration's own docstring, at `origin/master` today:
> *"One-shot migration: convert every j2_playbook_entries row into a j2_notes row. Idempotent via .notebook_migration_v1 flag file. … **The old j2_playbook_entries table is left in place as a backup — manual DROP TABLE after ~30 days of green prod.**"*

⛔ **So the instruction that would break account deletion is in the docstring an engineer reads, and the ruling that forbids it is in a runbook they have no reason to open.** That is a live second-authority defect over one decision, and §5's **MG-8** exists because of it. It is also carried as contradiction **CX-C1** in §8.

⭐ **The correction to the precedent, stated so it can be used:** the shape is **not** "keep a backup, drop it after 30 green days". The shape is **"keep a backup, and at the countdown RE-DERIVE the consumer set from the code; a backup with a consumer is not a backup."** The one countdown that completed is the one whose consumer census came back empty — and it came back empty *because someone ran it*, not because 30 days had passed.

⚠️ **Base rate caveat, stated plainly: n = 3.** One completion, two overturns. That is not a probability; it is three cases, all recorded, all in this repo, and all of them the only evidence available. What it licenses is a **gate**, not a forecast.

### 1.4 ⭐ COEXISTENCE IS CHEAP AND PRECEDENTED; ENDING IT IS THE EXPENSIVE PART, AND THE BILL GOT BIGGER SINCE D-08

**OBSERVATION.** D-08's three-sentence answer holds and I adopt it: four independently proven coexistence mechanisms already ship, and *"adding a fifth surface is a ~10-file additive edit and touches no Terminal-Current behaviour"* while *"what is expensive and unprecedented is **replacing** `/calendar`"* (`coexistence-current-mechanisms.md:29-31`).

⭐ **What changed is the size of the second half.** D-08 enumerated the inbound dependencies on 2026-09-02. Re-derived today, `/api/calendar` has **more in-app consumers than D-08 listed**, and TERMINAL-CURRENT has acquired an entirely new class of consumer that did not exist when D-08 was written: **the joystick hub**.

```bash
git grep -l 'api/calendar' origin/master -- app/src | grep -v test | wc -l    # 16
git grep -hoE '@router\.(get|post|delete|patch|put)\("/api/calendar[^"]*"' origin/master -- api/routers/calendar.py | wc -l   # 23
```

**EVIDENCE for the new consumer class.** `app/src/hub/sections/calendarSection.js` exists at `origin/master` and its header reads:
> *"Calendar (`calendar`) — route `/calendar`. The hub's controller for the week. … ⭐ **EVERY MOVE GOES THROUGH THE PAGE'S OWN `onDayTab`**, and that is deliberate. … Reusing that verb means the hub inherits the view-switch for free and cannot drift from what the page's own day tabs do. … **THE LABEL IS THE PAGE'S, NOT OURS** — `readout()` returns `days[ds].label` — the SAME string `FeedView.jsx:109` renders."*

⛔ **That is a tighter coupling than any embed in D-08's map, and it is coupled in the direction that matters.** The hub does not read TERMINAL-CURRENT's data; it **drives TERMINAL-CURRENT's own interaction verb and re-renders TERMINAL-CURRENT's own label string**, deliberately, to avoid a second authority over "what is this day called". ⭐ **A replacement of TERMINAL-CURRENT therefore breaks a hub mode, and the hub is the surface a member reaches by thumb on a phone.** It also introduces a further identifier that behaves like a key: `CALENDAR_MODE_ID = 'calendar'`, with membership in `PREVIEW_MODES` (`app/src/hub/registry.js:720`) governing whether the mode is visible at all.

⭐ **The good news, unchanged from D-08 and re-verified: the suite is the instrument.** The retirement template is intact — `app/src/routes/liveFlowRetired.route.test.jsx` and `app/src/routes/lostDoors.route.test.jsx` both present at `origin/master` — and TERMINAL-CURRENT is heavily railed:

```bash
git ls-tree -r --name-only origin/master -- app/src | grep -i calendar | grep -E '\.test\.(js|jsx)$' | grep -v journal-2-0 | wc -l   # 38
git ls-tree -r --name-only origin/master -- tests | grep -ci calendar                                                               # 36
```

### 1.5 ⭐ THE PARITY MATRIX'S ROWS ARE NOT WHERE THE PROGRAMME EXPECTED THEM, BECAUSE TERMINAL-CURRENT IS WHERE THE THESIS ALREADY HOLDS

**OBSERVATION.** Item 14 classifies each workflow by where it leaves our site, and its **NONE** class means *"the flow completes on our site today. ⭐ Fully substituted; the thesis already holds here"* (`workflow-library.md:185`). ⭐⭐ **Three of the five NONE workflows are on TERMINAL-CURRENT** — WF-C02 (`/calendar`, *"the first page of the day"*), WF-C05 (`/calendar`, weekend preparation), WF-C08 (`/calendar/mystocks`) — with the other two being the Wire view and the wire-feedback loop (`workflow-library.md:1258-1265`).

⭐ **And no `Tool:` verdict in item 13 ever says "leave UCT's calendar for X".** The only external tool ever paired with this surface was Market Chameleon via `JTBD-W04` — **and that is the pairing item 14 withdrew today** (§8.1).

**INTERPRETATION.** This inverts the naive framing of a parity matrix. TERMINAL-CURRENT is not a legacy surface being tolerated; **it is, by this programme's own outward measurement, the densest concentration of already-substituted work in the estate.** ⛔ **Which makes the migration risk the opposite of what a "legacy parity" title suggests: the danger is not that TERMINAL-NEXT fails to beat a weak incumbent, it is that a partial migration breaks three workflows that currently need nothing.**

⚠️ **With one honest counterweight, which item 14 states against itself and I carry into §3.2.** A NONE is a statement about coverage and never about value: **WF-C08 is fully substituted and measurably barely used** — `calendar_seen` holds **16 rows in total** across the roster (`workflow-library.md:818-823`, citing `OI-06-telemetry-derived-defaults.md:35`), and `/calendar` itself carries **161 total views and 2 session-opens** (`workflow-library.md:694-695`). ⭐ **That is what forces §3's fourth verdict value.** A row that is COVERED, carries a persisted key, and is provably unused is not a row to carry forward at cost; it is a row to retire deliberately — and a three-value matrix has nowhere to put it except GAP, which would be a lie in the expensive direction.

---

## 2. THE COEXISTENCE RULING — one shape, and an end condition written at the same time

### 2.1 ⛔ I RULE; I DO NOT RE-PRICE

D-08 priced six coexistence options (A–F) against the code and marked its ranking **PROVISIONAL** (`coexistence-current-mechanisms.md:430-506`). ⛔ **Re-pricing them here would put a second authority on a cost D-08 measured.** What was missing was a ruling. Below are **eleven defaultable rulings, CX-1…CX-11, each vetoable in one word.** Every one names the sibling it rests on.

### 2.2 The rulings

| # | Ruling | Rests on | Overturned by |
|---|---|---|---|
| **CX-1** | **Coexistence is B → E/A, additive at every step, exactly as D-08's sequence states.** Stage 1–2 is an admin-only route with no nav entry; Stage 3–4 is a first-class route. ⛔ Not option D (a tab inside TERMINAL-CURRENT) and not option C (a mode inside `/charts`). | D-08 `:500-506`; option D is *"attractive for naming, expensive for safety"* (`:474`) and option C loses URL addressability, which §1.4 shows is TERMINAL-CURRENT's most externally-held property | An owner ruling that one nav entry is required |
| **CX-2** | ⛔⛔ **TERMINAL-NEXT writes NEW persisted keys under a new prefix and touches no `calendar_*` key, no `chart_settings`, no `charts_workspace_layout`, no `multichart_state`, and no notebook embed param.** Coexistence, not migration, on the data. | NG-08 PERMANENT (`non-goals.md:99`); D-08 `:290-295` — the shim *"is per-key and hand-written, not a framework. Five keys ⇒ five shims"* | Nothing short of an owner ruling; this is the row this document exists to hold |
| **CX-3** | **TERMINAL-NEXT registers a NEW widget type id and leaves `calendar` bound.** Two ids coexist in `WIDGET_REGISTRY` indefinitely at the cost of two menu entries. | D-08 `:315` — *"the widget type key `calendar` is a data value inside every member's saved board"*; renaming it produces a loud `Unknown widget type: calendar` tile (`WidgetHost.jsx`), not a silent reset | A ruling that two menu entries is unacceptable — in which case the answer is a **label** change, never a key change |
| **CX-4** | **The cohort is `rollout:terminal-next`, assigned with `tools/rollout_cohort.py`. Nothing is built.** | §1.1 | Evidence that `rollout.py` is not reachable from the web pod, which nothing suggests |
| **CX-5** | **The master kill switch is a NEW env flag, declared in `docs/feature_flags.json` with `status: dark` before it is set anywhere, and read PER REQUEST.** It is evaluated **before** cohort membership. | item 37 S0 (`rollout-rollback.md:514-531`) and its per-request rail; `rollout.py`'s own ordering rule — *"the kill switch is evaluated FIRST … Without that, turning a feature off would mean emptying a table"* | Nothing |
| **CX-6** | ⛔ **Stopping the dual run is never a DELETE against member data.** Not a tag sweep, not a pref-row delete, not a `DROP TABLE`. | `feedback_kill_switch_never_a_delete`; item 37 `:590-594` — *"Stopping a dark run must never be a DELETE against member data"* | Nothing |
| **CX-7** | **`/calendar`, `/calendar/mystocks` and `/r/calendar` are permanent URLs.** If TERMINAL-CURRENT is ever superseded they become `<Navigate replace />`, never a 404. | D-08 `:98-100`; §1.4's inbound map; and the free-tier deep-link redirect at `AuthGuard.jsx` is *"the product's designed acquisition path"* (`:355`) | Nothing |
| **CX-8** | **Coexistence has a written END CONDITION from day one: the §3 parity matrix carrying zero rows in the CARRY-REQUIRED class.** A dual run with no end condition is not shipped. | §0.4; CARD 25 §1's arithmetic applied inward | An owner ruling that permanent coexistence is the product — which is a legitimate answer and would retire §5's MG-7 and MG-8 |
| **CX-9** | ⛔ **No cohort ladder.** With 13 accounts carrying any page-view row, the rungs are `{nobody} → {owner} → {owner + n named accounts} → {everyone}`, and n is a name, never a percentage. | CARD 25 §3; item 37 Headline 3 — a per-browser bucket *"over 26 accounts yields a cohort nobody can reason about, where the precedent it would copy ramped 0→25→100 over ~200 users"* (`:102-107`) | A population change |
| **CX-10** | **TERMINAL-NEXT shares the `/api/calendar` endpoints it needs rather than copying them.** No second backend authority over the same numbers. | D-08 `:494` — *"If the calendar data is shared, share the endpoint, not a copy"*; `lesson_a_second_authority_over_one_value` | A measured incompatibility in the response shape |
| **CX-11** | **Every TERMINAL-NEXT route ships with its route-resolution rail in the SAME commit.** | D-08 `:593`; `lostDoors.route.test.jsx`'s own header — *"`FlowScoreboard.test.jsx`-style component rendering stays green for the entire time no route reaches it"* | Nothing |

### 2.3 ⛔⛔ WHY CX-8 IS THE ONE THAT WILL BE ARGUED WITH, AND WHY IT SHOULD NOT BE DROPPED

Every other ruling above costs nothing to accept. CX-8 costs something real: it forbids the comfortable outcome where TERMINAL-NEXT ships, is good, and `/calendar` quietly stays in the nav forever because nobody wants to have the conversation.

⭐ **The argument for permanent coexistence is genuinely strong and I want to state it at full strength before rejecting it as a default.** Two surfaces cost two menu entries and no data risk at all. CX-2 already guarantees zero shared persisted state. The suite rails both. Nothing breaks. And §1.5 shows TERMINAL-CURRENT is where three already-substituted workflows live, so leaving it alone is the conservative move.

⛔ **It still fails, for one reason, and the reason is the owner's own sentence.** *"so someone can only use our site instead of the others"* is a statement about **a member's attention**, not about our route table. Two surfaces that both answer "what reports this week" means the member decides which one to open, every morning, forever — and item 14 measured that the estate **records no transition between any two surfaces at all** (`workflow-library.md:1286`, hand-off **H11**: *"a person moving from one surface to the next, which is what a workflow is — carries nothing, is watched by nothing"*). ⭐⭐ **So permanent coexistence is not merely an unresolved decision; it is an unresolved decision in the one dimension this estate cannot measure.** We would never find out it was costing us anything.

⚠️ **CX-8 is therefore a default, not a ruling about the product.** If the owner says permanent coexistence is fine, that is an answer and §5's MG-7/MG-8 become inert. What CX-8 refuses is *arriving* at permanent coexistence without anyone choosing it.

---

## 3. ⭐⭐ THE LEGACY PARITY MATRIX — the coverage ledger pointed inward

### 3.1 The cell vocabulary, adopted from item 9 and read inward

Item 9's three-value rule (`capability-matrix.md:305-332`) is adopted verbatim so the two ledgers read side by side. Pointed inward, the words mean:

| Verdict | Outward meaning (item 9) | Inward meaning (this file) |
|---|---|---|
| **COVERED** | A member can do this here. | A member can do this **in TERMINAL-NEXT**, so TERMINAL-CURRENT is not needed for it. |
| **GAP** | A member cannot do this here, and somebody could close it. | A member must **return to TERMINAL-CURRENT** for it. ⛔ **This is an internal break-out and it counts exactly like an external one.** |
| **STRUCTURAL BREAK-OUT** | A member leaves by design, and no build closes it. | The member leaves the site by design **and TERMINAL-NEXT inherits that, not a gap** — e.g. the ICS export into their own calendar app, where *"leaving **is** the feature"* (`workflow-library.md:804-806`). |

⛔ **Today, with TERMINAL-NEXT holding no route, every carry-required row is trivially GAP.** A matrix that said only that would be worthless. **So the load-bearing columns are not the verdict — they are the three that tell you what the row COSTS:** the persisted key or external contract it names, whether a shim is required, and the gate class.

### 3.2 ⛔ THE FOURTH VALUE THIS MATRIX NEEDS, WHICH ITEM 9 DOES NOT HAVE AND SHOULD NOT

Item 9's three values are complete for an outward ledger, where every competitor capability is a thing some real user somewhere uses. **An inward ledger has a fourth case they cannot express**, and §1.5 measured two instances of it.

* **DEAD** — the capability is **MEMBER-SERVING and its store is measurably near-empty**, so carrying it forward is a cost with no measured beneficiary. ⭐ **This is exactly item 9's "fourth fact" — does the store hold rows? — promoted from a caveat to a verdict**, because in a migration it changes the decision rather than merely qualifying it (`capability-matrix.md:78-82`).

⛔⛔ **DEAD is not a licence to delete and it is not a synonym for "unused".** Three guards:
1. **It requires a measured store, not an absence of evidence.** `calendar_seen` = 16 rows is a measurement; "nobody mentions it" is not.
2. ⛔ **It must never be applied to a capability whose store is empty because the capability is BROKEN.** A layer that cannot be read is not a layer that is empty — `lesson_a_saturated_instrument_reports_zero`, and this programme's own twice-paid version of it.
3. ⛔ **A DEAD row still keeps its persisted key.** NG-08 does not have a usage threshold. Retiring the *surface* is a product decision; the rows in `user_preferences` stay.

⭐ **And the honest reason DEAD earns its place: without it, a three-value matrix forces WF-C08 into GAP, which reads as "TERMINAL-NEXT must build the unread queue."** That is a build against 16 rows, and it is the §0.3 rule-2 error wearing a verdict.

### 3.3 The gate classes

| Class | Meaning | Consequence if the row is not closed |
|---|---|---|
| **CARRY-REQUIRED** | A member workflow item 13 or 14 records as served today. | ⛔ A dual run cannot end. This is the class CX-8's end condition counts. |
| **CONTRACT** | An **external** consumer depends on it — another repo, a scheduled job, a published link. | ⛔⛔ Breaks on the **next scheduled run**, invisibly, with no member report. Never gated on member feedback. |
| **KEY** | It names a persisted preference, widget, layout or embed key. | ⛔ Silent data loss on a rename; a loud 400 on an un-allow-listed add (§1.2). |
| **RETIRE-CANDIDATE** | DEAD per §3.2. | A deliberate decision, recorded, with the key retained. |

### 3.4 THE MATRIX

⛔ **Row spine.** The rows are D-08 §7's groups A–E (`coexistence-current-mechanisms.md:564-585`), supplied by that contract *"so D-09's map can be merged into a matrix without a second enumeration"*. ⛔ **I did not invent an axis and I did not re-enumerate the surface**; §9 derives the row count from the finished table.

⛔ **`/journal/calendar` is NOT on this list.** Different feature, different data path (`GET /api/j2/calendar`, closed-trade P&L), different pref (`j2_calendar_pnl_basis`), and the rename commit explicitly left it untouched (D-08 `:357-365`). Its route at `app/src/App.jsx:636` is the nested `calendar` under the journal, which §0.6's enumeration surfaced and which must not be mistaken for ours.

#### A. Views and layout

| # | Row | Key / contract it names | Shim? | Gate class | Verdict today |
|---|---|---|---|---|---|
| A1 | Wire view | `calendar_view_v3` value `wire` | ⛔ **YES if the view vocabulary moves** | CARRY-REQUIRED · KEY | GAP |
| A2 | Board view (the default) | `calendar_view_v3` value `board` | ⛔ **YES** — and note the *value* space is as load-bearing as the key: D-08 records option D's risk as *"a stale saved value is a real failure mode"* (`:469`) | CARRY-REQUIRED · KEY | GAP |
| A3 | Table view | `calendar_view_v3` value `table` | ⛔ YES | CARRY-REQUIRED · KEY | GAP |
| A4 | Month view | `calendar_view_v3` value `month`; `GET /api/calendar/month` | ⛔ YES | CARRY-REQUIRED · KEY · CONTRACT (Sunday Scans falls back to `/month`) | GAP |
| A5 | Week strip / week navigation (`?week=`, `?d=`) | URL contract; `weekAnchor.js` | no key | CARRY-REQUIRED · CONTRACT | GAP |
| A6 | Today's Brief | none — *"a pure client-side join over data the page already has, zero new endpoints"* (`workflow-library.md:699-700`) | no | ⛔ **CARRY-REQUIRED, highest priority** — it is WF-C02's answer and *"the retention moat: a five-second personal answer pinned atop the Board"* (`:703-704`) | GAP |
| A7 | Macro band | `calendar_event_types_v2` value `macro` | ⛔ YES | CARRY-REQUIRED · KEY | GAP |
| A8 | Day detail drawer | `onDayTab`, the page's own verb | ⛔⛔ **NO key, but see §1.4** — the joystick hub's `calendar` mode drives this exact verb | CARRY-REQUIRED · CONTRACT (internal, to the hub) | GAP |

#### B. Scoping and filtering

| # | Row | Key / contract it names | Shim? | Gate class | Verdict today |
|---|---|---|---|---|---|
| B1 | My Stocks scope (union of watchlists / flagged / J2 positions / UCT20) | `calendar_mystocks_sources`; `GET /api/calendar/my-sets` | ⛔⛔ **YES, and it has TWO WRITERS** — `Calendar.jsx:174` and `calendar/MyStocksHub.jsx:412`. A shim must move both or one writer silently keeps writing the old key. | CARRY-REQUIRED · KEY | GAP |
| B2 | Watchlist / Positions / UCT20 / All scopes | `calendar_filters_v2.audience` | ⛔ YES | CARRY-REQUIRED · KEY | GAP |
| B3 | Market-cap filters | `calendar_filters_v2` | ⛔ YES | CARRY-REQUIRED · KEY | GAP |
| B4 | Sort and rank order | `calendar_filters_v2.sort` | ⛔ YES | CARRY-REQUIRED · KEY | GAP |
| B5 | Event-type chips (earnings / macro / IPO / dividend) | `calendar_event_types_v2` | ⛔ YES — ⭐ and this key carries a **deliberately lossy** precedent: *"Bumping the key resets everyone to the new earnings-only default"* because macro used to be a locked chip, so every legacy value carried it not by choice (`Calendar.jsx:185-192`) | CARRY-REQUIRED · KEY | GAP |
| B6 | Quick search | ⭐ **none, deliberately** — *"EPHEMERAL component state, deliberately never persisted (a stale saved search silently blanking next session reads as data loss)"* (`Calendar.jsx:176-178`) | ⛔ **NO, and must stay NO** | CARRY-REQUIRED | GAP |
| B7 | "N hidden" + "Show all" undo | none | no | CARRY-REQUIRED | GAP |

#### C. Per-ticker depth (the earnings modal)

| # | Row | Key / contract it names | Shim? | Gate class | Verdict today |
|---|---|---|---|---|---|
| C1 | Deep-link contract `?earnings=SYM&esection=…` | ⛔⛔ URL contract, `ROUTED_PATHS = ['/calendar', '/calendar/mystocks']`; plus the free-tier redirect to `/research/:sym` at `AuthGuard.jsx` | no key | ⛔⛔ **CONTRACT, and the widest one** — shared links in Discord, DMs and bookmarks that **no repository can enumerate** (D-08 `:399-405`) | GAP |
| C2 | The modal's sections (rebuilt 2026-08-31; the only surface on `--glass-*` tokens) | none | no | CARRY-REQUIRED | GAP |
| C3 | Fundamentals / fwd-PE | `/api/fundamentals` | no | CARRY-REQUIRED | GAP |
| C4 | SEC filings | `/api/filings` | no | CARRY-REQUIRED | GAP |
| C5 | AI call recap + sentiment + guidance | `call_recap.py` | no | CARRY-REQUIRED | GAP |
| C6 | Verbatim transcripts + keyword search + TTS | `av_transcripts.py` | no | ⚠️ CARRY-REQUIRED — **but see item 9 BRK-09**, which measured the transcript corpus at `transcript: null (n=0)`. ⛔ That is §3.2 guard 2 territory, **not** a DEAD verdict: an unmeasured-or-empty corpus behind working machinery is a data question, not a usage one | GAP |
| C7 | Expected / implied move (forward) | `get_implied_move` | no | CARRY-REQUIRED | GAP |
| C8 | ⭐ **Trailing implied-vs-realized calibration** | `implied_snapshots` (`api/services/implied_store.py`) | no | CARRY-REQUIRED | ⭐⭐ **GAP — and this is the row I nearly recorded as an absence.** See §8.1: it ships and it is **the hero** of the Setup section (`SetupSection.jsx:19`, `:241`) |
| C9 | Beat history | `earnings_analytics` | no | CARRY-REQUIRED | GAP |
| C10 | Analyst percentiles | `/api/earnings/intel` | no | CARRY-REQUIRED | GAP |
| C11 | Live reaction / gap % | Massive `lastTrade.p` | no | CARRY-REQUIRED | GAP |

#### D. Adjacent surfaces

| # | Row | Key / contract it names | Shim? | Gate class | Verdict today |
|---|---|---|---|---|---|
| D1 | `/calendar/mystocks` hub (Earnings · News · Calls · Filings · Insights, with unseen badges) | `calendar_seen` (server-side); route | no pref key | ⚠️ **RETIRE-CANDIDATE** | ⛔ **DEAD** — `calendar_seen` holds **16 rows in total** across the roster, and the programme's own test ruled rows-per-user near zero means the state stays Calendar-local (`workflow-library.md:818-821`). *"An unread count nobody clears is decoration."* ⛔ The key stays (§3.2 guard 3) |
| D2 | `CalendarWidget` on `/charts` | ⛔⛔ widget **type key** `calendar` inside `charts_workspace_layout` → `widgets[].opts.settings`; plus `calendar_widget_settings` | ⛔⛔ **NO SHIM — CX-3 instead.** A renamed type key does not wipe the layout; it renders a loud `Unknown widget type: calendar` tile in the member's grid slot | CARRY-REQUIRED · KEY | GAP |
| D3 | `CalendarEmbed` in the notebook | ⛔⛔ the embed's `paramsSchema` keys, stored **verbatim inside every saved note document**: `date`, `econStars`, `selectedSym`, `tbdOpen`, `sections`, `settings` (`registry.js:571-579`), with the file's own rule *"Keep keys STABLE — every stored notebook doc carries them verbatim"* | ⛔⛔ **NO RENAME AT ALL.** ⭐ This is the worst row in the matrix: it is **durable member CONTENT**, not a view preference, so a param rename orphans an embed inside a note somebody wrote | CARRY-REQUIRED · KEY | GAP |
| D4 | `/r/calendar` render page | ⛔⛔ **a SCREENSHOT contract with two external repos.** Verified today: `morning-wire/substack/panelshot.py:43` — `"calendar": ("/r/calendar", {"w": 900, "from": "today", "days": 5}, 940, _S)`; `uct-sunday-scan/sunday_scan/panels.py` screenshots the same panel | no key | ⛔⛔ **CONTRACT — its VISUAL LAYOUT is consumed, not just its data** | GAP |
| D5 | `/r/calendar-week.png` + the `#event-calendar` Discord post | `calendar_week_poster.py`; flag `CALENDAR_WEEK_POST_ENABLED` — ⛔ **state unread** | no key | CONTRACT | GAP |
| D6 | Zone D "On deck" signpost card | ⛔ door **key** `calendar`, which is a **backend contract**: `api/routers/dashboard_signposts.py` is keyed by it | ⛔ **NO RENAME** | CARRY-REQUIRED · KEY | GAP |
| D7 | iCal / webcal export | `GET /api/calendar/export.ics` + `/export-token`, HMAC over `PUSH_SECRET` | no | ⭐ **STRUCTURAL BREAK-OUT** — *"the one break-out in this file that is a feature. The destination is the member's own calendar app; leaving is the point"* (`workflow-library.md:804-806`). ⚠️ What is addressable is the credential: the token *"has no TTL"* | STRUCTURAL BREAK-OUT |
| D8 | Pre-report alerts | `calendar_alerts.py`; flags `CALENDAR_ALERTS_ENABLED`, `calendar_alerts_morning` 07:00, `calendar_alerts_evening` 18:00 — ⛔ **states unread** | no | CARRY-REQUIRED · CONTRACT | ⚠️ GAP, and ⭐ **the one place on this surface with a measured population: 956 `calendar_alerts_fired` rows** (`jobs-to-be-done.md:740`). Contrast D1 |
| D9 | ⭐ **The joystick hub's `calendar` mode** | ⛔⛔ mode id `calendar` + `PREVIEW_MODES` membership + it re-renders the page's own `days[ds].label` and drives the page's own `onDayTab` | ⛔ **NO RENAME** | CARRY-REQUIRED · CONTRACT (internal) | ⛔ **GAP — and NOT IN D-08's MAP**, because the hub shipped after D-08 was written (§1.4) |

#### E. Cross-cutting

| # | Row | Key / contract it names | Shim? | Gate class | Verdict today |
|---|---|---|---|---|---|
| E1 | Company logos | `/api/ticker-logo/{sym}` proxy + `/data` cache | no | CARRY-REQUIRED | GAP |
| E2 | Free-tier deep-link redirect to `/research/:sym` | `AuthGuard.jsx` clause matching `location.pathname === '/calendar'` **exactly** | no | ⛔⛔ **CONTRACT — it is the designed acquisition path.** ⭐ And D-08 records the exact-match consequence: `/calendar/next` would **not** inherit it (`:481`) | GAP |
| E3 | Touch tier ≤1024px compliance (44px floor) | `breakpoints.css` tokens | no | CARRY-REQUIRED | GAP |
| E4 | ⛔ **The persisted preference keys themselves** | §4's ledger | ⛔ **YES, per key** | KEY | GAP |
| E5 | Enrichment batching + warm-on-boot | `GET /api/calendar/enrichment-batch`; `earnings_preview_warm` 06:20 daily | no | ⛔⛔ **CARRY-REQUIRED, and it is a LATENCY contract not a feature.** ⭐ The sharpest waiting number in the estate: *"instant rather than a 25–40 s cold wait"* on top of a **130× cliff** — enrichment cold 17.9 s → warm 0.14 s, whole-week batch cold 24.8 s → warm 0.22 s, *"re-armed every five minutes"* (`workflow-library.md:722-725`, `:1299`) | GAP |
| E6 | Past-day backfill from Finnhub, and the `_PAST_SESSION_CAP=150` vs live-40 asymmetry | none | no | CARRY-REQUIRED | GAP |
| E7 | ⭐ **The weekend warm cadence** | `earnings_preview_warm` running **7 days, not Mon–Fri** | no | ⛔ **CARRY-REQUIRED, and it is the least obvious row in the matrix.** *"the reader who opens Wednesday's NVDA tile on a SUNDAY was the reported symptom (2026-08-23). A weekday-only warm leaves the whole weekend cold for next week's board — which is exactly when someone sits down to prepare for it"* (`workflow-library.md:767-770`). ⛔ A migration that re-derives a warm schedule "for tidiness" re-breaks WF-C05 | GAP |

### 3.5 ⛔ WHAT THIS MATRIX IS NOT

1. ⛔ **It is not a build list.** Every row is GAP today because TERMINAL-NEXT has no route; the information is in the three cost columns, not the verdict.
2. ⛔ **It is not a capability census of TERMINAL-CURRENT.** D-09 owns that. Any row here that disagrees with D-09 defers to D-09 on inventory.
3. ⛔ **It is not a schedule.** Items 27–29 own MVP, roadmap and dependency order (`rollout-rollback.md:801-803`), and CX-8's end condition is a *condition*, not a date.
4. ⛔ **It does not carry a licensing column**, because a migration that changes no data source raises no new licensing question and a uniformly-empty column would read as clearance. The one row where licensing is live is C6, and item 9 §8 owns it.

---

## 4. ⛔⛔ THE PERSISTED-KEY LEDGER — every key a migration would touch, and whether a shim is required

### 4.1 The three failure modes, and the newest one is the loudest

| Mode | Trigger | What the member sees | What reports it |
|---|---|---|---|
| **1. Silent reset** | A preference key is **renamed** | Their saved view is gone. ⛔ Indistinguishable from a bug. | ⛔ **Nothing.** `get_user_preferences` is a flat `SELECT` with *"No aliasing, no fallback, no migration"* (D-08 `:242-249`) |
| **2. Loud orphan** | A **widget type id** or **notebook embed param** is renamed | `Unknown widget type: calendar` in their grid slot, geometry preserved so it reads as a crash; or an orphaned embed inside a note they wrote | The tile itself |
| **3. ⭐ NEW — loud refusal** | A **new** key is written without its `_PREFERENCE_KEYS` row | Every write 400s *"Unknown preference key"*. The surface appears to forget everything. | ⛔ `tests/test_preference_key_validation.py::test_every_key_the_client_writes_is_still_accepted` — **a Python rail fired by a JavaScript change** (§1.2) |

### 4.2 The ledger

⭐ **Derivation, not transcription** — every row re-verified at `origin/master` this pass:

```bash
# the authoritative WRITE set for this surface
git grep -nE "setPref\(\s*'calendar" origin/master -- app/src | grep -v test
# the READ set, including the legacy fallbacks
git grep -noE "prefs\.calendar_[a-z_0-9]+" origin/master -- app/src | grep -v test | sort -u
# the server-side allow-list
git show origin/master:api/routers/auth.py | sed -n '/^_PREFERENCE_KEYS = {/,/^}/p' | grep -cE '^\s+"'   # 48
```

| Key | Written at | Read at | In `_PREFERENCE_KEYS`? | What a rename loses | Shim required |
|---|---|---|---|---|---|
| `calendar_view_v3` | `Calendar.jsx:172` | `:152` | ✅ yes | Board / Table / Month / Wire choice → resets to `board` | ⛔ **YES** |
| `calendar_filters_v2` | `Calendar.jsx:173` | `:162` | ✅ yes | audience, cap filters, sort → resets to `DEFAULT_FILTERS` | ⛔ **YES** |
| `calendar_mystocks_sources` | ⛔ **`Calendar.jsx:174` AND `calendar/MyStocksHub.jsx:412`** | `:171`, `MyStocksHub.jsx:411` | ✅ yes | the My-Stocks source picker → resets to `ALL_SOURCES` | ⛔⛔ **YES, AND IT MUST MOVE BOTH WRITERS** |
| `calendar_event_types_v2` | `Calendar.jsx:192` | `:187` | ✅ yes | earnings/macro/IPO/dividend chip state | ⛔ **YES** |
| `calendar_widget_settings` | `charts/widgets/calendarWidgetSettings.js:7` | same | ✅ yes | per-widget calendar appearance | ⛔ **YES** |
| `calendar_view` | (legacy; only a test writes it today) | — | ✅ yes | — | n/a |
| `calendar_view_v2` · `calendar_density` · `calendar_filters` | ⛔ **never written; read once as a fallback** | `Calendar.jsx:151`, `:155`, `:167` | ⛔ **NO — and correctly so** | already-migrated predecessors | ⭐ **They ARE the shim** (§4.3) |
| `chart_settings` | app-wide, via `usePreferences` | app-wide | ✅ yes | ⛔ every chart setting, app-wide | ⛔⛔ **DO NOT TOUCH** (CX-2) |
| `charts_workspace_layout` → `widgets[].opts.settings` | `ChartsWorkspace.jsx` (six write sites) | `:724`, `:732` | ✅ yes | ⛔ every saved board. ⚠️ **Also read SERVER-side** — `indicator_alert_service.py:1368` `_INSTANCE_BLOBS = ("charts_workspace_layout", "chart_settings", "multichart_state")`, so a **shape** change is not a frontend-only concern | ⛔⛔ **DO NOT TOUCH** (CX-2, CX-3) |
| `multichart_state` | `grid/` | same | ✅ yes | every saved multi-chart grid | ⛔⛔ **DO NOT TOUCH** |
| `charts_workspace_groups` | `ChartsWorkspace.jsx` | same | ✅ yes | the A/B/C/D color-group symbols | ⛔ **DO NOT TOUCH** |
| **widget type id `calendar`** | ⛔ **a DATA VALUE inside every member's `charts_workspace_layout`** | `registry.js:565`, `WidgetHost.jsx:71` | n/a — not a pref key | a loud `Unknown widget type` tile | ⛔⛔ **NO SHIM EXISTS FOR THIS. CX-3: register a new id, leave `calendar` bound** |
| **notebook embed params** `date` · `econStars` · `selectedSym` · `tbdOpen` · `sections` · `settings` | ⛔ **stored VERBATIM inside every saved note document** (`registry.js:571-579`) | `CalendarEmbed.jsx` | n/a | ⛔ an orphaned embed inside durable member **content** | ⛔⛔ **NO RENAME AT ALL** |
| **door key `calendar`** | `doors.js:22` | `api/routers/dashboard_signposts.py` | n/a | the signpost card, and a backend contract | ⛔ **NO RENAME** |
| **hub mode id `calendar`** | `hub/sections/calendarSection.js`, `hub/registry.js` | `PREVIEW_MODES`, `HubRoot` | n/a | ⭐ a hub mode, and the day label it mirrors | ⛔ **NO RENAME** (§1.4) |
| `calendar_seen` | server-side, `api/services/calendar_seen.py` | same | n/a — not a pref | read/unseen state. ⚠️ **16 rows in total** | ⛔ keep (§3.2 guard 3) |
| `j2_calendar_pnl_basis` | the **journal's** calendar | — | ✅ yes | ⛔ **UNRELATED.** Named here only so nobody sweeps it | ⛔ **DO NOT TOUCH — different feature** |
| ⭐ **NEW** `tnext_*` keys | TERMINAL-NEXT | TERMINAL-NEXT | ⛔ **NOT YET — this is MG-4** | — | ⛔ **each needs an allow-list row IN THE SAME COMMIT** |

### 4.3 ⭐ THE SHIM CONTRACT — both halves, and the pattern already exists

⭐ **The read-fallback shim is not hypothetical and it is not a framework — it is three hand-written branches in `Calendar.jsx` today**, and its own comments state the rule: *"v2 prefs migrate once: feed+rows→table, else board"* and *"Legacy metric filters carry over once; audience/sort reset to the new default, then every choice persists under v2"* (`Calendar.jsx:145-192`, verified unchanged at `origin/master`).

**A conforming shim, in one commit:**

1. **Write the NEW key only.** The old key is never written again.
2. **Read BOTH**, new key authoritative when present, old key read once as the fallback.
3. ⛔ **Add the new key to `_PREFERENCE_KEYS`** in `api/routers/auth.py`, **in the same commit**. Without this the shim's write side 400s and the member's choice never persists — mode 3 (§4.1).
4. ⛔ **Run `tests/test_preference_key_validation.py`**, even though the diff may contain no Python. §1.2's three incidents are what step 4 is for.
5. **State the lossiness explicitly.** D-08 records that the existing shims are *"lossy on partial fields by design"* (`:290-292`), and `calendar_event_types_v2`'s own comment records the **opposite** deliberate choice — a reset, because every legacy value carried `macro` not by choice. ⭐ **Both are legitimate; what is not legitimate is not saying which one you chose.**
6. **Accept that the fallback branch is permanent.** *"It never migrates the row — the old key stays in the table forever, so the fallback path is permanent unless someone writes a sweep"* (D-08 `:292`).

### 4.4 ⛔ THREE THINGS A SHIM CANNOT DO

1. ⛔ **It cannot save a widget type id.** `parseLayout` does not filter by known type, so an unknown `type` survives parsing intact and reaches `WidgetHost`, which renders the unknown-widget div. There is no read-fallback seam in that path. **CX-3 is the only answer.**
2. ⛔ **It cannot save a notebook embed param**, because the params live inside durable member content, not in a preference row a fallback could bridge.
3. ⛔ **It cannot make a rename safe enough to be worth doing.** ⭐ **The sharpened version of NG-08, which D-08 got exactly right: it is not that renaming is impossible, it is that each rename costs a bespoke shim and a forgotten one is silent** (`:295`). **Five keys means five shims and five chances to forget one.** ⛔ **So the right move is not a better shim. It is CX-2: new names, and never touch the `calendar_*` family at all.**

---

## 5. THE MIGRATION GATES — MG-0 … MG-9

⛔ **These are not a test plan (item 36) and not rollout preconditions (item 37 §4, thirteen of them, each with its incident).** Every gate below is **specific to two products sharing one site**.

⭐ **And each one names its instrument honestly, including where there is none.** Eight of the ten name a rail, tool or scheduled job that already ships — because a gate whose instrument has to be built first is a wish. ⛔ **Two name a human check and say so out loud: MG-0 and MG-5.** Writing "human review" is not a placeholder for a rail somebody will add; it is the accurate statement, and dressing it up as automated coverage is how a gate stops being run.

### 5.1 MG-0 — THE VOCABULARY GATE

**Asserts.** Every migration commit message, member-impact paragraph and doc says TERMINAL-CURRENT or TERMINAL-NEXT, never bare "UCT Terminal".

**Instrument.** Human review. ⛔ **No rail, and I am naming that rather than inventing one.**

**Why it is a gate at all.** The 2026-09-01 rename cost ~23 files across **two** passes, and D-08 records that *"the first pass was a capital-`C` sweep and was structurally blind to lowercase attribute strings"* while *"`NavBar.test.jsx` matched the nav link by `/calendar/i`"* — so *"the suite caught it, not the sweep"* (`:135-140`). ⭐ **A migration that confuses the two names in a commit message eventually confuses them in a key.**

### 5.2 MG-1 — THE ADDITIVE GATE

**Asserts.** The migration commit changes **no existing behaviour of TERMINAL-CURRENT**. Every edit to a shared file is an added list entry, never a changed line.

**Instrument.** `git diff --stat` plus the 38 frontend and 36 backend calendar rails (§9). ⭐ **The rails are the real instrument**: D-08 records that the page's own header once had **no** rail at all — *"the title could have been renamed to anything or dropped and the suite stayed green"* — and `CalendarHeader.test.jsx` now pins it (`:136`).

**If skipped.** This is the gate CX-1 exists to make cheap. Option D (a tab inside TERMINAL-CURRENT) fails it by construction, which is why CX-1 rejects it.

### 5.3 MG-2 — THE ROUTE-RAIL GATE

**Asserts.** Every new TERMINAL-NEXT route ships with a rail that renders the **real `App`** at the URL and asserts it does not land on `'Page not found'` — in the **same commit** (CX-11).

**Instrument.** The pattern in `app/src/components/navGroups.route.test.jsx`, which also asserts that `/catalysts` alone does **not** resolve, *"so the rail cannot pass vacuously"*; plus `app/src/components/screener/reachable.test.js`, an AST walk of the real import graph from `App.jsx` over all of `app/src`.

**If skipped.** ⛔ Three doors in this repo were built, tested, green and connected to nothing. `lostDoors.route.test.jsx`'s header is the strongest statement of why a component test cannot substitute: *"`FlowScoreboard.test.jsx`-style component rendering stays green for the entire time no route reaches it."*

### 5.4 MG-3 — THE COHORT GATE

**Asserts.** Exposure is `rollout:terminal-next`, the kill switch is read **first and per request**, an empty cohort means **nobody**, and narrowing is `remove_from_cohort`, never a tag sweep.

**Instrument.** `api/services/rollout.py` + `tools/rollout_cohort.py` + the `askai.py::enabled_for` template — **all shipping** (§1.1). Plus item 37's S0 per-request rail (`rollout-rollback.md:523-527`), whose own note is the load-bearing one: *"a module-level capture passes every other test and makes the no-redeploy rollback a fiction."*

**If skipped.** The comfortable failure is `role == 'admin'`, which `rollout.py`'s header already indicts in three sentences: *"It is not a cohort, it is a privilege … It cannot shrink … It was duplicated."*

### 5.5 ⛔⛔ MG-4 — THE PERSISTED-KEY GATE (and see §5.9)

**Asserts.** Every new key TERMINAL-NEXT writes has (a) a row in `_PREFERENCE_KEYS` and (b) — if it supersedes an existing key at all — a read-fallback shim, **both in the same commit**; and `tests/test_preference_key_validation.py` is run **even when the diff contains no Python**.

**Instrument.** `tests/test_preference_key_validation.py` (**10 tests**, derived), which *"re-derives the same set from `app/src/**` on every run"*.

**If skipped.** ⛔ Three production incidents in six days, the most recent live this morning (§1.2). A member's every choice on the new surface 400s, which reads as "the new surface forgets everything" — **the exact symptom a shim exists to prevent, arriving through the opposite mechanism.**

### 5.6 MG-5 — THE EXTERNAL-CONTRACT GATE

**Asserts.** No migration commit changes `/r/calendar`'s rendered layout, `/api/calendar`'s response shape, or the `?earnings=SYM&esection=` parameter grammar without first being checked against the two external consumers by hand.

**Instrument.** ⛔ **There is no automated instrument and that is the finding.** The check is reading `morning-wire/substack/panelshot.py` and `uct-sunday-scan/sunday_scan/panels.py`, which is what I did this pass (§3.4 D4). D-08 states it as a standing recommendation (`:597`).

**If skipped.** ⛔⛔ **This gate's failures are invisible until the next scheduled run.** The Substack letter *"screenshots its own product to illustrate itself"* (`workflow-library.md:1008-1010`), and the Sunday Scan's own source carries a ⛔ warning about replacing that screenshot. Nobody files a bug; a panel is just wrong in a published letter.

### 5.7 MG-6 — THE LATENCY-CONTRACT GATE

**Asserts.** TERMINAL-NEXT inherits `earnings_preview_warm`'s **seven-day** cadence and the enrichment batch, or it re-derives a 25–40 s cold wait.

**Instrument.** The warm's own scheduled job, and the measured cliff: cold 17.9 s → warm 0.14 s single-date, 24.8 s → 0.22 s whole-week, *"re-armed every five minutes"*.

**Why it is a gate and not a performance note.** ⭐ Because the thing most likely to be lost is not the warm — it is **the weekend half of the warm**, which looks like waste to anyone who has not read the dated symptom (2026-08-23) that put it there. §3.4 E7.

### 5.8 MG-7 — THE END-CONDITION GATE  ·  MG-8 — THE CONSUMER-RECENSUS GATE  ·  MG-9 — THE LEDGER GATE

* **MG-7.** ⛔ **No TERMINAL-NEXT surface reaches a member until the §3 matrix names, for every CARRY-REQUIRED row, which of *carried · replaced · deliberately retired* it is** (CX-8). **Instrument:** the matrix itself. **If skipped:** permanent internal break-out, in the one dimension this estate cannot measure (§2.3).
* **MG-8.** ⛔⛔ **At the countdown on any kept backup — a table, a router, a route, a pref key — the consumer set is RE-DERIVED from the code, and the derivation is pasted into the retirement record.** **Instrument:** `git grep` over `api/`, `app/src`, `tools/`, `scripts/` **and the sibling repos**. **If skipped:** §1.3's base rate — one of three countdowns completed, and the two overturns were both caused by a **new** consumer arriving during the window. ⭐ **And the live instance is waiting: `db.py:2152-2157` still instructs a `DROP TABLE` that the runbook has ruled would break account deletion.**
* **MG-9.** Any new flag is in `docs/feature_flags.json` with `status: dark` **before** it is set anywhere, and the ledger is updated in the same docs push as the flip. **Instrument:** `tests/test_feature_flag_ledger.py`, which fails **by name** on an AST-discovered gate with no entry; plus item 37's RB-4. ⛔ **Its known blind spot, inherited verbatim rather than re-derived:** the ledger's gate list comes from `needs_declaration() = not defaults_on()`, so **a kill switch is outside the ledger by construction** (`rollout-rollback.md:69-81`) — which is exactly what a graduated TERMINAL-NEXT flag becomes at S4.

### 5.9 ⛔⛔ THE GATE MOST LIKELY TO BE SKIPPED UNDER PRESSURE, AND WHY IT MUST NOT BE

**It is MG-4, the persisted-key gate. I am not guessing: it has been skipped three times in the last six days by three different landings, and one of those skips was live in production this morning.**

**Why it is structurally invisible to the person who breaks it — five properties, all of them true at once:**

1. **The trigger is JavaScript; the rail is Python.** A diff that adds one `setPref('tnext_view', v)` touches no `.py` file.
2. **The convention that hides it is a correct convention.** "Run the rails your diff touches" is right almost always. Here it runs everything except the one rail that matters.
3. **Every page test stays green**, because a page test mocks the endpoint. The incident notes say so twice: *"while every page test stayed green"*, *"while the page tests were green"*.
4. **The failure is not in the developer's environment.** It needs the real endpoint and a real member.
5. **It is the last line of a big diff.** A persisted key is added at the end of building a surface, when the work looks finished and the temptation to land is highest. ⭐ **That is the definition of "under pressure."**

**Why it must not be skipped, in the migration case specifically — and this is worse than the three incidents that already happened.** Those were single features: a member's column presets failed, and the rest of the product was fine. ⛔⛔ **On a migration, the 400 lands on the surface that is supposed to prove it can replace TERMINAL-CURRENT.** The member tries TERMINAL-NEXT, sets a view, comes back, and it has forgotten — so they go back to `/calendar`, where it works. ⭐⭐ **And because the symptom is "the new surface does not remember", it is indistinguishable from the ONE failure mode NG-08 exists to prevent.** The migration then gets diagnosed as a data-loss bug in the shim, or worse, as evidence that TERMINAL-NEXT is not ready — when the actual defect is a missing line in a dictionary in `auth.py`.

⭐ **The mitigation is one line in a checklist and it is not a new instrument:** **any diff containing a new `setPref(` runs `tests/test_preference_key_validation.py`, regardless of language.** The rail is already written, already derives its own expectations, and was already red on master while three features shipped broken. ⛔ **It was never the rail that failed.**

---

## 6. THE END OF COEXISTENCE — the retirement sequence, and the base rate that governs it

### 6.1 The template, which exists and is five assertions long

If TERMINAL-CURRENT is ever superseded, the shape is D-08's retirement template (`:85-102`), read out of `app/src/routes/liveFlowRetired.route.test.jsx` — present at `origin/master`, verified this pass. Its five parts:

1. **Keep the URL.** `path="/live-flow"` still exists — *"a bookmark must not 404"*.
2. **Redirect with `replace`** — *"don't trap Back on the redirect"*.
3. **Un-import the dead page.** *"Left imported, the chunk still ships and the page stays one edit from being routed again by someone who does not know why it was unrouted."*
4. **Record the reason AT the route**, asserted by the rail.
5. ⭐ **Carry a control** — the rail also asserts the successor route is still routed *and* still imported, *"so the file cannot pass by reading the wrong `App.jsx`"*.

⭐ **Plus the kept-file idiom** (`reachable.test.js:285-330`): retired-but-retained modules get an entry with a written reason, and the entry for TERMINAL-CURRENT's predecessor tile already exists — *"COCKPIT RETIREMENT — replaced by Zone D's 'UCT Terminal' door (/calendar) … Kept as rollback backup."* Its own warning is the one §6.2 turns into a gate: **"⚠️ EACH IS A COUNTDOWN, NOT A PARKING SPACE."**

### 6.2 ⛔⛔ THE SIXTH PART THE BASE RATE ADDS, AND IT IS THE ONLY GENUINELY NEW THING IN THIS SECTION

6. ⛔⛔ **At the countdown, re-derive the consumer set. A backup with a consumer is not a backup.**

⭐ **The five-part template is about the moment you STOP serving something. It says nothing about the moment you DELETE it, and that is the moment two of this repo's three countdowns failed** (§1.3). In both failures the artifact had acquired a consumer during the window that was supposed to prove it unneeded:

* `j2_playbook_entries` → **account deletion** enumerated every `user_id`-bearing table and added it to `_DIRECT_USER_TABLES`.
* `GET /api/tweets/tape` → `useTapeFeed.js` was **restored** after being recorded as deleted, and fetches it.

⛔ **And in both, the artifact that said "safe to delete" was still sitting in the code, uncorrected, at the moment I read it.** The migration docstring at `api/services/journal_two/db.py:2157` still says *"manual DROP TABLE after ~30 days of green prod"*. ⭐ **So the operative rule is not "wait 30 days"; it is "the decision record expires and the code does not know."**

**The conforming countdown, therefore:**

```bash
# Paste the OUTPUT of this into the retirement record. Not the intention — the output.
git grep -n '<artifact>' origin/master -- api app/src tools scripts docs
for r in morning-wire uct-intelligence uct_intelligence uct-sunday-scan; do
  grep -rn '<artifact>' "/c/Users/Patrick/$r" 2>/dev/null
done
```

⚠️ **And one limit on that command, stated because it is the residual risk and no repository closes it.** D-08's cross-repo sweep found **no member-facing hardcoded links** to the SPA route anywhere — which means the route's external exposure is *"human-shared links and bookmarks, which no repository can enumerate"* (`:399-405`). ⭐ **That is exactly why CX-7 makes the redirect permanent rather than time-boxed: the one consumer class you cannot census is the one a redirect serves for free.**

### 6.3 ⛔ THREE THINGS A REDIRECT CANNOT CARRY

1. ⛔ **A screenshot.** `/r/calendar` is consumed for its **visual layout** by two external pipelines. A redirect satisfies the HTTP request and produces a wrong picture in a published letter. §3.4 D4, MG-5.
2. ⛔ **A persisted key.** A route redirect does nothing for `calendar_view_v3`. §4.
3. ⛔ **The free-tier deep-link clause.** `AuthGuard.jsx` matches `location.pathname === '/calendar'` **exactly**, so a redirect target that is not that literal string silently loses the `/research/:sym` acquisition path — *"the most viral surface in the product, spent as an unexplained bounce"* was the reasoning for building it. §3.4 E2.

---

## 7. ⭐ THE SMALL POPULATION IS A MIGRATION ASSET, AND I AM NOT DESIGNING A LADDER FOR IT

**UCT Intelligence is ~26 accounts, 13 with any page-view row, six of those roster admins** (CARD 25 §3). The Whop Discord's ~750 paying members are a **separate product outside this boundary** and appear here only as CARD 25's identified subject pool for a future study — never as our audience, never as a denominator.

⛔ **The honest reckoning, which is the opposite of a problem statement.** At n=13 with page-view rows, and `/calendar` carrying **161 total views and 2 session-opens** (`workflow-library.md:694-695`):

1. ⭐ **A cohort can be enumerated by hand, by name, and verified by eye.** `tools/rollout_cohort.py show --cohort terminal-next` prints a list somebody reads in full. ⭐ **That is a property a large product would pay a great deal for and cannot buy**, and it is why CX-9 forbids a percentage: a per-browser hash over 26 accounts *"yields a cohort nobody can reason about"* (`rollout-rollback.md:102-107`).
2. ⭐ **A migration can be reversed by talking to everyone affected.** At this size the rollback channel is a conversation, not a status page.
3. ⛔ **But a coexistence decision cannot be validated by telemetry, and that is not fixable by being clever.** With 2 session-opens and 16 `calendar_seen` rows total, **no A/B result at this population distinguishes preference from noise.** Item 37's GAP 3 says the same about the roster: *"the site is in `COMING_SOON_MODE`, so the roster is admins and testers."*
4. ⛔⛔ **Therefore the migration's evidence standard is not measurement — it is the parity matrix.** MG-7 gates on *"every CARRY-REQUIRED row is named carried, replaced or retired"*, which is a **structural** claim somebody can check by reading, and it is the only kind of claim that survives n=13.
5. ⚠️ **And one number this population makes dangerous rather than merely weak:** a DEAD verdict (§3.2) at n=13 is a measurement of **the roster's** behaviour, not of members'. ⭐ **I am recording that as a limit on D1's verdict, not walking it back**, because 16 rows across a roster that includes the people who built the feature is still the only evidence available — and it points one way.

⭐ **The one thing the small population genuinely buys the migration, stated plainly: a dual run at n=13 can be ended by asking the thirteen.** That is not available later, and it is the cheapest MG-7 will ever be.

---

## 8. CONTRADICTIONS CARRIED, NOT RESOLVED

### 8.1 ⚰️ WHAT I NEARLY WROTE AND THEN FOUND ALREADY SHIPPING

⛔ **Four of these. Each would have been a "TERMINAL-NEXT must build X" line, which §0.3 rule 2 names as this file's most expensive possible error.**

1. ⚰️⚰️ **"Stage 3 needs a per-user cohort mechanism built."** — **It ships.** `rollout.py` (347 lines), `tools/rollout_cohort.py` (147 lines), two live cohorts, seven projections, a live per-request gate. §1.1. ⭐ **This is the big one, and three programme documents say the opposite**: D-08 `:529-540`, item 37 `:560`, item 9's BRK-07 (*"written and read by no gate"*).
2. ⚰️ **"Renaming a preference key is silent, so the only gate is a shim."** — **Half wrong since the allow-list shipped.** Adding a key without its row is a **loud 400**, and that half has failed three times in six days. §1.2.
3. ⚰️ **"The trailing implied-vs-realized calibration is absent, so the modal's parity row is a build."** — **It ships and it is the HERO of a member-facing section** (`SetupSection.jsx:19`, `:241`; backed by `implied_store.py`'s `implied_snapshots`). ⭐ **Item 14 withdrew WF-C03 and WF-C06 today for exactly this** (`workflow-library.md:1205`), and its lesson is the one I was at risk of repeating: *"an 'UCT absent' cell is the single most dangerous kind in any coverage document, because it is the one that gets acted on."* §3.4 C8.
4. ⚰️ **"The `/calendar` route is gone from `App.jsx`."** — **My own grep under-reported.** §0.6. Caught by enumerate-then-filter, at no cost, only because a second method ran.

### 8.2 The contradictions

| # | The contradiction | Both sides | My handling |
|---|---|---|---|
| **CX-C1** | ⛔⛔ **A `DROP TABLE` instruction that has been ruled would break account deletion is still in the code.** | `api/services/journal_two/db.py:2157`: *"The old j2_playbook_entries table is left in place as a backup — manual DROP TABLE after ~30 days of green prod."* vs `docs/runbooks/options-flow-status.md`: *"PARKED — DO NOT DROP … 12 code refs … Dropping it breaks account deletion. Evidence overturns the retirement."* | ⛔ **Not resolved here — it is `api/**`, which this docs branch does not edit.** Recorded as the live instance MG-8 exists for. ⭐ The docstring is the artifact an engineer reads; the runbook is the one they have no reason to open. **A second authority over one decision, in the dangerous direction.** |
| **CX-C2** | **Three programme documents say the per-user cohort does not exist; master ships it.** | §1.1 | Recorded as an inventory correction, exactly as item 9 files its own (`capability-matrix.md:33-40`: item 9 *"wins on inventory"* only). ⛔ **I correct none of their verdicts** — D-08's, item 37's and item 9's *reasoning* about why a cohort is the right instrument all stand; only the availability cell moves. |
| **CX-C3** | **Item 13's `JTBD-W04` is now known-wrong and not amended**, after item 14 withdrew the two rows resting on it. | `jobs-to-be-done.md:426-427` still reads *"Market Chameleon, by hand"* and *"does **not** keep the trailing calibration"*; `workflow-library.md:1205` measured that it ships | ⛔ **Flagged, not fixed.** §3.4 C8 carries the measurement. ⚠️ It also feeds `jobs-to-be-done.md:614` and `:593`; **all four cells are invalidated by the same measurement** and item 13 owns the correction. |
| **CX-C4** | **Item 14's ADDRESSABLE count cannot be re-derived as instructed.** Its §5.1 table struck WF-C03 and WF-C06 but their §4 entry bodies still carry `- **Break-out.** ADDRESSABLE` as the first token, so the `grep -c` the correction tells you to re-run still counts them. | `workflow-library.md:1207` vs `:728`, `:787` | ⛔ **I quote no ADDRESSABLE count.** Recorded because it is the withdrawal's own residue and because item 14's GAPS 7 still names those two rows as "most exposed" without noting the exposure was realised. |
| **CX-C5** | **CLAUDE.md is a hazard on exactly this subject and its own copy in this worktree says so.** This branch's `CLAUDE.md` carries a banner recording itself *"eight recorded facts behind"* master, and master's runbook records CLAUDE.md as **wrong** about `useTapeFeed.js` being deleted. | This worktree's `CLAUDE.md` header vs `docs/runbooks/options-flow-status.md` | ⭐ **Every fact in this file is read from `origin/master` source, never from CLAUDE.md.** Where CLAUDE.md agrees it is corroboration; it is cited as authority nowhere. |
| **CX-C6** | **My brief's summary of D-08's notebook precedent said `_v1` with `_v2` for nested folders. Master has seven.** | Derived: `run_notebook_migration_v1` … `_v7`, and seven matching `.notebook_migration_v*` marker files | ⭐ **Not a contradiction in the artifacts — a warning about summaries.** §9 derives it. ⛔ And it strengthens the precedent rather than weakening it: **the one-shot-marker idiom survived seven iterations**, which is a better recommendation than two. |

---

## 9. DERIVED COUNTS — every number in this file, with the command that produced it

⛔ **Not one of these was typed from memory.** Run from `/c/Users/Patrick/uct-worktrees/terminal-research`.

```bash
# ── SHAs ──────────────────────────────────────────────────────────────────────
git rev-parse HEAD origin/master
#   de6b29face489869bc358a676309359d103ea668   (this docs branch)
#   2e0598bfa514303fe542c4473bd2f89470d04ec2   (origin/master)

# ── §1.1 the cohort mechanism ─────────────────────────────────────────────────
git show origin/master:api/services/rollout.py | wc -l                                       # 347
git show origin/master:tools/rollout_cohort.py | wc -l                                       # 147
git grep -l 'S7_DARK' origin/master -- api/services/alert_taxonomy | grep -v test | wc -l    # 7
git grep -hoE 'COHORT = "[a-z0-9-]+"|S7_DARK = "[a-z0-9-]+"' origin/master -- api | sort -u
#   COHORT = "wisdom-askai"        <- a SECOND cohort, unrelated feature
#   S7_DARK = "s7-dark"
git show origin/master:api/services/auth_db.py | sed -n '18,23p' | grep -cE '^\s+[a-z_]+\s'   # users: 6 columns
git grep -nE 'toolkit|cohort|\bbeta\b' origin/master -- api/services/auth_db.py              # (empty)
git show origin/master:api/services/entitlements.py | sed -n '/^TOOLKITS/,/^})/p' | grep -cE '^\s{4}"'   # 1 toolkit
git grep -n 'TERMINAL_NEXT_ENABLED' origin/master -- api app/src                             # (empty)

# ── §1.2 / §4 the persisted-key allow-list ────────────────────────────────────
git show origin/master:api/routers/auth.py | sed -n '/^_PREFERENCE_KEYS = {/,/^}/p' | grep -cE '^\s+"'   # 48
git show origin/master:tests/test_preference_key_validation.py | grep -cE '^def test'                     # 10
git grep -nE "setPref\(\s*'calendar" origin/master -- app/src | grep -v test | wc -l                      # 5 write sites
git grep -noE "prefs\.calendar_[a-z_0-9]+" origin/master -- app/src | grep -v test | sort -u | wc -l      # 8 read sites

# ── §1.3 / CX-C6 the migration precedents ─────────────────────────────────────
git show origin/master:api/services/journal_two/db.py | grep -cE '^def run_notebook_migration_v[0-9]+'   # 7
git show origin/master:api/services/journal_two/db.py | grep -oE '\.notebook_migration_v[0-9]+' | sort -u | wc -l   # 7
git ls-tree origin/master -- api/routers/trades.py data/trades.json                          # (empty -> retirement COMPLETED)
git grep -c 'j2_playbook_entries' origin/master -- api app
#   api/services/journal_two/account_purge.py:1      <- the new consumer that overturned the drop
#   api/services/journal_two/db.py:9

# ── §1.4 / §3 the inbound surface ─────────────────────────────────────────────
git show origin/master:app/src/App.jsx | grep -cE '<Route path='                             # 94 total routes
git show origin/master:app/src/App.jsx | grep -nE '<Route path=' | grep -ci calendar         # 5, of which 2 are the JOURNAL's
git grep -hoE '@router\.(get|post|delete|patch|put)\("/api/calendar[^"]*"' origin/master -- api/routers/calendar.py | wc -l   # 23
git grep -l 'api/calendar' origin/master -- app/src | grep -v test | wc -l                   # 16 in-app consumer files
git grep -hoE "calendar_[a-z_0-9]+" origin/master -- app/src | sort -u | wc -l               # 18 distinct calendar_* identifiers
git show origin/master:docs/feature_flags.json | python -c "import json,sys; d=json.load(sys.stdin); print(len(d['flags']), len(d['build_flags']))"   # 201 21

# ── §1.4 / §5.2 the rails ─────────────────────────────────────────────────────
git ls-tree -r --name-only origin/master -- app/src | grep -i calendar | grep -E '\.test\.(js|jsx)$' | grep -v journal-2-0 | wc -l   # 38
git ls-tree -r --name-only origin/master -- tests | grep -ci calendar                        # 36
git ls-tree origin/master -- app/src/routes/liveFlowRetired.route.test.jsx app/src/routes/lostDoors.route.test.jsx | wc -l           # 2

# ── §3 this file's own row count, derived from the finished table ─────────────
grep -cE '^\| (A|B|C|D|E)[0-9]+ \|' docs/terminal-research/10-roadmap/coexistence.md         # 42 parity rows
grep -cE '^\| \*\*CX-[0-9]+\*\* \|' docs/terminal-research/10-roadmap/coexistence.md         # 11 rulings
grep -cE '^### 5\.[0-9]+ ' docs/terminal-research/10-roadmap/coexistence.md                  # gate sections
grep -cE '^\| \*\*CX-C[0-9]+\*\* \|' docs/terminal-research/10-roadmap/coexistence.md        # 6 contradictions
```

⚠️ **Two numbers in this file are NOT mine and are cited, never re-derived:** `calendar_seen` = **16** rows and `calendar_alerts_fired` = **956** rows, both from `OI-06-telemetry-derived-defaults.md` via `workflow-library.md:818-821` and `jobs-to-be-done.md:740`. ⛔ **I have no production access and could not have measured either.** Both are ~13-day-old measurements against a roster of admins and testers (§7 limit 5).

---

## 10. WHAT THIS FILE DECIDES AND WHAT IT DOES NOT

**It decides.** The coexistence shape (CX-1), that no existing key moves (CX-2, CX-3), that the cohort is an assignment and not a build (CX-4), that a dual run needs a written end condition (CX-8), that there is no cohort ladder (CX-9), and ten migration gates — eight resting on a rail, tool or job that already ships, and two (MG-0, MG-5) on a named human check that this file declines to dress up as automation.

**It does not decide.**

* ⛔ **Any flag's live state.** No Railway access, none attempted. `TERMINAL_NEXT_MONITOR_ENABLED`, `CALENDAR_ALERTS_ENABLED`, `CALENDAR_WEEK_POST_ENABLED` and every other flag named here are **unread**. ⛔ Do not quote this file for what is set on the pod.
* ⛔ **Which TERMINAL-NEXT surfaces exist, or their order.** Items 27–29.
* ⛔ **The rollback tiers or the rollout rungs.** Item 37 §1.4 (`:308-315`) and §2 (`:514-642`). ⭐ Every gate above says "rollback = the tier item 37 §1.4 names for this failure shape" and adds only what is migration-specific: **what a coexistence rollback must ALSO restore — a pref key, a route, a redirect, an external screenshot's layout.**
* ⛔ **Whether TERMINAL-CURRENT should ever be retired at all.** CX-8 forces the *question* to be answered; it does not answer it. An owner ruling that both surfaces are permanent retires MG-7 and MG-8.
* ⛔ **The testing strategy.** Item 36. §5's gates are migration preconditions, not a test plan.
* ⛔ **Whether item 13's `JTBD-W04` and item 14's residual ADDRESSABLE bodies get corrected.** CX-C3, CX-C4. Flagged, owned elsewhere.
* ⛔ **Anything about `api/**` source.** CX-C1's fix is a one-line docstring correction in a file this docs branch does not edit.

### ⛔ MY OWN MOST-LIKELY ERROR

**It is §3.4's D1 row, the DEAD verdict on `/calendar/mystocks`, and I am naming it because it is the one cell here that somebody might act on.**

The verdict rests on **16 `calendar_seen` rows** — a number I did not measure, taken from a ~13-day-old telemetry artifact, against a roster where six of thirteen page-viewing accounts are admins. ⛔ **The failure mode is §3.2's guard 2 wearing a verdict:** if the unseen badge has been quietly broken — a badge that never renders, a write path that 400s the way three others did this month (§1.2) — then **16 rows is a measurement of a broken instrument, not of member disinterest**, and "retire the unread queue" would be the wrong call made from the right number. *A layer that cannot be read is not a layer that is empty.*

⭐ **What would settle it, cheaply, and it is not more telemetry:** open `/calendar/mystocks` as a real member, mark one item seen, and confirm a `calendar_seen` row is written. **One observation distinguishes "barely used" from "does not work"**, and until somebody makes it, D1's verdict is an inference about behaviour drawn from a store whose write path nobody in this programme has watched fire.

⚠️ **Second candidate, recorded so it is not a surprise.** I assert that a TERMINAL-NEXT cohort needs no build (CX-4, §1.1). I verified `rollout.py` is imported by production code on the web pod's path (`api/main.py:3451`) and gated per-request in a live adapter — **but I never executed anything.** If `rollout.includes` turns out to be unreachable from a route-level dependency for some reason my reading missed, CX-4 becomes a small build rather than an assignment. ⭐ **The check is one `python -c` against a local sandbox DB, and it is the first thing a builder should run.**

---

## GAPS — what this pass did not reach

1. ⛔ **No flag state, anywhere.** Named, unread, and no attempt made. Closes with one read-only `railway variables --service web --kv` (names only) or one `tools/flag_ledger_audit.py` run — ⚠️ whose own blind spot item 37 measured: all four of its questions are about **PRESENCE, never VALUE** (`rollout-rollback.md:180-184`).
2. ⛔⛔ **The one measurement this whole file would most want does not exist.** Whether a member returns to TERMINAL-CURRENT from anywhere is unrecorded: item 14's **H11** records surface-to-surface transitions as *"nothing … watched by nothing … not measured, anywhere"* (`workflow-library.md:1286`). ⭐ **So CX-8's end condition can only ever be checked structurally**, and §7 explains why that is the right answer at n=13 rather than a workaround.
3. ⚠️ **The retirement base rate is n=3.** One completion, two overturns, all in this repo, all recorded. It licenses MG-8; it forecasts nothing.
4. ⚠️ **I did not read D-09's `terminal-current-map.md` directly.** §3's row spine is D-08 §7's headers, which that contract supplied *for this purpose*, and every capability detail I cite is via item 14 or item 13 quoting D-09 with line numbers. ⛔ **If D-09 carries a capability D-08's headers omit, §3 is missing a row**, and D-09 wins on inventory.
5. ⚠️ **`_PREFERENCE_KEYS` was counted and sampled, not audited key-by-key against every client writer.** The rail that does that is `test_every_key_the_client_writes_is_still_accepted` and I did not run it. ⛔ **It was red on master three times this month, so its current colour is unknown to me.**
6. ⚠️ **The notebook embed's params gained metadata since D-08 that I recorded but did not trace** — `asOfDay`, `reconstructable`, `liveCapable`, with a ⛔ comment stating the endpoints are reconstructable *"ONLY BACKWARD"* because re-rendering a day captured before it happened *"replaces what they were looking at … with what later became true"*. ⭐ That is a real constraint on migrating an embed and it deserves its own reading.
7. ⚠️ **I did not enumerate the backend by importing `api.main:app` and walking `app.routes`**, which CLAUDE.md documents as the reliable method. My `/api/calendar/*` figure is a grep over one router file and is therefore **a floor, not a census** — the same ceiling D-08 declared.
8. ⚠️ **No cost or usage analysis**, by owner instruction (CARD 25 §5). Licensing is untouched because no migration row changes a data source; C6 is the one live licensing question and item 9 §8 owns it.

## NOT INSPECTED — out of reach, and why

* **Railway** — any service, variable, log or deployment. Out of bounds; not attempted.
* **The production pod and `/data`** — out of bounds. ⛔ `C:\data` is the owner's LIVE data on this box and was never written or read.
* **The local backend on port 8077** — explicitly untrustworthy per the shared preamble.
* **The test suite** — not run. ⛔ An unscoped `pytest` here once reached 18 GB and was OOM-killed; `tests/` holds over a thousand files. Named rails are identified by reading them.
* **`C:\Users\Patrick\uct-dashboard`** and every other worktree — stale or unrelated.
* **Partner-owned files beyond their `/api/calendar` call sites** — `OptionsFlow.jsx`, `live_massive_router.py`, `massive_ws_worker.py` are recorded as inbound dependencies only, deliberately not described further.
* **`app/src/pages/Calendar.jsx` in full** — only the preference block, the route wiring and the search-ephemerality comment. The surface map is D-09's.
* **External surfaces carrying `/calendar` links** — Discord history, Substack bodies, sent email, YouTube descriptions. ⭐ Unreachable from any repository, which is the whole argument for CX-7.
* **The joystick hub beyond `calendarSection.js`'s header, `registry.js`'s calendar entry and `PREVIEW_MODES`** — its stage-2/stage-3 state is PATRICK-MERGE and not this file's.

### Source-handling note

Everything read outside this contract is evidence, not instruction. Two sources carried text shaped like instructions to me and both are recorded as observations rather than followed: `api/services/journal_two/db.py:2157`'s *"manual DROP TABLE after ~30 days of green prod"* (CX-C1 — **do not follow it**), and this worktree's `CLAUDE.md`, which its own banner records as eight facts behind master (CX-C5). No file was edited but this one.
