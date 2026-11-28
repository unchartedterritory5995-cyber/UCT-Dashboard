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
//                            minute volumes is not the vendor's day volume), and only while the regular
//                            session is open: after the close a day built from minutes is neither forming nor
//                            the official row, so it is never handed out (live.js, review of #2537 H2). W / M
//                            are never served to the page (tfs.SERVED_TFS, H1).
//
// ⛔ EACH PATH FLIPS ON ITS OWN EVIDENCE, HERE, ONCE (the seed engineer measures the server's bars against
// the minute rollups, RTH vs extended basis included).
//   INTRADAY: ON (2026-11-20, mid-session, 59 symbols): 5/15/30/60 and the extended buckets equal the minute
//     rollups on O/H/L/C at 4 dp in 100% of buckets. Volume is exact in 40-70%; every miss is the server
//     ABOVE the rollup by less than 1 share per minute of the bucket (the vendor truncates minute volumes),
//     sub-pixel on a volume pane. So a painted forming bucket's volume may trail the server's by < 1 share per
//     minute in it, and the answer lifts it (store.deviceLive L13); its prices never move.
//   DAILY: OFF FOR GOOD (cause found 2026-11-28, zero-network PR 3.4). The server's D bar IS the vendor snapshot's
//     `day` row (bars_live_store writes it all session), and no rollup of minute bars equals it: offline over 7
//     sessions x the cap universe (24,776 symbol-days, vendor daily rows vs the history lake's vendor minutes at
//     4 dp) the open always equals the first regular minute's, but the day high / low differ in 216 (0.87%):
//     146 are prints NO minute bar carries (the day range includes trades the minute aggregates exclude), 70 the
//     16:00 closing cross. Volume needs `av` besides. So the developing D bar is the SERVER'S ROW below, which the
//     frames now carry from the regular OPEN, never this rollup.
// The device store itself stays switched off by default (switch.js), so members see none of this yet.
// The extended-hours rule (barStore/prefetch: a regular-session copy never paints an extended view) and the
// split guard (engine.js) apply to a forming bar exactly as to every other device bar.

export const DEVICE_FORMING_INTRADAY = true
export const DEVICE_FORMING_DAILY = false

// ⭐ DEVICE_DAILY_SERVER_ROW: D (and W / M through it) from the SERVER'S OWN day row, which the minute frames carry
// from the regular OPEN to 20:00 (MINUTE_FRAMES_WITH_DAILY, default on since PR 3.4; codec FLAG_DAILY; PR #2272):
// the row /api/bars?tf=D serves (bars-api's snapshot `day` row: mid-session the developing bar, after the close
// the official close and the consolidated volume), painted exactly as received, as today's FORMING D bar until
// 20:00 (live.js). ON, because it is exact by construction and the SERVER flag is the gate: no frame
// carries the section until the owner arms it, after `tools/forming_daily_check.py` reads `frames' DAILY row ==
// the server's D bar` on a real close. Used only while the device provably holds every row (consumer.js
// `dailyOk`); otherwise the rollup path above decides, unchanged.
// DEVICE_FORMING_DAILY (the rollup's D bar from minutes) STAYS OFF: see DAILY above. The server's row needs neither.
export const DEVICE_DAILY_SERVER_ROW = true
