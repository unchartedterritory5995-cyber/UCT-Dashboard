"""READ-ONLY on the web pod: what the brain says about the cycle of price action and Chart IQ's named bar events.

Third read after pod_kb_levels.py and pod_kb_rules.py (2026-11-06). Bank v2 now drafts two Chart IQ question families
(scripts/study/bank_v2/gen_chartiq.py): the six stages of the cycle of price action and seventeen named bar events. Their
lessons state Chart IQ's rules; the owner asked that the brain inform them too ("our VAST KNOWLEDGE AND SKILL AND BRAIN").
This prints, per stage and per event, every active knowledge-base passage that names it, by priority, each cut to 500
characters around the first mention, at most 25 per name. Opens the database read-only, writes nothing.

  ! powershell -File <scratchpad>/run_pod_py.ps1 -Script C:/Users/pgosz/uct-worktrees/study-hve-overlay/docs/study/levels/pod_kb_cycle.py
"""
import json
import os
import sqlite3

NAMES = {
    "cycle of price action": ["cycle of price action", "price action cycle"],
    "Reversal extension": ["reversal extension"],
    "Wedge pop": ["wedge pop"],
    "EMA crossback": ["ema crossback", "crossback"],
    "Base n' break": ["base n' break", "base n break", "base and break", "base-n-break"],
    "Exhaustion extension": ["exhaustion extension"],
    "Wedge drop": ["wedge drop"],
    "UnR": ["undercut and rally", "undercut & rally", "u&r", " unr "],   # a bare "unr" matches "unrealized"
    "Pocket pivot": ["pocket pivot"],
    "HVC": ["high volume close", "hvc"],
    "MA remount": ["ma remount", "remount"],
    "20EMA tap": ["20ema tap", "20 ema tap", "tap of the 20", "20-day ema tap"],
    "Inside bar break": ["inside bar", "inside day"],
    "Range breakout": ["range breakout"],
    "Hammer at support": ["hammer"],
    "Outside reversal": ["outside reversal", "outside day"],
    "Reversal off highs": ["reversal off highs", "shooting star"],
    "Bearish engulfing": ["bearish engulfing"],
    "Gap up / Gap down": ["gap up", "gap down"],
}
CAP, CUT = 25, 500


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
    for name, aliases in NAMES.items():
        like = " OR ".join(["lower(title) LIKE ? OR lower(content) LIKE ?"] * len(aliases))
        args = [x for al in aliases for x in (f"%{al}%",) * 2]
        rows = c.execute(
            f"SELECT id, category, title, content, trader, source_ref, priority FROM knowledge_base "
            f"WHERE (active IS NULL OR active=1) AND ({like}) ORDER BY priority DESC, id LIMIT 200", args).fetchall()
        keep = []
        for r in rows:
            text = r["content"] or ""
            low = text.lower()
            at = min((low.find(al) for al in aliases if low.find(al) >= 0), default=0)
            start = max(0, at - 120)
            keep.append({"id": r["id"], "cat": r["category"], "trader": r["trader"], "ref": r["source_ref"],
                         "title": (r["title"] or "")[:120], "text": ("..." if start else "") + text[start:start + CUT]})
        out[name] = {"matches": len(rows), "passages": keep[:CAP]}
    print(json.dumps(out, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
