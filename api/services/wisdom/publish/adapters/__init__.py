"""Dark publish adapters (stream S-F, docs/wisdom/CONTRACTS.md §6.6).

`run_daily(ctx)` is the one entry point the daily chain calls. Every step runs
whether or not its consumer flag is on: with the flag OFF a step writes
`wisdom_publish_log(action='would_publish')` previews (and, for the D20 scorers,
Wisdom-internal silent scores) and changes nothing a member sees. A step that
fails is reported and the next step still runs; nothing raises into the chain.

`ctx.dry_run` means no writes at all: each step returns the counts it would act on.

Imports stay lazy (strings resolved at run time) so this package can be imported
by the PC-side tools and by consumer hooks without pulling in the store.
"""
from __future__ import annotations

import importlib
import logging

log = logging.getLogger(__name__)

_PKG = "api.services.wisdom.publish"

#: (step name, module, function). Order matters only for the first two: the
#: index refresh runs before the Brain KB step, which sources voice principles
#: through the index.
STEPS = (
    ("retrieval", f"{_PKG}.retrieval", "refresh"),
    ("brainkb", f"{_PKG}.adapters.brainkb", "daily"),
    ("askai", f"{_PKG}.adapters.askai", "daily_preview"),
    ("desk_markers", f"{_PKG}.adapters.desk_markers", "daily_preview"),
    ("badges", f"{_PKG}.adapters.badges", "daily_preview"),
    ("dossier", f"{_PKG}.adapters.dossier", "daily_preview"),
    ("pv_examples", f"{_PKG}.adapters.pv_examples", "daily"),
    ("modelbook", f"{_PKG}.adapters.modelbook", "daily"),
    ("voice", f"{_PKG}.adapters.voice", "daily"),
    ("level_alerts", f"{_PKG}.level_alerts", "score_silently"),
    ("lookalike", f"{_PKG}.lookalike", "score_silently"),
)


def run_daily(ctx) -> dict:
    results: dict = {}
    for name, module, fn in STEPS:
        try:
            out = getattr(importlib.import_module(module), fn)(ctx)
            results[name] = {"status": "ok", **(out if isinstance(out, dict) else {"result": out})}
        except Exception as exc:  # one adapter never stops the others
            log.exception("[wisdom] publish adapter step %s failed", name)
            results[name] = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"[:500]}
        try:
            ctx.log(f"publish adapter {name}: {results[name]['status']}")
        except Exception:
            pass
    return {"steps": results, "failed": [n for n, r in results.items() if r["status"] == "failed"]}
