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
import re
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
            self.page.dialog_open = False
        if key == bc.SAVE_SHORTCUT:
            # the layout's own Save: the persisted copy becomes the page as it is now (the guarded clean-save)
            self.page.persisted = {"studies": json.loads(json.dumps(self.page.studies)),
                                   "symbol": self.page.symbol, "resolution": self.page.resolution}
            self.page.saved_word = True


#: ⭐ THE INDICATORS DIALOG AS MEASURED (2026-11-20, item 2). What a search lists, by `data-id` and the element's title:
#: patrick-54's vwap_dialog_probe read the two VWAP searches on the rig (the first entries of each, in order); every
#: other measured pair of `bc.BUILTIN_SEARCH` lists its own id (it captured). A search not listed here lists nothing.
MEASURED_DIALOG = {
    "Volume Weighted Average Price": [   # 36 elements, every one a community script: the built-in is NOT among them
        {"id": "PUB;dc6dc22f6df34a818f00858fdbd237b1", "title": "Volume Weighted Average Price"},
        {"id": "PUB;39qrkQnRpKsQUoJTk8wxl00Pa4Rj7n0v", "title": "Volume Weighted Average Price Oscillator [NeoButane]"},
        {"id": "PUB;31d30a274d234879af531500a2dc4bb5", "title": "Volume Weighted Average Price (VWAP) with Extras [starlord_xrp]"},
    ],
    "VWAP": [
        {"id": "STD;VWAP", "title": "Volume-weighted average price"},
        {"id": "VWAPAA@tv-basicstudies", "title": "VWAP auto-anchored"},
        {"id": "PUB;2741", "title": "VWAP Stdev Bands v2 Mod"},
    ],
}
#: ⭐⭐ A BUILT-IN'S TWO NAMES (patrick-54, 2026-11-21): `getAllStudies()` names the built-in VWAP by its description
#: "Volume-weighted average price" (the dialog element's title, which the double uses as the study's `name`), while the
#: census (`tv_capture.js`: `title(true)` / shortDescription) titles it "VWAP". A data-id not here: one name for both.
MEASURED_CENSUS_TITLE = {"STD;VWAP": "VWAP"}
#: the built-in VWAP's inputs by dialog label (`getInputsInfo`), as its retake2 captures recorded them
MEASURED_INPUTS = {"STD;VWAP": {"Hide VWAP on 1D or Above": ("in_0", False), "Anchor Period": ("in_1", "Session"),
                                "Source": ("in_2", "hlc3"), "Offset": ("in_3", 0)}}


#: a PASTED study's inputs by dialog label (kernel-channel-backquant's regime toggle, the `scriptInputs` case)
PASTED_INPUTS = {"Color Bars By Regime": ("in_7", False)}


def measured_dialog():
    out = {k: [dict(x) for x in v] for k, v in MEASURED_DIALOG.items()}
    for bid, search in bc.BUILTIN_SEARCH.items():
        if not any(x["id"] == bid for x in out.get(search, [])):
            out.setdefault(search, []).append({"id": bid, "title": search})
    return out


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
                 studies=None, signed_in=True, visible=True, autosave=None, persisted=None, attach_delay_s=0.0):
        # ⭐ THE LAYOUT'S PERSISTED COPY, what a fresh load reads (`reload`). None: a fresh load reads the page as
        # it is. autosave="tradingview": the MEASURED rig (2026-11-18): an editor add saves the layout as it is
        # then; a widget-API removal or resolution change is never saved.
        self.autosave = autosave
        self.persisted = json.loads(json.dumps(persisted)) if persisted is not None else None
        # ⭐ A SLOW ATTACH (2026-11-19, htfform-c): after a fresh load the chart handle answers at once, with 0 studies,
        # and the layout's saved studies attach `attach_delay_s` (virtual) seconds later. 0: they are there at once.
        self.attach_delay_s = float(attach_delay_s)
        # ⭐ (2026-11-21, #2134) the hours the LAYOUT is saved with ("regular" | "extended"): what an INTRADAY chart
        # resolves (`_resolved_session`); a daily, weekly or monthly chart of a US listing resolves 0930-1600 whatever it
        # is. Nothing the batch does changes it (a row's session is read, never set). `subsession` is what
        # `symbolInfo().subsession_id` reports: None by default (no capture records one; the live probe reads it)
        self.session_id = "regular"
        self.subsession = None
        # ⭐ (2026-11-21, probe R4) after a resolution change `symbolInfo()` reads NULL until the new resolution's bars
        # load: `reload_s` (virtual) seconds here; 0, at once. And the page's URL (the layout it is on, `--layout`).
        self.reload_s = 0.0
        self.res_changed_at = None
        self.url = LAYOUT
        # ⭐ (2026-11-21, patrick-54's review of #2289) a STALE read after a resolution change: for `stale_polls` session
        # reads the PREVIOUS resolution's bars and session are still what the series holds. `stale_mode` "held": its
        # interval too (patrick-54's spec); "bars": the interval property already reads the NEW resolution.
        self.stale_polls = 0
        self.stale_mode = "held"
        self.prev_resolution = None
        self._stale_left = 0
        self.stale_served = 0                   # how many stale reads the batch was actually offered
        # ⭐ (2026-11-20, item 2) the Indicators dialog: what each search lists (`measured_dialog`), whether it is open,
        # and `lands_on` {data-id: metaInfo id}: an element whose click adds ANOTHER study (a moved label)
        self.dialog = measured_dialog()
        self.dialog_open = False
        self.lands_on = {}
        self.searches = []
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
        # ⭐ (2026-11-21) THE CONTAINERS (`rig_controls.js`, the rig's recorded DOM): how many rows of a text the open
        # menus hold (a same-text element outside every menu is not one), the texts something else covers at their
        # centre, whether the editor dialog holds its own `Add to chart`, and how many sit OUTSIDE it (a modal's).
        self.menu_rows = {"Create new": 1, "Indicator": 1}
        self.covered = {}                      # text -> how many more reads it stays covered (math.inf: never clears)
        self.add_in_dialog = True
        self.add_outside = 0
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
            bc.OPEN_DIALOG_JS: ("OPEN_DIALOG", self._open_dialog),
            bc.SEARCH_AND_CLICK_JS: ("SEARCH_AND_CLICK", self._search_and_click),
            bc.CLOSE_DIALOG_JS: ("CLOSE_DIALOG", lambda a: not self.dialog_open),
            bc.STUDY_IDENTITY_JS: ("STUDY_IDENTITY", self._study_identity),
            bc.INPUT_IDS_JS: ("INPUT_IDS", self._input_ids), bc.INPUTS_JS: ("INPUTS", self._inputs),
            bc.READ_INPUTS_JS: ("READ_INPUTS", self._read_inputs),
            bc.SLOT_LAYOUT_JS: ("SLOT_LAYOUT", self._slot_layout),
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
        self.url = url

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
        # ⭐⭐ AS THE LIVE RIG ANSWERED (patrick-54, 2026-11-20, #2134): setSymbol takes ANY string and says ok. A session
        # spec (`={"session":…,"symbol":…}`, TradingView's wire encoding) becomes the chart's LITERAL symbol, and
        # `symbolInfo()` never arrives for it; only a plain symbol brings it back. The layout's hours never change.
        self.symbol = s
        return {"ok": True}

    def _resolved_session(self, res=None):
        if re.search(r"[DWM]$", bc.res_norm(self.resolution if res is None else res)):
            return bc.ROW_SESSIONS["regular"]      # every daily / weekly capture on record reads 0930-1600
        return bc.ROW_SESSIONS[self.session_id]

    def _session(self, _):
        if str(self.symbol).startswith("="):
            return {"ok": False, "why": "no symbolInfo yet"}
        if self.res_changed_at is not None and self.t - self.res_changed_at < self.reload_s:
            return {"ok": False, "why": "no symbolInfo yet"}      # the new resolution's bars are still loading
        held = self.resolution
        if self._stale_left > 0 and self.prev_resolution is not None:
            self._stale_left -= 1
            self.stale_served += 1
            held = self.prev_resolution                            # the previous resolution's bars and session
        step = (bc.bar_step_range(held) or (None, None))[0]
        interval = held if (held == self.resolution or self.stale_mode == "held") else self.resolution
        return {"ok": True, "session": self._resolved_session(held), "subsession": self.subsession,
                "interval": str(interval), "bars": BARS, "step": step}

    def _set_resolution(self, r):
        self.res_changed_at = self.t
        if r != self.resolution:
            self.prev_resolution, self._stale_left = self.resolution, self.stale_polls
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
        """As `rig_controls.js` (`within: 'menu'`) answers on the page: the ONE row of the text in the open menus
        (`menu_rows`), never a covered one (`covered`); several is a STOP, a covered one is read again."""
        text = a.get("text")
        shown = ((text == "Create new" and self.menu in ("title", "create"))
                 or (text == "Indicator" and self.menu == "create" and bool(a.get("rightOf"))))
        n = self.menu_rows.get(text, 1) if shown else 0
        if n == 0:
            return {"ok": False, "STOP": False, "found": 0, "covered": False, "why": f"no visible {text!r} in an open menu"}
        if n > 1:
            return {"ok": False, "STOP": True, "found": n, "covered": False,
                    "why": f"{n} visible {text!r} in an open menu: exactly one, or nothing is clicked"}
        if self._still_covered(text):
            return {"ok": False, "STOP": False, "found": 1, "covered": True,
                    "why": f"{text!r} in an open menu is covered at its centre by another element: nothing is clicked"}
        if text == "Create new":
            return {"ok": True, "x": CREATE_XY[0], "y": CREATE_XY[1],
                    "rect": {"left": 280, "right": 360, "top": 130, "bottom": 150}}
        return {"ok": True, "x": INDICATOR_XY[0], "y": INDICATOR_XY[1],
                "rect": {"left": 440, "right": 520, "top": 130, "bottom": 150}}

    def _still_covered(self, text):
        """Is `text` under another element at this read? Each read uses one of its covered reads up."""
        left = self.covered.get(text, 0)
        if left <= 0:
            return False
        self.covered[text] = left - 1
        return True

    def _own_add(self):
        """The editor dialog's own `Add to chart` (shown while the editor is open and unbound)."""
        return 1 if self.editor_open and self.bound == "add" and self.add_in_dialog else 0

    def _binding(self, _):
        # the binding gate counts own-text `Add to chart` over the WHOLE page: the dialog's and any outside it
        add = self._own_add() + self.add_outside
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
        # ⭐ as `rig_controls.js` (`within: 'editor'`): the ONE button inside the dialog, uncovered, or nothing
        covered = self._own_add() == 1 and self._still_covered("Add to chart")
        if self._own_add() != 1 or covered:
            self.adds.append((self.bound, False))
            return {"STOP": True, "vis": "visible", "gate": gate, "found": self._own_add(), "covered": covered,
                    "why": "no visible 'Add to chart' in #pine-editor-dialog" if self._own_add() != 1
                    else "'Add to chart' in #pine-editor-dialog is covered at its centre by another element"}
        src = self.buffers[self.current]
        sha = hashlib.sha256(src.encode("utf-8")).hexdigest()
        self._maybe_crash("add", sha)
        self.adds.append((self.bound, True))
        self.next_id += 1
        self.studies.append({"id": f"st{self.next_id}", "name": declared_title(src) or "Untitled",
                             "sha": sha, "source": src, "reads": 0,
                             "inputs": {iid: dv for iid, dv in PASTED_INPUTS.values()}})
        self.bound = "update"        # every add binds the editor (capture-procedure.md, S5)
        if self.autosave == "tradingview":
            self.persisted = {"studies": json.loads(json.dumps(self.studies)), "symbol": self.symbol, "resolution": self.resolution}
        return {"clicked": True, "vis": "visible", "gate": gate}

    # ── the Indicators dialog (item 2, 2026-11-20) ──────────────────────────
    def _open_dialog(self, _):
        if self.dialog_open:
            return {"open": True}
        self.dialog_open = True
        return {"open": False, "clicked": True}

    def _search_and_click(self, a):
        """As the page: the ONE element whose data-id is exactly `id` among what `search` lists is clicked (it adds its
        study); none or several, nothing is clicked."""
        if not self.dialog_open:
            return {"STOP": "no dialog search input"}
        self.searches.append(a["search"])
        hits = [x for x in self.dialog.get(a["search"], []) if x["id"] == a["id"]]
        if len(hits) > 1:
            return {"STOP": f"{len(hits)} elements carry data-id {a['id']}"}
        if not hits:
            return {"STOP": f"no element with data-id {a['id']} after searching {json.dumps(a['search'])}"}
        self.next_id += 1
        inputs = {iid: dv for iid, dv in (MEASURED_INPUTS.get(a["id"]) or {}).values()}
        self.studies.append({"id": f"st{self.next_id}", "name": hits[0]["title"], "sha": None, "source": None,
                             "title": MEASURED_CENSUS_TITLE.get(a["id"], hits[0]["title"]),
                             "reads": 0, "builtin": a["id"], "inputs": inputs,
                             "metaInfoId": self.lands_on.get(a["id"], bc.builtin_identity(a["id"]))})
        if self.autosave == "tradingview":
            # ⚠️ UNMEASURED whether a dialog add autosaves the layout as an editor add does; the double assumes the
            # worse case (it does), so the batch's removal and fresh-load verify must cover it
            self.persisted = {"studies": json.loads(json.dumps(self.studies)), "symbol": self.symbol, "resolution": self.resolution}
        return {"clicked": True, "title": hits[0]["title"]}

    def _study_identity(self, _):
        return {"ok": True, "indicators": [s.get("metaInfoId") or "Script$USER;787899e2@tv-scripting" for s in self.studies]}

    def _input_ids(self, sid):
        s = self._find(sid)
        if not s:
            return {}
        table = MEASURED_INPUTS.get(s["builtin"]) if s.get("builtin") else PASTED_INPUTS
        return {label: iid for label, (iid, _) in (table or {}).items()}

    def _read_inputs(self, sid):
        s = self._find(sid)
        if not s:
            return None
        got = dict(s.get("inputs") or {})
        for iid in getattr(self, "inputs_revert", ()):     # a chart that does not keep an override (the refusal case)
            if iid in got:
                got[iid] = (PASTED_INPUTS.get("Color Bars By Regime") or (None, None))[1]
        return got

    def _inputs(self, a):
        s = self._find(a["id"])
        if not s:
            return {"ok": False, "why": "study not found"}
        bad = [{"id": k, "want": v, "got": None} for k, v in a["inputs"].items() if k not in s.get("inputs", {})]
        for k, v in a["inputs"].items():
            if k in s.get("inputs", {}):
                s["inputs"][k] = v
        s["reads"] = 0                       # a new input recomputes
        return {"ok": not bad, "bad": bad, "set": len(a["inputs"])}

    def _slot_layout(self, _):
        """As SLOT_LAYOUT_JS: the layout id in the URL, and TradingView's own `layoutId()` (`layout_api`, when a scenario
        makes the page disagree with its URL; else the URL's)."""
        url = bc.layout_id_of(self.url)
        return {"url": url, "api": getattr(self, "layout_api", url)}

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
                          "title": s.get("title") or s["name"], "description": s["name"]} for s in self.studies]}

    def _vh_capture(self, o):
        self._need_vh()
        # as tv_capture.js: the study is selected by a substring of its census title or its description
        hits = [s for s in self.studies if o["study"] in (s.get("title") or s["name"]) or o["study"] in s["name"]]
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
            "page": {"url": LAYOUT, "visibilityState": "visible", "hasFocus": True,
                     **({"slot": {k: o["slot"].get(k) for k in bc.SLOT_PROVENANCE_KEYS}} if isinstance(o.get("slot"), dict) else {})},
            "symbol": {"name": "RDDT", "full_name": "NYSE:RDDT", "pro_name": "NYSE:RDDT", "exchange": "NYSE",
                       "listed_exchange": "NYSE", "type": "stock", "session": self._resolved_session(),
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
            "study": {"id": s.get("metaInfoId") or "Script$USER;787899e2@tv-scripting-101", "fullId": None,
                      "title": s.get("title") or s["name"], "description": s["name"],
                      "shortDescription": s.get("title") or s["name"], "status": {"type": 2},
                      "plots": [{"id": "plot_0", "type": "line", "title": "Plot"}],
                      "styles": {"plot_0": {"title": "Plot"}}, "styleState": None, "palettes": {},
                      "paletteState": None,
                      "inputs": [{"id": k, "value": v} for k, v in (s.get("inputs") or {}).items()]},
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
    opts = opts or fast_opts()
    assert acquire(page, 5) == 0
    bc.go_to_layout(page, opts.layout)          # as `_launch`: acquire() ends on the rig layout
    code = bc.run_batch(page, manifest, rd, opts, clock, verifier or bc.NodeVerifier(),
                        log=lambda *a: None, **kw)
    return code, rd, clock


def slot_info_for(slot, target=None, window=None, broker_pid=4242, browser_pid=4243) -> dict:
    """What `_launch_cdp` fills for a slot job, with fixed fake ids (target `T-<slot>`, window by slot)."""
    return {"slot": slot, "layoutId": bc.SLOT_LAYOUTS[slot], "cdpTargetId": target or f"T-{slot}",
            "cdpWindowId": window if window is not None else 10 + "ABC".index(slot),
            "brokerPid": broker_pid, "browserPid": browser_pid}


def slot_run(page, manifest, run_dir, slot, opts=None, verifier=None, slot_info=None, layout_on=None, **kw):
    """A SLOT job on the double, as `_launch_cdp` hands its page over: the window on the slot's layout (`layout_on`
    overrides it, the wrong-layout case), the slot's info filled, then the unchanged batch."""
    clock = FakeClock(page)
    rd = bc.RunDir(run_dir, f"slot-{slot}")
    opts = opts or fast_opts(layout=bc.SLOT_LAYOUTS[slot])
    opts.slot_info = dict(slot_info or slot_info_for(slot))
    opts.min_free_ram_bytes = opts.min_free_ram_bytes or bc.MIN_SLOT_FREE_RAM_BYTES
    page.goto(bc.layout_url(layout_on or opts.layout))
    code = bc.run_batch(page, manifest, rd, opts, clock, verifier or bc.NodeVerifier(), log=lambda *a: None, **kw)
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


def _jsonable(a):
    return a if isinstance(a, (str, int, float, bool, type(None))) else json.dumps(a, sort_keys=True, default=str)


def legacy_trace(tmp: pathlib.Path) -> dict:
    """⭐⭐ THE `--cdp`-LESS PATH, AS A TRACE (tv-capture slots, 2026-11-26): every page call (kind, name, arg) the batch
    makes on the double, every result's outcome and steps, the batch exit codes, the sleeps and the sha256 of every capture
    file, over three scenarios that cover the whole legacy loop: the five-script first run with its crash and the resume,
    an extended-session intraday row, and a built-in row. `tests/fixtures/vendor_batch/legacy_trace.json` holds the trace
    the code had BEFORE the slot mode existed (origin/master ed7605b405); the rail asserts today's trace equals it, so the
    path without `--cdp` is the same steps and calls, call for call. A deliberate change to the legacy path regenerates
    the fixture (`python tools/vendor_harness/batch_double.py --write-legacy-trace`) in the same commit, by name."""
    def calls(p):
        return [[k, n, _jsonable(a)] for k, n, a in p.calls]

    def results(rd):
        return {s: {"outcome": r.get("outcome"), "steps": r.get("steps"),
                    "reason": re.sub(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\+00:00", "<utc>", str(r.get("reason"))),
                    "provenanceKeys": sorted((r.get("provenance") or {}).keys())} for s, r in sorted(rd.results().items())}

    def caps(run_dir):
        return {f.name: hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted((run_dir / "captures").glob("*.json"))}

    out = {}
    manifest, beh, page1, crashed = first_run(tmp / "s1")
    r1 = results(bc.RunDir(tmp / "s1" / "run", "trace"))
    page2, code2, rd2, clock2 = resume_run(tmp / "s1", manifest, beh, page1)
    out["first_resume"] = {"crashed": crashed is not None, "page1": calls(page1), "results1": r1, "page2": calls(page2),
                           "exit2": code2, "sleeps2": clock2.sleeps, "results2": results(rd2), "captures": caps(tmp / "s1" / "run")}
    m, b = make_manifest(tmp / "s2", [("ext", '//@version=6\nindicator("X")\nplot(close)\n', {})])
    m["scripts"][0].update({"symbol": "AMEX:SPY", "tf": "60", "session": "extended", "captureStem": "s"})
    page = RecordingTVPage(behaviours={sha: x for sha, x in b.values()}, resolution="1D")
    page.session_id = "extended"
    code, rd, clock = run(page, m, tmp / "s2" / "run", fast_opts())
    out["session"] = {"page": calls(page), "exit": code, "sleeps": clock.sleeps, "results": results(rd),
                      "captures": caps(tmp / "s2" / "run")}
    row = {"slug": "vwap-earn", "builtin": {"id": "STD;VWAP"}, "builtinInputs": {"Anchor Period": "Earnings"},
           "captureStem": "builtin-vwap-anchor-earnings"}
    page = RecordingTVPage()
    code, rd, clock = run(page, {"schema": "uct.vendor-batch-manifest/v1", "scripts": [row]}, tmp / "s3" / "run", fast_opts())
    out["builtin"] = {"page": calls(page), "exit": code, "sleeps": clock.sleeps, "results": results(rd),
                      "captures": caps(tmp / "s3" / "run")}
    return out


LEGACY_TRACE_FIXTURE = HERE.parents[1] / "tests" / "fixtures" / "vendor_batch" / "legacy_trace.json"


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
    if "--write-legacy-trace" in sys.argv[1:]:
        with tempfile.TemporaryDirectory(prefix="vhbatch-trace-") as td:
            trace = legacy_trace(pathlib.Path(td))
        LEGACY_TRACE_FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        tmp = LEGACY_TRACE_FIXTURE.with_suffix(".tmp")
        tmp.write_text(json.dumps(trace, indent=0, sort_keys=True) + "\n", encoding="utf-8", newline="\n")
        tmp.replace(LEGACY_TRACE_FIXTURE)
        print(f"wrote {LEGACY_TRACE_FIXTURE}")
        sys.exit(0)
    sys.exit(self_check())
