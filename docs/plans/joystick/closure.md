# Joystick hub — closure

> ## ⬜ NOT YET LAUNCHED — this is the LAUNCHED template, and **two of its six boxes are ticked.**
>
> ### What is live right now — read from Railway, 2026-09-12, not inferred
>
> | | Value | How it was read |
> |---|---|---|
> | `web` deployment | **`7fce88bd2`** — SUCCESS, 2026-09-12T02:17:25Z (*"Rail: a PREVIEW_MODES flip cannot ship without a regenerated surface matrix"*) | `railway status --json` → production → `web.latestDeployment.meta.commitHash` |
> | Kill switch | **`HUB_PREVIEW_ENABLED=true`** — hub eligible | `railway variables --service web --kv` |
> | Rollout stage | **1 — admin only** (`ROLLOUT_STAGE = 1`, `app/src/hub/rolloutStage.js`) | read from the source at the live SHA; it is a BUILD-time constant, so the deployed bundle is its only authority — no Railway variable to check |
>
> ⭐ **Stage is a build constant and the kill switch is a runtime variable, and that asymmetry is
> the design** (`rolloutStage.js`: *"a stage is a deploy, deliberately"*). So "what stage is live"
> is answered by the SHA, and "is the hub on at all" by the variable. Neither answers the other.
>
> Engineering-complete at `f7ec5d5dd` + the Peek removal (`ccd661051`) + Increment 8's class
> rails — **with one incident on the record.** Read the caveat under the boxes before reading
> anything here as a clean close.
>
> **LAUNCHED is a state this document does not yet describe.** The charter's DEFINITION OF
> LAUNCHED is below, one box per line, each with the evidence that closes it.
>
> ⛔ **A box is ticked only by the artifact named in its own evidence slot** — a run record, a
> commit, a live check — never by a judgement that it is probably fine, and never ahead of the
> run. An empty evidence slot and an unticked box say the same thing. ⭐ An absent result is not
> a pass; it is an absent result.
>
> **The programme is closed to further FEATURE work.** ⚰️ This line also read *"and no further
> deploys are authorized"*; the MEMBER LAUNCH CHARTER of 2026-09-11 **re-opened deploys for the
> launch sequence**, and Deploys A (`0c0af484a`) and B (`b9d66e0c3`) both shipped under it. See
> `rollout.md`, which is this programme's authority on who can see the hub today.

## DEFINITION OF LAUNCHED — the gate: **2 of 6**

- [ ] **G0 resolved.** Flick scores **≥ 8/10 on an iPhone 15 Pro-class device**, measured by the
      owner on real glass; if it comes in below, the root cause is **traced and fixed** — not
      noted, not averaged across devices. `glass-acceptance.md:98` still carries G0-1 as
      ⬜ UNEXPLAINED: *"iPhone 15 Pro scored sticky fan 0/10 and flick 0/10, while iPhone SE
      scored 10/10 on both — on the same calibrated pointer path."* `g0-flick-trace-plan.md` is
      the plan for explaining it.
      **Evidence:** ⬜ OPEN — needs the owner's thumb, and as of 2026-09-12 that is now a
      *measured* conclusion rather than an assumption. **Both halves of the measurement
      exist and are self-checked:** the phone script is the numbered top half of
      `g0-flick-trace-plan.md` (7 steps, ~10 min, iPhone 15 Pro, production, admin), and the
      analyser is `tools/hub_trace_analyze.py` (`--self-check` PASSES: six buckets each reached by
      the row that means them, an intent-withheld gesture stays UNDECIDED, an overflowed buffer is
      refused). ⛔ Nothing here is a result — an instrument that is ready is not a measurement.

      **2026-09-12 — a real iPhone 15 Pro / iOS 17.6 was driven against production on
      BrowserStack Live. Verdict `INCONCLUSIVE-TRANSPORT`; this box stays UNTICKED.**
      Full run: `g0-1-live-device-run-2026-09-12.md`. The control gate failed by 2.2×: ten
      mirror-driven gestures took **260–427 ms** against a 120 ms window, and the mandated
      retry with the shortest drag the mirror accepts came out *slower*, because the mirror's
      floor is per pointer-event round trip, not per pixel. No flick was ever attempted by a
      real touch, so no twenty-flick table was published.
      ⭐ What the run did establish, on that device: the pad renders at exactly the specified
      pixel; the **press** path fired **10/10** onto the intended outer-ring action (so the
      Phase 2 "15 Pro 0/10 on sticky fan" half is NOT reproduced on iOS 17.6); the **flick
      branch itself fires 6/6** at 76–79 ms when a pointer sequence reaches it inside the
      window (engine probe — ⛔ *not* a G0-1 result, no finger touched glass); `elapsed` and
      `event.timeStamp` agree to **≤ 8 ms** across all 16 gestures, which **eliminates cause A
      as originally written**; and `getCoalescedEvents()` added 0 rows on every gesture.
      ⇒ One question is left, and no funded product can ask it: *does a real finger's flick on
      a 15 Pro produce a pointerdown→pointerup pair under 120 ms?* This is the point at which
      the owner's own device is the only remaining path, stated explicitly as required.

- [ ] **Glass acceptance passed on ≥ 1 notched iOS device and ≥ 1 Android.**
      `glass-acceptance.md`, every block, including the surfaces Increments 3–7 added.
      ⛔ Gated behind G0-1 above, in that file's own words (`:104`): *"Resolve G0-1 before
      reading any G1"* — G1 is the same measurement done by hand, so a G1 pass read while G0-1
      is unexplained proves nothing.
      **Evidence:** ⬜ OPEN, and still gated behind G0-1. The step list is no longer a memory:
      **`glass-acceptance-steps.md`, 96 rows, DERIVED** from the registry by
      `node tools/hub_surface_matrix.mjs --glass` — every mode's Primary/Reverse/Scrub binding and
      every fan action, plus D4 and D1 where an operator meets them, each row carrying a
      BLOCKED-BY-G0 box so a run made too early records itself as blocked rather than as a fail.
      ⛔ **The 2026-09-12 Live run did not lift this gate** and could not have: it returned
      `INCONCLUSIVE-TRANSPORT`, which is neither a G0-1 pass nor a fail. Every G1 row therefore
      still ticks its BLOCKED-BY-G0 box, and any of them run today on a mirror would measure
      the same ~300 ms transport rather than the product.

- [x] **Post-deploy client smoke, signed in, covering every top-level route including
      `/dashboard`, and CONCLUSIVE.** ✅ **CLOSED 2026-09-12.**
      **Evidence:** `smoke-runs/2026-09-12T02-24-24Z.md` — `tools/hub_nav_smoke.py --auth`
      against production at **02:24Z**, live `web` SHA **`7fce88bd2`** (SUCCESS 02:17:25Z,
      `/api/health` 200). **PASS, exit 0:** 16 top-level routes derived from `NavBar.jsx`, all
      probed for a render loop, **25 nav entries exercised, every one moving BOTH the URL and the
      screen.** Busiest main thread `/options-flow` at 6.3% blocked against a 60% limit.
      Signed in as `smoke@uctintelligence.internal` — synthetic, admin, comped Pro, created for
      this and nothing else (CLAUDE.md → Testing → Smoke).
      ⭐ `/dashboard` reads 33 fps at 0.0% blocked, and that is a healthy page here: live price
      cells repaint, which costs frames without starving the main thread. The 2026-09-10 freeze
      was ~4,500 React commits per second — the opposite signature, and the reason this instrument
      samples the CAUSE and not only the symptom.
      ⛔ **TWO THINGS THIS RUN DID NOT MEASURE, and the box is ticked on the tool's own criteria,
      not on a wider reading of them.** The hub requires `(max-width:1023px) AND (pointer:coarse)`,
      so on a desktop viewport it **could not mount on any route** — "it stayed off the routes it
      should" is true here for a reason that proves nothing about `hideOnRoute`. And the tool does
      not subscribe to `page.on("console")`, so no claim is made about console errors from hub
      files. Both need a touch-emulating context, which is a different instrument and a different
      run. Recorded rather than folded in: a pass whose scope is overstated is how a green
      instrument comes to stand in for one nobody ran.
      **touch-context pass: ✅ OK (2026-09-12T02:54:26Z, live SHA `36596a88a`)** —
      `smoke-runs/2026-09-12T02-54-26Z-touch.md`. `--auth --touch` in a 393x852 DPR-3 coarse-pointer context:
      eligibility floor confirmed in-browser, the hub **showing on all sixteen** routes, and the
      one hide the product actually declares — the chart shell's landscape-immersive mode at
      852x393 — verified with BOTH halves of its condition asked of the browser (shell attribute
      AND media query) and the hub measurably not showing (`hidden` attribute true, `display:none`,
      box 0x0). `hideOnRoute` is declared by **no shipped mode**, read from `registry.js` with
      comments stripped. Three console errors, all YouTube thumbnail 404s from `i.ytimg.com`;
      ⛔ that is "three errors, all external", NOT "zero from `app/src/hub/*`" — hashed production
      chunks cannot be attributed to a source path, and the record says so rather than implying
      the stronger claim.
      ⚰️ **The first run of this pass reported a product defect that did not exist** — it asked
      `querySelector` whether the hub was present, and `HubRoot` keeps the container in the DOM
      with the HTML `hidden` attribute. Measured, corrected, and railed with four fixtures before
      anything was written down. ⛔ Still not glass: Chromium emulating a viewport class is not an
      iPhone, and this says where the hub mounts, never that a gesture works.

- [x] **Preference-key validation live server-side.** ✅ **CLOSED 2026-09-11.**
      **Evidence:** built as L3 item 1 in `60cbe8919`, shipped as **Deploy B** (`b9d66e0c3`,
      pushed 11:01 ET) under the owner's one-file `api/routers/auth.py` waiver.
      `POST /api/auth/preferences` now **allow-lists keys** — refusing an unknown key `400` by
      name — and **schema-checks `joystick_hub`'s ten fields**, the tenth being `coachMarkSeen`,
      which is NOT in `HUB_SETTINGS_DEFAULTS` (`HubRoot` writes and reads it directly) and whose
      omission would have 400'd the coach-mark dismissal and left that hint card on screen with no
      way to dismiss it. The accepted key set is **re-derived from `app/src/**` on every run** by
      `tests/test_preference_key_validation.py` (24 tests, 5 mutation proofs) rather than restated,
      so the hand-typed list in `auth.py` cannot drift away from the client silently. Unknown
      FIELDS inside a known key stay accepted on purpose — a member's whole stored blob is spread
      into every later write, so refusing one stale field from an older build would become a
      permanent 400 on all their hub settings.
      **Live at `b63cf9775`** (`web`, SUCCESS 2026-09-11T20:58:24Z): `b9d66e0c3` is an ancestor,
      verified with `git merge-base --is-ancestor`, not inferred from the push.
      ⛔ **Therefore §2's "B6 is an exposure default, not a security boundary" and §4.3's
      "either fix it or stop calling it a gate" are now HISTORY, not current state** — they are
      left in place as the record of why this was worth its own deploy, and §0's re-examination
      table already records P6 as BUILT. The endpoint validates; the Settings card's admin-only
      default remains a default by design, which is a product ruling and not the hole it was.

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
      evidence slots above this line (**two are filled today — boxes 3 and 4**), and this header replaced by one that says LAUNCHED and
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

### ⛔⛔ THE REGISTER ABOVE WAS RE-EXAMINED — L3, member-launch charter, 2026-09-11

The owner widened the authority: `api/routers/auth.py` was waived **for that one file, on proof**,
as a maintenance deploy. That re-opened exactly one row (**P6**) and **changed the reason on every
other row without changing any verdict**. The re-examination's rule was: re-measure the stop at its
source, never re-litigate the ruling.

| Item | New verdict | Why |
|---|---|---|
| **P6** | ✅ **BUILT** — `60cbe8919` | The waived file. Allow-list + `joystick_hub` schema; rail `tests/test_preference_key_validation.py` (24). See `71-open-items-proposals.md` §1 for the design and what was deliberately NOT built. |
| **D-32** | **CLOSED — product decision (OWNER)** | The `api/` stop is now a priced deploy, not a bar — but the fix lives in `live_tier.py`'s serialiser, which the one-file waiver does not name, AND the row already carried an owner ruling ("do not add an endpoint for this now") that no file-list widening reaches. |
| **D-20** | **CLOSED — product decision (OWNER)** | Never an `api/` row. Half (1) is one line; half (2) asks whether the joystick outranks a modal **app-wide** (`hub.module.css:306-312` says the ladder split is deliberate). One ruling, not a calendar fix. |
| **D-06** | **CLOSED — product decision (OWNER, breadth customize)** | Never an `api/` row. Re-measure found the writer guard **three** times (`:112`, `:123`, `:185`) plus the reader guard (`:100-103`). The fix changes what a preset MEANS. |
| **R-08** | **CLOSED — dependency (Journal 2.0)** | The waiver is `auth.py` only; all three holes are in `positions.py`. There is no zero-`api/` implementation — every hole is a server-side acceptance rule. |
| **R-11** | **CLOSED — product decision (Journal 2.0)** | L3 widened `api/`; the zero-edit rule on `app/src/pages/journal-2-0/**` is a different rule and was not widened. |

#### The three proofs the `auth.py` waiver was granted on

1. **Not on `flow-worker`'s watch list.** The in-repo mirror (`api/flow_worker_main.py` header)
   enumerates its watched top-level modules: `massive_ws_worker, massive_processor, flow_db, bs_iv,
   flow_worker_main, live_massive_router, flow_router, flow_router_mount, flow_heal_enrich,
   flow_gap_autofill, massive_flatfiles_worker, flow_watchdog, oi_snapshots, massive_stream,
   flow_tape_spool, flow_backup, dealer_positioning, flow_rest_backfill, alpha_gold_eod,
   weekly_flow, flow_opt_aggregate`. No `routers/` path, and no `auth`.
   ⚰️ **The count in the register above says 20. Counted from the file, it is 21.** Off by one,
   harmlessly — but the register restates a number it does not derive, so it drifted. The header
   also carries two standing ⚠️ TODOs that `confluence_flow.py`, `oi_massive_snapshots.py` and
   `oi_morning.py` are flow-worker modules that are NOT watched.
2. **Not imported by `flow_worker_main`.** An `ast` walk of the transitive in-repo `api.*` import
   graph from that root reaches **228** modules; `api.routers.auth` is not one of them.
   **Control:** the same walk DOES reach `api.routers.ticker_search`, so "not reachable" is a
   measurement and not a resolver blind spot. (The walk's first run returned 1 module — a
   misjoined root path — and the control is what caught it.)
3. **The restart cost, measured.** Below.

#### What an `api/routers/auth.py` push actually costs — measured, for the member-impact paragraph

⛔ **THREE services restart, not one.** `web` (every master push rebuilds it, docs-only included),
`worker` (`/api/**`) and `bars-api` (`api/**`). `flow-worker` does **not** — which matters most,
because its gap is the only PERMANENT one ("a push touching a flow-worker watched file bounces the
OPRA tape, and that gap is PERMANENT until the overnight T+1 flat file"). The OPRA tape is untouched.

- **`web`** — ~1 min `/api/*` blip. **This is where the APScheduler class lands.** Its job store is
  in memory, so any scheduled slot whose time passes during the swap is never scheduled at all —
  lost outright, not run late, and `misfire_grace_time` cannot see it.
- **`worker`** — ⭐ **runs NO APScheduler.** Grepping `api/worker_main.py` for
  `scheduler|BackgroundScheduler|add_job|cron` returns two COMMENT lines (`:552`, `:558`) that
  refer to the *web* pod's scheduler being kept alive by the keep-warm ping. Every worker job is a
  `while True: … time.sleep(N)` daemon thread, so a restart loses loop PHASE, not a slot. What it
  actually drops:
  - the in-flight **prewarm pass, from zero** — the product says so itself in
    `_bars_alert_text`: "the most common way to see this alert is DURING the boot pass, and a
    redeploy restarts that pass from zero";
  - the **down-alert state machine** (`_alert_state = {"fails": 0, "down": False,
    "last_alert_at": None}`, in-process only). If the site is DOWN across the swap, the recovery
    ping is never sent, the 30-min re-nag cooldown resets, and DOWN must be re-detected from zero —
    `DOWN_ALERT_FAILS = 2` probes at a 60 s interval, so **~2 minutes blind**;
  - the **bars-freshness watchdog** state, same class (can re-page);
  - `_uploader_state`, so `/internal/health` reports no upload attempt until the first loop ends;
  - **R2 snapshots pause** until the blocking weekly-key purge finishes — its `DISTINCT` scan "has
    no tf-leading index and takes minutes on the worker's multi-GB ohlcv table", and the uploader
    starts from the same thread strictly after it.
  - **NOT dropped, by design:** the R2 base-snapshot day marker (a volume marker added precisely
    because "on busy deploy nights the in-process-only tracker re-uploaded a ~2.4 GB base per
    push"), the breadth-backfill floor marker, the deep-history-warm done-marker, the wick sweep's
    resume, and `bars.db` itself.
- **`bars-api`** — ⛔ **the member-visible one, and the one the register never priced.** It is the
  dedicated chart-data serving tier (`/api/bars` + `/api/bars-history`). Its own header says it
  exists "so app/partner deploys can NEVER restart chart serving" — but its watch paths were never
  narrowed (that sentence is still conditional: "once its Railway watch paths are narrowed"), so an
  `api/**` edit restarts exactly the thing it was built to protect. On boot it **serves cold-fetches
  until the R2 `bars.db` install thread completes**; charts are correct throughout, just slower
  until it lands.
- **Timing** — push → container start was measured at **~4-7 minutes** on this repo's services.

⛔ **The honest summary for a member-impact paragraph:** no data is lost and nothing members own is
touched; for a few minutes charts serve cold, one prewarm pass restarts, R2 snapshots pause, and any
`web` scheduler slot falling inside the swap is skipped. The options tape is not affected.

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


---

## 2026-09-12, end of day — where the gate actually stands, and what is left

⭐ **The shape of the remainder changed today.** It is no longer "a programme with open questions";
it is **one owner session** (`owner-run.md`) plus deferred items that each have an owner. Nothing
else in this programme waits on anybody.

### The gate: still **2 of 6**, and box 2 is deliberately NOT ticked

| box | state | why |
|---|---|---|
| 1 · G0 resolved | ⬜ **OPEN** | `INCONCLUSIVE-TRANSPORT`. A Live mirror costs 260–427 ms per gesture against a 120 ms window; the floor is per pointer-event round trip, so no shorter drag exists. Needs a real finger — `owner-run.md` §A. |
| 2 · Glass acceptance on ≥1 iOS + ≥1 Android | ⬜ **OPEN** | See below. |
| 3 · Post-deploy client smoke | ✅ CLOSED | |
| 4 · Preference-key validation | ✅ CLOSED | |
| 5 · Rollout at stage 3 | ⬜ OPEN | Stage stays **1**. |
| 6 · closure.md rewritten as LAUNCHED | ⬜ OPEN | This is that document; it is not yet that. |

⛔ **Why box 2 is not ticked, stated precisely rather than argued around.** Every row a mirror
*could* answer is answered, and several are new PASSes. But **Block G5's 96 derived sweep rows all
still carry BLOCKED-BY-G0**, and G0 is box 1. A row that is blocked is neither a PASS nor an
INCONCLUSIVE-with-a-transport-reason — it is a row that has not been asked yet, on purpose. Ticking
box 2 while 96 rows sit blocked would be exactly the "absence recorded as a pass" this programme
has refused four times.

⭐ **So box 2 is one measurement away, not one programme away:** owner takes §A of `owner-run.md`,
G0 resolves, the G5 sweep unblocks, and §B/§C answer the rest in the same sitting.

### What closed today

| item | result |
|---|---|
| **G3-15** chip vs Actions button | ✅ **PASS** — fixed (#109, `9b51eaf1a`), 27/27 pairs clear on the deployed build, **8px** clear on real glass across three modes, 0/51 points covered |
| **G3-17** mirrored chip growth | ✅ **FINE** — at its `max-width` cap on `/screener` it still stops **24px** short of the far edge; bounded and symmetric |
| **G3-1** left-hand mirror | ✅ PASS (summary row now carries the tick its detail block always had) |
| **iOS-17 Notebook crash** | ✅ **VERIFIED FIXED on the engine that broke** — `Iterator` is `undefined` on Safari 17.6 and `/journal/notebook` renders with zero JS errors. Retroactive gate appended to #111. |
| **Smoke-login hardening** | ✅ merged (#112, `1dbe230d0`), deployed, and the fragment link signed a real device in |
| **G3-2** high contrast | ⚠️ mechanism confirmed armed on a real device; legibility is an eye row |
| **G3-3 / G3-12** | 🗑️ **RETIRED** — both name the removed two-finger Peek as their door |

### What is newly OPEN, and each has an owner

| id | what | owner |
|---|---|---|
| **G3-18 / D-39** | The chip is partly covered by page-level fixed furniture (Journal's "Log a trade" FAB; a Breadth span at 360). Cosmetic-plus, **non-blocking** by ruling. Fix is hub-side, never a `journal-2-0` edit. | joystick |
| **D-40** | The Notebook's phone note list exposes **no per-note DOM id** (`ResponsiveTable`'s `rowKey` is a React key), so no automated check can open a specific note on a phone. This is why the iOS-17 **preview** path is recorded unexercised. | Notebook |
| **D-41** | Two corrections owed to `iteratorGlobalFloor.test.js`: the `Array.fromAsync` since-note is wrong against a measured 17.6 device, and the bundle-scan test needs an explicit timeout. Blocked from this side by rule 12. | Notebook |
| **B7 / rule 12** | `rule12Paths.test.js` still has no branch-identity check, so it reddens ANY branch touching those paths — it did exactly that to the hardening branch today. | joystick |

### The honest ledger on what a mirror can and cannot do

⭐ Three limits were **measured** this programme, not assumed, and they are why the remainder is an
owner session rather than more agent time:

1. **Timing** — 260–427 ms per gesture. Anything under that threshold is unmeasurable.
2. **Pointing** — with the inspector attached the device renders at ~0.42 of CSS size; a 44 px
   target is ~18 px with ~20 px spacing. Aiming at one fan bubble hit its neighbour.
3. **Text entry (Android)** — the mirror keyboard **drops capitalisation**, and the login token is
   case-sensitive, so the Pixel 8 could not be signed in at all.

⛔ None of the three is a product defect, and none of them should ever be recorded as one.
