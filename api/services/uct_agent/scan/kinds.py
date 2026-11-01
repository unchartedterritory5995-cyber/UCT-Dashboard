"""SC-1 scan kinds (owner: agent-sc), registered into the MD-1 gateway with category "scan".

screen.run / screen.count take exactly one of `spec`, `saved_id` (the member's own) or `text` (the
screener's criteria language, deterministic — scan/sources.py). All three kinds need UCT_AGENT_DATA=1 and UCT_AGENT_SCAN=1 (the gateway enforces it), count as the turn's one
scan read (MAX_SCANS_PER_TURN), and wrap the canonical screener — never /api/screener or /api/candidates.
"""
from __future__ import annotations


def register(registry) -> None:
    from api.services.uct_agent.marketdata.gateway import Kind
    from api.services.uct_agent.scan import screen

    registry.register(Kind(
        name="screen.run", fn=screen.run, freshness="periodic", category="scan", owner="agent-sc",
        description="Run a screener spec: up to 50 rows (symbol + requested fields), total matches, coverage."))
    registry.register(Kind(
        name="screen.count", fn=screen.count, freshness="periodic", category="scan", owner="agent-sc",
        description="How many rows a screener spec matches, with its coverage receipt."))
    registry.register(Kind(
        name="screen.saved", fn=screen.saved, freshness="periodic", category="scan", owner="agent-sc",
        description="The member's own saved screens (read-only), each marked runnable or not with a reason."))
