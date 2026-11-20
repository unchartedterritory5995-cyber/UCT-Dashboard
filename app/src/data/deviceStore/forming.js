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
// ⛔ BOTH OFF until the evidence says the server's bars ARE the minute rollups (the seed engineer measures
// after the close, RTH vs extended basis included). Each path flips on its own evidence, here, once.
// The extended-hours rule (barStore/prefetch: a regular-session copy never paints an extended view) and the
// split guard (engine.js) apply to a forming bar exactly as to every other device bar.

export const DEVICE_FORMING_INTRADAY = false
export const DEVICE_FORMING_DAILY = false
