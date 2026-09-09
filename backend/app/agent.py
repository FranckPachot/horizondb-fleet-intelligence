import json
from typing import Annotated, Any, Literal, Protocol

from agent_framework import tool
from pydantic import Field

from app.horizon_agent_client import HorizonDBChatClient
from app.models import AgentRequest, ChatResponse, Shipment, ShipmentStatus
from app.repository import ShipmentRepository

StatusArgument = Literal[
    "all",
    "in_transit",
    "delivered",
    "delayed",
    "exception",
    "unknown",
]


class AgentRunner(Protocol):
    async def run(self, prompt: str) -> Any: ...


class AgentClient(Protocol):
    def as_agent(self, **kwargs: Any) -> AgentRunner: ...


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
        repository: ShipmentRepository,
        client: AgentClient | None = None,
    ) -> None:
        self._repository = repository
        self._client = client or HorizonDBChatClient(
            repository,
            repository.chat_model_name,
        )

    async def run(self, request: AgentRequest) -> ChatResponse:
        matched_shipments: list[Shipment] = []
        tool_invoked = False

        @tool(
            name="search_shipments",
            description=(
                "Search live shipments by meaning and optional status. HorizonDB retrieves "
                "candidates with spherical-quantized DiskANN and returns ranked evidence."
            ),
            max_invocations=1,
        )
        async def search_shipments(
            query_text: Annotated[
                str,
                Field(
                    description=(
                        "Concise cargo, route, region, or operational intent to find."
                    ),
                    min_length=2,
                ),
            ],
            status_filter: Annotated[
                StatusArgument,
                Field(
                    description=(
                        "Status explicitly requested by the user, or 'all' when none is requested."
                    )
                ),
            ] = "all",
        ) -> str:
            nonlocal tool_invoked
            tool_invoked = True
            inferred_status = (
                None if status_filter == "all" else ShipmentStatus(status_filter)
            )
            effective_status = inferred_status or _infer_status(request.query)
            results = await self._repository.semantic_search(
                query=query_text,
                status=effective_status,
                eta_date=None,
                eta_days=None,
                location=None,
                radius_km=None,
                limit=request.limit,
            )
            matched_shipments[:] = results
            return _shipment_tool_payload(results, self._repository.search_mode)

        agent = self._client.as_agent(
            name="HorizonDBFleetAgent",
            instructions=(
                "You are a concise fleet operations assistant. Call search_shipments "
                "exactly once before answering every request. Base every shipment number, "
                "route, status, ETA, distance, and score only on its output. Never invent "
                "a shipment."
            ),
            tools=[search_shipments],
        )
        result = await agent.run(request.query)
        if not tool_invoked:
            raise RuntimeError("Agent Framework completed without invoking search_shipments")

        return ChatResponse(
            query=request.query,
            search_mode=self._repository.search_mode,
            shipments=matched_shipments,
            answer=result.text,
            agent_framework=True,
            ai_in_database=True,
            chat_model=self._repository.chat_model_name,
            explain=self._repository.last_explain(search=True),
        )


def _infer_status(query: str) -> ShipmentStatus | None:
    normalized = query.casefold().replace("-", "_").replace(" ", "_")
    for status in ShipmentStatus:
        if status.value in normalized:
            return status
    return None