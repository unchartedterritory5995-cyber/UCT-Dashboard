"""ONE authority seam for member-facing UCT Breadth — which methodology owns which session.

⭐⭐ EVERY DATE/VERSION DECISION FOR `uct` LIVES HERE. Readers (the Monitor row builder, the
chart series builder) ask this module and never compare dates to boundaries themselves.

Owner rulings (2026-09-29), in force only when `BREADTH_AUTHORITY=v2`:

    date <= 2026-03-22                 V1_LEGACY        existing V1 history, untouched
    2026-03-23 .. 2026-09-24           V2_FROZEN        the frozen V2c2 artifact, read-only
        PIT-rejected sessions          V2_GAP           no canonical value — an honest gap
    2026-09-25 ..                      V2_LIVE          a producer publication in state VALIDATED
        newest completed, unvalidated  PROVISIONAL      the collector's value, presentation only
        older, unvalidated             V2_PENDING       withheld (fail closed)

`BREADTH_AUTHORITY` unset / `v1` → this module answers "not in force" and every reader keeps its
V1 behaviour byte-for-byte. Rollback is that one setting; nothing is rebuilt or deleted.

⛔ The frozen artifact is NEVER copied into a mutable store. Web holds a READ-ONLY replica file
(0444), downloaded from the R2 freeze archive and accepted only if its sha256 and size equal the
freeze ledger's; it is opened `mode=ro&immutable=1`. A mismatch means V2 is UNAVAILABLE and the
seam fails closed to V1 — it never serves unverified bytes.

⛔ Nothing here writes authoritative Breadth. The live replica is a CACHE of the producer's
validated publications (rebuildable from R2); a publication whose sha differs from one already
accepted for the same session is REFUSED and reported, never adopted — an accepted session cannot
be silently rewritten by a later rerun.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import sqlite3
import threading
import time
from typing import Optional

# ── the rulings, as data ──────────────────────────────────────────────────────
LEGACY_END = "2026-03-22"
V2_START = "2026-03-23"
FROZEN_END = "2026-09-24"
LIVE_START = "2026-09-25"
PIT_GAPS_RULED = ("2026-03-24", "2026-08-31", "2026-09-23")
UNIVERSE = "uct"

FROZEN_NAME = "breadth_v2c2div_FINAL_v20260924f_VALIDATED_FROZEN_2026-09-29.db"
FROZEN_SHA256 = "5670fdc0d3deeb9ed1d7eb13da794457d395d3ad007255a8a685769aeefb904e"
FROZEN_BYTES = 88072192
FROZEN_ROWS = 611018
FROZEN_R2_KEY = ("breadth_ohlc/archive/breadth_v2c2div_FINAL_v20260924f_VALIDATED_FROZEN_NOT_FOR_CUTOVER_"
                 "2008-01-02_2026-09-24_2026-09-29_20260929T161734Z.db.gz")
FROZEN_R2_GZ_SHA256 = "7992da9c247dbcc52e4b5161a8d125c179ceb3b6bdedbfade4f3a9e72378a456"

#: The 35 canonical Breadth metrics V2 owns (asserted against the artifact at load).
V2_METRICS = (
    "adv_decline", "advancing", "declining", "down_20pct_5d", "down_25pct_month",
    "down_25pct_quarter", "down_4pct_today", "down_50pct_month", "hi_ratio", "lo_ratio",
    "magna_down", "magna_up", "near_52w_high", "net_new_high_low", "new_20d_highs",
    "new_20d_lows", "new_52w_highs", "new_52w_lows", "pct_above_100sma", "pct_above_10sma",
    "pct_above_200sma", "pct_above_20ema", "pct_above_40sma", "pct_above_50sma",
    "pct_above_5sma", "ratio_10day", "ratio_5day", "stage2_count", "stage4_count",
    "universe_count", "up_20pct_5d", "up_25pct_month", "up_25pct_quarter", "up_4pct_today",
    "up_50pct_month",
)
#: Fields the Monitor DERIVES from the 35 that V2 already stores — for a V2 row the stored
#: value is canonical and the V1 row-window recomputation must not replace it.
V2_DIRECT_DERIVED = ("ratio_5day", "ratio_10day", "hi_ratio", "lo_ratio", "net_new_high_low")
#: Derived fields still awaiting an owner methodology decision (withheld under V2). Empty since
#: the 2026-09-29 rulings: both bridges below are locked.
PENDING_DECISION_FIELDS = ()

#: First-class V2 provenance. Within one (universe, date, metric) exactly one row exists, so the
#: rank only matters if a future writer ever offered both: the observed path beats the body.
V2_SOURCES = {"intraday_recon_1m": 2, "intraday_recon_1m_body": 1}

V1_LEGACY = "v1_legacy"
V2_FROZEN = "v2_frozen"
V2_LIVE = "v2_live"
V2_GAP = "v2_gap"
PROVISIONAL = "provisional_collector"
V2_PENDING = "v2_pending"
CANONICAL = (V2_FROZEN, V2_LIVE)
#: A completed session may be shown provisionally only while it is one of the newest
#: collector sessions after the latest canonical V2 session. Two, not one: session D-1 becomes
#: canonical only after session D's collector row exists (the PIT hindsight gate needs it), so
#: for ~30 min each evening both are awaiting the producer.
PROVISIONAL_MAX = 2

#: ⭐ The two derived-field BRIDGES across the 2026-03-23 boundary (owner rulings 2026-09-29).
#: Seeds are PINNED (computed once by `breadth_monitor.v1_merged_adv_decline` +
#: `rebuild_mcclellan_state` on the production V1 stores, 2026-09-29) so a later V1-store change
#: can never move the V2 continuation; `seed_check()` re-derives them and reports drift.
SEED_SESSION = "2026-03-20"          # the last trading session before V2_START (03-22 was a Sunday)
V1_LINEAGE = {"input": "V1 daily adv_decline, deep-reader merge rule (collector breadth_snapshots wins; "
                       "trusted-source breadth_daily_ohlc uct close fills), 2008-01-02..2026-03-20",
              "sessions": 4583, "sha256": "90f41088f39b23dc49f33de24cd8a1a9f25c8d201d2faeb273e6038ccf1393b4"}
MCCLELLAN_BRIDGE = {
    "methodology": "mcclellan-rebuilt-v1-state-v2-input-v1",
    "description": "RECONSTRUCTED-V1-STATE / V2-INPUT CONTINUATION: through 2026-03-20 the legacy V1 "
                   "published oscillator; seed = EMA19/EMA39 deterministically rebuilt from the stored V1 "
                   "daily net-advance history (NOT the original V1 state, which V1 never persisted); from "
                   "2026-03-23 canonical V2 net advances only. PIT gaps emit no value and hold the state.",
    "rule": "EMA alpha 2/20 and 2/40, seeded at the first observation, missing sessions skipped, one pass "
            "2008-01-02..2026-03-20", "seed_session": SEED_SESSION,
    "ema19_seed": -447.32198711685294, "ema39_seed": -243.95100545909787,
    "reconstructed_osc_at_seed": -203.37098165775507, "stored_v1_osc_at_seed": -201.4,
    "accepted_discontinuity": -2.0, "v2_input_start": V2_START, "lineage": V1_LINEAGE}
AD_BRIDGE = {
    "methodology": "ad-legacy-full-history-seeded-v2-continuation-v1",
    "description": "LEGACY-FULL-HISTORY-SEEDED / V2-CONTINUATION: AD(D) = full-history V1 cumulative A/D at "
                   "2026-03-20 + sum of canonical V2 net advances 2026-03-23..D. PIT gaps emit no value and "
                   "hold the state. Window-independent (the V1 collector-window-relative -995 is NOT used).",
    "seed_session": SEED_SESSION, "seed_value": 806344.0, "v2_input_start": V2_START, "lineage": V1_LINEAGE}
DERIVED_FIELDS = ("mcclellan_osc", "adv_decline_cum")
_MCC_A19, _MCC_A39 = 2.0 / 20, 2.0 / 40

_R2_LIVE_PREFIX = "breadth_v2/live/"
_R2_MANIFEST = _R2_LIVE_PREFIX + "manifest.json"


def mode() -> str:
    """UCT authority (`BREADTH_AUTHORITY`)."""
    v = (os.environ.get("BREADTH_AUTHORITY") or "v1").strip().lower()
    return "v2" if v == "v2" else "v1"


def in_force() -> bool:
    return mode() == "v2"


# ── US: an INDEPENDENT authority over the whole V2 history (owner ruling 2026-09-29) ──────
#: `BREADTH_AUTHORITY_US` governs `us` alone; `BREADTH_AUTHORITY` governs `uct` alone. V2 owns
#: every `us` session it has — frozen 2008-01-02..2026-09-24 plus validated live publications —
#: with NO 2026-03-23 boundary (that is UCT's), NO provisional tail (V1 `us` is the defective
#: population, so it can never stand in for a V2 session) and NO PIT gaps (PIT is UCT's).
US_UNIVERSE = "us"
#: V1-only `us` metrics V2 does not produce — WITHHELD under V2 (never copied from V1).
US_WITHHELD = ("up_on_volume", "down_on_volume", "hvc_52w", "up_vol_ratio")


def us_mode() -> str:
    v = (os.environ.get("BREADTH_AUTHORITY_US") or "v1").strip().lower()
    return "v2" if v == "v2" else "v1"


def serves(universe: Optional[str]) -> bool:
    """Does V2 own `universe`'s OHLC history right now? (`uct` is composed by the Monitor/chart
    overlay instead, so this answers only for `us`.) False = the V1 store answers, unchanged."""
    return (universe or "").strip().lower() == US_UNIVERSE and us_mode() == "v2" and available()[0]


def _root() -> str:
    return os.environ.get("BREADTH_V2_DIR") or (
        "/data/breadth_v2" if os.path.isdir("/data") else
        os.path.join(os.path.dirname(__file__), "..", "..", "data", "breadth_v2"))


def frozen_path() -> str:
    return os.path.join(_root(), "frozen", FROZEN_NAME)


def live_replica_path() -> str:
    return os.path.join(_root(), "live_replica.db")


def _sha256_file(p: str) -> str:
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


# ── frozen artifact (read-only replica) ──────────────────────────────────────
_LOCK = threading.RLock()
_FROZEN: dict = {"stat": None, "data": None, "error": None}


def _load_frozen() -> Optional[dict]:
    """The verified frozen artifact's `uct` view, or None (and `error`) — never unverified."""
    p = frozen_path()
    try:
        st = os.stat(p)
    except OSError:
        _FROZEN.update(stat=None, data=None, error="frozen replica absent")
        return None
    key = (st.st_ino, st.st_size, st.st_mtime_ns)
    with _LOCK:
        if _FROZEN["stat"] == key:
            return _FROZEN["data"]
        data, err = None, None
        try:
            if st.st_size != FROZEN_BYTES:
                raise ValueError("size %d != %d" % (st.st_size, FROZEN_BYTES))
            sha = _sha256_file(p)
            if sha != FROZEN_SHA256:
                raise ValueError("sha256 %s != frozen identity" % sha)
            c = sqlite3.connect("file:%s?mode=ro&immutable=1" % p, uri=True)
            try:
                total = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc").fetchone()[0]
                if total != FROZEN_ROWS:
                    raise ValueError("rows %d != %d" % (total, FROZEN_ROWS))
                done = {d for (d,) in c.execute(
                    "SELECT date FROM pass_checkpoint WHERE status='done' AND date BETWEEN ? AND ?",
                    (V2_START, FROZEN_END))}
                rows: dict = {}
                for d, m, o, h, l, cl, s in c.execute(
                        "SELECT date, metric, o, h, l, c, source FROM breadth_daily_ohlc "
                        "WHERE universe=? AND date BETWEEN ? AND ?", (UNIVERSE, V2_START, FROZEN_END)):
                    if s not in V2_SOURCES:
                        raise ValueError("unexpected source %r" % s)
                    rows.setdefault(d, {})[m] = (o, h, l, cl, s)
                early = c.execute("SELECT COUNT(*) FROM breadth_daily_ohlc WHERE universe=? AND date<?",
                                  (UNIVERSE, V2_START)).fetchone()[0]
                if early:
                    raise ValueError("%d canonical uct rows before V2_START" % early)
                metrics = {m for r in rows.values() for m in r}
                if metrics != set(V2_METRICS):
                    raise ValueError("metric set differs: %s" % sorted(metrics ^ set(V2_METRICS)))
                gaps = tuple(sorted(done - set(rows)))
                if gaps != PIT_GAPS_RULED:
                    raise ValueError("PIT gaps %s != ruled %s" % (gaps, PIT_GAPS_RULED))
                data = {"rows": rows, "sessions": tuple(sorted(done)), "gaps": gaps,
                        "sha256": sha, "bytes": st.st_size,
                        "body_rows": sum(1 for r in rows.values() for v in r.values()
                                         if v[4] == "intraday_recon_1m_body")}
            finally:
                c.close()
        except Exception as e:
            err = "%s: %s" % (type(e).__name__, e)
        _FROZEN.update(stat=key, data=data, error=err)
        return data


# ── live V2 (replica of the producer's validated publications) ───────────────
_LIVE_SCHEMA = """
CREATE TABLE IF NOT EXISTS v2_live_session (
    date TEXT PRIMARY KEY, pub_id TEXT NOT NULL, sha256 TEXT NOT NULL, state TEXT NOT NULL,
    uct_present INTEGER NOT NULL, validated_at TEXT, adopted_at TEXT DEFAULT (datetime('now')),
    provenance TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_live_row (
    universe TEXT NOT NULL, date TEXT NOT NULL, metric TEXT NOT NULL,
    o REAL, h REAL, l REAL, c REAL, source TEXT NOT NULL, pub_id TEXT NOT NULL,
    PRIMARY KEY (universe, date, metric));
CREATE TABLE IF NOT EXISTS v2_live_conflict (
    date TEXT NOT NULL, offered_sha256 TEXT NOT NULL, accepted_sha256 TEXT NOT NULL,
    seen_at TEXT DEFAULT (datetime('now')), PRIMARY KEY (date, offered_sha256));
"""
_LIVE: dict = {"stat": None, "data": None}


def _live_conn(write: bool = False) -> sqlite3.Connection:
    p = live_replica_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    c = sqlite3.connect(p, timeout=30)
    c.executescript(_LIVE_SCHEMA)
    return c


def validate_publication(pub: dict, sha: str, entry: dict) -> Optional[str]:
    """Why a publication must NOT be adopted, or None. Structural only — the producer ran the
    methodology gates; this refuses anything that is not what the manifest promised."""
    d = pub.get("date")
    if d != entry.get("date") or d is None or d < LIVE_START:
        return "date %r not a live-period session / manifest mismatch" % d
    if pub.get("state") != "VALIDATED" or entry.get("state") != "VALIDATED":
        return "state not VALIDATED"
    if sha != entry.get("sha256"):
        return "sha mismatch"
    prov = pub.get("provenance") or {}
    for k in ("methodology", "producer_version", "vintage_tag", "input_manifest_sha256",
              "pit_ledger_sha256", "reference_sha256", "membership_sha256", "validated_at"):
        if not prov.get(k):
            return "provenance missing %s" % k
    rows = pub.get("rows") or []
    if not rows:
        return "no rows"
    for r in rows:
        if len(r) != 7 or r[6] not in V2_SOURCES or r[1] not in V2_METRICS:
            return "row outside the V2 contract: %r" % (r[:2] + r[6:],)
    uct = {r[1] for r in rows if r[0] == UNIVERSE}
    uct_gap = (prov.get("membership_sha256") or {}).get(UNIVERSE) == "PIT_REJECTED"
    if uct_gap and uct:
        return "uct rows present on a PIT-rejected session"
    if not uct_gap and uct != set(V2_METRICS) - _optional_on_session(pub):
        return "uct metric set incomplete"
    return None


def _optional_on_session(pub: dict) -> set:
    # the ratio family is honestly absent when its window reaches a gap or the canonical start
    return set((pub.get("provenance") or {}).get("absent_by_rule") or ()) & {"ratio_5day", "ratio_10day"}


def adopt_publication(pub_bytes: bytes, entry: dict) -> str:
    """Adopt ONE validated publication into the replica. Returns 'adopted' | 'same' | a refusal."""
    sha = hashlib.sha256(pub_bytes).hexdigest()
    try:
        pub = json.loads(gzip.decompress(pub_bytes))
    except Exception as e:
        return "refused: unreadable (%s)" % type(e).__name__
    why = validate_publication(pub, sha, entry)
    if why:
        return "refused: " + why
    d = pub["date"]
    with _LOCK, _live_conn(write=True) as c:
        cur = c.execute("SELECT sha256 FROM v2_live_session WHERE date=?", (d,)).fetchone()
        if cur is not None:
            if cur[0] == sha:
                return "same"
            c.execute("INSERT OR IGNORE INTO v2_live_conflict(date, offered_sha256, accepted_sha256) "
                      "VALUES(?,?,?)", (d, sha, cur[0]))
            return "refused: session %s already accepted with a different publication" % d
        prov = pub["provenance"]
        uct_present = int((prov.get("membership_sha256") or {}).get(UNIVERSE) != "PIT_REJECTED")
        c.execute("INSERT INTO v2_live_session(date, pub_id, sha256, state, uct_present, validated_at, provenance) "
                  "VALUES(?,?,?,?,?,?,?)", (d, pub["pub_id"], sha, "VALIDATED", uct_present,
                                           prov["validated_at"], json.dumps(prov, sort_keys=True)))
        c.executemany("INSERT INTO v2_live_row(universe, date, metric, o, h, l, c, source, pub_id) "
                      "VALUES(?,?,?,?,?,?,?,?,?)",
                      [(u, d, m, o, h, l, cl, s, pub["pub_id"]) for (u, m, o, h, l, cl, s) in pub["rows"]])
    _LIVE["stat"] = None
    return "adopted"


def _load_live() -> dict:
    p = live_replica_path()
    try:
        st = os.stat(p)
        key = (st.st_ino, st.st_size, st.st_mtime_ns)
    except OSError:
        return {"rows": {}, "sessions": {}}
    with _LOCK:
        if _LIVE["stat"] == key and _LIVE["data"] is not None:
            return _LIVE["data"]
        rows: dict = {}
        sessions: dict = {}
        try:
            c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
            try:
                for d, pid, sha, uct_present, va, prov in c.execute(
                        "SELECT date, pub_id, sha256, uct_present, validated_at, provenance "
                        "FROM v2_live_session WHERE state='VALIDATED'"):
                    sessions[d] = {"pub_id": pid, "sha256": sha, "uct_present": bool(uct_present),
                                   "validated_at": va, "provenance": json.loads(prov)}
                for d, m, o, h, l, cl, s in c.execute(
                        "SELECT date, metric, o, h, l, c, source FROM v2_live_row WHERE universe=?", (UNIVERSE,)):
                    if d in sessions:
                        rows.setdefault(d, {})[m] = (o, h, l, cl, s)
            finally:
                c.close()
        except Exception:
            return {"rows": {}, "sessions": {}}
        data = {"rows": rows, "sessions": sessions}
        _LIVE.update(stat=key, data=data)
        return data


# ── the view ──────────────────────────────────────────────────────────────────
def available() -> tuple[bool, Optional[str]]:
    """Can V2 authority be honoured right now? (False → readers stay on V1: fail closed.)"""
    if _load_frozen() is None:
        return False, _FROZEN["error"] or "frozen replica unavailable"
    return True, None


def token() -> str:
    """Cache-key component: changes when either authority or any authoritative input changes.
    Byte-identical to its pre-US form while `BREADTH_AUTHORITY_US` is unset/v1."""
    uct_v2, us_v2 = in_force(), us_mode() == "v2"
    # ⭐ Exchange Breadth V1 (nyse/nasdaq) rides the same token: '' while BREADTH_AUTHORITY_EXCH is off
    # (every key byte-identical to before), else its installed pointer — so every breadth cache and ETag
    # follows an exchange publish, cutover or rollback exactly as it follows a V1↔V2 switch.
    try:
        from api.services import breadth_exchange_authority as _ea
        exch = _ea.token()
    except Exception:
        exch = ":exch-error" if (os.environ.get("BREADTH_AUTHORITY_EXCH") or "").strip().lower() == "v1" else ""
    if not uct_v2 and not us_v2:
        return "v1" + exch
    f = _FROZEN.get("stat")
    live = _load_live()
    base = "%s:%s:%s" % (FROZEN_SHA256[:12] if f else "nofrozen", len(live["sessions"]),
                         max(live["sessions"]) if live["sessions"] else "-")
    return ("v2:" if uct_v2 else "v1:") + base + (":us-v2" if us_v2 else "") + exch


def session_authority(date: str, collector_tail: tuple = ()) -> str:
    """The authority class of one `uct` session under V2 (V1_LEGACY before the boundary)."""
    if date <= LEGACY_END:
        return V1_LEGACY
    if date <= FROZEN_END:
        f = _load_frozen() or {}
        return V2_FROZEN if date in (f.get("rows") or {}) else V2_GAP
    live = _load_live()
    s = live["sessions"].get(date)
    if s is not None:
        return V2_LIVE if s["uct_present"] else V2_GAP
    return PROVISIONAL if date in _provisional_dates(collector_tail, live) else V2_PENDING


def _provisional_dates(collector_tail, live) -> set:
    """`collector_tail` = the GLOBAL newest collector session dates (never a reader's window)."""
    last_canon = max([FROZEN_END] + list(live["sessions"]))
    after = sorted(d for d in set(collector_tail) if d > last_canon)
    return set(after[-PROVISIONAL_MAX:])


def v2_rows(date: str) -> dict:
    """{metric: (o, h, l, c, source)} for a canonical V2 session, else {}."""
    if LEGACY_END < date <= FROZEN_END:
        return dict(((_load_frozen() or {}).get("rows") or {}).get(date) or {})
    return dict(_load_live()["rows"].get(date) or {})


def v2_dates() -> list:
    """Every canonical-or-gap V2 session (frozen done-calendar + validated live sessions), ASC."""
    f = _load_frozen() or {}
    return sorted(set(f.get("sessions") or ()) | set(_load_live()["sessions"]))


def provenance(date: str, collector_tail: tuple = ()) -> dict:
    cls = session_authority(date, collector_tail)
    p = {"authority": cls}
    if cls == V2_FROZEN:
        p.update(artifact=FROZEN_NAME, artifact_sha256=FROZEN_SHA256,
                 methodology="rth-1m-composites-v2c2-div")
    elif cls == V2_LIVE:
        s = _load_live()["sessions"][date]
        p.update(pub_id=s["pub_id"], publication_sha256=s["sha256"], validated_at=s["validated_at"],
                 methodology=s["provenance"].get("methodology"))
    elif cls == V2_GAP:
        p["reason"] = "PIT-rejected session: no canonical V2 value (owner ruling 2026-09-29)"
    elif cls == PROVISIONAL:
        p["reason"] = "collector value shown until canonical V2 validates this session"
    elif cls == V2_PENDING:
        p["reason"] = "canonical V2 not yet validated and past the provisional window — withheld"
    return p


_DERIVED_MEMO: dict = {}
_LEGACY_MEMO: dict = {"at": 0.0, "data": None}
_LEGACY_TTL = 300.0


def derived_uct(provisional_adv: Optional[dict] = None, collector_tail: tuple = ()) -> dict:
    """Memoised on (authority token, provisional inputs, collector tail) — see _derived_uct."""
    key = (token(), tuple(sorted((provisional_adv or {}).items())), tuple(sorted(collector_tail)))
    hit = _DERIVED_MEMO.get(key)
    if hit is None:
        if len(_DERIVED_MEMO) > 32:
            _DERIVED_MEMO.clear()
        hit = _DERIVED_MEMO[key] = _derived_uct(provisional_adv, collector_tail)
    return hit


def _derived_uct(provisional_adv: Optional[dict] = None, collector_tail: tuple = ()) -> dict:
    """{date: {"mcclellan_osc", "adv_decline_cum", "authority"}} for every V2-period `uct`
    session, computed ONCE over the full V2 calendar from the pinned seeds — never from a reader's
    window. Canonical sessions feed their V2 `adv_decline`; a gap (or pending) session emits None
    and HOLDS both states (a missing observation is not a zero observation); a provisional
    session (after the last canonical one) is continued from the collector's value, flagged,
    never persisted."""
    e19, e39 = MCCLELLAN_BRIDGE["ema19_seed"], MCCLELLAN_BRIDGE["ema39_seed"]
    ad = AD_BRIDGE["seed_value"]
    prov = provisional_adv or {}
    out = {}
    for d in sorted(set(v2_dates()) | {x for x in prov if x > FROZEN_END}):
        if d < V2_START:
            continue
        cls = session_authority(d, collector_tail)
        v = None
        if cls in CANONICAL:
            r = v2_rows(d).get("adv_decline")
            v = r[3] if r is not None else None
        elif cls == PROVISIONAL:
            v = prov.get(d)
        if v is None:
            out[d] = {"mcclellan_osc": None, "adv_decline_cum": None, "authority": cls}
            continue
        e19 = _MCC_A19 * v + (1 - _MCC_A19) * e19
        e39 = _MCC_A39 * v + (1 - _MCC_A39) * e39
        ad = ad + v
        out[d] = {"mcclellan_osc": round(e19 - e39, 1), "adv_decline_cum": ad, "authority": cls,
                  "_state": (e19, e39)}
    return out


def legacy_ad_cum(frm: str = "0000") -> dict:
    """{date: full-history cumulative A/D} for legacy sessions (<= SEED_SESSION) from `frm` —
    one running sum over the whole V1 lineage, independent of any reader window."""
    now = time.time()
    if _LEGACY_MEMO["data"] is None or now - _LEGACY_MEMO["at"] > _LEGACY_TTL:
        from api.services import breadth_monitor as bm
        full, run = {}, 0.0
        for d, v in bm.v1_merged_adv_decline(SEED_SESSION):
            run += v
            full[d] = run
        _LEGACY_MEMO.update(at=now, data=full)
    return {d: v for d, v in _LEGACY_MEMO["data"].items() if d >= frm}


def seed_check() -> dict:
    """Re-derive both bridge seeds from the CURRENT V1 stores and compare to the pinned values."""
    from api.services import breadth_monitor as bm
    series = bm.v1_merged_adv_decline(SEED_SESSION)
    e19, e39 = bm.rebuild_mcclellan_state(series)
    ad = sum(v for _d, v in series)
    dig = bm.v1_lineage_digest(series)
    return {"lineage_sha256": dig, "lineage_matches": dig == V1_LINEAGE["sha256"], "sessions": len(series),
            "ema19": e19, "ema39": e39, "ad": ad,
            "mcclellan_seed_matches": (e19, e39) == (MCCLELLAN_BRIDGE["ema19_seed"], MCCLELLAN_BRIDGE["ema39_seed"]),
            "ad_seed_matches": ad == AD_BRIDGE["seed_value"]}


def overlay_monitor_rows(rows_asc: list, collector_tail: tuple = ()) -> list:
    """Apply V2 authority to Monitor rows (oldest-first dicts with 'date'), IN PLACE and returned.

    Before V2_START nothing changes. From V2_START:
      V2_FROZEN / V2_LIVE  the 35 metrics are replaced by V2 closes; missing sessions are ADDED
      V2_GAP / V2_PENDING  the 35 metrics become None (non-Breadth collector fields stay)
      PROVISIONAL          collector values kept, flagged
    Every V2-period row gets `_authority` + `_provenance`; `PENDING_DECISION_FIELDS` are withheld.
    No-op when V2 is not in force or not available.
    """
    if not in_force() or not available()[0]:
        return rows_asc
    by_date = {r.get("date"): r for r in rows_asc if r.get("date")}
    lo = min(by_date) if by_date else None
    hi = max(by_date) if by_date else None
    if lo is None:
        return rows_asc
    # sessions V2 knows that the collector never wrote (V1 holes) join the window
    for d in v2_dates():
        if lo <= d <= hi and d >= V2_START and d not in by_date:
            by_date[d] = {"date": d}
    prov_adv = {d: r.get("adv_decline") for d, r in by_date.items()
                if d > FROZEN_END and isinstance(r.get("adv_decline"), (int, float))}
    derived = derived_uct(prov_adv, collector_tail)
    legacy_ad = legacy_ad_cum(lo) if lo <= LEGACY_END else None
    out = []
    for d in sorted(by_date):
        row = by_date[d]
        if d >= V2_START:
            cls = session_authority(d, collector_tail)
            if cls in CANONICAL:
                v2 = v2_rows(d)
                for m in V2_METRICS:
                    row[m] = v2[m][3] if m in v2 else None
                row["_v2_direct"] = True
            elif cls in (V2_GAP, V2_PENDING):
                for m in V2_METRICS:
                    row[m] = None
                row["_v2_direct"] = True
            dv = derived.get(d) or {}
            for f in DERIVED_FIELDS:
                row[f] = dv.get(f)
            row["_v2_derived"] = True
            row["_authority"] = cls
            row["_provenance"] = dict(provenance(d, collector_tail),
                                      derived={"mcclellan_osc": MCCLELLAN_BRIDGE["methodology"],
                                               "adv_decline_cum": AD_BRIDGE["methodology"]})
        elif legacy_ad is not None:
            # ⭐ ONE canonical A/D under V2: legacy rows carry the FULL-HISTORY V1 lineage (the deep
            # reader's), never the collector-window-relative value the plain V1 reader derives.
            row["adv_decline_cum"] = legacy_ad.get(d)
            row["_v2_derived"] = True
        out.append(row)
    rows_asc[:] = out
    return rows_asc


def chart_bars(metric: str, collector_closes: dict, provisional_adv: Optional[dict] = None) -> Optional[dict]:
    """{date: (o, h, l, c, authority)} for `uct` sessions >= V2_START under V2, or None (V1).

    None also for a metric V2 does not own (collector-owned fields keep their V1 path).
    Canonical sessions carry V2's own OHLC (a `_body` row is o=h=l=c); PIT gaps and pending
    sessions are ABSENT (no bar, no interpolation); a provisional session carries the collector
    close with no wick (the reader draws it close-to-close). A pending-decision field is
    withheld entirely from V2_START ({}).
    """
    if not in_force() or not available()[0]:
        return None
    tail = tuple(sorted(d for d in collector_closes if d > FROZEN_END))
    if metric in DERIVED_FIELDS:
        dv = derived_uct(provisional_adv or {}, tail)
        out = {d: (None, None, None, x[metric], x["authority"]) for d, x in dv.items() if x[metric] is not None}
        if metric == "adv_decline_cum":
            # the legacy part of the ONE canonical A/D line (full-history lineage) — replaces the V1
            # chart's collector-window-relative values for every legacy date
            out.update({d: (None, None, None, v, V1_LEGACY) for d, v in legacy_ad_cum().items()})
        return out
    if metric not in V2_METRICS:
        return None
    out: dict = {}
    for d in sorted(set(v2_dates()) | set(tail)):
        if d < V2_START:
            continue
        cls = session_authority(d, tail)
        if cls in CANONICAL:
            r = v2_rows(d).get(metric)
            if r is not None:
                out[d] = (r[0], r[1], r[2], r[3], cls)
        elif cls == PROVISIONAL and collector_closes.get(d) is not None:
            out[d] = (None, None, None, collector_closes[d], cls)
    return out


_US_MEMO: dict = {}


def _frozen_metric(universe: str, metric: str) -> dict:
    """{date: (o, h, l, c, source)} for one frozen universe/metric (verified replica, memoised)."""
    f = _load_frozen()
    if f is None:
        return {}
    key = (_FROZEN.get("stat"), universe, metric)
    hit = _US_MEMO.get(key)
    if hit is None:
        c = sqlite3.connect("file:%s?mode=ro&immutable=1" % frozen_path(), uri=True)
        try:
            hit = {d: (o, h, l, cl, s) for d, o, h, l, cl, s in c.execute(
                "SELECT date, o, h, l, c, source FROM breadth_daily_ohlc WHERE universe=? AND metric=?",
                (universe, metric))}
        finally:
            c.close()
        if len(_US_MEMO) > 80:
            _US_MEMO.clear()
        _US_MEMO[key] = hit
    return hit


def _live_universe(universe: str) -> dict:
    """{date: {metric: (o, h, l, c, source)}} of VALIDATED live publications for `universe`."""
    p = live_replica_path()
    if not os.path.exists(p):
        return {}
    out: dict = {}
    c = sqlite3.connect("file:%s?mode=ro" % p, uri=True)
    try:
        for d, m, o, h, l, cl, s in c.execute(
                "SELECT r.date, r.metric, r.o, r.h, r.l, r.c, r.source FROM v2_live_row r "
                "JOIN v2_live_session x ON x.date = r.date AND x.pub_id = r.pub_id "
                "WHERE r.universe=? AND x.state='VALIDATED'", (universe,)):
            out.setdefault(d, {})[m] = (o, h, l, cl, s)
    finally:
        c.close()
    return out


def universe_history(metric: str, universe: Optional[str], limit: int = 6000,
                     with_source: bool = False) -> Optional[dict]:
    """The `breadth_daily_ohlc.history` answer under V2 for a universe V2 owns, else None.

    {date: {o, h, l, c}} newest `limit` sessions: frozen V2 rows + validated live rows. A metric V2
    does not produce (the four V1-only volume metrics, or anything outside the 35) is {} —
    unavailable, never a V1 value and never a zero."""
    if not serves(universe):
        return None
    u = US_UNIVERSE
    if metric in US_WITHHELD or metric not in V2_METRICS:
        return {}
    rows = {d: r for d, r in _frozen_metric(u, metric).items()}
    for d, byd in _live_universe(u).items():
        if metric in byd and d > FROZEN_END:
            rows[d] = byd[metric]
    keep = sorted(rows)[-int(limit):] if limit else sorted(rows)
    out = {d: {"o": rows[d][0], "h": rows[d][1], "l": rows[d][2], "c": rows[d][3]} for d in keep}
    if with_source:
        # OPT-IN provenance (the row's own V2 source), read only by the chart to tell an
        # observed 1-minute OHLC from a `_body` row; no value changes, and off is unchanged.
        for d in keep:
            out[d]["src"] = rows[d][4] if len(rows[d]) > 4 else None
    return out


def universe_dates(universe: Optional[str], since: str = "") -> Optional[list]:
    """The `breadth_daily_ohlc.dates_since` answer under V2 for a universe V2 owns, else None."""
    if not serves(universe):
        return None
    f = _load_frozen() or {}
    ds = set(f.get("sessions") or ()) | {d for d in _live_universe(US_UNIVERSE) if d > FROZEN_END}
    return sorted(d for d in ds if d >= (since or ""))


def status() -> dict:
    ok, why = available()
    f = _FROZEN.get("data") or {}
    live = _load_live()
    try:
        with _live_conn() as c:
            conflicts = c.execute("SELECT date, offered_sha256, accepted_sha256, seen_at "
                                  "FROM v2_live_conflict").fetchall()
    except Exception:
        conflicts = []
    return {"mode": mode(), "us_mode": us_mode(), "us_withheld_metrics": list(US_WITHHELD),
            "v2_available": ok, "v2_unavailable_reason": why,
            "boundaries": {"legacy_end": LEGACY_END, "v2_start": V2_START, "frozen_end": FROZEN_END,
                           "live_start": LIVE_START},
            "frozen": {"name": FROZEN_NAME, "sha256_expected": FROZEN_SHA256, "verified": bool(f),
                       "sessions": len(f.get("sessions") or ()), "uct_sessions": len(f.get("rows") or {}),
                       "gaps": list(f.get("gaps") or ()), "body_rows_uct": f.get("body_rows")},
            "live": {"sessions": sorted(live["sessions"]),
                     "latest": max(live["sessions"]) if live["sessions"] else None,
                     "conflicts": conflicts},
            "pending_decision_fields": list(PENDING_DECISION_FIELDS),
            "derived_bridges": {"mcclellan_osc": MCCLELLAN_BRIDGE, "adv_decline_cum": AD_BRIDGE},
            "token": token()}


# ── sync (background only — never from a request) ────────────────────────────
def ensure_frozen_replica() -> str:
    """Download + verify the frozen artifact from the R2 freeze archive into a 0444 replica."""
    if _load_frozen() is not None:
        return "present"
    from api.services import breadth_ohlc_sync as bos
    cl, bk = bos._client(), bos._bucket()
    if not (cl and bk):
        return "no-credentials"
    blob = cl.get_object(Bucket=bk, Key=FROZEN_R2_KEY)["Body"].read()
    if hashlib.sha256(blob).hexdigest() != FROZEN_R2_GZ_SHA256:
        return "refused: archive sha mismatch"
    plain = gzip.decompress(blob)
    if len(plain) != FROZEN_BYTES or hashlib.sha256(plain).hexdigest() != FROZEN_SHA256:
        return "refused: decompressed identity mismatch"
    p = frozen_path()
    os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + ".partial.%d" % os.getpid()
    with open(tmp, "wb") as f:
        f.write(plain)
    os.chmod(tmp, 0o444)
    os.replace(tmp, p)
    return "installed" if _load_frozen() is not None else "refused: %s" % _FROZEN["error"]


def sync_live_once() -> dict:
    """Adopt every VALIDATED session in the producer's R2 manifest not yet in the replica."""
    from api.services import breadth_ohlc_sync as bos
    cl, bk = bos._client(), bos._bucket()
    if not (cl and bk):
        return {"ok": False, "reason": "no-credentials"}
    try:
        man = json.loads(cl.get_object(Bucket=bk, Key=_R2_MANIFEST)["Body"].read())
    except Exception as e:
        return {"ok": False, "reason": "no manifest (%s)" % type(e).__name__}
    have = _load_live()["sessions"]
    res = {}
    for d, entry in sorted((man.get("sessions") or {}).items()):
        entry = dict(entry, date=d)
        if d in have and have[d]["sha256"] == entry.get("sha256"):
            continue
        try:
            blob = cl.get_object(Bucket=bk, Key=entry["key"])["Body"].read()
        except Exception as e:
            res[d] = "fetch failed (%s)" % type(e).__name__
            continue
        res[d] = adopt_publication(blob, entry)
    return {"ok": True, "results": res}


def sync_loop(interval: int = 600) -> None:
    """Web background thread: install the frozen replica, then poll the producer manifest."""
    while True:
        try:
            ensure_frozen_replica()
            sync_live_once()
        except Exception as e:
            print("[breadth_authority] sync error: %s: %s" % (type(e).__name__, e), flush=True)
        time.sleep(interval)
