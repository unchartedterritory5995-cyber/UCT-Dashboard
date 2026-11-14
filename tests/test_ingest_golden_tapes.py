"""Golden tapes: the live bar path's output, pinned byte for byte (ingest PR1).

Each tape in tests/fixtures/golden_tapes/ is replayed through ingest_core.apply_frame
and a real BarBroadcaster (tests/golden_tape_harness.py). The recorded calls and bar
frames must equal the committed golden exactly. A diff here means the live chart
feed changed behaviour: if that was intended, regenerate with
`python -m tests.fixtures._gen_golden_tapes --regen` and say why in the commit.
"""
import inspect

import pytest

from api.services import bar_stream, ingest_core
from tests import golden_tape_harness as H

pytestmark = pytest.mark.skipif(not H.filter_env_is_default(),
                                reason="goldens assume TRADE_CONDITION_FILTER_ENABLED=1 (prod default)")


@pytest.mark.parametrize("name", H.tape_names())
def test_tape_matches_golden(name):
    got = H.run_tape(name)
    want = H.read_golden(name)
    if got != want:
        for i, (g, w) in enumerate(zip(got, want)):
            if g != w:
                pytest.fail(f"{name}: first difference at output line {i + 1}\n got: {g}\nwant: {w}")
        pytest.fail(f"{name}: {len(got)} output lines, golden has {len(want)}")


def test_every_tape_has_a_golden_and_there_are_four_or_more():
    names = H.tape_names()
    assert len(names) >= 4
    for n in names:
        assert H.golden_path(n).exists(), f"tape {n} has no golden"


def test_replay_is_deterministic():
    assert H.run_tape("minute_roll") == H.run_tape("minute_roll")


def test_goldens_exercise_the_paths_they_claim():
    lines = {n: "\n".join(H.read_golden(n)) for n in H.tape_names()}
    # minute roll: AM finalises the closed minute
    assert '"final":true' in lines["minute_roll"]
    # F1: an older-t correction reaches v2 subscribers and NOT legacy ones
    import json
    fr = [json.loads(l) for l in H.read_golden("late_am_and_older_trade") if '"frame"' in l]
    one = [f for f in fr if f["frame"].startswith("ZZTB/1/")]
    v2 = {json.dumps(f["msg"]["bar"], sort_keys=True) for f in one if f["frame"].endswith("/v2")}
    legacy = {json.dumps(f["msg"]["bar"], sort_keys=True) for f in one if f["frame"].endswith("/legacy")}
    assert v2 - legacy and not (legacy - v2)
    # universe: a non-active symbol's AM reaches the universe hook but never on_bar
    # (the active-set filter applies to the wildcard AM only, exactly as on master)
    u = lines["universe"]
    assert '"call":"universe","sym":"ZZTZ"' in u
    assert '"call":"on_bar","sym":"ZZTZ","kind":"AM"' not in u
    # trade listeners see T prints
    assert '"call":"listener"' in lines["conditions_and_noise"]


def test_bar_stream_reader_runs_every_frame_through_ingest_core():
    """The in-web reader and the stream-ingest service share ONE frame body."""
    src = inspect.getsource(bar_stream._run_websocket)
    assert "ingest_core.apply_frame(raw_msg, frame_ctx)" in src
    assert "parse_aggregate_event(" not in src, "frame parsing belongs in ingest_core"
    assert bar_stream.parse_aggregate_event is ingest_core.parse_aggregate_event


def test_ingest_core_has_no_web_or_socket_imports():
    """PR4 runs ingest_core in a process with no FastAPI app and no bar_stream socket."""
    src = inspect.getsource(ingest_core)
    for banned in ("api.main", "fastapi", "websockets", "bar_stream import", "from api.services import bar_stream"):
        assert banned not in src, banned
