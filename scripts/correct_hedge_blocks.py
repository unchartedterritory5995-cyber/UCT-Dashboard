"""
correct_hedge_blocks.py — retroactively strip HEDGE-associated heavy BLOCK trades
from flow.db (last ~1 month) so the STORED lean stops counting dealer-hedge /
facilitation blocks as directional. DRY-RUN by default + fully reversible.

PRECEDENCE (per sided BLOCK >= PREMIUM_FLOOR in the window):
  1. ALIGNED SWEEP present  -> KEEP. If a SWEEP at the SAME strike/expiry/right,
     SAME aggressor side (ask/bid), SAME day, with premium >= SWEEP_MIN_FRAC of
     the block's premium exists, the block is sweep-backed conviction — never
     strip it (this is what stops it eliminating ALL blocks). Runs first, wins
     over everything below. The size floor stops a token $50K sweep from
     laundering a $45M block (the NBIS problem).
  2. else DARKPOOL mode + block tied to a same-second delta-consistent dark-pool
     equity print                                             -> STRIP (hedge).
  3. else FLAT mode                                           -> STRIP.
  4. else                                                     -> KEEP.

Blank-sided blocks are already non-directional in the DB, so they're skipped
(nothing to strip). This only decides sided heavy blocks.

Rationale (2026-07-25): a heavy option BLOCK tied to a same-second dark-pool
equity print is the derivative leg of an institutional equity trade — the
commercial hedger (size in the underlying) is the informed actor. Verified on
BE $250 9/18 7/16 (10,000c $45M ask @10:48:55 + 550k-sh $123M dark @10:48:56,
0.55 delta, NO $250 sweep -> strip) and NBIS $170 8/7. A block WITH a real
same-strike sweep (BE $240 had sweep accumulation) is genuine flow -> keep.

Modes:
  FLAT (default): every sided BLOCK >= PREMIUM_FLOOR that lacks an aligned sweep.
  DARKPOOL (--darkpool <csv>): only those ALSO tied to a same-ticker dark-pool
     print within +/- MATCH_SEC, share size 0.15-1.05x contracts*100.

Safety: DRY-RUN unless --apply. Reversible: backs up Side->orig_side, flags
hedge_block=1, nulls Side; undo with --rollback --apply. Idempotent (skips
already-blank rows). BACK UP flow.db FIRST (Railway Backups, or cp the file).

Run on flow-worker (/data/flow.db):
  python3 correct_hedge_blocks.py                     # dry-run flat
  python3 correct_hedge_blocks.py --apply
  python3 correct_hedge_blocks.py --darkpool dp.csv   # dry-run hedge-pair
  python3 correct_hedge_blocks.py --darkpool dp.csv --apply
  python3 correct_hedge_blocks.py --rollback --apply  # undo

Knobs (env): HEDGE_BLOCK_PREMIUM(10000000), HEDGE_BLOCK_DAYS(31),
HEDGE_MATCH_SEC(2), HEDGE_SWEEP_MIN_FRAC(0.10 = sweep must be >=10% of block).
"""
import os
import sys
import csv
import sqlite3
from collections import defaultdict
from datetime import datetime, timedelta

DB = os.environ.get("FLOW_DB", "/data/flow.db")
PREMIUM_FLOOR = float(os.environ.get("HEDGE_BLOCK_PREMIUM", "10000000"))
DAYS = int(os.environ.get("HEDGE_BLOCK_DAYS", "31"))
MATCH_SEC = float(os.environ.get("HEDGE_MATCH_SEC", "2"))
SWEEP_MIN_FRAC = float(os.environ.get("HEDGE_SWEEP_MIN_FRAC", "0.10"))
APPLY = "--apply" in sys.argv
ROLLBACK = "--rollback" in sys.argv
DP_CSV = sys.argv[sys.argv.index("--darkpool") + 1] if "--darkpool" in sys.argv else None


def _num(x):
    try:
        return float(str(x).replace("$", "").replace(",", "").strip())
    except Exception:
        return 0.0


def _mdy(s):
    for f in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d"):
        try:
            return datetime.strptime(str(s).strip(), f)
        except Exception:
            pass
    return None


def _hms(d, t):
    dt = _mdy(d)
    if dt is None:
        return None
    for f in ("%I:%M:%S %p", "%H:%M:%S"):
        try:
            tt = datetime.strptime(str(t).strip(), f)
            return dt.replace(hour=tt.hour, minute=tt.minute, second=tt.second)
        except Exception:
            pass
    return None


def side_class(side):
    s = (side or "").upper().strip()
    if s in ("A", "AA"):
        return "ASK"
    if s in ("B", "BB"):
        return "BID"
    return None


def contract_key(sym, strike, cp, exp, sc, date):
    return ((sym or "").upper().strip(), _num(strike),
            (cp or "").upper().strip()[:4], str(exp).strip(), sc, str(date).strip())


def ensure_cols(con):
    cols = {r[1] for r in con.execute("PRAGMA table_info(flow)")}
    if "orig_side" not in cols:
        con.execute("ALTER TABLE flow ADD COLUMN orig_side TEXT")
    if "hedge_block" not in cols:
        con.execute("ALTER TABLE flow ADD COLUMN hedge_block INTEGER DEFAULT 0")
    con.commit()


def load_darkpool(path):
    dp = defaultdict(list)
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            tk = (r.get("Ticker") or r.get("Symbol") or "").upper().strip()
            dt = _hms(r.get("Date"), r.get("Timestamp") or r.get("Time"))
            sh = _num(r.get("Volume") or r.get("Shares"))
            if tk and dt and sh > 0:
                dp[tk].append((dt, sh))
    for tk in dp:
        dp[tk].sort()
    return dp


def dp_match(dp, tk, when, contracts):
    if when is None or contracts <= 0:
        return None
    notion = contracts * 100
    for (dt, sh) in dp.get(tk, []):
        if abs((dt - when).total_seconds()) <= MATCH_SEC:
            ratio = sh / notion
            if 0.15 <= ratio <= 1.05:
                return (dt, sh, ratio)
    return None


def main():
    con = sqlite3.connect(DB, timeout=60)
    ensure_cols(con)

    if ROLLBACK:
        n = con.execute("SELECT COUNT(*) FROM flow WHERE hedge_block=1").fetchone()[0]
        print(f"[rollback] {n} rows currently stripped.")
        if APPLY:
            con.execute("UPDATE flow SET Side=orig_side WHERE hedge_block=1 AND orig_side IS NOT NULL")
            con.execute("UPDATE flow SET hedge_block=0 WHERE hedge_block=1")
            con.commit()
            print("[rollback] restored original Side; hedge_block cleared.")
        else:
            print("[rollback] DRY-RUN — add --apply to restore.")
        return

    cutoff = datetime.now() - timedelta(days=DAYS)
    prem = "CAST(REPLACE(REPLACE(COALESCE(Premium,''),'$',''),',','') AS REAL)"
    rows = con.execute(
        f"""SELECT rowid, Symbol, COALESCE(Type,''), CreatedDate, CreatedTime,
                   Side, Volume, Strike, CallPut, ExpirationDate, {prem}
            FROM flow"""
    ).fetchall()

    # 1) index aligned-sweep premium by contract/side/day
    sweep_idx = defaultdict(float)
    for (_rid, sym, typ, cd, _ct, side, _vol, strike, cp, exp, p) in rows:
        u = typ.upper()
        if "SWEEP" not in u and u != "SWP":
            continue
        sc = side_class(side)
        if sc is None:
            continue
        sweep_idx[contract_key(sym, strike, cp, exp, sc, cd)] += p

    dp = load_darkpool(DP_CSV) if DP_CSV else None

    # 2) evaluate blocks by precedence
    targets = []
    protected = 0
    for (rid, sym, typ, cd, ct, side, vol, strike, cp, exp, p) in rows:
        u = typ.upper()
        if "BLOCK" not in u and u != "BLK":
            continue
        if p < PREMIUM_FLOOR:
            continue
        d = _mdy(cd)
        if d is None or d < cutoff:
            continue
        sc = side_class(side)
        if sc is None:
            continue  # already blank / non-directional
        # precedence 1: aligned sweep -> KEEP
        sweep_prem = sweep_idx.get(contract_key(sym, strike, cp, exp, sc, cd), 0.0)
        if sweep_prem >= SWEEP_MIN_FRAC * p:
            protected += 1
            continue
        # precedence 2/3: dark-pool-tied (darkpool mode) or flat
        if dp is not None:
            if not dp_match(dp, (sym or "").upper(), _hms(cd, ct), int(_num(vol))):
                continue  # not dp-tied -> KEEP
        targets.append((rid, (sym or "?").upper(), p))

    by = defaultdict(lambda: [0, 0.0])
    for _, sym, p in targets:
        by[sym][0] += 1
        by[sym][1] += p
    print(f"criteria: {'DARKPOOL-tied' if dp is not None else 'FLAT'} | premium >= ${PREMIUM_FLOOR/1e6:.0f}M "
          f"| last {DAYS}d | sweep-protect >= {SWEEP_MIN_FRAC:.0%} of block")
    print(f"blocks KEPT by aligned sweep: {protected}")
    print(f"blocks to STRIP: {len(targets)}  total ${sum(t[2] for t in targets)/1e6:.1f}M  across {len(by)} tickers")
    for sym, (n, pp) in sorted(by.items(), key=lambda x: -x[1][1])[:25]:
        print(f"  {sym:6} {n:3} blocks  ${pp/1e6:6.1f}M")

    if not APPLY:
        print("\nDRY-RUN — nothing written. Add --apply to strip (Side -> NULL, orig_side saved, hedge_block=1).")
        return

    ids = [t[0] for t in targets]
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        q = ",".join("?" * len(chunk))
        con.execute(f"UPDATE flow SET orig_side=Side WHERE rowid IN ({q}) AND orig_side IS NULL", chunk)
        con.execute(f"UPDATE flow SET Side=NULL, hedge_block=1 WHERE rowid IN ({q})", chunk)
    con.commit()
    print(f"\n[apply] stripped {len(ids)} blocks. Side nulled (orig_side saved, hedge_block=1). Undo: --rollback --apply.")


if __name__ == "__main__":
    main()
