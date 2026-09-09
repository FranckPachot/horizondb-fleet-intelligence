from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.agent import ShipmentAgent
from app.config import Settings, get_settings
from app.models import (
    ChatResponse,
    DatabaseCapabilities,
    ExplainPlan,
    SearchRequest,
    SearchResponse,
    Shipment,
    ShipmentStats,
    ShipmentStatus,
)
from app.repository import (
    PostgresShipmentRepository,
    SemanticSearchUnavailableError,
    ShipmentRepository,
)


def _get_repository(request: Request) -> ShipmentRepository:
    return request.app.state.repository


RepositoryDependency = Annotated[ShipmentRepository, Depends(_get_repository)]


def create_app(
    settings: Settings | None = None,
    repository: ShipmentRepository | None = None,
) -> FastAPI:
    resolved_settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        resolved_settings.validate_live_configuration()
        active_repository = repository
        postgres_repository: PostgresShipmentRepository | None = None

        if active_repository is None:
            postgres_repository = PostgresShipmentRepository(resolved_settings)
            try:
                await postgres_repository.open()
            except Exception:
                await postgres_repository.close()
                raise
            active_repository = postgres_repository

        app.state.repository = active_repository
        app.state.shipment_agent = ShipmentAgent(
            resolved_settings,
            active_repository,
        )
        yield

        if postgres_repository is not None:
            await postgres_repository.close()

    app = FastAPI(
        title=resolved_settings.app_name,
        version="0.1.0",
        description=(
            "Shipment tracking with Azure HorizonDB, PostGIS, pgvector, and DiskANN."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.exception_handler(SemanticSearchUnavailableError)
    async def semantic_search_unavailable(
        _request: Request,
        exception: SemanticSearchUnavailableError,
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"detail": str(exception)},
        )

    @app.get("/api/health", response_model=DatabaseCapabilities)
    async def health(
        shipment_repository: RepositoryDependency,
    ) -> DatabaseCapabilities:
        capabilities = await shipment_repository.capabilities()
        return capabilities.model_copy(
            update={
                "ai_in_database": True,
                "chat_model": resolved_settings.chat_model_alias,
            }
        )

    @app.get("/api/shipments", response_model=list[Shipment])
    async def list_shipments(
        shipment_repository: RepositoryDependency,
        shipment_status: Annotated[
            ShipmentStatus | None,
            Query(alias="status"),
        ] = None,
        search: Annotated[
            str | None,
            Query(min_length=1, max_length=100),
        ] = None,
    ) -> list[Shipment]:
        return await shipment_repository.list_shipments(shipment_status, search)

    @app.get("/api/explain/last", response_model=ExplainPlan | None)
    async def last_explain(
        shipment_repository: RepositoryDependency,
        search: bool = True,
    ) -> ExplainPlan | None:
        return shipment_repository.last_explain(search=search)

    @app.get("/api/shipments/stats", response_model=ShipmentStats)
    async def shipment_stats(
        shipment_repository: RepositoryDependency,
    ) -> ShipmentStats:
        return await shipment_repository.stats()

    @app.get("/api/shipments/{shipment_number}", response_model=Shipment)
    async def shipment_detail(
        shipment_number: str,
        shipment_repository: RepositoryDependency,
    ) -> Shipment:
        shipment = await shipment_repository.get_shipment(shipment_number.upper())
        if shipment is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Shipment not found",
            )
        return shipment

    @app.post("/api/search", response_model=SearchResponse)
    async def semantic_search(
        request: SearchRequest,
        shipment_repository: RepositoryDependency,
    ) -> SearchResponse:
        shipments = await shipment_repository.semantic_search(
            query=request.query,
            status=request.status,
            eta_date=request.eta_date,
            eta_days=request.eta_days,
            location=request.location,
            radius_km=request.radius_km,
            limit=request.limit,
        )
        return SearchResponse(
            query=request.query,
            search_mode=shipment_repository.search_mode,
            shipments=shipments,
        )

    @app.post("/api/chat", response_model=ChatResponse)
    async def agent_chat(
        request: SearchRequest,
        http_request: Request,
    ) -> ChatResponse:
        shipment_agent: ShipmentAgent = http_request.app.state.shipment_agent
        return await shipment_agent.run(request)

    return app


app = create_app()
