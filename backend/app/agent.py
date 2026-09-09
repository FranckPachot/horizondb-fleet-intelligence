import json
from typing import Literal

from app.config import Settings
from app.models import ChatResponse, SearchRequest, Shipment, ShipmentStatus
from app.repository import ShipmentRepository
from app.tools import ShipmentSearchTool

StatusArgument = Literal[
    "all",
    "in_transit",
    "delivered",
    "delayed",
    "exception",
    "unknown",
]


def _shipment_tool_payload(shipments: list[Shipment], search_mode: str) -> str:
    return json.dumps(
        {
            "search_mode": search_mode,
            "matches": [
                {
                    "shipment_number": shipment.shipment_number,
                    "title": shipment.title,
                    "description": shipment.description,
                    "status": shipment.status.value,
                    "origin": shipment.origin_name,
                    "destination": shipment.destination_name,
                    "current_location": shipment.current_location_name,
                    "eta": shipment.eta.isoformat() if shipment.eta else None,
                    "cosine_similarity": shipment.similarity,
                    "distance_km": shipment.distance_km,
                    "hybrid_score": shipment.hybrid_score,
                }
                for shipment in shipments
            ],
        }
    )


class ShipmentAgent:
    def __init__(
        self,
        settings: Settings,
        repository: ShipmentRepository,
    ) -> None:
        self._settings = settings
        self._repository = repository
        self._search_tool = ShipmentSearchTool(repository)

    async def run(self, request: SearchRequest) -> ChatResponse:
        effective_status = request.status or _infer_status(request.query)
        matched_shipments = await self._search_tool.invoke(
            query=request.query,
            status=effective_status,
            eta_date=request.eta_date,
            eta_days=request.eta_days,
            location=request.location,
            radius_km=request.radius_km,
            limit=request.limit,
        )
        context = _shipment_tool_payload(
            matched_shipments,
            self._repository.search_mode,
        )
        answer = await self._repository.generate_answer(request.query, context)

        return ChatResponse(
            query=request.query,
            search_mode=self._repository.search_mode,
            shipments=matched_shipments,
            answer=answer,
            ai_in_database=True,
            chat_model=self._settings.chat_model_alias,
        )


def _infer_status(query: str) -> ShipmentStatus | None:
    normalized = query.casefold().replace("-", "_").replace(" ", "_")
    for status in ShipmentStatus:
        if status.value in normalized:
            return status
    return None