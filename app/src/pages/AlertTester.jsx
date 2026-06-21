/**
 * app/src/pages/AlertTester.jsx
 *
 * UCT Alert Tester — permanent admin page for tuning custom-alert settings
 * before saving them to Bullflow. Upload a Bullflow CSV, edit any filter
 * config, see exactly what would have fired through the full UCT pipeline
 * (Bullflow filter -> dedup -> grade -> Discord gate).
 *
 * NEVER posts to Discord. NEVER touches production state.
 *
 * Open at: https://uctintelligence.com/alert-tester
 */

import React, { useEffect, useMemo, useRef, useState } from "react";

const P = {
  bg:  "#0a0e1a",
  card:"#11162400",
  cardBorder: "#1f2a40",
  text:"#e6e9ef",
  dim: "#8b95a8",
  mt:  "#9aa4b8",
  ac:  "#c9a84c",
  bu:  "#3cb868",
  be:  "#ed4953",
  ye:  "#f5b033",
  bl:  "#1a2030",
  al:  "#0e1320",
  bd:  "#1f2a40",
  wh:  "#ffffff",
};

const GRADE_COLOR = { "A+":"#c9a84c", "A":"#3cb868", "B+":"#69b0d3", "B":"#5d7896", "C":"#9aa4b8", "D":"#6a7080" };

// Default config used when no alert is loaded
const DEFAULT_CFG = {
  alertName: "Custom Test",
  minPremium: 1000000, maxPremium: 5000000000,
  minDTE: 5, maxDTE: 1095,
  callsCheckBox: true, putsCheckBox: true,
  bullishCheckBox: true, bearishCheckBox: true, neutralCheckBox: false,
  aaCheckBox: true, bbCheckBox: false,
  sweepsCheckBox: true, blocksCheckbox: false,
  singlesCheckbox: false, splitsCheckBox: false, multilegCheckbox: false,
  minStrike: 0, maxStrike: 15000,
  minIV: 0, maxIV: 500,
  minCurrentVolume: 0, maxCurrentVolume: 100000,
  minOI: 0, maxOI: 1000000,
  minSpot: 0, maxSpot: 10000,
  minOptionPrice: 0, maxOptionPrice: 1000000,
  minTradeSize: 0, maxTradeSize: 1000000,
  minOTM: -3000, maxOTM: 3000,
  minScore: 0, maxScore: 1,
  minVolumeExceedsOIBy: -100, maxVolumeExceedsOIBy: 1000000000,
  excludeTickers: [], onlyShowTickers: [],
};

const ALL_UCT_ALERTS = [
  "UCT Alpha Gold","UCT Bullish","UCT Bearish","UCT Bullish Leaps","UCT Bearish Leaps",
  "UCT Leaps","UCT Size Bulls","UCT Size Bears","UCT Vol>OI","UCT Unusual",
];

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

function Card({ title, children, headerRight }) {
  return (
    <div style={{ background:P.bl, border:"1px solid "+P.cardBorder, borderRadius:10, padding:16, marginBottom:16 }}>
      {title && (
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:800, color:P.ac, letterSpacing:1, textTransform:"uppercase" }}>{title}</div>
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}

function NumField({ label, value, onChange, step=1, hint }) {
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <span style={{ fontSize:9, color:P.dim, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</span>
      <input type="number" value={value} step={step}
        onChange={e=>onChange(Number(e.target.value))}
        style={{ background:P.al, border:"1px solid "+P.bd, borderRadius:5, color:P.text, padding:"6px 8px", fontSize:11, fontFamily:"ui-monospace,monospace" }}/>
      {hint && <span style={{ fontSize:8, color:P.dim }}>{hint}</span>}
    </label>
  );
}

function CB({ label, checked, onChange, color = P.ac }) {
  return (
    <label style={{ display:"flex", alignItems:"center", gap:6, cursor:"pointer", padding:"4px 8px",
                    background: checked ? color+"22" : "transparent",
                    border:"1px solid "+(checked ? color : P.bd), borderRadius:5, fontSize:10, fontWeight:600 }}>
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} style={{ accentColor:color }}/>
      <span style={{ color: checked ? color : P.dim }}>{label}</span>
    </label>
  );
}

function TickerList({ label, value, onChange }) {
  const text = (value || []).join(", ");
  return (
    <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
      <span style={{ fontSize:9, color:P.dim, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>{label}</span>
      <input type="text" value={text}
        onChange={e=>onChange(e.target.value.split(/[\s,]+/).map(s=>s.trim().toUpperCase()).filter(Boolean))}
        placeholder="AAPL, MSFT, …"
        style={{ background:P.al, border:"1px solid "+P.bd, borderRadius:5, color:P.text, padding:"6px 8px", fontSize:11, fontFamily:"ui-monospace,monospace" }}/>
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function AlertTester() {
  const [csvFile, setCsvFile] = useState(null);
  const [csvDragOver, setCsvDragOver] = useState(false);
  const [liveConfigs, setLiveConfigs] = useState(null);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState("UCT Alpha Gold");
  const [cfg, setCfg] = useState({ ...DEFAULT_CFG, alertName: "UCT Alpha Gold" });
  const [minDiscordGrade, setMinDiscordGrade] = useState("B");
  const [dedupSec, setDedupSec] = useState(60);
  const [repeatSec, setRepeatSec] = useState(600);
  const [maxPerTicker, setMaxPerTicker] = useState(0);
  const [minRepeatFires, setMinRepeatFires] = useState(0);
  const [comboMinPremium, setComboMinPremium] = useState(0);
  const [comboWindowSec, setComboWindowSec] = useState(900);
  const [running, setRunning] = useState(false);
  // Backfill to SQLite (Option B) — writes CSV-derived alerts into live_alerts_v1
  // so the Live Flow history view (/live-flow?from=DATE&to=DATE) shows the
  // complete day even when MCP backfill missed alerts (100/day cap).
  const [backfilling, setBackfilling] = useState(false);
  const [backfillResult, setBackfillResult] = useState(null);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [showGated, setShowGated] = useState(false);
  const [showDrops, setShowDrops] = useState(false);
  const fileRef = useRef(null);

  // Fetch live configs from Bullflow MCP
  async function loadLiveConfigs() {
    setLoadingConfigs(true); setError(null);
    try {
      const r = await fetch("/api/admin/alert-tester/configs");
      if (!r.ok) throw new Error(`Configs fetch failed: HTTP ${r.status}`);
      const data = await r.json();
      const alerts = data.alerts || [];
      setLiveConfigs(alerts);
      // Auto-populate currently selected alert
      const found = alerts.find(a => a.alertName === selectedAlert);
      if (found) setCfg({ ...DEFAULT_CFG, ...found });
    } catch (e) {
      setError(e.message + " (Hint: paste config manually from /api/admin/bullflow/custom in another tab)");
    } finally {
      setLoadingConfigs(false);
    }
  }

  // When user changes alert picker, load that alert's config if we have it
  useEffect(() => {
    if (!liveConfigs) {
      setCfg(c => ({ ...c, alertName: selectedAlert }));
      return;
    }
    const found = liveConfigs.find(a => a.alertName === selectedAlert);
    if (found) setCfg({ ...DEFAULT_CFG, ...found });
    else setCfg({ ...DEFAULT_CFG, alertName: selectedAlert });
  }, [selectedAlert]);

  // CSV drag-drop handlers
  function handleFile(f) {
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setError("File must be .csv (Bullflow daily export)"); return;
    }
    setError(null);
    setCsvFile(f);
  }
  function onDrop(e) {
    e.preventDefault(); setCsvDragOver(false);
    const f = e.dataTransfer?.files?.[0]; handleFile(f);
  }

  // Run simulation
  async function runSimulation() {
    if (!csvFile) { setError("Upload a Bullflow CSV first."); return; }
    setRunning(true); setError(null); setResults(null);
    try {
      const fd = new FormData();
      fd.append("csv_file", csvFile);
      fd.append("alert_config", JSON.stringify(cfg));
      fd.append("min_discord_grade", minDiscordGrade);
      fd.append("dedup_window_sec", String(dedupSec));
      fd.append("repeat_window_sec", String(repeatSec));
      fd.append("max_alerts_per_ticker", String(maxPerTicker));
      fd.append("min_repeat_fires", String(minRepeatFires));
      fd.append("combo_min_combined_premium", String(comboMinPremium));
      fd.append("combo_window_sec", String(comboWindowSec));
      const r = await fetch("/api/admin/alert-tester/simulate", { method:"POST", body: fd });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Simulate failed: HTTP ${r.status} ${txt.slice(0,200)}`);
      }
      const data = await r.json();
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setRunning(false);
    }
  }

  // Quick-reset config to current alert's live config
  function resetToLive() {
    if (!liveConfigs) { setError("Click 'Load Live Config' first"); return; }
    const found = liveConfigs.find(a => a.alertName === selectedAlert);
    if (found) setCfg({ ...DEFAULT_CFG, ...found });
  }

  // Backfill the current CSV to live_alerts_v1 SQLite — used for historical
  // days where MCP backfill was incomplete. Sends ALL liveConfigs (not just
  // the selected alert) so the entire day's UCT alert pipeline gets captured.
  // Idempotent: re-running on the same date silently skips duplicate IDs.
  //
  // FALLBACK: if Load Live Configs failed (returns 0), backfill the current
  // edited config only. User can repeat for each of the 10 alerts manually.
  async function backfillToSqlite() {
    if (!csvFile) { setError("Upload a Bullflow CSV first."); return; }

    // Decide which configs to send. Three cases:
    //   A) liveConfigs loaded all 10 → send them all (one-click full backfill)
    //   B) liveConfigs empty → send just the current edited cfg (single-alert)
    //   C) cfg.alertName missing → bail
    const useFullList = liveConfigs && liveConfigs.length > 0;
    const configsToSend = useFullList
      ? liveConfigs
      : [{ ...cfg, alertName: cfg.alertName || selectedAlert }];

    if (!configsToSend[0].alertName) {
      setError("No alert config available. Pick an alert from the dropdown first.");
      return;
    }

    // Derive date from CSV filename if it follows Bullflow_M_DD.csv pattern,
    // otherwise prompt. Common patterns: Bullflow_6_18.csv → 2026-06-18.
    let csvDate = null;
    const m = csvFile.name.match(/(\d{1,2})[_-](\d{1,2})/);
    if (m) {
      const y = new Date().getFullYear();
      csvDate = `${y}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
    }
    const dateInput = window.prompt(
      "Trade date (YYYY-MM-DD) for this CSV:",
      csvDate || ""
    );
    if (!dateInput || !/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      setError("Backfill canceled — invalid or missing date.");
      return;
    }

    const confirmMsg = useFullList
      ? `Backfill ALL ${configsToSend.length} alert configs against ${csvFile.name} ` +
        `into SQLite for date ${dateInput}?\n\n` +
        `This writes alerts to live_alerts_v1. Visit /live-flow?from=${dateInput}&to=${dateInput} afterwards.`
      : `Load Live Configs returned 0 — backfilling just the CURRENTLY EDITED alert.\n\n` +
        `Alert: ${configsToSend[0].alertName}\n` +
        `Date:  ${dateInput}\n` +
        `CSV:   ${csvFile.name}\n\n` +
        `To get all 10 alerts in, you'll repeat this for each alert in the dropdown ` +
        `(change selection, edit filter to match Bullflow, click backfill again). ` +
        `Or fix Load Live Configs first.\n\n` +
        `Proceed with single-alert backfill?`;
    if (!window.confirm(confirmMsg)) return;

    setBackfilling(true); setError(null); setBackfillResult(null);
    try {
      const fd = new FormData();
      fd.append("csv_file", csvFile);
      fd.append("alert_configs", JSON.stringify(configsToSend));
      fd.append("date", dateInput);
      const r = await fetch("/api/admin/live/ingest-bullflow-csv", { method:"POST", body: fd });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`Backfill failed: HTTP ${r.status} ${txt.slice(0,200)}`);
      }
      const data = await r.json();
      setBackfillResult(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBackfilling(false);
    }
  }

  const fmt$ = (n) => {
    const a = Math.abs(n||0);
    if (a >= 1e6) return "$"+(a/1e6).toFixed(2)+"M";
    if (a >= 1e3) return "$"+(a/1e3).toFixed(0)+"K";
    return "$"+a.toFixed(0);
  };

  return (
    <div style={{ minHeight:"100vh", background:P.bg, color:P.text, fontFamily:"-apple-system,BlinkMacSystemFont,'SF Pro Text','Inter',system-ui,sans-serif", padding:"16px 24px" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20 }}>
        <div style={{ display:"flex", alignItems:"center", gap:16 }}>
          <a href="/" style={{ color:P.dim, fontSize:11, textDecoration:"none" }}>← Dashboard</a>
          <div style={{ fontSize:18, fontWeight:900, letterSpacing:2, color:P.text }}>ALERT TESTER</div>
          <span style={{ fontSize:9, fontWeight:800, color:P.ac, background:P.ac+"22", padding:"3px 8px", borderRadius:4 }}>TEST-ONLY · NO DISCORD</span>
        </div>
      </div>

      {error && (
        <div style={{ background:P.be+"22", border:"1px solid "+P.be, color:P.be, padding:12, borderRadius:6, marginBottom:16, fontSize:11 }}>
          {error}
        </div>
      )}

      {/* Step 1: CSV upload */}
      <Card title="1 · Upload Bullflow CSV">
        <div onDragOver={e=>{e.preventDefault();setCsvDragOver(true);}}
             onDragLeave={()=>setCsvDragOver(false)}
             onDrop={onDrop}
             onClick={()=>fileRef.current?.click()}
             style={{
               border: "2px dashed "+(csvDragOver?P.ac:P.bd),
               background: csvDragOver?P.ac+"11":"transparent",
               borderRadius:8, padding:24, textAlign:"center", cursor:"pointer",
               transition:"all 0.15s ease",
             }}>
          <input ref={fileRef} type="file" accept=".csv" style={{ display:"none" }}
                 onChange={e=>handleFile(e.target.files?.[0])}/>
          {csvFile ? (
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:P.ac, marginBottom:4 }}>✓ {csvFile.name}</div>
              <div style={{ fontSize:10, color:P.dim }}>{(csvFile.size/1024).toFixed(1)} KB — click to replace, or drop another</div>
            </div>
          ) : (
            <div>
              <div style={{ fontSize:14, color:P.text, marginBottom:6 }}>Drop Bullflow CSV here, or click to browse</div>
              <div style={{ fontSize:9, color:P.dim }}>Export the daily flow from Bullflow's UI as CSV. Up to 50 MB.</div>
            </div>
          )}
        </div>
      </Card>

      {/* Step 2: Alert picker */}
      <Card title="2 · Pick alert to test" headerRight={
        <button onClick={loadLiveConfigs} disabled={loadingConfigs}
          style={{ background:P.ac, color:P.bg, border:"none", padding:"6px 14px", borderRadius:5, fontSize:10, fontWeight:700, cursor:loadingConfigs?"wait":"pointer" }}>
          {loadingConfigs ? "Loading..." : "↻ Load Live Configs"}
        </button>
      }>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <select value={selectedAlert} onChange={e=>setSelectedAlert(e.target.value)}
            style={{ background:P.al, border:"1px solid "+P.bd, color:P.text, padding:"6px 10px", borderRadius:5, fontSize:11, minWidth:200 }}>
            {ALL_UCT_ALERTS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <button onClick={resetToLive} disabled={!liveConfigs}
            style={{ background:"transparent", color:P.dim, border:"1px solid "+P.bd, padding:"6px 12px", borderRadius:5, fontSize:10, fontWeight:600, cursor: liveConfigs?"pointer":"not-allowed" }}>
            ↺ Reset to live config
          </button>
          {liveConfigs && (
            <span style={{ fontSize:9, color:P.dim }}>
              {liveConfigs.length} alerts loaded from Bullflow MCP
            </span>
          )}
        </div>
      </Card>

      {/* Step 3: Filter form */}
      <Card title="3 · Bullflow filter settings (editable)">
        {/* Premium + DTE */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10, marginBottom:14 }}>
          <NumField label="Min Premium ($)" value={cfg.minPremium} onChange={v=>setCfg({...cfg, minPremium:v})} step={50000} hint={fmt$(cfg.minPremium)}/>
          <NumField label="Max Premium ($)" value={cfg.maxPremium} onChange={v=>setCfg({...cfg, maxPremium:v})} step={1000000} hint={fmt$(cfg.maxPremium)}/>
          <NumField label="Min DTE" value={cfg.minDTE} onChange={v=>setCfg({...cfg, minDTE:v})}/>
          <NumField label="Max DTE" value={cfg.maxDTE} onChange={v=>setCfg({...cfg, maxDTE:v})}/>
        </div>

        {/* Option type / Direction / Side */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:9, color:P.dim, fontWeight:700, marginBottom:6, textTransform:"uppercase" }}>Option Type</div>
            <div style={{ display:"flex", gap:6 }}>
              <CB label="Calls" checked={cfg.callsCheckBox} onChange={v=>setCfg({...cfg, callsCheckBox:v})} color={P.bu}/>
              <CB label="Puts" checked={cfg.putsCheckBox} onChange={v=>setCfg({...cfg, putsCheckBox:v})} color={P.be}/>
            </div>
          </div>
          <div>
            <div style={{ fontSize:9, color:P.dim, fontWeight:700, marginBottom:6, textTransform:"uppercase" }}>Direction</div>
            <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
              <CB label="Bullish" checked={cfg.bullishCheckBox} onChange={v=>setCfg({...cfg, bullishCheckBox:v})} color={P.bu}/>
              <CB label="Bearish" checked={cfg.bearishCheckBox} onChange={v=>setCfg({...cfg, bearishCheckBox:v})} color={P.be}/>
              <CB label="Neutral" checked={cfg.neutralCheckBox} onChange={v=>setCfg({...cfg, neutralCheckBox:v})}/>
            </div>
          </div>
          <div>
            <div style={{ fontSize:9, color:P.dim, fontWeight:700, marginBottom:6, textTransform:"uppercase" }}>Side</div>
            <div style={{ display:"flex", gap:6 }}>
              <CB label="Ask" checked={cfg.aaCheckBox} onChange={v=>setCfg({...cfg, aaCheckBox:v})}/>
              <CB label="Bid" checked={cfg.bbCheckBox} onChange={v=>setCfg({...cfg, bbCheckBox:v})}/>
            </div>
          </div>
        </div>

        {/* Trade Type */}
        <div style={{ marginBottom:14 }}>
          <div style={{ fontSize:9, color:P.dim, fontWeight:700, marginBottom:6, textTransform:"uppercase" }}>Trade Type</div>
          <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
            <CB label="Sweeps" checked={cfg.sweepsCheckBox} onChange={v=>setCfg({...cfg, sweepsCheckBox:v})}/>
            <CB label="Blocks" checked={cfg.blocksCheckbox} onChange={v=>setCfg({...cfg, blocksCheckbox:v})}/>
            <CB label="Singles" checked={cfg.singlesCheckbox} onChange={v=>setCfg({...cfg, singlesCheckbox:v})}/>
            <CB label="Splits" checked={cfg.splitsCheckBox} onChange={v=>setCfg({...cfg, splitsCheckBox:v})}/>
            <CB label="Multileg" checked={cfg.multilegCheckbox} onChange={v=>setCfg({...cfg, multilegCheckbox:v})}/>
          </div>
        </div>

        {/* Numeric ranges */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10, marginBottom:14 }}>
          <NumField label="Min OTM %" value={cfg.minOTM} onChange={v=>setCfg({...cfg, minOTM:v})}/>
          <NumField label="Max OTM %" value={cfg.maxOTM} onChange={v=>setCfg({...cfg, maxOTM:v})}/>
          <NumField label="Min IV" value={cfg.minIV} onChange={v=>setCfg({...cfg, minIV:v})}/>
          <NumField label="Max IV" value={cfg.maxIV} onChange={v=>setCfg({...cfg, maxIV:v})}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10, marginBottom:14 }}>
          <NumField label="Min OI" value={cfg.minOI} onChange={v=>setCfg({...cfg, minOI:v})}/>
          <NumField label="Max OI" value={cfg.maxOI} onChange={v=>setCfg({...cfg, maxOI:v})}/>
          <NumField label="Min Volume" value={cfg.minCurrentVolume} onChange={v=>setCfg({...cfg, minCurrentVolume:v})}/>
          <NumField label="Max Volume" value={cfg.maxCurrentVolume} onChange={v=>setCfg({...cfg, maxCurrentVolume:v})}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10, marginBottom:14 }}>
          <NumField label="Min Spot ($)" value={cfg.minSpot} onChange={v=>setCfg({...cfg, minSpot:v})}/>
          <NumField label="Max Spot ($)" value={cfg.maxSpot} onChange={v=>setCfg({...cfg, maxSpot:v})}/>
          <NumField label="Min Strike ($)" value={cfg.minStrike} onChange={v=>setCfg({...cfg, minStrike:v})}/>
          <NumField label="Max Strike ($)" value={cfg.maxStrike} onChange={v=>setCfg({...cfg, maxStrike:v})}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:10, marginBottom:14 }}>
          <NumField label="Min Trade Size" value={cfg.minTradeSize} onChange={v=>setCfg({...cfg, minTradeSize:v})}/>
          <NumField label="Max Trade Size" value={cfg.maxTradeSize} onChange={v=>setCfg({...cfg, maxTradeSize:v})}/>
          <NumField label="Min Score" value={cfg.minScore} step={0.01} onChange={v=>setCfg({...cfg, minScore:v})}/>
          <NumField label="Max Score" value={cfg.maxScore} step={0.01} onChange={v=>setCfg({...cfg, maxScore:v})}/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10, marginBottom:14 }}>
          <NumField label="Min Vol Exceeds OI By" value={cfg.minVolumeExceedsOIBy} onChange={v=>setCfg({...cfg, minVolumeExceedsOIBy:v})}/>
          <NumField label="Max Vol Exceeds OI By" value={cfg.maxVolumeExceedsOIBy} onChange={v=>setCfg({...cfg, maxVolumeExceedsOIBy:v})}/>
        </div>

        {/* Ticker lists */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
          <TickerList label="Only show tickers" value={cfg.onlyShowTickers} onChange={v=>setCfg({...cfg, onlyShowTickers:v})}/>
          <TickerList label="Exclude tickers" value={cfg.excludeTickers} onChange={v=>setCfg({...cfg, excludeTickers:v})}/>
        </div>
      </Card>

      {/* Step 4: UCT pipeline settings */}
      <Card title="4 · UCT pipeline settings (post-Bullflow)">
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:10, marginBottom:10 }}>
          <label style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <span style={{ fontSize:9, color:P.dim, fontWeight:700, textTransform:"uppercase", letterSpacing:0.5 }}>Min Discord Grade</span>
            <select value={minDiscordGrade} onChange={e=>setMinDiscordGrade(e.target.value)}
              style={{ background:P.al, border:"1px solid "+P.bd, color:P.text, padding:"6px 10px", borderRadius:5, fontSize:11 }}>
              <option value="A+">A+ only</option>
              <option value="A">A and above</option>
              <option value="B+">B+ and above</option>
              <option value="B">B and above (production default)</option>
              <option value="C">C and above (everything)</option>
            </select>
            <span style={{ fontSize:8, color:P.dim }}>Determines which graded alerts get pushed to Discord</span>
          </label>
          <NumField label="Dedup window (sec)" value={dedupSec} onChange={setDedupSec} hint="Same contract within window keeps only highest premium"/>
          <NumField label="Repeat-fires window (sec)" value={repeatSec} onChange={setRepeatSec} hint="Window for counting multi-fires on same contract. 600s = 10 min."/>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10, marginBottom:10 }}>
          <NumField label="Min repeat fires ('2X' filter)" value={minRepeatFires} onChange={setMinRepeatFires}
            hint={minRepeatFires<=1?"0 or 1 = off. Set to 2 for institutional follow-through (only emit when a contract had ≥2 large hits in window)":`Only emit alerts on contracts with ≥${minRepeatFires} fires in repeat window`}/>
          <NumField label="Max alerts per ticker" value={maxPerTicker} onChange={setMaxPerTicker}
            hint={maxPerTicker===0?"0 = unlimited. Set to 1 for 'one alert per ticker'":`${maxPerTicker} alert(s) max per ticker · highest grade wins`}/>
        </div>
        {/* Sweep+Block combo detector — stealth accumulation across trade types */}
        <div style={{ background:P.al, border:"1px dashed "+P.ac, borderRadius:6, padding:12 }}>
          <div style={{ fontSize:9, fontWeight:800, color:P.ac, marginBottom:8, letterSpacing:0.5, textTransform:"uppercase" }}>
            Sweep + Block Combo Detector (stealth-accumulation rule)
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2, 1fr)", gap:10 }}>
            <NumField label="Combo min combined premium ($)" value={comboMinPremium} onChange={setComboMinPremium} step={250000}
              hint={comboMinPremium===0?"0 = OFF. Set to e.g. 2500000 to fire Alpha Gold when a SWEEP + BLOCK on the same contract combine to ≥$2.5M":`When ≥$${(comboMinPremium/1e6).toFixed(2)}M combined of sweeps+blocks hit one contract within window → emit COMBO alert`}/>
            <NumField label="Combo window (sec)" value={comboWindowSec} onChange={setComboWindowSec}
              hint="Time window in which sweep and block must both occur. 900s = 15 min."/>
          </div>
          <div style={{ marginTop:8, fontSize:9, color:P.dim, lineHeight:1.5 }}>
            Detects institutional stealth accumulation: a sweep followed by (or preceded by) a block
            on the same contract, where their combined premium meets the threshold. Individual trades
            can be below the alert's normal floor — the combo's combined size is what counts.
            Bypasses the alert's trade-type filter. Tagged "COMBO" in results.
          </div>
        </div>
      </Card>

      {/* Run */}
      <div style={{ display:"flex", justifyContent:"center", gap:12, marginBottom:24, alignItems:"center", flexWrap:"wrap" }}>
        <button onClick={runSimulation} disabled={running || !csvFile}
          style={{ background: running||!csvFile?P.dim:P.bu, color:P.bg, border:"none", padding:"12px 32px", borderRadius:8, fontSize:13, fontWeight:800, cursor: running||!csvFile?"not-allowed":"pointer", letterSpacing:1 }}>
          {running ? "Simulating…" : "▶ RUN SIMULATION"}
        </button>
        {/* Backfill to SQLite — fills in days that MCP backfill couldn't fully capture.
            Requires CSV. If liveConfigs loaded all 10, backfills everything in one click.
            If liveConfigs empty (MCP fetch failed), backfills just the currently edited
            alert; user repeats for each alert by changing the dropdown. */}
        <button onClick={backfillToSqlite}
          disabled={backfilling || !csvFile}
          title={
            !csvFile ? "Upload CSV first" :
            (!liveConfigs || liveConfigs.length === 0)
              ? "Live configs not loaded — will backfill just the currently selected alert. Click 'Load Live Configs' for one-click full backfill."
              : `Write all matched alerts to live_alerts_v1 SQLite (${liveConfigs.length} alert configs).`
          }
          style={{
            background: (backfilling||!csvFile) ? P.al : "transparent",
            color: (backfilling||!csvFile) ? P.dim : P.ac,
            border: `1px solid ${(backfilling||!csvFile) ? P.bd : P.ac}`,
            padding:"10px 18px", borderRadius:8, fontSize:11, fontWeight:700,
            cursor: (backfilling||!csvFile) ? "not-allowed" : "pointer",
            letterSpacing:0.5,
          }}>
          {backfilling
            ? "Backfilling…"
            : (liveConfigs && liveConfigs.length > 0)
              ? `⇪ BACKFILL TO SQLITE (${liveConfigs.length} alerts)`
              : "⇪ BACKFILL TO SQLITE (1 alert)"}
        </button>
      </div>

      {/* Backfill result panel */}
      {backfillResult && (
        <Card title="Backfill result · live_alerts_v1 SQLite">
          {backfillResult.ok ? (
            <>
              <div style={{ display:"flex", gap:16, fontSize:11, marginBottom:8, flexWrap:"wrap" }}>
                <div><span style={{ color:P.dim }}>Date:</span> <span style={{ color:P.text, fontWeight:700 }}>{backfillResult.date}</span></div>
                <div><span style={{ color:P.dim }}>CSV rows:</span> <span style={{ color:P.text }}>{backfillResult.csv_rows?.toLocaleString()}</span></div>
                <div><span style={{ color:P.dim }}>Inserted:</span> <span style={{ color:P.ac, fontWeight:700 }}>{backfillResult.alerts_inserted}</span></div>
                <div><span style={{ color:P.dim }}>Skipped (dupes):</span> <span style={{ color:P.mt }}>{backfillResult.alerts_skipped_duplicates}</span></div>
                {backfillResult.insert_errors > 0 && (
                  <div><span style={{ color:P.dim }}>Errors:</span> <span style={{ color:P.be }}>{backfillResult.insert_errors}</span></div>
                )}
                <div><span style={{ color:P.dim }}>Elapsed:</span> <span style={{ color:P.text }}>{backfillResult.elapsed_sec}s</span></div>
              </div>
              <div style={{ fontSize:10, color:P.dim, marginBottom:8 }}>By alert:</div>
              <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:6 }}>
                {Object.entries(backfillResult.by_alert || {})
                  .sort((a,b) => b[1]-a[1])
                  .map(([name, count]) => (
                    <div key={name} style={{ background:P.al, padding:"6px 10px", borderRadius:4, border:`1px solid ${P.bd}`, fontSize:10 }}>
                      <span style={{ color:P.text, fontWeight:600 }}>{name}</span>
                      <span style={{ color:P.ac, fontWeight:700, marginLeft:6 }}>{count}</span>
                    </div>
                  ))}
              </div>
              {backfillResult.next_step && (
                <div style={{ marginTop:12, padding:"8px 12px", background:P.bu+"15", border:`1px solid ${P.bu}40`, borderRadius:5, fontSize:10, color:P.bu }}>
                  → {backfillResult.next_step}
                </div>
              )}
            </>
          ) : (
            <div style={{ color:P.be, fontSize:11 }}>
              <div style={{ fontWeight:700, marginBottom:4 }}>Backfill failed</div>
              <div>{backfillResult.error}</div>
            </div>
          )}
        </Card>
      )}

      {/* Results */}
      {results && (
        <>
          {/* Pipeline funnel */}
          <Card title="Results · pipeline funnel">
            <div style={{ display:"grid", gridTemplateColumns:"repeat(8, 1fr)", gap:4 }}>
              {[
                ["CSV", results.stages["1_csv_parsed"], P.dim],
                ["Bullflow", results.stages["2_bullflow_matched"], P.mt],
                [
                  results.combo_min_combined_premium > 0 ? "⚡ Combos" : "Combos (off)",
                  results.stages["2b_combos_detected"] ?? 0,
                  results.combo_min_combined_premium > 0 ? P.ac : P.dim,
                ],
                ["After Dedup", results.stages["4_after_dedup"], P.text],
                ["Graded", results.stages["5_graded"], P.ye],
                [
                  results.min_repeat_fires > 1 ? `≥${results.min_repeat_fires}× Fires` : "2X (off)",
                  results.stages["5a_after_repeat_filter"] ?? results.stages["5_graded"],
                  results.min_repeat_fires > 1 ? P.ac : P.dim,
                ],
                [
                  results.max_alerts_per_ticker > 0 ? `≤${results.max_alerts_per_ticker}/Tkr` : "Tkr Cap (off)",
                  results.stages["5b_after_ticker_cap"] ?? results.stages["5_graded"],
                  results.max_alerts_per_ticker > 0 ? P.ac : P.dim,
                ],
                ["→ DISCORD", results.stages["6_would_post_to_discord"], P.bu],
              ].map(([l, n, c]) => (
                <div key={l} style={{ background:P.al, border:"1px solid "+P.bd, borderRadius:6, padding:8, textAlign:"center" }}>
                  <div style={{ fontSize:8, color:P.dim, fontWeight:700, marginBottom:3, textTransform:"uppercase", letterSpacing:0.3 }}>{l}</div>
                  <div style={{ fontSize:16, fontWeight:900, color:c }}>{n.toLocaleString()}</div>
                </div>
              ))}
            </div>
            {results.warnings && results.warnings.length>0 && (
              <div style={{ marginTop:10, fontSize:9, color:P.ye }}>
                ⚠ {results.warnings.join(" · ")}
              </div>
            )}
          </Card>

          {/* Tier breakdown */}
          <Card title={`Grade breakdown · ${results.alert_name}`}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(6, 1fr)", gap:8 }}>
              {Object.entries(results.tier_breakdown).map(([g, n]) => {
                const total = Object.values(results.tier_breakdown).reduce((a,b)=>a+b,0) || 1;
                const pct = (n/total*100).toFixed(0);
                const passes = results.min_discord_grade && ["A+","A","B+","B","C","D"].indexOf(g) <= ["A+","A","B+","B","C","D"].indexOf(results.min_discord_grade);
                return (
                  <div key={g} style={{ background:P.al, border:"1px solid "+(GRADE_COLOR[g]||P.bd)+(passes?"":"55"), borderRadius:6, padding:10, opacity:passes?1:0.5 }}>
                    <div style={{ fontSize:18, fontWeight:900, color:GRADE_COLOR[g]||P.text, textAlign:"center" }}>{g}</div>
                    <div style={{ fontSize:14, fontWeight:800, color:P.text, textAlign:"center" }}>{n}</div>
                    <div style={{ fontSize:8, color:P.dim, textAlign:"center" }}>{pct}%</div>
                    {!passes && <div style={{ fontSize:7, color:P.be, textAlign:"center", marginTop:2 }}>BELOW GATE</div>}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* Top tickers */}
          <Card title="Top tickers by total premium">
            <table style={{ width:"100%", fontSize:10, borderCollapse:"collapse" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid "+P.bd, color:P.dim, fontWeight:700, textAlign:"left" }}>
                  <th style={{ padding:"6px 8px" }}>Ticker</th>
                  <th style={{ padding:"6px 8px", textAlign:"right" }}>Hits</th>
                  <th style={{ padding:"6px 8px", textAlign:"right" }}>Total Premium</th>
                  <th style={{ padding:"6px 8px", textAlign:"center" }}>Best Grade</th>
                  <th style={{ padding:"6px 8px", textAlign:"right" }}>Would Post</th>
                </tr>
              </thead>
              <tbody>
                {results.top_tickers.map(t => (
                  <tr key={t.ticker} style={{ borderBottom:"1px solid "+P.bd+"22" }}>
                    <td style={{ padding:"6px 8px", fontWeight:800, color:P.text }}>{t.ticker}</td>
                    <td style={{ padding:"6px 8px", textAlign:"right", color:P.text }}>{t.hits}</td>
                    <td style={{ padding:"6px 8px", textAlign:"right", color:P.ac, fontWeight:700, fontFamily:"ui-monospace,monospace" }}>{fmt$(t.premium)}</td>
                    <td style={{ padding:"6px 8px", textAlign:"center", color:GRADE_COLOR[t.best_grade]||P.text, fontWeight:800 }}>{t.best_grade}</td>
                    <td style={{ padding:"6px 8px", textAlign:"right", color: t.would_post>0?P.bu:P.dim, fontWeight:700 }}>{t.would_post}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Would-post alerts */}
          <Card title={`✓ Would push to Discord · ${results.would_post_sample.length} sample (of ${results.stages["6_would_post_to_discord"]} total)`}>
            <table style={{ width:"100%", fontSize:9, borderCollapse:"collapse", fontFamily:"ui-monospace,monospace" }}>
              <thead>
                <tr style={{ borderBottom:"1px solid "+P.bd, color:P.dim, textAlign:"left" }}>
                  <th style={{ padding:"4px 6px" }}>Time</th>
                  <th style={{ padding:"4px 6px" }}>Ticker</th>
                  <th style={{ padding:"4px 6px" }}>C/P</th>
                  <th style={{ padding:"4px 6px", textAlign:"right" }}>Strike</th>
                  <th style={{ padding:"4px 6px" }}>Exp</th>
                  <th style={{ padding:"4px 6px", textAlign:"right" }}>DTE</th>
                  <th style={{ padding:"4px 6px", textAlign:"right" }}>Premium</th>
                  <th style={{ padding:"4px 6px" }}>Type</th>
                  <th style={{ padding:"4px 6px" }}>Side</th>
                  <th style={{ padding:"4px 6px", textAlign:"center" }}>Signal</th>
                  <th style={{ padding:"4px 6px", textAlign:"center" }}>Grade</th>
                  <th style={{ padding:"4px 6px", textAlign:"right" }}>Score</th>
                </tr>
              </thead>
              <tbody>
                {results.would_post_sample.map(a => (
                  <tr key={a.id} style={{ borderBottom:"1px solid "+P.bd+"22", background: a.combo_upgrade ? P.ac+"08" : "transparent" }}>
                    <td style={{ padding:"3px 6px", color:P.dim }}>{a.time}</td>
                    <td style={{ padding:"3px 6px", color:P.text, fontWeight:800 }}>{a.ticker}</td>
                    <td style={{ padding:"3px 6px", color: a.cp==="C"?P.bu:P.be, fontWeight:800 }}>{a.cp}</td>
                    <td style={{ padding:"3px 6px", textAlign:"right", color:P.text }}>${a.strike}</td>
                    <td style={{ padding:"3px 6px", color:P.dim }}>{a.exp}</td>
                    <td style={{ padding:"3px 6px", textAlign:"right", color:P.dim }}>{a.dte}d</td>
                    <td style={{ padding:"3px 6px", textAlign:"right", color:P.ac, fontWeight:700 }}
                        title={a.combo_upgrade ? `Sweep $${(a.combo_sweep_premium/1e6).toFixed(2)}M + Block $${(a.combo_block_premium/1e6).toFixed(2)}M combined` : undefined}>
                      {fmt$(a.premium)}{a.combo_upgrade ? "*" : ""}
                    </td>
                    <td style={{ padding:"3px 6px", color: a.combo_upgrade ? P.ac : P.dim, fontWeight: a.combo_upgrade ? 800 : 600 }}>
                      {a.combo_upgrade ? "COMBO" : a.trade_type}
                    </td>
                    <td style={{ padding:"3px 6px", color:P.dim }}>{a.side}</td>
                    <td style={{ padding:"3px 6px", textAlign:"center" }}>
                      {a.combo_upgrade ? (
                        <span style={{ color:P.ac, fontWeight:800, padding:"1px 4px", borderRadius:3, background:P.ac+"22", border:"1px solid "+P.ac+"55", fontSize:8 }}
                              title={`Sweep+Block combo: $${(a.combo_sweep_premium/1e6).toFixed(2)}M sweep + $${(a.combo_block_premium/1e6).toFixed(2)}M block (${a.combo_trade_count} trades)`}>
                          ⚡COMBO
                        </span>
                      ) : (a.repeat_fires||1)>=2 ? (
                        <span style={{ color:P.ac, fontWeight:800 }}>{a.repeat_fires}×</span>
                      ) : (
                        <span style={{ color:P.dim }}>—</span>
                      )}
                    </td>
                    <td style={{ padding:"3px 6px", textAlign:"center", color:GRADE_COLOR[a.grade], fontWeight:800 }}>{a.grade}</td>
                    <td style={{ padding:"3px 6px", textAlign:"right", color:P.text }}>{a.grade_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Gated out (collapsible) */}
          <Card title={`✗ Gated out (below ${results.min_discord_grade}) · ${results.gated_out_sample.length} sample`}
                headerRight={<button onClick={()=>setShowGated(!showGated)} style={{ background:"transparent", color:P.dim, border:"1px solid "+P.bd, padding:"4px 10px", borderRadius:5, fontSize:9, cursor:"pointer" }}>{showGated?"Hide":"Show"}</button>}>
            {showGated && (
              <table style={{ width:"100%", fontSize:9, borderCollapse:"collapse", fontFamily:"ui-monospace,monospace" }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid "+P.bd, color:P.dim, textAlign:"left" }}>
                    <th style={{ padding:"4px 6px" }}>Time</th><th style={{ padding:"4px 6px" }}>Ticker</th><th style={{ padding:"4px 6px" }}>C/P</th>
                    <th style={{ padding:"4px 6px", textAlign:"right" }}>Strike</th><th style={{ padding:"4px 6px" }}>Exp</th>
                    <th style={{ padding:"4px 6px", textAlign:"right" }}>Premium</th><th style={{ padding:"4px 6px", textAlign:"center" }}>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {results.gated_out_sample.map(a => (
                    <tr key={a.id} style={{ borderBottom:"1px solid "+P.bd+"22", opacity:0.7 }}>
                      <td style={{ padding:"3px 6px", color:P.dim }}>{a.time}</td>
                      <td style={{ padding:"3px 6px", color:P.text, fontWeight:800 }}>{a.ticker}</td>
                      <td style={{ padding:"3px 6px", color: a.cp==="C"?P.bu:P.be, fontWeight:800 }}>{a.cp}</td>
                      <td style={{ padding:"3px 6px", textAlign:"right" }}>${a.strike}</td>
                      <td style={{ padding:"3px 6px", color:P.dim }}>{a.exp}</td>
                      <td style={{ padding:"3px 6px", textAlign:"right", color:P.ac }}>{fmt$(a.premium)}</td>
                      <td style={{ padding:"3px 6px", textAlign:"center", color:GRADE_COLOR[a.grade], fontWeight:800 }}>{a.grade}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {/* Ticker-dropped (collapsible, only if ticker cap is active) */}
          {results.max_alerts_per_ticker > 0 && results.ticker_dropped_sample && results.ticker_dropped_sample.length > 0 && (
            <Card title={`✗ Dropped by ticker cap (max ${results.max_alerts_per_ticker}/ticker) · ${results.ticker_dropped_sample.length} sample of ${results.ticker_cap_dropped}`}>
              <table style={{ width:"100%", fontSize:9, borderCollapse:"collapse", fontFamily:"ui-monospace,monospace" }}>
                <thead>
                  <tr style={{ borderBottom:"1px solid "+P.bd, color:P.dim, textAlign:"left" }}>
                    <th style={{ padding:"4px 6px" }}>Time</th><th style={{ padding:"4px 6px" }}>Ticker</th><th style={{ padding:"4px 6px" }}>C/P</th>
                    <th style={{ padding:"4px 6px", textAlign:"right" }}>Strike</th><th style={{ padding:"4px 6px" }}>Exp</th>
                    <th style={{ padding:"4px 6px", textAlign:"right" }}>Premium</th>
                    <th style={{ padding:"4px 6px", textAlign:"center" }}>Grade</th>
                    <th style={{ padding:"4px 6px", textAlign:"right" }}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {results.ticker_dropped_sample.map(a => (
                    <tr key={a.id} style={{ borderBottom:"1px solid "+P.bd+"22", opacity:0.6 }}>
                      <td style={{ padding:"3px 6px", color:P.dim }}>{a.time}</td>
                      <td style={{ padding:"3px 6px", color:P.text, fontWeight:800 }}>{a.ticker}</td>
                      <td style={{ padding:"3px 6px", color: a.cp==="C"?P.bu:P.be, fontWeight:800 }}>{a.cp}</td>
                      <td style={{ padding:"3px 6px", textAlign:"right" }}>${a.strike}</td>
                      <td style={{ padding:"3px 6px", color:P.dim }}>{a.exp}</td>
                      <td style={{ padding:"3px 6px", textAlign:"right", color:P.ac }}>{fmt$(a.premium)}</td>
                      <td style={{ padding:"3px 6px", textAlign:"center", color:GRADE_COLOR[a.grade], fontWeight:800 }}>{a.grade}</td>
                      <td style={{ padding:"3px 6px", textAlign:"right", color:P.text }}>{a.grade_score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize:9, color:P.dim, marginTop:8 }}>
                These alerts were valid (passed Bullflow filter + grading) but lost the per-ticker contest.
                The simulator ranks by grade_score, with premium as tiebreaker.
              </div>
            </Card>
          )}

          {/* Drop reasons (diagnostic) */}
          <Card title="Drop reasons (Bullflow filter diagnostics)"
                headerRight={<button onClick={()=>setShowDrops(!showDrops)} style={{ background:"transparent", color:P.dim, border:"1px solid "+P.bd, padding:"4px 10px", borderRadius:5, fontSize:9, cursor:"pointer" }}>{showDrops?"Hide":"Show"}</button>}>
            {showDrops && (
              <div style={{ display:"grid", gridTemplateColumns:"repeat(3, 1fr)", gap:8 }}>
                {Object.entries(results.drop_reasons).sort((a,b)=>b[1]-a[1]).map(([reason, count]) => (
                  <div key={reason} style={{ background:P.al, border:"1px solid "+P.bd, borderRadius:5, padding:8, display:"flex", justifyContent:"space-between", fontSize:10 }}>
                    <span style={{ color:P.dim }}>{reason}</span>
                    <span style={{ color:P.text, fontWeight:700 }}>{count.toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Footer note */}
          <div style={{ textAlign:"center", color:P.dim, fontSize:9, padding:16 }}>
            ✓ Simulation complete · {results._NEVER_POSTED_TO_DISCORD ? "No Discord posts were sent." : "WARNING — Discord may have received posts!"}
          </div>
        </>
      )}
    </div>
  );
}
