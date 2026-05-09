"""Self-healing for quarantined bars.

When a bar is quarantined (validation failure or reconciliation disagreement),
attempt to fetch the same bar from an alternate source. If the alt source
returns a valid bar, replace the quarantine entry with a fresh provenance
record. The audit engine triggers this; admin can also force-heal a specific
bar via /api/admin/bars/force-heal.
"""
import logging
from typing import Optional
from api.services import bar_quarantine, bar_provenance

_logger = logging.getLogger(__name__)


def _fetch_from_alt(ticker: str, tf: str, bar_time: int, exclude: str) -> Optional[dict]:
    """Fetch a single bar from any source except `exclude`. Returns None if unavailable.

    Plan 3 leaves this as a placeholder. Plan 4 (single-bar fetch API) will
    implement. Tests patch this.
    """
    return None


def try_heal(ticker: str, tf: str, bar_time: int, original_source: str) -> dict:
    """Attempt to replace a quarantined bar with a clean fetch from an alt source.

    Returns:
      {"status": "healed", "new_source": <source>} on success
      {"status": "no-op"} if no alt source produced a valid bar
      {"status": "skipped", "reason": "not quarantined"} if bar isn't quarantined
    """
    if not bar_quarantine.is_quarantined(ticker, tf, bar_time):
        return {"status": "skipped", "reason": "not quarantined"}

    fresh = _fetch_from_alt(ticker, tf, bar_time, exclude=original_source)
    if fresh:
        try:
            bar_quarantine.remove(ticker, tf, bar_time)
        except Exception:
            _logger.exception("[self-heal] quarantine.remove failed")
        # We don't know the actual new source from the placeholder — Plan 4
        # will return source info from _fetch_from_alt. For now, flag as "alt".
        new_source = fresh.get("source", "alt") if isinstance(fresh, dict) else "alt"
        try:
            bar_provenance.record(ticker, tf, bar_time, source=new_source)
        except Exception:
            _logger.exception("[self-heal] provenance.record failed")
        _logger.info("[self-heal] %s %s @ %s healed via %s", ticker, tf, bar_time, new_source)
        return {"status": "healed", "new_source": new_source}

    return {"status": "no-op"}
