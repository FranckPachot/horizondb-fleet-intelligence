$ErrorActionPreference = 'Stop'

$account = az account show --output json 2>$null | ConvertFrom-Json
if (-not $account.id) {
    throw "Azure CLI is not authenticated. Run 'az login' and retry."
}

$providerState = az provider show `
    --namespace Microsoft.OrionDB `
    --query registrationState `
    --output tsv `
    2>$null
if ($providerState -ne 'Registered') {
    throw "Microsoft.OrionDB is not registered. Run 'az provider register --namespace Microsoft.OrionDB' and retry."
}

$environmentName = azd env get-value AZURE_ENV_NAME 2>$null
if ($environmentName -notmatch '^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$') {
    throw 'The azd environment name must use lowercase letters, numbers, and hyphens and be at most 50 characters.'
}

$allowedLocations = @(
    'australiaeast',
    'centralus',
    'uaenorth',
    'uksouth',
    'westus3'
)
$location = azd env get-value AZURE_LOCATION 2>$null
if (-not $location) {
    throw 'AZURE_LOCATION is not set for this azd environment.'
}
if ($allowedLocations -notcontains $location.Trim().ToLowerInvariant()) {
    throw "HorizonDB preview is not enabled in '$location'. Choose: $($allowedLocations -join ', ')."
}

$deployerPublicIp = ''
try {
    $ipResponse = Invoke-RestMethod `
        -Uri 'https://api.ipify.org?format=json' `
        -TimeoutSec 15
    if ($ipResponse.ip -match '^\d{1,3}(\.\d{1,3}){3}$') {
        $deployerPublicIp = $ipResponse.ip
    }
} catch {
    Write-Warning 'The deployer public IP could not be detected. The personal HorizonDB firewall rule will be skipped.'
}

azd env set DEPLOYER_PUBLIC_IP $deployerPublicIp | Out-Null
Write-Host "Azure subscription: $($account.name)"
Write-Host "azd environment: $environmentName"
Write-Host "HorizonDB provider: Microsoft.OrionDB ($providerState)"
Write-Host "HorizonDB location: $location"
Write-Host "Deployer IPv4: $(if ($deployerPublicIp) { $deployerPublicIp } else { 'not set' })"
