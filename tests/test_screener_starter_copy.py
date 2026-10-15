import os
import re

from api.services.screener import saved_screens
from api.services.screener.saved_screens import PATTERN_PRESETS, starters

GROUPS = {"Momentum leaders", "Breakouts & entries", "Bases & chart patterns", "Earnings", "Quality & value"}
_JS = os.path.join(os.path.dirname(__file__), "..", "app", "src", "pages", "screener", "focus", "screenGroups.js")


def _all(monkeypatch):
    monkeypatch.setenv(saved_screens.PATTERN_PRESETS_FLAG, "1")
    return starters()


def test_every_starter_has_a_description(monkeypatch):
    for s in _all(monkeypatch):
        d = s.get("description") or ""
        assert 10 <= len(d) <= 80, (s["id"], d)
        assert "—" not in d and "–" not in d and " - " not in d, s["id"]
        assert d.isascii(), s["id"]


def test_every_preset_has_a_group(monkeypatch):
    for s in _all(monkeypatch):
        if s["id"].startswith("starter_pattern_"):
            assert s["group"] == "Chart Patterns", s["id"]
        else:
            assert s.get("group") in GROUPS, s["id"]


def test_descriptions_are_unique(monkeypatch):
    ds = [s["description"] for s in _all(monkeypatch)]
    assert len(ds) == len(set(ds))


def test_every_pattern_preset_has_its_own_description():
    assert set(saved_screens.PATTERN_DESCRIPTIONS) == {p for p, _ in PATTERN_PRESETS}


def test_all_keys_present(monkeypatch):
    for s in _all(monkeypatch):
        assert set(s) >= {"id", "name", "spec", "group", "description"}


def test_server_groups_match_the_clients_fallback_map():
    """Parses the client's FALLBACK_GROUP (screenGroups.js) so the two cannot drift."""
    js = open(_JS, encoding="utf-8").read()
    label_to_key = {m.group(2): m.group(1) for m in
                    re.finditer(r"key: '(\w+)', label: '([^']+)'", js)}
    body = re.search(r"FALLBACK_GROUP = \{(.*?)\n\}", js, re.S).group(1)
    fallback = dict(re.findall(r"(\w+): '(\w+)'", body))
    assert fallback and label_to_key
    for s in starters():
        assert label_to_key[s["group"]] == fallback[s["id"]], s["id"]
    assert {s["id"] for s in starters()} == set(fallback)


# -- every description names every condition its screen applies (N8) ---------
# The plain words a member reads for each filter key. A starter gaining a key
# this map does not know fails below, so the copy cannot silently fall behind.
_PLAIN = {
    "security_type": r"\bstocks?\b",
    "rs_rank": r"\bRS\b",
    "adr_pct": r"daily range",
    "dollar_vol_30d": r"traded",
    "price": r"\bprice\b",
    "above_50sma": r"\b50 day\b",
    "pct_vs_ema20": r"\b20 day EMA\b",
    "ema_stack_intact": r"\bEMAs stacked\b",
    "vol_nweek_low": r"\bvolume low\b",
    "dist_52w_high_pct": r"\b52 week high\b",
    "close_cv_pct": r"\btight\b",
    "vol_updown_ratio": r"\bup volume\b",
    "pe_fwd": r"\bP/E\b",
    "roe": r"\bROE\b",
    "eps_growth": r"\bEPS growth\b",
    "gap_pct": r"\bgapped\b",
    "vol_ratio": r"\bvolume\b",
    "market_cap": r"\bmarket cap\b",
    "new_52w_high": r"\b52 week high\b",
    "days_to_earnings": r"\breport",
    "optionable": r"\boptions\b",
}
# A named structure or pattern is one condition; its words come from the value.
_BY_VALUE = {
    ",pocket-pivot,": r"\bdown day\b",
    ",power-play,": r"\bdoubled\b",
    ",stage-2-breakout,": r"\bswing high\b",
    ",three-weeks-tight,": r"\bweekly closes\b",
}


def test_every_description_names_every_condition(monkeypatch):
    for s in _all(monkeypatch):
        d = s["description"]
        for f in s["spec"]["filters"]:
            k = f["key"]
            if k == "pattern_engine_id":
                pid = f["value"].strip(",")
                assert d == saved_screens.PATTERN_DESCRIPTIONS[pid], s["id"]
                continue
            pat = _BY_VALUE.get(f.get("value")) if k == "base_structure" else _PLAIN.get(k)
            assert pat, f"{s['id']}: no plain words known for {k} {f.get('value')}"
            assert re.search(pat, d, re.I), f"{s['id']}: {d!r} does not name {k}"


def test_the_description_check_can_fail(monkeypatch):
    """Non-vacuity: the leaders starter WITHOUT its price clause in the copy fails."""
    s = next(x for x in _all(monkeypatch) if x["id"] == "starter_momentum_leaders")
    assert not re.search(_PLAIN["price"], s["description"].replace("price $5+, ", ""), re.I)


def test_every_starter_is_stocks_only(monkeypatch):
    """Owner decision 3: no ETFs or closed-end funds in any starter, expressed the
    way the Type filter's Include control writes it."""
    from api.services.screener import filters as F
    for s in _all(monkeypatch):
        st = [f for f in s["spec"]["filters"] if f["key"] == "security_type"]
        assert st == [{"key": "security_type", "op": "in", "values": ["Stock", "ADR"]}], s["id"]
        assert set(st[0]["values"]) <= set(F.FILTERS["security_type"]["options"])
        assert "ETF" not in st[0]["values"]
