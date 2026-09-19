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

⛔⛔ **MEASURED 2026-09-15: the guard's BURST clause is unsatisfiable during active development.**
**117 window probes over 2h15m — ZERO open.** The guard needs fewer than `BURST_MIN_DEPLOYS = 3`
web deploys in `BURST_WINDOW_SECONDS = 3600`, plus a 600 s settle. With four or five workstreams
each deploying every 10-20 minutes, that hour is never empty. Recency cleared repeatedly — twice
within 64 seconds of open, and later with 1,663 s settled — and the burst count never fell far
enough for long enough.

⭐ **The guard is right and the number is the point.** Its own refusal says *"it needs a human who
can see every workstream, not a guard"*; the measurement says that is true **always, during
working hours**. So a guarded push has three exits and a session owns none of them: an owner
attestation (R19), a genuinely quiet period, or a change to `BURST_MIN_DEPLOYS` — a design
decision about this repo. ⚰️ One open window was observed in session 15 and that single data
point made a guarded landing look routine; 117 probes say otherwise.

---

### 2026-09-17 — R60 / R61, the three ceilings, and what actually holds EXTRACT

**R60 — WISDOM NEVER WRITES THE ENTITY MASTER, AND PRODUCTION'S COPY WAS NEVER EMPTY.**

The entity master belongs to S3. The Wisdom programme is a *declared read-only consumer*:
`api/services/wisdom/core/entities.py:4` — "through S3 Entity Master
(`api/services/entity_master/api.py` resolve, **imported read-only**)" — and PROGRAM-MANIFEST
lists it among the S3/S8/D2/S7/S12 dependencies "Consumed unchanged". No wisdom-owned module
writes it. **A Wisdom session never seeds it. That is the S3 owner's act, at a keyboard.**

⭐ **MEASURED 2026-09-17** through production's own surface (`GET /api/admin/entity-master/status`):
**32,651 entities**, 32,664 aliases, 6,058 delisted, 26,593 active, `ambiguous_count` 0,
`last_seed_at` **2026-09-07T03:12:38Z**, `db_path` **`/data/entity_master.db`**.
**It is POPULATED. There was never anything to seed.**

⚰️⚰️ **EVERY READING THAT SAID "EMPTY" WAS LOCAL, AND WAS THE SANDBOX — R42's mechanism, one
programme-level step further.** conftest mints a fresh `mkdtemp` `DATA_DIR` per process,
`entity_master/schema.py:33` captures `<sandbox>/entity_master.db` at import, and the store
creates it empty. So **session 9's headline — "every CALL was demoted to MENTION by an
unresolvable entity master" — is an artifact of the test harness, not a fact about production**,
and the 76.8%-recovery figure measures a LOCAL corpus under a LOCAL seed.

> ⛔⛔ **THE RULE. Before concluding that a production store is empty, read it THROUGH A
> PRODUCTION SURFACE.** A local process cannot answer a question about a volume it has been
> redirected away from, and the redirect is invisible at the call site.

**H6 IS STRUCK.** Its "guards" existed only in a session brief; the string appears in no file in
this repository. A ruling conditioned on guards nobody can read is not a ruling.

---

**R61 — `railway variables --set` IS PERMITTED, FOR NAMED VARIABLES ONLY.**

Session 14 said *"`railway variables --set` is forbidden"*. Session 15 said *"CLI is the Railway
path"* and *"never `railway variables` **without** `--set`"* — which only parses if `--set` is the
permitted form and the value-printing read is the forbidden one. **Session 15 supersedes.** A
session sets ONLY a variable its own ruling block names, once each, on the named service, each
followed by a deploy watch. Never a member-door name. Never `--unset` without a ruling.

⭐ Measured twice on `web`: `--set` **auto-redeploys** (2026-09-16: `DEPLOYING` 3 s after the set,
reaching SUCCESS), consistent with 2026-09-09 and not with the 2026-08-30 `chart-renderer`
reading. Expect a redeploy; verify the boot either way.

---

**THE THREE SPEND CEILINGS — AND THE "PER-NIGHT" ONE IS NOT PER NIGHT.**

`budget.py:101-105` names them in the source. Restated because a session brief was written
against the wrong one:

| ceiling | where | default | bounds production? |
|---|---|---|---|
| PC-side ledger `cap_usd` | `data/wisdom/extract/spend-ledger.json` | 100.0 | ⛔ **NO** |
| programme total | `WISDOM_EXTRACT_BUDGET_USD` | **120.0** | yes |
| per night | `WISDOM_EXTRACT_DAILY_BUDGET_USD` | 25.0 | yes |

⛔ **The ledger has no reader under `api/`** — the only readers are
`tools/wisdom/extract_golden_gate.py` and a test, proven with a control showing the same search
form does reach `api/`. `api/` is what production runs.
⛔ **And `cap_usd` is WRITE-ONLY even for the PC tool**: the gate reads only `entries` from that
file and takes its ceiling from `--max-usd` (default 40.0), writing `cap_usd` back as a record.
**Editing that number changes nothing, anywhere, in either direction.**

⛔⛔ **THE DEFECT, MEASURED BY EXECUTING THE REAL MODULE.** `select_within_budget`'s predicate
(`budget.py:271`) compares **cumulative programme spend** — `SUM(cost_usd_actual) FROM
wisdom_batches`, *no date filter* (`budget.py:242-248`) — against `cap = min(programme, night)`
(`batch.py:438`). So a per-night value does not ration a night; **it clamps the whole programme to
that number.** Seeded with $75 of night-1 actuals and ten $5 estimates: combined cap 75.0 →
**allowed 0 of 10**, reason *"budget stop (all extractor versions): actual $75.00 + … > cap
$75.00"*. Control, same DB, `cap=None` → 120.0 → **allowed 9 of 10**. **Night 2 gets zero while
$45 of programme headroom sits unused**, and spend asymptotes to the night cap rather than the
programme total.

⚠️ It binds on the N-pass path only (`batch.py:530`, `n <= 1` short-circuits past `night_cap_usd`),
and `WISDOM_EXTRACT_PASSES` is unset in production → `DEFAULT_PASSES = 3` → **it binds.**
⛔ There is no rail on this: `test_wisdom_npass_chain.py:246` pins only the *raise* direction.

⭐ **Consequence for any EXTRACT plan:** the knob that has to carry a corpus-sized budget is
`WISDOM_EXTRACT_BUDGET_USD`, not the ledger file. At the measured $0.058671/segment-pass, one pass
over the 9,733-segment catalog is **~$571** and three passes are **~$1,713**.

---

**WHAT ACTUALLY HOLDS EXTRACT IN PRODUCTION — AND IT IS NOT THE EMPTY TABLE.**

Measured 2026-09-17, `GET /api/admin/wisdom/core/status`:

```
production  wisdom_sources 0 · wisdom_segments 0 · wisdom_extract_requests 0 · wisdom_eval_runs 0
            wisdom_review_queue 36      <- non-zero: the reader works (the control)
local store wisdom_sources 63 · wisdom_segments 83 · wisdom_records 826 · wisdom_principles 91
            (data/wisdom/local-store/wisdom.db)
```

**Production has never held the corpus**; the programme's whole working set is local.

⛔ **But "0 segments ⇒ nothing_to_do" is the WRONG mechanism, and getting it wrong would mislead
the next session in three ways:**
1. `run_daily` does not read segments first — it **writes** them, from `wisdom_sources`
   (`batch.py:518` → `segment_pending_sources`, `batch.py:193-216`). The gating table is
   **`wisdom_sources`**. A store with sources and no segments segments them and submits.
2. The **golden gate is checked first** (`batch.py:519-524`). `golden.gate_status` reads
   `wisdom_eval_runs`, which is **0** in production, so it returns
   `accepted: False` and the real status is **`blocked_by_gate`**. ⭐ **The gate is holding the
   door, not the empty table** — and no readiness list named it.
3. **Retry rows are a second input** (`retry_rows`, `batch.py:239-242`, no join to segments): one
   `wisdom_extract_requests` row with status `retry` defeats `nothing_to_do` entirely.

So $0.00 spend requires **three** empty tables plus the gate — all four confirmed in production.

> ⛔⛔ **A first "paid night" that costs nothing and writes nothing is indistinguishable, in every
> dashboard, from one that worked.** Same well-formed-degraded-answer class as R42's demoted
> CALLs. **EXTRACT is not the next ruling.** Segments reach production only through the `sources`
> stream, and `WISDOM_SOURCES_INGEST_ENABLED` / `WISDOM_CAPTURE_ENABLED` are both off — and a
> golden-gate receipt has to be imported before the extractor will accept anything at all.

---

### 2026-09-17 (later) — the force-run spend path, and two instruments that lied

**⛔⛔ LIGHTING EXTRACT AND THEN FORCE-RUNNING THE CHAIN IS A SPEND EVENT, AND IT NEEDS NO SECOND
FLAG.** Found by adversarial verification while checking an unrelated claim.

`sources/__init__.py:18-21` gates the source streams like this:

```python
def _gate(ctx, reader, env):
    if getattr(ctx, "force", False) or reader():
        return None
```

So **`force` bypasses `WISDOM_SOURCES_INGEST_ENABLED` outright**, and `sources.run_daily` then
calls `transcripts.ingest_new(...)`, which walks `edu_videos` newest-first (limit 500) and writes
both `wisdom_sources` and `wisdom_segments` directly. The daily chain runs `sources` immediately
before `extract` **in the same run** (`publish/chain.py:62-67`).

⭐ **The consequence, in one sentence:** with `WISDOM_EXTRACT_ENABLED` on, a single ordinary admin
request — `POST /api/admin/wisdom/jobs/wisdom_daily_chain/run?force=true&dry_run=false`, the
obvious thing an operator does to check the switch they just flipped — takes the store from **0
sources to hundreds of sources to thousands of segments to three passes of up to 400 requests**,
inside one run.

⛔ **R52's acceptance string does NOT protect this.** `spend_allowed` short-circuits on the flag
(`batch.py:492-496`), so `WISDOM_EXTRACT_ACCEPT_SPEND` is only required when
`WISDOM_EXTRACT_ENABLED` is **off**. The literal exists for the forced-while-dark case, not for
this one. The only ceilings left are the $25/night and $120 programme defaults.

> **THE RULE. "Nothing will happen until 18:47" is false for any flag whose job can be
> force-run.** Before lighting a spend switch, decide what a forced run of every job that reads it
> would do, and say so in the same breath as the flip.

**✅ R52's THIRD ENTRY POINT — FIXED THIS SESSION.** `audit.run_audit` carried the pre-R52 form and
called `batch.submit_pending` directly, which has no spend gate of its own, so a forced weekly run
submitted **paid** audit batches with `WISDOM_EXTRACT_AUDIT_ENABLED` *and* `WISDOM_EXTRACT_ENABLED`
both off. $0 only because `select_segments` needs recent done requests and there were none — luck,
not a guard. Gate added beside the scheduling check; rail asserts **nothing reached the client**
and carries a control; mutation-proved.

---

**⚠️ TWO INSTRUMENTS LIED THIS SESSION, AND BOTH ARE THE SAME SHAPE AS R42.**

**1. `sources=ok` DID NO WORK.** `sources.run_daily` returns
`{"discord": {"skipped": …}, "transcripts": {"skipped": …}}` — the skip markers are **nested**, and
`chain._normalize` (`chain.py:196-204`) only inspects the **top level**. A fully skipped sources
step is therefore recorded as **`ok`** in the chain result and the observation log. ⛔ Do not read
`sources=ok` as evidence that anything was ingested; read the store counts.

**2. `capture=ok` IN 175 SECONDS, AND IT IS NOT GATED BY ITS OWN FLAG.** The chain's capture step
is declared `gate=None` (`chain.py:63`) — `WISDOM_CAPTURE_ENABLED` is read only by the standalone
slot jobs and the admin router, **not by the chain step**. `runner.run_all` iterates all 15
`families.DATASETS` and writes gzipped objects to R2; that is the 175 seconds. ⭐ It **cannot**
create extraction work: the only two writers of `wisdom_segments` are `segmenter.write_segments`
and `sources/common.insert_segments`, and no capture family reaches either. No model call occurs
anywhere in `capture/`.

---

**⚠️ AND THE LINE-ENDING CHECK THIS FILE RECOMMENDS IS UNRELIABLE THROUGH THE BASH TOOL.**

The documented cheap check is `git cat-file blob $(git rev-parse <sha>:<path>) | grep -c $'(a carriage return)'`.
Run through this environment's Bash tool it reported **CR on 100% of lines for every file
examined** — 133/133, 555/555, 920/920, 81/81. That is not a measurement; it is an **empty pattern
matching every line**, and "every file is uniformly CRLF" should have been the tell.

⭐ **Every blob in this repository is stored LF** (`core.autocrlf=true` normalises on the way in),
measured by reading raw bytes: `blob.count(b"
")` against `blob.count(b"
")`. Writing CRLF
over them was harmless — git cleaned it, and every recorded diff this session was minimal
(118/0, 2/0, 25/1, 36/0, 48/3) — but the *reading* was wrong, and the dangerous direction would
not have been.

⛔ **And it produced a VACUOUS MUTATION.** A mutation script anchored on `"    return value
"`
in an LF file failed its assert, wrote nothing, and the suite then reported **21 passed** — which
reads exactly like a mutation that failed to kill the tests. Always assert the anchor exists
**before** writing, and treat a mutation run that comes back green as unproven until the anchor is
confirmed applied.

⛔⛔ **AND ONE BARE CR DEFEATS `autocrlf` ENTIRELY — TURNING AN 84-LINE ADDITION INTO A 757/673
WHOLE-FILE REWRITE.** Measured here the same day. Writing this very section put a single lone
carriage return into the prose (an escape that resolved to a real CR instead of the two
characters). With that one byte present git declined to normalise the file at all: the STAGED
blob came out CRLF against an LF HEAD, and `git diff --cached --numstat` read **757 673**.
Removing that one byte and re-staging gave **84 0** and an LF blob.

⭐ **So `autocrlf=true` cleans a uniformly-CRLF working file, and silently does NOT clean an
irregular one** — which is the case you cannot see, because the working file still *looks* like
CRLF to every line-based check.
⛔ **`tools/check_repo_hygiene.py` CANNOT catch this**, and that is by design, not a bug: it
reports a path only when the two sides are identical once CRs are stripped, so on a file with
real added content it stays silent about endings. **Read `git diff --cached --numstat` before
every commit and disbelieve any count near the file's length.**
⭐ Count bare CRs as `data.count(bytes([13])) - data.count(bytes([13,10]))` on RAW BYTES. Escape
sequences in shell-embedded scripts are exactly what produced the stray byte, so a check written
with `a CR escape` in it can inject the defect it is looking for.

---

### 2026-09-17 (session 19) — R64/R65/R66/R67/R68, and a rule I broke by omission

**R64 — A FORCED RUN CAN NEVER SPEND.** R52 guarded the wrong half: it required an acceptance
literal for a forced run *while the switch was off*. The hazard is force **with the switch on**,
where `spend_allowed` short-circuited to True on the flag before it ever looked at `force`. And
the chain runs `sources` immediately before `extract` in the same run, with `sources` letting
`force` bypass its own switch outright — so `POST /api/admin/wisdom/jobs/wisdom_daily_chain/run
?force=true` would have taken the store from 0 sources to thousands of segments to three passes.
The literal is now **gone from the force path**: it is not a key, and no combination of variables
opens it.

⭐ **THE OLD TEST ASSERTED THE HAZARD AS A REQUIREMENT** —
`test_the_flag_alone_is_enough_when_it_is_on` asserted `spend_allowed(force=True)` was True with
the switch on, and called that correct. **When a guard is wrong, its rail is usually wrong in the
same direction**, so fixing the code without re-reading the test would have left the test to
restore the defect on the next refactor.

⛔ Every entry point now faces a **tripwire client that fails on the first attribute touch**.
Asserting on the return value is not enough: a refusal that had already built a client, or
already sent a batch, still returns `skipped`.

**R65 — THE PER-NIGHT BUDGET RATIONS A NIGHT.** It used to be handed to `select_within_budget`
as *the* cap and compared against cumulative programme spend, so it clamped the whole programme.
Two ceilings, two scopes, never a `min()` of the caps. Attribution is by SUBMISSION date
(`substr(submitted_at,1,10)`, which IS the ET date because `timeutil.iso_et` writes it) — a batch
submitted Friday and reaped Saturday belongs to the night whose budget authorised it.

**R66 — A STEP THAT DID NOTHING NO LONGER REPORTS `ok`.** And work is a **whitelist of write
counters**, not 'any positive number': `floor=0.8`, `lookback_days=10`, `candidates=5` are
thresholds and INPUTS, and counting them would let a step that skipped everything outvote its own
skip markers — the same defect one level down. The mixed case stays `ok` because **status is the
resume contract** (`_prior_ok_steps` selects `status='ok'`), so marking a partial step skipped
would re-run the half that already wrote rows.

**R67 — THE GATE VERDICT CROSSES, THE EVIDENCE DOES NOT.** An aggregates-only manifest, with a
**whitelist** classifier: 'reject anything that looks like a quote' is a judgement about text,
'accept only these shapes' is a judgement about structure, and only the second fails safe when
the source format changes. It is re-classified on the way IN, because the export's guarantee is
not inherited once a file has been through git and a human.

---

⛔⛔ **R68's FLAG HAS A SECOND CONSUMER, AND THE BRIEF DID NOT KNOW IT.**
`WISDOM_SOURCES_INGEST_ENABLED` is read in **two** places in `sources/__init__.py`: line 48 (the
daily transcripts ingest) **and line 72 (`run_weekly_sunday_scans`)**. So lighting it for a
Thursday night also arms **Sunday's** weekly step, which writes three further tables
(`wisdom_chart_images`, `wisdom_sunday_scans_checks`, `wisdom_source_attributions`).

⭐ Measured before flipping: `sunday_scans` makes **no model call** (searched with a control that
matches `grounding.py`, which does), and its only network call is a public unauthenticated
Substack GET. So the expansion costs nothing — but *a flag named for one stream gating two* is
exactly the shape that makes a flip's blast radius larger than its name.

> **THE RULE. Before flipping any flag, grep every reader of it — not the one the ruling names.**
> A ruling is written against the consumer somebody had in mind.

---

⚰️⚰️ **AND A SUBAGENT WROTE TO `C:\data` BECAUSE I DID NOT GIVE IT THE RULE.**

An investigation agent called `prompt.extractor_version()` to answer which version the gate
compares against. That reaches `vocab.ensure_seeded()` → `vocab.seed()` → `store.write()`, and
`store.db_path()` defaults to `/data/wisdom.db` — the live `C:\data\wisdom.db` on this box. It
wrote `wisdom_vocab` (32 rows, from the committed `setup-vocabulary-v1.json`) and one
`wisdom_seed_state` row. No member data; `wisdom_eval_runs`, `sources`, `segments` and `records`
all unchanged. **The agent disclosed it unprompted, at the top of its report.**

⛔ **The cause was my prompt.** The rules block I gave those agents covered scoped pytest, line
endings, mutation discipline and CODE-NEVER-PROSE, and contained **zero** mentions of the
shared-data-root prohibition. Measured: 0 occurrences in the workflow script. My own eight probe
scripts were clean — five applied `conftest.shared_data_root_census()` before importing `api.*`,
three never imported `api` at all.

> **THE RULE. A subagent inherits none of this session's context. Every prompt that can import
> `api.**` carries the shared-root sandbox instruction, or the agent is given a pinned
> `WISDOM_DB_PATH`/`DATA_DIR` before it starts.** `prompt.extractor_version()` in particular is
> not a read: it seeds.

---

### 2026-09-17 — R74: the autopilot, and the stop rules that need no judgement

Once EXTRACT is lit the programme spends money on a schedule nobody watches in real time. These
rules exist so that stopping is **mechanical**. A stop that requires somebody to weigh a night's
numbers is a stop that happens the morning after it should have.

**THE NIGHTLY VERDICT.** After every scheduled night, one line appended to the nightly table in
`OVERNIGHT-CHECKPOINTS.md`: date · segments · passes · $ actual · $ projected · errors · records
· floor PUBLISH/BLOCK/ENQUEUE · queue delta · verdict. Read from `wisdom_job_runs`, the ledger
and the store counts — never from `railway logs`, which reaches about twelve minutes.

**THE STOP RULES.** Any ONE of these fires `WISDOM_EXTRACT_ENABLED=0` (deploy-watched), records
the trigger *with its numbers*, and stops:

| # | trigger | why this number |
|---|---|---|
| 1 | night actual **> 1.5 ×** projection | a rate that moved, not a night that ran long |
| 2 | failed requests / submitted **> 10%** | the transport or the prompt is wrong, and every retry is billed |
| 3 | programme total **≥ budget − one night's p90** | the last night that can complete must not start |
| 4 | any paid-path step reporting **error twice running** | one is weather; two is a fault |
| 5 | **any member door found True** | nothing member-visible was ever ruled |

⛔ **RULE 3 IS THE ONE THAT IS EASY TO GET WRONG.** Stopping when the total *reaches* the budget
lets a night start that cannot finish inside it, and a half-submitted night is the UNRECONCILED
case: it costs money and scores nothing. Stop one night's p90 EARLY.

⛔ **RULE 5 IS NOT ABOUT SPEND.** It is in this table because the autopilot is the only thing
looking every night. A door that turns True without a ruling is an incident whoever notices it
first should stop, and the cheapest stop is the extractor.

⭐ **RE-ARMING IS NEVER AUTOMATIC.** A stop is a ruling request, not a pause. The session records
what fired, with numbers, and waits. ⛔ In particular a stop must never be re-armed by the same
run of reasoning that triggered it — that is how a threshold becomes a formality.

**BUDGET TRACKING**, one line beside the verdict: nights run · $ spent · $ remaining · nights
remaining at the current rate · corpus fraction (segments with ≥ 3 passes ÷ 9,733). ⭐ The
fraction is the only one of those that answers *are we getting anywhere*; the other four answer
*can we keep going*, and a programme can be healthy on all four while extracting nothing.

---

**⛔ AND THERE IS NO SEPARATE REAP SWITCH.** `wisdom_extract_reap` is gated by
`enabled=flags.extract_enabled` (`extract/jobs.py:25`) — the same variable as submission. So
`WISDOM_EXTRACT_ENABLED=0` stops BOTH: no new batches, and **no reaping of batches already in
flight**. Anything submitted before the stop stays open until it is re-armed or expires.
⭐ That is the right default for a runaway (it stops everything) and the wrong assumption for a
clean shutdown (it strands work you have already paid for). A stop taken mid-night should be
followed by a decision about the open batches, not treated as finished.

---

### 2026-09-17 — B3: can the imported gate verdict be superseded on the pod?

**NO, not by anything that runs on its own.** Nothing scheduled, chained or admin-triggerable
writes `wisdom_eval_runs`, and nothing on the pod can evaluate a golden set: the evaluator lives
entirely in `tools/wisdom/extract_golden_gate.py`, needs two required CLI paths, and refuses a
`--db` under the shared root. **Friday's spend cannot shut its own gate.**

⭐ The control for that absence is the part worth keeping: the same search **did** find writers —
three of them, including one nobody was looking for (`grounding.py`, an `INSERT OR REPLACE` in a
sibling package) and one outside `api/` (`import_eval_manifest.py`). A search that surfaces an
unexpected writer is a search that would have surfaced a fourth.

**YES through two deliberate acts, both needing PUSH_SECRET or a shell:**
1. `POST /api/internal/wisdom/extract/eval-runs` with a receipt. A receipt matching
   `(extractor_version, model, effort, split)` whose per-type numbers REGRESS gets
   `decision: "blocked"`, and `gate_status` takes the NEWEST matching row — so a worse
   evaluation silently shuts extraction.
2. Running the gate tool **inside the container** — its own docstring advertises
   `railway run --service web python tools/wisdom/extract_golden_gate.py …` — against a golden
   directory with no samples.

⛔⛔ **AND THE ZERO-SAMPLE PATH WAS A VACUOUS ACCEPT, NOT A REFUSAL.** With an empty `per_type`,
`decide_gate` treated the run as same-config against the single production row and recorded
**`accepted, baseline: True`** — a verdict that measured nothing, superseding one that measured
108 segments. ⭐ `import_receipt` did NOT have this hole (`golden.py:630-631` raises on an empty
`per_type`) — but that guard sat one layer up, in the RECEIPT path only; a DIRECT `record_eval`
call (the gate tool persisting the run it just measured) had no such check.

⛔⛔ **FIXED, session 25 (R98): `record_eval` itself now refuses an empty `per_type` — the
SHARED choke point both `import_receipt` and a direct gate run pass through.** Rails:
`tests/test_wisdom_extract_golden.py` — a zero-sample run raises and writes NO row (not a row
that happens to be blocked); a real run immediately after is unaffected; and the load-bearing
control, a NULL-only measurement (a type asserted absent across N segments, tp=fp=fn=0 but
`null_declared` nonzero) is correctly NOT refused — `golden.score()` keeps that measurement on
purpose (`n_null` in the emptiness check), and a naive "all-zero counts means nothing was
scored" fix would have deleted the single most useful NULL measurement the gate produces.
Mutation-proved: reverting the guard turns exactly the two zero-sample tests red.

> **THE RULE, NARROWED. The golden gate may run inside the container ONLY with: an explicit
> `--golden-file` naming real, uploaded bytes; an asserted sample count; scratch `--db` and
> `--data-dir` under the volume (never production's live `wisdom.db`/`wisdom_eval_runs` tables
> during the scoring run itself — only the AGGREGATES-ONLY manifest crosses back into
> production afterward, exactly as R67 already does for Opus's own gate-run-3); and the
> zero-sample refusal above actually serving in that image.** Without ALL FOUR, the rule is
> unchanged: never run the golden gate inside the container. The golden set is quote-bearing
> and deliberately not deployed by default — this narrowing does not change that; it describes
> the one supervised, bounded exception under which a real measurement, not a vacuous one, can
> happen there.

## 2026-09-18 — R93/R94/R95/R96 (session 23): the local attempt's real ceiling, and every
## path priced with real usage instead of a fresh estimate

**R93 — one bounded local attempt, 90-minute ceiling, honored.** Two fixes landed as
permanent `local_backend.py` defaults, neither touching `prompt.py`: `repeat_penalty=1.15`
(kills the repetition-loop collapse that hit 22% of session-22's segments) and
schema-constrained decoding, reusing `params["output_config"]["format"]["schema"]` — the
SAME contract Anthropic already enforces for the paid path — via llama-server's
`response_format: json_schema`. Measured on an isolated segment: 4/4 rejected
`quote_missing` at baseline → 0/4 with the constraint on. A local-only v2 prompt
(`local_prompt_v2.py`, its own `wx-local-v2-*` version, few-shot loaded from a gitignored
data file) added quote-first ordering + an explicit verbatim instruction on top.

⛔ **NET RESULT ON A 20-SEGMENT STRATIFIED SAMPLE (paid / v1 / v2 all sliced from the SAME
segments via `gate_records.load_phase`, the R12 canonical re-score path): FAIL on all six
types, both v1 and v2. Zero true positives against golden's specific expected records.**
The mechanism moved — `quote_missing` was eliminated by the schema constraint; the dominant
remaining failure is `reject:quote_absent` (present, not verbatim) — but that mechanism
shift did not convert into recall against golden's exact set at 7B/Q4_K_M. Full verdict:
`docs/wisdom/LOCAL-EXTRACTOR-VERDICT.md`.

⛔ **THROUGHPUT IS A SECOND, INDEPENDENT WALL.** Measured v1 rate on this contended box:
0.79 segments/min (76s/segment). One corpus pass (26,454 segments) is **23.2 days**; N=3 is
**69.6 days**. v2's added levers measured SLOWER per segment (longer prefill from the
few-shot turns) — the quality-adjacent fixes here cost clock, they do not buy it back.

**R94 — no GPU host reachable, measured not assumed.** This box: two NVIDIA GT 710s (2GB
VRAM each — too small to even hold a Q4_K_M 7B's ~4.5GB weights) plus an Intel UHD 770 iGPU
(untested — no dedicated VRAM, unlikely to beat CPU meaningfully for this workload). No
WSL2 installed. No SSH config beyond `github.com` in `known_hosts`. No documented remote GPU
host anywhere in this repo's docs. **Deliberately no LAN scan was run** — the ruling
explicitly asked for documented/reachable enumeration only, never indiscriminate probing.

**R95 — HOLD, honored structurally.** No paid extraction client was constructed this
session; `prompt.extractor_version()` was reasserted unchanged (`wx-v0-fc47bc97`) both by
the existing local-backend suite and by `local_prompt_v2`'s own tests.

**R96 — every path priced, with a blocker stated rather than papered over.** No Anthropic
API key was reachable this session — not in the shell env, not in a local `.env`, not in the
OS keyring (`uct-wisdom`/`anthropic`) — so `count_tokens`, the one paid-API call this
session's ruling permitted, could not be made. The pricing in
`docs/wisdom/PATH-PRICING-2026-09-18.md` instead reuses REAL, already-paid-for Anthropic
usage persisted from gate-run-3's own API calls (`data/wisdom/gate-runs/20260915T123550Z/
segments.jsonl` — real `usage.input_tokens`/`cache_read_input_tokens`/`output_tokens` from
83 real production-sourced segments). Stronger than a character estimate; still not the
fresh 500-segment production sample R96 asked for — that gap should close before any of
these numbers is treated as final. Density proxy (PRINCIPLE/MARKET_SIGNAL-bearing segments):
21.7%, from the same 83, explicitly the ONLY measured proxy since night 1 never ran.

⭐ **The cheapest path that buys the stated goal (judgement types at trusted quality,
mechanical types floor-scored) is SWEEP_N1_OPUS + a 2-pass targeted repass on the density
proxy: $1,103 p50 / $5,096 p90 — not HAIKU_ONLY's $462–$2,133, because Haiku's quality
against golden is UNMEASURED.** The one cheap measurement that would most change this
answer: an 83-segment Haiku golden run, priced at $0.48–$2.23 — close enough to free that
running it before committing to any paid path is close to free optionality.

## 2026-09-18 — R97/R98 (session 25): the Haiku golden run, measured, and one more
## structural rule for running the gate inside the container

**R98 — the vacuous-accept fix landed.** `record_eval` now refuses an empty `per_type` at
the SHARED choke point both `import_receipt` and a direct gate run pass through — not just
`import_receipt`'s own copy of the check. Verified via mutation (reverting the guard turns
exactly two new tests red). This is what let "never run the golden gate inside the
container" narrow from an absolute prohibition to a supervised, bounded exception.

⛔⛔ **`_SHARED_ROOTS = ("/data", "C:\\data")` in `tools/wisdom/extract_common.py` refuses
`--db` and `--out-dir` UNCONDITIONALLY under either root — including a "scratch"
subdirectory.** `--data-dir` is NOT checked (it is read-only input). The working layout for
any future in-container gate run: golden file + sample text under `/data/wisdom/scratch/`
(the persistent volume), `--db`/`--out-dir`/`--gate-runs-dir` under `/tmp` (the container's
own ephemeral filesystem). This is a permanent structural fact about the tool, not a
one-session workaround.

⛔⛔ **THE SAMPLE TEXT THE GOLDEN SET ANCHORS AGAINST DOES NOT EXIST IN PRODUCTION.**
`/data/wisdom/samples/` returns "No such file or directory" inside the container —
production's real ingested corpus (324 sources / 26,454 segments) lives in the database,
never as flat files at that path. Any future in-container golden run needs the SPECIFIC
sample files the golden set's records reference (computed via `golden.sample_key`, never
the full local samples tree — the dev split needed 45 of 396 files, 1.04MB gzipped vs the
full tree's 38MB), uploaded to the SAME scratch path `--data-dir` will read.

⛔⛔ **THREE MORE model-awareness bugs found and fixed by driving this end to end, each one
caught by evidence before it could cost anything:**
1. `extract_golden_gate.py`'s own `--model` CLI flag never reached
   `prompt.extractor_version()` — caught by a `--dry-run` printing Opus's exact pinned
   version for a `--model claude-haiku-4-5` invocation. One-line fix:
   `prompt.extractor_version(model=model)`.
2. **Haiku 4.5 rejects `output_config.effort` outright** — caught by a REAL first
   submission (not a dry-run: the estimator has no way to see a request-validation
   rejection coming), 35/35 errored, $0.0000 actual (an errored batch item is not billed).
   Fixed via `prompt.NO_EFFORT_MODELS`, an explicit, evidence-only allowlist — never guessed
   forward to Sonnet or any other untested model. Opus's request shape verified
   byte-for-byte unchanged.
3. `land_master_first.py` crashed printing a pre-push refusal containing a Unicode
   character this console's cp1252 codepage can't encode — AFTER a real `git push` had
   already succeeded on an EARLIER attempt, meaning the tool could land cleanly and still
   fail to report why a LATER attempt was refused. Fixed by reconfiguring stdout/stderr to
   UTF-8 once, in `main()`.

⛔ **A batch survives the connection that submitted it; the polling process does not.** An
ssh session disconnecting killed the local Python process via SIGHUP mid-poll on the first
(pre-fix) submission — the batch itself, already accepted by Anthropic, kept processing
server-side regardless. Recovered by reconnecting to the known batch id directly
(`client.messages.batches.retrieve`/`.results`), never by resubmitting. The real run was
launched via `nohup` (this minimal image's shell has no `disown`, but `nohup` alone was
sufficient, confirmed directly by watching it survive a disconnect) specifically to avoid
repeating this.

**R97 result: zero of six types clear.** Full table:
`docs/wisdom/PATH-SELECTED-2026-09-18.md`. Real spend for the complete, correct 83-segment
measurement: **$0.3469** — roughly 6x cheaper than the pre-flight's worst-case estimate,
consistent with every other model measured this session. Per the session's own decision
rule (Haiku clears zero of the four mechanical types) — **SWEEP_N1_OPUS is selected**, not
armed: it requires R79 (pending ≠ queued), a feature this session has no prior
specification for beyond its name and requirement, and commits PRODUCTION's live scheduled
chain to a multi-night, multi-hundred-to-multi-thousand-dollar autonomous spend. Stopped
for the owner's decision with the real numbers in hand. Full session record:
`docs/recon/2026-09-18-session25-haiku-in-container.md`.

### 2026-09-18 — Session 27: R79/R100 landed, then R99/R100-cost-attack — every lever smaller than hoped

**R79 (owner ruling)**: a floored record with no measurement yet (stability/runs NULL, or
runs < MIN_RUNS) is now **PENDING**, distinct from **BLOCK** (measured and below the floor).
`floor.passes()`/`sql_clause()` are UNCHANGED — PENDING still withholds publication exactly
like BLOCK always did. What changed: `enqueue_blocked` only queues genuine BLOCK rows now;
PENDING is counted (`records_pending`, on the admin `/status` route) but never reaches the
owner's review queue. This REVERSES R89's own prior, explicitly-documented choice to queue
PENDING identically to BLOCK — see `floor.py`'s `status()` docstring and the rewritten tests
in `test_wisdom_item3_floor.py` for the full reasoning either direction.

**R100 (owner ruling)**: `pending_segments` selects fresh segments by
`config.category_priority_order()` (15 named categories, R15-normalised) before date. Two-phase
fetch (lightweight sort, then a targeted full refetch) so a 26k-segment backlog doesn't load
full text just to order it. `WISDOM_EXTRACT_PRIORITY` overrides; unset uses the owner-approved
default order.

**Both armed for real** (`WISDOM_EXTRACT_ENABLED=1`, N=3, 6,000-request/night limit, $1,800/$400
programme/night budget) — then **PAUSED** (`WISDOM_EXTRACT_ENABLED=0`) before its first
scheduled run, at the owner's explicit direction, because the very next session attacked the
cost basis the arming was built on. Re-arming needs a fresh owner ruling on the priced table
below, not an assumption that pausing was temporary.

⛔⛔ **THE COST-REDUCTION LEVERS ALL UNDERDELIVERED RELATIVE TO THE HOPE, MEASURED FOR ~$0.77
REAL SPEND.** Full numbers: `docs/wisdom/COST-REDUCED-PRICING-2026-09-18.md`,
`docs/recon/2026-09-18-session27-cost-levers.md`.

- **Sonnet measured ~30% cheaper than Opus per segment, not ~80% cheaper.** `claude-sonnet-5`
  is 2.5x cheaper than Opus per TOKEN ($2/$10 vs $5/$25); the real gap is much smaller because
  Sonnet generates proportionally more output for this extraction task. Quality is UNMEASURED —
  the golden run was interrupted at 19 of 83 segments (see the container-restart incident below)
  and per-type predicted counts at that N are single digits, too small to answer
  R101_CLEAR_RULE. Completing a real, recordable verdict needs ~$2.58 more than what was spent.
- **The lexical pre-screen (R102) skips ~8.9% of segments, not 40-60%.** The screen fires on
  ANY of seven broad signals (cashtag, ticker-shaped token, company name, sector word, price
  token, principle vocabulary, signal vocabulary) and trading-show narration trips at least one
  of them almost everywhere — the screen is deliberately loose (golden-v1.1's own design:
  absence must be the safe claim), which is exactly what caps its value as a cost lever.
  Zero recall loss measured on the 83-segment golden split. Built
  (`tools/wisdom/null_screens.py` + `api/services/wisdom/extract/prescreen.py`,
  `WISDOM_EXTRACT_PRESCREEN_ENABLED`), NOT enabled.
- **Targeted N (R103) density is 31.3%, not "most segments."** 68.7% of segments produce at
  least one floored-type record on pass 1 alone and would still need passes 2/3; only 31.3%
  could ever skip them, saving ~21% of total N=3 spend. Measured from gate-run-3's real 3-pass
  data; the production pass-scheduling change itself was NOT built, on the reasoning that a 21%
  return should be priced before the engineering is spent building it.
- **Output cap (R104) real savings are unquantified.** The measured distribution is real (p50
  2,259 / p90 10,376 / p99 15,522 / max 18,857 tokens), but a cap's true recall cost depends on
  where in a truncated response the lost records fall — unmeasurable at $0, since production
  already retries a `max_tokens` stop at lower effort rather than losing the request outright.
  A pessimistic (whole-response-lost) upper bound is documented; the honest number needs a real,
  cheap re-run this session did not spend on.
- **Cache (R105) is already substantially exploited**: `cache_read_share: 0.7594` on Opus's own
  gate-run-3 calibration. No further lever identified.
- **Stacked, honestly:** Opus + prescreen + targeted-N ≈ **$2,300–3,500** for the full corpus at
  N=3 (down from $3,175–4,872), roughly a quarter to a third off, not an order of magnitude.

⛔⛔ **A CONTAINER RESTART MID-RUN LOST NO MONEY BUT LOST ALL LOCAL STATE, BECAUSE THE STATE WAS
PUT IN THE WRONG PLACE.** Railway's "sleep when idle" restarted the web pod mid-Sonnet-run (the
same incident class as `incident_web_bars_coverage_collapse_2026_08_25`). The two in-flight
batches survived on Anthropic's side untouched (batches are async, server-side, addressable by
ID regardless of local process state — the same fact session 25 already established for an ssh
disconnect). **What was lost: `extract_golden_gate.py`'s own `--db`/`--out-dir`/ledger, because
this session put them under `/tmp`** (ephemeral container filesystem, wiped on restart) instead
of `/data/wisdom/scratch/` (the persistent volume). `/tmp` was the RIGHT choice for the read-only
sample/golden data reused from session 25; it was the WRONG choice for anything that needs to
survive past one process's lifetime. **Rule for the next golden-gate run in-container: `--db`,
`--out-dir` and `--ledger` all belong under `/data/wisdom/scratch/`, never `/tmp`, whatever else
is true about the run.** Recovery without any resubmission or double-charge was still possible —
`run_batch_round`'s custom_id scheme (`g{phase[:1]}{round:02d}x{i:03d}`, `i` a chunk-local index
into `load_gate_segments()`'s deterministic sorted output) let the exact segment correspondence
be reconstructed from the batch IDs alone — but that recovery cost real engineering time an
un-lost run would not have needed.

**Pricing discrepancy resolved for Wisdom, filed for its owner:** Anthropic's real Sonnet-5
price is $2/$10/MTok (fetched from the official pricing page, 2026-09-18) — `budget.py`'s row
is correct. `api/services/catalyst/cost_guard.py`'s `claude-sonnet-5` row ($3/$15) duplicates
the Sonnet-4.6 legacy price onto the 5 key. Wrong, and not this session's file to fix — a
different subsystem. Filed here so the catalyst engine's owner finds it.

**Nothing armed by this session beyond what session 26 already armed and this session then
paused.** `R95` (path selection) and `R106` (a monthly spend line) are open owner questions;
see the recon doc's own "what's still open" section.

## Session 28 (2026-09-19) — R95 resolved (N3_PRIORITY_TO_CEILING), then re-paused on cost;
## Discord scope widened; a real pre-existing corpus found and reconciled

**R95 resolved by owner ruling: "rule N3_PRIORITY_TO_CEILING, fund the Sonnet finish."**
Session 26's Opus N=3 priority-to-ceiling extraction was re-armed exactly as built
(`WISDOM_EXTRACT_ENABLED=1`, unchanged N=3/opus/$1800/$400/6000-segment/15-category-order),
verified live via `flags.extract_enabled()` in-process, not just `railway variables --kv`. The
Sonnet golden-gate finish was attempted (dry-run clean, 83 segments, $6.00 cap) but the actual
paid launch was refused by the auto-mode security classifier (`[Real-World Transactions]`) —
not routed around; the exact command was handed to the owner instead.

⛔⛔ **THE OWNER THEN BALKED AT THE $1800/$400 FIGURE AND THE EXTRACTION WAS RE-PAUSED THE SAME
SESSION** (`WISDOM_EXTRACT_ENABLED=0`, verified via a forced redeploy + in-process check —
`railway variables --set` auto-redeployed this time, confirming yet again that its
restart behavior must be VERIFIED, never assumed either way). A live production count at pause
time: **11,027 segments total, ZERO ever extracted** (`wisdom_extract_requests` empty) — this
would have been a genuinely first real production run, not a resumption.

**A cost investigation (forked) found the $1800 figure was itself a 15x scale-up from this
programme's own original design point.** The original 2026-09-13 manifest priced full
back-catalog extraction at ≈$30-80 one-time, with `WISDOM_EXTRACT_BUDGET_USD` defaulting to
$120 total / ~$23 per night — Session 26 raised both 15x. The architecture itself (N=3
reproducibility, individually floor-gated CALL/MENTION/PRINCIPLE records) is NOT the cost driver
and should not be abandoned for a cheap RAG/embedding substitute — that substitute cannot
produce individually-verified, publishable, backtestable facts, which is the actual point of
this pipeline (§3-4 of the manifest: CALL-REPLAY, outcome-weighted eval, Substack citation). The
scale the budget runs at is a separate, freely revisable knob.

⛔⛔ **A REAL, ALREADY-COMPLETED PRE-WISDOM-LOOP CORPUS EXISTS AND MUST NOT BE RE-EXTRACTED.**
`C:\Users\Patrick\uct_intelligence\data\processed\processed_messages.json` — 7,766 #tsdr Discord
messages, classified, 2024-03-11 → 2026-02-20 — is EXACTLY the "Legacy #tsdr" seed import
(source version 0) the manifest already names, with a purpose-built reconciliation tool
(`tools/wisdom/sources_discord_legacy_ids.py`) that marks these ids `legacy_classified=1` so the
extraction view (`wisdom_sources_extractable_segments`) never re-offers them. **That tool had
NEVER been run** — both `wisdom_discord_messages` and `wisdom_discord_state` were at 0 rows
before this session. Dry-run confirmed clean (7,766 ids, date range matches exactly); the real
`--apply` POST to `/api/internal/wisdom/sources/discord/legacy-ids` was refused by the auto-mode
classifier (`[Modify Shared Resources]`, a production write) — command handed to the owner to
run directly, not attempted via a workaround.

Also found alongside the export, at zero extraction cost: `trader_profile.json` (aggregate
stats + a written style_summary) and `trading_rules.json` (a genuinely good rules_summary +
looser keyword-bucketed raw-quote arrays — useful as a style seed, NOT a substitute for
individually-verified CALL records). Not yet wired into anything; flagged to the owner as a
free head start.

**A second fork investigated whether to reuse the existing `uct_intelligence` Discord bot
(the thing that produced the export above) instead of this repo's own `discord.py` ingestion.**
Verdict: no. That bot is architecturally single-channel (`DISCORD_CHANNEL_TSDR`, one hardcoded
id), has been dormant since ~Feb 2026, stores every message with no author allowlist (conflicts
with this pipeline's `S0.4e` privacy rule), and its classification is single-pass RAG-context
quality with no reproducibility gate. Confirmed the separation was a deliberate prior design
choice (manifest + `docs/wisdom/methodology/sources-v1.md`), not an oversight — the legacy
export's correct role is exactly the one-time seed it's already slotted as.

**Discord scope changed by owner ruling, 2026-09-19:**
- **Jersace added as a 5th CALL author** (`docs/wisdom/authors.json`, `docs/wisdom/discord-sources.json`
  key `jersace`, channel `1216768669598613514`) — the owner ruling live in conversation IS the
  "owner review" the authors-file readme requires before a 5th author is more than a candidate.
  `discord_user_id` left `null`, marked PENDING: the bot has no grant on `#jersace` (403), so
  authorship could not be measured the way it was for the other four (`GET .../messages?limit=50`
  all-one-author). **Verify authorship and fill in the id once granted, before trusting this
  author's messages for CALL attribution.**
- **Main Chat added** (`main_chat`, `1216816863313657886`) — already bot-readable (200), no
  grant needed. Measured 2026-09-19: 17 distinct posters in the last 100 messages, only 1
  (braczyy/Bracco) is a named CALL author. Under the current author-only storage filter this
  channel captures almost nothing.
- **The SETUP EXAMPLES category's 18 channels added** (`setup_examples_*` keys, category
  `1443971380289994934`) — same author-only-filter problem as Main Chat, more sharply: these
  channels exist FOR non-author community members to post real setup examples.
- ⛔⛔ **OPEN, NOT DECIDED: whether to broaden the storage filter for Main Chat and Setup
  Examples beyond the named CALL authors, to capture other members' posts as MENTION-only
  (never CALL, never PRINCIPLE) content.** This is a real change to the `S0.4e` privacy
  guarantee ("only messages whose author_id is in authors.json are stored"), not a config
  toggle, and needs its own explicit owner ruling before it's built.
- **A 6th candidate author, "AtTheAsk," named by the owner could not be resolved.** No channel
  in the guild matches that name or handle. One TRADERS-category channel (`alex-jones`,
  `1216760919254892545`) doesn't fit the alias-as-channel-name pattern the other five follow,
  flagged as an unconfirmed candidate (`candidate_at_the_ask`, `in_scope: false`) pending the
  owner's confirmation — and the bot has no grant on it either way (403).
- **`WISDOM_DISCORD_LISTENER_ENABLED` was found unset** — the listener job
  (`wisdom_sources_discord_listener`, cron :13/:28/:43/:58 ET) is registered and would run, but
  its own dedicated kill switch (separate from `WISDOM_INGEST_ENABLED` /
  `WISDOM_SOURCES_INGEST_ENABLED`, both already on) was never flipped. This is why both Discord
  tables were still at 0 rows despite the master switches reading on.
- **Channels needing a manual Discord permission grant before the listener can read them**
  (bot role, same VIEW_CHANNEL(+READ_MESSAGE_HISTORY) override pattern as the original four):
  `#jersace`, all 18 SETUP EXAMPLES channels, and `alex-jones` if confirmed as AtTheAsk.

**`The Mental Game` dropped from `WISDOM_EXTRACT_PRIORITY`** by owner ruling (an old,
no-longer-produced segment) — the DB is at least consistent with this: all 54 sources cluster on
a single day (2026-06-19) rather than a spread of episodes, unlike every other category.

## Session 28 continued (2026-09-19) — Sunday Scans (Substack) ingested for the first time;
## it was already fully built and armed, never fired

Owner asked to widen source scope to "the Substack stuff" (The Desk's weekly market-prep
posts) alongside the Zoom/YouTube content (already fully covered, no change needed) and
Discord. Investigation (forked) found **there was nothing to build**: Sunday Scans ingestion
(`api/services/wisdom/sources/sunday_scans.py`, spec `docs/wisdom/methodology/sources-v1.md`
§4) already existed in full — HTML→text conversion, section-based segmentation
(`segmenter.py::segment_sunday_scans`), and per-section author resolution
(`segmenter.py::section_author`) — and was already wired into the `wisdom_weekly_chain` job
(cron Sun 19:52 ET), gated by the two master ingest flags, **both already on**.

⛔⛔ **IT HAD NEVER FIRED, and the reason was pure timing, not a bug.** Built and armed
2026-09-13 (a Sunday); `wisdom_job_runs` had zero rows for the weekly chain before this
session, and `wisdom_sources` had zero `sunday_scans`/substack rows despite everything reading
armed. The weekly cron's first real opportunity would have been 2026-09-20 (the next Sunday)
— less than one full week had passed since it was built. Confirmed via
`registry.run_job('wisdom_weekly_chain', force=True, dry_run=True)` before touching anything
for real.

**D4 ruling (the section-attribution design), confirmed exact and already coded:** unsigned
Sunday Scans sections resolve to `tsdr` (never `team-unresolved`, never skipped) —
`section_author()` matches a section heading against `authors.author_for_alias()` first
(e.g. "Bracco's Breakdown" → bracco, high confidence) and falls back to `("tsdr", "medium")`
only when nothing matches. This is the SAME distinction, worked out correctly here on the
first pass, that the Discord authorship work earlier this session had to learn by mistake
(AtTheAsk misidentified once) and by design (§0.4e's author-allowlist) — a fallback with a
LOWER confidence tier, never an unattributed or fabricated one.

**Run for real, 2026-09-18 23:03-23:04 ET.** `registry.run_job('wisdom_weekly_chain',
force=True, dry_run=False)` — three real steps all `ok` (`sunday_scans`, `contradictions`,
`weekly_report`); the fourth, `extract_audit`, self-skipped under **R64: "force never spends"**
— a forced/manual chain run can never trigger paid extraction, by design, regardless of any
env var. Result: **65 new `wisdom_sources` rows** (`stream='sunday_scans'`, all
`host_author_id='tsdr'` at the source level), **1,533 new `wisdom_segments`** (28,121 total,
up from the prior session's count). Verified the per-section resolution actually worked, not
just ran: 443 segments `author_id=tsdr`/high (signed TSDR sections), 70 `author_id=bracco`/high
(signed Bracco sections), 685 `author_id=tsdr`/medium (unsigned sections — INTRO, Market
Breadth Data, Earnings & Economic Calendar, Index & ETFs — correctly defaulted per D4, not
dropped). No chartmaster/manrav/jersace/attheask sections appear in this corpus, which is
expected — Sunday Scans is TSDR's own weekly post with occasional Bracco sections; those other
four authors' content lives in Discord/Zoom, not here.

**Zero paid extraction touched by any of this.** `WISDOM_EXTRACT_ENABLED` is still `0`
(paused earlier this session on the owner's cost concern) and nothing above required or
enabled it — ingestion and segmentation are free; only the extraction pass costs money, and
R64 makes that structurally true regardless of how the ingestion job is triggered.

**Discord grants completed by the owner directly** (Claude Code's own `[Permission Grant]`
classifier declined to perform this write, from both the terminal and mid-click in the
browser): `#jersace` granted View Channel + Read Message History; verified live via the bot's
API (403→200, real messages returned) and Jersace's authorship confirmed the same way as the
original four (48/50 recent messages from a single author, `jersace.x`,
id `395070112748666881`). `#bracco` re-confirmed working at the same time. Still open: the
SETUP EXAMPLES category (18 channels) and the AtTheAsk/`alex-jones` question above.

## Session 28 closed out (2026-09-19) — Setup Examples granted, Twitter/X built,
## everything landed to master and verified live end to end

Owner granted the SETUP EXAMPLES category (18 channels) the same way as jersace; all 18
confirmed 200 via the bot's API. Real data settled the open authorship-scope question with
measurement, not a guess: 56 of 57 sampled messages across all 18 channels are from the six
named authors (mostly tsdr/bracco) — unlike Main Chat, the existing strict author-only filter
already captures nearly everything here, no broadened-capture change needed.

**Twitter/X built** (`api/services/wisdom/sources/twitter.py`) per the owner's "full ongoing
pipeline" ruling: reads the existing `tweets.db` cache read-only for exactly the three official
accounts (never calls the Twitter API itself), one tweet = one source = one segment matching
Discord's model (not Sunday Scans' — a tweet never changes after posting, so there is no
content-hash re-versioning to do), idempotent by tweet id, its own kill switch
(`WISDOM_TWITTER_LISTENER_ENABLED`) on a 6-hour cadence. **Caught two silent, dangerous bugs
before either shipped**: the base contract's `wisdom_sources.stream` and `wisdom_segments.kind`
columns are `CHECK`-constrained to fixed enums that do not include `'twitter'`/`'tweet'` —
`INSERT OR IGNORE` swallowed both violations with zero rows written while `written=N` was still
reported. Found by testing real table content rather than the returned dict, mutation-proved,
fixed to the schema's own already-reserved values (`stream='x'`, `kind='message'`).
`TWEET_RETENTION_DAYS` extended 7→30 as a rescue for the tweets already sitting in the cache
while this shipped.

**A full-suite run (not just the narrow file touched each time) turned up three more tests left
stale by earlier tonight's Discord scope work** — `call_authors()` still asserted the original
four, `discord_status()`'s channel count still asserted 4, and two tests used `#main-chat` as
their "must be refused, out of scope" fixture after Main Chat was correctly made in-scope for
AtTheAsk. Fixed; two of the three now derive their expected value from the real config instead
of a literal, specifically so this doesn't recur the same way next time scope changes.

**Landed to master** (`dd2acb5a0`) once the pre-push guard found a genuinely quiet window —
it had correctly refused for over an hour on real concurrent activity from other sessions, not
red tape. Confirmed via ancestry (`git merge-base --is-ancestor dd2acb5a0 origin/production`),
not by trusting a commit-hash string, since `production` (what `web` actually serves, a separate
branch from `master`) was itself being raced by unrelated concurrent work the whole time.
Confirmed live in the running container directly: `twitter.py` present on disk, all six authors
resolve, `twitter.STREAM == 'x'`, both new job specs registered.

**Extraction re-armed at the moderate pilot scale** the owner chose after the earlier
15x-overscale pause: `WISDOM_EXTRACT_BUDGET_USD=175`, `WISDOM_EXTRACT_DAILY_BUDGET_USD=28`,
`WISDOM_EXTRACT_ENABLED=1` — confirmed in-process, not just set. Model/passes/segment-limit/
priority order left exactly as before. The daily chain only runs on trading days
(Mon-Fri 18:47 ET); today is a weekend, so the first real pass fires Monday regardless of when
the flag flipped.

**Both new listeners flipped on and manually fired once each for real, immediate verification**
rather than waiting on their natural cron slots (15 min / 6 h): Discord wrote **2,548 new
sources** across all six authors (bracco 524, manrav 522, tsdr 509, chartmaster 496, jersace
488, attheask 9 — Main Chat's backfill reached one page of recent history) plus the 18 Setup
Examples channels; Twitter/X wrote **126 tweets** (chartmaster 84, tsdr 22, bracco 20), zero
errors. `wisdom_segments` total: **30,795** (up from 28,121), exactly +2,674 = 2,548 + 126, one
segment per source as designed. `WISDOM_EXTRACT_ENABLED` was `0`/newly `1` at $28/night the
whole time — none of this ingestion touched paid extraction; R64 ("force never spends") makes
that structurally true regardless.

Every content source discussed this session is now live and verified end to end: Zoom/YouTube
(unchanged, already complete), Substack/Sunday Scans (65 sources), Discord (all six authors +
Main Chat + Setup Examples), and Twitter/X (all three official accounts) — with extraction
re-armed at a budget the owner chose with real numbers in front of them, not one that crept up
15x unnoticed.

## Session 28, first real extraction (2026-09-19) — a real sizing bug found and fixed before
## a dollar was spent, then the programme's first-ever real extraction run

Owner asked to run real extraction tonight rather than wait for Monday. Investigated the "run it
now" path fully rather than bypass anything: `registry.run_tracked()` is already public
specifically because some work is event-triggered rather than scheduled (R70's own doc), and
calling it directly with `force=False` and a real due_key is not a workaround of R64 ("force
never spends") -- it is simply running the real, unforced job outside its normal cron trigger,
with every actual spend gate (`flags.extract_enabled()`, the budget caps) fully intact. No code
was changed; no new deploy was needed.

⛔⛔ **A REAL SIZING BUG WAS FOUND AND FIXED BEFORE ANY MONEY WAS SPENT.** Re-arming extraction
earlier tonight had changed the DOLLAR caps ($1800/$400 → $175/$28) but never correspondingly
scaled `WISDOM_DAILY_SEGMENT_LIMIT`, left at `6000` (sized for the original $400/night budget).
At that limit, pass 1 alone (2000 segments) cost ~$27.99 -- essentially the entire $28 cap by
itself. Since publication requires all 3 passes to complete (`floor.MIN_RUNS = 3`), a real run at
the old limit would have spent the whole nightly budget on pass 1 only, left passes 2 and 3
starved, and produced **zero publishable records** -- money spent for nothing usable, the exact
failure class Session 27's interrupted Sonnet run already taught this program to watch for.

Measured directly rather than assumed, since per-segment cost varies with which segments are
selected (priority order matters, not a flat rate): the first correction attempt
(`WISDOM_DAILY_SEGMENT_LIMIT=1800`, 600 segments/pass) still produced the same $27.99/pass
result, because the $28 cap -- not the segment limit -- was the binding constraint at that size
too. Probed real cost directly with `batch.submit_pending(ctx, limit=n, ...)` at
n=50/75/100/125/150/200 (clean linear data, ~$0.0886/segment once the limit no longer left the
cap doing the trimming) and confirmed n=105: **105 segments/pass × 3 passes = $27.90 total**,
safely under $28 with real headroom. Set `WISDOM_DAILY_SEGMENT_LIMIT=315` (105 × 3). Confirmed via
a full dry-run: all three passes showed $9.30 each with zero budget-stop, versus the prior
configuration's pass-3 stop at "$55.98 vs $28.00."

⭐ **A second finding, also caught before it caused a problem:** `claim_slot`'s idempotency table
(`wisdom_job_claims`) does not distinguish a dry-run preview from a real run when checking
"already done" -- the natural `session_key(now)` due_key ("2026-09-18", the last real trading
session a Saturday resolves to) turned out to already be claimed `status='ok'`, because the
REAL scheduled `wisdom_daily_chain` already ran normally at 18:47 ET on Wed/Thu/Fri
(2026-09-16/17/18) -- the chain itself runs on the master ingest switch regardless of
`WISDOM_EXTRACT_ENABLED`, so those runs completed with `extract` merely skipped (the flag was off
those days), and the slot still shows 'ok'. Used a distinct, clearly-labeled due_key
(`manual-2026-09-19`) for this deliberate off-schedule run instead of colliding with an
already-completed real slot.

**Run for real, 2026-09-19 08:51 ET.** `registry.run_tracked('wisdom_daily_chain',
chain.daily_job, due_key='manual-2026-09-19', force=False, dry_run=False)` — the `extract` step
reported `status: ok` (not R64-skipped, since `force=False` this time). **Three real Anthropic
batches submitted**: `msgbatch_01V7MPuhk5zwCqfgWQBKsrJj` (105 req, $9.72 est), `msgbatch_01T2F2mfniHYm5g3BvnuErGK`
(105 req, $9.72 est), `msgbatch_01XBxjknyUccqcDSfF1jTeCi` (92 req, $8.51 est) — 302 requests,
~$27.95 total, all `in_progress`. **This is the first real, non-golden-set extraction spend in
this programme's history.** `wisdom_extract_reap` runs automatically every 30 minutes
(`:16`/`:46`) and will pick these up and drive same-night reconciliation (R70) once Anthropic
completes them — no further manual action needed for this run to finish on its own.

**Segment sizing is the one thing to re-check before the NEXT scale-up.** $27.90 for 105
segments × 3 passes was measured against tonight's specific priority-ordered candidate set
(currently topped by Setups & Strategies); if the budget or priority order changes again,
`WISDOM_DAILY_SEGMENT_LIMIT` needs re-measuring the same way -- probe real candidate costs with
`batch.submit_pending(ctx, limit=n, ...)` at a few values, never assume a linear rate holds
across a different-sized or differently-ordered selection.

## Session 28, part 2 -- the real batches landed, and a real N-pass bug with them (2026-09-19)

**The first real content landed.** All three batches from the entry above reaped cleanly: 338
records (44 MARKET_SIGNAL, 143 MENTION, 151 PRINCIPLE -- zero CALL/NEGATIVE_CALL this round,
because the R100 priority order (owner ruling 2026-09-18) puts "Live Trading Sessions" LAST and
"Setups & Strategies" near the front; CALL-bearing content arrives once the queue works its way
there). `author_id` is NULL on every one of the 338 -- verified as CORRECT, not a bug: all five
source videos are from the "Setups & Strategies" show, `edu_videos` has no host/presenter column,
and none of their titles self-identify a single host (one names BOTH Chartmaster and TSDR, so
`host_author_from_title` correctly refuses to guess). With diarization off program-wide, R6's
rule applies exactly as written: no signal, no author, PRINCIPLE/MENTION rather than a guess.

**The same-night reconciliation rider (R70) fired correctly and automatically** -- no manual
action needed, confirming that whole mechanism works end to end for the first time on real data.
But it REFUSED to score stability: `"refusing to reconcile runs over different segment sets --
...: 20260919T085013Z-chain-p2: missing 2, extra 1; ...-chain-p3: missing 14, extra 1"`. All 338
records are permanently stuck at `stability = NULL`, which the publication floor reads fail-closed
forever -- this specific night's content can never clear it. That is the CORRECT response to bad
input (reconcile comparing segment sets, refusing rather than guessing, is precisely the
discipline this programme is built on) -- but the INPUT should never have been bad, because a
night's three passes are supposed to run over the IDENTICAL segment set by construction
(`run_daily` queries `pending_segments` ONCE and hands the same `segs` list to every pass).

**Root cause, traced to `batch.py::submit_pending`'s own internal budget trim, not the shared
segment list.** `select_within_budget`'s per-item loop can return `allowed_count < len(items)`
when the night's REMAINING budget is positive but too small for a pass's full segment list --
and the old code took `items[:decision.allowed_count]` and submitted that PARTIAL subset. Real
numbers from tonight: pass 1 and pass 2 were each ESTIMATED at $9.72 (est_cost_usd, computed at
submission time), leaving only ~$8.57 of the $28 night cap for pass 3's own $9.72 estimate --
positive, but short -- so pass 3 shipped only 92 of the same 105 segments passes 1/2 got.
`run_daily`'s own pre-check (`if remaining <= 0: skip the whole pass`) is a CHEAP check for FULL
exhaustion only; it has no way to see "remaining is positive but insufficient for this pass",
which is exactly the shape that broke parity. The `run_daily` code already had a comment saying
the intended behavior -- *"a pass that would cross it submits nothing rather than part of a
pass"* -- but nothing enforced it at the point where the trim actually happens.

⭐ **The existing test, `test_a_pass_that_would_cross_the_night_budget_submits_NOTHING`, could
never have caught this** -- it mocks `submit_pending` entirely, so it only proves `run_daily`'s
outer `remaining <= 0` gate works, never that `submit_pending`'s OWN trim respects pass parity.
Same shape as this whole file's other vacuous-test lessons: a test that mocks the exact function
under suspicion cannot see what that function does.

**Fix:** a new `all_or_nothing: bool = False` parameter on `submit_pending`. When True and
`decision.stopped`, the WHOLE pass is refused (`selected = []`, `status =
"would_break_pass_parity"`) instead of shipping `items[:allowed_count]`. `run_daily`'s N-pass
loop now passes `all_or_nothing=True` on every pass. A night that cannot afford every pass in
full now does FEWER FULL passes (and reconcile correctly reports "only N persisted run(s); need
3" -- an honest, visible gap) instead of shipping unreconcilable partial data that already cost
real money. Two new tests in `test_wisdom_npass_chain.py`: a spy-based wiring check
(`test_run_daily_asks_every_pass_to_refuse_rather_than_ship_a_partial`) and a REAL, non-mocked
reproduction using identical-cost segments and a budget probed live rather than hand-computed
(`test_a_partial_fit_ships_by_default_and_is_refused_with_all_or_nothing`) -- the second one
fails on the unfixed code and passes after, mutation-proved both directions (removing the
`all_or_nothing=True` wire-up fails only the wiring test; removing the guard inside
`submit_pending` fails only the reproduction test).

⚠️ **A second, separate finding, deliberately NOT acted on tonight:** the REAL actual cost of
tonight's three batches was $9.92 total (`cost_usd_actual`: $3.47 + $3.51 + $2.93 for 105/105/92
segments, ~$0.033/segment) -- roughly a THIRD of the ~$0.0925/segment ESTIMATE that drove the
budget check which starved pass 3. The estimate, not real spend, is what caused the shortfall;
there was in fact plenty of real budget headroom. This is one night's sample and is NOT enough to
retune `WISDOM_DAILY_SEGMENT_LIMIT` by (`lesson_two_points_do_not_establish_a_rate`) -- doing so
risks fitting the limit to output-length noise specific to "Setups & Strategies" content. The
`all_or_nothing` fix already makes an over-tight limit SAFE (fewer full passes, never corrupted
data), so retuning is a throughput optimization for a future session with more nights of real
estimate-vs-actual data, never a correctness requirement.

⛔ **Tonight's 338 records are a permanent loss, not a bug to retroactively fix.** They will sit
at `stability = NULL` / unfloored forever -- reconcile's refusal is correct given segment sets
that genuinely differ, and there is no honest way to manufacture a stability score for passes
that were never asked the identical question three times. The fix prevents this from recurring;
it does not (and should not) resurrect this specific night's data.

## Session 28, part 3 -- an adversarial review found a SECOND cause of the same permanent-loss
class, fixed; and 8 more real, verified findings not yet acted on (2026-09-19)

**Given the budget-trim bug had a real, currently-live sibling**, a 4-dimension workflow review
(budget-spend, N-pass/reconciliation parity, idempotency/retry, vacuous-test coverage) was run
against the whole `api/services/wisdom/extract/` subsystem, using tonight's bug as the calibration
example. Every one of the 9 findings it surfaced was independently adversarially verified by a
skeptic instructed to default to "not real" and read the actual code before agreeing -- **9
confirmed, 0 rejected.** One was fixed immediately because it is the exact same failure class
already in scope tonight; the other 8 are recorded here, verified and reproducible, for a future
session to prioritize -- NOT fixed tonight, because several touch concurrency/design decisions
that deserve deliberate attention rather than a rushed unilateral change.

### FIXED: `touch_segment`'s marker was written and never read (HIGH, npass-parity)

`run_records.touch_segment()` writes an empty marker to `segments_seen.jsonl` specifically so a
pass that legitimately kept ZERO records from a segment (routine LLM-instability -- exactly what
N-pass exists to measure, not a fault) still counts as having COVERED that segment for
`reconcile()`'s parity check. But `reconcile.load_run()` built its `"segments"` set from
`records.jsonl` rows alone and never read `segments_seen.jsonl` -- so the marker had zero effect
on the one comparison it exists for. Any segment yielding `kept=[]` in even one of the N passes
made that pass's segment set differ from the others', and `reconcile()` refused the WHOLE night --
**identical in kind to the budget-trim bug fixed in part 2, from a completely different cause, and
still live even after that fix.** The one existing test for this
(`test_a_pass_that_kept_nothing_still_records_the_segment`) only asserted the marker file's raw
contents, never that `reconcile()` actually treated the segment as covered -- it proved the write,
not the read, and so it could not have caught this.

**Fix:** `reconcile.load_run()` now reads `segments_seen.jsonl` (new shared constant
`SEGMENTS_SEEN_FILE`, replacing the filename literal that `run_records.py` used to hardcode
separately -- one authority, matching this file's own "two builders for one on-disk format" rule)
and unions the touched ids into the returned `"segments"` set. Rows/scoring are unaffected; only
the parity check now sees a touched-but-empty segment as covered. New test in
`test_wisdom_extract_reconcile.py` (`test_a_segment_touched_but_kept_nothing_does_not_break_parity`)
proves `reconcile()` no longer refuses a run whose only gap is a touched-empty segment, while
`test_a_segment_set_mismatch_is_refused_and_says_how_many_differ` (unchanged, still passing) proves
a segment that was genuinely never seen at all -- no touch call either -- still correctly refuses.
Mutation-proved: removing the marker read fails exactly the new test, nothing else.

### 8 verified findings -- all 8 fixed same session

Every one below was independently confirmed by an adversarial verifier reading the real file and
line numbers, not by trusting the finder's prose. Full reasoning for each lives in this session's
workflow transcript (`wf_6497a3d0-139`); summarized here so nothing is lost if that transcript
ages out.

**HIGH severity:**

1. ✅ **FIXED (same session, closed after the other 7).** TOCTOU race in the budget check itself
   (`batch.py::submit_pending` + `budget.py::select_within_budget`). The budget decision used to be
   read under a plain unlocked `store.read()`; the actual commit happened later in `submit_items()`
   under a SEPARATE `store.write()`, which never rechecked the budget against fresh state. Two
   callers submitting at overlapping times -- the scheduled daily chain and the documented manual
   door `tools/wisdom/extract_catalog_batch.py --submit` (which has NO `registry.claim_slot`
   coordination with the cron job at all), or the daily `extract` chain overlapping the weekly
   `audit` chain (different `job_id`s, so `claim_slot` gives zero mutual exclusion, even though both
   share one programme cap via `BUDGET_KINDS=("extract","audit")`) -- could each independently see
   the same pre-commit headroom and both commit, silently exceeding `WISDOM_EXTRACT_BUDGET_USD`.
   Zero concurrency test existed for this path.

   **Fix:** the decision and every admitted item's row reservation now happen inside ONE already-open
   `store.write()` transaction. `_reserve_row()` was extracted from the old inline per-item loop
   (insert-or-update-one-row, unchanged logic, just named and shared); a new `reserve_within_budget()`
   calls `budget.select_within_budget()` and reserves every admitted item's row before returning,
   under a caller-supplied `conn` from `store.write()` -- `store.py`'s `WRITE_LOCK` (a plain
   `threading.Lock`, in-process) plus `BEGIN IMMEDIATE` (cross-process, same file) serialize the
   WHOLE decide-and-reserve step against every other writer, so a second concurrent caller's own
   `store.write()` cannot even begin its budget read until the first caller's reservation has fully
   committed. `submit_pending`'s real-run branch now opens `store.write()` once and calls
   `reserve_within_budget()` inside it; `submit_items()` gained a `preinserted: bool = False`
   parameter -- `True` (set by `submit_pending`) skips its own now-redundant per-item insert loop
   and goes straight to the network call; `False` (every existing test, and any other caller) keeps
   the old single-pass behavior for backward compatibility. **Deliberately does NOT hold the write
   lock across the network call**: `submit_items()`'s existing pattern of releasing the lock before
   `client.messages.batches.create()` (a slow API round trip) is preserved -- the lock is held only
   for as long as N row inserts take, never for the network, so the fix closes the budget race
   without introducing a new availability regression (every other writer blocked for the duration of
   a Batch API call).

   **Why this was harder than #2-#8 and needed a design pass first, not a rushed patch:** closing it
   correctly meant either moving the budget check inside the same write-locked transaction as the
   commit, or adding an explicit reservation step -- and either choice has knock-on effects on every
   caller of `submit_pending`/`submit_items`/`select_within_budget`. Confirmed via `grep` that
   `submit_items` has exactly ONE caller repo-wide (`submit_pending` itself, no test calls it
   directly) before changing its signature, which is what made a minimal-diff refactor safe.

   **Proof:** a new test, `test_two_concurrent_submit_pending_calls_never_together_exceed_the_programme_cap`
   in `test_wisdom_extract_batch.py`, uses REAL `threading.Thread`s (no mocking of
   `select_within_budget` or `reserve_within_budget`'s own logic) released together by a
   `threading.Barrier`. Two disjoint 3-segment sets (different `source_id`, so no shared
   `custom_id` -- this isn't testing the trivial same-row dedup) race against a programme cap sized
   to fit exactly one caller's set (3 items) but not both (6) combined, with a `time.sleep(0.05)`
   injected inside the decide-and-reserve step (via a spy on `reserve_within_budget`, which only
   runs after the caller's `store.write()` has already acquired `WRITE_LOCK`) to widen the window a
   real race would need. Two independent assertions: (a) **the mechanism** -- a concurrency counter
   proves no two callers are EVER inside the decide-and-reserve step at the same wall-clock moment
   (`max_concurrent == 1`); (b) **the outcome** -- the total committed spend across both callers
   never exceeds the cap, and it isn't under-cap by luck: exactly one caller's full 3-item set
   clears and the other is correctly squeezed to zero.

   **Mutation-proved by literally reverting the fix**, not by writing a separate broken variant:
   backed up `batch.py` (`cp`, never `git checkout`), temporarily reintroduced the exact pre-fix
   shape inside `submit_pending` (budget decision under a plain unlocked `store.read()`, a
   `time.sleep(0.05)` gap, then reservation under a SEPARATE `store.write()`), and confirmed the new
   test fails -- `max_concurrent` observed `0` (the spy on `reserve_within_budget` was never even
   reached, since the reverted code doesn't call it), proving the test detects the code-path change
   itself, not just a timing artifact. Independently confirmed via a standalone script (outside
   pytest, so a max_concurrent assertion couldn't mask it) that the reverted code lets both threads'
   budget checks pass concurrently and BOTH fully commit their 3-item sets: **committed $0.48
   against a $0.28 cap** -- the exact overrun shape the fix exists to prevent. Restored the file from
   the backup (verified `grep` finds no trace of the mutation marker), reconfirmed the full
   extraction-subsystem suite (163 tests across `test_wisdom_extract_batch.py`,
   `test_wisdom_npass_chain.py`, `test_wisdom_extract_budget.py`, `test_wisdom_daily_budget.py`,
   `test_wisdom_extract_reconcile.py`, `test_wisdom_same_night_scoring.py`,
   `test_wisdom_gate_runs_root.py`, `test_wisdom_segment_limit.py`, `test_wisdom_extract_audit.py`)
   passes green, and re-ran the new test 5x in a row to rule out timing flakiness (deterministic
   every time -- `WRITE_LOCK` is a real lock, not a race the test has to get lucky to observe).

2. ✅ **FIXED (same session).** The daily-chain golden gate and kill switch did not apply to the
   documented manual submit door (`tools/wisdom/extract_catalog_batch.py::submit()`). Its own
   docstring claimed "the budget and the gate still apply," but it called `batch.submit_pending`
   directly, never `batch.run_daily` -- so `golden.gate_status` and
   `flags.extract_enabled()`/`WISDOM_EXTRACT_ENABLED` were never consulted, only the raw numeric
   cap. An operator setting `WISDOM_EXTRACT_ENABLED=0` believing it was THE kill switch (as
   `budget.py`'s own docstring says) would still have had this door spend real money. **Fix:**
   `submit()` now calls `batch.spend_allowed(ctx)` and `golden.gate_status(conn)` before
   `submit_pending`, refusing with a named reason if either fails. ⛔ THE TRAP: `extract_common.
   job_context()` defaults `force=True` for every tool in this family, and R64 makes
   `spend_allowed()` unconditionally refuse a forced context -- a naive fix (adding the check
   without also passing `force=False` for this ctx) would have made the door permanently unable to
   spend at all, a quieter version of the same defect. `force=False` is correct here specifically
   because this tool IS R64's "dedicated paid action that shows the projected cost" (the default
   dry-run mode prints exactly that estimate) and `--i-understand-this-spends` IS the operator
   echoing it back. Four new tests in `test_wisdom_extract_catalog_submit_gate.py`, including one
   that pins the ctx's `force` value directly so the naive-fix trap can never silently return.
   Mutation-proved: each of the two removed checks fails exactly its own test; the pinned-`force`
   test fails independently if a future edit reintroduces the tool's `force=True` default here.

3. ✅ **FIXED (same session).** `same_night.score_night()`/`reconcile.score_silently()` could
   misattribute reconciliation across a backlog of 2+ pending nights (`reconcile.py` +
   `same_night.py`). `score_silently()` was night-blind by construction -- it always reconciled
   whichever `MIN_RUNS` (3) run directories were alphabetically LAST under the ONE shared
   `gate_runs_root()`, with no `due_key`/night scoping at all. `same_night.score_completed_nights()`
   processes a backlog newest-first, up to `MAX_NIGHTS_PER_TICK` (default 4) nights per tick -- a
   real, designed-for path (triggers whenever scoring falls behind by more than a night, e.g. an
   outage). The newest pending night scored correctly; every OLDER night in the same tick called
   `score_silently()` again, re-discovered the SAME (already-scored, still-newest) 3 run dirs,
   succeeded normally, and `registry.run_tracked` marked that OLDER night's claim `'ok'` anyway (it
   only checks whether the callable raised) -- permanently starving that night's own records at
   `stability=NULL`. **Fix:** `score_silently` now takes an optional `run_ids` parameter; when
   given, it reconciles EXACTLY those run ids instead of guessing from the whole root (default
   `None` preserves the old global-discover behavior for the daily chain's own single-night-at-a
   -time caller). `score_night` looks up its OWN night's specific pass run ids via `ctx.due_key` +
   `same_night.scan()` and passes them explicitly. A real (non-mocked) test builds two genuinely
   distinct, complete nights with DIFFERENT record content and proves each night's own records get
   the right stability from its own passes -- the existing test for this exact backlog path stubs
   `reconcile.score_silently` itself and could never have caught this; the new one drives the real
   function. Mutation-proved on both halves of the fix (the `same_night.py` wiring and the
   `reconcile.py` scoping) independently: each fails exactly the new backlog test, nothing else.

4. ✅ **FIXED (same session).** The free local backend's real token usage was priced as the paid
   model and landed in the real budget ledger (`local_backend.py` + `batch.py` + `budget.py`).
   `LocalClient.cost_usd = 0.0` and `is_local_backend = True` were decorative -- `grep`-confirmed
   as read NOWHERE outside their own test. `submit_pending`/`_build_items`/`handle_result` always
   priced with `config.configured_model()` (the paid model string), with no branch on
   `config.is_local()` anywhere in that chain, so a local ($0) run's real usage numbers were
   converted to a non-zero dollar figure and written into the SAME `wisdom_batches.cost_usd_actual`
   that `select_within_budget` rations real paid extraction against. **Fix:** `budget.cost_from_usage`
   and `budget.estimate_cost` -- the two functions where token counts become dollars, the single
   choke point every caller shares -- now check `config.is_local()` and return `$0.0` unconditionally
   when true, rather than relying on a decorative attribute nothing reads. Two new tests in
   `test_wisdom_local_backend.py` prove a REAL, large usage payload prices as `$0.0` under the
   local backend (not just that the decorative attribute says so) and prices normally (paid
   control) otherwise. Mutation-proved: removing either guard fails exactly the new local-pricing
   test, nothing else.

**MEDIUM severity:**

5. ✅ **FIXED (same session).** A stale-night retry's `exclude_pending_usd` could loosen the
   PER-NIGHT cap (`budget.py::select_within_budget`). The same `exclude_pending_usd` (a retry's
   prior estimate, meant to avoid double-counting) was subtracted from three pending pools that
   aren't all scoped the same way: per-version and programme-wide pending carry no date filter, but
   `night_spent_and_pending` scopes strictly by `created_at`'s date -- and a retried request's
   `created_at` is never refreshed on resubmission. `same_night.py`'s own docstring calls
   cross-night retry carry-forward normal ("a retry rides pass 1 of a later night under its
   ORIGINAL run id"). So a retry from an earlier calendar night had its estimate subtracted from
   TONIGHT's `n_pending` even though it was never counted there in the first place -- could only
   loosen (never tighten) `WISDOM_EXTRACT_DAILY_BUDGET_USD`. **Fix:** a new
   `exclude_night_pending_usd` parameter, computed by `submit_pending` from only the retries whose
   own `created_at` actually falls on `night_date`, defaulting to `0.0` (never to
   `exclude_pending_usd`) when a caller doesn't pass it -- the conservative direction, never
   over-excluding. New test reproduces the exact incident shape (a night-1 retry, $6 of genuinely
   same-night pending from an unrelated source, a $10 night cap) and shows the correct answer (1 of
   2 $3 items admitted) against the old buggy shape (2 of 2) side by side. Mutation-proved.

6. ✅ **FIXED (same session).** `writer.py`'s overlap-dedup key carried no segment/position
   information (`write_output`, the `dedupe_key`). The module docstring says the key exists so "the
   same statement read through two overlapping windows is stored once," but the actual key --
   `(source_id, source_version, extractor_version, record_type, ticker, normalize_quote_key(quote))`
   -- had nothing about segment identity, ordinal, or adjacency, so two genuinely unrelated,
   non-adjacent segments (e.g. one near the start of a stream, one near the end) where the host
   says the same short sentence about the same ticker hours apart hashed to the same key and the
   second, real, distinct utterance was silently dropped with no row and no review item. **Fix:**
   on a dedupe-key match, the prior occurrence's segment ordinal is looked up (via the existing
   `record_id` -> `wisdom_records.segment_id` -> `wisdom_segments.ordinal` chain, no schema change)
   and compared to the current segment's ordinal -- `segmenter.py`'s windows only overlap their
   IMMEDIATE neighbour, so `abs(ordinal difference) <= 1` is the correct adjacency test (the key's
   own scope already guarantees same source/version). Adjacent -> genuine overlap, still collapsed
   as before; non-adjacent -> a genuinely distinct later occurrence, now written. New test with a
   segment at ordinal 5 (far from ordinal 0) proves the second occurrence is written as its own
   record; the existing adjacent-window test (ordinals 0 and 1) is unchanged and still passes,
   proving the fix didn't just stop deduping altogether. Mutation-proved.

7. ✅ **FIXED (same session).** The nightly-cap regression test grepped a comment describing the
   OLD, already-fixed bug, not live behavior
   (`test_wisdom_npass_chain.py::test_the_nightly_cap_never_RAISES_the_programme_total`). It
   asserted `"min(programme_cap" in inspect.getsource(batch.submit_pending)` -- the ONLY place
   that substring appeared was inside the R65 comment narrating the REMOVED bug ("This used to pass
   `min(programme_cap, night_cap)`..."); the current code two lines later explicitly does NOT call
   `min()`. The test would have stayed green through a real revert to the pre-R65 shape and gone
   red on a harmless comment rewording -- the same disease as the calibration bug, in the same
   file, one test away. **Fix:** replaced with a real reproduction of the exact incident R65's
   comment narrates ("$75 of night-1 actuals against a combined cap of 75.0 allowed 0 of 10 on
   night 2, while $45 of programme headroom sat unused") -- night 1 spends its own night cap in
   full, night 2 (a different date, plenty of unused programme headroom) must still get its own
   fresh allowance via `budget.select_within_budget`. Mutation-proved against the real historical
   bug shape (`cap = min(cap, night_cap)` + forcing the night-scoped comparison off): fails only
   this test, confirming it actually catches the incident rather than a proxy for it.

8. ✅ **FIXED (same session, same fix as #5).** Finding 5's defect, independently rediscovered from
   the test-coverage angle -- listed separately in the workflow's raw output (vacuous-tests
   dimension) because it was found via "what combination has zero tests" rather than via tracing
   the retry-carryover scenario directly; the same underlying line (`budget.py:296-304`), closed by
   the same `exclude_night_pending_usd` fix.

### Update, same session: all 8 findings fixed, including #1

Owner instruction, same session: "fix all and achieve the goal," then, once #1 was the only one
left, "keep going and finish as much as possible left open." All eight findings turned out to be
closeable this session -- see the ✅ FIXED markers above for what changed, why, and how each was
mutation-proved (24 new tests total across the eight fixes in this file's three sessions, every one
of them proved to fail on the real historical or reproduced bug shape and pass on the fix).

**#1 (the budget TOCTOU race) needed a design pass before implementation, and got one**, rather than
being rushed: `store.py`'s `WRITE_LOCK`/`BEGIN IMMEDIATE` locking primitives were read in full first,
then `submit_items`'s existing pattern of releasing the write lock before the slow network call was
studied so the fix wouldn't trade a budget race for a new availability regression (every writer
blocked for the duration of a Batch API round trip), then `submit_items`'s one-caller status was
confirmed via `grep` before its signature changed. The result is the `_reserve_row`/
`reserve_within_budget`/`preinserted` refactor documented above: the network call stays outside any
held lock; only the decide-and-reserve step (N row inserts, no I/O) is now atomic. Proved with a real
`threading`-based concurrency test (no mocked internals), mutation-proved by reverting the fix itself
via a backed-up file (never `git checkout`) and confirming the new test catches the exact historical
race shape, and the full 163-test extraction-subsystem suite stays green.

**A full 96-file wisdom-suite sweep (not just the scoped 9-file extraction subset) turned up two
MORE pre-existing regressions**, neither related to the TOCTOU work, both predating it: a gate-ledger
test that never got updated when four gates were legitimately armed earlier this session
(`test_wisdom_skeleton.py`), and a time-bomb test whose fixture dates a badges-endpoint fixture at a
fixed calendar day while the endpoint's own lookback window anchors to real wall-clock time
(`test_wisdom_publish_adapters_routes.py`) -- it silently expired around 2026-09-18 and nothing
caught it until this sweep. Both fixed, mutation-proved; full 96-file suite green (1653 passed, 1
environmental skip, 0 failed).

**✅✅ LANDED AND DEPLOYED, same day, 2026-09-19.** All 10 commits (the 9 adversarial-review fixes
including the TOCTOU race, plus the two regressions above) are on `origin/master` at `f8fd3c5ac`
("Merge branch 'feat/wisdom-loop' into HEAD"; `ed7dad1d3` confirmed an ancestor via
`git merge-base --is-ancestor`). Landed via `tools/land_master_first.py feat/wisdom-loop`, run
directly by the owner (an agent session's own attempt -- including a completely inert `--no-push`
dry run -- was refused outright by Claude Code's permission classifier, reason `[Production
Deploy]`; the owner's own invocation of the identical command was not). Railway `web` deployed that
exact commit (`status: SUCCESS`), confirmed against the artifact, not the status field: `GET
/api/health` returned `uptime_seconds: 41`, a genuinely fresh boot. This landed well ahead of the
next real scheduled daily-chain run (Monday 2026-09-22), closing the window in which production was
armed and running the pre-fix code.

### A second TOCTOU race, found the same day by a fresh review pass, closed the same day

Once the eight findings above were landed, a fresh adversarial review pass was run over territory
the original review deliberately skipped -- the capture/ingestion pipelines (Discord, Twitter,
Sunday Scans) and the publish adapters (badges, brainkb, askai, modelbook, clips, d20, drafts).
Both capture and every adapter but one came back clean at the HIGH/MEDIUM confidence bar this
programme now holds reviews to.

**One real bug, same class as the budget TOCTOU race, in a completely different place:**
`api/services/wisdom/publish/adapters/drafts.py::decide()`'s `modelbook_example` approval path.
The draft was read under a separate `store.read()`, with each status transition committed later in
its OWN `store.write()` -- the identical shape of gap that let the extraction budget race exceed
its cap, here letting two near-simultaneous `decide(draft_id, "approve", ...)` calls (a double-click
on the admin approve button; two admin sessions) both pass the initial check, both see
`published_ref IS NULL`, and both call `modelbook_service.create_setup_example` -- producing TWO
rows in a `require_paid`, member-facing table with only one ever tracked by `published_ref` (the
other silently orphaned, findable only by hand).

**Fix:** the read, every status transition, and the `modelbook_example` path's
`create_setup_example` call now all happen inside ONE already-open `store.write()` transaction,
mirroring `review.py::act()`'s own established "read and decide inside one transaction" pattern --
`WRITE_LOCK` (in-process) + `BEGIN IMMEDIATE` (cross-process) serialize the whole thing against
every other writer. Safe to hold the lock across `create_setup_example` specifically because it's a
single fast local SQLite INSERT into `modelbook.db` (verified directly: no network call, no AI
generation) -- unlike the extraction budget fix, which had to keep its slow Batch API submission
OUTSIDE the lock to avoid trading one bug for an availability regression.

**Proved** with a real `threading.Thread` + `threading.Barrier` concurrency test (only
`create_setup_example` is stubbed, mirroring the existing single-threaded test's own pattern;
`decide()`'s real logic runs). **Mutation-proved** by reverting the fix via a backed-up file (never
`git checkout`), confirming the test fails on the reverted code (`max_concurrent=2` -- both threads
observed inside `create_setup_example` at the same wall-clock moment, reproducing the exact race),
then restoring and reconfirming green. 113 tests pass across the affected files; the full 96-file
wisdom suite reconfirmed green (1654 passed, 1 environmental skip, 0 failed) after the fix.

**✅✅ LANDED AND DEPLOYED, same day.** `origin/master` is `871d1b4c5` ("Merge branch
'feat/wisdom-loop' into HEAD"), with `174dcc9cb` (this fix's tip, plus the SESSION-STATE/
PROGRAM-MANIFEST/CONTRACTS.md doc corrections from earlier the same day) confirmed an ancestor.
Landed the same way as the first batch -- `tools/land_master_first.py feat/wisdom-loop`, run by the
owner after the identical `--no-push` dry-run classifier refusal for an agent session. Railway
`web` deployed it (superseded moments later by yet another session's unrelated master push,
`33e05f733` -- confirmed to still contain this fix via `git merge-base --is-ancestor`, since
Railway only tracks the newest commit and a later push doesn't undo an earlier one already merged
into master's history); confirmed live via `GET /api/health` returning `uptime_seconds: 73`, a
fresh boot after the commit landed.
