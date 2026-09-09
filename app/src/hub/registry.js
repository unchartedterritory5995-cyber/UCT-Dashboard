// Joystick hub — the registry. Every mode and action the hub can perform, as data.
// See docs/plans/joystick/00-master-spec-v1.3.md §4 (types), §7 (modes), Part C (per-section map).
//
// ⛔ DIRECTOR-ONLY FILE. Everyone else proposes changes as a diff in their report (Part D, D2).
//
// ⭐ THE ONE IDEA: adding a section is a DATA change, never a code change. If a new mode needs the
// gesture engine to learn something, the seam is missing — say so rather than special-casing here.
//
// ⚠️ THIS FILE IS PLAIN JS, NOT TYPESCRIPT, AND THAT IS LOAD-BEARING. The app has no tsconfig.json,
// no `typescript` dependency, and 0 .ts/.tsx files across 1,332 .jsx files; adding TS would be a new
// dependency, which the spec's ground rules forbid. The JSDoc typedefs below are editor hints that
// NOTHING CHECKS AT BUILD TIME. `validateRegistry()` is therefore not a convenience — it is the only
// enforcement that exists, and its test is the only thing standing between a typo and a dead bubble.

/**
 * @typedef {'symbol'|'position'|'list'|'flagged'|'chart'} HubRequirement
 * What a context must supply for an action to be usable. Unmet -> the bubble still renders,
 * disabled, with a reason. Never hidden.
 */

/**
 * @typedef {Object} HubAction
 * @property {string}   id           '<mode>.<action>', unique across the whole registry.
 * @property {string}   label        <=10 chars, sentence case.
 * @property {string}   icon         A UICON_NAMES value. Validated, never optional — colour is
 *                                   never the only signal (spec C2).
 * @property {0|1}      ring         0 = outer (hard push, <=5) · 1 = inner (soft push, <=4).
 * @property {string}   color        A --hub-* token name. Never a literal.
 * @property {'navigate'|'run'|'confirm'|'home'} kind
 * @property {string}  [to]          Route or mode id, for kind:'navigate'.
 * @property {Function}[run]         (ctx) => void|Promise<void>, for kind:'run'.
 * @property {Function}[confirmText] (ctx) => string. REQUIRED when kind === 'confirm'.
 * @property {HubRequirement[]} [requires]
 * @property {Function}[enabled]     (ctx) => boolean.
 * @property {boolean} [flickable]   Default true. false = deliberate selection only, never a
 *                                   <120ms flick. Only meaningful on kind:'confirm'.
 */

/**
 * @typedef {Object} HubMode
 * @property {string}  id
 * @property {string}  label
 * @property {string}  color         A --hub-mode-* token.
 * @property {string} [route]        Omitted for in-place modes (catalysts lives on /dashboard).
 * @property {string}  tapHint       What the chip says tap does, e.g. 'tap: next result'.
 * @property {{listId: string}} [cursor]
 * @property {Function}[onTap]
 * @property {Function}[onDoubleTap]
 * @property {Function}[onScrub]       (ctx, delta) => void
 * @property {Function}[onScrubCommit] (ctx) => void
 * @property {HubAction[]} fan
 */

export const OUTER_MAX = 5;
export const INNER_MAX = 4;

/** Every legal `requires` literal. validateRegistry rejects anything else. */
export const HUB_REQUIREMENTS = ['symbol', 'position', 'list', 'flagged', 'chart'];

/**
 * The one mode allowed to end its inner ring with something other than Home.
 * You are already home; a Home bubble there would be a no-op that looks like an action.
 */
export const HOME_MODE_ID = 'home';

/** Identity helper. Exists so a mode object is never assembled ad hoc at a call site. */
export function defineMode(mode) {
  return mode;
}

// ── Shared action builders ──────────────────────────────────────────────────
// Cross-section conventions from spec C4: these mean the same thing in every mode, so they are
// built once. A second definition of "Flag" is a second authority over what Flag means.

/** Voice — the orb's own handler, on the inner ring of every mode. */
const voice = (mode) => ({
  id: `${mode}.voice`,
  label: 'Voice',
  icon: 'mic',
  ring: 1,
  color: `--hub-mode-${mode}`,
  kind: 'run',
});

/** Home — hold-0.5s equivalent, and the last inner-ring action of every mode except home. */
const home = (mode) => ({
  id: `${mode}.home`,
  label: 'Home',
  icon: 'compass',
  ring: 1,
  color: '--hub-mode-home',
  kind: 'home',
});

/** Flag — always useFlagged().toggle(symbol). Never UCT20, which is read-only. */
const flag = (mode, ring = 0) => ({
  id: `${mode}.flag`,
  label: 'Flag',
  icon: 'flag',
  ring,
  color: `--hub-mode-${mode}`,
  kind: 'run',
  requires: ['symbol'],
});

/** Note — always a Notebook entry pinned to the current symbol. */
const note = (mode, ring = 0) => ({
  id: `${mode}.note`,
  label: 'Note',
  icon: 'pin',
  ring,
  color: '--hub-mode-notebook',
  kind: 'run',
  requires: ['symbol'],
});

/** Chart it — jump to the chart on the shared symbol. */
const chartIt = (mode) => ({
  id: `${mode}.chartIt`,
  label: 'Chart it',
  icon: 'chart',
  ring: 0,
  color: '--hub-mode-chart',
  kind: 'navigate',
  to: 'chart',
  requires: ['symbol'],
});

/** Why? — Sonar research on the current symbol, via /ai-search. */
const why = (mode, ring = 0) => ({
  id: `${mode}.why`,
  label: 'Why?',
  icon: 'sparkle',
  ring,
  color: `--hub-mode-${mode}`,
  kind: 'navigate',
  to: '/ai-search',
  requires: ['symbol'],
});

/** Plan trade — writes to hub_planned_trades. Never a broker. Opens the Plan-trade sheet. */
const planTrade = (mode) => ({
  id: `${mode}.planTrade`,
  label: 'Plan trade',
  icon: 'equity',
  ring: 0,
  color: '--hub-mode-journal',
  // ⛔ `run`, NOT `confirm` (R-16). Since R-09 wired the confirm branch, a `confirm` here opened
  // HubConfirmSheet AND the section opened the Plan-trade sheet — two sheets stacked on one
  // gesture. Plan trade IS its own sheet; a generic "Plan NVDA?" confirmation in front of it asks
  // the member to approve opening a form. The plan said `run` all along (§3.3).
  kind: 'run',
  requires: ['symbol'],
});

/** Alert — at LAST price, not crosshair. crosshairData is private to StockChart (deferred D-03). */
const alert = (mode) => ({
  id: `${mode}.alert`,
  label: 'Alert',
  icon: 'bell',
  ring: 0,
  color: `--hub-mode-${mode}`,
  kind: 'confirm',
  requires: ['symbol'],
  confirmText: (ctx) => `Alert on ${ctx?.symbol ?? ''}`.trim(),
});

// ── The ten modes ───────────────────────────────────────────────────────────

export const modes = [
  // 1 ── wire. The best-supported section: its segments are already addressable DOM.
  defineMode({
    id: 'wire',
    label: 'Wire',
    color: '--hub-mode-wire',
    route: '/morning-wire',
    tapHint: 'tap: next segment',
    cursor: { listId: 'wire' },
    fan: [chartIt('wire'), flag('wire'), note('wire'), voice('wire'), home('wire')],
  }),

  // 2 ── breadth. Targets the Views tab; the hub switches tabs rather than disabling the scrub.
  defineMode({
    id: 'breadth',
    label: 'Breadth',
    color: '--hub-mode-breadth',
    route: '/breadth',
    // ⚰️ WAS 'tap: next session'. Tap steps the TAB, not a session — nothing in Breadth's hub
    // binding has ever touched a session. Invisible while `breadth` sits in PREVIEW_MODES (the
    // chip shows "Preview — more coming"), which is exactly why it survived: copy that no one can
    // see is copy no one checks, and it would have become wrong the moment the preview exited.
    // Found by the 3.2 integrator, corrected here because registry.js is Director-owned.
    tapHint: 'tap: next tab',
    fan: [
      // ⚰️ `breadth.sizeRule` AND `breadth.snapshot` ARE REMOVED, NOT DEFERRED (B2).
      //
      // Both were `kind: 'run'` with NO `run` handler and no `requires`, so they rendered
      // ALWAYS-ENABLED and did nothing: `HubRoot` does `Promise.resolve(action.run?.(ctx))`,
      // which on `undefined` resolves silently — no throw, no warn, no toast. The member drags to
      // "Snapshot", the fan closes, nothing happens. Invisible while `breadth` sat in
      // PREVIEW_MODES (the projection hid them); live the moment it left.
      //
      // Dropped rather than shipped inert, on the R-13 precedent set when the Screener's "Scans"
      // had no seam. A bubble that answers a deliberate gesture with silence teaches the member
      // the product is broken — worse than an absent action, which at least tells the truth. They
      // come back with their handlers, in their own increment.
      voice('breadth'),
      home('breadth'),
    ],
  }),

  // 3 ── scan. The only mode with explicit flick assignments (up = Chart it, left = Flag).
  defineMode({
    id: 'scan',
    label: 'Scan',
    color: '--hub-mode-scan',
    route: '/screener',
    tapHint: 'tap: next result',
    cursor: { listId: 'scan' },
    fan: [
      chartIt('scan'),
      flag('scan'),
      alert('scan'),
      planTrade('scan'),
      {
        id: 'scan.scans',
        label: 'Scans',
        icon: 'sliders',
        ring: 1,
        color: '--hub-mode-scan',
        kind: 'run',
      },
      why('scan', 1),
      voice('scan'),
      home('scan'),
    ],
  }),

  // 4 ── chart. Compare and pan both ship (Wave 0.5 feasibility). Draw/Indicator deferred.
  defineMode({
    id: 'chart',
    label: 'Chart',
    color: '--hub-mode-chart',
    route: '/charts',
    tapHint: 'tap: next timeframe',
    fan: [
      planTrade('chart'),
      alert('chart'),
      flag('chart'),
      {
        id: 'chart.compare',
        label: 'Compare',
        icon: 'columns',
        ring: 0,
        color: '--hub-mode-chart',
        kind: 'run',
        requires: ['chart'],
      },
      {
        id: 'chart.logTrade',
        label: 'Log trade',
        icon: 'journal',
        ring: 1,
        color: '--hub-mode-journal',
        kind: 'run',
        requires: ['symbol'],
      },
      note('chart', 1),
      voice('chart'),
      home('chart'),
    ],
  }),

  // 5 ── journal. Move stop, Breakeven and Close are ALL confirm. Close is not flickable.
  defineMode({
    id: 'journal',
    label: 'Journal',
    color: '--hub-mode-journal',
    route: '/journal/trades',
    tapHint: 'tap: next position',
    cursor: { listId: 'journal' },
    fan: [
      chartIt('journal'),
      {
        id: 'journal.moveStop',
        label: 'Move stop',
        icon: 'moveStop',
        ring: 0,
        color: '--hub-mode-journal',
        kind: 'confirm',
        requires: ['position'],
        confirmText: (ctx) => `Set stop on ${ctx?.selectedPosition?.symbol ?? ''}`.trim(),
      },
      {
        id: 'journal.breakeven',
        label: 'Breakeven',
        icon: 'shield',
        ring: 0,
        color: '--hub-mode-journal',
        kind: 'confirm',
        requires: ['position'],
        confirmText: (ctx) => `Stop to breakeven on ${ctx?.selectedPosition?.symbol ?? ''}`.trim(),
      },
      {
        // ⛔ The highest-stakes action in the hub: it writes a permanent j2_trades row.
        // flickable:false means a flick in this direction OPENS THE FAN instead of firing.
        id: 'journal.close',
        label: 'Close',
        icon: 'x',
        ring: 0,
        color: '--ut-red',
        kind: 'confirm',
        flickable: false,
        requires: ['position'],
        confirmText: (ctx) => `Close ${ctx?.selectedPosition?.symbol ?? ''}`.trim(),
      },
      {
        id: 'journal.addTrade',
        label: 'Add trade',
        icon: 'plus',
        ring: 1,
        color: '--hub-mode-journal',
        kind: 'run',
      },
      note('journal', 1),
      voice('journal'),
      home('journal'),
    ],
  }),

  // 6 ── catalysts. In-place on /dashboard, no route. No scrub (the data is an overwritten snapshot).
  defineMode({
    id: 'catalysts',
    label: 'Catalysts',
    color: '--hub-mode-catalysts',
    tapHint: 'tap: next row',
    cursor: { listId: 'catalysts' },
    fan: [
      chartIt('catalysts'),
      flag('catalysts'),
      why('catalysts'),
      {
        // Opens the tile's own filter UI. It does NOT cycle: the real state is a multi-select Set
        // defaulting to all four on, and collapsing it to a singleton would redefine the tile.
        id: 'catalysts.filter',
        label: 'Filter',
        icon: 'sliders',
        ring: 1,
        color: '--hub-mode-catalysts',
        kind: 'run',
      },
      note('catalysts', 1),
      voice('catalysts'),
      home('catalysts'),
    ],
  }),

  // 7 ── notebook. The two inner shortcuts deep-link existing templates.
  defineMode({
    id: 'notebook',
    label: 'Notebook',
    color: '--hub-mode-notebook',
    route: '/journal/notebook',
    tapHint: 'tap: next note',
    cursor: { listId: 'notebook' },
    fan: [
      {
        id: 'notebook.newNote',
        label: 'New note',
        icon: 'edit',
        ring: 0,
        color: '--hub-mode-notebook',
        kind: 'run',
      },
      {
        id: 'notebook.linkTicker',
        label: 'Set ticker',
        icon: 'link',
        ring: 0,
        color: '--hub-mode-notebook',
        kind: 'run',
        requires: ['symbol'],
      },
      {
        id: 'notebook.templates',
        label: 'Templates',
        icon: 'library',
        ring: 0,
        color: '--hub-mode-notebook',
        kind: 'run',
      },
      {
        id: 'notebook.dailyPlan',
        label: 'Daily plan',
        icon: 'sun',
        ring: 1,
        color: '--hub-mode-notebook',
        kind: 'navigate',
        to: '/journal/notebook?new=daily-prep',
      },
      {
        id: 'notebook.postMortem',
        label: 'Postmortem',
        icon: 'eye',
        ring: 1,
        color: '--hub-mode-notebook',
        kind: 'navigate',
        to: '/journal/notebook?new=trade-review',
      },
      voice('notebook'),
      home('notebook'),
    ],
  }),

  // 8 ── calendar. UI label is "UCT Terminal"; the plumbing stays `calendar`.
  defineMode({
    id: 'calendar',
    label: 'Calendar',
    color: '--hub-mode-calendar',
    route: '/calendar',
    tapHint: 'tap: next day',
    cursor: { listId: 'calendar' },
    fan: [
      {
        id: 'calendar.earnings',
        label: 'Earnings',
        icon: 'earnings',
        ring: 0,
        color: '--hub-mode-calendar',
        kind: 'run',
      },
      {
        id: 'calendar.macro',
        label: 'Macro',
        icon: 'globe',
        ring: 0,
        color: '--hub-mode-calendar',
        kind: 'run',
      },
      {
        id: 'calendar.myNames',
        label: 'My names',
        icon: 'star',
        ring: 0,
        color: '--hub-mode-calendar',
        kind: 'navigate',
        to: '/calendar/mystocks',
      },
      voice('calendar'),
      home('calendar'),
    ],
  }),

  // 9 ── home. THE ONE MODE whose inner ring does not end with Home — you are already there.
  defineMode({
    id: 'home',
    label: 'Home',
    color: '--hub-mode-home',
    route: '/dashboard',
    tapHint: 'tap: last section',
    fan: [
      { id: 'home.scan', label: 'Scan', icon: 'screener', ring: 0, color: '--hub-mode-scan', kind: 'navigate', to: 'scan' },
      { id: 'home.chart', label: 'Chart', icon: 'chart', ring: 0, color: '--hub-mode-chart', kind: 'navigate', to: 'chart' },
      { id: 'home.breadth', label: 'Breadth', icon: 'breadth', ring: 0, color: '--hub-mode-breadth', kind: 'navigate', to: 'breadth' },
      { id: 'home.wire', label: 'Wire', icon: 'wire', ring: 0, color: '--hub-mode-wire', kind: 'navigate', to: 'wire' },
      { id: 'home.flow', label: 'Flow', icon: 'flow', ring: 0, color: '--hub-mode-flow', kind: 'navigate', to: 'flow' },
      { id: 'home.journal', label: 'Journal', icon: 'journal', ring: 1, color: '--hub-mode-journal', kind: 'navigate', to: 'journal' },
      { id: 'home.notebook', label: 'Notebook', icon: 'book', ring: 1, color: '--hub-mode-notebook', kind: 'navigate', to: 'notebook' },
      { id: 'home.calendar', label: 'Calendar', icon: 'calendar', ring: 1, color: '--hub-mode-calendar', kind: 'navigate', to: 'calendar' },
      voice('home'),
    ],
  }),

  // 10 ── flow. Navigate-only: OptionsFlow.jsx exports nothing but its default component.
  defineMode({
    id: 'flow',
    label: 'Flow',
    color: '--hub-mode-flow',
    route: '/options-flow',
    tapHint: 'navigate only',
    fan: [voice('flow'), home('flow')],
  }),
];

/** Lookup by id. Built once; the array above stays the single source of order. */
export const modesById = Object.fromEntries(modes.map((m) => [m.id, m]));

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE 2.5 — THE PREVIEW PROJECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Is the navigation-only preview in effect?
 *
 * ⭐ A PROJECTION OVER THE REGISTRY, NEVER A DESTRUCTIVE EDIT. Phase 3 continues on this same
 * branch and needs every fan above intact, so the preview narrows what is SHOWN rather than
 * deleting what is DEFINED. Flip this to `false` when Phase 3 wires the section actions.
 */
/**
 * Which modes are still showing the PREVIEW fan rather than their real one.
 *
 * ⛔ PER-MODE, NOT ONE GLOBAL BOOLEAN. Phase 3 ships section by section (Wire, then Breadth,
 * then Screener, …), and a single `PREVIEW` flag would force all nine to flip together —
 * which would mean either shipping unfinished sections or holding finished ones back. Each
 * section leaves this set in its own increment; the set empties when Phase 3 completes.
 *
 * ⭐ A SET OF MODE IDS, so "is this mode still preview?" is one lookup and the remaining work
 * is readable at a glance rather than inferred from a boolean plus a comment.
 */
export const PREVIEW_MODES = new Set([
  // ⭐ INCREMENT 2 FLIPPED FOUR TOGETHER: wire, breadth, scan, journal. Together, and not one at a
  // time, because their fans share actions (Chart it, Flag, Plan trade) and half-finished siblings
  // would put a bubble in front of an admin that works on one section and dies on the next.
  //
  // ⛔ THE REMAINING SIX STAY, and each still returns [Voice, Home] until its own increment.
  // A mode removed from this set gets its FULL fan the same render — which is how `calendar`
  // shipped a five-action fan into a navigation-only preview on the first attempt.
  'chart', 'catalysts', 'notebook', 'calendar', 'home', 'flow',
]);

/** True while ANY mode is still on its preview fan — for copy and rails, never for gating. */
export const PREVIEW = PREVIEW_MODES.size > 0;

/**
 * ⛔ EVERY MODE MUST BE ACCOUNTED FOR. A mode missing from this set silently returns its FULL
 * fan — which is how `calendar` shipped a five-action fan into a navigation-only preview on the
 * first attempt, caught only by `validatePreview`. `registry.test.js` asserts set membership
 * against `modes` so a mode added later cannot quietly default to "already shipped".
 */
/** Is this specific mode still showing its preview fan? */
export const isPreviewMode = (modeId) => PREVIEW_MODES.has(modeId);

/**
 * Home's preview fan (owner ruling, 2026-09-09).
 *
 *   outer — Screener · Charts · Flow · Breadth
 *   inner — Journal · Notebook · Wire · Voice
 *
 * ⚠️ Two deliberate differences from the full Home fan above, both owner decisions:
 * **Wire moves outer -> inner** (`/morning-wire` is a real route; this is placement, not
 * scope), and **Calendar is dropped from the preview** — still reachable through ordinary nav,
 * and it returns in Phase 3 with its in-section actions.
 * **Catalysts is absent because it has no route at all** (Wave 0: an in-place dashboard tile
 * mode), so it could not be a navigate target even if it were wanted.
 */
const PREVIEW_HOME = [
  { id: 'home.scan', ring: 0 },
  { id: 'home.chart', ring: 0 },
  { id: 'home.flow', ring: 0 },
  { id: 'home.breadth', ring: 0 },
  { id: 'home.journal', ring: 1 },
  { id: 'home.notebook', ring: 1 },
  { id: 'home.wire', ring: 1 },
  { id: 'home.voice', ring: 1 },
];

/**
 * The fan a mode actually shows right now.
 *
 * ⛔ AN UNWIRED ACTION IS ABSENT, NEVER PRESENT-AND-INERT. Phase 2 answered `run`/`confirm`
 * with a "Phase 3" toast; the preview does not ship that. A control that answers a deliberate
 * gesture with "not yet" teaches the user the product is unfinished — one that is not there
 * teaches them nothing false.
 *
 * Home keeps a real fan; every other mode is `[Voice, Home]` until Phase 3.
 *
 * @param {HubMode} mode
 * @returns {HubAction[]}
 */
export function fanFor(mode) {
  if (!mode) return [];
  if (!isPreviewMode(mode.id)) return mode.fan;
  if (mode.id === HOME_MODE_ID) {
    const byId = Object.fromEntries(mode.fan.map((a) => [a.id, a]));
    return PREVIEW_HOME
      .filter((p) => byId[p.id])
      .map((p) => ({ ...byId[p.id], ring: p.ring }));
  }
  return mode.fan.filter((a) => a.kind === 'run' || a.kind === 'home')
    .filter((a) => a.id.endsWith('.voice') || a.kind === 'home');
}

/**
 * Preview-scoped rule: **Voice is the only `run` action anywhere in the preview.**
 *
 * The preview is sold as navigation-only-plus-Voice. Anything else that DOES something rather
 * than going somewhere would make that sentence false, and the sentence is what members are
 * told. Scoped to `PREVIEW` so Phase 3 can add real `run` actions without editing this rule.
 *
 * @returns {string[]} problems; empty means valid.
 */
export function validatePreview(list = modes) {
  const problems = [];
  for (const mode of list) {
    if (!isPreviewMode(mode.id)) continue;
    for (const action of fanFor(mode)) {
      if (action.kind === 'run' && !action.id.endsWith('.voice')) {
        problems.push(
          `${mode.id}: ${action.id} is kind:"run" but is not Voice — the preview is `
          + 'navigation-only plus Voice',
        );
      }
      if (action.kind === 'confirm') {
        problems.push(`${mode.id}: ${action.id} is kind:"confirm"; the preview writes nothing`);
      }
    }
  }
  return problems;
}


/**
 * The registry's own conscience.
 *
 * ⭐ With no TypeScript in this app, THIS IS THE ONLY ENFORCEMENT THAT EXISTS. It returns a list of
 * human-readable problems rather than throwing, so one call reports every fault at once instead of
 * making the next engineer fix them one exception at a time.
 *
 * @param {HubMode[]} list
 * @param {{iconNames?: string[]}} [opts] iconNames: UICON_NAMES, injected so this module never
 *   imports a React component (keeps the registry testable without a DOM).
 * @returns {string[]} problems; empty means valid.
 */
export function validateRegistry(list = modes, opts = {}) {
  const problems = [];
  const seenActionIds = new Set();
  const seenModeIds = new Set();
  const iconNames = opts.iconNames ? new Set(opts.iconNames) : null;

  for (const mode of list) {
    if (seenModeIds.has(mode.id)) problems.push(`duplicate mode id: ${mode.id}`);
    seenModeIds.add(mode.id);

    const outer = mode.fan.filter((a) => a.ring === 0);
    const inner = mode.fan.filter((a) => a.ring === 1);

    if (outer.length > OUTER_MAX) {
      problems.push(`${mode.id}: outer ring has ${outer.length}, max ${OUTER_MAX}`);
    }
    if (inner.length > INNER_MAX) {
      problems.push(`${mode.id}: inner ring has ${inner.length}, max ${INNER_MAX}`);
    }

    // Inner ring ends with Home — every mode but home, which is already there.
    if (mode.id !== HOME_MODE_ID) {
      const last = inner[inner.length - 1];
      if (!last || last.kind !== 'home') {
        problems.push(`${mode.id}: inner ring must end with a kind:'home' action`);
      }
    } else if (inner.some((a) => a.kind === 'home')) {
      problems.push(`${mode.id}: the home mode must NOT carry a Home action`);
    }

    // Voice on the inner ring of every mode (spec §2c).
    if (!inner.some((a) => a.id === `${mode.id}.voice`)) {
      problems.push(`${mode.id}: missing a Voice action on the inner ring`);
    }

    for (const action of mode.fan) {
      if (seenActionIds.has(action.id)) problems.push(`duplicate action id: ${action.id}`);
      seenActionIds.add(action.id);

      if (typeof action.label !== 'string' || action.label.length === 0) {
        problems.push(`${action.id}: missing label`);
      } else if (action.label.length > 10) {
        problems.push(`${action.id}: label "${action.label}" is ${action.label.length} chars, max 10`);
      }

      if (!action.icon) {
        problems.push(`${action.id}: missing icon — colour is never the only signal`);
      } else if (iconNames && !iconNames.has(action.icon)) {
        problems.push(`${action.id}: icon "${action.icon}" is not in the UIcon registry`);
      }

      if (action.ring !== 0 && action.ring !== 1) {
        problems.push(`${action.id}: ring must be 0 or 1`);
      }

      if (typeof action.color !== 'string' || !action.color.startsWith('--')) {
        problems.push(`${action.id}: color must be a CSS custom-property name, got "${action.color}"`);
      }

      if (action.kind === 'confirm' && typeof action.confirmText !== 'function') {
        problems.push(`${action.id}: kind:'confirm' requires a confirmText(ctx) function`);
      }
      if (action.kind === 'navigate' && !action.to) {
        problems.push(`${action.id}: kind:'navigate' requires a 'to'`);
      }

      // flickable:false is a safety marker; it only means anything on an action that confirms.
      if (action.flickable === false && action.kind !== 'confirm') {
        problems.push(`${action.id}: flickable:false is only meaningful on kind:'confirm'`);
      }

      for (const req of action.requires ?? []) {
        if (!HUB_REQUIREMENTS.includes(req)) {
          problems.push(`${action.id}: unknown requires value "${req}"`);
        }
      }

      if ('tier' in action) {
        problems.push(`${action.id}: 'tier' was removed — there are no tiers (deferred.md D-23)`);
      }
    }
  }

  return problems;
}
