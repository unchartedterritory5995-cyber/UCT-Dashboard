# Route B — the authenticated auto-driving device harness

Built and run 2026-09-08 on branch `fix/mobile-legend-legacy-state`. Continues
`99f`, which left R1 at PARTIAL with a 60-second-per-device cap as the binding
constraint.

> **R1_AUTHENTICATED_DEVICE_GATE = PASS** *(for every flow the harness covers)*
> **DEVICE_WORKSPACE_ROUNDTRIP = PASS**
> **CAN_MOB08_BE_VERIFIED_WITH_CURRENT_INFRA = YES**
> **Paid BrowserStack access: NOT necessary.**

---

## 1 · The idea, and why it beats buying minutes

The cap is real and unchanged: sixty seconds per device, auto-closing. `99f`
observed that most of that minute was going to *idle* — booting, waiting,
typing — rather than testing. So the minute is now spent by a program.

**Measured outcome: the full suite runs in 12.1 seconds on a real iPhone.**
Against a 60-second cap that is ~48 seconds of headroom, which is why a plan is
not warranted. The constraint was never the cap; it was hand-driving.

## 2 · Architecture, and what it deliberately reuses

| piece | where | committed? |
|---|---|---|
| probes, state machine, flows | `app/src/testing/device/authHarness.js` | ✅ |
| the page that runs them | `app/src/testing/device/authHarness.page.html` | ✅ |
| its own rails | `app/src/testing/device/authHarness.test.js` | ✅ |
| stage / validate / clean | `tools/device_auth_harness.py` | ✅ |
| the disposable identity | `tools/sandbox_account.py` | ✅ (generates, stores nothing) |
| runtime page + credential | `app/dist/assets/uct-r1*.js\|html` | ❌ generated, deleted |

It reuses the existing `shellSteps.js` idiom (semantic `until`, tap-by-label,
"one screenshot answers everything"), the `settledLegend` poll-to-stability
rule, the isolated `e2e_sandbox_launcher.py`, the identifier-less BrowserStack
Local tunnel, and the real `StockChart` / mobile shell. No second test framework
was introduced.

⛔ **Same-origin is the load-bearing detail.** The page is served by the sandbox
backend out of `app/dist/assets/` — the only statically-mounted directory
besides `/fonts`. Everything else hits the SPA catch-all and returns
`index.html` with a 200, which is how the first attempt appeared to work while
serving the wrong document.

## 3 · Security — the credential never enters the repository

⚰️ **The first cut of this harness put a literal password in two committed
scripts.** It was only ever a throwaway for a temp-directory database — and
"it's only a test password" is exactly how real ones reach history. A repository
cannot un-learn a string.

`tools/sandbox_account.py` now **generates** the credential per run
(`secrets.token_urlsafe`), signs the account up in the fresh sandbox, and hands
it back in memory. The launcher writes it to a single generated module that
`--clean` deletes; `authHarness.js` receives it as a parameter and the
`authHarness.test.js` rail **fails if the committed module ever contains one**.
The validator also greps its own machine-readable result payload for the
credential before reporting.

There is now no password literal anywhere under `app/src`, `docs/`, or `tools/`.

## 4 · A state machine, because a false PASS is the failure mode that matters

`TRANSPORT_READY · AUTH_READY · APP_READY · FLOW_READY · PASS · FAIL · BLOCKED`

⛔ **`needs` is enforced, not documented.** A step whose prerequisite is anything
other than PASS does not execute; it is recorded BLOCKED, naming what blocked
it. This program has already shipped four instruments that reported success
while measuring nothing — a `-t` filter that matched no tests, a landscape
readout that had stopped polling, a crosshair rail that sampled the wrong frame,
a device step that called an un-tapped chart a FAIL. A harness whose failure
mode is silence is worse than no harness.

⛔ **No fixed sleep as primary synchronisation.** Every wait is a semantic
condition via `until()`, which throws BY NAME when the condition never arrives.
Bounded delays live only inside `settle()`, whose job is the opposite — proving
a value has stopped moving.

## 5 · Local validation, before any device minute

**Positive — 14 PASS / 0 FAIL / 0 BLOCKED**, `DEVICE_WORKSPACE_ROUNDTRIP = PASS`,
cleanup ran, credential absent from the payload.

**Negative control (`--break-auth`, a deliberately wrong credential):**

```
transport   T1  PASS     200
auth        T1  FAIL     (login HTTP 401)
app         T1  BLOCKED  (blocked by auth)
… 12 rows BLOCKED …
PASS 1 - FAIL 1 - BLOCKED 12 / 14
NEGATIVE CONTROL
  auth state        : FAIL
  downstream PASSes : none
  VERDICT: SOUND - a broken login blocks every downstream flow
```

⭐ **A harness nobody has watched fail is not evidence.** `--break-auth` is a
first-class mode, not a thought experiment, and it exits non-zero if any
downstream step still claims PASS.

**Unit rails — 16 cases** (`authHarness.test.js`) covering: a broken login
blocking downstream; a blocked step's body never running; a **non-vacuity
control** proving the runner still passes healthy steps; ROUNDTRIP reporting
FAIL on a broken read-back and BLOCKED on a missing leg; and the **blank-board
detector** failing a board that mounts with the marker intact but zero canvases.

⚰️ **Local validation earned its keep immediately.** `ws-nosymloss` FAILED on its
first local run — it read `appState()` once, a line after its predecessor had
observed the same symbol, and landed on a frame where the strip was still
re-rendering. **The same sample-instead-of-settle defect as the crosshair race
and the portrait toolbar**, caught before a device minute rather than after.
That is precisely what this stage is for.

## 6 · The real-device run

**iPhone 12 Pro / iOS 18.0**, Safari, via identifier-less BrowserStack Local to
`bs-local.com:8091`.

```
UCT R1 · 390×663 · portrait · 12.1s
PASS 14 · FAIL 0 · BLOCKED 0 / 14 · ROUNDTRIP PASS · DONE
P T1 the sandbox is reachable from this device
P T1 a REAL login through the real endpoint          → e2e-sandbox@local.dev
P T1 the authenticated app boots on this phone       → canvas=1 shell=phone
P T1 the workspace record reads back from the device
P T1 the phone WRITES the workspace record
P T1 and READS IT BACK from the device — not from the host
P T1 it SURVIVES a reload, and the board is not blank
P T1 the symbol survived the write — no unintended loss
P T1 a NAMED layout round-trips from the device      → __r1_device__
P T2 record symbol/timeframe before rotating         → SPY / 1D
P T2 the landscape MODE gate answers for this orientation
P T3 all four price scales are reachable from the phone → p-arith,p-log,p-pct,p-auto
P T3 the Tools door opens                            → 137ms
P T3 the chart-type catalogue opens                  → catalogue 129ms
cleanup: layout deleted · marker removed
```

**Session budget:** 60 s cap · ~15 s navigation and URL entry · **12.1 s harness**
· ~33 s unused.

### DEVICE_WORKSPACE_ROUNDTRIP = **PASS**

The exact gap `99f` left open is closed, and closed *on the device* rather than
promoted from a host-side run:

> real device → authenticated app → isolated workspace mutation → server write →
> **device-side** read-back → expected state present → reload → state recovered →
> board not blank → symbol not lost.

⛔ The mutation is an isolated `__r1_device_marker__` inside the sandbox
account's own blob, plus a `__r1_device__` named layout — both deleted by the
harness's own cleanup step. No real member workspace was read or written at any
point.

## 7 · CAN_MOB08_BE_VERIFIED_WITH_CURRENT_INFRA = **YES**

| capability the gate requires | status |
|---|---|
| enter an authenticated member/test workspace | ✅ device-proven |
| alter a safe device-scoped presentation state | ✅ scoped marker written into the workspace record |
| persist and reload it | ✅ `ws-reload` re-enters the app and re-reads |
| detect blank-board / migration failure | ✅ asserted on device, rail'd in `authHarness.test.js` |
| report a verdict on the device | ✅ on-page, one screenshot |
| distinguish device-scoped from workspace-scoped state | ⚠️ **mechanism ready, assertion pending the field** |

⚠️ **The one honest asterisk.** `presentation[deviceClass]` does not exist yet, so
the harness cannot today assert that a device-scoped key is read on one device
class and ignored on another. What it *can* do — and has proven — is write a
scoped sub-object into the same record, reload, and verify both that it survived
and that the board still draws. That is the mechanism MOB-08 verification needs;
the discriminating assertion is one step to add the day the field lands. This is
stated rather than folded into the YES.

## 8 · Bound alerts — F14 stays PARITY

Not attempted in this pass, and not fudged. Creating a bound alert, moving the
drawing and observing the updated condition fire requires a server evaluation
cycle that does not fit in the device window — but ⭐ **the phone does not have to
sit open waiting for it.** The workable architecture, staged rather than
guessed: create and move on-device, assert the stored binding references the
moved object, then let the evaluator run *outside* the session and inspect the
resulting alert event afterwards. Until that lifecycle is exercised end to end,
**F14 is not upgraded**.

## 9 · Remaining verification debt

Device-driveable but not yet scripted: Layouts apply/save through the UI (the
API round-trip is proven; the *sheet* is not) · the price-context sheet as a
deliberate flow · drawing placement and editing by finger · the object manager ·
Hide → recover · tool discovery · symbol-search disambiguation · crosshair
readout under a real touch crosshair. Each is a step in the existing list; with
~33 seconds of unused budget they fit without a plan.

⛔ **And the screenshots are saved this time** — `99f` recorded losing eight of
them to a transcript. Device frames are now written to disk at capture.
