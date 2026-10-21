# Study landing redesign (Desk -> Courses)

Owner, 2026-10-20: "we are gonna need to redesign the landing page for this interactive learning
section. I want it to look cool and fun not lame like this." Plan and work live here and in git,
never in an artifact (owner rule).

## Before (captured 2026-10-20, `/desk?section=courses`)

A "Courses" title, one grey sub-line, a "Today's Study" card (eyebrow, title, one gold button,
"Up next on the trail", XP line) and two flat course cards with a hairline progress bar. Nothing
moves, nothing is drawn, nothing says "trading" except the words.

## Concept: the trail is a chart

The firm teaches people to read candles, so the landing IS a candle chart of the member's own
progress. The brand's own motifs carry it: gold on near-black, the compass mark, the "member sees
to here" marker from the review screen, the dashed journey path from the intro animation.

1. **Hero: your trail, drawn as a chart.** One candle per station of The UCT Method
   (Regime, Scan, Setup, Size, Manage, Review, Calls, Overlay). Body height = share of that
   station's units mastered. A mastered station is a solid gold candle; a started one is hollow
   gold; an untouched one is a dim outline. A dashed gold trail runs along the candle tops and
   keeps drawing (CSS dash animation, off under reduced motion). The recommended station carries
   the compass marker and the words "you are here". Right axis reads "mastered" instead of a
   price. Headline: "Study". Sub: "Ten questions a day. The whole method, one trail."
2. **The action card stays** (Today's Study: streak chip, week dots, ONE gold button, Up next, XP,
   rank). Simplicity rule from the spec is untouched: one primary button, one obvious next action.
3. **Stations deck.** The eight Method stations as tiles under the chart: name, a nine-rung ring,
   "m of n mastered", the recommended one pulsing. Tap opens the trail at that station's first
   unit (`?study=unit&unit=...`, the existing contract).
4. **Foundations deck.** The fifteen Foundations tracks as a horizontal strip of chips with rings.
   Same tap contract.
5. **Badges shelf.** Earned badges as gold-embossed icons with the date; before the first one a
   single line: "Your first badge comes with your first set." Badges are never removed (owner).
6. **The two course doors** keep their text contract (the CoursesSection test pins "COURSE",
   "N tracks · M units · K recorded lessons", "m of n mastered") and gain the chart's register:
   a cover band with the compass mark, the gold bar drawn as candles.

## Rules kept

- No locks on the map; the chart shows order, not permission.
- Gold means mastery, XP or the one primary action, nothing else.
- Tokens only (`--ut-gold`, `--bg*`, `--text*`, `--border*`); both theme states.
- Phone first at 390 px: hero chart full width at 200 px tall, the action card right under it,
  decks scroll horizontally; desktop: hero full width, then the 340 px action column with the decks
  and cards to its right (the existing `studyLayout` grid).
- Reduced motion: the trail does not animate, the marker does not float, the recommended tile does
  not pulse.
- Existing tests keep passing: `CoursesSection.test.jsx` (heading "Courses", the STUDY panel, the
  course cards' meta, Start today's Study, Practise, Up next), plus a new `StudyLanding.test.jsx`.

## Files

- `app/src/pages/study/StudyLanding.jsx` + `StudyLanding.module.css` (pure props: curricula,
  skill rows, today, profile, badges, callbacks; no fetch of its own).
- `app/src/pages/desk/CoursesSection.jsx` mounts it above the existing study layout when Study is
  on.

## Status

- 2026-10-20: plan written, v1 built on branch `feat/study-landing`, deployed for the owner to see.
