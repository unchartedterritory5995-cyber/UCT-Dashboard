# R1 — the authenticated device gate, and what it measured

Run 2026-09-08 against branch `fix/mobile-legend-legacy-state` at code tip
`51f32d61c`. This is the evidence record for `99e` §3's R1, which was **BLOCKED**
when that document was written and is now **PARTIAL**.

> **R1_AUTHENTICATED_DEVICE_GATE = PARTIAL**
> **BROWSERSTACK_DEVICE_ACCESS = LIMITED**

> 🔄 **CONTINUED THE SAME DAY by `99g-route-b-auto-driving-device-harness.md`.**
> Route B closed the gap this document left open: the authenticated auto-driving
> harness runs the suite in **12.1 s on a real iPhone**, and
> **DEVICE_WORKSPACE_ROUNDTRIP = PASS** — read back ON the device, not promoted
> from a host-side run. §4 and §6 below are superseded on those two points; the
> 60-second cap in §1 is unchanged but is no longer the binding constraint.

---

## 1 · The account limit, re-measured rather than inherited

`99b`/`99d` recorded "Free Trial, one minute per device" and the owner asked for
that to be re-verified rather than carried forward on trust. It was, on the
logged-in account, and **the figure is current, not stale**:

- Dashboard: *"Each device is available for up to 1 minute during Free Trial. For
  full access: Buy Pro plan"*, with **Buy a plan** in the top bar.
- In-session: *"…for up to 1 minute(s), after which the session will
  automatically close"*, with a visible countdown, and a red *"session will end
  in 6 seconds"* before each auto-close.
- **Measured duration: 60 s, hard**, on three separate sessions.
- **Per-device consumption confirmed live:** iPhone 16 Pro was selectable, then
  greyed out after its run; iPhone 14 greyed after its run. Roughly a dozen
  devices were already spent before today.

⭐ **What HAS changed since `99b` is the other half of R1.** That document gave two
independent causes: the minute cap *and* "the device cannot authenticate."
**The second is now closed** — see §3. Only the cap survives.

## 2 · Why authentication needed no bypass — measured before it was attempted

`api/routers/auth.py:86`

```python
COOKIE_SECURE = os.environ.get("RAILWAY_ENVIRONMENT") is not None  # True on Railway, False local
```

So on a local sandbox the session cookie is `secure=False`, `samesite=lax`,
`httponly`, host-only, `path=/`. Confirmed empirically rather than read: a real
login issued `uct_session … secure=FALSE, HttpOnly`.

⛔ **Therefore plain-HTTP `bs-local.com` authenticates normally, and NOTHING was
weakened.** No production auth change, no test-only bypass, no magic link, no
token in a URL. The one requirement is that the SPA and `/api` be the **same
origin**, which is why the tunnel points at the sandbox backend (which serves the
built SPA *and* the API on one port) rather than at the vite device entry — that
entry deliberately has no `/api` proxy, and its own header records that pointing
it at a backend "is what put a login form in front of the phone."

Supporting measurements, all on the sandbox:

| check | result |
|---|---|
| sandbox isolation | root redirected to a temp dir, fail-closed; never `C:\data` |
| serves **this** branch | served entry hash `index-Gpmury4K.js` == `app/dist` exactly |
| `Host: bs-local.com:8091` | **200** — no `TrustedHostMiddleware` to reject the tunnel Host |
| unauthenticated `/api/auth/me` | **401** |
| test account | `role: admin`, `paid_equiv: true` — every route visible |

The credential is a **disposable sandbox account** in a throwaway temp database,
created for this run and discarded with the sandbox. No owner credential, MFA,
or payment detail was involved at any point.

## 3 · What ran on hardware

| device | iOS | what it produced |
|---|---|---|
| iPhone 16 Pro | 18.6 | transport proof — the real app over `bs-local.com` |
| iPhone 14 | 18.3 | authenticated session; rotation state held |
| iPhone 13 Pro Max | 18.3 | independent confirmation, both orientations |

**Verbatim on-device readouts** (the harness computed every verdict on-page, so
one screenshot answers everything inside a 60-second window):

```
iPhone 14 / iOS 18.3 — LANDSCAPE
R1 · AUTHENTICATED DEVICE GATE · 844×340 · LANDSCAPE · 13:02:01
· signed in: e2e-sandbox@local.dev
· real app mounted: yes   path=/charts canvas=1 shell=phone
· symbol / timeframe: SPY / —
· pointer coarse: yes · landscape MODE engaged: yes
· toolbar rail: yes  absolute/column x=47 w=52 · 5 doors:
    Timeframe · Chart type · Indicators · Watchlist · More tools
· APP STATE ACROSS ROTATION: STATE HELD

iPhone 13 Pro Max / iOS 18.3 — PORTRAIT then LANDSCAPE
R1 · AUTHENTICATED DEVICE GATE · 428×745 · portrait · 13:03:32
· signed in: e2e-sandbox@local.dev
· real app mounted: yes   path=/charts canvas=1 shell=phone
· symbol / timeframe: SPY / 1D
· pointer coarse: yes · landscape MODE engaged: no

R1 · AUTHENTICATED DEVICE GATE · 926×378 · LANDSCAPE · 13:04:03
· pointer coarse: yes · landscape MODE engaged: yes
· toolbar rail: yes  absolute/column x=47 w=52 · 5 doors
· APP STATE ACROSS ROTATION: STATE HELD  SPY / 1D
```

### What that closes

- **An authenticated real-device session exists.** R1's authentication half is
  answered; `99b`'s "the device cannot authenticate" no longer holds.
- **The real member workspace loads** on a phone: `/charts`, one chart canvas,
  the phone shell active.
- **`pointer: coarse` is true on real hardware**, so every coarse-gated rule is
  being evaluated for real rather than emulated.
- **The designed landscape mode engages on hardware**, and the rail is the shape
  it was built to be: out of flow, vertical, left-anchored, 52px, five doors,
  same order and names.
- 🔴 **F17's unmeasured half is MEASURED: APP STATE ACROSS ROTATION — STATE
  HELD**, on **two devices**, carrying both symbol and timeframe. The
  certification recorded this as "NOT measured; it needs the authenticated app."
  It now is.

## 4 · Workspace persistence — PARTIAL, and the failure was the instrument

The device's `POST /api/charts/layouts` returned **200**: the phone wrote to the
server-backed workspace. The harness then reported `rows 0→undefined · read back
false`, which was **my probe, not the product**.

⛔ **The read-back asserted the wrong shape.** `GET /api/charts/layouts` returns
`{global: [...], mine: [...]}` (`charts_layouts.py::list_layouts` →
`svc.list_for_user`), not a bare array and not `{layouts: [...]}`. The probe read
`(before.layouts || before).length`, which is `undefined` against that object —
a green-looking call and a meaningless assertion.

Corrected and proven end-to-end against the sandbox:

```
GET  /api/charts/layouts   → top-level keys: ['global', 'mine']   {global: 0, mine: 0}
POST /api/charts/layouts   → 200            (name __r1_device__, scope user)
GET  (same session)        → mine: ['__r1_device__']              READBACK: PASS
POST /api/auth/login       → 200            (a NEW session — reload-equivalent)
GET  (fresh cookie)        → mine: ['__r1_device__']              PERSISTED: PASS
```

So the chain **mobile write → server 200 → read-back → survives a new session**
holds. It stays **PARTIAL** for one honest reason: the *read-back* leg was
executed from the sandbox rather than from the phone. It is the same HTTP call
over the same authenticated cookie, so the residual risk is small — but "small"
is not "measured," and this program does not promote the two. The corrected
probe is staged for the next device minute.

⛔ **An isolated `__r1_device__` layout was used throughout.** The owner's working
board was never read or written; the sandbox has its own database and is
discarded.

## 5 · PORTRAIT_TOOLBAR = **CORRECT** — settled off-device

The device's portrait reading said `absolute/column x=6 w=52` while the landscape
gate reported false, and only ONE rule in `MobileCharts.module.css` produces
`absolute/column` — the landscape block. That had to be resolved before MOB-08
touches presentation.

⛔ **A plain browser structurally cannot answer it** (`pointer: coarse` is false on
desktop at any width — measured on this branch: the query matched WITHOUT the
pointer clause and failed WITH it). `tools/r1_toolbar_probe.py` is the local
instrument that can: a Playwright context with `is_mobile=True, has_touch=True`
makes Chromium report coarse, the probe **prints what pointer actually resolved
to and refuses to conclude anything if it is not coarse**, and every measurement
**polls to two identical reads** rather than sampling once.

| case | coarse | gate | position | flexDir | left | width |
|---|---|---|---|---|---|---|
| portrait · device viewport 428×745 | true | **false** | static | row | 0 | 428 |
| portrait · iframe box 428×595 | true | **false** | static | row | 0 | 428 |
| landscape · device viewport 926×378 | true | **true** | absolute | column | 6 | 52 |
| landscape · iframe box 926×228 | true | **true** | absolute | column | 6 | 52 |

**`absolute/column` appears only where the gate is true.** The CSS is correct in
both orientations; the toolbar is a full-width row in portrait exactly as
designed.

⚰️ **The device reading was a probe artifact — category A.** The R1 harness read
`getComputedStyle` on a single frame with no settlement rule, moments after the
app booted inside a freshly-created iframe. ⭐ **It is the same defect class as the
crosshair race fixed in `f5a495c51` earlier the same day**: an instrument that
SAMPLES where it should SETTLE. `settledLegend` exists for exactly this, the
landscape live panel was built with a clock for exactly this, and the R1 harness
still shipped without either. The rule generalises further than the legend did —
**any probe reading computed style or layout must poll to a stable value and say
so** — and `r1_toolbar_probe.py` is written that way.

⚠️ Scope of the verdict, stated rather than implied: it is settled on Chromium
with emulated coarse pointer plus source analysis showing a single producing
rule. A WebKit-specific media-query difference is not excluded, only made
unlikely; one device minute would close that residue if the owner wants it.

## 6 · What R1 still owes

**NOT device-verified**, and the 60-second cap is why: symbol switching · chart
types · Percent/Log/Arithmetic/Auto rescaling · crosshair OHLC/V/$ Vol/Avg 50D ·
the price-context sheet · Tools · Layouts apply/save · drawing placement and
editing by finger · the object manager · Hide → recover · tool discovery ·
symbol-search disambiguation · the chart-type catalogue.

**F14 bound alerts — NOT VERIFIED, and it stays PARITY.** Creating a bound alert,
moving the drawing, and observing the updated condition fire needs a server
evaluation cycle. That does not fit inside sixty seconds, so it cannot be
answered by the current instrument at all — it is not a matter of trying harder.
⛔ It is not promoted on tests alone, and it is not demoted either.

## 7 · Evidence handling — a process defect worth recording

⚰️ **The eight in-session screenshots could not be exported.** They were captured
without `save_to_disk`, so they existed only as conversation attachments and
cannot be retrieved after the fact — and the device sessions that produced them
are consumed and unrepeatable. What survives is the verbatim panel text in §3,
which is the part carrying the actual verdicts.

⭐ **The rule that follows, and it belongs beside the "one screenshot answers
everything" design:** a harness whose entire output is an image must SAVE that
image at capture time. Evidence that lives only in a transcript is evidence that
was never really preserved — the same failure this package keeps finding in other
forms (a counter that resets on redeploy, a readout that stops polling). Every
future device pass saves its frames before the session closes.

## 8 · The long-tail route — B, not A

Two paths were considered for the remaining flows.

**A · a paid BrowserStack plan.** Would work, and is the only thing that makes
interactive device QA pleasant. ⛔ **Not recommended as the next step, because it
has not been shown necessary**: the binding constraint is idle time, and the
current harness spends most of its minute booting and waiting rather than
testing.

**B · an authenticated auto-driving harness — RECOMMENDED.** The pattern already
exists in `app/src/testing/device/shellSteps.js`; it simply predates
authentication and was written for a no-auth entry. Extended to boot against the
disposable sandbox, drive deterministic flows, compute verdicts on-page and save
its own frames, a single 60-second session can answer many flows instead of one.
It modifies no production code, weakens no auth, and needs no purchase.

⭐ **The measurement that would change this answer:** if a fully-automated pass
still cannot clear the flow list inside 60 seconds — because the app's own boot
plus settle time eats the window — then the cap really is the binding constraint
and a plan is warranted. That is a number, not an opinion, and route B produces
it as a side effect.

## 9 · The MOB-08 gate

| condition | state |
|---|---|
| portrait-toolbar discrepancy resolved | ✅ **CORRECT** (§5) |
| workspace round-trip probe corrected | ✅ corrected and proven; device leg staged (§4) |
| a credible verification mechanism for the persistence/presentation migration | ⛔ **NOT YET** |

**MOB-08 remains NOT_STARTED and BLOCKED.** Two of three conditions are met. The
third is the one that matters most for a persistence-shape migration on the
workspace record — "the one place a careless refactor produces a blank board" —
and it is exactly what route B is for.
