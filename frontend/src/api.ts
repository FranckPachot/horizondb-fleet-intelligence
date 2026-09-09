import type {
  DatabaseCapabilities,
  ExplainPlan,
  SearchResponse,
  Shipment,
  ShipmentStats,
  ShipmentStatus,
  SpatialSearch,
} from './types'

const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    const message =
      typeof detail?.detail === 'string'
        ? detail.detail
        : `Request failed with status ${response.status}`
    throw new Error(message)
  }

  return response.json() as Promise<T>
}

export function getCapabilities(): Promise<DatabaseCapabilities> {
  return apiRequest('/api/health')
}

export function getShipments(): Promise<Shipment[]> {
  return apiRequest('/api/shipments')
}

export function getShipmentStats(): Promise<ShipmentStats> {
  return apiRequest('/api/shipments/stats')
}

export function getLastExplain(search: boolean): Promise<ExplainPlan | null> {
  return apiRequest(`/api/explain/last?search=${search}`)
}

export function searchShipments(
  query: string,
  status: ShipmentStatus | null,
  spatial: SpatialSearch,
): Promise<SearchResponse> {
  return apiRequest('/api/chat', {
    method: 'POST',
    body: JSON.stringify({
      query,
      status,
      eta_date: spatial.etaDate,
      eta_days: spatial.etaDate ? spatial.etaDays : null,
      location: spatial.location,
      radius_km: spatial.location ? spatial.radiusKm : null,
      limit: 8,
    }),
  })
}
