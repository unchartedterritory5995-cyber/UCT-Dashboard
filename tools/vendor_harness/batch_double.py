"""A RECORDING DOUBLE of the TradingView page, and the batch's `--self-check`.

⛔ WHY A DOUBLE AT ALL. The batch drives the owner's own TradingView account and
cannot be run here (nobody can sign in, and must not try). So everything the
driver does is proved against THIS: an object with the Playwright page surface
the driver uses (`evaluate`, `mouse`, `keyboard`, `context.request`, `goto`,
`wait_for_timeout`) that answers each of the driver's page snippets the way the
procedure says TradingView does, keeps a chart/editor/study state machine, and
RECORDS every call.

⛔ IT KNOWS EACH SNIPPET BY ITS EXACT TEXT. An expression it has not been taught
raises — so a snippet edited in `batch_capture.py` (or the imported `_gate` /
`AUTH_JS` / `BINDING_JS` changing) fails the self-check loudly instead of being
answered by a stale guess.

⭐ ITS CAPTURES ARE REAL v1 CAPTURES. It serialises exactly like the page's
`JSON.stringify` (integral numbers written as integers, no spaces), seals them
with the same FNV-1a over UTF-16 code units, and chunks them the same way — and
the self-check assembles them with the REAL `verify_capture.mjs`. A double whose
transport disagreed with the page's would fail there, not pass.

It does NOT prove: that TradingView's current DOM still has the script-title
menu, the Pine editor launcher or the chart handles where the snippets look.
`batch_capture.py recon` reads those, live, before a batch.
"""
from __future__ import annotations

import base64
import hashlib
import json
import pathlib
import sys
import tempfile

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))

import batch_capture as bc  # noqa: E402
from pine_vendor_capture import AUTH_JS, LAYOUT, STRANGER_MARKER  # noqa: E402

GATE_EXPR = "() => ({vis: document.visibilityState, w: innerWidth, h: innerHeight})"
TV_CAPTURE_TEXT = bc.TV_CAPTURE.read_text(encoding="utf-8")
FIRST_BAR = 1711027800          # 2024-03-21 09:30 ET — RDDT's listing session
DAY = 86400
BARS = 40


class SimulatedCrash(BaseException):
    """A process death, not an error: BaseException, so no `except Exception`
    in the driver can swallow it — exactly like a killed process."""


# ─── the page's JSON and hash, reproduced ────────────────────────────────────
def _num(x):
    if isinstance(x, float) and x.is_integer():
        return int(x)
    return x


def js_stringify(obj) -> str:
    """`JSON.stringify(obj)` for the values this double builds (ints, finite
    non-integral floats, strings, bools, null, lists, dicts)."""
    def norm(v):
        if isinstance(v, dict):
            return {k: norm(w) for k, w in v.items()}
        if isinstance(v, (list, tuple)):
            return [norm(w) for w in v]
        return _num(v)
    return json.dumps(norm(obj), separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def utf16_len(s: str) -> int:
    return len(s.encode("utf-16-le")) // 2


def fnv1a16(s: str) -> int:
    h = 2166136261
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def declared_title(src: str):
    import re
    m = re.search(r'\bindicator\s*\(\s*(?:title\s*=\s*)?"([^"]*)"', src or "")
    return m.group(1) if m else None


# ─── the double ──────────────────────────────────────────────────────────────
class _Resp:
    def __init__(self, status, body, url):
        self.status, self._body, self.url = status, body, url

    def text(self):
        return self._body


class _Request:
    def __init__(self, page):
        self.page = page

    def get(self, url):
        self.page._log("request", "layout_access", url)
        if self.page.signed_in:
            return _Resp(200, "<html><title>UCT CAPTURE RIG</title></html>", url)
        return _Resp(403, f"<html><title>{STRANGER_MARKER}</title></html>", url)


class _Ctx:
    def __init__(self, page):
        self.request = _Request(page)


class _Mouse:
    def __init__(self, page):
        self.page = page

    def click(self, x, y):
        self.page._pointer("click", x, y)

    def move(self, x, y):
        self.page._pointer("move", x, y)


class _Keyboard:
    def __init__(self, page):
        self.page = page

    def press(self, key):
        self.page._log("press", key, None)
        if key == "Escape":
            self.page.menu = None


TITLE_XY = (300.0, 100.0)
CREATE_XY = (320.0, 140.0)
INDICATOR_XY = (480.0, 140.0)


def _near(a, b, tol=12):
    return abs(a[0] - b[0]) <= tol and abs(a[1] - b[1]) <= tol


class RecordingTVPage:
    """behaviours: {source sha256 -> dict} with any of
         compile_error: str   the study's status().type becomes 3 with this message
         never_computes: True the study's rows stay 0
         crash_at: 'vh_capture' | 'add' | 'set_source'   raise SimulatedCrash there
         capture_error: str   __uctVH.capture throws this
         bind_before_add: True the binding flips to "Update on chart" right after
                               the buffer write (the in-evaluation gate must catch it)
       stays_bound: set of create-new ORDINALS (1-based) after which the editor
         stays bound — the measured hazard: a fresh model, and still "Update on chart".
    """

    def __init__(self, behaviours=None, stays_bound=(), symbol="NASDAQ:AAPL", resolution="5",
                 studies=None, signed_in=True, visible=True):
        self.behaviours = behaviours or {}
        self.stays_bound = set(stays_bound)
        self.symbol, self.resolution = symbol, resolution
        self.panes = [1.0]
        self.studies = list(studies or [])     # dicts: id, name, sha, source, reads
        self.signed_in, self.visible = signed_in, visible
        self.editor_open = False
        self.models = []
        self.buffers = {}
        self.bound = "update"                  # the editor starts bound to the last add
        self.menu = None
        self.create_count = 0
        self.next_id = 100
        self.injected = False
        self.globals = set()
        self.staged = None
        self.crashed = False
        self.t = 0.0
        self.calls = []
        self.adds = []                         # (bound state, clicked) at every ADD evaluation
        self.mouse, self.keyboard, self.context = _Mouse(self), _Keyboard(self), _Ctx(self)
        self._by_expr = {
            GATE_EXPR: ("gate", self._gate), AUTH_JS: ("auth", self._auth),
            TV_CAPTURE_TEXT: ("inject", self._inject),
            bc.STATE_JS: ("STATE", self._state), bc.SET_SYMBOL_JS: ("SET_SYMBOL", self._set_symbol),
            bc.SET_RESOLUTION_JS: ("SET_RESOLUTION", self._set_resolution),
            bc.SET_STRETCH_JS: ("SET_STRETCH", self._set_stretch),
            bc.EDITOR_PRESENT_JS: ("EDITOR_PRESENT", lambda a: self.editor_open),
            bc.OPEN_EDITOR_JS: ("OPEN_EDITOR", self._open_editor), bc.MODELS_JS: ("MODELS", self._models),
            bc.TITLE_JS: ("TITLE", self._title), bc.MENU_ITEM_JS: ("MENU_ITEM", self._menu_item),
            bc.BINDING_JS: ("BINDING", self._binding), bc.SET_SOURCE_JS: ("SET_SOURCE", self._set_source),
            bc.ADD_JS: ("ADD", self._add), bc.STUDY_JS: ("STUDY", self._study), bc.DEPTH_JS: ("DEPTH", self._depth),
            bc.REMOVE_JS: ("REMOVE", self._remove), bc.VH_STUDIES_JS: ("VH_STUDIES", self._vh_studies),
            bc.VH_CAPTURE_JS: ("VH_CAPTURE", self._vh_capture), bc.VH_CHUNK_JS: ("VH_CHUNK", self._vh_chunk),
            bc.VH_CLEANUP_JS: ("VH_CLEANUP", self._vh_cleanup), bc.GLOBALS_JS: ("GLOBALS", self._globals),
        }

    # ── recording ───────────────────────────────────────────────────────────
    def _log(self, kind, name, arg):
        self.calls.append((kind, name, arg))

    def _check_alive(self):
        if self.crashed:
            raise SimulatedCrash("the process is gone")

    def names(self, kind="evaluate"):
        return [n for k, n, _ in self.calls if k == kind]

    # ── the Playwright surface ──────────────────────────────────────────────
    def evaluate(self, expr, arg=None):
        self._check_alive()
        if expr not in self._by_expr:
            raise AssertionError(f"the double was not taught this expression: {expr[:90]!r}")
        name, fn = self._by_expr[expr]
        self._log("evaluate", name, arg if name not in ("SET_SOURCE", "VH_CAPTURE") else "…")
        return fn(arg)

    def wait_for_timeout(self, ms):
        self._check_alive()
        self._log("wait", "wait_for_timeout", ms)
        self.t += ms / 1000.0

    def goto(self, url, **kw):
        self._check_alive()
        self._log("goto", url, None)

    def _pointer(self, kind, x, y):
        self._check_alive()
        self._log(kind, f"{x:.0f},{y:.0f}", None)
        p = (x, y)
        if kind == "click":
            if _near(p, TITLE_XY) and self.editor_open:
                self.menu = "title"
            elif _near(p, INDICATOR_XY) and self.menu == "create":
                self._create_new()
                self.menu = None
            else:
                self.menu = None
        elif kind == "move" and _near(p, CREATE_XY) and self.menu in ("title", "create"):
            self.menu = "create"

    # ── state machine ───────────────────────────────────────────────────────
    def _beh(self, sha):
        return self.behaviours.get(sha) or {}

    def _maybe_crash(self, where, sha):
        if self._beh(sha).get("crash_at") == where:
            self.crashed = True
            raise SimulatedCrash(f"simulated process death at {where}")

    def _create_new(self):
        self.create_count += 1
        uri = f"file:///uctvh-{self.create_count}.pine"
        self.models.append(uri)
        self.buffers[uri] = '//@version=6\nindicator("My script")\nplot(close)\n'
        self.current = uri
        self.bound = "update" if self.create_count in self.stays_bound else "add"

    def _gate(self, _):
        return {"vis": "visible" if self.visible else "hidden", "w": 1440, "h": 900}

    def _auth(self, _):
        return {"signedOut": [], "signedIn": ["header-user-menu-toggle"], "ambiguous": [], "title": "rig"}

    def _state(self, _):
        return {"handle": "TradingViewApi", "vis": "visible" if self.visible else "hidden",
                "symbol": self.symbol, "resolution": self.resolution,
                "studies": [{"id": s["id"], "name": s["name"]} for s in self.studies], "panes": list(self.panes)}

    def _set_symbol(self, s):
        self.symbol = s
        return {"ok": True}

    def _set_resolution(self, r):
        self.resolution = r
        return {"ok": True}

    def _set_stretch(self, f):
        self.panes = list(f)
        return {"ok": True}

    def _open_editor(self, _):
        if self.editor_open:
            return {"open": True, "clicked": False}
        self.editor_open = True
        if not self.models:                      # the editor opens on whatever it held last
            self.models.append("file:///seed.pine")
            self.buffers["file:///seed.pine"] = '//@version=6\nindicator("owner script")\nplot(close)\n'
            self.current = "file:///seed.pine"
        return {"open": False, "clicked": True}

    def _models(self, _):
        return {"ok": True, "seen": 20353, "uris": list(self.models)}

    def _title(self, sel):
        if not self.editor_open:
            return {"ok": False, "why": "no editor"}
        return {"ok": True, "x": TITLE_XY[0], "y": TITLE_XY[1], "text": "Untitled script", "how": "heuristic"}

    def _menu_item(self, a):
        if a.get("text") == "Create new" and self.menu in ("title", "create"):
            return {"ok": True, "x": CREATE_XY[0], "y": CREATE_XY[1],
                    "rect": {"left": 280, "right": 360, "top": 130, "bottom": 150}}
        if a.get("text") == "Indicator" and self.menu == "create" and a.get("rightOf"):
            return {"ok": True, "x": INDICATOR_XY[0], "y": INDICATOR_XY[1],
                    "rect": {"left": 440, "right": 520, "top": 130, "bottom": 150}}
        return {"ok": False, "found": 0}

    def _binding(self, _):
        add = 1 if self.editor_open and self.bound == "add" else 0
        upd = 1 if self.editor_open and self.bound == "update" else 0
        return {"addToChart": add, "updateOnChart": upd, "gate": add == 1 and upd == 0}

    def _set_source(self, a):
        gate = self._binding(None)
        if not self.visible or not gate["gate"]:
            return {"STOP": True, "vis": "visible" if self.visible else "hidden", "gate": gate}
        text = base64.b64decode(a["b64"]).decode("utf-8")
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        self._maybe_crash("set_source", sha)
        if a["uri"] not in self.buffers:
            return {"ok": False, "why": f"no editor holds {a['uri']}"}
        self.buffers[a["uri"]] = text
        self.current = a["uri"]
        if self._beh(sha).get("bind_before_add"):
            self.bound = "update"
        return {"ok": True, "seen": 20353, "chars": utf16_len(text), "sha256": sha}

    def _add(self, _):
        gate = self._binding(None)
        if not self.visible or not gate["gate"]:
            self.adds.append((self.bound, False))
            return {"STOP": True, "vis": "visible", "gate": gate}
        src = self.buffers[self.current]
        sha = hashlib.sha256(src.encode("utf-8")).hexdigest()
        self._maybe_crash("add", sha)
        self.adds.append((self.bound, True))
        self.next_id += 1
        self.studies.append({"id": f"st{self.next_id}", "name": declared_title(src) or "Untitled",
                             "sha": sha, "source": src, "reads": 0})
        self.bound = "update"        # every add binds the editor (capture-procedure.md, S5)
        return {"clicked": True, "vis": "visible", "gate": gate}

    def _find(self, sid):
        return next((s for s in self.studies if s["id"] == sid), None)

    def _study(self, sid):
        s = self._find(sid)
        if not s:
            return {"found": False}
        s["reads"] += 1
        b = self._beh(s["sha"])
        if b.get("compile_error"):
            return {"found": True, "rows": 0,
                    "status": {"type": 3, "error": b["compile_error"], "title": "Compilation error"}}
        if b.get("never_computes"):
            return {"found": True, "rows": 0, "status": {"type": 2, "error": None, "title": None}}
        return {"found": True, "rows": 0 if s["reads"] == 1 else BARS,
                "status": {"type": 2, "error": None, "title": None}}

    def _depth(self, n):
        return {"ok": True, "asked": n > 0, "count": BARS, "first": FIRST_BAR, "tz": "America/New_York"}

    def _remove(self, sid):
        before = len(self.studies)
        self.studies = [s for s in self.studies if s["id"] != sid]
        return {"ok": len(self.studies) < before, **({} if len(self.studies) < before else {"why": "no such id"})}

    def _inject(self, _):
        self.injected = True
        self.globals.add("__uctVH")
        return "uct vendor harness ready: __uctVH.studies(), .capture({study, source, …}), .chunk(i), .cleanup()"

    def _need_vh(self):
        if not self.injected:
            raise AssertionError("__uctVH used before tv_capture.js was injected")

    def _vh_studies(self, _):
        self._need_vh()
        return {"studies": len(self.studies) + 2, "events": ["Splits", "Earnings"], "indicators": len(self.studies),
                "controlProbeSawSomething": True, "controlFilterRemovedExactlyTheEvents": True,
                "list": [{"id": "Script$USER;787899e2", "shortId": "Script$USER;787899e2",
                          "title": s["name"], "description": s["name"]} for s in self.studies]}

    def _vh_capture(self, o):
        self._need_vh()
        hits = [s for s in self.studies if o["study"] in s["name"]]
        if len(hits) != 1:
            return {"ok": False, "error": f"study {json.dumps(o['study'])} matched {len(hits)} indicators — need exactly one."}
        s = hits[0]
        self._maybe_crash("vh_capture", s["sha"])
        if self._beh(s["sha"]).get("capture_error"):
            return {"ok": False, "error": self._beh(s["sha"])["capture_error"]}
        body = self._capture_body(o, s)
        text0 = js_stringify(body)
        sealed = {**body, "receipt": {"algo": "fnv1a32-utf16",
                                      "over": "JSON.stringify(capture without its receipt key)",
                                      "chars": utf16_len(text0), "fnv1a": fnv1a16(text0)}}
        text = js_stringify(sealed)
        size = o.get("chunkSize") if isinstance(o.get("chunkSize"), int) and o["chunkSize"] > 1000 else 60000
        n = -(-len(text) // size)
        self.staged = {"text": text, "size": size, "n": n}
        return {"ok": True, "summary": {"ok": True, "id": body["id"], "study": s["name"], "symbol": "NYSE:RDDT",
                                        "timeframe": "D", "bars": BARS, "studyRows": BARS,
                                        "plots": ["plot_0:line:Plot"], "objects": None, "warnings": [],
                                        "chars": utf16_len(text), "fnv1a": fnv1a16(text),
                                        "chunkSize": size, "chunks": n}}

    def _capture_body(self, o, s):
        bars = [[FIRST_BAR + i * DAY, (20 + i) / 2, (22 + i) / 2, (19 + i) / 2, (21 + i) / 2, 1000 + 7 * i]
                for i in range(BARS)]
        # ⭐ The double "computes" `plot(close)` honestly (the close column), so a
        # graded self-check run has a real MATCH (alpha) beside real DIVERGEs —
        # the grade step is proved able to say both.
        vals = [[b[0], b[4]] for b in bars]
        src = o["source"]
        return {
            "schema": "uct.vendor-capture/v1", "id": o.get("id") or "capture",
            "capturedAtUTC": "2026-09-28T21:00:00.000Z",
            "tool": {"snippet": "tools/vendor_harness/tv_capture.js", "version": 1},
            "page": {"url": LAYOUT, "visibilityState": "visible", "hasFocus": True},
            "symbol": {"name": "RDDT", "full_name": "NYSE:RDDT", "pro_name": "NYSE:RDDT", "exchange": "NYSE",
                       "listed_exchange": "NYSE", "type": "stock", "session": "0930-1600",
                       "timezone": "America/New_York", "pricescale": 100, "minmov": 1, "currency": "USD"},
            "timeframe": "D",
            "newestBarIsForming": o.get("newestBarIsForming") if isinstance(o.get("newestBarIsForming"), bool) else None,
            "history": {"startsAtBar0": o.get("startsAtBar0") is True,
                        "why": (o.get("startsAtBar0Why") or "asserted by the capturer") if o.get("startsAtBar0") is True else "not asserted"},
            "source": {"text": src, "sha256": hashlib.sha256(src.encode("utf-8")).hexdigest(),
                       "chars": utf16_len(src), "declaredTitle": declared_title(src)},
            "census": {"studies": len(self.studies) + 2, "events": ["Splits", "Earnings"],
                       "indicators": len(self.studies), "controlProbeSawSomething": True,
                       "controlFilterRemovedExactlyTheEvents": True},
            "study": {"id": "Script$USER;787899e2@tv-scripting-101", "fullId": None, "title": s["name"],
                      "description": s["name"], "shortDescription": s["name"], "status": {"type": 2},
                      "plots": [{"id": "plot_0", "type": "line", "title": "Plot"}],
                      "styles": {"plot_0": {"title": "Plot"}}, "styleState": None, "palettes": {},
                      "paletteState": None, "inputs": []},
            "window": {"chartBarsLoaded": BARS, "studyBarsLoaded": BARS,
                       "firstBarTime": bars[0][0], "lastBarTime": bars[-1][0]},
            "bars": {"fields": ["time", "open", "high", "low", "close", "volume"], "timeUnit": "unix-s",
                     "count": BARS, "rows": bars},
            "plotValues": {"fields": ["time", "plot_0"], "rows": vals},
            "objects": None,
            "warnings": [],
        }

    def _vh_chunk(self, i):
        self._need_vh()
        st = self.staged
        text = st["text"][i * st["size"]:(i + 1) * st["size"]]
        return js_stringify({"i": i, "n": st["n"], "text": text, "fnv1a": fnv1a16(text),
                             "total": {"chars": utf16_len(st["text"]), "fnv1a": fnv1a16(st["text"])}})

    def _vh_cleanup(self, _):
        self.staged = None
        self.injected = False
        self.globals.discard("__uctVH")
        return {"globalsLeft": sorted(self.globals & {"__uctVH"})}

    def _globals(self, _):
        return sorted(self.globals)


class FakeClock:
    """Virtual time shared with the double; every sleep is recorded."""

    def __init__(self, page):
        self.page = page
        self.sleeps = []

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.page.t += seconds

    def monotonic(self):
        return self.page.t


# ─── scenarios ───────────────────────────────────────────────────────────────
SCRIPTS = [
    ("alpha", 'indicator("Alpha")\nplot(close)\n', {}),
    ("bravo", 'indicator("Bravo")\nplot(fooo)\n', {"compile_error": 'Undeclared identifier "fooo"'}),
    ("charlie", 'indicator("Charlie")\nplot(open)\n', {}),       # its create-new stays bound (ordinal 3)
    ("delta", 'indicator("Delta")\nplot(high)\n', {"never_computes": True}),
    ("echo", 'indicator("Echo")\nplot(low)\n', {"crash_at": "vh_capture"}),
]


def make_manifest(tmp: pathlib.Path, scripts=SCRIPTS):
    src_dir = tmp / "src"
    src_dir.mkdir(parents=True, exist_ok=True)
    rows, beh = [], {}
    for slug, text, b in scripts:
        p = src_dir / f"{slug}.pine"
        p.write_bytes(text.encode("utf-8"))
        sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
        rows.append({"slug": slug, "path": str(p), "sha256": sha, "bytes": len(text), "plots": 1,
                     "drawsObjects": False, "largestWindow": 20})
        beh[slug] = (sha, b)
    return {"schema": "uct.vendor-batch-manifest/v1", "scripts": rows}, beh


def fast_opts(**kw):
    base = dict(symbol="NYSE:RDDT", tf="1D", throttle_s=30, compute_timeout_s=20, add_timeout_s=5,
                ui_timeout_s=5, settle_s=1, poll_s=1, depth_rounds=6, chunk_size=1500,
                newest_bar_forming="false", date="2026-09-28")
    base.update(kw)
    return bc.Opts(**base)


def run(page, manifest, run_dir, opts=None, verifier=None, **kw):
    """The session a live run has: sign-in acquisition, then the batch."""
    from pine_vendor_capture import acquire
    clock = FakeClock(page)
    rd = bc.RunDir(run_dir, "selfcheck")
    assert acquire(page, 5) == 0
    code = bc.run_batch(page, manifest, rd, opts or fast_opts(), clock, verifier or bc.NodeVerifier(),
                        log=lambda *a: None, **kw)
    return code, rd, clock


def first_run(tmp: pathlib.Path):
    """Run 1: alpha CAPTURED, bravo REFUSED_BY_TV, charlie GATE_FAILED, delta
    INCONCLUSIVE, echo — the process dies mid-script."""
    manifest, beh = make_manifest(tmp)
    page = RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, stays_bound={3})
    crashed = None
    try:
        run(page, manifest, tmp / "run")
    except SimulatedCrash as exc:
        crashed = exc
    return manifest, beh, page, crashed


def resume_run(tmp: pathlib.Path, manifest, beh, page1):
    """Run 2 on the same run dir: a fresh browser whose chart still holds the
    study the dead process added, nothing misbehaving any more."""
    leftovers = [dict(s, reads=0) for s in page1.studies]
    # the owner left the chart on another symbol and timeframe since
    page2 = RecordingTVPage(behaviours={}, studies=leftovers, symbol="NASDAQ:AAPL", resolution="5")
    page2.next_id = page1.next_id
    code, rd, clock = run(page2, manifest, tmp / "run")
    return page2, code, rd, clock


def self_check() -> int:
    checks = []

    def check(name, cond, detail=""):
        checks.append((name, bool(cond)))
        print(f"  [{'PASS' if cond else 'FAIL'}] {name}{(' — ' + detail) if detail and not cond else ''}")

    print("[self-check] the whole batch loop against a recording double (no network, no TradingView)")
    with tempfile.TemporaryDirectory(prefix="vhbatch-selfcheck-") as td:
        tmp = pathlib.Path(td)
        manifest, beh, page1, crashed = first_run(tmp)
        rd = bc.RunDir(tmp / "run", "selfcheck")
        res = rd.results()
        check("a mid-script process death propagates (it is not swallowed)", crashed is not None)
        check("alpha -> CAPTURED", res.get("alpha", {}).get("outcome") == bc.CAPTURED, str(res.get("alpha")))
        check("bravo -> REFUSED_BY_TV with TradingView's message",
              res.get("bravo", {}).get("outcome") == bc.REFUSED_BY_TV and "fooo" in res["bravo"].get("reason", ""))
        check("charlie -> GATE_FAILED (binding)", res.get("charlie", {}).get("outcome") == bc.GATE_FAILED
              and "binding gate" in res["charlie"].get("reason", ""))
        check("delta -> INCONCLUSIVE (never computed)", res.get("delta", {}).get("outcome") == bc.INCONCLUSIVE)
        check("echo -> INCOMPLETE, the claim written before its first step",
              res.get("echo", {}).get("outcome") == bc.INCOMPLETE)
        check("the binding-gate failure never clicked `Add to chart` (4 adds for 5 scripts, none bound)",
              len(page1.adds) == 4 and all(clicked and bound == "add" for bound, clicked in page1.adds)
              and "add" not in res.get("charlie", {}).get("steps", []), str(page1.adds))
        cap = res.get("alpha", {}).get("capture")
        v = bc.NodeVerifier().verify_file(pathlib.Path(cap)) if cap else {"ok": False}
        check("the captured file is a verified uct.vendor-capture/v1 (real verify_capture.mjs)", v["ok"], str(v))
        for slug in ("alpha", "bravo", "delta"):
            check(f"cleanup removed {slug}'s study", res.get(slug, {}).get("cleanup", {}).get("removed"))
        check("cleanup always ran, and left no globals",
              all(r.get("cleanup", {}).get("ok") for s, r in res.items() if s != "echo"))
        page2, code, rd2, clock2 = resume_run(tmp, manifest, beh, page1)
        res2 = rd2.results()
        led = [json.loads(ln) for ln in (tmp / "run" / "ledger.jsonl").read_text(encoding="utf-8").splitlines()]
        skipped = {e["slug"] for e in led if e["event"] == "skip"}
        check("resume skips the verified capture and the TradingView refusal", {"alpha", "bravo"} <= skipped)
        check("resume retries INCOMPLETE / INCONCLUSIVE / GATE_FAILED and captures them",
              all(res2.get(s, {}).get("outcome") == bc.CAPTURED for s in ("charlie", "delta", "echo")))
        check("the dead process's orphan study was recognised by its recorded id and removed",
              any(e["event"] == "orphan-removed" for e in led) and not page2.studies)
        check("the throttle ran between processed scripts only",
              clock2.sleeps.count(30) == 2, str(clock2.sleeps))
        check("the chart was put back where it was found (symbol and resolution)",
              page2.symbol == "NASDAQ:AAPL" and page2.resolution == "5" and code == 0,
              f"{page2.symbol} {page2.resolution} exit {code}")
    ok = all(c for _, c in checks)
    print(f"[self-check] {sum(c for _, c in checks)}/{len(checks)} checks passed")
    print(f"VERDICT: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(self_check())
