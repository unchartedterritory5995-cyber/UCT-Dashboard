"""Server-side dark-pool zone aggregation: cumulative sum, 2%-band clustering, top-N."""
from api.darkpool_db import _cluster_prints_to_zones, _dp_dnum


def _p(price, notional, volume=0, date="8/13/2026"):
    return {"price": price, "notional": notional, "volume": volume,
            "date": date, "dateLong": date, "dateRaw": date, "pctAvgVol": 0, "type": "B"}


def test_dnum_orders_across_month_boundary():
    assert _dp_dnum("12/31/2025") < _dp_dnum("1/2/2026")
    assert _dp_dnum("8/3/2026") < _dp_dnum("8/13/2026")


def test_cluster_sums_cumulative_notional_across_prints():
    # Three prints within 2% at ~$100 accumulate into ONE zone; the far one splits.
    prints = [_p(100, 5e6), _p(100.5, 6e6), _p(101.5, 4e6), _p(250, 3e6)]
    zones = _cluster_prints_to_zones(prints)
    assert len(zones) == 2
    zones.sort(key=lambda z: z["notional"], reverse=True)
    big = zones[0]
    assert big["notional"] == 15e6          # 5+6+4, cumulative — the whole point
    assert big["printCount"] == 3
    assert big["_isCluster"] is True
    assert big["priceLow"] == 100 and big["priceHigh"] == 101.5
    far = zones[1]
    assert far["notional"] == 3e6 and far["printCount"] == 1 and far["_isCluster"] is False


def test_zone_labeled_by_most_recent_member():
    # A multi-day cluster carries its NEWEST print's date, not the seed's.
    prints = [_p(200, 4e6, date="8/3/2026"), _p(200.5, 5e6, date="8/12/2026")]
    zones = _cluster_prints_to_zones(prints)
    assert len(zones) == 1
    assert zones[0]["dateRaw"] == "8/12/2026"       # newest wins
    assert zones[0]["notional"] == 9e6


def test_empty_and_bad_prices_are_safe():
    assert _cluster_prints_to_zones([]) == []
    # zero / missing price drops out; doesn't crash or seed a zone
    z = _cluster_prints_to_zones([_p(0, 1e6), _p(-5, 1e6), {"notional": 1e6}])
    assert z == []
