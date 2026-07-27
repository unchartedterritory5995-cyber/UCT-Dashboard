"""Q-subscription-pool tests for api/massive_ws_worker.py.

Covers the size-print stickiness added 2026-07-27 (`_q_sticky_until`): a contract
that just printed >= Q_STICKY_PREMIUM is pinned against 950-cap eviction for
Q_STICKY_SEC, so a sweep/burst can't be churned out of the pool mid-print.

Until now nothing in the repo tested this file at all, so the eviction policy --
which decides which contracts have NBBO coverage, and therefore which prints get
a real Side instead of blank -- shipped unguarded.
"""

import datetime
import types

import pytest

import api.massive_ws_worker as w

_EXPIRY = datetime.date(2026, 8, 15)


def _evt(root, strike, premium, cp="CALL", expiry=_EXPIRY):
    """A minimal stand-in for the aggregator's event object.

    `_queue_q_subscriptions_for_events` only reads these five attributes.
    `expiry` must be a real date -- `_reconstruct_occ_symbol` reads `.year`.
    """
    return types.SimpleNamespace(
        root=root, expiry=expiry, cp=cp, strike=strike, premium=premium
    )


def _sym(evt):
    return w._reconstruct_occ_symbol(evt.root, evt.expiry, evt.cp, evt.strike)


@pytest.fixture(autouse=True)
def _clean_pool():
    """Establish a known-empty pool, and restore module state afterwards.

    The pool dicts are module-level, so a leaked entry would silently change
    another test's eviction decision.
    """
    saved = {
        name: dict(getattr(w, name))
        for name in ("_q_sticky_until", "_q_cumulative_premium", "_q_last_seen")
    }
    saved_subscribed = set(w._q_subscribed)
    saved_pending_sub = list(w._q_pending_subscribe)
    saved_pending_unsub = list(w._q_pending_unsubscribe)
    for name in saved:
        getattr(w, name).clear()
    w._q_subscribed.clear()
    w._q_pending_subscribe.clear()
    w._q_pending_unsubscribe.clear()
    # Precondition: the fixture actually produced an empty pool.
    assert not w._q_sticky_until and not w._q_subscribed
    yield
    for name, val in saved.items():
        getattr(w, name).clear()
        getattr(w, name).update(val)
    w._q_subscribed.clear()
    w._q_subscribed.update(saved_subscribed)
    w._q_pending_subscribe[:] = saved_pending_sub
    w._q_pending_unsubscribe[:] = saved_pending_unsub


def _fill_pool(entries):
    """Subscribe exactly MAX_Q_SUBSCRIPTIONS contracts so the next add must evict.

    `entries` is a list of (sym, cumulative_premium) placed at the front; the
    rest are filler priced ABOVE every named entry so they're never the victim.
    """
    for sym, prem in entries:
        w._q_subscribed.add(sym)
        w._q_cumulative_premium[sym] = prem
        w._q_last_seen[sym] = 1
    filler = w.MAX_Q_SUBSCRIPTIONS - len(entries)
    assert filler > 0
    for i in range(filler):
        sym = f"FILL{i:04d}"
        w._q_subscribed.add(sym)
        w._q_cumulative_premium[sym] = 10_000_000_000
        w._q_last_seen[sym] = 1
    assert len(w._q_subscribed) == w.MAX_Q_SUBSCRIPTIONS


def test_size_print_pins_contract_against_eviction():
    """A pinned contract survives even though it is the CHEAPEST candidate.

    This is the AMD 480C case: a contract quiet all session (low cumulative
    premium) fires one big sweep. Premium-ASC alone would evict it mid-burst
    precisely BECAUSE its session total is still small. The pin has to override
    the sort, so the setup below is built so the sort and the pin disagree.
    """
    pinned = _evt("AMD", 480, w.Q_STICKY_PREMIUM)  # >= threshold -> pins
    pinned_sym = _sym(pinned)
    victim_sym = "VICTIM0000"

    # After the size print the pinned contract sits at ~Q_STICKY_PREMIUM, which
    # must stay BELOW the victim -- otherwise the sort evicts the victim on its
    # own and the pin is never exercised.
    _fill_pool([(pinned_sym, 100), (victim_sym, w.Q_STICKY_PREMIUM * 2)])
    w._queue_q_subscriptions_for_events([pinned])  # real code path sets the pin
    assert pinned_sym in w._q_sticky_until, "size print did not pin the contract"
    assert (
        w._q_cumulative_premium[pinned_sym] < w._q_cumulative_premium[victim_sym]
    ), "precondition: the pinned contract must be the cheaper eviction candidate"

    w._q_pending_subscribe.clear()
    w._q_pending_unsubscribe.clear()

    w._queue_q_subscriptions_for_events([_evt("NEWCO", 50, 1_000)])

    assert w._q_pending_unsubscribe == [victim_sym]
    assert pinned_sym not in w._q_pending_unsubscribe


def test_eviction_falls_back_to_pinned_when_every_candidate_is_pinned():
    """A fully-pinned pool must still evict -- pins must never starve the pool."""
    a = _evt("AAA", 10, w.Q_STICKY_PREMIUM)
    b = _evt("BBB", 20, w.Q_STICKY_PREMIUM)
    a_sym, b_sym = _sym(a), _sym(b)

    for sym in (a_sym, b_sym):
        w._q_subscribed.add(sym)
        w._q_last_seen[sym] = 1
    # Seed UNEQUAL starting premiums. Both size prints add Q_STICKY_PREMIUM, so
    # without this a and b tie on premium AND on last_seen, and the victim would
    # be decided by set-iteration order -- a coin flip across runs.
    w._q_cumulative_premium[a_sym] = 1
    w._q_cumulative_premium[b_sym] = 500_000
    w._queue_q_subscriptions_for_events([a, b])
    assert w._q_cumulative_premium[a_sym] < w._q_cumulative_premium[b_sym]
    # Fill the REST of the pool with contracts that are also pinned.
    for i in range(w.MAX_Q_SUBSCRIPTIONS - 2):
        sym = f"FILL{i:04d}"
        w._q_subscribed.add(sym)
        w._q_cumulative_premium[sym] = 10_000_000_000
        w._q_last_seen[sym] = 1
        w._q_sticky_until[sym] = float("inf")
    assert len(w._q_subscribed) == w.MAX_Q_SUBSCRIPTIONS
    # Precondition: every subscribed contract really is pinned right now.
    now = w.time.monotonic()
    assert all(w._q_sticky_until.get(s, 0) > now for s in w._q_subscribed)

    w._q_pending_subscribe.clear()
    w._q_pending_unsubscribe.clear()

    w._queue_q_subscriptions_for_events([_evt("NEWCO", 50, 1_000)])

    # It evicted the cheapest pinned contract rather than refusing to make room.
    assert w._q_pending_unsubscribe == [a_sym]
    # ...and released that contract's pin on the way out.
    assert a_sym not in w._q_sticky_until


def test_small_print_does_not_pin():
    small = _evt("TINY", 5, w.Q_STICKY_PREMIUM - 1)
    w._queue_q_subscriptions_for_events([small])
    assert _sym(small) not in w._q_sticky_until


@pytest.mark.asyncio
async def test_session_reset_clears_sticky_pins(monkeypatch):
    """`_run_session`'s reset block must clear `_q_sticky_until` too.

    Every other pool dict (_q_subscribed / _q_last_seen / _q_cumulative_premium /
    the pending lists) is cleared per session; a missed one grows for the whole
    process lifetime. This drives the REAL reset block rather than asserting on
    its source text -- it fails against the version that omits the clear.
    """
    w._q_sticky_until["STALE_PIN"] = 1.0
    w._q_cumulative_premium["STALE_PIN"] = 5
    w._q_subscribed.add("STALE_PIN")

    class _Stop(Exception):
        pass

    # Abort right after the reset block, before the warm-start hits the DB.
    def _boom(*a, **k):
        raise _Stop()

    monkeypatch.setattr(w, "_build_warm_start_contracts", _boom)

    with pytest.raises(_Stop):
        await w._run_session(object())

    # Precondition check: the reset block really ran (a known-cleared sibling).
    assert not w._q_subscribed, "reset block did not run -- test aborted too early"
    assert not w._q_sticky_until
