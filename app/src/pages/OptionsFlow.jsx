import React, { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

// --- Configuration ---
// Bypasses the Python backend and fetches the CSV directly from your GitHub repo.
// Make sure your file on GitHub is named exactly 'flow-data.csv' in your public folder.
const REMOTE_CSV_URL = "https://raw.githubusercontent.com/unchartedterritory5995-cyber/UCT-Dashboard/main/app/public/flow-data.csv";

// --- Theme Palette ---
const P = {bg:"#06090f",cd:"#0d1321",al:"#111a2e",bd:"#1a2540",bl:"#243352",bu:"#00e676",be:"#ff1744",ac:"#ffab00",tx:"#c8d6e5",dm:"#7b8fa3",mt:"#4a5c73",wh:"#f0f4f8",ye:"#ffd600",ma:"#e040fb",sw:"#00b0ff",bk:"#b388ff",uc:"#78909c"};

// --- Error Boundary to Prevent Blank Screens ---
class DashboardErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, background: '#06090f', color: '#ff1744', minHeight: '100vh', fontFamily: 'monospace' }}>
          <h2>🚨 Dashboard Rendering Crash Intercepted</h2>
          <p>Instead of a blank screen, here is the exact error causing the issue:</p>
          <pre style={{ background: '#1a2540', padding: 20, borderRadius: 8, whiteSpace: 'pre-wrap' }}>
            {this.state.error?.toString()}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Helper Functions ---
function fmt(n){const a=Math.abs(n||0);if(a>=1e9)return"$"+(n/1e9).toFixed(2)+"B";if(a>=1e6)return"$"+(n/1e6).toFixed(1)+"M";if(a>=1e3)return"$"+(n/1e3).toFixed(0)+"K";return"$"+(n||0)}
function fK(n){const val=n||0;return val>=1e6?(val/1e6).toFixed(1)+"M":val>=1e3?(val/1e3).toFixed(1)+"K":String(val)}
function tc(t){return t==="SWP"?P.sw:P.bk}
function Tag({c,children}){return <span style={{display:"inline-block",padding:"2px 7px",borderRadius:3,fontSize:9,fontWeight:700,letterSpacing:0.4,whiteSpace:"nowrap",color:c,backgroundColor:`${c}15`,border:`1px solid ${c}30`}}>{children}</span>}
function Card({children,title,sub,col}){return <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:"14px 16px",display:"flex",flexDirection:"column",gap:8,minWidth:0, borderLeft: col ? `4px solid ${col}` : undefined}}>{title&&<div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline"}}><span style={{fontSize:11,fontWeight:700,color:col||P.dm,textTransform:"uppercase",letterSpacing:1.5}}>{title}</span>{sub&&<span style={{fontSize:10,color:P.mt}}>{sub}</span>}</div>}{children}</div>}
function TT({rows}){return <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}><thead><tr style={{borderBottom:`1px solid ${P.bd}`}}>{["Ticker","Day","Side","Signal","Type","C/P","Strike","Exp","Vol","Premium","DTE"].map(h=><th key={h} style={{padding:"5px 4px",textAlign:"left",color:P.mt,fontSize:9,fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} style={{borderBottom:`1px solid ${P.bd}10`,background:(r.Si==="AA"||r.Si==="BB")?`${P.ac}08`:"transparent"}}><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.S}</td><td style={{padding:"5px 4px",color:P.dm,fontSize:9}}>{r.Dt}</td><td style={{padding:"5px 4px"}}>{r.Si==="BB"?<Tag c={P.be}>BB</Tag>:r.Si==="AA"?<Tag c={P.ac}>AA</Tag>:r.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>{r.Si||"A"}</Tag>}</td><td style={{padding:"5px 4px"}}><Tag c={r.Co==="YELLOW"?P.ye:r.Co==="WHITE"?P.wh:P.ma}>{r.Co}</Tag></td><td style={{padding:"5px 4px"}}><Tag c={tc(r.Ty)}>{r.Ty}</Tag></td><td style={{padding:"5px 4px"}}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>${r.K}</td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.E}</td><td style={{padding:"5px 4px",color:P.dm}}>{fK(r.V)}</td><td style={{padding:"5px 4px",fontWeight:700,color:P.wh}}>{fmt(r.P)}</td><td style={{padding:"5px 4px",color:P.dm}}>{r.DTE}d</td></tr>)}</tbody></table>}
function CT({rows}){return <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}><thead><tr style={{borderBottom:`1px solid ${P.bd}`}}>{["Ticker","C/P","Strike","Exp","Hits","Vol","Premium"].map(h=><th key={h} style={{padding:"5px 4px",textAlign:"left",color:P.mt,fontSize:9,fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i} style={{borderBottom:`1px solid ${P.bd}10`,background:r.H>=5?`${P.ac}08`:"transparent"}}><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.S}</td><td style={{padding:"5px 4px"}}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>${r.K}</td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.E}</td><td style={{padding:"5px 4px"}}><span style={{fontWeight:800,fontSize:13,color:r.H>=10?P.ac:r.H>=5?P.ye:P.dm}}>{r.H}x</span></td><td style={{padding:"5px 4px",color:P.dm}}>{fK(r.V)}</td><td style={{padding:"5px 4px",fontWeight:700,color:P.wh}}>{fmt(r.P)}</td></tr>)}</tbody></table>}
function NC({data,fill,dir}){const neg=dir==="bear";const cd=(data||[]).map(d=>({...d,v:neg?-Math.abs(d.n):d.n}));return <div style={{height:220}}><ResponsiveContainer><BarChart data={cd} layout="vertical" margin={{top:0,right:8,left:5,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={P.bd} horizontal={false}/><XAxis type="number" tick={{fill:P.mt,fontSize:8}} tickFormatter={v=>fmt(Math.abs(v))}/><YAxis dataKey="s" type="category" tick={{fill:P.tx,fontSize:11,fontWeight:700}} width={60} interval={0} tickLine={false} axisLine={false}/><Tooltip content={({active,payload})=>{if(!active||!payload||!payload.length)return null;const d=payload[0].payload;return <div style={{background:"#152038",border:`1px solid ${P.bl}`,borderRadius:6,padding:"8px 12px",fontSize:11}}><div style={{fontWeight:700,marginBottom:3}}>{d.s}</div>{d.l&&<div style={{color:P.ac,fontSize:10,marginBottom:3}}>{d.l.split(" \u00b7 ")[1]}</div>}<div style={{color:P.bu}}>Bull: {fmt(d.b)}</div><div style={{color:P.be}}>Bear: {fmt(d.r)}</div><div style={{color:d.n>0?P.bu:P.be,fontWeight:700}}>Net: {fmt(d.n)}</div></div>}}/><Bar dataKey="v" fill={fill} radius={neg?[4,0,0,4]:[0,4,4,0]} barSize={14}/></BarChart></ResponsiveContainer></div>}

const TABS=["Market Read","Search","Performance","Short Term","Long Term","LEAPS","OI Watchlist"];

// --- Data Parsing Engine ---
const parseCSV = (csvText) => {
  const lines = csvText.trim().replace(/\r/g, '').split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const values = line.split(',');
    return headers.reduce((obj, header, i) => {
      obj[header] = values[i] ? values[i].trim() : '';
      return obj;
    }, {});
  });
};

const analyzeFlow = (rows) => {
  const blockTimes = {};
  rows.forEach(r => {
    if (r.Type === 'BLOCK') {
      const key = `${r.Symbol}|${r.CreatedDate}|${r.CreatedTime}`;
      blockTimes[key] = (blockTimes[key] || 0) + 1;
    }
  });

  const live = [];
  const white = [];
  const daysMap = {};
  let totBull = 0, totBear = 0;

  rows.forEach(r => {
    const type = r.Type;
    if (type === 'ML/') return; 
    
    const cp = r.CallPut;
    const side = r.Side;
    const strike = parseFloat(r.Strike) || 0;
    const spot = parseFloat(r.Spot) || 0;
    const price = parseFloat(r.Price) || 0;
    const prem = parseFloat(r.Premium) || 0;
    const vol = parseInt(r.Volume) || 0;
    const dte = parseInt(r.Dte) || 0;
    const color = r.Color;
    const sym = r.Symbol;
    const exp = r.ExpirationDate;
    const dateStr = String(r.CreatedDate || '');
    const time = r.CreatedTime;

    if (type === 'BLOCK') {
      const key = `${sym}|${dateStr}|${time}`;
      if (blockTimes[key] > 1) return;
    }
    
    if (cp === 'PUT' && type === 'BLOCK' && (side === 'A' || side === 'AA' || side === 'ASK')) {
      const intrinsic = Math.max(0, strike - spot);
      const extrinsic = price - intrinsic;
      if (price > 0 && (extrinsic / price) < 0.05) return;
    }

    if (color === 'WHITE') {
      white.push({ S: sym, CP: cp ? cp[0] : '', K: strike, E: exp, Ty: type, Si: side, V: vol, OI: parseInt(r.OI)||0, P: prem, Dt: dateStr ? dateStr.split('/').slice(0,2).join('/') : '', DTE: dte, Co: color });
      return; 
    }

    let dir = 'MIXED';
    if (cp === 'CALL') dir = 'BULL'; 
    if (cp === 'PUT') {
      if (side === 'A' || side === 'AA' || side === 'ASK') dir = 'BEAR'; 
      if (side === 'B' || side === 'BB' || side === 'BID') dir = 'BULL'; 
    }

    if (dir !== 'MIXED') {
      live.push({ sym, cp, strike, exp, price, prem, vol, dte, side, type, color, spot, dir, date: dateStr });
      
      if (dir === 'BULL') totBull += prem;
      else totBear += prem;
      
      const dParts = dateStr ? dateStr.split('/') : [];
      const dLabel = dParts.length >= 2 ? `${dParts[0]}/${dParts[1]}` : dateStr; 
      if (dLabel && !daysMap[dLabel]) daysMap[dLabel] = { d: dLabel, b: 0, r: 0 };
      if (dLabel) {
        if (dir === 'BULL') daysMap[dLabel].b += prem;
        else daysMap[dLabel].r += prem;
      }
    }
  });

  const groups = {};
  live.forEach(r => {
    const key = `${r.sym}|${r.cp}|${r.strike}|${r.exp}`;
    if (!groups[key]) {
      groups[key] = {
        key, sym: r.sym, cp: r.cp, strike: r.strike, exp: r.exp, hits: 0, prem: 0, vol: 0,
        dir: r.dir, dte: r.dte, lo: r.price, hi: r.price, entry: r.price, maxPrem: 0, spot: r.spot,
        hasAAorBB: false, side: r.side, type: r.type, color: r.color, date: r.date
      };
    }
    const g = groups[key];
    g.hits++;
    g.prem += r.prem;
    g.vol += r.vol;
    if (r.price < g.lo) g.lo = r.price;
    if (r.price > g.hi) g.hi = r.price;
    if (r.prem > g.maxPrem) {
      g.maxPrem = r.prem;
      g.entry = r.price;
      g.spot = r.spot;
      g.side = r.side;
      g.type = r.type;
    }
    if (r.side === 'AA' || r.side === 'BB') g.hasAAorBB = true;
  });

  const allGroups = Object.values(groups);
  allGroups.forEach(g => {
    g.score = (g.prem / 1000000) * 10 + (g.hits * 200) + (g.hasAAorBB ? 1000 : 0);
  });

  const short = allGroups.filter(g => g.dte <= 14);
  const long = allGroups.filter(g => g.dte > 14 && g.dte <= 179);
  const leaps = allGroups.filter(g => g.dte >= 180);

  const processTerm = (bucket) => {
    const b = bucket.filter(g => g.dir === 'BULL');
    const r = bucket.filter(g => g.dir === 'BEAR');
    
    const bPrem = b.reduce((s,g) => s + g.prem, 0);
    const rPrem = r.reduce((s,g) => s + g.prem, 0);

    const syms = {};
    bucket.forEach(g => {
      if (!syms[g.sym]) syms[g.sym] = { s: g.sym, b: 0, r: 0, n: 0, topTrade: null };
      if (g.dir === 'BULL') syms[g.sym].b += g.prem;
      else syms[g.sym].r += g.prem;
      if (!syms[g.sym].topTrade || g.prem > syms[g.sym].topTrade.prem) syms[g.sym].topTrade = g;
    });
    
    Object.values(syms).forEach(s => {
      s.n = s.b - s.r;
      const tt = s.topTrade;
      s.l = `${s.s} \u00b7 ${tt.exp} $${tt.strike}${tt.cp ? tt.cp[0] : ''}`;
    });

    const arr = Object.values(syms);
    const symB = arr.filter(s => s.n > 0).sort((a,b) => b.n - a.n).slice(0, 8);
    const symR = arr.filter(s => s.n < 0).sort((a,b) => Math.abs(b.n) - Math.abs(a.n)).slice(0, 8);

    const mapTrades = (arrData) => arrData.sort((a,b) => b.prem - a.prem).slice(0, 8).map(g => ({
      S: g.sym, Dt: g.date ? g.date.split('/').slice(0,2).join('/') : '', Si: g.side, Co: g.color, Ty: g.type, 
      CP: g.cp ? g.cp[0] : '', K: g.strike, E: g.exp, V: g.vol, P: g.prem, DTE: g.dte, dir: g.dir
    }));
    
    const mapConsist = (arrData) => arrData.filter(g => g.hits >= 2).sort((a,b) => b.hits - a.hits).slice(0, 6).map(g => ({
      S: g.sym, CP: g.cp ? g.cp[0] : '', K: g.strike, E: g.exp, H: g.hits, V: g.vol, P: g.prem, dir: g.dir
    }));

    return { bullPrem: bPrem, bearPrem: rPrem, symB, symR, tradesB: mapTrades(b), tradesR: mapTrades(r), consistB: mapConsist(b), consistR: mapConsist(r) };
  };

  const sTerm = processTerm(short);
  const lTerm = processTerm(long);
  const lpTerm = processTerm(leaps);

  const bulls = allGroups.filter(g => g.dir === 'BULL').sort((a,b) => b.score - a.score);
  const bears = allGroups.filter(g => g.dir === 'BEAR').sort((a,b) => b.score - a.score);
  const CONV = [];
  for(let i=0; i<3; i++) {
    if(bulls[i]) CONV.push({ sym: bulls[i].sym, strike: `$${bulls[i].strike}${bulls[i].cp ? bulls[i].cp[0] : ''}`, exp: bulls[i].exp, hits: bulls[i].hits, prem: bulls[i].prem, side: bulls[i].side, dir: bulls[i].dir });
    if(bears[i]) CONV.push({ sym: bears[i].sym, strike: `$${bears[i].strike}${bears[i].cp ? bears[i].cp[0] : ''}`, exp: bears[i].exp, hits: bears[i].hits, prem: bears[i].prem, side: bears[i].side, dir: bears[i].dir });
  }

  const DAYS = Object.values(daysMap);
  const PERF_INIT = [];
  const addPerf = (arrData, cat) => arrData.forEach((g,i) => {
    PERF_INIT.push({ id: cat+i, cat, sym: g.sym, cp: g.cp ? g.cp[0] : '', strike: g.strike, exp: g.exp, entry: g.entry, lo: g.lo, hi: g.hi, spot: g.spot, hits: g.hits, dir: g.dir });
  });
  addPerf(allGroups.sort((a,b)=>b.score - a.score).slice(0,6), "Conviction");
  addPerf(short.filter(g=>g.dir==='BULL').sort((a,b)=>b.prem-a.prem).slice(0,4), "Short Bull");
  addPerf(short.filter(g=>g.dir==='BEAR').sort((a,b)=>b.prem-a.prem).slice(0,4), "Short Bear");
  addPerf(long.filter(g=>g.dir==='BULL').sort((a,b)=>b.prem-a.prem).slice(0,4), "Long Bull");
  addPerf(long.filter(g=>g.dir==='BEAR').sort((a,b)=>b.prem-a.prem).slice(0,4), "Long Bear");
  addPerf(leaps.filter(g=>g.dir==='BULL').sort((a,b)=>b.prem-a.prem).slice(0,4), "LEAPS Bull");
  addPerf(leaps.filter(g=>g.dir==='BEAR').sort((a,b)=>b.prem-a.prem).slice(0,4), "LEAPS Bear");

  return { totBull, totBear, liveCount: live.length, whiteCount: white.length, DAYS, CONV, WATCH: white.sort((a,b)=>b.P-a.P).slice(0,10), PERF_INIT, sTerm, lTerm, lpTerm, liveTrades: live, whiteTrades: white };
};

function OptionsFlowDashboardUI() {
  const [flowData, setFlowData] = useState(null);
  const [tab, setTab] = useState("Market Read");
  const [searchQuery, setSearchQuery] = useState("");
  const [perf, setPerf] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    // The engine will check the remote GitHub URL first to bypass the Python router block
    const fetchPaths = [
      REMOTE_CSV_URL,
      '/flow-data.csv',
      '/options-flow/flow-data.csv',
      'flow-data.csv'
    ].filter(Boolean);

    const tryFetchData = async () => {
      let lastError = "";
      for (const path of fetchPaths) {
        try {
          const res = await fetch(path);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          
          const contentType = res.headers.get("content-type");
          if (contentType && contentType.includes("text/html")) {
            throw new Error(`Your backend router intercepted the request for '${path}' and returned HTML instead of a CSV file. FastAPI must be configured to serve 'flow-data.csv' as a static asset.`);
          }
          
          const text = await res.text();
          const rows = parseCSV(text);
          if (rows.length < 2) throw new Error(`Path ${path} was found, but it had no valid CSV data inside.`);
          
          const data = analyzeFlow(rows);
          setFlowData(data);
          setPerf(data.PERF_INIT.map(p => ({...p, now: 0})));
          return; // Success! Exit the loop.
        } catch (err) {
          lastError = err.message;
          // If it's the specific HTML catch-all error, log it but keep trying the next path
          // (because the REMOTE_CSV_URL bypass might be next in the list and succeed)
          console.log(`Failed fetching ${path}:`, err.message);
        }
      }
      throw new Error("Could not automatically find 'flow-data.csv'. Ensure the file exists on GitHub or configure your FastAPI to serve static files correctly. Last error: " + lastError);
    };

    tryFetchData().catch(err => {
      setErrorMsg(err.message);
    });
  }, []);

  const handleFileUpload = (e) => {
    setErrorMsg("");
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = evt.target.result;
        const rows = parseCSV(text);
        const data = analyzeFlow(rows);
        setFlowData(data);
        setPerf(data.PERF_INIT.map(p => ({...p, now: 0})));
      } catch (err) {
        console.error("Error processing uploaded file:", err);
        setErrorMsg("Failed to process file. Is it a valid CSV? Error: " + err.message);
      }
    };
    reader.readAsText(file);
  };

  async function fetchPrices(){
    setLoading(true);
    setStatus("Fetching simulated prices (Mocked API)...");
    await new Promise(r => setTimeout(r, 1500));
    setPerf(prev => prev.map(p => {
      const varianceFactor = (Math.random() * 0.5) - 0.2; 
      const simulatedNow = Math.max(0.01, p.entry * (1 + varianceFactor));
      return { ...p, now: Number(simulatedNow.toFixed(2)) };
    }));
    setLoading(false);
    setStatus(`Done. Simulated prices updated successfully.`);
  }

  if (!flowData) {
    return (
      <div style={{display:'flex', minHeight:'100vh', width:'100%', background:P.bg, color:P.tx, fontFamily:"'SF Mono','Fira Code',monospace", alignItems:'center', justifyContent:'center', padding: 20, boxSizing: 'border-box'}}>
        <div style={{background:P.cd, border:`1px solid ${P.bd}`, padding:"40px 30px", borderRadius:12, textAlign:'center', width: '100%', maxWidth: 550}}>
          <div style={{width:12,height:12,borderRadius:"50%",background:errorMsg ? P.be : P.ac,boxShadow:`0 0 15px ${errorMsg ? P.be : P.ac}`, margin: "0 auto 20px auto"}}/>
          <h2 style={{color:P.wh, margin:"0 0 10px 0", fontSize: 24}}>
            {errorMsg ? "Data Unavailable" : "Loading Options Flow..."}
          </h2>
          <p style={{color:P.dm, fontSize:12, marginBottom:20}}>
            {errorMsg ? "The options flow data could not be loaded from the server." : "Fetching and analyzing the latest market data..."}
          </p>
          
          {errorMsg && (
            <div style={{background: `${P.be}15`, border: `1px solid ${P.be}40`, color: P.be, padding: 14, borderRadius: 6, fontSize: 11, fontWeight: 600, textAlign: 'left', lineHeight: 1.5}}>
              <strong>Diagnostic Info:</strong><br/>{errorMsg}
            </div>
          )}

          {/* Dev/Canvas Fallback Upload */}
          {errorMsg && (
            <div style={{marginTop: 20}}>
              <p style={{color:P.dm, fontSize: 11, marginBottom: 10}}>Canvas/Dev Mode: Upload CSV to preview</p>
              <label style={{display: 'inline-block', background:P.mt, color:P.bg, padding:'8px 16px', borderRadius:6, cursor:'pointer', fontWeight:800, textTransform: "uppercase", letterSpacing: 1, fontSize: 11}}>
                Test with Local File
                <input type="file" accept=".csv" onChange={handleFileUpload} style={{display:'none'}} />
              </label>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{background:P.bg,color:P.tx,fontFamily:"'SF Mono','Fira Code',monospace",minHeight:"100vh", width:"100%", boxSizing: "border-box"}}>
      <div style={{maxWidth: 1400, margin: "0 auto", padding: "16px 20px", width: "100%"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
          <div style={{width:6,height:6,borderRadius:"50%",background:P.ac,boxShadow:`0 0 10px ${P.ac}`}}/>
          <h1 style={{fontSize:18,fontWeight:800,margin:0,color:P.wh}}>OPTIONS FLOW — DYNAMIC READ</h1>
          <span style={{marginLeft:"auto",fontSize:10,color:P.mt,background:P.al,padding:"3px 10px",borderRadius:4}}>AUTO-ANALYZED FLOW DATA</span>
        </div>
        <p style={{fontSize:10,color:P.mt,margin:"0 0 12px 16px"}}>{flowData.liveCount} confirmed live trades · {fmt(flowData.totBull + flowData.totBear)} confirmed premium · No ML/ or Arb Blocks · No deep ITM structures</p>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
          <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${flowData.sTerm.bullPrem > flowData.sTerm.bearPrem ? P.bu : P.be}`}}>
            <div style={{fontSize:11,color:flowData.sTerm.bullPrem > flowData.sTerm.bearPrem ? P.bu : P.be,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>Short-Term Outlook (0-14 DTE)</div>
            <div style={{fontSize:36,fontWeight:900,color:flowData.sTerm.bullPrem > flowData.sTerm.bearPrem ? P.bu : P.be,marginBottom:8}}>
               {flowData.sTerm.bullPrem > flowData.sTerm.bearPrem ? "BULLISH" : "BEARISH"}
            </div>
            <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>Bull {fmt(flowData.sTerm.bullPrem)} vs Bear {fmt(flowData.sTerm.bearPrem)}. {flowData.sTerm.consistB.length>0 ? `Bulls led by ${flowData.sTerm.consistB[0].S} $${flowData.sTerm.consistB[0].K}${flowData.sTerm.consistB[0].CP} hitting ${flowData.sTerm.consistB[0].H}x. ` : ""}{flowData.sTerm.consistR.length>0 ? `Bears led by ${flowData.sTerm.consistR[0].S} $${flowData.sTerm.consistR[0].K}${flowData.sTerm.consistR[0].CP} hitting ${flowData.sTerm.consistR[0].H}x.` : ""}</div>
          </div>
          <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${flowData.lTerm.bullPrem > flowData.lTerm.bearPrem ? P.bu : P.be}`}}>
            <div style={{fontSize:11,color:flowData.lTerm.bullPrem > flowData.lTerm.bearPrem ? P.bu : P.be,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>Long-Term Outlook (15+ DTE)</div>
            <div style={{fontSize:36,fontWeight:900,color:flowData.lTerm.bullPrem > flowData.lTerm.bearPrem ? P.bu : P.be,marginBottom:8}}>
               {flowData.lTerm.bullPrem > flowData.lTerm.bearPrem ? "BULLISH" : "BEARISH"}
            </div>
            <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>Bull {fmt(flowData.lTerm.bullPrem)} vs Bear {fmt(flowData.lTerm.bearPrem)}. {flowData.lTerm.consistB.length>0 ? `Bulls led by ${flowData.lTerm.consistB[0].S} hitting ${flowData.lTerm.consistB[0].H}x. ` : ""}{flowData.lTerm.consistR.length>0 ? `Bears led by ${flowData.lTerm.consistR[0].S} hitting ${flowData.lTerm.consistR[0].H}x.` : ""}</div>
          </div>
        </div>

        <div style={{fontSize:10,fontWeight:700,color:P.dm,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>Top Conviction Strikes</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:12}}>
          {flowData.CONV.map((t,i)=>{const c=t.dir==="BULL"?P.bu:P.be;return <div key={i} style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:8,padding:"10px 12px",borderTop:`2px solid ${c}`}}><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}><span style={{fontSize:14,fontWeight:900,color:P.wh}}>{t.sym}</span>{t.side==="AA"?<Tag c={P.ac}>AA</Tag>:t.side==="BB"?<Tag c={P.be}>BB</Tag>:<Tag c={P.mt}>{t.side||"A"}</Tag>}</div><div style={{fontSize:13,fontWeight:800,color:c}}>{t.strike} <span style={{fontSize:11,fontWeight:700,color:P.wh}}>{t.exp}</span></div><div style={{fontSize:10,color:P.dm,marginTop:4}}><span style={{color:P.ac,fontWeight:700}}>{t.hits}x</span> · {fmt(t.prem)}</div><div style={{marginTop:4}}><Tag c={c}>{t.dir}</Tag></div></div>})}
        </div>

        <div style={{display:"flex",gap:1,marginBottom:14,background:P.al,borderRadius:6,padding:2,width:"fit-content"}}>
          {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"6px 16px",borderRadius:5,border:"none",cursor:"pointer",fontSize:11,fontWeight:600,fontFamily:"inherit",background:tab===t?P.cd:"transparent",color:tab===t?P.wh:P.mt}}>{t}</button>)}
        </div>

        {/* ═══ SEARCH TICKER ═══ */}
        {tab==="Search" && (
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Card>
              <div style={{display: "flex", gap: 14, alignItems: "center"}}>
                <div style={{width:3,background:P.ac,borderRadius:2,alignSelf:"stretch",flexShrink:0}}/>
                <div style={{display: "flex", gap: 10, alignItems: "center"}}>
                  <span style={{fontSize: 14, fontWeight: 800, color: P.wh}}>SEARCH TICKER:</span>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value.toUpperCase())}
                    placeholder="e.g. NVDA"
                    style={{
                      background: P.al, border: `1px solid ${P.bl}`, color: P.wh,
                      padding: "8px 12px", borderRadius: 6, outline: "none", fontSize: 14, fontWeight: 700,
                      textTransform: "uppercase", width: 200
                    }}
                  />
                </div>
              </div>
            </Card>
            
            {searchQuery && (() => {
              const stLive = flowData.liveTrades.filter(r => r.sym === searchQuery);
              const stWhite = flowData.whiteTrades.filter(r => r.S === searchQuery);
              
              if (stLive.length === 0 && stWhite.length === 0) {
                return <Card><div style={{color:P.dm,fontSize:12}}>No flow found for {searchQuery} matching criteria (No ML/, No deep ITM blocks).</div></Card>;
              }

              let tBull = 0, tBear = 0;
              stLive.forEach(r => r.dir === 'BULL' ? tBull += r.prem : tBear += r.prem);
              
              const mappedLive = stLive.sort((a,b) => b.prem - a.prem).map(g => ({
                S: g.sym, Dt: g.date ? g.date.split('/').slice(0,2).join('/') : '', Si: g.side, Co: g.color, Ty: g.type, 
                CP: g.cp ? g.cp[0] : '', K: g.strike, E: g.exp, V: g.vol, P: g.prem, DTE: g.dte, dir: g.dir
              }));
              
              const mappedWhite = stWhite.sort((a,b) => b.P - a.P);

              return (
                <div style={{display:"flex",flexDirection:"column",gap:12}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                    <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${tBull > tBear ? P.bu : tBear > tBull ? P.be : P.dm}`}}>
                      <div style={{fontSize:11,color:tBull > tBear ? P.bu : tBear > tBull ? P.be : P.dm,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>{searchQuery} Confirmed Outlook</div>
                      <div style={{fontSize:36,fontWeight:900,color:tBull > tBear ? P.bu : tBear > tBull ? P.be : P.wh,marginBottom:8}}>
                         {tBull > tBear ? "BULLISH" : tBull < tBear ? "BEARISH" : "NEUTRAL"}
                      </div>
                      <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>Bull {fmt(tBull)} vs Bear {fmt(tBear)}.</div>
                    </div>
                    <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${P.uc}`}}>
                       <div style={{fontSize:11,color:P.uc,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>Unconfirmed Flow</div>
                       <div style={{fontSize:36,fontWeight:900,color:P.uc,marginBottom:8}}>
                         {fmt(stWhite.reduce((s, r) => s + r.P, 0))}
                       </div>
                       <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>{stWhite.length} unconfirmed (WHITE) trades. Requires OI check.</div>
                    </div>
                  </div>
                  <Card title={`Confirmed Trades: ${searchQuery}`}>
                     {mappedLive.length > 0 ? <TT rows={mappedLive} /> : <div style={{fontSize:11,color:P.dm}}>No confirmed trades.</div>}
                  </Card>
                  <Card title={`Unconfirmed Trades (Watchlist): ${searchQuery}`}>
                     {mappedWhite.length > 0 ? <TT rows={mappedWhite} /> : <div style={{fontSize:11,color:P.dm}}>No unconfirmed trades.</div>}
                  </Card>
                </div>
              );
            })()}
          </div>
        )}

        {tab==="Market Read"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card title="Confirmed Daily Flow" sub="Bull vs Bear (live exps only)">
            <div style={{height:200}}><ResponsiveContainer><BarChart data={flowData.DAYS} margin={{top:5,right:8,left:0,bottom:0}}><CartesianGrid strokeDasharray="3 3" stroke={P.bd}/><XAxis dataKey="d" tick={{fill:P.tx,fontSize:10,fontWeight:600}} tickLine={false}/><YAxis tick={{fill:P.mt,fontSize:9}} tickLine={false} axisLine={false} tickFormatter={fmt} width={52}/><Tooltip content={({active,payload,label})=>{if(!active||!payload||!payload.length)return null;return <div style={{background:"#152038",border:`1px solid ${P.bl}`,borderRadius:6,padding:"8px 12px",fontSize:11}}><div style={{color:P.dm,fontWeight:600,marginBottom:4}}>{label}</div>{payload.map((p,i)=><div key={i} style={{color:p.color,display:"flex",gap:8,justifyContent:"space-between"}}><span>{p.name}</span><span style={{fontWeight:700,fontFamily:"monospace"}}>{fmt(Math.abs(p.value))}</span></div>)}</div>}}/><Bar dataKey="b" name="Bullish" fill={P.bu} radius={[3,3,0,0]} barSize={20}/><Bar dataKey="r" name="Bearish" fill={P.be} radius={[3,3,0,0]} barSize={20}/></BarChart></ResponsiveContainer></div>
          </Card>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Card title="Short-Term Bullish" sub="0-14 DTE"><NC data={flowData.sTerm.symB} fill={P.bu} dir="bull"/></Card>
            <Card title="Short-Term Bearish" sub="0-14 DTE"><NC data={flowData.sTerm.symR} fill={P.be} dir="bear"/></Card>
            <Card title="Long-Term Bullish" sub="15+ DTE"><NC data={flowData.lTerm.symB} fill={P.bu} dir="bull"/></Card>
            <Card title="Long-Term Bearish" sub="15+ DTE"><NC data={flowData.lTerm.symR} fill={P.be} dir="bear"/></Card>
          </div>
        </div>}

        {/* ═══ PERFORMANCE ═══ */}
        {tab==="Performance"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card>
            <div style={{display:"flex",gap:14,alignItems:"center"}}>
              <div style={{width:3,background:P.ac,borderRadius:2,alignSelf:"stretch",flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:P.ac,marginBottom:5}}>Contract Performance Tracker</div>
                <div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>
                  Entry is the contract price from the largest trade on each strike. Range shows the low-high across all hits.
                </div>
              </div>
              <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:4}}>
                <button
                  onClick={fetchPrices}
                  disabled={loading}
                  style={{
                    padding:"8px 20px",borderRadius:6,border:"none",cursor:loading?"not-allowed":"pointer",
                    fontSize:11,fontWeight:700,fontFamily:"inherit",letterSpacing:0.5,
                    background:loading?P.bd:P.ac,color:loading?P.dm:P.bg,
                    opacity:loading?0.6:1,
                  }}
                >{loading ? "Fetching..." : "Simulate Refresh Prices"}</button>
                {status && <span style={{fontSize:9,color:loading?P.ac:P.dm}}>{status}</span>}
              </div>
            </div>
          </Card>
          {["Conviction","Short Bull","Short Bear","Long Bull","Long Bear","LEAPS Bull","LEAPS Bear"].map(cat => {
            const items = perf.filter(p => p.cat === cat);
            if (items.length === 0) return null;
            const catColor = cat.includes("Bull") ? P.bu : cat.includes("Bear") ? P.be : P.ac;
            return (
              <Card key={cat} title={cat} sub={`${items.length} contracts`} col={catColor}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}>
                  <thead>
                    <tr style={{borderBottom:`1px solid ${P.bd}`}}>
                      {["Ticker","C/P","Strike","Exp","Hits","Entry","Range","Now","P&L","P&L %","Dir"].map(h =>
                        <th key={h} style={{padding:"5px 5px",textAlign:"left",color:P.mt,fontSize:9,fontWeight:600}}>{h}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r,i) => {
                      const curr = r.now || 0;
                      const pnl = curr > 0 ? curr - r.entry : 0;
                      const pnlPct = curr > 0 && r.entry > 0 ? ((curr - r.entry) / r.entry * 100) : 0;
                      const pnlColor = pnl > 0 ? P.bu : pnl < 0 ? P.be : P.dm;
                      return (
                        <tr key={r.id} style={{borderBottom:`1px solid ${P.bd}10`}}>
                          <td style={{padding:"5px 5px",fontWeight:800,color:P.wh}}>{r.sym}</td>
                          <td style={{padding:"5px 5px"}}><Tag c={r.cp==="C"?P.bu:P.be}>{r.cp}</Tag></td>
                          <td style={{padding:"5px 5px",fontWeight:800,color:P.wh}}>${r.strike}</td>
                          <td style={{padding:"5px 5px",fontWeight:800,color:P.wh}}>{r.exp}</td>
                          <td style={{padding:"5px 5px"}}><span style={{fontWeight:800,color:r.hits>=10?P.ac:r.hits>=5?P.ye:P.dm}}>{r.hits}x</span></td>
                          <td style={{padding:"5px 5px",fontWeight:700,color:P.wh}}>${r.entry.toFixed(2)}</td>
                          <td style={{padding:"5px 5px",fontSize:9,color:P.mt}}>${r.lo && r.lo !== r.hi ? `${r.lo.toFixed(2)}-${r.hi.toFixed(2)}` : "—"}</td>
                          <td style={{padding:"5px 5px"}}>
                            <input
                              type="number"
                              step="0.01"
                              value={curr || ""}
                              placeholder="—"
                              onChange={e => {
                                const v = parseFloat(e.target.value) || 0;
                                setPerf(prev => prev.map(p => p.id === r.id ? {...p, now: v} : p));
                              }}
                              style={{
                                width:70,padding:"3px 6px",borderRadius:4,fontSize:10,fontWeight:700,
                                background:P.al,border:`1px solid ${P.bl}`,color:P.wh,fontFamily:"inherit",
                                outline:"none",
                              }}
                            />
                          </td>
                          <td style={{padding:"5px 5px",fontWeight:700,color:pnlColor}}>
                            {curr > 0 ? `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)}` : "—"}
                          </td>
                          <td style={{padding:"5px 5px",fontWeight:700,color:pnlColor}}>
                            {curr > 0 ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%` : "—"}
                          </td>
                          <td style={{padding:"5px 5px"}}><Tag c={r.dir==="BULL"?P.bu:P.be}>{r.dir}</Tag></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </Card>
            );
          })}
        </div>}

        {tab==="Short Term"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Card title="Bullish Bets" sub="0-14 DTE"><NC data={flowData.sTerm.symB} fill={P.bu} dir="bull"/></Card>
            <Card title="Bearish Bets" sub="0-14 DTE"><NC data={flowData.sTerm.symR} fill={P.be} dir="bear"/></Card>
          </div>
          <Card title="Short-Term Bullish Trades"><TT rows={flowData.sTerm.tradesB}/></Card>
          <Card title="Short-Term Bearish Trades"><TT rows={flowData.sTerm.tradesR}/></Card>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Card title="Bullish Consistency" sub="2+ hits"><CT rows={flowData.sTerm.consistB}/></Card>
            <Card title="Bearish Consistency" sub="2+ hits"><CT rows={flowData.sTerm.consistR}/></Card>
          </div>
        </div>}

        {tab==="Long Term"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Card title="Bullish Bets" sub="15+ DTE"><NC data={flowData.lTerm.symB} fill={P.bu} dir="bull"/></Card>
            <Card title="Bearish Bets" sub="15+ DTE"><NC data={flowData.lTerm.symR} fill={P.be} dir="bear"/></Card>
          </div>
          <Card title="Long-Term Bullish Trades"><TT rows={flowData.lTerm.tradesB}/></Card>
          <Card title="Long-Term Bearish Trades"><TT rows={flowData.lTerm.tradesR}/></Card>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Card title="Bullish Consistency" sub="2+ hits"><CT rows={flowData.lTerm.consistB}/></Card>
            <Card title="Bearish Consistency" sub="2+ hits"><CT rows={flowData.lTerm.consistR}/></Card>
          </div>
        </div>}

        {tab==="LEAPS"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${flowData.lpTerm.bullPrem > flowData.lpTerm.bearPrem ? P.bu : P.be}`}}>
              <div style={{fontSize:11,color:flowData.lpTerm.bullPrem > flowData.lpTerm.bearPrem ? P.bu : P.be,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>LEAPS Bull Side</div>
              <div style={{fontSize:24,fontWeight:900,color:flowData.lpTerm.bullPrem > flowData.lpTerm.bearPrem ? P.bu : P.be,marginBottom:4}}>{fmt(flowData.lpTerm.bullPrem)}</div>
            </div>
            <div style={{background:P.cd,border:`1px solid ${P.bd}`,borderRadius:10,padding:20,borderLeft:`4px solid ${flowData.lpTerm.bullPrem > flowData.lpTerm.bearPrem ? P.be : P.bu}`}}>
              <div style={{fontSize:11,color:flowData.lpTerm.bullPrem > flowData.lpTerm.bearPrem ? P.be : P.bu,fontWeight:700,letterSpacing:2,marginBottom:6,textTransform:"uppercase"}}>LEAPS Bear Side</div>
              <div style={{fontSize:24,fontWeight:900,color:flowData.lpTerm.bullPrem > flowData.lpTerm.bearPrem ? P.be : P.bu,marginBottom:4}}>{fmt(flowData.lpTerm.bearPrem)}</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Card title="Bullish Bets" sub="180+ DTE"><NC data={flowData.lpTerm.symB} fill={P.bu} dir="bull"/></Card>
            <Card title="Bearish Bets" sub="180+ DTE"><NC data={flowData.lpTerm.symR} fill={P.be} dir="bear"/></Card>
          </div>
          <Card title="LEAPS Bullish Trades"><TT rows={flowData.lpTerm.tradesB}/></Card>
          <Card title="LEAPS Bearish Trades"><TT rows={flowData.lpTerm.tradesR}/></Card>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Card title="Bull Consistency" sub="2+ hits"><CT rows={flowData.lpTerm.consistB}/></Card>
            <Card title="Bear Consistency" sub="2+ hits"><CT rows={flowData.lpTerm.consistR}/></Card>
          </div>
        </div>}

        {tab==="OI Watchlist"&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
          <Card><div style={{display:"flex",gap:14}}><div style={{width:3,background:P.uc,borderRadius:2,alignSelf:"stretch",flexShrink:0}}/><div><div style={{fontSize:13,fontWeight:700,color:P.uc,marginBottom:5}}>OI Check Needed</div><div style={{fontSize:11,color:P.dm,lineHeight:1.7}}>{flowData.whiteCount} unconfirmed trades this week. Check OI changes to confirm direction.</div></div></div></Card>
          <Card title="OI Watchlist" sub="Top unconfirmed by premium">
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:10}}><thead><tr style={{borderBottom:`1px solid ${P.bd}`}}>{["Ticker","C/P","Strike","Exp","Type","Side","Vol","OI","Premium","Vol/OI"].map(h=><th key={h} style={{padding:"5px 4px",textAlign:"left",color:P.mt,fontSize:9,fontWeight:600}}>{h}</th>)}</tr></thead><tbody>{flowData.WATCH.map((r,i)=>{const pct=r.OI>0?Math.round(r.V/r.OI*100):999;return <tr key={i} style={{borderBottom:`1px solid ${P.bd}10`}}><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.S}</td><td style={{padding:"5px 4px"}}><Tag c={r.CP==="C"?P.bu:P.be}>{r.CP}</Tag></td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>${r.K}</td><td style={{padding:"5px 4px",fontWeight:800,color:P.wh}}>{r.E}</td><td style={{padding:"5px 4px"}}><Tag c={tc(r.Ty)}>{r.Ty}</Tag></td><td style={{padding:"5px 4px"}}>{r.Si==="BB"?<Tag c={P.be}>BB</Tag>:r.Si==="AA"?<Tag c={P.ac}>AA</Tag>:r.Si==="B"?<Tag c={P.sw}>BID</Tag>:<Tag c={P.mt}>{r.Si||"A"}</Tag>}</td><td style={{padding:"5px 4px",color:P.dm}}>{fK(r.V)}</td><td style={{padding:"5px 4px",color:P.dm}}>{fK(r.OI)}</td><td style={{padding:"5px 4px",fontWeight:700,color:P.wh}}>{fmt(r.P)}</td><td style={{padding:"5px 4px",fontWeight:600,color:pct>=80?P.ac:pct>=50?P.ye:P.dm}}>{pct}%</td></tr>})}</tbody></table>
          </Card>
        </div>}

        <div style={{marginTop:16,padding:"10px 0",borderTop:`1px solid ${P.bd}`,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:9,color:P.mt}}>Flow Data Uploaded Automatically</span><span style={{fontSize:9,color:P.mt}}>YELLOW/MAG = confirmed · WHITE = check OI</span></div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <DashboardErrorBoundary>
      <OptionsFlowDashboardUI />
    </DashboardErrorBoundary>
  );
}
