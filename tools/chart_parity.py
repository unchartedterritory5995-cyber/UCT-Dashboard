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

    python tools/chart_parity.py --base-a http://localhost:5173 --same-build

**Prove the gate can fail** (one hex digit on one indicator's colour)::

    python tools/chart_parity.py --base-a http://localhost:5173 --same-build \
        --cases rsi_only \
        --perturb-b '{"indicators": {"rsi": {"color": "#7b68ef"}}}'

``--same-build`` is not ceremony. Both of those capture BOTH sides from one
server, and an A-vs-A run cannot fail on a build difference — it used to be the
silent default, which is how a determinism check reads like a legacy-vs-engine
result to whoever finds the report later. The tool also ASKS each base what it is
serving (see ``read_build_identity``) and refuses to run when the two answers
match and nothing else tells the sides apart.

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

**Measuring the flake rate, not asserting it away** (``--repeat``)::

    python tools/chart_parity.py --base-a $B --base-b $B --repeat 40 \
        --cases engine_rsi_vs_legacy engine_bb_vs_legacy

One 0 is not a measurement. ``n`` consecutive clean runs bound the per-run flake
probability at ``1 − 0.05^(1/n)`` with 95% confidence — 5 runs bounds it at 45%,
40 runs at 7.2% — and the report prints that bound next to the number so nobody
can round it up to "it doesn't flake". Every run's value is listed, and the
headline number is the WORST run, never the best.

Exit code is 1 when any case exceeds its tolerance, so this is usable as a
gate and not just a report. Output (PNGs + report.md + report.json) lands in
``tools/chart_parity_out/`` — gitignored.
"""
from __future__ import annotations

import argparse
import base64
import copy
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
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


# ─── build identity ──────────────────────────────────────────────────────────
#
# NOTHING IN THIS TOOL USED TO ASSERT WHICH BUILD A BASE URL SERVES, and that is
# not a hypothetical. The re-review of this branch opened with a clean green
# parity run against `http://localhost:5173` — a dev server that was serving the
# `phase-b1-foundations` worktree, a branch with no engine in it at all. Every
# case reported 0 changed pixels and exit 0, because two captures of the same
# wrong build are identical. The number was real; it just was not about this
# branch. It was caught by reading the server process's command line, which is
# not a thing a gate may depend on a human remembering to do.
#
# So each base is asked what it is serving, BEFORE any capture:
#
#   * a production build advertises hashed assets in `index.html`
#     (`/assets/index-<hash>.js`) — the hash IS the identity, and two `dist`
#     trees that differ anywhere differ here.
#   * a `vite dev` server advertises `/src/main.jsx` and `/@vite/client`, which
#     are IDENTICAL across every worktree — exactly the case that fooled the
#     re-review. So dev servers are identified by CONTENT: a handful of modules
#     on the chart's own render path are fetched and hashed. `binder.js` and
#     `pool.js` do not exist on a pre-engine branch, and "absent" is as good an
#     identity as any hash.
#
# The identities go into `report.json` and `report.md`, so every parity number
# this tool has ever printed is attributable after the fact.

# ⚠️ EVERY MODULE ON THE ENGINE'S RENDER PATH BELONGS HERE. A path that is absent
# is a change the tool cannot see: two dev servers differing ONLY in that file
# report the same identity, the tool refuses to run, and the operator's natural
# next move is `--same-build` — which silently downgrades a real A-vs-B gate into
# a determinism check that cannot fail on the very change being measured.
# `placement.js` was missing for exactly one commit (B3 Task 1 got two distinct
# identities only because it also touched `pool.js` and `binder.js`); `readout.js`
# is here for the same reason.
BUILD_PROBE_PATHS = (
    "/src/pages/ChartRender.jsx",
    "/src/components/StockChart.jsx",
    "/src/components/chart/engine/binder.js",
    "/src/components/chart/engine/pool.js",
    "/src/components/chart/engine/placement.js",
    "/src/components/chart/engine/instances.js",
    "/src/components/chart/engine/nativeRegistry.js",
    "/src/components/chart/engine/readout.js",
)

_ASSET_RE = re.compile(r"""(?:src|href)\s*=\s*["']([^"']+)["']""", re.I)


class BuildIdentityError(RuntimeError):
    """A base could not be asked what it serves. Fatal: an unattributable green
    is the exact failure this whole section exists to make impossible."""


def _http_get(url: str, timeout: int = 20) -> tuple[int, bytes]:
    req = urllib.request.Request(url, headers={"User-Agent": "chart-parity/1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:  # a 404 is an ANSWER, not a failure
        return e.code, e.read() or b""


def read_build_identity(base: str) -> dict:
    """What is this base serving? Returns a dict with a short stable ``id``."""
    root = base.rstrip("/")
    html = None
    for path in ("/index.html", "/"):
        try:
            status, body = _http_get(root + path)
        except Exception as e:  # noqa: BLE001 — connection refused, DNS, timeout
            raise BuildIdentityError(f"{root}{path}: {type(e).__name__}: {e}") from e
        if status == 200 and body:
            html = body.decode("utf-8", "replace")
            break
    if html is None:
        raise BuildIdentityError(f"{root}: no index.html (is the server up?)")

    assets = sorted({
        u.rsplit("/", 1)[-1]
        for u in _ASSET_RE.findall(html)
        if "/assets/" in u and u.rsplit(".", 1)[-1].lower() in ("js", "css")
    })

    probes = {}
    for path in BUILD_PROBE_PATHS:
        try:
            status, body = _http_get(root + path)
        except Exception as e:  # noqa: BLE001
            raise BuildIdentityError(f"{root}{path}: {type(e).__name__}: {e}") from e
        probes[path] = (
            f"{status}:{hashlib.sha256(body).hexdigest()[:12]}" if status == 200 else str(status)
        )

    canonical = json.dumps({"assets": assets, "probes": probes}, sort_keys=True)
    kind = "dist" if assets else "dev"
    return {
        "url": root,
        "kind": kind,
        "assets": assets,
        "probes": probes,
        # Does this base HAVE an engine to rehearse? Only answerable on a dev
        # server, where the source tree is served path-for-path. A bundled build
        # answers the SPA fallback (index.html) for every `/src/...` path, so
        # "absent" would be a false alarm there — hence three states, and only
        # `absent` is ever enforced. See the rehearsal guard in `main`.
        "engine_source": _engine_source(root) if kind == "dev" else "unknown (bundled build)",
        "id": hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12],
    }


def _engine_source(root: str) -> str:
    """`present` / `absent` — is `engine/instances.js` a real module on this dev
    server? A Vite dev server answers a path it does not have with the SPA
    fallback, so 200 alone is not an answer; the body has to be JS."""
    try:
        status, body = _http_get(root + "/src/components/chart/engine/instances.js")
    except Exception:  # noqa: BLE001
        return "absent"
    if status != 200:
        return "absent"
    head = body.lstrip()[:200].lower()
    return "absent" if (b"<!doctype" in head or b"<html" in head) else "present"


def identity_line(label: str, ident: dict) -> str:
    what = ", ".join(ident["assets"]) if ident["assets"] else "no hashed assets (dev server)"
    return (f"- {label}: `{ident['url']}` · build **{ident['id']}** ({ident['kind']}) — {what}"
            f" · engine source: {ident['engine_source']}")


# ─── capture ─────────────────────────────────────────────────────────────────
#
# ⚠️ A READINESS SIGNAL THAT IS REALLY A CLOCK IS NOT A READINESS SIGNAL.
#
# Until 2026-08-02 this function waited on `window.__chartReady` and screenshotted
# ONCE. `__chartReady` was a fixed 3,500 ms `setTimeout` — a wall-clock settle, not
# a statement about the canvas — so every number this tool has ever printed,
# including all of the zeros, was measured against a clock and not against a
# settled chart. The consequence was measured on this branch: an A/B pair whose two
# sides do asymmetric main-thread work came back 24 changed px on one scanline of
# the dashed last-price line, on 3 runs in 5, while each side ALONE was 0/5. The
# slower side had settled its price range one frame later than the screenshot.
#
# Two fixes, and they are independent on purpose:
#
#   * `ChartRender.jsx` now extends `__chartReady` past its old 3,500 ms floor
#     until the canvases inside `#chart-export` have been pixel-identical across
#     several consecutive sampled frames. It can only ever fire LATER than it used
#     to, never earlier, so no other consumer of the flag (the Morning Wire →
#     Substack renderer) can regress on it.
#   * THIS function no longer trusts any in-page flag on its own. It screenshots
#     at least twice and requires two CONSECUTIVE captures to be pixel-identical
#     before it accepts either. That asserts on the ARTIFACT — the bytes that get
#     diffed — rather than on a proxy for it, which is the standing lesson on this
#     project (`lesson_gate_that_cannot_fail`).
#
# Failure is LOUD: a chart that never settles raises `ChartNotSettledError`, the
# case is reported as an ERROR and the run exits 1. It does NOT quietly accept the
# last frame it happened to get, because that is exactly the old behaviour.


class ChartNotSettledError(RuntimeError):
    """`#chart-export` never produced two consecutive identical captures.

    Something inside the export is still animating (or repainting) after the
    page said it was ready. Accepting one of those frames is how a one-scanline
    diff enters a report as a migration result."""


def _pixels(png_bytes: bytes) -> bytes:
    """The DECODED RGB bytes of a screenshot.

    Comparison is on pixels, not on the PNG container: an encoder that ever
    emitted a differing byte for an identical framebuffer would make the
    stability loop run forever and raise a false `ChartNotSettledError`. Pixels
    are what `diff()` compares, so pixels are what stability has to mean.
    """
    from io import BytesIO
    return Image.open(BytesIO(png_bytes)).convert("RGB").tobytes()


def capture(page, url: str, out_png: Path, ready_timeout_ms: int = 60_000,
            stable_tries: int = 8, settle_ms: int = 220) -> dict:
    """Drive the page and screenshot the #chart-export ELEMENT, PROVING it settled.

    Waits on ``window.__chartReady`` (the page's own contract: settings landed,
    fixture landed, plus a pixel-stability settle) and then on
    ``document.fonts.ready`` — a cold vs warm webfont cache is a real,
    reproducible source of diff noise that has nothing to do with the indicator
    under test.

    Then captures repeatedly, ``settle_ms`` apart, until two CONSECUTIVE captures
    decode to identical pixels; that pair is what gets written. Bounded by
    ``stable_tries``; exhausting it raises ``ChartNotSettledError`` rather than
    accepting a frame.

    Returns a small dict of capture diagnostics (how many shots it took, and what
    the page itself said about its own settle) so the report can show that the
    numbers came from settled canvases and not from a timer.
    """
    out_png.parent.mkdir(parents=True, exist_ok=True)
    page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    page.wait_for_function("() => window.__chartReady === true", timeout=ready_timeout_ms)
    page.evaluate("() => document.fonts.ready.then(() => true)")
    el = page.locator("#chart-export")
    el.wait_for(state="visible", timeout=10_000)

    # What the PAGE thinks happened. `reason == 'ceiling'` means its own stability
    # detector gave up and fell back to the time cap — worth seeing in a report,
    # because it says the double-capture below is the only thing holding the line.
    ready = page.evaluate(
        "() => ({ms: window.__chartReadyMs ?? null, reason: window.__chartReadyReason ?? null,"
        " frames: window.__chartReadyFrames ?? null})"
    ) or {}

    prev_png = None
    prev_px = None
    for shot_no in range(1, max(2, stable_tries) + 1):
        png = el.screenshot()
        px = _pixels(png)
        if prev_px is not None and px == prev_px:
            out_png.write_bytes(prev_png)
            return {"shots": shot_no, "settled": True,
                    "ready_ms": ready.get("ms"), "ready_reason": ready.get("reason"),
                    "ready_frames": ready.get("frames")}
        prev_png, prev_px = png, px
        page.wait_for_timeout(settle_ms)

    raise ChartNotSettledError(
        f"#chart-export never produced two consecutive identical captures in "
        f"{max(2, stable_tries)} shots {settle_ms}ms apart "
        f"(page said ready after {ready.get('ms')}ms via {ready.get('reason')}). "
        f"url={url}"
    )


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

def flake_bound(n: int) -> float:
    """95% upper confidence bound on a per-run failure probability, given ``n``
    consecutive clean runs: ``1 − 0.05^(1/n)``.

    This is here because "we ran it five times and it was 0" is not a measurement
    of anything. Five zeros bound the flake rate at **45%** — a 20% flake rate
    produces five clean runs a third of the time. A run count is a claim about a
    bound; the tool states the bound so the report cannot round it up to
    certainty.
    """
    n = max(1, int(n))
    return 1.0 - (0.05 ** (1.0 / n))


def write_report(report: dict, out_dir: Path) -> None:
    (out_dir / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    lines = [
        "# Chart parity gate",
        "",
        # The build identities are FIRST because they are what makes every number
        # below attributable. A parity result whose builds are unknown is a
        # sentence with no subject.
        identity_line("A (baseline)", report["build_a"]),
        identity_line("B (candidate)", report["build_b"]),
        f"- cases: {len(report['results'])} · failures: {report['failures']}",
    ]
    if report.get("same_build"):
        lines.append(
            "- ⚠️ **A and B are the SAME build** "
            f"(`{report['build_a']['id']}`) — this run cannot fail on a build difference. "
            "It is a determinism self-check, a deliberate perturbation, or the one-build "
            "engine rehearsal; it is NOT a legacy-build-vs-engine-build result."
        )
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
    if report.get("repeat", 1) > 1:
        n = report["repeat"]
        lines.append(
            f"- **{n} runs per case.** The reported number is the WORST run; every run's "
            f"value is listed below. {n} consecutive clean runs put a 95% upper bound of "
            f"**{flake_bound(n) * 100:.1f}%** on the per-run flake probability "
            f"(`1 − 0.05^(1/n)`) — quote that bound, never \"it passed\"."
        )
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
    if report.get("repeat", 1) > 1:
        lines += ["", "### Per-run distribution", "",
                  "| case | runs | changed px, per run | max | capture shots (a/b) |",
                  "|---|---:|---|---:|---|"]
        for r in report["results"]:
            runs = r.get("runs") or []
            if not runs:
                lines.append(f"| `{r['name']}` | — | (errored) | — | — |")
                continue
            vals = ", ".join("—" if u.get("changed") is None else str(u["changed"]) for u in runs)
            shots = ", ".join(f"{u.get('shots_a', '?')}/{u.get('shots_b', '?')}" for u in runs)
            mx = max((u.get("changed") or 0) for u in runs)
            lines.append(f"| `{r['name']}` | {len(runs)} | {vals} | {mx} | {shots} |")
        lines.append("")
        lines.append("`capture shots` is how many screenshots each side needed before two "
                     "CONSECUTIVE ones decoded to identical pixels. 2 = settled immediately; "
                     "anything higher is the harness having caught a chart that was still "
                     "moving after the page called itself ready.")
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
                    help="candidate frontend (the engine build). Omitting it captures BOTH "
                         "sides from --base-a, which is an A-vs-A run and therefore REQUIRES "
                         "--same-build.")
    ap.add_argument("--same-build", action="store_true",
                    help="declare that A and B are intentionally the SAME build — a determinism "
                         "self-check, or a --perturb-b self-test on one server. Required when "
                         "--base-b is omitted, and required when the two bases turn out to "
                         "report the same build identity with nothing else telling them apart. "
                         "The engine rehearsal (a case with `instancesB`) and "
                         "--instances-side none|both are self-declaring and do not need it.")
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
    ap.add_argument("--repeat", type=int, default=1,
                    help="run the whole case list N times and report the DISTRIBUTION "
                         "(every run's changed-pixel count, plus the worst). A single 0 is "
                         "not a measurement of a flake rate: N consecutive clean runs bound "
                         "it at 1 - 0.05^(1/N) with 95%% confidence, which the report prints. "
                         "5 runs bounds it at 45%%; 40 runs at 7.2%%.")
    ap.add_argument("--stable-tries", type=int, default=8,
                    help="max screenshots per capture while waiting for two CONSECUTIVE "
                         "pixel-identical ones. Exhausting it is a loud ERROR, never a "
                         "silently-accepted frame.")
    ap.add_argument("--settle-ms", type=int, default=220,
                    help="delay between stability screenshots")
    args = ap.parse_args()

    if args.repeat < 1:
        raise SystemExit("--repeat must be >= 1")

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

    if args.base_b is None and not args.same_build:
        raise SystemExit(
            "--base-b was omitted, so BOTH sides would be captured from --base-a. That is an "
            "A-vs-A run and it cannot fail on a build difference — say so with --same-build.\n"
            "It used to default silently, which is how a determinism self-check reads like a "
            "legacy-vs-engine result in a report six months later."
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

    # THE OTHER EARLY RETURN IN `case_instances`, and it is the same failure class
    # as the one rejected above. `--perturb-b-instances` patches a case's
    # `instancesB`; a case that HAS no `instancesB` returns None before the
    # perturbation is reached, so the run renders two identical sides, reports
    # `0 · 🟢 pass` and exits 0 — while the report banner says "B's engine
    # INSTANCES were deliberately perturbed". Four of the five default cases are
    # that shape, and naming one is exactly what a B3 engineer does to sanity-check
    # the harness before migrating an indicator.
    if perturb_inst:
        inert = [c["name"] for c in cases if not c.get("instancesB")]
        if inert:
            raise SystemExit(
                "--perturb-b-instances has nothing to perturb on: "
                + ", ".join(sorted(inert))
                + ".\nThose cases carry no `instancesB`, so both sides render the LEGACY "
                  "indicator, the perturbation is never applied, and the run would report 0 "
                  "changed pixels and read exactly like a pass. Name a case that has "
                  "`instancesB` (see `engine_rsi_vs_legacy` in chart_parity_cases.json)."
            )

    # WHICH BUILD IS EACH SIDE SERVING? Asked before a single pixel is captured,
    # because a green from two servers running the same code — or from ONE server
    # running the wrong worktree — is indistinguishable from a real parity pass.
    try:
        ident_a = read_build_identity(base_a)
        ident_b = ident_a if base_b == base_a else read_build_identity(base_b)
    except BuildIdentityError as e:
        raise SystemExit(
            f"cannot read a build identity from the base(s): {e}\n"
            "Every number this tool prints is a claim about a specific build, so it refuses "
            "to measure one it cannot name. Check the server is up and serving the app."
        ) from e

    same_build = ident_a["id"] == ident_b["id"]
    # Two things legitimately make an A-vs-A BUILD a real comparison:
    #   * a perturbation — side B was deliberately changed;
    #   * the engine rehearsal — a case's `instancesB` goes to side B only, so the
    #     two sides differ by one URL parameter and the diff measures the
    #     migration rather than the distance between two checkouts.
    differentiated = bool(perturb or perturb_inst) or (
        args.instances_side == "b" and any(c.get("instancesB") for c in cases)
    )
    # `--instances-side none|both` IS a declaration: both of them say, in the flag
    # itself, "this run is a determinism check of one render path".
    declared_same = args.same_build or args.instances_side in ("none", "both")

    # THE TRAP, CLOSED FROM THE OTHER SIDE. `--base-b` being the same build is
    # legitimate for the engine rehearsal — but only if that build HAS an engine.
    # Point the rehearsal at a pre-engine worktree and `?instances=` arms nothing,
    # both sides render the legacy indicator, and the case reports 0 changed
    # pixels and 🟢 pass. That is not a hypothetical: it is what the re-review's
    # first parity run did against a `phase-b1-foundations` dev server, and the
    # only thing that caught it was a human reading the server's command line.
    rehearsing = args.instances_side in ("b", "both") and any(c.get("instancesB") for c in cases)
    if rehearsing:
        engineless = [i for i in ({"a": ident_a, "b": ident_b}).values()
                      if i["engine_source"] == "absent"]
        if engineless:
            raise SystemExit(
                "this run renders engine instances, but "
                + ", ".join(sorted({i["url"] for i in engineless}))
                + " has no `app/src/components/chart/engine/` to render them WITH.\n"
                  "`?instances=` would arm nothing, both sides would draw the legacy indicator, "
                  "and the case would report 0 changed pixels and read as a clean pass. That is "
                  "exactly how a green was once reported against a pre-engine worktree.\n"
                  "BOTH sides are checked, not just the one that receives the instances: an "
                  "`instancesB` case means ONE build rendering two ways, so a side that cannot "
                  "render the engine at all makes the comparison something other than what the "
                  "case claims to measure. Point --base-a/--base-b at the branch under test."
            )

    if same_build and not declared_same and not differentiated:
        raise SystemExit(
            f"A and B serve the SAME build ({ident_a['id']}), and nothing else tells the two "
            f"sides apart.\n"
            f"  A: {ident_a['url']} ({ident_a['kind']}, {ident_a['id']})\n"
            f"  B: {ident_b['url']} ({ident_b['kind']}, {ident_b['id']})\n"
            "Every case would report 0 changed pixels no matter what the code does. If that is "
            "what you meant — a determinism self-check — pass --same-build. If it is not, one "
            "of the two servers is serving the wrong worktree: a clean green against a build "
            "with no engine in it is how this check came to exist."
        )

    report = {
        "base_a": base_a, "base_b": base_b,
        "build_a": ident_a, "build_b": ident_b,
        "same_build": same_build,
        "same_build_declared": bool(args.same_build),
        "self_check": args.base_b is None,
        "perturb_b": perturb,
        "perturb_b_instances": perturb_inst,
        "instances_side": args.instances_side,
        "global_tolerance": args.tolerance,
        "tolerance_reason": args.tolerance_reason,
        "repeat": args.repeat,
        "flake_bound_95": round(flake_bound(args.repeat), 6),
        "results": [], "failures": 0,
    }
    print(identity_line("A (baseline) ", ident_a))
    print(identity_line("B (candidate)", ident_b))

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
        # ── ONE ENTRY PER CASE, N RUNS INSIDE IT ─────────────────────────────
        # `--repeat` reruns the whole list rather than one case N times so the
        # runs are spread across the same browser lifecycle a real gate run has,
        # and so a case can never be measured under conditions the others never
        # saw. The entry's headline `changed` is the WORST run: a gate that
        # reports its best number is a gate that hides its flake.
        entries = {}
        for case in cases:
            entries[case["name"]] = {
                "name": case["name"],
                "tolerance": case.get("tolerance", args.tolerance) or args.tolerance,
                "toleranceReason": case.get("toleranceReason"),
                "runs": [],
            }

        for run_idx in range(1, args.repeat + 1):
            sfx = "" if args.repeat == 1 else f"__r{run_idx}"
            for case in cases:
                w, h = case.get("w", 1200), case.get("h", 620)
                entry = entries[case["name"]]
                run = {"run": run_idx}
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
                            shots[side] = out_dir / side / f"{case['name']}{sfx}.png"
                            cap = capture(page, url, shots[side], args.ready_timeout,
                                          stable_tries=args.stable_tries,
                                          settle_ms=args.settle_ms)
                            entry[f"url_{side}"] = url
                            run[f"shots_{side}"] = cap["shots"]
                            run[f"ready_ms_{side}"] = cap["ready_ms"]
                            run[f"ready_reason_{side}"] = cap["ready_reason"]
                        finally:
                            ctx.close()

                    run.update(diff(shots["a"], shots["b"],
                                    out_dir / "diff" / f"{case['name']}{sfx}.png"))
                except Exception as e:  # noqa: BLE001
                    run["error"] = f"{type(e).__name__}: {e}"
                    run["size_mismatch"] = False
                    run["changed"] = None
                entry["runs"].append(run)

                if run.get("error"):
                    print(f"[{case['name']:24}] run {run_idx}/{args.repeat} ERROR {run['error']}",
                          file=sys.stderr)
                elif run["size_mismatch"]:
                    print(f"[{case['name']:24}] run {run_idx}/{args.repeat} "
                          f"SIZE MISMATCH {run['a_size']} vs {run['b_size']}")
                else:
                    print(f"[{case['name']:24}] run {run_idx}/{args.repeat} "
                          f"changed={run['changed']:>8} ({run['pct']}%) "
                          f"shots={run.get('shots_a')}/{run.get('shots_b')}")
        browser.close()

        # ── Collapse each case's runs into its verdict ────────────────────────
        for case in cases:
            entry = entries[case["name"]]
            runs = entry["runs"]
            errs = [r["error"] for r in runs if r.get("error")]
            worst = None
            for r in runs:
                if r.get("error") or r.get("size_mismatch") or r.get("changed") is None:
                    continue
                if worst is None or r["changed"] > worst["changed"]:
                    worst = r
            if errs:
                entry["error"] = errs[0] if len(errs) == 1 else f"{len(errs)}/{len(runs)} runs: {errs[0]}"
                entry["pass"] = False
                entry["size_mismatch"] = False
            elif any(r.get("size_mismatch") for r in runs):
                bad = next(r for r in runs if r.get("size_mismatch"))
                entry.update({k: bad[k] for k in ("size_mismatch", "a_size", "b_size")})
                entry["changed"] = None
                entry["pass"] = False
            else:
                entry.update({k: worst[k] for k in
                              ("size_mismatch", "a_size", "b_size", "changed", "total",
                               "pct", "diff_png")})
                entry["changed_values"] = [r["changed"] for r in runs]
                entry["pass"] = entry["changed"] <= entry["tolerance"]

            if not entry["pass"]:
                report["failures"] += 1
            report["results"].append(entry)
            flag = "ok" if entry["pass"] else "FAIL"
            shown = entry.get("changed")
            print(f"[{case['name']:24}] {flag:4} worst={shown} over {len(runs)} run(s) "
                  f"tol={entry['tolerance']}")

    write_report(report, out_dir)
    print(f"\n{len(report['results'])} case(s), {report['failures']} failure(s). "
          f"Report + images in {out_dir}")
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
