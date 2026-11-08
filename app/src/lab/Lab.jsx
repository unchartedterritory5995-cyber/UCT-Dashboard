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
import Piece11Widget from './pieces/Piece11Widget'
import Piece12Questions from './pieces/Piece12Questions'
import Piece13AnswerV3 from './pieces/Piece13AnswerV3'
import Piece14ReplayV3 from './pieces/Piece14ReplayV3'
import Piece15FinishV3 from './pieces/Piece15FinishV3'
import Piece16LoopWidget from './pieces/Piece16LoopWidget'
import Piece17AnswerV4 from './pieces/Piece17AnswerV4'
import Piece18ReplayV4 from './pieces/Piece18ReplayV4'
import Piece19FinishV4 from './pieces/Piece19FinishV4'
import Piece20Path from './pieces/Piece20Path'
import Piece21LoopDuo from './pieces/Piece21LoopDuo'
import Piece22AnswerV5 from './pieces/Piece22AnswerV5'
import Piece23Story from './pieces/Piece23Story'
import Piece24FinishSeq from './pieces/Piece24FinishSeq'
import Piece25Home from './pieces/Piece25Home'
import Piece26LoopV4 from './pieces/Piece26LoopV4'
import Piece27AnswerV6 from './pieces/Piece27AnswerV6'
import Piece28StoryV2 from './pieces/Piece28StoryV2'
import Piece29FinishBrand from './pieces/Piece29FinishBrand'
import Piece30HomeV2 from './pieces/Piece30HomeV2'
import Piece31LoopV5 from './pieces/Piece31LoopV5'
import Piece32AnswerV7 from './pieces/Piece32AnswerV7'
import Piece33StoryV3 from './pieces/Piece33StoryV3'
import Piece34FinishV3 from './pieces/Piece34FinishV3'
import Piece35HomeV3 from './pieces/Piece35HomeV3'
import Piece36Coach from './pieces/Piece36Coach'
import Piece37HitBuy from './pieces/Piece37HitBuy'
import Piece38DailySet from './pieces/Piece38DailySet'
import Piece39IntroFlow from './pieces/Piece39IntroFlow'
import Piece40Profile from './pieces/Piece40Profile'
import Piece41Blitz from './pieces/Piece41Blitz'
import Piece42Boss from './pieces/Piece42Boss'
import Piece43Hard from './pieces/Piece43Hard'
import Piece44DrawIt from './pieces/Piece44DrawIt'
import Piece45Trap from './pieces/Piece45Trap'
import Piece46LogoLab from './pieces/Piece46LogoLab'
import Piece47BlitzV2 from './pieces/Piece47BlitzV2'
import Piece48BossV2 from './pieces/Piece48BossV2'
import Piece49HardV2 from './pieces/Piece49HardV2'
import Piece50DrawItV2 from './pieces/Piece50DrawItV2'
import Piece51TrapV2 from './pieces/Piece51TrapV2'
import Piece52LogoLab3D from './pieces/Piece52LogoLab3D'
import Piece53BlitzV3 from './pieces/Piece53BlitzV3'
import Piece54BossV3 from './pieces/Piece54BossV3'
import Piece55HardV3 from './pieces/Piece55HardV3'
import Piece56DrawItV3 from './pieces/Piece56DrawItV3'
import Piece57TrapV3 from './pieces/Piece57TrapV3'
import Piece58LogoLadder from './pieces/Piece58LogoLadder'
import Piece59LogoExport from './pieces/Piece59LogoExport'
import Piece60LandingPreview from './pieces/Piece60LandingPreview'
import Piece61ChallengeBlitz from './pieces/Piece61ChallengeBlitz'
import Piece62ChallengeBoss from './pieces/Piece62ChallengeBoss'
import Piece63ChallengeKicker from './pieces/Piece63ChallengeKicker'
import Piece64DailyDrill from './pieces/Piece64DailyDrill'
import Piece65ChallengeHard from './pieces/Piece65ChallengeHard'
import Piece66StatusLineFocus from './pieces/Piece66StatusLineFocus'
import Piece67AnswerFocus from './pieces/Piece67AnswerFocus'
import Piece68EndFocus from './pieces/Piece68EndFocus'
import Piece69StartFocus from './pieces/Piece69StartFocus'
import Piece70StationTrail from './pieces/Piece70StationTrail'
import Piece71DrawIt from './pieces/Piece71DrawIt'
import Piece72PlainRules from './pieces/Piece72PlainRules'

const PIECES = {
  72: Piece72PlainRules,
  71: Piece71DrawIt,
  70: Piece70StationTrail,
  69: Piece69StartFocus,
  68: Piece68EndFocus,
  67: Piece67AnswerFocus,
  66: Piece66StatusLineFocus,
  65: Piece65ChallengeHard,
  64: Piece64DailyDrill,
  63: Piece63ChallengeKicker,
  62: Piece62ChallengeBoss,
  61: Piece61ChallengeBlitz,
  60: Piece60LandingPreview,
  59: Piece59LogoExport,
  58: Piece58LogoLadder,
  52: Piece52LogoLab3D,
  53: Piece53BlitzV3,
  54: Piece54BossV3,
  55: Piece55HardV3,
  56: Piece56DrawItV3,
  57: Piece57TrapV3,
  46: Piece46LogoLab,
  47: Piece47BlitzV2,
  48: Piece48BossV2,
  49: Piece49HardV2,
  50: Piece50DrawItV2,
  51: Piece51TrapV2,
  41: Piece41Blitz,
  42: Piece42Boss,
  43: Piece43Hard,
  44: Piece44DrawIt,
  45: Piece45Trap,
  36: Piece36Coach,
  37: Piece37HitBuy,
  38: Piece38DailySet,
  39: Piece39IntroFlow,
  40: Piece40Profile,
  31: Piece31LoopV5,
  32: Piece32AnswerV7,
  33: Piece33StoryV3,
  34: Piece34FinishV3,
  35: Piece35HomeV3,
  26: Piece26LoopV4,
  27: Piece27AnswerV6,
  28: Piece28StoryV2,
  29: Piece29FinishBrand,
  30: Piece30HomeV2,
  21: Piece21LoopDuo,
  22: Piece22AnswerV5,
  23: Piece23Story,
  24: Piece24FinishSeq,
  25: Piece25Home,
  16: Piece16LoopWidget,
  17: Piece17AnswerV4,
  18: Piece18ReplayV4,
  19: Piece19FinishV4,
  20: Piece20Path,
  11: Piece11Widget,
  12: Piece12Questions,
  13: Piece13AnswerV3,
  14: Piece14ReplayV3,
  15: Piece15FinishV3,
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
