# Joystick hub — closure

**The feature is complete.** Every row in `deferred.md` and every request in `requests.md`
carries a final-state verdict. What remains is not engineering: it is the owner's real-glass
verification (`glass-acceptance.md`) and whatever members ask for once they have used it.

This document supersedes `70-increment-6-closure.md`, which closed Increment 6 with a core list
of one. That list is still one, and it is still the same item.

---

## 1. What is actually open

| # | Item | Why it is not mine to close |
|---|---|---|
| **G** | **`glass-acceptance.md`** — real-glass D4 (flick safety) and D1 (the TalkBack/VoiceOver no-drag door), plus every surface Increments 3–7 added. | Needs a human with a finger on glass. jsdom performs no layout; emulated-green is not device-green. **Block G0 carries two Phase 2 findings that were never explained** — an iPhone 15 Pro scoring 0/10 on flick where an iPhone SE scored 10/10, and iOS gesture rows that have never actually run because WebDriverAgent rejects the action. G0-1 must be resolved **before** any G1 result is read as a pass, because G1 is the same measurement done by hand. |
| **Member feedback** | Whatever the first members ask for. | Not knowable from here. |

### Owner decisions — costed, not decided

These are product calls, not gaps. Each is recorded with its options and their price.

- **D-02 — the chart fan is structurally full.** Outer 5/5, inner 4/4 against `OUTER_MAX`/
  `INNER_MAX`; `validateRegistry` rejects a sixth. An Indicator bubble cannot exist until you say
  what it displaces. Also measured: `vwap`/`avwap` are intraday-only while the phone chart
  defaults to `'D'`, and "AVWAP from last pivot" matches **neither** existing AVWAP — it is a
  choice between `swingHigh` and `swingLow`, which is a directional opinion about the member's
  chart.
- **D-08 — Compare prior cycle.** The data is already **paid**-gated, not admin-gated; only the
  client declines. Making it member-visible is two lines. The price is editorial: the tab's
  headline is a forward-return claim shown to members, and the tab count goes 5→6 for everyone.
- **D-26 — LWC pane geometry for the scrim.** The row says it itself: "needs an owner decision,
  not an engineering one." The scrim ships its stated `calc(22% + 32px)` approximation, labelled.
- **D-36 — does planning a trade escalate?** `scan.planTrade`/`chart.planTrade` are `kind:'run'`
  with `escalate: false`, so `PlanTradeSheet` is a commit sheet whose action does not escalate.
  Rendering the notice anyway puts a second authority on "is this the serious kind"; flipping the
  flag changes the haptic every member feels. The notice is written and railed; this needs a
  ruling, not code.

### Not this program's, and still live

**D-30 — one `data_root()` helper.** 72 environment variables name paths inside the shared data
root and each resolves independently of `DATA_DIR`. It is a **production** risk, not a testing
inconvenience, and it must be its own task: ~68 call sites across `api/**`, which is also behind
the deploy stop below. Recorded here so it is not lost with this program's closure.

---

## 2. The `api/` stop, measured once

Read live from the Railway service manifest (`railway status --json`, read-only):

- `worker` → `['/api/**', '/requirements.txt', '/railway.json', '/nixpacks.toml', '/Procfile', '/runtime.txt']`
- `bars-api` → `['api/**', 'requirements.txt', 'nixpacks.toml', 'railway.json']`
- `flow-worker` → 20 enumerated top-level `api/*.py` modules; **no `routers/` path**

So any edit under `api/` redeploys `worker` **and** `bars-api`. `flow-worker` is not implicated —
stated because an overstated stop is as bad as a missed one. This closed **P6** (server-side
preference-key validation), **R-08**, **D-14**, **D-15**, **D-19** and the backend half of
**D-32**. The B6 Settings-card gate therefore remains an *exposure default*, not a security
boundary, and this document says so rather than letting the word "gate" imply otherwise.

---

## 3. What Increment 7 found

The rows are in `deferred.md` and `requests.md`. These are the findings that outlived them.

1. **`chart.alert` was a silent no-op on a live section.** It fell through `buildChartFan`'s
   default arm with no `run`; the member read "Alert on NVDA", pressed the primary, and nothing
   was created. **And the rail whose entire job is that defect could not see it** —
   `runActionsHaveHandlers.test.js` filtered `kind === 'run'`, and worse, skipped any mode with a
   controller on the stated assumption that "a controller rebuilds and drops what it cannot do."
   That assumption was false for half the controllers: `chartSection` and `catalystsSection` both
   end in `default: out.push(action)`. The rail now builds each fan and measures the output.
2. **`notebookSection` shipped an `onScrub` with no `readout()`** since B10 — forbidden by
   `contracts.js` — and survived because every notebook rail mounted the hook *without* a
   provider, so the one boundary that validates was never crossed by a test.
3. **The deferred row's own prescription for D-27 was wrong.** `#8FE0B0` *lowers* the WCAG ratio
   against Journal, which is the one channel a hue-blind viewer has and the entire reason the row
   exists.
4. **The cursor outline missed WCAG 1.4.11 in every theme** (light 2.202:1) because it borrowed
   the knob's rim, which is tuned for glass, not for a page. The fill provably cannot carry both
   the ink floor and the state floor at any opacity — that is why they are two tokens.
5. **Five defects existed only in the merge**, created by combining changes that were each
   correct alone. The write-path manifest would have asserted six against seven, because two
   branches each bumped five to six. Two ring-legality rails said "outer 3" where the answer was
   four. Two toast hosts became one. A registry tombstone was false before it ever merged.

⭐ **The pattern in four of those five: a number or a claim typed next to the thing it describes,
by someone who was right when they typed it.** This program has now paid for that lesson enough
times to state it plainly — derive it, or make it something a human must look at.

---

## 4. What I would reverse

1. **Two-finger Peek (§C1).** It shipped because the gesture table declares it, not because
   anything needs it. It is explicitly *not* an accessibility mechanism — screen readers consume
   two-finger tap, and two pointers fails WCAG 2.5.1 on its face — and it duplicates a sheet
   already reachable by one tap. The cost is a pointer-tracking branch in `useJoystick`, the most
   safety-critical file in the feature. Highest cost-to-benefit ratio in the program.
2. **The sequencing.** Seven increments reached production before a single real-glass test. Every
   gesture claim in this program is jsdom, which performs no layout. Glass belonged before
   Increment 3, not after 7 — and G0-1, an unexplained 0/10 flick score on real hardware, has been
   sitting in a run record since Phase 2.
3. **Calling B6 a gate.** It is an exposure default. `POST /api/auth/preferences` accepts any
   `{key, value}`, so the Settings card gate is cosmetic; the fix is blocked by the watch lists
   above. Either fix it or stop calling it a gate — the word did real work in reviews it had not
   earned.

---

## 5. How to turn it off

Not a revert: set **`HUB_PREVIEW_ENABLED=false`** in Railway. It is read per request in
`api/routers/auth.py::_access_payload`, so it takes effect on each member's next authenticated
request with **no redeploy**. An already-open page keeps its hub until its next `/api/auth/me`.

A member who wants it gone for themselves has two doors that both work: the session-only hide
from the Actions sheet (writes nothing), and Settings → Joystick (persistent). The edge tab
restores either.
