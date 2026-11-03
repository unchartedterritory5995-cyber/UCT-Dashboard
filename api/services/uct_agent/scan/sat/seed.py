"""SAT-1 sandbox seeding — a deterministic, SYNTHETIC screener universe for the interactive Scanner
acceptance test (owner: agent-sc). Never real market data, never production.

    python -m api.services.uct_agent.scan.sat.seed --data-dir C:\\data-sat1 --scenario fresh
    python -m api.services.uct_agent.scan.sat.seed --data-dir C:\\data-sat1 --scenario fresh --member-email hubtest@local.dev

What it does:
1. Writes `screener_rows` into the SANDBOX's screener.db, through the screener's own writer
   (`snapshot_db.init_db` + `upsert_rows`). It doesn't compose any SQL of its own. Tickers are `SY001…`
   and companies are named "SAT synthetic …", so nobody can mistake them for real names.
2. With `--member-email` (after that member has signed up in the sandbox), it saves three screens for
   them and one for a second, synthetic member, through `saved_screens.create`, the service's own write.
3. It runs the REAL SC-1 kinds against the result and prints what they answer. Those printed answers
   are SAT-1's expected values: measured from the canonical service, never typed by hand.

Scenarios: `fresh` (bars through the last closed session), `stale` (3 sessions behind), `mixed` (half one
session behind, half fresh), `empty` (no rows at all, which gives an empty universe).
Every non-empty scenario also has 5 names with no Float % (not computable) and 1 name whose bars stopped
40 sessions ago (the screener's stale gate drops it).

⛔ It refuses to run when:
* a Railway variable is set (it never runs on a deployed service);
* the data dir is missing, a drive root, or the shared data root (`/data`, `C:\\data`), or does not exist;
* the sandbox's screener.db path is not inside the data dir.
It pins EVERY census data path into the data dir (`pin`, the same census + mapping as the hub launcher) BEFORE
importing any screener module, because those paths are captured at import — and arms conftest's tripwire.
"""
from __future__ import annotations

import argparse
import datetime as dt
import os
import sys

RAILWAY = ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_SERVICE_ID", "RAILWAY_PROJECT_ID",
           "RAILWAY_DEPLOYMENT_ID", "RAILWAY_REPLICA_ID", "RAILWAY_STATIC_URL")
OTHER_MEMBER = "sat1-other-member"
INDUSTRIES = [("Technology", "Semiconductors"), ("Technology", "Software - Application"),
              ("Technology", "Software - Infrastructure"), ("Energy", "Oil & Gas E&P"),
              ("Healthcare", "Biotechnology"), ("Financial Services", "Banks - Regional")]
N = 120


def _refuse(msg: str) -> None:
    print(f"REFUSED: {msg}", file=sys.stderr)
    raise SystemExit(2)


def check_data_dir(path: str) -> str:
    if any(os.environ.get(k) for k in RAILWAY):
        _refuse("a Railway variable is set; SAT-1 seeding never runs on a deployed service")
    if not path:
        _refuse("--data-dir is required")
    p = os.path.abspath(path)
    norm = p.replace("\\", "/").rstrip("/").lower()
    drive_root = len(norm) <= 3                                  # "c:" or "/"
    shared = norm in ("/data", "c:/data") or norm.endswith(":/data")
    if drive_root or shared:
        _refuse(f"{p} is a drive root or the shared data root; use a sandbox such as C:\\data-sat1")
    if not os.path.isdir(p):
        _refuse(f"{p} does not exist; boot the sandbox once first (it creates the directory)")
    return p


def pin(data_dir: str) -> dict:
    """Pin EVERY data path the app reads into the sandbox — the census, never a hand-picked list.

    ⛔ The 2026-09-08 sandbox incident: two hand-typed pins left 70 other paths on the shared root.
    `conftest.shared_data_root_census()` derives every `(env var -> /data literal)` pair from `api/**` by AST
    (the list the hub launcher and the pytest suite already use), and `scripts/hub_sandbox_boot._sandbox_for`
    maps each literal into the sandbox (one mapping, reused — not a second copy). Importing conftest also ARMS
    its write tripwire: a write to the shared root raises instead of landing. Returns {env: path} pinned."""
    repo = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(
        os.path.abspath(__file__)))))))
    for extra in (repo, os.path.join(repo, "scripts")):
        if extra not in sys.path:
            sys.path.insert(0, extra)
    import conftest                      # noqa: E402 — arms the shared-root tripwire on import
    import hub_sandbox_boot as hsb       # noqa: E402 — for `_sandbox_for` only (main() is not run)
    _census, pins, _unpinnable = conftest.shared_data_root_census()
    done = {}
    for env, literal in pins.items():
        os.environ[env] = done[env] = hsb._sandbox_for(data_dir, literal)
    if os.environ.get("SCREENER_DB_PATH") != os.path.join(data_dir, "screener.db")             or os.environ.get("AUTH_DB_PATH") != os.path.join(data_dir, "auth.db"):
        _refuse("the census did not pin screener.db and auth.db into the data dir")
    return done


def _sessions_back(n: int, now: dt.datetime | None = None) -> int:
    from api.services.uct_agent.scan import screen
    day = screen.last_closed_session(now)
    while n > 0:
        day -= dt.timedelta(days=1)
        if screen._is_session(day):
            n -= 1
    return int(day.strftime("%Y%m%d"))


def rows(scenario: str, now: dt.datetime | None = None) -> list[dict]:
    if scenario == "empty":
        return []
    fresh = _sessions_back(0, now)
    behind = {"fresh": fresh, "stale": _sessions_back(3, now)}.get(scenario, fresh)
    one_back = _sessions_back(1, now)
    out = []
    for i in range(N):
        sector, industry = INDUSTRIES[i % len(INDUSTRIES)]
        asof = (one_back if i % 2 else fresh) if scenario == "mixed" else behind
        out.append({
            "ticker": f"SY{i + 1:03d}", "company": f"SAT synthetic {i + 1:03d}", "sector": sector, "industry": industry,
            "security_type": "Common Stock", "exchange": "NASDAQ",
            "price": round(5 + i * 1.7, 2), "market_cap": 5e8 + i * 2.5e8, "chg_pct_1d": round(((i * 7) % 21 - 10) / 2, 2),
            "chg_pct_1m": float((i * 3) % 60 - 15), "chg_pct_3m": float((i * 5) % 90 - 20),
            "vol_ratio": round(0.4 + (i % 17) * 0.25, 2), "float_pct": (i * 37) % 100, "adr_pct": round(2 + (i % 11) * 0.6, 2),
            "dist_52w_high_pct": float(i % 25), "new_52w_high": 1 if i % 25 == 0 else 0, "rsi14": float(20 + (i * 13) % 65),
            "above_50sma": 1 if i % 3 else 0, "tight_consolidation": 1 if i % 9 == 0 else 0,
            "eps_growth": float((i * 11) % 80 - 10), "rev_growth": float((i * 7) % 60 - 5),
            "short_float_pct": float(i % 30), "days_to_earnings": float(i % 40), "gap_pct": round(((i * 3) % 13 - 4) / 1, 2),
            "dollar_vol_30d": 1e7 + i * 1.5e6, "avg_dollar_vol_30d": 1e7 + i * 1.5e6,
            "bars_asof": asof, "snapshot_date": dt.date.today().isoformat(),
        })
    for r in out[-5:]:
        r["float_pct"] = None                                   # not computable for a float screen
    out.append(dict(out[0], ticker="SYSTOP", company="SAT synthetic stopped", float_pct=99,
                    bars_asof=_sessions_back(40, now)))           # dropped by the screener's own stale gate
    return out


def seed_screens(member_email: str) -> dict:
    from api.services import auth_service
    from api.services.screener import saved_screens
    u = auth_service.get_user_by_email(member_email)
    if not u:
        _refuse(f"no sandbox user {member_email!r}; sign up in the sandbox first, then re-run with --member-email")
    saved_screens.init()
    mine = [
        saved_screens.create(u["id"], "SAT Leaders", {"filters": [{"key": "float_pct", "op": "gte", "min": 90}],
                                                       "sort": {"key": "float_pct", "dir": "desc"}}),
        saved_screens.create(u["id"], "SAT Semis volume", {"filters": [{"key": "industry", "op": "in", "values": ["Semiconductors"]},
                                                                         {"key": "vol_ratio", "op": "gte", "min": 2}]}),
        saved_screens.create(u["id"], "SAT EMA cross (indicator)", {"filters": [{"key": "scan", "op": "in", "value": ["sha256:" + "0" * 64]}]}),
        # SC-1 §2d (owner F-16): a member's screen on a UCT rating is listed, never run, and says why
        saved_screens.create(u["id"], "SAT Composite (rating)", {"filters": [{"key": "uct_composite", "op": "gte", "min": 80}],
                                                                  "sort": {"key": "rs_rank", "dir": "desc"}}),
    ]
    other = saved_screens.create(OTHER_MEMBER, "SAT other member's screen", {"filters": [{"key": "price", "op": "gte", "min": 1}]})
    return {"member_id": u["id"], "mine": [(s["id"], s["name"]) for s in mine], "other_id": other["id"]}


def measured(member_id: str | None) -> list[tuple[str, dict]]:
    """Run the REAL kinds and return their answers: SAT-1's expected values."""
    os.environ.setdefault("UCT_AGENT_DATA", "1")
    os.environ.setdefault("UCT_AGENT_SCAN", "1")
    from api.services.uct_agent.marketdata import gateway
    gateway._reset_for_test()
    uid = member_id or "sat1-measure"
    asks = [
        ("A1 default order (no sort asked: market cap, largest first)", "screen.run", {"spec": {"filters": []}, "limit": 10}),
        ("Float % >= 90", "screen.count", {"spec": {"filters": [{"key": "float_pct", "op": "gte", "min": 90}]}}),
        ("Semiconductors with vol_ratio >= 2", "screen.count", {"spec": {"filters": [
            {"key": "industry", "op": "in", "values": ["Semiconductors"]}, {"key": "vol_ratio", "op": "gte", "min": 2}]}}),
        ("price > 100000 (zero matches)", "screen.count", {"spec": {"filters": [{"key": "price", "op": "gt", "min": 100000}]}}),
    ]
    if member_id:
        asks.append(("your saved screens", "screen.saved", {}))
    out = []
    for i, (label, kind, params) in enumerate(asks):
        out.append((label, gateway.read(kind, params, user_id=uid, turn_id=f"sat1-measure-{i}", purpose="answer")))
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="SAT-1 synthetic screener universe for a LOCAL sandbox")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--scenario", choices=["fresh", "stale", "mixed", "empty"], default="fresh")
    ap.add_argument("--member-email", default=None, help="the sandbox admin to give saved screens (after signup)")
    a = ap.parse_args(argv)
    try:
        sys.stdout.reconfigure(encoding="utf-8")              # Windows consoles default to cp1252
    except (AttributeError, ValueError):
        pass
    data_dir = check_data_dir(a.data_dir)
    pin(data_dir)
    from api.services.screener import snapshot_db
    if os.path.dirname(os.path.abspath(snapshot_db.get_db_path())) != data_dir:
        _refuse(f"screener.db resolved to {snapshot_db.get_db_path()}, outside {data_dir}")
    snapshot_db.init_db()
    with snapshot_db.connect() as conn:                       # a scenario REPLACES the universe
        conn.execute("DELETE FROM screener_rows")
        conn.commit()
    n = snapshot_db.upsert_rows(rows(a.scenario))
    print(f"seeded scenario={a.scenario}: {n} synthetic rows into {snapshot_db.get_db_path()}")
    info = seed_screens(a.member_email) if a.member_email else None
    if info:
        print(f"saved screens for {a.member_email}: {info['mine']}")
        print(f"another member's screen id (must be REFUSED for you): {info['other_id']}")
    print("\nMEASURED by the real SC-1 kinds (these are SAT-1's expected answers):")
    for label, env in measured(info["member_id"] if info else None):
        d = env.get("data") or {}
        what = d["count"] if "count" in d else d["total_matches"] if "total_matches" in d else (len(d["screens"]) if "screens" in d else None)
        print(f"  {label:40s} status={env['status']:8s} answer={what!s:5s} as_of={env['as_of']} stale={env['stale']} "
              f"coverage={env['coverage']}")
        for note in env["notes"]:
            print(f"      note: {note}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
