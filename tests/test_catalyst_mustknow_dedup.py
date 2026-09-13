"""F-S7-5 — the must-know rule gets its own dedup key. LEGACY PATH.

⛔ **THIS WAS A LIVE PRODUCTION DEFECT, NOT A MIGRATION ARTEFACT.** Read live on
`web`, 2026-09-12: `CATALYST_MUSTKNOW_ALERTS_ENABLED=1`,
`CATALYST_MUSTKNOW_GRADES=A`, and `CATALYST_ALERTS_ENABLED` unset (code default
ON). **Both rules armed.** So every admin who also WATCHED a name was not
receiving the must-know alert for it — and the suppressed alert is the
HIGHER-severity one, landing exactly on the names an operator cared enough to
watch, while a must-know alert exists to reach somebody REGARDLESS of their
watchlist.

⭐ **THE FIX IS THE ONE THIS CODEBASE ALREADY MADE FOR THE SAME SHAPE** —
`awareness/rules.py`'s `{sym}:stop_hit` vs `{sym}:stop_near`, whose comment says
*"an earlier 'nearing stop' warning must never swallow the THROUGH-the-stop
escalation."*

⛔ **MEMBER-VISIBLE.** This is a DELIVERY change: admins who watch a name start
receiving must-know alerts for it. Nobody loses anything — the watchlist rule's
key is untouched — so the only possible direction is one more alert.
"""
from __future__ import annotations

import pathlib

import pytest

from api.services.catalyst import engine as ce
from api.services.catalyst import store as cstore

_REPO = pathlib.Path(__file__).resolve().parents[1]
DAY = "2026-09-11"
ADMIN = "admin-1"


def _rows(*specs):
    return [{"ticker": t, "grade": g, "tag": tag, "catalyst_type": ct}
            for t, g, tag, ct in specs]


@pytest.fixture()
def wired(monkeypatch):
    """Both legacy rules, with delivery captured and the dedup table in memory.

    ⛔ THE DEDUP STORE IS REAL IN SHAPE — a dict keyed exactly as
    `try_record_alert` keys it, `ticker.upper()` included — because the whole
    defect lived in the KEY. A stub that returned True unconditionally would
    make every assertion here pass and prove nothing.
    """
    fired: set = set()
    delivered: list = []

    def _try_record(user_id, ticker, market_date):
        key = (user_id, (ticker or "").upper(), market_date)
        if key in fired:
            return False
        fired.add(key)
        return True

    from api.services import watchlist_alert_service as wal
    monkeypatch.setattr(wal, "deliver_alert_payload",
                        lambda **kw: delivered.append((kw["user_id"], kw["sym"], kw["source"])))
    monkeypatch.setattr(ce.store, "try_record_alert", _try_record)
    monkeypatch.setattr(ce, "_collect_admin_user_ids", lambda: [ADMIN])
    monkeypatch.setenv("CATALYST_ALERTS_ENABLED", "1")
    monkeypatch.setenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", "1")
    return {"fired": fired, "delivered": delivered, "monkeypatch": monkeypatch}


# ─────────────────────────────────────────────────────────────────────────────
# THE FIX
# ─────────────────────────────────────────────────────────────────────────────

def test_BOTH_rules_fire_for_the_same_user_ticker_and_date(wired):
    """⛔ THE DEFECT, GONE. An admin who WATCHES a grade-A name now gets both."""
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    wired["monkeypatch"].setattr(ce, "_collect_user_watchlist_tickers",
                                 lambda: {ADMIN: {"NVDA"}})

    ce._fire_catalyst_alerts(rows, DAY)
    ce._fire_mustknow_alerts(rows, DAY)

    sources = sorted(src for (_u, _s, src) in wired["delivered"])
    assert sources == ["catalyst_alert", "catalyst_mustknow"], (
        f"expected BOTH rules to deliver for one (user, ticker, date); got {wired['delivered']}")
    syms = {s for (_u, s, _src) in wired["delivered"]}
    assert syms == {"NVDA"}


def test_the_two_keys_are_DISTINCT_in_the_dedup_table(wired):
    """The mechanism, asserted at the key rather than at the outcome."""
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    wired["monkeypatch"].setattr(ce, "_collect_user_watchlist_tickers",
                                 lambda: {ADMIN: {"NVDA"}})
    ce._fire_catalyst_alerts(rows, DAY)
    ce._fire_mustknow_alerts(rows, DAY)

    assert (ADMIN, "NVDA", DAY) in wired["fired"], "the watchlist key is unchanged"
    assert (ADMIN, "MUSTKNOW:NVDA", DAY) in wired["fired"], "the must-know key is namespaced"
    assert len(wired["fired"]) == 2


def test_CONTROL_it_fails_if_the_two_keys_EVER_COLLIDE_AGAIN():
    """⛔⛔ THE STANDING CONTROL. Not an outcome test — a statement about the two
    identities, so a future edit that re-shares the key goes red here even if it
    happens to leave the delivery counts alone on some fixture."""
    for ticker in ("NVDA", "nvda", "BRK-B", "A", "UCTA5"):
        watch_key = ticker.upper()
        mustknow_key = cstore.mustknow_dedup_key(ticker).upper()
        assert watch_key != mustknow_key, (
            f"the two dedup identities collide for {ticker!r} — F-S7-5 is back")
        assert mustknow_key.startswith(cstore.MUSTKNOW_DEDUP_PREFIX.upper())
    # ⛔ NON-VACUITY: the prefix is a real, non-empty string. An empty prefix
    # would make every assertion above pass by comparing a string to itself...
    # except it would not, which is exactly why this is asserted separately.
    assert len(cstore.MUSTKNOW_DEDUP_PREFIX) > 3


def test_the_namespace_is_declared_ONCE():
    """A second spelling anywhere silently re-shares the key."""
    hits = []
    for p in (_REPO / "api").rglob("*.py"):
        txt = p.read_text(encoding="utf-8", errors="replace")
        if '"mustknow:"' in txt or "'mustknow:'" in txt:
            hits.append(str(p.relative_to(_REPO)).replace("\\", "/"))
    assert hits == ["api/services/catalyst/store.py"], (
        f"the must-know dedup prefix literal appears outside store.py: {hits}")


# ─────────────────────────────────────────────────────────────────────────────
# THE WATCH RULE IS UNTOUCHED
# ─────────────────────────────────────────────────────────────────────────────

def test_watch_only_behaviour_is_BYTE_IDENTICAL(wired):
    """⛔ NOBODY LOSES AN ALERT THEY GET TODAY. A member who is not an admin,
    or a name with no qualifying grade, must behave exactly as before."""
    rows = _rows(("NVDA", "C", "News", "Momentum"), ("AMD", None, "Gapper", None))
    wired["monkeypatch"].setattr(ce, "_collect_user_watchlist_tickers",
                                 lambda: {"member-1": {"NVDA", "AMD"}})
    ce._fire_catalyst_alerts(rows, DAY)
    ce._fire_mustknow_alerts(rows, DAY)

    assert sorted(s for (_u, s, _src) in wired["delivered"]) == ["AMD", "NVDA"]
    assert {src for (_u, _s, src) in wired["delivered"]} == {"catalyst_alert"}
    assert wired["fired"] == {("member-1", "NVDA", DAY), ("member-1", "AMD", DAY)}


def test_the_watch_rule_still_dedups_itself_within_a_day(wired):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    wired["monkeypatch"].setattr(ce, "_collect_user_watchlist_tickers",
                                 lambda: {ADMIN: {"NVDA"}})
    ce._fire_catalyst_alerts(rows, DAY)
    ce._fire_catalyst_alerts(rows, DAY)   # a second refresh, same day
    assert len(wired["delivered"]) == 1, "the watchlist rule's own dedup must be unchanged"


def test_the_mustknow_rule_still_dedups_ITSELF_within_a_day(wired):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    wired["monkeypatch"].setattr(ce, "_collect_user_watchlist_tickers", lambda: {})
    ce._fire_mustknow_alerts(rows, DAY)
    ce._fire_mustknow_alerts(rows, DAY)
    assert len(wired["delivered"]) == 1, (
        "namespacing the key must not disable the must-know rule's own dedup")


def test_a_different_market_date_is_a_different_key(wired):
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    wired["monkeypatch"].setattr(ce, "_collect_user_watchlist_tickers", lambda: {})
    ce._fire_mustknow_alerts(rows, DAY)
    ce._fire_mustknow_alerts(rows, "2026-09-12")
    assert len(wired["delivered"]) == 2


# ─────────────────────────────────────────────────────────────────────────────
# MUTATION
# ─────────────────────────────────────────────────────────────────────────────

def test_MUTATION_restoring_the_shared_key_puts_the_DEFECT_BACK(wired, monkeypatch):
    """⛔ THE MUTATION PROOF, run in-process against the REAL function.

    Restore the shared key — by making `mustknow_dedup_key` the identity
    function, which is exactly what the code did before F-S7-5 — and the
    must-know alert must vanish for an admin who watches the name.

    ⭐ If it did NOT vanish, the namespacing is not what is doing the work and
    every green above means nothing.
    """
    monkeypatch.setattr(ce.store, "mustknow_dedup_key", lambda t: (t or "").upper())
    rows = _rows(("NVDA", "A", "Catalyst", "FDA"))
    wired["monkeypatch"].setattr(ce, "_collect_user_watchlist_tickers",
                                 lambda: {ADMIN: {"NVDA"}})

    ce._fire_catalyst_alerts(rows, DAY)
    ce._fire_mustknow_alerts(rows, DAY)

    sources = sorted(src for (_u, _s, src) in wired["delivered"])
    assert sources == ["catalyst_alert"], (
        "with the shared key restored the must-know alert must be SUPPRESSED — "
        f"if it still fired, the fix is not what is delivering it. Got {sources}")
