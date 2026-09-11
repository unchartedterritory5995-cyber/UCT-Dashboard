# Joystick hub — closure

> ## ✅ FEATURE COMPLETE — with one incident on the record.
> at `f7ec5d5dd` + the Peek removal (`ccd661051`) + Increment 8's class rails.
> **The programme is closed. No further deploys are authorized.**
>
> ⛔⛔ **READ `postmortem-nav-freeze.md` BEFORE TREATING THIS AS A CLEAN CLOSE.** On 2026-09-10
> this programme shipped a render loop that **froze navigation app-wide for about four and a half
> hours** — clicking any nav entry changed the URL and left the screen where it was. It was found
> by a member and fixed by another session. Three of the four links in the chain were this
> programme's code.
>
> "Feature complete" is written above on the basis that the defect CLASS is now railed
> (Increment 8: C1 every host, C2 every ineligible member, C3 every width, C4 a real browser
> against production, C5 charter rule H14) — **not** on the basis that nothing went wrong.
>
> Every row in `deferred.md` and every request in `requests.md` carries a final-state verdict,
> including the four owner decisions, all now DECIDED. What remains is not engineering:
>
> 1. ⬜ **OPEN — the owner's real-glass run.** `glass-acceptance.md`, gated behind precondition
>    **G0-1**, which must be run first and which nothing else counts without.
> 2. ⬜ **OPEN — whatever members ask for** once they have used it.
>
> Nothing else in this programme is open. Anything that reads as open elsewhere is history — the
> two RESUME docs carry a SUPERSEDED banner saying so.

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
