// Wave 7 Task 7.4: the template picker is its own chunk, and the catalog it lists loads on demand.
// While either is on its way, the box the picker will fill is held by this skeleton, and the
// template-gallery and style-library tours (both wait for `template-gallery-door`) still find
// their anchor in it.
import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import TemplatePickerSkeleton from './TemplatePickerSkeleton'
import styles from './TemplatePicker.module.css'

describe('TemplatePickerSkeleton', () => {
  it('skeleton_carries_the_tour_anchor', () => {
    const { container } = render(<TemplatePickerSkeleton />)
    const anchor = container.querySelector('[data-tour="template-gallery-door"]')
    expect(anchor).not.toBeNull()
    // the tour engine refuses an anchor under aria-hidden or hidden (tourAnchorVisibility.js anchorFor)
    expect(anchor.closest('[hidden],[aria-hidden="true"]')).toBeNull()
  })

  it('it is the picker\'s own outer box (the same class), held at a height while it loads', () => {
    const { container } = render(<TemplatePickerSkeleton />)
    const box = container.firstElementChild
    expect(styles.wrap).toBeTruthy()
    expect(box.className.split(/\s+/)).toContain(styles.wrap)
    expect(box.className.split(/\s+/)).toContain(styles.skeleton)
  })

  it('it says it is loading, and offers no control that does nothing', () => {
    const { container, getByRole } = render(<TemplatePickerSkeleton />)
    expect(getByRole('status', { name: 'Loading templates' })).toBeTruthy()
    expect(container.querySelectorAll('button, a, input, select, [tabindex]')).toHaveLength(0)
  })
})
