from api.services.screener import snapshot_builder


def bar(c):
    return {"o": c, "h": c + 0.5, "l": c - 0.5, "c": c, "v": 1000}


def test_build_row_writes_rs_line_trend_when_spy_given():
    rising = [bar(100.0 + i) for i in range(30)]
    spy = [100.0] * 30
    row = snapshot_builder.build_row("T", rising, None, None, spy_closes=spy)
    assert row["rs_line_trend"] == "up"
    row = snapshot_builder.build_row("T", rising, None, None)
    assert row["rs_line_trend"] is None
