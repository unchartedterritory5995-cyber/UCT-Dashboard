import { useEffect, useState } from 'react'
import { normalizeBars } from '../pages/study/useStudySession'
import styles from './lab.module.css'
import Piece1QuestionCard from './pieces/Piece1QuestionCard'
import Piece2AnswerCard from './pieces/Piece2AnswerCard'
import Piece3Highlights from './pieces/Piece3Highlights'
import Piece4LessonIntro from './pieces/Piece4LessonIntro'
import Piece5Progress from './pieces/Piece5Progress'
import Piece6QuestionV3 from './pieces/Piece6QuestionV3'
import Piece7Flow from './pieces/Piece7Flow'
import Piece8AnswerV2 from './pieces/Piece8AnswerV2'
import Piece9TeachV2 from './pieces/Piece9TeachV2'
import Piece10FinishV2 from './pieces/Piece10FinishV2'

const PIECES = {
  1: Piece1QuestionCard,
  2: Piece2AnswerCard,
  3: Piece3Highlights,
  4: Piece4LessonIntro,
  5: Piece5Progress,
  6: Piece6QuestionV3,
  7: Piece7Flow,
  8: Piece8AnswerV2,
  9: Piece9TeachV2,
  10: Piece10FinishV2,
}

/** The workbench's sample: JBI daily ending 2023-12-14 (the Kicker the owner graded great), from the pod's own bars. */
export function useSample(name = 'JBI_2023-12-14') {
  const [d, setD] = useState(null)
  useEffect(() => {
    let alive = true
    fetch(`/labdata/${name}.json`).then((r) => r.json()).then((j) => {
      if (!alive) return
      setD({ sym: j.sym, asof: j.asof, visible: normalizeBars(j.visible), forward: normalizeBars(j.forward) })
    }).catch(() => alive && setD({ error: true }))
    return () => { alive = false }
  }, [name])
  return d
}

export default function Lab() {
  const n = Number(new URLSearchParams(window.location.search).get('piece') || 1)
  const Piece = PIECES[n] || Piece1QuestionCard
  return (
    <div className={styles.page}>
      <Piece />
    </div>
  )
}
