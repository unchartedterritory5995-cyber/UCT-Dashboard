# Options Flow cold-paint rig — how a run is performed and what it must report

The instrument is `tools/flow_cold_paint_rig.py`. **It owns its own mechanics; do not
restate them here** — a second copy of the detector's rules is a second authority over
one value, which is the defect this repo names more than any other. This file owns the
*operating* requirements: which paths a session measures, and what every run must print
whether or not anyone asks for it.

---

## ⛔⛔ TWO PATHS, MEASURED AND REPORTED SEPARATELY

**A session that reports one number has not measured the page.** There are two ways a
member arrives at Options Flow and they differ by roughly nine seconds of wall clock
that has nothing to do with the product:

| path | how it is reached | the intro | what the number means |
|---|---|---|---|
| **A — direct load** | typed URL, bookmark, refresh, post-deploy reload | **PLAYS** (~9.3 s) | what a member sees on a cold entry into the app |
| **B — in-app navigation** | clicking Options Flow in the nav from another page | **does not play** | the page's own cost, with the app already warm |

`IntroAnimation` is mounted at the `App.jsx` root inside `<AuthProvider>`, so a route
change does not remount it. That is the whole mechanism, and it is why the two numbers
are not comparable and must never be averaged, medianed together, or quoted as one.

⛔ **Report both, labelled, every session.** A path-B number quoted as "the cold paint"
flatters by ~9 s; a path-A number quoted as "the page cost" indicts the intro for the
page's work.

⛔ **Do NOT press Escape to skip the intro on path A.** Tried 2026-09-12: dismissing it
that way dropped the rendered body from 4,402 chars to 540 and produced a duplicated
aggregate+data round. It disturbs the app; it does not skip an overlay. The intro is
excluded by the **detector** instead, which costs up to ~9 s of wall time per run and
measures the right thing.

---

## ⛔⛔ EVERY RUN REPORTS ITS TRANSPORT: WHOLE-D vs PARTS

**A run that reports only a duration cannot tell a fast page from a fast page fetching
the wrong thing.** Beside the timing, each run prints which requests actually went out:
the `part=` values served, the `X-Flow-Version` seen at paint, and the flow URLs.

⚰️ **THIS LINE EXISTS BECAUSE THE REGRESSION IT CATCHES HAD ALREADY SHIPPED AND NOTHING
SAW IT.** On 2026-09-12 a member session was measured fetching **whole-day aggregate plus
a 5.5 MB tape** where it should have fetched `part=bootstrap` + `part=TOP_PICKS`. Root
cause: `Dockerfile.web` carried **zero `ARG` declarations**, so every `VITE_*` was
undefined during `npm run build`, `USE_PARTS` folded to `false`, and the whole parts path
was tree-shaken out of the bundle — since `af80e0b91`, 2026-09-08 21:53 ET.

⭐ **Nothing failed.** The suite was green, `/api/health` was 200, flow-worker was
building the parts cache correctly and serving it correctly. **No browser was asking for
it.** A timing-only rig on a quiet tape would have reported a perfectly healthy number
for a page on the wrong transport — which is exactly what "a regression hiding behind a
fast-looking number" means.

**So the transport line is not diagnostics. It is the measurement.** If `parts_served`
is empty on a build that is supposed to use parts, the run is a **FAILURE**, whatever the
milliseconds say.

---

## The label rule

Every row and the summary carry a label, and `--certifying` is the only thing that drops
it. Without that flag the run prints **"QUIET TAPE — NOT A MEASUREMENT"**, because on a
quiet tape the parts are already warm and the version never rolls: the run measures a
best case no member hits during RTH. `--certifying` is for RTH only.

⚠️ An unlabelled number quoted out of a non-certifying run is the instrument lying on the
operator's behalf. The label rides on the row so it survives copy-paste.

---

## Account

`MEMBER_SMOKE_EMAIL` / `MEMBER_SMOKE_PASSWORD` from the operator's environment — a
`role=member` account, which is the point: an admin session may render more regions than
a member's, so **an admin number is not a member number**. Run the admin account only as
an explicitly labelled secondary comparison.

⛔ Credentials live where the smoke account's credentials already live. Never in a
commit, never in a log, never printed.

---

## What the tool does today, and what it does not

Stated plainly so nobody reads this file as a description of shipped behaviour:

- ✅ Path A (direct load, intro-gated) — implemented, with the intro excluded by the
  detector.
- ✅ Transport reporting — implemented: `parts_served`, `part_versions`,
  `current_version_after`, `wire_bytes_flow` and the full `flow_urls` list print on every
  run.
- ✅ The label, the fresh context per run, the visible-tab assertion, the streaming
  response capture and the pinned ≥1025 px viewport — all implemented.
- ✅ **Path B (in-app navigation) — implemented 2026-09-12.** `--path b` (or the
  default `both`) lands on `--start-route` (default `/dashboard`), waits for the intro
  to finish on THAT load, asserts the nav link exists, then CLICKS it and measures from
  the click. It reports **two** signals, not one:

  | signal | selector | what it means |
  |---|---|---|
  | `shell_ms` | `.of-mroot` | the page's root rendered |
  | `picks_ms` | `.of-picks` | the TOP 10 FLOW PICKS table rendered — the PRODUCT of `part=TOP_PICKS` |

  ⛔ **A body-text threshold cannot work on path B** — the page you navigate FROM
  already exceeds any threshold, so "lots of text" is true before the click. Path B
  keys on Options Flow's own DOM instead.

  ⛔ **`url_changed` is reported SEPARATELY**, and a run with `url_changed=True` and no
  `shell_ms` prints an explicit warning. A URL that moves while the screen does not is
  the 2026-09-10 navigation-freeze signature; collapsing the two into one "it loaded"
  would make that indistinguishable from a slow render.

  ⚠️ **Instrument overhead is stated, not hidden:** `t0` is taken inside the injected
  script and the click is a separate round trip a few milliseconds later. That overhead
  is charged to the page, which is the conservative direction.

⛔ **CLICK, never `goto`, for path B.** A full page load rebuilds the world and replays
the intro — that is path A wearing path B's label, and it is the same mistake that hid
the 2026-09-10 navigation freeze from every instrument that looked.

---

## Running it

    python tools/flow_cold_paint_rig.py --runs 5                # labelled, any time
    python tools/flow_cold_paint_rig.py --runs 5 --certifying   # RTH only

Three outcomes, three different facts — do not collapse them:

| | |
|---|---|
| a completed run with its label | a measurement of what it says it measured |
| `INCONCLUSIVE` (no credentials, login non-200) | **not a pass** — nothing was measured |
| parts expected and `parts_served` empty | a **FAILURE**, regardless of the timing |

---

## Path B dry run — 2026-09-12, quiet tape

> ### ⚠️ QUIET TAPE — NOT A MEASUREMENT
> The parts were already warm and the version never rolled. These numbers are a best
> case no member hits during RTH. **The rig is being proven here, not the page.**

Member account, `--path b --runs 3`, started on `/dashboard`:

| run | `shell_ms` | `picks_ms` | flow req | wire | parts |
|---|---|---|---|---|---|
| 1 | — | — | — | — | **ERROR: login http 502** |
| 2 | 614 | 15,863 | 8 | 3,536,844 B | `bootstrap`, `TOP_PICKS` |
| 3 | 462 | **never** | 7 | 2,119,080 B | `bootstrap`, `TOP_PICKS` + 4 deferred |

`url_changed=True` on both successful runs; the shell rendered both times.

**shell median 538 ms**, against path A's 9,890 ms — which is the whole reason the two
paths are reported separately. Path A's number is ~9.3 s of intro animation plus the
page; path B is the page.

### 🔴 What the dry run found, and it is a product question, not an instrument one

**`.of-picks` is not reliably reached on in-app navigation.** One run took 15.9 s; the
next never rendered it inside the 6 s settle window and finished with a body of 2,709
chars against run 2's 3,852. The parts arrive either way — `part=bootstrap` and
`part=TOP_PICKS` are served on every run — so this is not the transport. It is the
TOP 10 table not consistently rendering from parts that the browser already has.

⭐ **A timing-only rig would have reported run 3 as a 462 ms success.** The shell was
up, the URL had moved, the parts had landed. Reporting the PRODUCT separately from the
SHELL is what makes the failure visible, and it is why `picks_ms` exists.

⚠️ **Run 2 also shows a duplicate-request storm**: `part=TOP_PICKS` ×3 and
`part=bootstrap` ×3 in one navigation, plus a `data?days=1`, for 3.5 MB — against run
3's clean 7 requests. Recorded, not chased.

⚠️ **`login http 502` appeared on 1 of 3 runs here and 3 of 3 on an immediate re-run.**
It was **not** the product: another workstream pushed five times in six minutes
(13:54 → 14:08 ET) and every master push rebuilds web, so the rig was logging in
through a deploy swap. `/api/health` was 502 in the same window and 200 with a 46 s
uptime afterwards. **A rig run that overlaps someone else's deploy is INCONCLUSIVE,
never a product failure** — check `railway deployment list --service web` before
believing a transport error.

---

## ⛔⛔ HARD RULE — a run overlapping any master push is INCONCLUSIVE

> **Every master push rebuilds web. A run that straddles the swap measured two
> different pods, and it is DISCARDED, never averaged.**

Owner ruling, 2026-09-12. Enforced in the rig, not left to the operator:

- `_uptime()` reads `/api/health`'s `uptime_seconds` **before and after every run**,
  on both paths.
- `_swap_verdict(before, after, elapsed, min_pod_age)` invalidates a run **four**
  ways, and the order is load-bearing:

  | # | condition | what it means |
  |---|---|---|
  | 1 | uptime **unreadable** | during a swap `/api/health` itself 502s |
  | 2 | uptime went **backward** | a swap landed mid-run |
  | 3 | pod **younger than the run** | a swap landed mid-run even though uptime rose |
  | 4 | pod **too young at START** (`MIN_POD_AGE_S`, 120 s) | no swap during the run, but the pod is **COLD** |

  ⭐ **(4) is not a variant of (3).** Forward uptime proves only that no swap
  happened DURING the run; it says nothing about whether the pod was warm enough to
  measure. Check 3 runs before check 4 so its specific diagnosis is not swallowed by
  the broader one — a mid-run swap and a cold start are different facts.

  ⚠️ **120 s is a floor derived from one observed pair, not a tuned number**: the
  same check returned `parts served: NONE` on a 38 s-old pod and all six parts on a
  232 s-old pod. It is deliberately generous — an extra INCONCLUSIVE costs one re-run,
  a false failure at the open costs a wrong diagnosis. `--min-pod-age` overrides it.
- A swapped run prints `!! INCONCLUSIVE` and is filtered out of every median. The
  summary **says how many were dropped** — a silent discard is as misleading as
  averaging them in, because nobody can tell `n` fell.
- ⛔ **An ERROR row carries the verdict too.** The error paths used to return before
  the second uptime read, so `login http 502` — the exact symptom a swap produces —
  came back with no verdict at all. That was the one case the rule exists for.

⭐ **FAIL CLOSED on "could not tell".** During a swap `/api/health` itself 502s, so an
unreadable uptime IS the swap case wearing a blank face. Treating `None` as fine is
the shape `lesson_a_saturated_instrument_reports_zero` names.

**Every row now prints `pod age at start=... after=...`**, whether or not it was
discarded — an operator can see the condition rather than having to trust the verdict,
and the discard summary names the cause **per run** instead of asserting "a swap".

Rail: `tests/test_flow_rig_swap_guard.py` — eleven cases, including a clean warm
control, a fails-closed sweep over every invalidating input, a pin on the 120 s literal
(so the default cannot be quietly "fixed" to match a failing run), and a source check
that `main()` still filters and still counts. Mutation-proved four ways: invert the
backward comparison; delete the cold-start branch; drop the floor to 0; reorder checks 3
and 4. Each goes RED naming the right test.

And the WIRING was smoke-tested against the live site, which the pure-function tests
cannot reach: `--min-pod-age 99999` on a real run printed
`!! INCONCLUSIVE ... pod was only 677s old at the START (floor 99999s)`, reported
`1 run(s) DISCARDED`, and left every median as `NOTHING MEASURED`.

⚰️ **Why it is a hard rule and not advice.** On 2026-09-12 the rig reported
`login http 502` on three consecutive runs and it read exactly like a broken product.
It was another workstream pushing five times in six minutes. Later the same afternoon
it happened again on the rig's own verification run, and the deploy in flight was
*this session's own commit*. Both times the honest answer was "nothing was measured".

---

## Path B, four runs total — the picks result is BIMODAL, and it correlates

> ### ⚠️ QUIET TAPE — NOT A MEASUREMENT. Version frozen at 39819849 throughout.

All four runs verified **not swapped** (uptime monotonic across each), so none of this
is deploy churn:

| run | `shell_ms` | `picks_ms` | flow req | wire | shape |
|---|---|---|---|---|---|
| A | 462 | **never** | 7 | 2,119,080 B | clean |
| B | 446 | 1,329 | 7 | 2,119,080 B | clean |
| C | 614 | 15,863 | 8 | 3,536,844 B | storm |
| D | 719 | 30,547 | 6 | 3,367,123 B | storm |

**`shell_ms` is tight: 446–719 ms.** `picks_ms` spans 1,329 ms → 30,547 ms → never, on
an identical quiet tape. That is not a slow page; it is two different behaviours.

### ⭐ The correlation that turns two Monday questions into one

The **clean** runs issue 7 flow requests for 2,119,080 B — two un-versioned first-paint
parts, then the four versioned deferred parts. The **storm** runs issue 6–8 requests
for ~3.4 MB and spend them **re-requesting `bootstrap` and `TOP_PICKS`** rather than
proceeding to the deferred remainder. Fast picks appear only on the clean shape.

So the duplicate-request storm and the slow/absent picks table look like **one defect,
not two**: something re-fires the first-paint fetch instead of advancing, and the table
waits on a product that keeps being re-requested. That reframes Monday's observation:

⛔ **Count MOUNTS, not requests.** A remount would produce exactly this — repeated
first-paint parts, no progression to the deferred set, and a table whose gate never
settles. A render gate below the shell would NOT re-issue the network calls, so the
request pattern is the discriminator between the two hypotheses.

⚠️ Run A is still the worst case and the most informative: clean shape, 7 requests,
parts served — and the table never rendered inside the settle window. Whatever the
storm is, it is not the only way to lose the picks table.
