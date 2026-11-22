// THE REPLAY CLOCK (2026-11-08): while a day of the run-on grows through its 30-minute (or hourly) closes, the session
// and the time of the close just drawn sit at the top of the chart, centred (clear of the ticker and the brand), so the member reads WHEN in the day the
// candle is ("tick by tick so each day has multiuple ticks ... to show how everyday moved"). Steady text, no motion
// (the owner: "i dont like that the text bounces a bit"); gone when the day is whole.
import { closeClock } from '../challenges/replayTicks'
import s from './study.module.css'

export default function ReplayClock({ clock, tfMin = 30, testId = 'replay-clock' }) {
  if (!clock) return null
  return (
    <div className={s.replayClock} data-testid={testId} aria-live="off">
      <span className={s.replayDay}>Day {clock.session}</span>
      <b>{closeClock(clock.t, tfMin, clock.next)}</b>
    </div>
  )
}
