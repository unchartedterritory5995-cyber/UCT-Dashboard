---
id: C7-02
title: Symbol master, corporate actions, time and session model
role: C7-02 — domain pod (symbol identity, corporate actions, market clock)
wave: 2
group: C
category: domain
scope: Identifier schemes, ticker changes, share classes, delistings, adjustment conventions, market calendar and sessions, timezone handling, earnings time normalization, TBD events
confidence: 🟡 overall
evidence_ceiling: Vendor symbology manuals (Bloomberg BSYM/DL, Refinitiv PermID enterprise docs, FactSet SPRI, Wall Street Horizon feed spec) remain behind sales gates or subscriber logins — unreached in both wave 1b and this completion pass. WebSearch was exhausted session-wide before this role ran (see the preamble); this pass used WebFetch on known URLs (vendor docs, exchange pages, standards-body pages, GitHub) per the Search-budget fallback order, which reached primary/official sources for identifiers, one vendor's own adjustment API (the vendor UCT itself uses), one exchange's own session/holiday page, and one open-source calendar library's own README. No browser-tab search was needed — every URL attempted was reached directly or via one redirect. Still unreached: CRSP/academic delisting-return methodology, SEC EDGAR ticker-change disclosure practice, yfinance's own adjustment-parameter documentation (JS-rendered, two fetch attempts both returned only navigation chrome), and ANNA's own site (isin.org used as a proxy, itself ANNA-affiliated but not cross-checked against ANNA directly).
sources: 13 primary (official vendor/exchange/standards-body docs + open-source project README, fetched this pass) + 4 internal program artifacts + 6 external observations reused with attribution from wave-1b competitive dossiers (not independently re-fetched this pass, tier and verification status preserved from the citing dossier)
uct_relevance: high
status: draft
date: 2026-09-02
---

# C7-02 — Symbol master, corporate actions, time and session model

> **Scope note.** This file is a DOMAIN report: the patterns a purpose-built financial
> workstation needs underneath every surface, whichever product it borrows from. It is
> not a specification. Benchmarks are learning, never requirements.
>
> **Two internal sources were in contract** and are cited as INTERNAL evidence (tier:
> internal program artifact, not external): `01-existing-system/backend-archaeology.md`
> (D-02) and `01-existing-system/terminal-current-map.md` (TERMINAL-CURRENT map).
> Everything they assert about production flag state is CLAIM, per their own frontmatter.
>
> **Completion-pass note (2026-09-02).** Sections 0–1 below are the prior pass's
> internal-baseline work, kept verbatim. Sections 2–5 are new: external patterns for
> the same four headline claims, gathered under the reduced search budget described
> in `evidence_ceiling` above. Section 6 closes the loop between the two halves.

---

## 0. HEADLINE — the four claims this file defends

1. **A symbol master is a *bitemporal* store, not a lookup table.** The identifier schemes
   in industry use (FIGI, ISIN, CUSIP, CIK, exchange tickers) each answer a *different*
   question, and the one designed to be permanent — FIGI — is deliberately the one that does
   NOT change on a corporate action, which is exactly why a ticker-keyed system silently
   mis-joins history. The design question is not "which id do we use" but "what is the
   entity whose identity we are asserting, and as of when".
2. **Adjustment is a *presentation* decision that must be stored as a *policy*, not baked
   into stored bars.** UCT already has the scar tissue: an unadjusted-vs-adjusted mismatch
   presents as "stale intraday" and is handled by a *fallback provider swap* rather than an
   adjustment model (INTERNAL, §1.7).
3. **The market clock is a first-class dataset with its own vendor problem.** Sessions,
   half-days, holidays and the pre/post boundary are not derivable from a timezone database;
   they come from exchange notices, and open-source calendars encode them at a known cost.
4. **"TBD" is a data value, not an error.** UCT's own calendar already treats ~10 % of past
   Finnhub rows with no `hour` as an honest **Time TBD** bucket rather than a bucketing bug
   (INTERNAL). Any events surface that cannot represent *unknown time* will either fabricate
   a time or drop the row — and dropping reads to a member as "a quiet day".

---

## 1. WHAT UCT DOES TODAY — the internal baseline (INTERNAL evidence)

This section exists so the external patterns below can be scored against a real starting
point instead of a blank page. Everything here is sourced to the two in-contract internal
reports; no application code was read.

### 1.1 There is no symbol master

**OBSERVATION.** The backend has a **ticker-search** and a **ticker-meta cache**, not a
symbol master. `api/routers/ticker_search.py` and `ticker_meta.py` sit in the
"Charts / bars / tickers" router family (14+ routes) alongside `bars.py`, backed by
`bars.db`, a disk cache, and Massive/yfinance/FMP. The membership set is a static file —
`cap_universe` out of `wire_data` — used as a **gate**, not as an identity registry.

**EVIDENCE.** INTERNAL — `01-existing-system/backend-archaeology.md` §3.2 (router census
table, "Charts / bars / tickers" row); §7 layer 5 (`ticker_meta_cache` as a disk cache on
`/data`). Read 2026-09-02. Tier: internal program artifact. **verified** (against the
report, which is itself AST-derived for the census).

**INTERPRETATION.** Three consequences follow mechanically from "the ticker string is the
key":
- **No ticker-change history.** A renamed symbol's past bars live under the old string with
  nothing pointing at them; a delisted symbol's rows simply stop.
- **No share-class model.** Class A and Class B are two unrelated strings.
- **The universe file is a second authority on "does this symbol exist".** INTERNAL records
  the gate's live failure mode: `tbd` entries skipping the `cap_universe` gate let
  sub-$300M Finviz names into the current week and thence into `calendar_alerts` and the
  ICS feed, while range weeks filtered them — described in-repo as *"the exact
  count-incomparability class this redesign exists to kill"* (TERMINAL-CURRENT §2).

**CONFIDENCE.** 🟢 that no symbol-master module is named in the archaeology; 🟡 that none
exists anywhere (the archaeology explicitly reports selective reading and carries a GAPS
section).

### 1.2 Dual-class symbology is handled at ONE provider boundary, by string rewrite

**OBSERVATION.** `massive.to_polygon_symbol()` maps `BRK-B` → `BRK.B` **at the Massive REST
boundary only**; the cache, FMP and yfinance legs keep the hyphen form.

**EVIDENCE.** INTERNAL — repository `CLAUDE.md`, "Bars Freshness & Reliability
Architecture". ⚠️ The archaeology treats `CLAUDE.md` as a **CLAIMS document** throughout and
TERMINAL-CURRENT §10.1 records five specific places it is already stale, so this is
**claimed**, not verified. Its *shape* is corroborated by the industry pattern in §2.3.

**INTERPRETATION.** This is the correct *tactic* (normalize at the adapter, not in the core)
at the wrong *altitude*: it is one function for one vendor rather than a symbology layer.
A second vendor with a third convention (`BRK/B`, `BRK B`, `BRKb`) needs a second function,
and nothing forces the two to agree. See §2.3 for the canonical-plus-alias-table pattern.

### 1.3 The time model is thirty-five lines, and it is session-anchored on purpose

**OBSERVATION.** `app/src/pages/calendar/calendarTime.js` is **35 lines and is the entire
timezone model** of TERMINAL-CURRENT:
- `todayIsoEt()` — the ET calendar date via `Intl.DateTimeFormat('en-CA', {timeZone:
  'America/New_York'})`, **never the browser's date**;
- `etHour()` — ET hour 0–23, taken `% 24` because WebKit renders midnight as `"24"`;
- `inPrintWindow()` — `h >= 16 || (6 <= h < 10)` ET;
- `isReportingNow(entry)` — **session-anchored, never a clock time**: BMO window 06:00–09:59
  ET, AMC 16:00–20:59 ET, TBD matches either.

The file's own header states the reason: ***"no clock times exist from any provider."***

**EVIDENCE.** INTERNAL — TERMINAL-CURRENT §1.3, which cites the file and quotes its header.
Read 2026-09-02. **verified** (against the report).

**INTERPRETATION.** This is the single most transferable decision in the internal corpus.
Earnings feeds publish a *session bucket* (before open / after close / during market /
unspecified), not a timestamp; a UI that renders "7:05 AM" asserts precision the source
never had. UCT resolved this by making the **session the unit** and defining windows around
it — which also makes "is this reporting now" answerable without a clock the provider never
sent.

**RELEVANCE TO UCT.** Directly reusable by TERMINAL-NEXT's events surface; it is the
concrete implementation of §5.1's session-code pattern.

**CONFIDENCE.** 🟢.

### 1.4 The week anchor is one decision implemented twice, deliberately, with a rail

**OBSERVATION.** `_current_week_monday()` (`api/routers/calendar.py:104`) = *"the ISO Monday
of the next session day"* — identity on a weekday, **rolls FORWARD on Sat/Sun**. The
frontend derives the same rule in `app/src/pages/calendar/weekAnchor.js::currentWeekMonday`,
and `tests/test_calendar_week_anchor.py` **executes both implementations and compares them
on every day of the week**. The paging horizon is ±52 weeks (`_WEEK_HORIZON_WEEKS`); beyond
it the API returns `source: "out_of_range"`.

The bug this exists to prevent is recorded in the docstring: a second, contradictory
frontend rule (`mondayOf(todayIso())`, which snaps BACK) made "Next week ▶" a visual no-op
and "◀ Prev week" skip a week — **every weekend**.

There are **two named week intents**, not two hand-rolled Monday derivations: the /charts
`CalendarWidget` wants *"the week of the most recent session"* (`lastSessionDay`), the
calendar wants *"the current-or-upcoming week"* (`currentWeekMonday`). **On a Saturday they
are seven days apart.** An AST rail (`CalendarWidget.weekIntent.test.jsx`) traces both back
to an import from `weekAnchor` and **fails on anything locally declared**.

**EVIDENCE.** INTERNAL — TERMINAL-CURRENT §1.3, §6.2. Read 2026-09-02. **verified**.

**INTERPRETATION.** ⭐ The pattern worth naming: **a calendar has more than one legitimate
"now", and the fix is to name each intent and centralize the derivation — not to pick one.**
A boolean cannot carry two intents; INTERNAL §10.3 item 6 records that `is_current_week`
*"says the opposite of what it reports"* on weekends and was **deliberately not renamed**
because tests and fixtures name it — a live trap for any new reader, and a direct argument
for naming intents at birth rather than after the fixtures harden.

**CONFIDENCE.** 🟢 — rail-backed on both sides per the internal map.

### 1.5 Date drift is already a shipped, competitively-framed feature

**OBSERVATION.** `api/services/calendar_date_integrity.py` maintains
`calendar_date_history(sym, report_date, prev_date, first_seen, updated_at)` PK `(sym)` on
`/data/calendar_dates.db`, fed from the **same Finnhub/FMP payloads the calendar already
fetches** (no new provider) plus `earnings_table._next_report_date`. It surfaces as a
**"Date moved Jul 28 → Aug 4" chip** (`DateMovedChip`). The file names its competitive
frame explicitly: *"Wall Street Horizon sells exactly this to institutions: a wrong or
shifted earnings date burns options traders every quarter, and no retail product flags
it."* Admin diagnostic: `GET /api/admin/calendar-date-integrity`.

**EVIDENCE.** INTERNAL — TERMINAL-CURRENT §2; backend-archaeology §3.3 (admin diagnostics
list, AST-derived). Read 2026-09-02. **verified**.

**INTERPRETATION.** This is a **corporate-action-adjacent temporal ledger built on a
single-row-per-symbol PK**. `PK (sym)` stores the *previous* date, not the *history*: it
answers "did this move once" and cannot answer "how many times has this issuer moved its
date, and does it habitually". That is a defensible v1 scope, and it is the natural seam
where an event-history table (§4.2) slots in.

### 1.6 One placement per symbol per week — the reconciler invariant

**OBSERVATION.** ⛔ **ONE PLACEMENT PER SYMBOL PER WEEK, across ALL days**
(`calendar.py:1174`; rail `tests/test_calendar_forward_week_coverage.py:128`). Providers
disagree about dates for the week ahead — measured on the live week of 2026-08-17: **EW had
XP on Monday while FMP projected Tuesday; Finnhub put ROST on Wednesday against EW's
confirmed Thursday.** A per-day dedup renders the company **twice in one week**. The FIRST
placement wins, and the live schedule's placements are seeded before any supplementary leg
runs, **so a confirmed date always beats a projection**.

**EVIDENCE.** INTERNAL — TERMINAL-CURRENT §2. Read 2026-09-02. **verified**.

**INTERPRETATION.** ⭐ This is the *precedence rule* every multi-vendor events system needs,
expressed as a uniqueness invariant rather than as a merge heuristic. "Confirmed beats
projected" is the industry's own distinction (§5.1), and encoding it as *seed order* makes
it structural rather than a comparison somebody can forget to write.

### 1.7 Adjustment appears only as a *symptom*, never as a model

**OBSERVATION.** The bars layer detects "stale intraday" via `_is_intraday_stale()`, which
**checks whether Massive data is >5 days old — explicitly to catch *pre-split bars*** — and
falls back to yfinance because yfinance is *split-adjusted*. A separate one-shot heal
module, `bars_split_repair`, exists in the services inventory.

**EVIDENCE.** INTERNAL — repo `CLAUDE.md` (**CLAIMS** document) for `_is_intraday_stale`;
backend-archaeology §4.2 names `bars_split_repair` in the services inventory
(**verified**). Read 2026-09-02.

**INTERPRETATION.** A split is being handled as a **freshness anomaly routed to a different
vendor**, not as a corporate action applied to a series. That works exactly until two
vendors disagree about the adjustment *policy* (§3) rather than the adjustment *fact*, at
which point the fallback silently changes the numbers on the chart. This is the largest gap
between the internal baseline and the patterns in §3, and the one with the quietest failure
mode.

**CONFIDENCE.** 🟡 — the mechanism is claimed by a stale-prone document; the *existence* of
a split-repair service is verified.

---

## 2. EXTERNAL PATTERNS — Identifier schemes

### 2.1 FIGI: the identifier UCT does not use, deliberately designed to survive what UCT's ticker key cannot

**OBSERVATION.** The Financial Instrument Global Identifier is a 12-character code
(2 provider chars + `G` + 8 random-excluding-vowels chars + 1 check digit) issued as a
free, open standard. Its defining property, stated in its own documentation: **"Once a
FIGI is assigned, it never changes throughout the trade lifecycle."** If the instrument
stops existing, the FIGI is retired and never reused, but stays resolvable — it does not
disappear. The standard is issued by the Object Management Group (an international
nonprofit standards body), with Bloomberg as the Registration Authority, and the mapping
dataset is distributed "under the MIT Open Source license at no cost and as a public
good."

**EVIDENCE.** `https://www.openfigi.com/` and `https://www.openfigi.com/about/figi` —
Tier: official standards-body/product documentation. Fetched 2026-09-02. **verified**
(direct quotes above). The page did not explicitly address how a composite (multi-exchange)
FIGI relates to an exchange-level or share-class-level FIGI — **NOT DETERMINED** from this
page; would need OpenFIGI's mapping-API reference, not fetched this pass.

**INTERPRETATION.** FIGI is the industry's answer to exactly the failure mode UCT's own
`backend-archaeology` names in §1.1: a ticker-keyed store cannot represent "this is the
same company, a different string, as of a date." FIGI's design choice — permanence THROUGH
a rename, THROUGH a delisting, with the old identifier still resolvable rather than
overwritten — is the structural fix, not a UI fix. It is free and MIT-licensed, which
removes the usual objection (identifier schemes are normally a paid vendor lock-in, per
CUSIP's licensing history).

**RELEVANCE TO UCT.** UCT does not need to adopt FIGI as a user-facing identifier (traders
think in tickers, not 12-character codes) — the transferable idea is the *property*, not
the *code*: a symbol master needs one column that is guaranteed stable across a rename and
a second, mutable column (the ticker) that maps to it *as of a date range*. UCT's `cap_universe`
gate and `ticker_meta_cache` are both keyed on the mutable column today (§1.1).

**CONFIDENCE.** 🟢 on the quoted properties; 🟡 on how FIGI resolves share classes (gap
above).

**RECOMMENDATION (hypothesis).** *If* TERMINAL-NEXT ever builds a real symbol master, the
permanent-key/mutable-alias split — not necessarily FIGI itself, which UCT has no vendor
relationship for — is the shape to copy: one internal entity id, a dated history of ticker
strings that pointed at it, and every downstream table (bars, watchlists, alerts) foreign-
keyed to the entity id, never the ticker string.

**OPEN QUESTION.** Does UCT's own data vendor (Massive/Polygon) expose FIGI or any
permanent identifier per instrument in its reference-data endpoints? Not checked this pass
— would settle whether UCT could adopt the pattern via an ID it already has access to,
versus building one from scratch.

### 2.2 ISIN/CUSIP: a two-tier national-numbering-agency hierarchy, and it is silent on renames

**OBSERVATION.** An ISIN is three parts: a 2-letter ISO 6166 country code, a 9-digit
National Securities Identifying Number assigned by that country's National Numbering
Agency, and a check digit. National Numbering Agencies are coordinated internationally by
ANNA (the Association of National Numbering Agencies). For the US and Canada, **"ISINs are
built upon CUSIP numbers"** — the ISIN wraps the existing CUSIP rather than replacing it.

**EVIDENCE.** `https://www.isin.org/isin/` — Tier: registration-authority-affiliated
reference page (not independently cross-checked against ANNA's own site this pass).
Fetched 2026-09-02. **verified** (direct quotes above) for structure and CUSIP relationship;
**NOT DETERMINED** whether an ISIN or CUSIP changes on a ticker rename or delisting — the
page does not address it, and this was not resolved elsewhere this pass.

**INTERPRETATION.** ISIN/CUSIP is the identifier layer UCT is most likely to actually touch
(via a data vendor's reference tables, or Koyfin-style CSV import — see §2.3), and it is a
*different* axis from FIGI: FIGI is trade-lifecycle-permanent by explicit design statement;
ISIN/CUSIP's permanence through a rename is unstated in the primary source reached here.
Treating "ISIN" and "permanent identifier" as synonyms would be an unverified assumption a
symbol-master design should not make silently.

**RELEVANCE TO UCT.** Two of the wave-1b benchmark dossiers already show ISIN as a working
identifier in a retail-adjacent product: Koyfin's My Portfolios accepts CSV import "by
ticker **or ISIN**" (`03-competitive-research/koyfin/dossier.md` line 175, verified), and
LSEG Workspace lists ISIN, SEDOL, LEI, CUSIP and PermID among its identifier breadth
(`03-competitive-research/lseg-workspace/dossier.md` line 505, verified). Neither dossier
resolves the rename question either — it was outside their scope.

**CONFIDENCE.** 🟡 — structure and CUSIP relationship are 🟢; rename/delisting behavior is
an open question, not a gap in the source, a genuine unresolved fact.

**RECOMMENDATION (hypothesis).** Do not assume any single vendor identifier is
rename-proof without checking that vendor's own documentation — the property that matters
(§2.1) is explicit in FIGI's docs and unstated in ISIN's. A symbol master built on a
vendor ID should verify the permanence claim for that specific vendor rather than
inheriting FIGI's reputation by association.

### 2.3 Exchanges do not agree with themselves on share-class notation — and Bloomberg's fix is to accept every scheme in one input slot

**OBSERVATION.** Nasdaq's own trader-facing documentation defines **four different suffix
conventions for the same concepts** (CQS, CMS, NASDAQ Integrated Platform, ACT/CTCI), and
they disagree with each other on the same instrument: a preferred share is `p` in one
convention and `PR` in another; a Class A/B share is `.A`/`.B` in CQS/Integrated notation
but bare `A`/`B` in CMS notation. This is Nasdaq documenting its *own* internal
inconsistency, not a cross-vendor gap.

Separately, Bloomberg's terminal grammar (`TICKER <MARKET SECTOR> FUNCTION <GO>`) accepts
CUSIP, ISIN or BBGID interchangeably in the ticker slot — `931142DD2 <CORP> <GO>` loads a
security by CUSIP with no different syntax than a ticker load.

**EVIDENCE.** `https://www.nasdaqtrader.com/Trader.aspx?id=CQSSymbolConvention` — Tier:
official exchange documentation. Fetched 2026-09-02. **verified** (direct examples above).
Bloomberg grammar cited via `03-competitive-research/bloomberg/01-search-navigation.md`
(lines 195–222) and `dossier.md` §C.1 — original tier: official Bloomberg PDFs + Cornell
University library guide, **verified** by that wave-1b role; not independently re-fetched
this pass.

**INTERPRETATION.** UCT's own `to_polygon_symbol()` (INTERNAL §1.2: `BRK-B` → `BRK.B`, one
function, one vendor boundary) is solving a real problem — the industry genuinely has no
single share-class notation, confirmed here from the exchange's own documentation, not
just observed as a UCT symptom. The fix at *industry* scale is not "pick the right
convention," it's Bloomberg's: make the *input layer* accept any recognized scheme
(ticker, CUSIP, ISIN, BBGID) and resolve internally to one canonical entity, rather than
propagating a single vendor's string format through the system.

**RELEVANCE TO UCT.** This is the direct external corroboration for the interpretation
already reached in §1.2: `to_polygon_symbol()` is correct in kind, wrong in altitude (one
function for one vendor rather than a symbology layer with a canonical form + an alias
table per vendor). The alias-table shape, not a rewrite function per vendor pair, is what
scales past two vendors.

**CONFIDENCE.** 🟢 on Nasdaq's own four-convention disagreement (directly quoted from its
own docs); 🟡 on how many other exchanges have the same internal inconsistency (not
checked — Nasdaq only).

**RECOMMENDATION (hypothesis).** Any TERMINAL-NEXT ticker-input box should accept multiple
schemes in one field (ticker, and where UCT's vendors expose it, CUSIP/ISIN) and resolve
to one canonical internal symbol, rather than teaching users "our" notation. This composes
with §5.2's redirect-on-rename pattern: the resolution step and the redirect step are the
same problem (map an input string to a current canonical entity) solved once.

**OPEN QUESTION.** Does Massive/Polygon (UCT's primary bars vendor) publish its own
canonical symbol list with alias mappings, or does UCT's `to_polygon_symbol()` hand-encode
a mapping the vendor itself could supply? Not checked this pass.

---

## 3. EXTERNAL PATTERNS — Corporate actions and adjustment conventions

### 3.1 UCT's own primary vendor documents split adjustment only — and says nothing about dividends or renames

**OBSERVATION.** Massive (the REST/WS API `api/services/massive.py` calls; Polygon.io now
redirects to `massive.com`, confirming they are the same underlying service) exposes a
single boolean, `adjusted`, on its aggregates/bars endpoint: **"Whether or not the results
are adjusted for splits. By default, results are adjusted. Set this to false to get
results that are NOT adjusted for splits."** The vendor's own worked example: AAPL 1-day
bars spanning its 2020-08-28 4-for-1 split show adjusted opens of 127.14/126.01 versus
unadjusted opens of 508.57/504.05 — exactly 4×. **The documentation does not mention
dividend adjustment anywhere on this endpoint**, and makes **no reference to ticker-change
or other corporate-action handling** on the aggregates API at all.

**EVIDENCE.** `https://massive.com/blog/aggs-api-updates` (reached via a 301 redirect from
`https://polygon.io/blog/aggs-api-updates`) and
`https://massive.com/docs/rest/stocks/aggregates/custom-bars` — Tier: official vendor
documentation, and this is the vendor UCT's own `CLAUDE.md` names as primary for bars.
Fetched 2026-09-02. **verified** (both pages independently returned the same split-only,
no-dividend, no-rename shape).

**INTERPRETATION.** This is the single most consequential finding in this file for UCT
specifically, because it is not a benchmark's vendor — it is **UCT's own vendor**. INTERNAL
§1.7 already found that UCT treats a split as a "stale intraday" symptom routed to a
different vendor (yfinance) rather than an explicit adjustment applied to a series. This
external evidence adds the missing half: **the primary vendor's own adjustment surface is
narrower than the problem** — it only ever claims to handle splits, never dividends, never
symbol continuity across a rename. Any current UCT chart that looks dividend-adjusted is
either not actually adjusted for dividends, or is silently relying on a fallback path
(yfinance) whose own adjustment documentation was not reachable this pass (see GAPS) — a
gap in what is *verified*, not a claim that it is broken.

**RELEVANCE TO UCT.** Directly extends INTERNAL §1.7 (the largest identified gap in the
existing baseline). A member-facing "why did the chart jump" ticket is exactly as likely
to be a *dividend* event (silently unadjusted, since the vendor's own docs never claim to
adjust for it) as a *split* event (which the vendor does adjust for, by default, without
being asked).

**CONFIDENCE.** 🟢 — this is the vendor's own current API documentation, fetched directly,
for the exact vendor and the exact endpoint UCT's `CLAUDE.md` names for bars.

**RECOMMENDATION (hypothesis).** Treat "does this vendor's `adjusted=true` cover
dividends" as a question to answer explicitly and test (a known dividend-paying, non-
splitting stock's chart, compared against a total-return series), not to assume from the
parameter's friendly name. If it does not, TERMINAL-NEXT needs to decide, as a stated
policy, whether it ships price-return or total-return series by default — and label
whichever it ships, the way Bloomberg's `GUID` and `FA` label standardized-vs-adjusted
(§3.3) — rather than leaving the answer to whatever a vendor's boolean happens to compute.

**OPEN QUESTION.** Same as INTERNAL §1.7's open question, now sharpened: when Massive data
is >5 days old and UCT falls back to yfinance "because yfinance is split-adjusted"
(`CLAUDE.md`, claimed), does yfinance's adjustment also cover dividends, and if so, does a
mid-fallback chart silently change adjustment *scope*, not just adjustment *source*? Not
verified this pass — yfinance's own parameter documentation returned only navigation
chrome on two fetch attempts (JS-rendered page); this is a named gap, not an assumption
either way.

### 3.2 TradingView replaced automatic split-guessing with an explicit, user-confirmed corporate-action transaction

**OBSERVATION.** TradingView's Portfolios feature previously detected splits by watching
for anomalous price jumps and auto-applying an adjustment — which misfired on unusual
ratios ("15:14 or 101:100") and applied silently with, in the product's own words, "no way
to see what changed or undo it if the system got something wrong." The 2026-08-24 redesign
replaces this with an explicit flow: a confirmed split (from real corporate-action data,
not price-anomaly inference) surfaces as a suggested transaction — "AAPL split 3-for-1 on
Apr 16, 2026" — that the user must accept before anything changes; all splits live in a
dedicated Splits tab; nothing adjusts automatically in the background anymore. The
product's own framing: **"Stock splits are simple in theory and messy in practice."**

**EVIDENCE.** `https://www.tradingview.com/blog/en/stock-split-handling-in-portfolios-60319/`
— Tier: official product blog. Fetched 2026-09-02. **verified** (direct quotes above).

**INTERPRETATION.** This is the same mistake UCT's own bars layer is currently making,
independently arrived at and then fixed by a different product: detecting a corporate
action from a *symptom in the price series* (TradingView's price-anomaly heuristic; UCT's
`_is_intraday_stale()` >5-day-old check, INTERNAL §1.7) is fragile and — TradingView's own
words — "messy in practice," because ordinary data noise and a real split look similar from
inside the price series alone. The fix in both directions is the same: source the
corporate-action *fact* from a structured feed (or vendor corporate-actions endpoint), not
from inference, and apply it as a deliberate, auditable step.

**RELEVANCE TO UCT.** UCT's `bars_split_repair` (INTERNAL §1.7, a one-shot heal module) is
closer to TradingView's OLD behavior (react to a detected anomaly) than its NEW one
(source the confirmed action, make it visible, make it reversible). TradingView's shift
from silent-and-automatic to explicit-and-auditable is directly transferable to a future
`bars_split_repair` redesign, independent of whether TERMINAL-NEXT ever exposes it to a
member the way TradingView exposes a Splits tab to its user.

**CONFIDENCE.** 🟢 — official product blog describing its own current and prior behavior
with dates.

**RECOMMENDATION (hypothesis).** A corporate-action pipeline should have three states, not
one: *detected* (something looks anomalous), *confirmed* (a structured source says a split
happened, with ratio and date), and *applied* (the adjustment is live in what users see).
UCT's current pipeline collapses all three into "vendor swap happens automatically" — the
transferable idea is not "ask the user" (UCT is not TradingView; its trades are placed by
an internal desk and its charts are read-only for members) but "make *confirmed* a distinct,
auditable, admin-visible state before *applied*," mirroring the `calendar_date_integrity`
pattern UCT already ships for date drift (INTERNAL §1.5) — this would be that same idea
applied to price adjustment instead of report dates.

### 3.3 Bloomberg ships raw and adjusted as parallel, explicitly labelled views — never a single silently-chosen number

**OBSERVATION.** Bloomberg's fundamentals screen (`FA`) exposes standardized, adjusted, and
as-reported figures as separate, named views, with the toggle a first-class data-layer
parameter (`FA_ADJUSTED=Y`) rather than a hidden default. Guidance (`GUID`) ships the raw
company-issued figure *beside* "Bloomberg's own adjusted guidance and confidence
intervals," explicitly labelled as Bloomberg's derived series, not presented as the
company's number. Corporate actions have their own dedicated function, `CACS`, separate
from the security's general news/events pages.

**EVIDENCE.** Cited via `03-competitive-research/bloomberg/dossier.md` §C (line 71, 98) and
`04-earnings-estimates.md` (lines 50, 329–331, 386–387) — original tier: official Bloomberg
PDF documentation, **verified** by the wave-1b role that fetched them; not independently
re-fetched this pass.

**INTERPRETATION.** The pattern is not "adjust correctly" — it is "never let a user or a
downstream consumer be unsure which number they are looking at." Every adjusted figure
Bloomberg ships carries its own name and sits beside the unadjusted source, rather than
overwriting it. This is the fundamentals-side twin of §3.1/§3.2's price-side finding: the
industry pattern across both domains is *label the adjustment, don't hide it inside a
default*.

**RELEVANCE TO UCT.** UCT's bars API has exactly one adjustment surface today (whatever
Massive's `adjusted` boolean computes, silently, per §3.1) and no labelled raw/adjusted
pair a member or an internal tool could compare. The `GUID` idiom — ship both, label both —
is a smaller lift than building a full corporate-actions engine and would at least make the
*current* ambiguity visible rather than invisible.

**CONFIDENCE.** 🟡 — reused from wave-1b, official-tier source, not independently
re-verified this pass (per the preamble's reuse-with-citation allowance).

**RECOMMENDATION (hypothesis).** Any adjusted price or figure TERMINAL-NEXT computes or
passes through should carry a visible adjustment-policy label (e.g. "split-adjusted,
2026-09-02" or "as reported") in its own metadata, the way `GUID` labels itself as
Bloomberg's derived series — cheap relative to building an adjustment engine, and it
directly resolves the "which number is this" ambiguity §3.1 surfaces.

---

## 4. EXTERNAL PATTERNS — Market calendar and sessions

### 4.1 One exchange, several session structures — and holidays are published years ahead as a fixed schedule

**OBSERVATION.** NYSE's own hours page documents that its own family of markets does not
share one session shape: NYSE-listed equities run Pre-Opening 6:30 AM → Core 9:30 AM–4:00 PM
ET (with some symbols also carrying Early 7:00–9:30 and Late 4:00–8:00 windows); NYSE Arca
equities open even earlier (Pre-Opening 2:30 AM, Early Trading 4:00–9:30 AM); bonds run a
third shape entirely (Early 4:00–8:00 AM, Core 8:00 AM–5:00 PM, Late 5:00–8:00 PM). Holiday
and early-close schedules are published three years in advance: **"All NYSE markets
observe U.S. holidays as listed below for 2026, 2027, and 2028,"** with early closes
flagged individually (typically 1:00 PM, 1:15 PM for options).

**EVIDENCE.** `https://www.nyse.com/markets/hours-calendars` — Tier: official exchange
documentation. Fetched 2026-09-02. **verified** (times and multi-year publication quoted
above).

**INTERPRETATION.** "The market's session times" is not one fact even for one exchange —
it is a small matrix (asset class × market segment × session type), and the exchange
treats the *schedule itself* as a versioned, multi-year-published artifact rather than
something computed from a timezone plus a simple 9:30–4:00 rule. This directly corroborates
headline claim 3: sessions are a **dataset with a vendor**, not a derivation.

**RELEVANCE TO UCT.** UCT's `calendarTime.js` (INTERNAL §1.3) hard-codes exactly one
session shape (BMO 06:00–09:59, AMC 16:00–20:59, print window 16:00+ / 06:00–09:59) for
earnings-timing purposes, which is the right scope for *that* surface (earnings BMO/AMC is
genuinely binary in a way NYSE's multi-segment equities/Arca/bonds matrix is not) — but a
TERMINAL-NEXT market clock that also needs to answer "is the market open right now" for
trading, alerts, or a session-status indicator cannot reuse the earnings-timing constants
for that purpose; it needs the exchange's own schedule-as-data, including the three-year-
ahead holiday list, as a separate input.

**CONFIDENCE.** 🟢 — official exchange page, directly quoted.

**RECOMMENDATION (hypothesis).** Model TERMINAL-NEXT's market-open/closed indicator and any
alert-timing logic off a versioned holiday+session schedule (ideally sourced or cross-
checked against NYSE's own multi-year-published list) rather than a hand-maintained holiday
array in application code — the same "don't hand-roll what the authority already publishes
years ahead" argument the internal baseline already makes for date drift (§1.5) and
corporate actions (§3.2).

### 4.2 Calendars are shipped as versioned code, not fetched at runtime — and a lunch break is a distinct concept from a holiday

**OBSERVATION.** `pandas_market_calendars`, an open-source Python library covering 50+
exchange and OTC-market calendars, states its own maintenance model explicitly: **"Calendars
and their rules are shipped as package code. pandas_market_calendars does not request
market hours from a server at runtime."** Updates require a new package release. The
library also treats an intraday trading *break* (a lunch pause on Asian exchanges, or a
processing gap on 24-hour futures markets) as a structurally different concept from a
*holiday* — version 1.4 added "the concept of a break during the trading day" separately
from the holiday calendar, and version 4.0 generalized this into an `interruptions_df`
property distinct from both.

**EVIDENCE.** `https://github.com/rsheftel/pandas_market_calendars` — Tier: open-source
project's own README (primary source for the library's documented behavior, not a
third-party description of it). Fetched 2026-09-02. **verified** (direct quote and
version-history claims above).

**INTERPRETATION.** Two transferable ideas, both corroborating headline claim 3. First,
**"versioned code, not a runtime API call"** is a deliberate trade-off: a calendar is
slow-changing enough (holidays are known years ahead, per §4.1) that shipping it as a
release artifact — testable, diffable, reviewable — beats a live dependency on an external
schedule service for every session-boundary check. Second, a **holiday** (no session at
all), an **early close** (a shortened session), and a **break** (a pause inside an
otherwise-normal session) are three distinct data shapes, and a calendar model that
collapses them into one boolean ("is the market open") cannot represent a half-day or a
lunch pause correctly.

**RELEVANCE TO UCT.** UCT's `calendarTime.js` (INTERNAL §1.3) is, in this framing, a
minimal, hand-rolled, single-purpose calendar — correct for its one job (earnings-session
bucketing) but not a general market-calendar dataset. If TERMINAL-NEXT needs a real
open/closed/early-close market-status indicator, the pattern to copy is not "add more
constants to `calendarTime.js`" but "adopt or mirror a versioned calendar dataset shaped
like this one" — separate holiday, early-close, and (for any non-equity surfaces UCT might
add) break data, shipped and reviewed like code rather than computed ad hoc.

**CONFIDENCE.** 🟢 — official project README, fetched directly, with explicit version
history for the design decisions cited.

**RECOMMENDATION (hypothesis).** If/when TERMINAL-NEXT needs true multi-asset session
awareness (options and equities today; the KNOWN FACTS common to all Wave 2 roles name the
internal desk trades both), evaluate reusing an existing open-source exchange-calendar
library rather than hand-extending `calendarTime.js` — the maintenance burden of a correct,
holiday-accurate, multi-exchange calendar is exactly the kind of "someone else already
solved this and ships it as reviewable code" problem the library's own design statement
describes.

**OPEN QUESTION.** Does `pandas_market_calendars` (or its JS-ecosystem equivalents, not
checked this pass) cover NYSE Arca's and the bond market's distinct session shapes from
§4.1, or only the single core-equity session most calendar libraries default to? Would
need to be checked before treating it as a drop-in replacement for anything beyond basic
equity open/close.

---

## 5. EXTERNAL PATTERNS — Earnings time normalization and TBD handling

### 5.1 "Before/after" is anchored to a named trading day, not a clock time, in a product built specifically around earnings timing

**OBSERVATION.** Market Chameleon's earnings-move analytics define their measurement window
explicitly around session buckets, not timestamps: **"the Day of Earnings Trading is the
business day immediately following the earnings release... if AMC, the next business
day."** The product's own worked example measures a move as "AAPL last reported earnings on
Jul 30, 2026 AMC," anchoring every downstream statistic (predicted move, actual move,
historical accuracy rate) to that BMO/AMC-qualified day, never to a report time.

**EVIDENCE.** Cited via `03-competitive-research/desk-tools/market-chameleon.md` (lines 40,
61) — original tier: official product page,
`https://marketchameleon.com/Overview/AAPL/Earnings/Earnings-Option-Strategies/`, fetched
by that wave-1b role 2026-09-02, **verified** for structure/methodology text; not
independently re-fetched this pass.

**INTERPRETATION.** This is external, independent corroboration of headline claim 3 and of
UCT's own §1.3 design (`isReportingNow`, session-anchored, never a clock time): a product
built specifically to measure earnings-driven moves — where getting the day wrong would
directly corrupt its core statistic — chose the same session-bucket anchor UCT already
uses, rather than a timestamp. It is independent validation, not just an analogy, because
this product has the strongest possible incentive (correctness of its paid analytics) to
get the "which day" question right.

**RELEVANCE TO UCT.** Confirms INTERNAL §1.3's design is not a workaround for missing
data but the industry-standard shape for this problem. Nothing to change here; this is a
"keep doing this" finding, cited so a future reader does not "fix" `isReportingNow` toward
clock-time precision the sources never had.

**CONFIDENCE.** 🟡 — reused from wave-1b, official-tier original source, not
independently re-verified this pass.

**RECOMMENDATION (hypothesis).** None needed for UCT's current mechanism; the
recommendation is defensive — document, in the code or in this program's decisions log,
*why* `isReportingNow` is session-anchored (with this external citation), so a future
"more precise timestamps" refactor is a deliberate trade-off discussion, not a silent
regression.

### 5.2 A renamed or merged entity keeps its page and gets a redirect — identity persists, the label does not

**OBSERVATION.** Fiscal.ai (formerly FinChat) documents, across several changelog entries,
an explicit maintenance program for entity identity: a "ticker-mapping refactor to reduce
company duplication and improve consistency" (2026-06-24), "merged/delisted company pages
retained" rather than deleted, and "a middleware redirect when a company's URL changes"
(the 2026-07 changelog entry names a SpaceX URL migration specifically).

**EVIDENCE.** Cited via `03-competitive-research/finchat/dossier.md` §H (line 191, with
source line 193 naming `https://fiscal.ai/changelog/`) — original tier: official product
changelog, Tier 1, fetched by that wave-1b role 2026-09-02, **verified**; not
independently re-fetched this pass.

**INTERPRETATION.** This is a second, independent product confirming the FIGI-style
permanence property from §2.1, but observed operationally rather than as a documented
identifier property: the entity's *page* (its identity in the product) survives a merger
or delisting, and the *label* (URL/ticker) is redirected forward rather than the old
identity simply vanishing or being overwritten. "Reduce company duplication" is the
tell that the failure mode being fixed is exactly UCT's §1.1 gap — a ticker-keyed system
accreting duplicate entities because renames create new strings with no link back.

**RELEVANCE TO UCT.** A concrete, product-level (not standards-body) precedent for §2.1's
recommendation: UCT's `ticker_meta_cache` and `cap_universe` gate, both keyed on the
current ticker string (INTERNAL §1.1), would benefit from the same shape — an internal
entity id that a renamed or delisted symbol still resolves to, with the old ticker string
redirecting forward rather than becoming a dead end.

**CONFIDENCE.** 🟡 — reused from wave-1b, official-tier changelog source, not
independently re-verified this pass.

**RECOMMENDATION (hypothesis).** If TERMINAL-NEXT builds any entity-centric page (a
security detail view, a model-book style history page), design its identity key as
"internal entity id, ticker-string history as a dated list" from day one — retrofitting a
redirect layer onto a ticker-keyed URL scheme after duplication has already accreted (the
problem Fiscal.ai's 2026-06-24 refactor was fixing) is a bigger lift than building it in.

### 5.3 A delisted identity is marked, not erased — the minimal viable UI convention

**OBSERVATION.** Godel Terminal's `TREND` command (a ranked list of the most-searched
tickers on the platform) renders delisted tickers **struck-through** rather than removing
them from the ranking.

**EVIDENCE.** Cited via `03-competitive-research/godel/02-verification.md` (line 98,
sourced to `https://godelterminal.com/docs/commands/trend.html`) — original tier: official
product documentation, **verified** by that wave-1b role; not independently re-fetched
this pass.

**INTERPRETATION.** A minimal, cheap pattern for the opposite failure mode from §5.2's
redirect (which is for a *renamed* entity, still tradeable): a delisted entity is not
tradeable, but it should still be *visible and legible as delisted* wherever historical
attention or history references it, rather than either (a) silently vanishing from a list
it once earned a place on, or (b) rendering identically to a live symbol with no visual
signal that it no longer trades.

**RELEVANCE TO UCT.** Directly applicable to any TERMINAL-NEXT surface that shows
historical membership (Model Book's per-year stock rosters, a theme's historical holdings,
UCT20's composition history — see `CLAUDE.md`'s "stocks that rotated out still contribute
their return during holding period" for UCT20 NAV) where a name that no longer trades
should stay visible for historical accuracy but be unmistakably marked as no longer live.

**CONFIDENCE.** 🟡 — reused from wave-1b, official-tier source, not independently
re-verified this pass; a single UI convention from a single product, not cross-checked
against a second product.

**RECOMMENDATION (hypothesis).** Adopt a visible "no longer trades" marker (strikethrough
or equivalent) as a standing convention anywhere TERMINAL-NEXT renders a symbol from
historical data (not just live watchlists) — cheap, and it prevents the specific member-
facing confusion of clicking a dead ticker that looks identical to a live one.

---

## 6. SYNTHESIS — closing the loop on the four headline claims

1. **Bitemporal symbol master (claim 1).** External evidence strengthens this from "a
   plausible design principle" to "an industry-observed pattern with at least three
   independent confirmations at different layers": FIGI's explicit permanence-by-design
   (§2.1, standards-body level), Fiscal.ai's operational redirect-on-rename (§5.2, product
   level), and Nasdaq's own admission of internal notation inconsistency (§2.3, exchange
   level) all point at the same fix — one stable internal key, tickers as a dated alias
   list pointing at it. UCT's `cap_universe`/`ticker_meta_cache` gap (§1.1) is not a UCT
   idiosyncrasy; it is the default failure mode every one of these external systems had to
   deliberately engineer against.
2. **Adjustment as policy, not baked-in bars (claim 2).** The sharpest finding in this
   pass is that UCT's *own* primary vendor's adjustment surface (§3.1) only ever documents
   split handling, never dividends, never renames — meaning the internal gap identified in
   §1.7 is not a UCT implementation shortfall alone; it is bounded by what the vendor
   itself exposes. TradingView's explicit-confirm redesign (§3.2) and Bloomberg's
   labelled-raw-plus-adjusted convention (§3.3) are two different, cheaper-than-a-full-
   corporate-actions-engine responses to the same underlying uncertainty: TERMINAL-NEXT
   could adopt either (or both) well before it could adopt a genuine corporate-actions
   feed.
3. **Market clock as a dataset (claim 3).** NYSE's own multi-segment, three-year-published
   session matrix (§4.1) and `pandas_market_calendars`'s shipped-as-code maintenance model
   (§4.2) both confirm this is a real engineering discipline with existing tooling, not a
   principle UCT would be inventing from scratch. UCT's `calendarTime.js` is correctly
   scoped to its one job (earnings BMO/AMC bucketing, §1.3) but is not, and should not be
   mistaken for, a general market calendar.
4. **TBD as a value, not an error (claim 4).** The strongest available confirmation is
   Market Chameleon's own session-anchored measurement convention (§5.1) — a product whose
   core paid analytic depends on getting "which day" right chose the same session-bucket
   model UCT already ships. No external evidence surfaced a *TBD-specific* handling
   pattern beyond what UCT's internal baseline already does (INTERNAL headline claim 4);
   this remains the one claim in this file resting more on UCT's own internal design than
   on an external precedent, and is flagged as such in GAPS below.

---

## GAPS

- **Search channel used.** Per the preamble's Search-budget fallback order, this pass used
  **WebFetch on known URLs only** (vendor docs, exchange pages, standards-body pages,
  GitHub, and one product blog). WebSearch was confirmed exhausted by the preamble before
  this role started, so no WebSearch calls were attempted. No browser-tab search
  (`mcp__claude-in-chrome__*`) was needed — every targeted URL was reached directly or via
  one HTTP redirect (`polygon.io` → `massive.com`), so channel 2 of the fallback order was
  not exercised this pass.
- **Vendor manuals still unreached** (carried forward from the prior pass, still true):
  Bloomberg BSYM/DL, Refinitiv PermID enterprise documentation, FactSet SPRI, Wall Street
  Horizon's feed specification. All behind sales gates or subscriber logins; not attempted
  this pass either.
- **yfinance's own adjustment-parameter documentation** — attempted twice
  (`ranaroussi.github.io/yfinance` reference page and the PyPI project page); both returned
  only navigation chrome, not the parameter description, because the reference site is
  JS-rendered. This directly bears on the open question in §3.1 (does UCT's fallback
  provider's "split-adjusted" claim in `CLAUDE.md` also cover dividends) and was not
  resolved. Raising it needs either a rendered-browser fetch of that page or reading the
  library's source/docstrings directly.
- **CRSP/academic delisting-return methodology** — not attempted. Relevant to how a
  delisted security's return should be treated at the point of delisting (CRSP's own
  delisting-return adjustment is a well-known academic convention), but likely paywalled
  and judged lower priority than the vendor/exchange/standards-body sources actually
  reached, given the 100-tool-call budget.
- **SEC EDGAR ticker-change disclosure practice** — not attempted. Would show how the
  regulatory record itself represents a rename (8-K Item 5.03/8.01 practice), which is a
  different angle from every commercial product's UI-level handling covered in §5.2–5.3.
- **ANNA's own site** — `isin.org` was used as a proxy for ISIN structure and governance
  (§2.2); it is ANNA-affiliated but was not cross-checked against `anna-web.org` or ANNA's
  own primary publications directly.
- **OpenFIGI's composite-vs-exchange-level-vs-share-class FIGI relationship** — the
  overview page (§2.1) did not address this; OpenFIGI's mapping-API reference documentation
  would likely resolve it and was not fetched this pass.
- **Massive/Polygon's own reference-data/tickers endpoints** (as opposed to the aggregates
  endpoint fetched) — not checked for whether the vendor exposes any permanent instrument
  identifier (FIGI or otherwise) that UCT could adopt without a new vendor relationship;
  flagged as an open question in §2.1.
- **Claim 4 (TBD handling) has the thinnest external corroboration of the four headline
  claims** — §5.1 confirms the *session-anchoring* half (which day) but no external source
  reached this pass specifically addressed how a product represents a **genuinely unknown**
  report time in its data model (as opposed to a known BMO/AMC bucket), which is the
  narrower claim UCT's internal Time-TBD bucket (INTERNAL headline claim 4) actually makes.
  This is the one area where a synthesis reader should weight the internal evidence over
  the external in this file.

## SOURCES

**Internal program artifacts** (tier: internal program artifact per the preamble; cited in
§1 only):

1. `01-existing-system/backend-archaeology.md` — read 2026-09-02 — internal, AST-derived
   router/service census — **verified** against its own claims.
2. `01-existing-system/terminal-current-map.md` (cited in-text as "TERMINAL-CURRENT") —
   read 2026-09-02 — internal — **verified** against its own claims.
3. Repository `CLAUDE.md` — read 2026-09-02 — internal — explicitly a **CLAIMS** document
   per the archaeology's own framing, several sections independently confirmed stale by
   TERMINAL-CURRENT §10.1; treated as **claimed**, not verified, throughout §1.

**External sources fetched this pass** (all fetched 2026-09-02):

4. OpenFIGI overview — `https://www.openfigi.com/` — Tier: official standards-body page —
   **verified**.
5. OpenFIGI FIGI structure/governance — `https://www.openfigi.com/about/figi` — Tier:
   official standards-body page — **verified**.
6. Massive (Polygon) aggregates API blog — `https://massive.com/blog/aggs-api-updates`
   (reached via 301 redirect from `https://polygon.io/blog/aggs-api-updates`) — Tier:
   official vendor documentation — **verified**.
7. Massive Custom Bars API reference —
   `https://massive.com/docs/rest/stocks/aggregates/custom-bars` — Tier: official vendor
   documentation — **verified**.
8. ISIN structure — `https://www.isin.org/isin/` — Tier: registration-authority-affiliated
   reference page — **verified** for structure/CUSIP relationship; silent on
   rename/delisting.
9. Nasdaq Trader symbol convention — `https://www.nasdaqtrader.com/Trader.aspx?id=CQSSymbolConvention`
   — Tier: official exchange documentation — **verified**.
10. NYSE hours & calendars — `https://www.nyse.com/markets/hours-calendars` — Tier:
    official exchange documentation — **verified**.
11. `pandas_market_calendars` README — `https://github.com/rsheftel/pandas_market_calendars`
    — Tier: open-source project's own documentation (primary for its documented behavior)
    — **verified**.
12. TradingView blog, stock split handling in Portfolios —
    `https://www.tradingview.com/blog/en/stock-split-handling-in-portfolios-60319/` —
    Tier: official product blog — **verified**.
13. Yahoo Finance help page (SLN2310) — attempted, did not contain earnings-timing or
    ticker-change content; not cited as a positive source, listed for completeness of the
    fetch record.

**External observations reused from wave-1b competitive dossiers** (not independently
re-fetched this pass; tier and verification status as recorded by the citing dossier —
cited per topic in §2.3, §3.3, §5.1, §5.2, §5.3 above with the specific dossier file and
line):

14. `03-competitive-research/bloomberg/01-search-navigation.md` + `dossier.md` — Bloomberg
    terminal grammar accepting CUSIP/ISIN/BBGID; `GUID`/`FA` adjusted-vs-raw labelling;
    `CACS` corporate-actions function. Original tier: official Bloomberg documentation +
    Cornell University library guide.
15. `03-competitive-research/desk-tools/market-chameleon.md` — Day-of-Earnings-Trading
    BMO/AMC convention. Original tier: official product page.
16. `03-competitive-research/finchat/dossier.md` — Fiscal.ai ticker-mapping refactor,
    merged/delisted page retention, URL-change redirect. Original tier: official product
    changelog.
17. `03-competitive-research/godel/02-verification.md` — Godel Terminal `TREND`
    struck-through delisted tickers. Original tier: official product documentation.
18. `03-competitive-research/koyfin/dossier.md` — ISIN accepted in CSV import. Original
    tier: official product documentation.
19. `03-competitive-research/lseg-workspace/dossier.md` — identifier breadth (ISIN, SEDOL,
    LEI, CUSIP, PermID). Original tier: official product documentation (leaning on one
    university library guide per that dossier's own evidence ceiling).
