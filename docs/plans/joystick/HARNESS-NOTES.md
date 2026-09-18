# The rendering harness — the sanctioned path when the sandbox cannot boot

> **Two files, ~26 MB of resident memory, and no contact with `C:\data` at all.**
>
> ```
> tools/hub_critique_server.py    the static server: the built SPA + the four API answers the hub needs
> tools/hub_critique_capture.py   the capture: states, themes, profiles, a manifest, and a self-check
> app/src/hub/hubShowing.js       the SHOWING predicate — ONE authority, railed in the suite
> ```
>
> ```sh
> cd app && npm run build                       # once — the harness serves dist/, it does not build
> python tools/hub_critique_server.py --port 8131 --backdrop
> python tools/hub_critique_capture.py --base http://127.0.0.1:8131 --out <dir> --pass N
> python tools/hub_critique_capture.py --self-check          # proves the predicate answers NO
> ```

---

## Why it exists — and it is not a preference

`scripts/hub_sandbox_boot.py` is the right instrument for a device certification run: it boots the
whole FastAPI app, arms the AST-derived env pins, and arms the shared-root tripwire. For
**photographing a control's material** it is the wrong instrument twice over, and both were
measured on 2026-09-17/18:

| | sandbox | harness |
|---|---|---|
| resident memory | **~1 GB** | **26 MB** |
| contact with `C:\data` | pins + tripwire + snapshot rail | **none — no database, no scheduler, no env pin** |
| survives another session writing the shared root | **no** | yes |

⛔ **THE SECOND ROW IS THE ONE THAT BLOCKED THIS PROGRAMME.** `hub_sandbox_boot.py:288` re-hashes
the whole shared root at +15 s and on **any** difference calls
`print("ABORTING THE RUN. The sandbox reached live data."); os._exit(2)`. On a box with concurrent
sessions it **cannot attribute** that difference to the process it is watching — and it did not:
another session was writing `C:\data\wisdom.db` continuously (three distinct hashes across two
boots), so the sandbox died 15 seconds into every attempt while this session's own tripwire
reported **zero** violations. `resource-manifest.md` §7 and §9 carry the full evidence.

⭐ **The harness has no such guard because it needs none.** It reads `app/dist` and answers four
routes. There is nothing for it to leak.

---

## What it serves, and what it stubs

| route | answer |
|---|---|
| `/api/auth/me` | a synthetic admin at `critique@harness.invalid` — unroutable by construction |
| `/api/auth/preferences` | the `joystick_hub` blob (enabled, surface) **and `theme`** |
| `/api/*` (everything else) | `{}` — so the SPA renders its own empty states rather than an error boundary that would cover the hub |
| `/__harness` | identity, so a capture can prove **which** server it photographed |
| everything else | `dist/`, with SPA fallback |

⛔ **It refuses a busy port rather than binding beside another listener.** Windows permits the
second bind and then nobody can say which socket answered — *a port assignment is not a server
identity*. `/__harness` is how a caller confirms it reached this one.

---

## ⛔ THE TWO LIMITS. Quote these beside any finding taken here.

### 1 — `/dashboard` mounts no hub

Four rows come back `INCONCLUSIVE: no hub-root in the DOM`, on both profiles and both themes.
Almost certainly the harness: every API answers `{}` and the Dashboard is the most data-dependent
route in the app, so a tile is likely throwing into a route-level error boundary that takes
`Layout` — and therefore the hub — with it.

⛔ **Recorded as INCONCLUSIVE, never as a defect**, because this harness cannot tell that from a
real mount failure. ⭐ And it matters more than a missing frame: **Home is the mode R4 cut to a
single bubble**, so `/dashboard` is exactly the frame that would settle **D-53**, and it is the one
frame this path cannot take. That question needs the sandbox or production.

### 2 — it says nothing about gesture feel

Pointer events are **synthetic**. That is enough to put the control into a visual state and
photograph it. It is **not** evidence about flick, hold or scrub — **R9 stands**, those need a real
finger. Every manifest row is stamped `synthetic: true` so no later reader can quote a screenshot
as a gesture result.

⚠️ And the backdrop is a synthetic field, not live data. The design bar says this control "sits
over dense, moving data", so **a blur judged here is judged over the easiest backdrop it will ever
have.** `--backdrop` paints a dense ruled field to make it non-trivial, and it is synthetic by
construction so it can never be mistaken for product data.

---

## ⚰️ Three defects this instrument had, all caught by the next check

Kept because each would have published a false result, and the chain is the point — **each fix
made the next one visible.**

| | what it was | how it was caught |
|---|---|---|
| **I1** | `fan-open` decided by *"are there `hub-bubble-*` in the DOM"*. `HubFan` mounts every bubble at all times (spec §5), so it was true at rest, mid-drag and after release alike — **one possible answer** | the frames showed six bubbles in an "idle" capture |
| **I2** | with I1 fixed, eight rows came back INCONCLUSIVE while a hand probe opened the fan every time. The tool took the *pressed* screenshot **between `pointerdown` and `pointermove`**; a Playwright screenshot takes ~1 s and **`HOLD_MS` is 500**, so the engine had already classified a HOLD — a scrub, not a fan push | reproduced the tool's exact sequence rather than picking a side |
| **I3** | twelve frames labelled "light" were the dark ones filed twice. `color_scheme` sets `prefers-color-scheme`, which **appears nowhere in this app's stylesheets** — the theme is `dataset.theme` from `prefs.theme` | the light and dark frames were byte-identical |

**Now standing:** open/closed is decided on **computed opacity** and must exceed the count visible
at rest; the gesture completes uninterrupted and the state is photographed after (`stickyFan` keeps
it open); the theme is served through the preferences route and `dataset.theme` is **asserted to
match** before any frame is kept, with `page_bg` recorded so the two can never silently converge
again.

⛔ **No screenshot may be taken between `pointerdown` and `pointermove`.** That is not a style
note — it is I2, and it will silently turn every drag into a hold.

---

## The predicate, and its rail

`app/src/hub/hubShowing.js` is the **single authority** on "can a member see the hub". The Python
tool **reads that file** and injects it; it does not carry a copy. `hubShowing.test.js` drives it
to all six answers and asserts each `why` is distinct.

⚠️ **PRESENT IS NOT SHOWING, and it cuts both ways.** `HubRoot` keeps its container in the DOM and
sets the `hidden` attribute, so a `querySelector` answers "did React render a container". The touch
smoke published a chart-shell defect that did not exist on exactly that mistake. And
`offsetParent === null` is not the signal either — the hub is `position: fixed`, so that is null
while it is plainly on screen.
