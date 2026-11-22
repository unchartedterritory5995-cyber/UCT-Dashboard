# Capture queue: I6a-N4 an opener with no line at a block indent (2026-11-07)

Review note N4 (`W34-I6a`): master served a nested `switch` whose inner arms sit at indent 9 or 6,
and also `if` / `else` / `for` / `while` / top-level `switch` whose every line beneath is at an indent
that is not a multiple of four. Branch `fix/pine-i6a-n4-switch-indent` refuses them by name on both
lanes (`pine:indent`, `pine.js::refuseOffBlockIndent`).

What the manual states exactly ("Script structure", https://www.tradingview.com/pine-script-docs/language/script-structure/):
"A local block must be indented by a tab or four spaces."; "Generally, each wrapped line after the
first can use any indentation length _except_ multiples of four, because Pine uses four-space or tab
indentations to define local code blocks." ("Conditional structures": "The local blocks in
conditional structures must be indented by four spaces or a tab.") So those lines are wraps and the
opener has no block.

What it does NOT state: what TradingView then does with them (a compile error, as the `switch` / `if`
syntax implies, or some other reading). The rows below settle that. Until they are captured the
refusal stands, and it is not widened back to a serve.

| id | probe | symbol / tf | ours today | settles | owner |
|---|---|---|---|---|---|
| I6A-N4-0 | `i6a-n4-control-8.pine` (CONTROL) | `AMEX:SPY 1D` | serves | that the harness compiles a nested switch at block indents; if this fails, no other row is readable | I6a-N4 |
| I6A-N4-1a | `i6a-n4-switch-9.pine` | `AMEX:SPY 1D` | refused `pine:indent` | compile error (refusal right) or a value (compare N01 to the control: equal = TradingView reads indent 9 as a block, so the refusal over-refuses) | I6a-N4 |
| I6A-N4-1b | `i6a-n4-switch-6.pine` | `AMEX:SPY 1D` | refused `pine:indent` | as 1a, at indent 6 | I6a-N4 |
| I6A-N4-1c | `i6a-n4-if-6.pine` | `AMEX:SPY 1D` | refused `pine:indent` (master served it on both lanes) | as 1a, for an `if` body at indent 6 | I6a-N4 |
| I6A-N4-1d | `i6a-n4-if-tab2.pine` | `AMEX:SPY 1D` | refused `pine:indent` (one tab then two spaces, measured 6 by the lexer's tab-to-next-multiple-of-four rule) | as 1a, for a tab-led body that is not at a block indent; the manual does not say how a tab followed by spaces is counted | I6a-N4 |
| I6A-N4-2 | `i6a-n4-switch-12.pine` | `AMEX:SPY 1D` | serves, unchanged | whether two levels of indent (12 under a line at 4) is a block; compile error = an over-serve for a later lane | later lane |

Each probe is pasted ALONE: a Pine script compiles as a whole, so one invalid shape would hide the
others. Record `isFailed()` and the editor error (code, message, line, column) per
`docs/pine/capture-procedure.md`.

Not refused, and not owed a capture (published scripts TradingView compiles write them; an 877-script
census found no hit of the new check):
- a wrapped condition above a real block (`if a` / `      and b` / `        x := 1`);
- a function or arm whose value wraps at a non-block indent (`f(x) =>` / `      a ? b :` / `      c`);
- a deeper line at a multiple of four.
