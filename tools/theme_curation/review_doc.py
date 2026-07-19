"""Stage 3 batch review doc — machine-parseable, hard-fail on ambiguity."""
import re

from tools.theme_curation.proposals import pid

_MARK = re.compile(r"<!--\s*CURATION id=([^\s]+)\s*-->")
_BOX = re.compile(r"^- \[( |x|X)\] APPROVE", re.M)


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
