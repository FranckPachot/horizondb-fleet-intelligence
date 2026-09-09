from dataclasses import dataclass
from datetime import date

from app.models import Coordinate, Shipment, ShipmentStatus
from app.repository import ShipmentRepository


@dataclass(frozen=True)
class ShipmentSearchTool:
    repository: ShipmentRepository

    name = "search_shipments"
    description = (
        "Find shipments by natural-language intent, optional status, and an optional "
        "PostGIS center and radius. Returns HorizonDB hybrid-ranked evidence."
    )

    async def invoke(
        self,
        *,
        query: str,
        status: ShipmentStatus | None,
        eta_date: date | None,
        eta_days: int | None,
        location: Coordinate | None,
        radius_km: float | None,
        limit: int,
    ) -> list[Shipment]:
        return await self.repository.semantic_search(
            query=query,
            status=status,
            eta_date=eta_date,
            eta_days=eta_days,
            location=location,
            radius_km=radius_km,
            limit=limit,
        )