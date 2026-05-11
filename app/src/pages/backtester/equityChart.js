import { createChart, LineSeries } from 'lightweight-charts'

export function mountEquityChart(container, equityCurve, capital) {
  const chart = createChart(container, {
    layout: { background: { color: '#0e0f0d' }, textColor: '#a8a290' },
    grid: { vertLines: { color: '#1f1d1a' }, horzLines: { color: '#1f1d1a' } },
    timeScale: { timeVisible: true, secondsVisible: false },
    rightPriceScale: { borderColor: '#3a3733' },
    width: container.clientWidth,
    height: 300,
  })

  const equitySeries = chart.addSeries(LineSeries, {
    color: '#4a9eff',
    lineWidth: 2,
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  })
  equitySeries.setData(equityCurve.map(p => ({ time: p.t, value: p.equity })))

  // Horizontal capital baseline
  equitySeries.createPriceLine({
    price: capital,
    color: '#888',
    lineWidth: 1,
    lineStyle: 2, // dashed
    axisLabelVisible: true,
    title: 'Capital',
  })

  // Resize handler
  const resize = () => chart.applyOptions({ width: container.clientWidth })
  window.addEventListener('resize', resize)

  return {
    destroy: () => {
      window.removeEventListener('resize', resize)
      chart.remove()
    },
  }
}
