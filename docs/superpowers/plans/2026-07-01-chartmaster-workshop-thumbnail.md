# ChartMaster Workshop Thumbnail Plate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ChartMaster workshop videos get a custom thumbnail: the owner's stormy-sea artwork plate with a per-episode gold date plaque stamped bottom-center.

**Architecture:** A fourth layout kind `"plate"` in `api/services/desk_thumbnail.py` beside classic/editorial/evening. Routing keys off the eyebrow label containing "chartmaster". The renderer cover-fits a bundled PNG plate to 1280×720 and alpha-composites a translucent date plaque; any plate-load failure falls back to the classic card so publish never breaks.

**Tech Stack:** Python, Pillow (already a dependency), pytest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-01-chartmaster-workshop-thumbnail-design.md`

## Global Constraints

- Work in worktree `C:\Users\Patrick\uct-dashboard\.worktrees\mp4fix` (branch off current master).
- ChartMaster ONLY — no general plate registry; all other shows' cards unchanged.
- Output: 1280×720 JPEG, quality 95, subsampling 0, encoded size < 2 MB.
- Plaque text = `date_text.upper()`, DejaVuSans-Bold 30px, tracking 3, fill `(251, 234, 202)`; pill fill `(0, 0, 0, 130)`, outline `(250, 212, 132)`, width 2, radius 25, 22px horizontal padding — mirrors the Evening Update pill.
- Thumbnail rendering must never raise out of `render_session_thumbnail` for a chartmaster eyebrow when the plate is missing — classic fallback instead.
- Before any push to master: `grep -c broker_sync api/main.py` must be ≥ 7 (repo-locked invariant).

---

### Task 1: Plate theme + routing

**Files:**
- Modify: `api/services/desk_thumbnail.py` (theme block, ~lines 74–109)
- Test: `tests/test_desk_thumbnail.py`

**Interfaces:**
- Produces: `_CHARTMASTER_THEME: Theme` with `layout="plate"`; `_resolve_theme(variant, eyebrow_label)` returns it for eyebrows containing `"chartmaster"` (case-insensitive) or `variant="chartmaster"`; `_THEMES["chartmaster"]` registered. Task 2 dispatches on `theme.layout == "plate"`.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_desk_thumbnail.py`:

```python
from api.services import desk_thumbnail as thumb


def test_chartmaster_eyebrow_routes_to_plate():
    assert thumb._resolve_theme(None, "WORKSHOP WITH CHARTMASTER").layout == "plate"


def test_chartmaster_variant_override_routes_to_plate():
    assert thumb._resolve_theme("chartmaster", "LIVE TRADING SESSION").layout == "plate"


def test_live_trading_still_classic():
    assert thumb._resolve_theme(None, "LIVE TRADING SESSION").layout == "classic"
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `python -m pytest tests/test_desk_thumbnail.py -q -k chartmaster`
Expected: 2 FAIL (`AssertionError: ... 'classic' == 'plate'` or similar); `test_live_trading_still_classic` passes.

- [ ] **Step 3: Implement theme + routing** — in `api/services/desk_thumbnail.py`, after the `_EVENING_THEME` block add:

```python
# "Workshop with ChartMaster" — a pre-made cinematic artwork plate (stormy sea,
# ornate gold CHARTMASTER lettering baked into the art); only the date is
# stamped per episode. ChartMaster workshops only — not a general plate system.
_CHARTMASTER_THEME = Theme(
    bg_top=(10, 20, 34),
    bg_bottom=(3, 7, 14),
    glow=_GOLD,
    wordmark=(236, 240, 246),
    eyebrow=_GOLD,
    date=(251, 234, 202),
    rule=_GOLD,
    tagline=(138, 147, 163),
    layout="plate",
)
```

Register it in `_THEMES`:

```python
_THEMES = {
    "default": _DEFAULT_THEME,
    "live": _DEFAULT_THEME,
    "thoughts": _EMERALD_THEME,
    "emerald": _EMERALD_THEME,
    "evening": _EVENING_THEME,
    "chartmaster": _CHARTMASTER_THEME,
}
```

And in `_resolve_theme`, add the check FIRST among the eyebrow checks (before "evening"):

```python
    if "chartmaster" in low:
        return _CHARTMASTER_THEME
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_desk_thumbnail.py -q`
Expected: all PASS (pre-existing tests included).

- [ ] **Step 5: Commit**

```bash
git add api/services/desk_thumbnail.py tests/test_desk_thumbnail.py
git commit -m "feat(desk): route ChartMaster workshop eyebrow to a plate thumbnail layout"
```

---

### Task 2: `_render_plate()` — cover-fit, date plaque, classic fallback

**Files:**
- Modify: `api/services/desk_thumbnail.py` (new renderer section before `render_session_thumbnail`, plus dispatch inside it)
- Test: `tests/test_desk_thumbnail.py`

**Interfaces:**
- Consumes: `_CHARTMASTER_THEME` / `layout == "plate"` from Task 1.
- Produces: module constant `_PLATE_CHARTMASTER` (absolute path to `desk_assets/chartmaster-workshop.png` — tests monkeypatch this), `_cover_fit(src: Image, size=_SIZE) -> Image`, `_render_plate(theme, date_text, eyebrow_label) -> Image` (RGB 1280×720), and the `elif theme.layout == "plate":` dispatch in `render_session_thumbnail`.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_desk_thumbnail.py`:

```python
import io
import os
import tempfile

from PIL import Image


def _fake_plate(path, size=(1280, 720)):
    Image.new("RGB", size, (10, 30, 60)).save(path, "PNG")


def test_plate_render_returns_jpeg_1280x720_under_2mb(monkeypatch, tmp_path):
    plate = str(tmp_path / "plate.png")
    _fake_plate(plate)
    monkeypatch.setattr(thumb, "_PLATE_CHARTMASTER", plate)
    data = thumb.render_session_thumbnail(
        "July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER")
    assert data[:2] == b"\xff\xd8"                      # JPEG magic
    img = Image.open(io.BytesIO(data))
    assert img.size == (1280, 720)
    assert len(data) < 2 * 1024 * 1024


def test_plate_cover_fits_non_16x9_source(monkeypatch, tmp_path):
    plate = str(tmp_path / "wide.png")
    _fake_plate(plate, size=(1886, 892))                # ~2.11:1 like the sample
    monkeypatch.setattr(thumb, "_PLATE_CHARTMASTER", plate)
    data = thumb.render_session_thumbnail(
        "July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER")
    assert Image.open(io.BytesIO(data)).size == (1280, 720)


def test_plate_missing_falls_back_to_classic(monkeypatch, tmp_path):
    monkeypatch.setattr(thumb, "_PLATE_CHARTMASTER", str(tmp_path / "nope.png"))
    data = thumb.render_session_thumbnail(
        "July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER")
    classic = thumb.render_session_thumbnail(
        "July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER",
        variant="default")
    assert data == classic                              # deterministic Pillow output
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_desk_thumbnail.py -q -k plate`
Expected: 3 FAIL (`AttributeError: ... has no attribute '_PLATE_CHARTMASTER'`).

- [ ] **Step 3: Implement the renderer** — in `api/services/desk_thumbnail.py` add a new section after `_render_evening` (before `render_session_thumbnail`):

```python
# ---------------------------------------------------------------------------
# Plate (Workshop with ChartMaster) — pre-made artwork + stamped date plaque
# ---------------------------------------------------------------------------

_PLATE_CHARTMASTER = os.path.join(_ASSETS, "chartmaster-workshop.png")

# Plaque center-y: inside the calm-water band the artwork reserves in its
# bottom 15%. Tuned visually against the real plate; keep in sync with the
# authoring brief in the design spec.
_PLATE_DATE_CY = 645


def _cover_fit(src: Image.Image, size: tuple = _SIZE) -> Image.Image:
    """Scale to cover `size`, center-crop the overflow (safety net — the
    plate is authored at 16:9, so normally this is a pure resize)."""
    w, h = src.size
    W, H = size
    scale = max(W / w, H / h)
    nw, nh = max(W, int(round(w * scale))), max(H, int(round(h * scale)))
    src = src.resize((nw, nh), Image.LANCZOS)
    x, y = (nw - W) // 2, (nh - H) // 2
    return src.crop((x, y, x + W, y + H))


def _render_plate(theme: Theme, date_text: str, eyebrow_label: str) -> Image.Image:
    try:
        plate = Image.open(_PLATE_CHARTMASTER).convert("RGBA")
    except Exception:
        # Never break a publish over a missing/corrupt plate asset.
        return _render_classic(_DEFAULT_THEME, date_text, eyebrow_label)
    img = _cover_fit(plate)
    cx = _W // 2

    # Date plaque — same treatment as the Evening Update pill. Drawn on its
    # own RGBA layer + alpha_composite so the translucent fill actually
    # blends over the artwork.
    df = _font("DejaVuSans-Bold.ttf", 30)
    dt = date_text.upper()
    measure = ImageDraw.Draw(img)
    dw = _tracked_w(measure, dt, df, 3)
    pill = Image.new("RGBA", _SIZE, (0, 0, 0, 0))
    ImageDraw.Draw(pill).rounded_rectangle(
        [cx - dw / 2 - 22, _PLATE_DATE_CY - 25, cx + dw / 2 + 22, _PLATE_DATE_CY + 25],
        radius=25, fill=(0, 0, 0, 130), outline=(250, 212, 132, 255), width=2)
    img = Image.alpha_composite(img, pill)
    _draw_tracked_center(ImageDraw.Draw(img), cx, _PLATE_DATE_CY - 15, dt, df,
                         theme.date, 3)
    return img.convert("RGB")
```

And in `render_session_thumbnail`, extend the dispatch:

```python
    if theme.layout == "evening":
        img = _render_evening(theme, date_text, eyebrow_label)
    elif theme.layout == "editorial":
        img = _render_editorial(theme, date_text, eyebrow_label)
    elif theme.layout == "plate":
        img = _render_plate(theme, date_text, eyebrow_label)
    else:
        img = _render_classic(theme, date_text, eyebrow_label)
```

- [ ] **Step 4: Run the full thumbnail suite**

Run: `python -m pytest tests/test_desk_thumbnail.py -q`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/desk_thumbnail.py tests/test_desk_thumbnail.py
git commit -m "feat(desk): ChartMaster plate renderer — cover-fit artwork + gold date plaque, classic fallback"
```

---

### Task 3: Bundle the real artwork plate + visual tune (BLOCKED on owner artwork)

**Files:**
- Create: `api/services/desk_assets/chartmaster-workshop.png`
- Possibly modify: `api/services/desk_thumbnail.py` (`_PLATE_DATE_CY` only)

**Interfaces:**
- Consumes: `_PLATE_CHARTMASTER` path + `_PLATE_DATE_CY` from Task 2.
- Produces: the bundled plate asset the production renderer loads.

**Blocked until:** the owner delivers the regenerated 16:9 artwork (1280×720 or 2560×1440; bottom ~15% center kept as calm dark water — see spec authoring brief). Ask for the file path.

- [ ] **Step 1: Normalize + bundle the asset** (adjust `SRC` to the delivered path):

```python
# scratch script — run from the worktree root
from PIL import Image
SRC = r"C:\Users\Patrick\Downloads\chartmaster-plate.png"   # <- delivered file
img = Image.open(SRC).convert("RGB")
if img.size != (1280, 720):
    from api.services.desk_thumbnail import _cover_fit
    img = _cover_fit(img.convert("RGBA")).convert("RGB")
img.save(r"api\services\desk_assets\chartmaster-workshop.png", "PNG")
```

- [ ] **Step 2: Render a proof and inspect it visually**

```python
from api.services.desk_thumbnail import render_session_thumbnail
open(r"..\..\..\proof_chartmaster.jpg", "wb").write(
    render_session_thumbnail("July 1, 2026", eyebrow_label="WORKSHOP WITH CHARTMASTER"))
```

View `proof_chartmaster.jpg`. Check: plaque sits in calm water, doesn't clip CHARTMASTER lettering, date legible when the image is scaled down to ~320px wide (Desk card size).

- [ ] **Step 3: Tune `_PLATE_DATE_CY` if needed** — adjust the constant (spec allows 610–720 band), re-render the proof, re-inspect. Show the proof to the owner for sign-off before shipping.

- [ ] **Step 4: Run the full thumbnail suite**

Run: `python -m pytest tests/test_desk_thumbnail.py -q`
Expected: all PASS (unit tests use synthetic plates and are unaffected by the real asset).

- [ ] **Step 5: Commit**

```bash
git add api/services/desk_assets/chartmaster-workshop.png api/services/desk_thumbnail.py
git commit -m "feat(desk): bundle ChartMaster workshop artwork plate"
```

---

### Task 4: Ship — full test pass, invariant check, push, deploy watch

**Files:** none new — verification + push.

- [ ] **Step 1: Run the desk pipeline suites**

Run: `python -m pytest tests/test_desk_thumbnail.py tests/test_desk_zoom_webhook.py tests/test_desk_daily_session.py -q`
Expected: all PASS.

- [ ] **Step 2: Repo invariant check before pushing master**

Run: `grep -c broker_sync api/main.py`
Expected: ≥ 7.

- [ ] **Step 3: Rebase on latest master + push**

```bash
git fetch origin master
git rebase origin/master
git push origin HEAD:master
```

- [ ] **Step 4: Watch the Railway deploy to SUCCESS**

Run: `railway deployment list --service web --json` (poll ~40s) until the thumbnail commit shows `SUCCESS`.

---

### Task 5: Backfill tonight's video thumbnail (`-XhibOL_5Fw`)

**Files:** scratch script only (scratchpad, not committed).

**Interfaces:**
- Consumes: shipped `render_session_thumbnail` + `YouTubeClient.set_thumbnail(video_id: str, image_bytes: bytes)` (`api/services/youtube_client.py:103`).

- [ ] **Step 1: Run the one-shot locally with prod YT creds** (from the worktree root; env pulled from Railway):

```python
# scratch script — set YT_OAUTH_CLIENT_ID / YT_OAUTH_CLIENT_SECRET /
# YT_OAUTH_REFRESH_TOKEN from `railway variables --service web --json` first
from api.services.desk_thumbnail import render_session_thumbnail
from api.services.youtube_client import YouTubeClient
jpeg = render_session_thumbnail("July 1, 2026",
                                eyebrow_label="WORKSHOP WITH CHARTMASTER")
YouTubeClient().set_thumbnail("-XhibOL_5Fw", jpeg)
print("thumbnail set OK")
```

Expected: `thumbnail set OK` (any HTTP error raises).

- [ ] **Step 2: Verify on YouTube** — fetch `https://img.youtube.com/vi/-XhibOL_5Fw/hqdefault.jpg` (cache may lag a few minutes) or open the watch page; confirm the stormy-sea plate with the `JULY 1, 2026` plaque. Confirm the Desk card at `/desk?section=videos` shows it.

---

## Self-Review

- **Spec coverage:** routing (Task 1), renderer + plaque + cover-fit + fallback + <2MB (Task 2), asset bundling + authoring-brief handoff + visual tune (Task 3), tests (Tasks 1–2), backfill of `-XhibOL_5Fw` (Task 5). Ship path + repo invariant (Task 4). ✔
- **Placeholders:** none — every code step contains full code; Task 3's `SRC` path is an explicit runtime input from the owner, called out as such. ✔
- **Type consistency:** `_PLATE_CHARTMASTER` (str path), `_render_plate(theme, date_text, eyebrow_label) -> Image`, `layout="plate"`, `set_thumbnail(video_id, image_bytes)` consistent across tasks. ✔
