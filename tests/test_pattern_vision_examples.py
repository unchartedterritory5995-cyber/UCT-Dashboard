import datetime

from api.services.pattern_vision import modelbook_examples as ex


def _bars(n=60, start=(2026, 1, 1)):
    base = datetime.date(*start)
    out = []
    for i in range(n):
        d = base + datetime.timedelta(days=i)
        ts = int(d.strftime("%Y%m%d"))
        c = 100 + i
        out.append((ts, float(c), c * 1.02, c * 0.98, float(c), 1_000_000))
    return out


def _wire(monkeypatch, setups, *, render=None):
    """Stub the Model Book getters + bars + render."""
    import api.services.modelbook_service as mb
    monkeypatch.setattr(mb, "list_years", lambda: [2026])
    monkeypatch.setattr(mb, "get_stocks_for_year", lambda y: [{"id": 1}])
    monkeypatch.setattr(mb, "get_stock_detail",
                        lambda sid: {"symbol": "AAA", "setups": setups})
    import api.services.bars_sqlite as b
    monkeypatch.setattr(b, "get_bars", lambda sym, tf, n: _bars())
    calls = {"n": 0}

    def _render(sl, **k):
        calls["n"] += 1
        return b"\x89PNG" + bytes([len(sl) % 256])
    monkeypatch.setattr(ex.chart_render, "render_chart", render or _render)
    ex.reset_cache()
    return calls


def test_example_pngs_renders_and_caches(monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_FEWSHOT_ENABLED", "1")
    monkeypatch.setenv("PATTERN_VISION_FEWSHOT_N", "2")
    calls = _wire(monkeypatch, [
        {"setup_type": "VCP", "label_date": "2026-02-20", "timeframe": "D",
         "entry_price": 130.0, "grade": "A+"},
    ])
    pngs = ex.example_pngs("vcp")
    assert len(pngs) == 1 and pngs[0][:4] == b"\x89PNG"
    assert calls["n"] == 1
    # second call is cached → no extra render
    ex.example_pngs("vcp")
    assert calls["n"] == 1


def test_disabled_returns_empty(monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_FEWSHOT_ENABLED", "0")
    _wire(monkeypatch, [{"setup_type": "VCP", "label_date": "2026-02-20",
                         "timeframe": "D", "entry_price": 1, "grade": "A"}])
    assert ex.example_pngs("vcp") == []


def test_grade_order_best_first(monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_FEWSHOT_ENABLED", "1")
    monkeypatch.setenv("PATTERN_VISION_FEWSHOT_N", "2")
    _wire(monkeypatch, [
        {"setup_type": "VCP", "label_date": "2026-02-10", "timeframe": "D", "grade": "C"},
        {"setup_type": "VCP", "label_date": "2026-02-20", "timeframe": "D", "grade": "A+"},
    ])
    coll = ex._collect_examples()["vcp"]
    assert coll[0]["grade"] == "A+"  # best grade sorted first


def test_label_date_before_history_skipped(monkeypatch):
    monkeypatch.setenv("PATTERN_VISION_FEWSHOT_ENABLED", "1")
    _wire(monkeypatch, [
        {"setup_type": "VCP", "label_date": "1999-01-01", "timeframe": "D", "grade": "A"},
    ])
    assert ex.example_pngs("vcp") == []  # no bars at/before that date → skipped
