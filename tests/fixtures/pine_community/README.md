# The community Pine corpus — 30 published TradingView scripts, unmodified

⭐ **THESE ARE TEST INPUTS, AND THEY ARE SOMEBODY ELSE'S CODE.** Same rules as the
sibling corpus in `tests/fixtures/pine/` (read its README first): every `.pine`
file here is byte-for-byte the published source — `//@version` line, author line
and licence header included, CRLF/LF as served — and nothing in this directory
is authored, edited, cleaned up or truncated by this repo.

**Attribution — publication title, exact URL, author, licence line, Pine
version, publish date, boost count and a one-line description for every file —
is in `SOURCES.md` beside this note.**

## Why a second corpus

`tests/fixtures/pine/` was hand-picked from GitHub collections. This directory
answers a different question: **what do ordinary TradingView members actually
paste?** Every script here was chosen by TradingView's own popularity number
(boosts, recorded per file on the fetch date) within a bucket, from the
open-source scripts the site's search returns for the bucket's topic. It is a
measurement set for the translator, not a curated set of things it is known to
handle — that is the point.

| Bucket | Files | What it measures |
|---|---|---|
| A · most-used indicators | 01–10 | Squeeze Momentum, WaveTrend, CM_Williams_Vix_Fix, UT Bot (ATR trailing stop), Chandelier Exit, QQE MOD, Hull Suite, Smoothed Heikin-Ashi, OBV Oscillator, Ehlers Instantaneous Trend |
| B · swing / momentum setups | 11–18 | 52-week high/low, VCP tightness, RS vs SPY (`request.security`), earnings gap-up + volume, inside bar, NR4/NR7, pocket pivot, Minervini trend template |
| C · multi-timeframe, same symbol | 19–24 | `security()` / `request.security()` pulling a higher-TF MACD, MA, MA-cross, D/W/M highs-lows, EMA and RSI onto a lower-TF chart |
| X · another symbol | 25–26 | VIX (incl. `ticker.new`) and SPY/QQQ pulled onto a different chart |
| D · drawings / arrays / loops | 27–30 | `box.new`, `line.new`, `label.new`, arrays and `for` loops — so refusals get measured too |

Pine versions: v1 ×9 (no `//@version` line — the ChrisMoody / LazyBear / ChartArt
classics), v2 ×2, v3 ×1, v4 ×3, v5 ×8, v6 ×7. Declarations: `study()` ×15,
`indicator()` ×15, no `strategy()`. Two files write the version line as
`// @version=N` with a space — real, compiles on TradingView, and a translator
has to accept it. Line counts run 12–193 (three files exceed 150; they are the
most-boosted scripts in their buckets and were kept for that reason).

## Where they came from, and how that was checked

Fetched 2026-08-25 from TradingView's source endpoint
(`pine-facade.tradingview.com/pine-facade/get/PUB%3B<id>/last`), which is what a
script page's source box loads, with `scriptAccess: open_no_auth` on all 30. For
the 12 pages that also embed the source in their HTML the two copies were
compared byte-for-byte (11 identical; #21 differs by one comment word because the
page's chart snapshot predates the author's last edit — see its entry). Each file
was read back and compared to the fetched string before this note was written.

## Licences, as seen

- 9 files carry TradingView's standard MPL-2.0 header line.
- `05-chandelier-exit.pine` declares GPL-3.0; `15-inside-bar.pine` declares "GNU
  License 2.0" (linking GPL-2.0).
- 19 files carry no licence line at all. They are published open-source on
  TradingView, whose Terms of Use §22 (quoted in `SOURCES.md`) make such scripts
  MPL-2.0 by default. `SOURCES.md` records this per file as *TV-default MPL-2.0*
  rather than inventing a header the author did not write.
- Deliberately **skipped**: every protected / invite-only result (e.g.
  Amphibiantrading's "Volatility Contraction Pattern", TraderLion's RS Line —
  closed source), and LuxAlgo's "Support and Resistance Levels with Breaks"
  (62k boosts, but CC BY-NC-SA 4.0 — non-commercial terms, so not taken).

⚠️ Committing third-party GPL files as inert test fixtures is the same owner
call the sibling README records; this directory adds two more (05, 15). Reversal
is the same one command, and `SOURCES.md` has the URLs to restore them exactly.

## What they are NOT

- ⛔ **Not shipped.** Nothing under `tests/` reaches the Vite bundle; nothing here
  is served to a browser or imported by product code.
- ⛔ **Not a source of product code.** No line of any script here was copied into
  `pine.js` or anywhere else.
- ⛔ **Not fetched at test time.** A gate that needs the network is a gate that
  skips — the files are committed for the same reason the sibling corpus is.
- **No test consumes this directory yet.** This drop is the corpus and its
  attribution only; the scoring test that reads it is a separate change.
