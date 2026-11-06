// THE CHART'S FRAME: the member's own Charts-tab widget (round 18; owner, batch 18, on the Hard chart: "It should look
// like the users chart widget from the charts tab. Should have our logo"). The frame, the identity row and the
// timeframe bar are the workspace's OWN classes and its own ChartTfBar (ChartsWorkspace.module.css; ChartPane's
// pieces), so a change there changes this too. Only the symbol slot is Study's: a masked badge while the ticker is
// hidden, then the ticker with its logo the way the widget's badge shows it. The brand mark rides in the header, and
// the canvas keeps the widget's own bottom-left compass (StockChart showBrandMark). The timeframes are shown and
// LOCKED: a bank chart is one daily window, and a control that cannot act is not offered as one.
import { useState } from 'react'
import ws from '../../charts/ChartsWorkspace.module.css'
import ChartTfBar from '../../../components/chart/pane/ChartTfBar'
import UIcon from '../../../components/ui/UIcon'
import usePreferences from '../../../hooks/usePreferences'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import s from './study.module.css'

// The widget's eight timeframe buttons (ChartWidget's TF bar), codes as StockChart knows them.
const WIDGET_TFS = [['1', '1m'], ['5', '5m'], ['15', '15m'], ['30', '30m'], ['60', '1h'], ['D', '1D'], ['W', '1W'], ['M', '1M']]

export default function StudyChartFrame({ masked = true, symbol = null, name = null, tf = 'D', right = null, stamp = null, children }) {
  const { prefs } = usePreferences(true)
  const [logoOk, setLogoOk] = useState(true)
  const show = !masked && !!symbol
  return (
    <div className={`${ws.widget} ${s.frame}`} data-charts-theme={prefs?.charts_theme || 'default'} data-testid="study-chart-frame" data-masked={show ? '0' : '1'}>
      <div className={ws.chartHeaderTop}>
        <div className={ws.symbolSlot}>
          {show ? (
            <span className={`${s.symBadge} ${s.reveal}`} data-testid="sym-label">
              {logoOk ? <img className={s.symLogo} src={`/api/ticker-logo/${encodeURIComponent(symbol)}`} alt="" onError={() => setLogoOk(false)} /> : null}
              {symbol}
            </span>
          ) : (
            <span className={`${s.symBadge} ${s.masked}`} data-testid="sym-label" aria-label="ticker hidden"><UIcon name="lock" size={13} gold={false} />••••</span>
          )}
        </div>
        {show && name ? <span className={s.symName}>{name}</span> : null}
        <div className={ws.headerTopRight}>
          {right}
          <span className={s.frameBrand} aria-label="UCT Intelligence"><img src={brandMark} alt="" /><span>UCT Intelligence</span></span>
        </div>
      </div>
      <div className={s.tfLocked} aria-hidden="true">
        <ChartTfBar tf={tf} visibleTfs={WIDGET_TFS} onTf={() => {}} showMenu={false} styles={ws} />
      </div>
      <div className={`${ws.chartFill} ${s.frameBody}`}>
        {stamp}
        {children}
      </div>
    </div>
  )
}
