// Benchmark for NoteGraphView's force layout -- the numbers its comment quotes.
//
// ⛔⛔ THE COMMENT IN THAT COMPONENT USED TO ASSERT "fine to ~1500 nodes" WITH
// NOBODY HAVING RUN IT. Half right, and the wrong half mattered: 1500 is the
// endpoint's DEFAULT, the ceiling was 5000, and 5000 measures ~18 SECONDS of
// blocked main thread -- the H14 nav-freeze class. This file exists so the
// claim is re-runnable instead of re-asserted.
//
//   node tools/graph_layout_bench.mjs
//
// ⚠️ It replicates step() BY HAND. That is a second copy of the loop, and it is
// a deliberate one: importing the component would drag in React, SWR and a DOM.
// If you change the constants or the force model in NoteGraphView, change them
// here too -- otherwise this measures a layout the product no longer runs.
//
// Measured 2026-09-20, per frame over 220 ticks, TWO runs on a contended dev
// box:
//
//     nodes    run 1     run 2    verdict
//      1500    5.9ms     6.3ms    smooth
//      2000   10.6ms    11.2ms    smooth
//      3000   26.8ms    32.9ms    janky
//      5000   80.9ms   122.8ms    freezes (17-27s of blocked main thread)
//
// ⚠️ THE MILLISECONDS ARE INDICATIVE, THE BOUNDARY IS NOT. Absolute numbers
// move with whatever else the box is doing -- 5000 measured 80.9ms once and
// 122.8ms an hour later. What is stable across runs is WHERE it crosses the
// 16ms frame budget, and that is why the endpoint caps at 2000 rather than at
// a number derived from a single timing.

// Replicates NoteGraphView's step() exactly: O(n^2) repulsion + springs + centring.
const TICKS=220, REPULSION=5200, SPRING=0.0016, SPRING_LEN=92, CENTER_PULL=0.014, DAMPING=0.86
function build(n, w=1500, h=560){
  const nodes=[], spread=Math.min(w,h)*0.32
  for(let i=0;i<n;i++){const a=(i/n)*Math.PI*2
    nodes.push({x:w/2+Math.cos(a)*spread,y:h/2+Math.sin(a)*spread,vx:0,vy:0,r:6})}
  const edges=[]
  for(let i=1;i<n;i++) edges.push({s:nodes[i], t:nodes[(i*7)%n]})  // ~1 edge/node
  return {nodes,edges,w,h}
}
function run({nodes,edges,w,h}){
  for(let t=0;t<TICKS;t++){
    for(let i=0;i<nodes.length;i++){const a=nodes[i]
      for(let j=i+1;j<nodes.length;j++){const b=nodes[j]
        let dx=b.x-a.x, dy=b.y-a.y, d2=dx*dx+dy*dy
        if(d2<1){dx=(i%7)-3;dy=(j%7)-3;d2=Math.max(1,dx*dx+dy*dy)}
        const d=Math.sqrt(d2), f=REPULSION/d2, fx=(dx/d)*f, fy=(dy/d)*f
        a.vx-=fx;a.vy-=fy;b.vx+=fx;b.vy+=fy}}
    for(const e of edges){const dx=e.t.x-e.s.x, dy=e.t.y-e.s.y
      const d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-SPRING_LEN)*SPRING*d
      const fx=(dx/d)*f, fy=(dy/d)*f
      e.s.vx+=fx;e.s.vy+=fy;e.t.vx-=fx;e.t.vy-=fy}
    for(const n of nodes){n.vx+=(w/2-n.x)*CENTER_PULL;n.vy+=(h/2-n.y)*CENTER_PULL
      n.vx*=DAMPING;n.vy*=DAMPING;n.x+=n.vx;n.y+=n.vy
      n.x=Math.max(n.r+2,Math.min(w-n.r-2,n.x));n.y=Math.max(n.r+2,Math.min(h-n.r-2,n.y))}}
}
console.log('nodes | full 220-tick layout | per frame | verdict')
for(const n of [500,1000,1500,2000,3000,5000]){
  const g=build(n); const t0=performance.now(); run(g); const ms=performance.now()-t0
  const per=ms/TICKS
  const v = per<16 ? 'smooth (<16ms/frame)' : per<50 ? 'janky' : 'FREEZES THE TAB'
  console.log(`${String(n).padStart(5)} | ${ms.toFixed(0).padStart(8)} ms | ${per.toFixed(1).padStart(6)} ms | ${v}`)
}
