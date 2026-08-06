import { describe, it, expect } from 'vitest'
import {
  validateDefinition, validateSourceReferents, SCHEMA_VERSION, TIERS,
  SUBSTITUTABLE_PLOT_FIELDS,
} from './defSchema'

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
