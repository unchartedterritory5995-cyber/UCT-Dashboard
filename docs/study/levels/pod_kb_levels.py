"""READ-ONLY on the web pod: what the brain already knows about trading the seven Hard-mode setups.

The owner, 2026-11-06, on the entry / stop / sell rules still waiting on him: "We will have to work through the entire
brain system knowledge base content examples pattern rec internet avilable information and studies and everything to
further inform and enhance the question and answers and explanations and examples". The brain pack lives on the pod
(<DATA_DIR>/brain/data/uct_intelligence.db, installed nightly from the owner's machine); this prints, per setup:

  * knowledge_base passages that name the setup (its aliases) AND talk about entries, stops, trims, targets, adds or
    exits (title, trader, source_ref, the passage cut to 600 characters);
  * model_examples for the setup: entry, stop, target, outcome, days held, grade, the failure analysis;
  * setup_performance rows (win rate, average gain / loss, expectancy by regime phase);
  * the setup_templates row's trade fields (entry_triggers, stop_methods, max_stop_pct, profit_logic, addon_rules,
    invalidation, hold_time_range, common_mistakes).

Opens the database read-only (mode=ro), writes nothing, prints one JSON document. Run from the owner's terminal:
  ! powershell -File <scratchpad>/run_pod_py.ps1 -Script C:/Users/pgosz/uct-worktrees/study-hve-overlay/docs/study/levels/pod_kb_levels.py
"""
import json
import os
import re
import sqlite3

SETUPS = {
    "Kicker": ["kicker"],
    "Oops Reversal": ["oops", "gap down reversal", "red to green", "red-to-green"],
    "Gap Support": ["gap support", "bull gap", "open gap", "gap & hold", "gap and hold", "gap hold"],
    "High Volume Edge": ["high volume edge", "hve", "hvc", "high volume close", "highest volume"],
    "Slingshot": ["slingshot", "4-day average of the highs", "4 day ema of the highs", "ema of highs", "ema(high"],
    "Launchpad": ["launchpad", "launch pad"],
    "Bear gap": ["bear gap", "gap down off the high", "breakaway gap down", "first gap down"],
}
TRADE = re.compile(r"\b(entry|enter|entries|buy point|stop|stops|trim|trims|sell|sells|target|targets|exit|exits|add|adds|"
                   r"add-on|trail|trailing|risk|ORB|opening range|R multiple|size|sizing|scale)\b", re.I)
PER_SETUP = 15   # passages per setup (the output lands in the conversation; keep it readable)


def brain_db() -> str:
    data_dir = os.environ.get("DATA_DIR", "/data")
    for p in (os.environ.get("BRAIN_DIR"), os.path.join(data_dir, "brain")):
        if p and os.path.exists(os.path.join(p, "data", "uct_intelligence.db")):
            return os.path.join(p, "data", "uct_intelligence.db")
    raise SystemExit("no brain pack installed on this pod")


def main() -> None:
    db = brain_db()
    c = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    out = {"db": db, "kb_rows": c.execute("SELECT COUNT(*) FROM knowledge_base").fetchone()[0], "setups": {}}
    for setup, aliases in SETUPS.items():
        like = " OR ".join(["lower(title) LIKE ? OR lower(content) LIKE ? OR lower(tags) LIKE ?"] * len(aliases))
        args = [a for al in aliases for a in (f"%{al}%",) * 3]
        rows = c.execute(f"SELECT id, category, title, content, trader, source_ref, priority FROM knowledge_base "
                         f"WHERE (active IS NULL OR active=1) AND ({like}) ORDER BY priority DESC, id", args).fetchall()
        kb = [{"id": r["id"], "category": r["category"], "title": r["title"], "trader": r["trader"],
               "source_ref": r["source_ref"], "text": (r["content"] or "")[:600]}
              for r in rows if TRADE.search(r["content"] or "")]
        ex_like = " OR ".join(["lower(setup_type) LIKE ?"] * len(aliases))
        examples = [dict(r) for r in c.execute(
            f"SELECT setup_type, symbol, chart_date, grade, example_type, entry_price, stop_price, target_price, outcome_pct, "
            f"days_held, substr(coalesce(failure_analysis,''),1,250) AS failure_analysis, substr(coalesce(notes,''),1,150) AS notes "
            f"FROM model_examples WHERE {ex_like} ORDER BY chart_date DESC LIMIT 15", [f"%{a}%" for a in aliases]).fetchall()]
        perf = [dict(r) for r in c.execute(
            f"SELECT * FROM setup_performance WHERE {ex_like.replace('setup_type', 'setup_type')}", [f"%{a}%" for a in aliases]).fetchall()]
        tpl = c.execute("SELECT name, entry_triggers, stop_methods, max_stop_pct, profit_logic, addon_rules, invalidation, "
                        "hold_time_range, common_mistakes FROM setup_templates WHERE " +
                        " OR ".join(["lower(name) LIKE ? OR lower(aliases) LIKE ?"] * len(aliases)),
                        [a for al in aliases for a in (f"%{al}%",) * 2]).fetchall()
        out["setups"][setup] = {"kb_matches": len(kb), "kb": kb[:PER_SETUP], "model_examples": examples,
                                "setup_performance": perf, "templates": [dict(t) for t in tpl]}
    print(json.dumps(out, ensure_ascii=False, indent=1, default=str))


if __name__ == "__main__":
    main()
