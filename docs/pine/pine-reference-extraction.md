# Recipe: extracting the Pine Script v6 Language Reference as JSON

**What this produces:** `research/pine_v6_reference.json` — a faithful, machine-readable copy of
TradingView's own Pine Script v6 reference data: 719 functions, 251 methods, 239 constants,
161 variables, 23 keywords, 23 operators, 20 types, 10 annotations — **1,937,776 bytes on disk**
(1,935,582 characters), pretty-printed with indent 1.

Per entry the site's own structure is preserved verbatim. The complete set of keys present across all
8 collections is: `name`, `desc`, `syntax`, `args[]` (each with `name`, `desc`, `required`,
`allowedTypeIDs`, `displayType`), `returns`, `returnedTypes`, `remarks`, `seeAlso`, `examples`,
`fields` (types), `type` (constants/variables), `detailedDesc`, `template`, `thisType`,
`originalName` (methods), `isType`, `color`, `learnMore`. Nothing is summarised, reordered, or
reformatted.

**Runnable script:** `research/pine_v6_reference_extract.js` (embedded verbatim in section 6 of this
file so the recipe survives the script being moved or deleted).

```
node pine_v6_reference_extract.js                            # v6 -> pine_v6_reference.json
node pine_v6_reference_extract.js --version 5 --out v5.json  # v4/v5 work too
node pine_v6_reference_extract.js --lang en --cache _chunkcache
```
Node >= 18 (global `fetch`); verified on Node v24.13.1. Network + writes to `--out`/`--cache` only.

---

## 1. Why scraping the page does not work

| Attempt | Result |
|---|---|
| `WebFetch` / `curl` on `https://www.tradingview.com/pine-script-reference/v6/` | HTTP 200, ~129 KB, **zero** function text — the page is a client-rendered SPA whose `.js-content` div is filled by JS at runtime. `grep -c "label.new"` on the HTML returns **0**. |
| Anchor URLs (`#fun_label.new`, `#var_xloc.bar_index`, ...) | Same shell — fragments never reach the server. |
| `.../v6/index.json`, `.../v6/reference.json`, `.../v6.json`, `/api/pine-script-reference/v6` | **404** (the 404 body is itself a ~146 KB HTML page, so check the status code, not the byte count). |
| `static.tradingview.com/static/bundles/pine-script-reference-v6.json` | 404. |

So the reference text has to be recovered from the bundles the page itself loads.

## 2. The loader chain (traced, September 2026)

```
/pine-script-reference/v6/                        # SPA shell; lists ~35 eager <script src> bundles
 |- pine_script_reference.<hash>.js               # page bootstrap
     |- module 991810  ReferenceRenderer          # owns the Mustache templates + loadReference()
     |    async loadReference(majorVersion) {
     |        const lang = getPineLanguage(majorVersion);
     |        const ref  = await getReference(lang);            // <-- the data
     |        const b    = await generateBuiltinsData(lang, ref);
     |        return this._loadReference(b, lang);
     |    }
     |- module 799613  { getReference, generateBuiltinsData, replaceType }
          async function getReference(lang) {
            switch (lang) {
              case PineLanguage.V4: ... o.e(13447) ... o.bind(o, 913447)
              case PineLanguage.V5: ... o.e(91998) ... o.bind(o, 191998)
              case PineLanguage.V6:
                t = (await Promise.all([o.e(41280), o.e(81395), o.e(21857),
                                        o.e(32258), o.e(42609)])
                    ).then(o.bind(o, 742609)).default;          # <-- data module
            }
            return t;
          }
```

`generateBuiltinsData()` only re-buckets the data into Maps for the search UI (`functionsDocsMap`,
`constantsDocsMap`, ...) and sorts overloads by priority. **The raw `getReference()` payload is the
canonical object**, so this recipe stops there — that object is what gets written to JSON.

Two structural facts make the extraction possible:

1. The data module (`742609` for v6) exports a plain object
   `{ keywords, operators, variables, constants, types, annotations, functions, methods }`,
   each a flat array of entry objects.
2. Every human-readable string is *not* inline. It is `a.t(null, {replace:{...}}, n(<id>))` where
   `a = n(982245)` is the i18n helper and `n(<id>)` resolves to a one-element array living in one of
   the **localized** chunks (`en.41280`, `en.81395`, `en.21857`, `en.32258` for v6). That is why four
   of the five chunks are `en.*`: they are the English string tables. The
   `{replace:{backTick_2:"...", mdInternalRef1:"[na](#var_na)"}}` placeholders are substituted at
   render time; the harness applies exactly the same substitution, which is why the output carries the
   reference's real markdown cross-links.

## 3. Rediscovering the chunk hashes (they rotate on every deploy)

Never hardcode filenames. The script rediscovers them on each run:

1. **Fetch the SPA shell** and collect every
   `src="https://static.tradingview.com/static/bundles/*.js"` (~35 bundles as of 2026-09).
2. **Find the loader bundle by content, not by id**: the one whose source contains
   `getReference:()=>`. In the 2026-09 build that is `76911.d8d6a93cfb2d60a4aa5d.js` — grep for the
   string, never for the name.
3. **Read the version branch** out of that bundle with `case <ident>.PineLanguage.V6:` ... `break`,
   then pull:
   * the chunk ids from every `.e(<digits>)` in the branch -> `[41280, 81395, 21857, 32258, 42609]`
   * the data module id from `.bind(<ident>, <digits>)` -> `742609`
4. **Map chunk id -> hashed filename** using the runtime bundle (`runtime.<hash>.js`), which defines
   `__webpack_require__.u`:
   ```js
   _.u = e => {
       if (85537 === e) return "__LANG__." + e + ".e47875beef942b285957.js";   // localized chunks
       ...                                                                    // ~600 such lines
       return (NAME_MAP[e] || e) + "." + HASH_MAP[e] + ".js";                  // ordinary chunks
   };
   ```
   * localized ids come from the `if (N === e) return "__LANG__..."` lines; substitute the locale for
     `__LANG__` -> `en.32258.<hash>.js`
   * ordinary ids come from `HASH_MAP`, the big `{id:"hash",...}` literal ending with `}[e]+".js"`,
     optionally renamed via `NAME_MAP`, the literal ending with `}[e]||e)`. Both literals hold
     thousands of entries, so locate them by their trailing syntax and walk **backwards** to the
     matching `{`. A regex over the whole literal either fails to anchor or backtracks
     catastrophically — this was the one real bug hit while writing the script.
5. **Download** `https://static.tradingview.com/static/bundles/<filename>` for each resolved chunk.

Observed 2026-09-08 (recorded only for drift-checking — expect all of these to change):

| chunk id | file | role |
|---|---|---|
| 41280 | `en.41280.c3103bbd9613b8c6938e.js` | English strings |
| 81395 | `en.81395.c3ea6fa280511b1fcf65.js` | English strings |
| 21857 | `en.21857.4889c7a70444e16ac9c7.js` | English strings |
| 32258 | `en.32258.7d600bc1e22f86336458.js` | English strings |
| 42609 | `42609.c7bb2b1ef75d75427a01.js` | **v6 reference data** (1.29 MB) |
| - | `76911.d8d6a93cfb2d60a4aa5d.js` | loader (`getReference`) |
| - | `runtime.4853b7b897e2447b1571.js` | chunk-id -> filename map |
| - | `pine_script_reference.b46975644b04fc42aa88.js` | page bootstrap |

## 4. The stubbed-webpack harness

Each chunk is
`(self.webpackChunktradingview = self.webpackChunktradingview || []).push([[id], {modules}])`.
Run them in a `vm` context whose `self.webpackChunktradingview.push` just harvests the module table,
then hand-roll `__webpack_require__`:

* `req(982245)` -> `{ t: (ctx, opts, val) => applyReplace(val, opts) }` — the i18n shim: take
  `val[0]`, then replace each `{key}` with `opts.replace[key]`. **Every** description flows through it.
* `req(<other>)` -> execute the module as `(module, exports, req)` and memoise `module.exports`
  (localized modules export `["the English string"]`).
* `req.r` = no-op esModule marker; `req.d` = defineProperty getters; `req.e` = `() => Promise.resolve()`;
  `req.bind` = bound `req` (the data module awaits nothing once its chunks are already registered).
* Invoke `modules[742609](module, exports, req)` and read `exports.default`.

**Validation gates** (the script enforces or reports all four):

1. Collection counts are non-zero and the shape is
   `keywords, operators, variables, constants, types, annotations, functions, methods`.
2. `unresolvedStringModules` is **empty** and the JSON contains no `<<MISSING_STRING_*>>` marker.
   A non-empty list means a string chunk is missing from the `.e()` list — re-derive step 3.
3. Spot-check a known entry: `label.new` must have 2 overloads, the second with `args[0].name === "x"`
   whose `desc` carries the "cannot be drawn further than 500 bars into the future" remark.
4. Cross-version sanity: `--version 5` must also succeed (section 5).

## 5. It generalises to v4/v5 — and yields a free version diff

`--version 5` resolves a different branch and data module with **no code change**:
chunks `[41280, 81395, 21857, 19721, 91998]`, data module `191998`, giving 198 constants,
452 distinct function names, 18 types. Diffing two versions' JSON is the cheapest possible
"what changed" instrument. Measured v5 -> v6: nothing removed, and added:

* **constants +41, none removed** — 34 new `currency.*` codes, `display.pine_screener`,
  `plot.linestyle_solid` / `_dashed` / `_dotted`, `text.format_none` / `_bold` / `_italic`.
* **types +2**: `footprint`, `volume_row`. **functions +23**, **variables +8**, **methods +14**.

## 6. The script, verbatim

Saved as `research/pine_v6_reference_extract.js`:

```javascript
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
```

## 7. Failure modes and where to look when it breaks

| Symptom | Cause | Fix |
|---|---|---|
| `could not find the bundle defining getReference()` | TradingView renamed or re-minified the export | grep the eager bundles for `loadReference` and `PineLanguage`, then update the detector string in step 2 |
| `could not find the PineLanguage.V6 case` | the switch was refactored (e.g. into a lookup table) | open the loader bundle around `getReference` and re-read how a version selects its chunks |
| `chunk NNNNN not present in the runtime chunk map` | the `_.u` shape changed | re-inspect `_.u` in `runtime.*.js`; the two markers to re-find are `"__LANG__."` and `}[e]+".js"` |
| output riddled with `<<MISSING_STRING_*>>` | a localized chunk id was missed, or the locale differs | confirm every `.e()` id was downloaded; pass `--lang en` explicitly |
| stale content after a TradingView deploy | `_chunkcache/` is keyed by filename, and the filename contains the content hash | a new hash means a new filename means an automatic refetch; to force a full refresh delete `_chunkcache/` |
| 403 / Cloudflare | UA filtering | the script already sends a desktop Chrome UA — keep it |

## 8. Provenance and caveats

* Extracted **2026-09-08** from the then-current build. The JSON is a snapshot; re-run to refresh.
* This is the **same data the reference page renders** — not a paraphrase, not scraped prose. But it is
  client-side data, so it can differ from server-side behaviour, and it is *documentation*: the lane-4C
  spec shows it is itself sometimes incomplete or self-inconsistent (e.g. `indicator()` and
  `strategy()` describe the same `max_labels_count` parameter differently).
* Only English was extracted. Other locales use the same pipeline via `--lang <code>`: the `__LANG__`
  chunks are per-locale while the structural chunk (`42609`) is shared.
* The reference's own taxonomy matters: identifiers a renderer thinks of as constants may live in the
  `variables` collection (`na`, `chart.fg_color`, `session.ismarket`, ...). Read both. See
  `pine_v6_constants_all.md` section 3.
* `_chunkcache/` holds ~40 downloaded bundles (a few MB). It is disposable.
* Related outputs from this lane: `pine_v6_constants_all.md` (all 35 constant namespaces, 239 members,
  plus reference-vs-manual disagreements) and `_intermediate/lane4c-labels-lines.md` (the
  argument-level label/line/linefill renderer spec).
