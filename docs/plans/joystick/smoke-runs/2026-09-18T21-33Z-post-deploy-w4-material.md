# Post-deploy smoke + contrast — `38f60f717` (W4 material)

> **Smoke 16/16 pass, exit 0. Contrast exit 2 — INCONCLUSIVE, and the reason is recorded
> rather than rounded away.**
> Instruments: `tools/hub_prod_smoke.py`, `tools/hub_contrast.py`, iPhone profile, against
> **production**, as `smoke@uctintelligence.internal`, no signup attempted.

---

## The deploy, verified by the artifact

| | |
|---|---|
| sha | `38f60f717` |
| deploy record | **SUCCESS**, created `2026-09-18T21:25:47`, settled 21:29:14 |
| ancestry | `git merge-base --is-ancestor 38f60f717 origin/production` → **true** |
| control | a fabricated 40-zero sha returns rc=128 — the ancestry test is not passing vacuously |

---

## Smoke — 16/16, no regression from the material change

Identical to the pre-glass run on `bd03e8cba`, which is the point: the glass changed the
material and nothing else.

- **at rest, both themes:** pad + chip + Actions showing; **6 bubbles PRESENT and none
  showing** — F1 still fixed on the live build
- **drag opens, both themes:** 0 → 6, the cut surface
- **dividers, both themes:** exactly 2 inside the Joystick card out of 20 divs — D-49 holds
- **surface control:** present, `simplified`, options `['simplified','full']`
- **kill switch:** hub hidden with `hub_preview_enabled=false`
- **surface round-trip through real storage:** full=**7** vs simplified=**6**
- **smoke reset:** `joystick_hub` restored to `{}` byte-identical

---

## Contrast on production — the glass, measured where members see it

| cell | graded | worst |
|---|---|---|
| dark · un-scrimmed | 3 | **10.44:1** |
| light · un-scrimmed | 3 | **6.36:1** |
| dark · scrimmed | ⛔ **0 — UNMEASURED** | — |
| light · scrimmed | ⛔ **0 — UNMEASURED** | — |

Every enabled label clears AA 4.5:1 with room, in both themes, on the live build. **The
backplate-inside-the-material works**, and the pill never had to go opaque to get there.

### ⛔ D-58 stands — production did NOT close the scrimmed cells

The hypothesis was that a real account with a real symbol would enable `flag`, `alert` and
`planTrade`, putting graded labels inside the scrim. **It did not.** On production, as the
smoke account, those three still render disabled (0.4 opacity) — no symbol reaches the hub's
`requires` context on that account's `/charts`.

⛔ **Reported as a hole, not rounded to a pass.** WCAG 1.4.3 exempts inactive components, so
grading them would manufacture a finding out of a deliberate affordance; and a cell with
nothing graded in it is not a cell that passed. The tool exits **2 = INCONCLUSIVE**, which is
deliberately distinct from 1, so this can never fire H15's rollback.

⚠️ **What would close it:** a session with a symbol actually selected on the chart — the
sandbox, or the owner's own device run, where the three symbol-gated actions come alive and
land inside the scrim.

### ⚠️ The exempt numbers, for the record

| | dark | light |
|---|---|---|
| `planTrade` (disabled) | 12.47:1 | 3.65:1 |
| `alert` (disabled) | 14.44:1 | 3.25:1 |
| `flag` (disabled) | 14.27:1 | **2.26:1** |

Dark is fine. **In light theme a disabled label falls to 2.26:1** — filed as **D-57**: the
0.4 opacity that makes "needs a symbol first" legible as a *state* is also what makes the
word hard to read. Not a WCAG failure; a question about whether disabled should dim the icon
and rim rather than the text.
