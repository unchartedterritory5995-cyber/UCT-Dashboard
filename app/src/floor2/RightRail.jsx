import LiveActivity from './LiveActivity'
import NeedsAnswer from './NeedsAnswer'

export default function RightRail({ questions, activity, onOpen }) {
  return (
    <aside className="rail">
      <LiveActivity activity={activity} onOpen={onOpen} />
      <NeedsAnswer questions={questions} onOpen={onOpen} />
    </aside>
  )
}
