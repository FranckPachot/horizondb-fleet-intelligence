import {
  startTransition,
  useEffect,
  useState,
} from 'react'
import {
  Bot,
  Boxes,
  Database,
  Map as MapIcon,
  PackageSearch,
  Radio,
} from 'lucide-react'
import {
  chatWithAgent,
  getCapabilities,
  getLastExplain,
  getShipments,
  getShipmentStats,
  searchShipments,
} from './api'
import { ChatPanel } from './components/ChatPanel'
import { ExplainPlanModal } from './components/ExplainPlanModal'
import { ShipmentDetail } from './components/ShipmentDetail'
import { ShipmentList } from './components/ShipmentList'
import { ShipmentMap } from './components/ShipmentMap'
import type {
  DatabaseCapabilities,
  ChatResponse,
  Coordinate,
  ExplainPlan,
  SearchResponse,
  Shipment,
  ShipmentStats,
  ShipmentStatus,
} from './types'
import './App.css'

type StatusFilter = ShipmentStatus | 'all'
type MobileView = 'shipments' | 'map' | 'assistant'
type ResultSource = 'criteria' | 'agent' | null

function App() {
  const [shipments, setShipments] = useState<Shipment[]>([])
  const [semanticResults, setSemanticResults] = useState<Shipment[] | null>(null)
  const [resultSource, setResultSource] = useState<ResultSource>(null)
  const [stats, setStats] = useState<ShipmentStats | null>(null)
  const [capabilities, setCapabilities] =
    useState<DatabaseCapabilities | null>(null)
  const [selected, setSelected] = useState<Shipment | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [etaDate, setEtaDate] = useState<string | null>(null)
  const [etaDays, setEtaDays] = useState(3)
  const [searchCenter, setSearchCenter] = useState<Coordinate | null>(null)
  const [searchRadiusKm, setSearchRadiusKm] = useState(500)
  const [mobileView, setMobileView] = useState<MobileView>('map')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [explainOpen, setExplainOpen] = useState(false)
  const [explain, setExplain] = useState<ExplainPlan | null>(null)
  const [explainLoading, setExplainLoading] = useState(false)
  const [explainError, setExplainError] = useState<string | null>(null)

  async function loadWorkspace() {
    setLoading(true)
    setError(null)
    try {
      const [nextShipments, nextStats, nextCapabilities] = await Promise.all([
        getShipments(),
        getShipmentStats(),
        getCapabilities(),
      ])
      startTransition(() => {
        setShipments(nextShipments)
        setStats(nextStats)
        setCapabilities(nextCapabilities)
      })
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Unable to load the shipping workspace.',
      )
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([getShipments(), getShipmentStats(), getCapabilities()])
      .then(([nextShipments, nextStats, nextCapabilities]) => {
        if (cancelled) return
        startTransition(() => {
          setShipments(nextShipments)
          setStats(nextStats)
          setCapabilities(nextCapabilities)
        })
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Unable to load the shipping workspace.',
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const sourceShipments = semanticResults ?? shipments
  const visibleShipments = sourceShipments

  const mapSelection = selected
    ? visibleShipments.find(
        (shipment) => shipment.shipment_number === selected.shipment_number,
      ) ?? null
    : null

  function selectShipment(shipment: Shipment, revealMap = false) {
    setSelected(shipment)
    if (revealMap) setMobileView('map')
  }

  function showAllShipments() {
    startTransition(() => {
      setSemanticResults(null)
      setResultSource(null)
      setStatus('all')
      setEtaDate(null)
      setSearchCenter(null)
      setSearchRadiusKm(500)
      setSelected(null)
      setExplainOpen(false)
    })
  }

  async function runCriteriaSearch(query: string): Promise<SearchResponse> {
    setExplainOpen(false)
    const result = await searchShipments(
      query,
      status === 'all' ? null : status,
      {
        location: searchCenter,
        radiusKm: searchRadiusKm,
        etaDate,
        etaDays,
      },
    )
    startTransition(() => {
      setSemanticResults(result.shipments)
      setResultSource('criteria')
      setSelected(result.shipments[0] ?? null)
    })
    return result
  }

  async function runAgentSearch(query: string): Promise<ChatResponse> {
    setExplainOpen(false)
    const result = await chatWithAgent(query)
    startTransition(() => {
      setSemanticResults(result.shipments)
      setResultSource('agent')
      setSelected(result.shipments[0] ?? null)
    })
    return result
  }

  const statusTotal = (shipmentStatus: ShipmentStatus) =>
    stats?.statuses.find((item) => item.status === shipmentStatus)?.count ?? 0

  async function showLastExplain() {
    setExplainOpen(true)
    setExplainLoading(true)
    setExplainError(null)
    try {
      setExplain(await getLastExplain(semanticResults !== null))
    } catch (loadError) {
      setExplainError(
        loadError instanceof Error ? loadError.message : 'Unable to load execution plan.',
      )
    } finally {
      setExplainLoading(false)
    }
  }

  function showExplain(explainPlan: ExplainPlan) {
    setExplain(explainPlan)
    setExplainError(null)
    setExplainLoading(false)
    setExplainOpen(true)
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Boxes size={20} />
          </span>
          <div>
            <strong>Fleet Intelligence</strong>
            <span>Powered by HorizonDB</span>
          </div>
        </div>

        <div className="capability-strip" aria-label="Platform capabilities">
          <span className={capabilities?.connected ? 'available' : 'standby'}>
            <Database size={14} />
            {capabilities?.connected ? 'HorizonDB live' : 'HorizonDB'}
          </span>
          <span className={capabilities?.postgis_version ? 'available' : 'standby'}>
            <MapIcon size={14} />
            PostGIS
          </span>
          <span
            className={capabilities?.diskann_spherical_quantization ? 'available' : 'standby'}
            title={
              capabilities?.diskann_spherical_quantization
                ? `Spherical quantization: ${capabilities.diskann_sq_bits}-bit, ${capabilities.diskann_sq_training_samples?.toLocaleString()} training samples`
                : 'DiskANN spherical quantization'
            }
          >
            <PackageSearch size={14} />
            {capabilities?.diskann_sq_bits
              ? `SQ${capabilities.diskann_sq_bits} DiskANN`
              : 'SQ DiskANN'}
          </span>
          <span className={capabilities?.agent_framework ? 'available' : 'standby'}>
            <Bot size={14} />
            Agent Framework
          </span>
        </div>

        <div className="network-state">
          <Radio size={15} aria-hidden="true" />
          <span>
            <strong>{stats?.total ?? shipments.length}</strong>
            tracked
          </span>
        </div>
      </header>

      {error ? (
        <div className="load-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void loadWorkspace()}>
            Retry
          </button>
        </div>
      ) : null}

      <main className={`workspace mobile-view-${mobileView}`}>
        <ShipmentList
          shipments={visibleShipments}
          total={visibleShipments.length}
          selectedNumber={mapSelection?.shipment_number ?? null}
          showingResults={semanticResults !== null}
          resultSource={resultSource}
          loading={loading}
          status={status}
          onStatusChange={setStatus}
          etaDate={etaDate}
          etaDays={etaDays}
          onEtaDateChange={setEtaDate}
          onEtaDaysChange={setEtaDays}
          searchCenter={searchCenter}
          searchRadiusKm={searchRadiusKm}
          onSearchRadiusChange={setSearchRadiusKm}
          onClearSearchCenter={() => setSearchCenter(null)}
          onSearch={runCriteriaSearch}
          onReset={showAllShipments}
          onSelect={(shipment) => selectShipment(shipment, true)}
          onShowExplain={() => void showLastExplain()}
        />

        <section className="map-workspace" aria-label="Global shipment map">
          <div className="map-summary" aria-label="Shipment status summary">
            <span>
              <i className="summary-dot transit" />
              <b>{statusTotal('in_transit')}</b> in transit
            </span>
            <span>
              <i className="summary-dot delayed" />
              <b>{statusTotal('delayed')}</b> delayed
            </span>
            <span>
              <i className="summary-dot exception" />
              <b>{statusTotal('exception')}</b> exceptions
            </span>
            {semanticResults ? (
              <button type="button" onClick={showAllShipments}>
                Show all {shipments.length}
              </button>
            ) : null}
          </div>
          <ShipmentMap
            shipments={visibleShipments}
            selected={mapSelection}
            searchCenter={searchCenter}
            searchRadiusKm={searchRadiusKm}
            onSelect={(shipment) => selectShipment(shipment)}
            onSearchCenterChange={setSearchCenter}
          />
          {mapSelection ? (
            <ShipmentDetail
              shipment={mapSelection}
              onClose={() => setSelected(null)}
            />
          ) : null}
        </section>

        <ChatPanel
          onSearch={runAgentSearch}
          onSelect={(shipment) => selectShipment(shipment, true)}
          onShowExplain={showExplain}
          selectedNumber={mapSelection?.shipment_number ?? null}
        />
      </main>

      <nav className="mobile-navigation" aria-label="Workspace views">
        <button
          type="button"
          className={mobileView === 'shipments' ? 'active' : ''}
          onClick={() => setMobileView('shipments')}
        >
          <Boxes size={19} />
          Shipments
        </button>
        <button
          type="button"
          className={mobileView === 'map' ? 'active' : ''}
          onClick={() => setMobileView('map')}
        >
          <MapIcon size={19} />
          Map
        </button>
        <button
          type="button"
          className={mobileView === 'assistant' ? 'active' : ''}
          onClick={() => setMobileView('assistant')}
        >
          <Bot size={19} />
          Assistant
        </button>
      </nav>
      {explainOpen ? (
        <ExplainPlanModal
          explain={explain}
          loading={explainLoading}
          error={explainError}
          onClose={() => setExplainOpen(false)}
        />
      ) : null}
    </div>
  )
}

export default App
