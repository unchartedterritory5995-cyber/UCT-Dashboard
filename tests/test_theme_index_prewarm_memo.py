"""Rail: one bars read per holding per prewarm pass (2026-11-12).

`prewarm_all` builds every theme back to back and a popular name sits in many themes, so
before this change the same ~620-bar read + conversion ran once PER THEME. The pass memo
must (1) read a shared holding once per pass, (2) hand every caller its OWN list, because
`_overlay_today` appends/replaces items in place, and (3) be gone outside a pass, so a
member's request still reads fresh bars."""
from api.services import theme_index as ti


def _install(monkeypatch, themes):
    reads = []

    def fake_read(sym, f, t):
        reads.append(sym)
        return [{"t": 1, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]

    monkeypatch.setattr(ti, "_holding_daily_bars_read", fake_read)
    monkeypatch.setattr(ti, "all_theme_slugs", lambda: list(themes))
    got = {}

    def fake_index(slug, tf="D"):
        got[slug] = [ti._holding_daily_bars(s, "a", "b") for s in themes[slug]]
        return {"bars": [1]}

    monkeypatch.setattr(ti, "get_theme_index", fake_index)
    return reads, got


def test_shared_holding_read_once_per_pass(monkeypatch):
    reads, _ = _install(monkeypatch, {"ai": ["NVDA", "AVGO"], "semis": ["NVDA", "AMD"], "dc": ["NVDA"]})
    assert ti.prewarm_all("D") == 3
    assert sorted(reads) == ["AMD", "AVGO", "NVDA"]


def test_each_caller_gets_its_own_list(monkeypatch):
    _, got = _install(monkeypatch, {"ai": ["NVDA"], "semis": ["NVDA"]})
    ti.prewarm_all("D")
    a, b = got["ai"][0], got["semis"][0]
    assert a == b and a is not b
    a.append({"t": 2})                     # what _overlay_today does during RTH
    assert len(b) == 1


def test_no_memo_outside_a_pass(monkeypatch):
    reads, _ = _install(monkeypatch, {})
    ti.prewarm_all("D")
    assert ti._pass_memo is None
    ti._holding_daily_bars("NVDA", "a", "b")
    ti._holding_daily_bars("NVDA", "a", "b")
    assert reads == ["NVDA", "NVDA"]


def test_memo_is_bounded(monkeypatch):
    syms = [f"S{i}" for i in range(ti._PASS_MEMO_MAX + 50)]
    reads, _ = _install(monkeypatch, {"big": syms})
    ti.prewarm_all("D")
    assert len(reads) == len(syms)          # no false hits

    seen = {}
    real = ti.OrderedDict
    monkeypatch.setattr(ti, "OrderedDict", lambda: seen.setdefault("m", real()))
    ti.prewarm_all("D")
    assert len(seen["m"]) == ti._PASS_MEMO_MAX
