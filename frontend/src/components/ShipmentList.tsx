import { Search, Workflow } from 'lucide-react'
import type { Shipment } from '../types'
import { STATUS_COLORS, STATUS_LABELS } from '../shipmentStatus'

interface ShipmentListProps {
  shipments: Shipment[]
  total: number
  selectedNumber: string | null
  showingResults: boolean
  loading: boolean
  onSelect: (shipment: Shipment) => void
  onShowExplain: () => void
}

export function ShipmentList({
  shipments,
  total,
  selectedNumber,
  showingResults,
  loading,
  onSelect,
  onShowExplain,
}: ShipmentListProps) {
  return (
    <aside className="shipment-panel workspace-panel" aria-label="Shipments">
      <div className="panel-heading shipment-heading">
        <div>
          <span className="eyebrow">{showingResults ? 'Agent matches' : 'Fleet overview'}</span>
          <h2>{showingResults ? 'Search results' : 'Shipments'}</h2>
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
            <span>Adjust the assistant search scope and try again.</span>
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