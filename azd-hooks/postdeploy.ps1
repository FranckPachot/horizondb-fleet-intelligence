$ErrorActionPreference = 'Stop'

$backendUri = (azd env get-value SERVICE_BACKEND_URI).TrimEnd('/')
$frontendUri = (azd env get-value SERVICE_FRONTEND_URI).TrimEnd('/')
if (-not $backendUri -or -not $frontendUri) {
    throw 'azd did not publish the backend and frontend service URIs.'
}

$health = $null
for ($attempt = 1; $attempt -le 40; $attempt++) {
    try {
        $health = Invoke-RestMethod `
            -Uri "$backendUri/api/health" `
            -TimeoutSec 30
        break
    } catch {
        if ($attempt -eq 40) {
            throw "The deployed API did not become ready within 10 minutes: $($_.Exception.Message)"
        }
        Write-Host "Waiting for HorizonDB setup and API startup ($attempt/40)..."
        Start-Sleep -Seconds 15
    }
}
if (-not $health.connected) {
    throw 'The deployed API is not connected to HorizonDB.'
}
if (-not $health.agent_framework -or $health.chat_model -ne 'gpt-5.4') {
    throw 'The deployed Agent Framework gpt-5.4 contract is not ready.'
}
if (
    -not $health.diskann_spherical_quantization `
    -or $health.diskann_sq_bits -ne 4 `
    -or $health.diskann_sq_training_samples -ne 25000
) {
    throw 'The deployed spherical-quantized DiskANN index is not ready.'
}

Write-Host 'HorizonDB Fleet Intelligence deployment is ready.'
Write-Host "Frontend: $frontendUri"
Write-Host "API health: $backendUri/api/health"
Write-Host 'Verified: PostGIS, Agent Framework gpt-5.4, and SQ4 DiskANN.'
