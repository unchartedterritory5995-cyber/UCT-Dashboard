// app/src/pages/charts/CreateIndicatorTopBarButton.jsx
//
// The charts workspace's ONE visible door to Create Indicator (`createIndicatorEntry.js` says why it
// stands in the top bar and which chart it opens on). A real button with a name, shown only to an
// account that may use Create Indicator: the same rule the chart's own button and the command
// palette ask (`useCreateIndicatorAccess`), so a member who cannot use it never sees a dead control.
//
// ⛔ IT READS NOTHING THAT CHANGES ON A CHART SWITCH. Its only inputs are the signed-in account and
// this browser's own review flag; the press handler arrives as a stable prop and finds the chart at
// the moment of the press. Memoised, so a parent that does render hands it the same props and it
// does not render again.
import { memo } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useCreateIndicatorAccess } from '../../components/chart/builder/studio/createIndicatorFlag'
import UIcon from '../../components/ui/UIcon'

export const CREATE_INDICATOR_TOP_BAR_LABEL = 'Create indicator'
export const CREATE_INDICATOR_TOP_BAR_HINT = 'Describe an indicator in plain words and build it on a chart'

function CreateIndicatorTopBarButton({ className, onOpen }) {
  const allowed = useCreateIndicatorAccess(useAuth())
  if (!allowed) return null
  return (
    <button
      type="button"
      className={className}
      data-guide="workspace.createIndicator"
      data-testid="workspace-create-indicator"
      title={CREATE_INDICATOR_TOP_BAR_HINT}
      onClick={onOpen}
    >
      <UIcon name="sparkle" size={12} />{CREATE_INDICATOR_TOP_BAR_LABEL}
    </button>
  )
}

export default memo(CreateIndicatorTopBarButton)
