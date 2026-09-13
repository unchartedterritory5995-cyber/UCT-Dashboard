"""Ticker -> entity resolution for Wisdom records (W1 §4.2; manifest §4.8; CONTRACTS §6.2).

resolve(ticker_or_alias, as_of) -> dict | None, through S3 Entity Master
(api/services/entity_master/api.py resolve, imported read-only).

RESOLUTION ORDER (manifest §4.8)
  1. A crypto name (ETH, ETHER, ETHEREUM, BTC, BITCOIN) -> its listed vehicle (ETHA, IBIT),
     BEFORE the symbol: "ETH" is also a listed equity ticker, and these authors mean ether.
  2. A symbol or cashtag ($NVDA, BRK.B) -> S3 resolve as of the date.
  3. An APPROVED alias from wisdom_ticker_aliases -> its ticker -> S3 resolve.
  4. Otherwise None. A record with no entity can be a MENTION, never a CALL; the writer
     enforces that.
S3 answering "ambiguous" is None too: two entities holding one ticker is not a CALL.

CONFIDENCE starts at 1.0 and is multiplied by every penalty that applies:
  single-letter ticker (W, U) x SINGLE_LETTER_PENALTY, alias x ALIAS_PENALTY,
  crypto name mapped to a vehicle x CRYPTO_VEHICLE_PENALTY (ETHA vs ETHU is a guess).

Never raises: an entity-master failure is logged and resolves to None.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from typing import Callable, Optional

from api.services.wisdom.core import aliases, timeutil

log = logging.getLogger(__name__)

SINGLE_LETTER_PENALTY = 0.5
ALIAS_PENALTY = 0.85
CRYPTO_VEHICLE_PENALTY = 0.8
_SYMBOL_RE = re.compile(r"^[A-Z]{1,5}(?:[.-][A-Z]{1,2})?$")

#: (symbol, as_of 'YYYY-MM-DD') -> an entity_master.api.ResolveResult-shaped object.
Resolver = Callable[[str, str], object]


def _as_of_str(as_of) -> Optional[str]:
    if as_of is None:
        return timeutil.now_et().date().isoformat()
    if isinstance(as_of, datetime):
        return timeutil.to_et(as_of).date().isoformat()
    if isinstance(as_of, date):
        return as_of.isoformat()
    text = str(as_of).strip()
    if re.fullmatch(r"\d{8}", text):
        text = f"{text[:4]}-{text[4:6]}-{text[6:]}"
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return None


def _vehicle_underlying(ticker: str) -> Optional[str]:
    for underlying, spec in aliases.CRYPTO_VEHICLES.items():
        if ticker in spec["vehicles"]:
            return underlying
    return None


def _lookup(symbol: str, as_of: str, db_path: Optional[str], resolver: Optional[Resolver]):
    try:
        if resolver is not None:
            result = resolver(symbol, as_of)
        else:
            from api.services.entity_master import api as entity_master_api

            result = entity_master_api.resolve(symbol, as_of, db_path=db_path)
    except Exception:
        log.exception("[wisdom-entities] entity master resolve failed for %s as of %s", symbol, as_of)
        return None
    if getattr(result, "status", None) != "resolved":
        return None
    return getattr(result, "entity", None)


def _result(entity, ticker: str, raw: str, as_of: str, *, via: str, confidence: float,
            underlying: Optional[str]) -> dict:
    base = re.split(r"[.-]", ticker, maxsplit=1)[0]
    single_letter = len(base) == 1
    if single_letter:
        confidence *= SINGLE_LETTER_PENALTY
    return {
        "entity_id": entity.entity_id,
        "ticker": ticker,
        "input": raw,
        "as_of": as_of,
        "via": via,
        "confidence": round(confidence, 4),
        "single_letter": single_letter,
        "crypto_vehicle": underlying is not None,
        "underlying": underlying,
        "entity_type": getattr(entity, "entity_type", None),
        "lifecycle_state": getattr(entity, "lifecycle_state", None),
    }


def resolve(ticker_or_alias, as_of, *, db_path: Optional[str] = None, resolver: Optional[Resolver] = None,
            alias_db_path: Optional[str] = None) -> Optional[dict]:
    raw = "" if ticker_or_alias is None else str(ticker_or_alias).strip()
    if not raw:
        return None
    as_of_s = _as_of_str(as_of)
    if as_of_s is None:
        log.warning("[wisdom-entities] unusable as_of %r for %r", as_of, raw)
        return None
    cleaned = raw.lstrip("$").strip()
    upper = cleaned.upper()

    underlying = aliases.CRYPTO_NAMES.get(upper)
    if underlying:
        vehicle = aliases.CRYPTO_VEHICLES[underlying]["primary"]
        entity = _lookup(vehicle, as_of_s, db_path, resolver)
        if entity is None:
            return None
        return _result(entity, vehicle, raw, as_of_s, via="crypto_vehicle",
                       confidence=CRYPTO_VEHICLE_PENALTY, underlying=underlying)

    if _SYMBOL_RE.match(upper):
        entity = _lookup(upper, as_of_s, db_path, resolver)
        if entity is not None:
            return _result(entity, upper, raw, as_of_s, via="symbol", confidence=1.0,
                           underlying=_vehicle_underlying(upper))

    alias_ticker = aliases.ticker_for_alias(cleaned, db_path=alias_db_path)
    if alias_ticker:
        entity = _lookup(alias_ticker, as_of_s, db_path, resolver)
        if entity is not None:
            return _result(entity, alias_ticker, raw, as_of_s, via="alias", confidence=ALIAS_PENALTY,
                           underlying=_vehicle_underlying(alias_ticker))
    return None
