---
id: F-06
title: Day 1 Executive Synthesis
role: Executive synthesizer (deliverable 2 of 2) — closes program Day 1
wave: 2
group: F
category: synthesis
scope: Genuine synthesis across every accepted Day-1 artifact — control files, the 40-question scoreboard, the hypothesis register, the existing-system map and ledgers, the provider and licensing registers, the two cost models, the Bloomberg and Gödel dossiers, the eleven leaf dossiers, the C-wave domain pods (AI tools, grounding, workspaces, command grammars, personalization, news, symbol/time, data platform) and the TERMINAL-CURRENT map. Twenty-one required sections plus emerging product-philosophy candidates (Part CCXLIX) and the Frankenstein temptations (Part CCXLVIII).
confidence: 🟡 overall — 🟢 where the underlying artifact is 🟢 and this file only restates it; 🟡 wherever this file draws a conclusion across artifacts; 🔴 on every owner-bound fact (OI-01, OI-03, OI-06, OI-08, OI-10, OI-12, OI-15) and on every competitor claim that no role observed running
evidence_ceiling: "This file inherits every ceiling of its inputs and adds none of its own. Three ceilings dominate. (1) NO PRODUCT IN THE BENCHMARK SET WAS OPERATED WITH A SEAT — every competitor behaviour cited here is a vendor's own documentation, and every performance figure is claimed or reported. (2) NO OWNER INPUT HAS BEEN ANSWERED — the licensing register's 81 Restricted rows, the desk's daily loop, the production tier mix, the AI spend, and the Massive plan tier all wait on OI-01/03/06/10/12/15. (3) NOTHING WAS OBSERVED IN PRODUCTION except the read-only unauthenticated GETs that confirmed R-17; the local backend on :8077 is never truth and C:\\data is forbidden. What would raise this file: one observed desk morning, two owner facts (OI-03a, OI-03b), and one telemetry read (`page_views`, `calendar_seen`, `calendar_alerts_fired`, `ai_search_log`)."
sources: 33 internal accepted artifacts read in full this pass (listed under NOT INSPECTED / SOURCES); 0 external fetches (this role fetches nothing)
uct_relevance: high
status: draft
date: 2026-09-02
---

# Day 1 Executive Synthesis

**What this is.** The document that closes program Day 1. It is not a concatenation of the
artifacts under `docs/terminal-research/`; it is the reading across them. Where an artifact
already states a fact, this file cites it and does not re-derive it. Where two artifacts
disagree, §13 says so. Where the evidence runs out, §3, §17 and §18 say where and why.

**How to read the confidence marks.** 🟢 = at least one accepted artifact establishes it from
primary evidence and no other artifact contradicts it. 🟡 = established but with a named
ceiling, or a conclusion this file draws across artifacts. 🔴 = owner-bound, unobserved, or
contradicted. The marks are the program's convention and are the only non-text glyphs used here.

**Vocabulary.** TERMINAL-CURRENT is the existing `/calendar` surface (display-named
"UCT Terminal" on 2026-09-01, plumbing unchanged). TERMINAL-NEXT is the product being
designed. UT is the parent brand; UCT Intelligence is the product. Licensing classes A / LA /
R / U / X and the provider ladder KEY-PRESENT → CODE-REFERENCED → OBSERVED-CALLED →
CONTRACT-ACTIVE are carried exactly as the source artifacts state them and are never upgraded
here.

**The scoreboard this file synthesizes** (`13-executive-synthesis/executive-questions.md`,
accepted): **10 🟢 / 23 🟡 / 7 🔴** across 40 questions. Product 0/4/1 · Trading 1/2/2 ·
Research 2/3/0 · Data 3/1/1 · Engineering 2/3/0 · UX 0/4/1 · AI 2/3/0 · Business 0/3/2. The
seven reds cluster in three places: the desk's unobserved daily loop (Q8, Q10, Q26), the
commercial unknowns (Q18, Q36, Q37), and table stakes (Q2). Everything below is organised so
that a reader who trusts the scoreboard can see what produced it, and a reader who does not
can see what would change it.

---

## 1. What materially changed our understanding

Day 0 began with a seed set of facts and assumptions. Fourteen of them did not survive contact
with the evidence, and the fourteenth is the one that reorganises the rest.

**1.1 The paywall runs the other way.** The seed said the Morning Wire was paid. The code says
it is the *only* free page: `AuthGuard.jsx:112 FREE_PAGES=['/morning-wire']` (DECISION_LOG
DL-010, an instruction conflict resolved in favour of the artifact). Every persona assumption
built on "free dashboard, paid wire" inverts. 🟢

**1.2 The tick stream is Finnhub, not Massive.** The repository's `CLAUDE.md` claims Massive
carries the live tick stream. The provider ledger (`02-data-providers/provider-ledger.md`,
F-03b) finds the dashboard-side tick stream on Finnhub, with Massive under-used in five named
places (native chains and Greeks, splits and dividends, index snapshots, WebSocket ticks,
news). The claims document was wrong about the single most important real-time path. 🟢

**1.3 Vendor real-time data is served to anyone with the URL.** R-17 was CONFIRMED at
2026-09-02 08:05 UTC by unauthenticated read-only GETs: `/api/live-prices?tickers=SPY`,
`/api/snapshot/SPY` and `/api/movers` answer 200 without a session; `/api/gex/data` reaches its
handler (422 for a missing parameter, not 401). This is a production finding, reported to the
owner for a normal session, and it compounds R-14. 🟢

**1.4 Licensing is one binary written 38 times.** The 118-row register
(`09-security-licensing-cost/licensing-register.md`, F-04) holds 81 Restricted rows, but two
owner facts move most of them: OI-03(a) the Massive plan tier moves 38 rows; OI-03(b) the FMP
DDLA moves 19. If both are favourable, Restricted falls from 81 to 27, and 13 of the survivors
are fixable by engineering. The program does not have a licensing problem of 81 parts; it has
two questions for the owner and a residue of roughly fourteen genuine contract rows. 🟢 on the
arithmetic, 🔴 on the answers.

**1.5 The desk's workflows are not in the repository.** Hypothesis H21 ("desk workflows can be
reconstructed from the repo alone") is UNSUPPORTED (`hypothesis-register.md`, F-08). Q7 finds
eleven per-ticker doors and four histories that never join; Q8 and Q10 are 🔴 because thinkorswim
appears in no repository and the desk's 06:30–10:00 CT loop was never observed. Observation, not
grep, is the only instrument that answers the first-persona questions. 🟢 on the absence.

**1.6 The moat is decision provenance and first-party narrative, not data volume.** D-13
(`05-product-strategy/proprietary-asset-inventory-raw.md`) measures the estate: a knowledge base
of 9,605 rows at 57.7% first-party; `earnings_analytics` 40,731 rows; `wire_universe` 19,050 rows
across 43 issues; `leadership_snapshots` 4,440 rows over 134 dates and 1,038 symbols;
`setup_triggers` 243 rows (47 W / 81 L / 57 never / 57 open); 26 `book_ledgers`; a voice profile
of 88 posts and 120,055 words; a curriculum of 16 modules and 79 lessons. The uniqueness ranking
puts the *per-ticker history join* first, and then records that no such join exists anywhere in
the code. The differentiator is latent. 🟢 on the counts; 🟡 on the ranking.

**1.7 The estate is one process.** The system map (`01-existing-system/system-map.md`, F-03a):
a single-replica Railway `web` pod running one uvicorn with a 64-thread anyio pool, 1,187 routes,
143 APScheduler job ids, roughly 34 daemon threads, and 50–55 SQLite databases on one volume,
`auth.db` alone carrying about 110 tables from 16 modules with no migration framework. Four
other services (`worker`, `flow-worker`, `bars-api` new 2026-09-02, `chart-renderer`) plus the
owner's PC running 34 Task Scheduler jobs (21 producers) complete the topology. R-04 (fan-out)
and R-09 (PC as single point of failure) are not hypothetical. 🟢

**1.8 Four PC jobs are failing silently.** R-16: the flow-corpus archive has written nothing
since 2026-08-09 (about 17 sessions of OPRA tape unrecoverable); the breadth-live monitor has
returned "could not check" on 52 runs since 2026-08-10; two more are named by D-14. Each job
has one end-of-run heartbeat at best. 🟢

**1.9 The per-user AI caps sum to three times list price.** E-06
(`cost-model-ai-infra.md`): the per-user caps in production code sum to roughly $610–650 per
member per month; Compass chat has no population-level cap; `COMPASS_COST_CAP_DAILY` defaults to
0; six price authorities exist across the code and `catalyst/cost_guard.py:33` still carries
(3.0, 15.0). R-18. 🟢 on the code; 🔴 on actual spend (no ledger was readable).

**1.10 Bloomberg does not link panels by colour group.** The workspace survey
(`06-ux-and-information-architecture/workspace-systems-survey.md`, C5-01 §3) carries a correction
the program must propagate: no Bloomberg source documents colour-coded component groups; the
Launchpad identifier is a number plus a letter badge. The colour-dot idiom is Koyfin's (seven),
Benzinga's (bands), FDC3's (eight) and UCT's (four). Any downstream sentence reading "Bloomberg
links widgets by colour group" is unsupported. 🟢 on the absence in the sources reached.

**1.11 The AI-native research interface is retreating, not advancing.** The AI tools survey
(`08-ai/ai-native-tools-survey.md`, C6-01): Fiscal.ai dropped "Chat" from its name and sells an
MCP; Fintool was acquired by Microsoft and `fintool.com` 301s to Microsoft 365; Koyfin ships one
AI feature (transcript summaries); SpotGamma ships none; Gödel has none on its published
roadmap. Four benchmark products are simultaneously suppliers to Perplexity Finance. The
defensible position vendors are choosing is *being the tool an agent calls*, not owning the chat
box. 🟢 on the facts; 🟡 on the reading.

**1.12 UCT's grounding is stronger than any vendor's published posture on the producer side and
has nothing on the reader side.** The grounding pod (`08-ai/grounding-architectures.md`, C6-02
§9): UCT runs P2 (declared gaps), P3 (post-generation gate), P4 (facts-first verdict) and part
of P6 (configuration-as-answer), and runs no P5 (API-level citation spans) anywhere. The
reader-side gesture — click a number, see the row — is a wire format now (`search_result`
blocks with `kb://`-style sources), and half of it is a data-modelling job no citation API does:
a computed number with no addressable row cannot be cited by any mechanism. 🟢

**1.13 "Why is it moving" is the thinnest capability in the entire benchmark set.** Across
twelve products, C6-01 §3 finds one named first-class feature (FactSet's Security Explanation,
a product-page sentence) and one honest negative answer (Perplexity's "no major earnings or
corporate announcements driving today's price action"). Ten of twelve ship nothing. This is the
single largest unclaimed capability, and UCT already composes a multi-source catalyst thesis
per ticker with a `catalyst_at` timestamp. 🟢 on the absence.

**1.14 The hard part of a workspace is the document, not the grid.** C5-01 §7: six of the seven
failure modes a workspace suffers are persistence failures. UCT's own `parseLayout` returns
`null` on a malformed blob, the board renders `DEFAULT_LAYOUT` (an empty board
indistinguishable from a new user), and the autosave overwrites the original within 500 ms
(R-13). None of the seven libraries surveyed documents a schema-version field; versioning is the
application's job in every case; and the repo already ships four working versioning idioms,
none applied to the layout. The fixed/modular question the program inherited is the wrong
question; the right ones are "can a page become a panel and back" and "who owns the schema". 🟢

**The reorganising fact** is 1.6 read against 1.12 and 1.13. The desk's proprietary numbers are
the ones its AI cannot cite, and the question the whole market has failed to productise is the
one UCT's catalyst engine already half-answers. Every architecture implication in §12 follows
from that pairing.

---

## 2. What is now known with high confidence

Ten scoreboard greens, seven supported hypotheses, and a set of verified vendor facts.

**Scoreboard 🟢 (executive-questions.md).**
- **Q7** — eleven per-ticker doors exist, four histories never join.
- **Q14, Q15** — the research workflow's shape and its nine missing joins are established from
  code.
- **Q16** — Massive is under-used in five named places.
- **Q17** — the NO PROVIDER list is definite: Level 2, credit, FX/crypto bars, whisper numbers,
  consensus-revision timeline, short-interest history, per-broker estimates.
- **Q20** — eleven second-authority defects, breadth the sharpest.
- **Q22, Q23** — the eleven bottlenecks and the platform shape (§1.7).
- **Q32, Q33** — the hallucination map: report card 12/50 with rungs 3–5 at zero; fast lane
  13/30 with eleven retrieval misses; and the `--grounding-audit` that measures retrieval for $0.

**Supported hypotheses (F-08):** H6, H7 (provisional), H11, H14, H23, H29, H31, H35. The register
recommends carrying H14, H23, H29 and H35 into GOVERNING_PRINCIPLES as constraints, and this file
concurs (§16).

**Accepted artifacts that are 🟢 in their own frontmatter or on their load-bearing claims:**
- The system map's five-service topology, the 25 reconciliations R1–R25, and the PC job census.
- The capability ledger's 178 rows (168 active, 5 dormant, 2 deprecated, 2 duplicated, 1 absent).
- The tech-debt register's 72 entries, with TD-01–18 classified "Blocks Terminal".
- The TERMINAL-CURRENT map: 4 views plus `/calendar/mystocks`, 31 routes, a 12-panel modal in 5
  groups, 9 readers of `/api/calendar` (5 server-side bare `.get()`), 32 things that change if
  `/calendar` disappears (17 vanish, 7 degrade, 8 break), and the Wire CONFIRMED live by the
  2026-09-02 render ("1 reported name not shown yet: PANW").
- The licensing register's class counts and the two-fact sensitivity (§1.4).
- The provider ledger's 48 rows and the OBSERVED-CALLED ceiling: only FMP 🟢 and Finnhub 🟡 are
  observed called dashboard-side; zero rows are CONTRACT-ACTIVE.

**Verified vendor facts that anchor the benchmark reading (each from the vendor's own
documentation, fetched 2026-09-02 by the citing role):**
- LSEG Workspace: Eikon withdrawn 2025-06-30; AI Search GA 2026-06-23; "when data is presented
  in a table, each value carries its own citation"; licensed research is never summarised;
  real-time data is not supported in AI Search; a published Known-issues table at GA
  (`lseg-workspace/dossier.md` §I).
- TradingView: AI Screener public beta 2026-08-17, emits a finished screen with an Explanation
  panel, and "replaces any manually set filters" (`tradingview/dossier.md` §I).
- Unusual Whales: a documented alert formula language with `$ticker` / `@sector` / `#watchlist`
  scope prefixes and field-to-field comparison; an MCP server, a published `/skill.md`, and an
  endpoint whitelist; three retail tiers that differ in almost nothing but saved-object counts
  (`unusual-whales/dossier.md` §G, §H, §I).
- Massive (UCT's own bars vendor): the aggregates `adjusted` flag documents split adjustment
  only, says nothing about dividends, nothing about renames
  (`07-technical-architecture/domain-symbol-master-time.md`, C7-02 §3.1).
- NYSE publishes sessions and early closes three years ahead; `pandas_market_calendars` ships
  calendars as versioned code and separates holiday, early close and break (C7-02 §4).
- SpotGamma ships no AI, sells refresh cadence and model assumptions as the tier boundary, and
  publishes level hit rates without a base rate (`spotgamma/dossier.md` §I, §L, §J).
- Gödel: DL Software, $7M raised, $118/mo, no AI anywhere including its own roadmap, no
  self-serve API, charting delegated to TradingView, brokerage via SnapTrade (`godel/dossier.md`).

---

## 3. What remains genuinely uncertain

The seven scoreboard reds and the twelve Unknown hypotheses share a small number of causes.

**Cluster A — the desk was never observed (Q8, Q10, Q26; H21 UNSUPPORTED; OI-06).** The
program has a 1,187-route map and no map of the 06:30–10:00 CT morning. thinkorswim is in no
repo. Q26 (the desk's real navigation cost) cannot be scored from code because the code does
not contain the tools the desk opens by hand. Only an observed morning moves these, and it is
the single test the hypothesis register says moves the most rows.

**Cluster B — the commercial facts are owner-bound (Q18, Q36, Q37; OI-01, OI-10, OI-12).** No
provider spend, no AI ledger, no tier mix, no telemetry read. E-05 and E-06 are built on
labelled assumptions: an as-is stack near $830/mo, a fixed block of $3.5k–7k/mo that dominates
below about 1,000 members, per-member $0.58 delayed versus $3.13 real-time, break-even at 19–36
paying members at $200 list. Every one of those is a forecast until derived.

**Cluster C — table stakes cannot be decided without the workspace answer (Q2; H1, H5
UNKNOWN).** Q2 lists a workspace and a command surface as table stakes; the hypothesis register
holds both Unknown. C5-01 §6 could not find one vendor telemetry write-up or third-party study
on whether users customise — the only route that closes it is UCT's own `charts_workspace_layout`
table, which nobody has queried. R-07 (directive volume biasing toward modular) is the reason
this is a red rather than a yellow.

**Cluster D — licensing waits on two facts (CP-03 🔴; OI-03a/b; D-002).** The 81 Restricted
rows are 27 if both facts are favourable and 81 if neither is. Nothing in Wave 2 architecture can
proceed to member scope until this collapses; the desk-first default (D-001) is what lets Day 2
proceed at all.

**Cluster E — nothing in the benchmark set was seen running.** Every dossier's §K is 🔴; every
§J density or feel judgement is inferred; every AI citation mechanism is a vendor description
(C6-01, C6-02 GAPS). The cheapest lifts are the owner's existing TradingView account, a free
Koyfin login, Gödel's 14-day trial and a $12.95 TradingView seat; the expensive ones (Bloomberg,
LSEG, FactSet, AlphaSense) are sales-gated and will stay 🟡.

**Cluster F — three specific technical unknowns with quiet failure modes.**
- Whether yfinance's fallback adjustment covers dividends, so that a mid-fallback chart silently
  changes adjustment *scope* not just source (C7-02 §3.1, unresolved).
- Whether dockview's or FlexLayout's popout preserves the opener's React tree, and therefore
  UCT's one-SSE-pool-per-browser property (C5-01 §8, "answerable in an afternoon with a spike").
- Whether the `IMPLIED_ENRICHMENT_CUTOVER` flag is on in production (terminal-current-map),
  which determines what the calendar's enrichment cliff actually costs today.

**What is not uncertain but is often treated as if it were:** the platform's shape (§1.7), the
paywall direction (§1.1), the licensing arithmetic (§1.4), and the absence of a per-ticker join
(§1.6). These are 🟢 and should not be re-researched.

---

## 4. Important Bloomberg and competitor patterns

**4.1 Bloomberg (B-POD-BBG, complete).** The dossier's philosophy sentence: everything is a short
typeable address in one frozen grammar; the loaded security is context that persists across
addresses; the counterparties live inside the same product. Three convergences it names recur in
every leaf dossier read for this file: *saved things become names* (a saved search becomes an NI
code the user can type); *identify the instrument once per context, then change only the lens*;
and *what Bloomberg withholds is designed*. Its 24 reconciliations settle two program myths:
there are no documented colour-coded component groups (R2, §1.10 above) and no verified price
(R20). Its best-ideas list M1–M18 and anti-patterns N1–N13 are cited by name where they apply
below. The ceiling: no seat, no screenshot, no practitioner (OI-08 asks the owner for access),
and the Launchpad mechanism comes from guides © 2012 and © 2015.

**4.1b Bloomberg's multi-asset breadth (leaf `bloomberg/09-multi-asset-analytics.md`, added after
this synthesis's first draft).** A dedicated pass closed the equities-centric ceiling the base
dossier had honestly named (GAPS item 8): macro/economic calendar, rates and yield curves, fixed
income (govt/corp/mortgage/municipal/preferred), FX, commodities, derivatives/options analytics
(`OMON`, `OSA`), portfolio and risk (`PORT`'s Past/Present/Future structure, `MARS`, `MAC3`,
`LQA`), corporate actions (`CACS`, located inside the bond `DES` page), and people/company
intelligence (`MGMT`) all now carry cited, evidence-tiered coverage — two of the mnemonics found
(`OMON`, `MGMT`) and one precise function location (`CACS`) were not previously sourced anywhere
in this program. **What this means for TERMINAL-NEXT is a scope decision, not a feature list to
copy.** Bloomberg's breadth exists because one grammar spans ten yellow-key asset classes for a
single global institutional desk; UCT's desk-first thesis (D-001) and its actual data estate
(§8) are equities- and options-flow-centric, with no FX, commodities, rates, or fixed-income
provider in the current ledger at all (F-03b) and no owner-stated intent to acquire one. Building
FX/commodities/rates/fixed-income coverage to match Bloomberg's shape would be **Temptation 2**
in §11 below (research-terminal envy) wearing a multi-asset costume rather than a research one —
a capability UCT should **intentionally not build** per the owner's own build-vs-buy framing,
absent a stated desk need. The one piece of this deepening pass that *is* strategically relevant
regardless of asset-class scope is `PORT`'s Past/Present/Future risk-analytics structure and
`MARS`'s factor-attribution shape (§7 below) — those are patterns about *how to present risk over
time*, portable to UCT's existing equities/options book without importing a new asset class.
Even after this pass, cross-screen chaining into one regime read (Workflow G) and cross-company
relationship mapping remain honestly-named ceilings — no source, including this deepening pass,
resolves them.

**4.2 Where the eleven leaf dossiers converge.** Read side by side, the leaf dossiers do not
disagree about much. They converge on six patterns, each with at least three independent
witnesses:

1. **The citation is a door, not a footnote.** Quartr (five doors onto one primitive: calendar,
   search, alert, citation, slide-history all land on the exact source page), Fiscal.ai (every
   number opens the filing PDF at the exact page), AlphaSense (highlight-to-verify), LSEG
   (per-cell citation; passage highlighting), FactSet (source linking as a UI invariant). No
   vendor achieves this for *computed* values (C6-02 §4).
2. **Explain the artefact, not the answer.** TradingView's AI Screener emits an editable screen
   and shows an Explanation; Unusual Whales' `option-stance` returns a 0–5 `fit_score` with five
   named sub-scores and narrating prose; UW's Flow Legend undercuts its own BULLISH/BEARISH
   labels in-product. Rank 4 on C6-01's ladder needs no citation machinery.
3. **Saved things become names, and the user mints the verbs.** Bloomberg NI codes, Koyfin's
   user-assigned shortcuts (`fcsp`, `DBOLL`, `RGM`), Raycast Quicklinks, Gödel's public command
   index. C4-01's P7 and P13.
4. **Meter quantities, not features.** Unusual Whales' three retail tiers differ only in saved
   objects and refresh cadence; TradingView's ladder is charts/indicators/alerts/layouts/bars;
   Koyfin meters custom calculations 1/10/unlimited; SpotGamma tiers on model assumptions (Total
   OI → Synthetic OI). Three of four also sell cadence (UW 10-min → 1-min; SpotGamma nightly →
   intraday).
5. **Publish the ceiling and the freshness.** LSEG's 2,500 streaming RICs desktop / 1,000 per
   browser tab and its Desktop-and-Web comparison; SpotGamma's "two instances per Workspace";
   Quartr's percentile SLAs with the failure rate stated ("95% of events within 45 minutes");
   AlphaSense's "earnings summaries within five minutes"; Perplexity's screener limits printed on
   the page.
6. **The complementarity map is almost exact.** Every research-shaped vendor (AlphaSense,
   Quartr, Fiscal.ai, Koyfin, FactSet, LSEG) is strongest on Workflows B and C (earnings prep,
   research from scratch) and weakest or absent on D and G (what matters today, regime). Every
   tape-shaped vendor (Unusual Whales, SpotGamma, Benzinga, TradingView) is the reverse on E and
   F. UCT's proprietary rails occupy D, G and the decision half of E. No single vendor covers
   TERMINAL-NEXT's span, and the research vendors are capability donors, not competitors.

**4.3 Where they converge as anti-patterns.** The same defect class UCT's own `CLAUDE.md` keeps
re-committing — a hand-typed count beside the artifact it describes — is universal: Fiscal.ai
says 22 skills in one official page and 28 in another; Quartr's company count is 15,000 / 15,200
/ 16,000 across its own pages; Benzinga drifts four separate times (6 widgets where ≥8 exist,
"5 channels" above a list of 7, a tier article missing a shipped tier); LSEG publishes three
coverage counts and two live descriptions of its own model stack; SpotGamma's help centre carries
$99/$299 and $9/$99 for the same product; TradingView's "400+" indicators sit beside 209 help
articles; Unusual Whales says 100,000+ in its hero and 80k+ in its footer, and its alert rule
states thresholds its own worked example contradicts. The transferable rule is not "count
better"; it is *derive the number through the artifact that owns it, or print none*.

Two more anti-patterns recur: **a provenance mode-switch with no rendering change** (Quartr's
optional wider-web mode; LSEG's older opt-in Bing fallback), and **"no hallucinations" as a
product claim** (AlphaSense's homepage, Quartr's MCP page), each contradicted by the vendor's own
help centre.

**4.4 The specific transferable ideas this file carries forward** (each a hypothesis; "product
X does Y" is never the argument):
- Per-value citation in tables (LSEG M1); highlight-to-verify (AlphaSense M2).
- Configuration-as-answer with an Explanation diff, staged beside the hand-set state, never over
  it (TradingView M3, N1).
- One small readable filter language across feed types, with the AI builder emitting the text
  (Unusual Whales M-2; C4-01 P11).
- Document-arrival as an alert type off the already-wired EDGAR client (Koyfin M6; C2-01 §6 —
  "the data exists, the pipe exists, only the trigger is missing").
- A three-tier content policy: own it → paraphrase; license it → quote verbatim, unblended,
  attributed; member content → never synthesise into house voice (LSEG M2).
- Name a small fixed set of levels and never rename them; publish the assumption beside the
  number and sell its removal (SpotGamma M1, M2).
- Meter saved configuration, degrade the free tier by freshness (UW M-1, M-6).
- The StreetAccount triad for earnings: Preview → Guidance → Street Takeaways (FactSet M3).
- A percentile SLA per rail, graded by its own watchdog (Quartr M5).
- Sample Views as editable starter boards, segmented by what the member trades (Bloomberg M17;
  C5-01 §4).

---

## 5. Significant Gödel findings

Gödel Terminal (`03-competitive-research/godel/dossier.md`, B-POD-GDL, complete) is the most
useful single data point in the competitive set because it is a controlled experiment the
program could not have run itself: a 2024-founded, $7M-funded team rebuilt the Bloomberg
mnemonic grammar in a browser and priced it at $118/mo ($996/yr, plus a $30 FINRA surcharge).

**What it proves.** The Bloomberg grammar is not an artifact of a special keyboard or a 1980s
stack. Gödel's own positional grammar (`<TICKER> <COUNTRY> <ASSETCLASS> <CMD>`, e.g.
`AAPL US EQ G`) is a deliberate mirror of `AAPL US Equity <GO>`, and the dossier documents at
least four legacy Bloomberg mnemonics accepted and rewritten internally verbatim (`GIP`, `GP`,
`OPT`, `PDF`) so a user's prior Bloomberg muscle memory transfers without retraining — the
dossier does not quantify what fraction of Gödel's 48 published commands this represents, and
the whole address space is one public page (C4-01 §2). That page is the highest
learnability-per-hour artifact found in the whole command-grammar survey (P13), and it is
nearly free to produce once a grammar exists.

*[QC correction, 2026-09-02: this section previously claimed "roughly two-thirds" of Gödel's 48
commands are Bloomberg mnemonics reused verbatim, naming a 14-mnemonic list including `TOP`. No
such fraction is stated in the Gödel dossier, and `TOP` is not among Gödel's documented 48
commands at all — an independent fact-check found only the grammar-mirroring and the four named
mnemonics above are actually supported. Corrected here to what the dossier actually states.]*

**What it lacks, verified as absences.** Any AI (not on the roadmap either); technical
screening (`EQS` is a conventional BETA filter); options flow, GEX or dark pool; backtesting; a
self-serve API; order entry. Charting is TradingView wholesale; brokerage is SnapTrade, the same
provider UCT uses. The dossier's one-line reading: **Gödel is strong exactly where UCT is weak
and absent exactly where UCT is strong.**

**Three mechanisms worth naming.**
- The `{AAPL EQ G}` command string as a universal hyperlink: a command is an address, an address
  is shareable, and a shared address is a URL (C4-01 P12).
- TREND and WJI are userbase-manufactured datasets (most-searched tickers, with delisted names
  struck through rather than removed). This independently validates UCT's `/buzz` design
  (recall over precision, per the owner) and the "mark delisted, do not erase" convention
  (C7-02 §5.3).
- A news-filter audit panel that shows why each story passed — the same instinct as UCT's
  `CoverageLine` receipt.

**Keyboard layer worth copying wholesale.** Backtick to focus the command line from anywhere
(the browser-legal version of LSEG's OS-level `Ctrl+Shift+Space`); `Esc` double-tap to close a
window (two presses for a destructive act); `⌘Z` to undo a window close, which treats the
workspace as an editable document with an undo stack, something no other product in the survey
documents.

**Its defect is instructive too.** Its `/pricing` page says the API is "Coming soon… join the
waitlist"; its `/docs` page says REST and WebSocket are available "to enterprise customers on a
case-by-case basis" — two official pages, same day, not saying the same thing, unresolved in its
own community for about nine months. The second-authority defect at documentation scale (C6-01
anti-pattern 5).

**Ceiling.** The grammar's *syntax* is unread: nothing on the docs page says whether commands
compose with a ticker in one line. OI-18 (the 14-day trial) is unopened. One demo-video transcript
or one logged-in session settles it (C4-01 GAPS 3).

---

## 6. Major UCT existing-system discoveries

Three artifacts carry this section: the system map (F-03a), the capability ledger, and the
tech-debt register, with the TERMINAL-CURRENT map (D-09) for the surface that carries the
display name.

**6.1 Topology.** Two machines. Railway: `web` (single replica, one uvicorn, 64-thread anyio
pool, 1,187 routes, 143 APScheduler job ids, ~34 daemon threads), `worker`, `flow-worker`,
`bars-api` (new 2026-09-02), `chart-renderer` — five services, three of which share one
`railway.json`. About 55 SQLite files and 286 `CREATE TABLE` names on one volume; backups armed
but never observed landing. The owner's PC: 34 Task Scheduler tasks (31 live, 3 expired), 21
producers, 4 failing silently (§1.8). `DESK_PUBLIC_SHOWS=*`. Twenty-five reconciliations R1–R25
settle claims against code: R2 (paywall direction), R4 (five services, not three), R13 (flag
ledger stale on all five dark entries), R16 (Sentry unconfigured), R21 (every Desk show uploads
public), R23 (`BrokerEquityCurve` live, not deleted).

**6.2 Capability ledger — 178 rows.** A13 B12 C9 D12 E17 F10 G12 H9 I6 J10 K13 L11 M8 N13 O12
P11. 168 active, 5 dormant, 2 deprecated, 2 duplicated, 1 absent (P6, per-user cohort
targeting). Reconciliations L-1..L-6: Claude synth ON; the awareness tile unmounted; the
ticker-mentions door NOT DETERMINED.

**6.3 Tech debt — 72 entries; eighteen block a terminal.** TD-01 `StockChart` at 15,500 lines;
TD-02 no per-widget error boundary (a widget that throws on every mount cannot be closed because
its header is inside the failing subtree); TD-03 unversioned layout (two migrations shape-sniffed
on `cols !== 24` and a height heuristic); TD-04 `user_preferences` as a size-unbounded bag with no
delete route; TD-05 link groups symbol-only; no DataGrid; no keyboard registry or palette (87
keydown listeners); no format/freshness primitive (118 `fmt*` helpers); no form controls; the
SPA catch-all serving 200 HTML for unmatched `/api/*` (OQ-12 closed); no cohort targeting;
single process; `auth.db`; no CI gate; a 3-minute deploy cut; observability by `print()` and
Discord; no performance baseline; fetch discipline `.catch(() => null)`. TD-19–50 increase risk:
flag-ledger drift; second authority in at least nine places; five LLM price tables; four PC jobs
failing; no second host; three codebases with no off-machine copy; local recipes hitting live
data (R-15); unauthenticated endpoints (R-17); credentials in the bundle; unverified backups; a
provider layer with no abstraction (six FMP helpers); streaming hazards; the capacity envelope;
OPRA with no replay; retention. TD-51–63 are opportunistic; TD-64–72 are leave-alone.

**6.4 TERMINAL-CURRENT.** Four views (Wire, Board default, Table, Month) plus
`/calendar/mystocks`; 31 routes; a 12-panel modal in 5 groups; 4 live and 3 legacy preference
keys; 9 readers of `/api/calendar`, 5 of them server-side bare `.get()`. Cold `/api/calendar` is
4.5–8 s (8,005 ms observed) and the enrichment cliff is 130×. Rebuilt twice and the modal once in
seven months. The 2026-09-01 rename touched 18 files and was display-only; `calendar_view_v3`,
`calendar_filters_v2` and `calendar_mystocks_sources` are persisted preferences and the widget key
lives in `charts_workspace_layout`, so a plumbing rename wipes saved views unless a read-fallback
shim ships. The deep link `?earnings=SYM&esection=` is to be honoured or 301'd, never retired.
`importance.js` carries the ordering hierarchy; `weekAnchor.js` carries two named week intents
that are seven days apart on a Saturday and an AST rail that fails on any locally declared
derivation (C7-02 §1.4 calls this the most transferable time decision in the internal corpus).

**6.5 What the estate already has that a terminal needs (Q21's ten primitives).** A widget
registry; the `/charts` board with pop-out (a React portal into `window.open`, so every popped
window shares one SSE pool — the strongest multi-monitor story in the benchmark set, C5-01 §2);
`ChartPane`; a tool registry of 154 tools shared by voice and text; persistence seeds
(`chartDefaults.js::mergeChartSettings`, `instanceShape.js`, `usePreferences.setPrefMerged`,
`useTracingsSync.js`, `charts_layout_service.py`, `user_definitions.py`); a latency layer;
honesty primitives (`CoverageLine`, the COT grounding gate, `cotFacts.js`); `entitlements.py`;
one-authority modules; and a screener DataGrid seed. C5-01 §7's reading: everything a versioned
workspace document needs exists in-repo, and none of it is applied to the layout.

**6.6 The estate's most expensive defect class.** Second authority over one value: Q20's eleven
instances; TD-19's nine-plus places; five LLM price tables; the `is_current_week` boolean that
"says the opposite of what it reports" on weekends and was deliberately not renamed because
fixtures name it (C7-02 §1.4). The benchmarks show the same class at every vendor (§4.3). It is
not a UCT peculiarity; it is the default failure mode of any artifact with a number in it.

---

## 7. UCT proprietary advantages emerging

D-13 measured the estate rather than describing it, and the measurement supports three claims
and undercuts a fourth.

**7.1 The advantage is narrative plus decision provenance.** Tier 1 of D-13's uniqueness ranking
is the combination of a first-party knowledge base (9,605 rows, 57.7% first-party), a voice
profile (88 posts, 120,055 words, 120 exemplars; Bracco is 20.7% of the body; "lol" appears 0
times in 211,539 characters), a curriculum (16 modules, 79 lessons, roughly 695 KB, 181 chart
examples of which 29 verified, 138 corrected, 9 replaced), and a labelled setup record
(`setup_triggers` 243 rows: 47 wins, 81 losses, 57 never triggered, 57 open). No vendor in the
benchmark set can license any of this. The AlphaSense and Koyfin dossiers each name it as the
"fifth perspective" or "the point of view about right now" that their products structurally
cannot have.

**7.2 The UCT way exists as constants, not prose.** `_SIZING_TABLE` at `api.py:2678` (GREEN A+25
/ A20 / B10 … RED 0); `_REGIME_LIMITS`; drawdown protocols; the 10% Desjardins heat cap; the
$300M scanner floor versus the $500M leadership floor; the Book's `max_stop_pct` 4.0 (recorded
inert in memory); exposure 0–150 in MODULE 5; FTD rules; the Top 5 entry types. Q3's second
differentiator, "the UCT way as constants", is measurable because it is code. This is what
SpotGamma calls a named, fixed vocabulary of levels (§4.4) and what Benzinga's "0-100 ranking"
lacks: a published derivation.

**7.3 The lift ledger is a track record with losses.** 25 measured, 3 published (darvas-box
+7.35pp at n=24,428; parabolic-extension +31.21pp; ema-crossback +12.94pp), six gates, all of
which must pass or no number publishes at all (D-13) — a discipline that discards more than it
ships. Q3's "track record with losses" and Unusual Whales' M-4 ("mark the community's shared
calls to market, publicly, including −99%") are the same idea. UCT already has the discipline;
it has not shipped the surface.

*[QC correction, 2026-09-02: this section previously described a specific "gate 5 killed two
rows that beat baseline and lost money" episode. That episode is not supported by D-13, which
documents gates numbered (0)-(3) only and contains no losing-money episode of this kind — an
independent fact-check traced the sentence to an unrelated user-memory entry describing a
different, coincidentally similar project, evidently conflated during this file's
context-compaction recovery. Corrected here to what D-13 actually states.]*

**7.4 The strongest differentiator does not exist yet.** D-13's top-ranked asset is the
per-ticker history join — one query that answers "what did we say about this name, what did the
setup do, what did the book do, what did the flow do" — and no join exists. Q7's four histories
never meet. Q15's nine missing joins are the research-side version. The advantage is latent, and
it is a data-modelling job (§12.3), not a UI job.

**7.5 The moat compounds but leaks (Q40).** The flow corpus has been dead since 2026-08-09 (about
17 OPRA sessions lost); the Brain Pack exporter was terminated on battery; `/buzz` stores no
text; the #tsdr corpus is frozen at 7,766 messages (2024-03-11 → 2026-02-20). A moat that is a
recording is only as good as the recorder, and four recorders are silent (R-16).

**7.6 One claim undercut.** The bot README's marketing ("150 books / 200 channels") is
contradicted by the measured 12 intakes and roughly 25 traders. The taxonomy is v4.22.0 with 112
themes, 2,029 holdings and 12 sectors; the setup vocabulary is four populations (48/32/26/24, 15
shared, 9 playbooks, 18 model examples, 24 detectors, 85 total); the candle library is 66. These
are the counts; the README's are not.

---

## 8. Provider and data findings

**8.1 Headline (F-03b).** 48 rows; 20 core; 7 retirement candidates (Bullflow, Polygon-direct,
Unusual Whales, Finnhub, AlphaVantage, yfinance, ForexFactory) plus six FMP helper modules to
consolidate; 9 dormant lanes; 20 retirement or consolidation candidates in all; 15 contradictions
settled. On the evidence ladder only FMP (🟢) and Finnhub (🟡) are OBSERVED-CALLED dashboard-side;
**zero rows are CONTRACT-ACTIVE**. DL-021: five code comments name "Polygon Advanced, $200/mo"
as the Massive plan — a high-confidence CLAIM, with no contract found anywhere. DL-022 schedules
F-09, a provider master ledger with the owner's A–G taxonomy, for the next wave.

**8.2 The NO PROVIDER list is real and short (Q17).** Level 2; credit; FX and crypto bars;
whisper numbers; a consensus-revision timeline; short-interest history; per-broker estimates.
Every other data class in the terminal's scope has at least a KEY-PRESENT row. The Buffer
publisher was found in `uct-clips/uct_clips/publishers/buffer.py:25`, not where the claims
document said.

**8.3 Massive is paid for and under-used; Finnhub carries the tick stream.** §1.2. The five
under-used Massive capabilities (native chains and Greeks, splits and dividends, index snapshots,
WebSocket ticks, news) are exactly the ones that would let the retirement candidates retire.

**8.4 News is a fallback chain, not a blended pool (C2-01 §1).** `AV NEWS_SENTIMENT → 7 RSS →
Massive /v2/reference/news → FMP stable/news/* → Finviz → Google News RSS`, each consulted only
when the previous fails or is throttled. Every benchmark news product treats the source as a
filter axis on one pool. UCT has no retraction or update channel on any news source, no
`primary` versus `mentioned` ticker bit (the cashtag regex treats every `$TICKER` as equally
about that ticker), and three unconnected taxonomies (catalyst tags, themes, cashtags). The two
engineering-only wins C2-01 names are the primary/mentioned bit and a filing-arrival alert type
off the already-wired EDGAR client.

**8.5 There is no symbol master (C7-02 §1.1).** The ticker string is the key; `cap_universe` is a
gate, not an identity registry; `to_polygon_symbol()` rewrites `BRK-B` → `BRK.B` at one vendor
boundary only. FIGI is a free, MIT-licensed permanent identifier designed to survive exactly the
rename and delisting that a ticker key cannot (C7-03; C7-02 §2.1); Fiscal.ai's 2026-06-24
ticker-mapping refactor and Quartr's `companyId`-first API are the product-level confirmations.
Adjustment appears only as a symptom (`_is_intraday_stale()` >5 days → yfinance fallback), never
as a policy, and UCT's own vendor documents split adjustment only.

**8.6 The market clock is a dataset (C7-02 §4).** `calendarTime.js` is 35 lines and is the entire
timezone model, correctly session-anchored for earnings BMO/AMC; it is not a market calendar, and
a TERMINAL-NEXT open/closed indicator cannot reuse it. C6-02 §5 adds that no AI lane injects
session state, and that LSEG's AI Search excludes real-time data rather than modelling the clock.

**8.7 Costs (E-05).** Branches S0 / A-lite / A-full / B. Massive Business from $2,499; OPRA $1,500
floor plus $1.25 per non-professional; a "delayed full market $499/mo" question for Massive.
Twelve owner questions. The fixed block dominates below about 1,000 members, which is the
commercial reason desk-first is also the cheap default.

---

## 9. Licensing findings

**9.1 The register (F-04, 118 rows).** 3 A (allowed), 7 LA (allowed with limits), 81 R
(restricted), 18 U (undetermined), 8 X (prohibited), 1 machinery. Two facts flip most rows:
OI-03(a), the Massive plan tier, moves 38 rows; OI-03(b), an FMP DDLA, moves 19. Both favourable
→ Restricted falls 81 → 27, and 13 of those 27 are fixable by engineering. The rows that survive
both facts as R are named: T-02, T-12 (composites, §6.1(j)), T-16–T-19, T-22, T-27, T-79,
T-51–T-59, T-62–T-64, T-68, T-81, N-06, N-18, N-20, N-23. These are the genuine contract
conversations.

**9.2 D-002 (escalated).** Member-facing raw vendor display is Restricted-pending-contract;
assume Massive Individual and no FMP DDLA until told otherwise. R-14 applies to production
today, not only to TERMINAL-NEXT, and R-17 compounds it: the data is redistributed to anyone
with the URL.

**9.3 The desk-only escape does not exist.** At Massive, FMP and Finnhub there is no license
class that permits internal desk display while forbidding member display in a way that changes
the register's answer. D-001 (desk-first) is a sequencing decision, not a licensing one.

**9.4 Four primitives and ten prohibitions for architects.** F-04's rules R-A4-1..12, R-A5-1..9,
R-A6-1..10 reduce to four data primitives (a real-time quote; an OPRA print; a chain plus Greeks;
everything derived is free on the plans held) and ten things architects may not assume. The
escalation ledger ESC-01..ESC-24 and the addenda X-01..X-16 record five clause-versus-code
collisions (three live), the unauthenticated endpoints X-06..X-13, and the LLM input-rights
warranty (§L.1) that applies the moment a model reads licensed text. LSEG's three-tier content
policy (§4.4) is the already-solved shape for that last item.

**9.5 The licensing lesson from the benchmark set.** Koyfin's contract is visible in its product
shape (no API, no Excel plug-in, download carve-outs — "They are in the API business. We are in
the analytics business"); its one AI feature sits on transcripts because that is the corner of
the corpus where the rights are cleanest. UCT's data is largely its own, so the licensing wall
that caps Koyfin does not apply to the proprietary layer — but it applies exactly to the vendor
layer underneath it, and §9.1 is the map of where.

---

## 10. Workflow implications

The executive-questions Trading (Q6–Q10) and Research (Q11–Q15) sections, read with the
benchmark workflow grids (each dossier's §E), yield four implications.

**10.1 Five workflows, not seven, and three of them are already UCT's.** Q1 names five: pre-market
prep; what's moving now; understand this name; scan → chart → decide; monitor what I own. Mapped
onto the benchmark grid: D (what matters today) and G (regime) are served by no research vendor
and only partially by the tape vendors; UCT's wire, breadth rails, exposure rating and catalyst
engine already occupy them. E (find a trade) is served as *candidates* by every screener vendor
and as a *decision* by none; UCT's `grade_ticker` is the only structurally decisive verdict in
the set. That is the defensible ground and every dossier's Part XXVI paragraph says so
independently.

**10.2 The desk's morning is unknown and is the highest-value observation available.** Q8 and
Q10 are 🔴; H21 is unsupported; OI-06 is unanswered. C4-01's whole grammar decision turns on the
desk's *tenth* action of a session versus the member's *first*, and neither number exists. The
reallocation advice from the scoreboard stands unchanged: one owner-observed 06:30–10:00 CT
timeline moves more rows than any further reading.

**10.3 Research is a join problem, not a surface problem.** Q14/Q15 are 🟢 because the code
answers them: eleven doors, four histories, nine missing joins. AlphaSense's Four Perspectives
(company / analyst / press / expert as a provenance filter over one result set) and the desk's
own prior view as a fifth perspective is the shape; the per-ticker join (§7.4) is the
prerequisite. FactSet's Preview → Guidance → Street Takeaways triad and AlphaSense's sentiment
*change* versus the company's own prior calls are two cheap additions on data UCT already
fetches.

**10.4 "Why is it moving" is open and UCT can answer it in the negative.** C6-01 §3: the honest
output a driver-attribution feature must produce is "nothing specific — this is a beta move with
the sector", and the deterministic version (move versus sector/beta, residual named) is
checkable where a narrated cause is not. Benzinga's WIIM is the fixed-slot, allowed-to-be-blank
precedent (M2). UCT's catalyst engine with `catalyst_at`, the honest blank of `CoverageLine`, and
the breadth rail are the three ingredients. Workflow A is the one where the market has left the
door open.

**10.5 What the tape vendors teach about monitoring.** Unusual Whales' "click a minute on Market
Tide → land on that minute in the flow feed" (M-7) is the most terminal-like gesture observed in
the set; TradingView's modifier-plus-cursor "act at this price" removes a dialog rather than adding
a launcher; Koyfin's dispatching right rail retargets the active pane. Q26 cannot be scored until
the desk is watched, but these three are the candidates for what a scored Q26 would measure.

---

## 11. Emerging product thesis

Labelled **emerging, not decided.** Each candidate is written in the Part CCXLIX shape: a
one-sentence philosophy, what it would make true, and what would falsify it. The program has not
chosen; §16 records nothing here as a decision.

**Candidate P-α — "Decisive, with the receipt attached."**
*Sentence:* TERMINAL-NEXT is the workstation that says what the data means and shows, per number,
where the number came from. *What it would make true:* every generated sentence renders through a
provenance component (FactSet's invariant), every computed number has an addressable row
(`uct://breadth/pct_above_50sma@…`), and the verdict is structural (`grade_ticker`) rather than
prompted. *Evidence for:* §1.12, §1.13, every dossier's Part XXVI paragraph ("UCT's intelligence
is the missing sentence at the end"). *What falsifies it:* a member telemetry read showing the
decisive surfaces are not where members go; or the observed desk morning showing the desk
reads the tape and ignores the verdict.

**Candidate P-β — "The desk's own prior view is the fifth perspective."**
*Sentence:* Every name, every setup and every regime call arrives beside what this firm already
said about it and whether it was right. *What it would make true:* the per-ticker history join
(§7.4) is the first data-model deliverable; the track-record-with-losses surface ships before any
new panel; the wire, the Model Book, the journal and the flow record are one corpus. *Evidence
for:* D-13's uniqueness ranking; Q3's differentiators 1 and 2; AlphaSense M10 (internal content
indexed beside external). *What falsifies it:* the join proves too sparse to render (fewer than a
few hundred names with all four histories), or the owner rules the history not member-safe.

**Candidate P-γ — "One authority per value, one door per capability, one grammar with many
front ends."**
*Sentence:* The terminal's discipline is structural: no number is restated, every capability has
exactly one reachable door, and browsing, typing and asking all resolve to the same address.
*What it would make true:* the second-authority class (§6.6) becomes a build-time rail; the
"doors per capability" count (FactSet dossier §J) is measured and driven to one; the command
surface, the menu and the AI door emit the same deterministic text (C4-01 P5, P11). *Evidence
for:* Q20, Q24, TD-19, C4-01 anti-pattern 1, §4.3. *What falsifies it:* the desk observation shows
the desk wants three doors for one thing on purpose (a keyboard path, a click path and a voice
path that differ in payload).

**Candidate P-δ — "Curated first, with an escape hatch to everything."**
*Sentence:* Every surface opens on the house read and offers, one gesture away, everything the
read filtered out. *What it would make true:* the catalyst tile's ⓘ citations and "why isn't X
here" widget generalise (C2-01 §8); no browsable general feed is built; every curated list carries
a `CoverageLine`-style receipt. *Evidence for:* `CLAUDE.md`'s curation posture throughout;
Bloomberg's `TOP`-first default; Benzinga's WIIM slot allowed to be blank. *What falsifies it:*
telemetry showing members route around the curated surfaces to raw pages, or the desk asking for
a raw feed first.

**How the candidates relate.** P-α and P-β are compatible and probably one thesis; P-γ is an
engineering discipline that any of the others needs; P-δ is a scope decision. The reconciliation
that must happen before any is adopted is the decisiveness tension in §13.4: LSEG and FactSet
refuse the verdict for strangers; UCT computes it for a coached membership; TERMINAL-NEXT serves
both a desk and members, and "decisive for the desk, balanced for a stranger" is a program
decision that no artifact has yet been asked to make.

### The Frankenstein temptations already visible (Part CCXLVIII)

Three ways the evidence, read carelessly, would produce a stitched product.

**Temptation 1 — the grammar stack.** Take Bloomberg's four-slot sentence, add TradingView's three
search modes, add Unusual Whales' `Ctrl-K` palette with `/cmds`, add Koyfin's user-minted verbs,
and ship all four as "the command surface". C4-01 §11 is explicit that Grammar A (noun-first) and
Grammar B (verb-first palette) are the sharpest fork in the file and TERMINAL-NEXT cannot have
both as its default; the decision is made against the desk's tenth action and the member's first,
neither of which has been measured. The tell that this temptation is live: Q2 already lists "a
command surface" as table stakes while H5 is Unknown.

**Temptation 2 — research-terminal envy.** Bolt AlphaSense's document corpus, Quartr's live
transcripts, Koyfin's 300-metric financial analysis and Fiscal.ai's 20-year statements onto a
trading desk because each dossier's §M has a good idea in it. Fiscal.ai's own N8 is the mirror
warning: adding RSI and MACD to a fundamentals terminal does not make it a charting product; it
makes a second-best chart sit beside a best-in-class statement viewer. The benchmarks are
capability donors (§4.2 point 6), and a donor's organ is not the recipient's identity. The tell:
Q4's nine not-in-year-one items exist precisely because this pull was already felt.

**Temptation 3 — AI surface sprawl.** FactSet ships twelve separately branded assistants
(Mercury, Portfolio Assistant, Transcript Assistant, Draft Assistant, Topic Assistant, Theme
Intelligence, Search Intelligence, Slide Assistant, Template Assistant, Security Explanation,
Signals, Agent Hub); a user cannot hold that map (FactSet N7). UCT already has six doors to one
assistant in a read-only Settings list (FactSet dossier §J), a Builder and a Concierge with an
undocumented boundary (AlphaSense N5), and a fast lane, an agent lane, Compass, the wire brain,
`ask_the_brain` and `grade_ticker` as separate lanes (D-12 via C6-02). Every new benchmark idea in
§4.4 that is AI-shaped (per-cell citation, highlight-to-verify, Explanation panel, automations,
skills) is a temptation to add a seventh door rather than to route the six through one provenance
component. Fiscal.ai's retreat from a chat identity (N1) is the counter-evidence.

A fourth, milder temptation is recorded for completeness: **workspace maximalism** — adopting a
dock library, FDC3 as a desktop container, and a Bloomberg View → Page hierarchy because seven
competitors have workspaces, before UCT's own `charts_workspace_layout` table has been queried
once. C5-01 §9 draws the line: adopt FDC3's *vocabulary* (typed channel payload,
`DisplayMetadata`, replay-on-join), never its *container*; and C5-01 §6's honest summary is that
users customise enough that vendors meter it and build undo for it, and simultaneously that
vendors do not trust users to start from blank.

---

## 12. Emerging architecture implications

Each is a direction the evidence points, not a decision (§16 carries those that are forming).

**12.1 Workspace: design the document first, the grid second.**
- Adopt the repo's own versioned / tombstoned / hydration-gated patterns (D-11's seed map, §6.5)
  before the layout stores anything; distinguish "empty because new" from "empty because
  unreadable" (R-13; C5-01 §5, §7).
- Keep the two-layer shape the estate already has — fixed pages for market-wide questions, a
  composable board for portfolio-specific ones — and build the crossing in both directions
  (Bloomberg `LLP` promotion; C5-01 §0). Test one operation, "open this page as a panel", before
  authoring more registry entries.
- The build-versus-adopt question is not grid-versus-dock. UCT has already built slot tabs
  (twice, sharing no code), floating panels, popout and seam-dragging on react-grid-layout. The
  one property at risk in any migration is the `window.open` portal that keeps one SSE pool
  browser-wide; whether dockview or FlexLayout preserves it is NOT DETERMINED and is an afternoon
  spike (C5-01 §8).
- Generalise the link key from a colour letter to a typed channel record
  (`{id, displayMetadata, context}`), payload kind explicit per channel (symbol · symbol-set ·
  list · timeframe · range), starting with exactly one list-consuming widget (C5-01 §3, §9). The
  four-group ceiling already bites (`GridChartCell` bypasses `ChartWidget` because of it).
- Port `useStaggeredMount` and `GRID_MAX_CELLS`-style caps to the widget board before the viewport
  lock is relaxed; publish the cap (SpotGamma M4; LSEG M3).

**12.2 Streaming and caching: the envelope decides, and it has not been measured.**
- R-04: one process, one volume, jobs that cannot move off web. D-05 measures the envelope before
  ARCH-07 designs to it; there is no p50/p95 anywhere (C6-02 GAPS; TD "no perf baseline").
- The commercial lever the benchmarks converged on is *cadence as a tier* (UW 10-min → 1-min;
  SpotGamma nightly → intraday). It bounds per-user fan-out commercially where the single pod
  cannot bound it technically (UW M-8).
- Prompt caching, batching (`llm_batch.py` has exactly one consumer) and response exclusion are the
  ordered cost levers; the model tier is last, and the standing doctrine forbids downgrading a
  model for cost (C6-02 §8).

**12.3 AI grounding: the reader-side half is a wire format plus a data model.**
- Route every AI surface through one provenance render component so a surface without citations is
  structurally impossible (FactSet's invariant; C6-01 §2 recommendation 2).
- Emit intent-gated packs as `search_result` blocks with `kb://`- or `uct://`-style sources; the
  citation win belongs to the block format, not to the agent lane, and does not cost the agent
  lane's quota (C6-02 §2).
- Give computed metrics addresses: an id, a value, an as-of, its inputs and the calculation
  version (W3C PROV: Entity `wasGeneratedBy` Activity `used` inputs). This is C7-03's canonical
  data model and metric dictionary; without it the renderer silently skips exactly the figures a
  desk cares about most (C6-02 §4).
- Inject session state as a first-class grounded fact (ET wall clock; `pre` / `RTH` / `post` /
  `closed` / `half-day`; minutes since the boundary; per-pack as-of), never as a cache salt
  (C6-02 §5). NYSE's 2026 early closes are 3 July, 27 November, 24 December.
- Citations always on, rendering optional: a per-answer citations toggle busts the cached prefix
  and collides with the all-or-nothing constraint (C6-02 §8).
- Add the exam class where the correct answer is a refusal; score compliance and robustness
  separately; extend `--grounding-audit` to every lane before adding a graded question (C6-02
  §6, §7).
- Stage AI-built configuration beside hand-set state, never over it (TradingView N1).

**12.4 Identity and time.**
- One internal permanent entity id with tickers as a dated alias list, every downstream table
  keyed to the entity (C7-02 §2.1, §6; FactSet M6; Quartr M8). The alias-table shape, not a
  rewrite function per vendor pair.
- Adjustment stored as a policy and labelled at the point of display ("split-adjusted,
  2026-09-02" / "as reported"), with a three-state pipeline: detected → confirmed → applied
  (C7-02 §3.2, §3.3).
- A versioned holiday-plus-session dataset, not constants in `calendarTime.js` (C7-02 §4).

**12.5 Entitlement and cost.**
- Server-side auth on every data endpoint is a Tier-S requirement (R-17 → ARCH-06); A-06 lists
  every unauthenticated `/api/*` data route from D-02's route table.
- Any agent-facing surface reuses the *same* entitlement object the web session uses (Fiscal.ai's
  inheritance rule; FactSet's "enforced per human, including for agents"); a parallel
  authorisation path is a second authority over "what may this member see" (C6-01 §5).
- No member-facing AI lane ships without a population cap; E-06's fifteen guard constraints go to
  ARCH-05 (R-18). The AlphaSense credit-pacing forecast ("at this rate you exhaust credits on the
  19th") is the shape that makes the cost doctrine survivable (AlphaSense M8).

**12.6 Provider layer.** An anti-corruption layer per vendor (C7-03; the Finnhub client as the
internal template), the six FMP helpers consolidated, the seven retirement candidates retired
against the five under-used Massive capabilities (§8.3), and a per-field lineage visible in the
product (TradingView M8; Fiscal.ai M-provenance column).

---

## 13. Important contradictions

Each in Position A / Position B / Reconciliation / Status form. Only contradictions that bear on
a decision are listed; documentation drift inside a single vendor is covered in §4.3.

**13.1 Morning Wire: free or paid?**
*A (seed):* the wire is paid. *B (code):* `AuthGuard.jsx:112 FREE_PAGES=['/morning-wire']` — the
wire is the only free page. *Reconciliation:* DL-010 resolved for the artifact. *Status:* closed.

**13.2 Tick stream: Massive or Finnhub?**
*A (`CLAUDE.md`):* Massive. *B (provider ledger):* Finnhub, with Massive WebSocket ticks
under-used. *Reconciliation:* the claims document is stale; the ledger is derived from code.
*Status:* closed for the map; open as a retirement/consolidation decision (§8.3).

**13.3 Workspace and command surface: table stakes or unknown?**
*A (executive-questions Q2):* both are table stakes. *B (hypothesis register H1, H5):* Unknown.
*Reconciliation:* Q2's classification rests on benchmark ubiquity, which the program's own
discipline says is never an argument; H1/H5 rest on the absence of any adoption evidence,
internal or external. The register's position is the safer one until `charts_workspace_layout`
is queried. *Status:* open; tension recorded in F-08; resolves with one query the owner can run.

**13.4 Decisive verdict versus balanced overview.**
*A (UCT):* `grade_ticker`'s decisiveness is structural, not prompted; hedging fails the report
card. *B (LSEG, FactSet, Quartr, Unusual Whales):* refuse the recommendation, present balanced
data, attach a disclaimer; `option-stance` "narrates, does not decide". *Reconciliation:* both are
defensible and they serve different readers — a coached membership versus strangers. C6-01
anti-pattern 8 and the LSEG dossier §I both say this "deserves an explicit program decision, not
a drift". *Status:* open; forming in §16.

**13.5 Fixed page versus modular workspace.**
*A (program framing, R-07):* a spectrum from fixed to dock manager, to be chosen. *B (C5-01):*
a two-layer architecture with promotion in both directions, where the hard part is the document
schema. *Reconciliation:* the survey reframes the question rather than answering it; C5-03 owns
the decision and should inherit the reframing. *Status:* open, reframed.

**13.6 Bloomberg colour groups.**
*A (contract framing and general lore):* Bloomberg links by colour group. *B (B-BBG-02 §5; C5-01
§3):* no source documents it; number plus letter badge. *Reconciliation:* B, on the sources
reached; the stronger claim "Bloomberg has never had them" is 🟡. *Status:* closed for citation
purposes.

**13.7 Massive plan: "Polygon Advanced, $200/mo"?**
*A (five code comments):* yes. *B (DL-021; every search for a contract):* no contract found.
*Reconciliation:* a high-confidence CLAIM that OI-03(a) confirms or refutes; 38 licensing rows
ride on it. *Status:* open, owner-bound.

**13.8 Curated only versus browsable feed.**
*A (`CLAUDE.md` posture; catalyst quota; edited wire):* curated. *B (every benchmark except
AlphaSense ships a browsable feed):* a general feed is standard. *Reconciliation:* C2-01 §8
finds no written decision that UCT deliberately does not ship a feed, and flags it as a product
scope question rather than assuming either answer. *Status:* open; P-δ in §11 is the candidate
thesis.

**13.9 Bot README claims versus measured intakes.**
*A (README):* "150 books / 200 channels". *B (D-13):* 12 intakes, about 25 traders.
*Reconciliation:* the measurement wins; the README is marketing. *Status:* closed; do not quote
the README.

**13.10 Hit rates with and without base rates.**
*A (SpotGamma):* "the Call Wall has held in 83% of daily trading sessions". *B (UCT's own
lesson, applied by SpotGamma N1 and AlphaSense M4):* a hit rate is meaningless without its base
rate. *Reconciliation:* UCT's lift ledger publishes lift against baseline (§7.3); TERMINAL-NEXT
must not import the SpotGamma format. *Status:* closed as a rule.

**13.11 `is_current_week` says the opposite of what it reports.**
*A (name):* current week. *B (behaviour on weekends):* next week, because the anchor rolls
forward. *Reconciliation:* deliberately not renamed because fixtures name it (C7-02 §1.4). A
live trap for new readers; name intents at birth. *Status:* open, accepted as debt.

**13.12 The awareness tile and the ticker-mentions door.**
*A (claims):* mounted and live. *B (capability ledger L-2, L-6):* unmounted; NOT DETERMINED.
*Reconciliation:* the ledger is derived; the claims are not. *Status:* open as flags, closed as
map.

---

## 14. Risks

Ranked by this file's reading of likelihood times impact on TERMINAL-NEXT, with the register's
own L/I carried as stated.

1. **R-17 — unauthenticated data endpoints (H/H, confirmed).** The one production finding of Day 1
   that is also a licensing exposure today. Not changed by this program; reported to the owner;
   ARCH-06 treats server-side auth on every data endpoint as Tier S.
2. **R-18 — per-user AI caps summing to about $650/member/month, Compass with no population cap
   (M/H).** A member-facing TERMINAL-NEXT AI feature on the same guards inherits unbounded
   exposure. The mitigation exists as E-06's fifteen constraints and AlphaSense's pacing-forecast
   shape (§12.5).
3. **R-14 / D-002 — member-facing raw vendor display outside the tier held (M/H).** Applies to
   production now. 81 Restricted rows until two owner facts land.
4. **R-16 — four PC jobs failing silently (H/M).** About 17 OPRA sessions already lost; the moat is
   leaking (§7.5). A terminal that depends on PC artifacts inherits one-heartbeat-at-best.
5. **R-13 — silent, unrecoverable workspace data loss (M/H).** `parseLayout` → `null` →
   `DEFAULT_LAYOUT` → autosaved over in 500 ms. Any TERMINAL-NEXT state on the same key→TEXT blob
   inherits it; the fix patterns are in-repo (§6.5).
6. **R-04 / R-09 — one process, one volume, one PC (M/H; H/M).** The envelope is unmeasured. Every
   scale win to date is about not fanning out per-user work; the benchmarks' answer is cadence as
   a tier.
7. **R-15 — local recipes hit live `C:\data` (M/H).** A prototype started the documented way
   touches production data. Program rule already in GOVERNING_PRINCIPLES.
8. **R-07 — directive volume biasing toward modular before evidence (M/H).** §13.3 is the live
   instance. Mitigated by three independent ARCH proposals and C5-03's gate.
9. **R-02 — dossiers filled by inference at the paywall (H/H).** Every §K is 🔴; the DISCARD rule
   for uniform-🟢 dossiers held (none was uniform); the practitioner tier was unreachable for
   Bloomberg, LSEG, FactSet and AlphaSense.
10. **R-19 — session-limit pauses truncating agents mid-write (H, recurring).** Three pauses this
    session at 4:20am, 10:40am and 4pm Chicago; mitigated by contracts-on-disk and per-file QC; the
    operating constraint that sets §21's colour.
11. **Emerging, not yet registered — silent adjustment-scope change.** A mid-fallback chart may
    switch from split-only to split-plus-dividend adjustment without a label (C7-02 §3.1). Quiet
    failure mode; cheap to label; recommend registering as R-20 with owner D-05/C7-03.
12. **Emerging, not yet registered — documentation drift as a product defect.** Seven of eleven
    vendors ship self-contradicting counts or prices (§4.3); UCT's `CLAUDE.md` is already recorded
    stale in five places (terminal-current-map §10.1). Recommend a standing rail rather than a
    risk row: derived counts only, in every member-facing and program artifact.

---

## 15. Hypotheses strengthened and weakened

From `hypothesis-register.md` (F-08): 8 supported, 12 partially, 3 unsupported, 12 unknown, out
of H1–H35.

**Strengthened by Day 1 (and by this file's cross-read).**
- **H14, H23, H29, H35** — supported and recommended for GOVERNING_PRINCIPLES as constraints. This
  file concurs and adds that the benchmark set independently converged on the same constraints
  where they are visible (one authority per value; the honest blank; measure, don't quote).
- **H6, H11, H31** — supported on internal evidence.
- **H7** — provisional support; the Wave 1b workspace survey (§12.1) neither strengthens nor
  weakens it further because nothing was observed running.
- **The grounding thesis** (not a numbered H, but the register's tension with Q32/Q33): the C-wave
  found that UCT's producer-side gates exceed every vendor's published posture (C6-02 §9), which
  strengthens the case that the AI investment belongs on the reader side, not on more lanes.

**Weakened or unsupported.**
- **H21** (desk workflows reconstructable from the repo) — UNSUPPORTED; §1.5, §3 Cluster A.
- **H24** (the setup library as-is is a terminal asset) — UNSUPPORTED; D-13's four-population
  vocabulary (48/32/26/24, 15 shared) is evidence of the second-authority class inside the asset
  itself.
- **H30** (the Exposure Rating is portable) — UNSUPPORTED; its yfinance input is Unsuitable under
  the licensing register.
- **H1** (workspaces) and **H3** (existing providers suffice) — the register's two most at risk.
  H1 waits on one table query; H3 was weakened further by the provider ledger's zero
  CONTRACT-ACTIVE rows and the seven retirement candidates.

**Still Unknown, and what moves them.** H1, H5, H8, H13, H15, H19, H20, H26, H28, H32, H33, H34.
The register names three owner facts that move the most rows — OI-03(a), OI-06, OI-15 — and one
test — the observed morning. Nothing read for this file changes that ordering.

**New hypotheses the C-wave and leaf dossiers put on the table** (candidates for the register,
not yet numbered; each is phrased in a dossier's §M and cited there):
- Configuration-as-answer is trusted faster than cited prose (TradingView M3; C6-01 §4).
- A "why is it moving" surface earns trust through its negative answers (C6-01 §3).
- Metering saved configuration converts better and churns less than gating data (UW M-1).
- Degrading the free tier by freshness beats degrading it by feature where value decays with time
  (UW M-6).
- A percentile SLA per rail makes "degraded" a state distinct from "up" and "down" (Quartr M5).
- A saved prompt plus a publication trigger is a higher-value personalisation primitive than
  another layout knob (Quartr M2; AlphaSense M7).
- Document arrival as an alert type is the cheapest desk-relevant tripwire not yet built (Koyfin
  M6; C2-01 §6).

**Provisional stamp.** The register recommends that Day-4 ARCH artifacts be stamped PROVISIONAL
pending C5-03. This file extends that: anything in §12.1 is provisional pending one query of
`charts_workspace_layout` and one popout spike.

---

## 16. Decisions forming

Two owner decisions stand; the rest are forming and are labelled as such.

**Standing.**
- **D-001 — desk-first.** Reinforced by every Day-1 artifact: the licensing arithmetic (§9), the
  fixed-cost block (§8.7), the desk persona no vendor serves (§4.2 point 6), and the benchmark
  evidence that a command grammar makes an expert fast and does not make a newcomer stay (C4-01
  anti-pattern 12).
- **D-002 — member-facing raw vendor display is Restricted-pending-contract;** assume Massive
  Individual and no FMP DDLA. Escalated; the two OI-03 facts are the only thing that changes it.

**Forming (not decided; each names the artifact that would decide it).**
1. **Decisiveness posture for two audiences.** Decisive-with-receipt for the desk; balanced with
   the same receipt for a stranger; never a hedge appended to a kept fabrication (C6-02 §6
   anti-pattern). Decides at: GOVERNING_PRINCIPLES revision, informed by §13.4.
2. **Provenance rendering as a shared component every AI surface must use.** Decides at: ARCH-05.
3. **Addressable computed metrics before a citation renderer.** Decides at: C7-03's canonical
   data model.
4. **Server-side auth on every data endpoint as Tier S.** Decides at: ARCH-06 (R-17). Production
   remediation is the owner's normal-session call, not this program's.
5. **Population cap before any member-facing AI lane.** Decides at: ARCH-05 (R-18).
6. **Design the workspace document first; keep the portal popout property; FDC3 vocabulary not
   container.** Decides at: C5-03, after the table query and the spike.
7. **An internal permanent entity id with a dated ticker alias list.** Decides at: C7-03 / ARCH
   data model.
8. **Adjustment as a labelled policy with a detected → confirmed → applied pipeline.** Decides at:
   the same.
9. **`/calendar` deep link honour-or-301; plumbing rename only with a read-fallback shim.**
   Decides at: whatever ARCH item retires or absorbs TERMINAL-CURRENT (D-09's 32-item list is the
   checklist).
10. **Retire or consolidate the seven provider candidates against Massive's under-used
    capabilities.** Decides at: F-09 (DL-022) with the owner's A–G taxonomy.
11. **Derived counts only.** A rail, not a decision: no hand-typed count in any member-facing or
    program artifact. Decides at: GOVERNING_PRINCIPLES.

Nothing in §11 (product thesis) is listed here. It is not forming; it is emerging.

---

## 17. Questions that no longer deserve further research

Each with the reason it is closed and where the answer lives.

1. **"Can the Bloomberg grammar be built in a browser?"** Yes — Gödel did it (§5). Closed; the open
   question is *whether the desk wants it*, which is an observation, not research.
2. **"Which competitors have AI, and how is it grounded?"** Mapped for twelve products (C6-01 §0)
   and the five mechanisms are ranked (§2 there). Further reading without a seat adds nothing;
   only a logged-in session moves the 🟡s.
3. **"Which layout library draws the best grid?"** All seven draw a grid; none versions the
   document (C5-01 §8). The question is the schema, not the library.
4. **"Does Bloomberg link by colour group?"** No, on every source reached (§13.6). Stop citing it.
5. **"Is it Eikon or Workspace?"** Eikon was withdrawn 2025-06-30. Use LSEG Workspace.
6. **"What does a FactSet / LSEG / AlphaSense / Capital IQ seat cost?"** Unreachable by design; every
   public figure is excluded-tier. Close Section L of those dossiers at 🔴 unless the owner obtains
   a quote.
7. **"What is SpotGamma's Synthetic OI methodology?"** Deliberately undisclosed; no public source
   will close it (SpotGamma GAPS).
8. **"Is there a desk-only licensing escape at Massive / FMP / Finnhub?"** No (§9.3).
9. **"Do users customise workspaces?"** Unanswerable from public sources (C5-01 §6, a negative
   result recorded as evidence about reachability). Only UCT's own table answers it. Stop reading;
   run the query.
10. **"What were Fintool's grounding mechanics?"** Unrecoverable; the product pages are gone behind
    the Microsoft redirect (C6-01 §7).
11. **"Are practitioner forums a source for Bloomberg?"** The top public pages are AI-generated and
    carry a verified factual error (B-BBG-02 §9). Discard the channel for this vendor.
12. **"What does `CLAUDE.md` say?"** It is a claims document, stale in at least five named places.
    Read it for hypotheses; verify against code or the derived ledgers.
13. **"Is the wire paid?"** No (§13.1). Closed.
14. **"How many services are there?"** Five (R4). Closed.
15. **"Does any vendor publish an AI accuracy or refusal metric?"** None found across the set
    (C6-01 §1 open question, answered negatively). Every number located is a benchmark self-report
    or a testimonial.

---

## 18. Questions requiring deeper investigation

Ranked, each tied to a critical-path item or scoreboard red, with the instrument that answers it.

1. **The desk's morning, 06:30–10:00 CT, observed once.** Moves Q8, Q10, Q26, H21, and the grammar
   fork (§11 Temptation 1). Instrument: the owner records or narrates one session (OI-06). Ties to
   CP-01/CP-02.
2. **OI-03(a) Massive tier and OI-03(b) FMP DDLA.** Moves 57 licensing rows and D-002. Instrument:
   two owner facts. Ties to CP-03 (🔴, owner-bound).
3. **One telemetry read** — `page_views`, `calendar_seen`, `calendar_alerts_fired`,
   `ai_search_log`. Moves Q18, Q36, Q37, and P-δ. Instrument: the owner runs four queries against
   a copy of `auth.db`. Ties to the Business reds.
4. **One query of `charts_workspace_layout`** — fraction of members with a row; widget-count and
   distinct-type distribution; rows byte-identical to a shipped template. Moves H1, H5, Q2, R-07.
   Ties to C5-03.
5. **The popout spike** — does a dock library's popout preserve the opener's React tree? Moves
   §12.1's build-versus-adopt. An afternoon. Ties to C5-03.
6. **The capacity envelope** — p50/p95 on the live pod's hot paths; the SSE pool's real fan-out.
   Moves R-04 and every streaming implication. Ties to CP-06 (🔴→🟡) and D-05.
7. **The unauthenticated route sweep** — every `/api/*` data route from D-02's table, tested
   read-only. Moves R-17's scope from four routes to a list. Ties to A-06 / ARCH-06.
8. **Adjustment scope on the fallback path** — does yfinance's series include dividend adjustment?
   Instrument: one known dividend-paying non-splitting name compared across the two sources
   (C7-02 §3.1). Ties to C7-03.
9. **F-09 provider master ledger** with the owner's A–G taxonomy (DL-022). Moves H3 and the
   retirement decisions. Ties to the next wave.
10. **Whether `sec_filings.py` polls on a schedule or only on request.** Sizes the cheapest alert
    idea in the set (C2-01 §6). One file read outside C2-01's allowlist.
11. **The actual AI ledger.** E-06 read the Console second-hand; no lane's spend was measured.
    Instrument: the owner's Console export. Ties to R-18 / ARCH-05.
12. **Cheap seats** — the owner's TradingView account (AI Screener with an ambiguous prompt; a
    cold-load waterfall on a 16-chart layout), a free Koyfin login (shortcut collision policy;
    summary citations), Gödel's 14-day trial (does `AAPL DES` compose?). Each is minutes and each
    lifts a dossier section from 🔴.
13. **`IMPLIED_ENRICHMENT_CUTOVER` state in production.** Determines the enrichment cliff's real
    cost on TERMINAL-CURRENT today. Instrument: a Railway variable read (staging semantics
    noted).
14. **Bloomberg ASKB** — the most consequential AI product in the set and the least evidenced.
    Instrument: OI-08 access, or a library-bookable Terminal hour. Stays 🟡 otherwise.

---

## 19. Critical path

State at Day-1 close, from `00-program-control/CRITICAL_PATH.md`:

- **CP-01, CP-02, CP-04, CP-05, CP-07, CP-08, CP-10, CP-11 — 🟡.** Evidence gathered; each waits on
  either an owner input or a Wave-2 role.
- **CP-03 — 🔴, owner-bound.** The 118-row register is complete; the answer is two facts away
  (81 → 27 if both favourable). Nothing the program can do moves it.
- **CP-06 — 🔴 → 🟡.** The capacity envelope has a measurement plan (D-05) and no measurement.
- **CP-09, CP-12 — 🔴, start on approval.**
- **Gate B (§27A) — NOT OPEN.**

**Tier-1 items, in this file's reading.**
1. CP-03 licensing — because member scope cannot be designed against 81 Restricted rows, and
   because R-14 and R-17 mean the exposure is present-tense.
2. CP-06 capacity — because every architecture implication in §12.2 is a guess until the envelope
   is a number.
3. The observed morning (CP-01/02) — because three of seven reds and the grammar fork depend on it.
4. C5-03 workspace decision — gated on one table query and one spike (§18 items 4 and 5), and
   the place R-07 either holds or does not.

**What is on the critical path that was not on it at Day 0.** The computed-metric address book
(§12.3, C7-03): every reader-side citation idea in the benchmark set is blocked on it, and it was
not a named deliverable before the C-wave.

---

## 20. Recommended Wave 2 / Wave 3 priorities

Concrete and ranked. Items 1–5 are owner actions measured in minutes to an hour; 6–12 are role
dispatches.

1. **Owner: answer OI-03(a) and OI-03(b).** Two facts; 57 register rows; D-002.
2. **Owner: one observed morning (OI-06).** Narrated or recorded; the program transcribes.
3. **Owner: four telemetry queries** against a copy of `auth.db` — `page_views`, `calendar_seen`,
   `calendar_alerts_fired`, `ai_search_log` — plus the `charts_workspace_layout` distribution.
4. **Owner: the AI Console export** (actual spend by lane) and a normal-session look at R-16 and
   R-17.
5. **Owner: three cheap seats** — TradingView (existing account), Koyfin free, Gödel trial — with
   the specific probes in §18 item 12.
6. **Dispatch F-09** provider master ledger (DL-022) with the A–G taxonomy, consuming §8.
7. **Dispatch D-05** capacity envelope with explicit DATA_DIR / AUTH_DB_PATH pins from
   `conftest.SHARED_DATA_ENV_PINS` (R-15), never the :8077 recipe.
8. **Dispatch the popout spike** (C5-03 pre-work): mount N real widgets in dockview and FlexLayout;
   test whether a popped window shares the opener's SSE pool.
9. **Dispatch C7-03's metric address book**: the ten figures a desk answer most often states, each
   with id, as-of, inputs, calculation version — or the named reason it has none.
10. **Dispatch A-06** with D-02's route table: the full unauthenticated `/api/*` data-route list,
    read-only.
11. **Dispatch the GOVERNING_PRINCIPLES revision** carrying H14, H23, H29, H35 as constraints, the
    decisiveness-for-two-audiences decision (§16.1), and the derived-counts rail.
12. **Dispatch C5-03** only after items 3, 8 and 11 land; stamp any earlier ARCH artifact
    PROVISIONAL.
13. **Wave 3 (after the above):** three independent ARCH proposals (R-07's mitigation) on a
    measured envelope, a collapsed licensing register, an observed desk, and a metric address
    book — not before.

**What to reallocate away from.** Further external reading on any vendor already at its ceiling
(§17 items 2, 6, 7, 9, 11); any additional archaeology of `CLAUDE.md` claims (derive from code or
the ledgers instead); any new dossier on a product not in DL-017's validated universe.

---

## 21. Deadline health

**YELLOW.**

*Why not GREEN.* Three of the seven scoreboard reds and CP-03 are owner-bound and cannot be moved
by dispatching more agents; the three-pause-per-session cadence (R-19; observed resets at 4:20am,
10:40am and 4pm Chicago) truncates full-parallel waves roughly every two to four hours, and the
Sonnet-default tiering (DL-020) that limits premium-model exposure per pause also means the
highest-consequence syntheses queue behind the pause window; the WebSearch cap was exhausted
before most Wave-1b roles ran (DL-018), so the leaf dossiers reached their ceilings on WebFetch
and a single browser tab each; and the capacity envelope (CP-06) has a plan but no number.

*Why not RED.* Day 1 closes with every planned artifact accepted; the licensing register is
complete and its sensitivity to two facts is arithmetic; the benchmark universe was validated
(DL-017) and every dossier carries a named ceiling rather than an inferred fill (R-02's DISCARD
rule fired on none); the internal estate is mapped to route, table, job and flag level; the
hypothesis register is live; and the highest-value next steps are owner actions measured in
minutes, not agent-weeks.

*The reallocation rule applies:* YELLOW means more parallelism, not less quality. The Wave-2
dispatches in §20 items 6–12 are independent of one another and of the owner inputs, and can run
in one wave between pauses. What they cannot do is open Gate B; only items 1–3 do that.

*Watch item.* If OI-03(a) and OI-03(b) are unanswered by the end of Day 2, CP-03 turns the whole
member-scope branch RED and the program should formally re-scope Phase One to desk-only under
D-001 rather than continue designing against 81 Restricted rows.

---

## GAPS

- **This role fetched nothing and observed nothing.** Every claim above is a restatement or a
  cross-reading of an accepted artifact; where an input is 🔴, this file is 🔴 there too.
- **Owner inputs unanswered:** OI-01, OI-03(a), OI-03(b), OI-06, OI-08, OI-10, OI-12, OI-15,
  OI-18. §3, §18 and §20 are organised around them.
- **Not seen running:** any competitor product; any UCT surface in production beyond the Wire
  render recorded by D-09 and the read-only GETs recorded by R-17. The local backend on :8077 was
  not used and is never truth; `C:\data` was not touched.
- **Artifacts read only in part:** none of the assigned inputs; `03-competitive-research/desk-tools/*`
  (finviz, market-chameleon, thinkorswim, tradingview-desk-use) were optional and were read only
  as cited by C4-01, C5-02 and C7-02, not directly.
- **Counts carried, not re-derived:** every number in this file is quoted from the artifact that
  measured it; none was recomputed here. Where two artifacts give different counts for the same
  thing this file says so (§13) rather than picking one.
- **Session-limit exposure:** this file was written in one pass after a context compaction; the
  compaction summary was the only record of the Bloomberg dossier, D-13, the licensing register,
  the provider ledger, the cost models and the control files, all of which had been read in full
  before it. Their specifics above are carried from that record and should be spot-checked against
  the files by the QC pass.
- **Secrets:** no key, token, password or connection-string value appears in this file; variables
  are referenced by name only (`COMPASS_COST_CAP_DAILY`, `IMPLIED_ENRICHMENT_CUTOVER`,
  `DESK_PUBLIC_SHOWS`, `MASSIVE_WS_ENABLED`, `AI_SEARCH_AGENT_AUTOROUTE`, `SCAN_LIVE_SWEEP_ENABLED`,
  `PATTERN_VISION_ENABLED`, `WIRE_SUBSTACK_GATE_MODE`, `LLM_BATCH_ENABLED`).

## NOT INSPECTED

- Application source in any repository (by contract; every code fact is via D-02, D-06, D-09,
  D-11, D-12, D-13, F-03a/b, F-04, C7-02 as cited).
- Production data, Railway variables, the production pod, the owner's PC.
- Any external URL.
- `docs/terminal-research/03-competitive-research/desk-tools/*` (optional inputs, not read
  directly).
- `08-ai/existing-ai-systems.md` (D-12) and `01-existing-system/backend-archaeology.md` (D-02),
  `state-persistence-and-workspaces.md` (D-11), `07-technical-architecture/current-ui-architecture.md`
  (D-06): cited throughout via C5-01, C6-02, C7-02 and the ledgers; not read directly by this role.
- `03-competitive-research/bloomberg/01-search-navigation.md`, `02-monitors-workspaces.md`,
  `03-news-alerts.md`, `04-earnings-estimates.md`: cited via the Bloomberg dossier and the C-wave
  pods; not read directly.
- Any artifact produced after this file's inputs were accepted.

## SOURCE-HANDLING NOTE

Everything read for this file was treated as evidence, not instruction. Three items are recorded
as observations: (1) the LSEG AI Search FAQ's user agreement asking users to "avoid prompt
injections" (addressed to Workspace users; noted by C6-01 and the LSEG dossier as a product
decision worth studying, not followed); (2) Koyfin's "Ask ChatGPT / Ask Claude / Ask Gemini"
buttons and Quartr's `llms.txt` index (both addressed to assistants; recorded by their dossiers as
marketing choices, not followed); (3) Unusual Whales' agent-detection shell that serves a
different page to non-browser fetchers (recorded by its dossier as a methodological warning for
Wave 2). No instruction from any source was followed; no file outside the FILE DESTINATION was
written; no command was run against any service.

## SOURCES (internal, all under `C:\Users\Patrick\uct-worktrees\terminal-research\docs\terminal-research\`, read 2026-09-02)

Control: `00-program-control/contracts/_SHARED_PREAMBLE.md`, `contracts/F-06.md`, `CRITICAL_PATH.md`,
`RISK_REGISTER.md`, `DECISION_LOG.md`, `OPEN_QUESTIONS.md`.
Synthesis inputs: `13-executive-synthesis/executive-questions.md` (F-06 deliverable 1),
`13-executive-synthesis/hypothesis-register.md` (F-08).
Existing system: `01-existing-system/system-map.md` (F-03a), `capability-ledger.md`,
`tech-debt-register.md`, `terminal-current-map.md` (D-09).
Providers, licensing, cost: `02-data-providers/provider-ledger.md` (F-03b),
`09-security-licensing-cost/licensing-register.md` (F-04), `cost-model-data.md` (E-05),
`cost-model-ai-infra.md` (E-06).
Strategy and domain: `05-product-strategy/proprietary-asset-inventory-raw.md` (D-13),
`05-product-strategy/domain-news-intelligence.md` (C2-01),
`06-ux-and-information-architecture/workspace-systems-survey.md` (C5-01), `command-grammars.md`
(C4-01), `personalization-patterns.md` (C5-02), `07-technical-architecture/domain-data-platform.md`
(C7-03), `domain-symbol-master-time.md` (C7-02), `08-ai/ai-native-tools-survey.md` (C6-01),
`grounding-architectures.md` (C6-02).
Competitive: `03-competitive-research/benchmark-universe.md` (B-VAL-01), `bloomberg/dossier.md`
(B-POD-BBG), `godel/dossier.md` (B-POD-GDL), `adjacent-notes/dossier.md`, `alphasense/dossier.md`,
`benzinga-pro/dossier.md`, `factset/dossier.md`, `finchat/dossier.md` (Fiscal.ai),
`koyfin/dossier.md`, `lseg-workspace/dossier.md`, `quartr/dossier.md`, `spotgamma/dossier.md`,
`tradingview/dossier.md`, `unusual-whales/dossier.md`.
