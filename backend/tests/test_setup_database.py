from typing import Any, Self

from app.config import Settings
from app.sample_data import build_sample_shipments
from app.setup_database import (
    EMBED_BATCH_SQL,
    PRIMARY_INDEX_SQL,
    shipment_parameters,
    verify_embedding_model,
)


class RecordingCursor:
    def __init__(self, lookup_result: tuple[str, ...] | None = None) -> None:
        self.lookup_result = lookup_result
        self.calls: list[tuple[str, tuple[Any, ...] | None]] = []

    def __enter__(self) -> Self:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(
        self,
        query: str,
        parameters: tuple[Any, ...] | None = None,
    ) -> None:
        self.calls.append((query, parameters))

    def fetchone(self) -> tuple[str, ...] | None:
        return self.lookup_result


class RecordingConnection:
    def __init__(self, cursor: RecordingCursor) -> None:
        self.recording_cursor = cursor

    def cursor(self) -> RecordingCursor:
        return self.recording_cursor


def test_setup_uses_registered_horizondb_embedding_model() -> None:
    cursor = RecordingCursor(("default-embedding",))
    connection = RecordingConnection(cursor)
    settings = Settings(_env_file=None)

    changed = verify_embedding_model(connection, settings)  # type: ignore[arg-type]

    assert changed is True
    assert cursor.calls[-1][1] == ("default-embedding",)


def test_seed_parameters_use_postgis_longitude_latitude_order() -> None:
    shipment = build_sample_shipments()[0]
    parameters = shipment_parameters(shipment)

    assert parameters[5:7] == (
        shipment.origin.longitude,
        shipment.origin.latitude,
    )
    assert parameters[8:10] == (
        shipment.destination.longitude,
        shipment.destination.latitude,
    )
    assert parameters[11:13] == (
        shipment.current_position.longitude,
        shipment.current_position.latitude,
    )


def test_embedding_input_formats_business_field_context() -> None:
    assert EMBED_BATCH_SQL.count("%%s") == 7
    assert "Title: %%s. Description: %%s." in EMBED_BATCH_SQL
    assert "Origin: %%s. Destination: %%s." in EMBED_BATCH_SQL
    assert "Current location: %%s. Status: %%s. Metadata: %%s." in EMBED_BATCH_SQL


def test_primary_diskann_index_uses_spherical_quantization() -> None:
    assert "USING diskann (embedding vector_cosine_ops)" in PRIMARY_INDEX_SQL
    assert "spherical_quantized = true" in PRIMARY_INDEX_SQL
    assert "sq_bits = 4" in PRIMARY_INDEX_SQL
    assert "sq_training_samples = 25000" in PRIMARY_INDEX_SQL