import json
import re
from collections.abc import Mapping
from datetime import UTC, date, datetime
from typing import Any, Protocol

from psycopg import AsyncConnection, sql
from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

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


class SemanticSearchUnavailableError(RuntimeError):
    pass

_SHIPMENT_COLUMNS = """
	s.id,
	s.shipment_number,
	s.title,
	s.description,
	s.origin_name,
	public.ST_Y(s.origin_position) AS origin_latitude,
	public.ST_X(s.origin_position) AS origin_longitude,
	s.destination_name,
	public.ST_Y(s.destination_position) AS destination_latitude,
	public.ST_X(s.destination_position) AS destination_longitude,
	s.current_location_name,
	public.ST_Y(s.current_position) AS current_latitude,
	public.ST_X(s.current_position) AS current_longitude,
	s.status,
	s.eta,
	s.updated_at,
	s.metadata
"""


class ShipmentRepository(Protocol):
    mode: str
    search_mode: str
    chat_model_name: str

    async def list_shipments(
        self,
        status: ShipmentStatus | None = None,
        search: str | None = None,
    ) -> list[Shipment]: ...

    async def semantic_search(
        self,
        query: str,
        status: ShipmentStatus | None,
        eta_date: date | None,
        eta_days: int | None,
        location: Coordinate | None,
        radius_km: float | None,
        limit: int,
    ) -> list[Shipment]: ...

    async def plan_tool_call(
        self,
        question: str,
        tool_name: str,
        tool_schema: str,
    ) -> dict[str, Any]: ...

    async def generate_answer(self, question: str, context: str) -> str: ...

    async def get_shipment(self, shipment_number: str) -> Shipment | None: ...

    async def stats(self) -> ShipmentStats: ...

    async def capabilities(self) -> DatabaseCapabilities: ...

    def last_explain(self, search: bool = True) -> ExplainPlan | None: ...


def _row_to_shipment(row: Mapping[str, Any]) -> Shipment:
    similarity = row.get("similarity")
    distance_km = row.get("distance_km")
    hybrid_score = row.get("hybrid_score")
    return Shipment(
        id=row["id"],
        shipment_number=row["shipment_number"],
        title=row["title"],
        description=row["description"],
        origin_name=row["origin_name"],
        origin=Coordinate(
            latitude=float(row["origin_latitude"]),
            longitude=float(row["origin_longitude"]),
        ),
        destination_name=row["destination_name"],
        destination=Coordinate(
            latitude=float(row["destination_latitude"]),
            longitude=float(row["destination_longitude"]),
        ),
        current_location_name=row["current_location_name"],
        current_position=Coordinate(
            latitude=float(row["current_latitude"]),
            longitude=float(row["current_longitude"]),
        ),
        status=ShipmentStatus(row["status"]),
        eta=row["eta"],
        updated_at=row["updated_at"],
        metadata=row["metadata"],
        similarity=round(float(similarity), 4) if similarity is not None else None,
        distance_km=(
            round(float(distance_km), 2) if distance_km is not None else None
        ),
        hybrid_score=(
            round(float(hybrid_score), 4) if hybrid_score is not None else None
        ),
    )


class PostgresShipmentRepository:
    mode = "horizondb"
    search_mode = "spatial_semantic_diskann"

    def __init__(self, settings: Settings) -> None:
        if not settings.database_conninfo:
            raise ValueError("HorizonDB connection settings are required")

        self._pool = AsyncConnectionPool(
            conninfo=settings.database_conninfo,
            min_size=settings.database_pool_min_size,
            max_size=settings.database_pool_max_size,
            open=False,
            kwargs={"row_factory": dict_row},
        )
        self._connect_timeout = settings.database_connect_timeout_seconds
        self._model_alias = settings.embedding_model_alias
        self._chat_model_alias = settings.chat_model_alias
        self.chat_model_name = settings.chat_model_alias
        self._search_ready = False
        self._last_explain: ExplainPlan | None = None
        self._last_search_explain: ExplainPlan | None = None
        self._last_list_explain: ExplainPlan | None = None

    def last_explain(self, search: bool = True) -> ExplainPlan | None:
        if search:
            return self._last_search_explain or self._last_explain
        return self._last_list_explain or self._last_explain

    async def _execute_select(
        self,
        connection: AsyncConnection[Mapping[str, Any]],
        query: str,
        parameters: list[Any] | tuple[Any, ...] = (),
    ) -> list[Mapping[str, Any]]:
        statement = query.strip().removesuffix(";")
        explain = (
            "EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT TEXT)\n" + statement
        )
        plan_cursor = await connection.execute(explain, parameters)
        plan_rows = await plan_cursor.fetchall()
        rendered_query = _render_query(connection, statement, parameters)
        self._last_explain = ExplainPlan(
            query=rendered_query + ";",
            plan="\n".join(str(row["QUERY PLAN"]) for row in plan_rows),
            captured_at=datetime.now(UTC),
        )
        cursor = await connection.execute(statement, parameters)
        return await cursor.fetchall()

    async def open(self) -> None:
        await self._pool.open(wait=True, timeout=self._connect_timeout)
        self._search_ready = await self._validate_search_readiness()

    async def close(self) -> None:
        await self._pool.close()

    async def _validate_search_readiness(self) -> bool:
        query = """
SELECT
    (SELECT count(*) FROM horizon_ship.shipments) AS shipment_count,
    (SELECT count(embedding) FROM horizon_ship.shipments) AS embedding_count,
    (
        SELECT count(*) = 2
        FROM model_registry.model_list_all()
        WHERE alias IN (%s, %s)
    ) AS models_registered,
    (
        SELECT model_name
        FROM model_registry.model_list_all()
        WHERE alias = %s
    ) AS chat_model_name,
    EXISTS (
		SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'azure_ai'
            AND procedure.proname = 'generate'
    ) AS generate_available,
    EXISTS (
        SELECT 1
        FROM pg_catalog.pg_class AS index_relation
        WHERE index_relation.oid =
            to_regclass('horizon_ship.shipments_embedding_diskann_idx')
            AND COALESCE(index_relation.reloptions, ARRAY[]::text[]) @> ARRAY[
                'spherical_quantized=true',
                'sq_bits=4',
                'sq_training_samples=25000'
            ]
    ) AS index_ready;
"""
        async with self._pool.connection() as connection:
            rows = await self._execute_select(
                connection,
                query,
                (
                    self._model_alias,
                    self._chat_model_alias,
                    self._chat_model_alias,
                ),
            )
            row = rows[0]
        if row["chat_model_name"]:
            self.chat_model_name = str(row["chat_model_name"])
        return bool(
            row["shipment_count"]
            and row["shipment_count"] == row["embedding_count"]
            and row["models_registered"]
            and row["generate_available"]
            and row["index_ready"]
        )

    def _require_search_readiness(self) -> None:
        if not self._search_ready:
            raise SemanticSearchUnavailableError(
                "HorizonDB semantic search is unavailable until the configured "
                "embedding and chat model aliases are registered and database setup completes"
            )

    async def list_shipments(
        self,
        status: ShipmentStatus | None = None,
        search: str | None = None,
    ) -> list[Shipment]:
        conditions: list[str] = []
        parameters: list[Any] = []

        if status is not None:
            conditions.append("s.status = %s")
            parameters.append(status.value)
        if search and search.strip():
            conditions.append(
                """(
				s.shipment_number ILIKE %s
				OR s.title ILIKE %s
				OR s.description ILIKE %s
				OR s.origin_name ILIKE %s
				OR s.destination_name ILIKE %s
				OR s.current_location_name ILIKE %s
			)"""
            )
            pattern = f"%{search.strip()}%"
            parameters.extend([pattern] * 6)

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        query = f"""
SELECT
{_SHIPMENT_COLUMNS}
FROM horizon_ship.shipments AS s
{where_clause}
ORDER BY s.shipment_number;
"""
        async with self._pool.connection() as connection:
            rows = await self._execute_select(connection, query, parameters)
            if status is None and not search:
                self._last_list_explain = self._last_explain
        return [_row_to_shipment(row) for row in rows]

    async def _generate_text(self, prompt: str, system_prompt: str) -> str:
        self._require_search_readiness()
        statement = "SELECT azure_ai.generate(%s, %s, %s) AS answer;"
        async with self._pool.connection() as connection:
            rows = await self._execute_select(
                connection,
                statement,
                (prompt, self._chat_model_alias, system_prompt),
            )
            row = rows[0]
        return str(row["answer"])

    async def plan_tool_call(
        self,
        question: str,
        tool_name: str,
        tool_schema: str,
    ) -> dict[str, Any]:
        prompt = (
            f"User request:\n{question}\n\n"
            f"Available tool:\n{tool_schema}\n\n"
            "Return only the JSON arguments object for this tool call. Keep query_text "
            "focused on the shipment intent. Use status_filter='all' unless the user "
            "explicitly requests one of the supported statuses."
        )
        raw_plan = await self._generate_text(
            prompt,
            (
                "You route fleet questions to one required Agent Framework tool. "
                f"Always call {tool_name} exactly once and output only valid JSON "
                "matching its parameter schema."
            ),
        )
        json_match = re.search(r"\{.*\}", raw_plan, flags=re.DOTALL)
        if json_match is None:
            raise SemanticSearchUnavailableError(
                "HorizonDB chat model did not return Agent Framework tool arguments"
            )
        try:
            arguments = json.loads(json_match.group(0))
        except json.JSONDecodeError as exception:
            raise SemanticSearchUnavailableError(
                "HorizonDB chat model returned invalid Agent Framework tool arguments"
            ) from exception
        if not isinstance(arguments, dict):
            raise SemanticSearchUnavailableError(
                "HorizonDB chat model returned a non-object Agent Framework tool call"
            )
        return arguments

    async def generate_answer(self, question: str, context: str) -> str:
        prompt = f"User question:\n{question}\n\nShipment search results:\n{context}"
        return await self._generate_text(
            prompt,
            (
                "You are a concise shipping operations assistant. Base every shipment "
                "number, route, status, ETA, and similarity claim only on the supplied "
                "search results. Mention the best matches and briefly explain why they fit. "
                "Never invent a shipment."
            ),
        )

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
        self._require_search_readiness()
        statement = f"""
WITH query_vector AS (
	SELECT azure_openai.create_embeddings(
		%s,
		%s
    )::vector(1536) AS embedding
),
candidates AS MATERIALIZED (
    SELECT
{_SHIPMENT_COLUMNS},
        s.embedding <=> query_vector.embedding AS vector_distance,
        CASE WHEN %s::double precision IS NULL THEN NULL ELSE
            public.ST_Distance(
                s.current_position::public.geography,
                public.ST_SetSRID(
                    public.ST_MakePoint(%s, %s), 4326
                )::public.geography
            ) / 1000.0
        END AS distance_km
    FROM horizon_ship.shipments AS s
    CROSS JOIN query_vector
    WHERE (%s::text IS NULL OR s.status = %s)
        AND (
            %s::date IS NULL
            OR s.eta BETWEEN
                %s::date - (%s * INTERVAL '1 day')
                AND %s::date + (%s * INTERVAL '1 day')
        )
        AND (
            %s::double precision IS NULL
            OR public.ST_DWithin(
                s.current_position::public.geography,
                public.ST_SetSRID(
                    public.ST_MakePoint(%s, %s), 4326
                )::public.geography,
                %s * 1000.0
            )
        )
    ORDER BY s.embedding <=> query_vector.embedding
    LIMIT %s
)
SELECT
    candidates.*,
    1 - vector_distance AS similarity,
    CASE WHEN distance_km IS NULL THEN 1 - vector_distance ELSE
        0.72 * (1 - vector_distance)
        + 0.28 * GREATEST(0, 1 - distance_km / %s)
    END AS hybrid_score
FROM candidates
ORDER BY hybrid_score DESC
LIMIT %s;
"""
        longitude = location.longitude if location else None
        latitude = location.latitude if location else None
        status_value = status.value if status else None
        candidate_limit = max(100, limit * 12)
        parameters: list[Any] = [
            self._model_alias,
            query,
            longitude,
            longitude,
            latitude,
            status_value,
            status_value,
            eta_date,
            eta_date,
            eta_days,
            eta_date,
            eta_days,
            radius_km,
            longitude,
            latitude,
            radius_km,
            candidate_limit,
            radius_km,
            limit,
        ]
        async with self._pool.connection() as connection, connection.transaction():
            for setting in (
                "SET LOCAL plan_cache_mode TO 'force_custom_plan'",
                "SET LOCAL diskann.iterative_search TO 'strict_order'",
                "SET LOCAL diskann.enable_filter_hook TO 'true'",
                "SET LOCAL diskann.selectivity_min TO '0.0'",
                "SET LOCAL diskann.selectivity_threshold TO '1.0'",
                "SET LOCAL diskann.filtering_beta TO 0.85",
                "SET LOCAL diskann.l_value_is TO 300",
            ):
                await connection.execute(setting)
            rows = await self._execute_select(connection, statement, parameters)
            self._last_search_explain = self._last_explain
        return [_row_to_shipment(row) for row in rows]

    async def get_shipment(self, shipment_number: str) -> Shipment | None:
        query = f"""
SELECT
{_SHIPMENT_COLUMNS}
FROM horizon_ship.shipments AS s
WHERE s.shipment_number = %s;
"""
        async with self._pool.connection() as connection:
            rows = await self._execute_select(connection, query, (shipment_number,))
            row = rows[0] if rows else None
        return _row_to_shipment(row) if row else None

    async def stats(self) -> ShipmentStats:
        query = """
SELECT status, count(*) AS count
FROM horizon_ship.shipments
GROUP BY status
ORDER BY status;
"""
        async with self._pool.connection() as connection:
            rows = await self._execute_select(connection, query)

        counts = {ShipmentStatus(row["status"]): int(row["count"]) for row in rows}
        return ShipmentStats(
            total=sum(counts.values()),
            statuses=[
                StatusCount(status=status, count=counts.get(status, 0))
                for status in ShipmentStatus
            ],
        )

    async def capabilities(self) -> DatabaseCapabilities:
        query = """
SELECT
	(
		SELECT extversion FROM pg_catalog.pg_extension WHERE extname = 'postgis'
	) AS postgis_version,
	(
		SELECT extversion FROM pg_catalog.pg_extension WHERE extname = 'vector'
	) AS vector_version,
	(
		SELECT extversion FROM pg_catalog.pg_extension WHERE extname = 'pg_diskann'
	) AS diskann_version,
    COALESCE((
        SELECT index_relation.reloptions @> ARRAY['spherical_quantized=true']
        FROM pg_catalog.pg_class AS index_relation
        WHERE index_relation.oid =
            to_regclass('horizon_ship.shipments_embedding_diskann_idx')
    ), false) AS diskann_spherical_quantization,
    (
        SELECT split_part(index_option, '=', 2)::integer
        FROM pg_catalog.pg_class AS index_relation
        CROSS JOIN LATERAL unnest(index_relation.reloptions) AS options(index_option)
        WHERE index_relation.oid =
            to_regclass('horizon_ship.shipments_embedding_diskann_idx')
            AND starts_with(index_option, 'sq_bits=')
    ) AS diskann_sq_bits,
    (
        SELECT split_part(index_option, '=', 2)::integer
        FROM pg_catalog.pg_class AS index_relation
        CROSS JOIN LATERAL unnest(index_relation.reloptions) AS options(index_option)
        WHERE index_relation.oid =
            to_regclass('horizon_ship.shipments_embedding_diskann_idx')
            AND starts_with(index_option, 'sq_training_samples=')
    ) AS diskann_sq_training_samples,
    (
        SELECT extversion FROM pg_catalog.pg_extension WHERE extname = 'azure_ai'
    ) AS azure_ai_version,
    count(*) AS shipment_count,
    count(embedding) AS azure_embedding_count
FROM horizon_ship.shipments;
"""
        async with self._pool.connection() as connection:
            rows = await self._execute_select(connection, query)
            row = rows[0]

        return DatabaseCapabilities(
            mode=self.mode,
            connected=True,
            postgis_version=row["postgis_version"],
            vector_version=row["vector_version"],
            diskann_version=row["diskann_version"],
            diskann_spherical_quantization=bool(
                row["diskann_spherical_quantization"]
            ),
            diskann_sq_bits=row["diskann_sq_bits"],
            diskann_sq_training_samples=row["diskann_sq_training_samples"],
            azure_ai_version=row["azure_ai_version"],
            shipment_count=int(row["shipment_count"]),
            azure_embedding_count=int(row["azure_embedding_count"]),
            embedding_mode="azure_openai",
            embedding_model_alias=self._model_alias,
            detail=(
                "Query embeddings are generated in HorizonDB through the azure_ai "
                "model registry."
            ),
        )


def _render_query(
    connection: AsyncConnection[Any],
    query: str,
    parameters: list[Any] | tuple[Any, ...],
) -> str:
    literals = iter(sql.Literal(value).as_string(connection) for value in parameters)
    rendered = re.sub(r"%s", lambda _match: next(literals), query)
    return rendered.replace("::date::date", "::date")
