import { describe, it, expect } from 'vitest'
import { validateDefinition, SCHEMA_VERSION } from './defSchema'

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
  it('accepts "fixed" and "sign"', () => {
    for (const mode of ['fixed', 'sign']) {
      const d = rsiDef(); d.plots[0].colorMode = mode
      ok(d)
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
