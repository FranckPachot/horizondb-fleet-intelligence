from datetime import UTC, date, datetime, timedelta

import pytest

from app.config import Settings
from app.models import (
    Coordinate,
    DatabaseCapabilities,
    ExplainPlan,
    Shipment,
    ShipmentStats,
    ShipmentStatus,
    StatusCount,
)
from app.sample_data import build_sample_shipments


class FakeShipmentRepository:
    mode = "horizondb"
    search_mode = "spatial_semantic_diskann"
    chat_model_name = "gpt-5.4"

    def __init__(self) -> None:
        self._shipments = build_sample_shipments()
        self.last_search: dict | None = None
        self.last_tool_plan: dict | None = None
        self.last_explain_search: bool | None = None

    async def list_shipments(
        self,
        status: ShipmentStatus | None = None,
        search: str | None = None,
    ) -> list[Shipment]:
        shipments = self._shipments
        if status is not None:
            shipments = [item for item in shipments if item.status is status]
        if search:
            normalized = search.casefold()
            shipments = [
                item
                for item in shipments
                if normalized
                in (
                    f"{item.shipment_number} {item.title} {item.description} "
                    f"{item.origin_name} {item.destination_name} "
                    f"{item.current_location_name}"
                ).casefold()
            ]
        return shipments

    async def semantic_search(
        self,
        query: str,
        status: ShipmentStatus | None,
        eta_date: date | None,
        eta_days: int | None,
        location: Coordinate | None,
        radius_km: float | None,
        limit: int,
    ) -> list[Shipment]:
        self.last_search = {
            "query": query,
            "status": status,
            "eta_date": eta_date,
            "eta_days": eta_days,
            "location": location,
            "radius_km": radius_km,
            "limit": limit,
        }
        shipments = await self.list_shipments(status=status)
        if eta_date is not None and eta_days is not None:
            lower = eta_date - timedelta(days=eta_days)
            upper = eta_date + timedelta(days=eta_days)
            shipments = [
                item
                for item in shipments
                if item.eta is not None and lower <= item.eta <= upper
            ]
        shipments.sort(key=lambda item: item.shipment_number != "SHIP-0014")
        return [
            item.model_copy(update={"similarity": 0.95 - index * 0.05})
            for index, item in enumerate(shipments[:limit])
        ]

    async def generate_answer(self, question: str, context: str) -> str:
        assert question
        assert "SHIP-0014" in context
        return "SHIP-0014 is the strongest medical match."

    async def plan_tool_call(
        self,
        question: str,
        tool_name: str,
        tool_schema: str,
    ) -> dict[str, str]:
        self.last_tool_plan = {
            "question": question,
            "tool_name": tool_name,
            "tool_schema": tool_schema,
        }
        return {
            "query_text": question.splitlines()[0],
            "status_filter": "all",
        }

    async def get_shipment(self, shipment_number: str) -> Shipment | None:
        return next(
            (
                item
                for item in self._shipments
                if item.shipment_number == shipment_number
            ),
            None,
        )

    async def stats(self) -> ShipmentStats:
        counts = {
            status: sum(item.status is status for item in self._shipments)
            for status in ShipmentStatus
        }
        return ShipmentStats(
            total=len(self._shipments),
            statuses=[
                StatusCount(status=status, count=counts[status])
                for status in ShipmentStatus
            ],
        )

    async def capabilities(self) -> DatabaseCapabilities:
        return DatabaseCapabilities(
            mode=self.mode,
            connected=True,
            postgis_version="3.5.2",
            vector_version="0.8.0",
            diskann_version="0.7.3",
            diskann_spherical_quantization=True,
            diskann_sq_bits=4,
            diskann_sq_training_samples=25000,
            azure_ai_version="2.2.2",
            shipment_count=len(self._shipments),
            azure_embedding_count=len(self._shipments),
            embedding_mode="azure_openai",
            embedding_model_alias="default-embedding",
        )

    def last_explain(self, search: bool = True) -> ExplainPlan | None:
        self.last_explain_search = search
        if self.last_search is None:
            return None
        return ExplainPlan(
            query="SELECT * FROM horizon_ship.shipments ORDER BY embedding <=> $1;",
            plan="Custom Scan (DiskANNFilteredScan)",
            captured_at=datetime.now(UTC),
        )


@pytest.fixture
def live_settings() -> Settings:
    return Settings(
        _env_file=None,
        database_url="postgresql://user:password@localhost/migration_lab",
    )


@pytest.fixture
def fake_repository() -> FakeShipmentRepository:
    return FakeShipmentRepository()
