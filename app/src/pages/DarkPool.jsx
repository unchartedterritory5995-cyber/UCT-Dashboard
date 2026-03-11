import { useState, useMemo, useRef, useEffect } from "react";

// ── Built-in CSV parser (no external dependencies) ───────────────────────────
function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === "," && !inQuotes) { result.push(current.trim().replace(/^"|"$/g, "")); current = ""; }
    else { current += line[i]; }
  }
  result.push(current.trim().replace(/^"|"$/g, ""));
  return result;
}
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  return lines.slice(1).map(line => {
    const cols = parseCSVLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = (cols[i] || "").trim(); });
    return row;
  }).filter(r => Object.values(r).some(v => v));
}

// ── colours ─────────────────────────────────────────────────────────────────
const C = {
  bg:"#0b1120", bg2:"#111a2e", bg3:"#0f1729", bg4:"#111d33", bgH:"#162240",
  bdr:"#1b2a45", bdr2:"#243352",
  tx:"#e8ecf4", tx2:"#7a8ba8", tx3:"#4a5d7a",
  blue:"#4e9fff", green:"#2dd4a0", red:"#ff5c72", amber:"#ffb347",
  cyan:"#22d3ee", purple:"#a78bfa", pink:"#f472b6", orange:"#fb923c",
};
const CAT_COLORS = {
  "Indexes":"#4e9fff","Large Cap":"#a78bfa","Mid Cap":"#ffb347","Small Cap":"#ff5c72",
  "Sector ETFs":"#2dd4a0","Bond ETFs":"#22d3ee","Intl/EM ETFs":"#f472b6","Commodity ETFs":"#fb923c"
};

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(n){
  if(n>=1e9) return "$"+(n/1e9).toFixed(2)+"B";
  if(n>=1e6) return "$"+(n/1e6).toFixed(1)+"M";
  if(n>=1e3) return "$"+(n/1e3).toFixed(0)+"K";
  return "$"+n;
}
function fP(p){ return p!=null?"$"+p.toFixed(2):"—"; }
function zC(p,lo,hi){ return p>hi?C.green:p<lo?C.red:"#c8d4e4"; }
function pctFmt(p){ return p===0?"IN":(p>0?"+":"")+p.toFixed(2)+"%"; }

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({it, w=140, h=36}){
  const P=4;
  const pts = it.prices.map((p,i)=>({p,w:it.w[i]})).filter(x=>x.p!=null);
  if(pts.length<2) return <span style={{color:C.tx3,fontSize:10}}>–</span>;
  const allP = pts.map(x=>x.p);
  const mn=Math.min(...allP), mx=Math.max(...allP);
  const rng=mx-mn||1;
  const y=p=>h-P-2-((p-mn)/rng)*(h-P*2-4);
  const x=i=>(P+(i/(pts.length-1||1))*(w-P*2));
  const lo=it.lo, hi=it.hi;
  const zoneY1=y(hi), zoneY2=y(lo);
  const polyline = pts.map((pt,i)=>x(i)+","+y(pt.p)).join(" ");
  const lastP=pts[pts.length-1].p;
  const lineColor=lastP>hi?C.green:lastP<lo?C.red:"#8899aa";

  // Big print level — clamp to visible range
  const bp = it.bigPrint;
  const bpInRange = bp!=null && bp>=mn && bp<=mx;
  const bpY = bp!=null ? Math.max(P, Math.min(h-P, y(bp))) : null;
  // Zone thickness scales with notional weight (bigger print = thicker zone)
  const bpThick = it.bigPrintN && it.n ? Math.max(2, Math.min(6, (it.bigPrintN/it.n)*20)) : 3;

  return (
    <svg width={w} height={h} style={{display:"block"}}>
      {/* DP zone band */}
      <rect x={P} y={zoneY1} width={w-P*2} height={Math.max(0,zoneY2-zoneY1)}
        fill="#22d3ee11" stroke="none"/>
      <line x1={P} y1={y(lo)} x2={w-P} y2={y(lo)} stroke="#22d3ee33" strokeWidth={0.5}/>
      <line x1={P} y1={y(hi)} x2={w-P} y2={y(hi)} stroke="#22d3ee33" strokeWidth={0.5}/>

      {/* Largest print level — amber zone */}
      {bpY!=null && (
        <>
          {/* Thick zone band */}
          <rect x={P} y={bpY - bpThick/2} width={w-P*2} height={bpThick}
            fill="#ffb34733" stroke="none" rx={1}/>
          {/* Center line */}
          <line x1={P} y1={bpY} x2={w-P} y2={bpY}
            stroke="#ffb347" strokeWidth={1.5} strokeDasharray="3,2" opacity={0.9}/>
          {/* Left anchor tick */}
          <line x1={P} y1={bpY-4} x2={P} y2={bpY+4}
            stroke="#ffb347" strokeWidth={2} opacity={0.9}/>
        </>
      )}

      {/* Price line */}
      <polyline points={polyline} fill="none" stroke={lineColor} strokeWidth={1.2}/>
      {pts.map((pt,i)=>{
        const wt=pt.w||0;
        const r=Math.max(1.2, wt*3.5);
        const clr=zC(pt.p,lo,hi);
        const a=(0.15+wt*0.65).toFixed(2);
        const fill=lastP>hi?`rgba(45,212,160,${a})`:lastP<lo?`rgba(255,92,114,${a})`:`rgba(200,212,228,${a})`;
        return <circle key={i} cx={x(i)} cy={y(pt.p)} r={r} fill={fill}/>;
      })}
    </svg>
  );
}

// ── Tooltip wrapper ───────────────────────────────────────────────────────────
function TickerCell({it, catColor}){
  const [show,setShow]=useState(false);
  return (
    <div style={{position:"relative",display:"inline-block"}}
      onMouseEnter={()=>setShow(true)} onMouseLeave={()=>setShow(false)}>
      <span style={{color:catColor||C.tx,fontWeight:700,fontFamily:"JetBrains Mono, monospace",
        fontSize:13,cursor:"default"}}>
        ${it.t}
      </span>
      {it.u && <span style={{marginLeft:4,fontSize:9,color:C.amber,background:C.amber+"18",
        padding:"1px 4px",borderRadius:4,fontWeight:700}}>UOA</span>}
      {show && it.top5 && (
        <div style={{position:"absolute",left:0,top:"100%",zIndex:50,
          background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,
          padding:"8px 10px",minWidth:220,boxShadow:"0 4px 20px #00000066",marginTop:2}}>
          <div style={{color:C.tx2,fontSize:10,fontWeight:700,marginBottom:6,
            borderBottom:`1px solid ${C.bdr}`,paddingBottom:4}}>
            ${it.t} Top Blocks ({it.c} total)
          </div>
          {it.top5.map((r,i)=>(
            <div key={i} style={{color:C.tx,fontSize:11,fontFamily:"JetBrains Mono, monospace",
              padding:"2px 0"}}>{r}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Zone display ──────────────────────────────────────────────────────────────
function ZoneCell({it}){
  const pos=it.pos;
  const color=pos==="above"?C.green:pos==="below"?C.red:"#8899aa";
  const pct=pos==="in"?"IN ZONE":(pos==="above"?"+":"")+it.pct.toFixed(2)+"%";
  return (
    <span style={{color,fontWeight:700,fontFamily:"JetBrains Mono, monospace",fontSize:13}}>
      {pct}
    </span>
  );
}

// ── Category pill ─────────────────────────────────────────────────────────────
function CatPill({cat}){
  const color=CAT_COLORS[cat]||C.tx2;
  return (
    <span style={{fontSize:10,padding:"2px 8px",borderRadius:10,
      background:color+"18",color,fontWeight:600}}>
      {cat}
    </span>
  );
}

// ── Flow table ────────────────────────────────────────────────────────────────
const TH = ({children,style={}}) => (
  <th style={{padding:"8px 10px",textAlign:"left",fontSize:11,
    color:"#4a5d7a",fontWeight:600,borderBottom:"1px solid #1b2a45",
    position:"sticky",top:0,background:"#0f1729",whiteSpace:"nowrap",...style}}>
    {children}
  </th>
);
const TD = ({children,style={}}) => (
  <td style={{padding:"7px 10px",borderBottom:"1px solid #1b2a4533",
    verticalAlign:"middle",...style}}>
    {children}
  </td>
);

// ── Module-level data ref (set when CSV loads) ─────────────────────────────
let D = null;

function FlowTable({items, showCat=true}){
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
        <thead>
          <tr>
            <TH>Ticker</TH>
            {showCat && <TH>Category</TH>}
            <TH>Last</TH>
            <TH>Big Print</TH>
            <TH>% Move</TH>
            <TH>Notional</TH>
            <TH>Trades</TH>
            <TH>Days</TH>
            <TH>30-Day</TH>
          </tr>
        </thead>
        <tbody>
          {items.map(it=>{
            const cc=CAT_COLORS[it.cat]||C.tx;
            const bpPct = it.bigPrint>0 ? ((it.last-it.bigPrint)/it.bigPrint*100) : null;
            const bpMoveColor = bpPct==null ? C.tx3 : bpPct>0 ? C.green : bpPct<0 ? C.red : C.tx3;
            return (
              <tr key={it.t+it.cat} style={{background:"transparent"}}
                onMouseEnter={e=>e.currentTarget.style.background=C.bgH}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <TD><TickerCell it={it} catColor={cc}/></TD>
                {showCat && <TD><CatPill cat={it.cat}/></TD>}
                <TD style={{fontFamily:"JetBrains Mono, monospace",color:zC(it.last,it.lo,it.hi)}}>
                  {fP(it.last)}
                </TD>
                <TD style={{fontFamily:"JetBrains Mono, monospace",fontSize:11}}>
                  {(()=>{
                    const [bpHover,setBpHover]=useState(false);
                    const tip = it.bigPrintN ? [
                      it.bigPrintDate,
                      fmt(it.bigPrintN),
                      it.bigPrintPctAvgVol>0 ? it.bigPrintPctAvgVol.toFixed(1)+"% of avg vol" : it.avg30>0 ? ((it.bigPrintN/it.avg30)*100).toFixed(1)+"% of avg vol" : null
                    ].filter(Boolean).join(" · ") : null;
                    return (
                      <div style={{position:"relative",display:"inline-block"}}
                        onMouseEnter={()=>setBpHover(true)} onMouseLeave={()=>setBpHover(false)}>
                        <span style={{color:C.amber,fontWeight:700,cursor:"default"}}>
                          {fP(it.bigPrint)}
                        </span>
                        {bpHover && tip && (
                          <div style={{position:"absolute",left:0,top:"100%",zIndex:50,
                            background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,
                            padding:"7px 11px",whiteSpace:"nowrap",boxShadow:"0 4px 20px #00000066",
                            marginTop:4,color:C.tx,fontSize:13,fontFamily:"JetBrains Mono, monospace",
                            fontWeight:500,letterSpacing:"0.01em"}}>
                            {tip}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </TD>
                <TD style={{fontFamily:"JetBrains Mono, monospace",fontWeight:700,
                  color:bpMoveColor}}>
                  {bpPct==null ? "—" : (bpPct>0?"+":"")+bpPct.toFixed(2)+"%"}
                </TD>
                <TD style={{fontFamily:"JetBrains Mono, monospace",color:C.cyan,fontWeight:600}}>
                  {fmt(it.n)}
                </TD>
                <TD style={{color:C.tx2,fontFamily:"JetBrains Mono, monospace"}}>{it.c}</TD>
                <TD style={{color:C.tx3,fontFamily:"JetBrains Mono, monospace"}}>{it.days}</TD>
                <TD><Sparkline it={it}/></TD>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Overview stat card ────────────────────────────────────────────────────────
function StatCard({label, value, sub, color}){
  return (
    <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,
      padding:"14px 18px",minWidth:140}}>
      <div style={{fontSize:11,color:C.tx3,marginBottom:4,textTransform:"uppercase",
        letterSpacing:"0.06em"}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color:color||C.tx,fontFamily:"JetBrains Mono, monospace"}}>
        {value}
      </div>
      {sub && <div style={{fontSize:11,color:C.tx2,marginTop:3}}>{sub}</div>}
    </div>
  );
}

// ── Overview tab ─────────────────────────────────────────────────────────────
function OverviewPane(){
  const sectionLabel = txt => (
    <div style={{fontSize:10,fontWeight:700,letterSpacing:"0.12em",color:C.tx3,
      textTransform:"uppercase",marginBottom:10}}>{txt}</div>
  );

  function MiniRow({item, dir}){
    const color = dir==="above" ? C.green : C.red;
    const [bpHover,setBpHover]=useState(false);
    const bpPct = item.bigPrint>0 ? ((item.last-item.bigPrint)/item.bigPrint*100) : null;
    const bpMoveColor = bpPct==null ? C.tx3 : bpPct>0 ? C.green : bpPct<0 ? C.red : C.tx3;
    const tip = item.bigPrintN ? [
      item.bigPrintDate,
      fmt(item.bigPrintN),
      item.bigPrintPctAvgVol>0 ? item.bigPrintPctAvgVol.toFixed(1)+"% of avg vol" : null
    ].filter(Boolean).join(" · ") : null;
    return (
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",
        padding:"6px 0",borderBottom:`1px solid ${C.bdr}`}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontFamily:"JetBrains Mono, monospace",fontWeight:700,
            fontSize:12,color:C.tx,minWidth:52}}>{item.t}</span>
          <span style={{fontSize:10,color:C.tx3}}>
            Zone {fP(item.lo)}–{fP(item.hi)}
          </span>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <span style={{fontFamily:"JetBrains Mono, monospace",fontSize:11,color:C.tx2}}>
            {fP(item.last)}
          </span>
          {/* Big Print level */}
          <div style={{position:"relative",display:"inline-block"}}
            onMouseEnter={()=>setBpHover(true)} onMouseLeave={()=>setBpHover(false)}>
            <span style={{fontFamily:"JetBrains Mono, monospace",fontSize:11,color:C.amber,
              fontWeight:700,minWidth:68,display:"inline-block",textAlign:"right",cursor:"default"}}>
              {fP(item.bigPrint)}
            </span>
            {bpHover && tip && (
              <div style={{position:"absolute",right:0,top:"100%",zIndex:50,
                background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,
                padding:"7px 11px",whiteSpace:"nowrap",boxShadow:"0 4px 20px #00000066",
                marginTop:4,color:C.tx,fontSize:13,fontFamily:"JetBrains Mono, monospace",
                fontWeight:500,letterSpacing:"0.01em"}}>
                {tip}
              </div>
            )}
          </div>
          {/* % move since big print */}
          <span style={{fontFamily:"JetBrains Mono, monospace",fontSize:12,
            fontWeight:700,color:bpMoveColor,minWidth:60,textAlign:"right"}}>
            {bpPct==null ? "—" : (bpPct>0?"+":"")+bpPct.toFixed(2)+"%"}
          </span>
          <span style={{fontSize:10,color:C.tx3,minWidth:36,textAlign:"right"}}>
            {fmt(item.n)}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>

      {/* Above zone */}
      <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"16px 18px"}}>
        {sectionLabel(`▲ Above Zone — Top ${Math.min(8,D.above.length)}`)}
        <div style={{display:"flex",justifyContent:"space-between",padding:"0 0 6px 0",
          borderBottom:`1px solid ${C.bdr2}`,marginBottom:2}}>
          <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:52}}>Ticker</span>
          <div style={{display:"flex",gap:12,alignItems:"center"}}>
            <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:48,textAlign:"right"}}>Last</span>
            <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:68,textAlign:"right"}}>Big Print</span>
            <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:60,textAlign:"right"}}>% Move</span>
            <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:36,textAlign:"right"}}>Flow</span>
          </div>
        </div>
        {D.above.slice(0,8).map(item=>(
          <MiniRow key={item.t} item={item} dir="above"/>
        ))}
        {D.above.length===0 && <div style={{fontSize:12,color:C.tx3}}>None</div>}
      </div>

      {/* Below zone */}
      <div style={{background:C.bg2,border:`1px solid ${C.bdr}`,borderRadius:8,padding:"16px 18px"}}>
        {sectionLabel(`▼ Below Zone — Top ${Math.min(8,D.below.length)}`)}
        <div style={{display:"flex",justifyContent:"space-between",padding:"0 0 6px 0",
          borderBottom:`1px solid ${C.bdr2}`,marginBottom:2}}>
          <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:52}}>Ticker</span>
          <div style={{display:"flex",gap:12,alignItems:"center"}}>
            <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:48,textAlign:"right"}}>Last</span>
            <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:68,textAlign:"right"}}>Big Print</span>
            <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:60,textAlign:"right"}}>% Move</span>
            <span style={{fontSize:10,color:C.tx3,fontWeight:600,minWidth:36,textAlign:"right"}}>Flow</span>
          </div>
        </div>
        {D.below.slice(0,8).map(item=>(
          <MiniRow key={item.t} item={item} dir="below"/>
        ))}
        {D.below.length===0 && <div style={{fontSize:12,color:C.tx3}}>None</div>}
      </div>

    </div>
  );
}

// ── Category tab ─────────────────────────────────────────────────────────────
function CategoryPane(){
  const [active,setActive]=useState(D.categories[0].name);
  const cat=D.categories.find(c=>c.name===active)||D.categories[0];
  const color=CAT_COLORS[active]||C.tx;
  return (
    <div>
      {/* Sub-tabs */}
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
        {D.categories.map(c=>{
          const cc=CAT_COLORS[c.name]||C.tx;
          const isOn=c.name===active;
          return (
            <button key={c.name} onClick={()=>setActive(c.name)}
              style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${cc}${isOn?"":"33"}`,
                background:isOn?cc+"22":"transparent",color:isOn?cc:C.tx2,
                fontWeight:isOn?700:400,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>
              {c.name}
            </button>
          );
        })}
      </div>
      {/* Category info */}
      <div style={{marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color,marginBottom:4}}>{cat.name}</div>
        <div style={{fontSize:12,color:C.tx2}}>{cat.desc}</div>
        <div style={{fontSize:12,color:C.tx3,marginTop:2}}>
          Total: <span style={{color:C.cyan,fontWeight:700}}>{fmt(cat.totalNotional)}</span>
          {" · "}{cat.count} tickers
        </div>
      </div>
      <FlowTable items={cat.items} showCat={false}/>
    </div>
  );
}

// ── Above / Below tabs ───────────────────────────────────────────────────────
function AbovePane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.green,marginBottom:4}}>
          ▲ Trading Above Dark Pool Zone <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.above.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3,lineHeight:1.5}}>
          Closed <b style={{color:C.green}}>above</b> the 25th–75th percentile institutional execution range.
          Sorted by % distance above zone. Bullish momentum signal.
        </div>
      </div>
      <FlowTable items={[...D.above].sort((a,b)=>b.pct-a.pct)}/>
    </div>
  );
}

function BelowPane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.red,marginBottom:4}}>
          ▼ Trading Below Dark Pool Zone <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.below.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3,lineHeight:1.5}}>
          Closed <b style={{color:C.red}}>below</b> the institutional execution range.
          Sorted by % distance below zone. Bearish pressure signal.
        </div>
      </div>
      <FlowTable items={[...D.below].sort((a,b)=>a.pct-b.pct)}/>
    </div>
  );
}

// ── Unusual Flow tab ─────────────────────────────────────────────────────────
function UnusualPane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.amber,marginBottom:4}}>
          Unusual Flow Activity <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.unusual.length} tickers)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3}}>
          Tickers with UOA flag — unusual options/dark pool activity relative to historical norms.
        </div>
      </div>
      <FlowTable items={D.unusual}/>
    </div>
  );
}

// ── Phantom Prints tab ───────────────────────────────────────────────────────
function PhantomPane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.purple,marginBottom:4}}>
          Phantom Prints <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.phantom.length} entries)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3}}>
          Dark pool prints where the execution price deviated significantly from the concurrent spot price.
          May indicate delayed reporting or unusual block structures.
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              <TH>Ticker</TH>
              <TH>Date</TH>
              <TH>DP Price</TH>
              <TH>Spot Price</TH>
              <TH>Deviation</TH>
              <TH>Volume</TH>
            </tr>
          </thead>
          <tbody>
            {D.phantom.map((p,i)=>{
              const dev=((p.dpPrice-p.spotPrice)/p.spotPrice*100);
              const devColor=dev>0?C.green:C.red;
              return (
                <tr key={i} style={{background:"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.bgH}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <TD><span style={{color:C.blue,fontWeight:700,fontFamily:"JetBrains Mono, monospace"}}>
                    ${p.ticker}</span></TD>
                  <TD style={{color:C.tx2,fontFamily:"JetBrains Mono, monospace"}}>{p.date}</TD>
                  <TD style={{fontFamily:"JetBrains Mono, monospace",color:C.tx}}>
                    {fP(p.dpPrice)}</TD>
                  <TD style={{fontFamily:"JetBrains Mono, monospace",color:C.tx2}}>
                    {fP(p.spotPrice)}</TD>
                  <TD style={{fontFamily:"JetBrains Mono, monospace",color:devColor,fontWeight:700}}>
                    {dev>0?"+":""}{dev.toFixed(2)}%</TD>
                  <TD style={{color:C.tx3,fontFamily:"JetBrains Mono, monospace"}}>
                    {p.volume||"—"}</TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Options Flow tab ─────────────────────────────────────────────────────────
function OptionsPane(){
  return (
    <div>
      <div style={{marginBottom:14}}>
        <div style={{fontSize:15,fontWeight:700,color:C.pink,marginBottom:4}}>
          Options Flow <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.options.length} alerts)</span>
        </div>
        <div style={{fontSize:12,color:C.tx3}}>
          Notable options activity flagged alongside dark pool data. Repeater, Roulette, Large, and Steady flow types.
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead>
            <tr>
              <TH>Date</TH>
              <TH>Ticker</TH>
              <TH>Price</TH>
              <TH>Alert</TH>
              <TH>Direction</TH>
            </tr>
          </thead>
          <tbody>
            {D.options.map((o,i)=>{
              const isBull=o.message.includes("Bullish");
              const isBear=o.message.includes("Bearish");
              const dirColor=isBull?C.green:isBear?C.red:C.tx2;
              const dir=isBull?"BULL":isBear?"BEAR":"NEUTRAL";
              return (
                <tr key={i} style={{background:"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.bgH}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <TD style={{color:C.tx3,fontFamily:"JetBrains Mono, monospace"}}>{o.date}</TD>
                  <TD><span style={{color:C.pink,fontWeight:700,fontFamily:"JetBrains Mono, monospace"}}>
                    ${o.ticker}</span></TD>
                  <TD style={{fontFamily:"JetBrains Mono, monospace",color:C.tx2}}>{fP(o.price)}</TD>
                  <TD style={{color:C.tx,fontSize:11,maxWidth:380}}>{o.message}</TD>
                  <TD><span style={{color:dirColor,fontWeight:700,fontSize:11,
                    background:dirColor+"18",padding:"2px 8px",borderRadius:10}}>{dir}</span></TD>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Signals + Search tab ─────────────────────────────────────────────────────
function SignalsPane(){
  const [query,setQuery]=useState("");
  const allItems = useMemo(()=>{
    const map={};
    for(const cat of D.categories) for(const it of cat.items) map[it.t]=it;
    for(const it of D.above) map[it.t]=it;
    for(const it of D.below) map[it.t]=it;
    for(const it of D.unusual) map[it.t]=it;
    return Object.values(map);
  },[]);
  const results = useMemo(()=>{
    if(!query||query.length<1) return [];
    const q=query.toUpperCase().replace(/\$|\s/g,"");
    return allItems.filter(it=>it.t.includes(q)).slice(0,30);
  },[query,allItems]);

  return (
    <div>
      {/* Alpha signals */}
      <div style={{marginBottom:20}}>
        <div style={{fontSize:15,fontWeight:700,color:C.cyan,marginBottom:10}}>
          Alpha Signals <span style={{fontSize:13,fontWeight:400,color:C.tx2}}>({D.alpha.length})</span>
        </div>
        <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
          {D.alpha.map((a,i)=>(
            <div key={i} style={{background:C.bg2,border:`1px solid ${C.bdr2}`,borderRadius:6,
              padding:"8px 12px",display:"flex",gap:10,alignItems:"center"}}>
              <span style={{color:C.cyan,fontWeight:700,fontFamily:"JetBrains Mono, monospace"}}>
                ${a.ticker}</span>
              <span style={{fontFamily:"JetBrains Mono, monospace",color:C.tx2,fontSize:11}}>
                {fP(a.price)}</span>
              <span style={{color:C.tx3,fontSize:11}}>{a.date}</span>
            </div>
          ))}
        </div>

        {/* Cancelled */}
        <div style={{fontSize:14,fontWeight:700,color:C.red,marginBottom:8}}>
          Cancelled Blocks <span style={{fontSize:12,fontWeight:400,color:C.tx2}}>({D.cancelled.length})</span>
        </div>
        <div style={{overflowX:"auto",marginBottom:20}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr>
                <TH>Date</TH><TH>Ticker</TH><TH>Price</TH><TH>Notional</TH><TH>Note</TH>
              </tr>
            </thead>
            <tbody>
              {D.cancelled.map((c,i)=>(
                <tr key={i} style={{background:"transparent"}}
                  onMouseEnter={e=>e.currentTarget.style.background=C.bgH}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <TD style={{color:C.tx3,fontFamily:"JetBrains Mono, monospace"}}>{c.date}</TD>
                  <TD><span style={{color:C.red,fontWeight:700,fontFamily:"JetBrains Mono, monospace"}}>
                    ${c.ticker}</span></TD>
                  <TD style={{fontFamily:"JetBrains Mono, monospace",color:C.tx2}}>{fP(c.price)}</TD>
                  <TD style={{fontFamily:"JetBrains Mono, monospace",color:C.amber,fontWeight:600}}>
                    {fmt(c.notional)}</TD>
                  <TD style={{color:C.tx2,fontSize:11}}>{c.message}</TD>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Search */}
      <div>
        <div style={{fontSize:15,fontWeight:700,color:C.tx,marginBottom:10}}>🔍 Ticker Search</div>
        <input
          value={query}
          onChange={e=>setQuery(e.target.value)}
          placeholder="Search any ticker (e.g. NVDA, SPY...)"
          style={{width:"100%",maxWidth:360,padding:"8px 14px",borderRadius:6,
            border:`1px solid ${C.bdr2}`,background:C.bg2,color:C.tx,fontSize:13,
            fontFamily:"JetBrains Mono, monospace",outline:"none",boxSizing:"border-box"}}
        />
        {query.length>0 && (
          <div style={{marginTop:12,color:C.tx3,fontSize:11,marginBottom:8}}>
            {results.length} result{results.length!==1?"s":""} for "{query.toUpperCase()}"
          </div>
        )}
        {results.length>0 && <FlowTable items={results}/>}
        {query.length>0 && results.length===0 && (
          <div style={{color:C.tx3,fontSize:13,marginTop:12}}>No tickers found.</div>
        )}
      </div>
    </div>
  );
}

// ── Tab config ────────────────────────────────────────────────────────────────
const TABS=[
  {id:"overview",label:"Overview"},
  {id:"category",label:"By Category"},
  {id:"above",label:"▲ Above Zone"},
  {id:"below",label:"▼ Below Zone"},
  {id:"unusual",label:"Unusual Flow"},
  {id:"phantom",label:"Phantom Prints"},
  {id:"options",label:"Options Flow"},
  {id:"signals",label:"Signals 🔍"},
];

// ── CSV Processing Engine ─────────────────────────────────────────────────────

const INDEXES = new Set(["SPY","QQQ","IWM","DIA","MDY","RSP","OEF","ONEQ","TQQQ","SQQQ","SPXU","SPXS","UPRO","SH","PSQ","QID","UVXY","VXX","VIXY","SVXY","SOXS","SOXL","TNA","TZA","UDOW","SDOW","SPXL","ERX","ERY"]);

const SECTOR_ETFS = new Set(["XLF","XLE","XLK","XLV","XLI","XLY","XLP","XLU","XLB","XLRE","XLC","GDX","GDXJ","KRE","KBE","XOP","OIH","XBI","IBB","ARKG","ARKK","ARKW","ARKQ","ARKF","ARKVV","SMH","SOXX","HACK","CIBR","FINX","CLOU","BOTZ","ROBO","WCLD","BUG","SKYY","AIQ","KBWB","KIE","IAI","IYF","PNQI","FDN","IPAY","EMQQ","KOMP","LOUP","DTEC","JETS","AIRR","MOO","SOIL","CROP","WEED","MSOS","POTX","MJ","BITO","BLOK","BITQ","IBIT","FBTC","GBTC","HODL","BTCO","EZBC","BTCW","DEFI","XME","PICK","SLX","REMX","LIT","BATT","DRIV","IDRV","KARS","VNQ","SCHH","ICF","REM","MORT","HOMZ","XHB","ITB","PKB","REZ","PHO","CGW","FIW","FWAT","RXL","BBH","PJP","XPH","SBIO","LABD","LABU","TAN","FAN","ICLN","QCLN","ACES","PBD","SMOG","IAT","KBWR","DPST","FAS","FAZ","SKF","UYG","CURE","RXD","MTUM","VLUE","QUAL","USMV","SIZE","IWF","IWD","IWB","IWR","IWS","VTV","VUG","VO","VB","VBR","VBK","MGC","MGK","MGV","ESGU","ESGD","ESGE","DSI","SDGA"]);

const BOND_ETFS = new Set(["TLT","IEF","SHY","IEI","SHV","GOVT","TBT","TMF","TBF","TTT","UBT","PST","AGG","BND","SCHZ","IUSB","SPAB","BOND","LQD","VCIT","IGIB","SPSB","VCSH","IGSB","FLOT","SJNK","BSCN","BSCO","HYG","JNK","FALN","PHB","HYLB","USHY","SHYG","HYEM","BSJN","BSJO","BSJP","EMB","VWOB","PCY","LEMB","ELD","EBND","MUB","TFI","CMF","ITM","PZA","VTEB","MUNI","SUB","HYD","SHYD","TIP","SCHP","STIP","VTIP","RINF","WIP","BWX","BNDX","IGOV","ISHG","PICB","BIL","GBIL","SGOV","CLTL","VGSH","SCHO","FTSM","LQDH","HYGH","IGBH","TOTB","BNDW","PFFD","FPE","IPFF","PFF","PRFD","MINT","NEAR","ICSH","GSY","JPST","PULS","FLRN"]);

const INTL_EM_ETFS = new Set(["EEM","EFA","VEA","VWO","IEMG","ACWI","ACWX","VXUS","VT","FXI","ASHR","MCHI","KWEB","CQQQ","CHIQ","HAO","GXC","KURE","PGJ","EWJ","DBJP","HEWJ","DXJ","EWZ","EWW","EWC","EWY","EWG","EWH","EWT","EWS","EWU","EWA","EWI","EWP","EWQ","EWD","EWN","EWK","EWL","EWO","EIS","INDA","INDY","PIN","EPI","SMIN","VGK","IEV","FEZ","HEDJ","EZU","EURL","RSX","ERUS","RUSL","RUSS","ENZL","EWM","ECH","EPHE","EIDO","TUR","EPOL","ARGT","EZA","AFK","FM","GAF","EMXC","XSOE","DFAE","DFEM","AVEM","GEM","GMF","SPEM","HEFA","DBEF","DEEF","HEEM"]);

const COMMODITY_ETFS = new Set(["GLD","IAU","GLDM","BAR","SGOL","PHYS","AAAU","BGLD","SLV","SIVR","PSLV","DSLV","USLV","USO","UCO","SCO","DBO","OIL","OILU","OILD","UNG","BOIL","KOLD","GAZ","FCG","PDBC","DJP","USCI","COMB","COM","GSG","DBC","RJI","MLPA","DBA","WEAT","CORN","SOYB","CANE","NIB","JO","BAL","COW","TAGS","CPER","COPX","CULL","PALL","PPLT","GLTR","WOOD","NLR","URA","URNM","HURA","LNG","MLPX","AMLP","AMJ","AMJB","ENFR","TPVG","MLPQ"]);

const LARGE_CAP_KNOWN = new Set(["AAPL","MSFT","NVDA","AMZN","GOOGL","GOOG","META","TSLA","AVGO","LLY","UNH","JPM","V","XOM","MA","PG","COST","HD","JNJ","MRK","CVX","ABBV","PEP","KO","BAC","WFC","NFLX","ORCL","CRM","AMD","INTC","MU","QCOM","NOW","ADBE","ACN","TXN","IBM","GS","MS","BLK","AMGN","GILD","REGN","VRTX","TMO","DHR","ABT","MDT","SYK","BMY","PFE","CI","ISRG","ELV","CVS","UNP","HON","RTX","LMT","NOC","BA","CAT","DE","GE","ETN","EMR","WM","RSG","ADP","PAYX","T","VZ","CMCSA","DIS","SBUX","MCD","BKNG","MAR","HLT","NKE","TGT","WMT","PYPL","UBER","ABNB","PLTR","DDOG","NET","CRWD","ZS","PANW","FTNT","SNOW","TEAM","WDAY","VEEV","TWLO","MDB","OKTA","DOCU","ZM","COIN","MSTR","HOOD","SOFI","NU","AFRM","SQ","SHOP","SPOT","PINS","SNAP","ROKU","TTD","RBLX","LYFT","DASH","RIVN","LCID","F","GM","STLA","NIO","LI","XPEV","ENPH","PLUG","NEE","FSLR","OXY","MPC","VLO","PSX","HES","DVN","COP","MRO","SLB","HAL","BKR","FCX","NEM","GOLD","WPM","UPS","FDX","DAL","UAL","AAL","LUV","CCL","NCLH","RCL","BX","KKR","APO","ARES","CME","ICE","CBOE","SPGI","MCO","USB","PNC","TFC","COF","DFS","SYF","AXP","SCHW","ALB","MP","TMUS","AMT","CCI","PSA","IRM","PLD","O","SPG","AWK","NEE","PCG","BRK.B","BRK.A","MKL","CAVA","CMG","TSCO","CHWY"]);

const CAT_ORDER = ["Indexes","Large Cap","Mid Cap","Small Cap","Sector ETFs","Bond ETFs","Intl/EM ETFs","Commodity ETFs"];
const CAT_DESC = {
  "Indexes":        "Major U.S. broad-market index ETFs and leveraged derivatives",
  "Large Cap":      "S&P 500 and mega-cap individual equities",
  "Mid Cap":        "S&P 400 mid-cap and Russell 1000 individual equities",
  "Small Cap":      "Russell 2000 and smaller individual equities",
  "Sector ETFs":    "Sector, thematic, and factor-based domestic ETFs",
  "Bond ETFs":      "Fixed income ETFs across duration and credit spectrum",
  "Intl/EM ETFs":   "International developed and emerging market ETFs",
  "Commodity ETFs": "Commodity ETFs including gold, oil, and natural resources",
};

function classifyTicker(tk, totalNotional, numDates){
  const t = tk.toUpperCase();
  if(INDEXES.has(t)) return "Indexes";
  if(SECTOR_ETFS.has(t)) return "Sector ETFs";
  if(BOND_ETFS.has(t)) return "Bond ETFs";
  if(INTL_EM_ETFS.has(t)) return "Intl/EM ETFs";
  if(COMMODITY_ETFS.has(t)) return "Commodity ETFs";
  const avgDaily = totalNotional / Math.max(numDates, 1);
  if(LARGE_CAP_KNOWN.has(t) || avgDaily >= 50_000_000) return "Large Cap";
  if(avgDaily >= 5_000_000) return "Mid Cap";
  return "Small Cap";
}

function weightedPercentile(prices, weights, pct){
  if(!prices.length) return null;
  const combined = prices.map((p,i)=>({p, w:weights[i]})).sort((a,b)=>a.p-b.p);
  const totalW = combined.reduce((s,x)=>s+x.w, 0);
  const target = (pct/100)*totalW;
  let cumsum = 0;
  for(const {p,w} of combined){
    cumsum += w;
    if(cumsum >= target) return Math.round(p*100)/100;
  }
  return Math.round(combined[combined.length-1].p*100)/100;
}

function fmtDateKey(d){ return d.toISOString().slice(0,10); }
function fmtLabel(d){ return d.toLocaleDateString("en-US",{month:"short",day:"numeric"}); }
function fmtShort(d){ return (d.getMonth()+1).toString().padStart(2,"0")+"/"+(d.getDate()).toString().padStart(2,"0"); }
function fmtN(n){ return n>=1e9?"$"+(n/1e9).toFixed(1)+"B":n>=1e6?"$"+(n/1e6).toFixed(0)+"M":"$"+(n/1e3).toFixed(0)+"K"; }

function parseCSVtoD(rows){
  // Parse & sort by date/time
  const parseDate = s => { const [m,d,y]=s.split("/"); return new Date(+y,+m-1,+d); };

  // Collect unique trading dates
  const seenDates = new Set();
  const allDatesMap = {};
  for(const r of rows){
    if(!r.Date) continue;
    try{ const d=parseDate(r.Date); const k=fmtDateKey(d); if(!seenDates.has(k)){seenDates.add(k);allDatesMap[k]=d;} }catch(e){}
  }
  const allDates = Object.keys(allDatesMap).sort().map(k=>allDatesMap[k]);
  const numDates = allDates.length;
  const dateIndex = {};
  allDates.forEach((d,i)=>{ dateIndex[fmtDateKey(d)]=i; });

  // Categorise rows
  const tradeRows=[], phantomRows=[], cancelledRows=[], optionsList=[], alphaList=[];
  const uoaTickers = new Set();

  for(const r of rows){
    const type = (r.Type||"").trim();
    const msg  = (r.Message||"").trim();
    const tk   = (r.Ticker||"").trim();
    if(!tk) continue;

    if(type==="AlphaGold"){
      try{ alphaList.push({ticker:tk, price:parseFloat(r.Price)||0, date:fmtShort(parseDate(r.Date))}); }catch(e){}
      continue;
    }
    if(type==="Options"){
      try{ optionsList.push({ticker:tk, price:parseFloat(r.Price)||0, message:msg, date:fmtShort(parseDate(r.Date))}); }catch(e){}
      continue;
    }
    if(type==="DarkPool"){ uoaTickers.add(tk); continue; }
    if(type!=="Block") continue;

    if(msg.startsWith("Cancelled")){
      try{ cancelledRows.push({ticker:tk, price:parseFloat(r.Price)||0, notional:parseFloat(r.Notional)||0, message:msg, date:fmtShort(parseDate(r.Date))}); }catch(e){}
      continue;
    }
    if(msg.startsWith("Phantom Print")){
      const spotM=msg.match(/Spot:\s*\$([0-9.]+)/);
      const volM=msg.match(/Volume:\s*(\d+)/);
      try{ phantomRows.push({ticker:tk, date:fmtShort(parseDate(r.Date)), dpPrice:parseFloat(r.Price)||0, spotPrice:spotM?parseFloat(spotM[1]):0, volume:volM?volM[1]:"0"}); }catch(e){}
      continue;
    }

    // Regular block trade
    try{
      const price=parseFloat(r.Price);
      const notional=parseFloat(r.Notional);
      if(!price||!notional||price<=0||notional<=0) continue;
      const d=parseDate(r.Date);
      const avg30=parseFloat(r.Avg30Day)||0;
      const avgVolM = msg.match(/([0-9.]+)%\s*AvgVol/);
      const pctAvgVol = avgVolM ? parseFloat(avgVolM[1]) : 0;
      tradeRows.push({ticker:tk, dateKey:fmtDateKey(d), price, notional, message:msg, avg30, pctAvgVol});
    }catch(e){}
  }

  // Aggregate per ticker
  const tickerTrades={};  // tk → [{price,notional,dateKey}]
  const tickerDaily={};   // tk → {dateKey → {notional,volNotional,count}}
  const tickerAvg30={};  // tk → avg 30-day volume (last seen value)

  for(const tr of tradeRows){
    const {ticker:tk,dateKey:dk,price:p,notional:n,avg30,pctAvgVol}=tr;
    if(!tickerTrades[tk]) tickerTrades[tk]=[];
    tickerTrades[tk].push({p,n,dk,pctAvgVol});
    if(avg30>0) tickerAvg30[tk]=avg30;
    if(!tickerDaily[tk]) tickerDaily[tk]={};
    if(!tickerDaily[tk][dk]) tickerDaily[tk][dk]={notional:0,volNotional:0,count:0};
    tickerDaily[tk][dk].notional+=n;
    tickerDaily[tk][dk].volNotional+=p*n;
    tickerDaily[tk][dk].count+=1;
  }

  // Build items
  const itemsAll=[];
  for(const [tk,trades] of Object.entries(tickerTrades)){
    const allPrices=trades.map(t=>t.p);
    const allWeights=trades.map(t=>t.n);
    const totalN=allWeights.reduce((s,w)=>s+w,0);
    const vwap=Math.round((allPrices.reduce((s,p,i)=>s+p*allWeights[i],0)/totalN)*100)/100;

    let lo=weightedPercentile(allPrices,allWeights,25);
    let hi=weightedPercentile(allPrices,allWeights,75);
    if(lo===hi){ lo=Math.round(lo*0.995*100)/100; hi=Math.round(hi*1.005*100)/100; }

    const activeDays=tickerDaily[tk];
    const days=Object.keys(activeDays).length;
    const lastDayKey=Object.keys(activeDays).sort().at(-1);
    const ld=activeDays[lastDayKey];
    const last=ld.notional>0?Math.round(ld.volNotional/ld.notional*100)/100:vwap;

    let pos,pct;
    if(last>hi){ pos="above"; pct=Math.round((last-hi)/hi*100*100)/100; }
    else if(last<lo){ pos="below"; pct=Math.round((last-lo)/lo*100*100)/100; }
    else{ pos="inside"; const mid=(lo+hi)/2; pct=Math.round((last-mid)/mid*100*100)/100; }

    const maxDailyN=Math.max(...Object.values(activeDays).map(v=>v.notional),1);
    const pricesArr=[],wArr=[];
    for(const d of allDates){
      const dk=fmtDateKey(d);
      if(activeDays[dk]){
        const dd=activeDays[dk];
        pricesArr.push(Math.round(dd.volNotional/dd.notional*100)/100);
        wArr.push(Math.round(dd.notional/maxDailyN*1000)/1000);
      } else { pricesArr.push(null); wArr.push(null); }
    }

    const top5=[...trades].sort((a,b)=>b.n-a.n).slice(0,5).map(({p,n,dk})=>{
      try{ const d=new Date(dk+"T00:00:00"); return fmtShort(d)+" @ $"+p.toFixed(2)+"  "+fmtN(n); }catch(e){ return ""; }
    });

    // Largest single print by notional — the level to watch
    const sortedByN=[...trades].sort((a,b)=>b.n-a.n);
    const bigPrint = sortedByN[0] ? sortedByN[0].p : null;
    const bigPrintN = sortedByN[0] ? sortedByN[0].n : 0;
    const bigPrintDk = sortedByN[0] ? sortedByN[0].dk : null;
    const bigPrintDate = bigPrintDk ? (()=>{ try{ return fmtShort(new Date(bigPrintDk+"T00:00:00")); }catch(e){ return bigPrintDk; } })() : null;
    const bigPrintPctAvgVol = sortedByN[0] ? sortedByN[0].pctAvgVol : 0;

    const cat=classifyTicker(tk,totalN,numDates);
    const avg30=tickerAvg30[tk]||0;
    itemsAll.push({t:tk,cat,n:Math.round(totalN),lo,hi,last,vwap,c:trades.length,days,pos,pct,u:uoaTickers.has(tk),prices:pricesArr,w:wArr,top5,bigPrint,bigPrintN,bigPrintDate,bigPrintPctAvgVol,avg30});
  }

  // Categories
  const catMap={};
  for(const item of itemsAll){
    if(!catMap[item.cat]) catMap[item.cat]=[];
    catMap[item.cat].push(item);
  }
  const categories=CAT_ORDER.map(cat=>{
    const items=(catMap[cat]||[]).sort((a,b)=>b.n-a.n);
    return {name:cat,desc:CAT_DESC[cat],totalNotional:items.reduce((s,i)=>s+i.n,0),count:items.length,items};
  });

  // Above/Below/Unusual
  const above=itemsAll.filter(i=>i.pos==="above").sort((a,b)=>b.pct-a.pct).slice(0,40);
  const below=itemsAll.filter(i=>i.pos==="below").sort((a,b)=>a.pct-b.pct).slice(0,40);
  const unusual=itemsAll.filter(i=>i.u).sort((a,b)=>b.n-a.n).slice(0,30);

  // Phantom dedup
  const seenPh=new Set();
  const phantomDeduped=[];
  for(const ph of phantomRows){
    const key=ph.ticker+"|"+ph.date+"|"+ph.dpPrice;
    if(!seenPh.has(key)){ seenPh.add(key); phantomDeduped.push(ph); }
  }
  phantomDeduped.sort((a,b)=>Math.abs(b.spotPrice-b.dpPrice)/Math.max(b.dpPrice,0.01)-Math.abs(a.spotPrice-a.dpPrice)/Math.max(a.dpPrice,0.01));
  const phantom=phantomDeduped.slice(0,15);

  // Options dedup (most recent first)
  const seenOpts=new Set();
  const optsDeduped=[];
  for(const o of [...optionsList].reverse()){
    const key=o.ticker+"|"+o.message;
    if(!seenOpts.has(key)){ seenOpts.add(key); optsDeduped.push(o); }
  }
  const options=optsDeduped.slice(0,25);

  // Alpha dedup
  const seenAlpha=new Set();
  const alphaDeduped=[];
  for(const a of [...alphaList].reverse()){
    if(!seenAlpha.has(a.ticker)){ seenAlpha.add(a.ticker); alphaDeduped.push(a); }
  }
  const alpha=alphaDeduped.slice(0,10);

  // Cancelled dedup
  const cancelledSorted=[...cancelledRows].sort((a,b)=>b.notional-a.notional);
  const seenCan=new Set();
  const cancelledDeduped=[];
  for(const c of cancelledSorted){
    const key=c.ticker+"|"+c.date+"|"+c.notional;
    if(!seenCan.has(key)){ seenCan.add(key); cancelledDeduped.push(c); }
  }
  const cancelled=cancelledDeduped.slice(0,15);

  // Meta
  const totalNotional=tradeRows.reduce((s,r)=>s+r.notional,0);
  const dateRange=allDates.length>=2?fmtLabel(allDates[0])+" – "+fmtLabel(allDates.at(-1))+", "+allDates.at(-1).getFullYear():"";

  return {
    dates:allDates.map(fmtDateKey),
    dateLabels:allDates.map(fmtLabel),
    meta:{
      generatedAt:new Date().toLocaleString(),
      dateRange,
      tradingDays:numDates,
      totalTrades:tradeRows.length,
      totalTickers:Object.keys(tickerTrades).length,
      totalNotional:Math.round(totalNotional),
    },
    categories, above, below, unusual, phantom, options, alpha, cancelled,
  };
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function DarkPool(){
  const [dpData,setDpData]=useState(null);
  const [loadErr,setLoadErr]=useState(null);
  const [loadStatus,setLoadStatus]=useState("Loading CSV…");

  useEffect(()=>{
    setLoadStatus("Fetching Darkpool-data.csv…");
    fetch("/Darkpool-data.csv")
      .then(r=>{
        if(!r.ok) throw new Error("HTTP "+r.status+" — check Darkpool-data.csv is in app/public");
        const ct = r.headers.get("content-type") || "";
        if(ct.includes("text/html")) throw new Error("Got HTML instead of CSV — file not found on server");
        return r.text();
      })
      .then(text=>{
        const trimmed = text.trim();
        if(trimmed.startsWith("<!") || trimmed.startsWith("<html")) throw new Error("Got HTML instead of CSV — Darkpool-data.csv not found");
        setLoadStatus("Parsing CSV…");
        const rows = parseCSV(text);
        if(!rows || rows.length===0) throw new Error("CSV parsed but contained 0 valid rows");
        setLoadStatus("Processing "+rows.length.toLocaleString()+" rows…");
        setTimeout(()=>{
          try{
            const d = parseCSVtoD(rows);
            setDpData(d);
          }catch(e){
            setLoadErr("Processing error: "+e.message);
          }
        }, 50);
      })
      .catch(e=>setLoadErr(e.message));
  },[]);




  const [tab,setTab]=useState("overview");
  const [catJump,setCatJump]=useState(null);

  function handleJumpTo(name){
    setCatJump(name);
    setTab("category");
  }

  if(loadErr) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:"60vh",background:"#0b1120",color:"#ff5c72",fontFamily:"Outfit,sans-serif",
      flexDirection:"column",gap:12,padding:20}}>
      <div style={{fontSize:20,fontWeight:700}}>⚠ Failed to load data</div>
      <div style={{fontSize:13,color:"#7a8ba8"}}>Attempted: <code style={{color:"#4e9fff"}}>/Darkpool-data.csv</code></div>
      <div style={{fontSize:12,color:"#ff5c72",background:"#1a0f14",border:"1px solid #ff5c7244",
        borderRadius:8,padding:"8px 16px",maxWidth:480,textAlign:"center"}}>
        {loadErr}
      </div>
      <div style={{fontSize:11,color:"#4a5d7a"}}>Make sure Darkpool-data.csv is in app/public/ and redeployed.</div>
    </div>
  );

  if(!dpData) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",
      minHeight:"100vh",background:"#0b1120",color:"#4e9fff",fontFamily:"Outfit,sans-serif",
      flexDirection:"column",gap:16}}>
      <div style={{width:40,height:40,border:"3px solid #1b2a45",
        borderTop:"3px solid #4e9fff",borderRadius:"50%",
        animation:"spin 0.8s linear infinite"}}/>
      <div style={{fontSize:14,color:"#7a8ba8"}}>{loadStatus}</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  D = dpData;

  return (
    <div style={{background:C.bg,minHeight:"100vh",color:C.tx,
      fontFamily:"Outfit, system-ui, sans-serif",fontSize:13}}>
      {/* Global font import */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Outfit:wght@400;600;700&display=swap');
        ::-webkit-scrollbar{width:6px;height:6px}
        ::-webkit-scrollbar-track{background:#0b1120}
        ::-webkit-scrollbar-thumb{background:#243352;border-radius:3px}
        input:focus{border-color:#4e9fff !important}
      `}</style>

      {/* Header */}
      <div style={{background:C.bg2,borderBottom:`1px solid ${C.bdr}`,padding:"14px 20px"}}>
        {/* Title row */}
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
          <span style={{width:10,height:10,borderRadius:"50%",background:C.green,
            boxShadow:`0 0 6px ${C.green}`,display:"inline-block",flexShrink:0}}/>
          <span style={{fontSize:22,fontWeight:800,color:C.tx,letterSpacing:"0.02em",
            fontFamily:"Outfit, system-ui, sans-serif"}}>DARK POOL SCANNER</span>
        </div>
        {/* Subtitle */}
        <div style={{fontSize:12,color:C.tx3,marginBottom:14,paddingLeft:18}}>
          {D.meta?.dateRange??""} · {D.meta?.tradingDays??""} trading days · {(D.meta?.totalTrades??0).toLocaleString()} block trades · {(D.meta?.totalTickers??0).toLocaleString()} tickers ·{" "}
          <span style={{color:C.cyan}}>{D.meta?.totalNotional?(D.meta.totalNotional>=1e12?`$${(D.meta.totalNotional/1e12).toFixed(2)}T`:`$${(D.meta.totalNotional/1e9).toFixed(0)}B`):"$0"} total flow</span>
        </div>
        {/* Zone cards */}
        <div style={{display:"flex",flexWrap:"wrap",gap:10}}>
          {[
            {label:`SPY ${D.meta?.tradingDays??30}-DAY ZONE`,item:D.categories[0]?.items[0]},
            {label:`QQQ ${D.meta?.tradingDays??30}-DAY ZONE`,item:D.categories[0]?.items[1]},
            {label:`IWM ${D.meta?.tradingDays??30}-DAY ZONE`,item:D.categories[0]?.items[4]},
          ].filter(x=>x.item).map(({label,item})=>{
            const c=zC(item.last,item.lo,item.hi);
            return (
              <div key={label} style={{background:C.bg4,border:`1px solid ${C.bdr}`,
                borderRadius:8,padding:"10px 16px",minWidth:160}}>
                <div style={{fontSize:10,color:C.tx3,fontWeight:700,letterSpacing:"0.05em",
                  textTransform:"uppercase",marginBottom:4}}>{label}</div>
                <div style={{fontSize:24,fontWeight:800,color:c,
                  fontFamily:"JetBrains Mono, monospace",lineHeight:1}}>{fP(item.last)}</div>
                <div style={{fontSize:11,color:C.tx3,marginTop:4,
                  fontFamily:"JetBrains Mono, monospace"}}>
                  Zone {fP(item.lo)} – {fP(item.hi)}
                </div>
              </div>
            );
          })}
          {/* Period card */}
          <div style={{background:C.bg4,border:`1px solid ${C.bdr}`,borderRadius:8,
            padding:"10px 16px",minWidth:140}}>
            <div style={{fontSize:10,color:C.tx3,fontWeight:700,letterSpacing:"0.05em",
              textTransform:"uppercase",marginBottom:4}}>PERIOD</div>
            <div style={{fontSize:24,fontWeight:800,color:C.amber,
              fontFamily:"JetBrains Mono, monospace",lineHeight:1}}>{D.meta?.tradingDays??""} <span style={{fontSize:14}}>days</span></div>
            <div style={{fontSize:11,color:C.tx3,marginTop:4,
              fontFamily:"JetBrains Mono, monospace"}}>{D.meta?.totalNotional?(D.meta.totalNotional>=1e12?`$${(D.meta.totalNotional/1e12).toFixed(2)}T`:`$${(D.meta.totalNotional/1e9).toFixed(0)}B`):"$0"} flow</div>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{background:C.bg3,borderBottom:`1px solid ${C.bdr}`,
        padding:"0 20px",display:"flex",overflowX:"auto",gap:2}}>
        {TABS.map(t=>{
          const on=t.id===tab;
          return (
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:"10px 14px",background:"transparent",border:"none",
                borderBottom:on?`2px solid ${C.blue}`:"2px solid transparent",
                color:on?C.blue:C.tx2,fontWeight:on?700:400,fontSize:12,
                cursor:"pointer",whiteSpace:"nowrap",transition:"color 0.15s",
                fontFamily:"Outfit, system-ui, sans-serif"}}>
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div style={{padding:"18px 20px",maxWidth:1400,margin:"0 auto"}}>
        {tab==="overview" && <OverviewPane/>}
        {tab==="category" && <CategoryPaneWrapper jump={catJump} onJumpDone={()=>setCatJump(null)}/>}
        {tab==="above"    && <AbovePane/>}
        {tab==="below"    && <BelowPane/>}
        {tab==="unusual"  && <UnusualPane/>}
        {tab==="phantom"  && <PhantomPane/>}
        {tab==="options"  && <OptionsPane/>}
        {tab==="signals"  && <SignalsPane/>}
      </div>
    </div>
  );
}

// Wrapper to handle jump-to-category
function CategoryPaneWrapper({jump,onJumpDone}){
  const [active,setActive]=useState(jump||D.categories[0].name);
  // If a new jump arrives, switch to it
  useMemo(()=>{ if(jump){ setActive(jump); onJumpDone(); } },[jump]);
  const cat=D.categories.find(c=>c.name===active)||D.categories[0];
  const color=CAT_COLORS[active]||C.tx;
  return (
    <div>
      <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:16}}>
        {D.categories.map(c=>{
          const cc=CAT_COLORS[c.name]||C.tx;
          const isOn=c.name===active;
          return (
            <button key={c.name} onClick={()=>setActive(c.name)}
              style={{padding:"5px 14px",borderRadius:20,border:`1px solid ${cc}${isOn?"":"33"}`,
                background:isOn?cc+"22":"transparent",color:isOn?cc:C.tx2,
                fontWeight:isOn?700:400,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>
              {c.name}
            </button>
          );
        })}
      </div>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700,color,marginBottom:4}}>{cat.name}</div>
        <div style={{fontSize:12,color:C.tx2}}>{cat.desc}</div>
        <div style={{fontSize:12,color:C.tx3,marginTop:2}}>
          Total: <span style={{color:C.cyan,fontWeight:700}}>{fmt(cat.totalNotional)}</span>
          {" · "}{cat.count} tickers
        </div>
      </div>
      <FlowTable items={cat.items} showCat={false}/>
    </div>
  );
}
