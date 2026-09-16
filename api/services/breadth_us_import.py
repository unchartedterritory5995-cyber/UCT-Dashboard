"""IMPORT AN AUDITED PIT UNIVERSE ARTIFACT (BL-031 Option A) — additive, never a replace.

⭐⭐ WHY IMPORT RATHER THAN RECOMPUTE. The alternative was to let the worker recompute US
history from the provider. Option A wins on an argument that is not about speed: the
audited artifact is the object 183,417 rows of evidence were gathered about — every
invariant, every sentinel, every replay. Recomputing produces a DIFFERENT object that we
would then have to prove equal to the audited one, which is strictly more work for
strictly less certainty. It also avoids a 4-5 GB resident grind (BL-029) on a pod with a
recorded OOM history.

⛔ IT IS ADDITIVE, AND THAT IS THE DIFFERENCE FROM `breadth_restore`. Restore replaces
the whole content of the two breadth tables; this touches ONLY rows of the universe being
imported and never reads, rewrites or deletes a UCT row. A UCT fingerprint taken before
and after must be identical, and `import_universe` returns both so the caller cannot
forget to check.

⚠️ IT REFUSES RATHER THAN REPAIRS. Wrong universe in the artifact, a universe that is
not registered, an artifact that fails integrity_check, a row count outside the expected
band, a non-finite value, a duplicate key — each is a refusal that writes nothing. The
one thing worse than not importing is a half-imported universe that looks complete.
"""
from __future__ import annotations

import hashlib
import logging
import sqlite3
from typing import Optional

_log = logging.getLogger("breadth_us_import")

OHLC_TABLE = "breadth_daily_ohlc"


class ImportRefused(RuntimeError):
    """Nothing was written. The live database is exactly as it was."""


def uct_fingerprint(conn=None) -> tuple:
    """(sha256, rows) over every UCT row, in key order. The parity instrument.

    ⭐ It hashes VALUES, not a row count — parity after a schema or content change is a
    claim about numbers, and a count cannot see a number that moved.
    """
    from api.services import breadth_daily_ohlc as store
    own = conn is None
    c = conn or store._conn()
    try:
        h, n = hashlib.sha256(), 0
        for row in c.execute(
                "SELECT date, metric, o, h, l, c, source FROM %s "
                "WHERE universe='uct' ORDER BY date, metric" % OHLC_TABLE):
            h.update(repr(row).encode())
            n += 1
        return h.hexdigest(), n
    finally:
        if own:
            c.close()


def inspect_artifact(path: str, universe: str) -> dict:
    """Read-only identity + integrity of the artifact. Every failure is a refusal."""
    c = sqlite3.connect("file:%s?mode=ro" % path, uri=True)
    try:
        verdict = c.execute("PRAGMA integrity_check").fetchone()[0]
        if verdict != "ok":
            raise ImportRefused("artifact failed integrity_check: %r" % verdict)
        cols = [r[1] for r in c.execute("PRAGMA table_info(%s)" % OHLC_TABLE)]
        if "universe" not in cols:
            raise ImportRefused(
                "artifact has no `universe` column — a PIT artifact must name its own "
                "universe rather than have one assumed for it")
        unis = dict(c.execute("SELECT universe, COUNT(*) FROM %s GROUP BY universe"
                              % OHLC_TABLE))
        if set(unis) != {universe}:
            raise ImportRefused(
                "artifact holds universe(s) %s, not exactly {%r} — refusing to import "
                "an artifact whose contents are not what was asked for"
                % (sorted(unis), universe))
        dupes = c.execute(
            "SELECT COUNT(*) FROM (SELECT universe, date, metric FROM %s "
            "GROUP BY 1,2,3 HAVING COUNT(*) > 1)" % OHLC_TABLE).fetchone()[0]
        if dupes:
            raise ImportRefused("artifact holds %d duplicate (universe, date, metric) "
                                "key(s)" % dupes)
        blank = c.execute("SELECT COUNT(*) FROM %s WHERE universe IS NULL OR universe=''"
                          % OHLC_TABLE).fetchone()[0]
        if blank:
            raise ImportRefused("artifact holds %d row(s) with no universe" % blank)
        # ⛔ NON-FINITE IS A REFUSAL, NOT A FILTER. `_render_json` serialises the history
        # response with allow_nan=False and RAISES on one — so a bad value would not be a
        # wrong cell, it would 500 the Monitor endpoint for every member.
        #
        # ⚰️ AND THE OBVIOUS CHECK IS DEAD CODE HERE, WHICH IS WORTH KNOWING. The
        # idiomatic NaN test `c != c` can NEVER match in SQLite, because SQLite has no
        # NaN: it stores one as NULL (measured — `typeof(x)` returns 'null'). So a
        # `c != c` clause would look like a rail, pass every test, and check nothing.
        # INFINITY is the value that really does survive as a REAL, and the magnitude
        # bound is what catches it. A NULL close is a legitimate "no value" and is left
        # alone; `update_intraday` already drops non-finite input on the write path.
        bad = c.execute(
            "SELECT COUNT(*) FROM %s WHERE c IS NOT NULL AND (c > 1e300 OR c < -1e300)"
            % OHLC_TABLE).fetchone()[0]
        if bad:
            raise ImportRefused("artifact holds %d non-finite close value(s)" % bad)
        h, n = hashlib.sha256(), 0
        for row in c.execute("SELECT universe, date, metric, o, h, l, c, source FROM %s "
                             "ORDER BY date, metric" % OHLC_TABLE):
            h.update(repr(row).encode())
            n += 1
        span = c.execute("SELECT MIN(date), MAX(date) FROM %s" % OHLC_TABLE).fetchone()
        metrics = c.execute("SELECT COUNT(DISTINCT metric) FROM %s"
                            % OHLC_TABLE).fetchone()[0]
        return {"path": path, "universe": universe, "rows": unis[universe],
                "span": list(span), "metrics": metrics, "fingerprint": h.hexdigest(),
                "integrity": verdict, "counted": n}
    finally:
        c.close()


def import_universe(path: str, universe: str, *, expect_rows: Optional[int] = None,
                    expect_fingerprint: Optional[str] = None,
                    dry_run: bool = False) -> dict:
    """ATTACH the artifact and INSERT..SELECT its rows. UCT is never read or written.

    Idempotent: `INSERT OR IGNORE` on the canonical `(universe, date, metric)` key, so a
    re-run inserts 0 and changes nothing.
    """
    from api.services import breadth_daily_ohlc as store
    from api.services import breadth_universes as bu

    if universe not in set(bu.UNIVERSE_IDS):
        raise ImportRefused(
            "%r is not a REGISTERED universe (%s) — membership is registry-backed, never "
            "inferred from a string" % (universe, sorted(bu.UNIVERSE_IDS)))
    info = inspect_artifact(path, universe)
    if expect_rows is not None and info["rows"] != expect_rows:
        raise ImportRefused("artifact holds %d rows, expected %d — this is not the "
                            "audited object" % (info["rows"], expect_rows))
    if expect_fingerprint and info["fingerprint"] != expect_fingerprint:
        raise ImportRefused(
            "artifact fingerprint %s… does not match the audited %s… — refusing to "
            "substitute a different dataset"
            % (info["fingerprint"][:16], expect_fingerprint[:16]))

    store._ensure_init()
    # ⛔ THE INTERLOCK IS CHECKED HERE TOO, AND IT IS NOT REDUNDANT. `write_bulk` guards
    # the ordinary write path; this one goes through raw SQL for speed, so it has to ask
    # the same question rather than inherit the answer.
    if store.compat_index_present():
        raise store.CompatIndexBlocksUniverse(
            "refusing to import universe=%r: the BL-028 compatibility index %s is still "
            "in place. Removing it is a deliberate, separate step "
            "(breadth_daily_ohlc.drop_compat_index())." % (universe, store.COMPAT_INDEX))

    before_fp, before_n = uct_fingerprint()
    out = {"artifact": info, "uct_fingerprint_before": before_fp,
           "uct_rows_before": before_n, "dry_run": dry_run, "imported": 0}
    if dry_run:
        return out

    with store._WRITE_LOCK:
        c = store._conn()
        try:
            c.execute("PRAGMA busy_timeout=30000")
            c.execute("ATTACH DATABASE ? AS art", (path,))
            c.execute("BEGIN IMMEDIATE")
            existing = c.execute("SELECT COUNT(*) FROM main.%s WHERE universe=?"
                                 % OHLC_TABLE, (universe,)).fetchone()[0]
            c.execute(
                "INSERT OR IGNORE INTO main.%s"
                "(universe, date, metric, o, h, l, c, source, updated_at) "
                "SELECT universe, date, metric, o, h, l, c, source, updated_at "
                "FROM art.%s WHERE universe = ?" % (OHLC_TABLE, OHLC_TABLE), (universe,))
            after = c.execute("SELECT COUNT(*) FROM main.%s WHERE universe=?"
                              % OHLC_TABLE, (universe,)).fetchone()[0]
            c.execute("COMMIT")
            out["rows_before"] = existing
            out["rows_after"] = after
            out["imported"] = after - existing
        except Exception:
            try:
                c.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            try:
                c.execute("DETACH DATABASE art")
            except Exception:
                pass
            c.close()

    after_fp, after_n = uct_fingerprint()
    out["uct_fingerprint_after"] = after_fp
    out["uct_rows_after"] = after_n
    out["uct_parity"] = (after_fp == before_fp and after_n == before_n)
    if not out["uct_parity"]:
        # ⛔ This cannot be "logged and continued". An import that moved a UCT value has
        # broken the one invariant the whole phase rests on.
        raise ImportRefused(
            "UCT PARITY BROKEN by the import: %s…/%d -> %s…/%d. The import is committed; "
            "restore the known snapshot (breadth_restore) rather than repairing rows."
            % (before_fp[:16], before_n, after_fp[:16], after_n))
    _log.warning("[breadth_us_import] imported %d row(s) of universe=%r "
                 "(now %d); UCT parity held at %s… over %d rows",
                 out["imported"], universe, out["rows_after"], after_fp[:16], after_n)
    return out
