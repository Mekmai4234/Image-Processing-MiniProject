import { describe, expect, it } from 'vitest'
import { DEMO_EXAMPLES } from '../demo/demoDataSource'
import type { InspectionFilesResponse } from '../types/inspection'
import { localFiles, resultFileName } from './historyFiles'
const record = DEMO_EXAMPLES[0]
const metadata: InspectionFilesResponse = {
  inspection_id: record.inspection_id, storage_status:'saved', all_available:false,
  files:[{name:'original.jpg',kind:'original',available:true,size_bytes:120},
         {name:'annotated.jpg',kind:'annotated',available:false,size_bytes:null},
         {name:'result.json',kind:'result_json',available:true,size_bytes:80}],
}
describe('file evidence from disk metadata',()=>{
  it('does not claim URLs or a saved DB row prove files still exist',()=>{
    expect(localFiles(record).every(f=>f.state==='unknown')).toBe(true)
    expect(localFiles(record,metadata).map(f=>f.state)).toEqual(['saved','missing','saved'])
  })
  it('rejects metadata from a previously selected row',()=>{
    expect(localFiles(record,{...metadata,inspection_id:'other'}).every(f=>f.state==='unknown')).toBe(true)
  })
  it('does not call an empty file saved',()=>{
    expect(localFiles(record,{...metadata,files:[{name:'original.jpg',kind:'original',available:true,size_bytes:0}]} )[0].state).toBe('missing')
  })
  it('distinguishes in-progress storage from confirmed disk evidence',()=>{
    expect(localFiles({...record,storage_status:'pending'}).every(f=>f.state==='pending')).toBe(true)
  })
  it('names results for the same inspection',()=>expect(resultFileName(record)).toBe('inspection-00000000.json'))
})
