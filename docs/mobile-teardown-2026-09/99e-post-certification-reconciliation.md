# Post-certification reconciliation — the package caught up to the code

Written 2026-09-08 against branch `fix/mobile-legend-legacy-state`, code tip
**`f5a495c51`**. It supersedes the status half of `99b`, `99c` and `99d`.

⛔ **NOTHING BELOW REWRITES HISTORY.** `99b`/`99c`/`99d` stay exactly as they were
written and stay correct *as of the certification tip* `f8d625c27`. Each now
carries a banner pointing here. Where this document changes a verdict it says
which document held the old one, what the old one was, and what evidence moved
it. A status doc that is silently edited stops being evidence.

## Why this document had to exist

Eleven commits landed **after** the certification and **not one of them touched a
document**. The newest authoritative artifact therefore contradicted the code it
described: `99b` listed MOB-05, MOB-10 and MOB-08 as DEFERRED when three of those
four rows had since shipped, and `99c` recorded two flows as TRADINGVIEW_AHEAD
for reasons that no longer hold. An adjudication reading the package on
2026-09-08 would have reached the wrong answer from the right documents.

⚠️ **AND THE PACKAGE IS SPLIT ACROSS TWO BRANCHES.** The research half
(`06` … `95`, including `70-task-flow-comparisons.md`,
`85-implementation-backlog-and-waves.md`, `90-independent-validation.md`,
`95-census-errata.md`) lives on **`research/mobile-tv-teardown-docs`**. The
implementation half (`96` … `99e`) lives on **`fix/mobile-legend-legacy-state`**.
Neither branch holds the whole package. Anyone reading one half and concluding
the other is missing is reading a branch, not a gap.

## The supersession chain, stated once

```
85 (backlog, research branch)   ──superseded by──▶  99b  ──superseded by──▶  99e
70 (flow comparisons, research) ──rerun in───────▶  99c  ──rerun in───────▶  99e
99d (certification)             ──residuals R1-R6 superseded by──────────▶  99e §3
```

`85` is **frozen research-side and must not be edited**: `99b` already replaced
its counts with measured ones ("Generated from current code, not from the
original backlog's counts"), and this document replaces `99b`'s. Read `85` only
through that chain. The same rule applies to `70`: it is the validated
TradingView baseline and no part of this reconciliation re-opens it — the
TradingView column is untouched throughout.

---

## 1 · The eleven post-certification commits

Certification tip was `f8d625c27` (doc `ab93803ef`). Everything below is after it.

| SHA | What it closed | Which residual |
|---|---|---|
| `8a92e61c2` | a real-device loop for the phone shell that needs **no login** — `device-harness.html`, `vite.device.config.mjs`, `mobileShellHarness.jsx`, `runner.js`, `shellSteps.js` | R1 (partially — see §3) |
| `d14e66957` | drawing and board creation were **dead on an insecure origin** — `crypto.randomUUID` is secure-context-only, so a plain-HTTP phone/LAN origin killed both silently (React swallowed the throw) | transport defect found *by* R1 work |
| `08635811a` | device steps name their failing step, and an un-tapped chart stops reporting FAIL | R1 instrument quality |
| `2d3b2d555` | **MOB-05** — alerts that FOLLOW a drawing, beside the fixed ones | R2 |
| `271522b31` | re-aimed a readout assertion + recorded the device origin — ⚠️ **its diagnosis was later invalidated, see §4** | — |
| `d216ba57b` | **an Objects recovery surface, and only THEN per-object Hide** | R3 (and MOB-15) |
| `251c22e49` | tool discovery at scale — 35 aliases, ranked matching, search is no longer a dead end | F10 residue |
| `78ee9417b` | symbol-search disambiguation — one shared `rowIdentity`, delisted/breadth/ETF badges, category chips | MOB-17 |
| `a9eb38b89` | chart-type catalogue — a Heikin Ashi phone door, and the declines stated in-file | `99d` §3's "smaller one" |
| `2f9d68b9f` | **landscape as a designed MODE** — the toolbar becomes a left-edge rail | R5 |
| `f5a495c51` | the crosshair rails stop racing the frame they read | §4 |

---

## 2 · Residual state as of `f5a495c51`

| residual | at certification | now |
|---|---|---|
| Authenticated real-device loop | BLOCKED | 🟡 **PARTIAL** — a session RAN; see `99f` |
| MOB-05 bound alerts | DEFERRED | **SHIPPED** `2d3b2d555` |
| MOB-10 per-object Hide | DEFERRED | **SHIPPED** `d216ba57b` — *and only because the recovery surface shipped first* |
| Tool discovery at scale | open residue | **SHIPPED** `251c22e49` |
| Symbol-search disambiguation | open (MOB-17, low value) | **SHIPPED** `78ee9417b` |
| Chart-type catalogue | open (smaller gap) | **SHIPPED** `a9eb38b89` |
| Landscape as a designed mode | R5, presentation only | **SHIPPED** `2f9d68b9f` |
| MOB-08 `presentation[deviceClass]` | DEFERRED | **NOT_STARTED / BLOCKED FOR IMPLEMENTATION** |
| Crosshair rail stability | not known to be a defect | **SHIPPED** `f5a495c51` |

---

## 3 · The certification's residuals R1-R6, answered

### R1 · Real-device QA of the authenticated app — **PARTIAL** (updated 2026-09-08)

> 🔄 **UPDATED THE SAME DAY, AND THE TEXT BELOW IS PRESERVED RATHER THAN
> REWRITTEN.** Full evidence: **`99f-r1-authenticated-device-evidence.md`**.
>
> **R1_AUTHENTICATED_DEVICE_GATE = PARTIAL** · **BROWSERSTACK_DEVICE_ACCESS = LIMITED**
>
> · **The cap is CURRENT, not stale** — re-measured on the logged-in account:
>   Free Trial, **60 s per device, hard**, auto-closing, consumed per device
>   (devices grey out after one run). Three sessions confirmed it.
> · **The other half of the blocker is GONE.** The paragraph below gives two
>   independent causes; the second — *"the device cannot authenticate"* — no
>   longer holds. An authenticated session ran on **iPhone 16 Pro / iOS 18.6**,
>   **iPhone 14 / iOS 18.3** and **iPhone 13 Pro Max / iOS 18.3**, signed in as
>   the disposable sandbox account, with `/charts` mounted (`canvas=1`,
>   `shell=phone`) and `pointer: coarse` true on hardware.
> · **No production auth was weakened.** `COOKIE_SECURE` is False off-Railway,
>   so plain-HTTP `bs-local.com` authenticates normally; the only requirement is
>   one origin for SPA + API. No bypass, no token in a URL.
> · 🔴 **F17's unmeasured half is MEASURED: application state across rotation —
>   STATE HELD**, on two devices, carrying symbol *and* timeframe. R5's closing
>   caveat and F17's PARTIAL both rested on this being unmeasured; **§6's F17
>   row and R5's last paragraph are superseded on that point.**
> · **Workspace persistence: PARTIAL.** The phone's `POST /api/charts/layouts`
>   returned 200; the harness's read-back asserted the wrong shape (the endpoint
>   returns `{global, mine}`) — an instrument defect, now corrected and proven
>   end-to-end, with the device leg staged.
> · **F14 bound alerts: NOT VERIFIED, and F14 stays PARITY.** A bound alert
>   firing needs a server evaluation cycle, which does not fit in 60 seconds.
> · **PORTRAIT_TOOLBAR = CORRECT.** A device reading suggested the landscape rail
>   shape in portrait; `tools/r1_toolbar_probe.py` (coarse-pointer emulation,
>   polling to two identical reads) shows `absolute/column` appears ONLY where the
>   gate is true. The device reading was a probe artifact — **the same
>   sample-instead-of-settle defect class as `f5a495c51`'s crosshair race.**
> · ⚰️ **The screenshots were NOT preserved** — captured without saving, so they
>   died with the session. The verbatim panel text in `99f` §3 is what survives.
>   Every future device pass saves its frames at capture time.

*(original text, as written when R1 was blocked:)*


Nothing has changed about the cause, and it must not be reported as softened. The
BrowserStack account is still a Free Trial capped at one minute per device, and
the device still arrives as `bs-local.com`, carries no session, and lands on a
login form that I am not permitted to fill in.

⛔ **The no-auth harness is NOT this.** `8a92e61c2` shipped a genuinely useful
instrument — a separate vite entry rendering the real `StockChart` against
fixture bars, with every verdict computed on-page so ONE screenshot answers
everything inside a one-minute budget. It is what verified `pointer: coarse` CSS
in both orientations and the landscape rail. It is **not equivalent to
authenticated application E2E**, and it can never answer a question about a
member's own workspace record, persistence across reload, or an alert firing.
Anywhere this package says "device-verified", check which of the two it means.

Two things the R1 *work* produced that are worth keeping separate from R1 itself:
`d14e66957` — a real product defect (drawing and board creation dead on a
plain-HTTP origin) that only a device on a LAN origin could have surfaced; and
`08635811a` — the harness no longer reports a chart it never tapped as a FAIL.

**To clear R1, unchanged:** a BrowserStack plan with usable session length, or the
owner signing the sandbox account in during a session. Both are owner actions.

### R2 · MOB-05 object → alert binding — **SHIPPED** (`2d3b2d555`), supersedes `99d`

⭐ **AND THE CERTIFICATION'S OWN REASON FOR DEFERRING IT WAS WRONG.** R2 said it
needed "an alert-row schema change *and* a change to server-side alert
evaluation". Re-verifying against current code found the evaluator was **already
correct**: the schema carries `anchor_t1/p1/t2/p2` and `_alert_level_now`
interpolates a sloped line's level at check time. The real defect was narrower
and worse — `handleSetDrawingAlert` **copied** the drawing's points and kept no
reference back, so dragging the line left the alert behind and deleting the line
left it armed against something invisible. Both silent.

Binding is therefore a sync problem, not a maths one: one nullable column, two
endpoints, one hook, with `drawing_id IS NOT NULL` as the single authority on
"bound". Both semantics are offered on purpose — "Follows the line" (default) and
"Fixed level" — and the seeded zero-typing path is untouched, with a standing
rail (`test_a_seeded_fixed_alert_is_never_touched_by_a_resync`) on that promise.

⚠️ **Evidence tier: TEST, not REAL.** The certification's objection — there is no
way to watch a bound alert actually *fire* — is an R1 objection and it survives.
This is why F14 moves to PARITY below and not to UCT_AHEAD.

### R3 · MOB-10 per-object Hide — **SHIPPED** (`d216ba57b`), constraint honoured

The gate held: **the recovery surface shipped first, and Hide is safe because of
it.** The Objects sheet answers all three kinds of lost — HIDDEN (still listed,
marked, one tap back, plus "Show all N", and the count is on the *door* so a
chart quietly missing three levels gives you a reason to look), LOCKED (the other
way an object stops responding with nothing on screen to say why), and FORGOTTEN.

⛔ **MOB-15 (the object tree) is closed by the same commit** and must stop being
listed as deferred: the recovery surface *is* the object tree, and it arrived as
MOB-10's prerequisite rather than as its own item. `99b`'s DEFERRED_LOW_VALUE row
for MOB-15 is superseded.

Two properties worth carrying forward because they are the reason this is safe:
the sheet owns **no state** (it reads `useChartDrawings(sym)`, the same store the
canvas draws from, so it cannot disagree with the chart about what exists); and
`visibleDrawings` is explicit at exactly two sites — the canvas and the hit test —
because filtering the overlay's `drawings` *prop* would have made the paneRelY
migration rebuild the list from the visible set and **silently delete every
hidden object**, with the whole suite green.

### R4 · MOB-08 `presentation[deviceClass]` — **NOT_STARTED, and blocked on purpose**

Unchanged in substance, and the owner has re-affirmed the block. It is an `L`,
MEDIUM-risk, persistence-shape migration on the workspace record — by the
certification's own words "the one place a careless refactor produces a blank
board". It does not begin while R1 is open.

⛔ **AND IT MUST NOT BE REDESIGNED AROUND THE ABSENCE OF DEVICE ACCESS.** The
correct sequence is to remove the evidence limitation, then build. A version of
MOB-08 shaped by what happens to be testable without a device is a different
feature wearing the same name.

### R5 · Landscape as a designed MODE — **SHIPPED** (`2f9d68b9f`)

The certification recorded a "correct-but-undesigned" landscape: the immersive
branch made portrait chrome thinner, but the five chart controls still sat in a
bottom row, which is **portrait grammar**. Rotated, a phone is held in two hands
with the thumbs at the left and right edges, so a bottom-centre row is the one
place neither thumb reaches — and it spends the scarce axis to do it.

The toolbar now leaves the flow and becomes a **left-edge rail**. The trade is
the argument: landscape has width to spare (844px) and height to spare none
(390px), so taking the row out of flow returns ~56px — about 15% of the visible
chart — and a 52px rail costs 6% of a width nobody was using. It is the LEFT edge
because the right edge carries the price scale and the newest bars; the left edge
is the oldest. No control is lost, none renamed, order unchanged.

**Verified on a real iPhone 16 Plus / iOS 18.6, rotated:** mode engaged yes ·
out-of-flow vertical rail yes (absolute/column) · hugs the left edge yes
(x=59 w=52) · all five doors kept.

⛔ **Two instrument rules came out of this and generalise.** *Orientation cannot
be a step* — a step runs once, at load, in whatever orientation the device
started in, which is portrait; so the harness carries a live panel that re-reads
forever and prints a clock, because a readout that stops polling reports the last
thing it saw as though it were now (exactly how an earlier pass recorded
`max-width:640px: true` on an 844px phone). *And it cannot be measured in a
desktop iframe at all* — measured: at 844x390 the media query matched WITHOUT the
`(pointer: coarse)` clause and failed WITH it, so a probe that drops the clause
"to make the test work" reports success against a rule that never applied.

⚠️ **R5's other half is untouched.** Application state across rotation — symbol,
timeframe, drawings, open sheets — is still **UNMEASURED** and still needs R1.
F17 stays PARTIAL below for exactly this reason.

### R6 · Drawing Boards — CLOSED at certification, unchanged.

---

## 4 · ERRATUM · the crosshair diagnosis, and the methodology lesson

⚰️ **`271522b31`'s diagnosis is INVALIDATED by `f5a495c51`.**

What `271522b31` said: `waveOneIntegration > the readout survives a SCALE CHANGE`
asserted `V 2.0M`, went red in company and green alone, and the legend had
"legitimately fallen back to the DEVELOPING bar's own volume". It widened the
assertion to *some* formatted number and moved on.

What is actually true: **that fallback is what the legend shows when the hover has
not landed at all.** `StockChart`'s crosshair handler does not render — it parks
the param on a ref and schedules ONE `requestAnimationFrame` flush, so the legend
updates a *frame* later than the event. Both suites had rolled their own local
`pump`: twelve deliveries on a 20ms timer, then assert. That is a fixed sleep
budget racing a frame on a fork the repo's own `vite.config.js` measures at 2x
wall variance. When the frame loses, the read is taken before the hover lands and
the off-hover row (`O 114.73 H 115.09 L 114.06 C 114.26` — the fixture's real
last bar) is a complete, correct readout failing an assertion about *which bar
was hovered*. The diagnosis described the symptom accurately and stopped one
layer short of the cause.

⭐ **The fix already existed in the repo.** `legendProbe.js::settledLegend` polls
to two identical reads and was written for this exact defect; its lesson 1 is
"NEVER `setTimeout(40)` AND COMPARE", recorded after the same failure in
`stockChartWiring`. `mobileScaleAndVolume` had imported `legendTextOf` from that
file and **left `settledLegend` behind**; `waveOneIntegration` re-implemented
both. Both now take the shared read, and the original stricter `V 2.0M` is
restored — a rail that accepts any number cannot tell a scale write that *blanks*
the volume rows from one that silently swaps which bar is being read.

⛔ **The predicate has to discriminate.** `LEGEND_RENDERED` (`/O\s*1/`) also
matches the off-hover row `O 114.73`: it answers "did a legend draw", not "did MY
hover land". `L 0.5` is the synthetic low and appears in no real bar of the
fixture, so it is the one token that separates them. A poll with a
non-discriminating predicate settles on the wrong state and is worse than a
sleep, because it looks rigorous.

⛔ **And one case must NOT use it.** `they are CONTEXTUAL — no crosshair, no rows`
asserts the legend stays ABSENT, and a stability poll whose predicate accepts an
empty read returns on the *first* read — before the legend could have appeared,
which is the only thing that case exists to catch. It keeps a fixed number of
deliveries, correctly, because the expected outcome is NO CHANGE: nothing is
being waited for, so nothing can be read too early.

**Proof it is the cause, not a hopeful re-run.** With `requestAnimationFrame`
forced to 800ms the old fixed-budget helper reproduces the production failure
byte-for-byte (`expected '2025-10-08O 114.73H 115.09L 114.06C 1…' to match
/O\s*1.*H\s*2.*L\s*0\.5.*C\s*1\.5/`) while the settled read PASSES under
identical conditions. At 2000ms the settled read does not silently pass either —
it throws **by name** ("the legend never settled to two identical reads"),
blaming the instrument rather than the product.

### 🧭 The lesson, stated generally

> **A FIXED SLEEP IS NOT BEHAVIOURAL SYNCHRONISATION.** Where UI state is
> *intentionally* frame-delayed, a test must wait for the semantic state, not for
> elapsed time — and the predicate it waits on must be one only the desired state
> can satisfy. A fixed budget does not test the product; it measures the machine,
> and it fails on the machine's worst day while passing on yours.

This joins the register in `98` §6 as a rule that holds from here, and it is the
third instrument failure this program has recorded (after the frozen landscape
readout and the un-tapped chart reporting FAIL). ⭐ The pattern across all three:
**every one of them failed by agreeing with something plausible.**

---

## 5 · Current test reality, stated exactly

`vitest run src/components/chart`, run **three times consecutively** after
`f5a495c51`, produced an **identical failure set every time**. Two runs before
that change disagreed with each other, which is what started the investigation.

**Three known pre-existing functional failures** — none of them from this
program, all reproducible:

| test | nature |
|---|---|
| `ImportBox.thinkscript` · "it DECLINES while the box is one keystroke behind" | CRLF vs LF line endings on Windows |
| `manifestProse` · "every key the product READS survives the strip" | the `_session` key |
| `pine.blindCorpus` · "the accepted floor moves one way too" | indicator-ecosystem workstream |

**Two aggregate-only timeouts**, which must be recorded and must NOT be called
regressions: `enumerationSites` ("names every shipped Python module…") and
`manifestProse` ("the keep list has no passengers") hit the 15s `testTimeout`
during a full batch and **both pass in isolation**. They are filesystem scans
starved by the fork pool — the exact class the repo's `vite.config.js` documents
at length ("that extra parallelism is thrashing, not throughput"). Timing
failures in the aggregate are not evidence of a product regression; they are also
not nothing, and hiding them would repeat the error this program keeps finding.

Suites owned by this program: **156/156** `pages/charts/mobile`, **53/53** across
the two repaired crosshair suites, **6/6** landscape, with the landscape rail
mutation-checked 4/4 red against a green control and a byte-identical restore.

---

## 6 · The 20 canonical workflows, rerun

Same 20 flows, same five verdict categories, **same validated TradingView
baseline** (`70-task-flow-comparisons.md` — not re-opened, not re-researched).
Only UCT's side moved, and only where a commit moved it.

| flow | at `99c` | now | Δ |
|---|---|---|---|
| F01 launch → chart | PARITY | **PARITY** | — |
| F02 change ticker | PARITY | **PARITY** | rows now disambiguate (`78ee9417b`) — see below |
| F03 cycle watchlist | UCT_AHEAD | **UCT_AHEAD** | — |
| F04 change timeframe | UCT_AHEAD | **UCT_AHEAD** | — |
| F05 inspect a candle | UCT_AHEAD | **UCT_AHEAD** | verdict unchanged; its *rail* is now sound (`f5a495c51`) |
| F06 return to live | PARITY | **PARITY** | — |
| F07 add an indicator | UCT_AHEAD | **UCT_AHEAD** | — |
| F08 modify an indicator | UCT_AHEAD | **UCT_AHEAD** | — |
| F09 remove / hide an indicator | PARITY | **PARITY** | — |
| F10 add a drawing | PARITY | **PARITY** | search-by-meaning shipped; see below |
| F11 position / edit a drawing | UCT_AHEAD | **UCT_AHEAD** | — |
| F12 drawing properties | **TRADINGVIEW_AHEAD** | **PARITY** ⬆ | Hide shipped *with* recovery (`d216ba57b`) |
| F13 alert from a price | UCT_AHEAD | **UCT_AHEAD** | — |
| F14 alert from an object | **TRADINGVIEW_AHEAD** | **PARITY** ⬆ | MOB-05 shipped (`2d3b2d555`) |
| F15 change chart type | PARITY | **PARITY** | Heikin Ashi door shipped; see below |
| F16 chart settings | UCT_AHEAD | **UCT_AHEAD** | — |
| F17 portrait ↔ landscape | **PARTIAL** | **PARTIAL** | mode shipped; the unmeasured half is unchanged |
| F18 leave and come back | UCT_AHEAD | **UCT_AHEAD** | — |
| F19 save / restore a workspace | UCT_AHEAD | **UCT_AHEAD** | — |
| F20 contextual intelligence | DIFFERENT_MODEL | **DIFFERENT_MODEL** | — |

### Distribution

| | at certification (`99c`) | now |
|---|---|---|
| UCT_AHEAD | 11 | **11** |
| PARITY | 5 | **7** |
| TRADINGVIEW_AHEAD | 2 | **0** |
| DIFFERENT_MODEL | 1 | **1** |
| PARTIAL | 1 | **1** |

**No flow moved backwards. No flow was re-scored without a commit behind it.**

### The two flows that moved, and why they moved only to PARITY

**F12 · drawing properties — TRADINGVIEW_AHEAD → PARITY.** `99c` marked this
against itself: Hide was listed as MISSING on UCT and deferred because shipping
it without a recovery surface would create a worse defect than it fixed. That
condition is now satisfied — Hide exists, and every hidden object is still
listed, marked, one tap from returning, with a "Show all N" and a count on the
door. The named gap is closed.

⛔ **Not UCT_AHEAD**, and the restraint is deliberate: I have **no verified
evidence** about the shape of TradingView's own object manager on iOS. `70`
recorded the property *sets*, not a comparison of recovery surfaces. A negative
claim about a competitor needs the same proof as a positive claim about us, and I
do not have it. PARITY is what the evidence supports.

**F14 · alert from an object — TRADINGVIEW_AHEAD → PARITY.** This was the one
cluster the research called "simply better", on one specific ground: TradingView
*binds* the alert to the object so moving the line moves the alert, while UCT
*seeded* a price snapshot that then stood alone. UCT now binds, offers both
semantics explicitly, remembers the choice, and keeps the zero-typing seeded path
intact.

⛔ **Not UCT_AHEAD**, on evidence tier. The certification's own objection was that
there is no way to watch a bound alert actually fire without an authenticated
device, and that is still true — the binding is proven by frontend and backend
tests, not by a fired alert on a phone. UCT's lower creation cost (three
gestures, zero typing) was already measured at baseline and is real, but "cheaper
*and* equal semantics" becomes a leadership claim only when the semantics are
verified end to end. **F14 is the flow most likely to move to UCT_AHEAD the day
R1 clears**, and that is the honest way to hold it.

### The three flows that improved without changing verdict

**F10 · add a drawing — PARITY holds.** `99c` withheld UCT_AHEAD for two reasons:
TradingView's picker is native-fast, and its categories help at a larger
catalogue. `251c22e49` answers the second more directly than categories do — 35
aliases mean `support`, `zone`, `fibonacci`, `parallel`, `ruler`, `risk`, `vwap`
and `earnings` all resolve, matches are *ranked* rather than filtered to a guess,
an exact name always outranks somebody else's synonym, and an unmatched query no
longer empties the screen. The first reason is untouched, so the verdict is.

**F02 · change ticker — PARITY holds.** `78ee9417b` closed a real presentation
defect: a delisted ticker looked exactly like a live one, an ETF was
indistinguishable from the operating company, and a UCT breadth pseudo-ticker
read as a company. `99d` §3 listed this as one of TradingView's two "smaller,
real" wins and it is now closed. It does not make UCT *ahead* — TradingView's
rows disambiguate too — so PARITY, with the gap gone.

**F15 · change chart type — PARITY holds.** `a9eb38b89` gave Heikin Ashi a phone
door — another orphan, the Drawing Boards shape exactly: a live field
(`heikinAshi`) whose only control was a checkbox inside the `display:none`
`ChartToolbar`. `99d` §3's other "smaller" TradingView win was the broader
catalogue (Renko/Kagi/PnF), and that is **unchanged and deliberately declined**:
each is a different *construction* of the series with its own transform, axis
semantics and live-bar rules against the single-writer invariant. Declining them
with a stated reason is not a gap, but it is also not a win, so PARITY.

### F17 · why landscape did NOT leave PARTIAL

The presentation half is now stronger than it has ever been — a designed mode,
real-device verified on an iPhone 16 Plus. The other half of the PARTIAL is
**application state across rotation**, which is unchanged, unmeasured, and needs
the authenticated app. Upgrading F17 on the strength of the half that improved
would be exactly the massaging `99c` refused to do.

---

## 7 · The best-in-class residual register

### OWNER_ACTION_REQUIRED

1. **An authenticated real-device loop.** 🟡 **PARTIALLY OPEN as of 2026-09-08** —
   a session runs and authenticates (`99f`); what remains is DURATION, a hard
   60 s per device. The recommended next step is NOT a purchase but an
   authenticated auto-driving harness (`99f` §8), which also produces the
   measurement that would justify a plan if it turns out to be needed.
   Originally: Needs a BrowserStack plan with usable session length, or the owner signing
   the sandbox account in during a session. Required outcome: a real iPhone → the
   authenticated app → a real member workspace → ideally an isolated test
   workspace → the ability to verify persistence across reload, orientation and
   device presentation.

### SURVIVING_BUILD_ITEM

2. **MOB-08 `presentation[deviceClass]`** — the only unbuilt item in the program.
   **BLOCKED FOR IMPLEMENTATION** behind (1) by owner decision, and it must not be
   redesigned around the absence of device access.

### VERIFICATION_ONLY — all gated behind (1)

3. Application state across rotation (F17's unmeasured half).
4. A bound alert actually firing on a device (F14's route to UCT_AHEAD).
5. Percent / Log / Arithmetic / Auto rescaling, the price-context sheet, Layouts,
   and workspace persistence — verified today at 390px in a real browser plus
   behavioural tests, never on an authenticated device.
6. **MOB-02 residue** — do the phone watchlist columns *populate* against a live
   vendor feed? The layout claims were disproven (`scrollWidth === clientWidth`,
   388/388); the data question needs a sandbox with a vendor key.

### INTENTIONAL_DESKTOP_ONLY — decisions, not gaps

7. Bar replay · symbol comparison · multi-chart grid — recorded in `98` §3.3.
8. The desktop A/L/% price-scale chips, the desktop `ChartToolbar`, and the
   desktop Heikin Ashi checkbox — hidden on the phone shell **by intent**, with
   the phone reaching the same *tasks* by other doors.

### DEFERRED_PRODUCT_CHOICE

9. Renko · Kagi · Point & Figure · Line Break · Baseline · Step Line — declined
   with reasons recorded next to the catalogue they are absent from.
10. Favourites in the tool picker — declined in favour of recents (curation before
    use vs recency that pays from the second session).
11. MOB-13 (truncate formula rows, subsumed by the MOB-06 rule) · MOB-16
    (watchlist sort tap targets) · MOB-19 (named drawing/settings templates —
    "Save as default" covers the 80%) · MOB-20 (replay/compare phone doors, whose
    register entry in `98` §3.3 the backlog itself said mattered more).

⚰️ **Removed from every deferred list — do not re-list these:** MOB-05 (shipped),
MOB-10 (shipped), **MOB-15, the object tree (shipped as MOB-10's prerequisite)**,
MOB-17 (shipped).

---

## 8 · What this reconciliation did NOT change

Every correction the package already carries survives, and none of it was
re-opened:

- TradingView's cursor-decoupled placement is **not** a required UCT replacement;
  `Set level…` is the stronger exact-price mechanism.
- Bare-chart price contextual actions and the rich mobile crosshair are UCT
  strengths.
- Named layouts/workspaces are **server-backed already**; MOB-01 opened the door
  and **no second mobile persistence system may be created**.
- Percent scale has a mobile path **without** restoring desktop A/L/% furniture.
- `$ Vol` / `Avg ND` belong contextually in the mobile crosshair legend.
- The "eleven controls collapse to 0x0" theory stays **withdrawn**: the whole
  `ChartToolbar` carries an inline `display:none`, and its children report
  `display:flex` at 0x0 only because `display` is not inherited. Read the
  CONTAINER's computed style, never the children's boxes.
- MOB-07 intentionally exposes one runtime fact through **two doors** — a pure
  module-scope function for ~22 pure call sites and a hook for components. A hook
  alone cannot serve pure functions; do not collapse it.
- Fine-pointer / responsive absence is **not** evidence of missing mobile
  capability.
- Per-object Hide required a recovery surface first — and that condition was
  honoured, not waived, when it shipped.
- The three presentation mechanisms stay **deliberately un-unified** (`98` §5).
