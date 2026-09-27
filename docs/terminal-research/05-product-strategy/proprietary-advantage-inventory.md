---
id: F-05
title: UCT Proprietary Advantage Inventory (canonical, gate item 15)
role: Cross-pod synthesizer (Group F) — canonical pass over D-13's raw discovery
wave: 3
group: F
category: synthesis
scope: uct-dashboard (origin/master) · uct-intelligence engine + local KB · uct_intelligence (Discord bot) · morning-wire · uct-sunday-scan
confidence: 🟢 on every count in class ACCUMULATED (each derived this pass, deriving command stated) · 🟡 on the class assignment itself (a judgement over measured inputs) · 🔴 on production volumes and on consumption of every asset
evidence_ceiling: "Binding, inherited from D-13 and applied MORE strictly. Every production SQLite store lives on the Railway /data volume and is unreachable from this box, and the local C:\\data mirror was NOT READ AT ALL this pass (D-13's contract forbade it; the stricter rule was taken). The one production-shaped store that is readable is the engine KB at C:\\Users\\Patrick\\uct-intelligence\\data\\uct_intelligence.db, opened read-only with mode=ro. Nothing was measured on a running service: no Railway command was run, no flag state was read, no vendor API was called, no production endpoint was touched, the test suite was not run. CONSUMPTION of every asset is unmeasured and unmeasurable by this programme (§0.4)."
sources: 05-product-strategy/proprietary-asset-inventory-raw.md (D-13 — the raw pass this file is canonical over) · 02-data-providers/provider-master-ledger.md (F-09, gate item 4) · 01-existing-system/capability-ledger.md (F-03a, under a staleness banner) · 04-workflows/jobs-to-be-done.md (gate item 13) · 12-decisions/DECISION_CARDS_2026-09-26.md CARD 17 · 00-program-control/charter/OWNER_SEED_FACTS.md · 00-program-control/OWNER_INPUTS_REQUESTED.md OI-04 · origin/master code and data read via git show · C:\\Users\\Patrick\\uct-intelligence\\data\\uct_intelligence.db (read-only) · C:\\Users\\Patrick\\morning-wire\\data · C:\\Users\\Patrick\\uct_intelligence\\data
uct_relevance: high
status: draft
date: 2026-09-26
---

# UCT Proprietary Advantage Inventory — sorted by what is actually defensible

**Vocabulary.** TERMINAL-CURRENT = the existing surface at route `/calendar`, display-named
"UCT Terminal" since 2026-09-01 (display-only rename; route, door key `calendar`, widget keys,
`/api/calendar/*`, filenames and CSS classes unchanged). TERMINAL-NEXT = the product this programme
designs. UT is the parent brand; UCT Intelligence is the product.

**What this file is.** The canonical pass over
`05-product-strategy/proprietary-asset-inventory-raw.md` (D-13, dated 2026-09-02, 1,149 lines). It
does not re-discover. It **sorts, re-measures and quarantines**. Every asset D-13 found is carried
into exactly one of four classes, and the class is the primary axis, because an advantage inventory
that lists things a competitor could build in a fortnight is worse than no inventory: it points the
roadmap at the replicable half.

⚠️ **One citation correction, recorded rather than edited.** D-13's own header says it "is the
discovery pass that feeds the canonical `proprietary-advantage-inventory.md` (gate item 11)". Item 11
in `MASTER_CHECKLIST.md` is the Anti-Pattern Library; the Proprietary Advantage Inventory is **item
15**, this file. D-13 is a dated discovery artifact and other agents may be reading it, so the
correction lives here at the point of citation and D-13 is left untouched.

---

## 0. METHOD — the four classes, and the rules that decide a row

### 0.0 ⭐⭐ THE THESIS THIS INVENTORY SERVES — aggregation, not differentiation

**Owner, verbatim, 2026-09-26: "the goal is to aggreagte all the best features so someone can only use
our site instead of the others."**

⛔ **That inverts the usual reading of an advantage inventory, and the inversion has to be stated here
or the four classes below will be misread.** Under a *differentiation* thesis the valuable asset is the
one nobody else has, and an inventory of proprietary depth is the plan. Under an **aggregation** thesis
the binding constraint is **coverage**: any capability a competitor has and this product lacks is a
reason a member keeps the other tab open, and **one missing feature can defeat a hundred proprietary
ones**, because the goal is not "better than them at our thing" but "you never need them".

So the relationship between this document and the goal is narrow and must not be overstated:

* **ACCUMULATED is still the moat** — it is what keeps the product from being copied once it wins, and
  it is the only class that answers *"why not them instead of us"*.
* ⛔ **ACCUMULATED does not decide whether the goal is met. GAPS decide that.** Proprietary depth does
  not substitute for coverage, and no row in §1 can close a missing-capability hole. The
  gap-and-coverage question is the **capability matrix** and **best-of-breed** work plus gate item 16's
  85-item backlog — not this file.
* **LICENSED (§3) therefore matters more under this thesis, not less** — an aggregator is defined by
  the breadth of what it serves, and every §3 row is a capability a third party can switch off. It is
  a **dependency and permission** question throughout: *can this feed legally serve members, and whose
  advantage is it?*
* **CLAIMED, NOT EVIDENCED (§4) is where an aggregation plan gets hurt** — an assumed asset is a
  coverage hole nobody has scheduled.

⚠️ **One tension reported and deliberately not resolved: "only use our site" has a structural ceiling
that no feature can cross.** There is a standing governing default of **no execution and no order
management**, so a member who places a trade must still open a broker. That bounds full substitution to
**research and analysis** unless the owner revisits the default. This file reports the tension and
proposes nothing about execution.

### 0.0b Two owner-stated facts this file may now cite, and the line between them

* ✅ **The owner personally uses every desk tool the programme names** (thinkorswim/Schwab,
  TradingView, Finviz, Market Chameleon and the other named sites) — owner-stated 2026-09-26, so their
  live use is a **citable fact** rather than an assumption. ⛔ It is an **existence statement, not a
  per-task attribution**: it establishes that each tool is in use, never which job any one of them
  holds.
* ✅ **~750 paying Discord members** — that is the **Whop product's** population (§0.7).
  ⛔⛔ **Never merge it with UCT Intelligence's ~26 accounts / 13 with a page-view row into one
  denominator.** They are two products' audiences and a combined rate would be meaningless.

### 0.1 The classes

| Class | Definition | What it is worth |
|---|---|---|
| **ACCUMULATED** | A data asset that exists **only because time passed**, and cannot be bought or rebuilt quickly. | **The only class that is a moat.** |
| **BUILT** | Real engineering that works and that a competent competitor could replicate. | Valuable. Not defensible. |
| **LICENSED** | Depends on a vendor, so the advantage is the **vendor's**, and a third party can switch it off. | Never a UCT advantage. Name the dependency or do not list it. |
| **CLAIMED, NOT EVIDENCED** | An advantage this programme asserts that cannot be traced to an artifact reachable from this box. | Quarantine. Never dropped, never promoted. |

### 0.2 The unit of a row is the CLAIM, not the code

A store whose schema is confirmed but whose volume is unreachable yields **two rows in two classes,
and that is not double counting**: the machinery is BUILT (it exists, it is cited, a competitor could
write it), while the sentence *"this store is an accumulated moat"* is CLAIMED, NOT EVIDENCED,
because its volume is on the production volume. `wisdom.db`, `education.db`, `buzz.db`,
`signal_ledger.db`, `breadth_monitor.db`, `catalysts.db`, `modelbook.db` and `community.db` all split
this way, and every pair is cross-referenced by id.

**The corollary is the admission rule for ACCUMULATED: a row may only enter that class with a count
derived this pass.** A moat you cannot measure is a claim, so it goes to the quarantine — not because
the data is absent, but because the *advantage* is unevidenced.

### 0.3 ⛔ NEVER TYPE A COUNT — the deriving command is part of the method

This programme's signature defect is a hand-typed number beside the source that owns it. The theme
taxonomy drifted across six minor versions while calling itself "source of truth"; the chart writer
index said FOUR beside six; the COT router said "4 routes" beside five; the setup catalog said 24
beside 26 **in its own file header**. So no count in this document was copied from another document.
Every one was derived this pass and §0.6 states the command. Where a prior artifact's number and mine
differ, **both appear**, and §7 carries the disagreement rather than settling it.

### 0.4 ⛔ FOUR THINGS THIS DOCUMENT MAY NOT DO

1. ⛔ **It may not argue from usage or from cost, and both are now DE-SCOPED BY THE OWNER**
   (2026-09-26: *"Dont worry aobut anything else on costs or uses."*). Independently, usage was never
   available: ~26 production accounts exist, **13 with any page-view row**, six of those the roster
   admins; one account moves any rate by 3.85 points; and gate item 13 says of its own figures *"That
   is a listing, not a statistic — read as an existence check."* So **no row here carries a usage rate,
   a spend figure or an ARPU inference.** The `CONSUMED` column in §1 is deliberately **not** a usage
   measure — it records a **wiring fact** (does any route read this store?), which is a code
   observation and stays in scope.
2. **It may not read a flag's state.** There is no Railway access on this pass and none was attempted.
   Where liveness would change a claim the row says **flag state not read** and names the flag. A code
   default is not a flag state; a past decision is not a flag state.
3. **Price is settled, and two near-miss numbers must not be substituted for it.** **UCT Intelligence
   is $200/month or $2,000/year, owner-ratified 2026-09-26** (`12-decisions/DECISION_CARDS_2026-09-26.md`
   CARD 23), corroborated by `app/src/pages/Pricing.jsx`, whose docstring records it as the
   owner-approved strategy of the dated 2026-07-11 "premium reposition": one plan, everything
   unmetered, two months free on the annual, a 7-day card-required trial, no free tier on the
   marketing pages. ⛔ **Two numbers in this programme's own artifacts are NOT this product's price
   and must never be read as it:** (a) the **$7/week is the Whop plan — a separate product** (see
   §0.7), and (b) `09-security-licensing-cost/cost-model-ai-infra.md` carries a **"~$30/month
   comparable-floor" ARPU which is a COMPETITOR comparable** (Benzinga Basic, Unusual Whales Basic),
   not UCT's own price. The root defect that produced the earlier "contested pricing" reading was a
   **splice**: `charter/OWNER_SEED_FACTS.md:61` put a UCT Intelligence tier statement and another
   product's promo price in one sentence. ⛔ Beyond recording the settled number and guarding those two
   near-misses, **this file carries no pricing analysis** — price and cost are de-scoped (item 1).
4. **It may not invent a tier axis.** **One paid tier only** — the owner's ruling, verbatim
   2026-09-26, `12-decisions/DECISION_CARDS_2026-09-26.md` CARD 17, which explicitly vetoed a
   two-tier default; `OWNER_SEED_FACTS.md:61` says the same. The entitlement axis is therefore a
   **binary**: no tier-comparison surface, no upgrade affordance, no per-tier row anywhere below. An
   accumulated asset cannot be "the premium tier's differentiator", because there is no premium tier.

### 0.5 ⛔ THE THREE-STATE RULE — absent, admin-mounted and member-serving are three things

The capability ledger's recurring collapse is treating "not on a member surface" as "absent". Three
states are used here and every capability row carries one:

* **ABSENT** — no code.
* **ADMIN-MOUNTED** — code exists, a router is included in `api/main.py`, and **every route is
  `require_admin` or `require_push_secret`**. This is materially different from absent **and**
  materially different from populated-and-serving-members. It is the state the ledger keeps losing.
* **MEMBER-SERVING** — a route a paying member can reach.

A fourth fact is independent of all three and is never inferred from them: **whether the store behind
it holds any rows.** From this box, an ADMIN-MOUNTED capability over an empty table and one over a
million rows are indistinguishable.

### 0.7 ⛔⛔ THE PRODUCT-BOUNDARY RULE — the Whop live-trading Discord is a different product

**UCT Intelligence (the dashboard, the wire, this programme's subject) and the Whop plan (a
live-trading Discord, one week for $7) are two products.** The Whop plan is merely *promoted through*
the wire's Substack; `morning-wire/substack/promo.py` is the code that renders that promotion and says
so in the first person — it points *"at Whop (the live converter until the site's Founder Access
launch)"*, gated so a placeholder can never ship.

⛔ **An asset belonging to the Whop product is not a UCT Intelligence advantage, and counting it as
one crosses a product line.** That is not a licensing question and no clause fixes it; it is a
boundary question, and this programme's boundary is UCT Intelligence.

⛔ **This bites hardest on the Discord-derived assets, and it moved a row out of the moat class.** The
deepest-reaching data in the whole inventory — the 7,766-message classified trading-room export
(2024-03-11 → 2026-02-20) — is a **trading room**, classified into `trade_entry` / `trade_exit`, which
is what the Whop product is; and `api/services/buzz_ingest.py:25` names its polled channel
`#main-chat, Uncharted Territory`, which is the **parent brand's** server. This pass could not
establish which product either belongs to, or whether they are the same server, so per the rule above
both are in the **quarantine on attribution grounds** (CLM-19, CLM-02) with their measurements intact
and their class withheld. ⚠️ **A measurement can be sound and its OWNERSHIP still unestablished**, and
this is the case that proves it: nothing about the 7,766 rows is in doubt except whose they are.

⚠️ **An open question this creates rather than closes, stated and not resolved:** whether the ~750
community-member figure this programme quotes counts the Whop audience, the UCT Intelligence audience,
or a union of the two. ✅ **CLOSED THE SAME DAY, 2026-09-26 — and this file already says so in §0.0b, so it contradicted itself:** the owner stated *"We have 750 members in discord paying"*, so the figure is the **Whop product's paying Discord members** (CARD 25 §3). ⛔ The boundary rule this paragraph exists to enforce is UNCHANGED and still right — **no row here reasons from community size, and the two populations are never one denominator** (UCT Intelligence is ~26 accounts, 13 with any page-view row). Only the *"nobody knows"* clause was stale.

### 0.6 The deriving commands

**A. The engine knowledge base** — the ONE readable production-shaped store, and it is **live, not a
stale copy**: `knowledge_base.created_at` maxes at `2026-09-26 01:33:41` and `wire_issues.sent_at` at
`2026-09-26 14:19:44`, i.e. today. File size 95,686,656 bytes (`os.path.getsize`).

```python
import sqlite3
DB = r"C:\Users\Patrick\uct-intelligence\data\uct_intelligence.db"
con = sqlite3.connect("file:" + DB.replace("\\", "/") + "?mode=ro", uri=True)
c = con.cursor()
for t in ("knowledge_base","setup_templates","wire_issues","wire_universe",
          "leadership_snapshots","setup_triggers","trigger_performance","setup_performance",
          "book_plans","book_ledgers","model_examples","coaching_notes","market_regimes",
          "ep_candidates","ep_follow_throughs","wire_prompt_config","earnings_analytics",
          "news_archive","ticker_metadata","market_breadth"):
    print(t, c.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
# Spans use each table's OWN date column, read from PRAGMA table_info and never guessed:
#   knowledge_base.created_at · leadership_snapshots.snapshot_date · wire_issues.sent_at
#   setup_triggers.trigger_date · book_plans.session_date · coaching_notes.note_date
#   market_regimes.regime_date · ep_candidates.date_flagged · earnings_analytics.report_date
# e.g. SELECT MIN(col), MAX(col), COUNT(DISTINCT col) FROM <table>
print(c.execute("SELECT status, COUNT(*) FROM setup_triggers GROUP BY 1 ORDER BY 2 DESC").fetchall())
print(c.execute("SELECT arm, COUNT(*) FROM book_ledgers GROUP BY 1").fetchall())
print(c.execute("SELECT origin_trader, COUNT(*) FROM setup_templates GROUP BY 1 ORDER BY 2 DESC").fetchall())
print(c.execute("SELECT COUNT(DISTINCT symbol), COUNT(DISTINCT snapshot_date) FROM leadership_snapshots").fetchall())
```

**B. Anything in the dashboard repo** — read from `origin/master`, never from this worktree's working
tree, which is a docs branch on an older master:

```python
import json, subprocess
def gs(p):
    return subprocess.run(["git", "show", "origin/master:" + p],
                          cwd=r"C:\Users\Patrick\uct-worktrees\terminal-research",
                          capture_output=True).stdout
t = json.loads(gs("themes_taxonomy.json"))
print(t["version"], len(t["themes"]), len(t["sectors"]),
      sum(len(v.get("holdings") or []) for v in t["themes"].values()))
b = json.loads(gs("docs/base_lift_ledger.json"))
print(len(b["structures"]), [k for k, v in b["structures"].items() if v.get("published")])
print(len(json.loads(gs("api/data/cap_universe.json"))))
print(len(json.loads(gs("app/src/constants/quotes.json"))))
print(len(json.loads(gs("api/data/buzz_collisions.json"))["tokens"]),
      len(json.loads(gs("api/data/buzz_aliases.json"))))
```

**C. Curriculum, and the chart-example verdict census** — `json.load` for structure, a regex census
for the verdicts, never a typed total:

```python
import collections, re
c = json.loads(gs("docs/curriculum/uct_method_course.json"))
print(len(c["modules"]), sum(len(m.get("lessons") or []) for m in c["modules"]))
f2 = json.loads(gs("docs/curriculum/curriculum_final_v2.json"))
print({k: len(v) for k, v in f2.items()})
raw = gs("docs/curriculum/uct_method_scripts.json").decode("utf-8", "replace")
print(collections.Counter(re.findall(r'"spec_verdict"\s*:\s*"([^"]+)"', raw)))
```

**D. On-disk archives** — morning-wire and the Discord bot, both local, neither under `C:\data`:

```python
import glob, json, os
W = r"C:\Users\Patrick\morning-wire"
print(len(glob.glob(W + r"\data\snapshots\wire_*.json")),
      len(glob.glob(W + r"\data\sent\letter_*.html")),
      len(glob.glob(W + r"\data\reviews\*")))
v = json.load(open(W + r"\data\voice\voice_profile.json", encoding="utf-8"))
print(len(v), v["posts_total"], v["tsdr_words"], v["tsdr_sentences"])
print(len(json.load(open(W + r"\data\voice\voice_exemplars.json", encoding="utf-8"))))
m = json.load(open(r"C:\Users\Patrick\uct_intelligence\data\processed\processed_messages.json",
                   encoding="utf-8"))
ts = [x["timestamp"] for x in m if x.get("timestamp")]
print(len(m), min(ts)[:10], max(ts)[:10])
```

**E. The published Substack archive** — counted **per dated snapshot**, because the snapshots differ
from each other by construction (one new Sunday Scan per week), which is why a single total is the
wrong shape:

```python
for f in sorted(glob.glob(r"C:\Users\Patrick\uct-intelligence\data\intake\substack_uct_full_archive_*.txt")):
    txt = open(f, encoding="utf-8", errors="replace").read()
    print(os.path.basename(f), txt.count("[SUNDAY SCAN]"), txt.count("[ARTICLE]"))
```

**F. Mounting and auth state** — read at `origin/master`, because a mount is a line in a file that
moves:

```bash
git show origin/master:api/main.py | grep -n "wisdom\|entity_master"
git show origin/master:api/routers/wisdom_core.py | grep -n "APIRouter\|require_admin\|prefix"
git ls-tree -r --name-only origin/master -- api/services/wisdom | wc -l
```

**G. Class membership counts in this document** — derived by pattern over the finished file, never
typed. §5 states the command and its output.

---

## 1. CLASS 1 — ACCUMULATED · the only class that is a moat

⛔ **Two admission rules, and both excluded a row this pass.**
1. From §0.2: a row appears here only with a **count derived this pass**. Assets whose depth is real
   but unreachable are in §4, not here.
2. From §0.7: a row appears here only if it belongs to **UCT Intelligence**. The deepest-reaching
   asset in the inventory was moved out on this rule alone (CLM-19).

**The `CONSUMED` column is a WIRING fact, not a usage measure**, and takes exactly one of three values:
`MEMBER-WIRED` (a route a paying member can reach reads it), `PRODUCER-ONLY` (only the generation
pipeline reads it), `NO-SURFACE-FOUND` (this pass found no reader). ⛔ **`MEMBER-WIRED` never means
anyone opened it** — usage and cost are de-scoped by the owner and were never measurable here anyway
(§0.4 #1, CLM-11). ⛔ And `NO-SURFACE-FOUND` is an absence of evidence from this pass, not proof of
absence: AI Search (`api/services/ai_search_*`, 12 modules) and the voice lane (~70 modules) were not
read here and are D-12's territory.

| ID | Asset · where | Derived measurement (2026-09-26) | Reaches back to | CONSUMED |
|---|---|---|---|---|
| **ACC-01** | **Trading knowledge base** — `uct_intelligence.db :: knowledge_base` | **9,797 rows**, all `active=1`; **5,215** distinct `created_at`; epoch split `2026` 7,430 / `2024` 2,367; largest single source `intake:substack_unchartedterritory_sunday_scans_2026-02-21` **4,399** (the firm's own newsletter), then `self_review` **1,615**, `intake:discord_tsdr` **591** | `created_at` **2026-02-21 05:14:49** → **2026-09-26 01:33:41** | MEMBER-WIRED (Brain Pack → `brain_service` / `brain_kb_service` → Compass + voice; gated by `BRAIN_TOOLS_ENABLED` — **flag state not read**) |
| **ACC-02** | ⭐⭐ **The decision record** — `wire_universe` × `wire_issues` | `wire_universe` **22,574 rows**; `wire_issues` **60 issues**; drop-stage census: `dropped_at_stage = 2` → **19,611**, NULL → **2,963** | `wire_issues.sent_at` **2026-04-29** → **2026-09-26** | **NO-SURFACE-FOUND** |
| **ACC-03** | **Leadership thesis archive** — `leadership_snapshots` | **5,120 rows**, **1,140** distinct symbols, **151** distinct dates; each row carries rank, `setup_type`, **`thesis`**, score, `confidence_tier`, `regime_fit` | **2026-02-19** → **2026-09-25** | MEMBER-WIRED (wire `leadership` payload → `/api/leadership` → `/uct-20`, `LeadershipTile`) |
| **ACC-04** | **Resolved trigger ledger** — `setup_triggers` + `trigger_performance` + `setup_performance` | `setup_triggers` **540 rows**, status census **win 134 · loss 151 · never_triggered 168 · open 85 · unresolved 2**; `trigger_performance` **54**; `setup_performance` **23** | **2026-07-30** → **2026-09-25**, **39** distinct trigger dates | MEMBER-WIRED via the Book (N3); whether the **negative** per-setup expectancies are displayed is D-13's own open 🟡 and was not settled here |
| **ACC-05** | **The Book** — `book_plans` + `book_ledgers` | `book_plans` **760 rows** over **38 sessions**; `book_ledgers` **58**, splitting exactly **29 variant / 29 control** | `session_date` **2026-07-30** → **2026-09-25**; the *published* record starts at `BOOK_RECORD_START = 2026-08-27` | MEMBER-WIRED (`wire_data.uct20_book` → `/uct-20`) |
| **ACC-06** | **Episodic-pivot outcome record** — `ep_candidates` + `ep_follow_throughs` | **506** candidates over **119** distinct flag dates; **12,257** follow-through rows | **2026-02-20** → **2026-09-25** | **NO-SURFACE-FOUND** |
| **ACC-07** | **Regime history** — `market_regimes` | **165 rows**, **165** distinct dates (one per session — the row count and the distinct-date count agree, so there are no duplicate days) | **2026-02-20** → **2026-09-25** | MEMBER-WIRED (`exposure_pct` → the 0–150 exposure rating) |
| **ACC-08** | **The desk's self-review trail** — `coaching_notes` + the KB's `self_review` slice | `coaching_notes` **619 rows** over **107** distinct dates, all `note_type='pattern'`; KB `source='self_review'` **1,615 rows** | `note_date` **2026-03-30** → **2026-09-25** | **NO-SURFACE-FOUND** (internal by design) |
| **ACC-09** | **Published Substack archive** — 11 dated snapshots in `uct-intelligence/data/intake/` | Newest, `substack_uct_full_archive_2026-09-25.txt` (1,632,596 bytes): **69 `[SUNDAY SCAN]` + 27 `[ARTICLE]`**. The series grows one Sunday Scan per snapshot: 61+27 (07-24, 07-30, 07-31) → 62 → 63 → 64 → **65** (08-28, the file D-13 read) → 66 → 67 → 68 → **69** (09-25) | earliest post **2025-06-01** (D-13's read of the same series; not re-derived here) | MEMBER-WIRED indirectly (4,399 KB rows; Desk articles via `substack_poller`) |
| **ACC-10** | **Morning Wire payload archive** — `morning-wire/data/` | **44** `snapshots/wire_*.json`; **26** `sent/letter_*.html`; **78** files in `data/reviews/` | snapshots **2026-07-21** → **2026-09-25**; letters **2026-08-19** → **2026-09-25** | **NO-SURFACE-FOUND** — no replay surface exists for the archive |
| **ACC-11** | **Quantified voice models (two named humans)** — `morning-wire/data/voice/` + `uct-sunday-scan` | `voice_profile.json`: **24 metrics**, `posts_total` **88**, `tsdr_words` **120,055**, `tsdr_sentences` **9,016**; `voice_exemplars.json`: **120** verbatim exemplars. Beside them the Bracco measurements (58 sections, 20.7% of published body, "lol" **0 times in 211,539 characters**) and the **851**-per-ticker-note anchor-vocabulary audit, both encoded as constants inside `uct-sunday-scan` | mined from the published archive back to 2025-06-01 | PRODUCER-ONLY (`morning-wire/owner_voice.py` at generation time; `sunday_scan/bracco.py`) |
| **ACC-12** | **The taste→prompt loop's output** — `wire_prompt_config` | **26 versions** | first version undated in-table; the loop's inputs are the owner's per-segment 👍/👎 and notes | PRODUCER-ONLY (`generate_rundown` reads it back) |
| **ACC-13** | **The curriculum** — `docs/curriculum/` at `origin/master` | `uct_method_course.json` **16 modules / 79 lessons**; `curriculum_final_v2.json` **33 units / 20 gaps / 20 briefs / 5 architecture keys / 2 schedule entries**; `uct_method_toolkit.json` **7** printable artifacts; `uct_method_scripts.json` 691,762 bytes; **`spec_verdict` census over 181 chart examples: corrected 138 · verified 29 · replaced 9 · no_data_needed 5** | authoring time, not market time | **NO-SURFACE-FOUND** — the content is in git and in no product DB (CLM-18) |
| **ACC-14** | **The annotated teaching corpus** — the scarce input | `model_examples` **18 rows** (only 2 carry an `outcome_pct`); **21** annotated PNGs in `uct-intelligence/data/charts/`; **9** authored playbooks in `setupPlaybooks.js` | — | PRODUCER-ONLY (desk authoring); the dashboard's Model Book uses its **own** `/data/modelbook.db` and the relationship between the two libraries is **NOT DETERMINED** (D-13 §4) |

### 1.1 ⭐⭐ The single strongest ACCUMULATED candidate, and the measurement that carries it

**ACC-02, the decision record — `wire_universe` at 22,574 rows across 60 issues, of which 19,611
carry `dropped_at_stage = 2`.**

The measurement that makes it the strongest is not the row count; it is the **drop-stage census**. A
published watchlist is a claim anyone can make. A table that records, per issue, the names that were
**considered and rejected, with the stage each one died at and the feature vector it had at the
time**, is a record of judgement under uncertainty. No vendor sells it and no scrape recovers it. It
exists only because 60 mornings happened. Three properties carry it:

1. **It is unambiguously this product's.** The Morning Wire is UCT Intelligence's paywalled item, and
   `wire_universe` is written by the wire engine. Unlike the Discord corpus (CLM-19) there is no
   product-boundary question to answer first — which, after §0.7, is itself a scarce property.
2. **It is adversarially self-incriminating.** 19,611 rejects is a standing statement that the desk
   looked at a name and passed on it. That is the same doctrine as ACC-04's 151 losses beside 134 wins
   and as the flow scoreboard's locked honesty rules (BLT-04): commercially costly, therefore
   credible. Best-of-breed found the per-ticker history join one of only two spine rows with **no
   incumbent** across fifteen products, several conceding they structurally cannot do it.
3. **It is the least consumed thing in the inventory.** `CONSUMED = NO-SURFACE-FOUND`. The most
   defensible asset reaches no member. ⭐ **That combination — highest defensibility, zero
   consumption — is the most actionable finding in this document**, because closing it is a join and a
   permission model rather than a data-collection programme. What remains unevidenced about the join
   itself is CLM-14.

⚠️ **The honest caveat, stated because this row is the headline.** 60 issues spanning 2026-04-29 →
2026-09-26 is a **young** record, and that span contains roughly 104 weekdays, so the archive is **not
every session**. The depth is five months, not five years. The *shape* is irreplaceable; the *depth*
is not yet, and a pitch that implies otherwise is making the LIC-14 mistake with UCT's own data.

⚠️ **And two points do not establish a rate.** §6.2 records that most of these tables grew between
D-13's 2026-09-02 measurement and this one. That is a **measured increment over a named interval**,
not a growth rate, and it must not be annualised (CLM-17).

### 1.2 Notes that change how three rows should be read

* **ACC-01's first-party share is a range, not a number.** Summing the traders the firm attributes to
  itself (`Bracco`, `TSDR`, `UCT Brain`, `Uncharted Territory`, `TSDR Trading`) gives **5,732 of 9,797
  = 58.5%**, with a further **1,414 rows carrying a blank `trader`** that could belong to either half.
  So the defensible share lies between **58.5% and 73.0%** and should be stated as that interval. The
  third-party remainder (Qullamaggie transcripts, Minervini/O'Neil/Brandt/Wyckoff frameworks) is
  re-organised public material, **not defensible on its own**, and carries an unresolved licensing
  question (CLM-15). ⛔ The KB already carries `source`, `trader` and `source_ref`, so a member-facing
  passage can be attributed — "Bracco, Sunday Scans 2026-06-08" is worth more than an unattributed
  rule, and attribution is also what keeps the commodity half honestly labelled. **A further 591 rows
  (`intake:discord_tsdr`) inherit CLM-19's product-attribution question and ship inside the Brain
  Pack**, which is a cross-product exposure, not merely a licensing one.
* **ACC-04's small-n rows must never ship unqualified.** The per-setup table includes samples in the
  single digits. Publishing an expectancy at n=4 is the exact defect the lift ledger's six gates exist
  to prevent (BLT-01). Ship n beside every number, or ship neither.
* **ACC-13 is the weakest row in this class and is flagged as such.** Authoring time is *purchasable*
  in a way that a two-year trading-room log is not: a funded competitor can hire authors. What is not
  cheaply purchasable is the **181-example data-verification pass**, whose census (**138 corrected, 9
  replaced**) is evidence the grounding was real rather than ceremonial — 147 of 181 examples were
  wrong on first pass, and a competitor who skips that step ships the wrong charts. **The moat is the
  verification, not the syllabus.**

---

## 2. CLASS 2 — BUILT · real engineering, replicable, not defensible

Most of the product is this class, and saying so plainly is the point. A BUILT row is worth shipping
and worth protecting operationally; it is **not** worth putting in a moat argument. Each row carries
its three-state reach (§0.5).

| ID | What it is · where | Derived / cited detail | Reach |
|---|---|---|---|
| **BLT-01** | **The six-gate lift harness** — `docs/base_lift_ledger.json` + `api/services/screener/lift_ledger.py` | Measured at `origin/master` today: **25 structures, 3 published** (`darvas-box`, `parabolic-extension`, `ema-crossback`) — a **22-of-25 rejection rate**. Metric `P(+10% before −8% within 20 sessions)`; CI = 400-draw cluster bootstrap resampling tickers; null re-runs the identical detector over moving-block (21-bar) resampled series; a published row needs 30 null trials, and gate 2 compares the CI's **lower bound** to the null's **maximum** | MEMBER-SERVING (published rows) |
| **BLT-02** | **The closed indicator grammar** — `engine/ast/closedTable.json` manifest v2, Pine/thinkScript/PCF transpilers, `api/services/ast_interpret.py`, CodeMirror editor + linter | Two runtimes (JS + Python) over **one** manifest; the grammar is closed so a formula is decidable before it runs, which is what lets one saved formula sweep thousands of symbols on a schedule | MEMBER-SERVING |
| **BLT-03** | **The append-only signal ledger design** — `api/services/signature/`, `signal_ledger.db :: signature_signals` | INSERT-only, keyed `(indicator, version, sym, tf, bar_time, direction)`, `first_seen_at` immutable; four tenants plus `rsLine` added specifically to prove the lane is generic | MEMBER-SERVING (design); **depth unmeasured → CLM-03** |
| **BLT-04** | **The flow scoreboard's honesty contract** — `api/flow_scoreboard.py` over `api/top_flow_tracker.py` | Locked rules in the module's own docstring: losers **never** excluded; picks with fewer than 2 daily snapshots reported separately as "too new" and excluded from rates rather than silently dropped; all gains are **contract-price** gains, not underlying moves | MEMBER-SERVING, and **public, no auth** |
| **BLT-05** | **The Book's mandatory control arm** — `uct_intelligence/book/book.py` | Returns stopped ledger **and** no-stops control from one pass; `ControlArmMissing` makes a control-less run an error, not a warning. Confirmed in the data: `book_ledgers` splits exactly 29/29 (ACC-05) | MEMBER-SERVING |
| **BLT-06** | **The setup grammar as data** — `uct_intelligence.db :: setup_templates` | **48 rows**, unchanged since D-13. `origin_trader` census: **TSDR 8** (house-original), O'Neil 6, Brandt 6, various 5, Wyckoff 4, Qullamaggie 4, remainder attributed. Each row carries `ideal_regime`, `sector_conditions`, `liquidity_min`, `float_requirements`, `catalyst_types`, `trend_requirements`, `ma_alignment`, `rs_requirements` | PRODUCER + MEMBER-SERVING via 24 `pattern_engine/detectors/uct/` modules |
| **BLT-07** | **The candle grammar** — `api/services/screener/candle_catalog.py` | 66 patterns (22 shapes + 44 relations), textbook bias only, **no scoring** by owner decision 2026-08-24 — no strength number, no measured direction, no probability reaches a member; `rank` is ordering only | MEMBER-SERVING |
| **BLT-08** | **The theme taxonomy + owner-precedence overlay** — `themes_taxonomy.json` + `theme_engine/` | Measured at `origin/master` today: **v4.22.0, 112 themes, 12 sectors, 2,029 holdings** — **unchanged** from D-13's 2026-09-02 read and from the 2026-08-07 reading in `CLAUDE.md`. The engine writes only to an `engine_memberships` overlay and physically cannot edit the JSON; aggregates are owner-only by rule | MEMBER-SERVING |
| **BLT-09** | **The COT read layer** — `app/src/pages/cot/` (13 modules) over public CFTC data | `cotRead.js` (3Y + 26-week COT Index, zones 90/75/25/10, commercial-led bias, crowding, Movement Index), `cotAnalogs.js` (forward returns 4/8/13 weeks, **no lookahead past the week shown**), `cotDivergence.js` (5 tells), `cotFacts.js` (**the only numbers the LLM may cite**). One implementation, two runtimes: Python shells out to the Node bundle | MEMBER-SERVING |
| **BLT-10** | **The Desk pipeline** — publish → insights → announce → audit | Zoom HMAC → largest-MP4 download with a content-type guard → resumable YouTube upload → branded thumbnail → `edu_videos` row → trash cloud copy; then VTT → chapters/ticker-moments/recap; then one Discord embed **edited** in place; then an audit that **reads the artifact, not a counter**, with a 3h grace and **names, not counts** | MEMBER-SERVING |
| **BLT-11** | **The Sunday Scan generator's measured-conformance machinery** — `uct-sunday-scan/` | `ROSTER_CARRY_TARGET = 0.72` with the measurement written beside it (72.2% mean / 73.5% median), band (0.50, 0.86); anchor confluence instead of entry/stop/target because that vocabulary "appears essentially nowhere in 851 per-ticker notes"; the Bracco renderer **asserts output word count equals input word count**, so summarising him is structurally impossible; a re-scrape is adopted only if `parse_agreement` passes; the package **never auto-publishes** | PRODUCER (owner publishes) |
| **BLT-12** | **The wire critic loop** — `morning-wire/wire_critic.py` + `api/routers/wire_feedback.py` | Owner per-segment 👍/👎 and notes → `GET /api/wire-feedback/recent-internal` (PUSH_SECRET) → Opus critic per qualifying segment → distilled guidance + ≤3 exemplars into `wire_prompt_config`; owner **notes bypass the min-votes gate and outweigh the thumbs** | PRODUCER; output is ACC-13 |
| **BLT-13** | **Privacy-by-schema buzz design** — `api/services/buzz_{ingest,store,extract,universe}.py` | Stores **no message text** by design: `message_id` + `channel_id` reconstruct a jump link, which stays true when a member edits or deletes. Collisions are **derived, never typed**: `buzz_collisions.json` holds **111 tokens** (keys `_comment`/`derived_from`/`measured_effect`/`tokens`) and `buzz_aliases.json` **54** entries; EMA, GAP, LINE, BULL, GAIN were **removed** 2026-09-01 once the derived corpus covered them | MEMBER/community-SERVING; **volume unmeasured → CLM-02** |
| **BLT-14** | **The Brain Pack two-repo contract** — `brain_pack_export.py` ⇄ `api/services/brain_{sync,service,kb_service}.py` | Pack layout (`uct_intelligence/` + `data/uct_intelligence.db` + `PACK_MANIFEST.json`) is a locked contract between two repositories; the facade never raises; sizing hard-caps account risk at 2%; semantic index over the KB with incremental reindex by content hash | MEMBER-SERVING (Compass/voice); `BRAIN_PACK_ENABLED` / `BRAIN_TOOLS_ENABLED` **flag state not read** |
| **BLT-15** | ⭐⭐ **The Wisdom Loop machinery** — `api/services/wisdom/` | **111 files** (`git ls-tree -r --name-only origin/master -- api/services/wisdom \| wc -l`); six packages (`core, capture, sources, extract, evals, publish`); a **32-table** schema contract (`docs/wisdom/contracts/wisdom-db-v0.sql`); store initialised at boot (`api/main.py:3480-3482`), jobs registered (`:6351-6353`), and **six routers included unconditionally** (`:8865-8867`, iterating `wisdom_registry.routers()`); store path `WISDOM_DB_PATH`, default `/data/wisdom.db`, resolved on every call | ⚠️ **ADMIN-MOUNTED.** `api/routers/wisdom_core.py:25` is `APIRouter(prefix="/api/admin/wisdom/core")` and its header states *"Every route, reads included, carries Depends(require_admin)"*, with owner-private routes on `require_owner`; the internal half is `require_push_secret`. **No member route exists.** Master switch `WISDOM_INGEST_ENABLED` re-read per run — **flag state not read** |
| **BLT-16** | **The entity master** — `api/services/entity_master/` | `entity_figi` table (`schema.py:78-85`: `composite_figi` / `share_class_figi` / `source`), reconciler writing entities (`reconciliation.py:164-211`) | ⚠️ **ADMIN-MOUNTED.** Verified independently at `origin/master` this pass: `api/main.py:125` imports `entity_master_admin`, `:8830` includes it at `/api/admin/entity-master/*` (admin-only). ⛔ Note the capability-ledger banner cites `:107` and `:8707` — **the line numbers have drifted**, which is the same defect class as a typed count beside a moving file |
| **BLT-17** | **The evaluation harnesses** — `api/services/{compass_eval,ai_search_eval}/`, `scripts/run_report_card.py` | Compass report card 50 questions / 5 rungs, exit 1 = do not ship; AI-Search card 30 questions; `run_grounding_audit` measures **retrieval** free. ⛔ Never run on the prod pod (two OOM outages 2026-08-28) | STAFF (manual) |
| **BLT-18** | **The coverage receipt** — `components/screener/CoverageLine.jsx` + `scan_evaluator._assert_coverage_closes` | Four counts, never three: *evaluated · answered · dropped · not computable*, with `withheld` **beside** them; refuses to present a receipt whose arithmetic does not close; says "that is a gap in what we hold, not a quiet market" **in those words** when `answered == 0` | MEMBER-SERVING |
| **BLT-19** | **The pattern engine** — `api/services/pattern_engine/` | 85 detector modules (candlestick 17 · classical 36 · structure 8 · **uct 24**) + `pattern_vision/` judging | **Dormant** by ruling (15.7% precision; `/patterns` page retired). `PATTERN_VISION_ENABLED` — **flag state not read**; the engine is kept because Compass's `find_patterns_on_ticker` reads `pattern_detections` |
| **BLT-20** | **The cited quote library** — `app/src/constants/quotes.json` + `api/services/quote_of_the_day.py` | **674** entries measured at `origin/master`, each `{t, a, src, tags}`; the 2026-08-22 verification pass upgraded 42 to primary sources, re-credited 33 and **dropped 12 fabrications**, leaving 76 as `Attributed`; the **server** picks, anchored to the latest wire's own `exposure_tier` word, parity-tested through Node | MEMBER-SERVING, **public** endpoint |

### 2.1 What the BUILT class is actually for

Four of these rows are *doctrine encoded as a refusal*, and that is the transferable part: BLT-01
refuses to publish a lift that fails six gates; BLT-04 refuses to drop a loser; BLT-05 refuses to run
without a control; BLT-18 refuses to print a receipt that does not balance. A competitor can copy the
code in a fortnight. **Copying the refusals means killing 22 of their own 25 claims**, and that is a
positioning asset even though it is not a moat — it is legible to a sophisticated member in one
sentence and it is exactly what a member cannot verify about anyone else.

⛔ **The reason this is still class BUILT and not ACCUMULATED:** a refusal is a policy, and a policy
can be adopted by anyone on any Monday. It is not an asset that took time to exist.

---

## 3. CLASS 3 — LICENSED · somebody else's advantage, and they can switch it off

⛔ **Read before this section is used for anything.** Every classification below is **inherited, not
re-derived**, from the provider/licensing ledger that already owns it: `02-data-providers/provider-master-ledger.md`
(F-09, gate item 4, **DRAFT COMPLETE**, which supersedes `provider-ledger.md` as the gate-4 artifact)
and through it F-04's 118-row licensing register. Nothing here re-classifies a clause. Three facts
about that ledger govern how this class must be read:

1. ⛔ **Zero rows in the entire programme reach CONTRACT-ACTIVE.** The status ladder is KP → CR → OC →
   CA, and **no leaf has ever seen a vendor contract, order form, invoice, plan page or provider
   console.** Every licensing cell is a reading of a *public* clause against an *assumed* tier.
2. ⛔ **Two owner facts decide roughly two-thirds of the licensing column and neither is answered** —
   the Massive tier and whether an FMP Data Display and Licensing Agreement exists (F-04 ESC-01 /
   ESC-02). They change **zero** access cells and **every** rights cell simultaneously.
3. ⛔ **OI-04 — "which providers are contractually active today?" — is settled by DEFAULT-APPLIED
   (2026-09-18), not by an owner answer.** The applied default is the operational proxy *"any key with
   no OBSERVED-CALLED evidence in 30 days is treated as retired"*, and the ledger records that the
   question's own framing was **stale**: `BULLFLOW_API_KEY` is still actively read and gating
   `api/liveflow_worker.py` (so "retired in code" is wrong), and `FRED`/`THEFLY` keys **are**
   referenced (`fred_economic.py`, `thefly_news.py`), so "absent everywhere" is wrong.
   **Code-liveness is not billing status**, and billing status is unmeasurable from this box. Any
   owner billing statement overrides the default instantly.

| ID | Capability that looks like an advantage | The dependency that actually owns it | Rights posture (F-09/F-04, inherited) |
|---|---|---|---|
| **LIC-01** | Live quotes, bars, movers, index/ETF snapshots — the spine under every chart | **Massive REST** (Polygon-family) | **R** at the assumed Individual tier / **LA** at Business; only Business §2.2 grants `store` at all. Tier **UNKNOWN** (ESC-01) |
| **LIC-02** | The options-flow tape — the product's most distinctive-looking surface | **Massive OPRA WS** | **U** — F-04 calls it *"the largest single U in the document"*; the Third-Party Agreements are unpublished. Massive OPRA **does not replay**: every feed gap is permanent until the T+1 flat file |
| **LIC-03** | Dark-pool prints and the all-time records built on them | **Massive flat files (S3)** | **R** (Ind) / **U**–**LA** (Bus). The *records table* is UCT's (BLT/CLM-04); the *prints* are not |
| **LIC-04** | Fundamentals, financial statements, estimates, earnings history, ownership | **FMP Premium** | **R** without a DDLA / **LA** with one; §2.2.2 forbids display *"on applications designed for utilization by multiple individuals"* absent one. **DDLA existence UNKNOWN** (ESC-02) — F-04 calls this the clearest case in the register of access without a settled right |
| **LIC-05** | Earnings-call transcripts and the search over them | **FMP** (of record) → **AlphaVantage** (verbatim, lazy) → **earningscall.biz/Quartr** (dormant stub) → **Finnhub** (403) | FMP display **LA** with a DDLA but storage/summarisation **U** — *"a DDLA about display may not speak to summarising prose"*, F-04's **sharpest AI row**. AlphaVantage's own commercial-use definition **catches UCT at the free tier**. Transcript coverage was measured **null (n=0)** this cycle |
| **LIC-06** | The whole-market screener universe, short interest, chart PNGs | **Finviz Elite** | **U** — *"no terms document exists at all"*, F-04's **single largest documentary gap**; `robots.txt` disallows the exact paths used, so reachability itself is contested. ⛔ *"A Finviz no is a capability deletion, not a swap"* |
| **LIC-07** | The always-on live tick stream | **Finnhub** | **R** — *"strictly for personal use"*, *"even internally"*, *"or derived results"* (undefined and unbounded). The **most-restricted provider in the stack sits on the least-visible always-on surface** |
| **LIC-08** | Futures (NQ/ES/RTY/BTC), index symbols, dividends, parts of fundamentals | **yfinance / Yahoo** | **X — no purchasable remedy at any price.** The only rows in the register where "verify the contract" is not a move. Reached by 24 importing modules |
| **LIC-09** | GEX walls / dealer positioning | **Schwab**, via partner-owned files | **U, leaning R** — one account holder's entitlement fanned out to the membership on unauthenticated routes. Developer portal 403; MDA behind a login |
| **LIC-10** | A member's own broker positions, trades and balances | **SnapTrade** | **LA** for the member's own data to that member; **R** for **any** cross-member aggregation (a leaderboard, "what the room owns") — needs written consent of **both** the end user and SnapTrade. ⭐ This is the clause that forecloses the most obvious "community data" product |
| **LIC-11** | Breaking-news tape and cashtag signal | **twitterapi.io / X** | **R** — X Display Requirements **measurably unmet** (X-03) and **no deletion-sync** (X-04). Cashtag *counts* are **LA**. ⛔ And nothing accretes: `TWEET_RETENTION_DAYS=7` — though `catalysts.db` retains tweets past that window (RG-21), which is a compliance exposure, not an asset |
| **LIC-12** | COT positioning — the substrate under BLT-09 | **CFTC** | **A — public domain**, no vendor licence in the path. F-04 calls it *"the cleanest AI surface in the product"* |
| **LIC-13** | SEC filings | **SEC EDGAR** | **A — public domain.** ⚠️ Also the one provider with a *class-C* capability: Form 4 / 13F are available, public-domain and **unused**, while five worse-licensed providers serve overlapping ownership data |
| **LIC-14** | The 1987→2026 breadth/sentiment series — the longest history in the inventory | **NAAIM / AAII / CBOE / CNN / Macrotrends / Barchart / YCharts** public scrapes (F-09 row 45) | ⛔ **Class F — licensing never researched.** Measured at `origin/master`: `api/data/breadth_sentiment_history.csv` = **15,897 rows, 1987-07-24 → 2026-01-01**. ⛔⛔ **This is the clearest trap in the document: the depth belongs to the publishers, not to UCT.** UCT did not wait 39 years; it downloaded someone who did. The feed is also **fragile and degrading** — NAAIM 101 days stale, CBOE 403s to python, the NAAIM task exiting rc 1 |
| **LIC-15** | Every AI lane — narratives, synthesis, chapters, covers, search | **Anthropic**, **OpenAI**, **Perplexity** | Anthropic is **LA conditioned on §L.1**, which **hands every input restriction (FMP, Finnhub, X, TheFly, AV) back to UCT at the prompt boundary** — the permissive AI vendor is precisely why this column is most likely to be mistaken for settled. Perplexity in-app **U**; Perplexity output **leaving** the app (paid Substack, Discord, Sunday Scans) is an **R-shaped U**. OpenAI **U** (terms 403 to every fetch path) |
| **LIC-16** | Keys that look like capability and are not | **Bullflow** (RETIRED as a product; key still read), **Polygon-direct** (duplicate of Massive, one backfill call), **Unusual Whales** (half-dormant) | **KP-only.** F-09: *"the clearest cases in the ledger where KEY-PRESENT is evidence of history, not of either access or right."* Governed by the OI-04 **DEFAULT-APPLIED** above. ⛔ Never list any of these as a UCT capability |
| **LIC-17** | Four content sources the product depends on and nobody has read the terms for | **EarningsWhispers** (scrape), **openinsider.com** (scrape), **Stocktwits**, the **logo chain** (logo.dev 429 on the one terms fetch; a publishable token literal in source) | **Class F — never researched by any leaf.** Also: **Buffer** and the second **YouTube** consumer in `uct-clips`, and **Pixabay/Wikimedia** static assets |
| **LIC-18** | The distribution layer the Desk library physically lives on | **YouTube** (one OAuth credential **shared with `uct-clips`**), **Zoom**, **Discord**, **Substack**, **Whop** | The Desk's videos are **on YouTube**, not on UCT infrastructure; `DESK_PUBLIC_SHOWS` decides whether a paywalled session becomes a searchable public video, and the same credential publishes from a second repository. ⛔ An "accumulated video library" whose bytes live in a third party's account is a **distribution dependency**, not an owned asset |

### 3.1 The two sentences this class exists to prevent

1. **"Our options flow / dark pool / screener is a differentiator."** The *presentation* may be. The
   *data* is Massive's and Finviz's, one of them at an unknown tier and the other with no terms
   document in existence. F-09's headline finding is Massive concentration — **20 of 29 derived
   products** — and the correct reading of that is dependency, not depth.
2. **"We have 39 years of breadth history."** UCT has a 15,897-row file it downloaded. See LIC-14.
   ⛔ This sentence is the one most likely to end up on a landing page, because the number is true and
   the implication is false.

---

## 4. CLASS 4 — CLAIMED, NOT EVIDENCED · the quarantine

⛔ **Nothing here is dropped and nothing here is disproved.** A quarantine row is an advantage sentence
this programme asserts (or would like to) that cannot be traced to an artifact reachable from this box.
Each row states **the claim**, **why it is quarantined**, and **the single read or answer that would
settle it**. Several rows have a BUILT counterpart by the §0.2 rule — the machinery is evidenced, the
moat is not.

| ID | The claim | Why it is quarantined | What would settle it |
|---|---|---|---|
| **CLM-01** | "The Desk video library is an accumulated content asset." | The only figure that exists is **"~300 rows"**, and it is an **in-file CLAIM** in `api/services/ticker_mentions.py`'s docstring describing `education_service`'s idiom — not a count of anything. It is also ambiguous between *videos* and *mentions*. `/data/education.db` is on the production volume. ⚠️ And per LIC-18 the bytes live in YouTube's account | One read-only `SELECT COUNT(*)` on `edu_videos` and on the `ticker_moments` expansion, plus a distinct-ticker count. Machinery: BLT-10 |
| **CLM-02** | "The `#main-chat` ticker-mention corpus is a community-data moat." | **Two independent reasons.** (a) Volume: `/data/buzz.db` `mentions` is unreachable; D-13 marked it NOT DETERMINED and nothing has changed. (b) ⛔ **Product attribution** (§0.7): `api/services/buzz_ingest.py:25` names the channel `#main-chat, Uncharted Territory` — the **parent brand's** server — and this pass could not establish whether that audience is UCT Intelligence's, the Whop product's, or both. By design the store holds **no message text**, so even at volume it is counts, not commentary | (a) `SELECT COUNT(*), MIN(ts), MAX(ts), COUNT(DISTINCT ticker) FROM mentions`. (b) an owner statement on which product the server belongs to. Machinery: BLT-13 |
| **CLM-03** | "This signal has fired N times, and here is what happened." | `signal_ledger.db :: signature_signals` is append-only with an immutable `first_seen_at` — an excellent design (BLT-03) over a store whose **depth is unmeasured**. D-13 raised this as its own open question and it is still open | `SELECT indicator, version, COUNT(*), MIN(first_seen_at) FROM signature_signals GROUP BY 1,2`. That one query decides whether a "signal track record" surface is shippable this quarter |
| **CLM-04** | "Dark-pool all-time records are an accretive asset that grows for free." | The mechanism is real and genuinely accretive — `darkpool_records` only ever grows while `darkpool_trades` is pruned to ~120 trading days — but **how many tickers carry a record and how far back the oldest reaches are both unmeasured**. ⚠️ The prints themselves are Massive's (LIC-03), so only the *record table* could be UCT's | `SELECT COUNT(DISTINCT ticker), MIN(<record date>) FROM darkpool_records`. Also: `DARKPOOL_RECORDS_ENABLED` — **flag state not read** |
| **CLM-05** | "Years of daily 40+-metric breadth snapshots." | ⛔ **This is the row most likely to be believed and least evidenced.** `/data/breadth_monitor.db` is unreachable and `C:\data` was not read. The only breadth numbers derivable from this box are the KB's `market_breadth` at **142 rows** and a **public-source** sentiment CSV (LIC-14) whose depth is not UCT's. So "years" is a claim about a file nobody in this programme has counted | `SELECT COUNT(*), MIN(date), MAX(date) FROM <snapshot table>` on `breadth_monitor.db`. Until then, quote 142 or quote nothing |
| **CLM-06** | "The catalysts history is an accumulated intelligence asset." | `catalysts.db` is declared **indefinite retention** — which is a *policy*, not a volume. Unreachable. ⚠️ It also **retains tweets past the 7-day window** the tweet store enforces (RG-21), so part of its depth is a compliance exposure rather than an asset | `SELECT COUNT(*), MIN(market_date), MAX(market_date), COUNT(DISTINCT ticker) FROM catalysts` |
| **CLM-07** | "The Wisdom Loop corpus is a proprietary extraction asset." | ⭐ The **machinery is the most substantial thing this pass found** (BLT-15: 111 modules, 32-table schema, six mounted routers) but it is **ADMIN-MOUNTED with no member route**, its store is `/data/wisdom.db`, and every volume figure available is a **CLAIM in a programme state document**, not a measurement: `docs/wisdom/SESSION-STATE.md` records a first real extraction run on 2026-09-19 producing **338 records** (44 MARKET_SIGNAL / 143 MENTION / 151 PRINCIPLE) which is *"permanently stuck at `stability=NULL`"* and is described there as *"a known, accepted, non-recoverable loss"*, and elsewhere **882 kept records of which 763 were never scored**. Derived from git this pass: golden set v1.1 = **170 records**, setup vocabulary v1 = **32 entries / 10 maps**, **6** authors, **28** Discord channels. Master switch `WISDOM_INGEST_ENABLED` — **flag state not read** | `SELECT COUNT(*) FROM wisdom_records` (and `wisdom_principles`) on `wisdom.db`, plus the flag. ⛔ Note the corpus inherits CLM-19's attribution question for any Discord-sourced segment |
| **CLM-08** | "The Floor gives us proprietary community content." | `/data/community.db` (14 tables) unreachable; volume NOT DETERMINED. ⚠️ Plus the §0.7 attribution question, and ⛔ **no backup rail exists for member posts** (TD-28), which is the opposite of an accumulating asset | A row count per board space, and a backup decision |
| **CLM-09** | "The Model Book is a curated library of the best stocks in history." | `/data/modelbook.db` unreachable: years covered, stocks per year and setups labelled are all unknown. Its engine-side cousin is ACC-14's **18 rows**, and **the relationship between the two libraries is NOT DETERMINED** | `SELECT COUNT(*) FROM modelbook_stocks`, `…_setups`, `…_setup_examples`, plus a ruling on which library is the authority |
| **CLM-10** | "Member notebooks and journals are a data asset." | Volume unreachable **and** — more decisively — **it is not the firm's asset**: every `j2_*` index is `(user_id, …)` and `api/routers/journal_two.py:4` states every `/api/j2/*` route scopes by `user_id`. Broker-synced positions mirror the member's brokerage exactly (a "dust filter" was explicitly rejected) | Nothing measurable would promote this row. The blocker is consent and scope, not volume — and LIC-10 forecloses the obvious cross-member product |
| **CLM-11** | "Members use these assets." | ⛔ **DE-SCOPED BY THE OWNER 2026-09-26** (*"Dont worry aobut anything else on costs or uses."*) — recorded, not analysed, and not dropped. Independently it was never available: ~26 production accounts, **13 with any page-view row**, six of those the roster admins; one account moves any rate by 3.85 points; gate item 13 calls its own figures *"a listing, not a statistic"*. ⚠️ The §1 `CONSUMED` column is **not** this row — it is a wiring fact (does a route read the store?), which is a code observation and in scope | Nothing this programme should spend effort on. ⛔ The consequence to keep: an ACC row's `MEMBER-WIRED` value means a route exists, and this document **never** upgrades that to "a member opened it" |
| **CLM-12** | "8,500+ entry knowledge base", "150 top trading books", "200 top trading YouTube channels", "100 Top Traders". | Marketing-register claims. `C:\Users\Patrick\uct_intelligence\CLAUDE.md` carries the last three and the measured KB contradicts them: **12** YouTube transcript intakes and **~25** attributed traders. The "8,500+" figure (also in the dashboard's own `CLAUDE.md` and carried into `capability-ledger.md` K6) **understates**: measured **9,797**. ⛔ These are the sentences that end up on a landing page | Nothing — they should be corrected or deleted at source. Marketing copy must be derived from §1, not from repository READMEs |
| **CLM-13** | "Our proprietary content is why someone pays $200/month." | ⛔ **DE-SCOPED BY THE OWNER 2026-09-26** — kept as a quarantine row so the sentence is not silently adopted, with **no pricing or willingness-to-pay analysis carried** (§0.4 #1, #3). Two guards only: the **price is settled and not in question** ($200/mo or $2,000/yr, owner-ratified), and the cost model's **"~$30/month comparable floor" is a COMPETITOR comparable**, never UCT's price | Out of scope by owner instruction. If it is ever re-opened, the missing evidence is member testimony attributed to a named surface, not a number |
| **CLM-14** | "The per-ticker history join is an uncontested differentiator." | The **trails are measured** (ACC-02, ACC-03, ACC-04, ACC-06, ACC-09, plus CLM-01 and CLM-19) but **the join does not exist**, and D-13's own confidence note says the absence of a unifying surface *"is an inference from not finding one"*. ⛔ Whether AI Search already retrieves across the wire archive and Desk transcripts for a ticker query is **NOT DETERMINED** and is D-12's territory | Read `api/services/ai_search_*` (12 modules) for cross-trail retrieval. If it already does part of this, the recommendation changes shape rather than scope |
| **CLM-15** | "The Qullamaggie transcript material is usable in a paid product." | **876 attributed rows** from **12** YouTube transcript intakes sit in the KB — and therefore **inside the Brain Pack shipping to Railway**. D-13 raised the licensing basis as an open question; F-09/F-04 never classified it | An owner/legal answer on third-party transcript use in a paid product. Until then these rows are the commodity half of ACC-01, not the defensible half |
| **CLM-16** | "The trading-room export can be used in a member-facing surface." | F-04 **T-85 / ESC-16: U — member consent basis unresolved**, and 591 rows are already inside the shipping Brain Pack. The export contains **message text and author ids**, unlike the deliberately text-free buzz store | The consent basis, and whether it extends from an internal RAG to a member-facing surface |
| **CLM-17** | Any growth rate for any accumulated asset. | Two dated measurements exist (D-13's 2026-09-02 and this pass's 2026-09-26) and **two points do not establish a rate**. §6.2 states the increments as increments over a named interval and deliberately does not divide by anything | Three or more dated measurements of the same table, or the engine's own write cadence read from its scheduler |
| **CLM-18** | "The curriculum is the asset most ready to become a product." | The content is measured (ACC-13) and the readiness claim is D-13's judgement, which this pass agrees with and cannot evidence: **the content is in git and in no product DB**, no member surface reads it, and the README leaves **two owner decisions deliberately open** (the setup-catalog count and the 0–150 regime band thresholds) that a shipped course would have to state | A member surface reading `docs/curriculum/*`, and the two owner decisions |
| **CLM-19** | ⛔⛔ "The 7,766-message classified trading-room corpus is UCT Intelligence's deepest moat." | **The measurement is sound and the ownership is not.** Derived this pass: **7,766** classified messages (5,572,488 bytes), `timestamp` **2024-03-11 → 2026-02-20**, each row carrying `tickers[]`, `message_type` and `classification_confidence`; derived `trading_rules.json` = **50 rules / 27 entry / 30 exit / 20 sizing / 20 process**. ⛔ But it is a **trading room**, classified into `trade_entry` / `trade_exit`, and the Whop plan **is** a live-trading Discord (§0.7) — so this pass could not establish which product it belongs to. Per §0.7 the class is withheld rather than guessed. Two further reasons it would not be a clean moat row even if attribution resolved: it is **frozen at 2026-02-20**, and the RAG that reads it is Discord bot #1 whose **runtime is NOT DETERMINED** (RG-19) | An owner statement on which product's room was exported. Then CLM-16's consent question. Then a decision on whether it is refreshed past 2026-02-20 |

### 4.1 The two quarantine rows that should be read first — and why the ranking changed

⭐ **Under the aggregation thesis (§0.0) the quarantine's centre of gravity moves.** A differentiation
reading would put CLM-11 (consumption) first, because it decides whether a moat is a warehouse. But
usage is de-scoped and coverage is the binding constraint, so the rows that matter most are the ones
where **an assumed asset is really an unscheduled coverage hole**:

**CLM-19 (product attribution) is the most expensive single unknown.** One owner sentence either
restores the deepest-reaching data in the inventory to the moat class or puts it permanently outside
this programme's boundary. It costs an answer, not a measurement — and until it is answered, a plan that
leans on "two years of trading-room history" may be leaning on a different product's asset.

**CLM-07 (the Wisdom Loop corpus) is the largest unmeasured investment.** 111 modules, a 32-table
schema and six mounted routers exist; the corpus behind them is a figure in a programme state document
(338 records, of which the run is recorded as a *"known, accepted, non-recoverable loss"*), and every
route is admin-only. ⛔ Under an aggregation thesis this is the sharpest shape of risk in the document:
**capability that ships at admin level reads as coverage and serves no member.**

⚠️ And the reason CLM-11 still sits in the quarantine rather than being deleted: five of fourteen ACC
rows reach **no member surface at all** (§5.1). That is a *wiring* fact, in scope, and it is the honest
residue of the consumption question after the usage half is de-scoped.

---

## 5. CLASS COUNTS — derived over the finished file, not typed

⛔ A count of the classes, typed beside the tables it describes, would be this document committing the
defect §0.3 exists to prevent. So it is derived by pattern over the finished file:

```bash
for p in ACC BLT LIC CLM; do
  printf "%s %s\n" "$p" "$(grep -cE "^\| \*\*${p}-[0-9]{2}\*\* \|" \
    docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md)"
done
# duplicate-id check (must print nothing):
grep -oE "^\| \*\*(ACC|BLT|LIC|CLM)-[0-9]{2}\*\*" \
  docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md \
  | sort | uniq -d
```

| Class | Rows | Share of the inventory |
|---|---:|---|
| **ACCUMULATED** (the moat) | **14** | the smallest class, and the only defensible one |
| **BUILT** (real, replicable) | **20** | the largest single class — most of the product is this, as expected |
| **LICENSED** (somebody else's) | **18** | every one of them switchable off by a third party |
| **CLAIMED, NOT EVIDENCED** (quarantine) | **19** | larger than the moat class, which is the finding |
| **Total rows** | **71** | |

⭐ **The shape is the headline.** The quarantine is bigger than the moat. Nineteen advantage sentences
this programme either asserts or would like to assert cannot be traced to an artifact from this box,
and **nine of them are blocked by a single read-only `SELECT COUNT(*)` against the production volume**.
That is not a research gap; it is a short job for whoever holds the Railway session, and it is the same
recommendation D-13 made on 2026-09-02 that has not been actioned in 24 days.

⛔ **Under the aggregation thesis the second-largest class is the one to worry about, not the smallest.**
Eighteen LICENSED rows are eighteen capabilities a third party can switch off, and an aggregator is
defined by the breadth of what it serves — so LIC is a **dependency and permission** ledger for the
goal itself, not a footnote to the moat. ACC being the smallest class is expected and is not a problem
to fix; **LIC-06 (no terms document exists at all) and LIC-08 (no purchasable remedy at any price) are
problems to fix.**

⚠️ **A derived count is not a neutral fact either.** These totals are a function of how finely a row was
split, and the splitting was mine. A reader who merges ACC-04's three tables into one row, or splits
LIC-15's three AI vendors into three, gets a different total. The totals are therefore useful for
*shape* — quarantine > moat, built > accumulated — and should not be quoted as measurements of the
product.

### 5.1 The consumption census, also derived

```bash
for s in MEMBER-WIRED PRODUCER-ONLY NO-SURFACE-FOUND; do
  printf "%s %s\n" "$s" "$(grep -cE "^\| \*\*ACC-[0-9]{2}\*\*.*${s}" \
    docs/terminal-research/05-product-strategy/proprietary-advantage-inventory.md)"
done
```

The census over the fourteen ACC rows: **`MEMBER-WIRED` 6 · `PRODUCER-ONLY` 3 · `NO-SURFACE-FOUND` 5**,
summing to 14. ⚠️ **That the three values sum to the row count is itself the check** — an ACC row whose
`CONSUMED` cell matches none of the three tokens would make the census silently short, and one did on
the first assembly of this file and was corrected before it shipped.

**Five of fourteen ACCUMULATED rows are `NO-SURFACE-FOUND`** — ACC-02 (the decision record, the
strongest row in the document), ACC-06, ACC-08, ACC-10 and ACC-13. ⛔ And for the six that are
`MEMBER-WIRED`, that means *a route reads it*, **not** that anyone walked through the door (CLM-11 —
usage is de-scoped, so this column is deliberately a wiring census and nothing more).

⭐ **Under the aggregation thesis (§0.0) this census is the most useful thing in §5.** An asset that no
route reads contributes nothing to "you never need the other tab", however defensible it is. Five rows
of measured, irreplaceable material are in that state.

---

## 6. WHERE THE CAPABILITY LEDGER UNDERSTATES WHAT SHIPS

`01-existing-system/capability-ledger.md` carries a staleness banner recording that **six of six cells
checked against code were wrong, every one understating what ships**, and instructing the reader not to
treat an "absent" cell as evidence of absence. This pass checked further, in the rows that touch
proprietary assets. The banner's direction mostly held — and **once it reversed**, which matters.

### 6.1 Coverage gaps — capabilities with no row at all (the `entity_master` shape)

⭐⭐ **1. The Wisdom Loop ships and the ledger has no row for it — and this is an order of magnitude
larger than the entity-master gap the banner already records.** Measured at `origin/master` this pass:

* **111 files** under `api/services/wisdom/` (`git ls-tree -r --name-only origin/master -- api/services/wisdom | wc -l`), in six packages (`core, capture, sources, extract, evals, publish`).
* A **32-table** schema contract, `docs/wisdom/contracts/wisdom-db-v0.sql`.
* **Six routers** (`api/routers/wisdom_{core,capture,sources,extract,evals,publish}.py`) included
  **unconditionally** — `api/main.py:8865-8867` iterates `wisdom_registry.routers()` and calls
  `app.include_router` on each.
* The store is **initialised at boot** with migrations applied (`api/main.py:3480-3482`) and **jobs are
  registered** (`:6351-6353`), deliberately "unconditionally, in their own try", with the master switch
  re-read per run so a job can be turned off without a deploy.
* ⚠️ **State, precisely: ADMIN-MOUNTED.** `api/routers/wisdom_core.py:25` is
  `APIRouter(prefix="/api/admin/wisdom/core")` and its module header states *"Every route, reads
  included, carries Depends(require_admin)"*, with owner-private routes on `require_owner`; the
  internal half is `require_push_secret`. **There is no member route.** That is materially different
  from absent **and** materially different from populated-and-serving-members.
* ⛔ **Populated is a third, separate question and this pass cannot answer it.** `WISDOM_DB_PATH`
  defaults to `/data/wisdom.db`. Row count unmeasured (CLM-07). `WISDOM_INGEST_ENABLED` — **flag state
  not read.**
* The word "wisdom" appears **zero times** in the capability ledger
  (`grep -c wisdom capability-ledger.md` → 0).

**2–6. Five measurable accumulated stores have no ledger row either.** Each `grep -c` over
`capability-ledger.md` returns **0**: `wire_universe`, `leadership_snapshots`, `voice_profile` /
`voice_exemplars`, `coaching_notes`, `ep_follow_throughs`, `trigger_performance`. ⛔ **The strongest
ACCUMULATED asset in this document (ACC-02) is invisible to the ledger.** `voice_profile` is the sharpest
case: ledger row M7 names the directory `morning-wire/data/{sent,snapshots,voice}/` in passing and never
measures what is in it, so a 24-metric quantified model of a named human's prose reads as a folder.

⭐ **The cause, and why it matters beyond these six.** The ledger's unit is the **capability** — a
surface with a user, a gate and a route. A *store with no surface* has no home in that taxonomy, which
is exactly the shape of ACC-02, ACC-06, ACC-08, ACC-10 and ACC-13. **So the capability ledger cannot be
used as an inventory of accumulated assets, and a reader who treats its silence as absence will
conclude UCT has no decision record.** This is the same failure mode the banner describes for
`entity_master` ("a coverage gap is the harder kind to notice, because nothing is written down to be
wrong") — generalised, and with a cause named rather than a list of instances.

### 6.2 Superseded cells — numbers the ledger states that have moved, all understating

Every figure below is a ledger cell beside a value derived this pass. ⚠️ The pairs also constitute the
**measured increment** referred to in §1.1 and CLM-17 — an increment over the interval
**2026-09-02 → 2026-09-26**, which is *not* a rate and must not be annualised.

| Ledger cell | What it states | Derived 2026-09-26 |
|---|---|---|
| K6 (Brain Bridge) | "engine KB **9,605** rows, 48 templates" | `knowledge_base` **9,797**; `setup_templates` **48** (unchanged) |
| N3 (UCT 20 / the Book) | "`book_plans` **420**, `book_ledgers` **26**, `setup_triggers` **243** (**47 W / 81 L**)" | **760**, **58** (29/29), **540** (**134 W / 151 L / 168 never_triggered / 85 open / 2 unresolved**) |
| N1 (Morning Wire) | "snapshots on the PC (**28 files**, 2026-07-21→)" | **44** snapshots, 2026-07-21 → 2026-09-25; plus **26** sent letters and **78** review files |
| H6 (Market regime) | "engine `market_regimes` (**148** rows …)" | **165** rows, 165 distinct dates |
| L3 / `CLAUDE.md` (Desk creative titles) | the title register is "**~80** harvested 8/20" | `desk_assets/qullamaggie_register.txt`: **97** lines, **93** non-blank non-comment |
| `CLAUDE.md` Compass Brain Bridge | "**8,500+**-entry KB" | **9,797** — see CLM-12 |
| D-13 §1 (the raw pass, for completeness) | `wire_universe` 19,050 · `leadership_snapshots` 4,440 · `coaching_notes` 527 · `ep_follow_throughs` 10,808 · `ep_candidates` 447 · `trigger_performance` 33 · `setup_performance` 21 · `wire_issues` 43 · `earnings_analytics` 40,731 · `news_archive` 22,562 · `market_breadth` 125 · db 82,718,720 B | **22,574 · 5,120 · 619 · 12,257 · 506 · 54 · 23 · 60 · 42,976 · 27,243 · 142 · 95,686,656 B**. `setup_templates` 48, `model_examples` 18 and `wire_prompt_config` 26 are **unchanged**, which is itself informative: the authored artifacts are static while the recorded ones accrete |

### 6.3 ⛔ One place the direction REVERSES — and it corrects the banner's own generalisation

**Ledger row A8 (ticker search) states `cap_universe.json (3,742)`. Measured at `origin/master` today,
`len(json.loads(...))` over `api/data/cap_universe.json` returns 3,640** — a plain JSON list. D-13
separately measured the *wire payload's* `cap_universe` key at **3,721**. So there are now **three
values**, and the current file holds the **smallest** of them.

⛔ **This is not a resolution and §7 carries it unresolved.** What it does settle is a methodological
point: the banner says *"four for four"* and then *"six for six … still every single one in the same
direction"*. On the seven cells this pass checked, **five understated, one overstated, and two were
exactly right** (G6's 25-measured/3-published and H9's taxonomy v4.22.0 / 112 themes / 12 sectors /
2,029 holdings, both re-derived and unchanged). ⭐ **The safe reading is therefore weaker and more
useful than the banner's: a ledger cell is a dated measurement, and its error has no reliable sign.**
"It always understates" would license reading a small number as a floor, and A8 shows that is wrong.

### 6.4 Line numbers drift even when the finding holds

The banner cites `api/main.py:107` (import) and `:8707` (include) for the entity master. Verified
independently at `origin/master` this pass: the import is at **`:125`** and the include at **`:8830`**.
The *finding* is correct and the *coordinates* moved — the same defect class as a typed count beside a
moving file. For the record, the entity master's own state is **ADMIN-MOUNTED**: an `entity_figi` table
(`schema.py:78-85`), a reconciler that writes entities (`reconciliation.py:164-211`), and an
admin-only router at `/api/admin/entity-master/*`. **Whether it is populated is unmeasured**, and
whether a member ever sees it is answered by the prefix: no.

---

## 7. CONTRADICTIONS CARRIED, NOT RESOLVED

Per the programme's standing instruction, and because gate item 13 left the first two open on purpose:

1. **The published-post count — now three values, not two.** `voice_profile.json` reads `posts_total`
   **88** (27 articles + 61 Sunday Scans); D-13 §11 states **92** (65 Sunday Scans + 27 articles); the
   newest archive snapshot in the same series measures **96** (69 + 27) this pass. All three are
   derived from real files. ⛔ **Not resolved here.** What this pass adds is the **shape** of the
   series: the snapshots grow one Sunday Scan per week (61 → 62 → … → 69), and re-measuring the exact
   file D-13 read (`…2026-08-28.txt`) reproduces **65 + 27 = 92** precisely. That is consistent with a
   dating difference, but a consistent story is not a ruling, and it is the owner's or item 13's to
   make — not this file's.
2. **The universe size — also three values.** `capability-ledger.md` A8: **3,742**. Wire payload
   `cap_universe` key (D-13 §2a): **3,721**. `api/data/cap_universe.json` at `origin/master` today:
   **3,640**. ⛔ Not resolved. §6.3 states what it does and does not imply.
3. **The base-structure ledger: 30 versus 25.** RG-18 records that project memory says 30 structures
   while the ledger holds 25, and explicitly says *"F-05 reconciles from the file"* — which is this
   file's job, so: **the file is the authority and it holds 25 structures with 3 published**, derived
   at `origin/master` today (`len(b["structures"])` and the `published` filter). ⚠️ **What is not
   settled** is whether five structures were measured somewhere this pass did not look; D-13 listed
   that as its own unreached gap and no second ledger file was searched for here. So: the number is
   25; the *reason* memory says 30 is NOT DETERMINED.
4. **`ticker_mentions`' "~300 rows" is ambiguous in kind.** The docstring says "small library (~300
   rows)" while the module produces "one row PER MENTION". Videos or mentions is undecided, and
   neither figure is measurable from here (CLM-01).
5. **`OWNER_SEED_FACTS.md:61` splices two products into one sentence** — a UCT Intelligence tier
   statement and the Whop product's promo price. The pricing question itself is settled (§0.4 #3) and
   the boundary rule is §0.7; the spliced *source line* is recorded here because anything else reading
   it will inherit the same error this pass initially did.
6. **Whether the ~750 community-member figure counts the Whop audience, UCT Intelligence's, or a
   union** is open (§0.7). No row in this document reasons from community size.

---

## 8. WHAT THIS DOES AND DOES NOT DECIDE

⛔ **This document does not score, rank or sequence anything.** Prioritisation is gate item 17's, and a
class is not a priority: BLT-01's lift harness is more commercially useful today than ACC-06's 12,257
follow-through rows, and it is still the replicable class.

⛔⛔ **And it does not decide whether the goal is met.** The goal is **aggregation — "so someone can
only use our site instead of the others"** (§0.0), so the binding constraint is **coverage**, and
coverage is measured by the capability matrix, the best-of-breed work and item 16's 85-item backlog.
**Nothing in §1 closes a missing-capability hole.** The correct relationship is: *gaps decide whether
the goal is reached; §1 decides whether it can be taken away afterwards.* A reader who treats
proprietary depth as a substitute for coverage has inverted the thesis. ⚠️ And the ceiling on full
substitution is structural, not a feature gap: the standing default of **no execution and no order
management** means a member who trades still opens a broker, which bounds substitution to research and
analysis unless the owner revisits that default. Reported; not resolved; nothing proposed.

What the sort *does* decide is narrower and firmer:

1. **A moat argument may cite only §1**, with the row's measurement and its `CONSUMED` state attached,
   and never a §3 row.
2. **Any §3 row named in a positioning claim must name its dependency in the same sentence.** LIC-14
   is the trap: the number is true and the implication ("UCT has 39 years of history") is false.
3. **Any §4 row used in a plan must carry its settling read**, and nine of the nineteen are one
   read-only `SELECT COUNT(*)` away from leaving the quarantine.
4. **The highest-value non-engineering action available** is the bounded production count sweep D-13
   recommended on 2026-09-02: it would move CLM-01, CLM-02(a), CLM-03, CLM-04, CLM-05, CLM-06,
   CLM-07, CLM-08 and CLM-09 out of the quarantine in one pass. **The highest-value non-measurement
   action** is one owner sentence on CLM-19's product attribution.
5. **The single most consequential gap between what is defensible and what is shipped** is ACC-02:
   most defensible row, `NO-SURFACE-FOUND`.

---

## GAPS — what this pass did not reach

* **Every production row count**, unchanged from D-13 and by a stricter rule: `/data/*.db` is
  unreachable and `C:\data` was **not read at all** this pass. Nine of the nineteen quarantine rows
  exist for this reason alone.
* **Consumption, for everything** (CLM-11). No analytics were consulted, and none may be.
* **Every flag state.** No Railway command was run. `BRAIN_TOOLS_ENABLED`, `BRAIN_PACK_ENABLED`,
  `WISDOM_INGEST_ENABLED`, `PATTERN_VISION_ENABLED`, `DARKPOOL_RECORDS_ENABLED` and
  `DESK_PUBLIC_SHOWS` are each named at the row that depends on them, with the state unread.
* **`api/services/ai_search_*` (12 modules) and the voice lane (~70 modules)** — D-12's territory, and
  the reason ACC-02/ACC-06/ACC-08/ACC-10's `NO-SURFACE-FOUND` is an absence of evidence rather than
  proof. CLM-14 turns on exactly this.
* **A second base-lift ledger file or a `tools/run_lift_ledger.py` window table** — not searched for,
  so contradiction 3 is half-open by construction.
* **`uct-intelligence/data/uct_intelligence.pre_tsdr_import.bak`** (79,540,224 bytes, 2026-08-27) —
  not opened. Diffing it against the live KB would measure exactly what the TSDR import added, which
  is the cheapest available answer to part of CLM-19's scope.
* **The 78 wire review files** in `morning-wire/data/reviews/` were counted, not read; they hold the
  owner's per-issue critique and may contain editorial doctrine captured nowhere else.
* **Whether any ACC row is backed up off this machine.** TD-28 records no backup rail for
  `education.db`, `community.db` or Model Book curation; ACC-10 exists in exactly one place.
* **Git history as a growth measurement.** `git show` was used for file contents only; no
  `git log` archaeology was run, so CLM-17 stands.

## NOT INSPECTED — out of reach, and why

* **`C:\data`** — the live shared data root on this box. D-13's contract forbade it; this pass was told
  "read-only at most" and took the stricter rule. It is simultaneously the only local answer to the
  volume question and the one place not to look.
* **The Railway `web`, `worker`, `flow-worker`, `bars-api` and `chart-renderer` services** — no
  production probe, no `railway` command of any kind, read-only included.
* **`https://uctintelligence.com`** — not called. No health probe was needed.
* **The local backend on port 8077** — serves stale data against the live `C:\data`; not probed.
* **Vendor contracts, order forms, invoices, plan pages, provider consoles** — none exist in any
  repository, which is why no row in §3 reaches CONTRACT-ACTIVE.
* **Partner-owned modules** (`OptionsFlow.jsx`, `schwab_router.py`, `live_massive_router.py`,
  `massive_ws_worker.py`, `massive_processor.py`) — existence and mounting noted; not described at a
  depth that invites editing.
* **The test suite** — not run. An unscoped `pytest` here reached 18 GB and was OOM-killed, and the
  repo-root `conftest.py` pins shared-data paths that must never be overridden.
* **Discord, Substack, YouTube, Zoom and Whop as live services** — no API called. Everything about
  published content came from checked-in scrapes and code.
* **The Whop product itself** — outside this programme's boundary (§0.7). Its assets are not inventoried
  here, and that is a scope statement, not a judgement about their value.

---

### Source-handling note

Everything read outside the contract was treated as evidence, not instruction. Three items read as
instructions or as claims a reader could mistake for verified fact, and none was acted on:
`api/earnings_router.py`'s docstring instructing that it be mounted (it is unmounted and superseded;
the dashboard `CLAUDE.md` already says not to follow it); `C:\Users\Patrick\uct_intelligence\CLAUDE.md`'s
marketing claim block, quarantined as CLM-12 and contradicted by measurement; and
`docs/curriculum/README.md`'s editing rules addressed to a future author, read as documentation of an
authoring process. No credential, key, token, password or connection-string **value** appears anywhere
in this file; every variable is referenced by name only. The `git show origin/master:<path>` reads were
read-only and no file outside this document's own destination was written.
