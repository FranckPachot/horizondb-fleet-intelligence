from datetime import date, datetime
from enum import StrEnum
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class ShipmentStatus(StrEnum):
    IN_TRANSIT = "in_transit"
    DELIVERED = "delivered"
    DELAYED = "delayed"
    EXCEPTION = "exception"
    UNKNOWN = "unknown"


class Coordinate(BaseModel):
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class Shipment(BaseModel):
    id: UUID
    shipment_number: str
    title: str
    description: str
    origin_name: str
    origin: Coordinate
    destination_name: str
    destination: Coordinate
    current_location_name: str
    current_position: Coordinate
    status: ShipmentStatus
    eta: date | None
    updated_at: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)
    similarity: float | None = Field(default=None, ge=-1, le=1)
    distance_km: float | None = Field(default=None, ge=0)
    hybrid_score: float | None = Field(default=None, ge=-1, le=1)


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)
    status: ShipmentStatus | None = None
    eta_date: date | None = None
    eta_days: int | None = Field(default=None, ge=0, le=365)
    location: Coordinate | None = None
    radius_km: float | None = Field(default=None, gt=0, le=20000)
    limit: int = Field(default=8, ge=1, le=24)

    @model_validator(mode="after")
    def validate_spatial_filter(self) -> "SearchRequest":
        if (self.location is None) != (self.radius_km is None):
            raise ValueError("location and radius_km must be provided together")
        if (self.eta_date is None) != (self.eta_days is None):
            raise ValueError("eta_date and eta_days must be provided together")
        return self


class SearchResponse(BaseModel):
    query: str
    search_mode: Literal["spatial_semantic_diskann"]
    shipments: list[Shipment]


class ChatResponse(SearchResponse):
    answer: str
    ai_in_database: Literal[True] = True
    chat_model: str


class StatusCount(BaseModel):
    status: ShipmentStatus
    count: int


class ShipmentStats(BaseModel):
    total: int
    statuses: list[StatusCount]


class DatabaseCapabilities(BaseModel):
    mode: Literal["horizondb"] = "horizondb"
    connected: bool
    postgis_version: str | None = None
    vector_version: str | None = None
    diskann_version: str | None = None
    azure_ai_version: str | None = None
    shipment_count: int = 0
    azure_embedding_count: int = 0
    embedding_mode: Literal["azure_openai"] = "azure_openai"
    embedding_model_alias: str
    ai_in_database: Literal[True] = True
    chat_model: str | None = None
    detail: str | None = None


class ExplainPlan(BaseModel):
    query: str
    plan: str
    captured_at: datetime
