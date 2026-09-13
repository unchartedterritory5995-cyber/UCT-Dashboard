# Held flags — runnable test plans, and the GEX check only Patrick can make

Three flags sit at `0` awaiting a scheduled test. Each is one `railway variables --set`
from on; none needs a code change. The `flip_precondition` field in
`docs/feature_flags.json` points here.

---

## `VITE_REALTIME_BARS` — the Massive bars push feed

**What a member gets:** every chart's developing candle comes from the push feed over
one pooled SSE instead of the Finnhub 250 ms poll, and 60m/D/W/M gain authoritative bar
updates.

| | |
|---|---|
| needs a live tape? | **Yes** — `bars_emitted_total` only moves during RTH |
| escape hatch | `window.__uctBarsPush(false)` per browser; `BARS_PUSH_ROLLOUT_PCT` for a cohort |
| rollback | `VITE_REALTIME_BARS=0` + rebuild, or `STREAM_BARS_ENABLED=0` server-side |

**Preconditions**

1. ✅ **PRE-VERIFIED 2026-09-13, no live tape needed.** The single-writer rail passes:
   `app/src/components/chart/engine/__tests__/singleWriterIndex.test.js` — **9 tests
   passed**. This is the one that matters: two writers on one developing bar is the
   Heikin-Ashi raw-candle bug that shipped 2026-07-06, and the rail derives the writer
   set from `StockChart.jsx`'s AST rather than a typed count.
2. ⏳ **Needs RTH.** `/api/admin/bars-stream-status` shows `subscriber_pairs` rising
   with a chart open **and** `bars_emitted_total` advancing.

⚠️ On a quiet tape `bars_emitted_total` stays 0, so **subscriber count is the honest
signal off-hours and emitted bars prove nothing.**

**Pass:** subscribers rise, emitted advances, no duplicated developing bar on any chart.
**Fail:** a candle that jumps or double-writes → roll back immediately (H15).

---

## `VITE_MASSIVE_STREAM` — Live Flow instant tape

**What a member gets:** prints appear the instant the server tailer classifies them
instead of up to 20 s later; the poll drops to a 60 s reconcile.

| | |
|---|---|
| needs a live tape? | **Yes** — there are no prints to stream otherwise |
| escape hatch | **`localStorage.setItem('uct.massiveStream','1')` or `?stream`** — exercises it for ONE browser without flipping it for everyone |
| rollback | `VITE_MASSIVE_STREAM=0` + rebuild; the escape hatch needs no deploy |

**Test it through the escape hatch first.** Confirm the SSE connects, the 60 s reconcile
still fires, and prints are **not double-counted** between the stream and the poll.
**Pass:** new prints appear within ~1 s and the reconcile finds nothing to add.

---

## `VITE_DESK_BG_AUDIO_ENABLED` — Desk mobile audio-primary playback

**What a member gets:** on a coarse-pointer device a Desk video's audio streams through
a hidden `<audio>` element so it survives screen-lock and backgrounding like a podcast,
with the YT iframe muted underneath.

| | |
|---|---|
| needs a live tape? | No — **needs a REAL touch device** |
| escape hatch | none |
| rollback | `VITE_DESK_BG_AUDIO_ENABLED=0` + rebuild |

⛔ **jsdom performs no layout and an emulator cannot reproduce lock behaviour.** This
one cannot be pre-verified here at all. **Pass:** audio survives a lock/unlock and the
iframe stays muted, so there is no double audio.

---

## GEX crosshair — the check only Patrick can make

The rig measured no GEX-specific lag: 60 fps headless over 5 runs, a positive control
that detects injected lag, and a headed control where the chart **without** GEX lines
dropped three times more frames. What it cannot measure is your perception on your own
display.

1. Open `/options-flow` → **GEX** tab → **Chart with Levels** (it renders again as of
   `67566d999`; it threw `ReferenceError` for six days before that).
2. Move the cursor across the chart for ~5 seconds.
3. **Fine looks like:** the crosshair sits under the pointer with no visible trailing —
   the same as the chart on `/charts`. Compare the two directly; that comparison is the
   measurement, not an absolute impression.
4. **If it lags:** DevTools → Performance → record ~30 s of cursor movement → stop →
   **Bottom-Up, sorted by Self Time** → screenshot the top 10.
5. Drop that screenshot next to `docs/runbooks/flow-worker-weekend-bundle.md`'s GEX
   section and reopen the thread. A named function with self time is what the rig could
   not produce; everything else about the trace is already built.
