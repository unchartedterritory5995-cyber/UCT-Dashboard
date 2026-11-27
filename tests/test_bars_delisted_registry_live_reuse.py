"""A dead company's registry record never shadows a LIVE listing that reuses its ticker.

MEASURED ON PRODUCTION 2026-11-27. `api/data/delisted_tickers_bulk.json` was enumerated once
(2026-08-09) and keys almost every record by its BARE symbol. `delisted_registry.resolve` answers
an exact key first, so when the exchange later gives that symbol to a new listing, every chart
ask for it goes to the frozen delisted branch: intraday answers `{"bars": []}` and the member
sees a blank chart. `/api/ticker-search` (built from the vendor's ACTIVE reference list) showed
43 such symbols as live stocks or ETFs: ANT (Anthropic, PBC), NANO (Forge Nano), AAC, HOS,
SATS... Every one answered 0 intraday rows with `Server-Timing: bars;desc="entry"` while D
served the live company's rows.

The file's own convention for a reused symbol is already there (`CPN-2018`, `GEW-2024`,
`KW-2023`): key the dead entity `SYM-<delisted year>` and set `bare_live`. The bare symbol
then resolves to nothing and takes the live path, while the dead entity stays chartable under
its own key, fetched as `SYM` clamped to its trading life.

⚠️ The list below is a measurement and it goes stale: the exchanges reuse symbols all the
time. The durable guard is a periodic reconcile against the active reference list (see the PR).
"""
import json
import os

import pytest

from api.services import delisted_registry

# (symbol, the dead entity's new key): live per prod /api/ticker-search 2026-11-27.
REUSED_LIVE = {
    "AAC": "AAC-2023", "ANS": "ANS-2008", "ANSS": "ANSS-2025", "ANT": "ANT-2006", "ARIA": "ARIA-2017",
    "AT": "AT-2021", "ATHX": "ATHX-2023", "AXNX": "AXNX-2024", "AZR": "AZR-2007", "BCOM": "BCOM-2020",
    "BURU": "BURU-2026", "CAPA": "CAPA-2021", "CASK": "CASK-2025", "COOL": "COOL-2024", "CSRA": "CSRA-2018",
    "DICE": "DICE-2023", "FIXX": "FIXX-2024", "HH": "HH-2017", "HOS": "HOS-2019", "HYAC": "HYAC-2026",
    "HZN": "HZN-2023", "IAM": "IAM-2018", "ISRL": "ISRL-2025", "JONE": "JONE-2018", "MATR": "MATR-2018",
    "MEA": "MEA-2015", "MGOL": "MGOL-2025", "MN": "MN-2022", "NANO": "NANO-2019", "NORD": "NORD-2017",
    "OIG": "OIG-2023", "OSPR": "OSPR-2018", "PCPC": "PCPC-2022", "PGRW": "PGRW-2023", "PORT": "PORT-2024",
    "RML": "RML-2006", "SATS": "SATS-2026", "SAX": "SAX-2006", "SDC": "SDC-2023", "SIX": "SIX-2024",
    "SONN": "SONN-2025", "UB": "UB-2008", "WORX": "WORX-2026",
}

_BULK = os.path.join(os.path.dirname(__file__), "..", "api", "data", "delisted_tickers_bulk.json")


@pytest.fixture(autouse=True)
def fresh_registry():
    delisted_registry.reload()
    yield
    delisted_registry.reload()


@pytest.mark.parametrize("sym", sorted(REUSED_LIVE))
def test_a_LIVE_reused_symbol_does_not_resolve_as_delisted(sym):
    rec = delisted_registry.resolve(sym)
    assert rec is None, (
        f"{sym} is a live listing today but resolves to the dead entity {rec and rec.get('name')!r}: "
        f"its intraday charts answer an empty series")


@pytest.mark.parametrize("sym,key", sorted(REUSED_LIVE.items()))
def test_the_dead_entity_stays_chartable_under_its_own_key(sym, key):
    rec = delisted_registry.resolve(key)
    assert rec is not None and rec["ticker"] == key, key
    assert rec["provider_symbol"] == sym, "the dead entity is still fetched as its own era's symbol"
    raw = {r["ticker"]: r for r in json.load(open(_BULK, encoding="utf-8"))}
    assert raw[key].get("bare_live") is True, "bare_live keeps the bare symbol out of the alias map"


def test_a_bare_live_record_is_never_keyed_by_its_bare_symbol():
    """The invariant behind the convention: `bare_live` means the bare symbol belongs to someone else."""
    bad = [r["ticker"] for r in json.load(open(_BULK, encoding="utf-8"))
           if r.get("bare_live") and r["ticker"] == r.get("provider_symbol")]
    assert bad == [], bad


def test_the_live_symbol_takes_the_live_bars_path(monkeypatch):
    """Drives the real serve: NANO (Forge Nano) reaches `_get_bars_inner`, not the frozen branch."""
    from fastapi.responses import ORJSONResponse
    from api.routers import bars
    from api.services import bars_fetch
    seen = []

    def inner(t, tf, n):
        seen.append((t, tf))
        return ORJSONResponse(content={"ticker": t.upper(), "tf": tf, "bars": [
            {"t": 1764000000, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]})

    def frozen(*a, **k):
        raise AssertionError("a live listing was sent to the delisted branch")
    monkeypatch.setattr(bars, "_get_bars_inner", inner)
    monkeypatch.setattr(bars_fetch, "_get_delisted_bars_response", frozen)
    r = bars.serve_bars("NANO", tf="5", bars=200, since="", to="")
    assert seen == [("NANO", "5")]
    assert len(orjson_loads(r.body)["bars"]) == 1


def orjson_loads(b):
    import orjson
    return orjson.loads(b)
