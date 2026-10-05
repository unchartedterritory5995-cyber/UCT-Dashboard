# 2026-10-02 — TERM-001 board-size bound · TERM-006 per-class freshness ceilings

**Authority.** Owner, 2026-10-02: *"decide and figure it all out"*. These calls were delegated, so
this file records each one, its evidence and its reversal. Any owner sentence overrides either.
Lane: `lane/term-001-006`.

---

## TERM-001 (`FB-S1-02`): a board holds at most **16** widgets

**Decision.** `MAX_BOARD_WIDGETS = 16`. A board may grow only while it holds fewer than 16. A board
that is already over 16 is never truncated and never rejected on read. It stays editable: moving,
resizing and closing widgets all save. It cannot grow.

**What was measured. No new measurement was taken.** Production stores were not read, by
instruction. Two dated measurements already in the repo decide the number:

| Fact | Value | Source |
|---|---|---|
| Real boards, widget count per board (read-only aggregate over `user_preferences`) | 17 of 29 accounts hold a board. Distribution 1→2 · 2→2 · 3→4 · 4→2 · **5→7**. **Max 5.** 0 empty | `10-roadmap/success-metrics.md` PH-1, from C5-03 §3 (2026-09-25) |
| Largest board ever measured for cost | **16 cells** on production: framed 2,582 ms; per-cell median 28 ms, p95 82 ms; heap +218 MB settled, +45 MB retained; **2 long tasks (worst 85 ms) in 60 s idle** | `07-technical-architecture/realtime-performance-architecture.md` §3 Q1; `10-roadmap/evidence/2026-09-26-protocol-c-and-gridspike/results.md` |

**Why 16.**
- **Headroom:** 16 is 3.2× the largest board anyone holds (5). Nobody is anywhere near it.
- **It goes no further than the evidence:** 16 is the largest panel count whose cost was measured,
  and that board was quiet once settled. Anything above 16 would be a bound past every measurement
  in the repo, which is the thing ARCH-07 §3 Q1 refused to do.
- It is a different number from `PANEL_MOUNT_CAP = 3`. That one limits how many widgets mount at the
  same time, not how many a board holds, and it is unchanged. It is also the same number as
  `GRID_MAX_CELLS = 16`, but only because both come from the same spike. The two are not linked.

⚠️ **Not measured:** the sizes of saved layouts in `charts_layouts.db`, which can be opened onto a
board. One that holds more than 16 is still stored, but it can only be opened over a board at
least as large (see below). The census to run is the PH-1 aggregate over
`charts_layouts.layout_json`, read-only, against a copy.

**Where it is enforced.**
- **One authority:** `app/src/pages/charts/boardBound.json` (`maxWidgets`, plus the refusal
  sentences). The client reads it through `boardBound.js`. The server reads the same file through
  `api/services/board_bound.py`. This is the `market_calendar.json` pattern.
- **Server, when a board is saved:** `POST /api/auth/preferences` and `POST /api/workspace-doc/apply`
  both call `auth.enforce_board_bound`. A `charts_workspace_layout` write gets a 400 with the
  bound's own sentence only when it would hold more than 16 widgets **and** more than the stored
  board holds. The stored board is read only when the new value is over 16, so an ordinary save
  costs nothing extra. An over-16 write cannot replace a stored board whose size is unknown
  (absent, or unreadable under STATE-2).
- **Client:** one growth gate, `refuseIfBoardFull`, covers the WIDGETS menu, the float-on-create
  submenu, `?ensure=` seeding and a confirmed ghost. A full board disables the WIDGETS chips and
  shows the sentence. An over-bound board loads whole, says so, is not saved again just because it
  was loaded, and cannot grow. Opening a saved layout over 16 on top of a smaller board is refused
  in words, and the saved layout is left as it was.

**The sentences** (in `boardBound.json`):
- Refusal: *"A board holds at most 16 widgets, and this one would hold 17. Close a widget before
  adding another."*
- Over-bound: *"This board holds N widgets, more than the 16 a board can hold. Nothing was removed:
  it stays as it is, and it can take a new widget once you close enough to bring it under 16."*

**Reversal.** Edit `maxWidgets` in `boardBound.json`. Both doors follow and no data migrates. To
remove the bound entirely, take out the `enforce_board_bound` calls and the `refuseIfBoardFull`
gate. No stored board is touched either way.

---

## TERM-006 (`FB-S8-02`): the maximum age a panel may display without saying so, per data class

**Decision.** A panel names its **data class**. The class declares a **cadence**. The maximum
silent age is **derived**: `clamp(2 × cadence, 60 s, one trading session as S11 measures it)`.
That is the existing `freshnessAge.js` rule, unchanged. Past that age the panel states its as-of
on the surface.

| Class | Cadence declared | Max silent age (derived) | Grounding in existing code |
|---|---|---|---|
| `intraday_live` | 30 s | **60 seconds** (the floor) | Every live cadence in the shell is 30 s or faster: `livePriceStore` polls every 2 s (4 s on mobile), the StockChart intraday SWR every 30 s. Twice any of them is at most 60 s, so all of them land on `AGE_FLOOR_MS`, the jitter floor. Chart-local hysteresis (`BARS_LIVE_STALE_MS` 120 s) stays per chart; ARCH-07 calls it "not a board contract" |
| `end_of_day` | 1 day | **one trading session**: 6.5 h, 3.5 h on a half-day | CARD 33 §2 ceiling ("one session is a ceiling for daily-cadence panels"), derived from `marketClock.nextBoundary()` by `oneTradingSessionMs`. No literal |
| `weekly` | 7 days | **one trading session**, then it states its cadence (*"weekly · as of …"*) | CARD 33 §2 carve-out ("states its own cadence"). The first adopter is the NAAIM column (TERM-059) |
| `quarterly` | 91 days | **one trading session**, then it states its cadence | CARD 33 §2 carve-out ("quarterly fundamentals") |

**The sentence:** *A panel may show a value without its as-of only while the value is younger than
twice its class's cadence, never less than 60 seconds and never more than one trading session.
For intraday-live that is 60 seconds. For end-of-day, weekly and quarterly it is one trading
session (6.5 h, 3.5 h on a half-day). After that the as-of, and for slower-than-daily data the
cadence, is on the surface.*

**Why per class and not per panel.** A panel already passed a raw `cadenceMs`, which meant one
number per panel. The NAAIM column was the only adopter, and it carried a second copy of the
weekly cadence (`7 * 24 * 60 * 60 * 1000`). With classes there is one statement, the
`FRESHNESS_CLASSES` table in `app/src/components/provenance/freshnessAge.js`. Adopters pass
`dataClass`. Passing both a class and a cadence throws, and so does an unknown class. Nothing falls
back to a default age.

**Why the end-of-day ceiling is tighter than CARD 33 strictly needs.** CARD 33 would let yesterday's
EOD row render silently all through today's session. The derived ceiling instead labels it once it
is 6.5 h old. CARD 33 is a *ceiling on silence*, and `freshnessAge.js` §8 already rails that a
tighter rule satisfies it. Kept on the module's asymmetry: an unlabelled stale number can cost a
member money, and a label costs pixels. ⚠️ Reversal for this case alone: give `end_of_day` a
session-anchored as-of (the NAAIM column already compares each row to its own session), not a
larger cadence.

**What reads it.** `freshnessAge.explainMustShowAge({ dataClass })` and `maxSilentAgeMs(id)` decide.
`FreshnessBadge.jsx` renders the class's cadence words when the caller passes `age.dataClass`.
`pages/breadth/naaimAge.js` names `weekly`. `sessionStale.js` and `freshnessContract.js` are
unchanged, because they answer different questions (see the module header).

**Contract.** `app/src/components/provenance/freshnessAge.test.js` §9 checks:
- the four values per class, including the half-day case;
- that every real live cadence lands on 60 s;
- that the class verdict equals the cadence verdict;
- the FB-S8-02 acceptance that a value with no ticks for 61 s states its age;
- that an unknown class throws, and that the table is frozen;
- that this file's class table matches `FRESHNESS_CLASSES`, read by the test;
- that no adopter states a numeric cadence, with a control.

**Reversal.** Edit a cadence in `FRESHNESS_CLASSES`. Every derived age, the contract and both
consumers move together. Adding a class means adding a row here; the contract test reads this
table.
