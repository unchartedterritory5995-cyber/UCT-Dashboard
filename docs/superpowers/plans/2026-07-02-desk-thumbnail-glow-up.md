# Desk Thumbnail Glow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the visual internals of the three code-drawn Desk thumbnail layouts with the owner-selected mockup designs (classic→Candlestick Skyline, editorial→Leather Journal, evening→City Lights on Water).

**Architecture:** Each task ports ONE proven mockup recipe (a working scratch script that already renders the approved design) into `api/services/desk_thumbnail.py` as the new body of the existing render function — same signature, same routing, same output contract. Ported code must re-derive all text from function arguments (mockups hardcode sample text).

**Tech Stack:** Python, Pillow (existing), pytest. No new dependencies, no new assets.

**Spec:** `docs/superpowers/specs/2026-07-02-desk-thumbnail-glow-up-design.md`

## Global Constraints

- Worktree: `C:\Users\Patrick\uct-dashboard\.worktrees\thumbs` (branch `feat/thumbnail-glow-up`). Commit per task. **NEVER push — owner approves proofs first.**
- Only the bodies of `_render_classic`, `_render_editorial`, `_render_evening` (plus new module-level private helpers they need) change. `_resolve_theme`, `_THEMES`, layout names, `render_session_thumbnail` dispatch, `_render_plate`, and the ChartMaster assets are UNTOUCHED.
- Signatures unchanged: `_render_classic(theme, date_text, eyebrow_label) -> Image`, same for the other two. Output stays 1280×720 RGB; encode path (JPEG q95 subsampling 0) is shared and untouched.
- Dynamic text: classic + editorial derive ALL show text from `eyebrow_label` (classic must handle arbitrary/long eyebrows — it is the default layout and the plate fallback); evening keeps its existing host-aware `" FROM "` split logic verbatim.
- Date input format stays `"July 1, 2026"`; per-layout casing per the mockups.
- Brand kit on every card: compass mark, UNCHARTED TERRITORY, show text, date, gold #c9a84c family, tagline "Navigate the market, effectively.".
- Existing tests in `tests/test_desk_thumbnail.py` must pass UNMODIFIED.
- Mockup recipes (read-only source material, outside the repo):
  `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\50b68299-1118-48ab-9f2e-e56b84440da6\scratchpad\variants\make_live.py` (port variant **v2** only),
  `...\make_thoughts.py` (port variant **v3** only),
  `...\make_evening.py` (port variant **v2** only).

---

### Task 1: Classic → Candlestick Skyline

**Files:**
- Modify: `api/services/desk_thumbnail.py` (body of `_render_classic`, ~lines 188–204, plus any new private helpers placed directly above it)
- Test: `tests/test_desk_thumbnail.py`
- Read-only source: `...\scratchpad\variants\make_live.py`, function that renders `live_v2.png`

**Interfaces:**
- Consumes: existing helpers `_gradient_bg`, `_radial`, `_vignette`, `_gold_center`, `_draw_tracked_center`, `_tracked_w`, `_font`, `_compass`, `_draw_uptrend`, constants `_W/_H/_SIZE/_GOLD/_WORDMARK/_TAGLINE`.
- Produces: new `_render_classic` body; optional helpers prefixed `_classic_*` or generic (`_grain(img, alpha)` if the recipe adds film grain — reusable by Tasks 2–3, name it `_grain`).

- [ ] **Step 1: Write the failing smoke tests** — append to `tests/test_desk_thumbnail.py`:

```python
def _smoke(eyebrow, variant=None):
    data = thumb.render_session_thumbnail("July 1, 2026", eyebrow_label=eyebrow,
                                          variant=variant)
    assert data[:2] == b"\xff\xd8"
    img = Image.open(io.BytesIO(data))
    assert img.size == (1280, 720)
    assert len(data) < 2 * 1024 * 1024
    return data


def test_classic_smoke():
    _smoke("LIVE TRADING SESSION")


def test_classic_long_arbitrary_eyebrow_no_crash():
    _smoke("SUPER EXTENDED WEEKEND DEEP DIVE MASTERCLASS MARATHON SESSION")
```

(`test_classic_long_arbitrary_eyebrow_no_crash` guards auto-fit: the new design must shrink/track the eyebrow line rather than overflow the canvas.)

- [ ] **Step 2: Run to confirm baseline** — these pass against the OLD renderer too; that is fine — they are regression rails for the port. Run: `python -m pytest tests/test_desk_thumbnail.py -q` → all PASS. Commit the tests first:

```bash
git add tests/test_desk_thumbnail.py
git commit -m "test(desk): smoke rails for classic thumbnail redesign"
```

- [ ] **Step 3: Port the recipe** — open `make_live.py`, locate the v2 ("candlestick skyline") render function, and transplant its drawing sequence into `_render_classic`, with these mandatory adaptations:
  - Replace hardcoded `"LIVE TRADING SESSION"` with `eyebrow_label`, drawn as `f"— {eyebrow_label} —"`; auto-fit: start at the mockup's font size and step down by 2 until the tracked width ≤ `_W - 120` (mirror the while-loop idiom used in `_render_evening` for its headline).
  - Replace the hardcoded date with `date_text` through the metallic `_gold_center` treatment; auto-fit the same way (width ≤ `_W - 160`).
  - Colors for wordmark/eyebrow/tagline come from `theme.wordmark` / `theme.eyebrow` / `theme.tagline`; the storm backdrop and gold chart glow may stay literal (they are the design).
  - Keep the function returning an RGB `Image` (convert at the end, as the old body did).

- [ ] **Step 4: Render and LOOK** — from the worktree root:

```python
# scratch: python -c below or a throwaway file
from api.services.desk_thumbnail import render_session_thumbnail
open("proof_classic.jpg", "wb").write(
    render_session_thumbnail("July 1, 2026", eyebrow_label="LIVE TRADING SESSION"))
```

View `proof_classic.jpg` (Read tool). It must match the approved `live_v2.png` design with no clipping/artifacts. Iterate Step 3 until it does. Delete `proof_classic.jpg` before committing.

- [ ] **Step 5: Run the full thumbnail suite** — `python -m pytest tests/test_desk_thumbnail.py -q` → all PASS (existing + new).

- [ ] **Step 6: Commit**

```bash
git add api/services/desk_thumbnail.py
git commit -m "feat(desk): classic thumbnail -> candlestick skyline design"
```

---

### Task 2: Editorial → Leather Journal

**Files:**
- Modify: `api/services/desk_thumbnail.py` (body of `_render_editorial` and its section, ~lines 211–356; the `_TREND` constant and `_draw_uptrend` MUST remain — classic now uses them)
- Test: `tests/test_desk_thumbnail.py`
- Read-only source: `...\scratchpad\variants\make_thoughts.py`, function that renders `thoughts_v3.png`

**Interfaces:**
- Consumes: `_gradient_bg`, `_gold_center`, `_hero_line_left` (may become unused — remove ONLY if no other caller remains after the port; check with grep), `_balanced_two_lines`, `_draw_tracked_center`, `_tracked_w`, `_font`, `_compass`, `_vignette`, `_grain` (from Task 1 if introduced), constants.
- Produces: new `_render_editorial` body; helpers prefixed `_journal_*` (e.g. `_journal_frame`, `_leather_grain`) if the recipe splits them out.

- [ ] **Step 1: Write the failing smoke test** — append:

```python
def test_editorial_smoke():
    _smoke("THOUGHTS ON THE MARKET")
```

- [ ] **Step 2: Baseline run + commit test** — `python -m pytest tests/test_desk_thumbnail.py -q` → all PASS.

```bash
git add tests/test_desk_thumbnail.py
git commit -m "test(desk): smoke rail for editorial thumbnail redesign"
```

- [ ] **Step 3: Port the recipe** — transplant the `thoughts_v3` ("leather journal") drawing sequence into `_render_editorial`, adaptations:
  - Headline text = `eyebrow_label` through `_balanced_two_lines` + auto-fit (step size down until the widest line ≤ `_W - 260`, inside the gold frame), NOT the hardcoded two lines.
  - Kicker stays the literal `"MARKET COMMENTARY"` (matches current behavior).
  - Date = `date_text.upper()` in the mockup's gold style.
  - Keep the emerald palette from `theme` where it maps (`theme.bg_top/bg_bottom` for the leather base tint); frame/foil gold stays literal.
  - The card must remain the layout for BOTH `_THEMES["thoughts"]` and `_THEMES["emerald"]` (same Theme object — nothing to do beyond not renaming).

- [ ] **Step 4: Render and LOOK** — same proof loop as Task 1 with `eyebrow_label="THOUGHTS ON THE MARKET"`, file `proof_editorial.jpg`. Iterate until it matches `thoughts_v3.png`. Delete the proof before committing.

- [ ] **Step 5: Full suite** — `python -m pytest tests/test_desk_thumbnail.py -q` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/services/desk_thumbnail.py
git commit -m "feat(desk): editorial thumbnail -> leather journal design"
```

---

### Task 3: Evening → City Lights on Water

**Files:**
- Modify: `api/services/desk_thumbnail.py` (body of `_render_evening` and its section constants `_SKY_STOPS`/`_SKY_SEEDH`/`_skyline` as the recipe requires, ~lines 363–499)
- Test: `tests/test_desk_thumbnail.py`
- Read-only source: `...\scratchpad\variants\make_evening.py`, function that renders `evening_v2.png`

**Interfaces:**
- Consumes: `_sky_gradient`, `_skyline`, `_radial`, `_gold_center`, `_shadow_center`, `_draw_tracked_center`, `_tracked_w`, `_font`, `_compass`, `_grain` (if introduced), constants.
- Produces: new `_render_evening` body; helpers prefixed `_water_*` (e.g. `_water_reflections`).

- [ ] **Step 1: Write the failing smoke tests** — append:

```python
def test_evening_smoke_host_aware():
    _smoke("EVENING UPDATE FROM TSDR")


def test_evening_smoke_no_host():
    _smoke("EVENING UPDATE")
```

- [ ] **Step 2: Baseline run + commit tests** — `python -m pytest tests/test_desk_thumbnail.py -q` → all PASS.

```bash
git add tests/test_desk_thumbnail.py
git commit -m "test(desk): smoke rails for evening thumbnail redesign"
```

- [ ] **Step 3: Port the recipe** — transplant `evening_v2` ("city lights on water") into `_render_evening`, adaptations:
  - PRESERVE the existing host-aware block verbatim (the `if " FROM " in eb:` split producing `head` + `sub`) — headline/subline text placement adapts to the new composition, the parsing logic does not change.
  - The date pill keeps its current construction (rounded rect + gold outline + tracked text) but sits centered on the water band per the mockup.
  - Horizon/water geometry, reflections, glitter path come from the recipe.

- [ ] **Step 4: Render and LOOK** — proof loop with BOTH `"EVENING UPDATE FROM TSDR"` and `"EVENING UPDATE"` eyebrows (subline present + absent must both compose cleanly). Files `proof_evening_host.jpg` / `proof_evening_plain.jpg`; delete before committing.

- [ ] **Step 5: Full suite** — `python -m pytest tests/test_desk_thumbnail.py -q` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/services/desk_thumbnail.py
git commit -m "feat(desk): evening thumbnail -> city lights on water design"
```

---

### Task 4: Owner proof pack (NO PUSH)

**Files:** scratch only — `C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\50b68299-1118-48ab-9f2e-e56b84440da6\scratchpad\proofs\`

- [ ] **Step 1: Render the pack** — from the worktree root, one script that renders all three shows full-size AND a 427px-wide downscale of each (Desk-card size):

```python
import os
from PIL import Image
import io as _io
from api.services.desk_thumbnail import render_session_thumbnail

OUT = r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\50b68299-1118-48ab-9f2e-e56b84440da6\scratchpad\proofs"
os.makedirs(OUT, exist_ok=True)
CARDS = [("classic", "LIVE TRADING SESSION"),
         ("editorial", "THOUGHTS ON THE MARKET"),
         ("evening", "EVENING UPDATE FROM TSDR")]
for name, eb in CARDS:
    data = render_session_thumbnail("July 1, 2026", eyebrow_label=eb)
    open(os.path.join(OUT, f"{name}_full.jpg"), "wb").write(data)
    img = Image.open(_io.BytesIO(data))
    img.resize((427, 240), Image.LANCZOS).save(os.path.join(OUT, f"{name}_small.jpg"), quality=92)
print("proof pack done")
```

- [ ] **Step 2: Final suite** — `python -m pytest tests/test_desk_thumbnail.py tests/test_desk_zoom_webhook.py tests/test_desk_daily_session.py -q` → all PASS.

- [ ] **Step 3: STOP.** Present the proof pack to the owner. Push happens only after their approval (outside this plan).

---

## Self-Review

- **Spec coverage:** three redesign ports (Tasks 1–3) with dynamic-text + host-aware requirements embedded; output contract via `_smoke`; tests-stay-green in every task; proofs + no-push gate (Task 4); ChartMaster untouched (no task touches `_render_plate`/routing). ✔
- **Placeholders:** the mockup scripts are referenced by exact path + variant as read-only source material (they contain the working drawing code); every new test is given in full; adaptation requirements are enumerated concretely. ✔
- **Type consistency:** `_smoke(eyebrow, variant=None)` defined in Task 1, reused in Tasks 2–3; render signatures unchanged; `_grain` introduced-once-if-needed in Task 1 and consumed later. ✔
