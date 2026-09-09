@description('Azure region where HorizonDB preview is enabled')
param location string

@description('Name of the HorizonDB cluster')
param clusterName string

@description('Number of vCores per replica')
param vCores int = 4

@description('Number of cluster replicas')
param replicaCount int = 1

@description('PostgreSQL major version')
param version string = '17'

@description('Unique suffix for the idempotent deployment script')
param deploymentSuffix string

@description('Resource ID of the user-assigned deployment-script identity')
param scriptIdentityId string

@description('Public IPv4 address of the machine running azd')
param deployerPublicIp string = ''

var administratorLogin = 'horizonAdmin'
var databaseName = 'fleet_intelligence'
var parameterGroupName = '${clusterName}-params'

@secure()
@description('Generated HorizonDB administrator password')
param administratorLoginPassword string = 'Hz1!${replace(newGuid(), '-', '')}'

resource parameterGroup 'Microsoft.HorizonDb/parameterGroups@2026-01-20-preview' = {
  name: parameterGroupName
  location: location
  properties: {
    applyImmediately: true
    description: 'Fleet Intelligence extensions managed by azd'
    parameters: [
      {
        name: 'azure.extensions'
        value: 'vector,pg_diskann,azure_ai,postgis'
      }
    ]
    pgVersion: int(version)
  }
}

resource cluster 'Microsoft.HorizonDb/clusters@2026-01-20-preview' = {
  name: clusterName
  location: location
  properties: {
    administratorLogin: administratorLogin
    administratorLoginPassword: administratorLoginPassword
    createMode: 'Create'
    vCores: vCores
    replicaCount: replicaCount
    version: version
    parameterGroup: {
      id: parameterGroup.id
      applyImmediately: true
    }
  }
}

#disable-next-line use-stable-resource-identifiers
resource setupScript 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: 'horizondb-setup-${deploymentSuffix}'
  location: location
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${scriptIdentityId}': {}
    }
  }
  properties: {
    azCliVersion: '2.70.0'
    retentionInterval: 'PT2H'
    timeout: 'PT25M'
    forceUpdateTag: deploymentSuffix
    environmentVariables: [
      {
        name: 'PGHOST'
        value: cluster.properties.?fullyQualifiedDomainName ?? '${clusterName}.${location}.horizondb.azure.com'
      }
      {
        name: 'PGPORT'
        value: '5432'
      }
      {
        name: 'PGUSER'
        value: administratorLogin
      }
      {
        name: 'PGPASSWORD'
        secureValue: administratorLoginPassword
      }
      {
        name: 'PGSSLMODE'
        value: 'require'
      }
      {
        name: 'APP_DB'
        value: databaseName
      }
      {
        name: 'ARM_ENDPOINT'
        value: environment().resourceManager
      }
      {
        name: 'CLUSTER_NAME'
        value: clusterName
      }
      {
        name: 'PARAM_GROUP_NAME'
        value: parameterGroupName
      }
      {
        name: 'POOL_NAME'
        value: 'pool1'
      }
      {
        name: 'DEPLOYER_PUBLIC_IP'
        value: deployerPublicIp
      }
    ]
    scriptContent: '''
      #!/bin/bash
      set -euo pipefail

      SUBSCRIPTION=$(az account show --query id -o tsv)
      RG=$(echo "$AZ_SCRIPTS_USER_ASSIGNED_IDENTITY" | cut -d'/' -f5)
      PARAM_GROUP_ID="/subscriptions/${SUBSCRIPTION}/resourceGroups/${RG}/providers/Microsoft.HorizonDb/parameterGroups/${PARAM_GROUP_NAME}"
      CLUSTER_URL="${ARM_ENDPOINT%/}/subscriptions/${SUBSCRIPTION}/resourceGroups/${RG}/providers/Microsoft.HorizonDb/clusters/${CLUSTER_NAME}"
      FIREWALL_URL="${CLUSTER_URL}/pools/${POOL_NAME}/firewallRules"

      echo "Attaching HorizonDB parameter group"
      az rest --method PATCH \
        --url "${CLUSTER_URL}?api-version=2026-01-20-preview" \
        --body "{\"properties\":{\"parameterGroup\":{\"id\":\"${PARAM_GROUP_ID}\",\"applyImmediately\":true}}}"

      echo "Allowing Azure services to reach the public HorizonDB endpoint"
      az rest --method PUT \
        --url "${FIREWALL_URL}/AllowAzureServices?api-version=2026-01-20-preview" \
        --body '{"properties":{"startIpAddress":"0.0.0.0","endIpAddress":"0.0.0.0","description":"Allow Azure services"}}'

      if [ -n "${DEPLOYER_PUBLIC_IP}" ]; then
        echo "Allowing deployer IPv4 address ${DEPLOYER_PUBLIC_IP}"
        az rest --method PUT \
          --url "${FIREWALL_URL}/AllowDeployerMachine?api-version=2026-01-20-preview" \
          --body "{\"properties\":{\"startIpAddress\":\"${DEPLOYER_PUBLIC_IP}\",\"endIpAddress\":\"${DEPLOYER_PUBLIC_IP}\",\"description\":\"azd deployer\"}}"
      fi

      tdnf install -y postgresql >/dev/null
      for attempt in $(seq 1 24); do
        if psql -d postgres -c "SELECT 1" >/dev/null 2>&1; then
          break
        fi
        if [ "$attempt" -eq 24 ]; then
          echo "HorizonDB did not accept connections in time"
          exit 1
        fi
        sleep 15
      done

      case "$APP_DB" in
        *[!a-zA-Z0-9_]*) echo "Invalid database name"; exit 1 ;;
      esac
      if [ "$(psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = '${APP_DB}'")" != "1" ]; then
        psql -d postgres -c "CREATE DATABASE \"${APP_DB}\""
      fi

      for extension in azure_ai vector pg_diskann postgis; do
        psql -d "$APP_DB" -v ON_ERROR_STOP=1 \
          -c "CREATE EXTENSION IF NOT EXISTS ${extension} CASCADE"
      done

      MODEL_COUNT=$(psql -d "$APP_DB" -tAc "SELECT count(*) FROM model_registry.model_list_all() WHERE alias IN ('default-chat', 'default-embedding')")
      if [ "$MODEL_COUNT" != "2" ]; then
        echo "HorizonDB built-in model aliases are unavailable"
        exit 1
      fi
    '''
  }
}

output clusterName string = cluster.name
output clusterFqdn string = cluster.properties.?fullyQualifiedDomainName ?? '${clusterName}.${location}.horizondb.azure.com'
output databaseName string = databaseName
output adminLogin string = administratorLogin
@secure()
output adminPassword string = administratorLoginPassword
