# A2: a named argument on a served built-in takes its declared position (engine NUMBER PENDING)

This is coordinator's order item 7, A2: named arguments on served built-ins, mapped by Pine's own parameter names
(`color.new(color, transp)`, `array.new_<t>(size, initial_value)`), following the review-L3 precedent
(`ta.sma(source =, length =)`).

## The reference

The parameter names come from the Pine v6 reference's own syntax lines. They were read from the local extraction of
TradingView's reference data (`docs/pine/pine-reference-extraction.md`):

| built-in | syntax line |
|---|---|
| `color.new` | `color.new(color, transp)` |
| `color.rgb` | `color.rgb(red, green, blue, transp)` |
| `color.from_gradient` | `color.from_gradient(value, bottom_value, top_value, bottom_color, top_color)` |
| `array.new_float` (and `_int`, `_bool`, `_string`, `_color`, …) | `array.new_float(size, initial_value)` |
| `array.new<type>` | `array.new<type>(size, initial_value)` |

## What changed (`pineRuntimeFrontend.js::argsInReferenceOrder`)

The runtime lane refused every named argument on these built-ins, as `runtime:statement` ("a named argument `size` on
`array.new_float`"). Now positional arguments fill from the left and a named argument goes to its parameter, so the
call is exactly the positional call.

The refusal by name stands, unchanged, for:

- a name the reference does not list;
- a parameter given twice;
- a positional argument after a named one;
- a parameter skipped before one that is given (no default is invented here);
- the object door.

## Rails and mutants

`runtime/__tests__/namedBuiltinArgs.test.js` checks that each named call has the same IR and the same values, bar for
bar, as its positional call:

- `color.new` with both names, in either order, and with a positional colour plus a named `transp`;
- `color.rgb` with all four names;
- `array.new_float(size =, initial_value =)`;
- `array.new<float>(initial_value =, size =)`;
- `array.new_int(size =)`.

It also checks the four refusals by name.

Mutants P1-P6 are in `ci/mutants/a2-named-builtin-args.json`. Each was made on a saved copy, watched turn its rail red,
and then restored from that copy and confirmed byte-equal.

## Blast radius (the 679-script coverage-map sample, every wall peeled, under the heavy lock)

Measured with master (engine 81) and this branch over the same tree. 5 scripts move:

- **Two now build at step 0 on the runtime lane.** Both are already drawn MATCH by the host lane, or graded MATCH on
  both lanes:
  - `committed:optimized-keltner-channels-sltp-strategy-for-btc`: its captures grade MATCH on both lanes;
  - `reference:fxn-week-and-day-separator`: host-clean.
- **Three are still refused at the same first wall.** Their `runtime:statement` (named argument) walls give way to the
  next walls by name:
  - `committed:camarilla`;
  - `committed:session-tpo-profile`;
  - `committed:volume-delta-oi-delta-kioseff-trading`.

  These match the sketch's "unblocks camarilla and session-tpo-profile once their other units land (it frees none
  alone)".

## A3, sized and not built

`math.min` / `math.max` with more than two arguments are already served on both lanes. `pine.js::variadicFold`
left-folds them over the two-argument form, and the reference reads `math.max(number0, number1, ...)`, "Returns the
greatest of multiple values".

What remains is v1-v4's bare `min` / `max` with more than two arguments. Both lanes refuse it as `pine:arity`, because
this engine's `PINE_CALL_SHAPES` declares Pine's own v1-v4 signature with 2 arguments. Changing that needs the v4
reference's own signature for `min` / `max`. The extraction recipe failed for `--version 4` on 2026-11-19
(`t.t is not a function` at step 6). The change itself is size S: add `min` / `max` to the v1-v4 fold, behind the
signature.
