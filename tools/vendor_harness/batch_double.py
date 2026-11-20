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
        # ⭐ (2026-11-20) UCT's own API through the rig's browser context: the automation account's session and the
        # listing answers production gives (`batch_capture.uct_first_trade_date`, a public GET); `page.ipo` steers it
        if url.startswith(bc.UCT_ORIGIN + "/api/"):
            self.page._log("request", "uct_api", url)
            path = url[len(bc.UCT_ORIGIN):]
            if path.startswith("/api/ticker-ipo/"):
                t = path.rsplit("/", 1)[-1]
                row = self.page.ipo.get(t)
                if row is None:
                    return _Resp(404, json.dumps({"detail": "not found"}), url)
                return _Resp(200, json.dumps({"symbol": t, **row}), url)
            return _Resp(404, "{}", url)
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
            self.page.dialog = False
        if key == bc.SAVE_SHORTCUT:
            # the layout's own Save: the persisted copy becomes the page as it is now (the guarded clean-save)
            self.page.persisted = {"studies": json.loads(json.dumps(self.page.studies)),
                                   "symbol": self.page.symbol, "resolution": self.page.resolution}
            self.page.saved_word = True


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
         input_defaults: {id: value}  the study's input defaults (what `defval` records)
         palette: [colour]     the study's own palette colours (metaInfo defaults)
         inputs_reject: True   setInputValues takes nothing (the read-back disagrees)
         palette_lags: True    a moved colour never reaches the LIVE palette
         palette_after_sets: n  the moved colour reaches it only once the inputs were set n times
       builtins (page attribute): {data-id: [{"title", "inputs": {label: input id}}]} —
         the Indicators dialog's list (two entries for one id: an ambiguous dialog)
       stays_bound: set of create-new ORDINALS (1-based) after which the editor
         stays bound — the measured hazard: a fresh model, and still "Update on chart".
    """

    def __init__(self, behaviours=None, stays_bound=(), symbol="NASDAQ:AAPL", resolution="5",
                 studies=None, signed_in=True, visible=True, autosave=None, persisted=None, attach_delay_s=0.0):
        # ⭐ THE LAYOUT'S PERSISTED COPY, what a fresh load reads (`reload`). None: a fresh load reads the page as
        # it is. autosave="tradingview": the MEASURED rig (2026-11-18): an editor add saves the layout as it is
        # then; a widget-API removal or resolution change is never saved.
        self.autosave = autosave
        self.persisted = json.loads(json.dumps(persisted)) if persisted is not None else None
        # ⭐ A SLOW ATTACH (2026-11-19, htfform-c): after a fresh load the chart handle answers at once, with 0 studies,
        # and the layout's saved studies attach `attach_delay_s` (virtual) seconds later. 0: they are there at once.
        self.attach_delay_s = float(attach_delay_s)
        # ⭐ (2026-11-20) the chart's session (the rig layout's: regular), and whether a session spec is honoured
        self.session_id = "regular"
        self.honours_session = True
        # ⭐ UCT's answers through the rig's browser context: `/api/ticker-ipo` per ticker as
        # production answers it (measured 2026-11-19: RDDT 2024-03-21 and ALAB 2024-03-20, both final)
        self.ipo = {"RDDT": {"first_trade_date": "2024-03-21", "first_trade_final": True},
                    "ALAB": {"first_trade_date": "2024-03-20", "first_trade_final": True}}
        self.attach_at = None
        self.behaviours = behaviours or {}
        self.stays_bound = set(stays_bound)
        self.symbol, self.resolution = symbol, resolution
        self.panes = [1.0]
        self.studies = list(studies or [])     # dicts: id, name, sha, source, reads
        self.signed_in, self.visible = signed_in, visible
        self.account = "rig-test-user"           # what ACCOUNT_JS reads (provenance only)
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
        # ⭐⭐ (folded 2026-11-20) the study API's inputs, the Indicators dialog, and what was picked / set there
        self.builtins = {}
        self.dialog = False
        self.picks = []
        self.input_calls = []
        self.mouse, self.keyboard, self.context = _Mouse(self), _Keyboard(self), _Ctx(self)
        self._by_expr = {
            GATE_EXPR: ("gate", self._gate), AUTH_JS: ("auth", self._auth),
            TV_CAPTURE_TEXT: ("inject", self._inject),
            bc.STATE_JS: ("STATE", self._state), bc.SET_SYMBOL_JS: ("SET_SYMBOL", self._set_symbol),
            bc.SESSION_JS: ("SESSION", self._session),
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
            bc.ACCOUNT_JS: ("ACCOUNT", lambda a: self.account),
            bc.SAVED_TEXT_JS: ("SAVED_TEXT", lambda a: bool(getattr(self, "saved_word", False))),
            bc.FOCUS_BODY_JS: ("FOCUS_BODY", lambda a: getattr(self, "focus_leaves", True)),
            bc.INPUTS_JS: ("INPUTS", self._inputs), bc.PALETTE_JS: ("PALETTE", self._palette),
            bc.BUILTIN_OPEN_JS: ("BUILTIN_OPEN", self._builtin_open), bc.BUILTIN_PICK_JS: ("BUILTIN_PICK", self._builtin_pick),
            bc.BUILTIN_CLOSED_JS: ("BUILTIN_CLOSED", lambda a: not self.dialog),
            bc.BUILTIN_INPUT_IDS_JS: ("BUILTIN_INPUT_IDS", self._builtin_input_ids),
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

    def reload(self, **kw):
        """A fresh load: the page reads the layout's persisted copy (when one is modelled); injected globals are gone."""
        self._check_alive()
        self._log("reload", "reload", None)
        self.injected, self.globals, self.editor_open = False, set(), False
        if self.persisted is not None:
            self.studies = json.loads(json.dumps(self.persisted["studies"]))
            self.symbol, self.resolution = self.persisted["symbol"], self.persisted["resolution"]
        self.attach_at = self.t + self.attach_delay_s if self.attach_delay_s > 0 else None

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
        attached = self.attach_at is None or self.t >= self.attach_at     # a slow attach: 0 studies until then
        return {"handle": "TradingViewApi", "vis": "visible" if self.visible else "hidden",
                "symbol": self.symbol, "resolution": self.resolution,
                "studies": [{"id": s["id"], "name": s["name"]} for s in self.studies] if attached else [],
                "panes": list(self.panes)}

    def _set_symbol(self, s):
        # ⭐ (2026-11-20) a session spec (`={...}`) sets the symbol AND its session, as TradingView does; a plain symbol
        # keeps the chart's session (so a row that named one must put it back). `honours_session` False: a chart that
        # resolves the spec's symbol but not its session (the read-back must catch it)
        if str(s).startswith("="):
            spec = json.loads(str(s)[1:])
            self.symbol = spec.get("symbol")
            if self.honours_session and spec.get("session") in bc.ROW_SESSIONS:
                self.session_id = spec["session"]
        else:
            self.symbol = s
        return {"ok": True}

    def _session(self, _):
        return {"ok": True, "session": bc.ROW_SESSIONS[self.session_id], "subsession": self.session_id}

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
        if self.autosave == "tradingview":
            self.persisted = {"studies": json.loads(json.dumps(self.studies)), "symbol": self.symbol, "resolution": self.resolution}
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

    # ── ⭐⭐ (folded 2026-11-20) the study API's inputs and palettes, and the Indicators dialog ──────────────────────
    def _defaults(self, s):
        return dict(self._beh(s.get("sha")).get("input_defaults") or {})

    def _inputs(self, a):
        s = self._find(a.get("id"))
        if not s:
            return {"ok": False, "why": "study not found"}
        cur = s.setdefault("inputs", self._defaults(s))
        self.input_calls.append(dict(a["inputs"]))
        s["input_sets"] = s.get("input_sets", 0) + 1
        if not self._beh(s.get("sha")).get("inputs_reject"):
            cur.update(a["inputs"])
        if self.autosave == "tradingview":
            # MEASURED (2026-11-16, run rsset): setting inputs marks the layout modified and its autosave keeps the study,
            # inputs and all
            self.persisted = {"studies": json.loads(json.dumps(self.studies)), "symbol": self.symbol, "resolution": self.resolution}
        bad = [{"id": k, "want": v, "got": cur.get(k)} for k, v in a["inputs"].items() if cur.get(k) != v]
        return {"ok": not bad, "bad": bad, "set": len(a["inputs"])}

    def _palette_lags(self, s):
        b = self._beh(s.get("sha"))
        return bool(b.get("palette_lags")) or s.get("input_sets", 0) < int(b.get("palette_after_sets") or 0)

    def _moved_colours(self, s):
        pal, d = self._beh(s.get("sha")).get("palette") or [], self._defaults(s)
        return {k: v for k, v in (s.get("inputs") or {}).items() if d.get(k) in pal and v != d.get(k)}

    def _palette(self, a):
        s = self._find(a.get("id"))
        if not s:
            return {"ok": False, "why": "study not found"}
        pal = self._beh(s.get("sha")).get("palette") or []
        if not pal:
            return {"ok": False, "why": "no palette colours read", "meta": 0, "live": 0}
        moved = sorted(self._moved_colours(s))
        lag = moved if self._palette_lags(s) else []
        return {"ok": True, "lag": lag, "moved": moved, "meta": len(pal), "live": len(pal)}

    def _study_settings(self, s):
        """What tv_capture.js records of the study's settings: its inputs (value and default), the metaInfo palette colours,
        and the LIVE palette state (which holds a moved colour only once TradingView applied it)."""
        b, d = self._beh(s.get("sha")), self._defaults(s)
        cur = {**d, **(s.get("inputs") or {})}
        pal = b.get("palette") or []
        live = list(pal) + ([] if self._palette_lags(s) else list(self._moved_colours(s).values()))
        colours = lambda cs: {"p0": {"colors": {str(i): {"color": c} for i, c in enumerate(cs)}}} if cs else {}
        return {"palettes": colours(pal), "paletteState": colours(live) or None,
                "inputs": [{"id": k, "name": k, "value": v, "defval": d.get(k)} for k, v in cur.items()]}

    def _builtin_open(self, _):
        if self.dialog:
            return {"open": True}
        self.dialog = True
        return {"open": False, "clicked": True}

    def _builtin_pick(self, a):
        if not self.dialog:
            return {"STOP": "no dialog search input"}
        hits = self.builtins.get(a.get("id")) or []
        if len(hits) > 1:
            return {"STOP": f"{len(hits)} elements carry data-id {a.get('id')}"}
        if not hits:
            return {"STOP": f"no element with data-id {a.get('id')} after searching {json.dumps(a.get('search'))}"}
        self.picks.append(a.get("id"))
        self.next_id += 1
        self.studies.append({"id": f"st{self.next_id}", "name": hits[0]["title"], "sha": f"builtin:{a['id']}",
                             "source": None, "reads": 0, "builtin": a["id"]})
        if self.autosave == "tradingview":
            self.persisted = {"studies": json.loads(json.dumps(self.studies)), "symbol": self.symbol, "resolution": self.resolution}
        return {"clicked": True, "title": hits[0]["title"]}

    def _builtin_input_ids(self, sid):
        s = self._find(sid)
        hits = self.builtins.get((s or {}).get("builtin")) or []
        return dict(hits[0].get("inputs") or {}) if hits else {}

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
                       "listed_exchange": "NYSE", "type": "stock", "session": bc.ROW_SESSIONS[self.session_id],
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
                      "styles": {"plot_0": {"title": "Plot"}}, "styleState": None,
                      **self._study_settings(s)},
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
# Every script carries its version header, as a real one does. Since engine 59 a script with no
# `//@version` line is Pine v1, and `indicator(` in it refuses pine:version-missing on our side
# (TradingView rejects it too), so a headerless double graded INCONCLUSIVE for every capture.
SCRIPTS = [
    ("alpha", '//@version=6\nindicator("Alpha")\nplot(close)\n', {}),
    ("bravo", '//@version=6\nindicator("Bravo")\nplot(fooo)\n', {"compile_error": 'Undeclared identifier "fooo"'}),
    ("charlie", '//@version=6\nindicator("Charlie")\nplot(open)\n', {}),       # its create-new stays bound (ordinal 3)
    ("delta", '//@version=6\nindicator("Delta")\nplot(high)\n', {"never_computes": True}),
    ("echo", '//@version=6\nindicator("Echo")\nplot(low)\n', {"crash_at": "vh_capture"}),
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


# ─── ⭐⭐ THE FOLDED STEPS (coordinator ruling 2026-11-20): what the retired scratchpad wrappers added, railed here ─────────
def single_save_path_findings(source: str) -> list:
    """Why `source` (batch_capture.py's text) is NOT a single save path, or []: no code string names TradingView's
    `saveChartToServer` (a direct save, outside the guard), and exactly ONE `...keyboard.press(SAVE_SHORTCUT)` call, inside
    `Driver.guarded_clean_save`. ⛔ CODE, NEVER PROSE: comments are not tokens here, and a docstring is skipped (an
    expression statement that is only a string), so a sentence naming either never counts; a JS string is code and does."""
    import ast
    tree = ast.parse(source)
    docstrings = {id(n.value) for n in ast.walk(tree)
                  if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)}
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in docstrings \
                and "saveChartTo" + "Server" in n.value:
            out.append(f"a code string names saveChartTo{'Server'} (line {n.lineno}): a direct save outside the guard")
    presses = []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for n in ast.walk(fn):
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "press" \
                    and any(isinstance(a, ast.Name) and a.id == "SAVE_SHORTCUT" for a in n.args):
                presses.append((fn.name, n.lineno))
    inner = {}
    for fname, line in presses:           # a nested function's press is also inside its parent: keep the innermost
        inner[line] = fname
    sites = sorted(set(inner.items()))
    if len(sites) != 1:
        out.append(f"{len(sites)} SAVE_SHORTCUT presses, one wanted: {sites}")
    elif sites[0][1] != "guarded_clean_save":
        out.append(f"the one SAVE_SHORTCUT press is in {sites[0][1]}, not guarded_clean_save")
    return out


def folded_run(tmp, name, scripts, page=None, opts=None, rows=None, page_kw=None):
    """One batch over `scripts` (make_manifest's triples) with extra row fields `rows` {slug: {...}}: (code, rd, page)."""
    manifest, beh = make_manifest(tmp / name, scripts)
    for r in manifest["scripts"]:
        r.update((rows or {}).get(r["slug"]) or {})
    if page is None:
        page = RecordingTVPage(behaviours={sha: b for sha, b in beh.values()}, **(page_kw or {}))
    else:
        page.behaviours.update({sha: b for sha, b in beh.values()})
    code, rd, _ = run(page, manifest, tmp / name / "run", opts or fast_opts())
    return code, rd, page, manifest


def _cap(res):
    p = (res or {}).get("capture")
    return json.loads(pathlib.Path(p).read_text(encoding="utf-8")) if p and pathlib.Path(p).exists() else None


def folded_checks(tmp, check):
    # (1) `inputs`: set on the study THIS run added, read back, recorded in the capture
    code, rd, page, _ = folded_run(tmp, "inputs", [("india", '//@version=6\nindicator("India")\nplot(close)\n', {})],
                                   rows={"india": {"inputs": {"in_0": 30}}})
    res = rd.results().get("india", {})
    cap = _cap(res)
    check("an `inputs` row: set through the study API, read back, and the capture records the value",
          res.get("outcome") == bc.CAPTURED and page.input_calls[:1] == [{"in_0": 30}]
          and any(i.get("id") == "in_0" and i.get("value") == 30 for i in ((cap or {}).get("study") or {}).get("inputs") or []),
          f"{res.get('outcome')} {page.input_calls}")
    # (2) `inputsOnePerCall`: one call per input, in order
    code, rd, page, _ = folded_run(tmp, "onepercall", [("juliet", '//@version=6\nindicator("Juliet")\nplot(close)\n', {})],
                                   rows={"juliet": {"inputs": {"in_0": 1, "in_1": 2}, "inputsOnePerCall": True}})
    check("`inputsOnePerCall`: one setInputValues per input, each its own call",
          rd.results().get("juliet", {}).get("outcome") == bc.CAPTURED
          and page.input_calls[:2] == [{"in_0": 1}, {"in_1": 2}], str(page.input_calls))
    # (3) an input that does not read back: INCONCLUSIVE, nothing captured
    code, rd, page, _ = folded_run(tmp, "reject", [("kilo", '//@version=6\nindicator("Kilo")\nplot(close)\n',
                                                     {"inputs_reject": True})], rows={"kilo": {"inputs": {"in_0": 30}}})
    res = rd.results().get("kilo", {})
    check("an input TradingView does not read back -> INCONCLUSIVE, no capture file",
          res.get("outcome") == bc.INCONCLUSIVE and "could not be set as asked" in str(res.get("reason"))
          and not list((tmp / "reject" / "run" / "captures").glob("*.json")), str(res.get("reason")))
    # (4) a moved colour the LIVE palette never holds: the capture is set aside, INCONCLUSIVE
    colour = {"input_defaults": {"in_0": "#FF5252"}, "palette": ["#FF5252", "#2196F3"]}
    code, rd, page, _ = folded_run(tmp, "lag", [("lima", '//@version=6\nindicator("Lima")\nplot(close)\n',
                                                 {**colour, "palette_lags": True})], rows={"lima": {"inputs": {"in_0": "#4CAF50"}}})
    res = rd.results().get("lima", {})
    check("a moved colour the live palette does not hold -> INCONCLUSIVE, the file set aside (captures-refused/)",
          res.get("outcome") == bc.INCONCLUSIVE and "live palette" in str(res.get("reason"))
          and list((tmp / "lag" / "run" / "captures-refused").glob("*.json"))
          and not list((tmp / "lag" / "run" / "captures").glob("*.json")), str(res.get("reason")))
    code, rd, page, _ = folded_run(tmp, "synced", [("mike", '//@version=6\nindicator("Mike")\nplot(close)\n', colour)],
                                   rows={"mike": {"inputs": {"in_0": "#4CAF50"}}})
    check("⛔ CONTROL: the same moved colour, held by the live palette -> CAPTURED",
          rd.results().get("mike", {}).get("outcome") == bc.CAPTURED, str(rd.results().get("mike", {}).get("reason")))
    code, rd, page, _ = folded_run(tmp, "reset", [("mike2", '//@version=6\nindicator("Mike2")\nplot(close)\n',
                                                   {**colour, "palette_after_sets": 2})], rows={"mike2": {"inputs": {"in_0": "#4CAF50"}}})
    check("a live palette that takes the moved colour only on the SECOND set: the inputs are set once more, then CAPTURED",
          rd.results().get("mike2", {}).get("outcome") == bc.CAPTURED and len(page.input_calls) == 2,
          f"{rd.results().get('mike2', {}).get('reason')} {page.input_calls}")
    # (5) a built-in: no editor step, the dialog's element picked by its EXACT data-id, its labelled input set
    label = "TradingView built-in: Detrended Price Oscillator (STD;DPO), added from the Indicators dialog\n"
    dpo = {"STD;DPO": [{"title": "Detrended Price Oscillator", "inputs": {"Centered": "in_3"}}]}
    page = RecordingTVPage()
    page.builtins = dpo
    code, rd, page, _ = folded_run(tmp, "builtin", [("nov", label, {})], page=page, rows={"nov": {
        "builtin": {"id": "STD;DPO", "search": "Detrended", "title": "Detrended Price Oscillator"},
        "builtinInputs": {"Centered": True}}})
    names = set(page.names())
    check("a `builtin` row: added from the dialog by its exact data-id, no editor step, its labelled input set",
          rd.results().get("nov", {}).get("outcome") == bc.CAPTURED and page.picks == ["STD;DPO"]
          and not names & {"OPEN_EDITOR", "MODELS", "TITLE", "BINDING", "SET_SOURCE", "ADD"}
          and page.input_calls == [{"in_3": True}], f"{rd.results().get('nov', {}).get('reason')} {page.picks} {sorted(names)}")
    page = RecordingTVPage()
    page.builtins = {"STD;DPO": dpo["STD;DPO"] * 2}
    code, rd, page, _ = folded_run(tmp, "builtin2", [("oscar", label, {})], page=page,
                                   rows={"oscar": {"builtin": {"id": "STD;DPO", "search": "Detrended"}}})
    check("a built-in whose data-id names TWO elements -> GATE_FAILED, nothing clicked, no study added",
          rd.results().get("oscar", {}).get("outcome") == bc.GATE_FAILED and page.picks == [] and not page.studies,
          str(rd.results().get("oscar", {}).get("reason")))
    page = RecordingTVPage()
    page.builtins = dpo
    code, rd, page, _ = folded_run(tmp, "builtin3", [("papa", label, {})], page=page, rows={"papa": {
        "builtin": {"id": "STD;DPO", "search": "Detrended"}, "builtinInputs": {"No such label": 1}}})
    check("a built-in input LABEL the study does not have -> GATE_FAILED, nothing set",
          rd.results().get("papa", {}).get("outcome") == bc.GATE_FAILED and page.input_calls == [],
          str(rd.results().get("papa", {}).get("reason")))
    # (6) `sessionId` is retired: the batch stops by name before any page step; a `session` row still captures
    code, rd, page, _ = folded_run(tmp, "retired", [("quebec", '//@version=6\nindicator("Quebec")\nplot(close)\n', {})],
                                   rows={"quebec": {"sessionId": "regular"}})
    led = [json.loads(ln) for ln in (tmp / "retired" / "run" / "ledger.jsonl").read_text(encoding="utf-8").splitlines()]
    check("a row naming the retired `sessionId` stops the batch by name, before any chart step",
          code != 0 and any("sessionId` is retired" in str(e.get("reason")) for e in led if e.get("event") == "abort")
          and "STATE" not in page.names(), f"exit {code}")
    code, rd, page, _ = folded_run(tmp, "session", [("romeo", '//@version=6\nindicator("Romeo")\nplot(close)\n', {})],
                                   rows={"romeo": {"session": "regular", "symbol": "AMEX:SPY", "tf": "60"}})
    cap = _cap(rd.results().get("romeo", {}))
    check("⛔ CONTROL: a row naming its `session` (#2134) still captures it, read back as 0930-1600",
          rd.results().get("romeo", {}).get("outcome") == bc.CAPTURED and ((cap or {}).get("symbol") or {}).get("session") == "0930-1600",
          str(rd.results().get("romeo", {}).get("reason")))
    # (7) AN INTERRUPTED INPUT ROW: its add was autosaved with the inputs, and the batch died before its repair. The NEXT
    # batch never captures on that rig: with --clean-save, the guarded clean-save removes the manifest's OWN leftover and
    # a fresh load must read clean first; without it, the scratch-layout gate stops, as always. A foreign study: stop.
    src = '//@version=6\nindicator("Sierra")\nplot(close)\n'
    dead = RecordingTVPage(autosave="tradingview")
    try:
        folded_run(tmp, "interrupted", [("sierra", src, {"crash_at": "vh_capture"})], page=dead,
                   rows={"sierra": {"inputs": {"in_0": 30}}})
    except SimulatedCrash:
        pass
    left = json.loads(json.dumps(dead.persisted))
    persisted_inputs = [s.get("inputs") for s in left["studies"]]

    def next_batch(name, clean_save, studies=None):
        pg = RecordingTVPage(autosave="tradingview", persisted={**left, "studies": studies if studies is not None else left["studies"]},
                             studies=studies if studies is not None else left["studies"], symbol=left["symbol"],
                             resolution=left["resolution"])
        out = folded_run(tmp, name, [("sierra", src, {})], page=pg, opts=fast_opts(clean_save=clean_save))
        return out[0], out[1], pg

    code, rd, pg = next_batch("after-interrupt", True)
    led = [json.loads(ln) for ln in (tmp / "after-interrupt" / "run" / "ledger.jsonl").read_text(encoding="utf-8").splitlines()]
    starts = [e for e in led if e.get("event") == "clean-save" and e.get("label") == "start-repair"]
    check("an interrupted input row's autosaved leftover: the next batch's guarded clean-save removes it, a fresh load "
          "reads clean, then it captures",
          persisted_inputs == [{"in_0": 30}] and starts and starts[0].get("ok") is True
          and rd.results().get("sierra", {}).get("outcome") == bc.CAPTURED, f"{persisted_inputs} {starts} exit {code}")
    code, rd, pg = next_batch("after-interrupt-no-save", False)
    check("⛔ …without --clean-save the next batch never captures on that rig (the scratch-layout gate stops), and saves nothing",
          rd.results().get("sierra", {}).get("outcome") == bc.GATE_FAILED and bc.SAVE_SHORTCUT not in pg.names("press"),
          str(rd.results().get("sierra", {}).get("reason")))
    foreign = [{"id": "st900", "name": "Owner study", "sha": "x", "source": None, "reads": 0}]
    code, rd, pg = next_batch("foreign-leftover", True, studies=foreign)
    check("⛔ a study this manifest's probes do not declare: no start repair, the batch stops, nothing is saved",
          rd.results().get("sierra", {}).get("outcome") == bc.GATE_FAILED and bc.SAVE_SHORTCUT not in pg.names("press")
          and any(s.get("name") == "Owner study" for s in pg.studies), str(rd.results().get("sierra", {}).get("reason")))
    # (8) ONE SAVE PATH, read from the source (with its own controls: the check can fail)
    findings = single_save_path_findings(pathlib.Path(bc.__file__).read_text(encoding="utf-8"))
    bad_direct = single_save_path_findings('def f(page):\n    page.evaluate("() => window.TradingViewApi.saveChartTo'
                                           'Server()")\n    page.keyboard.press(SAVE_SHORTCUT)\n')
    bad_two = single_save_path_findings('def guarded_clean_save(p):\n    p.keyboard.press(SAVE_SHORTCUT)\n'
                                        'def other(p):\n    p.keyboard.press(SAVE_SHORTCUT)\n')
    prose = single_save_path_findings('def guarded_clean_save(p):\n    """never saveChartTo' 'Server()"""\n'
                                      '    # saveChartTo' 'Server\n    p.keyboard.press(SAVE_SHORTCUT)\n')
    check("ONE SAVE PATH: batch_capture names no direct saveChartTo" "Server and presses the Save key only in the guarded "
          "clean-save (controls: a direct save and a second press are found; prose is not)",
          findings == [] and len(bad_direct) == 2 and len(bad_two) == 1 and prose == [],
          f"{findings} | {bad_direct} | {bad_two} | {prose}")


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
        # ── ⭐⭐ (folded 2026-11-20) THE STEPS THE SCRATCHPAD WRAPPERS ADDED: each case goes red without its step ──────
        folded_checks(tmp, check)
    ok = all(c for _, c in checks)
    print(f"[self-check] {sum(c for _, c in checks)}/{len(checks)} checks passed")
    print(f"VERDICT: {'PASS' if ok else 'FAIL'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(self_check())
