// 05-owned isolated harness. Imports the public 02 component without editing the app.
import React, { useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  SimulationScene, MockInspectionPort, machineConfigFrom,
  type SimulationSceneHandle, type SimulationSnapshot, type MockVerdict,
} from '../../apps/web/src/features/simulation/index'
import './style.css'

const h = React.createElement
function Harness() {
  const scene = useRef<SimulationSceneHandle>(null)
  const port = useMemo(() => new MockInspectionPort({ inspect_delay_ms: 700 }), [])
  const config = useMemo(() => machineConfigFrom(), [])
  const [snapshot, setSnapshot] = useState<SimulationSnapshot | null>(null)
  const [completed, setCompleted] = useState(0)
  const [replayed, setReplayed] = useState(0)
  const [fallback, setFallback] = useState(false)
  const [issue, setIssue] = useState('')
  const start = (verdict: MockVerdict) => {
    scene.current?.reset()
    port.resetLocateCounter()
    port.setScenario({ verdict })
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#ccc"/><rect x="140" y="80" width="120" height="350" rx="20" fill="#add8e6"/><text x="20" y="480">SYNTHETIC HARNESS INPUT</text></svg>'
    const issues = scene.current?.start({ expected_product: 'bottle_a', views: [{ image: new Blob([svg], {type:'image/svg+xml'}), angle_deg:null, name:'synthetic-harness.svg' }] }) ?? []
    setIssue(issues.map(i => i.message).join('; '))
    scene.current?.setSpeed(3)
  }
  return h('main', {},
    h('h1', {}, '05 component smoke — DEMO only'),
    h('p', {}, 'Isolated 02 component, not integrated Simulation route. Synthetic results; no real detector, webcam or visual approval.'),
    h('nav', {},
      h('button', {onClick:()=>start('PASS')}, 'Run PASS DEMO'),
      h('button', {onClick:()=>start('FAIL_WRONG_LABEL')}, 'Run FAIL DEMO'),
      h('button', {onClick:()=>start('REVIEW_BLURRED')}, 'Run REVIEW DEMO'),
      h('button', {onClick:()=>scene.current?.pause()}, 'Pause'),
      h('button', {onClick:()=>scene.current?.resume()}, 'Resume'),
      h('button', {onClick:()=>scene.current?.replay()}, 'Replay'),
      h('button', {onClick:()=>scene.current?.reset()}, 'Reset'),
      h('button', {onClick:()=>setFallback(v=>!v)}, fallback?'Use WebGL if available':'Force 2D fallback'),
    ),
    h('p', {role:'alert'}, issue),
    h('section', {className:'stage'}, h(SimulationScene, {ref:scene,port,config,forceFallback:fallback,
      onSnapshot:setSnapshot,onCompleted:()=>setCompleted(n=>n+1),onReplayed:()=>setReplayed(n=>n+1)})),
    h('pre', {id:'observed-state','aria-label':'Observed component state'}, JSON.stringify({
      state:snapshot?.state,phase:snapshot?.phase,result:snapshot?.result?.result,
      route:snapshot?.route,inspection_id:snapshot?.inspection_id,completed,replayed,
      inspect_requests:port.calls.inspect.length,force_fallback:fallback,
      evidence_kind:'synthetic_component_browser',
    }, null, 2)),
  )
}
createRoot(document.getElementById('root')!).render(h(Harness))
