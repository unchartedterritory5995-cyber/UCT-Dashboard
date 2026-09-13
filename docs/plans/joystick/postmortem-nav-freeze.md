# Postmortem — navigation froze app-wide, 2026-09-10

**Impact:** clicking any nav entry on `/dashboard` changed the URL and left the screen where it
was. Only a hard refresh recovered. It affected every member who loaded the dashboard, on every
device, for roughly **four and a half hours** (19:45 ET ship → ~00:20 ET fix merged).

**Found by:** a member, reporting it. Not by any instrument this programme owned.

**Fixed by:** a different session (`aa892aa18`, merged `4eab898e0`), while this programme was
running its Increment 7 gates two rooms away.

---

## 1. Timeline

| ET, 2026-09-10/11 | |
|---|---|
| 19:45 | **Increment 6 ships** `catalystsSection` — the Catalysts hub controller goes live on the Dashboard's session hero. The loop is now in production. |
| ~21:0x | A subagent (chart stream) hits an out-of-memory kill in its own harness and diagnoses it: *"`useHubMode` re-registration is identity-driven, so any host passing an unmemoized callback loops."* **The hazard class is named, correctly, in writing.** |
| 21:2x | It is relayed to the owner as a curiosity — "worth knowing". No check is made against the live build. |
| 23:03 | Increment 7 ships. Gate green, `/api/health` 200, first-hour watch clean. The freeze is live throughout and none of it looks. |
| 23:20 (CT 22:20) | Another session begins diagnosing a member report. Measures Dashboard at **0 renders/sec** and the hub-owning `CatalystTable` at **~4,500/sec**. |
| ~00:20 | Fix merged. |
| 00:25 | This programme deploys the Peek removal, still unaware. |
| 00:31 | Their fix reaches production; the pod restarts. **The only trace in our own first-hour watch is a single 502** — which we correctly attributed to "another workstream's deploy" and moved on from. |
| 00:4x | We read their commit while checking why master had moved, and find out. |

---

## 2. The chain — four links, three of them ours

Quoted from the fixing commit, because it measured this rather than inferring it:

> `useHubCursor` returned a fresh object every render
> → `catalystsSection`'s config memo was keyed on that whole object
> → `useHubMode` re-registered it every render
> → `setPageModeConfig` changed the hub context value
> → the tile, a context consumer THROUGH `useHubMode`, re-rendered

A second leg made it start on first mount: while the catalysts fetch was pending, `data?.rows || []`
manufactured a new array per render.

⛔ **Why nothing threw.** This is a *passive-effect* loop. React raises "Maximum update depth
exceeded" for a render-phase loop; it does not for this one. The browser simply spent its main
thread re-rendering, and React Router's navigation transition never got a commit. **The member was
held on the exact page that was looping** — so the one screen they could not leave was the one
generating the problem.

---

## 3. The false premise: "only a small, opted-in population can be affected"

This is the belief that let a hub defect be reasoned about as a small-blast-radius change, and it
is the one worth correcting hardest.

Everything this programme built to reason about exposure — `exposureGate.test.js`, the
coarse-pointer mount, the unset-preference-resolves-to-`isAdmin` rule, the admin-only Settings
card, `HUB_PREVIEW_ENABLED` — answers exactly one question: **who can SEE the hub.** Every one of
those rails is correct and none of them was violated.

⭐ **None of them says anything about who RUNS hub code.** `useHubMode` does not gate on
eligibility. `catalystsSection` mounts because the *tile* mounts, and the tile mounts for everyone
on `/dashboard`. So the loop ran for:

- desktop members, who can never see the joystick at all;
- non-admins with an unset preference, who had never opted in;
- every member on every device, eligible or not.

The exposure premise measured **visibility** and was read as **blast radius**. They are different
properties, and only one of them was ever under test.

⛔ This is also why the "admin-only preview" framing was dangerous in review: it made a hub change
*sound* low-risk in exactly the way a change mounted into a shared dashboard tile is not.

**Corrected by C2** (`hubInertWhenIneligible.test.jsx`): an ineligible member's host must render
the same number of times with the hub as without it. That rail immediately found two more
instances — `journalSection` and `screenerSection` each cost their host one extra render per
mount, because both read only *setters* off the volatile hub context and so re-rendered on their
own registration. Fixed with `HubSettersContext`.

---

## 4. Why the first-hour watch was blind

The watch polled `/api/health` every five minutes and recorded **five clean samples while the
defect was live**. It was not broken. It was measuring the wrong layer:

| Instrument | What it said | Why it could not see this |
|---|---|---|
| Full gate | 1,261 files, 18,708 tests, 0 NEW | jsdom renders; nothing clicked a link and compared screens |
| `/api/health` | `200`, uptime rising | the **server** was never unwell — this was entirely client-side |
| First-hour watch | five clean samples | it polls the endpoint above |
| Deploy artifact | uptime reset confirmed | proves a new build is serving, not that it works |

⭐ **A green suite, a 200 and a rising uptime are all compatible with a browser that cannot change
pages.** There was no instrument at the layer where the member lived.

**Corrected by C4** (`tools/hub_nav_smoke.py`): a real browser, against production, clicking every
nav entry and asserting **both** the URL and a screen fingerprint changed. It fails the watch
rather than logging. Its `--self-check` plants the freeze (a `pushState` that changes nothing) and
proves the detector fires on it and stays quiet on a healthy page.

⚠️ **It is honest about what it cannot cover.** With no smoke account it reports
**INCONCLUSIVE (exit 2)** — a distinct code from FAILED (exit 1) — because an anonymous visitor
has no nav to click. "We could not measure it" and "it is broken" are different facts, and the
first run of this smoke proved the point by reporting a vacuous PASS until a non-vacuity guard was
added.

---

## 5. "The tile mounts three times at once" — an error in our own header

`catalystsSection.js` opened with:

> ⛔⛔ **AND THE TILE MOUNTS THREE TIMES AT ONCE.** `Dashboard.jsx` renders `{hero}` TWICE
> (desktop zone B and the mobile stack) and `MorningWire.jsx:381` renders a third, compact copy.

It was quoted in the Increment 6 report as the reason the ref-scoped ownership rule was safe. It
was wrong in a way that mattered:

- Morning Wire's copy is **on its own route** and was never concurrent. It mounts **twice**, not
  three times.
- `display: none` hides without unmounting, so **both** copies were live on every visit — the
  hidden one paying for the same SWR poll, live-price subscription and hub registration.
- The ownership rule was "the mobile copy owns it". `Dashboard.module.css` hides `.mobileOnly` by
  **default** and only shows it under `@media (max-width: 640px)`. So at **641–1024px — tablets,
  which are coarse-pointer devices, i.e. exactly the population the hub is for** — the visible
  branch is the desktop one, and the hub was handed to a `display: none` tree.

⭐ The header was not a small inaccuracy; it was the *justification* for the design, and it was
never re-measured after being written.

**Corrected by their fix** (`useCssDisplayed` prunes the hero from the hidden branch and ownership
follows the visible copy) **and by C3** (`dashboardHeroByWidth.test.jsx`), which rails it at 393,
800 and 1024 with the phone ceiling **parsed out of the stylesheet** and cross-checked against
`BP.phone`.

---

## 6. The finding that was reported as a curiosity

The hazard class was named, in writing, by a subagent, hours before the fix — and after the code
exhibiting it was already live.

> "`useHubMode` re-registration is identity-driven, so any host passing an unmemoized callback
> loops."

It arrived attached to an OOM in a test harness, so it read as a testing anecdote. It was relayed
onward as "worth knowing". Nobody asked the one question that mattered: **is anything shipping
that does this right now?** The answer was yes, and a grep would have found it in under a minute —
the host was not even the one the finding came from.

**Corrected by C5**: `CLAUDE.md` now carries **H14** — a hazard class discovered while code
exhibiting it is live in production is a hard stop for the next deploy and an immediate check of
the live build, never a footnote. It names the tell: *the word "interesting"*. A hazard reported
as interesting has already been demoted.

---

## 7. What C1–C5 change

| | |
|---|---|
| **C1** `hub/hostRenderStability.test.jsx` | Every `useHubMode` host — list **derived** from source, reconciled both ways — mounted with frozen props: bounded renders, and at most one published config per distinct identity. The rail the finding in §6 described and nobody wrote. |
| **C2** `hub/hubInertWhenIneligible.test.jsx` | The exposure question's other half: what does an ineligible member *pay*. Found and fixed two live instances. |
| **C3** `pages/dashboardHeroByWidth.test.jsx` | Tablet ownership at 393/800/1024, boundary parsed from the stylesheet. |
| **C4** `tools/hub_nav_smoke.py` | A real browser asserting navigation actually navigates, against production, after every deploy. |
| **C5** `CLAUDE.md` → **H14** | A named hazard class + live code = hard stop, not a footnote. |

## 8. What this does not fix

- **`useHubMode` still does not gate on eligibility**, and that is deliberate: `useHubEligible`
  returns `false` in jsdom by design, so gating registration on it would suppress registration in
  every section rail — the guard would disable the thing it guards. The enforced property is zero
  *overhead*, not zero registrations. If the hub is ever made genuinely inert for ineligible
  users, it needs a test-environment story first.
- **No rail watches production continuously.** C4 runs after a deploy. A defect introduced by a
  data shape that only appears at 09:30 ET would still be found by a member.
- **The first-hour watch still reads `/api/health`.** It is kept, because a pod that stops serving
  is also real — but it is no longer the only thing looked at.
