// THE SPEED RIG: chart-switch timing on the REAL member path (production, a synthetic bench member, real Chrome).
// Ported 2026-11-28 from the owner-PC cold rig (C:/uct-runs/cold-arch-20261128/rig/cold-rig.mjs = the owner3 flip rig
// + per-request phase hooks) so the coverage passes can run in parallel on GitHub's larger runner. The PC rig stays the
// reference for what the owner FEELS; this copy gives breadth, parallelism and regression detection, and every
// result it writes carries its runner, its Cloudflare colo and its Chrome version (out.labels).
//
// Every switch (arrow, typed Enter, board tab) is sampled per animation frame around the key (--jump-probe) and graded
// by grade.py. The board under test is the account's Charts board; how it is set depends on --isolate:
//   --isolate=account  (the PC rig's behaviour) the test board is APPLIED to the bench account through
//                      /api/workspace/doc/apply and the recorded version is ALWAYS restored at the end. ONE pass at a
//                      time per account: two passes on one account overwrite each other's board, refuse each other's
//                      writes (409) and restore over each other.
//   --isolate=browser  the account's board state is never written. This run's OWN browser holds it: the rig answers
//                      the page's board reads and writes (/api/auth/preferences, /api/workspace/doc*) from a per-run
//                      store (the account's real prefs with this pass's board in place), each write answered after the
//                      measured origin round trip. Bars, quotes, search, watchlists and everything else are the real
//                      production path. Passes on one account run in parallel without touching each other.
// --dist=<dir> [--build-label=<ref@sha>] (with either isolation): this browser runs the front end built in <dir> (the
// workflow's build_ref) on the PRODUCTION ORIGIN: the page document and /assets/* are answered from <dir>, everything
// else is the real site, so the member's cookies are first-party and nothing is published (the --dist block below).
//
// Usage: node scripts/proofs/speed-rig/rig.mjs <out.json> [--isolate=browser] [--board=<file>] [--pattern=down|typed|tabs]
//          [--fresh-list=A,B,..] [--typed=C,D,..] [--flips=N] [--dwell=ms] [--tf=D] ... (every flag documented below)
//        node scripts/proofs/speed-rig/rig.mjs <out.json> --dry=1   (no sign-in: Chrome, the page and the labels only)
// Sends no OS keys: key presses are DevTools-dispatched into this run's own page.
// ⛔ The repo is PUBLIC and Actions logs are public: nothing here prints or writes a credential, a cookie or a token
// (scrub() below runs over every line printed and every file written; the workflow scans the artifacts again).
import { readFileSync, writeFileSync as writeFileSyncRaw, openSync, writeSync, closeSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import { startApp, sleep, BASE, browserVersion } from './launch.mjs'

// ── THE SCRUB: every line printed and every file written passes through it ─────────────────────────────────────────
const SECRETS = [process.env.BENCH_PASSWORD, process.env.PROOF_PASSWORD, process.env.BENCH_EMAIL, process.env.PROOF_EMAIL]
  .filter((v) => typeof v === 'string' && v.length >= 4)
const TOKENISH = /((?:token|access_token|auth|apikey|api_key|signature|secret|password|uct_session|uct_chart_edge|uct_chart_speed)=)[^&"'\s;,]+/gi
export function scrub(text) {
  let s = String(text)
  for (const v of SECRETS) s = s.split(v).join('[redacted]')
  return s.replace(TOKENISH, '$1[redacted]')
}
const writeFileSync = (file, data, ...rest) => writeFileSyncRaw(file, typeof data === 'string' ? scrub(data) : data, ...rest)
{ const log0 = console.log.bind(console); console.log = (...a) => log0(scrub(a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' '))) }

const OUT = process.argv[2]
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : d }
const FLIPS = Number(arg('flips', '12'))
const DWELL = Number(arg('dwell', '2500'))
const TF = arg('tf', 'D')
// --tf2=<tf>: a SECOND chart on the same colour group at this timeframe, beside the first (the owner's
// scan: daily + an intraday chart linked to one watchlist). Each frame then also records `o2`, chart 2's state.
let TF2 = arg('tf2', '')
// (2026-11-26, the owner's board) --board=<file.json>: the test board's widgets are THESE (a member's own board, read
// read-only from his account): the first two charts become flip-chart / flip-chart-2 and the watchlist flip-wl.
// --user-def=<file.json>: a user definition (GET /api/user-definitions/<id> body) is created on THIS bench account
// through the app's own POST, every instance of its original id is pointed at the new one, and it is DELETED at the end.
// --drop-user=1: the board's user-definition instances are left out (the board without its scripts).
const BOARD = arg('board', '')
const USER_DEF = arg('user-def', '')
const DROP_USER = arg('drop-user', '') === '1'
let deleteCreatedDefs = null
const TAB_B = arg('tab-b', '')
// --tab-b-ids=own (owner3, 2026-11-26): tab B keeps its OWN widget ids (from its board file) instead of being renamed
// flip-chart / flip-wl like tab A. Renamed, both tabs share one React key per widget, so react-grid-layout keeps the
// item and its `transition: all 200ms` animates the size change (W1: 463 -> 1400 px over ~230 ms) on every switch: real
// only for layouts that share widget ids. Default 'renamed' (as every earlier run).
const TAB_B_IDS = arg('tab-b-ids', 'renamed')
// --wl-probe=1 (owner3, 2026-11-26): per tab click, WHEN the watchlist's rows appear and go (a MutationObserver on
// [data-watch-sym] rows: time, added, removed, rows after) and every resource request started after the click
// (url, start, end), to find what gates the rows' mount ~370 ms after a board switch
const WL_PROBE = arg('wl-probe', '') === '1'
const LEGEND_STATS = arg('legend-stats', '') === '1'   // (2026-11-26) count legendInk.readLegendContextCached hits/misses per tab click
const USER_DEF_ID = arg('user-def-id', '')   // <owner id>:<bench id>: point his instances at a definition already made on the bench account
let tabsCleanup = null
let freshCleanup = null   // --fresh-tickers: deletes this run's temporary watchlist (set inside the run)
let activeTemplate = 'null'
const SET = arg('set', 'mixed')
const PORT = Number(arg('port', '9441'))
const PROFILE = arg('profile', '')
const WARMUP = Number(arg('warmup', '8000'))
// (2026-11-26) --scan-trace=1: the page's opt-in scan-warm trace (Watchlists.jsx `window.__uctScanWarmTrace`), set to []
// before the presses; each press record carries the sends made since the previous record (`scanTrace`). Off by default.
const SCAN_TRACE = arg('scan-trace', '0') === '1'
// --last-dwell=ms: the FINAL flip waits this long instead of --dwell. A burst (--dwell=40, the key
// held down) followed by a stop: how long the chart the member lands on takes to fill in.
const LAST_DWELL = Number(arg('last-dwell', '0'))
// --live-probe=ms (2026-11-27, the live production sweep): after the warm-up, sample the flip chart every 100 ms for
// this long: its newest bar (time, close) and its header's day-gain text; how often each moved and the longest gap.
const LIVE_PROBE_MS = Number(arg('live-probe', '0'))
// --stale-check=1: after the flips, every chart the page holds: its newest bar's time, its age, its bar count
const STALE_CHECK = arg('stale-check', '') === '1'
// --tab-diag=1 (2026-11-27, S3b): per tab switch, the dock's active tab, the asked target, the board's widget ids, the
// flip layouts' stored widget ids (synthetic rows), and every /api/workspace/doc*, /api/charts/layouts* and
// /api/auth/preferences request in the window (ids, widget ids and flip-tab names only: no other content)
const TAB_DIAG = arg('tab-diag', '') === '1'
// --mem-probe=1 (2026-11-27, the RTH verification): the JS heap (after a forced GC) and the page's canvases, after the
// warm-up and again after the flips
const MEM_PROBE = arg('mem-probe', '') === '1'
// --db-stats=1: window.__uctDoubleBuffer (the double-buffered row's flips / switches / refusal reasons) before and
// after the flips; the delta is this pass's
const DB_STATS = arg('db-stats', '') === '1'
// --live-accuracy=1: the forming bars against the 1m API aggregation (after the live probe)
const LIVE_ACC = arg('live-accuracy', '') === '1'
// --rth-close=<minutes after ET midnight>: the session's close for the aggregation (960 = 16:00; 780 on a half day)
const RTH_CLOSE = Number(arg('rth-close', '960'))
// --heap-at=0,20,40 (2026-11-27, the dry run's heap growth): a full heap snapshot (after a forced GC) after the warm-up
// (0) and after those arrow flips, streamed to <out>.heap<N>.heapsnapshot; with a per-widget canvas count beside it
// --heap-sample-flips=N (2026-11-27; NEVER full snapshots on this PC): the sampling heap profiler from the warm-up to
// the N-th arrow, objects collected by GC excluded, stopped after a forced GC: the allocation sites of what is still
// RETAINED, summarised to <out>.heapsample.json (KB-sized: sites, chunks, stacks)
const HEAP_SAMPLE_N = Number(arg('heap-sample-flips', '0'))
// --jump-probe=ms (2026-11-27, the owner: "the jumping has gotten worse"): every animation frame around each arrow /
// typed Enter, per chart: the visible logical range, the newest bar (time, close) and index, the price scale (y of the
// close and of close x 1.01), the shown canvas's rect; and the watchlist's selected row (offsetTop, top, scrollTop).
// Any change AFTER the first frame that shows the new symbol is flagged with its frame and size. Frames -> <out>.jump.json
const JUMP_MS = Number(arg('jump-probe', '0'))
// --screencast=i,j: PNG frames (Page.startScreencast) for those presses, into <out>.cast<i>/
// --fresh-tickers=N / --typed-fresh=K (owner rule 2026-11-27: "The 50 test tickers need to change each test and have
// to be different for every test"): N tickers for a fresh temporary watchlist on the bench account (made for this run,
// deleted at its end) and K for typed Enter, drawn (seeded random) from the liquid pool (the app's $300M+ universe,
// price > $5 and price x day volume > $5M, rig/liquid_pool.json, built once from /api/live-prices) EXCLUDING every
// ticker any earlier run used (the ledger rig/used_tickers.json, appended before use with the run id and time)
const FRESH_N = Number(arg('fresh-tickers', '0'))
const TYPED_FRESH = Number(arg('typed-fresh', '0'))
// the PC's own pool and ledger (the cloud rig never reads them: its plan job hands every pass its tickers, below)
const RIG_DIR = process.env.UCT_RIG_DIR || 'C:/uct-runs/rig'
// --fresh-list=A,B,C (the cloud rig, 2026-11-28): this pass's temporary watchlist holds EXACTLY these tickers, drawn
// by the plan job (scripts/proofs/speed-rig/plan.py) from the shared ledger so no two passes of a sweep, and no earlier
// run, share one. With it (or with --typed) the local pool and ledger are not read or written.
const FRESH_LIST = arg('fresh-list', '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
// --isolate=account|browser: see the header. --tab-suffix=<id>: the tab pattern's two layouts are named
// flip-tab-A-<id> / flip-tab-B-<id>, so parallel tab passes never meet (nor delete) each other's.
const ISOLATE = arg('isolate', 'account')
if (!['account', 'browser'].includes(ISOLATE)) throw new Error(`--isolate=${ISOLATE}: account or browser`)
const TAB_SUFFIX = arg('tab-suffix', '').replace(/[^\w-]/g, '').slice(0, 24)
const TAB_A_NAME = TAB_SUFFIX ? `flip-tab-A-${TAB_SUFFIX}` : 'flip-tab-A'
const TAB_B_NAME = TAB_SUFFIX ? `flip-tab-B-${TAB_SUFFIX}` : 'flip-tab-B'
// --dry=1: no sign-in, no account read or write: Chrome starts, the site's front page loads, and the labels (Chrome,
// colo, production build) are recorded. The pull-request dry run of the workflow, which holds no credentials.
const DRY = arg('dry', '') === '1'
const ZOOM_TO = arg('zoom-out-to', '')
const TYPED_PROF = new Set(arg('typed-profile', '').split(',').filter(Boolean).map(Number))   // (cold-arch) CPU profile around these typed Enters
const PHASE_JS = `(()=>{const P=window.__phase;if(!P)return null;const F=window.__flip;const k=(F&&F.keys&&F.keys[0])||performance.now();const req=P.req.filter((r)=>r.call>=k-3000).map((r)=>({...r,call:Math.round((r.call-k)*10)/10,hdr:r.hdr==null?null:Math.round((r.hdr-k)*10)/10,bodyS:r.bodyS==null?null:Math.round((r.bodyS-k)*10)/10,bodyE:r.bodyE==null?null:Math.round((r.bodyE-k)*10)/10,parseS:r.parseS==null?null:Math.round((r.parseS-k)*10)/10,parseE:r.parseE==null?null:Math.round((r.parseE-k)*10)/10}));const res=performance.getEntriesByType('resource').filter((e)=>e.startTime>=k-3000&&(e.name.indexOf('/api/bars')>=0||e.name.indexOf('/api/hist/')>=0)).map((e)=>({u:e.name.replace(location.origin,'').slice(0,160),s:Math.round((e.startTime-k)*10)/10,rqS:Math.round((e.requestStart-k)*10)/10,rsS:Math.round((e.responseStart-k)*10)/10,rsE:Math.round((e.responseEnd-k)*10)/10,conn:Math.round((e.connectEnd-e.connectStart)*10)/10,proto:e.nextHopProtocol,tx:e.transferSize,enc:e.encodedBodySize,dec:e.decodedBodySize,rs:e.responseStatus,st:(e.serverTiming||[]).map((x)=>x.name+(x.description?'('+x.description+')':'')+'='+Math.round(x.duration)).join(',')}));let up=null;try{const U=window.__uctPaints;const a=Array.isArray(U)?U:(U&&(U.ring||U.list||U.items||(typeof U.slice==='function'?U:null)));up=a?a.slice(-40).map((x)=>({...x,at:typeof x.at==='number'?Math.round((x.at-k)*10)/10:x.at})):(U?Object.keys(U).slice(0,10):null)}catch(e){up=String(e)}return {key:k,req,res,uctPaints:up}})()`
const GO_TO_DATE = arg('go-to-date', '')
// --zoom-out-max=1 (owner, 2026-11-27: "it needs to be fully zoomed out"): before the pass, wheel EVERY chart of the
// board out to its limit (until the view stops widening: D to its max, W/M to their whole history, intraday to its max)
const ZOOM_MAX = arg('zoom-out-max', '') === '1'
// --focus-check=1 (after #2932): after each typed Enter, is focus inside the shown layer ([data-db-layer="front"]), and
// does an ArrowDown then move the symbol (the list keys still reach the board)?
const FOCUS_CHECK = arg('focus-check', '') === '1'
const CAST = new Set(String(arg('screencast', '')).split(',').filter((x) => x !== '').map(Number))
const HEAP_AT = new Set(String(arg('heap-at', '')).split(',').filter((x) => x !== '').map(Number))
// --dwells=a,b,c (2026-11-27): the tab pattern's dwell per flip index (missing entries fall back to the rule above)
const DWELLS = String(arg('dwells', '')).split(',').filter((x) => x !== '').map(Number)
// --cpuprofile=i,j: a CPU profile of the 700 ms after the key of those flips, saved beside the output
// (<out>.flip<i>.cpuprofile, loadable in DevTools) for indicator-cpu-report.mjs.
const PROFILE_FLIPS = new Set(arg('cpuprofile', '').split(',').filter(Boolean).map(Number))
// --heap-sample=i,j (owner3, 2026-11-26): V8's sampling heap profiler (HeapProfiler.startSampling, 16 KB interval) from
// just before press i to the end of its dwell: what the press ALLOCATES, by function (<out>.flip<i>.heapprofile, the
// `samplingHeapProfile` with every sample: includeObjectsCollectedByMajorGC/MinorGC so garbage counts too)
const HEAP_FLIPS = new Set(arg('heap-sample', '').split(',').filter(Boolean).map(Number))
// --trace=i,j (2026-11-20, the key->BOTH wait): a Chromium trace of those flips (from just before the key to
// the end of the dwell), saved beside the output as <out>.flip<i>.trace.json; each flip records `traceAlign`
// (the performance.now() of a user-timing mark '__flipAlign' in the trace) so trace time maps onto page time.
// Task boundaries, timers (with their install stacks), animation frames, network, idle callbacks.
const TRACE_FLIPS = new Set(arg('trace', '').split(',').filter(Boolean).map(Number))
// (2026-11-27) no 'disabled-by-default-devtools.timeline.stack': it doubles the key task it is meant to measure
const TRACE_CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame', 'toplevel', 'v8.execute', 'blink.user_timing', 'latencyInfo', 'input',
  'loading', 'disabled-by-default-v8.cpu_profiler', 'blink', 'cc', 'gpu', 'scheduler', 'renderer.scheduler']
const UPDOWN = arg('pattern', 'down') // down | downup (down N then back up N: revisits) | typed | jump
// --pattern=tf (lane C, 2026-11-28, goal A4): on --tf-syms fresh rows in turn (the first selected at start, then the next
// row clicked, untimed), click EVERY timeframe of --tf-seq on the chart's own toolbar (custom 45m / 2h / 4h included: the
// board's header favourites are set to the sequence), key = the click, frames sampled by the jump probe; each flip
// records its tf, the tf it left, the view after the dwell and whether its key was fetched before the click
const TF_SEQ = arg('tf-seq', '1,5,15,30,45,60,120,240,D,W,M').split(',').map((s) => s.trim()).filter(Boolean)
const TF_SYMS = Number(arg('tf-syms', '3'))
const TF_NOLIST = arg('tf-nolist', '') === '1'   // the list on group B (unlinked), each ticker typed into the chart
const tfButtonLabel = (c) => { if (c === 'D' || c === 'W' || c === 'M') return '1' + c; const m = Number(c); return m >= 60 && m % 60 === 0 ? `${m / 60}h` : `${m}m` }
// --pattern=typed --typed=AAA,BBB,...: with the chart focused, TYPE each ticker (one key-down per
// character, --type-gap ms apart, as a member types), pause --typed-pause ms, then Enter. The flip's
// key time is the ENTER: what a member waits on after deciding. The type-to-search warm (if any)
// runs during the typing, exactly as for a member.
// --pattern=jump: POINT at a row --jump rows below the selection (outside the ±6 the list holds),
// --hover ms, then click it. The flip's key time is the CLICK.
const TYPED = arg('typed', '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const TYPE_GAP = Number(arg('type-gap', '90'))
const TYPED_PAUSE = Number(arg('typed-pause', '300'))
// --human-type=1 (owner, 2026-11-27: "close to 30MS for everything always"): type like a person, 150-250 ms per
// character (seeded), Enter about 150 ms after the last one, so prefetch-while-typing has its fair chance; the real
// gaps are recorded, and whether the Enter found the symbol's data already fetched (warm / in flight / cold)
const HUMAN_TYPE = arg('human-type', '') === '1'
let humanSeed = 7
const humanGap = () => { humanSeed = (humanSeed * 1664525 + 1013904223) >>> 0; return 150 + Math.floor((humanSeed / 4294967296) * 101) }
const JUMP = Number(arg('jump', '9'))
const HOVER = Number(arg('hover', '250'))
const AUTOREPEAT = arg('autorepeat', '') === '1' // a held key (repeat key-downs, one key-up), not taps
// --cadence=ms (the canary's, pixels-both e2de491, verbatim): the next key is pressed this long after the previous one (the
// per-flip reads are inside it), instead of a dwell AFTER each read: 33 ms with --autorepeat=1 is a held key at the OS rate.
const CADENCE = Number(arg('cadence', '0'))
// --stub=ms (LOCAL SANDBOX ONLY): the chart header's small per-symbol reads (research snapshot,
// adjustment basis, event markers) are answered here from a canned body after `ms`, so a sandbox
// with no provider data still shows header values and the server makes no provider call for them.
const STUB = Number(arg('stub', '0'))
// --delay-bars=MS: hold every /api/bars/<SYM> answer MS in the browser (a cold bar-server read, e.g.
// FROG 5m bars(sqlite)=1523 on 2026-11-17) to prove what a chart shows while its first answer is slow.
const DELAY_BARS = Number(arg('delay-bars', '0'))
// --override=<url part>=<file>: THIS RUN'S BROWSER ONLY is handed <file> wherever it asks for a
// script whose URL contains <url part> (e.g. vendor-charts-=C:/x/vendor-charts-patched.js): a
// candidate chunk measured against live data before it is merged. Nothing is sent to the server.
// The run stops unless the page really ran the file (it sets a marker).
const OVERRIDE = arg('override', '')
// --header=mcap,earn,rating,perf5d,theme,rvol,ipoDate: the chart header's info row shows these fields
// (the default is market cap, next earnings, UCT rating). For timing the optional ones.
const HEADER = arg('header', '').split(',').filter(Boolean)
// --ext=0|1: the chart's own extended-hours setting, written into the test board's chart. Without
// it the board's chart carries a PARTIAL settings blob, and the app resolves a missing
// `extendedHoursShading` two ways (the widget: default ON; the chart: the account's global
// setting), so the symbol handoff prepared the extended-hours 60m series while the chart drew the
// regular-hours one (found 2026-11-15: a wasted round trip before every 60m paint).
const EXT = arg('ext', '')
// ── TIME-SHIFT REPLAY (this copy only, 2026-11-23; replay/README.md) ─────────────────────────────────
// --replay-at=HH:MM:SS (US Eastern, on the most recent completed trading day, or --replay-date=YYYY-MM-DD):
// after hours the page behaves as if it were that moment of the session. Its wall clock is shifted by a
// constant, every /api/bars answer is cut back to what the server held at that clock minus --replay-lag-ms
// (default 1500), and the live feeds are taken away. ABSENT: none of the replay code is loaded and this
// script is the original, line for line.
const REPLAY_AT = arg('replay-at', '')
const D = { x: -1440, y: 0, w: 1440, h: 950 } // display 2 (portrait), top half

const inst = (defId, inputs = {}) => ({ instanceId: `t:${defId}`, defId, inputs, hidden: false })
const SETS = {
  // what a fresh member has: the four averages only
  base: [],
  native: ['rsi', 'macd', 'bb', 'vwap', 'relativeVolume'].map((d) => inst(d)),
  server: ['rsLine', 'rsRating', 'rsPhases', 'rsVsEma', 'rsExit'].map((d) => inst(d)),
  mixed: ['bb', 'vwap', 'rsi', 'macd', 'relativeVolume', 'rsLine', 'rsRating', 'rsPhases', 'rsVsEma', 'rsExit'].map((d) => inst(d)),
}
if (!SETS[SET]) throw new Error(`unknown --set ${SET}`)

// --cheap-sampler=1: read the chart's bar COUNT only when its newest bar (time|close) changes, or every 30th
// frame. `count` is series.data().length, a copy of every row: read per frame it cost 80-136 ms of each
// 60m flip's first 700 ms (2026-11-19 CPU profiles), inflating every long task this proof reports. Use
// it for freeze (long-task) runs; leave it off where a count-only change must be timed to the frame.
// --light-sampler=1 (the canary's, verbatim): the per-frame sample reads only each chart's newest bar and view,
// never its indicator series (engineSeries copies every series each call). Implies the cheap bar count.
const LIGHT_SAMPLER = arg('light-sampler', '') === '1'
// --pixels=1: THE PRESENTATION STAMP (the canary agent's pixels_both, uct-desktop pixels-both e2de491, copied
// verbatim: paint-probe.js at document start, F.arm0 / F.take / F.startBusy / PP.onPresent and the Event Timing
// observer in the sampler). Scored by pixels/pixels_score.mjs with the canary's scoreSwitch.
const PIXELS = arg('pixels', '') === '1'
const CHEAP_SAMPLER = arg('cheap-sampler', '') === '1' || LIGHT_SAMPLER
const PIXELS_JS = "  // ── the presentation stamp's per-flip state (paint-probe.js records every chart paint and when it was presented)\n  const PP = window.__paintProbe || null;\n  F.evt = []; F.busy = []; F.gen = 0; F.pp0 = 0; F.arm = null;\n  // Event Timing: the input's own first presentation (a cross-check: the charts cannot be on screen before it)\n  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (F.evt.length < 200 && (e.name === 'keydown' || e.name === 'keyup' || e.name === 'click' || e.name === 'pointerdown')) F.evt.push({ n: e.name, s: e.startTime, ps: e.processingStart, pe: e.processingEnd, d: e.duration }) } }).observe({ type: 'event', durationThreshold: 16, buffered: false }) } catch (e) {}\n  // THE POST-PAINT BUDGET: once every linked chart has PRESENTED the new symbol, a message-channel ping runs for\n  // 1 s (or until the next key): any gap over 8 ms between its turns is the main thread busy that long.\n  F.startBusy = (from, gen) => { try { const ch = new MessageChannel(); let last = performance.now(); const end = from + 1000; ch.port1.onmessage = () => { const now = performance.now(); if (now - last > 8 && F.busy.length < 500) F.busy.push({ s: Math.round(last * 10) / 10, d: Math.round((now - last) * 10) / 10 }); last = now; if (now < end && F.gen === gen) ch.port2.postMessage(0); else { ch.port1.close(); F.busyEnd = now } }; F.busyFrom = from; ch.port2.postMessage(0) } catch (e) {} };\n  const idsOf = () => [F.chart, F.chart2, F.chart3].filter(Boolean);\n  const newest = (id) => { try { const nb = window.__uctChartDebug[id].newestBar(); return nb ? { time: nb.time, close: nb.close } : { time: null, close: null } } catch (e) { return { time: null, close: null } } };\n  F.arm0 = () => { F.gen++; F.busy = []; F.evt = []; F.busyFrom = null; F.busyEnd = null; F.pp0 = PP ? PP.paints.length : 0; const need = {}; for (const id of idsOf()) need[id] = newest(id); const gen = F.gen; F.arm = { gen, need, found: {}, presented: {}, done: false, key: () => (F.gen === gen && F.keys.length ? F.keys[0] : Infinity) }; if (PP) PP.armed = F.arm };\n  F.take = () => { const finals = {}; for (const id of idsOf()) finals[id] = newest(id); if (PP && PP.armed === F.arm) PP.armed = null; return { paints: PP ? PP.paints.slice(F.pp0) : null, evt: F.evt.slice(), busy: F.busy.slice(), busyFrom: F.busyFrom, busyEnd: F.busyEnd, finals } };\n  if (PP) PP.onComplete = (p) => { const A = F.arm; if (!A || A.gen !== F.gen || A.done || !p.first || A.found[p.w] !== p) return; A.presented[p.w] = p.complete; if (Object.keys(A.presented).length === Object.keys(A.need).length) { A.done = true; F.startBusy(Math.max(...Object.values(A.presented)), A.gen) } };\n"
const SAMPLER = `(()=>{
  const CHEAP = ${CHEAP_SAMPLER ? 'true' : 'false'};
  const LIGHT = ${LIGHT_SAMPLER ? 'true' : 'false'};
  if (window.__flip) { window.__flip.on = false }
  const F = window.__flip = { on: true, frames: [], res: [], keys: [], t0: performance.now() };
  const lastFinite = (d) => { for (let i = d.length - 1, n = 0; i >= 0 && n < 400; i--, n++) { const v = d[i] && d[i].value; if (typeof v === 'number' && Number.isFinite(v)) return d[i].time + '=' + v } return 'none' };
  const sigOf = (id) => {
    const h = (window.__uctChartDebug || {})[id]; if (!h) return null;
    const nb = h.newestBar(); const es = LIGHT ? [] : (h.engineSeries() || []);
    const tc = nb ? nb.time + '|' + nb.close : null; F.fc = (F.fc || 0) + 1;
    let cnt;
    const st = (F.st = F.st || {})[id] || (F.st[id] = {}); cnt = st.count;
    if (!CHEAP || !nb || tc !== st.tc || F.fc % 30 === 0 || cnt == null) { cnt = nb ? nb.count : null; st.tc = tc; st.count = cnt }
    const o = { c: nb ? cnt + '|' + nb.time + '|' + nb.close : 'none', s: {} };
    for (const s of es) { const k = s.instanceId + '::' + s.plotKey; let n = s.data.length, lf = lastFinite(s.data); for (const r of s.runs) { n += r.length; if (lf === 'none') lf = lastFinite(r) } o.s[k] = n + '|' + lf }
    // (2026-11-20, the cold fix's rails in a real browser) the newest candle's distance from the right edge
    // (m: visibleRange().to - newestIndex(), invariant to a left prepend) and the visible width (w): a change
    // after the first paint is the picture moving (VISIBLE_RANGE_DRIFT / a zoom change), not a deeper history
    try { const vr = h.visibleRange(); const ni = h.newestIndex(); if (vr && Number.isFinite(ni)) { o.m = Math.round((vr.to - ni) * 100) / 100; o.w = Math.round((vr.to - vr.from) * 10) / 10 } } catch (e) {}
    return o };
  F.sigOf = sigOf;
${PIXELS ? PIXELS_JS : ''}  let prev = '';
  const tick = (t) => { if (!F.on) return; const n = performance.now(); const o = sigOf(F.chart); const o2 = F.chart2 ? sigOf(F.chart2) : null; if (F.armOrigin != null && o && o.c !== 'none' && o.c.split('|')[2] !== F.armOrigin) { F.armOrigin = null; F.originAt = n; const OW = document.querySelector('[data-widget-id="flip-chart"]'); const OB = OW && [...OW.querySelectorAll('[data-guide="chart.range"] button')].find((x) => x.textContent.trim() === 'Origin'); F.originClicked = !!OB; if (OB) setTimeout(() => { if (F.originWheel) { const CV = OW.querySelector('canvas'); if (CV) CV.dispatchEvent(new WheelEvent('wheel', { deltaY: 0, deltaX: 0, bubbles: true, cancelable: true })) } F.originClickAt = performance.now(); OB.click() }, 1000) } if (F.traceOrigin && F.originClickAt && n - F.originClickAt < 6000) { try { const TH = (window.__uctChartDebug || {})['flip-chart']; const VR = TH && TH.visibleRange(); const PW = document.querySelector('[data-widget-id="flip-chart"]'); const pill = !!(PW && PW.textContent.indexOf('Loading chart history') >= 0); const row = [Math.round(n - F.originClickAt), VR ? Math.round(VR.from) : null, VR ? Math.round(VR.to) : null, o.c.split('|')[0], pill ? 1 : 0]; const last = F.vr[F.vr.length - 1]; if (!last || last[1] !== row[1] || last[2] !== row[2] || last[3] !== row[3] || last[4] !== row[4]) F.vr.push(row) } catch (e) {} } const j = JSON.stringify([o, o2]); if (j !== prev) { F.frames.push(o2 ? { t: t, n: n, o: o, o2: o2 } : { t: t, n: n, o: o }); prev = j } requestAnimationFrame(tick) };
  requestAnimationFrame(tick);
  // THE SELECTED ROW, per frame (2026-11-20, useFlushSync measurement): the frame the new row first shows
  // selected, and the first frame it is FULLY inside its scroller. Layout is read only while the newest
  // selection is not yet confirmed visible, so a settled list costs one querySelector a frame.
  F.rows = []; let rsel = null, rvis = false;
  const scrollerOf = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p } return null };
  const rtick = (t) => { if (!F.on) return; try { const n = performance.now(); const sel = document.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]'); const sym = sel ? sel.getAttribute('data-watch-sym') : null; if (sym !== rsel) { rsel = sym; rvis = false; if (F.rows.length < 400) F.rows.push({ t: t, n: n, sym: sym, vis: 0 }) } if (sel && !rvis) { const sc = scrollerOf(sel); const r = sel.getBoundingClientRect(); const b = sc ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight }; if (r.height > 0 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5) { rvis = true; if (F.rows.length < 400) F.rows.push({ t: t, n: n, sym: sym, vis: 1 }) } } } catch (e) { F.rowErr = String(e) } requestAnimationFrame(rtick) };
  requestAnimationFrame(rtick);
  try { F.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.name.indexOf('/api/') >= 0) F.res.push({ u: e.name.replace(location.origin, ''), s: Math.round(e.startTime), e: Math.round(e.responseEnd), ttfb: Math.round(e.responseStart - e.startTime), bytes: e.transferSize, st: (e.serverTiming || []).map((x) => x.name + (x.description ? '(' + x.description + ')' : '') + '=' + Math.round(x.duration)).join(',') }) } }); F.po.observe({ type: 'resource', buffered: false }) } catch (e) {}
  // 2026-11-25 (additive): the page's Date.now() at each key, read in the same handler as F.keys (F.kw: [key, wall])
  F.kw = [];
  window.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (F.enterKeys && e.key === 'Enter')) { const kt = performance.now(); F.keys.push(kt); F.kw.push([kt, Date.now()]); if (F.kw.length > 64) F.kw.shift() } }, true);
  // main-thread long tasks (>50 ms): what the page was busy with around a flip
  F.long = [];
  // (owner3, 2026-11-27) canvas bitmap reallocations: a width/height set that changes the value (keep-alive A/B)
  F.cv = 0;
  // (owner3, 2026-11-27 layer review D3) sockets opened since the flip's reset, and the open ones now
  F.ws = 0; F.es = 0; F.wsLive = new Set(); F.esLive = new Set();
  try { const W = window.WebSocket; window.WebSocket = function (...a) { const s = new W(...a); F.ws++; F.wsLive.add(s); s.addEventListener('close', () => F.wsLive.delete(s)); return s }; window.WebSocket.prototype = W.prototype; Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 }) } catch (e) {}
  try { const E = window.EventSource; if (E) { window.EventSource = function (...a) { const s = new E(...a); F.es++; F.esLive.add(s); const c = s.close.bind(s); s.close = () => { F.esLive.delete(s); c() }; return s }; window.EventSource.prototype = E.prototype } } catch (e) {}
  try { for (const p of ['width', 'height']) { const d = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, p); Object.defineProperty(HTMLCanvasElement.prototype, p, { configurable: true, get() { return d.get.call(this) }, set(v) { if (d.get.call(this) !== v) F.cv++; d.set.call(this, v) } }) } } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (F.long.length < 400) F.long.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }) } }).observe({ type: 'longtask', buffered: false }) } catch (e) {}
  // every DOM text change inside the chart widget, outside the chart canvas: what else lands after the candles
  F.dom = [];
  try { const W = document.querySelector('[data-widget-id="flip-chart"]');
    F.mo = new MutationObserver((list) => { const t = performance.now(); for (const m of list) { if (F.dom.length > 600) return; const el = m.target.nodeType === 3 ? m.target.parentElement : m.target; if (!el || el.closest('canvas') || el.closest('table')) continue; const c = el.className; const cls = String((c && c.baseVal !== undefined ? c.baseVal : c) || el.tagName).split(' ')[0].replace(/^_/, '').slice(0, 44); const txt = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60); F.dom.push({ t: t, cls: cls, txt: txt }) } });
    F.mo.observe(W, { subtree: true, childList: true, characterData: true }) } catch (e) { F.domErr = String(e) }
  return true })()`

// Runs at the start of every new document (see --reloads): one sample per frame of what the chart holds.
const RELOAD_SAMPLER = `(()=>{
  if (window.top !== window) return;
  const R = window.__reload = { frames: [], res: [] };
  const has = (d) => { for (let i = d.length - 1, n = 0; i >= 0 && n < 400; i--, n++) { const v = d[i] && d[i].value; if (typeof v === 'number' && Number.isFinite(v)) return 1 } return 0 };
  let prev = '';
  const tick = (t) => {
    try {
      const h = (window.__uctChartDebug || {})['flip-chart'];
      if (h) {
        const nb = h.newestBar(); const es = h.engineSeries() || [];
        const o = { c: nb ? nb.count : 0, s: {} };
        for (const s of es) { let v = has(s.data); if (!v) for (const r of s.runs) { if (has(r)) { v = 1; break } } o.s[s.instanceId + '::' + s.plotKey] = v }
        const j = JSON.stringify(o);
        if (j !== prev) { R.frames.push({ t: Math.round(t), o: o }); prev = j }
      }
    } catch (e) { R.err = String(e) }
    if (R.frames.length < 400) requestAnimationFrame(tick)
  };
  requestAnimationFrame(tick);
  R.long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (R.long.length < 600) R.long.push({ s: Math.round(e.startTime), d: Math.round(e.duration) }) } }).observe({ type: 'longtask', buffered: true }) } catch (e) {}
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (e.name.indexOf('/api/signature/') >= 0) R.res.push({ u: e.name.replace(location.origin, '').slice(0, 60), s: Math.round(e.startTime), e: Math.round(e.responseEnd) }) } }).observe({ type: 'resource', buffered: true }) } catch (e) {}
})()`

const ORIGIN = arg('origin', '') === '1'
const ARM_ORIGIN_JS = `(()=>{const F=window.__flip;const s=F.sigOf(F.chart);F.armOrigin=s&&s.c!=='none'?s.c.split('|')[2]:'__none__';F.originAt=null;F.originClickAt=null;F.originClicked=null;F.vr=[];F.traceOrigin=${arg('trace-origin', '') === '1'};F.originWheel=${arg('origin-wheel', '') === '1'};return true})()`
const ORIGIN_END_JS = `(()=>{const F=window.__flip;F.armOrigin=null;const h=(window.__uctChartDebug||{})['flip-chart'];let endCount=null,endFrom=null;try{const nb=h&&h.newestBar();endCount=nb?nb.count:null}catch(e){}try{const r=h&&h.visibleRange();endFrom=r?r.from:null}catch(e){}const W=document.querySelector('[data-widget-id="flip-chart"]');const pill=!!(W&&[...W.querySelectorAll('div')].find((e)=>e.children.length<=1&&/Loading chart history/.test(e.textContent||'')));return {originAt:F.originAt,originClickAt:F.originClickAt||null,originClicked:F.originClicked,endCount,endFrom,historyPill:pill,vr:F.vr||null}})()`
const OPFS_JS = `(async()=>{const o={ok:0,files:[],estimate:null,persisted:null};try{const root=await navigator.storage.getDirectory();let dir=null;try{dir=await root.getDirectoryHandle('uct-device-store')}catch(e){}if(dir){for await(const [name,h] of dir.entries()){if(h.kind!=='file')continue;if(name.endsWith('.ok'))o.ok++;let size=null;try{size=(await h.getFile()).size}catch(e){size='locked'}o.files.push([name,size])}}}catch(e){o.err=String(e)}try{const e=await navigator.storage.estimate();o.estimate={usage:e.usage,quota:e.quota}}catch(e){}try{o.persisted=await navigator.storage.persisted()}catch(e){}return o})()`
async function probeMemory(port) {
  const ver = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(ver.webSocketDebuggerUrl)
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('browser socket failed')) })
  let id = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.no(new Error(m.error.message)); else p.ok(m.result) } else if (m.method) events.push(m)
  }
  const send = (method, params = {}, sessionId) => new Promise((ok, no) => {
    const i = ++id
    pending.set(i, { ok, no })
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }))
    setTimeout(() => { if (pending.has(i)) { pending.delete(i); no(new Error(method + ' timed out')) } }, 20000)
  })
  try {
    const { targetInfos } = await send('Target.getTargets')
    const page = targetInfos.find((t) => t.type === 'page' && /\/charts/.test(t.url)) || targetInfos.find((t) => t.type === 'page')
    const { sessionId: ps } = await send('Target.attachToTarget', { targetId: page.targetId, flatten: true })
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, ps)
    await sleep(2000)
    await send('Performance.enable', {}, ps).catch(() => {})
    const metrics = await send('Performance.getMetrics', {}, ps).then((r) => Object.fromEntries(r.metrics.filter((m) => /JSHeap|^Nodes$|JSEventListeners/.test(m.name)).map((m) => [m.name, m.value]))).catch((e) => String(e))
    const heap = await send('Runtime.getHeapUsage', {}, ps).catch((e) => String(e))
    const workers = []
    for (const ev of events) {
      if (ev.method !== 'Target.attachedToTarget' || ev.sessionId !== ps) continue
      const { sessionId, targetInfo } = ev.params
      const h = await send('Runtime.getHeapUsage', {}, sessionId).catch((e) => String(e))
      workers.push({ type: targetInfo.type, url: String(targetInfo.url).replace(/^https?:\/\/[^/]+/, '').slice(0, 140), heap: h })
    }
    const others = targetInfos.filter((t) => !['page', 'browser', 'tab'].includes(t.type)).map((t) => ({ type: t.type, url: String(t.url).replace(/^https?:\/\/[^/]+/, '').slice(0, 140) }))
    return { page: { heap, metrics }, workers, otherTargets: others }
  } finally { try { ws.close() } catch { /* closed */ } }
}
const out = { startedUtc: new Date().toISOString(), tf: TF, set: SET, flips: [], dwell: DWELL, cheapSampler: CHEAP_SAMPLER, origin: ORIGIN }
// (speed rig) the isolation store is written as its keys and sizes only: a pref VALUE never enters a result
const save = () => writeFileSync(OUT, JSON.stringify(out, function (k, v) { return k === 'store' && this && this.mode === 'browser' && v && typeof v === 'object' ? Object.keys(v).map((x) => `${x}:${String(v[x]).length}`) : v }, 1))
// --headless=1 (+ --chrome-version=<x.y.z.w>): an OFF-SCREEN Chrome (headless=new draws real frames) for a run
// while every display holds the owner's windows (same option as tick-latency-proof, 2026-11-19).
const HEADLESS = arg('headless', '') === '1'
const CHROME_VERSION = arg('chrome-version', '')
const launchArgs = HEADLESS
  ? ['--headless=new', '--window-size=1440,950', ...(CHROME_VERSION ? [`--user-agent=Mozilla/5.0 (${process.platform === 'win32' ? 'Windows NT 10.0; Win64; x64' : 'X11; Linux x86_64'}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION} Safari/537.36`] : [])]
  : ['--disable-features=CalculateNativeWinOcclusion', `--window-position=${D.x},${D.y}`]
// ── THE LABELS: cloud numbers are not PC numbers, so every result says where it was measured ─────────────────────────
// runner (and its CPU), the Cloudflare colo that answered the PAGE (the cf-ray suffix, read in the page at the start and
// again at the end), the Chrome build, the production commit (api) and web build, and the isolation mode.
async function labelsNow(run) {
  let page = null
  try {
    page = await run(`(async()=>{const o={};try{const r=await fetch('/api/health',{cache:'no-store'});o.healthStatus=r.status;const ray=r.headers.get('cf-ray');o.cfRay=ray;o.colo=ray&&ray.indexOf('-')>0?ray.slice(ray.lastIndexOf('-')+1):null;try{const j=await r.json();o.apiCommit=String(j.commit||j.git_sha||'').slice(0,12)||null;o.apiUptime=j.uptime_seconds==null?null:j.uptime_seconds}catch(e){}}catch(e){o.healthErr=String(e).slice(0,120)}try{const b=await fetch('/build.json',{cache:'no-store'});const j=await b.json();o.webBuild=String(j.commit||'').slice(0,12)||null;o.webBuildId=j.build_id||null}catch(e){}o.dpr=devicePixelRatio;o.ua=navigator.userAgent;o.hardwareConcurrency=navigator.hardwareConcurrency;o.deviceMemory=navigator.deviceMemory||null;o.viewport=[innerWidth,innerHeight];return o})()`)
  } catch (e) { page = { error: String(e).slice(0, 160) } }
  const cpus = os.cpus()
  return {
    at: new Date().toISOString(),
    runner: process.env.SPEED_RIG_RUNNER || (process.env.GITHUB_ACTIONS ? 'github' : 'local'),
    runnerName: process.env.RUNNER_NAME || null,
    os: `${os.platform()} ${os.release()}`,
    cpu: (cpus[0] && cpus[0].model) || null,
    cores: cpus.length,
    memGB: Math.round(os.totalmem() / 1e9),
    chrome: (await browserVersion(PORT)).product,
    isolate: ISOLATE,
    // (2026-11-28) the FRONT END this browser runs: 'production' (the site's own build), else --build-label (the
    // candidate's ref@commit, from the workflow's build job) or 'dist'. webBuild above stays the SITE's build.
    build: arg('dist', '') ? (arg('build-label', '').replace(/[^\w.@/:-]/g, '').slice(0, 80) || 'dist') : 'production',
    ...page,
  }
}
const BUILDS_JS = `(async()=>{const o={at:new Date().toISOString()};try{const j=await (await fetch('/api/health',{cache:'no-store'})).json();o.api={commit:String(j.commit||j.git_sha||'').slice(0,12)||null,uptime:j.uptime_seconds==null?null:j.uptime_seconds}}catch(e){o.api={error:String(e).slice(0,80)}}try{const j=await (await fetch('/build.json',{cache:'no-store'})).json();o.front={commit:String(j.commit||'').slice(0,12)||null,buildId:j.build_id||null}}catch(e){o.front={error:String(e).slice(0,80)}}o.commit=o.api&&o.api.commit||null;o.uptime=o.api&&o.api.uptime;return o})()`
class DryDone extends Error {}
const app = await startApp('chrome', PORT, launchArgs, { ...(PROFILE ? { profile: PROFILE } : {}), signIn: !DRY })
let board = null
let replay = null   // the time-shift replay (--replay-at), else null
let originalVersion = null
let exitCode = 0
try {
  const { c, run, waitFor, charts } = app
  if (!HEADLESS) app.placeMainWindow(D.x, D.y, D.w, D.h)
  out.headless = HEADLESS
  out.labels = await labelsNow(run)
  console.log(`labels: ${JSON.stringify({ runner: out.labels.runner, cpu: out.labels.cpu, cores: out.labels.cores, chrome: out.labels.chrome, colo: out.labels.colo, api: out.labels.apiCommit, web: out.labels.webBuild, build: out.labels.build, isolate: ISOLATE })}`)
  if (DRY) {
    // signed OUT: the account is never read. What a sweep needs from the runner: Chrome, the site through Cloudflare,
    // the app's own boot, and the auth door answering (401 signed out).
    out.dry = await run(`(async()=>{const o={};try{const r=await fetch('/api/auth/me',{credentials:'include',cache:'no-store'});o.meStatus=r.status}catch(e){o.meErr=String(e).slice(0,120)}o.title=document.title;o.rootChildren=(document.getElementById('root')||document.body).childElementCount;o.path=location.pathname;return o})()`)
    out.dry.signedOut = out.dry.meStatus === 401
    console.log(`dry run: ${JSON.stringify(out.dry)}`)
    save()
    if (!out.dry.signedOut || out.labels.healthStatus !== 200) { exitCode = 1; console.log('DRY RUN FAILED: the site did not answer as expected') }
    throw new DryDone('dry run done')
  }
  board = {
    head: () => run(`fetch('/api/workspace/doc?board=charts',{credentials:'include'}).then(r=>r.json()).then(j=>j.version)`),
    apply: (base, prefs) => run(`fetch('/api/workspace/doc/apply',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ base_version: base, board: 'charts', prefs }))}}).then(async r=>({status:r.status,body:await r.json().catch(()=>null)}))`),
    restore: (version, base) => run(`fetch('/api/workspace/doc/restore',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:${version},base_version:${base},board:'charts'})}).then(r=>r.status)`),
  }
  const me = await run(`fetch('/api/auth/me',{credentials:'include'}).then(r=>r.json()).then(j=>String((j.user||j).email||'').split('@')[1])`)
  const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(BASE)
  if (me !== (LOCAL ? 'local.dev' : 'uctintelligence.internal')) throw new Error('not a synthetic account')
  if (REPLAY_AT) {
    if (PROFILE) throw new Error('--replay-at needs the throwaway profile: a kept profile holds bars saved under another clock')
    if (OVERRIDE || STUB > 0 || DELAY_BARS > 0) throw new Error('--replay-at cannot be combined with --override, --stub or --delay-bars')
    throw new Error('--replay-at is not ported to the speed rig: run the owner-PC rig for a time-shift replay')
    const { createReplay } = await import('./replay.mjs')
    const { fileURLToPath } = await import('node:url')
    replay = await createReplay({
      c, run, base: BASE, at: REPLAY_AT, date: arg('replay-date', ''), lagMs: Number(arg('replay-lag-ms', '1500')),
      dump: arg('replay-dump', '') === '1', streams: arg('replay-streams', 'open'),
      wait1mMs: Number(arg('replay-1m-wait-ms', '1200')), days: Number(arg('replay-1m-days', '3')),
      minutePublishMs: Number(arg('replay-minute-publish-ms', '5000')),
      pushMs: Number(arg('replay-push-ms', '0')), pushLagMs: Number(arg('replay-push-lag-ms', '300')),
      dir: fileURLToPath(new URL('.', import.meta.url)),
    })
    out.replay = replay.report()
  }
  if (OVERRIDE) {
    if (STUB > 0) throw new Error('--override and --stub cannot be combined')
    const cut = OVERRIDE.indexOf('=')
    const part = OVERRIDE.slice(0, cut)
    const file = OVERRIDE.slice(cut + 1)
    if (cut < 1 || !/^[\w.-]+$/.test(part)) throw new Error('--override=<url part>=<file>')
    const body = Buffer.from(readFileSync(file, 'utf8') + '\n;globalThis.__uctOverride=(globalThis.__uctOverride||0)+1;\n').toString('base64')
    out.override = { part, file, served: [] }
    // A script already in the browser's disk cache is never offered to the interceptor (measured
    // 2026-11-13: fromDiskCache, zero pauses), so the cache is bypassed while the page loads.
    await c.send('Network.enable')
    await c.send('Network.setCacheDisabled', { cacheDisabled: true })
    await c.send('Fetch.enable', { patterns: [{ urlPattern: `*/assets/*${part}*` }] })
    c.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return
      const { requestId, request } = m.params
      out.override.served.push(new URL(request.url).pathname)
      c.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript; charset=utf-8' }, { name: 'Access-Control-Allow-Origin', value: '*' }], body }).catch(() => {})
    })
  }
  // --dist=<dir>: THIS RUN'S BROWSER ONLY runs the frontend built in <dir> (a local `vite build`)
  // against the site's real API. The page document and every /assets/ file that exists in <dir>
  // are answered from disk; everything else (the API, other static files) goes to the site. A
  // whole candidate build measured on production before it is merged: nothing is published.
  // ⛔ Build it with the site's own VITE_* values or its flags read "off" in the candidate.
  const DIST = arg('dist', '')
  // (2026-11-28, the cloud rig's build_ref) ONE Fetch interception carries both --dist and --isolate=browser: CDP's
  // Fetch.enable REPLACES the patterns of the call before it, and every listener sees every paused request, so each
  // handler answers only what it OWNS (distOwns / isoOwns) and the isolation's Fetch.enable re-sends distPatterns.
  let distPatterns = []
  let distOwns = () => false
  const isoOwns = (path) => ISOLATE === 'browser' && (path === '/api/auth/preferences' || path === '/api/workspace/doc' || path.startsWith('/api/workspace/doc/'))
  if (DIST) {
    if (OVERRIDE || STUB > 0) throw new Error('--dist cannot be combined with --override or --stub')
    const { lstatSync, realpathSync, readdirSync } = await import('node:fs')
    const { join, extname, sep } = await import('node:path')
    // (2026-11-28 audit) the build is the CANDIDATE's output: a symlink in it (assets/x.js -> /proc/self/environ, which
    // is THIS process's environment, BENCH_* included) would hand a file outside the build to the candidate's own page.
    // Only regular files, really inside the build directory, are ever served.
    const DIST_REAL = realpathSync(DIST)
    const inBuild = (f) => { try { const st = lstatSync(f); if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) return false; return realpathSync(f).startsWith(DIST_REAL + sep) } catch { return false } }
    if (!inBuild(join(DIST, 'index.html'))) throw new Error('--dist: index.html is not a regular file inside the build')
    const TYPES = { '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm' }
    const indexHtml = readFileSync(join(DIST, 'index.html'))
    const entry = (String(indexHtml).match(/\/assets\/index-[\w-]+\.js/) || [''])[0]
    if (!entry) throw new Error('--dist: no /assets/index-*.js in its index.html (is it a vite build?)')
    out.dist = { dir: DIST, entry, documents: 0, served: 0, passedOn: [] }
    // (2026-11-28 audit: the A/B was biased by construction) EVERY file is read and base64-encoded ONCE, here, before
    // the page loads: no readFileSync or encoding on the event loop while the sampler runs. Hashed assets are answered
    // as the CDN answers them (public, max-age=31536000, immutable: the browser keeps them and V8 their code cache);
    // the document no-store. Both sides of an A/B are builds served by this same code, so they meet identical headers.
    const ASSETS = new Map()
    const walk = (dir) => {
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const f = join(dir, ent.name)
        if (ent.isDirectory()) { walk(f); continue }
        if (!inBuild(f)) throw new Error('--dist: the build holds a symlink, hardlink or special file')
        ASSETS.set('/' + f.slice(DIST.length).replace(/^[\\/]+/, '').split(sep).join('/'), { type: TYPES[extname(f).toLowerCase()] || 'application/octet-stream', b64: readFileSync(f).toString('base64') })
      }
    }
    walk(join(DIST, 'assets'))
    out.dist.files = ASSETS.size
    const INDEX_B64 = Buffer.from(indexHtml).toString('base64')
    const IMMUTABLE = 'public, max-age=31536000, immutable'
    const origin = new URL(BASE).origin
    await c.send('Network.enable')
    await c.send('Network.setCacheDisabled', { cacheDisabled: true })
    await c.send('Network.setBypassServiceWorker', { bypass: true })
    distPatterns = [{ urlPattern: `${origin}/assets/*` }, { urlPattern: `${origin}/*`, resourceType: 'Document' }]
    distOwns = ({ request, resourceType }) => {
      try { const u = new URL(request.url); return u.origin === origin && (u.pathname.startsWith('/assets/') || (resourceType === 'Document' && !u.pathname.startsWith('/api/'))) } catch { return false }
    }
    await c.send('Fetch.enable', { patterns: [...distPatterns, ...(DELAY_BARS > 0 ? [{ urlPattern: '*/api/bars/*' }] : []), ...(replay ? replay.patterns : [])] })
    const answer = (requestId, type, b64, cacheControl) => c.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }, { name: 'Cache-Control', value: cacheControl }, { name: 'Access-Control-Allow-Origin', value: '*' }], body: b64 }).catch(() => {})
    c.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return
      const { requestId, request, resourceType } = m.params
      if (replay && replay.owns(m.params)) return    // the replay answers these (bars answers, the live feeds)
      const u = new URL(request.url)
      if (DELAY_BARS > 0 && u.pathname.startsWith('/api/bars/')) return    // the --delay-bars handler owns these
      if (isoOwns(u.pathname) && !distOwns(m.params)) return    // the --isolate=browser handler owns these
      if (u.pathname.startsWith('/assets/')) {
        const a = ASSETS.get(decodeURIComponent(u.pathname))
        if (a) { out.dist.served += 1; answer(requestId, a.type, a.b64, IMMUTABLE); return }
        if (out.dist.passedOn.length < 40) out.dist.passedOn.push(u.pathname)
      } else if (resourceType === 'Document' && !u.pathname.startsWith('/api/')) {
        out.dist.documents += 1
        answer(requestId, TYPES['.html'], INDEX_B64, 'no-store')
        return
      }
      c.send('Fetch.continueRequest', { requestId }).catch(() => {})
    })
  }
  if (DELAY_BARS > 0) {
    out.delayBars = { ms: DELAY_BARS, held: 0 }
    if (!DIST) await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/bars/*' }] })
    c.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return
      const { requestId, request } = m.params
      if (!new URL(request.url).pathname.startsWith('/api/bars/')) return
      out.delayBars.held += 1
      setTimeout(() => c.send('Fetch.continueRequest', { requestId }).catch(() => {}), DELAY_BARS)
    })
  }
  if (replay && !DIST) await replay.enable()   // (with --dist the interception above already carries the replay's patterns)
  // --console=<regex>: print (and keep in the result) every page console message matching it, e.g. a
  // throwaway instrumented build's `[lakedbg]` lines. Messages carry their own page clock if they need one.
  // (2026-11-21) PAGE ERRORS, always: every uncaught exception and console.error the page raises, with the
  // page time, kept in out.pageErrors (the owner's report needs them beside the timings)
  out.pageErrors = []
  c.on((m) => {
    try {
      if (m.method === 'Runtime.exceptionThrown') {
        const ex = m.params.exceptionDetails || {}
        if (out.pageErrors.length < 300) out.pageErrors.push({ kind: 'exception', t: m.params.timestamp, text: String((ex.exception && ex.exception.description) || ex.text || '').slice(0, 400), url: ex.url || null, line: ex.lineNumber ?? null })
      } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const text = (m.params.args || []).map((a) => a.value ?? a.description ?? '').join(' ')
        if (out.pageErrors.length < 300) out.pageErrors.push({ kind: 'console.error', t: m.params.timestamp, text: String(text).slice(0, 400) })
      }
    } catch { /* never breaks a run */ }
  })
  const CONSOLE = arg('console', '')
  if (CONSOLE) {
    const re = new RegExp(CONSOLE)
    out.console = []
    await c.send('Runtime.enable')
    c.on((m) => {
      if (m.method !== 'Runtime.consoleAPICalled') return
      const text = (m.params.args || []).map((a) => (a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description || a.type))).join(' ')
      if (!re.test(text)) return
      out.console.push(text)
      console.log(`console ${text}`)
    })
  }
  if (STUB > 0) {
    if (!LOCAL) throw new Error('--stub is for the local sandbox only: production is measured as it is')
    out.stub = { ms: STUB, asked: [] }
    const t0 = Date.now()
    await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/research/snapshot/*' }, { urlPattern: '*/api/adjustment-basis/*' }, { urlPattern: '*/api/chart/markers/*' }] })
    c.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return
      const { requestId, request } = m.params
      const u = new URL(request.url)
      const sym = decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')
      out.stub.asked.push({ u: u.pathname + u.search, at: Date.now() - t0 })
      let body = { earnings: [], splits: [], dividends: [] }
      if (u.pathname.includes('/research/snapshot/')) body = { sym, name: `${sym} Inc`, sector: 'Technology', industry: 'Software', composite: 40 + (sym.charCodeAt(0) % 50), components: {}, checkup: [], method: 'stub', metrics: { market_cap: `${sym.length}00.0B` }, next_earnings: '2026-12-01' }
      else if (u.pathname.includes('/adjustment-basis/')) body = { ticker: sym, tf: u.searchParams.get('tf') || 'D', adjustment_basis: { splits: true, dividends: null, as_of: '2024-06-10', applied_by: 'vendor' } }
      setTimeout(() => {
        c.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: Buffer.from(JSON.stringify(body)).toString('base64') }).catch(() => {})
      }, STUB)
    })
  }
  // (2026-11-28) TWO builds serve a page: the API pod's commit (/api/health) and the FRONT the browser runs
  // (/build.json: web-front's commit and build_id). They deploy apart (sweep 3: api 93b68df463 while the front served
  // 271b53f2d2), so both are recorded, at the start (out.build) and the end (out.buildEnd); `commit` stays the API's.
  out.build = await run(BUILDS_JS).catch(() => null)
  const serverDefs = await run(`fetch('/api/signature/definitions',{credentials:'include'}).then(r=>r.json()).then(j=>(j.definitions||[]).map(d=>d.id)).catch(()=>[])`)
  out.serverDefs = serverDefs
  let pick, watchKey
  if (LOCAL) {
    // the sandbox has no prebuilt lists: the run makes its own watchlist once (sandbox data only)
    const SYMS = (arg('syms', '') || 'NVDA,AAPL,MSFT,AMZN,META,GOOGL,TSLA,AMD,AVGO,NFLX,CRM,ORCL,ADBE,QCOM,MU,INTC,CSCO,IBM,TXN,AMAT,LRCX,KLAC,PANW,CRWD,SNOW,PLTR,SHOP,UBER,ABNB,COIN,HOOD,SOFI,JPM,GS,BAC,XOM,CVX,LLY,UNH,COST').split(',')
    const mine = await run(`fetch('/api/watchlists?include_items=0&include_prebuilt=0',{credentials:'include'}).then(r=>r.json())`)
    const all = Array.isArray(mine) ? mine : (mine.watchlists || mine.lists || [])
    pick = all.find((l) => l.name === 'flip-proof')
    if (!pick) {
      pick = await run(`fetch('/api/watchlists',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'flip-proof'})}).then(r=>r.json())`)
      pick = pick.watchlist || pick
      const added = await run(`fetch('/api/watchlists/${pick.id}/items/bulk',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols:${JSON.stringify(SYMS)}})}).then(r=>r.status)`)
      if (added !== 200) throw new Error('could not fill the sandbox watchlist: ' + added)
    }
    watchKey = `user:${pick.id}`
  } else {
    const prebuilt = await run(`fetch('/api/watchlists/prebuilt?include_items=0',{credentials:'include'}).then(r=>r.json())`)
    const lists = Array.isArray(prebuilt) ? prebuilt : (prebuilt.watchlists || prebuilt.lists || prebuilt.items || [])
    out.prebuilt = lists.slice(0, 40).map((l) => ({ id: l.id, name: l.name, n: l.item_count ?? l.count ?? (l.items ? l.items.length : null) }))
    const want = arg('list', '')
    pick = (want && lists.find((l) => String(l.name).toLowerCase().includes(want.toLowerCase())))
      || lists.find((l) => { const n = l.item_count ?? l.count ?? 0; return n >= 30 && n <= 120 }) || lists[0]
    if (!pick) throw new Error('no prebuilt list to scan')
    watchKey = `community:${pick.id}`
  }
  let freshList = null
  let listPicks = []
  if (FRESH_LIST.length) {
    // the cloud rig: the plan job drew these from the shared ledger (and recorded them there BEFORE this run)
    if (FRESH_N > 0 || TYPED_FRESH > 0) throw new Error('--fresh-list replaces --fresh-tickers / --typed-fresh: give one or the other')
    listPicks = FRESH_LIST
    // --reused=A,B (2026-11-28): the planned tickers the ledger had handed out before (past its reuse window): cold in
    // this fresh browser, maybe warm on the server; grade.py grades their switches apart from the never-used ones
    out.freshTickers = { source: 'plan', runId: arg('run-id', '') || null, list: listPicks, typed: TYPED.slice(),
      reused: arg('reused', '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) }
    console.log(`planned tickers: list ${listPicks.join(',')}; typed ${TYPED.join(',')}`)
  } else if (FRESH_N > 0 || TYPED_FRESH > 0) {
    // the liquid pool, built once (one /api/live-prices batch per 200 symbols; it reads quotes, it loads no bars)
    const poolFile = `${RIG_DIR}/liquid_pool.json`
    let pool = null
    try { pool = JSON.parse(readFileSync(poolFile, 'utf8')) } catch (e) { pool = null }
    // (owner rule) never reuse a ticker: a pool with too few unused names left is REBUILT from a fresh quote read of the
    // whole universe (today's volumes can admit names that failed before)
    let usedNow = new Set()
    try { usedNow = new Set(JSON.parse(readFileSync(`${RIG_DIR}/used_tickers.json`, 'utf8')).runs.flatMap((r) => r.tickers || [])) } catch (e) { /* none */ }
    const lowPool = pool && Array.isArray(pool.tickers) && pool.tickers.filter((x) => !usedNow.has(x.s)).length < (FRESH_N + TYPED_FRESH) + 200
    if (!pool || !Array.isArray(pool.tickers) || pool.tickers.length < 300 || lowPool) {
      const universe = JSON.parse(readFileSync(`${RIG_DIR}/cap_universe.json`, 'utf8'))
      const keep = []
      for (let k = 0; k < universe.length; k += 200) {
        const batch = universe.slice(k, k + 200)
        const q = await run(`fetch('/api/live-prices?tickers='+encodeURIComponent(${JSON.stringify(batch.join(','))}),{credentials:'include'}).then(r=>r.json()).catch(()=>({}))`)
        for (const s of batch) {
          const x = q && q[s]
          if (!x || typeof x.price !== 'number' || typeof x.volume !== 'number') continue
          if (x.price > 5 && x.price * x.volume > 5e6) keep.push({ s, p: x.price, dv: Math.round(x.price * x.volume) })
        }
      }
      pool = { built: new Date().toISOString(), rule: 'cap_universe ($300M+), price > $5, price x day volume > $5M', tickers: keep }
      writeFileSync(poolFile, JSON.stringify(pool))
      console.log(`liquid pool built: ${keep.length} of ${universe.length}`)
    }
    const ledgerFile = `${RIG_DIR}/used_tickers.json`
    let ledger = { runs: [] }
    try { ledger = JSON.parse(readFileSync(ledgerFile, 'utf8')) } catch (e) { /* a first run */ }
    const used = new Set(ledger.runs.flatMap((r) => r.tickers || []))
    const runId = `${OUT.replace(/\\/g, '/').split('/').slice(-2).join('/')}@${new Date().toISOString()}`
    let seed = 0
    for (const ch of runId) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }
    const free = pool.tickers.map((x) => x.s).filter((s) => !used.has(s))
    for (let k = free.length - 1; k > 0; k--) { const j = Math.floor(rnd() * (k + 1)); [free[k], free[j]] = [free[j], free[k]] }
    const need = FRESH_N + TYPED_FRESH
    if (free.length < need) throw new Error(`only ${free.length} unused liquid tickers left for ${need}: rebuild the pool or retire the ledger`)
    listPicks = free.slice(0, FRESH_N)
    const typedPicks = free.slice(FRESH_N, need)
    ledger.runs.push({ id: runId, at: new Date().toISOString(), out: OUT, list: listPicks, typed: typedPicks, tickers: [...listPicks, ...typedPicks] })
    writeFileSync(ledgerFile, JSON.stringify(ledger, null, 1))
    out.freshTickers = { runId, list: listPicks, typed: typedPicks, poolSize: pool.tickers.length, usedBefore: used.size }
    console.log(`fresh tickers (${runId}): list ${listPicks.join(',')}; typed ${typedPicks.join(',')}`)
    if (TYPED_FRESH > 0) { TYPED.length = 0; TYPED.push(...typedPicks) }
  }
  {
    if (listPicks.length) {
      const name = `rig-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`
      let made = await run(`fetch('/api/watchlists',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:${JSON.stringify(name)}})}).then(r=>r.json())`)
      made = made && (made.watchlist || made)
      if (!made || made.id == null) throw new Error('could not make the fresh watchlist')
      const added = await run(`fetch('/api/watchlists/${made.id}/items/bulk',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({symbols:${JSON.stringify(listPicks)}})}).then(r=>r.status)`)
      if (added !== 200) throw new Error('could not fill the fresh watchlist: ' + added)
      freshList = { id: made.id, name }
      freshCleanup = async () => run(`fetch('/api/watchlists/${made.id}',{method:'DELETE',credentials:'include'}).then(r=>r.status).catch(()=>null)`)
      pick = { id: made.id, name }
      watchKey = `user:${made.id}`
      console.log(`fresh watchlist ${name} (${made.id}) with ${listPicks.length} tickers (deleted at the end)`)
    }
  }
  out.list = { id: pick.id, name: pick.name, fresh: !!freshList }

  // ── --isolate=browser: THIS browser holds the account's board state (see the header) ─────────────────────────────
  // Board reads are the REAL read with this pass's board keys put in; board writes are answered here after the
  // measured origin round trip and never reach the account. Every other request is the production path; any other
  // WRITE the page sends (method + path only) is recorded in out.isolation.passedWrites, so a sweep can see what
  // still touches the shared account.
  let iso = null
  if (ISOLATE === 'browser') {
    if (LOCAL) throw new Error('--isolate=browser is for production: a sandbox has its own account')
    // --dist is combined (one Fetch.enable carries both pattern sets; each handler answers only what it owns)
    if (OVERRIDE || STUB > 0 || DELAY_BARS > 0 || REPLAY_AT) throw new Error('--isolate=browser cannot be combined with --override, --stub, --delay-bars or --replay-at (one Fetch interception per run)')
    // the account's own board revision and the origin's round trip for a board read (three reads, the median)
    const reads = []
    for (let k = 0; k < 3; k++) reads.push(await run(`(async()=>{const t0=performance.now();const r=await fetch('/api/auth/preferences',{credentials:'include',cache:'no-store'});await r.text();return {st:r.status,ms:Math.round((performance.now()-t0)*10)/10,stamp:r.headers.get('X-Workspace-Doc')}})()`))
    const stamp = (reads[reads.length - 1] || {}).stamp || ''
    const vm = /\bv=(\d+)/.exec(stamp)
    const rtt = reads.map((r) => r.ms).sort((a, b) => a - b)[1]
    iso = {
      mode: 'browser', store: {}, version: vm ? Number(vm[1]) : (/reason=absent/.test(stamp) ? 0 : null),
      rttMs: Math.max(20, Math.min(400, Math.round(rtt || 80))), reads: reads.map((r) => ({ st: r.st, ms: r.ms })),
      answered: { prefsRead: 0, prefsWrite: 0, docRead: 0, docApply: 0, docOther: 0 }, passedWrites: [], errors: [],
    }
    iso.accountVersionStart = iso.version
    // api/services/workspace_doc_store.py WORKSPACE_PREF_KEYS: the keys a write answers with a board revision
    const CHARTS_BOARD_KEYS = new Set(['aisearch_settings', 'breadth_widget_settings', 'chart_settings', 'charts_active_template', 'charts_merged', 'charts_theme', 'charts_vol_pane_pct', 'charts_workspace_groups', 'charts_workspace_layout', 'fundamentals_settings', 'theme_tracker_settings', 'watchlist_columns', 'watchlist_settings'])
    const origin = new URL(BASE).origin
    const fulfil = (requestId, code, body, headers = []) => c.send('Fetch.fulfillRequest', { requestId, responseCode: code, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Cache-Control', value: 'no-store' }, ...headers], body: Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)).toString('base64') }).catch(() => {})
    const later = (fn) => setTimeout(fn, iso.rttMs)
    const bodyOf = (request) => { try { const raw = request.postData ?? (request.postDataEntries || []).map((e) => Buffer.from(e.bytes || '', 'base64').toString('utf8')).join(''); return raw ? JSON.parse(raw) : {} } catch { return {} } }
    const stampHeader = () => (iso.version == null ? [] : [{ name: 'X-Workspace-Doc', value: `document; v=${iso.version}` }])
    const asText = (v) => (v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v))
    const pass = (requestId, atResponse) => c.send(atResponse ? 'Fetch.continueResponse' : 'Fetch.continueRequest', { requestId }).catch(() => {})
    await c.send('Fetch.enable', { patterns: [
      ...distPatterns,   // (--dist) Fetch.enable replaces the patterns before it: the candidate build's stay intercepted
      { urlPattern: `${origin}/api/auth/preferences*`, requestStage: 'Request' },
      { urlPattern: `${origin}/api/auth/preferences*`, requestStage: 'Response' },
      { urlPattern: `${origin}/api/workspace/doc*`, requestStage: 'Request' },
    ] })
    c.on(async (m) => {
      if (m.method !== 'Fetch.requestPaused') return
      const { requestId, request, responseStatusCode, responseHeaders } = m.params
      const atResponse = responseStatusCode !== undefined
      if (distOwns(m.params)) return   // the --dist handler answers the candidate's documents and assets
      try {
        const u = new URL(request.url)
        const path = u.pathname
        const method = request.method
        if (path === '/api/auth/preferences') {
          if (method === 'GET' && !atResponse) { pass(requestId, false); return }   // paused again with its answer
          if (method === 'GET') {
            const { body, base64Encoded } = await c.send('Fetch.getResponseBody', { requestId })
            const txt = base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body
            let prefs = null
            try { prefs = JSON.parse(txt) } catch { prefs = null }
            const hs = (responseHeaders || []).filter((h) => !/^(content-length|content-encoding|transfer-encoding|x-workspace-doc)$/i.test(h.name))
            if (responseStatusCode !== 200 || !prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
              c.send('Fetch.fulfillRequest', { requestId, responseCode: responseStatusCode, responseHeaders: hs, body: Buffer.from(txt).toString('base64') }).catch(() => {})
              return
            }
            const keysQ = u.searchParams.get('keys')
            const want = keysQ == null ? null : new Set(keysQ.split(',').map((k) => k.trim()).filter(Boolean))
            for (const [k, v] of Object.entries(iso.store)) if (!want || want.has(k)) prefs[k] = v
            iso.answered.prefsRead++
            c.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [...hs, ...stampHeader()], body: Buffer.from(JSON.stringify(prefs)).toString('base64') }).catch(() => {})
            return
          }
          if (method === 'POST') {
            const b = bodyOf(request)
            if (typeof b.key !== 'string') { later(() => fulfil(requestId, 422, { detail: 'speed rig: a preference write with no key' })); return }
            iso.store[b.key] = asText(b.value)
            iso.answered.prefsWrite++
            const versioned = CHARTS_BOARD_KEYS.has(b.key) && iso.version != null
            const answer = versioned ? { ok: true, version: ++iso.version } : { ok: true }
            later(() => fulfil(requestId, 200, answer))
            return
          }
          pass(requestId, atResponse)
          return
        }
        if (path === '/api/workspace/doc' || path.startsWith('/api/workspace/doc/')) {
          const boardQ = u.searchParams.get('board') || 'charts'
          if (method === 'GET' && path === '/api/workspace/doc' && boardQ === 'charts') {
            iso.answered.docRead++
            if (iso.version == null) later(() => fulfil(requestId, 404, { detail: 'Not Found' }))
            else { const v = iso.version; later(() => fulfil(requestId, 200, { board: 'charts', version: v, tombstone: false, source: 'document', doc: null, parse_failures: 0 })) }
            return
          }
          if (method === 'GET') { pass(requestId, false); return }   // version history, other boards' reads: real, read-only
          if (method === 'POST' && path === '/api/workspace/doc/apply') {
            const b = bodyOf(request)
            iso.answered.docApply++
            if ((b.board || 'charts') === 'charts') {
              if (iso.version == null) { later(() => fulfil(requestId, 404, { detail: 'Not Found' })); return }
              if (b.base_version !== iso.version) { const hv = iso.version; later(() => fulfil(requestId, 409, { detail: { code: 'workspace_conflict', head_version: hv, message: 'speed rig: a stale base' } })); return }
            }
            for (const [k, v] of Object.entries(b.prefs || {})) iso.store[k] = asText(v)
            const v = iso.version == null ? 0 : ++iso.version
            const keys = Object.keys(b.prefs || {})
            later(() => fulfil(requestId, 200, { board: b.board || 'charts', version: v, appended: true, prefs_written: keys, prefs_unchanged: [], prefs_failed: [], complete: true }))
            return
          }
          // restore, delete, anything else that would write the account's board: answered here, never sent
          iso.answered.docOther++
          const v = iso.version == null ? 0 : ++iso.version
          later(() => fulfil(requestId, 200, { board: boardQ, version: v, speedRig: 'isolated' }))
          return
        }
        pass(requestId, atResponse)
      } catch (e) {
        if (iso.errors.length < 40) iso.errors.push(String((e && e.message) || e).slice(0, 160))
        pass(requestId, atResponse)
      }
    })
    // what else the page writes to the shared account (method + path only: never a query, a body or a header)
    c.on((m) => {
      if (m.method !== 'Network.requestWillBeSent') return
      const rq = m.params.request || {}
      if (!rq.method || rq.method === 'GET' || rq.method === 'HEAD' || rq.method === 'OPTIONS') return
      let p = ''
      try { const u = new URL(rq.url); if (u.origin !== origin || !u.pathname.startsWith('/api/')) return; p = u.pathname } catch { return }
      if (p === '/api/auth/preferences' || p.startsWith('/api/workspace/doc')) return
      if (iso.passedWrites.length < 300) iso.passedWrites.push(`${rq.method} ${p.replace(/\/[0-9a-f-]{16,}(?=\/|$)/gi, '/<id>')}`)
    })
    out.isolation = iso
    console.log(`isolation: browser (board revision ${iso.version}, board writes answered after ${iso.rttMs} ms, the measured board-read round trip)`)
  } else out.isolation = { mode: 'account' }

  // A --tfs run clicks the chart's own timeframe buttons, and the bar sheds buttons that do not
  // fit: the chart is given more of the row then, so the buttons asked for are there to click.
  const CHART_W = (arg('tfs', '') || UPDOWN === 'tf') ? 19 : 16
  const layout = {
    widgets: [
      { id: 'flip-chart', type: 'chart', color: 'A', x: 0, y: 0, w: TF2 ? 8 : CHART_W, h: 20, opts: { tf: TF, settings: { indicatorInstances: SETS[SET], ...(EXT !== '' ? { extendedHoursShading: EXT === '1' } : {}), ...(HEADER.length || UPDOWN === 'tf' ? { header: { ...(HEADER.length ? { fields: HEADER } : {}), ...(UPDOWN === 'tf' ? { timeframes: TF_SEQ } : {}) } } : {}) } } },
      ...(TF2 ? [{ id: 'flip-chart-2', type: 'chart', color: 'A', x: 8, y: 0, w: 8, h: 20, opts: { tf: TF2, settings: { indicatorInstances: SETS[SET], ...(EXT !== '' ? { extendedHoursShading: EXT === '1' } : {}) } } }] : []),
      { id: 'flip-wl', type: 'watchlist', color: TF_NOLIST && UPDOWN === 'tf' ? 'B' : 'A', x: TF2 ? 16 : CHART_W, y: 0, w: TF2 ? 8 : 24 - CHART_W, h: 20, opts: { watchKey, watchName: pick.name } },
    ],
    cols: 24,
    version: 1,
  }
  if (BOARD) {
    const srcBoard = JSON.parse(readFileSync(BOARD, 'utf8'))
    const ws = Array.isArray(srcBoard) ? srcBoard : (srcBoard.widgets || [])
    const charts = ws.filter((w) => w.type === 'chart').slice(0, 2)
    const wl = ws.find((w) => w.type === 'watchlist')
    if (!charts.length) throw new Error('--board needs a chart')
    const renames = []
    if (USER_DEF) {
      const ud = JSON.parse(readFileSync(USER_DEF, 'utf8'))
      const oldId = ud.def_id || ud.id || (ud.definition && ud.definition.id)
      const def = { ...(ud.definition || ud) }
      delete def.id
      const made = await run(`fetch('/api/user-definitions',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ definition: def }))}}).then(async r=>({st:r.status,j:await r.json().catch(()=>null)}))`)
      const newId = made && made.j && (made.j.def_id || made.j.id || (made.j.definition && made.j.definition.id))
      if (made.st !== 200 || !newId) throw new Error(`user definition not created: ${made.st} ${JSON.stringify(made.j).slice(0, 300)}`)
      renames.push([oldId, newId])
      deleteCreatedDefs = async () => run(`fetch('/api/user-definitions/${newId}',{method:'DELETE',credentials:'include'}).then(r=>r.status)`)
      out.userDef = { from: oldId, created: newId }
      console.log(`user definition ${oldId} created on the bench account as ${newId} (deleted at the end)`)
    }
    if (USER_DEF_ID) { const [a0, z0] = USER_DEF_ID.split(':'); renames.push([a0, z0]); out.userDef = { from: a0, existing: z0 } }
    const fixOpts = (opts) => {
      let s = JSON.stringify(opts || {})
      for (const [a, z] of renames) s = s.split(a).join(z)
      const o = JSON.parse(s)
      if (DROP_USER && o.settings && Array.isArray(o.settings.indicatorInstances)) {
        o.settings.indicatorInstances = o.settings.indicatorInstances.filter((i) => !String(i.defId || '').startsWith('u_'))
      }
      return o
    }
    layout.widgets = [
      ...charts.map((w, k) => ({ ...w, id: k ? 'flip-chart-2' : 'flip-chart', color: 'A', opts: fixOpts(w.opts) })),
      ...(wl ? [{ ...wl, id: 'flip-wl', color: 'A', opts: { ...wl.opts, ...(freshList ? { watchKey, watchName: pick.name } : {}) } }] : []),
    ]
    if (srcBoard.cols) layout.cols = srcBoard.cols
    TF2 = charts[1] ? String((charts[1].opts && charts[1].opts.tf) || 'D') : ''
    out.board = { file: BOARD, charts: charts.length, watchKey: wl && wl.opts && wl.opts.watchKey, dropUser: DROP_USER, renames }
  }
  const groups = { A: 'SPY', B: null, C: null, D: null }
  if (UPDOWN === 'tabs') {
    if (!TAB_B) throw new Error('--pattern=tabs needs --tab-b=<board.json>')
    const srcB = JSON.parse(readFileSync(TAB_B, 'utf8'))
    const wsB = Array.isArray(srcB) ? srcB : (srcB.widgets || [])
    let nChart = 0
    const layoutB = { widgets: wsB.map((w) => (TAB_B_IDS === 'own' ? { ...w, id: `b-${w.id}`, color: 'A' } : (w.type === 'chart' ? { ...w, id: nChart++ ? 'flip-chart-2' : 'flip-chart', color: 'A' } : (w.type === 'watchlist' ? { ...w, id: 'flip-wl', color: 'A' } : w)))), cols: srcB.cols || 24, version: 1 }
    out.tabBIds = TAB_B_IDS
    const mk = async (name, lay) => run(`fetch('/api/charts/layouts',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ scope: 'user', name, layout: lay, groups, create_only: true }))}}).then(async r=>({st:r.status,j:await r.json().catch(()=>null)}))`)
    // (owner3, 2026-11-27) a run a server boot stopped leaves its two layouts behind, and every later run is refused 409
    // ("You already have a layout with that name"): the bench account's own leftovers of those two names are deleted first
    const leftovers = await run(`fetch('/api/charts/layouts',{credentials:'include'}).then(r=>r.json()).then(j=>(j.mine||[]).filter(t=>t.name===${JSON.stringify(TAB_A_NAME)}||t.name===${JSON.stringify(TAB_B_NAME)}).map(t=>t.id))`)
    for (const id of leftovers || []) {
      const st = await run(`fetch('/api/charts/layouts/${id}',{method:'DELETE',credentials:'include'}).then(r=>r.status)`)
      console.log(`leftover tab layout ${id} deleted: ${st}`)
    }
    out.tabsLeftoversDeleted = leftovers || []
    const a = await mk(TAB_A_NAME, layout)
    const z = await mk(TAB_B_NAME, layoutB)
    const made = [a, z].map((x) => x && x.j && x.j.id).filter((x) => x != null)
    const dockBefore = await run(`fetch('/api/auth/preferences',{credentials:'include'}).then(r=>r.json()).then(p=>{const q=p.preferences||p;return q.charts_layout_dock===undefined?null:q.charts_layout_dock})`)
    tabsCleanup = async () => {
      const del = []
      for (const id of made) del.push(await run(`fetch('/api/charts/layouts/${id}',{method:'DELETE',credentials:'include'}).then(r=>r.status)`))
      const v = dockBefore == null ? '' : (typeof dockBefore === 'string' ? dockBefore : JSON.stringify(dockBefore))
      const st = await run(`fetch('/api/auth/preferences',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ key: 'charts_layout_dock', value: v }))}}).then(r=>r.status)`)
      return { deleted: del, dockRestored: st }
    }
    if (a.st !== 200 || z.st !== 200 || made.length !== 2) throw new Error(`tab layouts not made: ${a.st} ${z.st} ${JSON.stringify([a.j, z.j]).slice(0, 300)}`)
    const dock = JSON.stringify({ pins: made, known: made, hidden: false })
    const dst = await run(`fetch('/api/auth/preferences',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ key: 'charts_layout_dock', value: dock }))}}).then(r=>r.status)`)
    if (dst !== 200) throw new Error(`dock pref refused: ${dst}`)
    activeTemplate = JSON.stringify({ id: made[0], name: TAB_A_NAME, scope: 'user' })
    out.tabs = { layouts: made, dockBefore }
    console.log(`two layouts made on the bench account: ${made.join(', ')} (deleted at the end)`)
  }
  if (LOCAL) {
    // the sandbox has no document store: the two board keys are written through the preferences door
    for (const [key, value] of [['charts_workspace_layout', JSON.stringify(layout)], ['charts_workspace_groups', JSON.stringify(groups)]]) {
      const st = await run(`fetch('/api/auth/preferences',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:${JSON.stringify(JSON.stringify({ key, value }))}}).then(r=>r.status)`)
      if (st !== 200) throw new Error(`sandbox preference ${key} refused: ${st}`)
    }
  } else {
    // --restore=<version>: put that recorded version of the bench board back and stop. For a run
    // whose own restore was refused (see the retry below).
    const only = arg('restore', '')
    if (only) { originalVersion = Number(only); out.restoreOnly = originalVersion; throw new Error('restore-only run: no measurement') }
    if (iso) {
      // the board lives in this browser's store: the account's own board is never read for a restore nor written
      Object.assign(iso.store, { charts_workspace_layout: JSON.stringify(layout), charts_workspace_groups: JSON.stringify(groups), charts_active_template: activeTemplate })
      out.boardVersionBefore = iso.version
    } else {
      originalVersion = await board.head()
      out.boardVersionBefore = originalVersion
      // ⛔ The active-layout pointer is cleared with the board (2026-11-16): Signature Release 2
      // moves an account whose pointer is still 'uct-default' to a BLANK board on load
      // (ChartsWorkspace applyUctDefault), so a test board applied under that pointer never
      // mounts ("reading 'engineSeries'" of undefined). The restore puts the pointer back.
      const applied = await board.apply(originalVersion, { charts_workspace_layout: JSON.stringify(layout), charts_workspace_groups: JSON.stringify(groups), charts_active_template: activeTemplate })
      if (applied.status !== 200) throw new Error(`test board refused: ${applied.status} ${JSON.stringify(applied.body).slice(0, 300)}`)
    }
  }
  save()

  // --ls=key=value[,key=value]: localStorage set before the page under test loads (e.g. a kill switch)
  const lsArg = arg('ls', '')
  if (lsArg) {
    const pairs = lsArg.split(',').map((kv) => kv.split('='))
    out.localStorage = Object.fromEntries(pairs)
    await run(`(()=>{for(const [k,v] of ${JSON.stringify(pairs)}){ if(v==='') localStorage.removeItem(k); else localStorage.setItem(k,v) } return true})()`)
  }
  // ⛔ A persistent profile REMEMBERS the kill switch. A control run with `--ls=uct.indwarm.off=1`
  // leaves it set, and the next run then measures the OFF state while looking like a normal run
  // (it happened on 2026-11-12). The state in force is recorded and printed with every result.
  out.warmSwitch = await run(`(()=>{try{return localStorage.getItem('uct.indwarm.off')}catch(e){return 'unreadable'}})()`)
  console.log(`indicator pre-load: ${out.warmSwitch === '1' ? 'SWITCHED OFF in this profile (uct.indwarm.off=1)' : 'on'}`)
  // every per-browser switch this work reads, as this profile holds it for THIS run
  out.switches = await run(`(()=>{const o={};for(const k of ['uct.indwarm.off','uct.rsdisk.off','uct.restgate.off','uct.plotwindow.off','uct.deviceStore','uct.neighborframes','uct.boardKeepAlive']){try{o[k]=localStorage.getItem(k)}catch(e){o[k]='unreadable'}}return o})()`)
  console.log(`switches: ${JSON.stringify(out.switches)}`)
  // ⛔ EVERY REQUEST FROM THE PAGE LOAD ON, not only those inside a flip (2026-11-15). Each flip's
  // `res` starts empty, so what the page asked for before the first key press (a list's up-front
  // warm) was invisible: a run with no server-lane request in it read as "zero requests" while
  // the warm had answered every row before the walk began. The browser keeps 250 entries by
  // default; the buffer is raised before the page loads and the whole timeline is kept as
  // out.allRes after the flips (same clock as each flip's `key`).
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{performance.setResourceTimingBufferSize(50000)}catch(e){}` })
  // THE PRESENTATION STAMP: every chart paint (lightweight-charts' rAF draw) and when its frame was presented
  if (PIXELS) await c.send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(new URL('./paint-probe.js', import.meta.url), 'utf8') })
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: readFileSync(new URL('./phase-hooks.js', import.meta.url), 'utf8') })   // (cold-arch) per-request phases
  // --idbtrace: every IndexedDB transaction the page opens (database, mode, stores, when it was
  // created, when it finished) and every get/put request inside it (store, key, how long), into
  // out.idbTrace for idb-trace-report.mjs. Installed before the page loads; times are the page's
  // performance.now(), the same clock the flips' `key` uses. Observes only: nothing is changed.
  if (arg('idbtrace', '')) {
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(()=>{
      if (window.__idbTrace) return
      const T = window.__idbTrace = { tx: [], req: [] }
      const now = () => performance.now()
      const keyOf = (k) => { try { return typeof k === 'string' ? k.slice(0, 40) : JSON.stringify(k).slice(0, 40) } catch (e) { return '?' } }
      const tx0 = IDBDatabase.prototype.transaction
      IDBDatabase.prototype.transaction = function (stores, mode, opts) {
        const tx = tx0.call(this, stores, mode, opts)
        const rec = { db: this.name, mode: mode || 'readonly', stores: [].concat(stores).join(','), t0: now(), end: null, how: null, n: 0 }
        if (T.tx.length < 60000) T.tx.push(rec)
        tx.__rec = rec
        tx.addEventListener('complete', () => { rec.end = now(); rec.how = 'complete' })
        tx.addEventListener('abort', () => { rec.end = now(); rec.how = 'abort' })
        tx.addEventListener('error', () => { if (!rec.end) { rec.end = now(); rec.how = 'error' } })
        return tx
      }
      for (const op of ['get', 'put', 'getAll', 'delete', 'add', 'openCursor', 'count', 'clear']) {
        const f = IDBObjectStore.prototype[op]
        if (!f) continue
        IDBObjectStore.prototype[op] = function (...a) {
          const r = f.apply(this, a)
          const tx = this.transaction && this.transaction.__rec
          if (tx) tx.n++
          const rec = { op, store: this.name, key: keyOf(op === 'put' || op === 'add' ? a[1] ?? (a[0] && (a[0].key || a[0].id)) : a[0]), t0: now(), end: null, tx: tx ? T.tx.indexOf(tx) : -1 }
          if (T.req.length < 200000) T.req.push(rec)
          r.addEventListener('success', () => { rec.end = now() })
          r.addEventListener('error', () => { rec.end = now(); rec.err = 1 })
          return r
        }
      }
    })()` })
    out.idbtrace = true
  }
  if (replay) await replay.startClock()   // from here the page's Date.now() is the replay instant, at real speed
  await charts()
  if (replay) { out.replay = { ...replay.report(), clock: await replay.prove() }; save() }
  await waitFor(`!!(window.__uctChartDebug && window.__uctChartDebug['flip-chart'] && window.__uctChartDebug['flip-chart'].newestBar())`, 240000)
  // (owner2) a board with no watchlist (the TC2000 board: one chart) has no rows to wait for
  if (layout.widgets.some((w) => w.type === 'watchlist')) await waitFor(`document.querySelectorAll('[data-watch-sym]').length >= ${freshList ? Math.min(8, FRESH_N) : 8}`, 90000)   // a fresh list may be shorter than 8
  // The marker is read on EVERY run: a run without --override that finds it is running an
  // override left in this profile's cache, and would report it as the shipped script.
  const overrideRan = await run(`globalThis.__uctOverride || 0`)
  if (out.override) {
    out.override.ran = overrideRan
    await c.send('Network.disable') // the cache is back in use for the measured flips
    console.log(`override: ${out.override.part} served ${out.override.served.length} time(s) as ${[...new Set(out.override.served)].join(', ')}; ran ${out.override.ran}`)
    if (out.override.ran !== 1) throw new Error('the override file did not run exactly once in the page: this run would measure the shipped script')
  } else if (overrideRan !== 0) throw new Error('an override script from an earlier run is still being served to this profile: clear its cache')
  if (DIST) {
    const runsIt = await run(`!!document.querySelector('script[src*=${JSON.stringify(out.dist.entry)}]')`)
    console.log(`dist: ${out.dist.documents} document(s) and ${out.dist.served} asset(s) answered from ${DIST}; the page runs its entry script: ${runsIt}`)
    if (!runsIt) throw new Error('the page is not running the candidate build: this run would measure the shipped one')
    // (2026-11-28) the candidate is loaded: the browser's HTTP cache is back in use for the measured switches, as it is
    // in a production pass (an API answer the site lets the browser keep is kept). The candidate's own hashed chunks are
    // not in the cache, so they still reach the interception; one with production's name and hash is the same bytes.
    await c.send('Network.setCacheDisabled', { cacheDisabled: false })
    out.dist.cacheAfterLoad = 'enabled'
  }
  await sleep(WARMUP) // the list's own up-front warm (and, on a new profile, the bars pack ingest)
  if (arg('lake-probe', '')) {
    const syms = arg('lake-probe', '').split(',').filter(Boolean)
    const picks = arg('lake-picks', '1:2012-05,5:2016Q1,15:2009,30:2020,60:2007,60e:2023').split(',').map((x) => x.split(':'))
    const fn = readFileSync(new URL('./lake-probe.js', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '')
    out.lakeProbe = await run(`(${fn.trim()})(${JSON.stringify(syms)}, ${JSON.stringify(picks)})`)
    console.log(`lake probe: ${JSON.stringify(out.lakeProbe).slice(0, 4000)}`)
    save()
  }
  const memNow = async () => {
    try { await c.send('HeapProfiler.collectGarbage') } catch (e) { /* not offered */ }
    let hu = null
    try { hu = await c.send('Runtime.getHeapUsage') } catch (e) { /* not offered */ }
    return { usedMB: hu ? Math.round(hu.usedSize / 1e5) / 10 : null, totalMB: hu ? Math.round(hu.totalSize / 1e5) / 10 : null, ...(await run(`(()=>{const cs=[...document.querySelectorAll('canvas')];let px=0;for(const c of cs)px+=c.width*c.height;return {canvases:cs.length,canvasMpx:Math.round(px/1e4)/100,charts:Object.keys(window.__uctChartDebug||{}).length,perfHeapMB:performance.memory?Math.round(performance.memory.usedJSHeapSize/1e5)/10:null}})()`)) }
  }
  if (LIVE_PROBE_MS > 0) {
    out.liveProbe = await run(`(async()=>{const ms=${LIVE_PROBE_MS};const t0=performance.now();const W=()=>document.querySelector('[data-widget-id="flip-chart"]');let last=null,lastH=null,closeMoves=[],timeMoves=[],headMoves=[],samples=0;const at=()=>Math.round(performance.now()-t0);while(performance.now()-t0<ms){samples++;let nb=null;try{const h=(window.__uctChartDebug||{})['flip-chart'];nb=h&&h.newestBar()}catch(e){}const g=W()&&[...W().querySelectorAll('[data-day-gain]')].find((e)=>!e.closest('[inert]'));const ht=g?g.textContent:null;if(nb){if(last){if(nb.close!==last.close)closeMoves.push(at());if(nb.time!==last.time)timeMoves.push(at())}last={close:nb.close,time:nb.time}}if(ht!==lastH){if(lastH!==null)headMoves.push(at());lastH=ht}await new Promise(r=>setTimeout(r,100))}const gap=(a)=>{let m=a.length?a[0]:ms;for(let i=1;i<a.length;i++)m=Math.max(m,a[i]-a[i-1]);if(a.length)m=Math.max(m,ms-a[a.length-1]);return m};return {ms,samples,closeMoves:closeMoves.length,barTimeMoves:timeMoves.length,headerMoves:headMoves.length,maxCloseGapMs:gap(closeMoves),maxHeaderGapMs:gap(headMoves),lastBar:last,header:lastH}})()`)
    console.log(`live probe: ${JSON.stringify(out.liveProbe)}`)
    save()
  }
  if (LIVE_ACC) {
    out.liveAccuracy = await run(`(async()=>{const tfs=${JSON.stringify((layout.widgets || []).filter((w) => w.type === 'chart').map((w) => String((w.opts && w.opts.tf) || 'D')))};const sel=document.querySelector('[data-watch-sym][aria-selected="true"]');const sym=(sel&&sel.getAttribute('data-watch-sym'))||'SPY';const d=window.__uctChartDebug||{};const ids=['flip-chart','flip-chart-2'];const ts=(t)=>{if(t==null)return null;if(typeof t==='number')return t>1e12?t/1000:t;if(typeof t==='object'&&t.year)return Date.UTC(t.year,t.month-1,t.day)/1000;const x=Date.parse(t);return isNaN(x)?null:x/1000};const norm=(j)=>{const a=Array.isArray(j)?j:(j&&(j.bars||j.data||j.candles))||[];return a.map((x)=>({t:ts(x.t!=null?x.t:x.time),o:x.o!=null?x.o:x.open,h:x.h!=null?x.h:x.high,l:x.l!=null?x.l:x.low,c:x.c!=null?x.c:x.close,v:x.v!=null?x.v:x.volume})).filter((x)=>x.t!=null)};const get=async(tf,n)=>{try{const r=await fetch('/api/bars/'+encodeURIComponent(sym)+'?tf='+tf+'&bars='+n+(tf==='D'||tf==='W'||tf==='M'?'':'&session=rth'),{credentials:'include'});return norm(await r.json())}catch(e){return []}};const etDay=(s)=>new Date((s-5*3600)*1000).toISOString().slice(0,10);const agg=(m1,lo,hi)=>{const xs=m1.filter((x)=>x.t>=lo&&x.t<hi);if(!xs.length)return null;let h=-1e18,l=1e18,v=0;for(const x of xs){if(x.h>h)h=x.h;if(x.l<l)l=x.l;v+=x.v||0}return {o:xs[0].o,h,l,c:xs[xs.length-1].c,v,n:xs.length}};const win=(tf,barT,m1)=>{if(tf==='D'){const last=m1.length?m1[m1.length-1].t:null;if(last==null)return null;const day=etDay(last);const xs=m1.filter((x)=>etDay(x.t)===day);return xs.length?[xs[0].t,last+60]:null}const mins=Number(tf);if(!mins)return null;const last=m1.length?m1[m1.length-1].t:null;for(const off of [0,-18000,-14400,18000,14400]){const lo=barT+off;if(last!=null&&last>=lo&&last<lo+mins*60)return [lo,lo+mins*60]}return null};const same=(a,b2)=>a&&b2&&Math.abs(a.o-b2.o)<0.011&&Math.abs(a.h-b2.h)<0.011&&Math.abs(a.l-b2.l)<0.011&&Math.abs(a.c-b2.c)<0.011;const once=async()=>{const bars={};ids.forEach((id,k)=>{const h=d[id];let t=null;try{t=h&&h.renderedTail?h.renderedTail(1):null}catch(e){}bars[id]=t&&t[0]?{t:ts(t[0].time),o:t[0].open,h:t[0].high,l:t[0].low,c:t[0].close,tf:tfs[k]}:null});const etMin=(s)=>Math.floor((((s-5*3600)%86400)+86400)%86400/60);const m1=(await get('1',900)).filter((x)=>{const m=etMin(x.t);return m>=570&&m<${RTH_CLOSE}});const res={};for(const id of ids){const cb=bars[id];if(!cb)continue;const w=win(cb.tf,cb.t,m1);const a=w?agg(m1,w[0],w[1]):null;const api=await get(cb.tf,3);const al=api.length?api[api.length-1]:null;res[id]={tf:cb.tf,chart:cb,agg1m:a,apiForming:al,chartMatches:same(cb,a),apiMatches:same(al,a),apiVolumeMatches:!!(al&&a&&Math.abs((al.v||0)-a.v)<=Math.max(1,0.005*a.v))}}return {m1n:m1.length,m1last:m1.length?m1[m1.length-1]:null,res}};const a1=await once();await new Promise((r)=>setTimeout(r,3000));const a2=await once();const verdict={};for(const id of ids){const x=a1.res[id],y=a2.res[id];if(!x&&!y)continue;verdict[id]={chart:!!((x&&x.chartMatches)||(y&&y.chartMatches)),api:!!((x&&x.apiMatches)||(y&&y.apiMatches)),apiVolume:!!((x&&x.apiVolumeMatches)||(y&&y.apiVolumeMatches))}}return {sym,verdict,first:a1,second:a2}})()`)
    console.log(`live accuracy: ${JSON.stringify(out.liveAccuracy.verdict)} (${out.liveAccuracy.sym})`)
    save()
  }
  const heapSampleSummary = (profile) => {
    const base = (u) => { const s = String(u || ''); const q = s.split('?')[0]; return q.slice(q.lastIndexOf('/') + 1) || '(native)' }
    const fr = (n) => `${n.callFrame.functionName || '(anonymous)'}@${base(n.callFrame.url)}:${n.callFrame.lineNumber + 1}:${n.callFrame.columnNumber + 1}`
    const sites = []
    const byChunk = {}
    let total = 0
    const walk = (n, stack) => {
      const here = [...stack, fr(n)]
      if (n.selfSize > 0) {
        total += n.selfSize
        const ch = base(n.callFrame.url)
        byChunk[ch] = (byChunk[ch] || 0) + n.selfSize
        sites.push({ size: n.selfSize, frame: here[here.length - 1], stack: here.slice(-8).reverse() })
      }
      for (const k of n.children || []) walk(k, here)
    }
    walk(profile.head, [])
    const byFrame = {}
    for (const s of sites) byFrame[s.frame] = (byFrame[s.frame] || 0) + s.size
    const mb = (x) => Math.round(x / 1e4) / 100
    return {
      totalMB: mb(total),
      byChunk: Object.entries(byChunk).sort((x, y) => y[1] - x[1]).slice(0, 20).map(([k, v]) => ({ chunk: k, MB: mb(v) })),
      byFrame: Object.entries(byFrame).sort((x, y) => y[1] - x[1]).slice(0, 30).map(([k, v]) => ({ frame: k, MB: mb(v) })),
      topStacks: sites.sort((x, y) => y.size - x.size).slice(0, 25).map((s) => ({ MB: mb(s.size), stack: s.stack })),
    }
  }
  if (HEAP_SAMPLE_N > 0) {
    await c.send('HeapProfiler.enable')
    await c.send('HeapProfiler.collectGarbage')
    await c.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: false, includeObjectsCollectedByMinorGC: false })
  }
  // a press's frames: the first frame showing the new symbol per chart, then every later change of what the member sees
  const analyzeJump = (frames, keyT, ms) => {
    const out = { charts: {}, wl: [], flags: 0 }
    const key = (nb) => (nb ? `${typeof nb[0] === 'object' ? JSON.stringify(nb[0]) : nb[0]}|${nb[1]}` : '')
    const pre = frames.filter((f) => f.t < keyT)
    const post = frames.filter((f) => f.t >= keyT && f.t <= keyT + ms)
    let firstShownT = null
    for (const id of ['flip-chart', 'flip-chart-2']) {
      const b0 = pre.length ? pre[pre.length - 1].c[id] : null
      const bk = b0 ? key(b0.nb) : null
      const k = post.findIndex((f) => f.c[id] && key(f.c[id].nb) !== bk)
      if (k < 0) { out.charts[id] = { shown: null }; continue }
      const s = post[k].c[id]
      const rel = (x) => (x && x.lr && x.ni != null ? [x.lr[0] - x.ni, x.lr[1] - x.ni] : null)
      const r0 = rel(s)
      const ev = []
      let last = s
      for (let j = k + 1; j < post.length; j++) {
        const x = post[j].c[id]
        if (!x) continue
        const fi = j - k
        const dt = Math.round(post[j].t - post[k].t)
        if (key(x.nb) !== key(last.nb) && x.nb && last.nb && String(x.nb[0]) !== String(last.nb[0])) ev.push({ f: fi, dt, kind: 'bars-replaced', from: last.nb, to: x.nb })
        if (x.ni != null && last.ni != null && x.ni !== last.ni && (!x.nb || !last.nb || String(x.nb[0]) === String(last.nb[0]))) ev.push({ f: fi, dt, kind: 'history-grew', bars: x.ni - last.ni })
        const r1 = rel(x), rl = rel(last)
        if (r1 && rl) {
          const w0 = rl[1] - rl[0], w1 = r1[1] - r1[0]
          if (Math.abs(w1 - w0) > Math.max(1, 0.02 * w0)) ev.push({ f: fi, dt, kind: 'zoom', bars: Math.round((w1 - w0) * 10) / 10, width: Math.round(w1) })
          else if (Math.abs(r1[1] - rl[1]) > 0.5) ev.push({ f: fi, dt, kind: 'time-shift', bars: Math.round((r1[1] - rl[1]) * 10) / 10 })
        }
        if (x.r && last.r && (Math.abs(x.r[2] - last.r[2]) > 1 || Math.abs(x.r[3] - last.r[3]) > 1 || Math.abs(x.r[0] - last.r[0]) > 1 || Math.abs(x.r[1] - last.r[1]) > 1)) ev.push({ f: fi, dt, kind: 'pane-reflow', from: last.r, to: x.r })
        if (x.y0 != null && last.y0 != null && x.y1 != null && last.y1 != null && x.nb && last.nb && x.nb[1] === last.nb[1]) {
          const span0 = Math.abs(last.y1 - last.y0), span1 = Math.abs(x.y1 - x.y0)
          const ph = (x.r && x.r[3]) || 400
          if (span0 > 0 && Math.abs(span1 - span0) / span0 > 0.01) ev.push({ f: fi, dt, kind: 'price-rescale', pct: Math.round(1000 * (span1 - span0) / span0) / 10 })
          else if (Math.abs(x.y0 - last.y0) > 0.01 * ph) ev.push({ f: fi, dt, kind: 'price-shift', px: Math.round(x.y0 - last.y0) })
        }
        last = x
      }
      const lastF = [...post].reverse().find((f) => f.c[id]) || post[k]
      const finalDt = ev.length ? ev[ev.length - 1].dt : 0
      out.charts[id] = { shown: Math.round(post[k].t - keyT), frame: k, barsFirst: s.ni != null ? s.ni + 1 : null, barsFinal: lastF.c[id] && lastF.c[id].ni != null ? lastF.c[id].ni + 1 : null,
        final: Math.round(post[k].t - keyT) + finalDt, events: ev }
      out.flags += ev.length
      if (firstShownT == null || post[k].t < firstShownT) firstShownT = post[k].t
    }
    if (firstShownT != null) {
      const after = post.filter((f) => f.t >= firstShownT && f.wl)
      for (let j = 1; j < after.length; j++) {
        const a = after[j - 1].wl, z = after[j].wl
        if (a.s !== z.s) continue
        if (Math.abs((z.st || 0) - (a.st || 0)) > 1 || Math.abs(z.top - a.top) > 1) out.wl.push({ dt: Math.round(after[j].t - firstShownT), kind: 'list-move', scroll: (z.st || 0) - (a.st || 0), rowTop: z.top - a.top })
      }
      out.flags += out.wl.length
    }
    return out
  }
  const castFrames = []
  let castDir = null
  if (CAST.size) c.on((m) => { if (castDir && m.method === 'Page.screencastFrame') { castFrames.push({ dir: castDir, data: m.params.data, t: m.params.metadata && m.params.metadata.timestamp }); c.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {}) } })
  const castStart = async (i) => { if (!CAST.has(i)) return; castDir = OUT.replace(/\.json$/, '') + `.cast${i}`; mkdirSync(castDir, { recursive: true }); await c.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 }) }
  const castStop = async () => { if (!castDir) return; await c.send('Page.stopScreencast').catch(() => {}); let n = 0; const idx = []; for (const f of castFrames.splice(0)) { const nm = `f${String(n++).padStart(3, '0')}.png`; writeFileSync(`${f.dir}/${nm}`, Buffer.from(f.data, 'base64')); idx.push({ f: nm, epochS: f.t }) } writeFileSync(`${castDir}/index.json`, JSON.stringify({ timeOrigin: out.timeOrigin || null, frames: idx })); console.log(`screencast: ${n} frames -> ${castDir}`); castDir = null }
  const jumpRaw = []
  let heapSink = null
  if (HEAP_AT.size) c.on((m) => { if (heapSink != null && m.method === 'HeapProfiler.addHeapSnapshotChunk') writeSync(heapSink, m.params.chunk) })
  const heapSnapshot = async (tag) => {
    try { await c.send('HeapProfiler.enable') } catch (e) { /* on */ }
    await c.send('HeapProfiler.collectGarbage')
    const file = OUT.replace(/\.json$/, '') + `.heap${tag}.heapsnapshot`
    heapSink = openSync(file, 'w')
    const t0 = Date.now()
    try { await c.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false }) } finally { closeSync(heapSink); heapSink = null }
    const widgets = await run(`(()=>{return [...document.querySelectorAll('[data-widget-id]')].map((w)=>{const cs=[...w.querySelectorAll('canvas')];return {id:w.getAttribute('data-widget-id'),canvases:cs.length,inertCanvases:cs.filter((x)=>!!x.closest('[inert]')).length,mpx:Math.round(cs.reduce((a,x)=>a+x.width*x.height,0)/1e4)/100}})})()`)
    const usage = await c.send('Runtime.getHeapUsage').catch(() => null)
    ;(out.heap = out.heap || []).push({ tag, file, ms: Date.now() - t0, usedMB: usage ? Math.round(usage.usedSize / 1e5) / 10 : null, widgets })
    console.log(`heap snapshot ${tag}: ${JSON.stringify(out.heap[out.heap.length - 1])}`)
    save()
  }
  if (HEAP_AT.has(0)) await heapSnapshot(0)
  if (MEM_PROBE) { out.memStart = await memNow(); console.log(`memory at the start: ${JSON.stringify(out.memStart)}`); save() }
  if (DB_STATS) { out.dbStart = await run(`(()=>{const s=window.__uctDoubleBuffer;return s?JSON.parse(JSON.stringify({flips:s.flips,switches:s.switches,why:s.why,retargets:s.retargets,log:Array.isArray(s.log)?s.log.slice(-300):undefined,last:Array.isArray(s.last)?s.last.slice(-32):undefined})):null})()`); save() }
  if (replay) {
    out.replay = await replay.finalReport(); save()
    replay.assertSane()   // stops the run when the page cannot have been replaying (wrong day, nothing rewritten)
    console.log(`replay: after the warm-up the page clock reads ${out.replay.pageNowUtc}; ${out.replay.bars.rewritten} bars answers rewritten, ${out.replay.own.ok} of ${out.replay.own.asked} 1m books fetched; first 1m answer ${JSON.stringify(out.replay.day.firstMinuteAnswer)}; minute feed ${JSON.stringify(out.replay.minuteFeed)}`)
  }
  if (arg('wait-device', '') === '1') {
    const t0 = Date.now()
    for (;;) {
      const st = await run(OPFS_JS)
      if (st.ok >= 6) { out.deviceWait = { msAfterWarmup: Date.now() - t0, ok: st.ok, files: st.files, estimate: st.estimate, persisted: st.persisted }; break }
      if (Date.now() - t0 > 480000) { out.deviceWait = { timeout: true, ok: st.ok, files: st.files, err: st.err || null }; break }
      await sleep(3000)
    }
    out.deviceCookie = await run(`document.cookie.split(';').some((x)=>x.trim().startsWith('uct_chart_speed='))`)   // presence only: a cookie VALUE never enters a result
    console.log(`device seed: ${JSON.stringify({ ...out.deviceWait, files: undefined })}`)
    save()
  }
  out.pack = await run(`(()=>{const o={};for(const k of ['barspack.version','barspack.seed','barspack.hotVersion','intradaypack.version','breadthpack.version']){try{o[k]=localStorage.getItem(k)}catch(e){o[k]='ERR'}}return o})()`)
  out.page = await run(`({hidden:document.hidden,w:innerWidth,h:innerHeight,x:screenX,y:screenY,rows:document.querySelectorAll('[data-watch-sym]').length,first:[...document.querySelectorAll('[data-watch-sym]')].slice(0,${FLIPS + 3}).map(e=>e.getAttribute('data-watch-sym')),series:(window.__uctChartDebug['flip-chart'].engineSeries()||[]).map(s=>s.instanceId+'::'+s.plotKey+'#'+s.data.length)})`)
  if (out.page.hidden) throw new Error('page is hidden: no frames would be drawn')
  console.log(`list ${pick.name}; rows ${out.page.rows}; series ${out.page.series.join(' ')}`)

  if (PIXELS) { out.paintProbe = await run(`!!window.__paintProbe`); if (!out.paintProbe) throw new Error('the paint probe is not in the page: no presentation stamp') }
  out.pixels = PIXELS; out.lightSampler = LIGHT_SAMPLER
  await run(SAMPLER)
  // 2026-11-25 (additive): the page's wall clock, so a summary can put each key on the wall minute exactly:
  // wall = timeOrigin + key (+ any shift of the page's Date: pageClock.dateNow - timeOrigin - pageClock.perfNow)
  try { const k = await run('({timeOrigin:performance.timeOrigin,dateNow:Date.now(),perfNow:performance.now()})'); out.timeOrigin = k.timeOrigin; out.pageClock = { dateNow: k.dateNow, perfNow: k.perfNow } } catch (e) { /* no wall clock: the summary falls back */ }
  if (TF2) await waitFor(`!!(window.__uctChartDebug && window.__uctChartDebug['flip-chart-2'] && window.__uctChartDebug['flip-chart-2'].newestBar())`, 240000)
  await run(`(()=>{window.__flip.chart='flip-chart';window.__flip.chart2=${TF2 ? "'flip-chart-2'" : 'null'};return true})()`)
  out.tf2 = TF2 || null
  // select the first row the way a member would (a click on the row), then arrow down
  // owner3 (2026-11-26): a board with NO watchlist (his one-chart TC2000 board) has no row to select; the typed pattern
  // focuses the chart itself, so the row click is skipped there (owner2 threw on the null row)
  await run(`(()=>{const r=document.querySelector('[data-watch-sym]');if(!r)return null;r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));r.click();return r.getAttribute('data-watch-sym')})()`, true)
  await sleep(DWELL + 1500)
  if (GO_TO_DATE) {
    const focused = await run(`(()=>{const W=document.querySelector('[data-widget-id="flip-chart"]');const el=W?[...W.querySelectorAll('[data-guide="chart.goToDate"]')].find((e)=>!e.closest('[inert]')):null;if(!el)return false;el.focus();return document.activeElement===el})()`)
    if (!focused) throw new Error('no Time Navigator date box on the flip chart')
    await c.send('Input.insertText', { text: GO_TO_DATE.replace(/[^0-9]/g, '') })
    await sleep(150)
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
    await sleep(2500)
    out.goToDate = { asked: GO_TO_DATE, view: await run(`(()=>{const h=(window.__uctChartDebug||{})['flip-chart'];if(!h)return null;const v=h.visibleTimeRange();return {from:v?v.from:null,to:v?v.to:null,lr:h.visibleRange(),ni:h.newestIndex()}})()`) }
    console.log(`go to date: ${JSON.stringify(out.goToDate)}`)
    save()
  }
  if (ZOOM_MAX) {
    out.zoomMax = {}
    for (const id of ['flip-chart', 'flip-chart-2']) {
      const view = async () => run(`(()=>{const h=(window.__uctChartDebug||{})[${JSON.stringify(id)}];if(!h)return null;const W=document.querySelector('[data-widget-id=${JSON.stringify(id)}]');let best=null,area=0;for(const c of (W?W.querySelectorAll('canvas'):[])){if(c.closest('[inert]'))continue;const r=c.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=r}}const lr=h.visibleRange();const vt=h.visibleTimeRange();return {lr,from:vt?vt.from:null,to:vt?vt.to:null,ni:h.newestIndex(),x:best?best.x+best.width*0.6:null,y:best?best.y+best.height*0.5:null}})()`)
      let v = await view()
      if (!v || v.x == null) continue
      let same = 0
      for (let k = 0; k < 120; k++) {
        const w0 = v.lr ? v.lr.to - v.lr.from : 0
        await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v.x, y: v.y })
        await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: v.x, y: v.y, deltaX: 0, deltaY: 240 })
        await sleep(100)
        v = await view()
        const w1 = v && v.lr ? v.lr.to - v.lr.from : 0
        same = Math.abs(w1 - w0) < 0.5 ? same + 1 : 0
        if (same >= 3) break   // three wheel steps that no longer widen it: the limit
      }
      out.zoomMax[id] = { from: v && v.from, to: v && v.to, widthBars: v && v.lr ? Math.round(v.lr.to - v.lr.from) : null, newestIndex: v && v.ni }
    }
    console.log(`zoomed out to the limit: ${JSON.stringify(out.zoomMax)}`)
    save()
  }
  if (ZOOM_TO) {
    const view = async () => run(`(()=>{const h=(window.__uctChartDebug||{})['flip-chart'];if(!h)return null;const W=document.querySelector('[data-widget-id="flip-chart"]');let best=null,area=0;for(const c of (W?W.querySelectorAll('canvas'):[])){if(c.closest('[inert]'))continue;const r=c.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=r}}const lr=h.visibleRange();const vt=h.visibleTimeRange();return {lr,from:vt?vt.from:null,to:vt?vt.to:null,ni:h.newestIndex(),x:best?best.x+best.width*0.6:null,y:best?best.y+best.height*0.5:null}})()`)
    const dstr = (t) => (t == null ? null : typeof t === 'string' ? t : typeof t === 'object' && t.year ? `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}` : new Date(t * 1000).toISOString().slice(0, 10))
    let v = await view()
    const steps = []
    for (let k = 0; k < 80 && v && v.x != null; k++) {
      if (dstr(v.from) && dstr(v.from) <= ZOOM_TO) break
      const w0 = v.lr ? v.lr.to - v.lr.from : 0
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: v.x, y: v.y })
      await c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: v.x, y: v.y, deltaX: 0, deltaY: 240 })
      await sleep(120)
      v = await view()
      const w1 = v && v.lr ? v.lr.to - v.lr.from : 0
      steps.push(Math.round(w1))
      if (k > 6 && Math.abs(w1 - w0) < 0.5) break   // the wheel stopped widening the view (the minimum bar spacing)
    }
    out.zoom = { target: ZOOM_TO, method: 'mouse wheel on the chart (no view lock, no Time Navigator)', from: dstr(v && v.from), to: dstr(v && v.to), widthBars: v && v.lr ? Math.round(v.lr.to - v.lr.from) : null, newestIndex: v && v.ni, steps }
    console.log(`zoomed out: ${JSON.stringify(out.zoom)}`)
    save()
  }
  if (SCAN_TRACE) await run(`(()=>{window.__uctScanWarmTrace=[];return true})()`)

  async function traceStart() {
    if (!globalThis.__traceSink) {
      globalThis.__traceSink = { on: false, events: [], done: null }
      const T0 = globalThis.__traceSink
      c.on((m) => { if (!T0.on) return; if (m.method === 'Tracing.dataCollected') { for (const e of m.params.value) T0.events.push(e) } else if (m.method === 'Tracing.tracingComplete') { T0.on = false; if (T0.done) T0.done() } })
    }
    const T1 = globalThis.__traceSink
    T1.events = []; T1.on = true; T1.done = null
    await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: TRACE_CATS } })
    await sleep(50)
    return run(`(()=>{const t=performance.now();performance.mark('__flipAlign');if(window.__paintProbe)window.__paintProbe.marks=true;return t})()`)
  }
  async function traceStop(i) {
    const T2 = globalThis.__traceSink
    await run(`(()=>{if(window.__paintProbe)window.__paintProbe.marks=false;return true})()`)
    const fin = new Promise((r) => { T2.done = r })
    await c.send('Tracing.end')
    await Promise.race([fin, sleep(30000)])
    T2.on = false
    writeFileSync(OUT.replace(/\.json$/, '') + `.flip${i}.trace.json`, JSON.stringify({ traceEvents: T2.events }))
    T2.events = []
  }
  if (UPDOWN === 'tabs') {
    if (TAB_DIAG) { await run(`(()=>{if(window.__s3b)return true;const S=window.__s3b={log:[]};const pick=(o)=>{const out={ids:[],w:[],names:[],keys:[]};const walk=(v,k,d)=>{if(d>8||v==null)return;if(typeof v==='string'&&(v[0]==='{'||v[0]==='[')&&v.length<400000){try{walk(JSON.parse(v),k,d+1)}catch(e){}return}if(Array.isArray(v)){if(k==='widgets'){for(const w of v){if(w&&typeof w==='object'&&w.id!=null)out.w.push(String(w.id)+':'+(w.type||''))}return}for(const x of v.slice(0,60))walk(x,k,d+1);return}if(typeof v==='object'){for(const kk of Object.keys(v)){if(d===0)out.keys.push(kk);walk(v[kk],kk,d+1)}return}if(/^(id|layout_id|layoutId|activeId|active_id|rev|revision|version|base|baseRev|base_rev|seq|board|scope|op|kind|ok|error|reason|status|conflict)$/.test(k))out.ids.push(k+'='+String(v).slice(0,48));if(k==='name'&&typeof v==='string'&&v.startsWith('flip-tab'))out.names.push(v)};walk(o,'',0);return out};const sum=(t)=>{try{return pick(JSON.parse(t))}catch(e){return {len:String(t||'').length}}};const of=window.fetch;window.fetch=async function(input,init){const url=typeof input==='string'?input:(input&&input.url)||'';const m=((init&&init.method)||(input&&input.method)||'GET').toUpperCase();const watch=['/api/workspace/doc','/api/charts/layouts','/api/auth/preferences'].some(x=>url.indexOf(x)>=0)&&!(init&&init.__diag);let req=null;if(watch&&init&&typeof init.body==='string')req=sum(init.body);const t=performance.now();const r=await of.apply(this,arguments);if(watch){let res=null;try{res=sum(await r.clone().text())}catch(e){}S.log.push({t:Math.round(t),m,u:url.replace(location.origin,'').slice(0,140),st:r.status,req,res})}return r};return true})()`); out.tabDiag0 = await run(`(async()=>{const S=window.__s3b||{log:[]};const act=[...document.querySelectorAll('button[data-layout-pin][aria-current="true"]')].map(e=>e.getAttribute('title'));const pins=[...document.querySelectorAll('button[data-layout-pin]')].map(e=>(e.getAttribute('title')||'')+(e.getAttribute('aria-current')?'*':''));const cur=document.querySelector('[data-board-current]');const wids=[...(cur||document).querySelectorAll('[data-widget-id]')].map(e=>e.getAttribute('data-widget-id'));const allW=[...document.querySelectorAll('[data-widget-id]')].map(e=>e.getAttribute('data-widget-id'));let lay=null;try{const j=await (await fetch('/api/charts/layouts',{credentials:'include',__diag:true})).json();lay=(j.mine||[]).filter(t=>t.name===${JSON.stringify(TAB_A_NAME)}||t.name===${JSON.stringify(TAB_B_NAME)}).map(t=>{let L=t.layout;if(typeof L==='string'){try{L=JSON.parse(L)}catch(e){L=null}}return {n:t.name,id:t.id,upd:t.updated_at||t.updatedAt||null,w:((L&&L.widgets)||[]).map(w=>w.id+':'+w.type)}})}catch(e){lay=String(e)}return {active:act,pins,path:location.pathname+location.search,boardCurrent:!!cur,wids,allW,layouts:lay,log:S.log.splice(0)}})()`); save() }
    if (LEGEND_STATS) await run(`(()=>{window.__uctLegendContextStats={};return true})()`)
    for (let i = 0; i < FLIPS; i++) {
      const target = i % 2 === 0 ? TAB_B_NAME : TAB_A_NAME
      // (2026-11-27) --last-dwell applies to the tab pattern too: a long hidden dwell, then a short look at the return
      const tabDwell = Number.isFinite(DWELLS[i]) ? DWELLS[i] : (LAST_DWELL > 0 && i === FLIPS - 1 ? LAST_DWELL : DWELL)
      await run(`(()=>{const F=window.__flip;F.arm0&&F.arm0();F.frames.length=0;F.res.length=0;F.keys.length=0;F.dom.length=0;F.long.length=0;F.cv=0;F.ws=0;F.es=0;return true})()`)
      const align = TRACE_FLIPS.has(i) ? await traceStart() : null
      // --cpuprofile on a tab click too (2026-11-26): the 1.5 s after the click, sampled at 100 us, with no timeline tracing
      const profiling = PROFILE_FLIPS.has(i)
      if (profiling) { await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 100 }); await c.send('Profiler.start') }
      const profAlign = profiling ? await run(`(()=>{const t0=performance.now();const end=t0+3;function __flipAlign(){let x=0;while(performance.now()<end){x++}return x};__flipAlign();return t0})()`) : null
      if (WL_PROBE) await run(`(()=>{const P=window.__wlp={t0:performance.now(),ev:[]};try{performance.setResourceTimingBufferSize(20000)}catch(e){}try{if(window.__wlpObs)window.__wlpObs.disconnect()}catch(e){}const isRow=(n)=>n&&n.nodeType===1&&(n.hasAttribute&&n.hasAttribute('data-watch-sym')||(n.querySelector&&n.querySelector('[data-watch-sym]')));const cnt=(ns)=>{let c=0;for(const n of ns){if(n.nodeType!==1)continue;if(n.hasAttribute('data-watch-sym'))c++;else if(n.querySelectorAll)c+=n.querySelectorAll('[data-watch-sym]').length}return c};const syms=(ns)=>{const out=[];for(const n of ns){if(n.nodeType!==1)continue;const list=n.hasAttribute('data-watch-sym')?[n]:(n.querySelectorAll?[...n.querySelectorAll('[data-watch-sym]')]:[]);for(const x of list)out.push(x.getAttribute('data-watch-sym'))}return out};const big=(ns,kind)=>{for(const n of ns){if(n.nodeType!==1)continue;const d=n.getElementsByTagName('*').length;if(d>=20&&P.big.length<200)P.big.push({t:Math.round(performance.now()),kind,tag:n.tagName,cls:String(n.className||'').slice(0,40),wid:(n.closest&&n.closest('[data-widget-id]')||{getAttribute:()=>null}).getAttribute('data-widget-id'),d})}};P.big=[];const o=new MutationObserver((ms)=>{let a=0,r=0;const as=[],rs=[];for(const m of ms){a+=cnt(m.addedNodes);r+=cnt(m.removedNodes);as.push(...syms(m.addedNodes));rs.push(...syms(m.removedNodes));big(m.removedNodes,'removed');big(m.addedNodes,'added')}if(a||r)P.ev.push({t:Math.round(performance.now()),a,r,rows:document.querySelectorAll('[data-watch-sym]').length,as:as.slice(0,6),rs:rs.slice(0,6),same:as.length&&rs.length?rs.filter(s=>as.includes(s)).length:0})});o.observe(document.body,{childList:true,subtree:true});window.__wlpObs=o;P.rs=[];P.hm=[];try{if(window.__wlpRo)window.__wlpRo.disconnect();if(window.__wlpHm)window.__wlpHm.disconnect()}catch(e){}const ro=new ResizeObserver((es)=>{for(const e of es){if(P.rs.length<400)P.rs.push({t:Math.round(performance.now()),id:e.target.getAttribute('data-widget-id'),w:Math.round(e.contentRect.width),h:Math.round(e.contentRect.height)})}});window.__wlpRo=ro;const seen=new WeakSet();const watch=()=>{document.querySelectorAll('[data-widget-id]').forEach((el)=>{if(!seen.has(el)){seen.add(el);ro.observe(el)}})};watch();const hm=new MutationObserver((ms)=>{watch();for(const m of ms){const tg=m.target.nodeType===1?m.target:m.target.parentElement;const hr=tg&&tg.closest&&tg.closest('[class*="headerTop"],[class*="identity"]');if(hr&&P.hm.length<400)P.hm.push({t:Math.round(performance.now()),k:m.type,in:String(hr.className).slice(0,40),tg:String(tg.className||tg.tagName).slice(0,40),txt:(m.type==='characterData'?String(m.target.data).slice(0,20):'')})}});hm.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class']});window.__wlpHm=hm;return true})()`)
      if (JUMP_MS > 0) { await run(`(()=>{const ids=['flip-chart','flip-chart-2'];const J=window.__jump={frames:[],on:true};const hl0=(id)=>{const W=document.querySelector('[data-widget-id="'+id+'"]');const e=W?[...W.querySelectorAll('[data-testid="sym-label"]')].find((x)=>!x.closest('[inert]')):null;return e?e.textContent.trim():null};const rowSel=()=>document.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]');const scroller=(el)=>{for(let n=el&&el.parentElement;n;n=n.parentElement){const s=getComputedStyle(n);if((s.overflowY==='auto'||s.overflowY==='scroll')&&n.scrollHeight>n.clientHeight)return n}return null};const rect=(id)=>{const W=document.querySelector('[data-widget-id="'+id+'"]');if(!W)return null;let best=null,area=0;for(const c of W.querySelectorAll('canvas')){if(c.closest('[inert]'))continue;const r=c.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=r}}return best?[Math.round(best.x),Math.round(best.y),Math.round(best.width),Math.round(best.height)]:null};const t0=performance.now();const tick=()=>{if(!J.on)return;const t=performance.now();const f={t:Math.round(t*10)/10,c:{}};for(const id of ids){const h=(window.__uctChartDebug||{})[id];if(!h)continue;let lr=null,nb=null,ni=null,y0=null,y1=null,vt=null;try{lr=h.visibleRange()}catch(e){}try{const v=h.visibleTimeRange();vt=v?v.from:null}catch(e){}try{nb=h.newestBar()}catch(e){}try{ni=h.newestIndex()}catch(e){}if(nb&&nb.close!=null){try{y0=h.priceToY(nb.close);y1=h.priceToY(nb.close*1.01)}catch(e){}}if(h.autoscaleSources){J.st=J.st||{};J.as=J.as||[];const st=J.st[id]||(J.st[id]={});const idk=(hl0(id)||'')+'|'+(nb?String(nb.time):'');if(st.idk!==idk&&nb&&nb.close!=null){st.idk=idk;st.ref=nb.close;try{st.cache=h.autoscaleSources()}catch(e){st.cache=null}try{st.yr=h.priceToY(st.ref);st.yr1=h.priceToY(st.ref*1.01)}catch(e){}}else if(st.ref!=null){let yr=null,yr1=null;try{yr=h.priceToY(st.ref);yr1=h.priceToY(st.ref*1.01)}catch(e){}if(yr!=null&&st.yr!=null&&(Math.abs(yr-st.yr)>0.5||Math.abs(yr1-st.yr1)>0.5)){let now=null;try{now=h.autoscaleSources()}catch(e){}if(J.as.length<60)J.as.push({t:Math.round(performance.now()*10)/10,id:id,prev:st.cache||null,now:now,y:[st.yr,st.yr1,yr,yr1]});st.cache=now;st.yr=yr;st.yr1=yr1}}}const HW=document.querySelector('[data-widget-id="'+id+'"]');const hl=HW?[...HW.querySelectorAll('[data-testid="sym-label"]')].find((e)=>!e.closest('[inert]')):null;f.c[id]={hs:hl?hl.textContent.trim().slice(0,16):null,lr:lr?[Math.round(lr.from*100)/100,Math.round(lr.to*100)/100]:null,nb:nb?[nb.time,nb.close]:null,ni:ni,y0:y0==null?null:Math.round(y0*10)/10,y1:y1==null?null:Math.round(y1*10)/10,vt:vt,r:rect(id)}}const sel=rowSel();const sc=sel?scroller(sel):null;f.wl=sel?{s:sel.getAttribute('data-watch-sym'),o:sel.offsetTop,top:Math.round(sel.getBoundingClientRect().top),st:sc?Math.round(sc.scrollTop):null}:null;J.frames.push(f);if(t-t0<${JUMP_MS + 3500})requestAnimationFrame(tick);else J.on=false};requestAnimationFrame(tick);return true})()`) }; await castStart(i)
      const clicked = await run(`(async()=>{const b=document.querySelector('button[data-layout-pin][title=${JSON.stringify(target)}]');if(!b)return false;const t0=performance.now();window.__flip.keys.push(t0);b.click();const t1=performance.now();const fr=await new Promise((r)=>requestAnimationFrame(()=>r(performance.now())));const pt=await new Promise((r)=>setTimeout(()=>r(performance.now()),0));const cur=document.querySelector('[data-board-current]')||document;const cv=[...cur.querySelectorAll('canvas')].filter((x)=>x.width>0&&x.height>0&&x.getBoundingClientRect().width>0).length;return {task:Math.round((t1-t0)*10)/10,frame:Math.round((fr-t0)*10)/10,paint:Math.round((pt-t0)*10)/10,cv}})()`)
      if (!clicked) throw new Error(`no dock tab ${target}`)
      if (profiling) {
        await sleep(1500)
        const { profile } = await c.send('Profiler.stop')
        writeFileSync(OUT.replace(/\.json$/, '') + `.flip${i}.cpuprofile`, JSON.stringify(profile))
        await sleep(Math.max(0, tabDwell - 1500))
      } else await sleep(tabDwell)
      if (align != null) await traceStop(i)
      const got = await run(`(()=>{const F=window.__flip;const k=F.keys[0]||0;const res=performance.getEntriesByType('resource').filter(e=>e.startTime>=k);return {key:F.keys[0]||null,long:F.long.slice(),dom:F.dom.slice(),frames:F.frames.length,evt:(F.evt||[]).slice(),cv:F.cv,net:{res:res.length,api:res.filter(e=>e.name.includes('/api/')).length,wsOpened:F.ws,esOpened:F.es,wsLive:F.wsLive?F.wsLive.size:null,esLive:F.esLive?F.esLive.size:null}}})()`)
      if (WL_PROBE) got.wlProbe = await run(`(()=>{const P=window.__wlp||{ev:[]};try{window.__wlpObs&&window.__wlpObs.disconnect()}catch(e){}const k=window.__flip.keys[0]||P.t0;const res=performance.getEntriesByType('resource').filter(e=>e.startTime>=k-5&&!/ticker-logo/.test(e.name)).map(e=>({u:e.name.replace(location.origin,'').slice(0,90),s:Math.round(e.startTime-k),e:Math.round(e.responseEnd-k)}));try{window.__wlpRo&&window.__wlpRo.disconnect();window.__wlpHm&&window.__wlpHm.disconnect()}catch(e){}return {key:k,rows:P.ev.map(x=>({t:x.t-Math.round(k),a:x.a,r:x.r,rows:x.rows,as:x.as,rs:x.rs,same:x.same})),big:(P.big||[]).map(x=>({...x,t:x.t-Math.round(k)})),res,sizes:(P.rs||[]).map(x=>({...x,t:x.t-Math.round(k)})),header:(P.hm||[]).map(x=>({...x,t:x.t-Math.round(k)}))}})()`)
      if (LEGEND_STATS) got.legendStats = await run(`(()=>{const s=window.__uctLegendContextStats||null;window.__uctLegendContextStats={};return s})()`)
      if (TAB_DIAG) got.diag = await run(`(async()=>{const S=window.__s3b||{log:[]};const act=[...document.querySelectorAll('button[data-layout-pin][aria-current="true"]')].map(e=>e.getAttribute('title'));const pins=[...document.querySelectorAll('button[data-layout-pin]')].map(e=>(e.getAttribute('title')||'')+(e.getAttribute('aria-current')?'*':''));const cur=document.querySelector('[data-board-current]');const wids=[...(cur||document).querySelectorAll('[data-widget-id]')].map(e=>e.getAttribute('data-widget-id'));const allW=[...document.querySelectorAll('[data-widget-id]')].map(e=>e.getAttribute('data-widget-id'));let lay=null;try{const j=await (await fetch('/api/charts/layouts',{credentials:'include',__diag:true})).json();lay=(j.mine||[]).filter(t=>t.name===${JSON.stringify(TAB_A_NAME)}||t.name===${JSON.stringify(TAB_B_NAME)}).map(t=>{let L=t.layout;if(typeof L==='string'){try{L=JSON.parse(L)}catch(e){L=null}}return {n:t.name,id:t.id,upd:t.updated_at||t.updatedAt||null,w:((L&&L.widgets)||[]).map(w=>w.id+':'+w.type)}})}catch(e){lay=String(e)}return {active:act,pins,path:location.pathname+location.search,boardCurrent:!!cur,wids,allW,layouts:lay,log:S.log.splice(0)}})()`)
      out.flips.push({ i, dir: 'tab', sym: target, click: clicked, ...got, ...(align != null ? { traceAlign: align } : {}), ...(profAlign != null ? { profAlign } : {}) })
      if (JUMP_MS > 0) { await sleep(Math.max(0, JUMP_MS + 200)); const jf = await run(`(()=>{const J=window.__jump||{frames:[]};J.on=false;const db=window.__uctDoubleBuffer;return {frames:J.frames,autoscale:J.as||[],db:db&&Array.isArray(db.last)?db.last.slice(-4):null,dblog:db&&Array.isArray(db.log)?db.log.slice(-6):null}})()`); const fl = out.flips[out.flips.length - 1]; fl.jump = analyzeJump(jf.frames, fl.key, JUMP_MS); fl.jump.db = jf.db; fl.jump.dblog = jf.dblog; if (jf.autoscale && jf.autoscale.length) fl.jump.autoscale = jf.autoscale; jumpRaw.push({ i: fl.i, dir: fl.dir, sym: fl.sym, key: fl.key, frames: jf.frames }); writeFileSync(OUT.replace(/\.json$/, '') + '.jump.json', JSON.stringify(jumpRaw)); save() }; await castStop()
      save()
    }
  }
  if (UPDOWN === 'typed' || UPDOWN === 'jump') {
    if (UPDOWN === 'typed' && !TYPED.length) throw new Error('--pattern=typed needs --typed=AAA,BBB,...')
    const n = UPDOWN === 'typed' ? TYPED.length : FLIPS
    const CHART = '[data-widget-id="flip-chart"]'
    for (let i = 0; i < n; i++) {
      await run(`(()=>{const F=window.__flip;F.arm0&&F.arm0();F.frames.length=0;F.res.length=0;F.keys.length=0;F.dom.length=0;F.long.length=0;F.enterKeys=${UPDOWN === 'typed'};return true})()`)
      let target = null
      if (UPDOWN === 'typed') {
        target = TYPED[i]
        // focus the chart region (type-to-search opens on a printable key there)
        // the CHART SURFACE (the focusable element holding the canvas), as a member's click on the chart focuses it;
        // 2026-11-17: the first [tabindex="0"] in the widget became a header button (chartMetaItemBtn) and typing went nowhere
        const focused = await run(`(()=>{const W=document.querySelector('${CHART}');const all=W?[...W.querySelectorAll('[tabindex="0"]')].filter((e)=>!e.closest('[inert]')):[];const el=all.find(e=>e.querySelector('canvas'))||all[0]||W;if(el&&el.focus){el.focus({preventScroll:true});return document.activeElement===el}return false})()`)
        if (!focused) throw new Error('could not focus the chart for type-to-search')
        const charGaps = []
        let lastCharAt = null
        for (const ch of target) {
          const vk = ch.charCodeAt(0)
          await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code: /[A-Z]/.test(ch) ? `Key${ch}` : '', text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
          await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: /[A-Z]/.test(ch) ? `Key${ch}` : '', windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
          if (HUMAN_TYPE && ch !== target[target.length - 1]) { const g = humanGap(); charGaps.push(g); await sleep(g) } else if (!HUMAN_TYPE) await sleep(TYPE_GAP)
        }
        lastCharAt = Date.now()
        await sleep(HUMAN_TYPE ? 100 : TYPED_PAUSE)   // + the rig's own reads below: about 150 ms in all
        if (process.argv.includes('--debug-typed')) {
          const dbg = await run(`(()=>{const a=document.activeElement;const ins=[...document.querySelectorAll('input')].filter(x=>x.offsetParent).map(x=>({ph:x.placeholder||'',v:x.value,cls:String(x.className).slice(0,40)}));const opts=[...document.querySelectorAll('[role=option],[class*="result"],[class*="Result"]')].filter(x=>x.offsetParent).slice(0,4).map(x=>x.textContent.trim().slice(0,30));return {active:(a&&a.tagName)+'.'+String(a&&a.className).slice(0,50),val:a&&a.value,inputs:ins.slice(0,4),opts}})()`)
          console.log(`typed ${target}: ${JSON.stringify(dbg)}`)
        }
        const before = await run(`(()=>{const F=window.__flip;F.arm0&&F.arm0();F.frames.length=0;F.keys.length=0;return {sig:F.sigOf(F.chart),sig2:F.chart2?F.sigOf(F.chart2):null}})()`)
        if (JUMP_MS > 0) { await run(`(()=>{const ids=['flip-chart','flip-chart-2'];const J=window.__jump={frames:[],on:true};const hl0=(id)=>{const W=document.querySelector('[data-widget-id="'+id+'"]');const e=W?[...W.querySelectorAll('[data-testid="sym-label"]')].find((x)=>!x.closest('[inert]')):null;return e?e.textContent.trim():null};const rowSel=()=>document.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]');const scroller=(el)=>{for(let n=el&&el.parentElement;n;n=n.parentElement){const s=getComputedStyle(n);if((s.overflowY==='auto'||s.overflowY==='scroll')&&n.scrollHeight>n.clientHeight)return n}return null};const rect=(id)=>{const W=document.querySelector('[data-widget-id="'+id+'"]');if(!W)return null;let best=null,area=0;for(const c of W.querySelectorAll('canvas')){if(c.closest('[inert]'))continue;const r=c.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=r}}return best?[Math.round(best.x),Math.round(best.y),Math.round(best.width),Math.round(best.height)]:null};const t0=performance.now();const tick=()=>{if(!J.on)return;const t=performance.now();const f={t:Math.round(t*10)/10,c:{}};for(const id of ids){const h=(window.__uctChartDebug||{})[id];if(!h)continue;let lr=null,nb=null,ni=null,y0=null,y1=null,vt=null;try{lr=h.visibleRange()}catch(e){}try{const v=h.visibleTimeRange();vt=v?v.from:null}catch(e){}try{nb=h.newestBar()}catch(e){}try{ni=h.newestIndex()}catch(e){}if(nb&&nb.close!=null){try{y0=h.priceToY(nb.close);y1=h.priceToY(nb.close*1.01)}catch(e){}}if(h.autoscaleSources){J.st=J.st||{};J.as=J.as||[];const st=J.st[id]||(J.st[id]={});const idk=(hl0(id)||'')+'|'+(nb?String(nb.time):'');if(st.idk!==idk&&nb&&nb.close!=null){st.idk=idk;st.ref=nb.close;try{st.cache=h.autoscaleSources()}catch(e){st.cache=null}try{st.yr=h.priceToY(st.ref);st.yr1=h.priceToY(st.ref*1.01)}catch(e){}}else if(st.ref!=null){let yr=null,yr1=null;try{yr=h.priceToY(st.ref);yr1=h.priceToY(st.ref*1.01)}catch(e){}if(yr!=null&&st.yr!=null&&(Math.abs(yr-st.yr)>0.5||Math.abs(yr1-st.yr1)>0.5)){let now=null;try{now=h.autoscaleSources()}catch(e){}if(J.as.length<60)J.as.push({t:Math.round(performance.now()*10)/10,id:id,prev:st.cache||null,now:now,y:[st.yr,st.yr1,yr,yr1]});st.cache=now;st.yr=yr;st.yr1=yr1}}}const HW=document.querySelector('[data-widget-id="'+id+'"]');const hl=HW?[...HW.querySelectorAll('[data-testid="sym-label"]')].find((e)=>!e.closest('[inert]')):null;f.c[id]={hs:hl?hl.textContent.trim().slice(0,16):null,lr:lr?[Math.round(lr.from*100)/100,Math.round(lr.to*100)/100]:null,nb:nb?[nb.time,nb.close]:null,ni:ni,y0:y0==null?null:Math.round(y0*10)/10,y1:y1==null?null:Math.round(y1*10)/10,vt:vt,r:rect(id)}}const sel=rowSel();const sc=sel?scroller(sel):null;f.wl=sel?{s:sel.getAttribute('data-watch-sym'),o:sel.offsetTop,top:Math.round(sel.getBoundingClientRect().top),st:sc?Math.round(sc.scrollTop):null}:null;J.frames.push(f);if(t-t0<${JUMP_MS + 3500})requestAnimationFrame(tick);else J.on=false};requestAnimationFrame(tick);return true})()`) }; await castStart(i)
        if (ORIGIN) await run(ARM_ORIGIN_JS)
        await run(`(()=>{try{window.__uctDeviceDiag&&window.__uctDeviceDiag.clear()}catch(e){}return true})()`)
        const ttraceAlign = TRACE_FLIPS.has(i) ? await traceStart() : null
        const enterGapMs = lastCharAt ? Date.now() - lastCharAt : null
        const tprof = TYPED_PROF.has(i)
        if (tprof) { await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 100 }); await c.send('Profiler.start') }
        const tprofAlign = tprof ? await run(`(()=>{const t0=performance.now();const end=t0+3;function __flipAlign(){let x=0;while(performance.now()<end){x++}return x};__flipAlign();return t0})()`) : null
        await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
        await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
        if (tprof) { await sleep(1500); const { profile } = await c.send('Profiler.stop'); writeFileSync(OUT.replace(/\.json$/, '') + `.flip${i}.cpuprofile`, JSON.stringify(profile)); await sleep(Math.max(0, DWELL - 1500)) } else await sleep(DWELL)
        if (ttraceAlign != null) await traceStop(i)
        const got = await run(`(()=>{const F=window.__flip;return {key:F.keys[0]||null,keyWall:(function(){var k=F.keys[0],p=k==null?null:(F.kw||[]).find(function(x){return x[0]===k});return p?p[1]:null})(),frames:F.frames.slice(),res:F.res.slice(),dom:F.dom.slice(),long:F.long.slice(),end:F.sigOf(F.chart),end2:F.chart2?F.sigOf(F.chart2):null,title:document.title,...(F.take?F.take():{})}})()`)
        if (ORIGIN) Object.assign(got, await run(ORIGIN_END_JS))
        got.device = await run(`(()=>{try{return window.__uctDeviceDiag?window.__uctDeviceDiag.log():null}catch(e){return 'diag threw'}})()`)
        // --dump-times: every candle time the chart holds at the end of the dwell (to find a hole in its history)
        if (process.argv.includes('--dump-times')) {
          got.times = await run(`(()=>{const h=(window.__uctChartDebug||{})['flip-chart'];const t=h&&h.renderedTail?h.renderedTail(100000):null;return t?t.map(b=>b.time):null})()`)
        }
        got.phase = await run(PHASE_JS)
        out.flips.push({ i, dir: 'typed', sym: target, before: before.sig, before2: before.sig2, ...got, ...(ttraceAlign != null ? { traceAlign: ttraceAlign } : {}), ...(tprofAlign != null ? { profAlign: tprofAlign } : {}) })
        { const fl = out.flips[out.flips.length - 1]; fl.typing = { human: HUMAN_TYPE, charGaps, enterGapMs }; fl.warm = await run(`(()=>{const s=${JSON.stringify(target)};const k=window.__flip.keys[0]||0;const enc=encodeURIComponent(s);const hits=performance.getEntriesByType('resource').filter((e)=>e.name.indexOf('/api/')>=0&&(e.name.indexOf('/'+enc+'?')>=0||e.name.indexOf('/'+enc+'/')>=0||e.name.indexOf('s-'+enc+'/')>=0||e.name.indexOf('s-'+enc+'.')>=0||e.name.indexOf('='+enc+'&')>=0||e.name.indexOf('='+enc+',')>=0||e.name.slice(-enc.length-1)==='='+enc));const before=hits.filter((e)=>e.startTime<k);const done=before.filter((e)=>e.responseEnd<=k);return {state:done.length?'warm':(before.length?'in-flight':'cold'),before:before.length,doneBefore:done.length,after:hits.length-before.length,firstBeforeMs:before.length?Math.round(Math.min(...before.map((e)=>e.startTime))-k):null,urls:hits.slice(0,6).map((e)=>e.name.replace(location.origin,'').slice(0,80))}})()`); save() }
        if (JUMP_MS > 0) { await sleep(Math.max(0, JUMP_MS + 200)); const jf = await run(`(()=>{const J=window.__jump||{frames:[]};J.on=false;const db=window.__uctDoubleBuffer;return {frames:J.frames,autoscale:J.as||[],db:db&&Array.isArray(db.last)?db.last.slice(-4):null,dblog:db&&Array.isArray(db.log)?db.log.slice(-6):null}})()`); const fl = out.flips[out.flips.length - 1]; fl.jump = analyzeJump(jf.frames, fl.key, JUMP_MS); fl.jump.db = jf.db; fl.jump.dblog = jf.dblog; if (jf.autoscale && jf.autoscale.length) fl.jump.autoscale = jf.autoscale; jumpRaw.push({ i: fl.i, dir: fl.dir, sym: fl.sym, key: fl.key, frames: jf.frames }); writeFileSync(OUT.replace(/\.json$/, '') + '.jump.json', JSON.stringify(jumpRaw)); save() }; await castStop()
        if (FOCUS_CHECK) { const fl = out.flips[out.flips.length - 1]; const f0 = await run(`(()=>{const a=document.activeElement;const W=document.querySelector('[data-widget-id="flip-chart"]');const hl=W?[...W.querySelectorAll('[data-testid="sym-label"]')].find((e)=>!e.closest('[inert]')):null;return {inFront:!!(a&&a.closest&&a.closest('[data-db-layer="front"]')),inWidget:!!(a&&W&&W.contains(a)),tag:a?a.tagName:null,sym:hl?hl.textContent.trim():null}})()`); await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 }); await sleep(1200); const f1 = await run(`(()=>{const W=document.querySelector('[data-widget-id="flip-chart"]');const hl=W?[...W.querySelectorAll('[data-testid="sym-label"]')].find((e)=>!e.closest('[inert]')):null;return {sym:hl?hl.textContent.trim():null}})()`); fl.focus = { ...f0, symAfterArrow: f1.sym, arrowMoved: !!(f1.sym && f0.sym && f1.sym !== f0.sym), pass: !!(f0.inFront && f1.sym && f0.sym && f1.sym !== f0.sym) }; console.log(`focus after typed ${fl.sym}: ${JSON.stringify(fl.focus)}`); save() }
      } else {
        // point at a row JUMP below the selection (wrapping), wait like a member, click it
        // ⭐ (2026-11-20, the owner's 70-row jumps) A VIRTUALIZED list renders only its window (+12 overscan), so a
        // jump past it is SCROLLED to first, as a member scrolls before clicking: the target is found by the
        // virtualizer's own `data-index`, the list scrolled until that index is mounted, then pointed at.
        const pick2 = JUMP > 12 ? await run(`(async()=>{const W=document.querySelector('[data-widget-id="flip-wl"]')||document;const sel=W.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]');const wrapOf=(el)=>el&&el.closest('[data-index]');const sw=wrapOf(sel)||W.querySelector('[data-index]');if(!sw)return null;const from=Number(sw.getAttribute('data-index'));const total=Number(W.querySelectorAll('[data-index]').length);const scr=(()=>{for(let p=sw.parentElement;p;p=p.parentElement){const cs=getComputedStyle(p);if((cs.overflowY==='auto'||cs.overflowY==='scroll')&&p.scrollHeight>p.clientHeight)return p}return null})();if(!scr)return null;const h=sw.getBoundingClientRect().height||30;const want=from+${JUMP};const frame=()=>new Promise((r)=>requestAnimationFrame(()=>r()));let tw=null;for(let i=0;i<40&&!tw;i++){tw=W.querySelector('[data-index="'+want+'"]');if(tw)break;const max=scr.scrollHeight-scr.clientHeight;if(scr.scrollTop>=max-1){break}scr.scrollTop=Math.min(max,scr.scrollTop+Math.max(h*20,scr.clientHeight*0.8));await frame();await frame()}if(!tw){scr.scrollTop=0;await frame();await frame();tw=W.querySelector('[data-index="'+(${JUMP}%Math.max(1,total))+'"]')||W.querySelector('[data-index]')}const r=tw.querySelector('[data-watch-sym]')||tw;r.scrollIntoView({block:'center'});await frame();for(const t of ['pointerover','pointerenter','mouseover','mouseenter'])r.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(t,{bubbles:t.endsWith('over')}));return r.getAttribute('data-watch-sym')})()`) : await run(`(()=>{const rows=[...document.querySelectorAll('[data-watch-sym]')];const sel=rows.findIndex(r=>/listRowSelected/.test(String(r.className))||r.getAttribute('aria-selected')==='true');const at=((sel<0?0:sel)+${JUMP})%rows.length;const r=rows[at];r.scrollIntoView({block:'center'});for(const t of ['pointerover','pointerenter','mouseover','mouseenter'])r.dispatchEvent(new (t.startsWith('pointer')?PointerEvent:MouseEvent)(t,{bubbles:t.endsWith('over')}));return r.getAttribute('data-watch-sym')})()`)
        target = pick2
        await sleep(HOVER)
        const before = await run(`(()=>{const F=window.__flip;F.arm0&&F.arm0();F.frames.length=0;F.keys.length=0;return {sig:F.sigOf(F.chart),sig2:F.chart2?F.sigOf(F.chart2):null}})()`)
        // --trace on a jump too (2026-11-21, the post-paint backlog): the same capture as the list loop's
        const jtrace = TRACE_FLIPS.has(i)
        let jtraceAlign = null
        if (jtrace) {
          if (!globalThis.__traceSink) {
            globalThis.__traceSink = { on: false, events: [], done: null }
            const T0 = globalThis.__traceSink
            c.on((m) => { if (!T0.on) return; if (m.method === 'Tracing.dataCollected') { for (const e of m.params.value) T0.events.push(e) } else if (m.method === 'Tracing.tracingComplete') { T0.on = false; if (T0.done) T0.done() } })
          }
          const T1 = globalThis.__traceSink
          T1.events = []; T1.on = true; T1.done = null
          await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: TRACE_CATS } })
          await sleep(50)
          jtraceAlign = await run(`(()=>{const t=performance.now();performance.mark('__flipAlign');if(window.__paintProbe)window.__paintProbe.marks=true;return t})()`)
        }
        await run(`(()=>{try{window.__uctDeviceDiag&&window.__uctDeviceDiag.clear()}catch(e){}return true})()`)   // (2026-11-20) the device record per jump too
        await run(`(()=>{const r=document.querySelector('[data-watch-sym=${JSON.stringify(String(target))}]');window.__flip.keys.push(performance.now());r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));r.click();return true})()`)
        await sleep(DWELL)
        if (jtrace) {
          const T2 = globalThis.__traceSink
          await run(`(()=>{if(window.__paintProbe)window.__paintProbe.marks=false;return true})()`)
          const fin = new Promise((r) => { T2.done = r })
          await c.send('Tracing.end')
          await Promise.race([fin, sleep(30000)])
          T2.on = false
          writeFileSync(OUT.replace(/\.json$/, '') + `.flip${i}.trace.json`, JSON.stringify({ traceEvents: T2.events }))
          T2.events = []
        }
        const got = await run(`(()=>{const F=window.__flip;return {key:F.keys[0]||null,keyWall:(function(){var k=F.keys[0],p=k==null?null:(F.kw||[]).find(function(x){return x[0]===k});return p?p[1]:null})(),frames:F.frames.slice(),res:F.res.slice(),dom:F.dom.slice(),long:F.long.slice(),end:F.sigOf(F.chart),end2:F.chart2?F.sigOf(F.chart2):null,title:document.title,...(F.take?F.take():{})}})()`)
        got.device = await run(`(()=>{try{return window.__uctDeviceDiag?window.__uctDeviceDiag.log():null}catch(e){return 'diag threw'}})()`)
        if (SCAN_TRACE) got.scanTrace = await run(`(()=>{const t=window.__uctScanWarmTrace;return Array.isArray(t)?t.splice(0):null})()`)
        out.flips.push({ i, dir: 'jump', sym: target, before: before.sig, before2: before.sig2, ...got, ...(jtraceAlign != null ? { traceAlign: jtraceAlign } : {}) })
      }
      save()
    }
  }
  // ---- (lane C, 2026-11-28) --pattern=tf: every toolbar timeframe on fresh rows, key = the click
  if (UPDOWN === 'tf') {
    const baseOf = (c) => { if (c === 'D' || c === 'W' || c === 'M') return c; const m = Number(c); if (m === 45) return '15'; if (m > 60 && m % 60 === 0) return '60'; return c }
    let cur = TF
    let fi = 0
    out.tfPass = { seq: TF_SEQ, syms: [] }
    out.tfPass.nolist = TF_NOLIST
    const typeInto = async (tk) => {
      const ok = await run(`(()=>{const W=document.querySelector('[data-widget-id="flip-chart"]');const all=W?[...W.querySelectorAll('[tabindex="0"]')].filter((e)=>!e.closest('[inert]')):[];const el=all.find(e=>e.querySelector('canvas'))||all[0]||W;if(el&&el.focus){el.focus({preventScroll:true});return document.activeElement===el}return false})()`)
      if (!ok) throw new Error('could not focus the chart to type ' + tk)
      for (const ch of tk) {
        const vk = ch.charCodeAt(0)
        await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code: /[A-Z]/.test(ch) ? `Key${ch}` : '', text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
        await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code: /[A-Z]/.test(ch) ? `Key${ch}` : '', windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
        await sleep(120)
      }
      await sleep(300)
      await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
      await sleep(DWELL + 2500)
    }
    const listSyms = TF_NOLIST ? await run(`(()=>[...(document.querySelector('[data-widget-id="flip-wl"]')||document).querySelectorAll('[data-watch-sym]')].map((e)=>e.getAttribute('data-watch-sym')))()`) : []
    if (TF_NOLIST) { if (!listSyms.length) throw new Error('no rows to type for --tf-nolist'); await typeInto(listSyms[0]) }
    for (let si = 0; si < TF_SYMS; si++) {
      if (si > 0 && TF_NOLIST) { if (!listSyms[si]) throw new Error('no row ' + si + ' to type'); await typeInto(listSyms[si]) } else
      if (si > 0) {
        const next = await run(`(()=>{const W=document.querySelector('[data-widget-id="flip-wl"]')||document;const rows=[...W.querySelectorAll('[data-watch-sym]')];const sel=W.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]');const k=sel?rows.indexOf(sel):-1;const r=rows[k+1];if(!r)return null;r.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));r.click();return r.getAttribute('data-watch-sym')})()`)
        if (!next) throw new Error('no next row for the tf pass')
        await sleep(DWELL + 1500)
      }
      const sym = await run(`(()=>{const W=document.querySelector('[data-widget-id="flip-chart"]');const e=W?[...W.querySelectorAll('[data-testid="sym-label"]')].find((x)=>!x.closest('[inert]')):null;return e?e.textContent.trim().split(/\\s+/)[0]:null})()`)
      out.tfPass.syms.push(sym)
      const seq = TF_SEQ.filter((c) => c !== cur)
      for (const code of seq) {
        const i = fi++
        const label = tfButtonLabel(code)
        const before = await run(`(()=>{const F=window.__flip;F.arm0&&F.arm0();F.frames.length=0;F.res.length=0;F.keys.length=0;F.dom.length=0;F.long.length=0;return {sig:F.sigOf(F.chart),sig2:F.chart2?F.sigOf(F.chart2):null}})()`)
        if (JUMP_MS > 0) { await run(`(()=>{const ids=['flip-chart','flip-chart-2'];const J=window.__jump={frames:[],on:true};const hl0=(id)=>{const W=document.querySelector('[data-widget-id="'+id+'"]');const e=W?[...W.querySelectorAll('[data-testid="sym-label"]')].find((x)=>!x.closest('[inert]')):null;return e?e.textContent.trim():null};const rowSel=()=>document.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]');const scroller=(el)=>{for(let n=el&&el.parentElement;n;n=n.parentElement){const s=getComputedStyle(n);if((s.overflowY==='auto'||s.overflowY==='scroll')&&n.scrollHeight>n.clientHeight)return n}return null};const rect=(id)=>{const W=document.querySelector('[data-widget-id="'+id+'"]');if(!W)return null;let best=null,area=0;for(const c of W.querySelectorAll('canvas')){if(c.closest('[inert]'))continue;const r=c.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=r}}return best?[Math.round(best.x),Math.round(best.y),Math.round(best.width),Math.round(best.height)]:null};const t0=performance.now();const tick=()=>{if(!J.on)return;const t=performance.now();const f={t:Math.round(t*10)/10,c:{}};for(const id of ids){const h=(window.__uctChartDebug||{})[id];if(!h)continue;let lr=null,nb=null,ni=null,y0=null,y1=null,vt=null;try{lr=h.visibleRange()}catch(e){}try{const v=h.visibleTimeRange();vt=v?v.from:null}catch(e){}try{nb=h.newestBar()}catch(e){}try{ni=h.newestIndex()}catch(e){}if(nb&&nb.close!=null){try{y0=h.priceToY(nb.close);y1=h.priceToY(nb.close*1.01)}catch(e){}}if(h.autoscaleSources){J.st=J.st||{};J.as=J.as||[];const st=J.st[id]||(J.st[id]={});const idk=(hl0(id)||'')+'|'+(nb?String(nb.time):'');if(st.idk!==idk&&nb&&nb.close!=null){st.idk=idk;st.ref=nb.close;try{st.cache=h.autoscaleSources()}catch(e){st.cache=null}try{st.yr=h.priceToY(st.ref);st.yr1=h.priceToY(st.ref*1.01)}catch(e){}}else if(st.ref!=null){let yr=null,yr1=null;try{yr=h.priceToY(st.ref);yr1=h.priceToY(st.ref*1.01)}catch(e){}if(yr!=null&&st.yr!=null&&(Math.abs(yr-st.yr)>0.5||Math.abs(yr1-st.yr1)>0.5)){let now=null;try{now=h.autoscaleSources()}catch(e){}if(J.as.length<60)J.as.push({t:Math.round(performance.now()*10)/10,id:id,prev:st.cache||null,now:now,y:[st.yr,st.yr1,yr,yr1]});st.cache=now;st.yr=yr;st.yr1=yr1}}}const HW=document.querySelector('[data-widget-id="'+id+'"]');const hl=HW?[...HW.querySelectorAll('[data-testid="sym-label"]')].find((e)=>!e.closest('[inert]')):null;f.c[id]={hs:hl?hl.textContent.trim().slice(0,16):null,sp:(()=>{try{const tl=h.renderedTail?h.renderedTail(8):null;if(!tl||tl.length<2)return null;const ts=tl.map((b)=>typeof b.time==='number'?b.time:(typeof b.time==='string'?Date.parse(b.time)/1000:(b.time&&b.time.year?Date.UTC(b.time.year,b.time.month-1,b.time.day)/1000:null)));let m=null;for(let q=1;q<ts.length;q++){const g=ts[q]-ts[q-1];if(g>0&&(m==null||g<m))m=g}return m}catch(e){return null}})(),lr:lr?[Math.round(lr.from*100)/100,Math.round(lr.to*100)/100]:null,nb:nb?[nb.time,nb.close]:null,ni:ni,y0:y0==null?null:Math.round(y0*10)/10,y1:y1==null?null:Math.round(y1*10)/10,vt:vt,r:rect(id)}}const sel=rowSel();const sc=sel?scroller(sel):null;f.wl=sel?{s:sel.getAttribute('data-watch-sym'),o:sel.offsetTop,top:Math.round(sel.getBoundingClientRect().top),st:sc?Math.round(sc.scrollTop):null}:null;J.frames.push(f);if(t-t0<${JUMP_MS + 3500})requestAnimationFrame(tick);else J.on=false};requestAnimationFrame(tick);return true})()`) }
        await run(`(()=>{try{window.__uctDeviceDiag&&window.__uctDeviceDiag.clear()}catch(e){}return true})()`)
        // (2026-11-28) the jump probe must sample a frame BEFORE the key (the pre-key chart is the grader's base): a bar click
        // right after the probe's start had none, and the OLD timeframe's chart on screen at +15 ms read as the new one's paint
        await sleep(80)
        const clicked = await run(`(async()=>{const W=document.querySelector('[data-widget-id="flip-chart"]');if(!W)return null;const bs=[...W.querySelectorAll('[data-guide="chart.timeframe"] button')].filter((b)=>!b.closest('[inert]'));const b=bs.find((x)=>x.textContent.trim()===${JSON.stringify(label)});if(b){const t=performance.now();window.__flip.keys.push(t);b.click();return {t,via:'bar'}}const more=[...W.querySelectorAll('[aria-label="More timeframes"]')].find((x)=>!x.closest('[inert]'));if(!more)return {miss:bs.map((x)=>x.textContent.trim()).join(' ')};more.click();await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));await new Promise((r)=>setTimeout(r,250));const menu=document.querySelector('[data-guide="chart.timeframeMenu"]');const it=menu?[...menu.querySelectorAll('button')].find((x)=>x.textContent.trim()===${JSON.stringify(label)}):null;if(!it){more.click();return {miss:'menu: '+(menu?[...menu.querySelectorAll('button')].map((x)=>x.textContent.trim()).filter(Boolean).join(' '):'no menu')}}await new Promise((r)=>setTimeout(r,150));const t=performance.now();window.__flip.keys.push(t);it.click();return {t,via:'menu'}})()`)
        if (!clicked || clicked.miss != null) throw new Error(`no ${label} button on the flip chart's toolbar (front layer has: ${clicked && clicked.miss})`)
        await sleep(DWELL)
        const got = await run(`(()=>{const F=window.__flip;return {key:F.keys[0]||null,frames:F.frames.slice(),res:F.res.slice(),dom:F.dom.slice(),long:F.long.slice(),end:F.sigOf(F.chart),end2:F.chart2?F.sigOf(F.chart2):null,title:document.title,...(F.take?F.take():{})}})()`)
        got.device = await run(`(()=>{try{return window.__uctDeviceDiag?window.__uctDeviceDiag.log():null}catch(e){return 'diag threw'}})()`)
        got.view = await run(`(()=>{const h=(window.__uctChartDebug||{})['flip-chart'];if(!h)return null;let v=null;try{v=h.visibleTimeRange()}catch(e){}let lr=null;try{lr=h.visibleRange()}catch(e){}let nb=null;try{nb=h.newestBar()}catch(e){}let ni=null;try{ni=h.newestIndex()}catch(e){}return {from:v?v.from:null,to:v?v.to:null,lr,ni,count:nb?nb.count:null}})()`)
        // was this timeframe's (base) data asked before the click (a dwell warm, a habitual-tf warm), and had it answered?
        got.warm = await run(`(()=>{const s=${JSON.stringify(sym || '')};const base=${JSON.stringify(baseOf(code))};const k=window.__flip.keys[0]||0;const enc=encodeURIComponent(s);const hits=performance.getEntriesByType('resource').filter((e)=>e.name.indexOf('/api/')>=0&&e.name.indexOf(enc)>=0&&(e.name.indexOf('tf='+base+'&')>=0||e.name.slice(-('tf='+base).length)==='tf='+base||e.name.indexOf('/'+base+'/')>=0));const pre=hits.filter((e)=>e.startTime<k);const done=pre.filter((e)=>e.responseEnd<=k);return {state:done.length?'warm':(pre.length?'in-flight':'cold'),before:pre.length,after:hits.length-pre.length,urls:hits.slice(-4).map((e)=>e.name.replace(location.origin,'').slice(0,90))}})()`)
        out.flips.push({ i, dir: 'tf', sym, tf: code, fromTf: cur, via: clicked.via, before: before.sig, before2: before.sig2, ...got })
        if (JUMP_MS > 0) { await sleep(Math.max(0, JUMP_MS + 200)); const jf = await run(`(()=>{const J=window.__jump||{frames:[]};J.on=false;const db=window.__uctDoubleBuffer;return {frames:J.frames,db:db&&Array.isArray(db.last)?db.last.slice(-4):null,dblog:db&&Array.isArray(db.log)?db.log.slice(-6):null}})()`); const fl = out.flips[out.flips.length - 1]; fl.jump = analyzeJump(jf.frames, fl.key, JUMP_MS); fl.jump.db = jf.db; fl.jump.dblog = jf.dblog; jumpRaw.push({ i: fl.i, dir: 'tf', sym: fl.sym, tf: code, fromTf: cur, key: fl.key, frames: jf.frames }); writeFileSync(OUT.replace(/\.json$/, '') + '.jump.json', JSON.stringify(jumpRaw)) }
        console.log(`tf ${sym} ${cur} -> ${code}: warm=${got.warm && got.warm.state}`)
        cur = code
        save()
      }
    }
  }
  const total = UPDOWN === 'tf' || UPDOWN === 'typed' || UPDOWN === 'jump' || UPDOWN === 'tabs' ? 0 : (UPDOWN === 'downup' ? FLIPS * 2 : FLIPS)
  let cadOverhead = 8, cadSleepEnd = null
  out.cadence = CADENCE || null
  for (let i = 0; i < total; i++) {
    const K = (UPDOWN === 'downup' && i >= FLIPS) ? { key: 'ArrowUp', vk: 38 } : { key: 'ArrowDown', vk: 40 }
    const before = await run(`(()=>{const F=window.__flip;F.arm0&&F.arm0();F.frames.length=0;F.res.length=0;F.keys.length=0;F.dom.length=0;F.long.length=0;return {sig:F.sigOf(F.chart),sig2:F.chart2?F.sigOf(F.chart2):null,now:performance.now()}})()`)
    if (JUMP_MS > 0) { await run(`(()=>{const ids=['flip-chart','flip-chart-2'];const J=window.__jump={frames:[],on:true};const hl0=(id)=>{const W=document.querySelector('[data-widget-id="'+id+'"]');const e=W?[...W.querySelectorAll('[data-testid="sym-label"]')].find((x)=>!x.closest('[inert]')):null;return e?e.textContent.trim():null};const rowSel=()=>document.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]');const scroller=(el)=>{for(let n=el&&el.parentElement;n;n=n.parentElement){const s=getComputedStyle(n);if((s.overflowY==='auto'||s.overflowY==='scroll')&&n.scrollHeight>n.clientHeight)return n}return null};const rect=(id)=>{const W=document.querySelector('[data-widget-id="'+id+'"]');if(!W)return null;let best=null,area=0;for(const c of W.querySelectorAll('canvas')){if(c.closest('[inert]'))continue;const r=c.getBoundingClientRect();if(r.width*r.height>area){area=r.width*r.height;best=r}}return best?[Math.round(best.x),Math.round(best.y),Math.round(best.width),Math.round(best.height)]:null};const t0=performance.now();const tick=()=>{if(!J.on)return;const t=performance.now();const f={t:Math.round(t*10)/10,c:{}};for(const id of ids){const h=(window.__uctChartDebug||{})[id];if(!h)continue;let lr=null,nb=null,ni=null,y0=null,y1=null,vt=null;try{lr=h.visibleRange()}catch(e){}try{const v=h.visibleTimeRange();vt=v?v.from:null}catch(e){}try{nb=h.newestBar()}catch(e){}try{ni=h.newestIndex()}catch(e){}if(nb&&nb.close!=null){try{y0=h.priceToY(nb.close);y1=h.priceToY(nb.close*1.01)}catch(e){}}if(h.autoscaleSources){J.st=J.st||{};J.as=J.as||[];const st=J.st[id]||(J.st[id]={});const idk=(hl0(id)||'')+'|'+(nb?String(nb.time):'');if(st.idk!==idk&&nb&&nb.close!=null){st.idk=idk;st.ref=nb.close;try{st.cache=h.autoscaleSources()}catch(e){st.cache=null}try{st.yr=h.priceToY(st.ref);st.yr1=h.priceToY(st.ref*1.01)}catch(e){}}else if(st.ref!=null){let yr=null,yr1=null;try{yr=h.priceToY(st.ref);yr1=h.priceToY(st.ref*1.01)}catch(e){}if(yr!=null&&st.yr!=null&&(Math.abs(yr-st.yr)>0.5||Math.abs(yr1-st.yr1)>0.5)){let now=null;try{now=h.autoscaleSources()}catch(e){}if(J.as.length<60)J.as.push({t:Math.round(performance.now()*10)/10,id:id,prev:st.cache||null,now:now,y:[st.yr,st.yr1,yr,yr1]});st.cache=now;st.yr=yr;st.yr1=yr1}}}const HW=document.querySelector('[data-widget-id="'+id+'"]');const hl=HW?[...HW.querySelectorAll('[data-testid="sym-label"]')].find((e)=>!e.closest('[inert]')):null;f.c[id]={hs:hl?hl.textContent.trim().slice(0,16):null,lr:lr?[Math.round(lr.from*100)/100,Math.round(lr.to*100)/100]:null,nb:nb?[nb.time,nb.close]:null,ni:ni,y0:y0==null?null:Math.round(y0*10)/10,y1:y1==null?null:Math.round(y1*10)/10,vt:vt,r:rect(id)}}const sel=rowSel();const sc=sel?scroller(sel):null;f.wl=sel?{s:sel.getAttribute('data-watch-sym'),o:sel.offsetTop,top:Math.round(sel.getBoundingClientRect().top),st:sc?Math.round(sc.scrollTop):null}:null;J.frames.push(f);if(t-t0<${JUMP_MS + 3500})requestAnimationFrame(tick);else J.on=false};requestAnimationFrame(tick);return true})()`) }; await castStart(i)
    await run(`(()=>{try{window.__uctDeviceDiag&&window.__uctDeviceDiag.clear()}catch(e){}if(window.__flip.rows)window.__flip.rows.length=0;return true})()`)
    const profiling = PROFILE_FLIPS.has(i)
    const heapSampling = HEAP_FLIPS.has(i)
    if (heapSampling) { await c.send('HeapProfiler.enable'); await c.send('HeapProfiler.startSampling', { samplingInterval: 16384, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true }) }
    if (profiling) { await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 100 }); await c.send('Profiler.start') }
    // Clock alignment for the profile: a 3 ms busy loop in a function named __flipAlign, started at a
    // recorded performance.now(). Its samples in the profile pin profile time to page time, so a report
    // can cut each flip's key..paint window exactly (the profile's own clock has another origin).
    const profAlign = profiling ? await run(`(()=>{const t0=performance.now();const end=t0+3;function __flipAlign(){let x=0;while(performance.now()<end){x++}return x};__flipAlign();return t0})()`) : null
    const tracing = TRACE_FLIPS.has(i)
    let traceAlign = null
    if (tracing) {
      if (!globalThis.__traceSink) {
        globalThis.__traceSink = { on: false, events: [], done: null }
        const T = globalThis.__traceSink
        c.on((m) => {
          if (!T.on) return
          if (m.method === 'Tracing.dataCollected') { for (const e of m.params.value) T.events.push(e) }
          else if (m.method === 'Tracing.tracingComplete') { T.on = false; if (T.done) T.done() }
        })
      }
      const T = globalThis.__traceSink
      T.events = []; T.on = true; T.done = null
      await c.send('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: TRACE_CATS } })
      await sleep(50)
      traceAlign = await run(`(()=>{const t=performance.now();performance.mark('__flipAlign');if(window.__paintProbe)window.__paintProbe.marks=true;return t})()`)
    }
    // --autorepeat=1: a HELD key, as the OS sends it: the first press, then auto-repeated key-downs
    // (`repeat: true` in the page), and ONE key-up after the last (or before a direction change).
    if (CADENCE && cadSleepEnd != null) cadOverhead = 0.7 * cadOverhead + 0.3 * Math.max(0, Date.now() - cadSleepEnd)
    const keyAt = Date.now()
    const firstOfKey = i === 0 || (UPDOWN === 'downup' && i === FLIPS)
    const lastOfKey = i === total - 1 || (UPDOWN === 'downup' && i === FLIPS - 1)
    await c.send('Input.dispatchKeyEvent', { type: 'keyDown', key: K.key, code: K.key, windowsVirtualKeyCode: K.vk, nativeVirtualKeyCode: K.vk, ...(AUTOREPEAT && !firstOfKey ? { autoRepeat: true } : {}) })
    if (!AUTOREPEAT || lastOfKey) await c.send('Input.dispatchKeyEvent', { type: 'keyUp', key: K.key, code: K.key, windowsVirtualKeyCode: K.vk, nativeVirtualKeyCode: K.vk })
    if (profiling) {
      await sleep(700)
      const { profile } = await c.send('Profiler.stop')
      writeFileSync(OUT.replace(/\.json$/, '') + `.flip${i}.cpuprofile`, JSON.stringify(profile))
      await sleep(Math.max(0, DWELL - 700))
    } else if (LAST_DWELL > 0 && i === total - 1) await sleep(LAST_DWELL)
    else if (CADENCE) { await sleep(Math.max(0, keyAt + CADENCE - Date.now() - cadOverhead)); cadSleepEnd = Date.now() }
    else await sleep(DWELL)
    if (heapSampling) {
      const { profile } = await c.send('HeapProfiler.stopSampling')
      writeFileSync(OUT.replace(/\.json$/, '') + `.flip${i}.heapprofile`, JSON.stringify(profile))
    }
    if (tracing) {
      const T = globalThis.__traceSink
      await run(`(()=>{if(window.__paintProbe)window.__paintProbe.marks=false;return true})()`)
      const fin = new Promise((r) => { T.done = r })
      await c.send('Tracing.end')
      await Promise.race([fin, sleep(30000)])
      T.on = false
      writeFileSync(OUT.replace(/\.json$/, '') + `.flip${i}.trace.json`, JSON.stringify({ traceEvents: T.events }))
      T.events = []
    }
    const got = await run(`(()=>{const F=window.__flip;const sel=document.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]');return {key:F.keys[0]||null,keyWall:(function(){var k=F.keys[0],p=k==null?null:(F.kw||[]).find(function(x){return x[0]===k});return p?p[1]:null})(),frames:F.frames.slice(),res:F.res.slice(),dom:F.dom.slice(),long:F.long.slice(),end:F.sigOf(F.chart),end2:F.chart2?F.sigOf(F.chart2):null,sym:sel?sel.getAttribute('data-watch-sym'):null,title:document.title,...(F.take?F.take():{})}})()`)
    got.device = await run(`(()=>{try{return window.__uctDeviceDiag?window.__uctDeviceDiag.log():null}catch(e){return 'diag threw'}})()`)
    got.rows = await run(`(()=>{const F=window.__flip;return F.rows?F.rows.slice():null})()`)
    got.phase = await run(PHASE_JS)
    out.flips.push({ i, dir: K.key, before: before.sig, before2: before.sig2, ...got, ...(profAlign != null ? { profAlign } : {}), ...(traceAlign != null ? { traceAlign } : {}) })
    if (JUMP_MS > 0) { await sleep(Math.max(0, JUMP_MS + 200)); const jf = await run(`(()=>{const J=window.__jump||{frames:[]};J.on=false;const db=window.__uctDoubleBuffer;return {frames:J.frames,autoscale:J.as||[],db:db&&Array.isArray(db.last)?db.last.slice(-4):null,dblog:db&&Array.isArray(db.log)?db.log.slice(-6):null}})()`); const fl = out.flips[out.flips.length - 1]; fl.jump = analyzeJump(jf.frames, fl.key, JUMP_MS); fl.jump.db = jf.db; fl.jump.dblog = jf.dblog; if (jf.autoscale && jf.autoscale.length) fl.jump.autoscale = jf.autoscale; jumpRaw.push({ i: fl.i, dir: fl.dir, sym: fl.sym, key: fl.key, frames: jf.frames }); writeFileSync(OUT.replace(/\.json$/, '') + '.jump.json', JSON.stringify(jumpRaw)); save() }; await castStop()
    if (HEAP_AT.has(i + 1)) await heapSnapshot(i + 1)
    if (HEAP_SAMPLE_N > 0 && i + 1 === HEAP_SAMPLE_N) {
      await c.send('HeapProfiler.collectGarbage')
      const { profile } = await c.send('HeapProfiler.stopSampling')
      out.heapSample = heapSampleSummary(profile)
      writeFileSync(OUT.replace(/\.json$/, '') + '.heapsample.json', JSON.stringify(out.heapSample, null, 1))
      console.log(`heap sample after ${i + 1} arrows: ${out.heapSample.totalMB} MB retained; top chunks ${JSON.stringify(out.heapSample.byChunk.slice(0, 5))}`)
      save()
    }
    save()
  }
  // --tfs=1W,1D,1W: after the flips, switch the chart's timeframe through these (the labels of the
  // buttons in its timeframe bar), one per dwell, recorded exactly like a flip into <out>.tf.json
  // so the same reports read it: do the indicators arrive with the candles on a timeframe switch?
  // --peek=<js expression>: evaluated in the page after the flips (and again after the timeframe
  // switches), the JSON-able result kept as out.peek / out.peekAfterTfs. For asking the page what
  // it holds at the moment that matters (a storage key, a counter an override chunk keeps).
  if (STALE_CHECK) {
    await sleep(3000)
    out.staleCheck = await run(`(()=>{const d=window.__uctChartDebug||{};const now=Date.now()/1000;return Object.keys(d).map(id=>{let nb=null;try{nb=d[id].newestBar()}catch(e){}const t=nb&&nb.time;const ts=typeof t==='number'?t:(t&&t.year?Date.UTC(t.year,t.month-1,t.day)/1000:(typeof t==='string'?Date.parse(t)/1000:null));return {id,count:nb?nb.count:null,time:t,ageSec:ts?Math.round(now-ts):null}})})()`)
    console.log(`stale check: ${JSON.stringify(out.staleCheck)}`)
    save()
  }
  if (DB_STATS) {
    out.dbEnd = await run(`(()=>{const s=window.__uctDoubleBuffer;return s?JSON.parse(JSON.stringify({flips:s.flips,switches:s.switches,why:s.why,retargets:s.retargets,log:Array.isArray(s.log)?s.log.slice(-300):undefined,last:Array.isArray(s.last)?s.last.slice(-32):undefined})):null})()`)
    const s0 = out.dbStart || { flips: 0, switches: 0, why: {} }
    const s1 = out.dbEnd || { flips: 0, switches: 0, why: {} }
    const why = {}
    for (const k of Object.keys(s1.why || {})) { const d = (s1.why[k] || 0) - ((s0.why || {})[k] || 0); if (d) why[k] = d }
    const flips = (s1.flips || 0) - (s0.flips || 0)
    const switches = (s1.switches || 0) - (s0.switches || 0)
    out.dbPass = { flips, switches, flipRate: flips + switches ? Math.round(1000 * flips / (flips + switches)) / 10 : null, why, present: !!out.dbEnd }
    console.log(`double buffer this pass: ${JSON.stringify(out.dbPass)}`)
    save()
  }
  if (MEM_PROBE) { out.memEnd = await memNow(); console.log(`memory at the end: ${JSON.stringify(out.memEnd)}`); save() }
  if (replay) { out.replay = await replay.finalReport(); save() }
  try { out.pageClockEnd = await run('({timeOrigin:performance.timeOrigin,dateNow:Date.now(),perfNow:performance.now()})') } catch (e) { /* none */ }
  // rs = the HTTP status (2026-11-28): a 429 is production's rate limiter answering THIS instrument (grade.py counts them)
  out.allRes = await run(`performance.getEntriesByType('resource').filter((e)=>e.name.indexOf('/api/')>=0).map((e)=>({u:e.name.replace(location.origin,''),s:Math.round(e.startTime),e:Math.round(e.responseEnd),ttfb:Math.round(e.responseStart-e.startTime),rs:e.responseStatus,st:(e.serverTiming||[]).map((x)=>x.name+(x.description?'('+x.description+')':'')+'='+Math.round(x.duration)).join(',')}))`)
  save()
  if (out.idbtrace) {
    out.idbTrace = await run(`(()=>{const T=window.__idbTrace;return T?{tx:T.tx,req:T.req}:null})()`)
    save()
  }
  const PEEK = arg('peek', '')
  const peek = async () => { try { return await run(`(()=>{try{return JSON.parse(JSON.stringify(${PEEK}))}catch(e){return 'peek threw: '+e.message}})()`) } catch (e) { return `peek failed: ${e.message}` } }
  if (PEEK) { out.peek = await peek(); save() }
  // --act=<js expression, may be a promise>: evaluated in the page after the flips and AWAITED,
  // the JSON-able result kept as out.act. For doing something to the chart that takes time to
  // answer (zoom out, wait for the repaint, read what the series hold now).
  // (--act=@<file> reads the expression from a file: a long one does not survive a shell's quoting)
  const actArg = arg('act', '')
  const ACT = actArg.startsWith('@') ? readFileSync(actArg.slice(1), 'utf8').trim() : actArg
  if (ACT) {
    try { out.act = await run(`(async()=>{try{return JSON.parse(JSON.stringify(await (${ACT})))}catch(e){return 'act threw: '+e.message}})()`) } catch (e) { out.act = `act failed: ${e.message}` }
    save()
  }
  const TFS = arg('tfs', '').split(',').filter(Boolean)
  if (TFS.length) {
    const tfOut = { ...out, flips: [], tfSwitches: TFS }
    for (let i = 0; i < TFS.length; i++) {
      const before = await run(`(()=>{const F=window.__flip;F.arm0&&F.arm0();F.frames.length=0;F.res.length=0;F.keys.length=0;F.dom.length=0;F.long.length=0;return {sig:F.sigOf(F.chart),sig2:F.chart2?F.sigOf(F.chart2):null,now:performance.now()}})()`)
      const clicked = await run(`(()=>{const w=document.querySelector('[data-widget-id="flip-chart"]');const b=[...w.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(TFS[i])});if(!b)return null;const t=performance.now();b.click();return t})()`, true)
      if (clicked == null) {
        const have = await run(`(()=>{const w=document.querySelector('[data-widget-id="flip-chart"]');return w?[...w.querySelectorAll('button')].map(x=>x.textContent.trim()).filter(t=>t&&t.length<=4).join(' '):'no chart widget'})()`)
        throw new Error(`no timeframe button labelled ${TFS[i]} in the chart's bar (short button labels there: ${have})`)
      }
      await sleep(DWELL)
      const got = await run(`(()=>{const F=window.__flip;return {frames:F.frames.slice(),res:F.res.slice(),dom:F.dom.slice(),long:F.long.slice(),end:F.sigOf(F.chart),end2:F.chart2?F.sigOf(F.chart2):null,title:document.title,...(F.take?F.take():{})}})()`)
      tfOut.flips.push({ i, dir: `tf ${TFS[i]}`, before: before.sig, key: clicked, ...got })
      writeFileSync(OUT.replace(/\.json$/, '') + '.tf.json', JSON.stringify(tfOut, null, 1))
    }
    if (PEEK) { out.peekAfterTfs = await peek(); save() }
  }
  // --reloads=N: after the flips, reload the page N times and record, from the start of each new
  // document, the frame the candles first appear in and the frame each series first has a value:
  // how long the FIRST chart of a page load waits for its indicators.
  const RELOADS = Number(arg('reloads', '0'))
  if (RELOADS > 0) {
    await sleep(2500) // the group's symbol and anything queued for this browser's stores are written
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: RELOAD_SAMPLER })
    out.reloads = []
    // --reload-profile=1 (owner3, 2026-11-27): a CPU profile (250 us) across each reload, saved as <out>.reload<i>.cpuprofile;
    // with the new document's long tasks (R.long) it measures a once-per-page-life cost (the closeTime memo A/B)
    const RELOAD_PROFILE = arg('reload-profile', '') === '1'
    for (let i = 0; i < RELOADS; i++) {
      if (RELOAD_PROFILE) { await c.send('Profiler.enable'); await c.send('Profiler.setSamplingInterval', { interval: 250 }); await c.send('Profiler.start') }
      await c.send('Page.reload', {})
      await sleep(Number(arg('reload-wait', '7000')))
      if (RELOAD_PROFILE) {
        try { const { profile } = await c.send('Profiler.stop'); writeFileSync(OUT.replace(/\.json$/, '') + `.reload${i}.cpuprofile`, JSON.stringify(profile)) } catch (e) { console.log(`reload ${i}: profile not saved: ${String(e).slice(0, 120)}`) }
        const lg = await run(`(()=>{const R=window.__reload;return R&&R.long?R.long.slice():null})()`)
        out.reloadLong = out.reloadLong || []
        out.reloadLong.push(lg)
      }
      const got = await run(`(()=>{const R=window.__reload;return R?{frames:R.frames,res:R.res,sym:(document.querySelector('[data-watch-sym][aria-selected="true"],[data-watch-sym][data-selected="true"],[data-watch-sym][class*="listRowSelected"]')||{getAttribute(){return null}}).getAttribute('data-watch-sym'),title:document.title}:null})()`)
      out.reloads.push(got)
      save()
    }
  }
  // --shot=<file.png>: what the page looks like at the end of the last flip
  const SHOT = arg('shot', '')
  if (SHOT) {
    const { data } = await c.send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(SHOT, Buffer.from(data, 'base64'))
    out.shot = SHOT
  }
  if (arg('memory', '') === '1') {
    try { out.memory = await probeMemory(PORT) } catch (e) { out.memory = { error: String(e) } }
    try { out.storage = await run(OPFS_JS) } catch (e) { out.storage = { error: String(e) } }
    console.log(`memory: page ${JSON.stringify(out.memory && out.memory.page && out.memory.page.heap)}; workers ${JSON.stringify((out.memory && out.memory.workers || []).map((w) => [w.url.split('/').pop(), w.heap && w.heap.usedSize]))}`)
    save()
  }
} catch (e) {
  if (e instanceof DryDone) { /* the dry run's own end: its exit code is already set */ } else {
  // owner3 (2026-11-26): a stopped run exits 2 = INCONCLUSIVE, never 0 (a board left unrestored below still makes it 1)
  exitCode = 2
  out.inconclusive = true
  out.error = String((e && e.stack) || e).slice(0, 600)
  console.log(`run stopped: ${out.error}`)
  }
} finally {
  if (!DRY && out.labels) { try { out.labelsEnd = await labelsNow(app.run) } catch { /* the label never breaks a run */ } }
  if (out.build) { try { out.buildEnd = await app.run(BUILDS_JS) } catch { /* a label never breaks a run */ } }
  if (tabsCleanup) {
    try { out.tabsCleanup = await tabsCleanup(); console.log(`tab layouts cleaned up: ${JSON.stringify(out.tabsCleanup)}`) } catch (e) { out.tabsCleanup = `FAILED: ${String(e.message).slice(0, 120)}`; console.log(`TAB LAYOUTS NOT CLEANED UP: ${out.tabsCleanup}`) }
  }
  if (deleteCreatedDefs) {
    try { out.userDefDeleted = await deleteCreatedDefs(); console.log(`user definition deleted: ${out.userDefDeleted}`) } catch (e) { out.userDefDeleted = `FAILED: ${String(e.message).slice(0, 120)}`; console.log(`USER DEFINITION NOT DELETED: ${out.userDefDeleted}`) }
  }
  if (board && originalVersion !== null) {
    try {
      // ⛔ A CONFLICT IS RETRIED, AND THE RESULT IS READ BACK. The page under test autosaves the
      // board (the group's symbol changes on every flip, debounced), so a save can land between
      // reading the head and restoring: the restore then answers 409 and the bench board is left
      // on the test layout (it happened on 2026-11-12, at 0.7 s a flip). Wait out the debounce,
      // retry on 409, and exit non-zero if the recorded board is not back.
      // ⛔ AND A SITE THAT IS RESTARTING IS WAITED FOR. A deploy landed during a run on 2026-11-13:
      // the head read answered an HTML error page, the restore threw, and the bench board was
      // left on the test layout until it was put back by hand. An answer that is not a version
      // number (or a restore that is neither 200 nor 409) is retried for about two minutes.
      await sleep(1500)
      let st = null
      for (let k = 0; k < 30; k++) {
        let head = null
        try { head = await board.head() } catch { head = null }
        if (head === originalVersion) { st = 'unchanged'; break }
        if (typeof head !== 'number') { st = 'site not answering'; await sleep(5000); continue }
        try { st = await board.restore(originalVersion, head) } catch { st = 'site not answering' }
        if (st === 200) break
        await sleep(st === 409 ? 1000 : 5000)
      }
      out.boardRestore = st
      console.log(`board restore: ${out.boardRestore}`)
      if (st !== 200 && st !== 'unchanged') { exitCode = 1; console.log(`BOARD NOT RESTORED: put version ${originalVersion} back with --restore=${originalVersion}`) }
    } catch (e) {
      out.boardRestore = `FAILED: ${String(e.message).slice(0, 120)}; restore version ${originalVersion} by hand`
      console.log(out.boardRestore)
      exitCode = 1
    }
  }
  // the fresh watchlist goes whatever happened to the board (it holds this run's tickers only)
  if (freshCleanup) {
    try { out.freshListDeleted = await freshCleanup() } catch (e) { out.freshListDeleted = 'FAILED' }
    console.log(`fresh watchlist deleted: ${out.freshListDeleted}`)
  }
  // (isolate=browser) THE PROOF THE ACCOUNT WAS NOT WRITTEN: the interception off, the account's REAL board revision
  // read again; it must equal the one read before the pass (another session writing the bench board in account
  // mode at the same time would also move it, and is the only other cause)
  if (out.isolation && out.isolation.mode === 'browser') {
    const I = out.isolation
    try {
      await app.c.send('Fetch.disable')
      I.accountVersionStart = I.accountVersionStart ?? null
      I.accountVersionEnd = await app.run(`fetch('/api/workspace/doc?board=charts',{credentials:'include',cache:'no-store'}).then(r=>r.ok?r.json().then(j=>j.version):'status '+r.status).catch(e=>'failed')`)
      I.accountUntouched = I.accountVersionStart == null ? null : I.accountVersionEnd === I.accountVersionStart
      console.log(`isolation: the account's own board revision ${I.accountVersionStart} before, ${I.accountVersionEnd} after (${I.accountUntouched ? 'untouched' : 'MOVED'}); answered here ${JSON.stringify(I.answered)}; other writes the page sent: ${JSON.stringify([...new Set(I.passedWrites)])}${I.errors.length ? `; ERRORS ${JSON.stringify(I.errors)}` : ''}`)
    } catch (e) { I.accountVersionEnd = `unread: ${String(e && e.message).slice(0, 80)}` }
  }
  if (replay) {
    try {
      out.replay = replay.report()
      const r = out.replay
      console.log(`replay: ${r.bars.rewritten} bars answers rewritten (${r.bars.failedClosed} refused unread, ${r.bars.passedNoRows} without rows), held median ${r.heldMs.median} ms p90 ${r.heldMs.p90}; 1m books ${r.own.ok}/${r.own.asked}; 1m depth restored ${r.depth.restored}, short ${r.depth.short}; fold check ${r.foldCheck.agree} agree / ${r.foldCheck.disagree} disagree; live-price polls answered empty ${r.livePricesAnswered}; envelope fields left ahead of the clock: ${JSON.stringify(r.futureFieldsNotRewritten)}`)
    } catch { /* the report never breaks a run */ }
  }
  save()
  // --graceful-close: the browser quits on its own (and writes its pending localStorage) before the kill
  await app.close({ graceful: !!arg('graceful-close', '') })
}
process.exit(exitCode)
