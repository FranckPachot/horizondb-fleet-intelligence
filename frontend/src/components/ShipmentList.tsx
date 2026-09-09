import { useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarDays, MapPinned, RotateCcw, Search, Workflow, X } from 'lucide-react'
import type { Coordinate, SearchResponse, Shipment, ShipmentStatus } from '../types'
import { STATUS_COLORS, STATUS_LABELS } from '../shipmentStatus'

interface ShipmentListProps {
  shipments: Shipment[]
  total: number
  selectedNumber: string | null
  showingResults: boolean
  resultSource: 'criteria' | 'agent' | null
  loading: boolean
  status: ShipmentStatus | 'all'
  onStatusChange: (status: ShipmentStatus | 'all') => void
  etaDate: string | null
  etaDays: number
  onEtaDateChange: (date: string | null) => void
  onEtaDaysChange: (days: number) => void
  searchCenter: Coordinate | null
  searchRadiusKm: number
  onSearchRadiusChange: (radiusKm: number) => void
  onClearSearchCenter: () => void
  onSearch: (query: string) => Promise<SearchResponse>
  onReset: () => void
  onSelect: (shipment: Shipment) => void
  onShowExplain: () => void
}

export function ShipmentList({
  shipments,
  total,
  selectedNumber,
  showingResults,
  resultSource,
  loading,
  status,
  onStatusChange,
  etaDate,
  etaDays,
  onEtaDateChange,
  onEtaDaysChange,
  searchCenter,
  searchRadiusKm,
  onSearchRadiusChange,
  onClearSearchCenter,
  onSearch,
  onReset,
  onSelect,
  onShowExplain,
}: ShipmentListProps) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const statusColor = status === 'all' ? '#758496' : STATUS_COLORS[status]

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = query.trim()
    if (normalized.length < 2 || searching) return
    setSearching(true)
    setSearchError(null)
    try {
      await onSearch(normalized)
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : 'Search failed.')
    } finally {
      setSearching(false)
    }
  }

  function resetSearch() {
    setQuery('')
    setSearchError(null)
    onReset()
  }

  const resultLabel = resultSource === 'agent'
    ? 'Agent matches'
    : resultSource === 'criteria'
      ? 'Criteria results'
      : 'Search workbench'

  return (
    <aside className="shipment-panel workspace-panel" aria-label="Shipments">
      <div className="panel-heading shipment-heading">
        <div>
          <span className="eyebrow">{resultLabel}</span>
          <h2>Find shipments</h2>
        </div>
        <div className="result-heading-actions">
          <span className="count-badge" aria-label={`${total} total shipments`}>
            {total}
          </span>
          <button
            className="result-plan-icon"
            type="button"
            onClick={onShowExplain}
            title="Execution plan"
            aria-label={showingResults ? 'Show result execution plan' : 'Show list execution plan'}
          >
            <Workflow size={14} />
          </button>
        </div>
      </div>

      <form className="criteria-search-form" onSubmit={submitSearch}>
        <label className="criteria-query-field">
          <span>Search intent</span>
          <span className="criteria-query-row">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="medical cargo near Rotterdam"
              maxLength={300}
              disabled={searching}
            />
            <button
              type="submit"
              title="Run criteria search"
              aria-label="Run criteria search"
              disabled={query.trim().length < 2 || searching}
            >
              <Search size={15} />
            </button>
          </span>
        </label>
        <label className="criteria-status-field">
          <span><i style={{ backgroundColor: statusColor }} />Status</span>
          <select
            value={status}
            style={{ borderColor: statusColor, color: statusColor }}
            onChange={(event) =>
              onStatusChange(event.target.value as ShipmentStatus | 'all')
            }
          >
            <option value="all">All statuses</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="eta-field">
          <span><CalendarDays size={13} />ETA</span>
          <span className="eta-inputs">
            <input
              type="date"
              value={etaDate ?? ''}
              onChange={(event) => onEtaDateChange(event.target.value || null)}
            />
            <b>±</b>
            <input
              type="number"
              min="0"
              max="365"
              value={etaDays}
              disabled={!etaDate}
              aria-label="ETA tolerance in days"
              onChange={(event) => onEtaDaysChange(Number(event.target.value))}
            />
            <small>days</small>
            {etaDate ? (
              <button
                type="button"
                title="Clear ETA filter"
                aria-label="Clear ETA filter"
                onClick={() => onEtaDateChange(null)}
              >
                <X size={13} />
              </button>
            ) : null}
          </span>
        </label>
        <div className="spatial-search-status">
          <MapPinned size={15} aria-hidden="true" />
          <span>
            <b>{searchCenter ? 'Map radius active' : 'Click map to add radius'}</b>
            {searchCenter ? (
              <small>{searchCenter.latitude.toFixed(2)}, {searchCenter.longitude.toFixed(2)}</small>
            ) : null}
          </span>
          {searchCenter ? (
            <button type="button" onClick={onClearSearchCenter}>Clear</button>
          ) : null}
        </div>
        <label className={`radius-field ${searchCenter ? '' : 'disabled'}`}>
          <span>Radius <b>{searchRadiusKm.toLocaleString()} km</b></span>
          <input
            type="range"
            min="50"
            max="3000"
            step="50"
            value={searchRadiusKm}
            disabled={!searchCenter}
            onChange={(event) => onSearchRadiusChange(Number(event.target.value))}
          />
        </label>
        <div className="criteria-form-footer">
          <button type="button" onClick={resetSearch}>
            <RotateCcw size={13} /> Clear
          </button>
          {searchError ? <span role="alert">{searchError}</span> : null}
        </div>
      </form>

      <div className="shipment-list" aria-live="polite" aria-busy={loading}>
        {loading && shipments.length === 0
          ? Array.from({ length: 6 }, (_, index) => (
              <div className="shipment-skeleton" key={index} />
            ))
          : null}

        {!loading && shipments.length === 0 ? (
          <div className="empty-state">
            <Search size={22} />
            <strong>No matching shipments</strong>
            <span>Adjust the criteria or ask the agent a different question.</span>
          </div>
        ) : null}

        {shipments.map((shipment) => (
          <button
            className={`shipment-card ${
              selectedNumber === shipment.shipment_number ? 'selected' : ''
            }`}
            key={shipment.id}
            type="button"
            onClick={() => onSelect(shipment)}
          >
            <span
              className="shipment-card-dot"
              style={{ backgroundColor: STATUS_COLORS[shipment.status] }}
              aria-hidden="true"
            />
            <span className="shipment-card-body">
              <span className="shipment-card-topline">
                <strong>{shipment.shipment_number}</strong>
                {shipment.similarity !== null ? (
                  <span
                    className="similarity-mini"
                    title="Cosine similarity, not a probability"
                  >
                    cos {shipment.similarity.toFixed(2)}
                  </span>
                ) : null}
              </span>
              <span className="shipment-title">{shipment.title}</span>
              <span className="shipment-destination">
                {shipment.destination_name}
              </span>
              <span className={`status-text status-text-${shipment.status}`}>
                {STATUS_LABELS[shipment.status]}
              </span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}