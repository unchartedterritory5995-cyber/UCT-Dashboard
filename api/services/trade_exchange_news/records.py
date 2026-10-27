"""The journal record contract, as web reads it.

The receiver (``services/trade_exchange_news_receiver/txn_receiver.py::build_record``)
writes it; this module refuses anything that does not match, whichever way it
arrived (push or recovery). ``tests/test_trade_exchange_news_handoff.py`` builds
records with the RECEIVER's code and validates them with THIS code, so the two
cannot drift apart silently.
"""
from __future__ import annotations

import re
import unicodedata
from typing import Any

from api.services.trade_exchange_news import config

RECORD_VERSION = 1
EVENT_ID_RE = re.compile(r"^[0-9A-HJKMNP-TV-Z]{26}$")
_WS = re.compile(r"\s+")
#: 2020-01-01 .. 2100-01-01 -- a receipt time outside this is a corrupt record.
_MS_LO, _MS_HI = 1_577_836_800_000, 4_102_444_800_000


class RecordError(ValueError):
    pass


def validate(obj: Any) -> dict[str, Any]:
    if not isinstance(obj, dict):
        raise RecordError("record is not an object")
    if obj.get("v") != RECORD_VERSION:
        raise RecordError("unsupported record version")
    eid = obj.get("id")
    if not isinstance(eid, str) or not EVENT_ID_RE.match(eid):
        raise RecordError("bad event id")
    ms = obj.get("received_at_ms")
    if not isinstance(ms, int) or isinstance(ms, bool) or not (_MS_LO <= ms <= _MS_HI):
        raise RecordError("bad received_at_ms")
    source, content = obj.get("source"), obj.get("content")
    if not isinstance(source, str) or source not in config.sources():
        raise RecordError("source not allowlisted")
    if not isinstance(content, str) or not content.strip():
        raise RecordError("empty content")
    if len(content) > config.max_content_chars():
        raise RecordError("content too long")
    delivery = obj.get("delivery") if isinstance(obj.get("delivery"), dict) else {}
    return {"id": eid, "received_at_ms": ms, "source": source, "content": content,
            "extra_keys": sorted(k for k in (obj.get("extra") or {}) if isinstance(k, str))
            if isinstance(obj.get("extra"), dict) else [],
            "header_names": [h for h in delivery.get("header_names", []) if isinstance(h, str)][:64]}


def normalize(content: str) -> str:
    """For DUPLICATE DETECTION ONLY -- never displayed. NFKC (full-width and
    compatibility forms fold), casefold, whitespace runs collapsed."""
    return _WS.sub(" ", unicodedata.normalize("NFKC", content)).strip().casefold()


def dedupe_key(source: str, content: str) -> str:
    return config.sha256_hex(source + "\x1f" + normalize(content))
