// app/src/data/deviceStore/forming.js — whether a device copy includes TODAY'S FORMING BAR (2026-11-20).
//
// Mid-session a device copy holds every COMPLETE bucket (live.js), so its first frame lacks the bar still
// forming until the server answers. With these on, the copy includes it too, built from today's minute
// frames (lib/minuteFrames/rollup.js, the same rules as the server's bar_rollup): the first frame is the
// whole chart, and the server's answer changes nothing when its bars equal the minute rollups.
//
//   DEVICE_FORMING_INTRADAY  5 / 15 / 30 / 60: the bucket in progress (open of its first minute, high /
//                            low the max / min, close of its last minute, volume summed). Never 1m, by
//                            construction: a frame carries only closed minutes, so a 1m bar is complete
//                            once its frame is applied (forming.test.js holds that).
//   DEVICE_FORMING_DAILY     D: today's bar from the regular-session minutes, its volume the frames'
//                            ACCUMULATED day volume (`av`, MINUTE_FRAMES_WITH_AV: the consolidated basis),
//                            painted only when every frame of the day carried it (fail closed: a sum of
//                            minute volumes is not the vendor's day volume). W / M: the period in progress
//                            from the D bars, only when today's forming D bar is in the copy.
//
// ⛔ EACH PATH FLIPS ON ITS OWN EVIDENCE, HERE, ONCE (the seed engineer measures the server's bars against
// the minute rollups, RTH vs extended basis included).
//   INTRADAY: ON (2026-11-20, mid-session, 59 symbols): 5/15/30/60 and the extended buckets equal the minute
//     rollups on O/H/L/C at 4 dp in 100% of buckets. Volume is exact in 40-70%; every miss is the server
//     ABOVE the rollup by less than 1 share per minute of the bucket (the vendor truncates minute volumes),
//     sub-pixel on a volume pane. So a painted forming bucket's volume may trail the server's by < 1 share per
//     minute in it, and the answer lifts it (store.deviceLive L13); its prices never move.
//   DAILY: OFF. The server's D volume is above even the all-session minute sum (median x1.007, thin names up
//     to x1.5), so D needs the accumulated day volume (av); and one of 56 D bars had O/H/L differ from its
//     regular-session minutes (cause pending).
// The device store itself stays switched off by default (switch.js), so members see none of this yet.
// The extended-hours rule (barStore/prefetch: a regular-session copy never paints an extended view) and the
// split guard (engine.js) apply to a forming bar exactly as to every other device bar.

export const DEVICE_FORMING_INTRADAY = true
export const DEVICE_FORMING_DAILY = false

// ⭐ DEVICE_DAILY_SERVER_ROW: D (and W / M through it) from the SERVER'S OWN day row after the close, which the
// minute frames carry once stream-ingest runs with MINUTE_FRAMES_WITH_DAILY=1 (codec FLAG_DAILY; PR #2272): the
// row /api/bars?tf=D serves (bars-api's snapshot `day` row: the official close and the consolidated volume),
// painted exactly as received. ON, because it is exact by construction and the SERVER flag is the gate: no frame
// carries the section until the owner arms it, after `tools/forming_daily_check.py` reads `frames' DAILY row ==
// the server's D bar` on a real close. Used only while the device provably holds every row (consumer.js
// `dailyOk`); otherwise the rollup path above decides, unchanged.
// DEVICE_FORMING_DAILY (the rollup's D bar from minutes) STAYS OFF: its volume needs the accumulated day volume
// (`av`, a sum of minutes is not the vendor's day volume), and 1 of 56 D bars had O/H/L differ from its
// regular-session minutes. The server's row needs neither.
export const DEVICE_DAILY_SERVER_ROW = true
