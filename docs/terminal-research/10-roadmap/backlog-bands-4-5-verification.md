---
id: H-03-APPENDIX-B45
title: Engineering Backlog — bands 4 and 5 verified against `origin/master` (the check item 30 did not run)
role: >
  The appendix item 30 (`10-roadmap/backlog.md`, owner H-03) asks for in its own GAPS 2.
  Item 30 grepped `origin/master` once per ticket for bands 1–3 (26 packages) and the check
  fired six times; GAPS 2 records that **bands 4 and 5 got no such grep** and names five
  highest-risk ids. This file runs that check on all of band 4 and all of band 5 and reports,
  per ticket, what is true at `origin/master` today.
  ⛔ It does NOT edit `backlog.md`, does not re-order anything, does not re-score anything,
  and does not choose scope. It is a state report against source, for item 30's author to fold in.
wave: 4
group: H
category: roadmap
inputs: >
  `10-roadmap/backlog.md` §2.6 (band 4), §2.7 (band 5), §2.9, §8, §9, GAPS 2 ·
  `05-product-strategy/feature-opportunity-backlog.md` (item 16 — the `Today.` cell per `FB-*` id,
  which is the statement each row below is tested against) ·
  `00-program-control/MASTER_CHECKLIST.md` row 30 ·
  `00-program-control/GOVERNING_PRINCIPLES.md` §13 ·
  **`origin/master` read directly per ticket via `git show` / `git grep`, 2026-09-26, tip
  `2e0598bfa`** — every command in the table below was run and its output read.
scope: uct-dashboard (`api/` + `app/` + `tools/` + `tests/`) at `origin/master`
confidence: >
  🟢 on every presence (a file, a line and a quoted sentence back each one) ·
  🟡 on every absence (an absence is only as good as the command, and the commands are printed) ·
  🔴 on every store row count and every flag value — neither was measured, see NOT INSPECTED
evidence_ceiling: >
  Source was READ, never EXECUTED. No test was run (an unscoped `pytest` is forbidden on this box).
  No database was opened and **no row was counted**, so "it ships" never means "it holds data".
  No Railway command was run and none attempted, so **every flag named below is NAMED and UNREAD**.
  Line numbers are pinned to the `origin/master` read of 2026-09-26 and will drift.
sources: docs/terminal-research/10-roadmap/backlog.md, docs/terminal-research/05-product-strategy/feature-opportunity-backlog.md, docs/terminal-research/00-program-control/MASTER_CHECKLIST.md, origin/master
uct_relevance: high
status: draft
date: 2026-09-26
---

# Bands 4 and 5 against `origin/master` — the appendix to item 30

## 0. Headline — derived, not typed

⛔ **No number in this section is written down.** Each is the output of a command run over
**this file's own register in §3**, and the command is printed beside it. The register is the
only place in this file where a line begins with `| TERM-0`, which is what makes the counts
closed.

```
F=docs/terminal-research/10-roadmap/backlog-bands-4-5-verification.md

# tickets checked
grep -cE '^\| TERM-0' "$F"

# the four states, and the four I16 verdicts, read out of their OWN COLUMN
awk -F'|' '/^\| TERM-0/ { s=$5; gsub(/ /,"",s); print s }' "$F" | sort | uniq -c
awk -F'|' '/^\| TERM-0/ { v=$6; gsub(/ /,"",v); print v }' "$F" | sort | uniq -c

# already ship in some form (either ships state)
awk -F'|' '/^\| TERM-0/ { s=$5; gsub(/ /,"",s); if (s ~ /^SHIPS-/) n++ } END { print n }' "$F"

# no duplicate and no missing id
grep -oE '^\| TERM-0[0-9][0-9]' "$F" | sort -u | wc -l

# closure: each census must sum to the ticket count
```

⛔⛔ **Read the state out of the COLUMN, never with a bare `grep -c` over the row** — and this
is not a stylistic preference, it is §1.4's own substring rule applied to this file. A bare
`grep -E '^\| TERM-0' "$F" | grep -c ABSENT` **overcounts**, because two evidence cells quote the
token in prose (`TERM-066` cites `presentationPrimitives.js`'s exported absent-sentinel constant;
`TERM-085` explains why that verdict would have been the wrong one), and `grep -c INCONCLUSIVE`
overcounts for the same reason (`TERM-083` quotes the restore drill's `2 INCONCLUSIVE` exit code).
⭐ The naive command does not close; the column command does. **That is this instrument catching
its own blind spot, and it is recorded here rather than quietly fixed.**

⭐ **H1. The 23% rate did not hold up — it split into two rates, one lower and one much higher,
and the split is the finding.** Strictly, counting only rows where item 16's own `Today.`
sentence is **false** at master, the hit rate (`I16-FALSE` ÷ checked) comes out *below* item 30's
~23%. Loosely, counting every row where a substantial component of the proposed capability
**already ships** (`SHIPS-ADMIN` + `SHIPS-MEMBER` ÷ checked), it comes out **well above** item
30's headline — far enough that GAPS 2's *"the expected number of further already-ships
corrections is not zero"* understates it substantially. ⛔ Both are derived above; neither is typed here. The reason they diverge is
the whole point of this appendix: **item 16 was usually not wrong, it was one checkpoint behind.**
Most of these capabilities were mid-build when item 16 measured them, and a checkpoint programme
(S1 CP1, S2 CP2, S4 CP1/CP2, S6 CP2′/CP4, S10, S12, D1, D5 CP7, GATE-S9 CP1, PACKET-AB CP1)
landed the next rung between that read and this one.

⚰️⚰️ **H2. Item 30's five named high-risk ids were the wrong five, and the selection heuristic is
worth retiring.** GAPS 2 selects *"the ones whose item-16 'today' reads **absent**"* — `TERM-066`,
`TERM-067`, `TERM-075`, `TERM-079`, `TERM-081`. Of those, **one** is a clean already-ships
(`TERM-066`), two are genuinely absent exactly as recorded (`TERM-067`, `TERM-075`), and two are
partial. Meanwhile the largest hits in this file — **`TERM-058`** (an authoring-time match count
that ships end to end, with the debounce and three rails already written), **`TERM-063`** (a
keyboard registry with five product importers, against *"No registry"*), **`TERM-072`** (six
`_fmp_get` helpers collapsed onto one adapter with a census rail), **`TERM-068`** (`user_tags`
read by a real gate, against *"read by no gate"*) and **`TERM-083`** (a restore *drill*, against
*"no observed restore"*) — were **none of them on the list**. ⭐ **The rule that would have caught
them is the opposite of the one used:** the rows at risk are the ones whose item-16 cell describes
a *partial* mechanism ("two of the four ship", "five consumers", "six helpers", "no registry ...
on an estate that measures 87 raw listeners"), because a partial mechanism is one somebody is
already finishing. An `absent` cell describes something nobody has started, and nobody starting is
a stabler state than somebody halfway.

⛔ **H3. The middle state is where this estate keeps surprising people, and it appeared repeatedly
— derive how often with §0's census.** `SHIPS-ADMIN` below never means "nearly done". It means the capability exists, is
reachable, is usually railed — and **no member can see it**: `app/src/surfaces/manifest.js`
("NOTHING IMPORTS THIS TO RENDER"), `GET /api/bars/{ticker}/adjustment-basis` ("⛔ SHIPS DARK.
Nothing in the frontend calls this yet"), `api/services/rollout.py` (a cohort store with no admin
UI), `app/src/lib/context/focusDivergence.js` ("READ-ONLY. MOUNTS NOTHING") and
`tools/authdb_restore_drill.py` (an ops script). ⭐ Every one of those five is a **smaller** ticket
than its register row says, and every one of them is a ticket whose acceptance criterion is *a
member path*, not a build.

⚠️ **H4. The fourth fact is unmeasured for every single row, and it is not a detail.** Whether a
store that ships actually **holds rows** cannot be answered from here — no database was opened.
`user_tags`, `analyst_rows`, `ai_search_log`, `transcript_index`'s FTS5 index and the auth.db
backup objects in R2 are all reported below as *shipping code*, never as *populated stores*.
⛔ Item 30's own GAPS 4 says the same thing and it binds harder here, because these rows change
shape if the answer is "empty": `TERM-049`, `TERM-058`, `TERM-068`, `TERM-073`, `TERM-083`.

---

## 1. Method, and the three states — stated before the table so a reader can audit the table

### 1.1 Which tickets, and how the set was derived rather than assumed

`backlog.md` §2.1 publishes the id→band mapping in prose: *"`TERM-037…062` band 4, `…063…085`
band 5"*. ⛔ That is a sentence, not a derivation, so the set below was taken from the **register
tables themselves** — §2.6's rows and §2.7's rows — and cross-checked against §2.1's sentence and
against §2.9's own arithmetic — *"49 of the 93 tickets get a register row and no 17-field
package"* — whose three components are band 0, band 4 and band 5, the first excluded below and the
other two re-derived by the commands here. Band 0 is **excluded**: §2.9 and §6.1 both say its deliverable is a
person's sentence, a vendor request or a purchase, so there is no capability to grep for.
The commands:

```
B=docs/terminal-research/10-roadmap/backlog.md
# band 4 register rows
sed -n '/^### 2.6 /,/^### 2.7 /p' "$B" | grep -cE '^\| TERM-0'
# band 5 register rows
sed -n '/^### 2.7 /,/^### 2.8 /p' "$B" | grep -cE '^\| TERM-0'
# and the FB id per row, which is the key into item 16
sed -n '/^### 2.6 /,/^### 2.8 /p' "$B" | grep -oE '`FB-[A-Z0-9-]+`' | sort -u
```

### 1.2 What item 30 §8 already verified, so nothing here is redone

§8's six near-misses are `FB-S3-01` (`TERM-023`), `FB-S8-01` (`TERM-019`), `FB-D2-01`
(`TERM-020`), `FB-OBS-01` (`TERM-012`), item 15 `ACC-13` (`TERM-091`) and item 15 `ACC-08`
(deleted before it was written). ⭐ **Not one of the six is a band-4 or band-5 id**, so there is no
overlap to avoid. §8 also records three checks on the NEW band (`ACC-06`/`ACC-10`/`ACC-13`) and one
negative check on `TERM-086`; those are outside this set and are left alone. ⚠️ Two band-4/5 rows
did get a partial touch in §8's closing note — `TERM-066`'s `fmt*` population (*"a
similar-but-not-identical pattern ... returns 128"*) and `TERM-033`'s `sectionFetch` neighbours.
§8 was careful to say it was **not** correcting item 16's numbers because the patterns differ.
That discipline is kept below: where my pattern differs from item 16's, **I report both and
correct neither.**

### 1.3 ⛔⛔ The three states, and the fourth independent fact

Exactly one state per row. There is no fourth state and no hyphenated pair.

| token | means | what it does NOT mean |
|---|---|---|
| `ABSENT` | the capability is not in the tree, **and the command printed beside it would have found it if it were** | not "nobody wants it"; not "no adjacent thing exists" — several `ABSENT` rows have a shipped idiom to copy, named in the finding |
| `SHIPS-ADMIN` | it ships, is reachable and is usually railed, and **no member surface reads it** — admin-mounted, ops-only, or shipped dark by its own declaration | not "half-built". The code is there; the member path is the ticket |
| `SHIPS-MEMBER` | a member on the single paid tier can reach it today | not "it is finished" — the finding names what is left, and that is the recut |
| `INCONCLUSIVE` | the command **could not** have found a presence (wrong repository, or the answer is not in git) | ⛔ never silently folded into `ABSENT`. *A layer that cannot be read is not a layer that is empty* |

⭐ **And the fourth fact, independent of all four states: does the store hold rows?** For every row
below the answer is **not measured from here** (GAPS 1, restated at H4). A module that exists is
not a module that runs, and a table that exists is not a table with rows in it.

### 1.4 ⛔ Two rules that changed what the table says

1. **An absence is only a finding if the command could have found a presence.** Every `ABSENT` row
   carries its command, and where the needle is unusual it carries a **control** — a same-shaped
   command that returns hits — so "zero" is distinguishable from "broken grep". `TERM-054`'s
   control is `yield f"data: ` (six-plus hits) beside `id: ` (none); `TERM-051`'s is
   `charts_workspace_layout` (four hits) beside `workspace_versions` (none); `TERM-081`'s is
   `ADD COLUMN` (hits in a dozen modules) beside `ADD COLUMN ... toolkit` (none).
2. **Substring traps were hunted, and two were caught.** §8 records the `concurrent.futures` class
   of error. Here: (a) `TERM-061`'s needle `mcp` returns a handful of files at master and **every one is
   the Bullflow MCP probe the admin alert-tester proxies outbound** (`api/alert_tester.py:13`,
   `:698`) — an MCP *client*, not a surface UCT exposes, so the row stays `ABSENT`; (b)
   `TERM-075`'s needle `taxonomy` returns the whole of `api/services/alert_taxonomy/` — which is
   the **S7 trigger** taxonomy, a different subsystem from A8's three ticker-tagging populations,
   and counting it would have manufactured a ships verdict. ⛔ A third near-trap was caught on the
   other side: `app/src/components/screener/CoverageLine.jsx` looks like a duplicate component and
   its own header (`:1`–`:12`) says it is a documented **re-export shim** — so `TERM-047` is NOT
   reported as a second-authority defect.

### 1.5 ⛔ Four boundaries this file does not cross

- **No execution or order management** is proposed anywhere below (`GOVERNING_PRINCIPLES.md` §13).
  Where a row touches positions (`TERM-049`'s journal lane, `TERM-077`'s planned-trades idiom) it
  is read-only and said so.
- **Costs and usage are de-scoped.** ⛔ **Licensing is not**, and three rows carry an **open
  licensing question** because the capability needs a data source the product does not currently
  hold on clean terms: `TERM-045` (EDGAR vs an OpenInsider scrape and an FMP column), `TERM-046`
  (a FINRA floor vs yfinance/Yahoo — and the *provenance changed*, see §6), `TERM-042` (a
  non-yfinance breadth source). ⚠️ `TERM-005`'s screener universe is band 0 and outside this set.
- **One paid tier.** No row proposes a second tier; `TERM-081`'s finding is about *toolkits and
  limits*, which is the axis `entitlements.py` actually has.
- **Two products.** The Whop Discord (~750 paying) is out of boundary and appears in no denominator
  here. UCT Intelligence is the product, and ⭐ master corroborates the population independently:
  `app/src/surfaces/manifest.js:17`–`:18` records the manifest's `order` field as measured from
  production `/data/auth.db`, *"29 users, 13 with traffic"*, with n = 13 over 50 admin session-days
  and an explicit *"Re-read past ~100 members."*

---

## 2. The five ids item 30 named as highest-risk — answered first

⭐ In the order GAPS 2 names them. Full rows, commands and evidence are in §3; this section says
what each one turned out to be, because that is what a sequencer reading GAPS 2 needs.

### 2.1 ⚰️⚰️ `TERM-066` / `FB-S10-02` — "One `format` module" **already ships, with three rails**

Item 16 is emphatic: *"Nothing shared. ⚰️ This is one of the two §R 'absent primitives' that
really is still absent."* At master, `app/src/lib/presentation/presentationPrimitives.js` is that
module: **S10 — PRESENTATION PRIMITIVES**, *"product-architecture.md's S10 block, built for the
first time"*, exporting `formatNumber` `formatPercent` `formatCurrency` `formatPriceDisclosure`
`formatPriceTick` `formatTimeEt` `formatDateTimeEt` `formatFreshnessAsOf` plus `ABSENT`, `LOCALE`
and `MARKET_TIME_ZONE`. ⭐ Its header states the design rule the ticket would have had to invent —
*"AN EXPLICIT LOCALE, ALWAYS — never a bare `toLocaleString()` ... the same screen reads `3,742`
for one member and `3.742` for another, and the second one reads as a decimal"* — which is
`CoverageLine.jsx`'s rule, kept in its own words. Three rails ship with it:
`presentationPrimitives.test.js`, `presentationSingleFormatter.test.js` and `s10Adoption.test.jsx`,
the last of which proves *"S8 renders byte-identical before and after adoption"* with **the
expected strings computed by the frozen pre-S10 code, never typed**. Six product modules already
import it. ⛔ **What is left is the migration, not the module** — and §8's own note already measured
that population larger than item 16's 118 (its pattern returned 128 files defining an `fmt*`).

### 2.2 `TERM-067` / `FB-S10-03` — a form-control layer is **genuinely absent, and now measured**

Item 16 says *"Nothing"*, and adds that the call-site count is *"unmeasured by any artefact this
file read"*. Both hold. There is no shared `Input`/`Select`/`Checkbox`/`Toggle`/`Radio`/`Switch`/
`TextField`/`FormField`/`NumberInput` anywhere under `app/src` — `app/src/components/ui/` contains
`UIcon.jsx` and nothing else — and `app/src/styles/tokens.css` defines a couple of hundred `--*`
custom properties of which **not one is a density token** (the only `density` in the file is prose
at `:556`, *"so tables keep their information density"*). ⭐ **The unmeasured number is now
measured**: §4 prints the population of files holding a raw `<input`/`<select`, and that is the
migration this ticket is actually buying. ⛔ Item 16's *"the two travel together"* note about
density tokens is confirmed: neither half exists, so neither half blocks the other.

### 2.3 `TERM-075` / `FB-A8-01` — absent as recorded, **and a second authority has appeared since**

The three populations are still three: `api/services/catalyst/tagging.py` (the deterministic tag),
`themes_taxonomy.json` + `api/services/theme_engine/*` (the theme taxonomy, ten-plus readers), and
the cashtag path (`api/services/tweet_ticker_extract.py`, `api/services/buzz_extract.py`). No
shared resolver. ⚰️ **But the catalyst vocabulary is now declared twice**, and the second
declaration carries a comment asserting the agreement nobody wired:
`api/services/alert_taxonomy/catalyst_match.py:171`
`TAGS = ("Earnings", "Catalyst", "Gapper", "News")`, headed *"The deterministic tag vocabulary from
`tagging.py`. CLOSED"* — while `tagging.py:17` `assign_tag` returns those four strings **inline, as
literals**. ⛔ That is `lesson_a_comment_claiming_agreement_is_not_agreement` in the tree today, and
it makes this ticket **bigger** than item 16's cell, not smaller: the unification now has to absorb
a fourth copy (and `catalyst_match.py:174` adds a fifteen-label `CATALYST_TYPE_CONVENTION` that its
own comment calls *"A CONVENTION, NOT A CONTRACT ... Nothing in the code enforces them"*).
⚠️ A **primary-vs-mentioned bit** does exist, but in a further population entirely —
`api/services/ai_search_log.py:92` declares `("primary_ticker","TEXT")` with an index at `:130` —
so the bit has a precedent and no shared home.

### 2.4 ⚰️ `TERM-079` / `FB-S4-01` — S4's first two checkpoints ship, and **S4 reclassified itself**

Item 16's `Today.` describes link groups A/B/C/D, `useAppFocus`, the four-group ceiling and the
ad-hoc buses, and all of that is still true. What it does not know is that
`app/src/lib/context/focusDivergence.js` exists: **"S4 CHECKPOINT 1 — the divergence detector.
READ-ONLY. MOUNTS NOTHING"**, with six statuses (`AGREE` `DIVERGE` `FOCUS_ONLY` `HUB_ONLY`
`NEITHER` `NOT_YET_READ`), a pure `compareFocus` and a two-read `useFocusDivergence` hook.
⭐⭐ **And its own headline is the sentence that should change this ticket**, at `:11`: *"WHAT S4
TURNED OUT TO BE — AN ADOPTION GAP, NOT A CAPABILITY GAP ... The bus was built in August and two
files joined it"*, with the population measured at `:17` — *"Measured over 2,702 files, nine
distinct context mechanisms exist and **184 non-test files still hold or pass a symbol by prop or
`useState`**."* ⛔ It also names the trap the ticket would walk into: the detector *"is only safe
because it holds nothing. The moment it caches, defaults, or normalises differently from
`useAppFocus`, it IS the tenth mechanism"*, and it refuses to upper-case because that *"would
MANUFACTURE agreement between two authorities that disagree on case"*. ⚠️ **A contradiction rides
with this row and §6 carries it**: the sibling file
`app/src/lib/context/symbolLinkChannels.test.js:5` says *"CP2 is unsigned; this file is built to
signature-ready and **is not merged**"* — and it is present at `origin/master`.

### 2.5 `TERM-081` / `FB-S9-04` — the column really is absent, **and the row is owner-blocked in source**

`api/services/entitlements.py:270` reads `raw = user.get("toolkit")`, and the `toolkit` column
exists in no DDL anywhere in the repository — verified against a control that finds `ADD COLUMN` in
a dozen modules. So the ticket's core is intact. ⛔ Two of its supporting premises are not.
(a) Ledger P5's *"`premium`/`lifetime` strings orphaned"* is **false at master**:
`api/middleware/auth_middleware.py:86` `PAID_PLANS = {"pro", "premium", "lifetime"}` is a single,
load-bearing definition read at `api/main.py:228`. (b) ⭐ **GATE-S9 CP1 ships**:
`api/data/entitlements_manifest.json` (`schema_version` 1, seven top-level keys, generated by
`tools/build_entitlements_manifest.py`, guarded by
`tests/test_entitlements_manifest.py::test_no_product_path_reads_the_manifest`) enumerates the
entitlement axis **from source, nothing typed** — and its own `what_this_is` field says *"CP2+ (the
first reader) is **NOT PROPOSABLE** until OI-03(a)/OI-03(b)/OI-12 are answered by the owner."*
⛔⛔ **So `TERM-081` is owner-blocked at master and no register row records that.** Its `STATE` in
§2.7 reads `BUILDABLE`; source says the next checkpoint may not even be proposed. §6 carries the
contradiction rather than resolving it.

---

## 3. The register — one row per ticket, with the command and the evidence

⛔ **`STATE` is the state of the capability the ticket proposes to build**, not of the nearest
adjacent thing. `I16` grades item 16's own `Today.` sentence against master: `I16-FALSE` (the
sentence is wrong), `I16-PARTIAL` (right but a checkpoint behind), `I16-HOLDS` (right as written),
`I16-UNTESTABLE` (not answerable from this repository). Every command was run at `origin/master`,
tip `2e0598bfa`, 2026-09-26.

### 3.1 Band 4 — `TERM-037` … `TERM-062`

| TERM | FB | band | STATE | I16 | command run at `origin/master` | evidence `file:line`, and what it says |
|---|---|---|---|---|---|---|
| TERM-037 | `FB-S1-03` | B4 | SHIPS-ADMIN | I16-PARTIAL | `git ls-tree -r --name-only origin/master app/src/ \| grep -iE "registry\.(js\|jsx)$\|surfaceRegistry"` then `git ls-tree -r --name-only origin/master app/src/surfaces/` | `app/src/surfaces/manifest.js:1` *"S1 CP1 — THE SURFACE MANIFEST, AS INERT DATA"*, `:6` *"⛔⛔ NOTHING IMPORTS THIS TO RENDER ... `manifest.test.js` is the only consumer"*, `:11` *"DERIVED, NEVER TYPED"* by an AST walk over `App.jsx`'s route table, `SURFACE_KINDS` plus one row per route, each with an `order` the header says is *measured* and `null` wherever telemetry is silent. The panel side is separate: `app/src/widgets/registry.js`, `app/src/hub/registry.js`. ⭐ The surface set this ticket wants to derive FROM already exists, derived and railed |
| TERM-038 | `FB-S2-03` | B4 | ABSENT | I16-HOLDS | `git grep -nE "defId@version\|addressFor\|toAddress\|parseAddress" origin/master -- app/src/ api/` | No general address space. Two seeds, as item 16 says: `app/src/lib/chartDeepLink.js:23` `CHART_LINK_PARAMS = { sym: 'sym', tf: 'tf' }` (the authority — a param is *"a ONE-SHOT INSTRUCTION ... then STRIPS — never a second source of truth"*), `app/src/pages/charts/ChartsWorkspace.jsx:1888`–`:1907` the `?openLayout=`/`?openShared=` doors, `api/services/user_definitions.py:45` the `defId@version` pin. ⭐ A drift baseline already exists: `app/src/lib/context/symbolLinkChannels.test.js:22` — *"Five sites read a symbol or timeframe straight out of a query string without going through the authority, and TWO OF THEM SPELL THE SAME FACT A THIRD WAY — `?ticker=`"* |
| TERM-039 | `FB-S12-02` | B4 | ABSENT | I16-HOLDS | `git show origin/master:app/src/utils/comingSoon.js` and `git grep -n "ComingSoon" origin/master -- app/src/` | `app/src/utils/comingSoon.js:21` `export const COMING_SOON = import.meta.env.VITE_COMING_SOON === '1'` — a **whole-product pre-launch holding page** with a `<PreLaunchGate>` route set, not per-feature status at the point of use. ⚠️ Flags `VITE_COMING_SOON` / `COMING_SOON_MODE`: NAMED, UNREAD |
| TERM-040 | `FB-A10-04` | B4 | ABSENT | I16-HOLDS | `git grep -niE "shard_?0\|shard_?1\|warm.*shard\|shard.*warm" origin/master -- api/` (zero) with control `git ls-tree -r --name-only origin/master api/ \| grep -iE "prewarm\|warm"` (a dozen-odd warmer modules, all read) | No warmer names the two cold-pack shard keys. ⭐ But the idiom ships and is measured: `api/services/panel_prewarm.py:1`–`:13` *"Warm the Company Panel's caches ahead of the member ... AMKR cold 4.46s -> warm 0.12s ... 35-60x"*, and crucially *"It warms through the SAME functions the endpoints call, never a private build"* — the exact discipline this ticket needs. ⛔ `api/services/serve_stale.py` is the other half, measured at five adopters by `TERM-082` |
| TERM-041 | `FB-A11-02` | B4 | SHIPS-MEMBER | I16-PARTIAL | `git grep -nE "REGIME_LABELS\|REGIME_VOCAB\|REGIMES = " origin/master -- api/ app/src/` | A closed five-label vocabulary exists **twice**: `api/services/alert_taxonomy/regime_change.py:251` `REGIME_LABELS = ("bull_trend","bull_correction","distribution","chop","bear_trend")` and `api/services/voice_regime_classifier.py:24` `REGIMES = ` the same five. Served to paid members by `api/routers/regime.py` (`/api/regime`, `require_paid`, mounted `api/main.py:8785`) as `{regime, label, confidence, reasons[], signals{}}`. ⛔ Not *published* as one vocabulary across surfaces, which is item 16's actual claim — so the enum half is paid for and the publication half is the ticket |
| TERM-042 | `FB-A11-04` | B4 | ABSENT | I16-HOLDS | `git grep -niE "yfinance\|yf_" origin/master -- api/services/breadth_live.py api/services/breadth_history_recon.py` and `git ls-tree -r --name-only origin/master \| grep -i breadth_collector` (not in this repo) | `api/services/breadth_live.py:29` *"The collector downloads with yfinance `auto_adjust=True`"*, `:1060` *"The 4:15 collector reads yfinance `auto_adjust=True`; `bars.db` is"* split-only, and `api/services/breadth_history_recon.py:872` records the same divergence *"moves this number by"*. ⛔ The collector itself is PC-side and absent from git, so this absence is a statement about the **consumer** side; the re-sourcing is unstarted. ⚠️ Open licensing question: the replacement source |
| TERM-043 | `FB-A3-02` | B4 | ABSENT | I16-HOLDS | `git grep -niE "source_page\|sourcePage\|page_number\|filing_page" origin/master -- api/ app/src/` then `git ls-tree -r --name-only origin/master app/src/components/research/sections/ \| grep -i statement` | No figure-level source link on statements: `app/src/components/research/sections/StatementPanels.jsx` + `statementSeries.js` render the lines with no anchor. ⭐ The idiom to copy is one subsystem over and already member-facing — the Notebook OCR path returns a page-addressed passage: `api/routers/journal_two.py:3771` `GET /notes/documents/{document_id}/pages/{page_number}/text`, `:3822` `"sourceUrl": r["source_url"]`, `api/services/journal_two/ask_evidence.py:185` `passage_label(row, page_number)` |
| TERM-044 | `FB-A6-02` | B4 | ABSENT | I16-HOLDS | `git grep -niE "span_start\|span_end\|char_offset\|anchor_span\|transcript_span" origin/master -- api/` — the only hits are `dividend_join.py`'s date span, read and discarded as a trap | No span anchor. The substrate is exactly where item 16 says: `api/services/transcript_index.py` + `api/services/transcript_indexer.py` (FTS5, scheduled `api/main.py:2772`–`:2791`), word-timed transcripts via `api/services/earningscall_timed.py` (read at `api/routers/earnings_intel.py:394`), recaps in `api/services/call_recap.py` / `call_recap_grounded.py` / `call_recap_store.py`. ⚠️ Flag `TRANSCRIPT_INDEX_ENABLED` at `api/main.py:2764` gates the whole index job: **NAMED, UNREAD** — and if it has never been on, the substrate is empty, which is the fourth fact biting this row |
| TERM-045 | `FB-A7-01` | B4 | SHIPS-MEMBER | I16-PARTIAL | `git grep -niwE "form4\|form_4\|13f" origin/master -- api/ tools/` and `git grep -niw "openinsider" origin/master -- api/` | Form 4 and 13F **already serve members**: `api/routers/insider.py:7` (three routes, Form 4, paid since the 2026-08-09 sweep), `api/routers/filings.py:38` *"The raw feed is dominated by Form 4 / 144 insider"*, `api/services/insider_clusters.py:1` *"OpenInsider cluster scraping"* with `:24` `_BASE = "http://openinsider.com/latest-cluster-buys"`, `api/services/institutional_holdings.py:4` *"top holders from 13F filings) — much simpler than parsing SEC 13F XML"*, `api/services/fmp_client.py:420` and `:430` typed 13F functions *"added for the Ownership tab's D1"*. EDGAR-direct parsing is absent and explicitly deferred: `api/services/fundamentals_pit/catalog.py:218` *"DEFERRED: 13F history by filing date is a separate ingestion."* ⚠️ **Open licensing question** — the shipped path is a scrape plus a vendor column, which is the argument this ticket exists to make |
| TERM-046 | `FB-A7-02` | B4 | SHIPS-MEMBER | I16-FALSE | `git grep -niw "finra" origin/master -- api/ tools/` | ⚰️ Ledger D8's *"Finviz single-sources short interest"* is **not what master does**. `api/services/short_interest.py:3` *"Free source: yfinance pulls FINRA-reported short interest from Yahoo"*, `:5` *"Updates bi-monthly per FINRA cadence"*, `:97` `"source": "yfinance / FINRA"`, reaching members through `api/services/voice_tool_impls.py:618` *"Short interest + days-to-cover + % of float (FINRA via yfinance)"*, registered at `api/services/voice_agents.py:398`. ⭐ `api/services/wisdom/capture/families/street.py:10` already reasons about *"FINRA's own `as_of` so an unchanged twice-monthly value is not mistaken for a"* fresh one. ⚠️ **The licensing question moves rather than closes**: the exposure is Yahoo/yfinance terms, not Finviz's missing terms document |
| TERM-047 | `FB-A9-02` | B4 | SHIPS-MEMBER | I16-FALSE | `git grep -ln "CoverageLine" origin/master -- app/src/` then read every hit | Item 16 says *"One surface"*; master has more than one product consumer, both named below. `app/src/components/provenance/CoverageLine.jsx` is the component; `app/src/components/screener/CoverageLine.jsx:1`–`:12` is a **documented re-export shim** (*"RE-EXPORT SHIM (S8 Step 1) ... so the component's real importers (`ScanResults.jsx`, `EvidenceTab.jsx`) never need same-day rewiring"*) — ⛔ **not** a second authority, and it names its own removal condition. So the adopters are `app/src/components/screener/ScanResults.jsx` (the `/screener` surface) and `app/src/components/chart/builder/EvidenceTab.jsx` (the builder), with the primitive also re-exported through `app/src/lib/presentation/presentationPrimitives.js` |
| TERM-048 | `FB-A12-01` | B4 | ABSENT | I16-HOLDS | `git grep -nw "deliver_alert_payload" origin/master -- api/` and `git grep -nE "def .*(price\|line\|trendline)" origin/master -- api/services/watchlist_alert_service.py` | The migration has not happened: `api/services/watchlist_alert_service.py:53` `create_alert(user_id, sym, target_price, direction, ...)`, `:202` `check_alerts_against_prices`, `:553` `run_alert_check` are still their own predicate family, beside `api/services/alert_taxonomy/`'s registry. ⭐ **But the delivery seam is already proven shared, with three non-watchlist consumers**: `api/services/ai_search_briefings.py:281`, `api/services/ai_search_deep.py:528`, `api/services/alert_rev_migration.py:254` — and `api/services/alert_fired_log.py:14` rails *"`deliver_alert_payload` reaches a member exactly once per recorded fire"*. So the risky half of item 16's `M` is retired |
| TERM-049 | `FB-A13-01` | B4 | ABSENT | I16-PARTIAL | `git ls-tree -r --name-only origin/master api/ \| grep -iE "ticker_history\|history_join\|per_ticker"` (zero) then `git grep -rn "ticker_mentions" origin/master -- api/routers/` | No join. ⭐ **But item 16's own ◻ is resolved**: it records L8 ticker mentions as *"a per-ticker 'what the Desk said' substrate, ⚠️ whose door is NOT DETERMINED"*. The door is `api/routers/education.py:300` `get_ticker_mentions(sym, _user: dict = Depends(require_paid))` → `:307` `ticker_mentions.mentions_for_symbol(sym)` — **a paid member route**. So one of A13's lanes has a member-facing per-ticker read, and `XL` is still right for the join |
| TERM-050 | `FB-I1-01` | B4 | SHIPS-MEMBER | I16-HOLDS | `git ls-tree -r --name-only origin/master app/src/ \| grep -iE "i1S8\|provenance"` | Confirms item 16 on both halves. The four S8 primitives ship with tests and four contract modules under `app/src/components/provenance/` (item 30 §8 row 2, not re-litigated), and **the rail item 16 says already exists does exist**: `app/src/pages/research/i1S8Boundary.test.js`, beside its subject `app/src/pages/research/tabs/AskAiTab.jsx`. ⛔ The ticket is the migration of the five grounding doors exactly as written, and item 16's instruction *"Extend that rail's roots; do not write this section again"* stands |
| TERM-051 | `FB-S5-02` | B4 | ABSENT | I16-HOLDS | `git grep -niwE "workspace_versions\|layout_versions\|version_history" origin/master -- api/` (zero) with control `git grep -nw "charts_workspace_layout" origin/master -- api/` (four hits) | No version history. The store exists and is one opaque preference — `api/routers/auth.py:2128` `"charts_workspace_layout": _PREF_OPAQUE`, read path documented at `api/services/indicator_alert_service.py:1387` *"`charts_workspace_layout -> widgets[].opts.settings`"*. ⛔ Confirms §2.9's *"impossible rather than deferred"* verdict: there is no retained prior state to restore from, so nothing here can begin before `TERM-021` |
| TERM-052 | `FB-S6-01` | B4 | ABSENT | I16-HOLDS | `git grep -rln "capability matrix" origin/master -- app/src/ api/` (zero in product code; `docs/` only) and `git grep -nE "\-\-(uct-)?density" origin/master -- app/src/` (zero) | None of the three publications exists as a product artefact. ⭐ **But the expensive half of item 16's caveat — *"M if each must be derived, and it must"* — now has a shipped precedent and a rail to copy**: `api/services/member_interest.py:1` *"S6 CP2' — the member-interest resolver"*, whose `SOURCE_BUCKETS` is *"the SINGLE authority for the numbers `importance.js`'s `impEff` used to hardcode as an independent if-chain (CP3 derives from it instead of mirroring it)"*; served to paid members at `api/routers/member.py:73` `GET /api/member/interest`, mounted `api/main.py:8714`–`:8715`; railed by `tests/test_a12_s6_consistency_rail.py`, which exists because *"two independent readers of the same rows with no comparison is the precondition for that class of bug"* |
| TERM-053 | `FB-S9-02` | B4 | SHIPS-MEMBER | I16-PARTIAL | `git grep -n "api/movers\|api/live-prices" origin/master -- api/ \| grep -E "@app\.\|@router\."` then read each route's dependency line | OI-17's closures verified in source: `api/routers/live_prices.py:556` `@router.get("/api/live-prices")` with `:559` `user: dict = Depends(get_current_user)`; `api/routers/movers.py:8`/`:9` the same. ⭐ **And the population moved again after item 16's read**: `api/routers/provenance_quote.py:9` *"⚰️ It was NO-AUTH until 2026-09-25, citing `/api/live-prices` ... existing no-auth convention"*, `:11` *"That convention ended with OI-17 (`caebdab16`, 2026-09-23)"*, with `/provenance-demo` moved inside `<AuthGuard/>` in the same commit *"so the pair is gated together, never one without the other"*. A sixth family closed and the remaining set is smaller than item 16's cell |
| TERM-054 | `FB-D3-01` | B4 | ABSENT | I16-HOLDS | `git grep -nE "\"id: \|'id: " origin/master -- api/` (zero) with control `git grep -nE "yield f?\"data: " origin/master -- api/` (hits in abundance) | No `id:` field on any stream. The control proves the shape is findable: `api/routers/ai_search.py:197` `yield f"data: {json.dumps({'type': 'meta', ...})}` and five more in that module, plus `api/routers/community.py:1384` `yield "event: connected\ndata: {}"` — SSE framing is hand-written in this codebase, so an `id:` line would have matched. ⛔ Confirms `S` to emit / `M` to honour |
| TERM-055 | `FB-D5-01` | B4 | SHIPS-ADMIN | I16-HOLDS | `git grep -n "adjustment-basis" origin/master -- api/routers/bars.py` then read the docstring | ⭐ Item 16 is exactly right, and the endpoint says so itself. `api/routers/bars.py:526` `@router.get("/api/bars/{ticker}/adjustment-basis")` gated `Depends(require_bars_access)`, `:532` *"D5 CHECKPOINT 7 — the adjustment-basis label"*, `:534` *"⛔ SHIPS DARK. Nothing in the frontend calls this yet — the member-facing sentence ('split-adjusted, 2026-09-02' / 'as reported') is an explicit, named deferral to S8/S10 ... not an oversight"*, over `api/services/adjustment_basis.py` where *"an 'undetermined' answer is preferred over a confident-sounding guess"*. ⛔ The `S` for the label is now purely a render |
| TERM-056 | `FB-S2-04` | B4 | ABSENT | I16-HOLDS | `git grep -niE "commandString\|parseCommand\|renderCommand\|interchange format" origin/master -- app/src/ api/` (zero) | Nothing. The nearest shipped thing is `app/src/lib/chartDeepLink.js`, and it is deliberately the opposite mechanism — its ruling is *"an instruction is not a channel"*, quoted at `app/src/lib/context/symbolLinkChannels.test.js:11`. ⛔ Confirms `S` after `TERM-038`, `L` before it |
| TERM-057 | `FB-A8-03` | B4 | SHIPS-MEMBER | I16-PARTIAL | `git grep -n "@router" origin/master -- api/routers/catalysts.py` then read the handler signature | ⭐ Item 16 hedged this cell 🟡 — *"Partly inferred ... the exact shipped affordance was not verified by this document"* — and the hedge was warranted: it ships. `api/routers/catalysts.py:184` `@router.get("/catalysts/explain/{sym}")`, `:185` `def catalysts_explain(sym: str = Path(...), user=Depends(get_current_user))`, beside `:152` `/catalysts/history/{sym}`, `:287` `/catalysts/feedback` and `:324` `/catalysts/my-feedback`. ⛔ So the ticket is a receipt **shape** plus adoption, not a route |
| TERM-058 | `FB-A9-01` | B4 | SHIPS-MEMBER | I16-FALSE | `git grep -rn "screener/count" origin/master` | ⚰️⚰️ Item 16 says *"Nothing at authoring time."* **False, end to end, with the debounce and the rails already written.** Backend: `api/routers/screener.py:222` `@router.post("/api/screener/count")` with `:223` `Depends(require_paid)` and *"How many rows this spec would return — benchmark metric 450"*, over `api/services/screener/query.py:1271` `def preview_count(spec, user_id=None)`. Frontend: `app/src/pages/screener/hooks/useScreenerCount.js:3` *"PACKET-AB CP1 (fingerprint bc19457cf) -- debounced POST /api/screener/count"*, `:26` the fetch, consumed at `app/src/pages/screener/shell/FilterRail.jsx:192` *"by the cheap /api/screener/count endpoint, decoupled from and never"* the scan. Rails: `useScreenerCount.test.jsx`, `Screener.door.test.jsx:207`, and the auth pin `tests/test_scan_screener_auth.py:164`. ⛔ Item 16's anti-pattern warning (*"the count must not become a second evaluator"*) is already honoured by the route's comment on the `list` filter and the user-id source |
| TERM-059 | `FB-A11-03` | B4 | SHIPS-MEMBER | I16-PARTIAL | `git grep -ln "FreshnessBadge" origin/master -- app/src/ \| grep -v "provenance/"` | A value-level freshness label ships and is adopted outside its own directory: `app/src/lib/presentation/presentationPrimitives.js:313` `formatFreshnessAsOf({tier, asOf, seconds})`, consumed by `app/src/components/provenance/FreshnessBadge.jsx:33`, and the badge appears on `app/src/pages/research/tabs/AnalystRatingsTab.jsx` and `app/src/pages/ProvenanceDemo.jsx`, with the clock side in `app/src/hooks/useMarketOpen.js` and `app/src/lib/marketClock/marketClock.js`. ⛔ The named stale/proxied **columns** are still unlabelled, so the ticket is adoption plus a threshold — smaller than `S` was |
| TERM-060 | `FB-I1-02` | B4 | ABSENT | I16-HOLDS | `git grep -niE "citation_pointer\|claim_id\|citationPointer" origin/master -- api/ app/src/` — the only hits are `wyckoff_spring.py`'s `reclaim_idx`, read and discarded as a trap | No machine-checkable pointer. ⭐ The consumer-side honesty primitive does ship: `app/src/components/provenance/Cited.jsx:69` *"never a fabricated citation for a value with no addressed row"*, `:74` renders `citation unavailable`, `:99` `aria-label="Show citation detail"`. ⛔ So the component that would *render* a pointer exists and refuses to invent one — the right precondition, not the wire format. Confirms `L`, and confirms item 16's *"the data-modelling half is `FB-D2-01`"*, i.e. behind `TERM-020`'s CP3 |
| TERM-061 | `FB-X2-01` | B4 | ABSENT | I16-HOLDS | `git grep -rn "skill.md\|skills catalogue\|endpoint whitelist" origin/master -- api/ app/src/ tools/` (zero) and `git grep -rliE "\bmcp\b" origin/master -- api/ app/src/ tools/` (a handful of files, **all read**) | ⚠️ **Substring trap caught and reported rather than counted.** Every `mcp` hit is an **outbound** client: `api/alert_tester.py:13` *"Proxy to Bullflow MCP, returns 10 saved alerts"*, `:698` *"Lazy import the MCP probe"*, `:721` *"Could not fetch live configs from MCP"*, `:733` *"Unwrap the MCP response shape"* — an admin alert-tester talking to somebody else's MCP server. **UCT exposes no MCP surface and no skill file.** The substrate is where item 16 says: the tool registry in `api/services/voice_agents.py`, and the ICS token as the only egress credential (`TERM-084`) |
| TERM-062 | `FB-S7-02` | B4 | ABSENT | I16-HOLDS | `git grep -niE "cooldown" origin/master -- api/routers/` then `git grep -niE "cooldown" origin/master -- app/src/ \| grep -v "\.test\."` | Cooldowns exist and are published nowhere. Module constants and env vars: `api/routers/admin_twitter.py:22` `_AUTO_REFRESH_COOLDOWN_SEC = 30 * 60`, `api/routers/bars.py:184` `_SCHEMA_REPAIR_COOLDOWN_S = 60.0`, `api/routers/broker_sync.py:203` `float(os.getenv("BROKER_SYNC_COOLDOWN_SEC", "180"))`, `api/routers/breadth_monitor.py:575` a *"cooldown-gated"* self-heal. On the member side the only mention is a **code comment**, not a publication: `app/src/pages/journal-2-0/hooks/useBrokerSync.js:6`. ⛔ No fire-frequency query anywhere. Confirms `M` |

### 3.2 Band 5 — `TERM-063` … `TERM-085`

| TERM | FB | band | STATE | I16 | command run at `origin/master` | evidence `file:line`, and what it says |
|---|---|---|---|---|---|---|
| TERM-063 | `FB-S2-01` | B5 | SHIPS-MEMBER | I16-FALSE | `git ls-tree -r --name-only origin/master app/src/ \| grep -iE "chord\|keybind\|keyboard\|hotkey\|shortcut"` then `git grep -n "from.*command/chords" origin/master -- app/src/` | ⚰️⚰️ Item 16 says *"No registry. The palette shipped without one."* **False.** `app/src/pages/command/chords.js:1` *"S2 — THE COMMAND-CHORD TABLE, as a module a surface can actually read"*, `:7` *"CP1 declared this table and railed it for collisions, but it lived as a `const` INSIDE `chordCollision.test.js` — so nothing shippable could read it ... CP2 moves it here"*, exporting `CHORDS` `:22`, `chordById` `:33`, `matchesChord` `:47` (whose `forbids` half exists because *"`Ctrl+Shift+F` came to flag a ticker on three surfaces while being correctly ignored on two"*). **Product importers, all of them**: `app/src/components/TickerPopup.jsx:21`, `app/src/components/chart/pane/ChartPane.jsx:35`, `app/src/pages/ThemeTrackerPage.jsx:32`, `app/src/pages/Watchlists.jsx:94`, `app/src/pages/charts/grid/GridChartCell.jsx:33`. Rails: `chordCollision.test.js:59`, `chords.identity.test.js:19`, `ChartPane.chordAdoption.test.jsx:61`. ⚠️ **And there are three registries, not one**: `chords.js::CHORDS`, `app/src/components/chart/keyboardShortcuts.js:29` `INDICATOR_CHORDS` (frozen, derived into the help sheet at `:156` and the Ctrl map at `:213`, railed by `keyboardBindingCollisions.test.js:55`), and `app/src/pages/journal-2-0/JournalLayout.jsx:76` `HOTKEY_ROUTES` + `:82` `PAID_HOTKEY_CHORDS`. §4 prints the raw-`keydown` migration population |
| TERM-064 | `FB-S2-02` | B5 | ABSENT | I16-PARTIAL | `git grep -nE "def (_)?(extract\|parse\|resolve)_(tickers?\|symbols?)" origin/master -- api/ services/ tools/` and `git ls-tree -r --name-only origin/master \| grep -iE "tickerResolv\|symbolResolv"` (no such module) | No single resolver, and the population is **larger than item 16's four** — these, in full: `api/routers/ai_search.py:732` `_extract_tickers`, `api/services/news_aggregator.py:218` `_extract_tickers`, `api/services/catalyst/sources.py:394` `_extract_tickers_from_text`, `api/services/tweet_ticker_extract.py:13` `extract_tickers`, `api/services/wisdom/publish/adapters/badges.py:35` `parse_tickers`, `api/services/massive.py:216` `_resolve_symbol`, `api/services/journal_two/broker/snaptrade_adapter.py:66` `extract_symbol`, `api/build_cancel_patches.py:40` `parse_ticker`, plus `tools/theme_curation/discover.py:15` and `tools/audit_bars_bulk.py:109`. ⛔ **I do not correct item 16's four** — its unit was call-site families, mine is function definitions. ⭐ The consequential fact: the resolver the estate already has is the entity master (item 30 §8 row 1), so this belongs behind `TERM-023` rather than beside it |
| TERM-065 | `FB-S10-01` | B5 | ABSENT | I16-HOLDS | `git ls-tree -r --name-only origin/master app/src/ \| grep -iE "DataGrid\|VirtualTable\|GridTable"` (zero) with control `git ls-tree -r --name-only origin/master app/src/components/ \| grep -cE "\.jsx$"` (hundreds, so a shared component is findable) | No shared grid module. The grids are separate components: `app/src/pages/screener/columnDefs.js` (the 157-column seed), `app/src/components/mobile/ResponsiveTable.jsx`, `app/src/pages/breadth/CompareGrid.jsx`, `app/src/pages/calendar/CalendarDayTable.jsx`, `app/src/pages/journal-2-0/components/PositionsTable.jsx`, `TradesTable.jsx`, `StatsGrid.jsx`, `accounts/ComparisonGrid.jsx`, `app/src/components/tiles/CatalystTable.jsx`, `app/src/components/research-kit/charts/HeatGrid.jsx`, `app/src/pages/charts/grid/MultiChartGrid.jsx`. ⛔ *"before a sixth grid exists"* understates the count |
| TERM-066 | `FB-S10-02` | B5 | SHIPS-MEMBER | I16-FALSE | `git ls-tree -r --name-only origin/master app/src/ \| grep -i format` then `git grep -nE "^export" origin/master -- app/src/lib/presentation/presentationPrimitives.js` and `git grep -n "presentationPrimitives" origin/master -- app/src/ \| grep -v "\.test\."` | ⚰️⚰️ See §2.1. `app/src/lib/presentation/presentationPrimitives.js:1` *"S10 — PRESENTATION PRIMITIVES ... built for the first time"*, `:11` *"⭐ THIS RATIFIES A FORM THE CODEBASE ALREADY HAD"* with three of five lifted verbatim, `:25` *"AN EXPLICIT LOCALE, ALWAYS"*; exports at `:47` `ABSENT`, `:51` `LOCALE`, `:55` `MARKET_TIME_ZONE`, `:69` `formatNumber`, `:95` `formatPercent`, `:119` `formatCurrency`, `:166` `formatPriceDisclosure`, `:189` `formatPriceTick`, `:229` `formatTimeEt`, `:282` `formatDateTimeEt`, `:313` `formatFreshnessAsOf`. Product importers: `app/src/components/chart/drawingLabels.js:26`, `provenance/Cited.jsx:25`, `provenance/CoverageLine.jsx:58`, `provenance/FreshnessBadge.jsx:33`, `provenance/Provenance.jsx:24`, `provenance/presentationFormat.js:53`. Rail `app/src/lib/presentation/s10Adoption.test.jsx:5` — *"snapshot tests prove S8 renders byte-identical before and after adoption"* — with `:16` *"⛔ THE EXPECTED STRINGS ARE COMPUTED BY THE FROZEN PRE-S10 CODE, NEVER TYPED"*. ⛔ Per-domain formatters remain and are what migrates: `research-kit/charts/format.js`, `lib/journal-2-0/format.js`, `pages/cot/cotFormat.js`, `utils/feedFormat.js`, `utils/profileFormat.js`, `chart/engine/fundamentalFormat.js` |
| TERM-067 | `FB-S10-03` | B5 | ABSENT | I16-HOLDS | `git ls-tree -r --name-only origin/master app/src/ \| grep -icE "/(Input\|Select\|Checkbox\|Toggle\|Radio\|Switch\|TextField\|FormField\|NumberInput)\.(jsx\|js)$"` (zero) · `git grep -nE "\-\-(uct-)?density" origin/master -- app/src/` (zero) · `git grep -lE "<(input\|select)[ >]" origin/master -- app/src/ \| wc -l` | See §2.2. `app/src/components/ui/` holds only `UIcon.jsx`; zero shared form primitives by name; `app/src/styles/tokens.css` defines a couple of hundred `--*` properties and no density token (the word appears once, as prose, at `:556`). ⭐ **The migration population item 16 calls unmeasured is measured in §4** |
| TERM-068 | `FB-S12-01` | B5 | SHIPS-ADMIN | I16-FALSE | `git grep -nwE "user_tags\|cohorts?" origin/master -- api/` then `git grep -nE "^def \|^[A-Z_]+ =" origin/master -- api/services/rollout.py` | ⚰️ Item 16 says *"`user_tags` is written and read by no gate"*. **False.** `api/services/rollout.py:1` *"S12 — ROLLOUT COHORTS. The first migration, and nothing else"*, owner-approved 2026-09-12, with `:75` `ROLLOUT_PREFIX = "rollout:"`, `:79` `S7_DARK`, `:87` `tag_for`, `:100` `cohort_user_ids`, `:127` `includes`, `:145` `cohorts_for`, `:166` `seed_cohort_from_role`, `:219` `assign_cohort`, `:258` `seed_cohort_all_members`, `:291` `remove_from_cohort`, `:344` `ensure_s7_dark_seeded`; seeded at `api/main.py:3430`–`:3454`, where *"dark projections now read `user_tags` instead of `users.role = 'admin'`"* and *"an untagged cohort means NO MEMBERS -- never a fallback to admins"*. ⛔ **The module states the other two halves are NOT in it**: `:63` *"Not a percentage"*, `:66` *"Not an entitlement"*, `:68` *"**Not a kill switch.** The env flags stay, and the ORDERING is load-bearing: the kill switch is evaluated FIRST, so `FLAG=false` beats any membership"*. Maintenance mode is still the only runtime switch (`api/main.py:190` `_MAINTENANCE_MODE = False`, flipped at `api/routers/auth.py:1452`), and no admin flag UI was found. ⛔ Cohort store DONE; master flag and runtime kill switch NOT |
| TERM-069 | `FB-A10-02` | B5 | ABSENT | I16-HOLDS | `git grep -nE "yfinance\|black_scholes\|bs_iv" origin/master -- api/services/options_chain.py` and `git grep -n "snapshot/options" origin/master -- api/` | Duplication confirmed exactly as ledger F10 records it. Legacy leg: `api/services/options_chain.py:3` *"Free starting point — yfinance for chain/IV/OI/volume, Black-Scholes for"* greeks, `:14` `import yfinance as yf`, `:42` `_black_scholes_greeks`, `:104` its call; plus `api/bs_iv.py`. Native leg: `api/massive_oi_snapshots.py:22` *"Endpoint: https://api.massive.com/v3/snapshot/options/{ticker}"*, `:211`, `:283`, `:473`. Stale name confirmed: `api/services/polygon_options.py`. ⛔ Nothing retired |
| TERM-070 | `FB-A10-03` | B5 | SHIPS-MEMBER | I16-PARTIAL | `git grep -n "market-narrative" origin/master -- api/` then read the handler | ⭐ **The diagnosis item 16 defers is answerable from source, without a probe.** `api/schwab_router.py:258` `@router.get("/market-narrative")`, `:259` `Depends(require_flow_user)`, docstring *"Generate AI narrative of today's market using Claude + web search. Cached 30 min keyed by date — cuts cost ~15x"*, with `import anthropic` **inside the handler** and a cache check before it; corroborated by `api/services/narrative_cost_guard.py:3` *"`GET /api/schwab/market-narrative` made a Claude call — with"*. ⛔ So 20.8 s cold is a synchronous model call with web search on the request path and 7.5 s warm is the 30-minute cache. ⚠️ **Still through the partner boundary** — `schwab_router.py` is partner-owned, so this is an ack-first change |
| TERM-071 | `FB-A11-01` | B5 | ABSENT | I16-PARTIAL | `git ls-tree -r --name-only origin/master \| grep -iE "regime"` and `git grep -lnw "market_regimes" origin/master -- api/` | No single authority, and the modules are these — **more than item 16's three**: `api/routers/regime.py` + `api/services/voice_regime_classifier.py` (the paid `/api/regime`, mounted `api/main.py:8785`), `api/services/alert_taxonomy/regime_change.py` (+ `_compare`, `_projection`), `api/services/awareness/regime_snapshots.py` (scheduled `api/main.py:3583`), `api/services/journal_two/regime.py` (+ `regime_backfill.py`, `app/src/pages/journal-2-0/hooks/useJ2CurrentRegime.js`), the engine's `market_regimes` (read at `api/routers/intelligence.py`), and `app/src/pages/breadth/views/RegimeClockView.jsx`. ⛔ I do not correct item 16's three; its unit was ledger rows, mine is modules. The consequence stands: naming one authority now has more losers to derive |
| TERM-072 | `FB-A3-01` | B5 | SHIPS-MEMBER | I16-FALSE | `git grep -nw "def _fmp_get" origin/master` then `git show origin/master:tools/fmp_guard_census.py \| grep -n '^\s*"api/'` | ⚰️⚰️ Item 16 says *"six independent `_fmp_get` helpers (TD-29)"*. **One survives, and it is quarantined by name.** `api/services/fmp_client.py:1` *"Provider Abstraction Layer (D1) — the FMP adapter ... the ONE module in this codebase that constructs an `financialmodelingprep.com` URL for the endpoints this build's approved scope covers (the 6 originally-named call sites)"*, shaped on `finnhub_client.py` with *"ONE deliberate divergence"* — it raises typed `provider_errors` instead of returning `None`, *"the 'never raises' anti-pattern this system exists to retire"* — and it imports `api/services/provider_licensing_class.py`, which **is** the per-response licensing stamp item 16 sizes into the `M`. Rail: `tools/fmp_guard_census.py:66` `QUARANTINE` + `tests/test_fmp_guard_census.py:17` `test_real_repo_has_zero_unquarantined_violations`, with `test_quarantine_is_the_exact_pinned_set` mutation-checking the exemption list and `test_retired_quarantine_entries_are_genuinely_clean` proving two entries were retired because they measured clean, not suppressed. The surviving def is `api/services/earnings_estimates.py:345`, quarantined as *"kept byte-for-byte, load-bearing for 9 external consumers"*. ⛔ Remaining debt is the quarantine list, of which one entry is **not** debt: `api/services/news/adapters/fmp_news.py`, exempt by the G5 ruling 2026-09-12 as *"contract mismatch, not migration debt"* |
| TERM-073 | `FB-A4-01` | B5 | ABSENT | I16-HOLDS | `git grep -nE "DELETE FROM analyst_rows\|INSERT OR REPLACE INTO analyst_rows\|as_of\|snapshot_date" origin/master -- api/services/screener/analyst_pass.py` | `api/services/screener/analyst_pass.py:159` `"INSERT OR REPLACE INTO analyst_rows "` — **replace, not append**, and no `as_of`/`snapshot_date` in that write; `:6` *"``/data/screener_analyst.db``), table ``analyst_rows`` (one row per"* symbol. Scheduled at `api/main.py:1974` `id="screener_analyst_pass"` with a receipt logged at `:1966`. ⛔ Confirms item 16 and confirms §2.9's monotonic cost of delay: *"a retention series cannot be backfilled, so every night not retained is permanently lost"* — and it is still being lost nightly |
| TERM-074 | `FB-A5-04` | B5 | ABSENT | I16-HOLDS | `git grep -niE "'wire'" origin/master -- app/src/pages/Calendar.jsx` then read the ladder | Precisely as item 16 says. The view exists — `app/src/pages/Calendar.jsx:817` `{view === 'wire' && <WireView />}` — and the migration ladder at `:149`–`:158` maps v2 preferences to `table`, `board` or `month` only: *"v2 prefs migrate once: feed+rows→table, else board; month stays month"*, with `:172` `setView = v => setPref('calendar_view_v3', v)`. **No path lands anyone on Wire.** ⛔ Confirms `S` — a ladder rule plus its missing test |
| TERM-075 | `FB-A8-01` | B5 | ABSENT | I16-HOLDS | `git grep -nE "Earnings.*Catalyst.*Gapper\|TAG_PRECEDENCE" origin/master -- api/` · `git grep -ln "themes_taxonomy" origin/master -- api/ app/src/ tools/` · `git grep -nw "primary_ticker" origin/master -- api/` | See §2.3. Three populations still three, no shared resolver, **plus a second declaration of the catalyst vocabulary**: `api/services/alert_taxonomy/catalyst_match.py:171` `TAGS = ("Earnings","Catalyst","Gapper","News")` against `api/services/catalyst/tagging.py:17` `assign_tag` returning those four inline. ⚠️ `catalyst_match.py:174` also records a *"CONVENTION, NOT A CONTRACT"* fifteen-label `CATALYST_TYPE_CONVENTION` that *"Nothing in the code enforces"* — a third vocabulary in one file. The primary bit exists only at `api/services/ai_search_log.py:92`/`:130`. ⛔ The trap: `alert_taxonomy/` is S7's trigger taxonomy, not A8's third population |
| TERM-076 | `FB-A12-02` | B5 | ABSENT | I16-HOLDS | `git grep -niE "device-local\|device local" origin/master -- app/src/ api/` (zero) and `git grep -nw "watchlist_perf_cols" origin/master` | No publication of the rule anywhere in product code. ⭐ CARD 3's half is confirmed closed: `api/routers/auth.py:2171` `"watchlist_perf_cols": _PREF_OPAQUE`, `app/src/pages/Watchlists.jsx:111` `WATCHLIST_PERF_COLS_KEY = 'watchlist_perf_cols'`, railed by `app/src/pages/Watchlists.perfcols.test.jsx` and described at `tests/test_a12_s6_consistency_rail.py:241` as *"hydrated once after prefs load"*. ⛔ The drawings half is untouched, and the *"per-surface capability matrix as a product artefact"* exists only as research documents under `docs/`. Confirms `S` to publish / `M` to move |
| TERM-077 | `FB-A12-03` | B5 | ABSENT | I16-HOLDS | `git grep -niE "copy_from_source\|link_to_source\|import_mode\|source_mode" origin/master -- api/ app/src/` then check `watchlist_service.py` | No copy-vs-link choice on a watchlist; `api/services/watchlist_service.py` has no such concept. ⭐ **But the exact flag shape ships one subsystem over**, which turns this into a copy rather than a design: `api/services/journal_two/db.py:1908` `source_mode  TEXT`, `api/routers/hub_planned_trades.py:33` `source_mode: Optional[str] = Field(None, max_length=40)`, `api/services/hub_planned_trades.py:95`/`:99` the insert, railed at `app/src/hub/PlanTradeSheet.test.jsx:134`. ⛔ Read-only precedent only — no order management is proposed |
| TERM-078 | `FB-I1-04` | B5 | SHIPS-MEMBER | I16-PARTIAL | `git grep -n "_quota_snapshot" origin/master -- api/routers/ai_search.py` then `git grep -nE "\.quota\b" origin/master -- app/src/` | ⚰️ **One lane's member-visible meter ships end to end.** `api/routers/ai_search.py:530` `_quota_snapshot(user_id)` — *"Member-visible daily budget: used / limit, so the widget can show a quiet meter instead of a surprise 429 at the end of the day"* — returned on the response paths at `:2684`, `:2760`, `:2784`, `:2802`, `:2954`, `:2971`, `:2979` and `:3184`, with a refund path at `:518` *"never bill for a non-answer"*. The frontend reads it: `app/src/pages/charts/widgets/AiSearchWidget.jsx:688` `if (d.quota && Number.isFinite(d.quota.used)) setQuota(d.quota)`. ⛔ The other lanes, the **population cap** and the one price table are absent; `api/services/narrative_cost_guard.py` and the catalyst/compass guards remain separate. ⚠️ Flag `COMPASS_COST_CAP_DAILY`: NAMED, UNREAD |
| TERM-079 | `FB-S4-01` | B5 | SHIPS-ADMIN | I16-PARTIAL | `git ls-tree -r --name-only origin/master app/src/lib/context/` then read both files | See §2.4. `app/src/lib/context/focusDivergence.js:1` *"S4 CHECKPOINT 1 — the divergence detector. READ-ONLY. MOUNTS NOTHING"*, `:11` *"AN ADOPTION GAP, NOT A CAPABILITY GAP"*, `:17` *"nine distinct context mechanisms exist and 184 non-test files still hold or pass a symbol by prop or `useState`"*, six statuses with `NOT_YET_READ` held apart from `NEITHER` because *"a layer that cannot be READ is not a layer that is EMPTY"*, then `compareFocus` and `useFocusDivergence`. Rails `focusDivergence.test.jsx` and `symbolLinkChannels.test.js`. ⛔ No typed channel beyond symbol; the four-group ceiling and the TF/date/filter gap are unchanged |
| TERM-080 | `FB-S9-03` | B5 | ABSENT | I16-PARTIAL | `git grep -c "@limiter.limit" origin/master -- api/` (per-file counts, summed in §4) and `git ls-tree -r --name-only origin/master api/ \| grep -iE "rate_limit\|ratelimit\|throttl"` | No default-plus-override policy. `slowapi` decorators are hand-applied across eight modules (`api/routers/auth.py`, `voice.py`, `capture_auth.py`, `earnings.py`, `note_sync.py`, `transcripts.py`, `waitlist.py`, `api/services/transcripts.py`); the only rate-limit module is `api/services/journal_two/broker/rate_limit.py`, which is SnapTrade-specific. ⛔ **I do not correct item 16's 38** — it counted routes, I counted decorator occurrences, and §4 prints mine beside the command. ⭐ The `429`-with-reset-headers discipline this ticket wants now has an internal precedent: `fmp_client.py`'s non-blocking token bucket plus `provider_errors`' typed rate-limited class |
| TERM-081 | `FB-S9-04` | B5 | ABSENT | I16-FALSE | `git grep -nE "ADD COLUMN[^;]*toolkit" origin/master` (zero) with control `git grep -n "ADD COLUMN" origin/master -- api/` (hits in a dozen modules) · `git grep -nw "lifetime" origin/master -- api/` | See §2.5. `api/services/entitlements.py:270` `raw = user.get("toolkit")` reads a column no DDL defines; `:229` records *"Today exactly one toolkit ships"* and `:243` `toolkit="all"`. ⚠️ Item 16's *"`premium`/`lifetime` strings orphaned"* is **false**: `api/middleware/auth_middleware.py:86` `PAID_PLANS = {"pro", "premium", "lifetime"}`, read at `api/main.py:228`. ⭐ GATE-S9 CP1 ships as `api/data/entitlements_manifest.json` (seven top-level keys; its `who_may.paid_plans.note` records that *"GATE-S9's own 2026-09-13 finding called this 'copied twice' -- measured 2026-09-19, it is not"*, the real defect being **three JS re-implementations**, one fixed the same day to read `data.paid_equiv`), built by `tools/build_entitlements_manifest.py` and fenced by `tests/test_entitlements_manifest.py`. ⛔⛔ Its `what_this_is` says CP2 *"is NOT PROPOSABLE until OI-03(a)/OI-03(b)/OI-12 are answered by the owner"* — so the register's `BUILDABLE` and source disagree |
| TERM-082 | `FB-D4-01` | B5 | ABSENT | I16-HOLDS | `git grep -lnw "serve_stale" origin/master -- api/` then read each hit to separate importers from prose references | ⭐ Item 16's *"5 sites"* is **exact**. `api/services/serve_stale.py` defines `ServeStale`; the importers are `api/routers/calendar.py:27`, `api/routers/signature.py:49`, `api/routers/wire.py:19`, `api/services/implied_move.py:14`, `api/services/setup_grade.py:25` — and `api/routers/signature.py:12`/`:32` are prose references to the module, **not** a sixth adopter, which is the over-count this row was checked for. The companion modules all exist: `cache_policy.py`, `cache_snapshot.py`, `source_circuit_breaker.py`. ⛔ Confirms `M`, and confirms `TERM-040` has a shipped mechanism waiting |
| TERM-083 | `FB-X1-02` | B5 | SHIPS-ADMIN | I16-FALSE | `git ls-tree -r --name-only origin/master tools/ scripts/ \| grep -iE "backup\|restore"` | ⚰️ Item 16 says *"no observed restore"*. **The rehearsal it calls *"the part that is the actual deliverable"* ships**, for the store that matters most. `tools/authdb_restore_drill.py:1` *"Restore drill for the auth.db backups in R2: prove the newest one can be restored"*, `:7` *"A backup nobody has restored is a hope, not a backup"* — it downloads into a temp dir, gunzips, opens **read-only**, runs `PRAGMA integrity_check` (*"the full check, not quick_check"*), asserts `REQUIRED_TABLES` and `MAX_AGE_HOURS`, exits `0 PASS / 1 FAIL / 2 INCONCLUSIVE` with *"An unknown is never a pass"*, ⛔ *"never writes under the shared data root ... and refuses a work directory there"*, and derives its key layout from the backup job itself *"so this drill cannot drift from what is actually being written"*. Beside it: `tools/archive_authdb_backup.py`, `scripts/rth-restore.ps1`. ⛔ **Whether the drill has ever been RUN is unmeasured from here**, and the other ~50 stores are still unbacked |
| TERM-084 | `FB-X2-02` | B5 | ABSENT | I16-HOLDS | `git grep -nE "ics_token\|ICS_TOKEN\|ics_secret" origin/master -- api/` | ⛔ **No TTL, and the code says so in its own words.** `api/routers/calendar.py:3642` *"subscribe URLs continue to work forever. decode_ics_token() reverses it by"*; `:3650` `_ics_secret()`, `:3658` `_make_ics_token(user_id)` = `:3660` an HMAC-SHA256 over the user id with **no expiry claim**, `:3664` `_decode_ics_token`, `:3673` a decode cache, minted at `:3872`, read at `:3903`, and `:3899` *"scope=mine requires a token parameter"*. ⭐ The in-repo idiom to copy is `api/chart_edge_token.py:185`–`:186`, which **does** carry `iat`/`exp`; and `api/routers/note_sync.py:102` cites the same `_ics_secret` precedent, so a second consumer of the no-TTL pattern already exists. Confirms `S`, and makes the `scope=all` bound concrete |
| TERM-085 | `FB-X3-01` | B5 | INCONCLUSIVE | I16-UNTESTABLE | `git ls-tree -r --name-only origin/master \| grep -iE "substack\|wire.*template\|morning_wire"` | ⛔ **Not answerable from this repository, so not recorded as absent.** This repo holds only the publishing side — `api/services/substack_article.py`, `substack_bodies.py`, `substack_internal_links.py`, `substack_poller.py`, with a fixture at `tests/fixtures/substack_sunday_scans_2026-08-16.html.gz`. The wire's monologue template is engine-side in another repo, which item 16 states in its own `Size.` cell (*"the wire is engine-side and PC-dependent, so the change lands in a different repo's template"*). ⚠️ My command **could not** have found a presence, so `ABSENT` would have been a manufactured finding |

---

## 4. Counting discipline — every number this file relies on, with its command

⛔ **No count above or below is typed beside the artefact that owns it.** Counts carried from other
documents are attributed and left alone even where my own pattern disagrees, per item 30 §8's own
discipline. Run at `origin/master`, tip `2e0598bfa`.

```
# ── the ticket set (over backlog.md, READ-ONLY) ────────────────────────────
B=docs/terminal-research/10-roadmap/backlog.md
sed -n '/^### 2.6 /,/^### 2.7 /p' "$B" | grep -cE '^\| TERM-0'      # band 4 rows
sed -n '/^### 2.7 /,/^### 2.8 /p' "$B" | grep -cE '^\| TERM-0'      # band 5 rows

# ── the four states and the four I16 verdicts (over THIS file, §3) ────────
# ⛔ BY COLUMN, not by row: a bare grep -c overcounts. See §0.
F=docs/terminal-research/10-roadmap/backlog-bands-4-5-verification.md
grep -cE '^\| TERM-0' "$F"
awk -F'|' '/^\| TERM-0/ { s=$5; gsub(/ /,"",s); print s }' "$F" | sort | uniq -c
awk -F'|' '/^\| TERM-0/ { v=$6; gsub(/ /,"",v); print v }' "$F" | sort | uniq -c
# and the naive version, kept so the overcount is reproducible rather than asserted
for s in ABSENT SHIPS-ADMIN SHIPS-MEMBER INCONCLUSIVE; do
  printf '%s ' "$s"; grep -E '^\| TERM-0' "$F" | grep -c "$s"; done

# ── TERM-067: the form-control migration population item 16 calls unmeasured
git grep -lE '<(input|select)[ >]' origin/master -- app/src/ | wc -l
git grep -cE '^\s*--[a-z-]+:' origin/master -- app/src/styles/tokens.css   # tokens defined
git grep -nE '\-\-(uct-)?density' origin/master -- app/src/                # density tokens

# ── TERM-063: the keyboard migration population, and the adopters ─────────
git grep -lE "addEventListener\('keydown'" origin/master -- app/src/ | wc -l
git grep -n "from.*command/chords" origin/master -- app/src/ | grep -v '\.test\.' | wc -l

# ── TERM-064: ticker extractor/resolver DEFINITIONS (my unit, not item 16's)
git grep -cE "def (_)?(extract|parse|resolve)_(tickers?|symbols?)" origin/master -- api/ tools/

# ── TERM-080: slowapi decorator OCCURRENCES (my unit; item 16 counted routes)
git grep -h -c "@limiter.limit" origin/master -- api/ \
  | python -c "import sys; print(sum(int(l.split(':')[-1]) for l in sys.stdin if l.strip()))"

# ── TERM-082: serve_stale importers, prose references excluded BY READING ──
git grep -lnw "serve_stale" origin/master -- api/ | wc -l

# ── TERM-072: the quarantine that IS the remaining migration ──────────────
git show origin/master:tools/fmp_guard_census.py | grep -cE '^\s*"api/'
# ⛔ SCOPED to api/: unscoped, this also counts a docs mention and a fixture the
#    census's own positive-control test writes, neither of which is a live helper.
git grep -nw "def _fmp_get" origin/master -- api/ | wc -l

# ── TERM-071 / TERM-075: the populations, by module ───────────────────────
git ls-tree -r --name-only origin/master api/ app/src/ | grep -ci regime
git grep -ln "themes_taxonomy" origin/master -- api/ app/src/ tools/ | wc -l

# ── the manifest that changes TERM-081, sized rather than described ───────
git show origin/master:api/data/entitlements_manifest.json | wc -c
git show origin/master:api/data/entitlements_manifest.json \
  | python -c "import json,sys; print(len(json.load(sys.stdin)))"
```

⚠️ **Three places where my pattern is not the owning artefact's pattern, stated so nobody
subtracts one from the other.** `TERM-064` (function definitions vs item 16's call-site families),
`TERM-071` (modules vs ledger rows), `TERM-080` (decorator occurrences vs routes). ⛔ In all three
the **direction** is the finding — the population is larger than the cell — and in none of them is
item 16's number corrected here.

---

## 5. ⭐ The tickets whose recut is now obvious

⛔ Sizes below are **item 16's own bands**, re-cut only where a command above changed the shape, and
the recut is stated rather than implied. No value or priority claim is made; item 17 owns order and
this appendix does not reopen it. Following item 30 §8's pattern, most of these become **smaller and
differently shaped**, not gone.

- **`TERM-058`** — ⚰️⚰️ *the one that disappears.* `M` → **`XS`, or delete it.** The route, the
  debounce, the hook, the consumer and three rails all ship. What is left is a question, not a
  build: does the Builder sheet / Concierge authoring surface get the hook the `/screener`
  `FilterRail` already has? If yes, `XS`. If the answer is "it already does", the ticket goes the
  way item 30's `ACC-08` went — deleted before it is written.
- **`TERM-063`** — `M` → **`S` for the unification, `L` for the migration, and they are two
  tickets.** Three chord tables ship, each with its own collision rail. The `S` is deriving one
  from the others — and ⛔ `INDICATOR_CHORDS` is already the derived source for the help sheet and
  the Ctrl map, so it is the model, not a victim. The `L` is the raw-`keydown` population in §4,
  which is a bigger number than best-of-breed's 87.
- **`TERM-066`** — `M` → **`XS` for the module (it exists), `M` for the migration.** ⭐ And the
  migration's acceptance criterion is already written and shipping for S8:
  `s10Adoption.test.jsx`'s *"byte-identical before and after"* with **expectations computed from
  the frozen pre-migration code**. Every subsequent domain migrates the same way, which turns item
  16's *"each one is a chance to change a rendered number"* from a risk into a procedure.
- **`TERM-072`** — `M` → **`S` per quarantine entry, and the census says which.** The adapter, the
  token bucket, the typed errors, the licensing stamp and the rail all ship. The ticket is now
  *"retire N named quarantine entries"*, each independently sized, minus the one entry that is a
  deliberate architectural exemption rather than debt. ⛔ Do not retire `fmp_news.py` — the G5
  ruling's reason is a contract difference, and retiring it changes the contract.
- **`TERM-068`** — `M` → **three tickets, one of which is done.** Cohort store: shipped. Master
  flag: absent. Runtime kill switch: absent, ⛔ **and constrained** — `rollout.py:68` fixes the
  ordering (*"the kill switch is evaluated FIRST, so `FLAG=false` beats any membership"*), so the
  kill switch is an env-flag evaluation order and never a table mutation. That matches
  `feedback_kill_switch_never_a_delete`, and it is a design input the register row does not carry.
  ⚠️ A fourth piece appears from source and belongs in the ticket: there is still **no admin UI** to
  assign a cohort, so today a cohort is assigned by a pod-side write.
- **`TERM-083`** — `M` → **`S` to generalise, and the deliverable already exists.** The drill's
  shape is the hard part and it is written, including the three things a naive version gets wrong:
  `integrity_check` not `quick_check`, an explicit `INCONCLUSIVE` exit that is never a pass, and a
  refusal to work under the shared data root. The ticket is a store list plus a schedule. ⛔ It is
  **not** evidence that a restore has ever been run — that is the fourth fact, unmeasured.
- **`TERM-037`** — `L` → **`M`.** The surface set is already derived data with a rail. What remains
  is the panel registry becoming its by-product, plus the migration of the existing widget types.
  ⭐ And the manifest hands the ticket its hardest design decision pre-made: `order` is measured,
  `null` where telemetry is silent, and *"Silence is not last place."*
- **`TERM-057`** — `M` → **`S`.** The explain route ships authenticated. The ticket is the receipt
  *shape* (`CoverageLine`'s four counts) plus adoption on the curating surfaces.
- **`TERM-047`** — `M` → **`S` plus one shim removal.** The extraction is done and there are two
  adopters, not one. ⛔ The shim names its own removal condition; retiring it belongs **in the same
  commit** as the second repoint, because a documented workaround left in place is how it becomes
  permanent.
- **`TERM-070`** — *"`S?` diagnose / unknown to fix"* → **diagnosed; `M` to fix, through the partner
  boundary.** The cause is an in-handler `anthropic` call with web search plus a 30-minute cache.
  The fix shape is the one this estate already uses everywhere else: generate on a schedule, serve
  the artefact, label its freshness.
- **`TERM-078`** — `M` → **`S` per remaining lane plus `M` for the population cap.** One lane's
  meter is shipped end to end and is the template. ⛔ The population cap is the half with no
  precedent, and it is where the `M` lives.
- **`TERM-041`** — `S` → **`S`, but the work changed.** The enum exists twice; the ticket is *derive
  one from the other and prove it by moving the source*, then publish. That is a second-authority
  fix, not an authoring task.
- **`TERM-059`** — `S` → **`XS` for the primitive (shipped and adopted), `S` for the named columns.**
- **`TERM-046`** and **`TERM-045`** — sizes unchanged, ⚠️ **but both are now licensing tickets rather
  than ingestion tickets**, and `TERM-046`'s premise changed provider. Neither can be written
  against item 16's `Today.` cell as it stands.
- **`TERM-081`** — `S` → **`S`, held.** The column is genuinely absent, and source says the next
  checkpoint may not be proposed until three owner questions are answered. ⛔ The honest state is
  `HELD` on a named owner input — a band-0 shape sitting in band 5.
- **`TERM-064`** — `M` → **`M`, re-parented.** It should key against the entity master (`TERM-023`),
  which ships admin-mounted, rather than inventing a resolver beside it. ⛔ A new resolver would make
  the entity master the tenth mechanism, which is exactly what `focusDivergence.js` warns about in
  its own domain.
- **`TERM-075`** — `M` → **`M`, and larger than the cell.** A further copy of the catalyst vocabulary
  has appeared since item 16 measured, with a comment asserting the agreement nobody wired. The
  unification has to absorb it, and the migration still must not move the owner's theme baseline.
- **`TERM-040`** and **`TERM-082`** — unchanged in size, ⭐ but the pairing is now proven in source:
  `serve_stale` at five adopters plus `panel_prewarm.py`'s *"warms through the SAME functions the
  endpoints call, never a private build"* are the two halves of `TERM-040`'s acceptance criterion.
- **`TERM-043`** and **`TERM-077`** — unchanged in size, and each now has a **named in-repo idiom to
  copy** rather than a design to invent (the Notebook OCR page-addressed passage; planned trades'
  `source_mode`).
- **`TERM-053`** — unchanged in size, ⚠️ but the population must be **re-measured, not carried**: it
  has moved twice since item 16's read and once since item 30's.

---

## 6. ⚠️ Contradictions found, recorded and not resolved

⛔ Each is between source and an artefact, or between two statements inside source. This file has no
authority to settle any of them, and picking a winner would be inventing one.

1. ⚰️ **`app/src/lib/context/symbolLinkChannels.test.js:5` says it "is not merged" — and it is at
   `origin/master`.** Verbatim: *"CP2 is unsigned; this file is built to signature-ready and is not
   merged."* Either the header is stale or a checkpoint landed without its approval line being
   updated. ⛔ Consequential, because the same file carries an owner-facing scope claim
   (*"APPROVED SCOPE: **NONE YET**"*) and a five-site drift baseline a reviewer would read as
   ratified. Owner of the fix: whoever owns the S4 packet.
2. ⚰️⚰️ **`api/data/entitlements_manifest.json` says `TERM-081`'s next step is not proposable;
   `backlog.md` §2.7 says `BUILDABLE`.** The manifest's `what_this_is`: *"CP2+ (the first reader) is
   NOT PROPOSABLE until OI-03(a)/OI-03(b)/OI-12 are answered by the owner."* ⛔ Not a contradiction
   about whether the column is missing — it is — but about whether the ticket may be scheduled. A
   register saying `BUILDABLE` over a source file saying held is the expensive direction of that
   error.
3. ⚠️ **Ledger D8's `"Finviz single-sources short interest"` vs `api/services/short_interest.py`.**
   Master reads FINRA-reported figures **through yfinance/Yahoo** (`:3`, `:97`). ⛔ The licensing
   exposure the capability matrix records against Finviz (*"no terms document exists at all…the
   single largest documentary gap in the audit"*) may still be live for other columns, but it is not
   what the short-interest lane does. Owner of the fix: item 15 / item 16.
4. ⚠️ **Ledger P5's `"premium`/`lifetime` strings orphaned"` vs `api/middleware/auth_middleware.py:86`.**
   They are a single load-bearing definition. ⭐ And `entitlements_manifest.json` records the same
   class of correction being made *inside* source: GATE-S9's own 2026-09-13 finding that
   `PAID_PLANS` was *"copied twice"* was **re-measured on 2026-09-19 and withdrawn**, the real
   defect turning out to be three JS re-implementations, one fixed the same day. ⛔ A ledger cell is
   a dated measurement whose error has no reliable sign — item 30 §8's own rule, confirmed again.
5. ⚠️ **Item 16's `FB-A9-01` `"Nothing at authoring time"` vs `POST /api/screener/count`.** The route
   is dated in source — `tests/test_scan_screener_auth.py:103` records *"+1 2026-08-24"* — which is
   **before** item 16's read. ⛔ So this is not a race between artefact and build; it is a cell that
   could have been checked and was not, and it is the single clearest argument for the rule item 30
   already drew.
6. ⚠️ **Item 16's `FB-S2-01` `"No registry"` vs `app/src/pages/command/chords.js`, whose own header
   says CP1 had declared the table inside a test file.** ⛔ Both statements can be true of different
   dates, and the module says so. What cannot be true is the ticket as written — *"the keyboard
   registry, before any more palette"* — since the registry now precedes the palette.
7. ⚠️ **`api/services/alert_taxonomy/catalyst_match.py:171` claims agreement with
   `api/services/catalyst/tagging.py` and nothing wires it.** A comment saying *"The deterministic
   tag vocabulary from `tagging.py`"* over a typed tuple is a record that somebody noticed the
   dependency and did not express it. ⛔ Recorded, not fixed: fixing it is `TERM-075`.
8. ⚠️ **Item 30 §2.9 calls `TERM-041` *"impossible"* while two regime authorities exist; source shows
   six.** ⛔ The verdict is if anything better supported than when it was written, but the *number*
   behind it is not the number in the register, and a sequencer reading "two" will under-estimate the
   derivation work for the losers.

---

## GAPS

1. ⚠️ **No store row count, for any row.** The fourth independent fact is unanswered 49 times.
   `TERM-049`, `TERM-058`, `TERM-068`, `TERM-073` and `TERM-083` all change shape if the answer is
   "empty", and `TERM-044` changes shape if `TRANSCRIPT_INDEX_ENABLED` has never been on.
2. ⚠️ **No flag value was read and none attempted.** Named and UNREAD: `VITE_COMING_SOON` /
   `COMING_SOON_MODE`, `TRANSCRIPT_INDEX_ENABLED`, `BARSPACK_WEB_INGEST_ENABLED`,
   `CATALYST_MUSTKNOW_GRADES`, `COMPASS_COST_CAP_DAILY`, `BROKER_SYNC_COOLDOWN_SEC`,
   `CLIENT_ERROR_BEACON_ENABLED`, `BARS_PUSH_ROLLOUT_PCT`, `BARS_HISTORY_SPLIT_ROLLOUT_PCT`,
   `DATA_SYNC_*`. ⛔ Several rows above would change state if a flag is off — a shipped module behind
   an unset flag is not a serving capability, and this file cannot tell the difference.
3. ⚠️ **No test was run, so every rail named above is a rail that EXISTS, not a rail that PASSES.**
   `s10Adoption.test.jsx`, `test_fmp_guard_census.py`, `test_rollout.py`,
   `test_entitlements_manifest.py`, `chordCollision.test.js` and `test_a12_s6_consistency_rail.py`
   are cited for what they assert, never for a green run. ⛔ And a rail nobody has seen fail proves
   nothing.
4. ⚠️ **`TERM-085` is unchecked, not absent**, and one more row leans the same way: `TERM-042`'s
   collector is PC-side, so its `ABSENT` is a statement about the **consumer** side only.
5. ⚠️ **Band 4's rows were checked for existence, not for interface fit.** §2.9's objection stands:
   a `d ≥ 1` ticket's acceptance criterion is a forecast about an interface that does not exist.
   Nothing here licenses writing those packages; it only says which premises are already false.
6. ⚠️ **No package is proposed for any row.** This file changes *states and sizes*, and a size
   without a package is still not implementable.
7. ⚠️ **Partner-owned files were read only as far as mounting and one docstring.**
   `api/schwab_router.py:258` was read because `TERM-070`'s diagnosis is in it; nothing deeper.
   `TERM-040` also routes through the partner boundary.
8. ⚠️ **I did not re-band anything.** Several rows are plainly `XS` after their recut (`TERM-058`,
   `TERM-066`'s module half, `TERM-059`'s primitive half) and item 30 GAPS 8 already records `XS` as
   underused — but re-banding on a grep is how item 17's `SZ` column would acquire an error with no
   owner.
9. ⚠️ **`I16-PARTIAL` is the weakest verdict in this file** — derive which rows carry it with §0's
   column census. It means *the sentence is defensible and the ticket premise moved beneath it*,
   which is a judgement about intent rather than a measurement. A reader who disagrees with one of
   them should re-read the cited lines, not the verdict — and ⛔ **`I16-PARTIAL` is the verdict most
   likely to be where I am wrong**, because it is the only one that is neither a presence nor an
   absence.

## NOT INSPECTED

- **The production pod, Railway and every flag's live value.** No `railway` command was run, none
  attempted, `/api/health` was not called.
- **Any database.** `user_tags`, `analyst_rows`, `ai_search_log`, `transcript_index`'s FTS5 index,
  `screener_analyst.db`, `education.db`, `entity_master.db`, and the R2 backup objects — **schemas
  and writers read at `origin/master`; no database opened, no row counted.**
- **`C:\data`.** Not read, not written, not enumerated. ⭐ `tools/authdb_restore_drill.py` refuses to
  work there, and that refusal was read rather than tested.
- **Every test suite.** Not run. `conftest.py`'s shared-data pins were not overridden and must not be.
- **The morning-wire repository** (`TERM-085`) and any engine-side template.
- **Partner-owned modules** beyond existence, mounting and the one `market-narrative` docstring.
- **The Whop Discord product.** Out of boundary; in no denominator here.
- **`backlog.md` itself was never written to.** Read-only, via `sed`/`grep`, while another agent held
  it — and nothing in this worktree was committed, staged or pushed.

## SOURCES

`10-roadmap/backlog.md` §2.1, §2.6, §2.7, §2.9, §8, §9, §10, GAPS 2/3/4/8 ·
`05-product-strategy/feature-opportunity-backlog.md` (the `Today.` / `Mechanism.` / `Size.` cells for
all 49 `FB-*` ids in bands 4–5) · `00-program-control/MASTER_CHECKLIST.md` row 30 ·
`00-program-control/GOVERNING_PRINCIPLES.md` §13.

Code, all at `origin/master` tip `2e0598bfa`, read 2026-09-26 via `git show` / `git grep`:
`api/services/rollout.py` · `api/services/fmp_client.py` · `api/services/provider_licensing_class.py` ·
`api/services/entitlements.py` · `api/data/entitlements_manifest.json` ·
`tools/build_entitlements_manifest.py` · `tests/test_entitlements_manifest.py` ·
`tools/fmp_guard_census.py` · `tests/test_fmp_guard_census.py` · `tools/authdb_restore_drill.py` ·
`tools/archive_authdb_backup.py` · `api/services/member_interest.py` · `api/routers/member.py` ·
`tests/test_a12_s6_consistency_rail.py` · `api/services/serve_stale.py` ·
`api/services/panel_prewarm.py` · `api/services/short_interest.py` ·
`api/services/institutional_holdings.py` · `api/services/insider_clusters.py` ·
`api/routers/insider.py` · `api/routers/filings.py` · `api/routers/catalysts.py` ·
`api/routers/screener.py` · `api/services/screener/query.py` ·
`api/services/screener/analyst_pass.py` · `api/routers/regime.py` ·
`api/services/voice_regime_classifier.py` ·
`api/services/alert_taxonomy/{catalyst_match,regime_change}.py` ·
`api/services/catalyst/tagging.py` · `api/services/watchlist_alert_service.py` ·
`api/services/alert_fired_log.py` · `api/routers/bars.py` · `api/services/adjustment_basis.py` ·
`api/routers/live_prices.py` · `api/routers/movers.py` · `api/routers/provenance_quote.py` ·
`api/routers/ai_search.py` · `api/services/ai_search_log.py` · `api/routers/education.py` ·
`api/routers/calendar.py` · `api/chart_edge_token.py` · `api/routers/note_sync.py` ·
`api/services/options_chain.py` · `api/massive_oi_snapshots.py` · `api/schwab_router.py` ·
`api/services/narrative_cost_guard.py` · `api/services/breadth_live.py` ·
`api/services/breadth_history_recon.py` · `api/alert_tester.py` ·
`api/middleware/auth_middleware.py` · `api/main.py` (`:190`, `:228`, `:1966`, `:1974`, `:2764`,
`:2772`, `:3430`, `:3583`, `:8714`, `:8785`) · `api/routers/auth.py` (`:1452`, `:2128`, `:2171`) ·
`api/routers/journal_two.py` · `api/services/journal_two/db.py` ·
`api/routers/hub_planned_trades.py` · `api/services/hub_planned_trades.py` ·
`app/src/lib/presentation/{presentationPrimitives.js,s10Adoption.test.jsx}` ·
`app/src/lib/context/{focusDivergence.js,symbolLinkChannels.test.js}` ·
`app/src/pages/command/{chords.js,chordCollision.test.js,chords.identity.test.js}` ·
`app/src/components/chart/keyboardShortcuts.js` · `app/src/pages/journal-2-0/JournalLayout.jsx` ·
`app/src/surfaces/manifest.js` · `app/src/lib/chartDeepLink.js` ·
`app/src/pages/charts/ChartsWorkspace.jsx` · `app/src/pages/screener/hooks/useScreenerCount.js` ·
`app/src/pages/screener/shell/FilterRail.jsx` · `app/src/pages/charts/widgets/AiSearchWidget.jsx` ·
`app/src/components/provenance/*` · `app/src/components/screener/CoverageLine.jsx` ·
`app/src/pages/research/i1S8Boundary.test.js` · `app/src/pages/Calendar.jsx` ·
`app/src/pages/Watchlists.jsx` · `app/src/utils/comingSoon.js` · `app/src/styles/tokens.css`.

⚠️ **Not a source:** this worktree's working tree. It is an older docs branch; every code statement
above came from `origin/master` through `git show` / `git grep`, never from a file on disk.
⛔ And **not a source:** `CLAUDE.md`, for the reason item 30 gives.
