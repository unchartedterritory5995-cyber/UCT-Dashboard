import os
import tempfile

import pytest

from api.services import modelbook_service as svc


@pytest.fixture
def s(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setattr(svc, "_DB_PATH", os.path.join(d, "modelbook.db"))
        svc._init_db()
        yield svc


def _stock(year=2025, symbol="NVDA", **kw):
    return {
        "year": year,
        "symbol": symbol,
        "company": kw.get("company", "NVIDIA Corp"),
        "sort_order": kw.get("sort_order", 1),
        "thesis": kw.get("thesis", "AI leader"),
        "gain_pct": kw.get("gain_pct", 171.0),
    }


def _setup(label_date="2025-03-14", **kw):
    return {
        "setup_type": kw.get("setup_type", "VCP"),
        "label_date": label_date,
        "frame_start_date": kw.get("frame_start_date"),
        "drawings_json": kw.get("drawings_json"),
        "timeframe": kw.get("timeframe", "D"),
        "entry_price": kw.get("entry_price", 120.0),
        "stop_price": kw.get("stop_price", 110.0),
        "target_price": kw.get("target_price", 150.0),
        "grade": kw.get("grade", "A+"),
        "notes": kw.get("notes", "textbook squeeze"),
        "marker_side": kw.get("marker_side", "belowBar"),
        "marker_shape": kw.get("marker_shape", "arrowUp"),
    }


def test_create_and_get_stock(s):
    created = s.create_stock(_stock())
    assert created["id"]
    assert created["symbol"] == "NVDA"
    assert created["setups"] == []

    detail = s.get_stock_detail(created["id"])
    assert detail["company"] == "NVIDIA Corp"
    assert detail["gain_pct"] == 171.0


def test_list_years_and_stocks_for_year(s):
    s.create_stock(_stock(year=2025, symbol="NVDA", sort_order=1))
    s.create_stock(_stock(year=2025, symbol="PLTR", sort_order=2))
    s.create_stock(_stock(year=2024, symbol="SMCI", sort_order=1))

    assert s.list_years() == [2025, 2024]  # newest first

    stocks = s.get_stocks_for_year(2025)
    assert [x["symbol"] for x in stocks] == ["NVDA", "PLTR"]  # by sort_order
    assert all(x["setup_count"] == 0 for x in stocks)


def test_create_stock_upserts_on_year_symbol(s):
    a = s.create_stock(_stock(symbol="NVDA", thesis="v1"))
    b = s.create_stock(_stock(symbol="NVDA", thesis="v2"))
    assert a["id"] == b["id"]
    assert s.get_stock_detail(a["id"])["thesis"] == "v2"
    assert len(s.get_stocks_for_year(2025)) == 1


def test_setup_crud_and_setup_count(s):
    stock = s.create_stock(_stock())
    setup = s.create_setup(stock["id"], _setup())
    assert setup["setup_type"] == "VCP"
    assert setup["grade"] == "A+"

    detail = s.get_stock_detail(stock["id"])
    assert len(detail["setups"]) == 1
    assert s.get_stocks_for_year(2025)[0]["setup_count"] == 1

    updated = s.update_setup(setup["id"], {"grade": "B", "notes": "revised"})
    assert updated["grade"] == "B"
    assert updated["notes"] == "revised"

    assert s.delete_setup(setup["id"]) is True
    assert s.get_stock_detail(stock["id"])["setups"] == []


def test_create_setup_on_missing_stock_returns_none(s):
    assert s.create_setup(9999, _setup()) is None


def test_setup_frame_start_date_roundtrips(s):
    stock = s.create_stock(_stock())
    # Defaults to None when not provided.
    a = s.create_setup(stock["id"], _setup())
    assert a["frame_start_date"] is None
    # Stored and returned when provided.
    b = s.create_setup(stock["id"], _setup(label_date="2025-08-22",
                                           frame_start_date="2025-06-02"))
    assert b["frame_start_date"] == "2025-06-02"
    assert s.get_setup(b["id"])["frame_start_date"] == "2025-06-02"
    # Patchable via update_setup.
    upd = s.update_setup(b["id"], {"frame_start_date": "2025-05-15"})
    assert upd["frame_start_date"] == "2025-05-15"


def test_setup_drawings_json_roundtrips(s):
    stock = s.create_stock(_stock())
    a = s.create_setup(stock["id"], _setup())
    assert a["drawings_json"] is None  # default when not provided
    payload = '[{"id":"x","type":"trendline","points":[{"time":"2025-08-01","price":2.1}],"lineStyle":"dashed"}]'
    b = s.create_setup(stock["id"], _setup(drawings_json=payload))
    assert b["drawings_json"] == payload
    # Patchable in isolation (annotate-save sends only drawings_json).
    upd = s.update_setup(a["id"], {"drawings_json": payload})
    assert upd["drawings_json"] == payload
    # And editing other fields leaves drawings untouched.
    upd2 = s.update_setup(a["id"], {"grade": "B"})
    assert upd2["drawings_json"] == payload


def test_setups_ordered_by_label_date(s):
    stock = s.create_stock(_stock())
    s.create_setup(stock["id"], _setup(label_date="2025-09-01"))
    s.create_setup(stock["id"], _setup(label_date="2025-02-01"))
    dates = [x["label_date"] for x in s.get_stock_detail(stock["id"])["setups"]]
    assert dates == ["2025-02-01", "2025-09-01"]


def test_delete_stock_cascades_to_setups(s):
    stock = s.create_stock(_stock())
    setup = s.create_setup(stock["id"], _setup())
    assert s.delete_stock(stock["id"]) is True
    assert s.get_stock_detail(stock["id"]) is None
    assert s.get_setup(setup["id"]) is None  # cascade removed it


def test_update_stock_patches_fields(s):
    stock = s.create_stock(_stock(gain_pct=100.0))
    updated = s.update_stock(stock["id"], {"gain_pct": 250.0, "company": "NVIDIA"})
    assert updated["gain_pct"] == 250.0
    assert updated["company"] == "NVIDIA"


def test_delete_missing_returns_false(s):
    assert s.delete_stock(123) is False
    assert s.delete_setup(123) is False


def _catalyst(catalyst_date="2025-09-04", **kw):
    return {
        "catalyst_date": catalyst_date,
        "title": kw.get("title", "Q3 earnings beat"),
        "description": kw.get("description", "Blew past estimates on AI demand."),
        "move_pct": kw.get("move_pct", 18.5),
        "sort_order": kw.get("sort_order", 0),
        "source": kw.get("source", "ai"),
    }


def test_stock_detail_includes_empty_catalysts(s):
    stock = s.create_stock(_stock())
    assert s.get_stock_detail(stock["id"])["catalysts"] == []


def test_catalyst_crud(s):
    stock = s.create_stock(_stock())
    cat = s.create_catalyst(stock["id"], _catalyst())
    assert cat["title"] == "Q3 earnings beat"
    assert cat["move_pct"] == 18.5
    assert cat["source"] == "ai"

    detail = s.get_stock_detail(stock["id"])
    assert len(detail["catalysts"]) == 1

    upd = s.update_catalyst(cat["id"], {"title": "Earnings beat + raise", "move_pct": 22.0})
    assert upd["title"] == "Earnings beat + raise"
    assert upd["move_pct"] == 22.0

    assert s.delete_catalyst(cat["id"]) is True
    assert s.get_stock_detail(stock["id"])["catalysts"] == []


def test_create_catalyst_on_missing_stock_returns_none(s):
    assert s.create_catalyst(9999, _catalyst()) is None


def test_replace_catalysts_swaps_whole_set_and_orders(s):
    stock = s.create_stock(_stock())
    s.create_catalyst(stock["id"], _catalyst(title="old one"))
    new = s.replace_catalysts(stock["id"], [
        _catalyst(catalyst_date="2025-05-01", title="B", sort_order=1),
        _catalyst(catalyst_date="2025-02-01", title="A", sort_order=0),
    ])
    # Returns the fresh set ordered by sort_order; the old one is gone.
    assert [c["title"] for c in new] == ["A", "B"]
    detail = s.get_stock_detail(stock["id"])
    assert [c["title"] for c in detail["catalysts"]] == ["A", "B"]
    # catalysts_at is stamped so generation isn't retried in a loop.
    assert detail["catalysts_at"] is not None


def test_replace_catalysts_on_missing_stock_returns_none(s):
    assert s.replace_catalysts(9999, [_catalyst()]) is None


def test_delete_stock_cascades_to_catalysts(s):
    stock = s.create_stock(_stock())
    cat = s.create_catalyst(stock["id"], _catalyst())
    assert s.delete_stock(stock["id"]) is True
    assert s.get_catalyst(cat["id"]) is None


def test_mark_catalysts_attempt_stamps(s):
    stock = s.create_stock(_stock())
    assert s.get_stock_detail(stock["id"])["catalysts_at"] is None
    s.mark_catalysts_attempt(stock["id"])
    assert s.get_stock_detail(stock["id"])["catalysts_at"] is not None


def test_get_stocks_needing_catalysts(s):
    a = s.create_stock(_stock(symbol="NVDA"))
    b = s.create_stock(_stock(symbol="PLTR"))
    # Both need catalysts initially (none + never attempted).
    assert {x["symbol"] for x in s.get_stocks_needing_catalysts()} == {"NVDA", "PLTR"}
    # One gets catalysts → drops out.
    s.create_catalyst(a["id"], _catalyst())
    assert {x["symbol"] for x in s.get_stocks_needing_catalysts()} == {"PLTR"}
    # The other gets an attempt stamp (e.g. generation found nothing) → drops out.
    s.mark_catalysts_attempt(b["id"])
    assert s.get_stocks_needing_catalysts() == []


def test_regen_catalysts_clears_ai_keeps_manual_and_is_flag_gated(s):
    stock = s.create_stock(_stock())
    s.create_catalyst(stock["id"], _catalyst(source="ai", title="ai one"))
    s.create_catalyst(stock["id"], _catalyst(source="manual", title="manual one",
                                             catalyst_date="2025-06-01"))
    s.mark_catalysts_attempt(stock["id"])

    s.regen_catalysts("testtag")
    detail = s.get_stock_detail(stock["id"])
    assert [c["title"] for c in detail["catalysts"]] == ["manual one"]  # AI dropped, manual kept
    assert detail["catalysts_at"] is None                              # reset so it regenerates

    # Second call is a no-op (flag-gated) — a fresh AI catalyst survives.
    s.create_catalyst(stock["id"], _catalyst(source="ai", title="ai two"))
    s.regen_catalysts("testtag")
    titles = {c["title"] for c in s.get_stock_detail(stock["id"])["catalysts"]}
    assert "ai two" in titles


def test_seed_initial_populates_and_is_flag_gated(s):
    s.seed_initial()
    assert s.list_years() == [2025, 2024]
    assert len(s.get_stocks_for_year(2025)) == 10
    assert len(s.get_stocks_for_year(2024)) == 10
    # Once seeded, a second call is a no-op: deletions must stick across reseeds.
    victim = s.get_stocks_for_year(2025)[0]
    assert s.delete_stock(victim["id"]) is True
    s.seed_initial()
    assert len(s.get_stocks_for_year(2025)) == 9


# ── Index-pane drawings (GLOBAL) ──────────────────────────────────────────────

def test_index_drawings_default_empty(s):
    assert s.get_index_drawings("^IXIC") == "[]"


def test_index_drawings_set_get_roundtrip_and_upsert(s):
    payload = '[{"id":"a","type":"measure","points":[{"time":"2025-04-01","price":15000}]}]'
    assert s.set_index_drawings("^IXIC", payload) == payload
    assert s.get_index_drawings("^IXIC") == payload
    # Upsert (same symbol) replaces rather than inserting a second row.
    updated = '[{"id":"b","type":"measure"}]'
    s.set_index_drawings("^ixic", updated)  # case-insensitive on symbol
    assert s.get_index_drawings("^IXIC") == updated
    # A different symbol is stored independently.
    assert s.get_index_drawings("^GSPC") == "[]"


def test_index_drawings_falsy_stores_empty_array(s):
    s.set_index_drawings("^IXIC", "")
    assert s.get_index_drawings("^IXIC") == "[]"
