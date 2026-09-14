// @vitest-environment node
// ⛔ NODE, NOT JSDOM. This rail parses a file and walks a directory; it touches no DOM.
// Under the default jsdom environment the run spent 30s building an environment it never
// used and the directory walk timed out at 15s - a green rail lost to its own harness.
/**
 * S1 CP1 rail — the manifest is DERIVED from App.jsx, and CP1 is INERT.
 *
 * Two jobs, and they fail for different reasons:
 *   1. PARITY — every Layout-hosted route has a declaration and every declaration names a
 *      route. A hand-typed roster beside the source that owns it is the defect this repo
 *      has paid for in the writer index, the COT router and the setup catalog.
 *   2. INERTNESS — CP1 declares and does not mount. If anything outside this directory
 *      starts importing the manifest, CP1 has silently become CP2 and the gate line no
 *      longer describes what shipped.
 *
 * ⛔ AN AST, NEVER A REGEX. A regex over JSX finds the string in a comment, in a prop name,
 * and in the prose above the call site — this repo has three recorded instances of exactly
 * that. `lesson_probe_names_must_be_derived_not_typed`.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as acorn from 'acorn';
import jsx from 'acorn-jsx';
import { MANIFEST, MEASURED_ORDER, SURFACE_KINDS } from './manifest.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '..');
const APP_JSX = path.join(SRC, 'App.jsx');

const Parser = acorn.Parser.extend(jsx());
const nameOf = (n) => (n && n.type === 'JSXIdentifier' ? n.name : null);
const attr = (el, k) =>
  (el.openingElement?.attributes || []).find((a) => a.type === 'JSXAttribute' && a.name?.name === k);

function deriveLayoutRoutes() {
  const ast = Parser.parse(fs.readFileSync(APP_JSX, 'utf8'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  let layout = null;
  (function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'JSXElement' && nameOf(n.openingElement?.name) === 'Route') {
      const v = attr(n, 'element')?.value;
      if (
        v?.type === 'JSXExpressionContainer' &&
        v.expression?.type === 'JSXElement' &&
        nameOf(v.expression.openingElement?.name) === 'Layout'
      ) layout = n;
    }
    for (const k of Object.keys(n)) {
      const c = n[k];
      if (Array.isArray(c)) c.forEach(walk);
      else if (c && typeof c === 'object') walk(c);
    }
  })(ast);
  if (!layout) throw new Error('no <Route element={<Layout/>}> found — the derivation is broken, not the manifest');

  const out = [];
  (function collect(n) {
    if (!n || typeof n !== 'object') return;
    if (n !== layout && n.type === 'JSXElement' && nameOf(n.openingElement?.name) === 'Route') {
      const p = attr(n, 'path');
      const idx = attr(n, 'index');
      let route = null;
      if (idx) route = '(index)';
      else if (p?.value?.type === 'Literal') route = p.value.value;
      else if (p?.value?.type === 'JSXExpressionContainer' && p.value.expression.type === 'Identifier')
        route = p.value.expression.name;
      if (route !== null) out.push(route);
    }
    for (const k of Object.keys(n)) {
      const c = n[k];
      if (Array.isArray(c)) c.forEach(collect);
      else if (c && typeof c === 'object') collect(c);
    }
  })(layout);
  return out;
}

function stripComments(src) {
  // ⛔ CODE, NEVER PROSE — a comment mentioning the path must not count as an import.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function walkFiles(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walkFiles(full, acc);
    } else if (/\.(jsx?|tsx?|mjs)$/.test(e.name)) acc.push(full);
  }
  return acc;
}

describe('S1 CP1 — the surface manifest is derived, not typed', () => {
  const derived = deriveLayoutRoutes();

  it('the derivation actually found the route table (non-vacuity)', () => {
    // ⛔ Without this every parity assertion below passes over an empty set.
    expect(derived.length).toBeGreaterThan(40);
    expect(derived).toContain('/dashboard');
    expect(derived).toContain('/charts');
  });

  it('every Layout-hosted route has a declaration', () => {
    const declared = new Set(MANIFEST.map((m) => m.path));
    const missing = derived.filter((r) => !declared.has(r));
    expect(missing, `routes with no manifest row: ${missing.join(', ')}`).toEqual([]);
  });

  it('every declaration names a real route', () => {
    const real = new Set(derived);
    const orphans = MANIFEST.map((m) => m.path).filter((p) => !real.has(p));
    expect(orphans, `manifest rows naming no route: ${orphans.join(', ')}`).toEqual([]);
  });

  it('declares a known kind for every row, and no duplicate paths', () => {
    for (const m of MANIFEST) expect(SURFACE_KINDS, m.path).toContain(m.kind);
    const paths = MANIFEST.map((m) => m.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('S1 CP1 — order is measured, and silence is not last place', () => {
  it('the measured ranks are a dense 1..N with no gaps or duplicates', () => {
    const ranks = MANIFEST.filter((m) => m.order !== null).map((m) => m.order).sort((a, b) => a - b);
    expect(ranks).toEqual(ranks.map((_, i) => i + 1));
  });

  it('only surfaces carry a rank — a redirect or a detail view is not ranked', () => {
    for (const m of MANIFEST) if (m.kind !== 'surface') expect(m.order, m.path).toBeNull();
  });

  it('/dashboard is first, because the session-opener count says so', () => {
    // OI-06: 22 of 50 admin session-days, twice the next. NOT total views, which the
    // notebook leads - the two orderings disagree and this is the one that was chosen.
    expect(MEASURED_ORDER[0]).toBe('/dashboard');
  });

  it('surfaces telemetry is silent on carry null, never an invented rank', () => {
    const unranked = MANIFEST.filter((m) => m.kind === 'surface' && m.order === null);
    expect(unranked.length).toBeGreaterThan(0);
  });
});

describe('S1 CP1 — INERT: nothing mounts the manifest yet', () => {
  it('no file outside src/surfaces imports it', () => {
    const offenders = walkFiles(SRC)
      .filter((f) => !f.startsWith(path.join(SRC, 'surfaces')))
      .filter((f) => /from\s+['"][^'"]*surfaces\/manifest(\.js)?['"]/.test(stripComments(fs.readFileSync(f, 'utf8'))));
    expect(
      offenders.map((f) => path.relative(SRC, f)),
      'CP1 declares and does not mount — an importer means CP1 quietly became CP2',
    ).toEqual([]);
  });

  it('the comment-stripper can still see a real import (control)', () => {
    const real = "import { MANIFEST } from './surfaces/manifest.js';";
    expect(/from\s+['"][^'"]*surfaces\/manifest(\.js)?['"]/.test(stripComments(real))).toBe(true);
    const commented = "// import { MANIFEST } from './surfaces/manifest.js';";
    expect(/from\s+['"][^'"]*surfaces\/manifest(\.js)?['"]/.test(stripComments(commented))).toBe(false);
  });
});
