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
      **Evidence:** ⬜ OPEN — needs the owner's thumb. **Both halves of the measurement now
      exist and are self-checked:** the phone script is the numbered top half of
      `g0-flick-trace-plan.md` (7 steps, ~10 min, iPhone 15 Pro, production, admin), and the
      analyser is `tools/hub_trace_analyze.py` (`--self-check` PASSES: six buckets each reached by
      the row that means them, an intent-withheld gesture stays UNDECIDED, an overflowed buffer is
      refused). ⛔ Nothing here is a result — an instrument that is ready is not a measurement.

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
      **touch-context pass: ⬜ BUILT AND SELF-CHECKED, NOT YET RUN** — blocked on a credential,
      not on a finding. `tools/hub_nav_smoke.py --auth --touch` drives 393×852 at DPR 3 with a
      coarse pointer and asserts, per route, that the hub mounts exactly where the registry says
      and nowhere it says otherwise, recording console and page errors as it goes. The
      `hideOnRoute` list it quotes is **empty — no shipped mode declares it** (read from
      `registry.js` with comments stripped, because `hubViewport.js` discusses the field in prose
      and a scanner that matched prose would expect the hub to be absent on real routes and fail
      the product for its own mistake). So the expectation is MOUNTS on all 16, and the one hide
      the product actually declares — the chart shell's landscape-immersive mode — is exercised
      separately at 852×393. ⛔ The run stopped because the smoke account's password was lost
      before it was persisted (CLAUDE.md records the lesson); recovery is one admin
      `POST /api/auth/admin/reset-password`. ⭐ The tool refuses to grade itself in the meantime:
      an ineligible context or an unauthenticated session exits **2 INCONCLUSIVE**, never 0 —
      because every route would report "no hub" for a reason that is the harness's, not the
      product's.

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
