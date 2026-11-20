# Capture queue: Q-CF (constant folding precision) and Q-STN2 (`str.tonumber` blanks), 2026-11-20

Filed for coordinator patrick-2b by the builtins engine unit. Queue order (coordinator, 2026-11-20): right after
Q-REQ10, ahead of Q-REQ5, because this rule could touch the last bit of many scripts. Every probe runs with its
inputs at their defaults. A line that does not compile is a reading: record the error text and the line, remove
only that row, and capture the rest. Captures are read after the close.

Probe sha256 (first 16 hex) is listed with each row's probe in `tools/visual_conformance/probes/`.

## CF: what TradingView's folded constant is

Witness so far: `vw-bt-toradians-spy-1d-2026-11-16` D3 (`x * (math.pi / 180)`) is bit-exact on 8,508 / 8,508
bars only if TradingView's `math.pi / 180` is 0.0174532925199433. That is the IEEE quotient
0.017453292519943295 kept to 16 significant digits, one ulp above it. The alternatives all fail:

- the IEEE constant, or the nearest double to the true pi/180: 51 bars;
- `(x * pi) / 180`: 148;
- `x / (180 / pi)`: 2;
- pi as a 15-digit literal: 0;
- an FMA: 0.

E3 (`y * (180 / math.pi)`) grades MATCH on every bar, and that constant already needs only 16 digits. So the
hypothesis is: a folded constant whose double needs 17 significant digits to round-trip loses its last bit. Our
engine folds in IEEE on both lanes. Nothing is built until this grades.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-CF-a | `vw-cf-const-fold.pine` (a5f161ba1370586d) | AMEX:SPY 1D from the listing | no | every row on every bar (K*, R*, D*, B11, X1, X2) | the precision of a folded constant (`math.pi / 180`, `0.1 + 0.2`, `1 / 7 * 3`, `math.e / 7` the control), and where folding happens: a `float` binding, an `input.float` default, a `var`, a const inside a series expression, a 17-digit literal |
| Q-CF-b | the same | NYSE:RDDT 1D from the listing | no | the same | the same on a second symbol (X1 / X2 move with the bars; the K / D rows must not) |

## STN2: `str.tonumber` around and inside the number

Graded: `vw-bi-str-tonumber-spy-1d-2026-11-19`, all 21 rows on every bar. " 3" and "3 " are 3, and the exponent
spellings are `na`. STR-TONUMBER (engine 90) serves exactly that: the spaces around the text are dropped. A tab,
a line break or another blank at either end stops the run by name until this grades.

| id | probe | chart | live | what to record | unblocks |
|---|---|---|---|---|---|
| Q-STN2 | `vw-bi-str-tonumber-2.pine` (e573e28da8e58ad0) | AMEX:SPY 1D, >= 50 bars | no | every row (one value each) | `str.tonumber` of text with a tab, a line break or a no-break space at either end (served by name as a stop today); two spaces each side; an inner space, sign and point edges, a full-width digit, "-0" |
