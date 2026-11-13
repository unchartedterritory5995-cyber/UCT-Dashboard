"""Owner-scoped Massive channels (STREAM_SCOPED_CHANNELS, INGEST-PROCESS-DESIGN PR2).

Invariant 10 of the design: the owner refcount is a union PER CHANNEL. A symbol is
subscribed on a channel while ANY owner needs that channel; releasing one owner
never narrows another owner's channels.

Also the release rail: with the flag OFF (the default) every frame bar_stream
sends must be byte-identical to the pre-scoping builder, which is reproduced
verbatim below as `_legacy_*` so the comparison cannot drift with the code.
"""
from __future__ import annotations

import asyncio
import json
import random

import pytest

import api.services.bar_stream as bs


# ── the pre-scoping implementation, copied verbatim (the byte-identity oracle) ──

def _legacy_build(action: str, syms, universe: bool) -> str:
    parts = []
    for s in sorted(syms):
        if not universe:
            parts.append(f"AM.{s}")
        parts.append(f"A.{s}")
        parts.append(f"T.{s}")
    return json.dumps({"action": action, "params": ",".join(parts)})


class _LegacyRefcount:
    """The pre-scoping subscribe_symbols/unsubscribe_symbols, state for state."""

    def __init__(self):
        self.active, self.pend_sub, self.pend_unsub, self.owners = set(), set(), set(), {}

    def subscribe(self, symbols, owner="bars"):
        syms = {s.upper() for s in symbols}
        newly = set()
        for s in syms:
            o = self.owners.get(s)
            if o is None:
                self.owners[s] = {owner}
                if s not in self.active:
                    newly.add(s)
            else:
                o.add(owner)
        if newly:
            self.active |= newly
            self.pend_sub |= newly
            self.pend_unsub -= newly

    def unsubscribe(self, symbols, owner="bars"):
        syms = {s.upper() for s in symbols}
        gone = set()
        for s in syms:
            o = self.owners.get(s)
            if not o:
                continue
            o.discard(owner)
            if not o:
                self.owners.pop(s, None)
                if s in self.active:
                    gone.add(s)
        if gone:
            self.active -= gone
            self.pend_unsub |= gone
            self.pend_sub -= gone

    def take(self, universe):
        sub, unsub = sorted(self.pend_sub), sorted(self.pend_unsub)
        self.pend_sub.clear(); self.pend_unsub.clear()
        return (_legacy_build("subscribe", sub, universe) if sub else None,
                _legacy_build("unsubscribe", unsub, universe) if unsub else None)


# ── fixtures / helpers ──────────────────────────────────────────────────────────

@pytest.fixture
def clean(monkeypatch):
    def _reset():
        with bs._state_lock:
            bs._active.clear(); bs._active_channels.clear(); bs._sub_owners.clear()
            bs._pending_subscribe.clear(); bs._pending_unsubscribe.clear()
    _reset()
    monkeypatch.setattr(bs, "_universe_stream_enabled", lambda: False)
    yield
    _reset()


def _scoped(monkeypatch, on: bool):
    if on:
        monkeypatch.setenv("STREAM_SCOPED_CHANNELS", "1")
    else:
        monkeypatch.delenv("STREAM_SCOPED_CHANNELS", raising=False)


def _take(universe=False):
    """What the drain task would send next (and clears the queues like it does)."""
    with bs._state_lock:
        sub = {s: set(c) for s, c in bs._pending_subscribe.items()}
        unsub = {s: set(c) for s, c in bs._pending_unsubscribe.items()}
        bs._pending_subscribe.clear(); bs._pending_unsubscribe.clear()
    return (bs._channel_message("subscribe", sub, universe) if sub else None,
            bs._channel_message("unsubscribe", unsub, universe) if unsub else None)


def _params(msg):
    return set(json.loads(msg)["params"].split(",")) if msg else set()


# ── message builder ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("universe", [False, True])
def test_builder_with_plain_symbols_is_byte_identical_to_legacy(universe):
    syms = ["MSFT", "AAPL", "BRK.B", "NVDA"]
    assert bs._build_subscribe_message(syms, universe) == _legacy_build("subscribe", syms, universe)
    assert bs._build_unsubscribe_message(syms, universe) == _legacy_build("unsubscribe", syms, universe)
    assert bs._build_subscribe_message([], universe) == _legacy_build("subscribe", [], universe)


def test_builder_per_channel_mapping_keeps_wire_order():
    msg = bs._build_subscribe_message({"MSFT": {"A"}, "AAPL": {"T", "A", "AM"}}, universe=False)
    assert json.loads(msg) == {"action": "subscribe",
                               "params": "AM.AAPL,A.AAPL,T.AAPL,A.MSFT"}


def test_builder_drops_am_under_universe_and_skips_an_empty_frame():
    assert json.loads(bs._build_subscribe_message({"X": {"AM", "A"}}, universe=True))["params"] == "A.X"
    # only AM changed while AM.* carries it: nothing to send at all.
    assert bs._channel_message("unsubscribe", {"X": {"AM"}}, universe=True) is None
    assert bs._channel_message("unsubscribe", {"X": {"AM"}}, universe=False) == \
        json.dumps({"action": "unsubscribe", "params": "AM.X"})


def test_unknown_or_empty_channel_set_is_rejected(clean, monkeypatch):
    _scoped(monkeypatch, True)
    with pytest.raises(ValueError):
        bs.subscribe_symbols(["X"], owner="o", channels={"Q"})
    with pytest.raises(ValueError):
        bs.subscribe_symbols(["X"], owner="o", channels=set())


# ── union + narrowing across owners ─────────────────────────────────────────────

def test_chart_release_unsubscribes_t_but_keeps_volume_a(clean, monkeypatch):
    """The design's example: volume and chart own the same sym; chart releases;
    T must be unsubscribed and A kept."""
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["AAPL"], owner="volume", channels={"AM", "A"})
    bs.subscribe_symbols(["AAPL"], owner="bars", channels=bs.BARS_CHANNELS)
    sub, unsub = _take()
    assert _params(sub) == {"AM.AAPL", "A.AAPL", "T.AAPL"} and unsub is None

    bs.unsubscribe_symbols(["AAPL"], owner="bars")
    sub, unsub = _take()
    assert sub is None
    assert _params(unsub) == {"T.AAPL"}              # T goes, A and AM stay
    assert bs._active_channels["AAPL"] == {"AM", "A"}
    assert "AAPL" in bs._active

    bs.unsubscribe_symbols(["AAPL"], owner="volume")
    sub, unsub = _take()
    assert _params(unsub) == {"AM.AAPL", "A.AAPL"}
    assert "AAPL" not in bs._active and "AAPL" not in bs._sub_owners


def test_volume_alone_never_subscribes_t(clean, monkeypatch):
    _scoped(monkeypatch, True)
    from api.services import volume_live
    bs.subscribe_symbols(["MSFT"], owner=volume_live.STREAM_OWNER,
                         channels=volume_live.STREAM_CHANNELS)
    sub, _ = _take(universe=False)
    assert _params(sub) == {"AM.MSFT", "A.MSFT"}
    bs.unsubscribe_symbols(["MSFT"], owner=volume_live.STREAM_OWNER)
    bs.subscribe_symbols(["MSFT"], owner=volume_live.STREAM_OWNER,
                         channels=volume_live.STREAM_CHANNELS)
    with bs._state_lock:
        bs._pending_subscribe.clear(); bs._pending_unsubscribe.clear()
    bs.unsubscribe_symbols(["MSFT"], owner=volume_live.STREAM_OWNER)
    bs.subscribe_symbols(["MSFT"], owner=volume_live.STREAM_OWNER,
                         channels=volume_live.STREAM_CHANNELS)
    sub, _ = _take(universe=True)                   # universe feed: A only
    assert _params(sub) == {"A.MSFT"}


def test_adding_an_owner_only_subscribes_the_missing_channels(clean, monkeypatch):
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["NVDA"], owner="volume", channels={"AM", "A"})
    _take()
    bs.subscribe_symbols(["NVDA"], owner="nhnl", channels={"AM", "A", "T"})
    sub, unsub = _take()
    assert _params(sub) == {"T.NVDA"} and unsub is None


def test_releasing_a_wider_owner_never_narrows_another_full_owner(clean, monkeypatch):
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["AMD"], owner="bars", channels=bs.CHANNELS_FULL)
    bs.subscribe_symbols(["AMD"], owner="nhnl", channels=bs.CHANNELS_FULL)
    bs.subscribe_symbols(["AMD"], owner="volume", channels={"AM", "A"})
    _take()
    for owner in ("bars", "volume"):
        bs.unsubscribe_symbols(["AMD"], owner=owner)
        assert _take() == (None, None)              # nhnl still needs all three
    assert bs._active_channels["AMD"] == {"AM", "A", "T"}


def test_release_before_flush_cancels_queued_channels(clean, monkeypatch):
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["X"], owner="volume", channels={"AM", "A"})
    _take()
    bs.subscribe_symbols(["X"], owner="bars", channels=bs.CHANNELS_FULL)
    bs.unsubscribe_symbols(["X"], owner="bars")      # before the drain ran
    sub, unsub = _take()
    assert sub is None
    assert _params(unsub) == {"T.X"}                 # harmless, same as pre-scoping


def test_unknown_owner_release_is_a_noop(clean, monkeypatch):
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["X"], owner="volume", channels={"A"})
    _take()
    bs.unsubscribe_symbols(["X"], owner="bars")
    assert _take() == (None, None)
    assert bs._active_channels["X"] == {"A"}


def test_get_channel_counts_reports_owners_and_channels(clean, monkeypatch):
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["A1", "A2"], owner="volume", channels={"AM", "A"})
    bs.subscribe_symbols(["A2"], owner="bars", channels=bs.CHANNELS_FULL)
    st = bs.get_channel_counts()
    assert st["scoped"] is True
    assert st["symbols_per_channel"] == {"AM": 2, "A": 2, "T": 1}
    assert st["owners"]["volume"] == {"symbols": 2, "channels": ["AM", "A"]}
    assert st["owners"]["bars"] == {"symbols": 1, "channels": ["AM", "A", "T"]}


# ── reconnect rebuild ───────────────────────────────────────────────────────────

def test_reconnect_resubscribes_exactly_the_per_channel_union(clean, monkeypatch):
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["AAPL", "MSFT"], owner="volume", channels={"AM", "A"})
    bs.subscribe_symbols(["AAPL", "TSLA"], owner="bars", channels=bs.CHANNELS_FULL)
    bs.unsubscribe_symbols(["TSLA"], owner="bars")
    n, msg = bs._take_resubscribe_message()
    assert n == 2
    assert json.loads(msg) == {"action": "subscribe",
                               "params": "AM.AAPL,A.AAPL,T.AAPL,AM.MSFT,A.MSFT"}
    # the queues are cleared: the full state was just resent.
    assert not bs._pending_subscribe and not bs._pending_unsubscribe


def test_reconnect_with_nothing_active_sends_nothing(clean):
    assert bs._take_resubscribe_message() == (0, None)


def test_reconnect_flag_off_is_byte_identical_to_legacy(clean, monkeypatch):
    _scoped(monkeypatch, False)
    bs.subscribe_symbols(["MSFT", "AAPL"], owner="volume", channels={"A"})
    bs.subscribe_symbols(["NVDA"], owner="nhnl", channels=bs.CHANNELS_FULL)
    _, msg = bs._take_resubscribe_message()
    assert msg == _legacy_build("subscribe", ["AAPL", "MSFT", "NVDA"], False)


# ── flag off == today, byte for byte ────────────────────────────────────────────

def test_flag_off_ignores_declared_channels(clean, monkeypatch):
    _scoped(monkeypatch, False)
    bs.subscribe_symbols(["AAPL"], owner="volume", channels={"AM", "A"})
    sub, _ = _take()
    assert sub == _legacy_build("subscribe", ["AAPL"], False)


@pytest.mark.parametrize("seed", range(25))
@pytest.mark.parametrize("universe", [False, True])
def test_flag_off_random_owner_sequences_match_legacy_frames(clean, monkeypatch, seed, universe):
    """Random interleavings of subscribe/unsubscribe/flush across every real owner,
    each declaring its real channel set: with the flag off every flushed frame is
    byte-identical to the pre-scoping implementation's."""
    _scoped(monkeypatch, False)
    # the reconnect path reads the universe gate itself, exactly as the legacy one did.
    monkeypatch.setattr(bs, "_universe_stream_enabled", lambda: universe)
    rng = random.Random(seed)
    owners = {"bars": bs.BARS_CHANNELS, "nhnl": frozenset({"AM", "A", "T"}),
              "volume": frozenset({"AM", "A"}), "s7_price_level_dark": frozenset({"AM", "A", "T"})}
    universe_syms = ["AAPL", "MSFT", "NVDA", "BRK.B", "TSLA", "AMD"]
    legacy = _LegacyRefcount()
    for _ in range(60):
        op = rng.random()
        owner = rng.choice(list(owners))
        syms = rng.sample(universe_syms, rng.randint(1, 3))
        if op < 0.45:
            bs.subscribe_symbols(syms, owner=owner, channels=owners[owner])
            legacy.subscribe(syms, owner=owner)
        elif op < 0.85:
            bs.unsubscribe_symbols(syms, owner=owner)
            legacy.unsubscribe(syms, owner=owner)
        else:
            assert _take(universe) == legacy.take(universe)
        assert bs._active == legacy.active
    assert _take(universe) == legacy.take(universe)
    _, msg = bs._take_resubscribe_message()
    want = _legacy_build("subscribe", sorted(legacy.active), universe) if legacy.active else None
    assert msg == want


# ── the drain task flushes per channel ──────────────────────────────────────────

class _FakeWS:
    def __init__(self, fail=False):
        self.sent, self.fail = [], fail

    async def send(self, msg):
        if self.fail:
            raise ConnectionError("closed")
        self.sent.append(msg)


async def _run_drain_briefly(ws):
    task = asyncio.ensure_future(bs._drain_pending_queue(ws))
    await asyncio.sleep(0.35)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


def test_drain_sends_per_channel_frames(clean, monkeypatch):
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["AAPL"], owner="volume", channels={"AM", "A"})
    bs.subscribe_symbols(["AAPL"], owner="bars", channels=bs.CHANNELS_FULL)
    with bs._state_lock:                              # pretend it's already on the wire
        bs._pending_subscribe.clear()
    bs.unsubscribe_symbols(["AAPL"], owner="bars")
    ws = _FakeWS()
    asyncio.run(_run_drain_briefly(ws))
    assert ws.sent == [json.dumps({"action": "unsubscribe", "params": "T.AAPL"})]


def test_drain_failure_requeues_only_channels_still_wanted(clean, monkeypatch):
    _scoped(monkeypatch, True)
    bs.subscribe_symbols(["AAPL"], owner="bars", channels=bs.CHANNELS_FULL)
    ws = _FakeWS(fail=True)
    asyncio.run(_run_drain_briefly(ws))
    assert bs._pending_subscribe == {"AAPL": {"AM", "A", "T"}}
