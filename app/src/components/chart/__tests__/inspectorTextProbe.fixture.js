// app/src/components/chart/__tests__/inspectorTextProbe.fixture.js
//
// ⭐ UCT RS PHASE 3, UNIT 3-02b — the server definition the Chart Settings
// Inspector suites mount (`ChartSettingsIndicators.text.test.jsx`,
// `ChartSettingsIndicators.serverGate.test.jsx`). It is the settings dialog's
// 3-02 `textProbe` with two more inputs, so the Inspector is checked against
// every gate 3-01 defines:
//   · `benchmark`        an enum with a GATED option (`CUSTOM`);
//   · `customBenchmark`  a text input with pattern, maxLength, case, placeholder, hint;
//   · `note`             a text input with a pattern and NO hint (the generic sentence);
//   · `window`           a GATED input (`requiresServer`);
//   · `oldMode`          a LEGACY input (declared, never rendered);
//   · presets `plain` (ungated), `mine` (sets the gated option) and `dark`
//     (`requiresServer`), and `tech` (ungated, sets the text input).
// Not a test file: vitest only collects `*.test.*`.
import { validateDefinition } from '../engine/defSchema'

export const PROBE_ID = 'textProbe'
export const PROBE_INST = 'inst:textProbe:1'
export const TICKER = '^[A-Z][A-Z0-9.\\-]{0,9}$'

export const textProbeRaw = () => ({
  schemaVersion: 1, id: PROBE_ID, version: 1,
  compute: { kind: 'server', fn: 'textProbe', rev: 1 },
  meta: {
    name: 'Text probe', shortName: 'TP', category: 'Momentum', tier: 'premium', repaint: 'non-repainting',
    serverInputs: ['benchmark', 'customBenchmark', 'length', 'window'],
    presets: [
      { id: 'plain', label: 'Plain', inputs: { length: 21 } },
      { id: 'mine', label: 'My symbol', inputs: { benchmark: 'CUSTOM' } },
      { id: 'dark', label: 'Dark preset', requiresServer: true, inputs: { length: 30 } },
      { id: 'tech', label: 'Tech', inputs: { customBenchmark: 'XLK' } },
    ],
  },
  placement: { target: 'pane' },
  inputs: [
    { key: 'benchmark', type: 'enum', label: 'Benchmark', default: 'SPY',
      options: [['SPY', 'S&P 500'], ['RSP', 'Equal weight'], ['CUSTOM', 'Your symbol', { requiresServer: true }]] },
    { key: 'customBenchmark', type: 'string', label: 'Symbol', default: '',
      pattern: TICKER, maxLength: 10, case: 'upper', placeholder: 'e.g. XLK',
      hint: 'Letters, dots and dashes, up to 10', tooltip: 'The symbol to compare against.' },
    { key: 'note', type: 'string', label: 'Note', default: '', pattern: '^[0-9]+$' },
    { key: 'length', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
    { key: 'window', type: 'int', label: 'Window', default: 63, min: 5, max: 252, requiresServer: true },
    { key: 'oldMode', type: 'string', label: 'Old mode', default: '', legacy: true },
  ],
  plots: [{ key: 'line', label: 'Line', style: 'line', color: '#ffffff', width: 1 }],
  events: [],
})

/** The route's body, declaring CUSTOM, `window` and the dark preset's input — or not. */
export const definitionsBody = ({ custom }) => ({
  schemaVersion: 1,
  definitions: [{
    schemaVersion: 1, id: PROBE_ID, version: 1, compute: { kind: 'server', fn: 'textProbe', rev: 1 },
    inputs: [
      { key: 'benchmark', type: 'enum', default: 'SPY', options: custom ? ['SPY', 'RSP', 'CUSTOM'] : ['SPY', 'RSP'] },
      { key: 'customBenchmark', type: 'string', default: '' },
      { key: 'length', type: 'int', default: 14 },
      ...(custom ? [{ key: 'window', type: 'int', default: 63 }] : []),
    ],
    columns: ['line'],
  }],
})

/** The REGISTERED shape (`$refs` resolved), as `nativeRegistry.getDefinition` hands it out. */
export function probeDefinition() {
  const res = validateDefinition(textProbeRaw())
  if (!res.ok) throw new Error(`fixture definition rejected: ${res.errors.join(' | ')}`)
  return res.def
}

/** `nativeRegistry` with the probe registered beside the shipped definitions. */
export function withProbe(actual) {
  const probe = probeDefinition()
  return {
    ...actual,
    getDefinition: (id) => (id === PROBE_ID ? probe : actual.getDefinition(id)),
    listDefinitions: () => [...actual.listDefinitions(), probe],
    listAllDefinitions: () => [...actual.listAllDefinitions(), probe],
  }
}
