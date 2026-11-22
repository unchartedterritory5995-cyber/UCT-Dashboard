# Study — the production programme (owner: "let's do it all", 2026-11-02)

The whole list the owner approved, in build order, with the quality bar every piece is held to. Each item lands
in the local workbench as a piece in a batch of five, is scored 0-100 by the owner with words, and the words are
stored verbatim in `docs/study/audits/2026-10-24/owner_verdicts.jsonl`. Nothing ships to members until the owner
says the whole thing is done. No runtime AI. No model ever writes a market fact: every number is measured from
the firm's own bars, every rule is the owner's words.

## The quality bar (applies to every piece)

- **Brand.** The site's gold (`--ut-gold`), its candle green `#2faf68` and red `#df4646`, OLED black, the site's
  type (Instrument Sans). No borrowed palettes. The chart is always the real Chart widget (ChartPane).
- **Pointer.** One pointer everywhere: gold arrow, chip label in capitals, halo (`lab/pointers.js spot()`).
- **Motion.** One easing (`cubic-bezier(.2,.9,.3,1)`), three durations (120 / 260 / 480 ms), one direction for
  screen changes (new screen slides in from the right). Nothing bounces unless it is a celebration.
- **Sound.** One sound map (`lab/sfx.js`): right, wrong, combo, level up, chest, streak, tick. Soft, short, can be
  muted. Voice lines are the owner's recordings only; the player shows a caption and is silent when no file exists.
- **Copy.** Short, in the owner's voice, no hedging, one idea per line. Setup names in capitals in captions.
- **Phone.** Every piece checked at 390 px wide; buttons inside one screen; no horizontal scroll.
- **Honesty.** Placeholder names, scores and leaderboards are labelled as placeholders until real data exists.

## Round 8 — the production pass (pieces 36-40)

36. **The coach, sound and voice.** A drawn SVG coach built from the compass mark with moods (idle, thinking,
    pleased, wincing, on fire), used in every bubble and sheet. The sound map. The voice-line player with captions
    (owner records the lines; list in `docs/study/VOICE_LINES.md`).
37. **Live-reveal: hit BUY.** The Kicker day plays tick by tick from the 30-minute bars; the member must hit BUY
    the moment price crosses the previous day's high. Early is wrong, on the bar is perfect, one bar late is good,
    later is late. Reaction time is scored.
38. **Daily Set + leaderboard.** Five charts, the same for every member each day, a day leaderboard and the
    member's rank. Timer per question optional.
39. **Lesson intro, transitions, wrong-answer side by side.** An intro screen per lesson (glyph, time, Start); one
    slide transition between every screen; on a miss, the candle you picked and the right one on two small widgets.
40. **Profile.** Setups mastered, accuracy per setup, best run, charts seen, a practice heat map, crown decay
    (a cracked crown after two idle weeks asks for a review), the weekly league card.

## Round 9 — the challenge modes (pieces 41-45)

41. **Timed Blitz.** Sixty seconds, hearts off, name as many setups as you can, multiplier climbs with the combo.
42. **Boss lesson.** Ten charts, one heart, the unit trophy only on a pass; a failure screen that says what to review.
43. **Hard mode.** Ticker hidden, averages hidden, candles only; a legendary fourth crown for a perfect run.
44. **Draw-it.** The member draws the stop or the trigger line with the widget's own drawing tools; graded by the
    distance from the house level.
45. **Spot-the-trap.** Three candidates pulse; one is the setup, two are look-alikes the owner has ruled out.

## Round 10 — teaching depth and social (pieces 46-50)

46. **Guidebook per unit.** The owner's rules in his words, one page, with the glyph art, readable before a lesson.
47. **Sell rules unit.** Written with the owner (trim, trail, exit); the Manage chapter of the story points here.
48. **Share card.** The lesson result on the chart with the brand mark, as an image to post.
49. **League results + friend streaks.** Sunday night promotion / relegation screen; a shared streak for two
    members; a Discord post through the existing bot when a setup badge is earned.
50. **Replay-the-week.** Friday night: the week's real charts from the firm's scans, name the setups that fired.

## Cross-cutting, done alongside

- Multi-timeframe reveal on every answer (the 30-minute opens under the daily).
- Mastery rhythm per setup: story replay, learn, practice, boss.
- Loading states that never show a blank chart; an offline message.
- Phone pass on every piece; haptics on right / wrong / combo.
- The reward economy (XP, combo, perfect bonus, crowns, chest, streak, badge, league) as proposed in round 7,
  numbers to be confirmed by the owner.
