"""Stage 3 interactive review — writes each decision immediately (resumable)."""
from tools.theme_curation.proposals import pid


def review_interactive(props, ledger, input_fn=input, out_fn=print) -> None:
    for p in props:
        if ledger.is_decided(p.theme_id, p.sym, p.action):
            continue
        detail = ", ".join(f"{k}={v}" for k, v in p.fields.items())
        out_fn(f"[{p.theme_id}] {p.action.upper()} {p.sym} (conf {p.confidence:.2f}) {detail}")
        ans = (input_fn("  [a]pprove / [r]eject / [s]kip: ") or "").strip().lower()
        if ans == "a":
            ledger.record(p.theme_id, p.sym, p.action, "approve", p.fields)
        elif ans == "r":
            ledger.record(p.theme_id, p.sym, p.action, "reject", p.fields)
        # 's' (or anything else) records nothing -> re-appears next run
