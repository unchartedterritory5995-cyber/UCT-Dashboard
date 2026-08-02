"""Chart parity gate — deterministic per-indicator screenshot diff.

Phase B's indicator migration is gated on "Flip A": a migrated indicator must
render into the same legacy bands, so the chart must be **pixel-identical**
before and after. This is the thing that measures that.

It drives the headless ``/r/chart`` route (``app/src/pages/ChartRender.jsx``)
twice — once per build — waits for ``window.__chartReady``, screenshots the
``#chart-export`` ELEMENT (not the page), and diffs the two PNGs with Pillow.

Why this and not ``tools/mobile_audit.py``: that harness screenshots whole pages
after a 2.5s wall-clock settle against LIVE streaming bars, and never compares
two images. Two runs of it differ because the tape moved. The determinism here
comes from three things, and all three are load-bearing:

  * ``?fixedbars=`` renders a committed bar fixture through StockChart's
    ``barsOverride`` seam — no SWR, no IndexedDB, no delta merge.
  * that mode also goes hermetic (every ``/api/`` call short-circuits), so no
    live setting, ticker name or preference can leak into a baseline.
  * the export footer's wall-clock stamp is frozen — it is the only dynamic
    element inside ``#chart-export``.

Usage
-----
Start a frontend (a bare ``vite dev`` is enough — hermetic mode needs no
backend)::

    cd app && npm run dev            # http://localhost:5173

**Determinism self-check** (same build twice — must report 0 changed pixels)::

    python tools/chart_parity.py --base-a http://localhost:5173

**Prove the gate can fail** (one hex digit on one indicator's colour)::

    python tools/chart_parity.py --base-a http://localhost:5173 \
        --cases rsi_only \
        --perturb-b '{"indicators": {"rsi": {"color": "#7b68ef"}}}'

**The real gate** (legacy build vs engine build, two servers)::

    python tools/chart_parity.py --base-a http://localhost:5173 \
                                 --base-b http://localhost:5174

**The engine rehearsal** — a case carrying ``instancesB`` renders the LEGACY
indicator on side A and the ENGINE's on side B, from ONE build, so the diff
measures the migration and not the difference between two checkouts::

    python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy
    # determinism of each render path on its own, run these FIRST:
    python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy \
        --instances-side none      # legacy vs legacy — must be 0
    python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy \
        --instances-side both      # engine vs engine — must be 0
    # prove it can fail (the engine reads its colour from the INSTANCE):
    python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy \
        --perturb-b-instances '{"color": "#7b68ef"}'

Exit code is 1 when any case exceeds its tolerance, so this is usable as a
gate and not just a report. Output (PNGs + report.md + report.json) lands in
``tools/chart_parity_out/`` — gitignored.
"""
from __future__ import annotations

import argparse
import base64
import copy
import json
import os
import sys
import urllib.parse
from pathlib import Path

from PIL import Image, ImageChops  # Pillow is already a dependency (requirements.txt)
from playwright.sync_api import sync_playwright

TOOLS_DIR = Path(__file__).parent
CASES_PATH = TOOLS_DIR / "chart_parity_cases.json"
OUT_DIR = TOOLS_DIR / "chart_parity_out"


# ─── case list ───────────────────────────────────────────────────────────────

def deep_merge(base: dict, patch: dict) -> dict:
    """Recursive dict merge; ``patch`` wins. Non-dict values (incl. LISTS)
    replace wholesale, matching ``mergeSettingsOverride`` in chartDefaults.js —
    the merge the page itself will apply. If these two ever disagree, a case
    means something different to the harness than it does to the chart."""
    out = copy.deepcopy(base)
    for k, v in (patch or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = copy.deepcopy(v)
    return out


def load_cases(path: Path, names: list[str] | None, include_placeholders: bool):
    doc = json.loads(path.read_text(encoding="utf-8"))
    defaults = doc.get("defaults", {})
    presets = doc.get("presets", {})
    cases = []
    for raw in doc.get("cases", []):
        case = {**defaults, **raw}
        if names and case["name"] not in names:
            continue
        if case.get("status") == "placeholder" and not include_placeholders:
            continue
        preset_name = case.get("preset")
        if preset_name and preset_name not in presets:
            raise SystemExit(f"case {case['name']}: unknown preset {preset_name!r}")
        settings = deep_merge(presets.get(preset_name, {}), case.get("settings", {}))
        # `_`-prefixed keys are prose for the reader of the JSON (why a preset is
        # shaped the way it is). They must not ride along into the URL — a case's
        # ?indicators= blob should contain settings and nothing else.
        case["_settings"] = {k: v for k, v in settings.items() if not k.startswith("_")}
        cases.append(case)
    if names:
        missing = set(names) - {c["name"] for c in cases}
        if missing:
            raise SystemExit(f"no such case(s): {', '.join(sorted(missing))}")
    return cases


def b64url(obj) -> str:
    raw = json.dumps(obj, separators=(",", ":"), sort_keys=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def case_instances(case: dict, side: str, mode: str, perturb_inputs: dict | None):
    """The `?instances=` payload for one side, or None.

    A case's ``instancesB`` list is what makes the ENGINE draw the indicator
    instead of the legacy block, on the SAME build. That is deliberate: side A
    and side B differ by one URL parameter and nothing else, so a non-zero diff
    is attributable to the migration rather than to two builds of the app.

    ``mode`` decides which sides get it, and exists so the case can be
    determinism-checked on its own terms before its A-vs-B number is believed:

      ``b``    (default) A = legacy, B = engine — the rehearsal.
      ``none`` A = legacy, B = legacy — proves the LEGACY render is deterministic.
      ``both`` A = engine, B = engine — proves the ENGINE render is deterministic.
                An engine render that differs from itself would make a 0 in
                ``b`` mode meaningless and a non-0 unattributable.
    """
    raw = case.get("instancesB")
    if not raw:
        return None
    if mode == "none":
        return None
    if mode == "b" and side != "b":
        return None
    if not perturb_inputs or side != "b":
        return raw
    # The gate's self-test for an ENGINE case. `--perturb-b` patches chart
    # SETTINGS, and the engine reads its colour from the instance's own inputs —
    # so on this case a settings perturbation would change nothing and the
    # "prove it can fail" step would silently pass. This is the reachable knob.
    return [{**i, "inputs": {**(i.get("inputs") or {}), **perturb_inputs}} for i in raw]


def case_url(base: str, case: dict, token: str, extra_settings: dict | None = None,
             side: str = "a", instances_mode: str = "b",
             perturb_instances: dict | None = None) -> str:
    settings = deep_merge(case["_settings"], extra_settings or {})
    params = {
        "sym": case.get("sym", "PARITY"),
        "tf": case.get("tf", "D"),
        "w": case.get("w", 1200),
        "h": case.get("h", 620),
        "fixedbars": case["fixedbars"],
        "indicators": b64url(settings),
    }
    instances = case_instances(case, side, instances_mode, perturb_instances)
    if instances:
        params["instances"] = b64url(instances)
    if case.get("bars"):
        params["bars"] = case["bars"]
    if case.get("ext") is not None:
        params["ext"] = case["ext"]
    if case.get("company"):
        params["company"] = case["company"]
    if token:
        params["token"] = token
    return f"{base.rstrip('/')}/r/chart?{urllib.parse.urlencode(params)}"


# ─── capture ─────────────────────────────────────────────────────────────────

def capture(page, url: str, out_png: Path, ready_timeout_ms: int = 60_000) -> None:
    """Drive the page and screenshot the #chart-export ELEMENT.

    Waits on ``window.__chartReady`` (the page's own contract: settings landed,
    fixture landed, plus a paint settle) and then on ``document.fonts.ready`` —
    a cold vs warm webfont cache is a real, reproducible source of diff noise
    that has nothing to do with the indicator under test.
    """
    out_png.parent.mkdir(parents=True, exist_ok=True)
    page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    page.wait_for_function("() => window.__chartReady === true", timeout=ready_timeout_ms)
    page.evaluate("() => document.fonts.ready.then(() => true)")
    el = page.locator("#chart-export")
    el.wait_for(state="visible", timeout=10_000)
    el.screenshot(path=str(out_png))


# ─── diff ────────────────────────────────────────────────────────────────────

def diff(a_png: Path, b_png: Path, out_png: Path | None = None, channel_threshold: int = 0) -> dict:
    """Per-pixel compare. Returns changed-pixel count + pct and writes a
    highlight image (the baseline dimmed, changed pixels painted red).

    A size mismatch is a FAILURE, not something to resize past: it means the two
    builds framed the chart differently, which is exactly the class of
    regression this gate exists to catch.
    """
    a = Image.open(a_png).convert("RGB")
    b = Image.open(b_png).convert("RGB")
    if a.size != b.size:
        return {
            "size_mismatch": True, "a_size": list(a.size), "b_size": list(b.size),
            "changed": None, "total": None, "pct": None, "diff_png": None,
        }

    total = a.size[0] * a.size[1]
    # PER-CHANNEL MAX, never `.convert("L")`.
    #
    # The first version of this reduced the RGB difference to greyscale before
    # counting, and greyscale is LUMA-weighted: blue counts 0.114. A whole-canvas
    # background change of #0e0f0d → #0e0f0e (blue +1) came out as 0.114 → rounds
    # to 0 → "0 changed pixels" on 642,000 pixels that had visibly changed. The
    # gate reported perfect parity on an image that was different everywhere.
    # Caught only because the fail-proof run refused to fail. Channel-max has no
    # blind channel: any byte that moved, moved.
    r, g, bl = ImageChops.difference(a, b).split()
    delta = ImageChops.lighter(ImageChops.lighter(r, g), bl)
    mask = delta.point(lambda p: 255 if p > channel_threshold else 0)
    # histogram()[0] = pixels that did not change; everything else did.
    changed = total - mask.histogram()[0]

    diff_path = None
    if out_png is not None and changed:
        out_png.parent.mkdir(parents=True, exist_ok=True)
        dimmed = Image.blend(a, Image.new("RGB", a.size, (0, 0, 0)), 0.72)
        red = Image.new("RGB", a.size, (255, 32, 32))
        Image.composite(red, dimmed, mask.convert("1")).save(out_png)
        diff_path = str(out_png)

    return {
        "size_mismatch": False, "a_size": list(a.size), "b_size": list(b.size),
        "changed": changed, "total": total,
        "pct": round(100.0 * changed / total, 6) if total else 0.0,
        "diff_png": diff_path,
    }


# ─── report ──────────────────────────────────────────────────────────────────

def write_report(report: dict, out_dir: Path) -> None:
    (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        "# Chart parity gate",
        "",
        f"- A (baseline): `{report['base_a']}`",
        f"- B (candidate): `{report['base_b']}`",
        f"- cases: {len(report['results'])} · failures: {report['failures']}",
    ]
    if report.get("perturb_b"):
        lines.append(f"- ⚠️ **B was deliberately perturbed**: `{json.dumps(report['perturb_b'])}` "
                     "— this run is a self-test of the gate, not a parity result.")
    if report.get("perturb_b_instances"):
        lines.append(f"- ⚠️ **B's engine INSTANCES were deliberately perturbed**: "
                     f"`{json.dumps(report['perturb_b_instances'])}` — self-test, not a parity result.")
    if report.get("instances_side") and report["instances_side"] != "b":
        lines.append(f"- engine instances applied to: **{report['instances_side']}** "
                     "(a determinism self-check of one render path, not a legacy-vs-engine result).")
    if report.get("tolerance_reason"):
        lines.append(f"- tolerance override: **{report['global_tolerance']}** px — "
                     f"_{report['tolerance_reason']}_")
    lines += ["", "| case | changed px | of total | tolerance | verdict | diff |",
              "|---|---:|---:|---:|---|---|"]
    for r in report["results"]:
        if r.get("error"):
            lines.append(f"| `{r['name']}` | — | — | — | 🔴 ERROR | {r['error']} |")
            continue
        if r["size_mismatch"]:
            lines.append(f"| `{r['name']}` | — | — | {r['tolerance']} | 🔴 SIZE "
                         f"{r['a_size']} vs {r['b_size']} | — |")
            continue
        verdict = "🟢 pass" if r["pass"] else "🔴 FAIL"
        dpng = f"`{Path(r['diff_png']).name}`" if r.get("diff_png") else "—"
        lines.append(f"| `{r['name']}` | {r['changed']} | {r['pct']}% | {r['tolerance']} "
                     f"| {verdict} | {dpng} |")
    lines += [
        "",
        "## Reading this",
        "",
        "**0 changed pixels is the bar for a Flip A migration.** The migrated indicator",
        "renders into the same legacy bands with the same colours, so anything nonzero",
        "is a real visual change that a user would see — open the diff image, the red",
        "pixels are where.",
        "",
        "A tolerance above 0 is an ESCAPE, not a setting. It must be justified in",
        "writing, per case, in `tools/chart_parity_cases.json` (`toleranceReason`), and",
        "the reason is reprinted here so a reviewer sees it next to the number it",
        "excuses. \"It's only a few pixels\" is not a reason; \"the LWC 5.2 line",
        "rasteriser antialiases the last segment differently, verified by <x>\" is.",
        "",
    ]
    for r in report["results"]:
        if r.get("tolerance") and r.get("toleranceReason"):
            lines.append(f"- `{r['name']}` tolerance {r['tolerance']}: {r['toleranceReason']}")
    (out_dir / "report.md").write_text("\n".join(lines), encoding="utf-8")


# ─── main ────────────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-a", default=os.environ.get("CHART_PARITY_BASE_A", "http://localhost:5173"),
                    help="baseline frontend (the legacy build)")
    ap.add_argument("--base-b", default=None,
                    help="candidate frontend (the engine build). Omit to capture BOTH sides "
                         "from --base-a, which is the determinism self-check.")
    ap.add_argument("--cases", nargs="*", help="subset of case names")
    ap.add_argument("--include-placeholders", action="store_true",
                    help="also run cases marked status=placeholder (B3 fills those in)")
    ap.add_argument("--out", default=str(OUT_DIR))
    ap.add_argument("--token", default=os.environ.get("CHART_RENDER_TOKEN", ""),
                    help="VITE_CHART_RENDER_TOKEN, when the build sets one")
    ap.add_argument("--tolerance", type=int, default=0,
                    help="changed-pixel budget applied to every case (default 0)")
    ap.add_argument("--tolerance-reason", default="",
                    help="REQUIRED with --tolerance > 0; printed in the report")
    ap.add_argument("--perturb-b", default="",
                    help="JSON settings patch applied to the B capture ONLY. The gate's own "
                         "self-test: change one colour by one hex digit and the diff must be "
                         "nonzero. A gate never shown to fail is not a gate.")
    ap.add_argument("--perturb-b-instances", default="",
                    help="JSON patch merged into every side-B instance's `inputs`. The same "
                         "self-test for an ENGINE case: the engine reads its colour from the "
                         "instance, not from chart settings, so --perturb-b alone cannot move "
                         "an engine-drawn line and would pass vacuously.")
    ap.add_argument("--instances-side", choices=["b", "none", "both"], default="b",
                    help="which side gets a case's `instancesB`. b = legacy vs engine (the "
                         "rehearsal); none = legacy vs legacy; both = engine vs engine. The "
                         "last two are determinism self-checks of one render path.")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--ready-timeout", type=int, default=60_000)
    args = ap.parse_args()

    if args.tolerance > 0 and not args.tolerance_reason.strip():
        raise SystemExit("--tolerance > 0 requires --tolerance-reason (it goes in the report)")

    # A SELF-TEST THAT CANNOT FAIL IS THE FAILURE MODE THIS TOOL EXISTS TO CATCH.
    # `--instances-side none` sends the engine instances to NEITHER side, and
    # `case_instances` returns before the perturbation is ever applied — so the
    # run reports 0 changed pixels and reads exactly like a pass, when in fact
    # nothing was perturbed and nothing was proven. Rejected here rather than
    # noted in the report, because the whole point of the "prove it can fail"
    # step is that a 0 from it is impossible.
    if args.perturb_b_instances and args.instances_side == "none":
        raise SystemExit(
            "--perturb-b-instances is meaningless with --instances-side none: no side gets the "
            "instances, so there is nothing to perturb and the run would report 0 changed pixels "
            "and look like a pass. Use --instances-side b (the rehearsal) or both."
        )

    perturb = json.loads(args.perturb_b) if args.perturb_b else None
    perturb_inst = json.loads(args.perturb_b_instances) if args.perturb_b_instances else None
    base_a = args.base_a
    base_b = args.base_b or args.base_a
    out_dir = Path(args.out)
    (out_dir / "a").mkdir(parents=True, exist_ok=True)
    (out_dir / "b").mkdir(parents=True, exist_ok=True)
    (out_dir / "diff").mkdir(parents=True, exist_ok=True)

    cases = load_cases(CASES_PATH, args.cases, args.include_placeholders)
    if not cases:
        raise SystemExit("no runnable cases (every match was a placeholder?)")

    report = {
        "base_a": base_a, "base_b": base_b,
        "self_check": args.base_b is None,
        "perturb_b": perturb,
        "perturb_b_instances": perturb_inst,
        "instances_side": args.instances_side,
        "global_tolerance": args.tolerance,
        "tolerance_reason": args.tolerance_reason,
        "results": [], "failures": 0,
    }

    with sync_playwright() as p:
        # --force-color-profile=srgb: without it Chromium converts the composited
        # frame through the DISPLAY's colour profile on the way to the PNG, and
        # that conversion quantises — a one-least-significant-bit colour change
        # (#7b68ee → #7b68ef) survives the canvas but not the profile, and the
        # gate silently reports 0. Pinning sRGB restores 1-of-255 sensitivity AND
        # makes two machines with different monitors agree.
        # --font-render-hinting=none: glyph hinting varies with the platform's
        # font stack; the axis labels are inside #chart-export.
        browser = p.chromium.launch(
            headless=not args.headed,
            executable_path=os.environ.get("PW_CHROME") or None,
            args=["--force-color-profile=srgb", "--font-render-hinting=none",
                  "--disable-lcd-text"],
        )
        for case in cases:
            w, h = case.get("w", 1200), case.get("h", 620)
            entry = {"name": case["name"],
                     "tolerance": case.get("tolerance", args.tolerance) or args.tolerance,
                     "toleranceReason": case.get("toleranceReason")}
            try:
                shots = {}
                for side, base in (("a", base_a), ("b", base_b)):
                    # A fresh context per capture: no carried-over storage, no warm
                    # IndexedDB, no reused canvas. deviceScaleFactor is pinned to 1
                    # so the PNG is measured in CSS pixels on every machine.
                    ctx = browser.new_context(
                        viewport={"width": w + 60, "height": h + 60},
                        device_scale_factor=1,
                        reduced_motion="reduce",
                    )
                    page = ctx.new_page()
                    try:
                        url = case_url(base, case, args.token,
                                       perturb if side == "b" else None,
                                       side=side, instances_mode=args.instances_side,
                                       perturb_instances=perturb_inst)
                        shots[side] = out_dir / side / f"{case['name']}.png"
                        capture(page, url, shots[side], args.ready_timeout)
                        entry[f"url_{side}"] = url
                    finally:
                        ctx.close()

                entry.update(diff(shots["a"], shots["b"], out_dir / "diff" / f"{case['name']}.png"))
                entry["pass"] = (not entry["size_mismatch"]) and entry["changed"] <= entry["tolerance"]
            except Exception as e:  # noqa: BLE001
                entry["error"] = f"{type(e).__name__}: {e}"
                entry["pass"] = False
                entry["size_mismatch"] = False

            if not entry["pass"]:
                report["failures"] += 1
            report["results"].append(entry)

            if entry.get("error"):
                print(f"[{case['name']:16}] ERROR {entry['error']}", file=sys.stderr)
            elif entry["size_mismatch"]:
                print(f"[{case['name']:16}] SIZE MISMATCH {entry['a_size']} vs {entry['b_size']}")
            else:
                flag = "ok" if entry["pass"] else "FAIL"
                print(f"[{case['name']:16}] {flag:4} changed={entry['changed']:>8} "
                      f"({entry['pct']}%) tol={entry['tolerance']}")
        browser.close()

    write_report(report, out_dir)
    print(f"\n{len(report['results'])} case(s), {report['failures']} failure(s). "
          f"Report + images in {out_dir}")
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
