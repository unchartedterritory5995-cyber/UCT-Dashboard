# Decisions 2026-10-06: what the backlog re-measure merged, built and left alone

The owner delegated terminal product decisions on 2026-10-02 ("decide and figure it all
out") and on 2026-10-06 asked for the terminal's functionality to be finished ("all of it and
anything remaining"). These are branch `terminal/fn-backlog` decisions. Each one records what
was measured, what was decided, and what would reverse it. The per-ticket state is in
`10-roadmap/backlog-status-2026-10-06.md`.

---

## D1. TERM-055: merge `lane/p2-term055`; the raw view ships dark

**Measured.** The lane's checkpoint (`868516a75`, labelled UNVERIFIED) merged cleanly onto
master `d46bfb033`. Its tests pass on the merge: `tests/test_adjustment_basis.py`,
`tests/test_raw_price_view.py`, `tests/test_intraday_split_is_not_staleness.py` (35 passed),
`AdjustmentLabel.test.jsx` (8 passed). The only new census red was the skill whitelist, which
was regenerated (one new member GET route). The nine other census reds were present on master
before the merge and are unchanged.

**Decided.** Merge it (`1464023a7`). Two halves, two treatments:

1. The intraday split label is ungated. It only ever says what the series shows
   ("Not split-adjusted · cliff at <date>") and renders nothing when unsure, so it can only
   remove a silent wrong reading.
2. The "As traded" raw view stays dark behind `RAW_PRICE_VIEW_ENABLED`, as the lane built it.
   It adds two bounded vendor calls on a member request path, so arming it is the owner's act.

**Reverses it.** A member report that the label names a split the chart does not show.

## D2. TERM-067 / TERM-065: merge `lane/p2-ratchets-b`

**Measured.** One conflict (UCT20.jsx imports; both sides kept). 16 test files, 293 tests
passed. The unnamed-control baseline falls 33 → 23 and the hand-rolled grid baseline 14 → 9.

**Decided.** Merge it (`1b391f926`). No member-visible change by design; it narrows two
shrink-only ratchets the backlog owns.

## D3. TERM-066: do NOT merge `lane/p2-ratchets-a`

**Measured.** The lane conflicts on `QuoteStrip.jsx` and `statementSeries.js`, both already
moved by visual round 2 onto `formatCompactTerminal` (the one K/M/B rule the owner ruled for
the terminal). The lane would put a second tier ladder (`formatCompact` with local tiers)
back beside it.

**Decided.** Leave the lane unmerged. The remaining 46 formatter sites drain against
`formatCompactTerminal`, not against the lane.

## D4. TERM-033: drain the terminal-reached sites first

**Decided.** Order the `.catch(() => null)` drain by what a terminal member reaches, not by
file order. First slice (`2c9ee09b5`): the research quote strip (DES modal) and the CMP
compare page. Copy for a failed compare, decided here: *"The comparison of A and B couldn't
be loaded. The request failed; this is not a statement about either company."* plus Retry,
matching the research sections' existing `FETCH_FAILED` wording.

**Reverses it.** Nothing; later slices continue in the same order.

## D5. TERM-047: built, verified, not merged by this session

**Measured.** `lane/s2-finish` trial-merges with two resolvable conflicts and 121 passing
lane tests. Landing it requires deleting a stale duplicate `PINE_RUNTIME_SAVE_ENABLED` entry
from `docs/feature_flags.json`; this session's permission rules refused that edit.

**Decided.** Leave it for the owner (or an agent the owner permits to edit the flag ledger).
Exact steps: `backlog-status-2026-10-06.md` §5 item 1.

## D6. Lanes outside the backlog's themes are handed off, not built here

`lane/alrt-centre` and `lane/mon-watchlist` (new terminal functions) go to the fn-features
lane; `lane/t4-chrome-phone` and the shell edits in `lane/mon-watchlist` go to the fn-daily
lane. None of them is a TERM ticket, and two other lanes own those themes on this date.
