// THE STUDY MARK, LIVE: the compass + candle extruded and lit by three.js. Decided by the owner's delegation on
// 2026-11-03 ("decide now and get it all done") after the twelve-step ladder in the workbench: step 12 (every step on,
// the glow turned down a touch) is the logo. The ladder survives as `variant` 1..12 so the workbench can still show the
// steps; the product always renders 12.
//   1 flat extrude, one light          2 + rounded bevel            3 + key light from the upper left
//   4 + fill and rim lights            5 + metal materials          6 + a contact shadow on the floor
//   7 + finer curves and bevel         8 + gold trim on the edges   9 + tone mapping and sRGB
//  10 + depth and a slight tilt       11 + eased motion (a gentle sway on the turn)
//  12 + a glow halo and sparks behind the mark
// Import this file only through StudyMark.jsx (which lazy-loads it, so three.js is its own chunk and never rides the
// entry) or from the workbench. `window.__uctLogoPhase` pins the turn; the screenshot rig uses it.
import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import m from './StudyMark.module.css'

const SPEED = { idle: 12, live: 4.5, think: 18, happy: 6, oops: 22, fire: 3.2 }   // seconds per turn ('live': the drill, visibly turning)
const GREEN = 0x34be70, RED = 0xe84c46, GOLD = 0xdcbb5e
const D = Math.PI / 180
function arcPts(r, a0, a1, n) { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; o.push([r * Math.cos(a), -r * Math.sin(a)]) } return o }
function ring(a0, a1, n) { return [...arcPts(37, a0, a1, n), ...arcPts(27, a1, a0, n)] }
function outlines(n) {
  return [
    { pts: ring(-173 * D, -97 * D, n), color: RED }, { pts: ring(-83 * D, -7 * D, n), color: GREEN },
    { pts: ring(97 * D, 173 * D, n), color: GREEN }, { pts: ring(7 * D, 83 * D, n), color: RED },
    { pts: [[-4.5, 19], [4.5, 19], [1.5, 50]], color: GREEN }, { pts: [[-4.5, -19], [4.5, -19], [-1.5, -50]], color: GREEN },
    { pts: [[-19, 4.5], [-19, -4.5], [-50, -1]], color: RED }, { pts: [[19, 4.5], [19, -4.5], [50, 1]], color: RED },
    { pts: [[-8, 17], [8, 17], [-8, -17]], color: GREEN }, { pts: [[8, 17], [8, -17], [-8, -17]], color: RED },
    { pts: [[-1.6, 25], [1.6, 25], [1.6, 17], [-1.6, 17]], color: GREEN }, { pts: [[-1.6, -17], [1.6, -17], [1.6, -25], [-1.6, -25]], color: GREEN },
  ]
}

function buildScene(v) {
  const scene = new THREE.Scene()
  const group = new THREE.Group()
  const fine = v >= 7
  const depth = v >= 10 ? 11 : 9
  outlines(fine ? 64 : 18).forEach(({ pts, color }) => {
    const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)))
    const geo = new THREE.ExtrudeGeometry(shape, v >= 2
      ? { depth, bevelEnabled: true, bevelThickness: fine ? 1.5 : 1.0, bevelSize: fine ? 1.2 : 0.8, bevelSegments: fine ? 6 : 2, curveSegments: fine ? 24 : 6 }
      : { depth, bevelEnabled: false, curveSegments: 6 })
    geo.translate(0, 0, -depth / 2)
    const mat = v >= 5
      ? new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.3 })
      : new THREE.MeshLambertMaterial({ color })
    const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = v >= 6
    group.add(mesh)
    if (v >= 8) {   // gold trim: the outline as a thin gold line along the edges
      const edges = new THREE.EdgesGeometry(geo, 40)
      group.add(new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: GOLD, transparent: true, opacity: 0.55 })))
    }
  })
  if (v >= 12) {   // a soft halo behind the mark: a radial falloff in the shader (a canvas texture showed its square edge)
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(190, 190), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec2 vUv; void main() { float d = length(vUv - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); a = a * a * 0.3; gl_FragColor = vec4(vec3(0.86, 0.73, 0.37) * a, a); }',
    }))
    halo.position.z = -30
    scene.add(halo)
  }
  scene.add(group)
  if (v >= 3) { const key = new THREE.DirectionalLight(0xfff1c2, v >= 9 ? 2.4 : 1.6); key.position.set(-60, 80, 120); key.castShadow = v >= 6; key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 10, far: 400 }); key.shadow.radius = 4; scene.add(key) }
  else { const l = new THREE.DirectionalLight(0xffffff, 1.4); l.position.set(0, 0, 100); scene.add(l) }
  if (v >= 4) { const fill = new THREE.DirectionalLight(0xbfd8ff, 0.7); fill.position.set(90, 20, 60); scene.add(fill); const rim = new THREE.DirectionalLight(GOLD, 1.2); rim.position.set(30, 40, -120); scene.add(rim) }
  scene.add(new THREE.HemisphereLight(0x2a2414, 0x050505, v >= 4 ? 0.9 : 0.5))
  if (v >= 6) { const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.45 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -56; floor.receiveShadow = true; scene.add(floor) }
  const camera = new THREE.PerspectiveCamera(30, 1, 10, 1000); camera.position.set(0, v >= 10 ? 18 : 10, 235); camera.lookAt(0, -2, 0)
  group.rotation.x = v >= 10 ? 0.12 : 0.04
  return { scene, camera, group }
}

/** @param {{ mood?: 'idle'|'live'|'think'|'happy'|'oops'|'fire', size?: number, variant?: number, still?: boolean, className?: string }} props
 *  `still` drops the wrapper's throb and glow (the export rig renders a bare frame). */
export default function StudyMark3D({ mood = 'idle', size = 72, variant = 12, still = false, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    const host = ref.current; if (!host) return undefined
    let renderer
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }) } catch { return undefined }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(size, size)
    renderer.shadowMap.enabled = variant >= 6; renderer.shadowMap.type = THREE.PCFSoftShadowMap
    if (variant >= 9) { renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.3 }
    host.replaceChildren(renderer.domElement)
    const { scene, camera, group } = buildScene(variant)
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
    const per = (SPEED[mood] || 12) * 1000, t0 = performance.now()
    const tiltBase = variant >= 10 ? 0.12 : 0.04
    let raf = 0, visible = true
    const frame = (now) => {
      raf = requestAnimationFrame(frame)
      if (!visible) return
      const fixed = window.__uctLogoPhase   // the screenshot rig pins the turn (and the sway follows it, so a frame set loops)
      const t = fixed != null ? (fixed - 0.5) / (Math.PI * 2) : (now - t0) / per
      group.rotation.y = reduced && fixed == null ? 0.5 : t * Math.PI * 2 + 0.5
      if (variant >= 11 && (!reduced || fixed != null)) { group.rotation.x = tiltBase + Math.sin(t * Math.PI * 2 * 0.5) * 0.06; group.position.y = Math.sin(t * Math.PI * 2 * 0.75) * 2.5 }
      renderer.render(scene, camera)
    }
    let onScreen = true, tabShown = !document.hidden
    const io = typeof IntersectionObserver === 'function' ? new IntersectionObserver((es) => { onScreen = es.some((x) => x.isIntersecting); visible = onScreen && tabShown }) : null
    io?.observe(host)
    const onVis = () => { tabShown = !document.hidden; visible = onScreen && tabShown }   // a hidden tab draws nothing (phone battery)
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); io?.disconnect(); document.removeEventListener('visibilitychange', onVis); scene.traverse((o) => { o.geometry?.dispose?.(); if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((x) => x.dispose?.()) }); renderer.dispose(); renderer.domElement?.remove() }
  }, [mood, size, variant])
  const glow = still ? '' : mood === 'fire' ? m.fire : mood === 'happy' ? m.happy : mood === 'oops' ? m.oops : mood === 'live' ? m.live : mood === 'think' ? m.think : ''
  return (
    <div key={mood} className={`${still || variant < 11 ? '' : m.wrap} ${glow} ${className}`} style={{ width: size, height: size, flex: 'none', position: 'relative' }} aria-hidden="true">
      <div ref={ref} style={{ width: size, height: size }} />
      {!still && mood === 'fire' && variant >= 12 ? <><i className={m.spark} style={{ '--d': '0s', '--x': '18%' }} /><i className={m.spark} style={{ '--d': '.5s', '--x': '70%' }} /><i className={m.spark} style={{ '--d': '.9s', '--x': '44%' }} /></> : null}
    </div>
  )
}
