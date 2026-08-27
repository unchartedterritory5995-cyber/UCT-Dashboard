"""Holdings-as-truth for OPEN options — the SnapTrade unit conventions.

`reconcile_option_holdings` / `_holding_contract` had ZERO test coverage
repo-wide (audit D-2) while carrying a factor-of-100 normalisation and, on a
mini option, disagreeing with `balances._opt_contract_multiplier` by 10×
(audit D-3). A factor of 100 with no test is the most dangerous shape in a
trading product: it is off by 10,000% and every internal consistency check
still passes.

The member-visible number these tests pin is the one rendered by
`OptionStrategiesSection.jsx`:

    open P&L = brokerCurrentValue - netEntry

so every expectation below is hand-worked against that formula and asserted
EXACTLY (never pytest.approx — an approx window is how a real defect hides).
"""

from __future__ import annotations

import pytest

from api.services import auth_db
from api.services.journal_two.db import ensure_schema
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two.broker import balances
from api.services.journal_two.broker import option_reconstruct as oro


@pytest.fixture
def env(tmp_path, monkeypatch):
    dbfile = tmp_path / "auth.db"
    monkeypatch.setattr(auth_db, "_DB_PATH", str(dbfile))
    conn = auth_db.get_connection()
    ensure_schema(conn)
    conn.close()
    acct = accounts_service.create_account(
        "u1", {"name": "Broker", "color": "blue", "startingBalance": 1.0}
    )
    return {"j2": acct["id"], "ba": {"id": "ba1", "j2AccountId": acct["id"]}}


def _holding(*, units, avg_purchase_price, price, mini=False,
             underlying="AAPL", strike=200.0, expiration="2026-06-19",
             option_type="CALL"):
    """A SnapTrade option holding.

    THE QUIRK UNDER TEST: `price` is PER-SHARE (the premium quote a member
    sees, e.g. 7.25) while `average_purchase_price` is PER-CONTRACT (premium
    x contract size, e.g. 550.00). They are NOT in the same unit.
    """
    return {
        "symbol": {"option_symbol": {
            "ticker": f"{underlying} 260619C00200000",
            "strike_price": strike,
            "expiration_date": expiration,
            "option_type": option_type,
            "underlying_symbol": {"symbol": underlying},
            "is_mini_option": mini,
        }},
        "units": units,
        "price": price,
        "average_purchase_price": avg_purchase_price,
        "currency": {"code": "USD"},
    }


def _open_rows(user="u1"):
    conn = auth_db.get_connection()
    try:
        return conn.execute(
            "SELECT s.strategy_type, s.direction, s.status, s.net_entry, "
            "       s.broker_current_value, s.external_id, "
            "       l.side, l.qty, l.entry_price "
            "FROM j2_option_strategies s JOIN j2_option_legs l "
            "  ON l.strategy_id = s.id "
            "WHERE s.user_id = ? ORDER BY s.created_at", (user,),
        ).fetchall()
    finally:
        conn.close()


# ── D-2 · the x100 normalisation, on a STANDARD (100-share) contract ────────

def test_average_purchase_price_is_per_contract_and_normalises_to_per_share():
    """`average_purchase_price` 550.00 is the PER-CONTRACT cost of a 5.50
    premium. leg.entry_price is per-share, so it must read 5.50 — not 550.00
    (no normalisation) and not 0.055 (inverted)."""
    c = oro._holding_contract(_holding(units=2, avg_purchase_price=550.0, price=7.25))
    assert c is not None
    assert c["entry_price"] == 5.50
    assert c["mark"] == 7.25          # `price` is already per-share — never divided
    assert c["multiplier"] == 100


def test_standard_contract_open_pnl_is_exact(env):
    # Hand-worked: 2 contracts, premium paid 5.50/share, mark now 7.25/share.
    #   net_entry            = +1 x 2 x 5.50 x 100 = 1100.00
    #   brokerCurrentValue   =      2 x 7.25 x 100 = 1450.00
    #   member P&L           = 1450.00 - 1100.00   =  350.00
    out = oro.reconcile_option_holdings(
        "u1", env["ba"], [_holding(units=2, avg_purchase_price=550.0, price=7.25)])
    assert out["created"] == 1 and out["valued"] == 1

    r = _open_rows()[0]
    assert r["entry_price"] == 5.50
    assert r["qty"] == 2
    assert r["net_entry"] == 1100.00
    assert r["broker_current_value"] == 1450.00
    assert r["broker_current_value"] - r["net_entry"] == 350.00


# ── D-3 · mini options: 10 shares/contract, ONE authority over that value ───

def test_mini_option_open_pnl_is_exact(env):
    """A mini option is 10 shares/contract. `balances._opt_contract_multiplier`
    already knew this; `option_reconstruct` hardcoded 100 in three places, so
    the member saw an entry price 10x too low and a current value 10x too high
    on the same screen where `balances.option_market_value` got it right.

    Hand-worked: 3 mini contracts, premium paid 5.50/share, mark now 7.25/share.
      average_purchase_price = 5.50 x 10        =   55.00  (PER-CONTRACT)
      net_entry              = +1 x 3 x 5.50 x 10 = 165.00
      brokerCurrentValue     =      3 x 7.25 x 10 = 217.50
      member P&L             = 217.50 - 165.00    =  52.50

    Before the fix this rendered 2175.00 - 165.00 = 2010.00.
    """
    out = oro.reconcile_option_holdings(
        "u1", env["ba"],
        [_holding(units=3, avg_purchase_price=55.0, price=7.25, mini=True)])
    assert out["created"] == 1

    r = _open_rows()[0]
    assert r["entry_price"] == 5.50
    assert r["net_entry"] == 165.00
    assert r["broker_current_value"] == 217.50
    assert r["broker_current_value"] - r["net_entry"] == 52.50


def test_mini_option_current_value_agrees_with_the_balances_sibling(env):
    """The two modules read the SAME `raw_option_holdings` payload. Their
    marks must agree to the cent — a second authority over one value is this
    repo's most-repeated defect, and here it sat on a money number."""
    h = _holding(units=3, avg_purchase_price=55.0, price=7.25, mini=True)
    oro.reconcile_option_holdings("u1", env["ba"], [h])

    assert _open_rows()[0]["broker_current_value"] == balances.option_market_value([h])


def test_the_multiplier_is_read_from_balances_not_reimplemented(env, monkeypatch):
    """The WIRE test. Both modules can be individually correct while the wire
    between them is cut — so redefine contract size at the authority and prove
    option_reconstruct moves with it. Reimplement `10 if mini else 100` locally
    and this goes RED while every other test here stays green."""
    monkeypatch.setattr(balances, "_opt_contract_multiplier", lambda o: 7)

    oro.reconcile_option_holdings(
        "u1", env["ba"], [_holding(units=1, avg_purchase_price=700.0, price=9.0)])

    r = _open_rows()[0]
    assert r["entry_price"] == 100.0          # 700.00 / 7
    assert r["net_entry"] == 700.00           # 1 x 100.00 x 7
    assert r["broker_current_value"] == 63.00  # 1 x 9.00 x 7


# ── D-4 · a sign flip must not leave the row disagreeing with itself ────────

def test_a_flip_to_short_reseeds_side_strategy_type_and_net_entry(env):
    """`held` is keyed on (underlying, strike, expiration, contractType) —
    side excluded — so a long -> short flip (e.g. assignment) matches the
    existing row and skips the create branch. Holdings-as-truth already
    corrects quantity there; it must correct SIDE the same way, or net_entry
    keeps its debit sign while broker_current_value goes negative and the
    member's P&L is wrong by twice the position.

    Hand-worked, 1 contract, 5.00 premium, mark now 3.00:
      short net_entry          = -1 x 1 x 5.00 x 100 = -500.00
      short brokerCurrentValue = -1     x 3.00 x 100 = -300.00
      member P&L               = -300.00 - -500.00   = +200.00

    Before the fix: strategy stayed long_call with net_entry +500.00, so the
    screen read -300.00 - 500.00 = -800.00.
    """
    oro.reconcile_option_holdings(
        "u1", env["ba"], [_holding(units=1, avg_purchase_price=500.0, price=6.0)])
    assert _open_rows()[0]["strategy_type"] == "long_call"

    # Same contract, now held SHORT at the same 5.00 basis, marked 3.00.
    oro.reconcile_option_holdings(
        "u1", env["ba"], [_holding(units=-1, avg_purchase_price=500.0, price=3.0)])

    rows = _open_rows()
    assert len(rows) == 1, "a flip must reseed the row, never fork a second one"
    r = rows[0]
    assert r["side"] == "sell"
    assert r["strategy_type"] == "short_call"
    assert r["direction"] == "bearish"
    assert r["net_entry"] == -500.00
    assert r["broker_current_value"] == -300.00
    assert r["broker_current_value"] - r["net_entry"] == 200.00


# ── idempotency · a stable external_id means re-sync = 0 dupes ──────────────

def test_re_syncing_the_same_holdings_creates_no_duplicates(env):
    h = [_holding(units=2, avg_purchase_price=550.0, price=7.25),
         _holding(units=1, avg_purchase_price=55.0, price=7.25, mini=True,
                  underlying="MSFT", strike=410.0)]

    first = oro.reconcile_option_holdings("u1", env["ba"], h)
    second = oro.reconcile_option_holdings("u1", env["ba"], h)

    assert first["created"] == 2
    assert second["created"] == 0 and second["removed"] == 0
    assert second["valued"] == 2
    assert len(_open_rows()) == 2
    assert all(r["external_id"].startswith("bkoptpos:") for r in _open_rows())


def test_a_contract_no_longer_held_is_removed(env):
    h = _holding(units=2, avg_purchase_price=550.0, price=7.25)
    oro.reconcile_option_holdings("u1", env["ba"], [h])
    out = oro.reconcile_option_holdings("u1", env["ba"], [])

    assert out["removed"] == 1
    assert _open_rows() == []


# ── 2026-08-20 reconnect bug · reconciliation is PER-CONTRACT-AGGREGATE ─────
#
# The ledger can hold several open LOTS of one contract (two real 3-lot buys;
# a sell not yet delivered — SnapTrade transactions lag ~a day). The broker
# reports ONE held quantity per contract. Comparing each lot to the held total
# individually made two lots of 3 each "agree" with a held 3, and each was
# stamped the FULL held market value — the account hero read $12,335.65
# against Robinhood's $10,227.88.

from api.services import auth_db as _adb


def _insert_activity_lot(env, *, ext, qty, entry_price, entry_date,
                         underlying="AAPL", strike=200.0,
                         expiration="2026-06-19", contract_type="call",
                         side="buy", user="u1"):
    conn = _adb.get_connection()
    try:
        stype = oro._strategy_type(side, contract_type)
        s = {
            "underlying": underlying, "strike": strike, "expiration": expiration,
            "contractType": contract_type, "side": side, "strategy_type": stype,
            "direction": oro._direction(stype), "qty": qty,
            "entry_price": entry_price, "entry_date": entry_date,
            "entry_fee": 0.0, "exit_price": None, "closed_at": None,
            "status": "open",
        }
        conn.execute("BEGIN")
        oro._insert_strategy(conn, user, env["j2"], s, ext)
        conn.commit()
    finally:
        conn.close()


def test_two_lots_are_valued_at_their_own_qty_never_the_held_total(env):
    """THE bug: lots 3 + 3, broker holds 3 -> the older lot is closed at the
    broker (its sell just hasn't been delivered). One open strategy must
    remain — the NEWEST (brokers close FIFO) — valued once at 3 x 7.00 x 100,
    and the sum of brokerCurrentValue must equal the balances-sibling MV."""
    _insert_activity_lot(env, ext="bkopt:older", qty=3, entry_price=11.5,
                         entry_date="2026-08-17T16:15:08Z")
    _insert_activity_lot(env, ext="bkopt:newer", qty=3, entry_price=11.5,
                         entry_date="2026-08-17T19:01:49Z")
    h = _holding(units=3, avg_purchase_price=1150.0, price=7.0)

    out = oro.reconcile_option_holdings("u1", env["ba"], [h])

    rows = _open_rows()
    assert out["removed"] == 1 and out["created"] == 0
    assert len(rows) == 1
    assert rows[0]["external_id"] == "bkopt:newer"
    assert rows[0]["qty"] == 3
    assert rows[0]["broker_current_value"] == 2100.00
    assert sum(r["broker_current_value"] for r in rows) == \
        balances.option_market_value([h])


def test_two_lots_whose_sum_matches_held_keep_their_own_quantities(env):
    """A member genuinely holding two lots (1 + 2 = held 3) keeps BOTH rows,
    each valued at its OWN quantity — never rewritten to the held total
    (the per-row comparison also inflated every multi-lot member: each lot
    'diverged' from held 3 and was reseeded to qty 3)."""
    _insert_activity_lot(env, ext="bkopt:one", qty=1, entry_price=10.0,
                         entry_date="2026-08-10T14:00:00Z")
    _insert_activity_lot(env, ext="bkopt:two", qty=2, entry_price=12.0,
                         entry_date="2026-08-12T14:00:00Z")
    h = _holding(units=3, avg_purchase_price=1150.0, price=7.0)

    out = oro.reconcile_option_holdings("u1", env["ba"], [h])

    rows = {r["external_id"]: r for r in _open_rows()}
    assert out["removed"] == 0 and out["created"] == 0 and out["valued"] == 2
    assert rows["bkopt:one"]["qty"] == 1
    assert rows["bkopt:one"]["broker_current_value"] == 700.00
    assert rows["bkopt:two"]["qty"] == 2
    assert rows["bkopt:two"]["broker_current_value"] == 1400.00
    assert sum(r["broker_current_value"] for r in rows.values()) == \
        balances.option_market_value([h])


def test_excess_over_held_trims_the_oldest_lot(env):
    """Lots 2 + 2, broker holds 3 -> FIFO says the OLDEST lot was half-closed:
    newest keeps 2, oldest trims to 1 (net_entry follows its own basis)."""
    _insert_activity_lot(env, ext="bkopt:old", qty=2, entry_price=5.0,
                         entry_date="2026-08-10T14:00:00Z")
    _insert_activity_lot(env, ext="bkopt:new", qty=2, entry_price=6.0,
                         entry_date="2026-08-12T14:00:00Z")
    h = _holding(units=3, avg_purchase_price=550.0, price=7.0)

    oro.reconcile_option_holdings("u1", env["ba"], [h])

    rows = {r["external_id"]: r for r in _open_rows()}
    assert rows["bkopt:new"]["qty"] == 2
    assert rows["bkopt:new"]["broker_current_value"] == 1400.00
    assert rows["bkopt:old"]["qty"] == 1
    assert rows["bkopt:old"]["net_entry"] == 500.00   # 1 x 5.00 x 100
    assert rows["bkopt:old"]["broker_current_value"] == 700.00


def test_open_lots_for_a_contract_no_longer_held_are_removed(env):
    """Holdings fetch SUCCEEDED and the contract is gone -> the open lots are
    closed at the broker (activity lag); mirror the broker now, let the real
    closing activity land later."""
    _insert_activity_lot(env, ext="bkopt:gone", qty=3, entry_price=11.5,
                         entry_date="2026-08-17T16:15:08Z")

    out = oro.reconcile_option_holdings("u1", env["ba"], [])

    assert out["removed"] == 1
    assert _open_rows() == []


def test_failed_holdings_fetch_mutates_nothing(env):
    """None (fetch FAILED) must be inert — deleting open strategies on missing
    data would wipe a member's option book on a transient SnapTrade error."""
    _insert_activity_lot(env, ext="bkopt:keep", qty=3, entry_price=11.5,
                         entry_date="2026-08-17T16:15:08Z")

    out = oro.reconcile_option_holdings("u1", env["ba"], None)

    assert out.get("skipped") is True
    assert out["removed"] == 0 and out["created"] == 0 and out["valued"] == 0
    rows = _open_rows()
    assert len(rows) == 1
    assert rows[0]["broker_current_value"] is None  # untouched


def test_held_exceeding_ledger_tops_up_with_a_carried_lot_for_remainder(env):
    """Broker holds 3, the ledger explains 1 -> keep the real lot AND add a
    carried-in lot for the 2 the ledger can't see; totals mirror the broker."""
    _insert_activity_lot(env, ext="bkopt:real", qty=1, entry_price=11.5,
                         entry_date="2026-08-17T16:15:08Z")
    h = _holding(units=3, avg_purchase_price=1150.0, price=7.0)

    out = oro.reconcile_option_holdings("u1", env["ba"], [h])

    rows = {r["external_id"]: r for r in _open_rows()}
    assert out["created"] == 1
    assert rows["bkopt:real"]["qty"] == 1
    assert rows["bkopt:real"]["broker_current_value"] == 700.00
    carried = [r for e, r in rows.items() if e.startswith("bkoptpos:")]
    assert len(carried) == 1
    assert carried[0]["qty"] == 2
    assert carried[0]["entry_price"] == 11.50
    assert carried[0]["broker_current_value"] == 1400.00
    assert sum(r["broker_current_value"] for r in rows.values()) == \
        balances.option_market_value([h])


def test_prune_never_touches_carried_in_strategies(env):
    """`_prune_broker_option_strategies` desired-set covers only activity ids
    ('bkopt:...'); carried-in rows belong to reconcile_option_holdings. Pruning
    them re-minted every carried lot each sync (new id, enrichments lost)."""
    from api.services.journal_two.broker import reconstruct as recon

    h = _holding(units=2, avg_purchase_price=550.0, price=7.25)
    oro.reconcile_option_holdings("u1", env["ba"], [h])
    _insert_activity_lot(env, ext="bkopt:stale", qty=1, entry_price=2.0,
                         entry_date="2026-08-01T14:00:00Z",
                         underlying="MSFT", strike=410.0)

    pruned = recon._prune_broker_option_strategies("u1", env["j2"], set())

    exts = [r["external_id"] for r in _open_rows()]
    assert pruned == 1                       # the stale activity strategy only
    assert len(exts) == 1
    assert exts[0].startswith("bkoptpos:")


# ── settlement pinning · a flapping holdings feed must not re-split lots ─────
#
# Measured 2026-08-21: with the ledger at 6 BA (two 3-lot buys, the sale's
# activity undelivered), SnapTrade's fleet alternated held=3 and held=5 across
# syncs ALL DAY. Both are "trims"; applying each re-split the member's lots
# every few minutes. The pin holds the MINIMUM held seen (the most-settled
# server = what the broker's own app shows) and resets when the LEDGER moves.


def _lots_33(env):
    _insert_activity_lot(env, ext="bkopt:older", qty=3, entry_price=11.5,
                         entry_date="2026-08-17T16:15:08Z")
    _insert_activity_lot(env, ext="bkopt:newer", qty=3, entry_price=11.5,
                         entry_date="2026-08-17T19:01:49Z")


def _open_ba_qtys(user="u1"):
    conn = _adb.get_connection()
    try:
        return sorted(r["qty"] for r in conn.execute(
            "SELECT l.qty FROM j2_option_strategies s "
            "JOIN j2_option_legs l ON l.strategy_id = s.id "
            "WHERE s.user_id = ? AND s.status = 'open'", (user,)))
    finally:
        conn.close()


def _repersist_ledger_lots(env):
    """Mirror _do_sync's order: every sync re-runs the ledger reconstruction
    FIRST, whose insert-or-skip persist re-creates any open lot the previous
    reconcile trimmed away. The pin's ledger_total comes from those rows, so
    a test that skips this step under-counts the ledger."""
    conn = _adb.get_connection()
    have = {r["external_id"] for r in conn.execute(
        "SELECT external_id FROM j2_option_strategies WHERE user_id = ?", ("u1",))}
    conn.close()
    if "bkopt:older" not in have:
        _insert_activity_lot(env, ext="bkopt:older", qty=3, entry_price=11.5,
                             entry_date="2026-08-17T16:15:08Z")
    if "bkopt:newer" not in have:
        _insert_activity_lot(env, ext="bkopt:newer", qty=3, entry_price=11.5,
                             entry_date="2026-08-17T19:01:49Z")


def _sync_with(env, holding):
    _repersist_ledger_lots(env)
    return oro.reconcile_option_holdings("u1", env["ba"], [holding])


def test_a_flapping_held_count_pins_to_the_minimum_seen(env):
    _lots_33(env)
    h3 = _holding(units=3, avg_purchase_price=1150.0, price=7.0)
    h5 = _holding(units=5, avg_purchase_price=1150.0, price=7.0)

    _sync_with(env, h3)
    assert _open_ba_qtys() == [3]              # trim to the settled 3

    _sync_with(env, h5)
    assert _open_ba_qtys() == [3]              # flap to 5 is PINNED — no re-split

    _sync_with(env, h3)
    assert _open_ba_qtys() == [3]              # stable through the oscillation


def test_the_pin_resets_when_the_ledger_moves(env):
    """A REAL new fill (activities or the Recent Orders rail) changes the
    ledger total → the pin resets and the new holdings apply instantly."""
    _lots_33(env)
    h3 = _holding(units=3, avg_purchase_price=1150.0, price=7.0)
    _sync_with(env, h3)
    assert _open_ba_qtys() == [3]

    # The member buys 2 more; the fills rail lands it in the ledger minutes
    # later. The ledger total MOVES → the pin resets, the new lot shows at once.
    _insert_activity_lot(env, ext="bkopt:rebuy", qty=2, entry_price=6.8,
                         entry_date="2026-08-21T15:30:00Z")
    h5 = _holding(units=5, avg_purchase_price=1150.0, price=7.0)
    _sync_with(env, h5)
    qtys = _open_ba_qtys()
    assert 2 in qtys and sum(qtys) == 5        # the rebuy is visible instantly


def test_the_pin_clears_when_holdings_match_the_ledger(env):
    """held == ledger (nothing pending) → no pin, and any stale memo row is
    deleted so a later real divergence starts fresh."""
    _lots_33(env)
    h6 = _holding(units=6, avg_purchase_price=1150.0, price=7.0)
    oro.reconcile_option_holdings("u1", env["ba"], [h6])
    assert _open_ba_qtys() == [3, 3]
    conn = _adb.get_connection()
    n = conn.execute("SELECT COUNT(*) AS n FROM j2_broker_opt_holdings_memo").fetchone()["n"]
    conn.close()
    assert n == 0


# ── broker-closed pin: the ledger rebuild must not resurrect sold contracts ──
#
# 2026-08-26 (second defect of the stale-hero incident): the owner's BABA/BA
# calls were sold 8/25; the 8/26 pre-market sync's holdings reconcile deleted
# their open strategies (holdings-as-truth — the sale's activity is T+1). The
# 14:55Z fills-rail rebuild then re-emitted them from the ledger, and under the
# DAILY sync cadence the resurrected rows stood until the next morning.

def _oev(kind, side, oc, contracts, price, date, *, cp="call", strike=200.0,
         underlying="AAPL", exp="2026-06-19", fee=0.0, aid="x", row=1):
    return {
        "externalId": aid, "row": row, "eventKind": kind, "side": side,
        "openClose": oc, "underlying": underlying, "strike": strike,
        "expiration": exp, "contractType": cp, "contracts": contracts,
        "price": price, "fee": fee, "date": date, "currency": "USD",
    }


def _buy3(aid="o1", row=1):
    return _oev("option_trade", "buy", "open", 3, 5.50,
                "2026-08-17T16:15:08Z", aid=aid, row=row)


def _rebuild(env, events):
    return oro.reconstruct_options("u1", env["ba"]["id"], env["j2"], events)


def _memo_rows():
    conn = _adb.get_connection()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT contract_key, min_held, ledger_total "
            "FROM j2_broker_opt_holdings_memo")]
    finally:
        conn.close()


def test_broker_closed_contract_is_not_resurrected_by_the_ledger_rebuild(env):
    _rebuild(env, [_buy3()])
    assert _open_ba_qtys() == [3]

    # Broker reports the contract GONE (sold; activity undelivered) → the
    # reconcile removes the rows and pins the contract at zero-held.
    out = oro.reconcile_option_holdings("u1", env["ba"], [])
    assert out["removed"] == 1
    assert _open_ba_qtys() == []
    memos = _memo_rows()
    assert len(memos) == 1 and memos[0]["min_held"] == 0
    assert memos[0]["ledger_total"] == 3

    # The fills-rail ledger rebuild runs (same ledger, sale still missing) —
    # the open lot must STAY suppressed instead of standing all day.
    _rebuild(env, [_buy3()])
    assert _open_ba_qtys() == []


def test_a_new_fill_lifts_the_broker_closed_pin(env):
    _rebuild(env, [_buy3()])
    oro.reconcile_option_holdings("u1", env["ba"], [])
    assert _open_ba_qtys() == []

    # A REAL re-buy lands in the ledger (fills rail): total moves 3 → 5 —
    # the pin no longer describes reality, both lots must show instantly.
    _rebuild(env, [_buy3(), _oev("option_trade", "buy", "open", 2, 6.0,
                                 "2026-08-26T15:00:00Z", aid="o2", row=2)])
    assert _open_ba_qtys() == [2, 3]
    assert _memo_rows() == []          # stale pin dropped


def test_the_pin_clears_once_the_closing_activity_delivers(env):
    _rebuild(env, [_buy3()])
    oro.reconcile_option_holdings("u1", env["ba"], [])
    assert _memo_rows() != []

    # The sale's real activity lands: the ledger closes the lot itself — no
    # open strategy, and the now-obsolete pin row is swept.
    sell = _oev("option_trade", "sell", "close", 3, 6.10,
                "2026-08-25T17:36:02Z", aid="o3", row=2)
    _rebuild(env, [_buy3(), sell])
    assert _open_ba_qtys() == []
    conn = _adb.get_connection()
    closed = conn.execute(
        "SELECT COUNT(*) AS n FROM j2_option_strategies "
        "WHERE user_id='u1' AND status='closed'").fetchone()["n"]
    conn.close()
    assert closed == 1
    assert _memo_rows() == []


def test_a_partially_settled_pin_still_suppresses_only_while_ledger_unchanged(env):
    # Pin written at ledger_total 3; a rebuild that computes a DIFFERENT total
    # (e.g. a split-adjusted lot) must emit rather than suppress on a mismatch.
    _rebuild(env, [_buy3()])
    oro.reconcile_option_holdings("u1", env["ba"], [])
    _rebuild(env, [_oev("option_trade", "buy", "open", 4, 5.50,
                        "2026-08-17T16:15:08Z", aid="o1")])
    assert _open_ba_qtys() == [4]
    assert _memo_rows() == []
