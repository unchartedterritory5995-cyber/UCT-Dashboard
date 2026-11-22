"""W9-T3b: `range_guard.py`, the deterministic rewrite that confines a strategy's ORDERS to a window.

    python tools/vendor_harness/range_guard.py rewrite SRC OUT --from-ms X --to-ms Y
    python tools/vendor_harness/range_guard.py window CAPTURE.json --lookback L [--forming]

docs/pine/W9-STRATEGY-DESIGN.md 5.1 / T3b: method (b) grades a strategy on a window [X, Y) that both
sides hold, with every order call gated on `time >= X and time < Y`. A grading variant of a corpus
script is that script with the guard added by THIS file and nothing else changed.

What the rewrite does, per order call (a statement that starts a line):
  * a call that names `when = <expr>` (Pine v4/v5) gets `when = (<expr>) and time >= X and time < Y`;
  * any other call is wrapped:  `if time >= X and time < Y` and the call, indented four more spaces.
    The enclosing `if` is never edited, so state updates beside the order keep running outside the
    window (only the ORDER is confined).
Everything else in the file is byte-identical. A trailer comment records the source sha256 and window.

Refused BY NAME (never a guess): `range_guard:no-order-calls` (a source with nothing to guard),
`range_guard:order-call-in-expression` (a call that does not start its line), `range_guard:code-after-order-call`,
`range_guard:another-window` (the source already carries a guard for different X, Y), `range_guard:bad-window`.

ONE AUTHORITY per value: the order-call set is `STRATEGY_ORDER_CALLS` in `ast/pine.js`, PARSED here, not
copied. `strategy.risk.*` are configuration calls (they take no `when`, are not orders and run every
bar), so they are excluded by that prefix, by name.

Idempotent: a call that is already guarded for the same window is left alone, and the trailer keeps the
ORIGINAL source's sha. The format of the guard is read back by `strategy_capture.mjs::guardsIn`.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
PINE_JS = REPO / "app" / "src" / "components" / "chart" / "engine" / "ast" / "pine.js"
RISK_PREFIX = "strategy.risk."
TRAILER_RX = re.compile(r"^// range_guard: .*$")
GUARD_ANY_RX = re.compile(r"\btime\s*>=\s*(\d+)\s+and\s+time\s*<\s*(\d+)")
CALL_RX = re.compile(r"(?<![\w.])(strategy\.[A-Za-z_][\w.]*)\s*\(")


class RangeGuardRefused(Exception):
    def __init__(self, name: str, detail: str):
        super().__init__(f"{name}: {detail}")
        self.name = name
        self.detail = detail


def guard_text(x: int, y: int) -> str:
    return f"time >= {x} and time < {y}"


def order_calls(pine_js: pathlib.Path = PINE_JS) -> frozenset:
    """STRATEGY_ORDER_CALLS parsed from pine.js, minus the `strategy.risk.*` configuration calls."""
    text = pine_js.read_text(encoding="utf-8")
    m = re.search(r"export const STRATEGY_ORDER_CALLS\s*=\s*Object\.freeze\(new Set\(\[(.*?)\]\)\)", text, re.S)
    if not m:
        raise RangeGuardRefused("range_guard:order-set-unreadable", f"STRATEGY_ORDER_CALLS not found in {pine_js}")
    names = re.findall(r"'([^']+)'", m.group(1))
    out = frozenset(n for n in names if not n.startswith(RISK_PREFIX))
    if not out:
        raise RangeGuardRefused("range_guard:order-set-unreadable", "STRATEGY_ORDER_CALLS held no order call")
    return out


def blank(source: str) -> str:
    """`source` with comment text and string contents replaced by spaces: same length, same newlines."""
    out = list(source)
    i, n = 0, len(source)
    while i < n:
        ch = source[i]
        if ch == "/" and source[i + 1:i + 2] == "/":
            while i < n and source[i] != "\n":
                if source[i] != "\r":
                    out[i] = " "
                i += 1
            continue
        if ch in "\"'":
            q = ch
            i += 1
            while i < n and source[i] != q and source[i] != "\n":
                if source[i] == "\\" and i + 1 < n:
                    out[i] = " "
                    i += 1
                out[i] = " "
                i += 1
            i += 1
            continue
        i += 1
    return "".join(out)


def _match_paren(code: str, open_idx: int) -> int:
    depth = 0
    for k in range(open_idx, len(code)):
        if code[k] == "(":
            depth += 1
        elif code[k] == ")":
            depth -= 1
            if depth == 0:
                return k
    raise RangeGuardRefused("range_guard:unbalanced", f"no closing parenthesis for the call at offset {open_idx}")


def _split_top(code: str, start: int, end: int) -> list:
    """(start, end) spans of the top-level arguments between code[start:end] (exclusive of the parens)."""
    spans, depth, s = [], 0, start
    for k in range(start, end):
        c = code[k]
        if c in "([":
            depth += 1
        elif c in ")]":
            depth -= 1
        elif c == "," and depth == 0:
            spans.append((s, k))
            s = k + 1
    spans.append((s, end))
    return spans


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def rewrite(source: str, x: int, y: int, calls: frozenset | None = None) -> tuple[str, dict]:
    """Return (guarded source, report). Raises RangeGuardRefused, by name."""
    if not (isinstance(x, int) and isinstance(y, int) and 0 < x < y):
        raise RangeGuardRefused("range_guard:bad-window", f"need integer 0 < X < Y (epoch ms), got {x!r}, {y!r}")
    calls = calls if calls is not None else order_calls()
    guard = guard_text(x, y)

    original_sha = None
    stem = source[:-1] if source.endswith("\n") else source
    head, sep, last = stem.rpartition("\n")
    if TRAILER_RX.match(last.rstrip("\r")):
        m = re.search(r"sourceSha256=([0-9a-f]{64})", last)
        original_sha = m.group(1) if m else None
        source = head + sep            # the text before the trailer, newline kept, byte for byte
    original_sha = original_sha or sha256(source)

    code = blank(source)
    for gm in GUARD_ANY_RX.finditer(code):
        if (int(gm.group(1)), int(gm.group(2))) != (x, y):
            raise RangeGuardRefused("range_guard:another-window", f"the source already guards {gm.group(0)!r}, not {guard!r}")

    line_starts = [0]
    for m in re.finditer(r"\n", source):
        line_starts.append(m.end())

    def line_of(idx: int) -> int:
        lo, hi = 0, len(line_starts) - 1
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if line_starts[mid] <= idx:
                lo = mid
            else:
                hi = mid - 1
        return lo

    src_lines = source.split("\n")
    found = []
    for m in CALL_RX.finditer(code):
        if m.group(1) in calls:
            found.append(m)
    if not found:
        raise RangeGuardRefused("range_guard:no-order-calls", "the source has no strategy order call to guard")

    edits = []        # (start, end, replacement) over `source`
    report = {"calls": len(found), "wrapped": 0, "whenEdited": 0, "alreadyGuarded": 0}
    for m in found:
        name = m.group(1)
        i = m.start(1)
        open_idx = m.end() - 1
        close_idx = _match_paren(code, open_idx)
        l0, l1 = line_of(i), line_of(close_idx)
        ls = line_starts[l0]
        if code[ls:i].strip():
            raise RangeGuardRefused("range_guard:order-call-in-expression", f"line {l0 + 1}: `{name}` does not start its statement")
        eol = source.find("\n", close_idx)
        eol = len(source) if eol < 0 else eol
        if code[close_idx + 1:eol].strip():
            raise RangeGuardRefused("range_guard:code-after-order-call", f"line {l1 + 1}: code follows the closing parenthesis of `{name}`")
        indent = re.match(r"[ \t]*", src_lines[l0]).group(0)

        when = None
        for a, b in _split_top(code, open_idx + 1, close_idx):
            wm = re.match(r"\s*when\s*=(?!=)", code[a:b])
            if wm:
                when = (a + wm.end(), b)
        if when is not None:
            expr = source[when[0]:when[1]]
            if expr.strip().endswith(" and " + guard) or expr.strip().endswith("and " + guard):
                report["alreadyGuarded"] += 1
                continue
            lead = re.match(r"\s*", expr).group(0)
            trail = re.search(r"\s*$", expr).group(0)
            edits.append((when[0], when[1], f"{lead}({expr.strip()}) and {guard}{trail}"))
            report["whenEdited"] += 1
            continue

        prev = src_lines[l0 - 1] if l0 > 0 else ""
        prev_indent = re.match(r"[ \t]*", prev).group(0)
        if prev.strip() == f"if {guard}" and len(prev_indent) + 4 == len(indent):
            report["alreadyGuarded"] += 1
            continue
        end_line_end = source.find("\n", close_idx)
        end_line_end = len(source) if end_line_end < 0 else end_line_end
        block = source[ls:end_line_end]
        cr = "\r" if block.endswith("\r") else ""
        body = "\n".join(("    " + ln if ln.strip() else ln) for ln in block.split("\n"))
        edits.append((ls, end_line_end, f"{indent}if {guard}{cr}\n{body}"))
        report["wrapped"] += 1

    out = source
    for s, e, r in sorted(edits, key=lambda t: t[0], reverse=True):
        out = out[:s] + r + out[e:]
    nl = "\r\n" if "\r\n" in out else "\n"
    if not out.endswith("\n"):
        out += nl
    out += f"// range_guard: sourceSha256={original_sha} window={x}..{y} calls={len(found)}{nl}"
    report.update(sourceSha256=original_sha, x=x, y=y, variantSha256=sha256(out))
    return out, report


# ── the window, from TradingView's own bars ───────────────────────────────────────

def window_from_bars(rows: list, lookback: int, newest_forming: bool, factor: int = 5) -> dict:
    """The grading-variant window of 5.1: X = TradingView's first bar + factor x lookback bars, Y just
    after the last CLOSED bar. `rows` are the capture's bar rows (time in epoch seconds first)."""
    if not (isinstance(lookback, int) and lookback > 0):
        raise RangeGuardRefused("range_guard:bad-window", f"lookback must be a positive integer, got {lookback!r}")
    n = len(rows)
    last = n - 2 if newest_forming else n - 1
    if last <= factor * lookback:
        raise RangeGuardRefused("range_guard:bad-window",
                                f"{n} bars cannot hold a {factor}x{lookback} warm-up and a graded span")
    from_t = int(rows[factor * lookback][0])
    to_t = int(rows[last][0]) + 1
    return {"fromTime": from_t, "toTime": to_t, "warmupBars": factor * lookback,
            "x": from_t * 1000, "y": to_t * 1000}


_INT_ARG_RX = re.compile(r"(?<![\w.])(?:ta\.[a-z_]+|sma|ema|rma|wma|vwma|hma|alma|atr|rsi|highest|lowest|stdev|swma|sar)\s*\(([^()]*)\)")
_INPUT_RX = re.compile(r"\binput(?:\.int)?\s*\(\s*(?:defval\s*=\s*)?(\d+)")


def longest_lookback(source: str, cap: int = 1000) -> int:
    """A PROXY (5.1 / section 7 of the design): the longest integer in `ta.*` and moving-average calls and
    in `input(...)` defaults, capped. The CLI takes an explicit `--lookback` that overrides it."""
    code = blank(source)
    best = 1
    for m in _INT_ARG_RX.finditer(code):
        for t in re.findall(r"(?<![\w.])(\d+)(?![\w.])", m.group(1)):
            if int(t) <= cap:
                best = max(best, int(t))
    for m in _INPUT_RX.finditer(code):
        if int(m.group(1)) <= cap:
            best = max(best, int(m.group(1)))
    return best


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    rw = sub.add_parser("rewrite")
    rw.add_argument("src")
    rw.add_argument("out")
    rw.add_argument("--from-ms", type=int, required=True)
    rw.add_argument("--to-ms", type=int, required=True)
    wi = sub.add_parser("window")
    wi.add_argument("capture")
    wi.add_argument("--lookback", type=int, required=True)
    wi.add_argument("--forming", action="store_true", help="the newest bar is still forming")
    a = ap.parse_args(argv)
    try:
        if a.cmd == "rewrite":
            text = pathlib.Path(a.src).read_text(encoding="utf-8")
            out, rep = rewrite(text, a.from_ms, a.to_ms)
            pathlib.Path(a.out).write_text(out, encoding="utf-8", newline="")
            print(json.dumps(rep))
        else:
            cap = json.loads(pathlib.Path(a.capture).read_text(encoding="utf-8"))
            print(json.dumps(window_from_bars(cap["bars"]["rows"], a.lookback, a.forming)))
    except RangeGuardRefused as exc:
        print(f"REFUSED {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
