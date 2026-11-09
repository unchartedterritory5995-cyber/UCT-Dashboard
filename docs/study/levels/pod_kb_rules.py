"""READ-ONLY on the web pod: the brain's RULE-BEARING passages for the seven Hard-mode setups, Manrav's first.

Second pass after pod_kb_levels.py (2026-11-06), which found the in-house source of the setup names: Manrav, the group's
trader who trades "Launchpad, Slingshot, HVC edge, and Oops" daily, whose dated teaching notes sit in the knowledge base
(category SETUP). This prints, per setup, every active passage that names the setup (its aliases) and states a trade
rule (entry, stop, trim, sell, target, add, trail, risk, size), from the categories that carry rules (SETUP, RULE,
EXECUTION, CASE_STUDY, PLAYBOOK, PRINCIPLE), Manrav's first, then by priority, each cut to 500 characters, at most 45 per
setup. Opens the database read-only, writes nothing.

  ! powershell -File <scratchpad>/run_pod_py.ps1 -Script C:/Users/pgosz/uct-worktrees/study-hve-overlay/docs/study/levels/pod_kb_rules.py
"""
import json
import os
import re
import sqlite3

SETUPS = {
    "Kicker": ["kicker"],
    "Oops Reversal": ["oops"],
    "Gap Support": ["gap support", "bull gap", "open gap", "gap hold", "gap & hold", "gap and hold"],
    "High Volume Edge": ["high volume edge", "hve", "hvc"],
    "Slingshot": ["slingshot"],
    "Launchpad": ["launchpad", "launch pad"],
    "Bear gap": ["bear gap", "gap down off", "bearish gap", "breakaway gap"],
}
RULE_CATS = ("SETUP", "RULE", "EXECUTION", "CASE_STUDY", "PLAYBOOK", "PRINCIPLE", "RISK", "LESSON")
TRADE = re.compile(r"\b(entry|enter|entered|buy point|buy it|stop|stops|stopped|trim|trimmed|sell|sold|target|exit|add|added|"
                   r"trail|trailing|risk|R multiple|size|sizing|opening range|ORB|low of (?:the )?day|LOD|prior day'?s low|"
                   r"break ?even)\b", re.I)
CAP, CUT = 45, 500


def brain_db() -> str:
    data_dir = os.environ.get("DATA_DIR", "/data")
    for p in (os.environ.get("BRAIN_DIR"), os.path.join(data_dir, "brain")):
        if p and os.path.exists(os.path.join(p, "data", "uct_intelligence.db")):
            return os.path.join(p, "data", "uct_intelligence.db")
    raise SystemExit("no brain pack installed on this pod")


def main() -> None:
    c = sqlite3.connect(f"file:{brain_db()}?mode=ro", uri=True)
    c.row_factory = sqlite3.Row
    out = {}
    for setup, aliases in SETUPS.items():
        like = " OR ".join(["lower(title) LIKE ? OR lower(content) LIKE ?"] * len(aliases))
        args = [a for al in aliases for a in (f"%{al}%",) * 2]
        cats = ",".join("?" * len(RULE_CATS))
        rows = c.execute(
            f"SELECT id, category, title, content, trader, source_ref, priority FROM knowledge_base "
            f"WHERE (active IS NULL OR active=1) AND upper(category) IN ({cats}) AND ({like}) "
            f"ORDER BY (lower(coalesce(trader,''))='manrav') DESC, priority DESC, id",
            [*RULE_CATS, *args]).fetchall()
        keep = []
        for r in rows:
            text = r["content"] or ""
            if not TRADE.search(text):
                continue
            # cut around the first mention of the setup, so the rule about it is in the 500 characters
            low = text.lower()
            at = min((low.find(a) for a in aliases if low.find(a) >= 0), default=0)
            start = max(0, at - 120)
            keep.append({"id": r["id"], "cat": r["category"], "trader": r["trader"], "ref": r["source_ref"],
                         "title": (r["title"] or "")[:120], "text": ("..." if start else "") + text[start:start + CUT]})
        out[setup] = {"matches": len(keep), "passages": keep[:CAP]}
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
