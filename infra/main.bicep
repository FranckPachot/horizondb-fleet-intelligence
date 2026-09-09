targetScope = 'resourceGroup'

@minLength(1)
@maxLength(50)
@description('Azure Developer CLI environment name')
param environmentName string

@allowed([
  'australiaeast'
  'centralus'
  'uaenorth'
  'uksouth'
  'westus3'
])
@metadata({
  azd: {
    type: 'location'
  }
})
@description('HorizonDB preview region')
param location string

@description('Public IPv4 address of the machine running azd')
param deployerPublicIp string = ''

@minValue(2)
@maxValue(96)
@description('Number of HorizonDB vCores per replica')
param horizonDbVCores int = 4

@minValue(1)
@maxValue(15)
@description('Number of HorizonDB replicas')
param horizonDbReplicaCount int = 1

@description('Unique deployment-script suffix')
param deploymentSuffix string = utcNow('yyyyMMddHHmmss')

var resourceToken = toLower(uniqueString(subscription().id, resourceGroup().id, environmentName, location))
var compactEnvironmentName = take(replace(toLower(environmentName), '-', ''), 12)
var prefix = 'fi-${compactEnvironmentName}-${take(resourceToken, 6)}'
var clusterName = take('${prefix}-hdb', 55)
var containerEnvironmentName = take('${prefix}-cae', 32)
var registryName = 'hdbfi${take(resourceToken, 20)}'
var backendName = take('${prefix}-api', 32)
var frontendName = take('${prefix}-web', 32)
var deploymentIdentityName = take('${prefix}-deploy', 128)
var backendIdentityName = take('${prefix}-api-id', 128)
var frontendIdentityName = take('${prefix}-web-id', 128)
var tags = {
  'azd-env-name': environmentName
  sample: 'horizondb-fleet-intelligence'
}

resource deploymentIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: deploymentIdentityName
  location: location
  tags: tags
}

resource deploymentContributor 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(resourceGroup().id, deploymentIdentity.id, 'horizondb-deployment-contributor')
  scope: resourceGroup()
  properties: {
    principalId: deploymentIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'b24988ac-6180-42a0-ab88-20f7382dd24c'
    )
  }
}

module horizonDb 'modules/horizondb.bicep' = {
  name: 'horizondb-${deploymentSuffix}'
  params: {
    location: location
    clusterName: clusterName
    vCores: horizonDbVCores
    replicaCount: horizonDbReplicaCount
    deploymentSuffix: deploymentSuffix
    scriptIdentityId: deploymentIdentity.id
    deployerPublicIp: deployerPublicIp
  }
  dependsOn: [deploymentContributor]
}

resource containerEnvironment 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: containerEnvironmentName
  location: location
  tags: tags
  properties: {}
}

resource registry 'Microsoft.ContainerRegistry/registries@2025-04-01' = {
  name: registryName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource backendIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: backendIdentityName
  location: location
  tags: tags
}

resource frontendIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: frontendIdentityName
  location: location
  tags: tags
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'

resource backendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, backendIdentity.id, acrPullRoleId)
  scope: registry
  properties: {
    principalId: backendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

resource frontendAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, frontendIdentity.id, acrPullRoleId)
  scope: registry
  properties: {
    principalId: frontendIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

var backendHost = '${backendName}.${containerEnvironment.properties.defaultDomain}'
var backendUri = 'https://${backendHost}'
var frontendHost = '${frontendName}.${containerEnvironment.properties.defaultDomain}'
var frontendUri = 'https://${frontendHost}'
var placeholderImage = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

resource backend 'Microsoft.App/containerApps@2025-01-01' = {
  name: backendName
  location: location
  tags: union(tags, {
    'azd-service-name': 'backend'
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${backendIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 80
        transport: 'auto'
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: backendIdentity.id
        }
      ]
      secrets: [
        {
          name: 'database-password'
          value: horizonDb.outputs.adminPassword
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'backend'
          image: placeholderImage
          env: [
            {
              name: 'HOST'
              value: '0.0.0.0'
            }
            {
              name: 'PORT'
              value: '80'
            }
            {
              name: 'AZURE_PG_HOST'
              value: horizonDb.outputs.clusterFqdn
            }
            {
              name: 'AZURE_PG_NAME'
              value: horizonDb.outputs.databaseName
            }
            {
              name: 'AZURE_PG_USER'
              value: horizonDb.outputs.adminLogin
            }
            {
              name: 'AZURE_PG_PASSWORD'
              secretRef: 'database-password'
            }
            {
              name: 'AZURE_PG_PORT'
              value: '5432'
            }
            {
              name: 'AZURE_PG_SSLMODE'
              value: 'require'
            }
            {
              name: 'EMBEDDING_MODEL_ALIAS'
              value: 'default-embedding'
            }
            {
              name: 'CHAT_MODEL_ALIAS'
              value: 'default-chat'
            }
            {
              name: 'CORS_ORIGINS'
              value: '["${frontendUri}"]'
            }
          ]
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [backendAcrPull]
}

resource frontend 'Microsoft.App/containerApps@2025-01-01' = {
  name: frontendName
  location: location
  tags: union(tags, {
    'azd-service-name': 'frontend'
  })
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${frontendIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        external: true
        allowInsecure: false
        targetPort: 80
        transport: 'auto'
      }
      registries: [
        {
          server: registry.properties.loginServer
          identity: frontendIdentity.id
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'frontend'
          image: placeholderImage
          env: [
            {
              name: 'BACKEND_HOST'
              value: backendHost
            }
            {
              name: 'NGINX_ENVSUBST_FILTER'
              value: '^BACKEND_HOST$'
            }
          ]
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
  dependsOn: [frontendAcrPull]
}

output AZURE_LOCATION string = location
output AZURE_CONTAINER_ENVIRONMENT_NAME string = containerEnvironment.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = registry.properties.loginServer
output AZURE_CONTAINER_REGISTRY_NAME string = registry.name
output HORIZONDB_CLUSTER_NAME string = horizonDb.outputs.clusterName
output POSTGRES_HOST string = horizonDb.outputs.clusterFqdn
output POSTGRES_DATABASE string = horizonDb.outputs.databaseName
output POSTGRES_USERNAME string = horizonDb.outputs.adminLogin
output SERVICE_BACKEND_NAME string = backend.name
output SERVICE_BACKEND_URI string = backendUri
output SERVICE_BACKEND_IMAGE_NAME string = backend.properties.template.containers[0].image
output SERVICE_FRONTEND_NAME string = frontend.name
output SERVICE_FRONTEND_URI string = frontendUri
output SERVICE_FRONTEND_IMAGE_NAME string = frontend.properties.template.containers[0].image
