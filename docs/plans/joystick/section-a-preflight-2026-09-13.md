# §A pre-flight — the trace pipeline works on the live build

⛔⛔ **THIS IS NOT G0-1 AND CANNOT BE.** No finger touched glass. Chromium emulated a phone
viewport class and CDP synthesised the touches, so nothing here says anything about the touch
pipeline, about `FLICK_MS`, or about whether a real flick fires. **A device-console pointer probe
is an engine test, never a glass result** — the same rule the 2026-09-12 session recorded.

It answers exactly one question, and it is the one that can waste the owner's sitting:

> **If he turns *Record gesture trace* on, gestures the hub, and presses *Copy trace*, does
> anything come out — and can `hub_trace_analyze.py` read it?**

**Answer: yes, end to end.** Live `web` SHA at the time of the run, signed in as
`smoke@uctintelligence.internal`, 393×852 coarse-pointer, dpr 3.

## The five links, each checked

| # | link | result |
|---|---|---|
| 1 | The Joystick card renders for an admin | ✅ **under Settings → Charts**, 16 controls incl. `joystick-trace-toggle`, `-copy`, `-clear` |
| 2 | *Record gesture trace* turns on and persists | ✅ toggle flipped OFF → ON and read back ON |
| 3 | Gestures reach the engine and are recorded | ✅ `recorded 9 · kept 9 · dropped 0` |
| 4 | `data-hub-trace` carries the payload at render | ✅ 5,757 bytes of valid JSON |
| 5 | `hub_trace_analyze.py` parses and classifies it | ✅ exit **0 ANALYSED**, every gesture bucketed, control check ran, four verdicts printed |

⭐ **The analyser read the deployed build's own constants out of the capture** —
`FLICK_MS=120 TRAVEL_PX=24 OPEN_AT_RATIO=0.4167` — so the numbers §A is written against are the
numbers the shipped bundle is using.

## The trap it found, which is the reason this was worth doing

⛔ **A document load empties the trace ring**, and the Copy button then hands you a valid,
well-formed, **empty** capture. The ring is module state with no sink.

**The controlled comparison** — same account, same build, minutes apart, differing only in how the
run reached Settings after gesturing:

```
page.goto('/settings?section=charts')        ->  recorded 0 · kept 0 · rows 0      ✗
pushState + PopStateEvent (in-app nav)       ->  recorded 9 · kept 9 · dropped 0   ✓
```

The first run was a real mistake by the instrument, caught only because the payload was inspected
rather than assumed. The owner would hit it the same way — gesture on the Journal, then **reload**
into Settings — after performing all twenty-five gestures, with nothing to show for it.
`owner-run.md` §A now carries the warning and the measurement.

## And a path correction

There is **no "Joystick" entry** in Settings' section list; the card is inside **Charts**
(`Settings.jsx:2315`). Measured: `?section=charts` renders all sixteen joystick controls,
`?section=preferences` renders none. `owner-run.md` said *"Settings → Joystick"* in three places
and `g0-flick-trace-plan.md` in one; all four now name the real path.

## State left behind

**None, deliberately.** The trace buffer was cleared and the toggle restored to its prior value
(OFF) in a `finally` block, and the restored state was read back and printed. ⛔ A smoke account
that accumulates state stops being a control — the next run could not tell a product change from
its own leftovers.
