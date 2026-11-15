# I2: thinkorswim weekly/monthly validation (manual capture procedure)

**Purpose.** Settle, with one independent reading from thinkorswim, what a thinkScript weekly or
monthly read means on a daily chart. It answers three questions:

1. Does a window over a weekly read (`Average(close(period=WEEK),10)`) average **weeks**?
2. On a **past** daily bar, does it show the week's **final** value, or the value as it stood on that
   day?
3. On the **current** week, does it move until the week closes?

**Status.** Until this capture is done and compared, UCT says weekly/monthly imports are "intended to
match thinkorswim; not yet confirmed against thinkorswim". It never says "exact".

Owner decision 2026-11-01: **basis F** (developing higher-timeframe bars). UCT's design assumes the
answers are (1) yes, (2) **final**, (3) yes. If the capture says otherwise, the basis is one constant
and changes before release.

> ⛔ **These are real market values. Keep them on your own machine.** Report only PASS/FAIL per row
> (and, for a FAIL, which question it answers) back to a Claude session. Never paste the numbers.

## Setup (once)

| Setting | Value |
|---|---|
| Platform | thinkorswim desktop, **Charts** tab |
| Symbol | **SPY** |
| Aggregation | **Day** (1D), time frame at least 1 year |
| Extended hours | **OFF** (Chart settings → Equities → uncheck "Show extended-hours trading session") |
| Dividend adjustment | **OFF** (Chart settings → General → uncheck "Adjust for dividends"; if your build names it differently, record what it says) |
| Price display | default (2 decimals) |

Create a custom study (Studies → Edit studies → Create…). Name it `UCT_I2_CHECK`, paste the code below
exactly, and apply it:

```thinkscript
declare lower;
plot W10 = Average(close(period = AggregationPeriod.WEEK), 10);
plot W1  = close(period = AggregationPeriod.WEEK)[1];
plot WH4 = Highest(high(period = AggregationPeriod.WEEK), 4);
plot M6  = Average(close(period = AggregationPeriod.MONTH), 6);
```

**Read values** from the crosshair data box (or right-click the bar → *Show data*) on the bar named in
each row. Record exactly what is shown, to 2 decimals.

## Part A: history (any time, completed periods)

| Row | Bar (daily) | Read | Record | Answers |
|---|---|---|---|---|
| A1 | Mon 2026-10-19 | W10 | | Q2: compare with A2/A3 |
| A2 | Wed 2026-10-21 | W10 | | Q2 |
| A3 | Fri 2026-10-23 | W10 | | Q2 |
| A4 | Mon 2026-10-19 | W1 | | `[1]` = previous WEEK's close (Fri 2026-10-16 close) |
| A5 | Fri 2026-10-23 | W1 | | same value as A4 expected |
| A6 | Wed 2026-10-21 | WH4 | | a 4-WEEK high |
| A7 | Wed 2026-10-14 | M6 | | Q2 for months: compare with A8 |
| A8 | Fri 2026-10-30 | M6 | | (last trading day of October) |
| A9 | Fri 2026-10-16 | close (price) | | reference for A4 |

**How to read Part A**
- **Q2 is FINAL** when A1 = A2 = A3 (and A7 = A8). That is UCT's basis-F design.
- **Q2 is AS-OF-THAT-DAY** when A1, A2 and A3 differ. Tell the Indicators session "Q2 = as-of": the
  basis changes before release.
- **A4 = A9** confirms `[1]` reads the previous **week**, not the previous day.

## Part B: the developing week (week of 2026-11-02)

| Row | When you read it | Bar | Read | Record |
|---|---|---|---|---|
| B1 | Wed 2026-11-04, during the session (note the time, ET) | Wed 11-04 | W10 | |
| B2 | Wed 2026-11-04, after 16:15 ET | Wed 11-04 | W10 | |
| B3 | Fri 2026-11-06, after 16:15 ET | Fri 11-06 | W10 | |
| B4 | Fri 2026-11-06, after 16:15 ET | **Wed 11-04** (re-read the past bar) | W10 | |

**How to read Part B**
- **Q3 is yes (it moves until the week closes)** when B1 ≠ B2 or B2 ≠ B3.
- **Past bars are rewritten to the final value** when B4 = B3, which is consistent with Q2 = FINAL.
  This is the "may repaint" behaviour UCT discloses.
- If B4 = B2 instead, past bars keep their as-of value. Report "B4 = B2".

## Comparing with UCT (after Workstream 1 is built)

1. Open the same symbol, daily, in a UCT environment that has the fix:
   - a local sandbox from the branch, or
   - production only after an authorized release.
2. Import the same four plots through **Create Indicator → Import** (thinkScript).
3. Read the same bars as Part A.
4. A row **PASSES** when the two values agree within **0.01**. Displayed rounding is 2 decimals; a
   provider's last-print difference can move a weekly close by a cent.
5. Report to the Indicators session **only**, in this form:

   `A1 PASS · A2 PASS · … · Q2=FINAL · Q3=yes · B4=B3`

   For a FAIL, give the row and which way it differs ("UCT higher" / "UCT lower"), never the values.

## What happens with the result

| Result | Consequence |
|---|---|
| All PASS and Q2 = FINAL | The language may change from "not yet confirmed" to "matched thinkorswim on the owner's capture of SPY, <date>". It is still never "exact" in general. |
| Q2 = as-of, or B4 = B2 | The basis is revised before any release. No saved definition is affected either way: imports are saved as plain formula text. |
| A4 ≠ A9 | `[n]` semantics are revised before release. |
| Values differ by more than 0.01 with every question answered as designed | Investigate the data source (dividends, prints) before any compatibility claim. |
