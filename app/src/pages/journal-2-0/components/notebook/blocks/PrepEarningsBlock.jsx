// The daily prep pack's earnings block (Notebook P2b, Task 10; spec §P2 item 6): which of the member's
// OWN names report today, frozen at capture. `bmo` reports before today's open and `amcTonight` after
// today's close; `amc` reported LAST NIGHT after the close (the engine's three buckets), so it is said
// as last night and never counted as today. An older frozen snapshot may carry no `amcTonight`.
import PrepCapture from './PrepCapture'
import styles from './Blocks.module.css'

const names = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x) : [])

export default function PrepEarningsBlock(props) {
  return (
    <PrepCapture part="earnings" {...props}>
      {(s) => {
        const lines = [
          ['Before the open', names(s.bmo)],
          ['After the close', names(s.amcTonight)],
        ].filter(([, list]) => list.length)
        const lastNight = names(s.amc)
        return (
          <ul className={styles.list} aria-label="Earnings for your names">
            {lines.map(([label, list]) => <li key={label}>{`${label}: ${list.join(', ')}`}</li>)}
            {!lines.length && <li>None of your names report today.</li>}
            {lastNight.length > 0 && <li>{`Reported last night after the close: ${lastNight.join(', ')}`}</li>}
          </ul>
        )
      }}
    </PrepCapture>
  )
}
