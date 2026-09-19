# Vendor Parity Capture Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the manual, ad-hoc TradingView-vs-ours screenshot comparison (done by hand this
session for Uncharted Clouds) into a fast, repeatable tool — while keeping the TradingView side
100% human-driven, never automated.

**Architecture:** A human opens and authenticates the TradingView chart themselves, same as
today — that never changes. `tools/vendor_parity_capture.py` automates everything else: it
drives OUR OWN side via a reusable, parameterized version of the existing
`pine_member_pane_capture.py` Playwright flow, takes the human-provided TradingView screenshot
and crop box, runs a perceptual (SSIM) comparison instead of exact-pixel diffing, and writes a
dated report with a threshold-based review flag.

**Tech Stack:** Python, Playwright (sync API, already used elsewhere in this repo), Pillow
(already a dependency), scikit-image (new dependency, added in Task 1), pytest.

**Spec:** `docs/superpowers/specs/universal-indicator-ecosystem/RENDERING_PARITY_VERIFICATION_PROGRAM.md`
(§4.3, §5, §6 OD2) — read both this plan and that spec; the plan implements exactly §4.3.

## Global Constraints

- **The tool NEVER logs into, screenshots, or otherwise automates TradingView.** A human has
  already opened and authenticated that chart before this tool is invoked. No password, cookie,
  or session token for TradingView is ever read, stored, or handled by any code in this plan.
  (Spec §2 NG1 — an explicit owner ruling, not a preference.)
- **No password is typed into a page, anywhere in this plan**, including our own side — sign-in
  reuses the existing `page.request.post` API-call pattern from `pine_member_pane_capture.py`
  against a local sandbox account, never a form field.
- Every new script gets its own test file (this repo's near-universal pattern).
- Every comparator ships with BOTH a determinism check (identical input scores as identical) and
  a non-vacuity check (genuinely different input scores as different) — mirroring
  `chart_parity.py`'s own `--same-build` / `--perturb-b` pair. A check that cannot fail is not a
  check.
- New Python dependency this plan introduces: `scikit-image` (Task 1) — called out explicitly,
  never added silently.

---

### Task 1: Add scikit-image dependency

**Files:**
- Modify: `requirements.txt:62` (insert directly after the `Pillow>=10.0.0` line)

**Interfaces:**
- Produces: `skimage.metrics.structural_similarity` becomes importable for Task 3.

- [ ] **Step 1: Add the dependency line**

In `requirements.txt`, immediately after line 62 (`Pillow>=10.0.0`), insert:

```
scikit-image>=0.22.0    # perceptual (SSIM) comparison for vendor-parity capture — see
                        # tools/vendor_parity_capture.py; chart_parity.py's exact-pixel
                        # diff() is the wrong tool for cross-platform comparison (different
                        # fonts/AA/compression make two vendors' renders of the same data
                        # never near-pixel-identical)
```

- [ ] **Step 2: Install and verify import**

Run: `pip install -r requirements.txt`
Then: `python -c "from skimage.metrics import structural_similarity; print('ok')"`
Expected: prints `ok` with no import error.

- [ ] **Step 3: Commit**

```bash
git add requirements.txt
git commit -m "deps: add scikit-image for vendor-parity perceptual comparison"
```

---

### Task 2: Extract a reusable, parameterized capture function from `pine_member_pane_capture.py`

**Why this task exists:** `pine_member_pane_capture.py` today is a single hardcoded script — the
fixture path (`uncharted-clouds.pine`), the output filename (`member-door-clouds-...`), and the
three-tier phone/tablet/desktop sweep are all baked in. `vendor_parity_capture.py` (Task 5) needs
the SAME proven capture technique (its own Playwright page/viewport, immune to the OS-occlusion
class documented in `capture-procedure.md`, API-based sign-in, sha256-verified paste) but for an
ARBITRARY corpus script, at a SINGLE desktop viewport (matching what a human sees on TradingView
desktop — the 3-tier sweep is a different concern this task does not touch). Reuse the logic by
extracting it into a function both scripts import, rather than copy-pasting ~150 lines.

**Files:**
- Modify: `tools/pine_member_pane_capture.py` (extract `capture_member_pane()`, keep the
  existing CLI/`main()` behavior byte-identical via a thin wrapper)
- Test: `tools/test_pine_member_pane_capture.py` (new — this file has no test today; add one
  covering the extraction, not full Playwright coverage)

**Interfaces:**
- Produces: `capture_member_pane(base: str, script_path: pathlib.Path, out_dir: pathlib.Path, tag: str, slug: str, viewport: tuple[int, int] = (1440, 900)) -> dict`
  — returns `{"ok": bool, "shot": Path | None, "plots": int, "fills": int, "hidden": int, "reason": str | None}`.
  `slug` names the output file (`member-door-{slug}-{tag}.png`), decoupling filename from the
  literal indicator name the way `--tag` already decouples the date.

- [ ] **Step 1: Write the failing test for the extracted signature**

```python
# tools/test_pine_member_pane_capture.py
import pathlib
import pine_member_pane_capture as pmpc


def test_capture_member_pane_is_importable_with_expected_signature():
    import inspect
    sig = inspect.signature(pmpc.capture_member_pane)
    assert list(sig.parameters) == ["base", "script_path", "out_dir", "tag", "slug", "viewport"]
    assert sig.parameters["viewport"].default == (1440, 900)


def test_main_still_uses_the_uncharted_clouds_fixture_by_default():
    # backward-compat: the original CLI's behavior must not change silently.
    assert pmpc.FIXTURE.name == "uncharted-clouds.pine"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tools/test_pine_member_pane_capture.py -v`
Expected: FAIL — `capture_member_pane` does not exist yet.

- [ ] **Step 3: Extract the function**

In `tools/pine_member_pane_capture.py`, replace the body of `main()` from the `with sync_playwright() as p:` line through the `for name, w, h in TIERS:` loop's single-tier desktop-only use with a new top-level function, and have `main()` call it in a loop for backward compatibility. Concretely:

```python
def capture_member_pane(base: str, script_path: pathlib.Path, out_dir: pathlib.Path,
                         tag: str, slug: str, viewport: tuple[int, int] = (1440, 900)) -> dict:
    """Attach `script_path` as a member-pane definition on `base` and screenshot it
    at `viewport`. Returns {"ok", "shot", "plots", "fills", "hidden", "reason"}.
    Never types a password into a page — sign-in is an API call against a local
    sandbox account. Never reaches TradingView."""
    from playwright.sync_api import sync_playwright

    raw = script_path.read_bytes()
    want = sha16(raw)
    SERVED_DIR.mkdir(parents=True, exist_ok=True)
    served = SERVED_DIR / SERVED_NAME
    shutil.copyfile(script_path, served)
    print(f"[capture] fixture {script_path.name}: {len(raw)} bytes, sha256 {want}...")

    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            ctx = browser.new_context(viewport={"width": viewport[0], "height": viewport[1]})
            page = ctx.new_page()

            r = page.request.post(f"{base}/api/auth/login", data=SIGN_IN)
            if not r.ok:
                return {"ok": False, "shot": None, "reason": f"sign-in {r.status}"}

            page.goto(f"{base}/charts", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            _gate(page, "open-the-door")

            opened = page.evaluate(OPEN_DOOR_JS)
            if not opened.get("importTab"):
                return {"ok": False, "shot": None, "reason": f"no Import tab: {opened}"}

            page.wait_for_timeout(1500)
            paste = page.evaluate(PASTE_JS, f"/assets/{SERVED_NAME}")
            if paste.get("sha") != want:
                return {"ok": False, "shot": None,
                        "reason": f"textarea sha {paste.get('sha')} != file sha {want}"}

            try:
                page.wait_for_function(READY_JS, timeout=20000)
            except Exception:
                return {"ok": False, "shot": None, "reason": "attach door never appeared"}

            attached = page.evaluate(ATTACH_JS)
            if not attached.get("ok"):
                return {"ok": False, "shot": None, "reason": f"attach failed: {attached}"}

            state = _gate(page, "final screenshot")
            if state["w"] != viewport[0]:
                return {"ok": False, "shot": None,
                        "reason": f"asked for width {viewport[0]}, page reports {state['w']}"}

            shot = out_dir / f"member-door-{slug}-{tag}.png"
            page.screenshot(path=str(shot))
            ctx.close()
            browser.close()
            return {"ok": True, "shot": shot, "plots": attached["plots"],
                     "fills": attached["fills"], "hidden": attached["hidden"], "reason": None}
    finally:
        served.unlink(missing_ok=True)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://127.0.0.1:8131")
    ap.add_argument("--out", default="docs/pine/capture")
    ap.add_argument("--tag", default=time.strftime("%Y-%m-%d"))
    ap.add_argument("--self-check", action="store_true",
                     help="prove the gate can fail: shoot from a hidden page")
    args = ap.parse_args()

    out_dir = (REPO / args.out) if not pathlib.Path(args.out).is_absolute() else pathlib.Path(args.out)

    if args.self_check:
        return _run_self_check(args.base)

    results = []
    for name, w, h in TIERS:
        r = capture_member_pane(args.base, FIXTURE, out_dir, args.tag, f"clouds-{name}", (w, h))
        if not r["ok"]:
            print(f"[capture] {name}: MEASURED FAILURE: {r['reason']}")
            return 1
        print(f"[capture] {name}: wrote {r['shot'].relative_to(REPO)} "
              f"plots={r['plots']} fills={r['fills']} hidden={r['hidden']}")
        results.append({"tier": name, **r, "shot": r["shot"].name})

    print(json.dumps({"captured": results}, indent=1))
    return 0 if len(results) == len(TIERS) else 2
```

Move the existing `--self-check` branch (lines 195-212 of the original file) into a
`_run_self_check(base: str) -> int` function unchanged in logic, just relocated so `main()`
stays short. Keep `_gate`, `sha16`, `OPEN_DOOR_JS`, `PASTE_JS`, `ATTACH_JS`, `READY_JS`,
`FIXTURE`, `SERVED_NAME`, `SERVED_DIR`, `TIERS`, `SIGN_IN` exactly as they are — Task 5 imports
several of these directly.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tools/test_pine_member_pane_capture.py -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Manually verify the original CLI still behaves identically**

Run the exact command from the module's own docstring (requires the rig up per
`docs/pine/wip/rig/boot_rig.py`):
```
python tools/pine_member_pane_capture.py --base http://127.0.0.1:8131 --out docs/pine/capture --tag verify-refactor
```
Expected: same three files written (`member-door-clouds-phone-verify-refactor.png`, etc.), same
console output shape as before the refactor. Delete the verification output afterward — it is
not a real dated capture.

- [ ] **Step 6: Commit**

```bash
git add tools/pine_member_pane_capture.py tools/test_pine_member_pane_capture.py
git commit -m "refactor: extract capture_member_pane() for reuse by vendor_parity_capture.py"
```

---

### Task 3: SSIM comparison function with determinism + non-vacuity checks

**Files:**
- Create: `tools/vendor_parity_capture.py` (this task writes only the comparator; Tasks 4-6 add
  to the same file)
- Test: `tools/test_vendor_parity_capture.py`

**Interfaces:**
- Consumes: `PIL.Image` objects (already a dependency).
- Produces: `compare(a_path: Path, b_path: Path) -> dict` returning
  `{"score": float, "a_size": [w, h], "b_size": [w, h], "size_mismatch": bool}`.
  `score` is in `[-1.0, 1.0]`, 1.0 = identical structure. Later tasks consume `score` and
  `size_mismatch`.

- [ ] **Step 1: Write the failing tests**

```python
# tools/test_vendor_parity_capture.py
import pathlib
import tempfile
from PIL import Image, ImageDraw
import vendor_parity_capture as vpc


def _make_image(path, fill, shape="rect"):
    img = Image.new("RGB", (200, 200), color=(20, 20, 20))
    d = ImageDraw.Draw(img)
    if shape == "rect":
        d.rectangle((40, 40, 160, 160), fill=fill)
    else:
        d.ellipse((40, 40, 160, 160), fill=fill)
    img.save(path)


def test_identical_images_score_near_one():
    with tempfile.TemporaryDirectory() as d:
        p = pathlib.Path(d) / "a.png"
        _make_image(p, (0, 200, 180))
        result = vpc.compare(p, p)
        assert result["score"] > 0.999
        assert result["size_mismatch"] is False


def test_genuinely_different_images_score_meaningfully_lower():
    # non-vacuity control: a comparator that can't tell these two images apart
    # is not a comparator. One is a solid teal rectangle; the other is a solid
    # magenta ellipse on the same canvas — different color AND different shape.
    with tempfile.TemporaryDirectory() as d:
        a = pathlib.Path(d) / "a.png"
        b = pathlib.Path(d) / "b.png"
        _make_image(a, (0, 200, 180), shape="rect")
        _make_image(b, (200, 0, 150), shape="ellipse")
        result = vpc.compare(a, b)
        assert result["score"] < 0.85, (
            f"comparator did not distinguish genuinely different images: {result['score']}")


def test_size_mismatch_is_reported_not_silently_resized():
    with tempfile.TemporaryDirectory() as d:
        a = pathlib.Path(d) / "a.png"
        b = pathlib.Path(d) / "b.png"
        Image.new("RGB", (200, 200)).save(a)
        Image.new("RGB", (300, 250)).save(b)
        result = vpc.compare(a, b)
        assert result["size_mismatch"] is True
        assert result["score"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tools/test_vendor_parity_capture.py -v`
Expected: FAIL — `vendor_parity_capture` module does not exist yet.

- [ ] **Step 3: Write the comparator**

```python
# tools/vendor_parity_capture.py
"""Compare our own rendering of a Pine indicator against a human-provided
TradingView screenshot. The TradingView side is NEVER automated — a human has
already opened and authenticated that chart before this tool runs; see the
module-level docstring further down and spec §2 NG1
(docs/superpowers/specs/universal-indicator-ecosystem/RENDERING_PARITY_VERIFICATION_PROGRAM.md).

Uses SSIM (structural similarity), not chart_parity.py's exact-pixel diff() —
two renders of the same data on two different platforms (different fonts, AA,
DPI, JPEG compression, watermarks) are never near-pixel-identical, and an
exact-pixel comparator would report ~100% "changed" on every real pair. SSIM
compares local structure (luminance/contrast/structure windows) instead of
per-pixel bytes, so it tolerates that class of rendering noise while still
catching a genuinely different shape or color family.
"""
from __future__ import annotations

import pathlib

from PIL import Image
from skimage.metrics import structural_similarity
import numpy as np


def compare(a_path: pathlib.Path, b_path: pathlib.Path) -> dict:
    """Perceptual comparison. Returns {"score", "a_size", "b_size", "size_mismatch"}.

    A size mismatch is reported, never silently resized past — resizing one
    image to match the other changes what's being measured and would hide
    exactly the "the two builds framed the chart differently" class of
    problem chart_parity.py's own diff() refuses to paper over.
    """
    a = Image.open(a_path).convert("RGB")
    b = Image.open(b_path).convert("RGB")
    if a.size != b.size:
        return {"score": None, "a_size": list(a.size), "b_size": list(b.size),
                 "size_mismatch": True}

    a_arr = np.asarray(a)
    b_arr = np.asarray(b)
    # channel_axis=-1, never a greyscale conversion first: chart_parity.py's own
    # diff() documents a real incident where luma-weighted greyscale hid a
    # whole-canvas color change because blue only weighs 0.114 in that
    # formula. SSIM's multichannel mode compares each channel's structure
    # rather than collapsing to one luminance value first.
    score = structural_similarity(a_arr, b_arr, channel_axis=-1)
    return {"score": float(score), "a_size": list(a.size), "b_size": list(b.size),
             "size_mismatch": False}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tools/test_vendor_parity_capture.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/vendor_parity_capture.py tools/test_vendor_parity_capture.py
git commit -m "feat: SSIM-based perceptual comparator for vendor-parity capture"
```

---

### Task 4: Threshold-based flagging

**Why a threshold, not pass/fail:** per spec §4.3, a comparator that auto-fails on ordinary
vendor-rendering noise (font anti-aliasing, JPEG compression) gets ignored within a week; the
result needs a human-reviewable flag, not a hard gate. The default threshold below is a starting
point, not a calibrated constant — say so in the code, because pretending otherwise would be
false precision (no real vendor-pair SSIM data exists yet to calibrate against).

**Files:**
- Modify: `tools/vendor_parity_capture.py` (add `verdict()`)
- Test: `tools/test_vendor_parity_capture.py` (append)

**Interfaces:**
- Consumes: `compare()`'s return dict (Task 3).
- Produces: `verdict(compare_result: dict, threshold: float = 0.80) -> str` — one of
  `"NEEDS_REVIEW"`, `"OK"`, `"SIZE_MISMATCH"`. Task 6's report writer consumes this.

- [ ] **Step 1: Write the failing tests**

```python
def test_verdict_flags_low_score_for_review():
    assert vpc.verdict({"score": 0.5, "size_mismatch": False}) == "NEEDS_REVIEW"


def test_verdict_passes_high_score():
    assert vpc.verdict({"score": 0.95, "size_mismatch": False}) == "OK"


def test_verdict_reports_size_mismatch_before_looking_at_score():
    assert vpc.verdict({"score": None, "size_mismatch": True}) == "SIZE_MISMATCH"


def test_verdict_threshold_is_overridable():
    assert vpc.verdict({"score": 0.82, "size_mismatch": False}, threshold=0.90) == "NEEDS_REVIEW"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tools/test_vendor_parity_capture.py -v -k verdict`
Expected: FAIL — `verdict` does not exist yet.

- [ ] **Step 3: Implement**

Append to `tools/vendor_parity_capture.py`:

```python
#: Starting point, not a calibrated constant. No real vendor-pair SSIM
#: measurements exist yet — recalibrate once the first several real
#: comparisons have been run and a human has judged whether each one
#: "looked right." Override with --threshold; the CLI (Task 6) requires a
#: stated reason when overriding, mirroring chart_parity.py's own
#: --tolerance/--tolerance-reason pairing.
DEFAULT_THRESHOLD = 0.80


def verdict(compare_result: dict, threshold: float = DEFAULT_THRESHOLD) -> str:
    if compare_result["size_mismatch"]:
        return "SIZE_MISMATCH"
    return "OK" if compare_result["score"] >= threshold else "NEEDS_REVIEW"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tools/test_vendor_parity_capture.py -v -k verdict`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add tools/vendor_parity_capture.py tools/test_vendor_parity_capture.py
git commit -m "feat: threshold-based NEEDS_REVIEW/OK/SIZE_MISMATCH verdict"
```

---

### Task 5: Report writer

**Files:**
- Modify: `tools/vendor_parity_capture.py` (add `write_report()`)
- Test: `tools/test_vendor_parity_capture.py` (append)

**Interfaces:**
- Consumes: `compare()`'s dict, `verdict()`'s string, image paths, `slug`, `tag`.
- Produces: writes two files (`.md`, `.json`) to `out_dir`; returns
  `{"md": Path, "json": Path}`.

- [ ] **Step 1: Write the failing test**

```python
import json


def test_write_report_creates_md_and_json_with_expected_naming(tmp_path):
    a = tmp_path / "member.png"
    b = tmp_path / "vendor.png"
    Image.new("RGB", (100, 100)).save(a)
    Image.new("RGB", (100, 100)).save(b)
    result = vpc.compare(a, b)
    v = vpc.verdict(result)

    paths = vpc.write_report(
        out_dir=tmp_path, slug="test-indicator", tag="2026-09-19",
        member_shot=a, vendor_shot=b, compare_result=result, verdict_str=v,
    )

    assert paths["md"].name == "parity-report-test-indicator-2026-09-19.md"
    assert paths["json"].name == "parity-report-test-indicator-2026-09-19.json"
    assert paths["md"].exists() and paths["json"].exists()

    data = json.loads(paths["json"].read_text())
    assert data["verdict"] == v
    assert data["score"] == result["score"]
    assert "test-indicator" in paths["md"].read_text()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tools/test_vendor_parity_capture.py -v -k write_report`
Expected: FAIL — `write_report` does not exist yet.

- [ ] **Step 3: Implement**

Append to `tools/vendor_parity_capture.py`:

```python
import json as _json
import time as _time


def write_report(out_dir: pathlib.Path, slug: str, tag: str, member_shot: pathlib.Path,
                  vendor_shot: pathlib.Path, compare_result: dict, verdict_str: str) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"parity-report-{slug}-{tag}"
    md_path = out_dir / f"{stem}.md"
    json_path = out_dir / f"{stem}.json"

    record = {
        "slug": slug, "tag": tag, "generated_at": _time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "member_shot": str(member_shot), "vendor_shot": str(vendor_shot),
        "score": compare_result["score"], "size_mismatch": compare_result["size_mismatch"],
        "verdict": verdict_str,
    }
    json_path.write_text(_json.dumps(record, indent=2))

    md_path.write_text(
        f"# Vendor parity report — {slug} ({tag})\n\n"
        f"**Verdict:** {verdict_str}\n"
        f"**SSIM score:** {compare_result['score']!r}\n"
        f"**Member shot:** `{member_shot}`\n"
        f"**Vendor shot:** `{vendor_shot}`\n\n"
        f"{'⚠️ Needs human review — score below threshold.' if verdict_str == 'NEEDS_REVIEW' else ''}"
        f"{'⛔ Size mismatch — the two captures are not directly comparable.' if verdict_str == 'SIZE_MISMATCH' else ''}\n"
    )
    return {"md": md_path, "json": json_path}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tools/test_vendor_parity_capture.py -v -k write_report`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tools/vendor_parity_capture.py tools/test_vendor_parity_capture.py
git commit -m "feat: dated markdown+JSON report writer for vendor-parity capture"
```

---

### Task 6: CLI orchestration entrypoint

**Files:**
- Modify: `tools/vendor_parity_capture.py` (add `main()`)
- Test: `tools/test_vendor_parity_capture.py` (append — CLI argument wiring only; the
  Playwright-driving path is exercised manually per Step 5 below, not under pytest, matching
  `pine_member_pane_capture.py`'s own test-free precedent for its Playwright path)

**Interfaces:**
- Consumes: `capture_member_pane()` (Task 2, imported from `pine_member_pane_capture`),
  `compare()`, `verdict()`, `write_report()` (this file).
- Produces: process exit code — `0` OK, `1` NEEDS_REVIEW or SIZE_MISMATCH (a MEASURED result
  needing a human look, not a crash), `2` INCONCLUSIVE (capture itself failed), matching the
  three-exit-code convention `pine_member_pane_capture.py` already established.

- [ ] **Step 1: Write the failing test for argument wiring**

```python
def test_main_requires_vendor_screenshot_argument(capsys):
    import sys
    old_argv = sys.argv
    sys.argv = ["vendor_parity_capture.py", "--script", "x.pine", "--slug", "x"]
    try:
        raised = False
        try:
            vpc.main()
        except SystemExit:
            raised = True
        assert raised, "argparse should reject a missing required --vendor-screenshot"
    finally:
        sys.argv = old_argv
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tools/test_vendor_parity_capture.py -v -k main_requires`
Expected: FAIL — `main` does not exist yet.

- [ ] **Step 3: Implement**

Append to `tools/vendor_parity_capture.py`:

```python
import argparse
import sys

import pine_member_pane_capture as pmpc


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default="http://127.0.0.1:8131",
                     help="the local member-pane rig (see docs/pine/wip/rig/boot_rig.py)")
    ap.add_argument("--script", required=True, type=pathlib.Path,
                     help="path to the .pine fixture to attach on our own side")
    ap.add_argument("--slug", required=True,
                     help="short name for output files, e.g. 'rsi-divergence'")
    ap.add_argument("--vendor-screenshot", required=True, type=pathlib.Path,
                     help="path to the ALREADY-CAPTURED TradingView screenshot — a human "
                          "must produce this; this tool never opens or logs into TradingView")
    ap.add_argument("--out", default="docs/pine/capture", type=pathlib.Path)
    ap.add_argument("--tag", default=_time.strftime("%Y-%m-%d"))
    ap.add_argument("--threshold", type=float, default=DEFAULT_THRESHOLD)
    ap.add_argument("--threshold-reason", default="",
                     help="REQUIRED when --threshold differs from the default; printed in "
                          "the report, mirroring chart_parity.py's --tolerance-reason")
    args = ap.parse_args()

    if args.threshold != DEFAULT_THRESHOLD and not args.threshold_reason:
        ap.error("--threshold-reason is required when --threshold overrides the default")

    if not args.vendor_screenshot.exists():
        print(f"[vendor-parity] INCONCLUSIVE: vendor screenshot not found: "
              f"{args.vendor_screenshot}")
        return 2

    captured = pmpc.capture_member_pane(
        base=args.base, script_path=args.script, out_dir=args.out,
        tag=args.tag, slug=args.slug,
    )
    if not captured["ok"]:
        print(f"[vendor-parity] INCONCLUSIVE: member-side capture failed: {captured['reason']}")
        return 2

    result = compare(captured["shot"], args.vendor_screenshot)
    v = verdict(result, threshold=args.threshold)
    paths = write_report(
        out_dir=args.out, slug=args.slug, tag=args.tag,
        member_shot=captured["shot"], vendor_shot=args.vendor_screenshot,
        compare_result=result, verdict_str=v,
    )
    print(f"[vendor-parity] {v} — score={result['score']!r} — report: {paths['md']}")
    return 0 if v == "OK" else 1


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tools/test_vendor_parity_capture.py -v -k main_requires`
Expected: PASS.

- [ ] **Step 5: One real end-to-end run (manual, not pytest)**

This is the one step in this plan that genuinely requires a human at the keyboard — the
TradingView half cannot be scripted (Global Constraints, above). With the rig up
(`docs/pine/wip/rig/boot_rig.py`) and a human-captured TradingView screenshot of any corpus
script already saved to disk:

```
python tools/vendor_parity_capture.py \
    --base http://127.0.0.1:8131 \
    --script tools/c0_oos_fixtures/high_engagement__10-rsi-divergence-faytterro.pine \
    --slug rsi-divergence \
    --vendor-screenshot <path to the human-captured TradingView PNG/JPG> \
    --tag verify-e2e
```

Expected: prints a verdict line, writes `parity-report-rsi-divergence-verify-e2e.md`/`.json` to
`docs/pine/capture/`. Read the `.md` file and confirm the score is a plausible SSIM value
(strictly between -1.0 and 1.0) and the verdict matches what the two images actually look like.
Delete the verification output afterward — it is not a real dated capture.

- [ ] **Step 6: Run the full test suite for this file**

Run: `python -m pytest tools/test_vendor_parity_capture.py tools/test_pine_member_pane_capture.py -v`
Expected: PASS, all tests (11 total across both files).

- [ ] **Step 7: Commit**

```bash
git add tools/vendor_parity_capture.py tools/test_vendor_parity_capture.py
git commit -m "feat: CLI entrypoint tying vendor-parity capture, compare, and report together"
```

---

## Plan self-review

**Spec coverage:** §4.3's five bullet points are each covered — Playwright reuse (Task 2),
human-provided screenshot input (Task 6's `--vendor-screenshot`), structural/perceptual
comparison via scikit-image (Tasks 1, 3), threshold-based flagging not hard pass/fail (Task 4),
dated report to `docs/pine/capture/` (Task 5). §5's testing strategy requirements — determinism
check, non-vacuity check — are both in Task 3. §6 OD2 (scikit-image vs hand-rolled SSIM) is
resolved in Task 1 per the spec's own recommendation.

**Placeholder scan:** no TBD/TODO; every step has real code; the one manual step (Task 6 Step 5)
is manual by necessity (Global Constraints) and is written as exact commands + exact expected
output, not "verify it works."

**Type consistency:** `capture_member_pane()`'s return dict shape
(`ok`/`shot`/`plots`/`fills`/`hidden`/`reason`) is defined once in Task 2 and consumed
identically in Task 6. `compare()`'s return shape (`score`/`a_size`/`b_size`/`size_mismatch`) is
defined in Task 3 and consumed identically by `verdict()` (Task 4) and `write_report()`
(Task 5). `slug`/`tag` parameter names are consistent across all six tasks.
