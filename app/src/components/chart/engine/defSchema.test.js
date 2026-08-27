import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  validateDefinition, validateSourceReferents, SCHEMA_VERSION, TIERS,
  SUBSTITUTABLE_PLOT_FIELDS, EVENT_COLUMN_DOMAIN, isEventColumnValue,
  SUPPORTED_KINDS, COMPUTE_KINDS, PLOT_STYLES, RESERVED_PLOT_STYLES,
} from './defSchema'
// ⭐ THE ONE PARSER, IMPORTED BY THE TEST FOR THE SAME REASON THE SCHEMA IMPORTS
// IT: an `ast` fixture built any other way is a second grammar (D-A1).
import { parseFormula, astHash } from './ast/parse'
// ⭐ AND THE ONE MULTI-TREE HASH, for the same reason: a fixture that typed its
// own `treesHash` would be comparing its copy of the definition to itself.
import { treesHash, assertTrees } from './ast/trees'

const rsiDef = () => ({
  schemaVersion: 1, id: 'rsi', version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'RSI', shortName: 'RSI', category: 'Momentum', tier: 'free', repaint: 'non-repainting' },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [{ key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
           { key: 'color', type: 'color', label: 'Colour', default: 'token:info' }],
  plots: [{ key: 'rsi', label: 'RSI', style: 'line', color: '$color', width: 1 },
          { key: 'levels', style: 'hlines', levels: [70, 50, 30] }],
  events: [],
})

describe('definition schema', () => {
  it('accepts a well-formed definition', () => {
    const r = validateDefinition(rsiDef())
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })

  it('FAILS CLOSED on an unknown input type — never coerces', () => {
    const d = rsiDef(); d.inputs[0].type = 'quantum'
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/quantum/)
  })

  it('FAILS CLOSED on an unknown plot style', () => {
    const d = rsiDef(); d.plots[0].style = 'hologram'
    expect(validateDefinition(d).ok).toBe(false)
  })

  it('rejects an unresolvable $ref rather than defaulting it', () => {
    const d = rsiDef(); d.plots[0].color = '$nope'
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/\$nope/)
  })

  it('resolves $refs to their input defaults on the returned def', () => {
    const r = validateDefinition(rsiDef())
    expect(r.def.plots[0].color).toBe('token:info')   // from inputs[].default
  })

  it('REMEMBERS which input each substituted field came from', () => {
    // A definition has no user behind it, so resolving to the default is right
    // for one. An INSTANCE is nothing but the user — `{inputs: {color: '#abc'}}`
    // is the field's whole purpose — and once the reference is gone the binder
    // cannot tell an edited colour from a literal the author wrote. It would
    // render every migrated indicator in its default colour, silently.
    const d = rsiDef()
    d.inputs.push({ key: 'thickness', type: 'int', label: 'Width', default: 2, min: 1, max: 4 })
    d.plots[0].width = '$thickness'
    const r = validateDefinition(d)

    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.def.plots[0].$refs).toEqual({ color: 'color', width: 'thickness' })
  })

  it('records nothing for a field the author wrote as a LITERAL', () => {
    const r = validateDefinition(rsiDef())
    expect(r.def.plots[1].$refs, 'the hlines guide is all literals').toBeUndefined()
    expect(r.def.plots[0].$refs.width, 'width: 1 is a literal').toBeUndefined()
  })

  it('records per-ELEMENT level refs positionally', () => {
    const d = rsiDef()
    d.inputs.push({ key: 'high', type: 'int', label: 'High', default: 70, min: 1, max: 99 })
    d.plots[1].levels = ['$high', 50, 30]
    const r = validateDefinition(d)

    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.def.plots[1].levels).toEqual([70, 50, 30])
    expect(r.def.plots[1].$refs).toEqual({ levels: ['high', null, null] })
  })

  it('preserves unknown META fields (document-shaped, forward-compatible)', () => {
    const d = rsiDef(); d.meta.futureThing = 42
    const r = validateDefinition(d)
    expect(r.ok).toBe(true)
    expect(r.def.meta.futureThing).toBe(42)
  })

  it('requires a matching schemaVersion', () => {
    const d = rsiDef(); d.schemaVersion = 99
    expect(validateDefinition(d).ok).toBe(false)
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('rejects duplicate plot keys — they are the public handles', () => {
    const d = rsiDef(); d.plots[1].key = 'rsi'
    expect(validateDefinition(d).ok).toBe(false)
  })
})

// ─── Extensions beyond the brief ─────────────────────────────────────────────
// Each block below covers a rule §3.1 states that the brief's eight cases leave
// unpinned. The reason for each is stated where it isn't self-evident, because
// a test whose motivation is invisible is a test the next person deletes.

const ok = (d) => {
  const r = validateDefinition(d)
  expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  return r.def
}
const errs = (d) => {
  const r = validateDefinition(d)
  expect(r.ok).toBe(false)
  return r.errors
}

describe('purity — the caller\'s object is never touched', () => {
  it('does not mutate the argument while substituting $refs', () => {
    const d = rsiDef()
    const before = JSON.stringify(d)
    const def = ok(d)
    expect(JSON.stringify(d)).toBe(before)     // caller's copy still says '$color'
    expect(d.plots[0].color).toBe('$color')
    expect(def.plots[0].color).toBe('token:info')
    expect(def).not.toBe(d)
    expect(def.plots[0]).not.toBe(d.plots[0])
  })

  it('never throws — garbage in, errors out', () => {
    // This runs on the registration path. One malformed catalog entry must not
    // take the chart down with it, so every shape returns {ok:false}.
    for (const junk of [null, undefined, 'rsi', 42, [], () => {}, NaN, true]) {
      const r = validateDefinition(junk)
      expect(r.ok, `threw or accepted for ${String(junk)}`).toBe(false)
      expect(Array.isArray(r.errors)).toBe(true)
      expect(r.errors.length).toBeGreaterThan(0)
    }
  })

  it('never throws on a definition carrying a function (a stray registry showIf)', () => {
    // structuredClone would throw here. deepClone must not.
    const d = rsiDef(); d.inputs[0].showIf = (v) => v.period > 0
    expect(() => validateDefinition(d)).not.toThrow()
    expect(validateDefinition(d).ok).toBe(true)
  })
})

describe('error strings are an interface, not decoration', () => {
  it('names the offending field path AND the offending value', () => {
    // A future AI generating definitions reads these to repair its own output.
    const d = rsiDef(); d.inputs[0].type = 'quantum'
    const joined = errs(d).join('\n')
    expect(joined).toMatch(/inputs\[0\]\.type/)
    expect(joined).toMatch(/quantum/)
  })

  it('is exhaustive — every problem is reported in one pass', () => {
    const d = rsiDef()
    d.inputs[0].type = 'quantum'
    d.plots[0].style = 'hologram'
    d.placement.target = 'moon'
    const e = errs(d)
    expect(e.join('\n')).toMatch(/quantum/)
    expect(e.join('\n')).toMatch(/hologram/)
    expect(e.join('\n')).toMatch(/moon/)
    expect(e.length).toBeGreaterThanOrEqual(3)
  })
})

describe('fail-closed behavioural vocabularies', () => {
  it('rejects an unknown compute.kind — the execution LANE is behavioural', () => {
    // Coercing an unrecognised lane to `native` runs a different implementation
    // than the author declared. Same class as an unknown input type.
    const d = rsiDef(); d.compute.kind = 'wasm'
    expect(errs(d).join(' ')).toMatch(/compute\.kind[\s\S]*wasm|wasm[\s\S]*compute\.kind/)
  })

  it('rejects an unknown placement.target', () => {
    const d = rsiDef(); d.placement.target = 'moon'
    expect(errs(d).join(' ')).toMatch(/moon/)
  })

  it('rejects an unknown meta.repaint — it is a truth claim about the maths', () => {
    const d = rsiDef(); d.meta.repaint = 'probably-fine'
    expect(errs(d).join(' ')).toMatch(/probably-fine/)
  })

  it('rejects unknown lineStyle / role on a plot', () => {
    expect(errs({ ...rsiDef(), plots: [{ key: 'a', style: 'line', lineStyle: 'dashy' }] }).join(' '))
      .toMatch(/dashy/)
    expect(errs({ ...rsiDef(), plots: [{ key: 'a', style: 'line', role: 'headline' }] }).join(' '))
      .toMatch(/headline/)
  })

  it('distinguishes SCHEMA-RESERVED from unknown, for plot styles and input types', () => {
    // "not yet" and "you typo'd" are different repairs. The message has to say which.
    const reservedStyle = errs({ ...rsiDef(), plots: [{ key: 'z', style: 'zones' }] }).join(' ')
    expect(reservedStyle).toMatch(/zones/)
    expect(reservedStyle).toMatch(/reserved/i)

    const d = rsiDef(); d.inputs[0].type = 'timeframe'
    const reservedType = errs(d).join(' ')
    expect(reservedType).toMatch(/timeframe/)
    expect(reservedType).toMatch(/reserved/i)

    // …and an outright unknown does NOT claim to be reserved.
    const d2 = rsiDef(); d2.inputs[0].type = 'quantum'
    expect(errs(d2).find((e) => e.includes('quantum'))).not.toMatch(/reserved/i)
  })
})

describe('$<inputKey> substitution grammar', () => {
  it('rejects a $ref that resolves to the WRONG TYPE for its field', () => {
    // '$period' resolves to 14 — a number where a colour string belongs. Letting
    // it through would hand LWC a number as a CSS colour and paint nothing.
    const d = rsiDef(); d.plots[0].color = '$period'
    expect(errs(d).join(' ')).toMatch(/color/)
  })

  it('rejects a malformed $ref rather than treating it as a literal', () => {
    // '$' as a literal CSS colour is a silent default wearing a disguise.
    for (const bad of ['$', '$1x', '$has-hyphen']) {
      const d = rsiDef(); d.plots[0].color = bad
      expect(errs(d).join(' '), bad).toMatch(/\$ref|substitution/)
    }
  })

  it('rejects a $ref to an input that declares no default', () => {
    const d = rsiDef(); delete d.inputs[1].default
    const e = errs(d).join(' ')
    expect(e).toMatch(/default/)
  })

  it('substitutes width from an input default', () => {
    const d = rsiDef()
    d.inputs.push({ key: 'lw', type: 'int', default: 2, min: 1, max: 4 })
    d.plots[0].width = '$lw'
    expect(ok(d).plots[0].width).toBe(2)
  })

  it('substitutes levels PER ELEMENT — the reachable form (RSI 70/30 from inputs)', () => {
    const d = rsiDef()
    d.inputs.push({ key: 'obLevel', type: 'int', default: 70, min: 50, max: 95 })
    d.inputs.push({ key: 'osLevel', type: 'int', default: 30, min: 5, max: 50 })
    d.plots[1].levels = ['$obLevel', 50, '$osLevel']
    expect(ok(d).plots[1].levels).toEqual([70, 50, 30])
  })

  it('whole-array "$bands" has NO v1 input type that can feed it — and says so precisely', () => {
    // Pinning a real constraint rather than a wish: every v1 input type resolves
    // to a scalar (int/float → number, bool → boolean, enum → a scalar option,
    // string/color/source → string), so `levels: "$bands"` cannot produce an
    // array until a list-shaped input type ships. The validator must therefore
    // reject it with the reason, not with a shrug.
    const d = rsiDef()
    d.inputs.push({ key: 'bands', type: 'int', default: 80, min: 1, max: 100 })
    d.plots[1].levels = '$bands'
    const e = errs(d).join(' ')
    expect(e).toMatch(/levels/)
    expect(e).toMatch(/array/)
    expect(e).toMatch(/\$bands/)
  })

  it('rejects an enum whose option values are not scalars', () => {
    // Membership is identity-based, so an array option could never match its own
    // default — it would fail with a baffling "[80, 20] is not one of: [80, 20]".
    const d = rsiDef()
    d.inputs.push({ key: 'bands', type: 'enum', default: [80, 20], options: [[[80, 20], 'wide']] })
    expect(errs(d).join(' ')).toMatch(/scalar/)
  })

  it('reports an unresolvable $ref inside levels, naming the element index', () => {
    const d = rsiDef(); d.plots[1].levels = [70, '$nope', 30]
    expect(errs(d).join(' ')).toMatch(/levels\[1\][\s\S]*\$nope|\$nope/)
  })

  it('leaves token: colours BYTE-UNCHANGED — resolution is the binder\'s job', () => {
    // designTokens.resolveToken needs a chart PRESET, which is a render-time
    // fact. The same definition renders on four presets, so a validator that
    // resolved colours would bake one preset into the stored definition.
    const d = rsiDef(); d.plots[0].color = 'token:bull@band'
    expect(ok(d).plots[0].color).toBe('token:bull@band')
  })
})

describe('keys — the public namespace', () => {
  it('rejects duplicate INPUT keys ("$x" would be ambiguous)', () => {
    const d = rsiDef(); d.inputs[1].key = 'period'
    expect(errs(d).join(' ')).toMatch(/period/)
  })

  it('rejects a plot key that collides with an event key', () => {
    // compute returns ONE column per plot/event key (spec §4) — a collision is
    // two producers fighting over one Float64Array.
    const d = rsiDef(); d.events = [{ key: 'rsi', label: 'Crossed 70' }]
    expect(errs(d).join(' ')).toMatch(/rsi/)
  })

  it('rejects a definition id containing a dot (defId.plotKey addressing)', () => {
    const d = rsiDef(); d.id = 'uct.rsi'
    expect(errs(d).join(' ')).toMatch(/uct\.rsi/)
  })

  it('rejects a non-identifier plot key', () => {
    const d = rsiDef(); d.plots[0].key = 'rsi line'
    expect(errs(d).join(' ')).toMatch(/rsi line/)
  })
})

describe('colorMode — compute never returns colour strings', () => {
  it('accepts "fixed", and "sign" WHEN it names both of its colours', () => {
    ok((() => { const d = rsiDef(); d.plots[0].colorMode = 'fixed'; return d })())
    const d = rsiDef()
    Object.assign(d.plots[0], { colorMode: 'sign', colorUp: '#4caf50', colorDown: '#f44336' })
    ok(d)
  })

  it('REJECTS "sign" with no colours — the mode is unrenderable without them', () => {
    // Same rule, and the same reason, as `band` requiring `edges`. MACD's
    // histogram declared `colorMode: 'sign'` and nothing else; the binder had no
    // per-point colour to emit, so the engine drew the whole pane in ONE flat LWC
    // default where the legacy block draws green above zero and red below. A mode
    // that cannot be half-declared cannot fail that way again.
    for (const partial of [{}, { colorUp: '#4caf50' }, { colorDown: '#f44336' }]) {
      const d = rsiDef()
      Object.assign(d.plots[0], { colorMode: 'sign' }, partial)
      const e = errs(d).join(' ')
      expect(e, JSON.stringify(partial)).toMatch(/colorUp|colorDown/)
    }
  })

  it('rejects a non-string colorUp / colorDown', () => {
    for (const field of ['colorUp', 'colorDown']) {
      const d = rsiDef()
      Object.assign(d.plots[0], { colorMode: 'sign', colorUp: '#4caf50', colorDown: '#f44336' })
      d.plots[0][field] = 3
      expect(errs(d).join(' ')).toMatch(new RegExp(`${field}.*expected a non-empty colour`))
    }
  })

  it('accepts column:<key> naming a declared plot or event column', () => {
    const d = rsiDef()
    d.events = [{ key: 'overbought', label: 'Crossed above 70' }]
    d.plots[0].colorMode = 'column:overbought'
    ok(d)
  })

  it('rejects column:<key> naming a column nothing declares', () => {
    const d = rsiDef(); d.plots[0].colorMode = 'column:ghost'
    expect(errs(d).join(' ')).toMatch(/ghost/)
  })
})

describe('input defaults are type-checked against the declared type', () => {
  it('rejects a stringly-typed int default — never coerce it to a number', () => {
    // A coerced default is precisely the failure the fail-closed rule exists for:
    // the string reaches the compute lane and does string maths there.
    const d = rsiDef(); d.inputs[0].default = '14'
    expect(errs(d).join(' ')).toMatch(/"14"/)
  })

  it('rejects a default outside its own declared min/max', () => {
    const d = rsiDef(); d.inputs[0].default = 500      // max is 200
    expect(errs(d).join(' ')).toMatch(/500/)
  })

  it('requires every input to declare a default', () => {
    const d = rsiDef(); delete d.inputs[0].default
    expect(errs(d).join(' ')).toMatch(/inputs\[0\]\.default/)
  })

  it('accepts enum options in the [value, label] shape indicatorRegistry already uses', () => {
    // The v1 inputs[] vocabulary is a strict SUPERSET of the registry's field
    // vocabulary so B4 can drive ONE renderer from definitions.
    const d = rsiDef()
    d.inputs.push({ key: 'maType', type: 'enum', label: 'Average type', default: 'EMA', options: [['SMA', 'Simple'], ['EMA', 'Exponential']] })
    ok(d)
  })

  it('accepts enum options as bare scalars too', () => {
    const d = rsiDef()
    d.inputs.push({ key: 'maType', type: 'enum', default: 'EMA', options: ['SMA', 'EMA'] })
    ok(d)
  })

  it('rejects an enum default that is not among its options', () => {
    const d = rsiDef()
    d.inputs.push({ key: 'maType', type: 'enum', default: 'WMA', options: [['SMA', 'Simple'], ['EMA', 'Exponential']] })
    expect(errs(d).join(' ')).toMatch(/WMA/)
  })

  it('carries the registry modifiers through: min/max/step/group/tooltip/disabled', () => {
    const d = rsiDef()
    d.inputs[0] = {
      key: 'period', type: 'int', label: 'Length', default: 14,
      min: 2, max: 200, step: 1, group: 'Core', tooltip: 'Lookback', disabled: 'Coming soon',
    }
    const def = ok(d)
    expect(def.inputs[0].group).toBe('Core')
    expect(def.inputs[0].disabled).toBe('Coming soon')
  })

  it('rejects an activeWhen keyed on an input that does not exist', () => {
    // A condition on a phantom input evaluates to "never show" — the control
    // disappears forever and nobody learns why. Same class as a dangling $ref.
    const d = rsiDef()
    d.inputs[1].activeWhen = { key: 'ghost', gt: 0 }
    expect(errs(d).join(' ')).toMatch(/ghost/)
  })

  it('accepts an activeWhen keyed on a real input (the JSON successor to showIf)', () => {
    const d = rsiDef()
    d.inputs[1].activeWhen = { key: 'period', gt: 0 }
    ok(d)
  })
})

describe('plots that would render nothing', () => {
  it('rejects an hlines plot with no levels', () => {
    const d = rsiDef(); delete d.plots[1].levels
    expect(errs(d).join(' ')).toMatch(/hlines/)
  })

  it('rejects a definition that declares neither plots nor events', () => {
    const d = rsiDef(); d.plots = []; d.events = []
    expect(errs(d).join(' ')).toMatch(/at least one plot or one event/)
  })
})

describe('events are columns — the half this validator can check, and the half it cannot', () => {
  it('EVENT_COLUMN_DOMAIN is exactly {0, 1, NaN} and is frozen', () => {
    expect(Object.isFrozen(EVENT_COLUMN_DOMAIN)).toBe(true)
    expect(EVENT_COLUMN_DOMAIN.length).toBe(3)
    expect([EVENT_COLUMN_DOMAIN[0], EVENT_COLUMN_DOMAIN[1]]).toEqual([0, 1])
    expect(Number.isNaN(EVENT_COLUMN_DOMAIN[2])).toBe(true)
  })

  it('isEventColumnValue is a DOMAIN, not a null test and not "any number"', () => {
    expect([0, 1, NaN].every(isEventColumnValue)).toBe(true)
    // 0.5 is not a "maybe": every consumer of an event column reads this one
    // shape, so a float wearing an event's name would be read as a signal.
    for (const bad of [0.5, 2, -1, Infinity, null, undefined, '1', true]) {
      expect(isEventColumnValue(bad), String(bad)).toBe(false)
    }
  })

  it('⛔ validateDefinition still does NOT check that a column comes back — on purpose', () => {
    // This is a claim about a BOUNDARY, and it is easy to read as a gap. This
    // validator is a pure function of ONE definition that never runs a compute
    // lane — it has to accept a `server`- or `ast`-kind definition this client
    // cannot execute at all — so "does that key name a returned column, valued
    // {0,1,NaN}?" is unanswerable here. It is answered at REGISTRATION, by
    // `nativeRegistry.registerDefinitions`, which runs the compute over a probe
    // series; `engine/__tests__/eventColumns.test.js` asserts BOTH refusals.
    //
    // Asserting the acceptance here is what stops someone "fixing" the gap in
    // the wrong file and quietly making every non-native definition unregistrable.
    const d = rsiDef()
    d.events = [{ key: 'neverComputed', label: 'names nothing at all' }]
    const r = validateDefinition(d)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })
})

describe('forward compatibility — the document half round-trips', () => {
  it('preserves unknown keys at every level, not just meta', () => {
    const d = rsiDef()
    d.futureTopLevel = { a: 1 }
    d.inputs[0].futureInputField = 'keep me'
    d.plots[0].futurePlotField = [1, 2, 3]
    d.compute.futureComputeField = true
    const def = ok(d)
    expect(def.futureTopLevel).toEqual({ a: 1 })
    expect(def.inputs[0].futureInputField).toBe('keep me')
    expect(def.plots[0].futurePlotField).toEqual([1, 2, 3])
    expect(def.compute.futureComputeField).toBe(true)
  })

  it('invents no keys on the way out — a round-trip is a round-trip', () => {
    const d = rsiDef(); delete d.events
    const def = ok(d)
    expect('events' in def).toBe(false)
    expect(Object.keys(def)).toEqual(Object.keys(d))
  })

  it('round-trips a definition through JSON unchanged apart from substitution', () => {
    const d = rsiDef()
    d.plots[0].color = 'token:info'          // already literal — nothing to substitute
    expect(JSON.parse(JSON.stringify(ok(d)))).toEqual(d)
  })
})

describe('structural requirements', () => {
  it('rejects a missing or malformed compute block', () => {
    for (const bad of [undefined, null, 'rsi', []]) {
      const d = rsiDef(); d.compute = bad
      expect(errs(d).join(' ')).toMatch(/compute/)
    }
  })

  it('rejects a non-integer compute.rev — the math revision orders migrations', () => {
    const d = rsiDef(); d.compute.rev = 1.5
    expect(errs(d).join(' ')).toMatch(/1\.5/)
  })

  it('rejects a missing meta.name', () => {
    const d = rsiDef(); delete d.meta.name
    expect(errs(d).join(' ')).toMatch(/meta\.name/)
  })

  it('rejects a placement.scale whose min is not below its max', () => {
    const d = rsiDef(); d.placement.scale = { min: 100, max: 0 }
    expect(errs(d).join(' ')).toMatch(/placement\.scale/)
  })

  it('accepts a placement with no scale (price-overlay indicators have none)', () => {
    const d = rsiDef()
    d.placement = { target: 'price' }
    ok(d)
  })
})

// ─── Task 2 carry-ins ────────────────────────────────────────────────────────
// (a) `band` needs a schema for its edge columns before BB/Donchian can use it.
// (c) `meta.tier` had no locked enum, so any string registered as a tier.

const bandDef = () => ({
  schemaVersion: 1, id: 'bb', version: 1,
  compute: { kind: 'native', fn: 'bb', rev: 1 },
  meta: { name: 'Bollinger Bands', tier: 'free' },
  placement: { target: 'price' },
  inputs: [{ key: 'color', type: 'color', label: 'Colour', default: '#fff' }],
  plots: [
    { key: 'upper',  style: 'line', color: '$color', lineStyle: 'dashed' },
    { key: 'middle', style: 'band', color: '$color', edges: { upper: 'upper', lower: 'lower' } },
    { key: 'lower',  style: 'line', color: '$color', lineStyle: 'dashed' },
    { key: 'guides', style: 'hlines', levels: [0] },
  ],
})

describe('band edges (carry-in a)', () => {
  it('accepts a band whose edges name two declared data plots', () => {
    const def = ok(bandDef())
    expect(def.plots[1].edges).toEqual({ upper: 'upper', lower: 'lower' })
  })

  it('requires edges on a band — a band with no edges bounds nothing', () => {
    const d = bandDef(); delete d.plots[1].edges
    expect(errs(d).join(' ')).toMatch(/edges/)
  })

  it('rejects an edge naming a plot that does not exist', () => {
    const d = bandDef(); d.plots[1].edges.upper = 'ghost'
    expect(errs(d).join(' ')).toMatch(/ghost/)
  })

  it('rejects an edge naming an hlines plot — a guide produces no column', () => {
    const d = bandDef(); d.plots[1].edges.lower = 'guides'
    expect(errs(d).join(' ')).toMatch(/guides/)
  })

  it('rejects a band whose edge is its own key, or whose edges are equal', () => {
    const a = bandDef(); a.plots[1].edges.upper = 'middle'
    expect(errs(a).join(' ')).toMatch(/middle/)
    const b = bandDef(); b.plots[1].edges.lower = 'upper'
    expect(errs(b).join(' ')).toMatch(/edges/)
  })

  it('rejects edges on a plot that is not a band — it would silently do nothing', () => {
    const d = bandDef(); d.plots[0].edges = { upper: 'upper', lower: 'lower' }
    expect(errs(d).join(' ')).toMatch(/edges/)
  })
})

describe('meta.tier vocabulary (carry-in c)', () => {
  it('accepts the locked tiers', () => {
    for (const tier of TIERS) {
      const d = rsiDef(); d.meta.tier = tier
      ok(d)
    }
    expect([...TIERS]).toEqual(['free', 'premium'])
  })

  it('rejects an unlocked tier rather than treating it as free', () => {
    const d = rsiDef(); d.meta.tier = 'enterprise'
    expect(errs(d).join(' ')).toMatch(/enterprise/)
  })

  it('accepts an omitted tier (a definition need not claim one)', () => {
    const d = rsiDef(); delete d.meta.tier
    ok(d)
  })
})

describe('source referents (carry-in b — the pure half)', () => {
  const probe = (dflt) => ({
    ...rsiDef(),
    inputs: [{ key: 'src', type: 'source', label: 'Source', default: dflt }],
    plots: [{ key: 'rsi', style: 'line', color: '#fff' }],
  })
  const columnsOf = (id) => (id === 'rsi' ? ['rsi'] : null)

  it('passes a bar field and a real defId.plotKey', () => {
    expect(validateSourceReferents(probe('close'), columnsOf)).toEqual([])
    expect(validateSourceReferents(probe('rsi.rsi'), columnsOf)).toEqual([])
  })

  it('names the offending value for an unknown definition or plot', () => {
    expect(validateSourceReferents(probe('ghost.x'), columnsOf).join(' ')).toMatch(/ghost/)
    expect(validateSourceReferents(probe('rsi.ghost'), columnsOf).join(' ')).toMatch(/ghost/)
    expect(validateSourceReferents(probe('bananas'), columnsOf).join(' ')).toMatch(/bananas/)
  })
})

// ─── the legend vocabulary (B3 carry #2) ────────────────────────────────────
//
// A chip is a BEHAVIOURAL declaration, not documentation: it decides what the
// crosshair readout prints for a migrated indicator, and every failure here is
// invisible to the pixel gate (a headless capture has no cursor). So it fails
// closed like `inputs[].type` and `plots[].style` rather than being preserved
// like a `meta.*` document field.

describe('plots[].legend', () => {
  const withLegend = (legend) => { const d = rsiDef(); d.plots[0].legend = legend; return d }

  it('accepts the three declared fields', () => {
    expect(validateDefinition(withLegend({ decimals: 1 })).ok).toBe(true)
    expect(validateDefinition(withLegend({ label: 'SIG', decimals: 4 })).ok).toBe(true)
    expect(validateDefinition(withLegend({ hide: true })).ok).toBe(true)
    expect(validateDefinition(withLegend(undefined)).ok).toBe(true)
  })

  it('FAILS CLOSED on an unknown legend field — a chip nobody renders', () => {
    const r = validateDefinition(withLegend({ decimals: 1, prefix: '$' }))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/prefix/)
  })

  it('rejects decimals that are not an integer 0..10', () => {
    for (const bad of [1.5, -1, 11, '1', null]) {
      expect(validateDefinition(withLegend({ decimals: bad })).ok, String(bad)).toBe(false)
    }
  })

  it('rejects a non-string label and a non-boolean hide', () => {
    expect(validateDefinition(withLegend({ label: 14 })).ok).toBe(false)
    expect(validateDefinition(withLegend({ hide: 'yes' })).ok).toBe(false)
  })

  it('rejects a legend that is not an object at all', () => {
    expect(validateDefinition(withLegend('RSI')).ok).toBe(false)
    expect(validateDefinition(withLegend([1])).ok).toBe(false)
  })
})

describe('meta.legendParams', () => {
  const withParams = (params) => { const d = rsiDef(); d.meta.legendParams = params; return d }

  it('accepts an array of declared input keys, and its absence', () => {
    expect(validateDefinition(withParams(['period'])).ok).toBe(true)
    expect(validateDefinition(withParams([])).ok).toBe(true)
    expect(validateDefinition(rsiDef()).ok).toBe(true)
  })

  it('rejects a key no input declares — the chip would read "RSI(undefined)"', () => {
    const r = validateDefinition(withParams(['length']))
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/length/)
    expect(r.errors.join(' ')).toMatch(/undefined/)
  })

  it('rejects a non-array, and an array holding anything but non-empty strings', () => {
    for (const bad of ['period', 14, ['period', ''], ['period', null]]) {
      expect(validateDefinition(withParams(bad)).ok, JSON.stringify(bad)).toBe(false)
    }
  })
})

// ─── meta.timeframes — the ONLY timeframes this indicator exists on ──────────
//
// B3 Task 8. `engine/eligibility.js` DROPS an instance whose chart is not one of
// these, so this is a gate, not decoration — a session indicator on a daily bar
// is not a degraded picture, it is a meaningless one.

describe('meta.timeframes', () => {
  const withTfs = (v) => { const d = rsiDef(); d.meta.timeframes = v; return d }

  it('accepts an array of timeframe codes, and its absence', () => {
    expect(validateDefinition(withTfs(['1', '5', '15', '30', '60'])).ok).toBe(true)
    expect(validateDefinition(withTfs(['D'])).ok).toBe(true)
    // Omitted entirely = "renders everywhere". That is the DEFAULT and every
    // shipped definition but VWAP relies on it.
    expect(validateDefinition(rsiDef()).ok).toBe(true)
    expect(validateDefinition(withTfs(null)).ok).toBe(true)
  })

  it('REJECTS an empty array — "everywhere" is omission, "nowhere" is not a thing', () => {
    // ⚠️ The two are one keystroke apart and they mean opposite things. An `[]`
    // that validated would make the field permissive-by-accident on the read side
    // (`Array.isArray(tfs) && tfs.length` in `eligibleInstances`) — the indicator
    // would render EVERYWHERE while its author had written the code for "nowhere".
    // Rejecting it is the only answer that does not guess which they meant.
    const r = validateDefinition(withTfs([]))
    expect(r.ok, 'an empty meta.timeframes was accepted').toBe(false)
    expect(r.errors.join(' ')).toMatch(/nowhere/)
  })

  it('rejects a non-array, and an array holding anything but non-empty strings', () => {
    for (const bad of ['5', 5, ['5', ''], ['5', null], ['5', 15]]) {
      expect(validateDefinition(withTfs(bad)).ok, JSON.stringify(bad)).toBe(false)
    }
  })
})

// ─── SUBSTITUTABLE_PLOT_FIELDS is the AUTHORITY, not a comment ──────────────
//
// ⚠️ THIS SUITE EXISTS BECAUSE THE EXPORT WAS DECORATIVE. `validatePlot` calls
// `substitute()` per field by hand, so removing an entry from this frozen array
// changed NOTHING observable — a mutation deleting `lineStyle` from it left the
// whole 735-test selection green while the constant, the spec line it mirrors,
// and the docstring above it all claimed otherwise. A vocabulary nothing reads is
// a vocabulary that drifts.
//
// So the list is asserted BEHAVIOURALLY, in both directions: every field named
// here must actually resolve a `$ref`, and a field NOT named here must not. That
// makes the constant load-bearing without moving the validator's per-field logic
// behind a loop it would have to special-case anyway (`levels` substitutes
// per-element, `color`/`width`/`lineStyle` whole-value).

describe('SUBSTITUTABLE_PLOT_FIELDS is what actually substitutes', () => {
  it('names exactly the fields v1 resolves', () => {
    expect([...SUBSTITUTABLE_PLOT_FIELDS]).toEqual(['color', 'width', 'levels', 'lineStyle'])
  })

  it('every NAMED field resolves a $ref to the input default', () => {
    const cases = {
      color: { input: { key: 'c', type: 'color', label: 'C', default: '#123456' }, ref: '$c', expect: '#123456' },
      width: { input: { key: 'w', type: 'int', label: 'W', default: 3, min: 1, max: 5 }, ref: '$w', expect: 3 },
      lineStyle: {
        input: {
          key: 's', type: 'enum', label: 'S', default: 'dashed',
          options: [['solid', 'Solid'], ['dashed', 'Dashed']],
        },
        ref: '$s', expect: 'dashed',
      },
    }
    for (const [field, c] of Object.entries(cases)) {
      const d = rsiDef()
      d.inputs.push(c.input)
      d.plots[0][field] = c.ref
      const r = validateDefinition(d)
      expect(r.ok, `${field}: ${JSON.stringify(r.errors)}`).toBe(true)
      expect(r.def.plots[0][field], `${field} did not resolve`).toEqual(c.expect)
      expect(r.def.plots[0].$refs[field], `${field} recorded no $ref`).toBe(c.input.key)
    }
    // `levels` is per-ELEMENT, which is why it is checked apart from the others.
    const d = rsiDef()
    d.inputs.push({ key: 'hi', type: 'int', label: 'Hi', default: 80, min: 1, max: 100 })
    d.plots[1].levels = ['$hi', 50, 30]
    const r = validateDefinition(d)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.def.plots[1].levels).toEqual([80, 50, 30])
    expect(r.def.plots[1].$refs.levels).toEqual(['hi', null, null])
  })

  it('a field NOT named here does NOT substitute — the list is a boundary', () => {
    // `precision` is a real, validated plot field of the right shape (a number
    // from an int input) and is deliberately absent from the list. If substitution
    // ever became blanket, this is what would notice.
    expect(SUBSTITUTABLE_PLOT_FIELDS).not.toContain('precision')
    const d = rsiDef()
    d.inputs.push({ key: 'p', type: 'int', label: 'P', default: 4, min: 0, max: 8 })
    d.plots[0].precision = '$p'
    const r = validateDefinition(d)
    expect(r.ok, 'a $ref in an unsubstitutable field was accepted as a number').toBe(false)
    expect(r.def === undefined || r.def.plots[0].precision, 'precision silently substituted').not.toBe(4)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PHASE D TASK 8 — the third lane, and the filter that stopped being a comment
// ─────────────────────────────────────────────────────────────────────────────

/** A valid `ast` definition for `source`, built THROUGH the one parser.
 *
 *  ⛔ THE TREE AND THE HANDLE ARE BOTH DERIVED, never typed. A fixture holding a
 *  hand-written tree would be a second grammar (D-A1's whole subject), and a
 *  fixture holding a hand-typed `compute.fn` would rot the day `stableStringify`
 *  changes — while still passing, because the test would be comparing its own
 *  copy to itself. */
const astDef = (source) => {
  const parsed = parseFormula(source)
  if (!parsed.ok) throw new Error(`astDef fixture does not parse: ${source} — ${parsed.error}`)
  return {
    schemaVersion: SCHEMA_VERSION, id: 'myFormula', version: 1,
    compute: { kind: 'ast', fn: astHash(parsed.ast), rev: 1, ast: parsed.ast, source },
    meta: { name: 'My formula', shortName: 'F', category: 'Custom', tier: 'free', repaint: 'non-repainting' },
    placement: { target: 'pane', pane: { height: 0.15 } },
    inputs: [{ key: 'color', type: 'color', label: 'Colour', default: 'token:info' }],
    plots: [{ key: 'out', label: 'F', style: 'line', color: '$color', width: 1, role: 'primary' }],
  }
}

describe('`supportedKinds` EXISTS (Phase D Task 8)', () => {
  it('is a real, frozen, STRICT SUBSET of the declared kinds — and `script` is not in it', () => {
    // ⛔ `defSchema.js`'s COMPUTE_KINDS comment HAS CLAIMED SINCE B1 that "the
    // registry's `supportedKinds` filter decides what a given client will
    // actually run." MEASURED 2026-08-06: that filter had NO identifier anywhere
    // in `app/src` or `api/` — the string appeared twice in the whole repo, in
    // that comment and in spec §3.1, and zero times as code. A comment
    // describing a mechanism nobody wrote, sitting in the file whose job is to
    // fail closed.
    //
    // `script` stays a DECLARED kind (it parses, per spec §3) and an UNSUPPORTED
    // one (nothing runs it). Those are different statements and the schema has
    // to be able to make both.
    expect(SUPPORTED_KINDS).toEqual(['native', 'server', 'ast'])
    expect(COMPUTE_KINDS).toContain('script')
    expect(SUPPORTED_KINDS).not.toContain('script')
    expect(Object.isFrozen(SUPPORTED_KINDS)).toBe(true)
    // …and it is a SUBSET, not a second vocabulary that could drift into naming
    // a lane `COMPUTE_KINDS` has never heard of.
    expect(SUPPORTED_KINDS.filter(k => !COMPUTE_KINDS.includes(k))).toEqual([])
    expect(SUPPORTED_KINDS.length).toBeLessThan(COMPUTE_KINDS.length)
  })

  it('a definition of an UNSUPPORTED kind is still WELL-FORMED — unsupported is not invalid', () => {
    // Spec §3.1: the catalog fetch filters by client `supportedKinds`; §5: premium
    // entries stay LISTED for merchandising even when locked. So "cannot run" and
    // "must not appear" are different claims, and conflating them would hide the
    // whole server lane from a client that simply has an older bundle. The
    // REFUSAL TO RENDER lives at the registry door (`nativeRegistry.test.js`);
    // the schema's job is to keep saying yes here.
    const d = rsiDef()
    d.compute = { kind: 'script', fn: 'x', rev: 1 }
    const r = validateDefinition(d)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })
})

describe('the `ast` lane — the AST is what runs, the source is what the user edits', () => {
  it('accepts a well-formed ast definition', () => {
    const r = validateDefinition(astDef('sma(close, 20)'))
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })

  it('an `ast` definition MUST carry both `compute.ast` and `compute.source`', () => {
    for (const field of ['ast', 'source']) {
      const d = astDef('sma(close, 20)')
      delete d.compute[field]
      const r = validateDefinition(d)
      expect(r.ok, `a definition with no compute.${field} registered`).toBe(false)
      expect(r.errors.join('\n')).toMatch(new RegExp(`compute\\.${field}`))
    }
  })

  it('…and they must AGREE', () => {
    // ⭐ D-A1's RAIL. The AST is what runs; the source is what the user edits. A
    // stored pair that disagree is a definition whose read-back describes maths
    // nobody is computing — the exact failure the concierge is designed against,
    // arriving from the other direction.
    const def = astDef('sma(close, 20)')
    def.compute.source = 'sma(close, 200)'          // edited, AST not re-parsed
    const res = validateDefinition(def)
    expect(res.ok).toBe(false)
    expect(res.errors.join('\n')).toMatch(/compute\.source does not parse to compute\.ast/)
  })

  it('…and a source that does not parse AT ALL is the same refusal, not a crash', () => {
    const def = astDef('sma(close, 20)')
    def.compute.source = 'close = 1'                 // jsep core has no assignment
    const res = validateDefinition(def)
    expect(res.ok).toBe(false)
    expect(res.errors.join('\n')).toMatch(/compute\.source does not parse to compute\.ast/)
  })

  it('WHITESPACE AND SPACING ARE NOT A DISAGREEMENT — the comparison is by hash', () => {
    // The rail above must fail on different MATHS and only on different maths.
    // Compared by `astHash` — the same identity that decides a `compute.rev`
    // bump — so a reformat cannot make an identical formula read as an edit.
    const def = astDef('sma(close, 20)')
    def.compute.source = '  sma( close ,   20 )  '
    const res = validateDefinition(def)
    expect(res.ok, JSON.stringify(res.errors)).toBe(true)
  })

  it("an `ast` definition's `compute.fn` IS its astHash", () => {
    // `compute.fn` is required for EVERY kind (a non-empty-string check with no
    // kind branch), so the alternative was never "no handle" — it was "a handle
    // that means nothing". `fn` names a function in `NATIVE_COMPUTE` for a
    // native and an endpoint's definition id for a server def; for an AST there
    // is no third thing to name, because the tree IS the implementation.
    const good = astDef('ema(close, 9)')
    expect(good.compute.fn).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(validateDefinition(good).ok).toBe(true)

    const d = astDef('ema(close, 9)')
    d.compute.fn = 'myEma'
    const r = validateDefinition(d)
    expect(r.ok, 'a hand-named ast handle registered').toBe(false)
    expect(r.errors.join('\n')).toMatch(/compute handle IS its astHash/)

    // …and the handle tracks the MATHS: two formulas, two handles.
    expect(astDef('ema(close, 9)').compute.fn).not.toBe(astDef('ema(close, 21)').compute.fn)
  })

  it('a non-canonical stored tree is refused by name, not by exception', () => {
    const d = astDef('sma(close, 20)')
    d.compute.ast = { type: 'MemberExpression', object: 'close', property: 0 }
    d.compute.fn = `sha256:${'0'.repeat(64)}`
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/not a canonical tree/)
    // ⛔ AND THE VALIDATOR STILL DID NOT THROW — the contract that keeps one bad
    // catalog entry off the chart instead of taking the chart with it.
    expect(Array.isArray(r.errors)).toBe(true)
  })

  it('⛔ the OTHER lanes gained no ast requirement — a native needs neither field', () => {
    // The positive control for every case above: if `validateAstCompute` were
    // called unconditionally, all seventeen shipped definitions would stop
    // registering. This is what says the branch is a branch.
    const r = validateDefinition(rsiDef())
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.def.compute.ast).toBeUndefined()
    expect(r.def.compute.source).toBeUndefined()
  })
})

// ─── schema v2 — many trees, one hash (spec §5.1, lane W1b task 2) ──────────
// The twelve cases below are the brief's, verbatim. The nested block after them
// is this task's: the holes those twelve leave open, each named at the field.
describe('schema v2 — many trees, one hash', () => {
  const astDef = (source) => {
    const ast = parseFormula(source).ast
    return {
      schemaVersion: 1, id: 'u_0123456789ab', version: 1,
      compute: { kind: 'ast', fn: astHash(ast), rev: 1, ast, source },
      meta: { name: 'Mine', tier: 'premium', repaint: 'non-repainting', freshness: 'live' },
      placement: { target: 'pane', pane: { height: 0.15 } },
      inputs: [{ key: 'color', type: 'color', label: 'Color', default: '#c9a84c' }],
      plots: [{ key: 'value', label: 'Value', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 2 } }],
    }
  }
  const SRC = {
    macd: 'ema(close, 12) - ema(close, 26)',
    signal: 'ema(ema(close, 12) - ema(close, 26), 9)',
    hist: '(ema(close, 12) - ema(close, 26)) - ema(ema(close, 12) - ema(close, 26), 9)',
  }
  const macdV2 = () => {
    const trees = Object.fromEntries(Object.entries(SRC).map(([k, s]) => [k, parseFormula(s).ast]))
    const d = astDef(SRC.hist)
    d.compute = { ...d.compute, ast: trees.hist, fn: astHash(trees.hist), source: SRC.hist,
      trees, treesHash: treesHash(trees), scanPlot: 'hist', sources: { ...SRC } }
    d.plots = [
      { key: 'macd', label: 'MACD', style: 'line', color: '$color', width: 1, role: 'primary', legend: { decimals: 4 } },
      { key: 'signal', label: 'Signal', style: 'line', color: '$color', width: 1, role: 'secondary', legend: { decimals: 4 } },
      { key: 'hist', label: 'Histogram', style: 'histogram', color: '$color', role: 'secondary', legend: { hide: true } },
      { key: 'zero', label: '0', style: 'hlines', levels: [0], color: 'rgba(255,255,255,0.12)', width: 1, lineStyle: 'largeDashed' },
    ]
    return d
  }

  it('⛔ RAIL — a single-tree document is BYTE-IDENTICAL to today: no v2 key on the way out, `fn` unchanged', () => {
    const r = validateDefinition(astDef('sma(close, 20)'))
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(Object.keys(r.def.compute).sort()).toEqual(['ast', 'fn', 'kind', 'rev', 'source'])
    expect(r.def.compute.fn).toBe(astHash(parseFormula('sma(close, 20)').ast))
  })
  it('🔴 accepts a 3-tree MACD whose `ast` IS `trees[scanPlot]`, and `fn` is STILL astHash(ast)', () => {
    const d = macdV2()
    const r = validateDefinition(d)
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
    expect(r.def.compute.fn).toBe(astHash(d.compute.trees.hist))
    expect(r.def.compute.treesHash).toBe(treesHash(d.compute.trees))
  })
  it('compute.ast must BE trees[scanPlot] — a stale alias is refused by name', () => {
    const d = macdV2(); d.compute.ast = d.compute.trees.macd; d.compute.fn = astHash(d.compute.ast); d.compute.source = SRC.macd
    expect(errs(d).join(' ')).toMatch(/compute\.ast: must BE compute\.trees\.hist/)
  })
  it('scanPlot must name a tree', () => {
    const d = macdV2(); d.compute.scanPlot = 'nope'
    expect(errs(d).join(' ')).toMatch(/compute\.scanPlot/)
  })
  it('treesHash is CHECKED, never trusted', () => {
    const d = macdV2(); d.compute.treesHash = `sha256:${'0'.repeat(64)}`
    expect(errs(d).join(' ')).toMatch(/compute\.treesHash: expected/)
  })
  it('every tree must be canonical, and the error names the plot', () => {
    const d = macdV2(); d.compute.trees.signal = { type: 'Literal', value: 1 }
    expect(errs(d).join(' ')).toMatch(/compute\.trees\.signal/)
  })
  it('the data-bearing plots and the trees are ONE key set, in both directions', () => {
    const missing = macdV2(); missing.plots = missing.plots.filter((p) => p.key !== 'signal')
    expect(errs(missing).join(' ')).toMatch(/compute\.trees\.signal: names no data-bearing plot/)
    const extra = macdV2(); extra.plots.push({ key: 'fourth', style: 'line', color: '$color' })
    expect(errs(extra).join(' ')).toMatch(/plots: data-bearing plot "fourth" has no tree/)
  })
  it('sources: each parses to its tree, and sources[scanPlot] is compute.source', () => {
    const wrong = macdV2(); wrong.compute.sources.macd = 'ema(close, 5)'
    expect(errs(wrong).join(' ')).toMatch(/compute\.sources\.macd does not parse to compute\.trees\.macd/)
    const split = macdV2(); split.compute.sources.hist = 'sma(close, 3)'
    expect(errs(split).join(' ')).toMatch(/compute\.sources\.hist/)
  })
  it('v2 keys beside NO trees are refused by name — a single-tree document stays schema-1 shaped', () => {
    const d = astDef('sma(close, 20)'); d.compute.scanPlot = 'value'
    expect(errs(d).join(' ')).toMatch(/compute\.scanPlot: only a multi-tree document/)
  })
  it('fill.with names ANOTHER data plot — never itself, never a guide, never nothing', () => {
    const good = macdV2(); good.plots[0].fill = { with: 'signal' }
    expect(ok(good).plots[0].fill).toEqual({ with: 'signal' })
    const self = macdV2(); self.plots[0].fill = { with: 'macd' }
    expect(errs(self).join(' ')).toMatch(/plots\[0\]\.fill\.with: "macd" is this plot's own key/)
    const guide = macdV2(); guide.plots[0].fill = { with: 'zero' }
    expect(errs(guide).join(' ')).toMatch(/plots\[0\]\.fill\.with: "zero" is an "hlines" plot/)
    const nope = macdV2(); nope.plots[0].fill = { with: 'nope' }
    expect(errs(nope).join(' ')).toMatch(/plots\[0\]\.fill\.with: "nope" names no declared plot/)
  })
  it('hidden is a boolean', () => {
    const d = macdV2(); d.plots[2].hidden = 'yes'
    expect(errs(d).join(' ')).toMatch(/plots\[2\]\.hidden: expected true or false/)
    const h = macdV2(); h.plots[2].hidden = true
    expect(ok(h).plots[2].hidden).toBe(true)
  })
  it('`cross` is SCHEMA-RESERVED — refused with the later-phase sentence, never coerced to a neighbour', () => {
    const d = macdV2(); d.plots[0].style = 'cross'
    expect(errs(d).join(' ')).toMatch(/plots\[0\]\.style: plot style "cross" is SCHEMA-RESERVED/)
  })

  // ─── beyond the brief: the holes the twelve above leave open ──────────────
  describe('beyond the brief — the rails around the rails', () => {
    it('the v2 output CARRIES the four v2 keys, and the v1 output carries NO defaulted plot field — the byte-identical rail is not vacuous', () => {
      // Half one: a v2 document CHANGES the compute key set. Without this the
      // RAIL above would pass against a validator that dropped v2 on the floor.
      const v2 = validateDefinition(macdV2())
      expect(v2.ok, JSON.stringify(v2.errors)).toBe(true)
      expect(Object.keys(v2.def.compute).sort())
        .toEqual(['ast', 'fn', 'kind', 'rev', 'scanPlot', 'source', 'sources', 'trees', 'treesHash'])
      expect(v2.def.compute.scanPlot).toBe('hist')
      expect(v2.def.compute.sources).toEqual(SRC)
      // Half two: a v1 plot gains no `hidden: false` / `fill: null` on the way
      // out. A normalising default here is exactly what "byte-identical" forbids.
      const v1 = validateDefinition(astDef('sma(close, 20)'))
      expect(Object.keys(v1.def.plots[0]).sort())
        .toEqual(['$refs', 'color', 'key', 'label', 'legend', 'role', 'style', 'width'])
    })
    it('a ONE-tree trees map is refused by name — one tree IS compute.ast, and a single-tree document has exactly ONE shape', () => {
      const d = astDef('sma(close, 20)')
      d.compute.trees = { value: d.compute.ast }
      d.compute.treesHash = treesHash(d.compute.trees)
      d.compute.scanPlot = 'value'
      d.compute.sources = { value: d.compute.source }
      expect(errs(d).join(' ')).toMatch(/compute\.trees: one tree is compute\.ast/)
    })
    it('trees: null is NOT "absent" — refused by name, never silently carried', () => {
      const d = macdV2(); d.compute.trees = null
      expect(errs(d).join(' ')).toMatch(/compute\.trees: expected an object of plotKey/)
    })
    it('trees: an array, or an illegal key, is refused under the compute.trees field path', () => {
      const arr = macdV2(); arr.compute.trees = [arr.compute.ast]
      expect(errs(arr).join(' ')).toMatch(/compute\.trees: expected an object of plotKey → canonical tree, got an array/)
      const bad = macdV2(); bad.compute.trees = { ...bad.compute.trees, 'a.b': bad.compute.ast }
      expect(errs(bad).join(' ')).toMatch(/compute\.trees: "a\.b" is not a legal plot key/)
    })
    it('treesHash is REQUIRED on a multi-tree document — absent reads as "got undefined", never as "trusted"', () => {
      const d = macdV2(); delete d.compute.treesHash
      expect(errs(d).join(' ')).toMatch(/compute\.treesHash: expected "sha256:[0-9a-f]{64}".*got undefined/)
    })
    it('scanPlot is REQUIRED on a multi-tree document — there is no "default the first plot"', () => {
      const d = macdV2(); delete d.compute.scanPlot
      expect(errs(d).join(' ')).toMatch(/compute\.scanPlot: must name one key of compute\.trees \(hist, macd, signal\).*got undefined/)
    })
    it('sources is REQUIRED on a multi-tree document, and COMPLETE — a tree with no source text can never be reopened', () => {
      const none = macdV2(); delete none.compute.sources
      expect(errs(none).join(' ')).toMatch(/compute\.sources: a multi-tree document must carry the source text of EVERY tree/)
      const partial = macdV2(); delete partial.compute.sources.signal
      expect(errs(partial).join(' ')).toMatch(/compute\.sources\.signal: missing/)
      const extra = macdV2(); extra.compute.sources.ghost = 'close'
      expect(errs(extra).join(' ')).toMatch(/compute\.sources\.ghost: names no tree/)
      const notText = macdV2(); notText.compute.sources.macd = 42
      expect(errs(notText).join(' ')).toMatch(/compute\.sources\.macd: expected the source text/)
    })
    it('a scan source that does not parse STILL reports the tree errors — the tree check runs before that return', () => {
      const d = macdV2()
      d.compute.source = 'ema(close, 12'; d.compute.sources.hist = d.compute.source; d.compute.scanPlot = 'nope'
      const e = errs(d).join(' ')
      expect(e).toMatch(/compute\.source does not parse/)
      expect(e).toMatch(/compute\.scanPlot/)
    })
    it('a MISSING compute.ast still reports the tree defects — EVERY early return is above the tree rules, not just one', () => {
      // ⛔ THE LIKELIER v2 AUTHORING FAILURE, and the reason one early return was
      // not enough: the sheet writes `ast = trees[scanPlot]`, so a bug there
      // breaks `compute.ast` and the trees TOGETHER. Reporting the missing tree
      // and swallowing the rest is the "one refusal per save attempt" the
      // placement exists to prevent.
      const d = macdV2()
      delete d.compute.ast
      d.compute.scanPlot = 'nope'
      d.compute.treesHash = `sha256:${'0'.repeat(64)}`
      const e = errs(d).join(' ')
      expect(e).toMatch(/compute\.ast: an "ast" definition must carry the canonical tree/)
      expect(e).toMatch(/compute\.scanPlot/)
      expect(e).toMatch(/compute\.treesHash: expected/)
      // …and the `fn` rule still does NOT fire with no tree to hash it against:
      // there is no expected value, so there is no disagreement to report.
      expect(e).not.toMatch(/compute handle IS its astHash/)
    })
    it('…and a NON-CANONICAL compute.ast does too — including the per-tree source rules', () => {
      const d = macdV2()
      d.compute.ast = { type: 'Literal', value: 1 }
      d.compute.fn = `sha256:${'0'.repeat(64)}`
      d.compute.sources.macd = 'ema(close, 5)'
      const e = errs(d).join(' ')
      expect(e).toMatch(/compute\.ast: not a canonical tree/)
      expect(e).toMatch(/compute\.sources\.macd does not parse to compute\.trees\.macd/)
      // The ALIAS check is the one rule that needs compute.ast's hash, and it
      // stays silent rather than guessing — one defect, one sentence.
      expect(e).not.toMatch(/must BE compute\.trees/)
    })
    it('hidden: FALSE on a guide is accepted — the refusal is about hiding a plot that computes nothing', () => {
      const d = macdV2(); d.plots[3].hidden = false
      expect(ok(d).plots[3].hidden).toBe(false)
    })
    it('v2 keys on a NON-ast kind are refused by name — a native names a function, it computes no trees', () => {
      const d = rsiDef(); d.compute.trees = { rsi: parseFormula('close').ast }
      expect(errs(d).join(' ')).toMatch(/compute\.trees: only an "ast" definition/)
      const s = rsiDef(); s.compute.scanPlot = 'rsi'
      expect(errs(s).join(' ')).toMatch(/compute\.scanPlot: only an "ast" definition/)
    })
    it('a HIDDEN plot is still DATA-BEARING — it needs a tree, and its tree needs it (A1\'s 0/1 scan plot)', () => {
      const d = macdV2()
      d.plots.push({ key: 'hist_up', style: 'line', color: '$color', hidden: true })
      expect(errs(d).join(' ')).toMatch(/plots: data-bearing plot "hist_up" has no tree/)
      const src = `(${SRC.hist}) > 0`
      d.compute.trees.hist_up = parseFormula(src).ast
      d.compute.treesHash = treesHash(d.compute.trees)
      d.compute.sources.hist_up = src
      const r = validateDefinition(d)
      expect(r.ok, JSON.stringify(r.errors)).toBe(true)
      expect(r.def.plots[4].hidden).toBe(true)
    })
    it('fill.with may name a HIDDEN plot — hidden is computed, so the second edge exists', () => {
      const d = macdV2()
      d.plots.push({ key: 'ref', style: 'line', color: '$color', hidden: true })
      d.compute.trees.ref = parseFormula('ema(close, 50)').ast
      d.compute.treesHash = treesHash(d.compute.trees)
      d.compute.sources.ref = 'ema(close, 50)'
      d.plots[0].fill = { with: 'ref' }
      expect(ok(d).plots[0].fill).toEqual({ with: 'ref' })
    })
    it('fill declared ON a guide is refused — an "hlines" plot has no column, so there is no edge to fill FROM', () => {
      const d = macdV2(); d.plots[3].fill = { with: 'macd' }
      expect(errs(d).join(' ')).toMatch(/plots\[3\]\.fill: an "hlines" plot returns no column/)
    })
    it('hidden ON a guide is refused — an "hlines" plot computes nothing, so there is nothing to hide', () => {
      // Keeps `hidden ⇒ data-bearing` true by construction, so the binder's
      // pass-one skip (W1b.6) never needs a guide special case.
      const d = macdV2(); d.plots[3].hidden = true
      expect(errs(d).join(' ')).toMatch(/plots\[3\]\.hidden: an "hlines" plot is a guide/)
    })
    it('fill must be {with: "<plotKey>"} — a bare string or an empty object is refused by shape', () => {
      const str = macdV2(); str.plots[0].fill = 'signal'
      expect(errs(str).join(' ')).toMatch(/plots\[0\]\.fill: expected \{with: "<plotKey>"\}/)
      const empty = macdV2(); empty.plots[0].fill = {}
      expect(errs(empty).join(' ')).toMatch(/plots\[0\]\.fill: expected \{with: "<plotKey>"\}/)
    })
    it('`cross` is RESERVED and NOT buildable — the two lists disagree on purpose', () => {
      expect(RESERVED_PLOT_STYLES).toContain('cross')
      expect(PLOT_STYLES).not.toContain('cross')
    })
  })

  // ─── `fill` is VALIDATED-BUT-INERT until W6 ────────────────────────────────
  //
  // Brief §1.4: *"Until W6, `fill` is validated-but-inert exactly as
  // `colorMode: 'column:<key>'` is today, and a test says so."* This is that
  // test, and it exists because "nobody renders this" is otherwise a fact that
  // lives only in a comment — the shape a lane inherits as a surprise. Both
  // halves are asserted: nothing DRAWS it, and the schema CARRIES it.
  describe('⛔ fill is VALIDATED-BUT-INERT until W6 — a declared state, not an accident', () => {
    const ENGINE = resolve(process.cwd(), 'src/components/chart/engine')
    /** ⛔ SOURCE PROBE, DELIBERATELY, and the file list is DERIVED from the
     *  directory rather than typed: a renderer added tomorrow is covered the day
     *  it lands. A behavioural test cannot prove the ABSENCE of a reader — a
     *  renderer that reads `plot.fill` and draws nothing yet renders nothing
     *  different, and no DOM assertion anywhere can see it.
     *
     *  ⭐ AND `chart/` IS SWEPT, NOT JUST `engine/`. Spec §6 calls W6's renderer
     *  a SERIES PRIMITIVE, and this repo's existing series primitives
     *  (`earningsBadgePrimitive.js`, `swingLabelsPrimitive.js`) live one
     *  directory UP — so a W6 renderer authored where its siblings already live
     *  would have left this probe green while reading the field. A rail that
     *  cannot see the place the thing will actually be written is not a rail. */
    const engineSources = () => [['', ENGINE], ['ast/', resolve(ENGINE, 'ast')], ['../', resolve(ENGINE, '..')]]
      .flatMap(([prefix, dir]) => readdirSync(dir)
        .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'defSchema.js')
        .map((f) => [prefix + f, readFileSync(resolve(dir, f), 'utf8')]))
    /** ⛔ `.fill` NOT FOLLOWED BY `(`. `col.fill(NaN)` (interpret.js),
     *  `new Array(n).fill(0)` (paneLayout.js) and `ctx.fill()` are the Array and
     *  Canvas METHODS — a probe that counted those would report every renderer as
     *  a reader and be green forever after W6 wires the real one. */
    const FIELD_READ = /\.fill\b(?!\s*\()/

    it('no engine module READS the fill field today — so W6 turning it on is a visible edit, not a silent one', () => {
      const readers = engineSources().filter(([, src]) => FIELD_READ.test(src)).map(([name]) => name)
      expect(readers,
        'a module reads plots[].fill. The field is SCHEMA-ONLY in Wave 1 (spec §6 gives the renderer ' +
        'to W6): if a renderer now consumes it, this claim in validateFills\' header is stale and the ' +
        'comment must move with the code.',
      ).toEqual([])
      // ⛔ AND THE PROBE IS NOT VACUOUS, in both directions. `defSchema.js` — the
      // one legitimate reader, excluded above — must MATCH, or the pattern has
      // rotted into one that reports every deletion as done; and the Array
      // method must NOT, or the exclusion above is doing nothing.
      expect(FIELD_READ.test(readFileSync(resolve(ENGINE, 'defSchema.js'), 'utf8')),
        'the probe shape matches nothing — it rotted').toBe(true)
      expect(FIELD_READ.test('col.fill(NaN)'), 'the Array method is not a field read').toBe(false)
      expect(engineSources().length, 'the derived file list is empty — readdir found nothing').toBeGreaterThan(10)
      // ⛔ AND THE `chart/` SWEEP REACHES THE PRIMITIVES. A directory entry that
      // resolved somewhere empty would add nothing and report nothing — the
      // probe would read as widened while sweeping exactly what it did before.
      expect(engineSources().map(([name]) => name),
        'the sweep no longer reaches the existing series primitives — W6 could write its renderer beside them unseen',
      ).toEqual(expect.arrayContaining(['../earningsBadgePrimitive.js', '../swingLabelsPrimitive.js']))
    })

    it('…and the schema CARRIES it — inert means "drawn by nobody", never "quietly dropped"', () => {
      const d = macdV2(); d.plots[0].fill = { with: 'signal' }
      expect(ok(d).plots[0].fill).toEqual({ with: 'signal' })
    })
  })

  // ─── ONE key grammar ───────────────────────────────────────────────────────
  // `defSchema.js` and `ast/trees.js` each held a private copy of the plot-key
  // regex (W1b.1's review). The grammar now lives in `ast/parse.js` beside
  // `LOOKBACK_RE` — the leaf both already import — and these two cases are what
  // make that load-bearing: a re-typed copy that drifts fails here BY NAME.
  //
  // The import is DYNAMIC on purpose: the day the export is missing, the
  // assertion below says so, instead of this whole file refusing to load and
  // taking a hundred unrelated cases down with it.
  describe('⛔ ONE key grammar — parse.js owns KEY_RE; defSchema and trees derive from it', () => {
    const PROBES = ['a', 'A', 'macd', 'Z9', 'abc_1', 'hist_up',
      '1a', 'a.b', 'a-b', 'a b', '_a', '$a', '', 'é', 'a\n', 'ema(close)']
    it('the grammar is EXPORTED from the leaf both modules import — never a private copy', async () => {
      const parse = await import('./ast/parse')
      expect(parse.KEY_RE, 'ast/parse.js exports KEY_RE beside LOOKBACK_RE').toBeInstanceOf(RegExp)
      // the probe list carries both halves, so a regex that accepted everything
      // (or nothing) could not pass the agreement case below vacuously
      expect(PROBES.filter((k) => parse.KEY_RE.test(k))).toEqual(['a', 'A', 'macd', 'Z9', 'abc_1', 'hist_up'])
    })
    it('defSchema (a plot key) and trees (a tree key) accept and reject the SAME keys, and both agree with parse.js', async () => {
      const { KEY_RE } = await import('./ast/parse')
      for (const k of PROBES) {
        const d = astDef('sma(close, 20)'); d.plots[0].key = k
        const r = validateDefinition(d)
        const schemaAccepts = r.ok || !r.errors.some((e) => e.startsWith('plots[0].key'))
        let treesAccepts = true
        try { assertTrees({ [k]: d.compute.ast }) } catch { treesAccepts = false }
        expect(schemaAccepts, `defSchema on ${JSON.stringify(k)}`).toBe(KEY_RE.test(k))
        expect(treesAccepts, `trees on ${JSON.stringify(k)}`).toBe(KEY_RE.test(k))
      }
    })
  })
})
