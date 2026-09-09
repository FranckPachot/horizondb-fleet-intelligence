export type ShipmentStatus =
  | 'in_transit'
  | 'delivered'
  | 'delayed'
  | 'exception'
  | 'unknown'

export interface Coordinate {
  latitude: number
  longitude: number
}

export interface Shipment {
  id: string
  shipment_number: string
  title: string
  description: string
  origin_name: string
  origin: Coordinate
  destination_name: string
  destination: Coordinate
  current_location_name: string
  current_position: Coordinate
  status: ShipmentStatus
  eta: string | null
  updated_at: string
  metadata: {
    regions?: string[]
    tags?: string[]
    [key: string]: unknown
  }
  similarity: number | null
  distance_km: number | null
  hybrid_score: number | null
}

export interface SpatialSearch {
  location: Coordinate | null
  radiusKm: number
  etaDate: string | null
  etaDays: number
}

export interface DatabaseCapabilities {
  mode: 'horizondb'
  connected: boolean
  postgis_version: string | null
  vector_version: string | null
  diskann_version: string | null
  diskann_spherical_quantization: boolean
  diskann_sq_bits: number | null
  diskann_sq_training_samples: number | null
  azure_ai_version: string | null
  shipment_count: number
  azure_embedding_count: number
  embedding_mode: 'azure_openai'
  embedding_model_alias: string
  agent_framework: true
  ai_in_database: true
  chat_model: string
  detail: string | null
}

export interface StatusCount {
  status: ShipmentStatus
  count: number
}

export interface ShipmentStats {
  total: number
  statuses: StatusCount[]
}

export interface SearchResponse {
  query: string
  search_mode: 'spatial_semantic_diskann'
  shipments: Shipment[]
}

export interface ChatResponse extends SearchResponse {
  answer: string
  agent_framework: true
  ai_in_database: true
  chat_model: string
  explain: ExplainPlan | null
}

export interface ExplainPlan {
  query: string
  plan: string
  captured_at: string
}
