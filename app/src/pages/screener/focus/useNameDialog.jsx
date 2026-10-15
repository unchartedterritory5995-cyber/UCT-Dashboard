import { useCallback, useState } from 'react'
import NameDialog from './NameDialog'

// Ask for a name and get it back as a promise: a string, or null when cancelled.
// Render `dialog` once in the host.
export function useNameDialog() {
  const [ask, setAsk] = useState(null) // {title, label, initial, submitLabel, resolve}
  const askName = useCallback(opts => new Promise(resolve => setAsk({ ...opts, resolve })), [])
  const dialog = ask && (
    <NameDialog key={ask.title} title={ask.title} label={ask.label} initial={ask.initial || ''} submitLabel={ask.submitLabel} note={ask.note}
      onSubmit={v => { setAsk(null); ask.resolve(v) }} onCancel={() => { setAsk(null); ask.resolve(null) }} />
  )
  return [askName, dialog]
}
