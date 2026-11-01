"""MD-1 market-data kinds (owner: agent-md). Sprint 0: none registered yet.

Each kind is an adapter over an existing canonical UCT service (see contracts/MD-1-market-data.md §4)
and is added with `registry.register(Kind(...))` inside `register` below.
"""
from __future__ import annotations


def register(registry) -> None:  # noqa: ARG001 — Sprint 1 (agent-md) registers the v1 kinds here
    return None
