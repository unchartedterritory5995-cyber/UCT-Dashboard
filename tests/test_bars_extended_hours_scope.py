"""⭐⭐ WHICH FETCHES CARRY EXTENDED-HOURS PRINTS — measured, not assumed.

⚰️ THIS FILE EXISTS BECAUSE A COMMIT MESSAGE CLAIMED IT ALREADY DID. On
2026-09-09 `docs/pine/barstate.md` asserted that the bars pipeline delivers
regular-session bars and called that *"an **assumption with a test**"*. There was
no such test — `pine.barstate.test.js` asserted nothing about sessions, hours,
holidays or early closes — and the sentence used the named safety net as its
reason to accept the assumption. The assumption was also wrong. This is the test
that sentence was describing, written afterwards.

⛔ THE PROPERTY THIS PINS IS SCOPE, NOT PRESENCE. Extended-hours prints reach an
INTRADAY fetch and do not reach a DAILY or an INDEX one. `barstate.isrealtime`'s
scheduled-close arithmetic leans on that split: intraday is `bar_open + interval`
and needs no calendar precisely because the arithmetic is indifferent to session,
while daily and above resolve a session close on the ET calendar. Flip either half
and one of those two is wrong.

⭐ IT READS THE SOURCE, NOT THE NETWORK. Asserting this by fetching would make the
suite depend on a vendor, a key and a clock; the claim is about what THIS REPO
ASKS FOR, which is a property of the code and is checkable offline. Every
assertion below is anchored on a real call site so a moved argument is a red test
rather than a stale docstring.
"""
from __future__ import annotations

import ast
import io
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
BARS_FETCH = ROOT / "api" / "services" / "bars_fetch.py"
INDEX_BARS = ROOT / "api" / "index_bars.py"


def _tree(path: pathlib.Path) -> ast.Module:
    return ast.parse(io.open(path, encoding="utf-8").read(), filename=str(path))


def _func(tree: ast.Module, name: str) -> ast.FunctionDef:
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name} not found — it was renamed or removed")


def _prepost_args(node: ast.AST):
    """Every ``prepost=<literal>`` keyword under ``node``, in source order."""
    out = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call):
            for kw in sub.keywords:
                if kw.arg == "prepost":
                    out.append(ast.literal_eval(kw.value))
    return out


# ─── intraday: asks for them, and keeps them ────────────────────────────────

def test_the_intraday_fetch_ASKS_for_extended_hours():
    """⛔ `_fetch_intraday_yfinance` passes ``prepost=True``. This is the single
    site in the repo that asks for pre/post-market prints, so if it flips, nothing
    else brings them in."""
    fn = _func(_tree(BARS_FETCH), "_fetch_intraday_yfinance")
    assert _prepost_args(fn) == [True], (
        "_fetch_intraday_yfinance no longer asks for extended-hours prints; "
        "docs/pine/barstate.md and indicator_compute.scheduled_close_seconds both "
        "describe the opposite")


def test_only_ONE_site_in_the_repo_asks_for_extended_hours():
    """⭐ THE NON-VACUITY CONTROL FOR THE SCOPE CLAIM. `barstate.md` says
    ``prepost=True`` occurs at exactly one site; a second one appearing would make
    the daily half of that claim unsafe without anything else going red."""
    asks = []
    for path in sorted(ROOT.glob("api/**/*.py")):
        try:
            tree = ast.parse(io.open(path, encoding="utf-8").read())
        except SyntaxError:                      # pragma: no cover
            continue
        for value in _prepost_args(tree):
            asks.append((path.relative_to(ROOT).as_posix(), value))
    truthy = [p for p, v in asks if v is True]
    assert truthy == ["api/services/bars_fetch.py"], (
        f"prepost=True is asked at {truthy}; barstate.md's scope claim assumes "
        "exactly one site")
    # ⛔ AND THE FALSE ONE IS STILL THERE, so this test cannot pass by everyone
    # having stopped passing `prepost` at all.
    assert ("api/index_bars.py", False) in asks, (
        "api/index_bars.py no longer pins prepost=False — the index lane's "
        "regular-session-only property is now unasserted")


def test_the_prepost_site_serves_INTRADAY_TIMEFRAMES_ONLY():
    """⛔⛔ THE LOAD-BEARING HALF. `_fetch_intraday_yfinance` reads `_YF_CONFIG`,
    and `_YF_CONFIG` holds intraday codes only — that is *why* `prepost=True`
    cannot reach a daily bar. If a `D`/`W`/`M` key were added to that map, the
    daily scheduled-close logic in
    ``indicator_compute.scheduled_close_seconds`` would silently start seeing
    extended-hours bars."""
    src = io.open(BARS_FETCH, encoding="utf-8").read()
    tree = ast.parse(src)
    cfg = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name) and t.id == "_YF_CONFIG":
                    cfg = ast.literal_eval(node.value)
    assert cfg is not None, "_YF_CONFIG not found"
    assert set(cfg) == {"1", "5", "15", "30", "60"}, (
        f"_YF_CONFIG now holds {sorted(cfg)} — a non-intraday key here puts "
        "extended-hours prints into a lane whose close is resolved on the ET "
        "calendar")
    fn = _func(tree, "_fetch_intraday_yfinance")
    assert any(
        isinstance(n, ast.Name) and n.id == "_YF_CONFIG" for n in ast.walk(fn)), (
        "_fetch_intraday_yfinance no longer reads _YF_CONFIG — the timeframe "
        "bound on the prepost site is gone")


def test_a_ZERO_VOLUME_extended_hours_bar_is_KEPT_not_dropped():
    """⛔ THE SERVE-TIME FILTER DROPS GARBAGE AND KEEPS THIN PRINTS, and the
    difference matters: an extended-hours bar legitimately trades zero volume, so
    a filter keyed on `v == 0` would silently delete the very bars the intraday
    lane just asked for. Driven through the real formatter rather than asserted
    from its comment."""
    from api.services import bars_fetch

    # ⛔ NAMED, NOT PROBED. An earlier draft looked the formatter up under two
    # guessed names and SKIPPED when neither matched — a guard that cannot fire,
    # which is the defect this whole file exists to answer. `_fmt_sqlite_bars` is
    # the single chokepoint every cached response flows through; if it is renamed
    # this test fails by name rather than quietly passing.
    fmt = bars_fetch._fmt_sqlite_bars

    t = 1757325600                                 # 2026-09-08 08:00 ET, pre-market
    rows = [
        (t,          10.0, 10.2, 9.9, 10.1, 0),    # zero-volume extended-hours
        (t + 300,    10.1, 10.3, 10.0, 10.2, 500),
    ]
    out = fmt(rows, "5")
    assert len(out) == 2, (
        f"the zero-volume extended-hours bar was dropped: {out}. "
        "Zero volume is legitimate on a thin/extended-hours print and "
        "bars_fetch keeps it deliberately")
    assert out[0]["v"] == 0


# ─── daily and index: do not ask, and must not ──────────────────────────────

def test_the_DAILY_fetch_does_NOT_ask_for_extended_hours():
    """⭐ The daily lane passes no ``prepost`` at all, so it takes yfinance's
    regular-session default. That is what lets ``scheduled_close_seconds`` resolve
    a D/W/M close on the ET calendar."""
    fn = _func(_tree(BARS_FETCH), "_fetch_daily_yf")
    assert _prepost_args(fn) == [], (
        "_fetch_daily_yf now passes prepost — a daily bar carrying "
        "extended-hours prints breaks the 16:00/13:00 ET close assumption in "
        "indicator_compute.scheduled_close_seconds")


def test_the_INDEX_fetch_pins_prepost_FALSE_explicitly():
    """⭐ `api/index_bars.py` says `prepost=False` rather than relying on the
    default — an explicit refusal, and the one this test can see move."""
    tree = _tree(INDEX_BARS)
    values = _prepost_args(tree)
    assert values and all(v is False for v in values), (
        f"api/index_bars.py prepost values are {values}; the index lane is "
        "documented as regular-session-only")
