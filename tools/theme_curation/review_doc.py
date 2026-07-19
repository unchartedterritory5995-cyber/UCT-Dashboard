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
    blocks = text.split("<!-- CURATION")
    for b in blocks[1:]:
        m = _MARK.search("<!-- CURATION" + b)
        if not m:
            # No valid `id=<pid>` marker => this is prose that merely mentions the
            # comment token (e.g. the writer's own "Do NOT delete the
            # `<!-- CURATION -->` marker lines" instruction), NOT a proposal block.
            # A real proposal marker always carries id=<pid>, so this can never
            # skip an actual decision.
            continue
        box = _BOX.search(b)
        if not box:
            # A real marker block that we cannot parse (missing checkbox) HARD-FAILS
            # -- never default-to-approved, never silently skip. This is the safety
            # gate before the destructive reseed.
            raise ValueError(f"unparseable review block: {b[:80]!r}")
        out[m.group(1)] = box.group(1).lower() == "x"
    return out
