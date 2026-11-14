"""Golden-tape harness for the live bar path (ingest-process PR1).

Replays a TAPE (recorded-shape Massive stocks WS frames, synthetic symbols and prices)
through the exact production code path and records EVERYTHING it emits:

    frame --ingest_core.apply_frame--> on_bar / trade listeners / universe hook
          --BarBroadcaster.push_aggregate--> bar frames on real subscriber queues

Output is one JSON line per observable event, in order:
    {"at": ms, "call": "on_bar"|"listener"|"universe", "sym", "kind", "payload"}
    {"at": ms, "frame": "<subscriber label>", "msg": {...}}     # byte-exact json

The broadcaster runs on an injected clock (the tape's `at`) and an injected scheduler
(trailing flushes fire when the tape clock passes their due time), so the output is
fully deterministic, `rev` included. Subscribers are real asyncio queues on a real
loop, reached through the broadcaster's default (call_soon_threadsafe) publisher.

Used by tests/test_ingest_golden_tapes.py, and by PR4's stream-ingest E2E to prove the
service emits the same frames as the in-web reader. Regenerate goldens ONLY for an
intended behaviour change: python -m tests.fixtures._gen_golden_tapes --regen
"""
from __future__ import annotations

import asyncio
import heapq
import itertools
import json
import os
from pathlib import Path
from typing import Iterable

from api.services import ingest_core
from api.services.bar_broadcaster import BarBroadcaster

TAPE_DIR = Path(__file__).resolve().parent / "fixtures" / "golden_tapes"

#: Subscribers every tape gets, per symbol in the tape header: (tf, session, v2).
#: Legacy + v2 on 1m and 5m covers the F1 older-t rule; 60/eth covers the
#: session-keyed hourly message shape.
SUBSCRIBERS = (("1", "rth", False), ("1", "rth", True), ("5", "rth", False),
               ("5", "rth", True), ("60", "eth", True))

#: After the last frame the tape clock runs on by this much so every trailing
#: flush scheduled by the throttle fires.
DRAIN_MS = 2_000


def _dumps(obj) -> str:
    # Key order preserved (byte-exact frames); compact; floats as Python repr.
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)


def load_tape(name: str) -> dict:
    """A tape file: line 1 = header {symbols, universe, active?}; then {at, frame}."""
    lines = (TAPE_DIR / f"{name}.tape.jsonl").read_text(encoding="utf-8").splitlines()
    header = json.loads(lines[0])
    rows = [json.loads(l) for l in lines[1:] if l.strip()]
    return {"header": header, "rows": rows}


def tape_names() -> list[str]:
    return sorted(p.name[: -len(".tape.jsonl")] for p in TAPE_DIR.glob("*.tape.jsonl"))


def run_tape(name: str) -> list[str]:
    """Replay one tape; return its output lines (see module doc)."""
    tape = load_tape(name)
    return asyncio.run(_run(tape))


async def _run(tape: dict) -> list[str]:
    header, rows = tape["header"], tape["rows"]
    out: list[str] = []
    now = [rows[0]["at"] if rows else 0]
    timers: list = []
    seq = itertools.count()

    def clock_ms() -> int:
        return now[0]

    def scheduler(delay_s: float, fn) -> None:
        due = now[0] + int(round(delay_s * 1000))
        heapq.heappush(timers, (due, next(seq), fn))

    bb = BarBroadcaster(clock_ms=clock_ms, scheduler=scheduler, seed_fetcher=lambda s: [])

    queues: list = []
    for sym in header["symbols"]:
        for tf, sess, v2 in SUBSCRIBERS:
            q = bb.subscribe(sym, tf, sess, v2=v2)
            queues.append((f"{sym}/{tf}/{sess}/{'v2' if v2 else 'legacy'}", q))

    def record_call(call: str, sym: str, kind, payload) -> None:
        out.append(_dumps({"at": now[0], "call": call, "sym": sym, "kind": kind, "payload": payload}))

    def on_bar(sym, payload, kind):
        record_call("on_bar", sym, kind, payload)
        bb.push_aggregate(sym, payload, kind)

    active = set(header.get("active", header["symbols"]))
    ctx = ingest_core.FrameContext(
        on_bar=on_bar,
        active=active,
        trade_listeners=[lambda s, p: record_call("listener", s, "T", p)],
        universe=bool(header.get("universe")),
        on_universe_am=(lambda s, p: record_call("universe", s, "AM", p)) if header.get("universe") else None,
    )

    async def drain() -> None:
        # Let call_soon_threadsafe deliveries run, then empty every queue in a fixed order.
        for _ in range(3):
            await asyncio.sleep(0)
        for label, q in queues:
            while not q.empty():
                out.append(_dumps({"at": now[0], "frame": label, "msg": q.get_nowait()}))

    def fire_timers_until(t: int) -> None:
        while timers and timers[0][0] <= t:
            due, _, fn = heapq.heappop(timers)
            now[0] = max(now[0], due)
            fn()

    await drain()   # subscribe-time snapshots (none on a fresh broadcaster)
    for row in rows:
        fire_timers_until(row["at"])
        await drain()
        now[0] = row["at"]
        ingest_core.apply_frame(row["frame"], ctx)
        await drain()
    fire_timers_until(now[0] + DRAIN_MS)
    await drain()
    return out


def golden_path(name: str) -> Path:
    return TAPE_DIR / f"{name}.golden.jsonl"


def write_golden(name: str, lines: Iterable[str]) -> None:
    golden_path(name).write_text("".join(l + "\n" for l in lines), encoding="utf-8", newline="\n")


def read_golden(name: str) -> list[str]:
    return golden_path(name).read_text(encoding="utf-8").splitlines()


def filter_env_is_default() -> bool:
    """The goldens assume the ghost-print filter is ON (its prod default)."""
    return os.environ.get("TRADE_CONDITION_FILTER_ENABLED", "1") == "1"
