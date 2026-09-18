# Post-deploy smoke — `bd03e8cba` (design/bar-and-strong-cut)

> **16 checks, 16 pass, 0 FAIL, 0 inconclusive. Exit 0.**
> Instrument `tools/hub_prod_smoke.py`, iPhone profile (390×844, coarse), against
> **production**, as `smoke@uctintelligence.internal`, no signup attempted.
> Frames: `scratchpad/prodsmoke3/`.

---

## The deploy, verified by the artifact

| | |
|---|---|
| sha | `bd03e8cba` |
| deploy record | **SUCCESS**, created `2026-09-18T18:38:43`, settled 18:43:36 |
| ancestry | `git merge-base --is-ancestor bd03e8cba origin/production` → **true** |
| control | a fabricated 40-zero sha returns rc=128 — so the ancestry test is not passing vacuously |

⛔ **Not verified by uptime.** `uptime_seconds` resolves to whichever pod is serving; if a
deploy is superseded mid-flight that number describes somebody else's boot. The deploy
record's own STATUS plus ancestry against the ref Railway deploys from are the two facts
that answer *"did MY code ship"*.

---

## What passed

| check | dark | light | evidence |
|---|---|---|---|
| theme via the **preference**, not the OS scheme | ✅ | ✅ | `data-theme` asserted before any frame is kept; bg `rgb(16,16,18)` vs `rgb(255,255,255)` — they differ, so the light pass is real |
| hub showing | ✅ | ✅ | 84×84 box, via `hubShowing.js`, the single authority |
| **at rest: exactly pad + chip + Actions** | ✅ | ✅ | 6 bubbles **PRESENT** in the DOM and **none showing** |
| drag opens to the cut surface | ✅ | ✅ | 0 → 6: `planTrade, alert, flag, draw, voice, home` |
| both dividers (D-49) | ✅ | ✅ | **exactly 2** inside the Joystick card, `1px`, colour `rgb(42,44,49)` / `rgb(227,229,231)` |
| the full/default switch exists | ✅ | ✅ | `value='simplified'`, options `['simplified','full']` |
| kill switch hides all of it | ✅ | ✅ | `hub_preview_enabled=false` → no hub-root in the DOM |
| **surface round-trip through real storage** | ✅ | — | full=**7** vs simplified=**6** bubbles |
| smoke reset (joystick_hub) | ✅ | — | restored to `{}` byte-identical |

⭐ **PRESENT IS NOT SHOWING, and it was checked both ways.** At rest the six bubbles are in
the DOM *and* invisible. Asserting only "not visible" would pass on a hub that never
mounted; asserting only "present" is the mistake the touch smoke published once before.
This is F1 — the fan drawn while closed — verified fixed on production rather than in a
fixture.

⭐ **The surface round-trip is the only check that does NOT stub `/api/auth/preferences`,
and it is the one that mattered most.** The R4 variant was once built, tested, green and
unreachable because `setHubSurface` had no product caller. Writing the preference through
production's real storage and watching the fan change (7 → 6) is what proves the wiring
exists outside a fixture. It writes, which is why the run restores the baseline.

---

## ⚰️ Three instrument defects found and fixed DURING this run

Recorded because each produced a confident wrong answer first, and two of them were green.

| | what it was | how it was caught |
|---|---|---|
| **S1** | the divider check counted **297** bordered `div`s page-wide on `/settings` and reported PASS. It would have passed with both Joystick dividers invisible — a fixture that cannot distinguish | the number was absurd for a check about two borders |
| **S2** | `hub-actions-button` is not a testid; the real one is **`hub-actions`**. A wrong selector reports the element ABSENT, which my check scored as FAIL — and under H15 a measured failure rolls production back. **My typo would have rolled back a healthy deploy** | verified every selector against source before the first run |
| **S3** | the first real run reported `FAIL: the full/default switch is not on the Settings page`. Settings is **tabbed**; the Joystick card lives in the `charts` section (`Settings.jsx:2311-2316`), so a bare `/settings` never draws it. The URL parameter is `?section=`, not `?tab=` | a two-context probe (with and without my preference stub) showed the card absent **both** ways, which ruled out my stub and pointed at the page, not the product |

⛔ **S3 is the one to keep.** The hypothesis that fit best — *"my stub starved the data-hungry
Settings page into an error boundary"* — was plausible, had a precedent in this very
programme (the harness's `/dashboard` rows), and was **wrong**. It was only discarded because
the probe carried the control: the same page, without the stub. A likely story with a
precedent is still a story.

⭐ **And the classification bug beneath S2/S3 is the real lesson:** *absent* and
*present-but-broken* are different facts, and I had applied that discipline to the at-rest
check and not to the others. `FAIL` now requires the card to be **mounted** and the control
**missing**; a card that is not there is INCONCLUSIVE. Exit codes stay 0 / 1 / 2 for the
same reason — H15 fires on 1 only.

---

## ⚠️ One open finding, product-side, NOT this branch's

**Loading `/charts` rewrites the `tracings_doc` preference with a fresh `updatedAt` even
when nothing changed.** Measured across the run: `1789693083736 → 1789757406781`, and the
`doc` payload compares **byte-identical**.

So it is a no-op write to `auth.db` on every chart page load, per user. That is the same
*shape* as the unthrottled per-request `last_login` write behind the 2026-07-01 524 outage
— much less frequent (a page load, not every request), so not urgent, but it is a write on
a path nobody chose.

⛔ **Deliberately not "fixed" here, and the stale value deliberately not written back.**
`updatedAt` looks like conflict-resolution state; planting an older timestamp to make this
run's reset check go green would be manufacturing the result. The drift is recorded as
explained-and-content-neutral instead.

⚠️ **Consequence for the reset rule:** while the product writes on load, a browser-driven
smoke can never leave the account perfectly byte-identical. `joystick_hub` — the only key
this run deliberately wrote — **is** restored byte-identical, and that is the guarantee
that actually protects the next run.

---

## ⚠️ Pre-existing residue on the smoke account, from earlier runs

The baseline capture found **7 preference keys**, including
`charts_workspace_groups = {"A":"SMCI"}` and a populated `charts_workspace_layout`.

The account's contract says it must hold nothing — *"whatever a run creates, that run
removes"* — so this is a standing breach, from runs before this one. **Not silently cleaned
here**: there is no HTTP delete for a preference (`delete_user_preference` is imported at
`api/routers/auth.py:76` and has **zero call sites**), so "reset" would mean writing seven
more values into a live account, which is a judgement call for the owner rather than a
tidy-up an automated run should make on its own.
