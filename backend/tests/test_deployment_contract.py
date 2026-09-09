from pathlib import Path

ROOT = Path(__file__).parents[2]


def test_azd_deploys_two_container_apps() -> None:
    manifest = (ROOT / "azure.yaml").read_text(encoding="utf-8")

    assert "backend:" in manifest
    assert "frontend:" in manifest
    assert manifest.count("host: containerapp") == 2
    assert "context: .." in manifest
    assert "remoteBuild: true" in manifest
    assert "./azd-hooks/preprovision.ps1" in manifest
    assert "./azd-hooks/postdeploy.ps1" in manifest


def test_bicep_deploys_native_horizondb_with_required_extensions() -> None:
    horizon = (ROOT / "infra" / "modules" / "horizondb.bicep").read_text(
        encoding="utf-8"
    )
    main = (ROOT / "infra" / "main.bicep").read_text(encoding="utf-8")

    assert "Microsoft.HorizonDb/clusters@2026-01-20-preview" in horizon
    assert "Microsoft.HorizonDb/parameterGroups@2026-01-20-preview" in horizon
    assert "vector,pg_diskann,azure_ai,postgis" in horizon
    assert "'default-chat', 'default-embedding'" in horizon
    assert main.count("Microsoft.App/containerApps@2025-01-01") == 2
    assert "CHAT_MODEL_ALIAS" in main
    assert "default-chat" in main


def test_backend_container_uses_canonical_schema_and_horizondb_setup() -> None:
    dockerfile = (ROOT / "backend" / "Dockerfile").read_text(encoding="utf-8")
    startup = (ROOT / "backend" / "start-container.sh").read_text(encoding="utf-8")
    nginx = (ROOT / "frontend" / "nginx.conf.template").read_text(
        encoding="utf-8"
    )

    assert "COPY database /app/database" in dockerfile
    assert "python -m app.setup_database" in startup
    assert "exec python -m app.server" in startup
    assert "proxy_pass https://${BACKEND_HOST};" in nginx


def test_azd_hooks_enforce_preview_and_runtime_readiness() -> None:
    preprovision = (ROOT / "azd-hooks" / "preprovision.ps1").read_text(
        encoding="utf-8"
    )
    postdeploy = (ROOT / "azd-hooks" / "postdeploy.ps1").read_text(
        encoding="utf-8"
    )

    assert "Microsoft.OrionDB" in preprovision
    assert "AZURE_LOCATION" in preprovision
    assert "diskann_spherical_quantization" in postdeploy
    assert "diskann_sq_bits -ne 4" in postdeploy
    assert "chat_model -ne 'gpt-5.4'" in postdeploy
