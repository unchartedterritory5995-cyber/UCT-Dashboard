// GENERATED — do not hand-edit.
// The TOP 10 FLOW PICKS block as it stood BEFORE the extraction, taken from
// git and parameterised with the same substitutions. It exists so the moved
// version can be diffed against the original on real data: a wrong boundary,
// a dropped line or a mis-scoped closure shows up as a failing comparison
// instead of a silent ranking change in production.
import { capBand } from '../flowCompute'

export function referenceTopPicks(directionalRows, tradeRows, { dataMode, capFilter, isEtfFn, includeStandout = false } = {}) {
  // 2026-07-04: honor the Stocks tab by excluding ETFs/indexes
  // (and vice versa on the Indexes tab). Matches Watchlist behavior.
  const _tabOk = (t) => {
    const isEtf = isEtfFn(t.S, t.stocketf);
    return dataMode === "stocks" ? !isEtf : isEtf;
  };
  const baseAd = (directionalRows||[]).filter(_tabOk);
  const ad = capFilter==="All" ? baseAd : baseAd.filter(t=>capBand(t.mktcap)===capFilter);
  if (!ad.length) return { candidates: [], standoutCandidates: null, ad };
  // Pre-build TOTAL premium per (ticker,contract) from broader trade list
  // (includes B-side MAGENTA call buys etc. that don't get a direction
  // assigned per the strict A/AA-only rule, but are real flow on the strike).
  // Used for DISPLAY ONLY — scoring/exit detection still use the directional
  // subset to avoid misclassifying ambiguous flow as conviction.
  const baseAllTrades = (tradeRows||[]).filter(_tabOk);
  const allTrades = capFilter==="All" ? baseAllTrades : baseAllTrades.filter(t=>capBand(t.mktcap)===capFilter);
  const contractTotals = {};
  for (const t of allTrades) {
    const k = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
    if (!contractTotals[k]) contractTotals[k] = {hits:0, prem:0};
    contractTotals[k].hits++;
    contractTotals[k].prem += (t.P||0);
  }
  const _now = new Date();
  const _parseDt = (dt) => { if(!dt) return null; const p=dt.split("/").map(Number); return p.length>=2?new Date(_now.getFullYear(),p[0]-1,p[1]):null; };
  const tkMap = {};
  ad.forEach(t => {
    if (!tkMap[t.S]) tkMap[t.S]={sym:t.S,bull:0,bear:0,n:0,swp:0,blk:0,swpAsk:0,swpBid:0,confirmed:0,band:capBand(t.mktcap),
      contracts:{},hasER:!!t.er,minDTE:999,mktcap:t.mktcap||0,sector:t.sector||"",lastDate:null,hasUOA:false};
    // 7/9: Upgrade mktcap + band when a real value shows up. Prevents
    // gap-fill rows (mktcap=0 → Unknown) from locking a ticker's cap
    // band. See matching fix at line 6410 for full explanation.
    else if (!tkMap[t.S].mktcap && t.mktcap) {
      tkMap[t.S].mktcap = t.mktcap;
      tkMap[t.S].band = capBand(t.mktcap);
    }
    const tk=tkMap[t.S];
    if(t.D==="BULL") tk.bull+=t.P; if(t.D==="BEAR") tk.bear+=t.P;
    tk.n++;
    if(t.Ty==="SWP") {
      tk.swp++;
      if(t.Si==="A"||t.Si==="AA") tk.swpAsk++;
      else if(t.Si==="B"||t.Si==="BB") tk.swpBid++;
    } else if(t.Ty==="BLK") tk.blk++;
    if(t.confirmed) tk.confirmed++;
    if(t.uoa) tk.hasUOA=true;
    if(t.DTE!=null && t.DTE<tk.minDTE) tk.minDTE=t.DTE;
    const tDate=_parseDt(t.Dt);
    if(tDate&&(!tk.lastDate||tDate>tk.lastDate)) tk.lastDate=tDate;
    const ck=t.CP+"|"+t.K+"|"+t.E;
    if(!tk.contracts[ck]) tk.contracts[ck]={cp:t.CP,K:t.K,exp:t.E,hits:0,prem:0,vol:0,oi:0,lastOI:0,askPrem:0,bidPrem:0,prices:[],lastDate:null,spot:0};
    const c=tk.contracts[ck]; c.hits++; c.prem+=t.P; c.vol+=(t.V||0);
    if(t.OI>c.oi) c.oi=t.OI;
    if(t.Si==="A"||t.Si==="AA") c.askPrem+=t.P; if(t.Si==="B"||t.Si==="BB") c.bidPrem+=t.P;
    if(t.price>0) c.prices.push(t.price);
    if(tDate&&(!c.lastDate||tDate>=c.lastDate)){ c.lastDate=tDate; c.lastOI=t.OI||c.lastOI; if(t.Spot>0) c.spot=t.Spot; }
  });
  const candidates = [];
  Object.values(tkMap).forEach(tk => {
    const total=tk.bull+tk.bear;
    if(total===0) return;
    const net=Math.abs(tk.bull-tk.bear);
    const purity=Math.max(tk.bull,tk.bear)/total*100;
    const dir=tk.bull>=tk.bear?"BULL":"BEAR";
    const hasBoth=tk.swp>0&&tk.blk>0;
    const swpRatio=tk.swp/(tk.swp+tk.blk);
    if(purity<70) return;
    // Trade-count hard gate removed — premium > count.
    // Cap-band premium gates below ($250K Mid-Small / $1M Large / $10M Mega)
    // already filter out noise. A single $1M ASK sweep shouldn't fail just
    // because it's not a 3-hit cluster. The +20% confirmed≥3 modifier below
    // still rewards multi-hit consistency without making it a hard cutoff.
    if(tk.swp<1) return;
    if(tk.hasER&&tk.minDTE<=14) return;
    let score=0;
    if(tk.band==="Mega"){ if(net<10e6) return; score=net/10e6; }
    else if(tk.band==="Large"){ if(net<1e6) return; score=net/1e6*1.5; }
    else { if(net<250e3) return; score=net/250e3*2.0; }
    if(hasBoth) score*=1.3;
    if(purity>=90) score*=1.2;
    if(tk.confirmed>=3) score*=1.2;
    if(swpRatio<0.3) score*=0.3;
    else if(swpRatio<0.5) score*=0.6;
    const topC=Object.values(tk.contracts).sort((a,b)=>b.prem-a.prem)[0];
    const volOI=topC&&topC.oi>0?topC.vol/topC.oi:0;
    if(volOI>2) score*=1.15;
    const topDTE = topC ? (topC.exp ? Math.round((new Date(topC.exp)-new Date())/(86400000)) : 999) : 0;
    if((tk.band==="Large"||tk.band==="Mega") && topDTE>180) score*=0.2;
    else if(tk.band==="Mid-Small" && topDTE>180) score*=0.8;
    // Exit detection — penalize closing flow, not age
    const daysSince = tk.lastDate ? Math.max(0,Math.round((_now-tk.lastDate)/86400000)) : 30;
    const lastDateStr = tk.lastDate ? `${tk.lastDate.getMonth()+1}/${tk.lastDate.getDate()}` : "—";
    const freshLabel = daysSince<=1?"Today":daysSince<=2?"Yesterday":lastDateStr;
    // Bid-side exit ratio on top contract: high bid% = closing trades
    const exitRatio = topC&&topC.prem>0 ? topC.bidPrem/topC.prem : 0;
    // OI retention: lastOI vs maxOI — declining OI = positions closed
    const oiRetention = topC&&topC.oi>0&&topC.lastOI>0 ? topC.lastOI/topC.oi : 1;
    let posStatus = "ACTIVE";
    if(exitRatio>0.5 || oiRetention<0.5) { score*=0.3; posStatus="CLOSED"; }
    else if(exitRatio>0.3 || oiRetention<0.7) { score*=0.6; posStatus="FADING"; }
    else if(exitRatio<0.1 && oiRetention>=0.9) { score*=1.1; posStatus="ACTIVE"; }
    // Stale with no exit data still gets slight discount
    if(daysSince>=14 && posStatus==="ACTIVE") posStatus="HOLDING";
    const entry = topC&&topC.prices.length>0 ? topC.prices.reduce((a,b)=>a+b,0)/topC.prices.length : 0;
    // Look up TOTAL premium/hits for the top contract from the broader
    // trade list. Falls back to directional-only if no entry (shouldn't happen).
    let topCDisplayPrem = topC ? topC.prem : 0;
    let topCDisplayHits = topC ? topC.hits : 0;
    if (topC) {
      const k = tk.sym+"|"+topC.cp+"|"+topC.K+"|"+topC.exp;
      const totals = contractTotals[k];
      if (totals) {
        topCDisplayPrem = totals.prem;
        topCDisplayHits = totals.hits;
      }
    }
    candidates.push({...tk,net,purity,dir,score,hasBoth,topC,volOI,entry,daysSince,freshLabel,posStatus,exitRatio,oiRetention,topCDisplayPrem,topCDisplayHits});
  });
  // Default ranking = raw net premium (biggest flow wins). score is still
  // computed above (its band-premium gates filter noise) but no longer ranks.
  candidates.sort((a,b)=>(b.net-a.net) || (b.score-a.score));
  // Standout mode: rebuild candidates at the CONTRACT level (each pick = one
  // strike) in the SAME shape as the ticker picks, so the identical row renderer
  // (NET+%, TOP CONTRACT, GRADE, OPEN INTEREST, status, notes) is reused verbatim.
  // Gate is a flat $1M net + sweep + one-sided (clean) — NO ticker-purity/band gate,
  // so a killer strike shows even when its ticker nets to a coin-flip (e.g. GLW 110C).
  const standoutCandidates = includeStandout ? (()=>{
    const soMap = {};
    ad.forEach(t => {
      const ck = t.S+"|"+t.CP+"|"+t.K+"|"+t.E;
      if (!soMap[ck]) soMap[ck] = { sym:t.S, bull:0, bear:0, n:0, swp:0, blk:0, swpAsk:0, swpBid:0,
        confirmed:0, band:capBand(t.mktcap), contracts:{}, hasER:!!t.er, minDTE:999, mktcap:t.mktcap||0,
        sector:t.sector||"", lastDate:null, hasUOA:false };
      const tk = soMap[ck];
      if(t.D==="BULL") tk.bull+=t.P; if(t.D==="BEAR") tk.bear+=t.P;
      tk.n++;
      if(t.Ty==="SWP"){ tk.swp++; if(t.Si==="A"||t.Si==="AA") tk.swpAsk++; else if(t.Si==="B"||t.Si==="BB") tk.swpBid++; }
      else if(t.Ty==="BLK") tk.blk++;
      if(t.confirmed) tk.confirmed++;
      if(t.uoa) tk.hasUOA=true;
      if(t.DTE!=null && t.DTE<tk.minDTE) tk.minDTE=t.DTE;
      const tDate=_parseDt(t.Dt);
      if(tDate&&(!tk.lastDate||tDate>tk.lastDate)) tk.lastDate=tDate;
      if(!tk.contracts[ck]) tk.contracts[ck]={cp:t.CP,K:t.K,exp:t.E,hits:0,prem:0,vol:0,oi:0,lastOI:0,askPrem:0,bidPrem:0,prices:[],lastDate:null,spot:0};
      const c=tk.contracts[ck]; c.hits++; c.prem+=t.P; c.vol+=(t.V||0);
      if(t.OI>c.oi) c.oi=t.OI;
      if(t.Si==="A"||t.Si==="AA") c.askPrem+=t.P; if(t.Si==="B"||t.Si==="BB") c.bidPrem+=t.P;
      if(t.price>0) c.prices.push(t.price);
      if(tDate&&(!c.lastDate||tDate>=c.lastDate)){ c.lastDate=tDate; c.lastOI=t.OI||c.lastOI; if(t.Spot>0) c.spot=t.Spot; }
    });
    const _perContract = Object.values(soMap).map(tk => {
      const total=tk.bull+tk.bear; if(total===0) return null;
      const net=Math.abs(tk.bull-tk.bear);
      const purity=Math.max(tk.bull,tk.bear)/total*100;
      const dir=tk.bull>=tk.bear?"BULL":"BEAR";
      const hasBoth=tk.swp>0&&tk.blk>0;
      const topC=Object.values(tk.contracts)[0];
      const bidRatio=topC&&topC.prem>0?topC.bidPrem/topC.prem:0;
      // Standout = clean, positional conviction. Exclude sub-$1M, no-sweep, two-sided
      // (purity<80 directional OR >25% bid-side = buying AND selling on the strike =
      // day-trade churn), and ultra-short expirations (<5 DTE = gamma scalp / day-trade).
      if(net<1e6 || tk.swp<1 || purity<80 || bidRatio>0.25 || tk.minDTE<5) return null;
      const volOI=topC&&topC.oi>0?topC.vol/topC.oi:0;
      const daysSince = tk.lastDate ? Math.max(0,Math.round((_now-tk.lastDate)/86400000)) : 30;
      const lastDateStr = tk.lastDate ? `${tk.lastDate.getMonth()+1}/${tk.lastDate.getDate()}` : "—";
      const freshLabel = daysSince<=1?"Today":daysSince<=2?"Yesterday":lastDateStr;
      const exitRatio = topC&&topC.prem>0 ? topC.bidPrem/topC.prem : 0;
      const oiRetention = topC&&topC.oi>0&&topC.lastOI>0 ? topC.lastOI/topC.oi : 1;
      let posStatus = "ACTIVE";
      if(exitRatio>0.5 || oiRetention<0.5) posStatus="CLOSED";
      else if(exitRatio>0.3 || oiRetention<0.7) posStatus="FADING";
      if(daysSince>=14 && posStatus==="ACTIVE") posStatus="HOLDING";
      const entry = topC&&topC.prices.length>0 ? topC.prices.reduce((a,b)=>a+b,0)/topC.prices.length : 0;
      let topCDisplayPrem = topC ? topC.prem : 0;
      let topCDisplayHits = topC ? topC.hits : 0;
      if (topC) { const k=tk.sym+"|"+topC.cp+"|"+topC.K+"|"+topC.exp; const totals=contractTotals[k]; if(totals){ topCDisplayPrem=totals.prem; topCDisplayHits=totals.hits; } }
      return {...tk,net,purity,dir,score:net,hasBoth,topC,volOI,entry,daysSince,freshLabel,posStatus,exitRatio,oiRetention,topCDisplayPrem,topCDisplayHits};
    }).filter(Boolean).sort((a,b)=>b.net-a.net);
    // One row per ticker: each ticker's biggest strike is the headline row; its
    // other standout strikes roll into `_moreStrikes` (shown as a "+N more" note
    // and expanded on row click).
    const _headMap={}, _deduped=[];
    for (const c of _perContract) {
      if (_headMap[c.sym]) _headMap[c.sym]._moreStrikes.push(c);
      else { c._moreStrikes=[]; _headMap[c.sym]=c; _deduped.push(c); }
    }
    return _deduped;
  })() : null;
  return { candidates, standoutCandidates, ad };
}
