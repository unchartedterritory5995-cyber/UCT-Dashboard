---
id: PACKET-H
title: A Model Book appearances tab on the per-ticker research page — pre-implementation gate
role: the packet an approval line must name a checkpoint in
status: PROPOSED, unsigned
date: 2026-09-22
---

# PACKET H — the missing Model Book connection

## ⛔ APPROVAL — EMPTY, and that is its correct state

```
APPROVED BY:
APPROVED ON:
APPROVED AT SHA:
SCOPE APPROVED:
```

> ⛔⛔ **NOT AUTHORIZED. PROPOSED** — no existing checkpoint governs this connection.
> **Non-collision:** `PACKET-H` appears nowhere in either worktree (checked before writing this
> file; note a DIFFERENT, unrelated packet already exists as `GATE-H14-PLACEHOLDER-STOP`, not
> `PACKET-H` — no collision).

⛔ **ONE NEW READ-ONLY QUERY, ONE NEW READ-ONLY ENDPOINT, ONE NEW TAB. ZERO NEW DATA, ZERO CHANGE
TO MODEL BOOK ITSELF.** Same shape as Packet G (Catalysts tab), same day, same page.

---

## 1 · The gap, checked directly against source

Model Book (`/model-book`) is the firm's curated library of the best stocks in history, organized
by year — every entry carries setups (entry/stop/target, grade, teaching notes), AI-generated
bullish catalysts for that year, and a quarterly earnings table.

**There is no way to ask it "has this ticker ever been a Model Book entry, in any year, and what
did we say about it."** Checked `api/services/modelbook_service.py` directly: every read function
is keyed by year (`get_stocks_for_year(year)`) or by row id (`get_stock_detail(stock_id)`,
`get_setup(setup_id)`). `get_all_stocks()` exists but returns **every** curated stock across
**every** year unfiltered — its own docstring says it exists "for background stat warming," not
for a per-symbol lookup. There is no `WHERE symbol = ?` query anywhere in the file.

So today, if NVDA was a curated 2023 entry with three graded setups, `/research/NVDA` gives no
hint that fact exists — a member would have to already know to browse to `/model-book`, click
2023, and find it by eye.

## 2 · Proposed checkpoint

| CP | scope | strands? | size |
|---|---|---|---|
| **CP1** | One new read-only store function, one new read-only endpoint, one new tab component on `ResearchPage.jsx` | none | **S** |

### MUST-BUILD, exactly

1. **`api/services/modelbook_service.py`**: a new function, e.g. `get_stock_appearances(symbol:
   str) -> list[dict]` — the exact same query shape as `get_stocks_for_year` (join to
   `modelbook_setups` for `setup_count`), but `WHERE s.symbol = ? ORDER BY s.year DESC` instead of
   `WHERE s.year = ?`. Read-only; the existing `modelbook_stocks`/`modelbook_setups` tables and
   every write path are untouched.
2. **`api/routers/modelbook.py`**: a new endpoint, e.g. `GET /api/modelbook/appearances/{symbol}`
   (`require_paid`-gated, matching every other read on this router), calling the new function.
   Zero appearances is a valid, honest answer ("this ticker has never been curated") — never an
   error, never hidden as if the feature doesn't exist.
3. **`app/src/pages/research/tabs/ModelBookTab.jsx`** (new file): same shape as `NewsTab.jsx` /
   the new `CatalystsTab.jsx` from Packet G — a dedicated SWR hook, a loading state, an honest
   empty state ("Not yet in the Model Book" — never a blank card), and one card per appearance:
   the year, thesis, gain_pct, and a link to that year's full Model Book entry (`/model-book?
   year=Y&symbol=SYM` or equivalent — reuses the existing page, does not duplicate its chart/setup
   rendering).
4. **`ResearchPage.jsx`**: add `'Model Book'` to `TABS` (placed with the other third-party/
   in-house-research tabs — after Calls & Transcript, before Filings, matching the file's existing
   grouping of "what others/we have said about this name" ahead of raw documents) and the matching
   `SECTION_TO_TAB` entry and render line.
5. A rail test asserting the tab renders, the empty state shows honestly for a ticker never
   curated, and a real appearance (fixture-seeded) renders its year/thesis/link correctly.

### Explicitly deferred, NOT authorized by this line

- Any change to Model Book's own pages, setups, or catalyst-generation pipeline.
- Rendering the full setup chart (entry/stop/target markers) inline on the research page — this
  packet links OUT to the existing Model Book detail view rather than re-implementing its chart
  recipe a second time (avoiding a second-authority rendering of the same setup markers).
- The separately-scoped "Desk lens" (§3 below) — Model Book is ONE of several sources that lens
  would eventually synthesize; this packet does not attempt that synthesis.

### Risk

**Low**, same profile as Packet G: additive tab, additive read-only endpoint, additive read-only
query, no write path, no schema change, no change to any currently-shipped surface.

## 3 · Where this sits in the larger plan

Packets G (Catalysts) and H (this one) are both **the cheap, safe kind of gap** — data that
already exists and is already trustworthy, just not yet linked into the one page a member would
look for it on. Neither is the "Desk lens" (D-13 §11's per-ticker history join: setup track
record, wire mentions, and Model Book appearances synthesized into one read, with a verdict on
whether the firm was right) — that is real, valuable, and still genuinely undesigned. It needs a
short design/spec pass (what does the synthesis actually say, where does `setup_triggers`' W/L
record fit, how does a wire mention get attributed to a ticker reliably) before it can be a
narrow, signable checkpoint the way this packet and Packet G are. Proposing it prematurely, sized
like this one, would be guessing at a shape nobody has actually specified — the same mistake this
whole program refuses to make elsewhere.
