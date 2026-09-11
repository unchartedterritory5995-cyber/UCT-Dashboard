# Joystick hub — closure

> ## ⬜ NOT YET LAUNCHED — this is the LAUNCHED template, and every box below is empty.
> Engineering-complete at `f7ec5d5dd` + the Peek removal (`ccd661051`) + Increment 8's class
> rails — **with one incident on the record.** Read the caveat under the boxes before reading
> anything here as a clean close.
>
> **LAUNCHED is a state this document does not yet describe.** The charter's DEFINITION OF
> LAUNCHED is below, one box per line, each with the evidence that closes it.
>
> ⛔ **A box is ticked only by the artifact named in its own evidence slot** — a run record, a
> commit, a live check — never by a judgement that it is probably fine, and never ahead of the
> run. An empty evidence slot and an unticked box say the same thing, and today that is the
> true thing to say. ⭐ An absent result is not a pass; it is an absent result.
>
> **The programme is closed to further FEATURE work, and no further deploys are authorized**
> for anything except the work these six boxes name.

## DEFINITION OF LAUNCHED — the gate, unticked

- [ ] **G0 resolved.** Flick scores **≥ 8/10 on an iPhone 15 Pro-class device**, measured by the
      owner on real glass; if it comes in below, the root cause is **traced and fixed** — not
      noted, not averaged across devices. `glass-acceptance.md:98` still carries G0-1 as
      ⬜ UNEXPLAINED: *"iPhone 15 Pro scored sticky fan 0/10 and flick 0/10, while iPhone SE
      scored 10/10 on both — on the same calibrated pointer path."* `g0-flick-trace-plan.md` is
      the plan for explaining it.
      **Evidence:**

- [ ] **Glass acceptance passed on ≥ 1 notched iOS device and ≥ 1 Android.**
      `glass-acceptance.md`, every block, including the surfaces Increments 3–7 added.
      ⛔ Gated behind G0-1 above, in that file's own words (`:104`): *"Resolve G0-1 before
      reading any G1"* — G1 is the same measurement done by hand, so a G1 pass read while G0-1
      is unexplained proves nothing.
      **Evidence:**

- [ ] **Post-deploy client smoke, signed in, covering every top-level route including
      `/dashboard`, and CONCLUSIVE.** ⛔ *Conclusive* is the load-bearing word, not decoration:
      `tools/hub_nav_smoke.py` exists because a green suite, a 200 from `/api/health` and a
      rising uptime were all simultaneously true while navigation was frozen for members
      (`postmortem-nav-freeze.md`). A run that comes back empty, or that dies before it writes,
      is an INCOMPLETE — never a pass.
      **Evidence:**

- [ ] **Preference-key validation live server-side.** `POST /api/auth/preferences` accepts any
      `{key, value}` from any authenticated user with no validation, which is why §2 below
      records B6 as an **exposure default, not a security boundary**, and §4 lists calling it a
      gate among the things to reverse. Closing it is an `api/` edit; the `api/` stop measured
      in §2 is why it is still open, and that stop is a reason, not a dispensation.
      **Evidence:**

- [ ] **Rollout at stage 3, with the kill switch verified on glass.** ⚠️ The plan's own ladder
      stops at two rungs — `45-phase2.5-plan.md:52` **Step 1 — ADMIN PREVIEW** and `:61`
      **Step 2 — MEMBER PREVIEW** (*"`hub.enabled` default becomes true for every authenticated
      user"*) — so the charter's stage 3 is a rung beyond anything this programme planned, and
      the first thing its evidence slot must name is what stage 3 IS. Today the product is at
      Step 1: `useHubSettings.js` resolves an unset preference to `isAdmin`. The kill switch
      (`HUB_PREVIEW_ENABLED=false`) must be **seen to take effect on a device**, not inferred
      from the flag being read per request — a `--kv` read confirms the service's config and is
      not evidence the running process has it.
      **Evidence:**

- [ ] **closure.md rewritten as LAUNCHED, citing each of the above.** This document: five filled
      evidence slots above this line, and this header replaced by one that says LAUNCHED and
      has the citations to mean it. ⛔ It is deliberately last and deliberately not
      self-satisfying — ticking it while any box above is empty is the only way to make this
      whole gate a lie.
      **Evidence:**

---

> ⛔⛔ **READ `postmortem-nav-freeze.md` BEFORE TREATING THIS AS A CLEAN CLOSE.** On 2026-09-10
> this programme shipped a render loop that **froze navigation app-wide for about four and a half
> hours** — clicking any nav entry changed the URL and left the screen where it was. It was found
> by a member and fixed by another session. Three of the four links in the chain were this
> programme's code.
>
> "Engineering-complete" is written above on the basis that the defect CLASS is now railed
> (Increment 8: C1 every host, C2 every ineligible member, C3 every width, C4 a real browser
> against production, C5 charter rule H14) — **not** on the basis that nothing went wrong.
>
> Every row in `deferred.md` and every request in `requests.md` carries a final-state verdict,
> including the four owner decisions, all now DECIDED. What remains **of this programme's own
> work** is not engineering:
>
> 1. ⬜ **OPEN — the owner's real-glass run.** `glass-acceptance.md`, gated behind precondition
>    **G0-1**, which must be run first and which nothing else counts without.
> 2. ⬜ **OPEN — whatever members ask for** once they have used it.
>
> Nothing else in this programme is open. Anything that reads as open elsewhere is history — the
> two RESUME docs carry a SUPERSEDED banner saying so.
>
> ⚠️ **That sentence and the LAUNCHED boxes above are not in conflict, and the distinction is
> worth stating rather than leaving to be re-derived.** The boxes name work LAUNCH requires,
> which is not the same set as work this programme left undone: preference-key validation is
> engineering, it is required for LAUNCHED, and it is CLOSED-BLOCKED in §0 — stopped by the
> `api/` watch lists measured in §2, not skipped. A box can therefore be empty because someone
> still has to run something, or empty because something outside this programme has to move
> first. Both are empty. Neither is a pass.

This document supersedes `70-increment-6-closure.md`, which closed Increment 6 with a core list
of one. That list is still one, and it is still the same item.

## 0. The CLOSED-BLOCKED register — every stop, quoted once

These are not gaps in the work. Each is an item the programme could not touch, with the reason it
could not, so nobody re-derives the stop from scratch.

| Item | The stop |
|---|---|
| **P6 — server-side preference-key validation** | `api/` is watched by **two** services. Live Railway manifest: `worker` → `['/api/**', …]`, `bars-api` → `['api/**', …]`. Either would redeploy on any `api/` edit. (`flow-worker` is NOT implicated — its list is 20 enumerated top-level `api/*.py` modules with no `routers/` path.) ⛔ Consequence recorded plainly: **B6 is an exposure default, not a security boundary** — `POST /api/auth/preferences` accepts any `{key, value}`. |
| **R-08 — `PUT /api/j2/positions/{id}` stop validation** | Same stop. `api/` file. |
| **D-14 · D-15 · D-19** | Same stop. Each needs an endpoint, a column or an append-only log. |
| **D-32 — Screener → Plan trade prefill** | Same stop for the half that matters: the absolute level exists only server-side and is never emitted. ⛔ The client-side derivation was **refused, not overlooked** — `deferred.md` names it as "a SECOND AUTHORITY over a number the live tier already computes", and a wrong step still produces a plausible number. |
| **D-20 — Add to Notebook from a calendar entry** | Two stops, either sufficient: the only surface naming an entry is `EarningsResearchModal`, whose `z-index: var(--z-modal, 1000)` buries the hub's own ladder (`--z-hub-open: 401`); and `Calendar.jsx` never sets the hub `symbol`, so a `requires:['symbol']` bubble would render permanently DISABLED. |
| **D-06 — Metric-group cycling** | `useBreadthCustomize.js:112` — `if (prev.activePreset === DEFAULT_PRESET) return prev  // immutable`. `Default` is the shipped state, so the named mechanism is a **no-op for every member who has never made a preset** and **destructive** for those who have. ⭐ The mutation proof found the stop is DOUBLED: removing either guard alone leaves the rail green. |
| **R-11 — `OptionsBoard` cursor carrier** | `app/src/pages/journal-2-0/**`, which this build does not edit; the request names Journal 2.0 as owner and says "Blocking: no". |
| **D-16 — Notebook double-tap search** | The only fix is inside `NotebookTab.jsx`, under a standing zero-edit rule. |
| **D-30 — one `data_root()` helper** | Not this programme's, and a live PRODUCTION risk. See §1.

---

## 1. What is actually open

| # | Item | Why it is not mine to close |
|---|---|---|
| **G** | **`glass-acceptance.md`** — real-glass D4 (flick safety) and D1 (the TalkBack/VoiceOver no-drag door), plus every surface Increments 3–7 added. | Needs a human with a finger on glass. jsdom performs no layout; emulated-green is not device-green. **Block G0 carries two Phase 2 findings that were never explained** — an iPhone 15 Pro scoring 0/10 on flick where an iPhone SE scored 10/10, and iOS gesture rows that have never actually run because WebDriverAgent rejects the action. G0-1 must be resolved **before** any G1 result is read as a pass, because G1 is the same measurement done by hand. |
| **Member feedback** | Whatever the first members ask for. | Not knowable from here. |

### Owner decisions — ALL FOUR DECIDED, 2026-09-11

Each was recommended with its cost and taken as the ruling under the charter's default. Full
reasoning lives on the rows in `deferred.md`; these are the verdicts.

- **D-02 — Indicator on the chart fan → CLOSED BY DESIGN** (owner pre-ruled). The fan is full at
  5/5 outer, 4/4 inner, and `validateRegistry` rejects a sixth. Replacing a shipped action needs
  **glass evidence about which bubble members actually use**, not a guess from a registry.
- **D-08 — Compare prior cycle → ADMIN-ONLY STANDS.** The tab's headline is a **forward-return
  claim** shown to members, and this repo's own standing lesson is that a hit rate is meaningless
  without its base rate. That is editorial, not plumbing, and the safe default is not to publish
  the number. The two-line change stays available if the claim is ever reworded.
- **D-26 — LWC pane geometry → CLOSED BY DESIGN.** Keep the labelled `calc(22% + 32px)`
  approximation. The fix needs a new imperative method on an 11,700-line file; the cost of being
  wrong is a scrim edge a few pixels off, with no write and no gesture behind it.
- **D-36 — does Plan trade escalate? → NO, `escalate` stays false.** Plan trade writes to
  `hub_planned_trades` and **never a broker**. B5's escalation marks writes that change a live
  position — move stop, breakeven, close. A plan is a record of intent that cannot lose money, and
  flipping the flag would change the haptic every member feels on every Plan trade to say
  otherwise.

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
