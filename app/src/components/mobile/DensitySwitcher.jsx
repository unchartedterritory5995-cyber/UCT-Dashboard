import SegmentedNav from './SegmentedNav'

/* DensitySwitcher — preset SegmentedNav for choosing how dense a data surface
 * renders (Options Flow, J2 positions, Dark Pool). Pair with a persisted value
 * (e.g. usePreferences) at the call site.
 */
export const DENSITY_OPTIONS = [
  { key: 'cards', label: 'Cards' },
  { key: 'compact', label: 'Compact' },
  { key: 'detailed', label: 'Detailed' },
]

export default function DensitySwitcher({ value, onChange, options = DENSITY_OPTIONS }) {
  return (
    <SegmentedNav items={options} value={value} onChange={onChange} ariaLabel="Density" />
  )
}
