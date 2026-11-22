// The scan board's two more ways to pick a screen, beside the dropdown (ScreenMenu).
//   ScreenTabs     the member's pinned screens as tabs along the top (one click to switch)
//   ScreenSidebar  every screen, by group, always visible at the left
// Both call the page's own `onApply(spec, item)`, the dropdown's door.
import { GROUPS, groupOf } from '../screenGroups'
import s from './Board.module.css'

const MAX_TABS = 4

function resolve(starters, saved) {
  return [
    ...starters.map(x => ({ ...x, kind: 'starter' })),
    ...saved.map(x => ({ ...x, kind: 'saved' })),
  ]
}

export function ScreenTabs({ starters = [], saved = [], pinned = [], currentId, currentName, isEdited, count, onApply }) {
  const all = resolve(starters, saved)
  let tabs = [...new Set(pinned.map(String))].map(id => all.find(it => String(it.id) === id)).filter(Boolean)
  if (!tabs.length) tabs = starters.filter(x => !x.hidden).slice(0, 4).map(x => ({ ...x, kind: 'starter' }))
  tabs = tabs.slice(0, MAX_TABS)
  const onTab = tabs.some(it => String(it.id) === String(currentId))
  // The open screen is always a tab, so the page never hides what you are looking at.
  if (!onTab && currentName) tabs = [{ id: currentId ?? '__custom', name: currentName, current: true }, ...tabs.slice(0, MAX_TABS - 1)]
  return (
    <div className={s.tabs} role="tablist" aria-label="Pinned screens">
      {tabs.map(it => {
        const on = it.current || String(it.id) === String(currentId)
        return (
          <button key={it.id} type="button" role="tab" aria-selected={on} className={on ? s.tabOn : s.tab}
            onClick={() => { if (!on) onApply(it.spec || { filters: [] }, it) }}>
            <span className={s.tabName}>{it.name}{on && isEdited ? ' (edited)' : ''}</span>
            {on && Number.isFinite(count) && <span className={s.tabCount}>{count.toLocaleString('en-US')}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function ScreenSidebar({ starters = [], saved = [], pinned = [], currentId, onApply }) {
  const all = resolve(starters, saved)
  const pinnedIds = [...new Set(pinned.map(String))]
  const pinnedItems = pinnedIds.map(id => all.find(it => String(it.id) === id)).filter(Boolean)
  const notPinned = it => !pinnedIds.includes(String(it.id))
  const sections = [
    pinnedItems.length ? { key: 'pinned', label: 'Pinned', items: pinnedItems } : null,
    ...GROUPS.map(g => ({ key: g.key, label: g.label, items: starters.filter(x => !x.hidden && groupOf(x) === g.key).map(x => ({ ...x, kind: 'starter' })).filter(notPinned) })),
    saved.length ? { key: 'mine', label: 'My screens', items: saved.map(x => ({ ...x, kind: 'saved' })).filter(notPinned) } : null,
  ].filter(x => x && x.items.length)
  return (
    <nav className={s.side} aria-label="Screens">
      <div className={s.sideTitle}>Screens</div>
      <div className={s.sideScroll}>
        {sections.map(sec => (
          <section key={sec.key} className={s.sideSec}>
            <h3 className={s.sideHead}>{sec.label}</h3>
            {sec.items.map(it => {
              const on = String(it.id) === String(currentId)
              return (
                <button key={`${it.kind}-${it.id}`} type="button" className={on ? s.sideItemOn : s.sideItem} aria-current={on ? 'true' : undefined}
                  title={it.description || undefined} onClick={() => { if (!on) onApply(it.spec || { filters: [] }, it) }}>
                  {it.name}
                </button>
              )
            })}
          </section>
        ))}
      </div>
    </nav>
  )
}
