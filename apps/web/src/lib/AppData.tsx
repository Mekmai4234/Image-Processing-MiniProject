import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createDemoDataSource, type DemoScenario } from '../demo/demoDataSource'
import type { Product, ProductCatalog } from '../types/inspection'
import { describeApiError, isAbort } from './api'
import { liveDataSource, type DataSource } from './dataSource'
import { readinessOf, type Readiness } from './readiness'

export type SourceKind = 'live' | 'demo'
export type Connection =
  | { state: 'checking' }
  | { state: 'online'; configVersion?: string; readiness: Readiness }
  | { state: 'offline'; message: string }
  | { state: 'demo' }

interface AppDataValue {
  source: SourceKind
  setSource(kind: SourceKind): void
  ds: DataSource
  connection: Connection
  catalog: ProductCatalog | null
  products: Product[]
  catalogError: string | null
  recheck(): void
  scenario: DemoScenario
  setScenario(s: DemoScenario): void
}

const AppDataContext = createContext<AppDataValue | null>(null)
const STORAGE_KEY = 'vv.source'

function readStoredSource(): SourceKind {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'demo' ? 'demo' : 'live'
  } catch {
    return 'live'
  }
}

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [source, setSourceState] = useState<SourceKind>(readStoredSource)
  const [scenario, setScenario] = useState<DemoScenario>('pass')
  const scenarioRef = useRef(scenario)
  scenarioRef.current = scenario

  // สร้าง demo store ครั้งเดียว ผลที่ตรวจในโหมด DEMO จึงไปโผล่ใน History DEMO ได้
  const demo = useMemo(() => createDemoDataSource(() => scenarioRef.current), [])
  const ds = source === 'demo' ? demo : liveDataSource

  const [connection, setConnection] = useState<Connection>({ state: 'checking' })
  const [catalog, setCatalog] = useState<ProductCatalog | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const setSource = useCallback((kind: SourceKind) => {
    setSourceState(kind)
    try {
      localStorage.setItem(STORAGE_KEY, kind)
    } catch {
      /* storage ไม่พร้อมก็ไม่เป็นไร */
    }
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    setConnection(source === 'demo' ? { state: 'demo' } : { state: 'checking' })
    setCatalog(null)
    setCatalogError(null)
    ;(async () => {
      try {
        const h = await ds.health(ctrl.signal)
        if (source === 'live') setConnection({ state: 'online', configVersion: h.config_version, readiness: readinessOf(h) })
      } catch (err) {
        if (isAbort(err)) return
        setConnection({ state: 'offline', message: describeApiError(err) })
      }
      try {
        setCatalog(await ds.products(ctrl.signal))
      } catch (err) {
        if (isAbort(err)) return
        setCatalogError(describeApiError(err))
      }
    })()
    return () => ctrl.abort()
  }, [ds, source, tick])

  const value = useMemo<AppDataValue>(
    () => ({
      source,
      setSource,
      ds,
      connection,
      catalog,
      products: catalog?.products ?? [],
      catalogError,
      recheck: () => setTick((t) => t + 1),
      scenario,
      setScenario,
    }),
    [source, setSource, ds, connection, catalog, catalogError, scenario],
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppDataValue {
  const v = useContext(AppDataContext)
  if (!v) throw new Error('useAppData must be used inside AppDataProvider')
  return v
}
