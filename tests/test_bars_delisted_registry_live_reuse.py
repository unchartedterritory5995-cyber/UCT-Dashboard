"""A dead company's registry record never shadows a LIVE listing that reuses its ticker.

MEASURED ON PRODUCTION 2026-11-27. `api/data/delisted_tickers_bulk.json` was enumerated once
(2026-08-09) and keys almost every record by its BARE symbol. `delisted_registry.resolve` answers
an exact key first, so when the exchange later gives that symbol to a new listing, every chart
ask for it goes to the frozen delisted branch: intraday answers `{"bars": []}` and the member
sees a blank chart. `/api/ticker-search` (built from the vendor's ACTIVE reference list) showed
43 such symbols as live stocks or ETFs: ANT (Anthropic, PBC), NANO (Forge Nano), AAC, HOS,
SATS... (41 re-keyed; 2 were the same company after a corporate action and are deleted, see
SAME_COMPANY_REMOVED). Every one answered 0 intraday rows with `Server-Timing: bars;desc="entry"` while D
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

# symbol: (the dead entity's new key, the dead record's name, the LIVE listing's name). The live name is
# prod /api/ticker-search on 2026-11-27 (the vendor's ACTIVE reference list); every live D tape starts AFTER the
# dead record's delisted_date, so none is the dead equity still trading. Reuse is proven by a DIFFERENT name,
# except HOS (see NEW_SECURITY_SAME_ISSUER).
REUSED_LIVE = {
    "AAC": ("AAC-2023", "Ares Acquisition Corporation", "Ares Acquisition Corporation III"),
    "ANS": ("ANS-2008", "AIRNET SYSTEMS INC.", "GraniteShares 2x Short Anthropic Daily ETF"),
    "ANSS": ("ANSS-2025", "Ansys Inc", "Leverage Shares 1X Short Anthropic Daily ETF"),
    "ANT": ("ANT-2006", "ANTEON INTERNATIONAL CORPORATION", "Anthropic, PBC Class A Common Stock"),
    "ARIA": ("ARIA-2017", "Ariad Pharmaceuticals Inc", "Aria Opportunities ETF"),
    "AT": ("AT-2021", "Atlantic Power Corporation", "Defiance Robotics Actuators ETF"),
    "ATHX": ("ATHX-2023", "Athersys, Inc. Common Stock", "2x Anthropic ETF"),
    "AXNX": ("AXNX-2024", "Axonics, Inc. Common Stock", "Axonex AI Group Limited Class A Ordinary Shares"),
    "AZR": ("AZR-2007", "AZTAR CORP", "Azora Therapeutics, Inc. Common Stock"),
    "BCOM": ("BCOM-2020", "B Communications Ltd", "Rareview Bloomberg Commodity Index ETF"),
    "CAPA": ("CAPA-2021", "HighCape Capital Acquisition Corp. Class A Common Stock", "Defiance AI Capacitors & MLCC ETF"),
    "CASK": ("CASK-2025", "Heritage Distilling Holding Company, Inc. Common Stock", "Sempreon, Inc. Common Stock"),
    "COOL": ("COOL-2024", "Corner Growth Acquisition Corp. Class A Ordinary Shares", "VegaShares AI Thermal, Cooling & Power Management ETF"),
    "CSRA": ("CSRA-2018", "CSRA Inc.", "Cohen & Steers Real Assets Active ETF"),
    "DICE": ("DICE-2023", "DICE Therapeutics, Inc. Common Stock", "Tema Trading & Prediction Markets ETF"),
    "FIXX": ("FIXX-2024", "Homology Medicines, Inc. Common Stock", "Leverage Shares 2X Long FIX Daily ETF"),
    "HH": ("HH-2017", "Hooper Holmes Inc", "Corgi FTSE High Yield Corporate Bond ETF"),
    "HOS": ("HOS-2019", "Hornbeck Offshore Services, Inc.", "Hornbeck Offshore Services, Inc."),
    "HYAC": ("HYAC-2026", "Haymaker Acquisition Corp. 4", "Haymaker Acquisition Corp V"),
    "HZN": ("HZN-2023", "Horizon Global Corporation", "Bright Horizon Energy Corporation"),
    "IAM": ("IAM-2018", "I-AM Capital Acquisition Company Common Stock", "Iambic Therapeutics, Inc. Common Stock"),
    "ISRL": ("ISRL-2025", "Israel Acquisitions Corp Class A Ordinary Shares", "Defiance KSM Israel 120 ETF"),
    "JONE": ("JONE-2018", "Jones Energy, Inc.", "Jones Ventures INTL Acquisition1 Corp Class A Ordinary Shares"),
    "MATR": ("MATR-2018", "Mattersight Corp.", "Harbor Multi-Asset Total Return ETF"),
    "MEA": ("MEA-2015", "METALICO INC", "GraniteShares Autocallable META ETF"),
    "MGOL": ("MGOL-2025", "MGO Global Inc. Common Stock", "Leverage Shares MANGOS ETF"),
    "MN": ("MN-2022", "MANNING & NAPIER, INC.", "Corgi MANGOS ETF"),
    "NANO": ("NANO-2019", "Nanometrics Inc", "Forge Nano Holdings Inc. Common Stock"),
    "NORD": ("NORD-2017", "Nord Anglia Education, Inc.", "Nordicus Partners Corporation Common Stock"),
    "OIG": ("OIG-2023", "Orbital Infrastructure Group, Inc. Common Stock", "Orion180 Insurance Group Inc. Class A common stock"),
    "OSPR": ("OSPR-2018", "Osprey Energy Acquisition Corp. Class A", "Osprey Acquisition Corp. III Class A Ordinary Shares"),
    "PCPC": ("PCPC-2022", "Periphas Capital Partnering Corporation", "Porter & Company Property & Casualty Index ETF"),
    "PGRW": ("PGRW-2023", "Progress Acquisition Corp. Class A Common Stock", "Principal Growth ETF"),
    "PORT": ("PORT-2024", "Southport Acquisition Corporation", "Southport Acquisition Corp. II"),
    "RML": ("RML-2006", "RUSSELL CORPORATION (DELAWARE)", "Resolution Minerals Ltd American Depositary Shares"),
    "SATS": ("SATS-2026", "EchoStar Corporation", "Strive, Inc. 15% Series A Perpetual SATS Preferred Stock"),
    "SAX": ("SAX-2006", "SAXON CAPITAL INC", "Saratoga Investment Corp. 8.00% Notes due 2031"),
    "SDC": ("SDC-2023", "SmileDirectClub, Inc. Class A Common Stock", "KICK Space Data Center & Infrastructure Index ETF"),
    "SIX": ("SIX-2024", "Six Flags Entertainment Corp.", "Global X Magnificent Six ETF"),
    "SONN": ("SONN-2025", "Sonnet BioTherapeutics Holdings, Inc. Common Stock", "The Southern Company 2026 Series A Corporate Units"),
    "UB": ("UB-2008", "UNIONBANCAL CORP (DELAWARE)", "Corgi FTSE U.S. Treasury Bond ETF"),
}

#: Same issuer name, a DIFFERENT security: Hornbeck Offshore's pre-bankruptcy equity (delisted 2019-12-23) and the
#: listing whose vendor tape starts 2026-09-02. The dead record keeps the old equity's clamped history as HOS-2019.
NEW_SECURITY_SAME_ISSUER = {"HOS"}

#: The SAME company still trading: the vendor's "delisted" record was a corporate action, not a death, so the dead
#: record is DELETED (re-keying would invent a dead twin of a live company). Evidence, prod 2026-11-27:
#:   BURU  "Nuburu, Inc." both sides; one continuous D tape 2023-02-01 -> today. NYSE American suspended it
#:         2026-07-17 (OTC from 07-20); 1-for-40 reverse split 2026-09-01; relisted on NYSE American as BURU.
#:   WORX  "SC WORX Corp" / "SCWorx Corp."; one continuous D tape 2016-10-06 -> today.
SAME_COMPANY_REMOVED = {"BURU", "WORX"}

_BULK = os.path.join(os.path.dirname(__file__), "..", "api", "data", "delisted_tickers_bulk.json")


@pytest.fixture(autouse=True)
def fresh_registry():
    delisted_registry.reload()
    yield
    delisted_registry.reload()


@pytest.mark.parametrize("sym", sorted(set(REUSED_LIVE) | SAME_COMPANY_REMOVED))
def test_a_LIVE_reused_symbol_does_not_resolve_as_delisted(sym):
    rec = delisted_registry.resolve(sym)
    assert rec is None, (
        f"{sym} is a live listing today but resolves to the dead entity {rec and rec.get('name')!r}: "
        f"its intraday charts answer an empty series")


@pytest.mark.parametrize("sym", sorted(REUSED_LIVE))
def test_the_dead_entity_stays_chartable_under_its_own_key(sym):
    key, dead_name, _live_name = REUSED_LIVE[sym]
    rec = delisted_registry.resolve(key)
    assert rec is not None and rec["ticker"] == key, key
    assert rec["provider_symbol"] == sym, "the dead entity is still fetched as its own era's symbol"
    raw = {r["ticker"]: r for r in json.load(open(_BULK, encoding="utf-8"))}
    assert raw[key].get("bare_live") is True, "bare_live keeps the bare symbol out of the alias map"
    assert raw[key]["name"] == dead_name, "the re-keyed record is the dead company this rail names"


def _norm_name(n):
    return " ".join("".join(ch for ch in n.upper() if ch.isalnum() or ch == " ").split())


@pytest.mark.parametrize("sym", sorted(REUSED_LIVE))
def test_reuse_is_proven_by_a_DIFFERENT_company_name(sym):
    _key, dead_name, live_name = REUSED_LIVE[sym]
    if sym in NEW_SECURITY_SAME_ISSUER:
        assert _norm_name(dead_name) == _norm_name(live_name)
        return
    assert _norm_name(dead_name) != _norm_name(live_name), (
        f"{sym}: the live listing carries the dead record's name: the same company after a corporate action is "
        f"DELETED from the registry (SAME_COMPANY_REMOVED), never re-keyed")


@pytest.mark.parametrize("sym", sorted(SAME_COMPANY_REMOVED))
def test_a_SAME_company_corporate_action_leaves_no_dead_record(sym):
    assert delisted_registry.resolve(sym) is None
    raw = json.load(open(_BULK, encoding="utf-8"))
    left = [r["ticker"] for r in raw if r.get("provider_symbol") == sym or r["ticker"].split("-")[0] == sym]
    assert left == [], f"{sym} is the same live company; no dead twin may remain: {left}"


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
