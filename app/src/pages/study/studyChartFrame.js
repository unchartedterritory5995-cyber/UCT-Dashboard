// THE LESSON CHART'S FRAME (the Study real-screen check, 2026-11-14): how much blank room the answered chart keeps right
// of its last bar, how wide its plot is for spacing the trade marks' words, and how wide a slot its date labels get.
// Pure numbers for DrillPlayer, kept apart so the rails can read them without mounting the player.

/** The plot's width in px, the chart box (334 px on a 390 px phone, 720 on a desktop) less the price scale. */
export const plotWidthPx = (phone) => (phone ? 258 : 640)

/** The blank room to the right of the last bar once the answer is in (StockChart frameRightPadFrac), a share of the
 *  frame's bars. The bar the replay just landed keeps its mark's word clear of the price scale (STOPPED and BOUGHT were
 *  cut on the last bar): half a word, about 30 px, which is 0.12 of a phone's 258 px plot. A desktop's tags also carry
 *  the levels' names (tradeMarks.tradeLevelLines), about 50 px, which 0.1 of its 640 px plot leaves clear of the bars. */
export function revealRightPad(phone) {
  return phone ? 0.12 : 0.1
}

/** The date axis's label slot, in characters (StockChart tickLabelChars), for a frame of `slots` bars (the bars shown and
 *  the blank room after them). The library keeps its date labels at least a slot apart (its 11 px font gives 9.375 px a
 *  character, eight by default) and lays them greedily, so the axis reads evenly only when that distance in sessions sits
 *  clear of a month's length (19 to 23 sessions): 12 to 19 sessions puts a label on every month with no room for a day
 *  between two, 24 to 38 on every other month, 46 to 60 on every quarter. The default eight characters put a desktop
 *  replay of about 170 days at 20 sessions, so a 19-session February lost its mark and a "4" stood in for March (the
 *  screen check). The widest slot (eight characters down to five, the length of "Mar 4") that lands in the finest band; a
 *  frame that fits none keeps the library's own. */
export const TICK_BANDS = [[12, 19], [24, 38], [46, 60]]
/** An intraday chart's label slot (the 2026-11-16 screen check: after a five-minute chart's replay, a phone's axis read
 *  only "Sep 14" and "Sep 15", because an eight-character slot is 75 px and a phone's whole plot is 258). Its labels are
 *  at most "Sep 15", "10 AM" or "10:30" (studyTickMarkFormatter drops the AM/PM on a half hour), so five characters, 47
 *  px, fit them and leave room for the times between the days. */
export const INTRADAY_TICK_CHARS = 5
export const PX_PER_TICK_CHAR = 9.375          // the library's (11 px + 4) x 5 / 8
export function tickLabelCharsFor(phone, slots) {
  if (!(slots > 0)) return null
  const spacing = plotWidthPx(phone) / slots
  for (const [lo, hi] of TICK_BANDS) {
    for (let chars = 8; chars >= 5; chars -= 1) {
      const sessions = Math.ceil((PX_PER_TICK_CHAR * chars) / spacing)
      if (sessions >= lo && sessions <= hi) return chars
    }
  }
  return null
}
