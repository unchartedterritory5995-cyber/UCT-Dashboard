// News (Trade Exchange) registration: offered to every member's add menus (released
// to all signed-in users), bound in the workspace, and News & Catalysts (`news`) left
// exactly as it was.
import { describe, expect, it } from 'vitest'
import {
  WIDGET_REGISTRY, WORKSPACE_MENU_TYPES, WORKSPACE_MENU_TYPES_ALL, TAB_MENU_TYPES, MOBILE_MENU_TYPES,
  JOURNAL_MENU_TYPES, labelMap, catalogMeta, WIDGET_CATEGORIES, menuGroups,
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

  // ⛔ REGRESSION (2026-10-30): released to every signed-in user by #532, it was still
  // listed in the Wave R capture gate, which strips a widget from EVERY member's menus
  // unless that browser opted into capture -- so members never saw it.
  it('is offered in the workspace and add-tab menus of every browser, opted in or not', () => {
    expect(UNRELEASED_CAPTURE_WIDGETS).not.toContain('tradeExchangeNews')
    expect(releasedTypes(WORKSPACE_MENU_TYPES_ALL, false)).toContain('tradeExchangeNews')
    expect(releasedTypes(WORKSPACE_MENU_TYPES_ALL, true)).toContain('tradeExchangeNews')
    expect(WORKSPACE_MENU_TYPES).toContain('tradeExchangeNews')         // default browser
    expect(TAB_MENU_TYPES).toContain('tradeExchangeNews')
    const research = menuGroups('workspace').find((g) => g.key === 'research')
    expect(research.items).toEqual(expect.arrayContaining(['news', 'tradeExchangeNews']))
    // Still no phone sheet and no Notebook capture.
    expect(MOBILE_MENU_TYPES).not.toContain('tradeExchangeNews')
    expect(JOURNAL_MENU_TYPES).not.toContain('tradeExchangeNews')
  })

  it('leaves News & Catalysts registered, offered and bound exactly as before', () => {
    expect(WIDGET_REGISTRY.news.labels).toEqual({ header: 'News', menu: 'News & Catalysts', tab: 'News' })
    expect(WIDGET_REGISTRY.news.menus).toMatchObject({ workspace: true, tab: true, mobile: false, journal: false })
    expect(WORKSPACE_MENU_TYPES).toContain('news')
    expect(WORKSPACE_WIDGETS.news.component.name).toBe('NewsWidget')
    expect(labelMap('menu').news).toBe('News & Catalysts')
  })
})
