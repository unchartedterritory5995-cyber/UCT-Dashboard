/**
 * FlowCharts — every recharts-drawing surface Options Flow has, in one lazily
 * loaded chunk.
 *
 * ⛔ WHY THIS FILE EXISTS: recharts WAS A STATIC IMPORT ON THE CRITICAL PATH.
 * `import { BarChart, ... } from "recharts"` sat at the top of OptionsFlow.jsx,
 * so its ~371 KB chunk had to be fetched AND EVALUATED before the module could
 * finish evaluating, before React could render anything at all — for charts that
 * are not on the default tab and that most sessions never open.
 *
 * Measured on prod 2026-09-07, visible transition dashboard -> /options-flow,
 * recorded off DOM mutations with the route chunks already cached:
 *
 *     10 ms   blank content area
 *    992 ms   still blank
 *   1002 ms   the section's own UI finally appears
 *
 * That ~1 s blank is module evaluation, not download and not the network — the
 * flow requests do not even start until 1,002 ms. UCT20, measured with the same
 * instrument, is blank for 480 ms and imports no chart library.
 *
 * ⛔ NOT A SECOND AUTHORITY ON ANY NUMBER. These components receive their data
 * and their formatters as props; they compute nothing. Moving them changed the
 * chunk they live in, never what they draw.
 */

import {
  BarChart, Bar, ComposedChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import { P } from './flowCompute'

/** Horizontal net-flow bars (Market Read "top names" panels). */
export function NC({ data, fill, dir, onBarClick, fmt }) {
  const neg = dir === 'bear'
  const cd = data.map((d) => ({ ...d, v: neg ? -Math.abs(d.n) : d.n }))
  return (
    <div style={{ height: 220 }}>
      <ResponsiveContainer>
        <BarChart data={cd} layout="vertical" margin={{ top: 0, right: 8, left: 5, bottom: 0 }}
          onClick={onBarClick ? (e) => { if (e && e.activePayload && e.activePayload[0]) { onBarClick(e.activePayload[0].payload) } } : undefined}>
          <CartesianGrid strokeDasharray="3 3" stroke={P.bd} horizontal={false} />
          <XAxis type="number" tick={{ fill: P.mt, fontSize: 10 }} tickFormatter={(v) => fmt(Math.abs(v))} />
          <YAxis dataKey="s" type="category" tick={{ fill: P.tx, fontSize: 11, fontWeight: 700 }} width={60} interval={0} tickLine={false} axisLine={false} />
          <Bar dataKey="v" fill={fill} radius={neg ? [4, 0, 0, 4] : [0, 4, 4, 0]} barSize={14} cursor={onBarClick ? 'pointer' : 'default'} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Volume / OI bars + contract-price line, in the contract detail panel. */
export function ContractHistoryChart({ trimmed, fK }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={trimmed} margin={{ top: 4, right: 4, left: -8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2540" />
        <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#7b8fa3' }}
          interval={trimmed.length > 15 ? 'preserveStartEnd' : trimmed.length > 10 ? 1 : 0}
          angle={-45} textAnchor="end" height={32}
          tickFormatter={(v) => (v === 'Now' ? 'Now' : v.split('/').slice(0, 2).join('/'))} />
        <YAxis yAxisId="price" orientation="left" tick={{ fontSize: 10, fill: '#dcbb5e' }}
          tickFormatter={(v) => '$' + v.toFixed(1)} width={36} domain={[(dm) => Math.max(0, dm * 0.8), (dm) => dm * 1.1]} />
        <YAxis yAxisId="voloi" orientation="right" tick={{ fontSize: 10, fill: '#7b8fa3' }}
          tickFormatter={(v) => fK(v)} width={42} />
        <Tooltip contentStyle={{ background: P.cd, border: '1px solid ' + P.bl + '', borderRadius: 6, fontSize: 10, padding: '6px 10px' }}
          formatter={(val, name) => { if (name === 'price') return ['$' + val.toFixed(2), 'Price'] ; if (name === 'vol') return [fK(val), 'Volume'] ; return [val.toLocaleString(), 'OI'] }}
          labelFormatter={(v) => (v === 'Now' ? 'Live' : v.split('/').slice(0, 2).join('/'))} />
        <Bar yAxisId="voloi" dataKey="vol" fill="#ff6d00" opacity={0.8} radius={[1, 1, 0, 0]} barSize={trimmed.length > 15 ? 4 : 6} />
        <Bar yAxisId="voloi" dataKey="oi" fill="#6ba3be" opacity={0.7} radius={[1, 1, 0, 0]} barSize={trimmed.length > 15 ? 4 : 6} />
        <Line yAxisId="price" dataKey="price" type="monotone" stroke="#dcbb5e" strokeWidth={2} strokeOpacity={0.5}
          dot={{ r: 4, fill: '#dcbb5e', stroke: '#17181b', strokeWidth: 1.5 }} connectNulls />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** GEX by strike, on the GEX tab. */
export function GexStrikesChart({ visibleStrikes, gexData, fmtGex }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={visibleStrikes} layout="vertical" margin={{ top: 4, right: 20, left: 20, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1a2540" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#7b8fa3' }} tickFormatter={(v) => fmtGex(v)} />
        <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: '#7b8fa3' }} width={60} reversed />
        <Tooltip contentStyle={{ background: P.cd, border: '1px solid ' + P.bl + '', borderRadius: 6, fontSize: 11 }}
          formatter={(val, name) => [fmtGex(val), name === 'callGex' ? 'Call GEX' : name === 'putGex' ? 'Put GEX' : 'Net GEX']} />
        <ReferenceLine x={0} stroke="#7b8fa3" strokeWidth={1} />
        {gexData.zeroGamma && <ReferenceLine y={'$' + Math.round(gexData.zeroGamma)} stroke={P.ac} strokeDasharray="3 3" label={{ value: '0γ', position: 'right', fill: P.ac, fontSize: 10 }} />}
        {gexData.spot && <ReferenceLine y={'$' + Math.round(gexData.spot)} stroke={P.wh} strokeWidth={2} label={{ value: 'Spot', position: 'right', fill: P.wh, fontSize: 10, fontWeight: 700 }} />}
        <Bar dataKey="callGex" fill={P.bu} opacity={0.85} />
        <Bar dataKey="putGex" fill={P.be} opacity={0.85} />
      </BarChart>
    </ResponsiveContainer>
  )
}
