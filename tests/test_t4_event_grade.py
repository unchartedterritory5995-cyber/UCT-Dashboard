"""Track 4, unit E1: `tools/vendor_harness/event_grade.py`, the grade of production's event fetch against
TradingView's probe captures. Each verdict is proved on a synthetic capture, and each can be reached only by the
shape it names: an exact placement with float32-equal values (MATCH-CAPABLE), an exact placement with other values
(SUBSTITUTED), a placement one bar off (DIVERGE), events TradingView has before our first held one (COVERAGE).
"""
from __future__ import annotations

import ast
import datetime as dt
import json
import os
import struct
import sys
import types

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(REPO, "tools", "vendor_harness"))
import event_grade as eg  # noqa: E402
import event_witness as ew  # noqa: E402

DAYS = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08", "2026-01-09",
        "2026-01-12", "2026-01-13", "2026-01-14", "2026-01-15", "2026-01-16"]


def _t(day):
    return int(dt.datetime.fromisoformat(day + "T14:30:00+00:00").timestamp())


def _f32(x):
    return struct.unpack("f", struct.pack("f", x))[0]


def _cap(tmp_path, title, cols, tf="1D", sym="NYSE:TEST", name="c"):
    titles = list(cols)
    plots = [{"id": f"plot_{i}", "title": f"{t} x"} for i, t in enumerate(titles)]
    doc = {"id": name, "capturedAtUTC": "x", "symbol": {"full_name": sym}, "timeframe": tf,
           "study": {"title": title, "plots": plots},
           "plotValues": {"fields": ["time"] + [p["id"] for p in plots],
                          "rows": [[_t(d)] + [cols[t][k] for t in titles] for k, d in enumerate(DAYS)]}}
    p = tmp_path / f"{name}.json"
    p.write_text(json.dumps(doc), encoding="utf-8")
    return ew.load(str(p))


def _col(**at):
    return [at.get(f"i{k}") for k in range(len(DAYS))]


def _div_cap(tmp_path, on):
    return _cap(tmp_path, "UCTPROBE_VW_DATA_DIVIDENDS", {"D01": on, "D07": [1] * len(DAYS)})


def _ours(rows, family="dividends", splits=None):
    fam = {"state": "ok", "rows": rows, "knownFrom": rows[0][eg.DATE_KEY[family]] if rows else None}
    out = {"families": {family: fam}}
    if splits is not None:
        out["families"]["splits"] = {"rows": splits}
    return out


def test_MATCH_CAPABLE_exact_placement_and_float32_values(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=_f32(0.77)))            # TradingView stores the float32 of 0.77
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-07", "gross": 0.77}]))
    assert r["verdict"] == "MATCH-CAPABLE" and r["values"]["gross"]["float32"] == 1


def test_SUBSTITUTED_exact_placement_other_values(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=0.77))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-07", "gross": 0.75}]))
    assert r["verdict"] == "SUBSTITUTED" and r["placement"]["both"] == 1


def test_SUBSTITUTED_values_close_but_not_float32_equal(tmp_path):
    """Within 1% is still another figure: only an exact or float32-equal value is MATCH-capable."""
    cap = _div_cap(tmp_path, _col(i2=0.77))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-07", "gross": 0.7705}]))
    assert r["verdict"] == "SUBSTITUTED" and r["values"]["gross"]["rel1pct"] == 1


def test_DIVERGE_a_placement_one_bar_off(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=0.77))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-08", "gross": 0.77}]))
    assert r["verdict"] == "DIVERGE" and r["placement"]["tvOnly"] == 1 and r["placement"]["oursOnly"] == 1


def test_COVERAGE_tradingview_holds_events_before_our_first(tmp_path):
    cap = _div_cap(tmp_path, _col(i1=0.5, i6=0.5))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-13", "gross": 0.5}]))
    assert r["verdict"] == "COVERAGE" and r["placement"]["tvOnlyBeforeKnownFrom"] == 1


def test_a_weekend_dated_vendor_event_is_placed_on_monday(tmp_path):
    cap = _div_cap(tmp_path, _col(i5=0.59))                  # Monday 2026-01-12
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-10", "gross": 0.59}]))   # dated Saturday
    assert r["verdict"] == "MATCH-CAPABLE"


def test_weekly_placement_and_a_weekend_event_goes_to_the_next_week():
    weeks = ["2026-01-05", "2026-01-12", "2026-01-19"]
    assert eg.place("2026-01-08", weeks, weekly=True) == "2026-01-05"
    assert eg.place("2026-01-10", weeks, weekly=True) == "2026-01-12"
    assert eg.place("2026-01-12", weeks, weekly=True) == "2026-01-12"


def test_earnings_values_are_also_tried_on_todays_share_basis(tmp_path):
    cap = _cap(tmp_path, "UCTPROBE_VW_DATA_EARNINGS", {"E01": _col(i2=0.612), "E05": _col(i2=0.56)})
    ours = _ours([{"date": "2026-01-07", "actual": 6.12, "estimate": 5.6}], family="earnings",
                 splits=[{"date": "2026-01-14", "numerator": 10, "denominator": 1}])
    r = eg.grade_one(cap, ours)
    v = r["values"]["actual"]
    assert v["exact"] == 0 and v["splitAdjustedRel1e-6"] == 1 and r["verdict"] == "SUBSTITUTED"


def test_NO_DATA_when_we_hold_nothing_and_tradingview_does(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=0.77))
    assert eg.grade_one(cap, {"families": {"dividends": {"state": "unavailable", "rows": []}}})["verdict"] == "NO-DATA"


def test_the_report_carries_no_tradingview_value(tmp_path):
    cap = _div_cap(tmp_path, _col(i2=0.123456))
    r = eg.grade_one(cap, _ours([{"exDate": "2026-01-07", "gross": 0.5}]))
    assert "0.123456" not in json.dumps(r)


# ── `--base`: the production read signs in ONLY through tools/synthetic_session.py, and always signs out ────────────
# (2026-11-23) The first version POSTed the login itself with SMOKE_PASSWORD read from the environment and never
# signed out: every run could leave a 30-day admin session open (tests/test_synthetic_session_signout.py named it).
# Everything below is a fake: the tool's httpx client is replaced in sys.modules and the helper's own wire
# (`S._http`, the logout and the `/api/auth/me` proof) is patched, so no request leaves the process.

SYNTH_EMAIL = "smoke@uctintelligence.internal"
SYNTH_PASSWORD = "pw-" + "x" * 12      # a fake, assembled so it is never a literal credential
SESSION_COOKIE = "uct_" + "session"
FAKE_BASE = "https://events-grade.test"  # `.test` never resolves; the fakes answer every request


def _code_strings_and_calls(path):
    """The module's syntax: string constants that are code (docstrings and bare string statements are prose and are
    dropped; comments never reach the AST), and the attribute names it calls or reads."""
    tree = ast.parse(open(path, encoding="utf-8").read())
    prose = {id(n.value) for n in ast.walk(tree)
             if isinstance(n, ast.Expr) and isinstance(n.value, ast.Constant) and isinstance(n.value.value, str)}
    strings = [n.value for n in ast.walk(tree)
               if isinstance(n, ast.Constant) and isinstance(n.value, str) and id(n) not in prose]
    called = {n.func.attr for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)}
    attrs = {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    imports = set()
    for n in ast.walk(tree):
        if isinstance(n, ast.Import):
            imports |= {a.name for a in n.names}
        elif isinstance(n, ast.ImportFrom):
            imports |= {f"{n.module}.{a.name}" for a in n.names}
    return strings, called, attrs, imports


def test_event_grade_signs_in_only_through_the_helper_read_from_its_syntax():
    strings, called, attrs, imports = _code_strings_and_calls(eg.__file__)
    assert not [s for s in strings if "/api/auth/" in s], "event_grade names an auth route itself"
    assert "post" not in called, "event_grade POSTs something itself; the sign-in is the helper's"
    assert not {"environ", "getenv"} & attrs, "event_grade reads the environment; the helper reads the credential"
    assert {"tools.synthetic_session", "synthetic_session"} & imports
    assert "sign_in_client" in called


def test_CONTROL_the_syntax_read_sees_a_raw_login_and_ignores_prose(tmp_path):
    raw = tmp_path / "raw.py"
    raw.write_text('"""Signs in by POSTing /api/auth/login (prose)."""\n'
                   "# cl.post('/api/auth/login')\n"
                   "import os\n"
                   "def f(cl):\n"
                   "    pw = os.environ.get('SMOKE_' + 'PASSWORD')\n"
                   "    return cl.post(f\"{cl.base}/api/auth/login\", json={'password': pw})\n", encoding="utf-8")
    strings, called, attrs, _ = _code_strings_and_calls(str(raw))
    assert [s for s in strings if "/api/auth/" in s] == ["/api/auth/login"]    # the f-string part, not the prose
    assert "post" in called and "environ" in attrs
    prose = tmp_path / "prose.py"
    prose.write_text('"""POST /api/auth/login with os.environ."""\n# cl.post("/api/auth/login")\nX = 1\n',
                     encoding="utf-8")
    strings, called, attrs, _ = _code_strings_and_calls(str(prose))
    assert not [s for s in strings if "/api/auth/" in s] and "post" not in called and "environ" not in attrs


class _Resp:
    def __init__(self, status, body=None, cookies=None, bad_json=False):
        self.status_code = status
        self._body, self._bad = body, bad_json
        self.cookies = dict(cookies or {})

    def json(self):
        if self._bad:
            raise ValueError("the answer is not JSON")
        return self._body


class _Wire:
    """One fake server behind both the tool's client and the helper's wire; `live` is the server's answer to
    "which sessions still work", so signed-out is measured there, not as "close() was called"."""

    def __init__(self, login_status=200, on_events=None):
        self.login_status = login_status
        self.on_events = on_events or (lambda sym: _Resp(200, {"state": "ok", "families": {}, "sym": sym}))
        self.live, self.issued, self.logouts, self.log, self.clients = set(), [], [], [], 0

    def path(self, url):
        return url[len(FAKE_BASE):] if url.startswith(FAKE_BASE) else url

    def helper_http(self, method, url, token=None, body=None, timeout=None):
        p = self.path(url)
        self.log.append(f"helper {method} {p}")
        if method == "GET" and p == "/api/auth/me":
            return (200, {"user": {"email": SYNTH_EMAIL}}) if token in self.live else (401, None)
        if method == "POST" and p == "/api/auth/logout":
            self.logouts.append(token)
            self.live.discard(token)
            return 200, {"ok": True}
        raise AssertionError(f"the helper sent an unexpected request: {method} {p}")

    def client_class(self):
        wire = self

        class Client:
            def __init__(self, base_url=None, timeout=None, follow_redirects=None):
                wire.clients += 1
                self.cookies = {}

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def post(self, url, json=None):
                p = wire.path(url)
                wire.log.append(f"client POST {p}")
                assert p == "/api/auth/login", p
                if wire.login_status != 200:
                    return _Resp(wire.login_status, {"detail": "refused"})
                tok = f"tok{len(wire.issued)}-" + "z" * 20
                wire.issued.append(tok)
                wire.live.add(tok)
                self.cookies[SESSION_COOKIE] = tok
                return _Resp(200, {"user": {"email": SYNTH_EMAIL}}, cookies={SESSION_COOKIE: tok})

            def get(self, url):
                p = wire.path(url)
                wire.log.append(f"client GET {p}")
                if self.cookies.get(SESSION_COOKIE) not in wire.live:
                    return _Resp(401, {"detail": "Not authenticated"})
                return wire.on_events(p.rsplit("/", 1)[-1])

        return Client


@pytest.fixture
def wire(monkeypatch):
    from tools import synthetic_session as S
    w = _Wire()
    monkeypatch.setattr(S, "_http", w.helper_http)
    monkeypatch.setattr(S, "_LOGOUT_ATTEMPTS", 1)
    monkeypatch.setenv("SMOKE_EMAIL", SYNTH_EMAIL)
    monkeypatch.setenv("SMOKE_PASSWORD", SYNTH_PASSWORD)
    fake_httpx = types.ModuleType("httpx")
    fake_httpx.Client = w.client_class()
    monkeypatch.setitem(sys.modules, "httpx", fake_httpx)
    w.S = S
    yield w
    left = [s for s in list(S._LIVE) if s.base == FAKE_BASE]
    for s in left:      # never leave one for the helper's atexit (it would use the real wire)
        S._LIVE.discard(s)
    assert not left, "a session was left registered for the interpreter-exit sign-out"


def test_the_tool_uses_the_helper_module_the_fakes_patch(wire):
    assert eg._synthetic_session() is wire.S


def test_the_production_read_signs_in_once_and_out_after_the_last_read(wire):
    out = eg.ours_from_base(FAKE_BASE, ["AAA", "BBB"], wait_s=0)
    assert set(out) == {"AAA", "BBB"} and out["AAA"]["sym"] == "AAA"
    assert len(wire.issued) == 1 and wire.logouts == wire.issued and wire.live == set()
    log = wire.log
    last_read = max(i for i, e in enumerate(log) if e.startswith("client GET /api/pine/events/"))
    assert log.index("client POST /api/auth/login") < log.index("client GET /api/pine/events/AAA")
    assert log.index("helper POST /api/auth/logout") > last_read
    assert log[-1] == "helper GET /api/auth/me"          # the helper proved the session is refused


@pytest.mark.parametrize("failure", [
    RuntimeError("the connection was reset"),            # the network fails mid-read
    "bad-json",                                          # a 200 whose body is not JSON
    KeyboardInterrupt(),                                 # the operator presses Ctrl-C
])
def test_an_error_mid_read_still_signs_the_session_out(wire, failure):
    def on_events(sym):
        if sym == "BBB":
            if failure == "bad-json":
                return _Resp(200, bad_json=True)
            raise failure
        return _Resp(200, {"state": "ok"})
    wire.on_events = on_events
    expected = ValueError if failure == "bad-json" else type(failure)
    with pytest.raises(expected):
        eg.ours_from_base(FAKE_BASE, ["AAA", "BBB", "CCC"], wait_s=0)
    assert len(wire.issued) == 1 and wire.logouts == wire.issued and wire.live == set()
    assert "client GET /api/pine/events/CCC" not in wire.log    # the error really ended the read


def test_a_refused_sign_in_exits_reads_nothing_and_leaves_no_session(wire):
    wire.login_status = 401
    with pytest.raises(SystemExit, match="HTTP 401"):
        eg.ours_from_base(FAKE_BASE, ["AAA"], wait_s=0)
    assert wire.issued == [] and wire.live == set()
    assert not [e for e in wire.log if e.startswith("client GET")]


def test_missing_credentials_exit_before_any_client_or_request(wire, monkeypatch):
    monkeypatch.delenv("SMOKE_PASSWORD")
    with pytest.raises(SystemExit, match="not set"):
        eg.ours_from_base(FAKE_BASE, ["AAA"], wait_s=0)
    assert wire.clients == 0 and wire.log == []
