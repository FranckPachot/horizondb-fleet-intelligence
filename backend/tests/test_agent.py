from datetime import date

import pytest
from app.agent import ShipmentAgent
from app.config import Settings
from app.models import Coordinate, SearchRequest


@pytest.mark.asyncio
async def test_horizondb_ai_uses_grounded_semantic_results(
    live_settings: Settings,
    fake_repository,
) -> None:
    agent = ShipmentAgent(
        live_settings,
        fake_repository,
    )

    result = await agent.run(
        SearchRequest(
            query="Find healthcare cargo near Rotterdam",
            eta_date=date(2026, 9, 9),
            eta_days=2,
            location=Coordinate(latitude=51.9244, longitude=4.4777),
            radius_km=250,
            limit=5,
        )
    )

    assert result.ai_in_database is True
    assert result.chat_model == "default-chat"
    assert result.shipments[0].shipment_number == "SHIP-0014"
    assert result.answer.startswith("SHIP-0014")
    assert fake_repository.last_search == {
        "query": "Find healthcare cargo near Rotterdam",
        "status": None,
        "eta_date": date(2026, 9, 9),
        "eta_days": 2,
        "location": Coordinate(latitude=51.9244, longitude=4.4777),
        "radius_km": 250,
        "limit": 5,
    }
