# Joystick hub — the simplification proposal

> **Owner ruling R4, 2026-09-17: simplification is the owner's decision. This PROPOSES; it changes
> no default.** The owner used the hub on his phone and said *"simplify a ton imo … too much going
> on"*. This is what "a ton" could mean, costed against the registry as it actually stands.
>
> ⛔ **You do not have to read this to rule on it.** W5.3 builds the strong cut as a switchable
> variant: flip **Settings → Joystick → Simplified surface** on your phone, use both, and tap
> **Report** on whichever is wrong. That tap is the ruling. This document exists so the proposal is
> reviewable, not so it has to be reviewed.

**Derived 2026-09-17** by importing `registry.js` — not by reading it. A regex over that file finds
25 actions; the module reports **62**, so every count below comes from the module.

---

## 1 · What the surface actually is

**10 modes · 62 actions.**

| mode | route | outer | inner | total | tap hint |
|---|---|---:|---:|---:|---|
| `home` | `/dashboard` | 5 | 4 | **9** | tap: last section |
| `chart` | `/charts` | 5 | 4 | **9** | tap: next timeframe |
| `scan` | `/screener` | 4 | 4 | **8** | tap: next result |
| `journal` | `/journal/trades` | 4 | 4 | **8** | tap: next position |
| `notebook` | `/journal/notebook` | 4 | 4 | **8** | tap: next note |
| `catalysts` | *(no route)* | 3 | 4 | **7** | tap: next row |
| `wire` | `/morning-wire` | 3 | 2 | **5** | tap: next segment |
| `calendar` | `/calendar` | 2 | 2 | **4** | tap: next day |
| `breadth` | `/breadth` | 0 | 2 | **2** | tap: next tab |
| `flow` | `/options-flow` | 0 | 2 | **2** | navigate only |

By kind: **run 32 · navigate 17 · home 9 · confirm 4**.

⛔ **THE `home` KIND IS STRUCTURAL, NOT SURFACE.** Nine of the 62 are the "return home" bubble, one
per mode. Cutting those is not simplification, it is removing the way back.

---

## 2 · ⭐ The finding that decides this

**`home` is nine actions, and eight of them are navigation: `home.scan`, `home.chart`,
`home.breadth`, `home.wire`, `home.flow`, `home.journal`, `home.notebook`, `home.calendar`.**

That is **a second navigation menu**, drawn as a fan, on a device that already has one. The app's
own menu is one tap away at every width ≤1024px — the top-left button opens `MoreSheet`, *"the
SINGLE comprehensive directory"*, and on the phone chart shell the Menu button in the symbol strip
opens the same sheet.

So the hub's largest mode is its most duplicative one. **8 of 17 navigate actions in the whole
registry are this one menu.** If "too much going on" has a single largest cause, this is it — and
it is also the safest thing to remove, because nothing becomes unreachable.

⚠️ **AND THERE IS NO USAGE DATA. I am not going to invent any.** The report table shipped today and
is empty; the hub has never had analytics by charter (`gestureTrace.js`: no sink). So every ranking
below is argued from **reachability and cost**, never from "nobody uses it" — a claim nothing in
this repo can currently support.

---

## 3 · The three tiers

### KEEP — mode-only capability, not reachable in one tap elsewhere

The tap/scrub verbs (next result, next timeframe, next position, next note, next day, next segment)
and the actions that act on *the thing under the cursor*. These are the hub's actual argument: a
thumb that advances a list and acts on the current item without moving your hand.

`scan.*`, `chart.*`, `journal.*` run/confirm actions · the per-mode `home` bubble · `Voice`.

### DEMOTE — real, but reachable elsewhere in one tap

`*.chartIt` (4 of them: wire, scan, journal, catalysts) — every one of those pages already opens a
chart from the row you are on. `*.why` (scan, catalysts). `notebook.dailyPlan` /
`notebook.postMortem` — both are tabs in the Journal. Keep the capability, lose the bubble.

### CUT — the hub duplicating page furniture

1. **`home`'s eight navigate bubbles.** The app's own `MoreSheet` is the single comprehensive
   directory and is one tap away. −8
2. **`flow` and `breadth` as modes.** Their fans are `[Voice, Home]` — the universal pair and
   nothing else. They are two modes that carry no capability; `flow` is *navigate-only by design*
   because `OptionsFlow.jsx` is partner-owned. A mode whose whole fan is the universal pair is a
   label, not a mode. −2 modes, −4 actions
3. **`calendar.myNames`** — the Calendar's own "My Stocks" is a first-class surface with its own
   route. −1

---

## 4 · ⭐ The strong cut — "minimum viable hub"

**3 modes · 4 actions each · 12 + the universal pair.**

| mode | why this one | outer (4) |
|---|---|---|
| `scan` | finding is where a thumb beats a hand — advance the list, act on the row | the four highest-value `scan.*` run/confirm actions |
| `chart` | looking: timeframe by tap is the verb nothing else does in one gesture | the four highest-value `chart.*` |
| `journal` | logging: the one place the hub writes, and the reason it exists | the four highest-value `journal.*` |

**find → look → log.** Everything else is a page you can reach from the menu you already have.

⛔ **This is the option I would put in front of a member, and I am not authorised to choose it.**
It takes the hub from **62 actions to 12**, and from a fan that is *"too much going on"* to one
whose every bubble is a thing you cannot do in one tap any other way.

⚠️ **What it costs, stated rather than buried:** `wire`, `breadth`, `calendar`, `notebook`,
`catalysts`, `flow` and `home` stop being hub modes. On those pages the hub would show the
universal pair or nothing. That is a real loss of reach and it is exactly the trade the owner has
to rule on — *"simplify a ton"* and *"keep every door"* cannot both be satisfied.

---

## 5 · How the ruling arrives

Not as a reply to this document.

1. `HUB_SURFACE=simplified` in **Settings → Joystick** (W5.3) — default unchanged.
2. Use both on the phone.
3. Tap **Report** on whichever is wrong. The report records which variant produced it.
4. `tools/hub_reports_intake.py` turns the table into triage rows.

⛔ **Nothing here changes the default surface, and no agent may.** R4.


---

## 6 · The variant is NOT BUILT — and the reason inverted while I checked it

R4 authorises building the strong cut as a switchable variant. I stopped to check one thing first,
and the check changed the answer twice. Both halves are recorded because the second is good news.

### What I suspected

`fanFor()` projects a mode's fan, but `useJoystick` appeared to resolve wedges out of `mode.fan` —
the DECLARED array — and four section controllers read `modesById[X].fan` directly. Two authorities
over one list. A `HUB_SURFACE` switch implemented by filtering `fanFor()` would then DRAW four
bubbles while the engine RESOLVED against nine: a flick would fire something that is not on screen,
which is indistinguishable from *"too glitchy"*. I was about to refuse to build it on that basis.

### ⚰️ What is actually true — and it was a REAL, SHIPPED defect, already fixed

`fanResolutionParity.test.js` exists, and its header is the same hypothesis, measured:

> *"a member tapping the third bubble fired the third DECLARED action instead of the third DRAWN
> one … Home draws seven bubbles and THREE of the seven navigated somewhere other than their own
> label — Flow→Breadth, Breadth→Wire, Wire→Calendar … **Live in production since Increment 2**, and
> invisible to every existing rail because each one checked a single list."*

It is **fixed and railed**: `HubRoot` hands the engine the PROJECTION, not the declared config, and
the rail carries both a non-vacuity control and an "the OLD wiring would fail this" control. It runs
green today — **4 passed**, checked in one command rather than assumed.

### ⭐ So the consequence flips: the variant is CHEAP and SAFE

Because the engine now resolves against the projection, **`fanFor()` IS the single chokepoint.**
Filtering there reaches the drawn fan and the resolved fan together, which is exactly the property a
surface switch needs. The implementation is a preference, a filter at `registry.js:822`, and a
Settings toggle — not a refactor of 13 modules.

⛔ **It is still not built in this run, and that is a scheduling call, not an engineering one.** The
remaining cost is 5.3's own requirement — *"all rails run against both registries"* — which is a
harness change, and starting it at the end of a long session is the "atomic units not started if
they cannot finish" rule. The implementation point is now proven rather than guessed, so the next
run starts from a known-good place instead of this investigation.

### What this bought anyway

A hypothesis about why the hub feels glitchy, tested in one command and **retired** — that class is
fixed, railed, and not a candidate for the owner's report. That is worth more than a rushed variant:
it removes a whole branch of the search before W3 starts looking.
