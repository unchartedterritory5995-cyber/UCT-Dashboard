# L12 readings: clause 2c (no dead clicks) and clause 6c (no layout regressions)

Every number is read from committed raw evidence (R-RAW); the raw evidence was committed before this reading.

## 2c: no dead clicks: **MET**

| run | evidence | surfaces | control |
|---|---|---|---|
| full sweep at `0100a3032` | `l12dc-0100a3032/` (`3d95c76fc`) | 39: 37 MEASURED, 1 TIMEOUT, 1 ERROR | VALID |
| targeted re-run at `6cbf0618e` (`--surface-deadline 900`) | `l12dc2-6cbf0618e/` (`589b0ddf9`) | the 2 unfinished surfaces, both MEASURED | VALID |

**The two surfaces the full sweep could not finish**, both completed by the targeted re-run:

| surface | full sweep | targeted re-run |
|---|---|---|
| nb-templates (desk) | TIMEOUT at the flat 360 s after 59 of 60 enumerated controls, none DEAD. The 25 templates give distinct names, so per-key sampling cannot fold them. | LIVE 59, CURRENT-NO-OP 1 |
| nb-first-run-clicks (desk) | ERROR: the walk's own setup `POST /api/auth/login` to the sandbox timed out (30 s) before any click | OCCLUDED 5. The first-run tour dialog covers the page by design; the same reading as L11 (`l11-52deeb767`). |

**Control verdicts across the full sweep:**

| verdict | count |
|---|---|
| LIVE | 561 |
| REPEATED | 44 (the per-key sample cap, WK6) |
| CURRENT-NO-OP | 16 |
| NOT-FOUND | 9 |
| DISABLED | 9 |
| OCCLUDED | 3 |
| NOT-ACTIONABLE | 3 |
| **DEAD** | **0** |

- **What the two runs cover together:** all 39 surface x mode cells are measured, with **0 DEAD**.
- **The three DEAD rows L11 found are gone:**
  - nb-table's `UPDATED` sort header got a server-side toggle (FX4 `a1cce8ad1`);
  - the calendar and timeline `Today` buttons are marked `aria-current` (FX4 `464d56a40`). They now read CURRENT-NO-OP: 16 here, 14 at L11.
- **Why this instrument can be trusted:**
  - its quiet-window wait covers network activity as well as the DOM, with a derived 300 ms floor (WK6 `7113bd567`);
  - window membership is decided on one clock, and cross-origin requests are never stamped (WK7 `1518c9337`, `7c1b27692`);
  - in both runs the planted poller read IN-WINDOW and the planted dead controls read DEAD.
- **Sandbox:** CLEAN at all four checkpoints in both runs.

## 6c: no layout regressions at 390/820/1200: **MET under ruling D23**

- **Evidence:** `l3-reconfirm-fe01bdb14/` (`e50f2a1ba`); the L3 instrument ran UN-SCOPED over every surface.
- **Coverage:** widths 390/820/1200 on the orb pass (the hub draws only below 1024 on a coarse pointer, so the hub pass covers 390/820), with hint-seen and coach-pending in both states.
- **Instrument summary:** `controls_valid: true`, `errors: 0`.

| named lead | count | what it is |
|---|---|---|
| CLEARED | 398 | |
| SAME-COMPONENT | 88 | the hub knob beneath its own pad, which is the knob's designed hit surface |
| under-open-popup | 36 | a menu that is open over the page by intent |
| **CONFIRMED** | **0** | |

- **Ruling D23** (controller, owner-delegated 2026-09-30) is why the 88 read SAME-COMPONENT:
  - it applies only when the occluder is the control's own component, i.e. `sameHub` read from the control's own occlusion reading;
  - a different element with the same geometry still reads CONFIRMED (the GX rails, mutation-proved).
- **Sandbox:** CLEAN at all four checkpoints.

## The final walk on the L12 tree: every sweep, after TY's follow-ups

- **Evidence:** `l12final-035b301b6/`, committed in `406c13f64` (R-RAW) before this reading.
- **The tree:** L12 `035b301b6`, which includes TY's toolbar re-render bailout and both follow-ups:
  - `3b6e6fde4`: G-131 text colour on touch; `selectionEmpty` and highlight state in the signature; the audit rail.
  - `c9b303c63`: Quote after "1. List" is disabled with a reason.
- **Walk settings:** `--surface-deadline 900`.
- **Run health:** all five controls VALID, the sandbox CLEAN at all four checkpoints, 0 errors, 0 page errors.

| sweep | reading |
|---|---|
| census (2b) | WORKS 113, N/A 30, NOT-DRIVEN 22, **BROKEN 0, NO-DOOR 0**. G-131 WORKS on desktop, touch and keyboard. The pre-follow-up walk `l12full-62e252649` read touch BROKEN. |
| dead clicks (2c) | **39/39 surfaces MEASURED in one run, 0 DEAD.** LIVE 564, CURRENT-NO-OP 16, DISABLED 9 (Quote inside a list is now one of these), NOT-FOUND 9, OCCLUDED 9, NOT-ACTIONABLE 3. REPEATED 972 is per-key sampling: at most 3 of each repeated control are clicked, and every other one is recorded by name, never dropped. |
| silent (5d) | reads 72/72 SENTENCE; writes 24 SENTENCE + 4 EXEMPT; **0 SILENT** |
| axe (9a) | 123/123 runs, **0 violations** |
| geometry (6c inventory) | 129 cells; 2440 findings (the raw inventory; 6c is read on the L3 classification above) |

**The follow-ups this walk verifies.** TY's bailout regressed two things, and the walk before this one found both:
- **G-131 on touch.** TY could not reproduce it in jsdom, so this walk is its proof.
- **The Quote button.** Its old LIVE reading was really the re-render's side effects. After "1. List" the command is a schema refusal (`listItem` content is `paragraph block*`).

Both are fixed and both read clean here.
