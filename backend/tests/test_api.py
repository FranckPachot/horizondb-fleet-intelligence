import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def make_client(live_settings, fake_repository) -> TestClient:
    return TestClient(
        create_app(
            settings=live_settings,
            repository=fake_repository,
        )
    )


def test_health_and_list_endpoints_report_live_capabilities(
    live_settings,
    fake_repository,
) -> None:
    with make_client(live_settings, fake_repository) as client:
        health = client.get("/api/health")
        shipments = client.get("/api/shipments", params={"status": "delayed"})

    assert health.status_code == 200
    assert health.json()["mode"] == "horizondb"
    assert health.json()["shipment_count"] == 24
    assert health.json()["embedding_mode"] == "azure_openai"
    assert health.json()["diskann_spherical_quantization"] is True
    assert health.json()["diskann_sq_bits"] == 4
    assert health.json()["diskann_sq_training_samples"] == 25000
    assert health.json()["agent_framework"] is True
    assert health.json()["ai_in_database"] is True
    assert health.json()["chat_model"] == "gpt-5.4"
    assert shipments.status_code == 200
    assert {shipment["status"] for shipment in shipments.json()} == {"delayed"}
    assert len(shipments.json()) == 3


def test_last_explain_is_empty_before_a_captured_query(
    live_settings,
    fake_repository,
) -> None:
    with make_client(live_settings, fake_repository) as client:
        response = client.get("/api/explain/last", params={"search": "false"})

    assert response.status_code == 200
    assert response.json() is None
    assert fake_repository.last_explain_search is False


def test_semantic_search_and_detail_endpoints(
    live_settings,
    fake_repository,
) -> None:
    with make_client(live_settings, fake_repository) as client:
        response = client.post(
            "/api/search",
            json={
                "query": "healthcare cargo for clinics",
                "eta_date": "2026-09-09",
                "eta_days": 2,
                "location": {"latitude": 51.9244, "longitude": 4.4777},
                "radius_km": 250,
                "limit": 5,
            },
        )
        spatial_search = fake_repository.last_search
        chat = client.post(
            "/api/chat",
            json={"query": "healthcare cargo for clinics", "limit": 5},
        )
        detail = client.get("/api/shipments/ship-0014")

    assert response.status_code == 200
    assert response.json()["search_mode"] == "spatial_semantic_diskann"
    assert response.json()["shipments"][0]["shipment_number"] == "SHIP-0014"
    assert spatial_search["location"].latitude == 51.9244
    assert spatial_search["radius_km"] == 250
    assert spatial_search["eta_date"].isoformat() == "2026-09-09"
    assert spatial_search["eta_days"] == 2
    assert chat.status_code == 200
    assert chat.json()["agent_framework"] is True
    assert chat.json()["ai_in_database"] is True
    assert chat.json()["chat_model"] == "gpt-5.4"
    assert chat.json()["shipments"][0]["shipment_number"] == "SHIP-0014"
    assert chat.json()["answer"].startswith("SHIP-0014")
    assert detail.status_code == 200
    assert detail.json()["title"] == "Hospital Equipment"


def test_unknown_shipment_and_invalid_search_are_rejected(
    live_settings,
    fake_repository,
) -> None:
    with make_client(live_settings, fake_repository) as client:
        missing = client.get("/api/shipments/SHIP-9999")
        invalid = client.post("/api/search", json={"query": "x"})
        agent_with_criteria = client.post(
            "/api/chat",
            json={"query": "Find delayed shipments", "status": "delayed"},
        )

    assert missing.status_code == 404
    assert invalid.status_code == 422
    assert agent_with_criteria.status_code == 422


def test_startup_rejects_missing_live_configuration() -> None:
    app = create_app(settings=Settings(_env_file=None))

    with (
        pytest.raises(ValueError, match="Live HorizonDB configuration"),
        TestClient(app),
    ):
        pass