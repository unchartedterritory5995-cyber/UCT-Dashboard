// News (Trade Exchange) registration: dark behind the unreleased gate, bound in the
// workspace, and News & Catalysts (`news`) left exactly as it was.
import { describe, expect, it } from 'vitest'
import {
  WIDGET_REGISTRY, WORKSPACE_MENU_TYPES, WORKSPACE_MENU_TYPES_ALL, labelMap, catalogMeta, WIDGET_CATEGORIES,
} from '../../../widgets/registry'
import { UNRELEASED_CAPTURE_WIDGETS, releasedTypes } from '../../../widgets/captureRelease'
import { WORKSPACE_WIDGETS } from '../WidgetHost'

describe('tradeExchangeNews registration', () => {
  it('is registered as "News" and bound to its component', () => {
    expect(WIDGET_REGISTRY.tradeExchangeNews.labels).toEqual({ header: 'News', menu: 'News', tab: 'News' })
    expect(WORKSPACE_WIDGETS.tradeExchangeNews.component.name).toBe('TradeExchangeNewsWidget')
    expect(catalogMeta('tradeExchangeNews').icon).toBe('wire')
    expect(WIDGET_CATEGORIES.filter((c) => c.items.includes('tradeExchangeNews'))).toHaveLength(1)
  })

  it('is hidden from general menus by the existing unreleased gate', () => {
    expect(UNRELEASED_CAPTURE_WIDGETS).toContain('tradeExchangeNews')
    expect(WORKSPACE_MENU_TYPES_ALL).toContain('tradeExchangeNews')
    expect(releasedTypes(WORKSPACE_MENU_TYPES_ALL, false)).not.toContain('tradeExchangeNews')
    expect(WORKSPACE_MENU_TYPES).not.toContain('tradeExchangeNews')     // default browser
    expect(WIDGET_REGISTRY.tradeExchangeNews.menus.mobile).toBe(false)
  })

  it('leaves News & Catalysts registered, offered and bound exactly as before', () => {
    expect(WIDGET_REGISTRY.news.labels).toEqual({ header: 'News', menu: 'News & Catalysts', tab: 'News' })
    expect(WIDGET_REGISTRY.news.menus).toMatchObject({ workspace: true, tab: true, mobile: false, journal: false })
    expect(WORKSPACE_MENU_TYPES).toContain('news')
    expect(WORKSPACE_WIDGETS.news.component.name).toBe('NewsWidget')
    expect(labelMap('menu').news).toBe('News & Catalysts')
  })
})
