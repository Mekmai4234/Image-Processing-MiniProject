import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, Save, ScanLine, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { api, describeApiError, resolveApiUrl, type ReferenceProfile } from '../lib/api'
import { useAppData } from '../lib/AppData'

export function ReferencePage() {
  const { recheck, setSource } = useAppData()
  const [profile, setProfile] = useState<ReferenceProfile | null>(null)
  const [identity, setIdentity] = useState('bottle_a')
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [crop, setCrop] = useState([0.3, 0.35, 0.4, 0.25])
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  useEffect(() => {
    const ctrl = new AbortController()
    api.referenceProfile(ctrl.signal).then(setProfile).catch((e) => { if (!ctrl.signal.aborted) setError(describeApiError(e)) })
    return () => ctrl.abort()
  }, [])
  useEffect(() => {
    if (!file) { setPreview(''); return }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  async function save() {
    if (!file || !name.trim() || !acknowledged) return
    setBusy(true); setError(''); setSuccess('')
    const form = new FormData()
    form.append('image', file); form.append('product_id', identity)
    form.append('name', name.trim()); form.append('crop', JSON.stringify(crop))
    form.append('acknowledge_experimental', 'true')
    try {
      const result = await api.saveReference(form)
      setProfile(result); recheck()
      setSuccess(result.ready ? 'บันทึกแล้ว เริ่มตรวจสินค้านี้ได้ในโหมดเทียบภาพอ้างอิง ไม่จำเป็นต้องเพิ่มสินค้าที่สอง' : 'บันทึกแล้ว แต่ตัวตรวจยังไม่พร้อม กรุณาตรวจสถานะระบบ')
      setSource('live')
    } catch (e) { setError(describeApiError(e)) }
    finally { setBusy(false) }
  }

  async function remove(identity: string) {
    setBusy(true); setError(''); setSuccess('')
    try {
      const result = await api.removeReference(identity)
      setProfile(result); recheck()
      setSuccess('นำออกจากรายการใช้งานแล้ว ภาพเดิมและสำเนาการตั้งค่ายังเก็บสำรองในเครื่อง')
    } catch (e) { setError(describeApiError(e)) }
    finally { setBusy(false) }
  }

  return <div className="reference-page">
    <div className="page-head"><div><h1>Reference setup</h1><p>ตั้งค่าสินค้าและภาพฉลากอ้างอิงในเครื่องของคุณ</p></div><ScanLine size={34} /></div>
    <div className="notice review">โหมดทดลองเทียบภาพอ้างอิง: PASS/FAIL เป็นผลตามเกณฑ์เริ่มต้น ความคล้ายไม่ใช่ confidence หรือความแม่นยำที่สอบเทียบแล้ว ต้องใช้พื้นหลังเรียบและเลือกขวดตั้งตรงทั้งใบ</div>
    <div className="split">
      <section className="panel stack">
        <h2><Upload size={20} /> ภาพอ้างอิง</h2>
        <label className="field">สินค้า<select value={identity} disabled={busy} onChange={e => {setIdentity(e.target.value); setSuccess(''); setFile(null)}}><option value="bottle_a">Bottle A</option><option value="bottle_b">Bottle B</option></select></label>
        <label className="field">ชื่อยี่ห้อ / รุ่น / ขนาด<input type="text" value={name} maxLength={100} onChange={e => setName(e.target.value)} placeholder="เช่น น้ำดื่มรุ่นที่ใช้จริง 600 ml" /></label>
        <label className="field">ภาพขวดเต็มใบ JPG/PNG ไม่เกิน 10 MB<input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={e => {const f=e.target.files?.[0]; if(f && f.size <= 10_000_000){setFile(f);setError('')} else if(f) setError('ภาพต้องไม่เกิน 10 MB')}} /></label>
        {preview && <div className="reference-preview"><img src={preview} alt="ภาพขวดอ้างอิง เลือกกรอบให้ครอบเฉพาะฉลาก" /><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><rect x={crop[0]*100} y={crop[1]*100} width={crop[2]*100} height={crop[3]*100} fill="#12d5f522" stroke="#12d5f5" strokeWidth="0.7" /></svg></div>}
        <p className="hint">ปรับกรอบฟ้าให้ครอบเฉพาะฉลากด้านหน้าภายในตัวขวด ไม่รวมฝาและพื้นหลัง</p>
        <div className="reference-crop">{['ซ้าย (X)', 'บน (Y)', 'ความกว้าง', 'ความสูง'].map((label,i)=><label className="field" key={label}>{label} {Math.round(crop[i]*100)}%<input type="range" step="0.1" min={i<2?0:3} max={i===0?100-crop[2]*100:i===1?100-crop[3]*100:i===2?100-crop[0]*100:100-crop[1]*100} value={crop[i]*100} onChange={e=>setCrop(c=>c.map((v,j)=>j===i?Number(e.target.value)/100:v))} /></label>)}</div>
        <label className="row"><input type="checkbox" checked={acknowledged} onChange={e=>setAcknowledged(e.target.checked)} />ฉันเข้าใจว่าเป็นเกณฑ์ทดลอง และมีสิทธิ์ใช้ภาพนี้</label>
        {error && <p className="notice error" role="alert">{error}</p>}
        {success && <p className="notice success" role="status">{success}</p>}
        <button className="btn btn-primary" disabled={busy || !file || !name.trim() || !acknowledged} onClick={save}><Save size={18} />{busy?'กำลังบันทึก…':'บันทึกภาพอ้างอิง'}</button>
      </section>
      <section className="panel stack"><h2>สินค้าที่ตั้งค่าแล้ว</h2>
        {['bottle_a','bottle_b'].map(id=>{const p=profile?.products.find(p=>p.product_id===id);return <article className="reference-product" key={id}>{p?<><img src={resolveApiUrl(p.image_url+`?v=${profile?.version}`) ?? ''} alt={p.name}/><div><strong>{p.name}</strong><p className="hint">{id} · ภาพอ้างอิงในเครื่อง</p><span className="row"><CheckCircle2 size={17}/>บันทึกแล้ว</span></div></>:<><ScanLine size={32}/><div><strong>{id}</strong><p className="hint">ยังไม่ได้ตั้งค่า</p></div></>}</article>})}
        <div className="row">{profile?.products.map(p => <button key={p.product_id} className="btn btn-sm" disabled={busy} onClick={() => remove(p.product_id)}>นำภาพอ้างอิง {p.product_id === 'bottle_a' ? 'Bottle A' : 'Bottle B'} ออก</button>)}</div>
        <p className="hint">Bottle A/B ควรเป็นคนละสินค้า อย่าใส่ฉลากเดียวกันทั้งสองช่อง เพราะคะแนนจะใกล้กันจนแยกไม่ออก</p>
        <p className="hint">ภาพและ config เก็บใน STORAGE_ROOT/reference-profile และโหลดกลับเมื่อเปิด Backend ใหม่ ไม่มีการอัปโหลดเข้า GitHub</p>
        <p className="hint">บันทึกอย่างน้อยหนึ่งสินค้าก็เริ่มตรวจได้ เลือกตรวจเฉพาะสินค้าที่ตั้งค่าแล้ว หากมีเพียงหนึ่งสินค้า ภาพที่ความคล้ายต่ำจะเป็น REVIEW และไม่สามารถระบุชื่อสินค้าอื่นได้ ฉลากที่คล้ายกันอาจแยกผิด เพิ่มอีกสินค้าเมื่อต้องการเปรียบเทียบชนิดฉลาก แล้วลองภาพที่ไม่ใช่ภาพอ้างอิงและตรวจผลใน History</p>
        <Link className="btn btn-primary" to="/simulation">ไปหน้า Simulation <ArrowRight size={18}/></Link>
      </section>
    </div>
  </div>
}
