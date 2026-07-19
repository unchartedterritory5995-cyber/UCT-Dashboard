"""Stage 3 batch review doc — machine-parseable, hard-fail on ambiguity."""
import re

from tools.theme_curation.proposals import pid

_MARK = re.compile(r"<!--\s*CURATION id=([^\s]+)\s*-->")
_BOX = re.compile(r"^- \[( |x|X)\] APPROVE", re.M)

# Cues that a DROP is being justified by a rename / duplicate / merger — exactly the
# case the LLM most often gets backwards (dropping the LIVE new ticker as a "duplicate"
# of the old one, e.g. FI treated as a dup of FISV). These NEVER auto-batch.
_RENAME_CUES = ("rename", "rebrand", "duplicate", "dup of", "dup.", "canonical",
                "ticker chang", "same as", "merged into", "merger", "absorbed")


def is_rename_drop(p) -> bool:
    """True for a DROP whose reason/rationale cites a rename/duplicate/merger. Such a
    drop must go to interactive review regardless of confidence — a live-but-renamed
    name (FI) can otherwise sail into the bulk-approve doc at high confidence."""
    if getattr(p, "action", None) != "drop":
        return False
    f = getattr(p, "fields", None) or {}
    text = f"{f.get('reason', '')} {f.get('rationale', '')}".lower()
    return any(cue in text for cue in _RENAME_CUES)


def route_for_review(props, threshold):
    """Split proposals into (batch, interactive). High-confidence proposals batch,
    EXCEPT rename-class DROPs (is_rename_drop) which always route to interactive."""
    batch, interactive = [], []
    for p in props:
        if p.confidence >= threshold and not is_rename_drop(p):
            batch.append(p)
        else:
            interactive.append(p)
    return batch, interactive


def write_review_md(props) -> str:
    lines = ["# Curation Review", "",
             "Flip `- [ ] APPROVE` to `- [x] APPROVE` to approve. Leave unchecked to reject.",
             "Do NOT delete the `<!-- CURATION -->` marker lines.", ""]
    for p in props:
        detail = ", ".join(f"{k}={v}" for k, v in p.fields.items())
        lines += [f"<!-- CURATION id={pid(p)} -->",
                  "- [ ] APPROVE",
                  f"  **{p.action.upper()} {p.sym}** (conf {p.confidence:.2f}) {detail}", ""]
    return "\n".join(lines) + "\n"


def parse_review_md(text: str) -> dict:
    out = {}
    marks = list(_MARK.finditer(text))
    for i, m in enumerate(marks):
        start = m.end()
        end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
        box = _BOX.search(text[start:end])
        if not box:
            raise ValueError(f"CURATION marker {m.group(1)!r} has no APPROVE checkbox")
        out[m.group(1)] = box.group(1).lower() == "x"
    return out
