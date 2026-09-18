# W4 MATERIAL — closed. The programme stops at WALL-OWNER-TAP.

> **The one line, per the owner's ruling:**
>
> **Open the hub on your phone. Record gesture trace on. Use it. If it is fit, tap Hub is
> fit; if not, tap Report once on the first wrong thing.**

---

## What is live

| | |
|---|---|
| master / production | `39252bc07` |
| deploy record | **SUCCESS**, created `2026-09-18T22:53:53` |
| ancestry | `git merge-base --is-ancestor 39252bc07 origin/production` → **true**, with a fabricated-sha control returning rc=128 |
| post-deploy smoke | **16/16 pass, exit 0**, both themes, as the smoke account |
| exposure | `ROLLOUT_STAGE = 1` — **admin-only**. No member sees any of this yet. |

---

## The four phases

**Phase 1 — LAND NOW.** `bd03e8cba`. Lean gate `NO_NEW_FAILURES` against the baseline of
record; three-dot list proving R1 bounds (45 files, **0** outside the declared surfaces);
exposure levers `ROLLOUT_STAGE`/`STAGE_NAMES`/`unsetDefault`/`cardVisible`/`ROW_DIGESTS` at
**0 changed code lines each**, with a control (`STRONG_CUT`: 10 lines) proving the scan could
see a real change; Rule 12 clean; R2 discipline with recency and in-flight passing **unaided**
and only the burst clause attested.

**Phase 2 — COMMIT THE HARNESS.** The 26 MB static server, `hubShowing.js` as the single
visibility authority, `HARNESS-NOTES.md` with its two stated limits, plus
`tools/hub_prod_smoke.py` — a driver that IMPORTS the capture tool's gesture timing, SHOWING
predicate and fan reader rather than copying them.

**Phase 3 — W4 MATERIAL, three passes.**

| pass | fixed |
|---|---|
| 4 | The bubble becomes the material. Five hub surfaces carried `blur(18px) saturate(160%)` and `.bubble` — the only thing you look at for the whole gesture — carried none. **Rim is glass, centre is a backplate**: the contrast token lives inside the material, so the pill never goes opaque. |
| 5 | **F13** — a shadow derived from `--bg` is a *glow* in light theme (`#ffffff` at 70%). **D3** — the specular follows the drag vector. |
| 6 | **D1** — a depth scale (10/12/14/18/24px by role) instead of one blur for five depths. |

**Phase 4 — the wall.** Here.

---

## The measurements that matter

**Contrast, from sampled pixels** — the page shot twice, once with labels hidden, so the
second shot *is* the composited ground behind the text. Control runs first every time and can
fail: `#777` on `#808080` → **1.13**, black on white → **21.00**.

| | dark | light |
|---|---|---|
| un-scrimmed, worst | **11.48:1** | **5.95:1** |
| scrimmed | ⛔ UNMEASURED | ⛔ UNMEASURED |

⛔ The scrimmed cells were tried on the harness **and on production** and remain unmeasured:
the only bubbles landing inside the scrim are the three requiring a symbol, which render
disabled and are WCAG-1.4.3 exempt. Reported as a hole, exit 2 — never rounded to a pass.

**M1, with the control that matters more than the number** — 4× CPU throttle, six samples per
arm: control (the build already in production) **1,4,4,3,1,4**; glass **3,5,4,4,1,2**.
Overlapping ranges, no measurable regression — and **both fail M1's absolute "zero"**. Filed
as **D-56**.

---

## ⛔ What no instrument here can answer

Every number above comes from synthetic pointer events, on an emulated profile, over a
synthetic backdrop.

- **CPU throttling throttles the main thread; `backdrop-filter` runs on the GPU compositor.**
  This rig is structurally *least* sensitive to the cost the glass introduces.
- A Live mirror's measured floor is **260–427 ms per gesture** against `FLICK_MS = 120`.
- Synthetic events put the control into a state; they say nothing about feel.

**R9 stands. The tap is the measurement.**

---

## Open, and each one filed rather than left implicit

| # | |
|---|---|
| **D-55** | `Home` overlaps the Actions button — geometry (`fanGeometry.js`), not material |
| **D-56** | M1's absolute bar, unmet by the shipped build; needs a ruling on the ratio form |
| **D-57** | Disabled labels fall to **2.26:1** in light theme — WCAG-exempt, but a real question |
| **D-58** | The two scrimmed contrast cells, unmeasurable on the harness AND on production |
| D-47, D-51–D-54 | unchanged, not this pass's |

---

## ⚰️ The corrections this programme paid for, kept because each one was believed

1. **`HARNESS-NOTES.md` carried a false mechanism in its own prose** — "the fan is
   photographed after release because `stickyFan` keeps it open". Probed: **0 bubbles 600 ms
   after release**, with `stickyFan` defaulted *and* stubbed true. Filed as **I4** beside that
   file's own I1–I3.
2. **Pass 2's F10** — "the light-theme tokens are NOT broken" — was true of the three tokens
   it measured and false by omission about the shadow family.
3. **C2 had never been evaluated on any landing.** `gate_carry_over` documented
   `--edges-json` "produced by the AST walker"; no walker existed.
   `tools/import_edges.mjs` now emits it — and turned this landing from `RE-GATE — could not
   evaluate: C2` into `CARRIES`.
4. **A true sentence held D1 in place for three passes**: *"no `--hub-blur` token exists to
   reference."* Accurate, and the reason nobody made one.

⭐ **And the instrument defects, because two would have been expensive.** A mistyped selector
(`hub-actions-button` for `hub-actions`) scored ABSENT as FAIL — under H15 that **rolls back a
healthy deploy**. A divider check passed on a page-wide count of **297** borders and would
have gone green with both dividers invisible. Both of D3's mistakes — lit-from-below, and a
"specular" that went black in light theme — were invisible to every number and turned up only
by **looking at a frame**.
