---
id: PACKET-G
title: A Catalysts tab on the per-ticker research page — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET G — the missing Catalysts tab

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs
> `app/src/pages/research/ResearchPage.jsx`. **Non-collision:** `PACKET-G` appears
> nowhere in either worktree (checked before writing this file).

⛔ **ONE NEW TAB, ONE NEW READ-ONLY ENDPOINT, ZERO NEW DATA PIPELINE.** No new AI call, no new
provider, no schema change to `catalysts.db`, no change to the nightly catalyst engine, no change
to any other tab on this page.

---

## 0 · Why this packet exists — corrected record

The owner asked whether the product is organized to Bloomberg-terminal standards — one place to
find "the full fundamental, catalyst, everything" resource per ticker. The first answer given in
this conversation, based on the `terminal-research` planning documents (`13-executive-synthesis/
DAY_1_EXECUTIVE_SYNTHESIS.md`, `06-ux-and-information-architecture/information-architecture.md`,
`00-program-control/COMPLETION_AUDIT.md`'s S1 CP3 row), was that the consolidated "entity page" the
research calls for is designed but explicitly **deferred, not built**.

**That answer was wrong, and the reason is worth recording rather than quietly fixing.** Those
documents are three weeks stale relative to the live code. Checked directly against
`app/src/App.jsx`, `TickerActions.jsx` and `ResearchPage.jsx` this session:

- **`/research/:sym` already IS a real, live, comprehensive per-ticker page** — twelve tabs
  (Overview, News, Technical, Financials, Estimates, Analyst Ratings, Ratings, Ownership, Calls &
  Transcript, Filings, Ask AI, My Research), built incrementally across at least six dated slices
  from 2026-09-03 through 2026-09-09 (per the file's own header comments), paid-gated.
- It is reachable from **every ticker in the app**, not one page: `TickerActions.jsx:251`
  (`navigate(\`/research/${sym}\`)`) is the universal right-click/long-press menu's own door.

This packet is the correction found by checking code instead of trusting the planning documents a
second time — matching the discipline this whole program has enforced on every other finding.

## 1 · The one real, precise gap found

`ResearchPage.jsx`'s twelve tabs cover fundamentals (Financials, Estimates, Ownership),
third-party research (Analyst Ratings, Ratings, Calls & Transcript, Filings, News), technicals,
an AI Q&A door, and the member's own private notes (My Research). **None of them is Catalysts.**

The catalyst engine (`api/services/catalyst/*`, `api/routers/catalysts.py`) is real, already
built, and already live — but only on two surfaces: the Dashboard's "🎯 STOCK CATALYSTS" tile
(today's top-20 only) and `/catalysts/history` (a date-scoped browser — pick a day, see that
day's list). **Neither answers "what has UCT's own catalyst engine ever flagged about THIS
ticker."**

Checked directly, `api/services/catalyst/store.py` has no function for that question either:

| existing query | what it answers |
|---|---|
| `get_for_date(market_date)` | every ticker's catalyst row on ONE date |
| `get_ticker_for_date(ticker, market_date)` | one ticker's row on ONE specific date |
| `GET /api/catalysts/explain/{sym}` | a live, on-demand re-scoring of TODAY's inclusion/exclusion — not history |

**There is no "every catalyst entry ever recorded for this ticker, across all dates" query
anywhere in the codebase.** That is the one new thing this packet builds.

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One new read-only store function (`catalyst/store.py`), one new read-only router endpoint, one new tab component on `ResearchPage.jsx`, wired into the existing tab strip and `SECTION_TO_TAB` map | none | **S** |

### MUST-BUILD, exactly

1. **`api/services/catalyst/store.py`**: a new function, e.g. `history_for_ticker(ticker: str,
   limit: int = 50) -> list[dict]` — `SELECT * FROM catalysts WHERE ticker = ? ORDER BY market_date
   DESC LIMIT ?`, reusing `_deserialize_row` (already exists, used by `get_for_date`) so the
   returned shape matches every other catalyst read in the codebase exactly. Read-only; no write
   path touched.
2. **`api/routers/catalysts.py`**: a new endpoint, e.g. `GET /api/catalysts/history/{sym}`
   (`get_current_user`-gated, matching every other per-ticker read on this router), calling the
   new store function and returning `{"ticker": SYM, "entries": [...]}`. An empty list is a valid,
   honest answer (a ticker UCT's engine has never flagged) — never an error.
3. **`app/src/pages/research/tabs/CatalystsTab.jsx`** (new file): follows `NewsTab.jsx`'s exact
   shape — a dedicated SWR hook (`useCatalystHistory(sym)`, new file in `research/hooks/`)
   fetching the new endpoint, a loading state, an honest empty state ("No catalysts recorded for
   this ticker yet" — matching NewsTab's "No recent news for this ticker" convention exactly,
   never a blank card), and one card per historical entry: date, tag (Earnings/Catalyst/
   Gapper/News — the engine's own existing taxonomy), the thesis text, and a `Provenance`/
   `FreshnessBadge` pair per entry (S8's shared component, same as every other tab on this page —
   never a bespoke citation rendering).
4. **`ResearchPage.jsx`**: add `'Catalysts'` to the `TABS` array (placed after News, before
   Technical — catalysts and news are both "what's happening" before the fundamentals-heavy tabs,
   matching the file's own stated tab-ordering rationale for News/Technical's placement) and
   `catalysts: 'Catalysts'` to `SECTION_TO_TAB`, plus the render line
   (`{active === 'Catalysts' && <CatalystsTab sym={sym} />}`).
5. A rail test (new or extended, matching this page's existing test conventions) asserting the
   tab renders, the empty state shows honestly when the endpoint returns zero entries, and the
   tab survives a symbol switch without holding the previous ticker's data (the same "keyed off
   the SETTLED symbol" discipline the modal shell's own header comment states as this page
   family's standing rule).

### Explicitly deferred, NOT authorized by this line

- **The "Desk lens"** — what UCT itself has said or called about this ticker historically (Model
  Book entries, wire mentions, `setup_triggers` track record) — checked this session and
  confirmed genuinely unbuilt anywhere in `app/src/pages/research/`. This is the
  competitive-research program's own separately-named, larger initiative (D-13 §11's "per-ticker
  history join," candidate thesis P-β) and is NOT scoped into this packet. A future packet, not
  this one.
- Promoting the Catalysts tab's content onto the Dashboard tile or any other surface.
- Any change to the catalyst engine's scoring, tagging, selection, or nightly sweep.
- Any change to the eleven other existing per-ticker doors (TickerPopup, the calendar's
  EarningsResearchModal, etc.) — this packet only adds a tab to the one page that already
  consolidates most of them.

### Risk

**Low.** Additive only: one new tab in an existing, already-multi-tab page; one new read-only
endpoint on an already-mounted router; one new read-only store query against an existing table,
using the existing row-deserialization helper. No write path, no schema change, no new external
call, no change to any currently-shipped tab's behavior. A member who never clicks the new tab
sees no difference at all.

## 3 · What this does and does not answer about "Bloomberg-level"

This packet closes the one **concrete, precisely-named** gap the owner's own wording pointed at
("catalyst"). It does not, by itself, make the page "everything" — the Desk lens above remains a
real, separately-scoped gap, and this program's own research explicitly warns against chasing
Bloomberg's multi-asset breadth (FX, rates, fixed income) as a goal UCT should not have
(`13-executive-synthesis/DAY_1_EXECUTIVE_SYNTHESIS.md` §11, "Temptation 2"). This is one precise
brick, not the whole wall, and is scoped that way deliberately.
