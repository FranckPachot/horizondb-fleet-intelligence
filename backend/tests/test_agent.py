import pytest

from app.agent import ShipmentAgent
from app.models import AgentRequest


@pytest.mark.asyncio
async def test_agent_framework_tool_drives_horizondb_results(
    fake_repository,
) -> None:
    agent = ShipmentAgent(
        fake_repository,
    )

    result = await agent.run(
        AgentRequest(query="Find healthcare cargo", limit=5)
    )

    assert result.agent_framework is True
    assert result.ai_in_database is True
    assert result.chat_model == "gpt-5.4"
    assert result.shipments[0].shipment_number == "SHIP-0014"
    assert result.answer.startswith("SHIP-0014")
    assert result.explain is not None
    assert "ORDER BY embedding <=>" in result.explain.query
    assert fake_repository.last_search == {
        "query": "Find healthcare cargo",
        "status": None,
        "eta_date": None,
        "eta_days": None,
        "location": None,
        "radius_km": None,
        "limit": 5,
    }
    assert fake_repository.last_tool_plan is not None
    assert fake_repository.last_tool_plan["tool_name"] == "search_shipments"
    assert '"status_filter"' in fake_repository.last_tool_plan["tool_schema"]
