"""R63(c) ADDENDUM — registration is DERIVED from R63(a)'s manifest, never hand-picked.

`docs/discord-render/instruments/oi44_cold_paths.py --measure` cold-imports every lazily-
imported module in `api/**` in a fresh interpreter and times it. This module reads that
manifest's output and answers one question, purely: *which modules cost enough, measured,
to be worth a boot-time preload?*

⛔⛔ THE THRESHOLD FILTERS BY WHAT WAS MEASURED, NEVER BY A GUESS. A module the scanner
could not import standalone (`cold_ms is None`) is EXCLUDED, not defaulted to 0 or to the
threshold — registering something nobody has verified imports cleanly in isolation would
preload a possible crash into every boot. It is reported (`unmeasurable_modules`) so a human
reviews it, exactly like the scanner's own `bad` list.

⛔ THE MANIFEST PATH IS READ, NEVER ASSUMED PRESENT. This module and the scanner that produces
its input currently live on different branches mid-programme; a boot on a pod that predates the
manifest landing on `master` must preload nothing extra and say so in the log, not crash startup
over a missing dev-tooling artifact.
"""
from __future__ import annotations

import json
import logging
import pathlib

logger = logging.getLogger(__name__)

#: Same repo-relative path the scanner writes to. One path, read here and by the scanner —
#: a second, hand-typed copy of this string anywhere else would be the second-authority-over-
#: one-value defect this repo keeps paying for.
DEFAULT_MANIFEST_PATH = (
    pathlib.Path(__file__).resolve().parents[3]
    / "docs" / "discord-render" / "evidence" / "cold-paths" / "preload-manifest.json"
)

#: ⭐ Below this, boot-time preload machinery (a thread, a Future, a registry entry) plausibly
#: costs more than the import it is saving. Not tuned from a formula — R63(a)'s own findings
#: named modules from a few ms up into the thousands; 50 ms is the point past which "the member
#: waited for this" starts being true rather than theoretical.
DEFAULT_THRESHOLD_MS = 50.0

#: ⛔⛔ MEASURED 2026-09-18: `api.main` timed at **17,300 ms** — by far the largest single entry
#: the scanner has ever produced, and a METHODOLOGY ARTIFACT, not a live-request risk. `api.main`
#: is the ASGI entry point uvicorn imports first; every OTHER module in this repo — including
#: `api.routers.auth` and `api.services.discord_index_close`, the two places that lazily
#: `import api.main` (a maintenance-mode toggle and a scheduled-post uptime read) — can only
#: execute a single line of its own code AFTER `api.main` has finished importing, because that
#: import is what wires their routers/scheduler into existence in the first place. So a "lazy"
#: import of `api.main` from inside this codebase is a GUARANTEED `sys.modules` cache hit in
#: every real request path; measuring it standalone times the WHOLE APP'S boot cost and
#: attributes it to a call site that can never pay it live. Registering it for preload would be
#: harmless (an instant no-op resolving from cache) but reporting it at the top of a ranked list
#: is actively misleading — a reader would reasonably read "17.3 s, #1 by far" as an emergency
#: that does not exist, and it would visually bury the entries below it that ARE real risks
#: (`api.services.options_chain` at 13.4 s, lazily imported from three live voice-tool call
#: sites in `voice_tool_impls.py` with no such guarantee, is the actual most urgent finding this
#: run produced). Excluded by name, not by a general "is this the entry point" heuristic — the
#: entry point has exactly one name in this codebase and inventing a broader rule for a
#: population of one would be guessing ahead of evidence.
EXCLUDED_SELF_REFERENTIAL_MODULES = frozenset({"api.main"})


def load_manifest(path: "pathlib.Path | str | None" = None) -> "dict | None":
    """The parsed manifest, or None if it is missing/unreadable. NEVER raises — a boot must
    survive a missing or malformed dev-tooling artifact."""
    p = pathlib.Path(path) if path is not None else DEFAULT_MANIFEST_PATH
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.info("[cold-path-manifest] no manifest at %s — nothing derived from it "
                   "(hand-registered resources are unaffected)", p)
        return None
    except Exception:                                          # noqa: BLE001
        logger.exception("[cold-path-manifest] manifest at %s could not be parsed", p)
        return None


def above_threshold_modules(manifest: dict, *, threshold_ms: float = DEFAULT_THRESHOLD_MS
                            ) -> list[dict]:
    """Modules whose MEASURED cold-import cost exceeds `threshold_ms`, ranked descending —
    ranked, not just filtered, because a preload thread with bounded workers should reasonably
    start the most expensive resources first.

    ⛔ `cold_ms is None` (unmeasurable) is EXCLUDED, never coerced to 0 or to the threshold —
    see the module docstring. `cold_ms <= 0` (a corrupted or synthetic reading) is excluded too;
    a real cold import is never free. `EXCLUDED_SELF_REFERENTIAL_MODULES` (`api.main`) is
    excluded regardless of cost — see that constant's docstring."""
    rows = manifest.get("measured") or []
    qualifying = [r for r in rows
                 if isinstance(r.get("cold_ms"), (int, float)) and r["cold_ms"] > threshold_ms
                 and r.get("module") not in EXCLUDED_SELF_REFERENTIAL_MODULES]
    return sorted(qualifying, key=lambda r: -r["cold_ms"])


def unmeasurable_modules(manifest: dict) -> list[dict]:
    """The scanner's own `bad` list, re-derived here rather than re-run — modules that could
    not be imported standalone in the environment the manifest was generated in. Reported so a
    human can tell 'never registered because it's cheap' apart from 'never registered because
    nobody could verify it imports cleanly.'"""
    rows = manifest.get("measured") or []
    return [r for r in rows if r.get("cold_ms") is None]


def manifest_summary(*, path: "pathlib.Path | str | None" = None,
                     threshold_ms: float = DEFAULT_THRESHOLD_MS) -> dict:
    """One call for a startup log line or a status endpoint — never for a decision that needs
    to survive a missing manifest; callers must handle `None`."""
    m = load_manifest(path)
    if m is None:
        return {"manifest_present": False}
    above = above_threshold_modules(m, threshold_ms=threshold_ms)
    unmeasurable = unmeasurable_modules(m)
    return {
        "manifest_present": True,
        "generated_at": m.get("generated_at"),
        "modules_scanned": len(m.get("modules") or []),
        "modules_measured": len(m.get("measured") or []),
        "above_threshold_count": len(above),
        "above_threshold_modules": [r["module"] for r in above],
        "threshold_ms": threshold_ms,
        "unmeasurable_count": len(unmeasurable),
    }
