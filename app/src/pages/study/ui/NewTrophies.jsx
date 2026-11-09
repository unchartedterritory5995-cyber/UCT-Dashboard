// A trophy earned in this set or run (the server's own `badges_new` on an answer), struck on the end screen.
import UIcon from '../../../components/ui/UIcon'
import { TROPHIES } from '../studyBadges'
import t from './newTrophies.module.css'

export default function NewTrophies({ ids = [] }) {
  const list = [...new Set(ids)].map((id) => TROPHIES.find((x) => x.id === id) || { id, name: String(id).replace(/[_-]+/g, ' '), icon: 'star' })
  if (!list.length) return null
  return (
    <div className={t.wrap} data-testid="new-trophies">
      <span className={t.head}>{list.length > 1 ? 'New trophies' : 'New trophy'}</span>
      <div className={t.row}>
        {list.map((x, i) => (
          <span key={x.id} className={t.item} style={{ '--i': i }}>
            <i className={t.coin}><UIcon name={x.icon} size={20} gold={false} /></i>
            <b>{x.name}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
