"""MD-1 kinds `index.quote`, `commodity.quote`, `crypto.quote` (W1-C C-03, builder-c).

One dedicated kind per asset class, each with its own adapter module (index_quote.py, commodity_quote.py,
crypto_quote.py) built on this shared, LICENCE-DRIVEN core:

* A class is served only from a source whose (vendor, data_class) row in `provider_licensing_class` is in force as
  `A` or `LA`. Today none is: Massive index snapshots are a live-confirmed entitlement gap (`/v3/snapshot/indices`
  → 403, api/routers/massive_adapter_status.py; register T-72 names the plan, nothing executes it → `U`), and the
  only index / commodity / crypto quotes in the stack come from Yahoo (`^GSPC`, BTC-USD… T-71/T-72: class `X`, "no
  licence exists to buy at any price"). So every read answers an HONEST DECLINE — a `refused` envelope whose note
  says "I don't have a licensed source for <class>" — and never a ticker guess (never an ETF's share price presented
  as gold's, bitcoin's or an index level; MD-1 §4.7.3, owner ruling 2026-11-02).
* When a licensed source lands, its row flips to A/LA and the adapter's `fetch` serves a normal envelope: the
  source's own `as_of`, its freshness class (`live` or `delayed` + `delay_s`), one `provider_calls` per request.
  The tests prove that path with a fake client; no provider is ever called here.
* `validate` refuses an unknown asset BEFORE admission (spends nothing); the asset ids are the class's own
  vocabulary (asset_classes.py).
"""
from __future__ import annotations

from typing import Any, Callable, Optional

from api.services.provider_licensing_class import licensing_class_for
from api.services.uct_agent.marketdata import asset_classes
from api.services.uct_agent.marketdata import envelope as env

LICENSED = ("A", "LA")
NOTE_NO_SOURCE = "I don't have a licensed source for {what}, so no figure is stated"
NOTE_SOURCE = "{label} from {vendor} (licensing class {cls})"
_SOURCE_PREFIX = "uct-agent-"


def validate_for(kind: str) -> Callable[[dict], Optional[str]]:
    """The kind's pure pre-admission check: `asset` must be one of the class's own ids."""
    ids = asset_classes.assets_of(kind)

    def validate(params: dict) -> Optional[str]:
        a = str(params.get("asset") or "").strip().lower()
        if not a:
            return "`asset` is required"
        if a not in ids:
            return f"`asset` must be one of {', '.join(sorted(ids))}"
        return None
    return validate


def licensed_source(sources: list) -> Optional[tuple]:
    """The first (vendor, data_class, fetch) whose licensing row is in force as A or LA, else None."""
    for vendor, data_class, fetch in sources:
        if licensing_class_for(vendor, data_class) in LICENSED:
            return vendor, data_class, fetch
    return None


def decline(kind: str, params: Any) -> dict:
    return env.make_envelope(kind, params, status="refused", freshness="unavailable", as_of=None,
                             source=_SOURCE_PREFIX + kind, notes=[NOTE_NO_SOURCE.format(what=asset_classes.CLASS_WORDS[kind])])


def _num(v: Any) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def read_asset(kind: str, params: dict, sources: list) -> dict:
    """The shared read: validate → licensed source or decline → one fetch → envelope."""
    why = validate_for(kind)(params)
    if why:
        return env.unavailable(kind, params, _SOURCE_PREFIX + kind, why)
    asset = str(params["asset"]).strip().lower()
    label = asset_classes.assets_of(kind)[asset]
    src = licensed_source(sources)
    if src is None:
        return decline(kind, params)
    vendor, data_class, fetch = src
    try:
        got = fetch(asset)
    except Exception:  # noqa: BLE001 — a source failure is an honest unavailable, never a guess
        return env.unavailable(kind, params, vendor, f"the {vendor} source could not answer", provider_calls=1)
    if not isinstance(got, dict) or _num(got.get("value")) is None:
        return env.unavailable(kind, params, vendor, f"the {vendor} source returned no value for {label}", provider_calls=1)
    freshness = got.get("freshness") if got.get("freshness") in ("live", "delayed") else "delayed"
    delay_s = _num(got.get("delay_s"))
    if freshness == "delayed" and delay_s is None:
        delay_s = 900.0
    as_of = got.get("as_of") if isinstance(got.get("as_of"), str) else None
    notes = [NOTE_SOURCE.format(label=label, vendor=vendor, cls=licensing_class_for(vendor, data_class))]
    if as_of is None:
        notes.append("the source gives no observation time for this value")
    data = {"asset": asset, "label": label, "value": _num(got.get("value")), "change": _num(got.get("change")),
            "change_pct": _num(got.get("change_pct")), "previous_close": _num(got.get("previous_close")),
            "unit": got.get("unit") if isinstance(got.get("unit"), str) else None, "as_of": as_of}
    return env.make_envelope(kind, params, status="ok", freshness=freshness, as_of=as_of, source=vendor, data=data,
                             delay_s=delay_s, stale=bool(got.get("stale")), notes=notes,
                             provider_calls=int(got.get("provider_calls", 1) or 0))
