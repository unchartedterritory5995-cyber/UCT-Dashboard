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

**Measuring an INTENDED change** (``expect`` / ``regions`` / the pane manifest)::

    python tools/chart_parity.py --base-a $A --base-b $B --cases macd_headmask
    # the case file carries `"expect": 88` and a `regions` block; the run must
    # equal 88 on EVERY run, price_plot must read 0, and `rest` must read 0.

Every gate on this branch has been ``changed <= tolerance`` with ``tolerance ==
0``. B5's cutover turns the indicator bands into real panes, so it changes the
picture by construction and that sentence stops being available. A tolerance
cannot replace it — a budget passes anything under it, including the NEXT
regression of the same size, and it cannot say WHERE the change landed. So:

  * ``expect`` is an EQUALITY on every run (not the worst): a diff SMALLER than
    the declared number fails, and variance between runs is itself a failure.
    ``--expect N`` is the one-off form; the durable form is a case-file field.
  * ``regions`` are named rectangles counted from the SAME mask the headline
    number came from, each with its own expectation, plus ``rest`` — every
    changed pixel outside every declared rectangle, COMPUTED by mask
    subtraction, never declarable, and always expected to be 0.
  * the PANE MANIFEST (``window.__paneManifest``) is diffed as JSON alongside
    the pixels, IN TWO HALVES. **GEOMETRY** — pane count, per-pane pixel height,
    series type, ``priceScaleId``, pane index and INSERTION ORDER — keeps the
    unconditional cross-check, because a change that moves pixels but not the
    geometry, or the geometry but not pixels, means one of the two is lying.
    **PROVENANCE** — the pool ``key``, i.e. which module created the series — is
    what a Flip-B migration changes on purpose, so a case DECLARES it
    (``expectProvenance``) and an UNDECLARED provenance change is a failure.

``--expect`` and ``--tolerance > 0`` are mutually exclusive: one is a declared
measurement, the other is an escape.

Exit code is 1 when any case exceeds its tolerance, misses its ``expect``, puts a
pixel in a region it did not declare, or contradicts its own pane manifest — so
this is usable as a gate and not just a report. Output (PNGs + report.md +
report.json) lands in ``tools/chart_parity_out/`` — gitignored.
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
from collections import Counter
from pathlib import Path

from PIL import Image, ImageChops  # Pillow is already a dependency (requirements.txt)
from playwright.sync_api import sync_playwright

TOOLS_DIR = Path(__file__).parent
CASES_PATH = TOOLS_DIR / "chart_parity_cases.json"
OUT_DIR = TOOLS_DIR / "chart_parity_out"


def _spa_server_module():
    """`tools/spa_server.py`, imported by PATH.

    This file is a script, not a package member, and it is run from the repo
    root (`python tools/chart_parity.py`) as often as from `tools/` — so a plain
    `import spa_server` resolves only sometimes. Loading it by path makes the
    ONE-STRING claim below true by construction rather than by luck."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "_spa_server_for_chart_parity", TOOLS_DIR / "spa_server.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


try:
    PARITY_ROOT_PATH = _spa_server_module().PARITY_ROOT_PATH
except Exception:  # noqa: BLE001 — a missing/older server must not stop the import
    PARITY_ROOT_PATH = "/__parity_root"


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
    # `priceLine: false` ⇒ `?priceline=0`. A DETERMINISM control, not a view
    # preference: see `engine_rsi_toggle_off`'s `why` and the note beside
    # `hidePriceLine` in ChartRender.jsx. Both sides always get it, so it can
    # never tell A and B apart — it only removes an element that Chromium
    # rasterises two ways at one specific pane geometry.
    if case.get("priceLine") is False:
        params["priceline"] = 0
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
    line = (f"- {label}: `{ident['url']}` · build **{ident['id']}** ({ident['kind']}) — {what}"
            f" · engine source: {ident['engine_source']}")
    served = ident.get("served")
    if served and served.get("verified"):
        line += (f" · **served == disk** at `{served['root']}` (pid {served['pid']}, "
                 f"{served['files_checked']} file(s))")
    elif served:
        line += f" · served-vs-disk: {served.get('reason')}"
    return line


# ─── served-vs-disk ──────────────────────────────────────────────────────────
#
# ⛔ THE ONE THING EVERY OTHER CHECK IN THIS FILE ASSUMES AND NONE OF THEM PROVE.
#
# `read_build_identity` asks the SERVER what it advertises and refuses to run
# when A and B answer the same thing. That catches "both servers are the same
# build". It cannot catch **"the server is not serving the build you just
# built"**, because a stale listener answers with a perfectly self-consistent
# identity of its own — two DIFFERENT stale builds pass the identity check, the
# rehearsal check, the engine-source check and every case, and report numbers
# about a tree nobody is holding.
#
# That is not a hypothesis on this branch:
#   * `tools/spa_server.py` set `allow_reuse_address = True` with no bind check,
#     so starting a second server on a held port SUCCEEDED SILENTLY and left the
#     first one answering (fixed there; this is the other half);
#   * two clean-but-fictional results have already been produced here, one of
#     them a `0 px, 20/20, exit 0`;
#   * nine stale listeners were bound in one task, eight more in the next.
#
# Task 10 closed it BY HAND — diffing the served chunk name and that chunk's
# sha256 against the dist on disk before any case ran. A hand check is not a
# gate. This makes it automatic and MANDATORY: a `dist`-kind base must be
# attributable to a directory on this filesystem, and every byte it serves for
# `index.html` and for each hashed asset must equal the bytes in that directory.
#
# ⚠️ THERE IS NO `--skip` FOR IT, deliberately. An escape hatch on a check whose
# whole purpose is to catch an operator's stale terminal is the check being off
# by default with extra steps.


class ServedContentError(RuntimeError):
    """A base could not be proven to serve what is on disk. Fatal, and it must
    stay fatal — an unverifiable serve is exactly the state that produced this
    branch's fictional greens."""


def read_served_root(base: str, *, get=None) -> dict | None:
    """Ask a base which directory it is serving (`tools/spa_server.py`).

    ``None`` when the base cannot answer — which includes the important case: a
    server started before this endpoint existed answers `/__parity_root` with
    `index.html` through its own SPA fallback, i.e. a 200 carrying HTML. A 200
    that is not JSON is therefore ABSENT, not present-and-weird."""
    get = get or _http_get
    try:
        status, body = get(base.rstrip("/") + PARITY_ROOT_PATH)
    except Exception:  # noqa: BLE001 — refused/timeout: the identity read already reported it
        return None
    if status != 200 or not body:
        return None
    try:
        data = json.loads(body.decode("utf-8", "replace"))
    except (ValueError, AttributeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get("root"), str):
        return None
    return data


def _served_assets(html: str) -> list[str]:
    """The hashed asset URLs `index.html` advertises, as SERVER PATHS.

    `read_build_identity` keeps only basenames (it is building an identity);
    here the path is the thing being fetched and compared, so it is kept whole."""
    seen, out = set(), []
    for u in _ASSET_RE.findall(html):
        if "/assets/" not in u:
            continue
        if u.rsplit(".", 1)[-1].lower() not in ("js", "css"):
            continue
        if u in seen:
            continue
        seen.add(u)
        out.append(u)
    return out


def verify_served_matches_disk(base: str, ident: dict, expected_dist=None, *,
                               get=None, label: str = "") -> dict:
    """Prove this base serves the bytes that are on disk, in the named directory.

    Raises `ServedContentError` on every failure mode rather than returning a
    flag: the caller's only correct response is to stop, and a returned flag is
    a thing a future edit forgets to read.
    """
    get = get or _http_get
    who = f"{label} ({base})" if label else base

    if ident.get("kind") != "dist":
        # A dev server has no bundle to compare against; its identity is already
        # CONTENT-derived (`BUILD_PROBE_PATHS` hashes real source files), which is
        # the equivalent guarantee for that shape.
        return {"verified": False, "reason": "dev server — identity is content-derived"}

    served = read_served_root(base, get=get)
    if served is None:
        raise ServedContentError(
            f"{who} is serving a production build but cannot say WHICH DIRECTORY it is "
            f"serving ({PARITY_ROOT_PATH} did not answer JSON).\n"
            "  Every number this tool prints would then be a claim about a tree nobody can\n"
            "  identify. The overwhelmingly likely cause is a STALE LISTENER from an earlier\n"
            "  run holding this port -- that is how this branch produced a `0 px, 20/20,\n"
            "  exit 0` that was entirely wrong.\n"
            f"  Serve it with `python tools/spa_server.py <dist> <port>` on a FREE port.")

    root = Path(served["root"])
    if expected_dist is not None:
        want = Path(expected_dist).resolve()
        if root.resolve() != want:
            raise ServedContentError(
                f"{who} is serving `{root}`, but you named `{want}`.\n"
                "  A server bound to a port another server already holds keeps answering with\n"
                "  the OTHER build while your terminal says it is serving yours. This is that.")
    if not root.is_dir():
        raise ServedContentError(
            f"{who} reports it serves `{root}`, which is not a directory on this machine.\n"
            "  Served-vs-disk cannot be checked across a filesystem boundary, and an unchecked\n"
            "  serve is the state this gate exists to refuse.")

    checked = 0
    index_sha = None
    for rel in ["/index.html", *_served_assets(_http_text(base, "/index.html", get))]:
        disk = root / rel.lstrip("/").replace("/", os.sep)
        if not disk.is_file():
            raise ServedContentError(
                f"{who} advertises `{rel}`, which does not exist under `{root}`.\n"
                "  The server is answering from somewhere other than the directory it names.")
        status, body = get(base.rstrip("/") + rel)
        if status != 200:
            raise ServedContentError(f"{who}: `{rel}` answered {status}, not 200.")
        wire = hashlib.sha256(body).hexdigest()
        on_disk = hashlib.sha256(disk.read_bytes()).hexdigest()
        if wire != on_disk:
            raise ServedContentError(
                f"{who}: SERVED `{rel}` does not match the file on disk.\n"
                f"  served  sha256 {wire[:12]}\n"
                f"  on disk sha256 {on_disk[:12]}   ({disk})\n"
                "  A different process is answering this port. Nothing measured here would be\n"
                "  about the build you think you are measuring.")
        if rel == "/index.html":
            index_sha = wire
        checked += 1

    return {
        "verified": True,
        "root": str(root),
        "pid": served.get("pid"),
        "index_sha256": index_sha,
        "files_checked": checked,
    }


def _http_text(base: str, path: str, get) -> str:
    status, body = get(base.rstrip("/") + path)
    if status != 200 or not body:
        raise ServedContentError(f"{base}{path}: {status} (is the server up?)")
    return body.decode("utf-8", "replace")


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
                    "ready_frames": ready.get("frames"),
                    # Read from the SETTLED page, next to the bytes that were
                    # accepted — a manifest read before the chart stopped moving
                    # would describe a layout the screenshot never shows.
                    "manifest": read_manifest(page)}
        prev_png, prev_px = png, px
        page.wait_for_timeout(settle_ms)

    raise ChartNotSettledError(
        f"#chart-export never produced two consecutive identical captures in "
        f"{max(2, stable_tries)} shots {settle_ms}ms apart "
        f"(page said ready after {ready.get('ms')}ms via {ready.get('reason')}). "
        f"url={url}"
    )


# ─── the pane manifest ───────────────────────────────────────────────────────
#
# 🔑 PIXELS AND GEOMETRY ARE TWO WITNESSES TO ONE FACT, AND B5 CROSS-EXAMINES THEM.
#
# The cutover turns the indicator BANDS (margins inside one pane) into real LWC
# panes. A screenshot can say the picture changed; it cannot say the pane COUNT
# changed, and it cannot tell "the RSI band moved down 4 px" from "the RSI series
# moved to pane 1 and pane 0 shrank". So the page publishes what it built —
# `window.__paneManifest`: pane count, per-pane pixel height, and per-series pane
# index + priceScaleId — and the harness diffs the two sides as normalised JSON.
#
# The cross-check is the point, in BOTH directions:
#
#   * a manifest that MOVED while zero pixels moved is always a failure. A pane
#     layout that differs and paints identically did not happen; a manifest being
#     written from somewhere other than the chart did.
#   * pixels that moved while the manifest is IDENTICAL is a failure for a case
#     that DECLARES `expectManifestChange` — and only for those, because a colour
#     perturbation legitimately moves pixels with unchanged geometry. That
#     declaration is what makes the cutover's own cases assert their geometry
#     structurally instead of inferring it from red rectangles.
#
# ─── 🎯 GEOMETRY vs PROVENANCE — THE B5 TASK 5 RULING ────────────────────────
#
# 🔴 B5 Task 5 measured the sentence above hitting a case it was never about:
# `stoch_only` / `atr_only` / their two `engine_*_vs_legacy` twins reported
# `pass: false` with **`changed: 0`**, and the ENTIRE diff was
#
#     panes[0].series[1].key: None -> 'legacy:stoch::k'
#
# Pane count, per-pane height, stretch factor, per-series type, `priceScaleId`,
# pane index and insertion order were BYTE-IDENTICAL. What moved was the pool
# `key` — *which module created the series*. **That is what a Flip-B migration
# IS**, so every remaining migration trips the rule by construction, and
# `expectManifestChange` does not help (that branch only ADDS the reverse rule).
#
# So the diff is split, and the two halves are gated differently:
#
#   * **GEOMETRY** — everything except `key`: pane count, per-pane height,
#     stretch factor, series `type`, `scaleId`, pane `index`, and the ORDER of
#     the `series` and `panes` lists (order IS z-order; LWC paints by insertion).
#     This half keeps BOTH unconditional rules above. The pixels⇄manifest
#     cross-check is a statement about geometry: one of the two is lying.
#   * **PROVENANCE** — the pool `key` alone. A case DECLARES which keys flip and
#     to what (`expectProvenance: [[from, to], …]`); an observed change whose
#     `(from, to)` pair the case did not declare — or one that occurs MORE times
#     than declared — is a failure, on every case, whether or not pixels moved.
#
# ⛔ `key` IS NOT SIMPLY DROPPED, and the reason is not hypothetical. It is the
# only field that can catch a series created by the WRONG MODULE, and it earned
# that keep on its first two-build outing: `engine_bb_rsi_vs_legacy` built the
# same series in a DIFFERENT ORDER on the two sides (side A's read-time migrator
# walks REGISTRY order; the case's `instancesB` started with `bb`) — 0 changed
# pixels, because none of them overlap, and invisible until side A had a
# manifest at all.
#
# ⚠️ A DECLARED PAIR THAT DOES NOT OCCUR IS **NOT** A FAILURE, deliberately. The
# same case file is run two-build (A = the commit before the migration, B = after
# → the keys flip) AND `--same-build` (B vs B → nothing flips, and that run is
# the determinism proof). Gating "declared ⇒ must happen" would turn every
# same-build determinism run red on the cases that matter most. Unmet
# declarations are RECORDED (`provenance_unmet` in report.json) instead.
#
# A MISSING manifest is not an error. Nothing publishes one today, and a raise
# here would abort a 20-run measurement at run 13 with nothing written down.


#: The manifest leaf names that record PROVENANCE rather than geometry.
#: One entry, and the whole ruling above hangs off it: `key` is the pool key
#: `paneLayout.paneManifest` copies off the binder's binding, i.e. the identity
#: of the module that created the series. Everything else the manifest carries
#: describes WHERE and WHAT, which is geometry.
PROVENANCE_LEAVES = frozenset({"key"})


def read_manifest(page):
    """``window.__paneManifest``, or None.

    ChartRender publishes it only in fixed-bars (parity) mode, and a page that
    does not is a MISSING manifest, not an error: a missing manifest reads
    ``null`` in report.json and the A/B comparison is skipped with a stated
    reason, which is visible. An exception at run 13 of 20 is not.

    A non-object answer is also None — a page that publishes garbage has not
    published a manifest, and coercing it here keeps the diff from reporting the
    garbage as a geometry change.
    """
    try:
        value = page.evaluate("() => window.__paneManifest ?? null")
    except Exception:                                     # noqa: BLE001
        return None
    return value if isinstance(value, dict) else None


def manifest_diff_parts(a, b) -> dict:
    """The manifest diff, split into ``geometry`` and ``provenance``.

    Compared as plain data, not as objects: the manifest crosses a browser
    boundary, so key order is not ours to trust — every dict is walked by SORTED
    key, while lists keep their order because in this manifest order IS meaning
    (LWC paints by insertion, so a reordered `series` list is a z-order change).

    Both lists are ``[]`` when BOTH sides are absent — that is a pass. One side
    absent is an asymmetry, and it is GEOMETRY: a side that published no manifest
    published no geometry, and calling it provenance would let a case declare its
    way past a page that stopped publishing.

    Returns ``{"geometry": [line], "provenance": [line], "provenance_pairs":
    [(from, to)]}``. The pairs are what `expectProvenance` is matched against —
    the PATH is deliberately not part of that match, because a series that
    changed pane or position has already failed the geometry half.
    """
    empty = {"geometry": [], "provenance": [], "provenance_pairs": []}
    if a is None and b is None:
        return empty
    if a is None or b is None:
        return {**empty,
                "geometry": ["manifest missing on " + ("A" if a is None else "B")]}
    geometry: list[str] = []
    provenance: list[str] = []
    pairs: list[tuple] = []

    def walk(path, leaf, x, y):
        if isinstance(x, dict) and isinstance(y, dict):
            for k in sorted(set(x) | set(y)):
                walk(f"{path}.{k}" if path else k, k, x.get(k), y.get(k))
        elif isinstance(x, list) and isinstance(y, list):
            # The list INDEX is not a leaf name — a `series[3].key` is still a
            # `key`, and a whole `series[3]` appearing on one side only is still
            # geometry, because its leaf is the `series` that holds it.
            for i in range(max(len(x), len(y))):
                walk(f"{path}[{i}]", leaf, x[i] if i < len(x) else None,
                     y[i] if i < len(y) else None)
        elif x != y:
            line = f"{path}: {x!r} -> {y!r}"
            if leaf in PROVENANCE_LEAVES:
                provenance.append(line)
                pairs.append((x, y))
            else:
                geometry.append(line)

    walk("", None, a, b)
    return {"geometry": geometry, "provenance": provenance, "provenance_pairs": pairs}


def manifest_diff(a, b):
    """Every manifest diff line, geometry first — the REPORT's flat view.

    Kept as the reporting shape (`report.json`'s `manifest_diff`, report.md's
    A → B listing) because a reader wants one list of what moved. The GATE reads
    `manifest_diff_parts`, because the two halves are gated differently.
    """
    parts = manifest_diff_parts(a, b)
    return parts["geometry"] + parts["provenance"]


def _pair_key(pair) -> str:
    """A hashable, JSON-stable identity for one ``(from, to)`` provenance pair.

    `json.dumps` and not the tuple itself: the observed values cross a browser
    boundary and the declared ones come out of the case file, so both are JSON
    scalars — but a future manifest field could carry a list, and an unhashable
    value must not raise inside the gate.
    """
    return json.dumps(list(pair), sort_keys=True, default=str)


def provenance_verdict(declared, pairs) -> tuple[str | None, list]:
    """``(failure_reason_or_None, unmet_declarations)`` for one run.

    ⛔ THE GATE IS ONE-SIDED, AND THE SIDE MATTERS. An observed provenance change
    the case did not declare — or one that happens MORE times than it declared —
    FAILS. A declared change that did not happen is RETURNED, not failed: see the
    block above for why (the same case runs two-build AND `--same-build`).
    """
    want = Counter(_pair_key(p) for p in (declared or []))
    got = Counter(_pair_key(p) for p in pairs)
    extra = got - want
    unmet = want - got
    unmet_pairs = [json.loads(k) for k, n in unmet.items() for _ in range(n)]
    if not extra:
        return None, unmet_pairs
    shown = "; ".join(f"{json.loads(k)[0]!r} -> {json.loads(k)[1]!r}"
                      + (f" (x{n})" if n > 1 else "")
                      for k, n in list(extra.items())[:4])
    return ("UNDECLARED pane-manifest provenance change — a series was created by a "
            "module the case did not declare: " + shown +
            ". Declare it with `expectProvenance` if it is the migration, or find "
            "out which module built it if it is not"), unmet_pairs


def validate_provenance(declared, case_name: str = "?"):
    """Refuse an `expectProvenance` block that could make the gate unfalsifiable.

    Same posture as `validate_regions`: a declaration that cannot be matched is
    worse than none at all, because it reads like a live gate. Two refusals:

      * a pair that is not exactly ``[from, to]`` — anything else silently
        matches nothing, so every provenance change reads as UNDECLARED and the
        case fails for a reason nobody can act on;
      * a pair whose two sides are EQUAL — it can never occur (the diff only
        emits a line when they differ), so it is a declaration that only ever
        lands in `provenance_unmet` while looking like a gate.

    ``None`` in and ``None`` out: a case that declares nothing declares nothing.
    """
    if declared is None:
        return None
    if not isinstance(declared, list):
        raise SystemExit(f"case {case_name}: expectProvenance must be a list of [from, to] pairs")
    out = []
    for pair in declared:
        if not isinstance(pair, list) or len(pair) != 2:
            raise SystemExit(
                f"case {case_name}: each expectProvenance entry must be a two-element "
                f"[from, to] list; got {pair!r}")
        if pair[0] == pair[1]:
            raise SystemExit(
                f"case {case_name}: expectProvenance pair {pair!r} declares a key changing "
                "to itself, which the diff can never emit — it would gate nothing")
        out.append([pair[0], pair[1]])
    return out


def manifest_verdict(entry: dict, run: dict) -> str | None:
    """Why this run's pane manifest contradicts its pixels or its case, or None.

    Both directions of "one of the two is lying" on the GEOMETRY half, and the
    asymmetry between them is deliberate — see the block above. The PROVENANCE
    half is gated against the case's own declaration instead, on every case.
    """
    a, b = run.get("manifest_a"), run.get("manifest_b")
    parts = run.get("manifest_parts") or manifest_diff_parts(a, b)
    lines = parts["geometry"]
    comparable = a is not None and b is not None

    if entry.get("expect_manifest_change"):
        if not comparable:
            return ("the case declares a pane-geometry change, but no pane manifest was "
                    "published on " + ("both sides" if a is None and b is None
                                       else ("A" if a is None else "B")) +
                    " — the geometry assertion would be vacuous")
        if not lines:
            return ("pixels moved but the pane manifest is identical — the case declares a "
                    "geometry change and the geometry says nothing changed")
    if comparable and lines and not run.get("changed"):
        return ("the pane manifest changed but 0 pixels did: " + "; ".join(lines[:3]))
    if comparable:
        reason, _unmet = provenance_verdict(entry.get("expect_provenance"),
                                            parts["provenance_pairs"])
        if reason:
            return reason
    return None


# ─── diff ────────────────────────────────────────────────────────────────────
#
# ⚠️ A REGION IS A SECOND VERDICT, NEVER A REPLACEMENT FOR THE FIRST. The headline
# `changed` stays whole-canvas and stays reported on every case, with or without
# regions. What regions add is WHERE: B5's cutover changes the picture by
# construction, so "0 changed pixels" stops being available and the gate has to be
# able to say *this many pixels changed, in these rectangles, and nowhere else*.
# A `--tolerance` cannot say that — a budget also passes the next change of the
# same size, and it cannot tell the oscillator strip from the price pane.


def validate_regions(regions) -> None:
    """Refuse a region list that could make the gate unfalsifiable.

    ``rest`` is reserved: it is the bucket for every changed pixel outside every
    declared rectangle, and a case that could declare it could declare its own
    blind spot. A zero-area box is refused for the same reason — it reports 0
    forever and reads exactly like a region that is holding the line.
    """
    seen = set()
    for r in regions or []:
        name = r.get("name")
        if name == "rest":
            raise SystemExit("chart_parity: `rest` is computed, not declarable — "
                             "it is the bucket that catches a pixel nobody named, and a "
                             "case that could declare it could declare its own blind spot.")
        if not name or name in seen:
            raise SystemExit(
                f"chart_parity: region names must be present and unique (got {name!r})")
        seen.add(name)
        box = r.get("box")
        if not isinstance(box, (list, tuple)) or len(box) != 4:
            raise SystemExit(f"chart_parity: region {name!r} needs box [x0,y0,x1,y1] (got {box!r})")
        for v in box:
            if isinstance(v, bool) or not isinstance(v, (int, float)) or float(v) != int(v):
                raise SystemExit(
                    f"chart_parity: region {name!r} box must be whole pixels (got {box!r}) — "
                    "a fractional edge silently rounds and the rectangle stops being the "
                    "one the case wrote down.")
        x0, y0, x1, y1 = (int(v) for v in box)
        if x1 <= x0 or y1 <= y0:
            raise SystemExit(f"chart_parity: region {name!r} has zero area — "
                             "a region that can only ever report 0 is not a gate.")


def diff(a_png: Path, b_png: Path, out_png: Path | None = None, channel_threshold: int = 0,
         regions: list | None = None) -> dict:
    """Per-pixel compare. Returns changed-pixel count + pct and writes a
    highlight image (the baseline dimmed, changed pixels painted red).

    ``regions`` splits that SAME mask into named rectangles plus a computed
    ``rest``; see the block above and ``validate_regions``.

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
            "regions": None,
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

    region_counts = None
    if regions is not None:
        validate_regions(regions)
        region_counts = {}
        # `covered` accumulates the union of every declared rectangle. It is a
        # MASK, not an arithmetic total: overlapping regions make
        # `changed - sum(regions)` NEGATIVE, and two cases in this file's suite
        # exist because the naive version was written first.
        covered = Image.new("L", a.size, 0)
        for r in regions:
            x0, y0, x1, y1 = (int(v) for v in r["box"])
            if x0 < 0 or y0 < 0 or x1 > a.size[0] or y1 > a.size[1]:
                raise SystemExit(
                    f"chart_parity: region {r['name']!r} box {list(r['box'])} falls outside "
                    f"the {a.size[0]}x{a.size[1]} canvas. Pillow pads a crop past the edge "
                    f"with BLACK, which counts as 'unchanged' — the region would under-report "
                    f"forever instead of failing.")
            crop = mask.crop((x0, y0, x1, y1))
            region_counts[r["name"]] = (x1 - x0) * (y1 - y0) - crop.histogram()[0]
            covered.paste(255, (x0, y0, x1, y1))
        # Everything the case did NOT name. `rest` is computed here and can never
        # be declared (`validate_regions` refuses the name), because a cutover
        # that moves a pixel nobody named must fail — and the only way to keep
        # that failable is for this bucket not to be a case-file field.
        outside = ImageChops.subtract(mask, covered)
        region_counts["rest"] = total - outside.histogram()[0]

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
        "regions": region_counts,
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


def run_failures(entry: dict, run: dict) -> list[str]:
    """Every way ONE run fails what the case DECLARED, as sentences.

    ⛔ **`expect` IS AN EQUALITY, AND IT IS CHECKED ON EVERY RUN.** An `expect` is
    a declared, measured, signed-off number — the MACD head-mask's 88 px and the
    VWAP anchor's 2,590 px are the precedent, both with zero variance over 20
    runs. A tolerance would pass a regression that happens to be SMALLER than the
    allowance, and would hide the next change of the same size. And it is every
    run, not the worst: **variance is itself a failure**, because a number that
    moves is a number nobody can sign off.

    This is the single predicate behind BOTH `entry["pass"]` and
    ``clean_runs`` — deliberately, because when they were two predicates
    `flake_bound_95` got computed from runs the verdict had already rejected.
    """
    n = run.get("run")
    if run.get("error"):
        return [f"run {n}: {run['error']}"]
    if run.get("size_mismatch"):
        return [f"run {n}: size mismatch {run.get('a_size')} vs {run.get('b_size')}"]
    if run.get("changed") is None:
        return [f"run {n}: no measurement"]

    out = []
    expect = entry.get("expect")
    if expect is not None:
        if run["changed"] != expect:
            out.append(f"run {n}: changed = {run['changed']}, expected EXACTLY {expect}")
    elif run["changed"] > entry["tolerance"]:
        out.append(f"run {n}: changed = {run['changed']}, over tolerance {entry['tolerance']}")

    want_regions = entry.get("expect_regions") or {}
    if want_regions:
        got = run.get("regions") or {}
        # `rest` defaults to 0 and a case may not raise it (validate_regions).
        for name, want in {"rest": 0, **want_regions}.items():
            if got.get(name) != want:
                out.append(f"run {n}: region {name} = {got.get(name)}, expected {want}")

    reason = manifest_verdict(entry, run)
    if reason:
        out.append(f"run {n}: {reason}")
    return out


def case_entry(case: dict, *, tolerance: int, expect: int | None) -> dict:
    """The per-case accumulator `main()` fills with runs, built from the case file.

    Out here as a pure function so the mapping from case-file keys to gate
    behaviour is reachable without launching Chromium — the same reason
    `collapse_case` is.
    """
    regions = case.get("regions")
    validate_regions(regions)
    declared_provenance = validate_provenance(case.get("expectProvenance"), case["name"])
    return {
        "name": case["name"],
        "tolerance": case.get("tolerance", tolerance) or tolerance,
        "toleranceReason": case.get("toleranceReason"),
        # `--expect` overrides the case's own: a one-off measurement on the
        # command line, where the durable form is the case file's `expect`.
        "expect": expect if expect is not None else case.get("expect"),
        # A region without its own `expect` is MEASURED and REPORTED but not
        # gated — that is how a new region gets its number before anyone signs
        # off on it.
        "expect_regions": {r["name"]: r["expect"] for r in (regions or [])
                           if "expect" in r} or None,
        "expect_manifest_change": bool(case.get("expectManifestChange")),
        # `[[from, to], …]` — which pool keys this case's migration flips, and to
        # what. See `provenance_verdict`: undeclared FAILS, unmet is recorded.
        "expect_provenance": declared_provenance,
        "regions": regions,
        "runs": [],
    }


def collapse_case(entry: dict) -> dict:
    """Reduce one case's ``runs`` into its verdict, in place. Returns ``entry``.

    ⚠️ **THIS FUNCTION DECIDES `entry["pass"]`, AND `entry["pass"]` DECIDES THE
    PROCESS EXIT CODE.** ``main()`` counts every non-passing entry into
    ``report["failures"]`` and returns ``1`` if that is nonzero. On this branch the
    exit code IS the evidence: ``parity_final.sh`` echoes ``EXIT=$?`` after every
    run and the reports quote it.

    It lives out here, as a pure function over a dict, because it used to be an
    inline block inside ``main()`` and was therefore reachable only by launching
    Chromium. `capture()`'s raise is gated three ways in
    ``tests/test_chart_parity_harness.py``; the conversion of that raise into a
    non-zero exit was gated NOWHERE, and a review mutation that changed the one
    word below — ``entry["pass"] = False`` → ``True`` in the error branch —
    survived a 78-test pytest selection. A case whose every run raised
    ``ChartNotSettledError`` would then report ``🔴 ERROR`` in ``report.md`` and
    ``exit 0`` to anything reading the verdict.

    THREE OUTCOMES, in priority order, and the order matters:
      1. **any run errored** ⇒ the case ERRORED. Not "use the runs that worked":
         an error means a capture was never proven settled, so the runs that did
         produce a number were measured under conditions this tool cannot vouch
         for.
      2. **any run size-mismatched** ⇒ the two builds framed the chart
         differently, which is never something to resize past.
      3. otherwise the WORST run is the verdict, against the case's tolerance.

    ``flake_bound_95`` is per case and is emitted ONLY when every run was clean,
    because ``1 − 0.05^(1/n)`` is the bound implied by *n consecutive clean runs*
    and there is no such n once one of them failed.
    """
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
        # `.get`, not `[...]`: a hand-written entry in a test (or a future run
        # shape that carries fewer diagnostics) must still collapse to a VERDICT.
        # A KeyError here would be an exception where a 🔴 belongs.
        entry.update({k: worst.get(k) for k in
                      ("size_mismatch", "a_size", "b_size", "changed", "total",
                       "pct", "diff_png")})
        entry["changed_values"] = [r["changed"] for r in runs]
        entry["region_values"] = [r.get("regions") for r in runs]
        # ⛔ NOT `entry["changed"] <= entry["tolerance"]`, and not the worst run
        # either: EVERY run must satisfy EVERYTHING the case declared — its
        # `expect` (an equality), each region's own expectation, the computed
        # `rest`, and the pane manifest's agreement with the pixels. On a case
        # that declares none of those this is exactly the old sentence, because
        # `all(r.changed <= tol)` and `max(r.changed) <= tol` are the same claim.
        entry["pass"] = all(not run_failures(entry, r) for r in runs)

    entry["expectation_failures"] = [m for r in runs for m in run_failures(entry, r)]
    entry["manifest_diff"] = next(
        (r["manifest_diff"] for r in runs if r.get("manifest_diff") is not None),
        manifest_diff(runs[0].get("manifest_a"), runs[0].get("manifest_b")) if runs else [])
    # The two halves, reported separately: a reader of report.json must be able
    # to see that a case's whole diff was provenance without re-deriving it.
    parts = next((r["manifest_parts"] for r in runs if r.get("manifest_parts") is not None),
                 manifest_diff_parts(runs[0].get("manifest_a"), runs[0].get("manifest_b"))
                 if runs else manifest_diff_parts(None, None))
    entry["manifest_geometry_diff"] = parts["geometry"]
    entry["manifest_provenance_diff"] = parts["provenance"]
    # ⚠️ RECORDED, NOT GATED — a declared pair that did not occur is the normal
    # state of a `--same-build` determinism run. It is here so a declaration that
    # has rotted (the migration it names is long done, or it was never right) is
    # visible in the report instead of quietly matching nothing.
    _reason, entry["provenance_unmet"] = provenance_verdict(
        entry.get("expect_provenance"), parts["provenance_pairs"])
    clean = sum(1 for r in runs if not run_failures(entry, r))
    entry["clean_runs"] = clean
    entry["flake_bound_95"] = round(flake_bound(clean), 6) if runs and clean == len(runs) else None
    return entry


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
        bound = report.get("flake_bound_95")
        if bound is None:
            # ⚠️ THE SENTENCE BELOW IS NOT PRINTED OVER A 🔴 ROW. `1 − 0.05^(1/n)`
            # is the bound implied by n consecutive CLEAN runs; a report that
            # contains a failure has no such n, and printing one anyway is how a
            # bound gets quoted out of a report that does not support it. That
            # happened: `off40/report.md` carried "40 consecutive clean runs put a
            # 95% upper bound of 7.2%" directly above two `🔴 FAIL` rows, and
            # `report.json` carried the number with nothing qualifying it.
            lines.append(
                f"- **{n} runs per case.** The reported number is the WORST run; every run's "
                f"value is listed below. **No report-level flake bound is quoted: "
                f"{report['failures']} case(s) did not pass.** The bound describes *n "
                f"consecutive clean runs* and there were not n of them. Per-case bounds are "
                f"in the distribution table, and only a case that met its expectation on "
                f"every run carries one. A case that is DELIBERATELY non-zero (e.g. "
                f"`macd_headmask`, which prices a decision) carries one ONLY once that number "
                f"is written down as its `expect`: without one, 'clean' has nothing to mean "
                f"and what backs the number is that every run produced the SAME value, which "
                f"the per-run column shows."
            )
        else:
            lines.append(
                f"- **{n} runs per case.** The reported number is the WORST run; every run's "
                f"value is listed below. {n} consecutive clean runs put a 95% upper bound of "
                f"**{bound * 100:.1f}%** on the per-run flake probability "
                f"(`1 − 0.05^(1/n)`) — quote that bound, never \"it passed\"."
            )
    if report.get("global_expect") is not None:
        lines.append(f"- ⚠️ **`--expect {report['global_expect']}` was applied to EVERY case** "
                     "— an exact number, on every run, overriding each case's own `expect`.")
    lines += ["", "| case | changed px | of total | expected | verdict | diff |",
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
        # `= N` is a DECLARED number that must hold on every run; `<= N` is a
        # budget. The two never mean the same thing and the table says which.
        want = (f"**= {r['expect']}**" if r.get("expect") is not None
                else f"<= {r['tolerance']}")
        lines.append(f"| `{r['name']}` | {r['changed']} | {r['pct']}% | {want} "
                     f"| {verdict} | {dpng} |")

    declared = [r for r in report["results"]
                if r.get("expect") is not None or r.get("expect_regions")
                or r.get("regions") or r.get("manifest_diff")
                or r.get("expect_provenance") or r.get("provenance_unmet")]
    if declared:
        lines += [
            "",
            "### The declared diff — regions and the pane manifest",
            "",
            "A region block adds a SECOND, finer verdict; it never replaces the first. The",
            "headline `changed` above is still whole-canvas. `rest` is every changed pixel",
            "outside every declared rectangle — it is COMPUTED by mask subtraction, a case",
            "may not declare it, and its expectation is always 0.",
            "",
            "| case | region | changed px | expected |",
            "|---|---|---:|---:|",
        ]
        for r in declared:
            want = r.get("expect_regions") or {}
            counts = next((v for v in (r.get("region_values") or []) if v), None) or {}
            # `rest` last: it is the bucket everything else is subtracted from,
            # and it reads as the bottom line of the block rather than as one
            # more rectangle sorted alphabetically into the middle of them.
            names = sorted(set(counts) | set(want), key=lambda k: (k == "rest", k))
            for name in names:
                exp = ("0 (computed)" if name == "rest"
                       else want[name] if name in want
                       else "— (measured, not gated)")
                lines.append(f"| `{r['name']}` | {name} | {counts.get(name, '—')} | {exp} |")
        for r in declared:
            geo = r.get("manifest_geometry_diff")
            prov = r.get("manifest_provenance_diff")
            if geo is None and prov is None and r.get("manifest_diff"):
                # A hand-built entry (or an older report.json) that carries only
                # the flat list. Show it rather than dropping it.
                lines += ["", f"**`{r['name']}` — pane manifest A → B:**", ""]
                lines += [f"- `{line}`" for line in r["manifest_diff"][:40]]
                continue
            if geo:
                lines += ["", f"**`{r['name']}` — pane manifest GEOMETRY A → B "
                              "(gated unconditionally against the pixels):**", ""]
                lines += [f"- `{line}`" for line in geo[:40]]
            if prov:
                head = ("declared" if r.get("expect_provenance") else "UNDECLARED")
                lines += ["", f"**`{r['name']}` — pane manifest PROVENANCE A → B "
                              f"({head}) — which module created the series:**", ""]
                lines += [f"- `{line}`" for line in prov[:40]]
            if r.get("provenance_unmet"):
                lines += ["", f"**`{r['name']}` — declared provenance that did NOT occur "
                              "(recorded, not gated):**", ""]
                lines += [f"- `{p[0]!r} -> {p[1]!r}`" for p in r["provenance_unmet"][:20]]
        fails = [(r["name"], m) for r in report["results"]
                 for m in (r.get("expectation_failures") or [])]
        if fails:
            lines += ["", "**Why each failing case failed, run by run:**", ""]
            lines += [f"- `{name}` — {msg}" for name, msg in fails[:60]]
    if report.get("repeat", 1) > 1:
        lines += ["", "### Per-run distribution", "",
                  "| case | runs | clean | 95% flake bound | changed px, per run | max | capture shots (a/b) |",
                  "|---|---:|---:|---:|---|---:|---|"]
        for r in report["results"]:
            runs = r.get("runs") or []
            cb = r.get("flake_bound_95")
            cbs = f"{cb * 100:.1f}%" if cb is not None else "n/a"
            clean = r.get("clean_runs")
            cleans = "—" if clean is None else f"{clean}/{len(runs)}"
            if not runs:
                lines.append(f"| `{r['name']}` | — | — | n/a | (errored) | — | — |")
                continue
            vals = ", ".join("—" if u.get("changed") is None else str(u["changed"]) for u in runs)
            shots = ", ".join(f"{u.get('shots_a', '?')}/{u.get('shots_b', '?')}" for u in runs)
            mx = max((u.get("changed") or 0) for u in runs)
            lines.append(f"| `{r['name']}` | {len(runs)} | {cleans} | {cbs} | {vals} | {mx} | {shots} |")
        lines.append("")
        lines.append("`capture shots` is how many screenshots each side needed before two "
                     "CONSECUTIVE ones decoded to identical pixels. 2 = settled immediately; "
                     "anything higher is the harness having caught a chart that was still "
                     "moving after the page called itself ready.")
        lines.append("")
        lines.append("`95% flake bound` is `1 − 0.05^(1/clean)` and is **n/a unless every run "
                     "of that case met its expectation** — the bound is a statement about "
                     "consecutive clean runs, so a case with a failure in it has no bound to "
                     "quote. For a case carrying an `expect`, 'clean' means *equal to the "
                     "declared number, with every declared region where it said it would be*, "
                     "so a deliberately non-zero case does get a bound — on the deviation "
                     "probability, which is the thing that matters once the number is not 0.")
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
        "**An `expect` is not a tolerance and does not replace one.** It is an EQUALITY,",
        "asserted on EVERY run: a diff SMALLER than the declared number fails, and so",
        "does variance between runs. It is for a change that was deliberately made,",
        "measured, and signed off — B5's real-panes cutover, where '0 changed pixels' is",
        "not available because the picture changes by construction. A case that has one",
        "reads `= N` in the table above; a case that does not still reads `<= N`.",
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
    ap.add_argument("--dist-a", default=None,
                    help="the directory --base-a is SUPPOSED to be serving. The tool always "
                         "checks that a production base serves the bytes on its own disk; "
                         "naming the directory here additionally checks it is the RIGHT one, "
                         "which is the only way to catch a stale listener holding the port.")
    ap.add_argument("--dist-b", default=None, help="the same, for --base-b")
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
    ap.add_argument("--expect", type=int, default=None,
                    help="EXACT changed-pixel count every run must equal (not a budget). "
                         "Overrides a case's own `expect`. Use it for a one-off "
                         "measurement; the durable form is the case file's `expect` + "
                         "`regions`.")
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

    # ONE IS A DECLARED MEASUREMENT, THE OTHER IS AN ESCAPE. `--expect` says "this
    # exact number, on every run"; `--tolerance` says "anything up to here is
    # fine". A run carrying both has a verdict nobody can state — and the budget
    # would silently outrank the equality on any case that has no `expect` of its
    # own, so the report would be part signed-off measurement and part allowance
    # with nothing marking which case is which.
    if args.expect is not None and args.tolerance > 0:
        raise SystemExit(
            f"--expect {args.expect} and --tolerance {args.tolerance} are mutually exclusive.\n"
            "  --expect is a DECLARED, MEASURED, SIGNED-OFF number that must hold on every "
            "run;\n  --tolerance is a budget that passes anything under it — including the "
            "next\n  regression of the same size. Pick the one you mean.")

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

    # ⭐ AND DOES EACH BASE ACTUALLY SERVE THE TREE ON ITS OWN DISK? Before a
    # single pixel, and before the same-build adjudication below — because two
    # DIFFERENT stale servers sail through that adjudication (see
    # `verify_served_matches_disk`). Task 10 did this by hand; a hand check is
    # not a gate.
    try:
        ident_a["served"] = verify_served_matches_disk(
            base_a, ident_a, args.dist_a, label="A (baseline)")
        if ident_b is ident_a:
            # ONE base, ONE server. `--dist-b` naming a different directory is a
            # contradiction the operator must see, not a second check to run.
            root_a = ident_a["served"].get("root")
            if args.dist_b and (root_a is None
                                or Path(args.dist_b).resolve() != Path(root_a).resolve()):
                raise ServedContentError(
                    f"--dist-b names `{args.dist_b}`, but A and B are the SAME base "
                    f"({base_a}), which serves `{root_a}`. One server cannot be two builds.")
        else:
            ident_b["served"] = verify_served_matches_disk(
                base_b, ident_b, args.dist_b, label="B (candidate)")
    except ServedContentError as e:
        raise SystemExit(f"SERVED-VS-DISK CHECK FAILED\n{e}") from e

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
        "global_expect": args.expect,
        "tolerance_reason": args.tolerance_reason,
        "repeat": args.repeat,
        # Filled in AFTER the collapse, and only if nothing failed — see the
        # assignment below `write_report`'s caller for why it cannot be computed
        # from `--repeat` here.
        "flake_bound_95": None,
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
            entries[case["name"]] = case_entry(case, tolerance=args.tolerance,
                                               expect=args.expect)

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
                            run[f"manifest_{side}"] = cap.get("manifest")
                        finally:
                            ctx.close()

                    run.update(diff(shots["a"], shots["b"],
                                    out_dir / "diff" / f"{case['name']}{sfx}.png",
                                    regions=entry.get("regions")))
                    run["manifest_parts"] = manifest_diff_parts(run.get("manifest_a"),
                                                                run.get("manifest_b"))
                    run["manifest_diff"] = (run["manifest_parts"]["geometry"]
                                            + run["manifest_parts"]["provenance"])
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
                    extra = ""
                    if run.get("regions"):
                        extra = " regions=" + " ".join(
                            f"{k}:{v}" for k, v in run["regions"].items())
                    parts = run.get("manifest_parts") or {}
                    if parts.get("geometry"):
                        extra += f" manifest_geometry={len(parts['geometry'])} line(s)"
                    if parts.get("provenance"):
                        extra += f" manifest_provenance={len(parts['provenance'])} line(s)"
                    print(f"[{case['name']:24}] run {run_idx}/{args.repeat} "
                          f"changed={run['changed']:>8} ({run['pct']}%) "
                          f"shots={run.get('shots_a')}/{run.get('shots_b')}{extra}")
        browser.close()

        # ── Collapse each case's runs into its verdict ────────────────────────
        # The reduction itself is `collapse_case` — a pure function, out of this
        # closure on purpose, because the raise→exit-code conversion is the gate's
        # verdict channel and it must be reachable without launching Chromium.
        for case in cases:
            entry = collapse_case(entries[case["name"]])
            if not entry["pass"]:
                report["failures"] += 1
            report["results"].append(entry)
            flag = "ok" if entry["pass"] else "FAIL"
            shown = entry.get("changed")
            print(f"[{case['name']:24}] {flag:4} worst={shown} over {len(entry['runs'])} run(s) "
                  f"tol={entry['tolerance']}")

    # The report-level bound is the bound implied by n consecutive CLEAN runs, so
    # it only exists when there were n of them. It used to be stored at report
    # construction from `--repeat` alone, which put `"flake_bound_95": 0.072158`
    # and "40 consecutive clean runs put a 95% upper bound of 7.2%" into an off40
    # report carrying two 🔴 FAIL rows.
    report["flake_bound_95"] = (
        round(flake_bound(args.repeat), 6) if report["failures"] == 0 else None
    )

    write_report(report, out_dir)
    print(f"\n{len(report['results'])} case(s), {report['failures']} failure(s). "
          f"Report + images in {out_dir}")
    return 1 if report["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
