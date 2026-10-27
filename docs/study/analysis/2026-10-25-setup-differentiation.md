# Setup differentiation: what the owner's 26-chart Slingshot review, and the five reviews before it, actually teach

Date: 2026-10-25. Source material: the 23 owner rulings in `docs/study/corrections/spot.fixtures.jsonl`
(2026-10-18 to 2026-10-25) and the 181-line verdict log `docs/study/audits/2026-10-24/owner_verdicts.jsonl`,
covering Kicker Candle (4 passes), Oops Reversal (3), Launchpad (4), High Volume Edge (3) and Slingshot (2).
Everything below is inferred from those words and the measured facts on the charts he graded; nothing is a
model's market opinion. Where a number is quoted it was measured on the pod from the bars the owner saw.

## 1. The one thing all five reviews have in common

The owner does not grade a pattern. He grades a **situation**: who is trapped, what the stock had already done,
and what the day looked like against that. Every cut across 90-odd charts falls into one of four buckets:

| bucket | what he said | setups it hit |
|---|---|---|
| **wrong neighbour** | "plainly just an earnings gapper", "just a breakout", "just HVC and PEGs", "a bear-market bounce" | Kicker, Launchpad, HVE, Slingshot |
| **wrong context** | "wouldn't be on my radar with that nasty red day", "gap against an intermediate downtrend", "a bounce under a falling 200" | Oops, Kicker, Slingshot pass 1 |
| **not pretty** | "sloppy", "messy", "too dramatic, looks news driven", "they can look prettier", "subtle and hidden" | Kicker, Oops, Launchpad, Slingshot |
| **wrong universe** | "idk what the heck SIBN is", "lame regional bank", a $7 stock, thin names | all |

So the education system has to teach **the neighbour and the context**, not only the trigger geometry. A member
who can tell a Kicker from a breakout, an HVE from a high-volume close, a Launchpad from a pullback breakout,
and the Slingshot trigger from the gap day that preceded it, has learned what the owner knows. The spot drills
("does X fire on the last bar?") cannot teach that on their own, because every one of those confusions fires the
detector. That is the gap this pass closes.

## 2. The mental model behind each setup, and its measurable signature

### Kicker Candle: the trapped seller

- **Idea**: one weak red day makes sellers commit near the lows of a base; the next day's gap reverses them.
- **Context first**: the stock is *already* set up (an uptrend or a clean base). "ETON is the best because it is
  technically already giving a good setup." Not a recovery into the 200-day (SMH, a C-).
- **The red day is the whole setup**: a real body (kept examples 1.3 to 5.8% of price), closing weak near its
  low (DCR at or under 0.35), at or under the recent lows of the base. "Sellers need to be trapped, so there needs
  to be like an almost failed breakdown vs just a little baby red candle." The breakouts he cut had near-doji red
  days under 0.3%. Opening above the prior high does **not** separate kickers from breakouts; the prior body does.
- **The kicker day**: a decent gap (JBI 4.9%), a strong green close near the high (95% of range), usually a volume
  surge, often clearing the 20-day high. Not a crash before it (TH's 9% red bar was "too dramatic").
- **Rarely earnings**: an earnings-day gap is an earnings gapper by default.
- **Models**: JBI 2023-12-14 (picture perfect), AMD 2023-12-07 ("the ultimate elite example"), HOOD, PSN, GS, BMRN, RBRK.

### Oops Reversal: the trapped breakdown seller, at the right address

- **Idea**: the open takes out the prior day (close or low), the breakdown sellers commit, the close reverses them.
- **Three named versions**: scanner (open below prior close, low below prior low, close above prior close),
  Williams (opens below the prior LOW), Super (closes above the prior HIGH, engulfing the day).
- **Location is the main thing**: "see how it steadily flags and drifts into a buyable spot the days prior." The
  end of an orderly drift lower, a flag, a wedge down, a double bottom, the end of a downtrend. Score the days before.
- **Orderly before, technical on the day**: no news gap the day before (that is a "delayed reaction setup"), no
  outsized red bar in the prior 5-7 sessions (range under ~2.5x ATR, drop under ~4%), the Oops day itself not
  news-sized (under ~3x ATR). Soft preference for a red prior day. Prefer visually clear examples.
- **Afterwards**: the Oops-day low never breaks; quick follow-through preferred (score the first five sessions).
- **Models**: ORIC, SHOP 2026-09-28 ("a prime example"), CCJ ("pretty confident we have the system good"), LLY,
  TEAM 2023-12-08 (an Oops on a Launchpad trigger: "great confluence").

### Launchpad: the coil under the bundle

- **Idea**: after a real correction the averages converge and price lives *under* them in a flat base; the
  launch is the first bar above everything as they stack.
- **The signature that re-anchored pass 3 on MSTR**: closes below the 8/21/50 bundle on most of the prior 40
  sessions, price under the bundle 20 sessions before the trigger, the 50 flat, the 200 at or just under the chunk.
  The cuts (TAN, MARA, SONO, JD) had the opposite: price above the bundle about half the time, rallying *up into*
  it and breaking out. That is a base breakout, and "some of these will crossover with BaseBreakouts and that is fine",
  but it is not what the Launchpad teaches.
- **The dangle**: "I like when they dangle and retest the launchpad a bit." The best triggers are still inside the
  base (WDAY): the Launchpad is the convergence and the dangle, not a breakout bar.
- **The launch bar closes above EVERY average, the 200 included** (WSM and ADSK cut). The full stack is not required
  beforehand; it forms as the launch happens ("as the MAs stack and get into trend alignment with the 9 > 20 > 50").
- **Models**: MSTR 2023-10-23 (the template), TEAM, WDAY, BIDU, IBKR, EXE, LI.

### High Volume Edge: the new story, marked as a level

- **Three things that look alike**: HVC (any high-volume close, leaves a level), PEG (an earnings gap on big but
  ordinary volume), HVE (a volume day that **dwarfs** everything before it, 10x+ normal, above the prior record).
- **Where it lives**: "usually on some lesser known stocks", the start of a new story. Mega-caps on a 3x day are
  HVCs. Earnings days count only when the volume is truly massive (FSLY 2026-02-12, 27x, "100% A+").
- **What it is for**: the close is a level to mark. "They can go below the HVC that's fine." So the must-work rule
  does not apply, and the HVE chart carries a ray from that close and an AVWAP from that day.
- **Never**: OPEX (third Friday) and month-end sessions. Days that close in the lower part of a huge range (TVTX, DYN).
- **Models**: NAVN 2026-03-26 ("perfect"), MRNA 2026-08-19, RUM, FSLY, WVE 2024-10-16.

### Slingshot: the first pause after the drive

- **Idea**: strength first (an earnings gapper, or a strong rally), then the first pullback under the 4-day EMA of
  the highs, then the first close back over it. "Meant to be used to enter PEGs mostly, but not exclusively."
- **Why the 4-EMA of highs matters**: the owner asked for it on every chart "so we can see exactly where and when the
  slingshot triggered and why." The line IS the lesson: the pullback is the closes under it, the trigger is the first
  close back over it. The gap day or rally day itself is never the trigger.
- **The measured signature of his six "perfect / beautiful / A+" charts** (VRT, NFLX, NVDA, SOFI, PLTR, SMCI):

  | fact | the six greats | the three cuts |
  |---|---|---|
  | drive | 5 of 6 an earnings-style gap (+11 to +29% days) | COIN a rally only |
  | pullback length | 3 to 7 sessions | 3 to 6 |
  | pullback depth | 5.6 to 11.7% | 7.1 to 11.2% |
  | pullback whole range | 1.0 to 1.6 ATR (orderly) | TCOM 1.85 |
  | worst red body in the pullback | 0.9 to 3.3% | 2.4 to 3.0% |
  | trigger day | +3.2 to +5.8%, closes at 78-99% of range | COIN closed at 72% |
  | trigger gap | under 1.2% (two of six gapped down) | TCOM 2.7%, COIN 2.0% |
  | trigger volume | 0.9 to 1.4x normal | 1.3 to 1.6x |
  | follow-through | never within 2.6% of the trigger low; +6 to +21% in five days | DUOL flat by day 20, TCOM undercut |

  What separates the goods from the greats is **drama**: APP (+13% on 2.4x volume after a 2.6-ATR, 12% pullback)
  and PAAS (+11% on 2.9x) were "good" and "okay"; the greats are quiet, technical triggers. What separates the
  cuts is **a gap on the trigger day** (TCOM, COIN), **no earnings drive** (COIN: "good but I don't want to keep
  this"), and **no follow-through** (DUOL).
- **Not required**: the 200-day overhead (HAE triggered under a falling 200 off a long downtrend, "I like this one").
- **Universe**: FIGS, a $7 stock, was cut on price alone; CBZ and INTA on thinness.
- **Models**: SMCI 2023-05-16 ("A+, perfect example"), VRT ("Perfect"), PLTR ("Beautiful"), NVDA ("very good").

## 3. The confusion matrix the drills must cover

| looks like | is actually | the tell, in his words |
|---|---|---|
| Kicker | earnings gapper (PEG) | "this is plainly just an earnings gapper"; the kicker is positioning, rarely earnings |
| Kicker | breakout | "a baby red candle traps nobody"; the prior red body is the tell |
| Kicker | gap against a downtrend | "technically it's a gap versus intermediate downtrend instead of a kicker" |
| Oops | delayed reaction to news | "the previous day was a big gapper, this is more of a delayed reaction setup" |
| Oops | off the radar | "that big red day so nasty a few days prior" |
| Launchpad | base / pullback breakout | "price rallied up into the bundle"; the Launchpad lives under it first |
| Launchpad | not the launch | "I want it above the MAs" (closes under the 200, or inside the chunk) |
| HVE | HVC | "most of these are just HVC"; 3x on a mega-cap is a high-volume close |
| HVE | PEG | "again, just a PEG"; an earnings gap on ordinary volume |
| HVE | OPEX / month-end | mechanical volume |
| Slingshot | the gap day | "an earnings gap does not count" as the trigger |
| Slingshot | a news day | +11-13% on 2.4-2.9x volume graded down |
| Slingshot | a bear-market bounce | TEAM / HAS pass-1 cuts, under a falling 200 and rolled over |
| any setup | wrong stock | thin, obscure, sub-$10, "lame regional bank" |

## 4. What changed in the system today

1. **Lesson definitions** (`scripts/study/gen_setup_examples.py` SETUPS): the five definitions now carry the
   rulings above in the owner's words (context, the neighbour it is not, the after-rule). Every new setup example
   inherits them, and the live items were refreshed on the pod with `apply .../refresh_setup_lessons_pod.py`
   (the measured fact line and the "Owner's note" on each approved item are kept verbatim).
2. **Slingshot fact line**: the reveal now states the pullback length and depth, the trigger day's gain, its close
   position and its gap, so the member reads the same numbers the gallery was graded on.
3. **Slingshot finder** (`scripts/study/find_slingshot_examples.py`): the gallery score v3 encodes the signature
   in §2 (earnings-drive weight, orderly pullback, decisive-but-technical trigger, no gap, no drama), a "pretty"
   gate, a $10 price floor, the 200-day gate removed (HAE), and must-work tightened to the greats (never within 2%
   of the trigger low, +3% in five sessions). Re-scored against the 26 graded charts: all six greats pass, every cut
   fails, and the "they can look prettier" okays fail. Ready for a pass-3 scan when more Slingshots are wanted.
4. **Contrast drills** (`scripts/study/gen_contrasts.py` -> `docs/study/bank/recall.contrasts.json`): 20 recall
   items, one per row of the confusion matrix, each answer a sentence the owner ruled on, each reveal citing the
   ruling. Imported as drafts for the owner's review like everything else.
5. **Proposed, pending owner OK** (he reviews every word a member reads):
   - `setupCatalog.js` card essences (the three he already asked to reword, plus Kicker and Slingshot):
     - Launchpad: "After a correction the 8/21/50 chunk into a tight bundle near the 200 and price lives under it in
       a flat base; the launch is the first close above every average as they stack."
     - High Volume Edge: "An up day on volume that dwarfs everything before it, often on a lesser-known name; the
       close is a level to mark. Not an HVC, not a PEG."
     - Oops Reversal: "Opens below the prior close, trades under the prior low, closes back above the prior close,
       at the end of an orderly drift into a buyable spot. Williams: opens under the low. Super: closes over the high."
     - Kicker Candle: "A weak red day that looks like a failed breakdown out of a base, then a gap up that follows
       through and closes above its high: the sellers are trapped. Rarely earnings."
     - Slingshot: "An earnings gapper or strong rally, a tight pullback under the 4-EMA of the highs, then the first
       close back over it. The gap day is never the trigger."
   - Playbooks (`setupPlaybooks.js`) for Kicker, Oops, Slingshot and HVE in the Launchpad format (intro, context,
     criteria, trigger, stop, exit, mistakes), written from the rulings; the setups page shows a placeholder today.
6. **For the detector owner** (the firm's pattern engine, not touched here): uct_kicker fires without a green
   close and without a red prior day; uct_hve fires on down closes and on OPEX/month-end; uct_slingshot's S5
   (close above the 50) and the 190-session warm-up mean the owner's template charts can be invisible to it
   (NAVN for HVE, MSTR for Launchpad). The study finders scan on the owner definition with the detector as a gate
   where it helps and without it where it hides the template.

## 5. Open questions for the owner

- Launchpad confluence (TEAM: an Oops on the launch day) and Slingshot-after-PEG are two cases where one chart is
  two setups by design. Today an item carries one skill. A "confluence" tag on the item (two skills, one chart) would
  let the drill ask "which TWO setups fire here?".
- The pass-1 Slingshot survivors XOM and PANW are "okay" by his words, but "they can look prettier". If the gallery
  should be only perfect / beautiful, both can be retired with a one-line verdict.
- Gap Support and Go Signal still carry detector definitions with "owner ruling pending" in their lessons.
