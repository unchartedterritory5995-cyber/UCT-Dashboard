# Study games: the catalogue and the build contract

Owner, 2026-11-08 (verbatim in `docs/study/audits/2026-10-24/owner_verdicts.jsonl`): he picked every proposed game
(*"Order Ticket + Size It, Vocab Match + True/False, Options Payoff + Earnings Desk, History Detective + Trade Story"*)
and asked for more: *"Anything that is really cool and fun and educational and valuable. be creative and awesome"*.
The live five (Blitz, Boss, Spot the Setup, Hard mode, Draw it) are all chart and setup games; these add the rest of
trading: orders, sizing, options, earnings, history, managing a trade, words, risk.

## 1. The rules every game keeps

1. **One design** (OWNER_PRINCIPLES rule 21, *"Need all the design templates and graphics to be uniform throughout
   each section!"*). A game is built ONLY from the Study kit Hard mode wears: `ui/StartLooks` `StartArena` (start
   screen, stakes, `HowItPlays`), `ui/HudLooks` (`HudCombo`, `HudClock`), `ui/AnswerLooks` `AnswerLessonApp` (question
   header + answer tiles), `ui/VerdictTakeover` (the answer takes over the screen, rule 15), `ui/EndLooks` `EndHard`
   (the end screen, level bar, trophies), `ui/StudyButton`, `ui/Tile`, `ui/study.module.css` (`kit`, `screen`,
   `heroChart`, `flash`). Read `challenges/BlitzChallenge.jsx` and `challenges/HardChallenge.jsx` first and copy their
   shape. New CSS only for what the kit truly lacks (a payoff diagram, a ticket form), in the game's own
   `*.module.css`, on the existing tokens (`var(--text)`, the gold, `--text-md`, ...), never new colours.
2. **Never wrong** (rule 6). Every number a game shows or scores is computed by tested code (a pure module next to
   the game), or comes from the bank (approved items, scored by `POST /api/study/attempts`). A game never invents a
   market fact. Its teaching lines name the rule they teach and where it comes from (the course unit, or our house
   rule in `docs/study/sizing_rule.md` / `docs/study/TRADE_PLANS.md`).
3. **Teach on every miss.** A wrong answer shows the right one AND the working ("Risk $500 / $2.00 a share = 250
   shares"), in the voice of `docs/study/VOICE.md`: short, plain, a mentor talking. Never "the firm".
4. **Fun.** A clock or hearts, a combo multiplier, a best score, the end screen's level bar and trophies. Keyboard:
   number keys pick answers, Enter checks. Works on a phone (`useIsPhone`, 44px taps, no horizontal scroll).
5. **XP.** A bank-backed answer earns XP through `scoreAttempt` (challengeBank). A computed game reports its run once
   at the end through `POST /api/study/game-runs` (below), which grants capped XP; then the end screen's level bar uses
   the response. Wrap it in `beginRunXp()` / `runXp()` the way Blitz does, or pass the response's `{before, after}`.
6. **Tests.** The pure module gets unit tests for every formula and generator (fixed seeds, known answers, the
   mistakes the distractors model). The component gets a vitest render test (start screen, one right answer, one
   wrong answer showing the working, the end screen) with the fetcher mocked. Run with `--maxWorkers=1`.
7. **Deterministic.** Generators take a seed (a number) and return the same run for the same seed; the component
   seeds from `Date.now()` once at start. No `Math.random()` inside the pure module.

## 2. The server doors games use

- `POST /api/study/attempts` (existing): score one bank item, returns `{correct, reveal, progress}`.
- `POST /api/study/sessions {kind: 'skill', skill_id, size}` (existing): a set of approved items from one skill
  (`challengeBank.fetchSkillSet`-style helpers).
- `POST /api/study/spot-setup` (existing): Hard mode / Spot the Setup's verified chart pool.
- **`POST /api/study/game-runs`** (new, 2026-11-08): `{kind, run_id, right, total}` → `{xp_gained, progress: {xp,
  level, xp_gained}, badges_new}`. XP = 2 per right answer, at most 30 per run and 150 per game kind per ET day;
  idempotent on `run_id` (a resend grants nothing). Only for computed games; bank items earn through attempts.
- **`POST /api/study/game-pool`** (new): `{kind: 'tf' | 'match', size}` → `{items}`. `tf`: approved true/false items
  (prompts only, scored through attempts). `match`: approved term + meaning pairs `[{id, term, meaning}]`.

## 3. The catalogue

| kind | game | the play | data | teaches |
|---|---|---|---|---|
| `size` | **Size It** | 60 seconds. Account, risk %, entry and stop: how many shares? Four choices: the right one and the classic mistakes (sized on the price not the stop distance, rounded up past the risk, a 10x slip, forgot the risk %). Multiplier like Blitz. | computed (`sizeIt.js`) | F9.02 stop first, then size; our risk range 0.25% to 2% |
| `ticket` | **Order Ticket** | 8 situations, 3 hearts. A short situation and a quote card; fill the ticket: side (buy, sell, sell short, buy to cover), type (market, limit, stop, stop-limit), price (three prices around the quote). All three right to score. | computed (`orderTicket.js`) from the order rules F10.01-F10.03 teach | which order does what, where it sits against the market |
| `payoff` | **Options Payoff** | 6 positions (long call, long put, short put, covered call, debit vertical, credit vertical). The stock's price at expiry: profit or loss? Four choices, built on two of the three classic slips (forgot the x100, left out the premium, the sign flipped), the pair seeded per position: the right amount, each slip alone, and both together (R, R/100, −R, −R/100; or R, R/100, P, P/100; or R, P, −R, −P, where P is the options part with the premium left out). The set is closed under its two slips, so every tile has the same partners and the pattern never points at the answer: only the math does. A pair whose four amounts would repeat or read $0 gives way to the next. Measured over 30,000 positions, no guess from the amounts alone beats about one in two, and a unit test holds that line. A miss names the slip, or both, with the numbers. Then the payoff line draws, breakeven marked. | computed (`optionsPayoff.js`) | F6.01-F6.03, F6.11-F6.13 |
| `greeks` | **Greeks Lab** | Sliders for days to expiry, implied volatility and stock price; the option's price and its delta, theta and vega update live. Five challenges ("make this call lose the most in one day", "which slider raised the put most"). | computed (Black-Scholes, no dividends, `greeksLab.js`) | F6.04-F6.08 |
| `survive` | **Survive the Drawdown** | Pick a risk per trade (0.5%, 1%, 2%, 5%, 10%). The same 50 trades play out (a 40% win rate, winners 2.5R, losers 1R): the account curve draws for your pick, then for every pick. Three questions after: what the stretch's longest losing streak takes at 10% a trade, compounded (at our 2% ceiling if you took 10%); how deep your own pick fell from its peak; which picks fell 50% or more. The end screen shows the same game played 10,000 times, every draw kept: how often each pick fell by half or more, finished below the start or finished highest, and the middle finish, on the promised bag (4 in 10) and on one a little worse (3 in 10, still +0.05R a trade), because nobody knows their real edge for sure. Over 10,000 deals no question's commonest answer covers more than 59% of runs (the 50% line's "10% only"; the streak's 24%, the depth's 20%), and no guess from the tiles alone does better. It used to ask which pick ended highest: on this bag (best growth at 16% a trade, above every pick) that was 10% about three runs in four, a lesson backwards. | computed (`survive.js`, seeded trade sequences; the 10,000-stretch counts pinned, recomputed by its test) | F9.01, F9.03, F9.04: why the risk per trade decides survival, and why our ceiling is 2% |
| `watchlist` | **Weekend Watchlist** | Eight real charts, the last candle each time. Pick the three where a setup really fired. Scored per pick; the reveal names each one and shows what happened next. | `POST /api/study/spot-setup` pool + look-alikes | reading setups like a Sunday scan |
| `story` | **Trade Story** | A real setup that fired, entered on its own plan. The replay plays forward and stops only where the plan makes a call: the stop, the house trims at 3R and 5R (a third at each, the account rulebook `sizing_rule.md` §9 B19 and E51; at 3R the stop on the rest moves up to breakeven, and from then a bar back at the entry is the **breakeven stop**, filled at the entry or at the open on a gap), the plan's own trail (from 5R, starting at breakeven), and the two trims the plans name (the owner, 2026-11-09, *"yes add those stops too"*): the Gap Support's **post-gap high** (the highest high from the detector's gap day through the entry day, found with the detector's own rules; the plan takes some off there; on the same bar as 3R or 5R it is one question that says both) and the High Volume Edge's **first return to the high-volume close** (after a close away from it, the first later session back at it before the stop). What the plan does at the first return is not ruled yet (`HVE_RETURN_CALL` in `tradeStory.js`): until it is, that stop asks, says the plan's words and its stop, and is neither right nor wrong (no XP, not in the log; the end screen says it was the member's call). Hold, sell a third, or sell the rest. Scored against the setup's own plan (TRADE_PLANS.md) and the account rulebook; the fraction is the rulebook's (a third at 3R, a third at 5R), never the game's. A trim level the day opens past fills at the open (F63); a gap through a stop fills at the open on the daily chart, and the why says the house 30-minute gap rule (B20). | the Hard pool + `study_trade` plans + the replay within the day | F10.05, managing a winner, our trim and trail rules (`sizing_rule.md` §9) |
| `tf` | **True or False** | 45 seconds of statements from every course; tap true or false. Streak multiplier. | `game-pool` kind `tf` (approved course items) | everything, fast |
| `match` | **Word Match** | Five words and five meanings; tap a word, then its meaning. Three rounds against the clock; misses cost time. | `game-pool` kind `match` | the vocabulary track |
| `mistake` | **Spot the Mistake** | A short trade journal entry or plan, four lines; one line breaks a rule. Tap it. | approved course items (F8, F9, F12 scenario units tagged for it) | discipline and process |
| `daily` | **Daily Chart** | Three charts a day, the same for every member; one go; a result line to share. | approved chart items, picked by the ET day | a daily habit |
| `history` | **History Detective** | An index chart of a real market fall, dates hidden. Which fall is it, how deep, how long to the low? | index bars + sourced events (F7) | F7.02-F7.04 |
| `sectors` | **Sector Race** | The eleven sector funds over a real past month, names hidden behind their charts. Pick the leader. | sector fund bars | group strength before stock |
| `earnings` | **Earnings Desk** | A real quarter: earnings and revenue against the estimates. Beat, miss or in line? Then what the stock did next. | frozen real quarters | F5.01-F5.07 |

Build order: the computed games first (`size`, `ticket`, `payoff`, `greeks`, `survive`), then the pool games on
existing data (`watchlist`, `story`), then the ones that fill as the courses are approved (`tf`, `match`, `mistake`,
`daily`), then the ones that need new data (`history`, `sectors`, `earnings`).

## 4. Where a game's files go

`app/src/pages/study/challenges/<Name>Game.jsx` (the component, default export, props `{profile, fetcher, onClose,
signedOut}` like Blitz), `<Name>Game.test.jsx`, the pure module `app/src/pages/study/challenges/games/<name>.js` with
`<name>.test.js`, and an optional `<Name>Game.module.css`. The component also exports
`export const GAME = {kind, title, sub, icon, plate, accent}` (icon: a `UIcon` name; accent: one of the landing's
existing accents) so the Challenges deck and `ChallengeSheet` register it from one place.
