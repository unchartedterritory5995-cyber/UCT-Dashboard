// Benchmark for NoteGraphView's force layout -- the numbers its comments quote.
//
// ⛔⛔ THIS FILE ONCE MEASURED ONLY SPEED, AND SPEED WAS THE WRONG AXIS.
// It reported 2000 nodes at 10.6ms/frame and called it "smooth". The endpoint
// cap was set from that number. It was true, and the product still drew a
// RECTANGLE OUTLINE with an empty middle at 500 notes, because the layout
// DIVERGED inside its tick budget. A layout can be fast and useless, and a
// benchmark that only times it will say nothing is wrong.
//
//   node tools/graph_layout_bench.mjs
//
// So it now prints THREE numbers per size:
//
//   ms/frame -- the H14 nav-freeze axis. Must stay under the 16ms budget.
//   wallX    -- nodes in the 10px border band, as a MULTIPLE of what a uniform
//               scatter would put there. 1.0 = uniform. 20x = pressed onto the
//               frame, which is what the divergence looked like.
//   occ      -- share of 40px grid cells holding a node. Catches the opposite
//               failure: everything collapsed into one clump.
//
// ⚠️ It replicates step() BY HAND. That is a second copy of the loop and a
// deliberate one: importing the component would drag in React, SWR and a DOM.
// If you change the constants or the force model in NoteGraphView, change them
// here too -- otherwise this measures a layout the product no longer runs.
//
// Measured 2026-09-20 on a contended dev box, 1500x560:
//
//     nodes   ms/frame   wallX    occ    verdict
//      500       0.7      4.1x    69%    a graph
//     1000       2.5      4.2x    85%    a graph
//     1500       5.5      3.7x    89%    a graph
//     2000      10.3      3.4x    92%    a graph, and at the frame budget
//     3000      24.7      2.8x    94%    janky -- past the cap, correctly
//
// and the control, the same model with the step cap removed:
//
//      500        --     20.2x     6%    ON THE FRAME
//     2000        --     20.6x     3%    ON THE FRAME
//
// ⚠️ THE MILLISECONDS ARE INDICATIVE, THE BOUNDARY IS NOT. Absolute timings
// move with whatever else the box is doing -- 5000 nodes measured 80.9ms once
// and 122.8ms an hour later. What is stable is WHERE it crosses 16ms, and that
// is why the endpoint caps at 2000 rather than at a number from one timing.
//
// ⚠️ ~3-5x wall concentration is NOT a defect. A layout that fills its frame
// puts its outermost nodes on the frame; that is the boundary being a boundary.
// 20-30x with 3% occupancy was the defect.

// Replicates NoteGraphView's step() exactly: O(n^2) repulsion + springs +
// centring + THE PER-TICK STEP CAP, which is what stops the divergence.
const TICKS=220, REPULSION=5200, SPRING=0.0016, SPRING_LEN=92, CENTER_PULL=0.014, DAMPING=0.86
const MAX_STEP_FRAC=0.02, COOLING=0.985, TEMP_FLOOR=0.05
const BAND=10, CELL=40

function build(n, w, h){
  const nodes=[], spread=Math.min(w,h)*0.32
  for(let i=0;i<n;i++){const a=(i/n)*Math.PI*2
    nodes.push({x:w/2+Math.cos(a)*spread,y:h/2+Math.sin(a)*spread,vx:0,vy:0,r:6})}
  const edges=[]
  for(let i=1;i<n;i++) edges.push({s:nodes[i], t:nodes[(i*7)%n]})  // ~1 edge/node
  return {nodes,edges,w,h}
}

function run({nodes,edges,w,h}, {capped=true}={}){
  const cap0=MAX_STEP_FRAC*Math.min(w,h), floor=cap0*TEMP_FLOOR
  let cap=cap0
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
      n.vx*=DAMPING;n.vy*=DAMPING
      if(capped){const sp=Math.sqrt(n.vx*n.vx+n.vy*n.vy)
        if(sp>cap){n.vx=(n.vx/sp)*cap;n.vy=(n.vy/sp)*cap}}
      n.x+=n.vx;n.y+=n.vy
      n.x=Math.max(n.r+2,Math.min(w-n.r-2,n.x));n.y=Math.max(n.r+2,Math.min(h-n.r-2,n.y))}
    if(capped) cap=Math.max(cap*COOLING, floor)}
}

function shape({nodes,w,h}){
  const inBand=nodes.filter(n=>n.x<BAND||n.x>w-BAND||n.y<BAND||n.y>h-BAND).length
  const bandArea=w*h-Math.max(0,(w-2*BAND))*Math.max(0,(h-2*BAND))
  const cells=new Set()
  for(const n of nodes) cells.add(`${Math.floor(n.x/CELL)},${Math.floor(n.y/CELL)}`)
  const maxCells=Math.min(nodes.length, Math.ceil(w/CELL)*Math.ceil(h/CELL))
  return {wallX:(inBand/nodes.length)/(bandArea/(w*h)), occ:cells.size/maxCells*100}
}

const W=1500, H=560
console.log(`canvas ${W}x${H}`)
console.log('nodes |  220 ticks |  ms/frame | wallX |  occ | verdict')
for(const n of [500,1000,1500,2000,3000]){
  const g=build(n,W,H)
  const t0=performance.now(); run(g); const ms=performance.now()-t0
  const per=ms/TICKS, s=shape(g)
  const speed = per<16 ? 'smooth' : per<50 ? 'janky' : 'FREEZES THE TAB'
  const look  = s.wallX>10 ? 'ON THE FRAME' : s.occ<20 ? 'CLUMPED' : 'a graph'
  console.log(`${String(n).padStart(5)} | ${ms.toFixed(0).padStart(7)} ms | ${per.toFixed(1).padStart(6)} ms | ${s.wallX.toFixed(1).padStart(4)}x | ${s.occ.toFixed(0).padStart(3)}% | ${speed}, ${look}`)
}

// ⛔ THE CONTROL. Without the step cap these same sizes must read ON THE FRAME.
// If this block ever prints "a graph", the shape metric has stopped being able
// to see the defect it was built for, and the numbers above mean nothing.
console.log('\ncontrol -- the same model with the step cap REMOVED (must read ON THE FRAME):')
for(const n of [500,2000]){
  const g=build(n,W,H); run(g,{capped:false}); const s=shape(g)
  const look = s.wallX>10 ? 'ON THE FRAME' : s.occ<20 ? 'CLUMPED' : 'a graph'
  console.log(`${String(n).padStart(5)} | ${' '.repeat(10)} | ${' '.repeat(9)} | ${s.wallX.toFixed(1).padStart(4)}x | ${s.occ.toFixed(0).padStart(3)}% | ${look}`)
}
