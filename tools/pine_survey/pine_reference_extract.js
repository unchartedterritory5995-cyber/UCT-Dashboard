#!/usr/bin/env node
/*
 * pine_v6_reference_extract.js
 *
 * Extracts TradingView's Pine Script v6 Language Reference Manual as machine-readable JSON.
 *
 * WHY: https://www.tradingview.com/pine-script-reference/v6/ is a client-rendered SPA. A plain
 * fetch returns a ~129 KB shell with ZERO function text; the #fun_* anchors return the same shell;
 * no public JSON endpoint exists (…/v6/index.json, reference.json, /api/… all 404). The reference
 * content ships inside webpack chunks and is assembled at runtime. This script reproduces that
 * assembly offline.
 *
 * The chunk file names contain content hashes that ROTATE on every TradingView deploy, so this
 * script REDISCOVERS them from the live page on each run instead of hardcoding filenames.
 *
 * Usage:
 *   node pine_v6_reference_extract.js [--out FILE] [--cache DIR] [--lang en] [--version 6]
 *
 * Requires Node >= 18 (uses global fetch). Verified on Node v24.13.1.
 * Network only; writes only to --out and --cache.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ---------------------------------------------------------------- args
const argv = process.argv.slice(2);
const arg = (flag, dflt) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const OUT = arg('--out', path.join(__dirname, 'pine_v6_reference.json'));
const CACHE = arg('--cache', path.join(__dirname, '_chunkcache'));
const LANG = arg('--lang', 'en');
const VERSION = arg('--version', '6'); // 4 | 5 | 6 — the reference's PineLanguage switch
const PAGE = `https://www.tradingview.com/pine-script-reference/v${VERSION}/`;
const CDN = 'https://static.tradingview.com/static/bundles/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';

fs.mkdirSync(CACHE, { recursive: true });
const log = (...a) => console.error('[extract]', ...a);

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': LANG } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function cached(fileName, url) {
  const p = path.join(CACHE, fileName);
  if (fs.existsSync(p) && fs.statSync(p).size > 0) return fs.readFileSync(p, 'utf8');
  const body = await get(url);
  fs.writeFileSync(p, body, 'utf8');
  return body;
}

// ---------------------------------------------------------- STEP 1: page
(async () => {
  log('STEP 1  fetch SPA shell:', PAGE);
  const html = await get(PAGE);

  // Every eagerly loaded bundle is a <script src>. The lazily loaded reference DATA chunks are NOT
  // here — they are named only inside the runtime's chunk-id -> filename map (step 4).
  const srcs = [...html.matchAll(/src="(https:\/\/static\.tradingview\.com\/static\/bundles\/[^"]+\.js)"/g)]
    .map((m) => m[1]);
  const uniq = [...new Set(srcs)];
  log(`STEP 1  ${uniq.length} eager bundles referenced`);

  log('STEP 2  download eager bundles (cached)');
  const bundles = new Map(); // basename -> source
  for (const url of uniq) {
    const base = path.basename(url);
    bundles.set(base, await cached(base, url));
  }

  // ------------------------------------------- STEP 3: locate the reference loader
  // Loader chain in the app:
  //   pine_script_reference.<hash>.js
  //     -> new ReferenceRenderer()               (module 991810 as of 2026-09)
  //     -> renderer.loadReference(majorVersion)
  //        -> getReference(pineLanguage)         (module 799613)
  //        -> generateBuiltinsData(lang, ref)
  // getReference() is a switch over PineLanguage.V4/V5/V6 that dynamic-imports the data chunk.
  // Find whichever bundle DEFINES getReference rather than assuming a module id.
  let loaderSrc = null, loaderName = null;
  for (const [name, src] of bundles) {
    if (src.includes('getReference:()=>') || /getReference\s*:\s*\(\)\s*=>/.test(src)) {
      loaderSrc = src; loaderName = name; break;
    }
  }
  if (!loaderSrc) throw new Error('could not find the bundle defining getReference()');
  log('STEP 3  getReference() lives in', loaderName);

  // The V6 branch looks like (minified, identifiers vary):
  //   case r.PineLanguage.V6: t=(await Promise.all([o.e(41280),o.e(81395),o.e(21857),
  //        o.e(32258),o.e(42609)]).then(o.bind(o,742609))).default; break;
  const caseRe = new RegExp(
    'case\\s+[\\w$]+\\.PineLanguage\\.V' + VERSION + '\\s*:([\\s\\S]{0,600}?)break',
  );
  const caseM = loaderSrc.match(caseRe);
  if (!caseM) throw new Error(`could not find the PineLanguage.V${VERSION} case in ${loaderName}`);
  const branch = caseM[1];
  const chunkIds = [...branch.matchAll(/\.e\((\d+)\)/g)].map((m) => Number(m[1]));
  const dataModuleM = branch.match(/\.bind\(\s*[\w$]+\s*,\s*(\d+)\s*\)/);
  if (!dataModuleM) throw new Error('could not find the data module id in the V' + VERSION + ' branch');
  const dataModuleId = Number(dataModuleM[1]);
  log(`STEP 3  V${VERSION} needs chunks [${chunkIds.join(', ')}], data module ${dataModuleId}`);

  // ---------------------------- STEP 4: resolve chunk ids -> hashed filenames via the runtime
  // runtime.<hash>.js defines __webpack_require__.u:
  //   _.u = e => {
  //       if(85537===e) return "__LANG__."+e+".<hash>.js";      // localized chunks
  //       ...
  //       return (NAME_MAP[e]||e) + "." + HASH_MAP[e] + ".js";  // ordinary chunks
  //   }
  // "__LANG__" is substituted with the locale at load time (e.g. "en.32258.<hash>.js").
  const runtimeName = [...bundles.keys()].find((n) => n.startsWith('runtime.'));
  if (!runtimeName) throw new Error('runtime bundle not found among eager bundles');
  const runtime = bundles.get(runtimeName);
  log('STEP 4  runtime bundle:', runtimeName);

  const langHashes = new Map();
  // form A: if(N===e)return"__LANG__."+e+".HASH.js"
  for (const m of runtime.matchAll(/if\((\d+)===e\)return"__LANG__\."\+e\+"\.([0-9a-f]{16,32})\.js"/g)) {
    langHashes.set(Number(m[1]), m[2]);
  }
  // form B: if(N===e)return"__LANG__.N.HASH.js"
  for (const m of runtime.matchAll(/if\((\d+)===e\)return"__LANG__\.(\d+)\.([0-9a-f]{16,32})\.js"/g)) {
    langHashes.set(Number(m[1]), m[3]);
  }

  // The two maps are huge object literals (~5000 entries), so locate them by their trailing
  // syntax and walk back to the matching `{` rather than regexing the whole literal.
  const objectEndingWith = (marker) => {
    const end = runtime.indexOf(marker);
    const out = new Map();
    if (end < 0) return out;
    let depth = 0, start = -1;
    for (let i = end; i >= 0; i--) {
      const c = runtime[i];
      if (c === '}') depth++;
      else if (c === '{') { depth--; if (depth === 0) { start = i; break; } }
    }
    if (start < 0) return out;
    for (const e of runtime.slice(start, end).matchAll(/(\d+):"([^"]+)"/g)) out.set(Number(e[1]), e[2]);
    return out;
  };
  // ordinary chunks:  (NAME_MAP[e]||e) + "." + HASH_MAP[e] + ".js"
  const hashMap = objectEndingWith('}[e]+".js"');
  const nameMap = objectEndingWith('}[e]||e)');
  log(`STEP 4  parsed ${langHashes.size} localized + ${hashMap.size} hashed chunk names`);

  const fileFor = (id) => {
    if (langHashes.has(id)) return `${LANG}.${id}.${langHashes.get(id)}.js`;
    if (hashMap.has(id)) return `${nameMap.get(id) || id}.${hashMap.get(id)}.js`;
    throw new Error(`chunk ${id} not present in the runtime chunk map`);
  };

  const files = chunkIds.map(fileFor);
  log('STEP 5  data chunks resolved:');
  chunkIds.forEach((id, i) => log(`          ${id} -> ${files[i]}`));

  const sources = [];
  for (const f of files) sources.push([f, await cached(f, CDN + f)]);

  // ------------------------------------ STEP 6: run the chunks under a stubbed webpack runtime
  // Each chunk is `(self.webpackChunktradingview=self.webpackChunktradingview||[]).push([[id],{mods}])`.
  // We capture the module table, then hand-roll __webpack_require__ so the data module can execute:
  //   * module 982245 is the i18n helper; its .t(ctx, opts, strArray) picks strArray[0] and applies
  //     {placeholder} -> opts.replace substitutions. Every description in the reference goes through it.
  //   * the localized chunks define modules whose exports are ["the actual English string"].
  //   * .r/.d are the standard esModule/getter helpers; .e/.bind are stubbed (no further async).
  const modules = {};
  const sandbox = { console };
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.webpackChunktradingview = {
    push: (arg) => {
      const mods = arg[1] || {};
      for (const k of Object.keys(mods)) modules[k] = mods[k];
    },
  };
  const ctx = vm.createContext(sandbox);
  for (const [name, src] of sources) vm.runInContext(src, ctx, { filename: name });
  log(`STEP 6  ${Object.keys(modules).length} modules registered`);

  const applyReplace = (val, opts) => {
    let s = Array.isArray(val) ? val[0] : val;
    if (typeof s !== 'string') return s;
    if (opts && opts.replace) {
      for (const k of Object.keys(opts.replace)) s = s.split('{' + k + '}').join(String(opts.replace[k]));
    }
    return s;
  };
  const cache = {};
  const missing = new Set();
  function req(id) {
    if (id === 982245) return { t: (ctx_, opts, val) => applyReplace(val, opts), i18n: {} };
    if (cache[id] !== undefined) return cache[id];
    if (!modules[id]) { missing.add(id); cache[id] = [`<<MISSING_STRING_${id}>>`]; return cache[id]; }
    const m = { exports: {} };
    cache[id] = m.exports;
    modules[id](m, m.exports, req);
    cache[id] = m.exports;
    return m.exports;
  }
  req.r = () => {};
  req.d = (t, defs) => {
    for (const k of Object.keys(defs)) Object.defineProperty(t, k, { get: defs[k], enumerable: true, configurable: true });
  };
  req.e = () => Promise.resolve();
  req.bind = Function.prototype.bind.bind(req);

  const mod = { exports: {} };
  const exp = {};
  modules[dataModuleId](mod, exp, req);
  const ref = exp.default;
  if (!ref || !ref.functions) throw new Error('data module did not yield a reference object');

  // ------------------------------------------------------------- STEP 7: write + self-check
  const counts = Object.fromEntries(Object.keys(ref).map((k) => [k, Array.isArray(ref[k]) ? ref[k].length : null]));
  log('STEP 7  collections:', JSON.stringify(counts));
  if (missing.size) log('WARNING unresolved string module ids:', [...missing].join(','));
  const json = JSON.stringify(ref, null, 1);
  if (/<<MISSING_STRING_/.test(json)) log('WARNING output contains unresolved <<MISSING_STRING_*>> markers');
  fs.writeFileSync(OUT, json, 'utf8');
  log(`STEP 7  wrote ${OUT} (${json.length} bytes)`);
  // machine-readable summary on stdout
  process.stdout.write(JSON.stringify({
    out: OUT, bytes: json.length, counts,
    chunkFiles: files, dataModuleId, loaderBundle: loaderName, runtimeBundle: runtimeName,
    unresolvedStringModules: [...missing],
  }, null, 2) + '\n');
})().catch((e) => { console.error('[extract] FAILED:', e.message); process.exit(1); });
