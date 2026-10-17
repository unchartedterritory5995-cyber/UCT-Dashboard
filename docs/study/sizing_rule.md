# The house sizing rule (single authority for Study)

**Status:** Phase 0 draft for owner sign-off (2026-10-17). From the owner's workshop answers
(spec §4.11) plus the owner's own published rules (Sunday Scans, 2026-06-14 and 2026-07-19,
quoted below). `gen_size.py` reads this file; the toolkit's printed sizing-gate card is regenerated
from it; `houseSizing.json` becomes a cap layer the Method mentions once.

## 1. Risk per trade

- **0.25% to 2% of the account**, chosen by setup quality, your recent performance, market
  conditions and your edge. **2% is the hard ceiling.** Under 1% is normal.
- **Flat-risk sizing** (the same percent on every trade) is taught as a valid alternative, not a
  mistake. Both are in the curriculum; the member chooses one and writes it in the plan.
- Owner's own number, quoted: *"I almost never take a loss greater than 3%."* (position loss, not
  account risk; taught as "where the owner's stops sit", see §2).

## 2. Stop first

1. **Default stop: the low of the day, or the prior day's low.** (Owner's answer.)
2. **Supporting methods:** the structure (pivot area, pullback low, the base low) and ATR.
3. **Sequence is law:** stop first, distance second, size last. You never pick a size and back-fit
   a stop inside the noise. (Toolkit sizing gate.)
4. **If the honest stop does not fit the risk budget: skip. Never tighten the stop.** (Toolkit
   problem #10.)
5. A stop cannot catch an overnight gap: a tight stop never licenses a monster position.
   (Toolkit problem #9.)

## 3. Size from the stop

- **Position % = risk % ÷ stop distance %.** Then Position $ = Position % × account; Shares =
  Position $ ÷ entry, **rounded down**.
- Worked: 1% risk, 5% stop → 20% position. 1% risk, 10% stop → 10% position. 0.5% risk, 1% stop →
  50% position, which the ceiling (§4) then caps.
- The reverse is drilled too: given a size and a stop, what is the risk? (Owner: "if it's a 1% stop
  then technically a 50% size would be 0.5% risk.")
- **Trade SHARES.** (Owner.) Options are a defined-risk substitute taught in F6, never the default.

## 4. Ceilings and the drawdown ladder

- Max position size is a **cap layer**, not the lesson. The app's table (`houseSizing.json`):
  GREEN A+ 25 / A 20 / B 10 · YELLOW 15 / 12 / 6 · ORANGE 8 / 5 / 0 · RED 0. The Method mentions it
  once as "the firm's cap by market condition and grade".
- **Owner's own drawdown ladder, quoted (2026-07-19):** *"I lowered my max sizing to 5% down from
  10% which is down from 20%. After a 6% drawdown I immediately reduce to 10% max. After an 8%
  drawdown I reduce to 8% max. And after 10% drawdown I reduce to 5% max."*
  → Taught as the firm's drawdown protocol: **normal max 20% · after −6% → 10% max · after −8% →
  8% max · after −10% → 5% max.** ⚑ Owner to confirm these as the house numbers (the dossier's
  M13 says "−5% halve, −10% pilot-only"; the owner's published ladder is more specific).

## 5. Portfolio layer

- **Total open risk (heat) ≤ 10% of the account.** (App cap.)
- **5 to 10 positions** for a momentum swing book. Concentration over diversification.
- **Progressive exposure:** pilot → half → full, add only after the last step paid.
- **Correlation:** five positions in one theme count as one trade; sector concentration flagged
  at 40% (the heat tool's rule).

## 6. Management (so the sizing drills can go full circle)

- *"Hold your winners by selling partials into strength and trailing the rising moving averages."*
  (Owner, 2026-06-14.) The firm's trail: the 10/20-day for episodic pivots (dossier CORRECTIONS);
  named traders' variants appear only in questions that name the trader.
- Breakeven rule: the point after which a trade must never again become a loser (dossier M10).
- Base re-entry rule: cut at least half if the stock falls back into its base.

## 7. What the drills generate from this file

- `size` items: forward (shares and $ at risk), reverse (risk from size and stop), ceiling-capped,
  skip cases, flat-risk vs quality-scaled, drawdown-ladder cases ("you are −7% from peak, A+ setup,
  what is your max size?").
- `manage.math` items: open R after partials, breakeven stop moves, R still at risk.
- Every answer is computed by the formula in §3 with the caps in §4 and §5; the reveal shows the
  arithmetic.

## 8. Open for the owner

1. Confirm the drawdown ladder numbers in §4 as the house protocol.
2. Confirm "under 1% is normal" as the default risk the drills assume when the question does not
   state one.
3. Confirm the 3% "position loss" line as a taught guideline, not a rule.
