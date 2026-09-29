"""Clearance rail: may this registry entry be ingested and served in production?

    production_eligible(entry) -> (bool, reason)

ONE question, answered from the entry's licensing + source fields only (the
registry's `validate_registry` layers status/verification rails on top). The
answer is conservative: anything this module does not positively recognise as
cleared is refused.

Rules (Phase 1 contract, owner rulings #9 and #10, Phase 0 licensing.md):
  1. FRED / ALFRED / the St. Louis Fed API is NEVER a production source, whatever
     the other fields say. Its terms prohibit "storing, caching, or archiving any
     portion of the FRED(R) Services or FRED(R) Content"
     (https://fred.stlouisfed.org/legal/). This is a REGRESSION RAIL: a registry
     entry marked GREEN / cleared / enabled with a FRED source is still refused.
  2. status "excluded" is never eligible (RED / not cleared by definition).
  3. RED is never eligible.
  4. GREEN needs clearance "cleared" or "permission_granted".
  5. YELLOW needs clearance "permission_granted" AND a non-empty approval_ref.
  6. permission_granted always needs an approval_ref, whatever the class.
"""
from __future__ import annotations

import json
import re
from typing import Any, Mapping

from .model import Clearance, LicenseClass, SeriesStatus

# "fred" / "alfred" as a WORD (so "Freddie Mac" -- a separate, YELLOW publisher --
# is not caught), plus the St. Louis Fed's hosts and name.
_FRED_WORD = re.compile(r"(?<![a-z0-9])(al)?fred(?![a-z0-9])", re.IGNORECASE)
_FRED_MARKERS = ("stlouisfed", "st. louis fed", "st louis fed", "federal reserve bank of st. louis",
                 "federal reserve bank of st louis", "research.stlouisfed.org", "api.stlouisfed.org")


def _get(entry: Any, key: str, default=None):
    if isinstance(entry, Mapping):
        return entry.get(key, default)
    return getattr(entry, key, default)


def _source_text(entry: Any) -> str:
    """Every source-identifying string on the entry, lower-cased, for the FRED scan."""
    src = _get(entry, "source") or {}
    if not isinstance(src, Mapping):
        src = {"agency": getattr(src, "agency", ""), "adapter": getattr(src, "adapter", ""),
               "dataset": getattr(src, "dataset", ""), "official_url": getattr(src, "official_url", ""),
               "provider_series_id": getattr(src, "provider_series_id", ""),
               "params": getattr(src, "params", {})}
    parts = [str(src.get(k) or "") for k in ("agency", "adapter", "dataset", "official_url", "provider_series_id")]
    try:
        parts.append(json.dumps(src.get("params") or {}, sort_keys=True, default=str))
    except Exception:  # noqa: BLE001 -- unserialisable params still get scanned by str()
        parts.append(str(src.get("params")))
    # an adapter attribute directly on a spec object (adapters.base.SeriesSpec)
    parts.append(str(_get(entry, "adapter", "") or ""))
    return " ".join(parts).lower()


def is_fred_source(entry: Any) -> bool:
    """True if the entry's source is FRED/ALFRED/St. Louis Fed in ANY source field."""
    text = _source_text(entry)
    if any(m in text for m in _FRED_MARKERS):
        return True
    return bool(_FRED_WORD.search(text))


def production_eligible(entry: Any) -> tuple[bool, str]:
    """(eligible, reason). Reason is a short human string; 'ok' when eligible."""
    if is_fred_source(entry):
        return False, ("FRED/ALFRED is never a production source: its terms prohibit storing, caching "
                       "or archiving FRED content (https://fred.stlouisfed.org/legal/)")
    status = _get(entry, "status")
    if status == SeriesStatus.EXCLUDED.value:
        return False, "status excluded"
    lic = _get(entry, "licensing") or {}
    cls = lic.get("class") if isinstance(lic, Mapping) else getattr(lic, "class_", None)
    clearance = lic.get("clearance") if isinstance(lic, Mapping) else getattr(lic, "clearance", None)
    approval = lic.get("approval_ref") if isinstance(lic, Mapping) else getattr(lic, "approval_ref", None)
    approval = (approval or "").strip() if isinstance(approval, str) else approval
    valid_cls = {c.value for c in LicenseClass}
    valid_clr = {c.value for c in Clearance}
    if cls not in valid_cls:
        return False, f"unknown licensing class {cls!r}"
    if clearance not in valid_clr:
        return False, f"unknown clearance {clearance!r}"
    if clearance == Clearance.PERMISSION_GRANTED.value and not approval:
        return False, "permission_granted without an approval_ref"
    if cls == LicenseClass.RED.value:
        return False, "licensing class RED"
    if cls == LicenseClass.YELLOW.value:
        if clearance != Clearance.PERMISSION_GRANTED.value:
            return False, f"YELLOW requires permission_granted (is {clearance})"
        return True, "ok (YELLOW with written permission " + str(approval) + ")"
    # GREEN
    if clearance not in (Clearance.CLEARED.value, Clearance.PERMISSION_GRANTED.value):
        return False, f"GREEN but clearance is {clearance}"
    return True, "ok"
