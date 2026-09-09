# Render rules — the three R0 findings that must not quietly regress

Three things R0 established by measurement. Each is stated here as a **rule**, with the
**fixture that proved it** and the **test that enforces it**, because all three share a
property that makes them dangerous:

> ⛔ **Getting any of them wrong produces a chart that renders without complaint and looks
> deliberate.** No exception, no blank pane, no console warning. The only way to notice is to
> already know the right answer — which is exactly what a rule and a fixture are for.

R2 will touch every one of these. If a change here goes red, that is the rule working.

| # | Rule | Fixture | Enforced by |
|---|---|---|---|
| 1 | `size.*` → px is **per consumer** | `docs/pine/pine-presentation-spec.md` §4.2.5 / §4.3.1 | `engine/__tests__/textLayout.test.js` |
| 2 | Three colour constants **changed value at v6** | the spec's palette table + `reference/A/*.meta.json` | `engine/__tests__/versionRender.test.js` |
| 3 | A colorer int is **`0xTTBBGGRR`** | `reference/A/clouds-volume-spy-1d-250.csv` | `engine/__tests__/colorInt.test.js` |

---

## Rule 1 — `size.normal` is 12px on a label and 14px in a box or cell

**The same constant means different pixels in different places.**

| Consumer | auto | tiny | small | **normal** | large | huge |
|---|---|---|---|---|---|---|
| `label` | 0 | ~7 | ~10 | **12** | 18 | 24 |
| `box`, `table` | 0 | 8 | 10 | **14** | 20 | 36 |
| `plotshape`, `plotchar` | — | — | — | — | — | — |

`plotshape` and `plotchar` accept a `size.*` constant and map it to **no pixel value at all**.
`sizeToPx` throws for them rather than substituting the label table.

⛔ **A single shared table keyed only by the size name is wrong for one of the two consumers on
every render** — and wrong by two pixels, which is too small to catch in review and too large
to miss on a chart once you know.

⚠️ `size.auto` is `0` in the vendor table, which means "the renderer picks", not "0px". What
TradingView picks is **UNVERIFIED**. We resolve it to the consumer's `normal` and say so; a 0px
label is indistinguishable from a broken one.

**Do not retype this table.** `textLayout.test.js` parses it out of the spec paragraph that
warns the two "must not be crossed", with a control asserting six numbers were found per row,
and a further assertion that the two tables genuinely *disagree* — so a refactor into one
shared map fails loudly instead of silently.

## Rule 2 — three colour constants changed value at v6

| Constant | v1–v5 | v6 |
|---|---|---|
| `color.red` | `#FF5252` | `#F23645` |
| `color.teal` | `#00897B` | `#089981` |
| `color.yellow` | `#FFEB3B` | `#FDD835` |

**Every other one of the 17 is stable across every version that had `color.*` at all.**

⛔ A renderer that ignores the script's `//@version=` tag tints these wrong on every script
that uses them — and `color.teal` / `color.red` are the two most common colours in the corpus,
because they are the up/down pair.

⚠️ `color.blue` is `#2962ff` — **lowercase in the payload, and not `#2196F3`.** The Material
Blue value appears only in the user manual's prose; both the v5 and v6 payloads carry
`#2962ff`. Compare case-insensitively.

Three independent routes agree on the v6 values, which is why this is a rule and not a note:
1. the spec's own §4.2.5 palette table,
2. the live chart's candle colours, captured in `reference/A/*.meta.json` (`#089981` / `#F23645`),
3. Uncharted Clouds' own band colours, decoded from `reference/A/clouds-volume-spy-1d-250.csv`.

`versionRender.test.js` parses the palette from the spec **scoped to §4.2.5** — an unscoped
sweep matches the spec's *other* colour table (the v5→v6 comparison, whose first column is the
pre-v6 value) and silently agrees with the wrong one. It then cross-checks the three changes
against both that comparison table and `pine-version-evolution.md`, and requires them to agree.

## Rule 3 — a colorer integer is `0xTTBBGGRR`

A `colorer` plot emits a 32-bit **integer**, packed as transparency, then **blue, green, red**.

```
226597128  = 0x0D819908   ->  transparency 13,  #089981   (color.teal)
2253328008 = 0x864F0E88   ->  transparency 134, #880E4F   (color.maroon)
```

⛔ **Read as RGB, `0x0D819908` gives `#819908`** — a plausible olive that renders without
complaint and looks like a choice somebody made.

⭐ **The tell is the palette.** The correct byte order lands *exactly* on Pine palette
constants; the reversed order lands on nothing. `colorInt.test.js` asserts both halves over all
250 bars of the real capture — every decoded band colour **is** a palette constant, and under
the reversed reading **none** of them is. The second half is the control: without it, agreeing
with the palette would prove nothing if both orders happened to.

⚠️ **The high byte is TRANSPARENCY, not alpha, and they run in opposite directions.** Pine:
0 = opaque, 100 = invisible. CSS alpha: 1 = opaque, 0 = invisible. Feeding the byte into an
`rgba()` alpha slot inverts every fade in the script. `unpackColor` returns both, so no call
site has to remember which it holds.

`unpackColorRgbOrder` is exported **on purpose** — a rail needs to name the defect it guards
against, so the test can assert the two readings differ on real data rather than only that the
correct one is correct.

---

## Why these three and not others

R0 produced a lot of findings. These three are here because each one:

- **is invisible when wrong** — no error, no blank, no warning;
- **is load-bearing for R2**, which will build the label, fill and box renderers that consume
  all three; and
- **was corrected during R0 itself**, not assumed. Rule 3's byte order and the `vol_color`
  palette index were both recorded backwards first and fixed by measurement. That is the
  evidence that reading them off intuition does not work.

Anything else R0 learned lives with its module. These three are promoted because a regression
in them would be found by a user, not by us.
