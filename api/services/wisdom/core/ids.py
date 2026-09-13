"""Deterministic ids for the Wisdom Loop (docs/wisdom/CONTRACTS.md §2.4)."""
from __future__ import annotations

import hashlib


def sha24(*parts: object) -> str:
    joined = "|".join("" if p is None else str(p) for p in parts)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:24]


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_text(text: str) -> str:
    return sha256_bytes(text.encode("utf-8"))
