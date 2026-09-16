---
id: WISDOM-HARD-RULES
title: UCT Wisdom Loop — the owner's HARD RULES (§0.4), copied verbatim
status: verbatim copy — this file is NOT the authority, the source below is
---

# UCT Wisdom Loop — HARD RULES

⛔⛔ **THIS IS A COPY. The authority is the owner's Wave 1 GO, which is NOT in git.**

| | |
|---|---|
| source | `data/wisdom/WAVE1-PROMPT-v2.0.md` |
| lines copied | **15–24** (§0.4 in full) and **231** (§11.3, secrets) |
| source modified | 2026-09-13 10:57:58 |
| source size | 39,085 bytes, sha256 `46e279ff129352b4…` |
| source tracked by git? | **NO — gitignored** (`.gitignore:11: data/`) |
| copied | 2026-09-14, session 4, owner ruling **R1_HARD_RULES_FILE: YES** |

⚠️ **The source is gitignored because `data/wisdom/` is the programme's quote-bearing tree** —
paid transcript text and golden labels — which §0.4f itself forbids in git. That is a property of
the DIRECTORY, not of this text: the lines below are policy prose. Before copying them they were
scanned for double-quoted spans, dollar and bare-decimal price levels, share/contract counts,
credential-shaped literals, secret-name assignments, email addresses and @handles. **The only
match was the string `11.3` — the section number of the secrets rule itself** — confirmed against
a control proving the level detector still sees a real price on the same line. Nothing else
tripped, so the block is reproduced verbatim rather than redacted.

⛔ **If the source and this file ever disagree, the source wins and this file is the thing that
drifted.** It carries no authority of its own; it exists so a fresh clone of this public repo can
read the rules at all. Re-copy it rather than editing it in place.

⭐ The in-repo *restatements* are `docs/wisdom/PROGRAM-MANIFEST.md` §0 (12 standing rules) and
`docs/wisdom/CONTRACTS.md:110-121` (an off-limits path list LONGER than §0.4i's). Neither is the
owner's text. This file is.

---

## §0.4 — verbatim

```
0.4 Hard rules NOT subject to 0.1 — enforced in code, not settings, each with a CI + pre-merge check:
  a) Sunday Scans: published Substack post only, never drafts. Wisdom never imports the Substack publisher or the Sunday Scans publish/run/promo modules, never reads the saved Substack login, and you may not open substack.com in the browser under this program except to fetch a public post URL for a body-text diff (§2.3). The §0.9 import-ban check stands.
  b) Journal / J2 / Notebook / broker-synced fills are OUT OF SCOPE for reading, ingestion, matching, or search (Part 10).
  c) Nothing member-visible changes without a flag flip; flag flips are mine. (Notebook-program standing rulings on Notebook keys do not transfer here.)
  d) Private data from the content streams (position sizes, share counts, stated entry prices on open positions) lives in the owner-only private store and is import-banned from every member-facing module.
  e) No member messages are ever ingested. Only the authors in §2.1. Quoted or replied-to member text inside an author's message is stripped before storage.
  f) Public repo: no transcript text, golden quotes, private levels, positions, or credentials in git. gitignored data/wisdom/ only. Committed files carry locators (video id + cue timestamp; issue + section + paragraph) and paraphrases; verbatim quotes only from Sunday Scans (free, public).
  g) Paid content (Sunday Scans bodies, live-session and workshop transcripts) is served only to entitled members through the existing plan/role checks; during dark phases, admin cohort only via the S12 user_tags cohort predicate.
  h) One master merge at a time; Railway web SUCCESS before the next; ledger row per commit on program paths; docs/runbooks/deploy-windows.md is the deploy authority. Parallel BUILD is required (Part 8); parallel MERGE is not.
  i) Off-limits paths: app/src/pages/journal-2-0/, lib/offline/, OptionsFlow.jsx, the Discord render hardening program's files (docs/discord-render/, chart-renderer service), and the Data Charts overhaul files (app/src/pages/BreadthCharts.jsx, PresetRow.jsx, MetricReadout.jsx). Read through their APIs; never edit.
```

## §11.3 — verbatim (secrets)

```
11.3 Secrets stay in Railway env / the existing secret store; never in files; never printed in logs or reports.
```

---

## Appended notes — NOT part of the verbatim text above

⛔ Everything above this line is the owner's text, copied byte-for-byte. Everything below is this
programme's own record. Never edit upward across this line.

### 2026-09-14 — Q17: what "stability = 1.0 (3/3)" means as a rule

The Wave 1.5 item-3 publication floor is written in `SESSION-STATE.md` as *"no PRINCIPLE or
MARKET_SIGNAL publishes under a named author unless **stability = 1.0 (3/3)**"*. Session 4 found
that this phrasing has two readings that agree at N=3 and disagree elsewhere, and asked which
governs (Q17).

**Owner ruling, 2026-09-14 — `R17_VOTING_RULE: FLOOR`, `R17_MIN_RUNS: 3`.** The rule is:

> a record publishes only when `stability >= golden.STABILITY_FLOOR` **and**
> `stability_runs >= 3`.

⭐ **"3/3" is the N=3 INSTANCE of that rule, not a separate rule.** `stability` is
`runs_present / N`, so at N=3 the attainable values are 0, ⅓, ⅔ and 1 — and only **1.0** clears a
0.8 floor. The two spellings pick out exactly the same records at the intended run count.

⚠️ **They diverge above N=3, and FLOOR is what governs there.** At N=5 the attainable values
include **0.8**, so **4/5 passes** — a record present in four of five passes publishes. If that is
ever not what you want, this is the line to change, and changing it means changing the ruling, not
the code.

⛔ **`MIN_RUNS = 3` exists because a score is only a measurement if enough passes went into it.**
Without it `stability = 1.0` computed over a SINGLE run clears the floor — one run agreeing with
itself is not agreement, and 1/1 = 1.0 is the most confident-looking number the pipeline can
produce for the least evidence. A run count below the minimum, or an unrecorded one, is treated
exactly like NULL: it blocks.

**Where it lives:** `api/services/wisdom/publish/floor.py` — `MIN_RUNS` (one literal, no env
override, because a publication floor that can be lowered from the environment is not a floor) and
`floor_value()`, which reads `golden.STABILITY_FLOOR` and never restates it. All four enforcement
points consume that one predicate. Rails: `tests/test_wisdom_item3_floor.py`, including a
boundary test that pins the threshold to `STABILITY_FLOOR` exactly rather than to a near
neighbour, and behavioural tests at each of the four sites.

### 2026-09-15 — R30: MARKET_SIGNAL's identity is PROVISIONAL

MARKET_SIGNAL has **no id anywhere in the schema** — it lives only as
`wisdom_records.market_signal_json` (session 3). Item 2's reconciler has to match records across
passes, so it needs one, and the key it uses is:

> `(type, normalize_quote_key(name))` — the tuple session 4's persistence adopted.

**That is the first stable id MARKET_SIGNAL has ever had.** It is **name-based**, so a signal the
extractor names slightly differently on a second pass reads as two identities scoring **1/N twice
instead of 2/N once** — understating stability.

⭐ **Owner ruling R30, 2026-09-15: ACCEPT, WITH AN AUDIT BESIDE IT.** Accepting was safe because
the error is bounded in the safe direction and **completely recoverable**: understated stability
BLOCKS under Q17 rather than publishing, and the gate runs persist **raw records**, so the
reconciler can be re-run offline under a different key for **$0.00**. Choosing this key now
forecloses nothing.

⛔ The audit (`reconcile.audit_market_signal_renames`) measures how much of MARKET_SIGNAL's
instability is a rename: within one segment, two keys that never co-occur in a run and whose name
tokens share ≥ 0.5 Jaccard are reported as a **suspected rename**, by **segment id and key only —
never by name text**. It measures suspicion, not truth: two different signals can share
vocabulary, and a real rename can share none. The number is a prompt for a decision.

### 2026-09-15 — R32: the gate carries its OWN API-key variable

`api/services/wisdom/extract/batch.make_client` reads, in order:

> **`WISDOM_ANTHROPIC_API_KEY`** (preferred), then `ANTHROPIC_API_KEY`.

⛔⛔ **The generic name is not free to set, and that is the whole reason.**
`ANTHROPIC_API_KEY` in the operator's shell is the variable **Claude Code itself** reads to
authenticate and bill. Exporting it so the golden gate can run would change how the agent session
that launches the gate is authenticated — a side effect nobody asked for, on the account paying
for the session. A programme that needs a credential should carry its own, under its own name.

⛔ §11.3 applies to both names unchanged: the value lives in the **environment**, never in a file,
never in a log, never in a report. `make_client`'s failure message names **both variables and
neither value** — an error that quotes a key is a key in a log — and
`tests/test_wisdom_extract_key_precedence.py` asserts the (obviously fake) fixture values are
absent from both the exception text and captured logs, on the success path as well as the failure
path.

**To run the gate:** export `WISDOM_ANTHROPIC_API_KEY` in the shell that launches Claude Code, on
the machine Claude Code runs on. A session already running will not see it — the variable is read
from the process environment at call time, and that environment is inherited at launch.


### 2026-09-15 — R34: the OS credential store is a THIRD source, and it loses every tie

`make_client` now reads, in order:

> **`WISDOM_ANTHROPIC_API_KEY`** (preferred) → `ANTHROPIC_API_KEY` → **the OS credential store**,
> service `uct-wisdom`, user `anthropic`.

⛔ **A tie goes to the ENVIRONMENT, and the order is the ruling.** `railway run` and a one-off
export are deliberate acts scoped to ONE process; the store is ambient and applies to every run on
the machine. An ambient credential that could override an explicit one would make a `railway run`
invocation mean something different depending on machine state nobody looked at.

**To store one** (once, on the operator's machine — it prompts, so the value never appears in a
command line, a history file or a log):

```
python -m keyring set uct-wisdom anthropic
```

⛔⛔ **`keyring` IS NOT IN `requirements.txt`, AND MUST NOT BE PUT THERE.** It was, for about four
hours on 2026-09-15, and the programme's own off-limits rail refused it — correctly, for two
separate reasons:

1. **`requirements.txt` is a flow-worker watched file (W1 §0.4i).** Merging a change to it
   redeploys flow-worker, which drops the Massive OPRA socket, and **Massive does not replay** —
   the tape gap is permanent until the T+1 flat file. That is a real cost paid by the options
   product for a convenience belonging to one operator's laptop.
2. **Declaring it would INSTALL it in production.** "Declared but not installed" was true of this
   box and false of Railway: every service would carry a credential-store library it never calls,
   to serve a fallback that only ever runs on the operator's machine.

⭐ Nothing is lost by leaving it out, because the fallback is built to be absent: `key_from_keyring()`
catches every exception — a missing module, no backend, a locked store — and returns `None`, so
with nothing installed the gate behaves **exactly as it did before R34 existed**, raising the same
`ExtractUnavailable`. That equivalence is the point, and it is railed both ways
(`test_an_absent_keyring_module_falls_through`, `test_a_keyring_error_falls_through_instead_of_crashing`).

**The operator installs it on their own machine if they want it** — `pip install keyring` beside
the `keyring set` command above. It is a tool on a workstation, not a dependency of the product.

⛔ §11.3 is unchanged and now covers a third surface: the failure message names all three sources —
both variable names, plus the keyring service and user — and **no value from any of them**. The
store's own value is asserted absent from the exception text and from captured logs on the success
path as well as the failure path. A key read from a credential store is still a key.

### 2026-09-15 — R35: the settings-`env` fallback is DOCUMENTED, NEVER WRITTEN

There is a third way a key could reach the gate: Claude Code's own settings file carries an `env`
block, and an entry there would be injected into every session on this machine.

⛔⛔ **Owner ruling R35, 2026-09-15: DOCUMENT ONLY. It is not to be used, and no session writes
it.** Two independent standing rules forbid it and each would be enough on its own:

- **§11.3 — a key never lives in a file.** `settings.json` is a file, it is not gitignored by the
  programme's own rules, and a credential there survives every session, every reboot and every
  `git status` that nobody reads. A value in the environment dies with the process; a value in a
  settings file waits.
- **Never self-grant through settings.** A session editing the file that governs what sessions may
  do is the agent widening its own authority, which is refused whatever the payload
  (`feedback_when_blocked_enumerate_tool_paths`).

⭐ It is written down anyway because an undocumented path gets rediscovered and tried. The reason
to refuse it is not that it would fail — it would work, which is precisely the hazard. The two
sanctioned paths are the ones above: an environment variable for this run, or the OS credential
store for this machine.


### 2026-09-15 — R42: a SANDBOX REDIRECT ALSO REDIRECTS THE DATA A TOOL NEEDS TO BE CORRECT

⚰️⚰️ **THIS CORRECTS SESSION 9.** That report said the golden gate, run under `railway run`, took
production's `DATA_DIR` and read this box's `C:\data\entity_master.db`. **That is wrong.** The
measured mechanism is the opposite, and it is the more useful one:

1. `tools/wisdom/extract_golden_gate.py:412` calls `common.bootstrap(...)` **before** its first
   `api.*` import at `:413-414`;
2. `tools/wisdom/extract_common.py:39` does `import conftest` deliberately — census pins + tripwire;
3. `conftest.py:515` runs the redirect **at module import and is NOT gated on pytest**;
4. `conftest.py:469` mints a **fresh `mkdtemp(prefix="uct_tests_datadir_")` per process** and
   `:501-512` repoints `DATA_DIR` there. `:505-508` skips a variable only when its value is
   truthy AND outside the shared root — and `os.path.abspath("/data")` on Windows is `C:\data`,
   which IS the shared root, so a production `DATA_DIR` of `/data` is redirected exactly as an
   unset one is;
5. `api/services/entity_master/schema.py:33` then captures `<fresh sandbox>/entity_master.db` at
   import, and the store CREATES it.

⭐ **The physical evidence is three sandbox databases whose mtimes match the three gate manifests
to within 0.3 s** — 07:16:47 / 07:33:43 / 07:55:47 against manifests at 07:16:46.8 / 07:33:42.8 /
07:55:47.3 — each **86,016 bytes with 0 rows in every table**. The shared-root copy was never
opened; its sha256 is unchanged across all of this (verified again 2026-09-15).

> ⛔⛔ **THE RULE. A sandbox redirect protects against WRITES by guaranteeing an EMPTY READ. Before
> running any tool whose CORRECTNESS depends on a populated store, ask what the redirect will hand
> it — and if the answer is "an empty database", seed one explicitly and pass its path.**

⚠️ **Why nothing reported it, and this is the part to carry:** the empty store made every ticker
unresolvable, and `writer.py:504` then downgraded every CALL to MENTION — which is a **legitimate
fail-closed path**, indistinguishable in the output from a corpus that genuinely contained no
attributable calls. **A safety mechanism silently degraded a product behaviour, and the degraded
answer was well-formed.** The gate's own precision/recall table cannot show it either, because it
scores `pre_entity_type`, fixed before the entity step.

⭐ **Measured remedy, $0.00:** `scripts/entity_master_seed.py --db-path <local> --max-pages 0` runs
fully offline (the Massive pagination loop body never executes) off `api/data/cap_universe.json`
and the delisted registry. It built **9,824 entities** here, and re-resolving the three persisted
runs offline recovers **228 of 297 pre-entity CALLs — 76.8%**, the rest needing the paid reference
feed. Nothing was written to the shared root; its hash was baselined before and verified after.


### 2026-09-15 — R43: the PUBLICATION IDENTITIES are ruled

> **MARKET_SIGNAL = `MERGED_J05`** — keys clustered within a segment when their name tokens share
> at least **0.5** Jaccard, which is R30's OWN audit threshold.
> **PRINCIPLE = `KEY`** — unchanged.

One constant decides it: `reconcile.MS_IDENTITY` (`MS_MERGE_JACCARD = 0.5` beside it), and it is
mutation-proved as the single switch — flipping it to `KEY` reds three tests by name.

**What it bought, measured on the local store (826 real records):** MARKET_SIGNAL records clearing
the floor went **21 → 61**; identities 1,223 → 1,150; floor blocks **143 → 103**. PRINCIPLE is
untouched at 31, as ruled.

**Graded against golden, for $0.00:** where two members of a merged cluster both map to a golden
record, the labels settle it. MERGED-MS scored 1–2 gradeable clusters, all correct. LENS-PRINCIPLE
scored **13/13 correct at t=0.6, 7/7 at t=0.9 — precision 1.000 at every threshold**. ⛔ That is the
number behind a future `LENS_STRICT` ruling (it would move PRINCIPLE 31 → 67); it is NOT a licence
to change PRINCIPLE now, because R43 rules KEY.

⭐ **KEY is retained as the lower-bound comparator** and is recomputed on every reconciliation into
the manifest as `comparison_key_identity` — never written to `wisdom_records` or
`wisdom_principles`.

⛔⛔ **THE INVARIANT THAT MAKES MERGING SAFE:** two keys present in the SAME run are two records,
never one renamed record. `_Union.union` refuses any merge whose components share a run.
Mutation-proved 2026-09-15: disabling it reds
`test_the_guard_holds_at_COMPONENT_level_not_just_pair_level`. ⚠️ The pair-level pre-filter beside
it is an OPTIMISATION and is proved to be one — disabling it changes no test.

⚰️ **And the fixture that made four of these tests vacuous:** `_name_tokens` reads
`fields.market_signal.name`, which the synthetic rows did not carry — so no pair was ever a merge
candidate and every "must not merge" assertion passed because nothing merged at all. Two guard
mutations went UNCAUGHT until the fixture carried a name and a non-vacuity control asserted that a
merge actually happens.

⚠️ **OPEN — the floor enqueues but never retracts.** After R43, 103 records are blocked while the
review queue holds **153** `below_publication_floor` rows: a record that starts passing does not
have its old row withdrawn. Harmless today (the queue is advisory, nothing publishes from it), but
the owner's queue overstates what is currently blocked.


### 2026-09-15 — R46: THERE IS NO PUSH OR MERGE WINDOW

> **No time-of-day condition applies to pushes or merges (owner ruling R46, 2026-09-15).** The market-hours freeze and both its guards were removed on 2026-08-24 (CLAUDE.md:4805); `pre_push_guard.py` carried a stale reinstatement of it, which this session removed.

⚰️ **How a retired rule cost a session anyway.** `tools/pre_push_guard.py` carried an "owner ruling
A2" clock refusing every master push between **09:25 and 16:05 ET**, with ~190 lines of machinery
and **19 tests** behind it — three weeks after the owner removed the freeze and both its guards.
Session 11 read that clause, believed it, and wrote *"merge after 16:05 ET or at a weekend"* into a
promotion document. **A rescinded rule that outlives its removal is indistinguishable from a live
one**, and CLAUDE.md warns twice that this repo has reinstated rescinded restrictions before.

⛔ **The clause, its constants, its override env var and its 19 tests are removed.**
`test_the_guard_has_no_time_of_day_branch` walks the module's AST and fails by name if any of them
returns — or if any `.hour`/`.minute` comparison appears at all. Mutation-proved: reintroducing one
reds that test. ⭐ Its control plants a `.hour` comparison and proves the predicate can see it.

⭐ **What is NOT retired:** the QUEUE guard (Railway `web` must be SUCCESS and settled ≥ 150 s) and
the CADENCE guard (don't push inside another deploy's build window). Those are about not colliding
with a deploy in flight — physics, not a clock — and they stay.

⛔ **And a merge performed on github.com runs NO local hook.** Hooks are client-side; a PR merged
in the browser or the mobile app triggers the promotion-gate workflows only. The guard was never in
that path.


### 2026-09-15 — R43 revised: PRINCIPLE publishes under the LENS at t=0.6

> **PRINCIPLE = `LENS_STRICT_06`** — keys clustered within a segment when their normalised
> statements clear golden.py's paraphrase lens at **0.6**. MARKET_SIGNAL stays `MERGED_J05`.

**Ruled on graded evidence.** Where two members of a merged cluster both map to a golden record the
labels settle it: **13 of 13 correct at t=0.6, 7 of 7 at t=0.9 — precision 1.000 at every threshold
measured.**

**What it bought, on the local store's 826 real records:** PRINCIPLE records clearing the floor
**31 → 66**; with MARKET_SIGNAL's 61, the floor now blocks **68** where it blocked 143 under KEY.

⚠️⚠️ **PROVISIONAL, and the reversion is one line.** n is small — 13 gradeable clusters — and the
lens is documented to OVER-merge. The **42** ungradeable pairs in
`data/wisdom/identity-study/lens-principle-pairs.jsonl` are the confirmation. **If any hand-checked
pair is an over-merge, set `reconcile.PRINCIPLE_IDENTITY = "KEY"` — one line, one commit**, and the
regression pins prove KEY still reproduces 31.

⛔ Two constants, two types, each flippable alone and each mutation-proved by name. KEY is still
computed into the manifest as the lower bound for both.

⭐ **The lens is assembled from golden's own parts** — `_key_tokens`, `_polarity_conflict`, the
threshold — because its shipped entry point `_fuzzy_agreed` is a one-to-one COUNT matcher between
two runs, not a pair predicate.

⚰️ **And the fixture lesson, again, in a new place.** The obvious polarity test — *"always add to a
winner"* vs *"never add to a winner"* — scores **0.500**, below the 0.6 threshold, so it would not
merge whether the polarity guard existed or not. Measured before asserting: the pair now used
scores exactly **0.600** and merges without the guard, so removing the guard reds the test by name.


### 2026-09-15 — R50: the CALL / MENTION / LEVEL / NEGATIVE_CALL gating audit

> **EXTRACT IS NOT RULED WHILE LIST (i) IS NON-EMPTY.** List (i) is *consumers of the four
> unfloored types that are MEMBER-VISIBLE and UNGATED*. **It is EMPTY at 2026-09-15**, and it is
> a standing condition, not a one-time finding: any change that puts a name on list (i) puts
> `WISDOM_EXTRACT_ENABLED` back behind this rule.

**Why the question exists at all.** `floor.FLOORED_TYPES = ("PRINCIPLE", "MARKET_SIGNAL")` and
`floor.passes()` returns True for every other type by construction, so CALL, MENTION, LEVEL and
NEGATIVE_CALL are **unfloored** — the stability floor is a no-op for them at all four of its
enforcement sites. The moment EXTRACT runs they exist, and whatever reads them, publishes them.

**What was measured, derived from source, never from a doc list:**

| | |
|---|---|
| wisdom-owned routes | **38** — 28 `require_admin`, 4 `require_owner`, 6 `require_push_secret` |
| member-reachable wisdom routes | **0** — no `require_paid`, no `get_current_user`, none unguarded |
| doors into the package from outside it | **5** — `main.py` (mount), `ai_search.py`, `ai_search_dossier.py`, `ticker_mentions.py`, `desk_session_insights.py` (R2 archive, reads no record) |
| readers of `wisdom_records` | **21** modules, each now carrying an R50 verdict |
| gates | **25**, **every one defaulting `"0"`**; 10 marked `member_visible` |

**LIST (i) — member-visible AND ungated: EMPTY.**

**LIST (ii) — reaches a member, behind a `member_visible=True` gate that defaults OFF (5):**
`desk_markers` (`WISDOM_DESK_MARKERS_ENABLED`) · `dossier` (`WISDOM_DOSSIER_ENABLED`) ·
`askai`/`retrieval` (`ASKAI_WISDOM_RETRIEVAL_ENABLED`, plus the `wisdom-askai` cohort) ·
`modelbook` drafts (`WISDOM_MODELBOOK_DRAFTS_ENABLED`, plus an owner approval) ·
`brainkb` (`WISDOM_BRAINKB_PUBLISH_ENABLED`, plus the owner's own PC-side `--commit`).

**No minimal gate set is applied, because the minimal set needed to empty list (i) is empty.**
Inventing a gate nobody ruled would be a behaviour change on the owner's chain dressed as an
audit finding. What IS applied is the enforcement: `tests/test_wisdom_type_gating_audit.py` fails
by name when a module outside the package starts reading it, or when a new reader of
`wisdom_records` lands without a verdict. ⭐ **A one-time audit nobody re-runs reads as coverage**
— this repo's own `desk_session_insights` was "written, documented as scheduled, wired into no
scheduler" for weeks.

⚰️ **The session-12 rehearsal could not have answered this.** It ran INGEST-only against an EMPTY
store and reported `level_alerts 0 crosses, lookalike 0 scores, wisdom_records 0`. True, and
worthless as evidence: an empty store cannot distinguish *this consumer is gated* from *this
consumer had nothing to read*, and every ungated consumer would have printed the same zeros.
`tools/wisdom/gating_rehearsal.py` re-runs it with **12 records of the four types present**:
every member door **SHUT**, and `--self-check` proves **4 of the 5 doors report OPEN when their
gate is lit**, so `shut` is a measurement and not silence. The fifth, Ask-AI, carries a second
gate this rig cannot light — the `wisdom-askai` cohort is a `user_tags` row in auth.db — and is
reported as a stated limit rather than faked.

⛔⛔ **A FORCED CHAIN RUN BYPASSES `WISDOM_EXTRACT_ENABLED`.** `extract/batch.py:439` reads
`if not ctx.force and not flags.extract_enabled()`. The golden gate and the spend cap still sit
behind it, so it is not an open till — but it is the one switch that spends, and on the forced
path it does not mean what its name says. Found because the rehearsal's own first run forced the
chain and watched `extract` report `ok` with the flag unset. Pinned by
`test_a_forced_chain_run_bypasses_the_extract_spend_gate`. **Whether an admin-triggered chain run
may force is the owner's call, not this audit's.**

⚠️ **Three things that are NOT list (i) and are the owner's to look at anyway:**
1. **`clips.clip_candidates` is the one publish consumer with no flag of any kind** — untyped over
   all six types, `require_push_secret` only. Already ruled: R10_ITEM3 (2026-09-14) put it behind
   the FLOOR. Recorded here so the *next* audit finds a decision, not a gap.
2. **`report._calls` runs with no flag and its status filter is LOOSER than every other reader's**
   — `!= 'superseded'`, which admits **rejected** records that `select_records` never returns. Any
   admin can build one on demand at `POST /api/admin/wisdom/reports/preview`.
3. **`brainkb` STAGES rows into `wisdom_kb_rows` with its flag OFF** — measured in the rehearsal:
   3 rows staged on a dark night. Only the export is gated. Nothing leaves, and the staging is
   what makes a flip instant; it is recorded so a populated table is not read as a leak.

⚠️ **`WISDOM_RETRIEVAL_INDEX_ENABLED` is marked `member_visible=False`** while the index it builds
is what the member-visible Ask-AI block reads. Ask-AI's own gate decides whether anything leaves,
so the defence in depth is intact — but the LABEL under-states it on a flip checklist. **Left
unchanged: relabelling is a judgement, not a measurement, and it is the owner's.**


### 2026-09-15 — R52 / R53 / R56 / R57, and the merge-window rule

> **R56 — the persisted-runs root is `<DATA_DIR>/wisdom/gate-runs`, override**
> **`WISDOM_GATE_RUNS_DIR`. Never CWD-relative, and never a module-level constant.**

⚰️ It was `Path("data")/"wisdom"/"gate-runs"` — a bare CWD-relative literal. On the pod the CWD
is `/app`, so it resolved to an **ephemeral image layer**, not the volume. The consequence was not
a wrong directory: `MIN_RUNS = 3` needs three passes to COEXIST, so a chain-side N-pass would have
accumulated nothing forever while every step reported `ok`.

⛔ TWO second-order traps, both closed and both worth carrying: a module-level constant would be a
default ARGUMENT bound once at import, freezing the environment — the same bug in different
clothes; and the path was defined TWICE (the module that writes runs, the module that discovers
them), which is how a writer and a reader come to point at different directories with both
reporting success. The PC-side tool now has an explicitly different `LOCAL_ROOT`, because on a dev
box `<DATA_DIR>` is the live `C:\data` that `out_path` refuses outright.

> **R57 — every chain step target must resolve, or be declared unbuilt by name.**

⚰️ `chain.py` named `extract.run_weekly_audit`, which does not exist. `resolve()` returned None,
the step recorded `not_available` — a SKIP, not a failure — so the weekly extraction audit had
**never run**. Only the name was wrong; `extract.run_audit` is the specified implementation.

⛔⛔ **And the rail found three more: FOUR of the seven weekly steps have never run.**
`evals.reconcile_weekly`, `core.vocab.refresh_candidates` and `publish.adapters.refresh_voice_profile`
are not implemented anywhere. Those three are genuinely UNBUILT rather than misspelled, so they are
declared in `KNOWN_UNBUILT` with a reason each. ⭐ The distinction is the whole point: `not_available`
exists so a chain can outlive an unbuilt module, and its cost is that a TYPO is indistinguishable
from a GAP. A new typo now fails by name; a gap is a line somebody had to write.

> **R52 — `force` bypasses scheduling, never the switch that spends.**

`ctx.force` still bypasses the master switch, the job kill switch and the trading-day check. It no
longer bypasses `WISDOM_EXTRACT_ENABLED`. A forced run may spend only with
`WISDOM_EXTRACT_ACCEPT_SPEND` set to an exact literal — not a truthy value, and useless without
`force`, so it cannot sit in a profile as a standing grant. ⛔ This mattered because `force` is a
query parameter on an admin route, so the one switch that costs money was one request from not
applying.

> **R53 — `WISDOM_EXTRACT_DAILY_BUDGET_USD`, default 25.0. A VALUE, not a switch.**

Unset takes the ruled default; **present-but-unusable REFUSES** rather than falling back, because
`=25O` quietly becoming 25.0 is how somebody ships a night they did not authorise. Zero refuses
too, and the message points at `WISDOM_EXTRACT_ENABLED` — zero is not a pause button. Three
ceilings now exist and none replaces another: this one (a night), `WISDOM_EXTRACT_BUDGET_USD`
(the programme total, default 120.0), and the PC-side ledger's own `cap_usd`.

> **THE MERGE WINDOW — a session WAITS. It never attests and never bypasses.**

⛔⛔ `UCT_BURST_ATTESTED_BY` / `_AT` is **never set by a session.** Master's R19 defines it as
*"a named person at a named minute"* confirming they can see every workstream. A session cannot
see other sessions, so setting it would be asserting something untrue. `--no-verify` is banned
outright. The only correct response to the guard's recency and burst clauses is to wait.

> **Wait-for-CI is OFF on all six services, so the gate is PRE-MERGE and LOCAL.**

⛔ A merge to master deploys immediately; a red gate does not stop it (measured, master's
`d85d22509`). Any check that finishes after the merge is a record, not a gate. So the full local
pass — scoped suite, the four CI-parity steps, every deploy-gate check, a secret scan over **every
file the PR adds**, and the blast-radius check — runs BEFORE the merge. ⚠️ The gate's own secret
scan reads `HEAD^..HEAD`; a push is not one commit, so on an 86-commit PR it covers exactly one.

> **A session never attempts a Railway browser login.** The CLI is the Railway path.

⭐⭐ **R52 CLOSED A DEFECT THAT SESSION 13 HAD PINNED, AND THE PIN CHANGED SIDES.**
`test_a_forced_chain_run_bypasses_the_extract_spend_gate` asserted the DEFECTIVE expression was
still present, so the behaviour could not change unnoticed, and its failure message said what to
do when it moved: *re-state the finding, never delete the test*. R52 made it red — as designed —
and it now pins the opposite, that the bypass is gone. ⚠️ It deliberately does not re-implement
the behavioural checks (`test_wisdom_forced_run_spend.py` owns those); it owns the HISTORY.

⚰️ It also caught me claiming a green gate before its totals line existed. The targeted suites for
each commit were green; the FULL scoped run was still going, and it came back **1 failed**. *A test
run without a totals line is not a run* — and a PR body written on the strength of one is a claim
about a run nobody finished.


### 2026-09-15 — R57 DELETE_ALL, R58 landing path, and what a session may do to master

> **THE LANDING PATH IS A GUARDED PUSH IN A WINDOW (owner ruling R58, 2026-09-15).**
> A local master-first merge commit, pushed through the pre-push guard. **Never `--no-verify`,**
> **never an attestation variable, never a force push, never a rebase of the branch.** The
> guard's refusal IS the window closing: the session waits and retries, it does not argue.

⛔⛔ **MASTER-FIRST, AND THE DIRECTION IS NOT COSMETIC.** `tools/land_master_first.py` (added to
master by another workstream, 2026-09-15) records the measurement: the deploy gate scans
`git diff HEAD^ HEAD` — the FIRST parent. Master-first (`^1`=old master, `^2`=branch) puts OUR
files in front of the gate; branch-first puts master's. Measured A/B on this repo: **2 files vs
62.** Use that tool; it refuses a wrong-direction merge rather than pushing it.

⛔ **`git checkout master` CANNOT be used from a worktree** — master is checked out in another
workstream's worktree and git refuses a second checkout. The tool detaches at `origin/master`
instead, which produces an identical commit graph without touching that worktree.

⚠️ **AND THE GATE'S SECRET SCAN READS `HEAD^..HEAD`, SO A PUSH IS NOT A COMMIT.** Master's own
`717eb4e39` measured it: **66 of 85** first-parent commits that reached production had no gate run
of their own. On an 80-commit landing the gating scan covers exactly one. Run
`tools/secret_scrub.py --scan` over **every file the landing adds**, locally, before pushing.

> **R57 DELETE_ALL — three weekly steps deleted, their intent kept as W2 backlog.**

`reconcile_outcomes`, `vocab_candidates` and `voice_profile` named functions that are not
implemented anywhere. `resolve()` returned None, each recorded `not_available` — a SKIP, not a
failure — so three of the weekly chain's seven steps had never run once and nothing paged.
**A step that cannot run is not a plan; it is a green tick standing in for one.** Deleted; the
intent is W2-A/B/C in OVERNIGHT-CHECKPOINTS.md. ⭐ The fourth was a MISSPELLING and was fixed
instead — telling those two cases apart is what `test_wisdom_chain_targets_resolve.py` enforces.

> **R58 DIAGNOSTIC — PR creation fails REPO-WIDE, and it is not branch size.**

⛔ Measured 2026-09-15 with a control: a branch **one commit ahead of master, one file, one line**
got the identical *"There was an error creating your PullRequest."* So the failure is not
`feat/wisdom-loop`'s 86 commits. There are **no rulesets on master**. This is a GitHub-side repo
or account setting, and `gh pr create` (absent on this box) is what would print the real API
error. **A session cannot fix it; it is a desk-and-keyboard item.**
