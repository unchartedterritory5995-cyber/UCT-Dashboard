// THE REWARD ECONOMY in one place (the 2026-11-02 review found XP numbers drifting between pieces). Every piece
// reads these; the Rewards tile prints them. Numbers are a proposal until the owner confirms them.
export const XP = {
  RIGHT: 10,            // a right answer
  COMBO_STEP: 5,        // added per step of a combo, from the second right in a row
  COMBO_CAP: 25,        // the combo bonus never exceeds this per answer
  PERFECT_LESSON: 30,   // every question right, no heart lost
  DAILY_SPEED_PER_2S: 1,// Daily Set: +1 per two seconds left on the clock
  BUY_PERFECT: 25,      // hit BUY on the trigger bar
  BUY_GOOD: 15,         // one bar late
  BUY_LATE: 5,          // later
  DRAW_PERFECT: 25,     // a drawn stop within 0.5% of the house stop
  DRAW_CLOSE: 12,       // within 1.5%
  BOSS: 150,            // the unit boss, ten for ten on one heart
  HARD_MULT: 2,         // hard mode multiplies every answer's XP
}
export const CROWNS = { ONE: 60, TWO: 80, THREE: 100 }   // accuracy % per level
export const DAILY_GOAL = 5                                // right answers in a day → the chest
export const DECAY_DAYS = 14                               // a crown cracks after this many idle days
export const RANKS = [['Rookie', 0], ['Apprentice', 250], ['Trader', 750], ['Pro', 1500], ['Mentor', 3000]]
export const BLITZ = { SECS: 60, MULT: (combo) => (combo >= 9 ? 5 : combo >= 6 ? 4 : combo >= 3 ? 3 : combo >= 1 ? 2 : 1) }
export const comboBonus = (combo) => Math.min(XP.COMBO_CAP, Math.max(0, combo - 1) * XP.COMBO_STEP)
export const rankFor = (xp) => RANKS.reduce((r, [, min], i) => (xp >= min ? i : r), 0)
