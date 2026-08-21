$ErrorActionPreference = 'Stop'

$phaseProjectName = "ytmonitor-phase0-$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
if ($phaseProjectName -notmatch '^ytmonitor-phase0-[0-9]+-[a-f0-9]{8}$') {
  throw "Unsafe Compose project name: $phaseProjectName"
}
$phaseServiceNames = @('postgres', 'db-migrate', 'worker', 'api', 'web')
$phaseNetworkNames = @('frontend', 'database', 'egress')

function Get-AvailableHostPort {
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    # Stay below Windows' default dynamic TCP range (49152-65535). Selecting an
    # ephemeral port and immediately releasing it can race with WinNAT/Docker.
    $candidate = Get-Random -Minimum 20000 -Maximum 40000
    $portProbe = [System.Net.Sockets.TcpListener]::new(
      [System.Net.IPAddress]::Loopback,
      $candidate
    )
    $portProbe.Server.ExclusiveAddressUse = $true

    try {
      $portProbe.Start()
      return $candidate
    }
    catch [System.Net.Sockets.SocketException] {
      continue
    }
    finally {
      $portProbe.Stop()
    }
  }

  throw 'Could not find an available low host port for the Phase 0 Docker test'
}

$phaseWebPort = Get-AvailableHostPort

$previousWebPort = $env:WEB_PORT
$previousHeartbeatInterval = $env:WORKER_HEARTBEAT_INTERVAL_SECONDS
$previousHeartbeatStale = $env:WORKER_HEARTBEAT_STALE_SECONDS
$previousPostgresUser = $env:POSTGRES_USER
$previousPostgresPassword = $env:POSTGRES_PASSWORD
$previousPostgresDatabase = $env:POSTGRES_DB
$previousDatabaseUrl = $env:DATABASE_URL
$previousBuildkitProgress = $env:BUILDKIT_PROGRESS
$previousComposeCompatibility = $env:COMPOSE_COMPATIBILITY
$phaseDatabasePassword = "phase0_$([Guid]::NewGuid().ToString('N'))"
$env:WEB_PORT = [string]$phaseWebPort
$env:WORKER_HEARTBEAT_INTERVAL_SECONDS = '2'
$env:WORKER_HEARTBEAT_STALE_SECONDS = '6'
$env:POSTGRES_USER = 'phase0_test'
$env:POSTGRES_PASSWORD = $phaseDatabasePassword
$env:POSTGRES_DB = 'phase0_test'
$env:DATABASE_URL = "postgresql://phase0_test:$phaseDatabasePassword@postgres:5432/phase0_test"
$env:BUILDKIT_PROGRESS = 'plain'
Remove-Item Env:COMPOSE_COMPATIBILITY -ErrorAction SilentlyContinue
$integrationDatabaseUrl = "$($env:DATABASE_URL)?schema=phase0_integration"
$baseUrl = "http://127.0.0.1:$phaseWebPort"
$composeInvoked = $false
$phaseFailure = $null
$cleanupFailure = $null

function Invoke-PhaseCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)

  & docker compose -f docker-compose.yml -p $phaseProjectName @ComposeArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'A Phase 0 docker compose command failed; arguments were omitted to protect secrets'
  }
}

function Wait-HttpStatus {
  param(
    [string]$Url,
    [int]$ExpectedStatus,
    [int]$TimeoutSeconds = 45
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastObservation = 'no response received'
  do {
    try {
      $response = Invoke-WebRequest -Uri $Url -SkipHttpErrorCheck -TimeoutSec 3
      if ([int]$response.StatusCode -eq $ExpectedStatus) {
        return $response
      }
      $lastObservation = "received HTTP $([int]$response.StatusCode)"
    }
    catch {
      $lastObservation = $_.Exception.Message
    }
    Start-Sleep -Seconds 1
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Timed out waiting for HTTP $ExpectedStatus from $Url. Last observation: $lastObservation"
}

function Assert-NoPublishedPort {
  param([string]$Service)

  $containerId = (& docker compose -f docker-compose.yml -p $phaseProjectName ps -q $Service).Trim()
  if (-not $containerId) {
    throw "No container found for service $Service"
  }

  $published = (& docker port $containerId 2>$null) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect published ports for service $Service"
  }
  if (-not [string]::IsNullOrWhiteSpace($published)) {
    throw "Service $Service unexpectedly publishes a host port: $published"
  }
}

function Assert-WebLoopbackPort {
  $containerId = (& docker compose -f docker-compose.yml -p $phaseProjectName ps -q web).Trim()
  if (-not $containerId) {
    throw 'No container found for service web'
  }

  $ports = (& docker inspect $containerId --format '{{json .NetworkSettings.Ports}}') |
    ConvertFrom-Json
  $bindings = @($ports.'3000/tcp')
  if (
    $bindings.Count -ne 1 -or
    $bindings[0].HostIp -ne '127.0.0.1' -or
    $bindings[0].HostPort -ne [string]$phaseWebPort
  ) {
    throw 'Web must publish exactly one loopback-only host binding'
  }
}

function Get-ServiceNetworks {
  param([string]$Service)

  $containerIds = @(& docker compose -f docker-compose.yml -p $phaseProjectName ps -aq $Service)
  $containerIds = @($containerIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($LASTEXITCODE -ne 0 -or $containerIds.Count -ne 1) {
    throw "No container found for service $Service"
  }

  $networkJson = & docker inspect $containerIds[0].Trim() --format '{{json .NetworkSettings.Networks}}'
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect networks for service $Service"
  }

  return @(($networkJson | ConvertFrom-Json).PSObject.Properties.Name)
}

function Assert-ExactStringSet {
  param(
    [string[]]$Actual,
    [string[]]$Expected,
    [string]$Description
  )

  if (
    $Actual.Count -ne $Expected.Count -or
    @(Compare-Object -ReferenceObject $Expected -DifferenceObject $Actual).Count -ne 0
  ) {
    throw "$Description does not match the exact expected topology"
  }
}

function Assert-NetworkIsolation {
  $webNetworks = @(Get-ServiceNetworks web)
  $apiNetworks = @(Get-ServiceNetworks api)
  $postgresNetworks = @(Get-ServiceNetworks postgres)
  $workerNetworks = @(Get-ServiceNetworks worker)
  $migrationNetworks = @(Get-ServiceNetworks db-migrate)
  $frontendNetwork = "${phaseProjectName}_frontend"
  $databaseNetwork = "${phaseProjectName}_database"
  $egressNetwork = "${phaseProjectName}_egress"

  Assert-ExactStringSet $webNetworks @($frontendNetwork) 'Web networks'
  Assert-ExactStringSet $apiNetworks @($frontendNetwork, $databaseNetwork) 'API networks'
  Assert-ExactStringSet $postgresNetworks @($databaseNetwork) 'PostgreSQL networks'
  Assert-ExactStringSet $workerNetworks @($databaseNetwork, $egressNetwork) 'Worker networks'
  Assert-ExactStringSet $migrationNetworks @($databaseNetwork) 'Migration networks'

  $frontendInternal = (& docker network inspect $frontendNetwork --format '{{.Internal}}').Trim()
  $databaseInternal = (& docker network inspect $databaseNetwork --format '{{.Internal}}').Trim()
  $egressInternal = (& docker network inspect $egressNetwork --format '{{.Internal}}').Trim()
  if ($frontendInternal -ne 'false') {
    throw 'Frontend network must allow the loopback Web port to be published'
  }
  if ($databaseInternal -ne 'true') {
    throw 'Database network must remain internal'
  }
  if ($egressInternal -ne 'false') {
    throw 'Worker egress network must allow outbound provider traffic'
  }
}

function Assert-HealthContract {
  param(
    [string]$Url,
    [int]$ExpectedHttpStatus,
    [string]$ExpectedService,
    [string]$ExpectedHealthStatus,
    [string]$ExpectedCheckName = '',
    [string]$ExpectedCheckCode = ''
  )

  $healthArguments = @(
    'exec',
    'tsx',
    'scripts/assert-health-response.ts',
    $Url,
    [string]$ExpectedHttpStatus,
    $ExpectedService,
    $ExpectedHealthStatus
  )
  if ($ExpectedCheckName -or $ExpectedCheckCode) {
    if (-not $ExpectedCheckName -or -not $ExpectedCheckCode) {
      throw 'Expected health check name and code must be provided together'
    }
    $healthArguments += @($ExpectedCheckName, $ExpectedCheckCode)
  }

  & corepack pnpm @healthArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Health contract failed for $ExpectedService"
  }
}

function Get-ProjectResourceIds {
  param([ValidateSet('container', 'network', 'volume')][string]$ResourceType)

  $resourceIds = if ($ResourceType -eq 'container') {
    @(& docker container ls -aq --no-trunc --filter "label=com.docker.compose.project=$phaseProjectName")
  }
  else {
    @(& docker $ResourceType ls -q --filter "label=com.docker.compose.project=$phaseProjectName")
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Could not enumerate Phase 0 $ResourceType resources"
  }

  return @($resourceIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-ExactNamedProjectResourceIds {
  param([ValidateSet('container', 'network', 'volume')][string]$ResourceType)

  $escapedProject = [Regex]::Escape($phaseProjectName)
  $servicePattern = ($phaseServiceNames | ForEach-Object { [Regex]::Escape($_) }) -join '|'
  $networkPattern = ($phaseNetworkNames | ForEach-Object { [Regex]::Escape($_) }) -join '|'
  $namePattern = switch ($ResourceType) {
    'container' { "^$escapedProject[-_](?:$servicePattern)[-_][0-9]+$" }
    'network' { "^$escapedProject[-_](?:$networkPattern)$" }
    'volume' { "^$escapedProject[-_]postgres_data$" }
  }
  $format = if ($ResourceType -eq 'volume') { '{{.Name}}|{{.Name}}' } else { '{{.ID}}|{{.Name}}' }
  $listArguments = if ($ResourceType -eq 'container') {
    @('container', 'ls', '-a', '--no-trunc', '--format', '{{.ID}}|{{.Names}}')
  }
  else {
    @($ResourceType, 'ls', '--format', $format)
  }
  $records = @(& docker @listArguments)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not enumerate exact-name Phase 0 $ResourceType resources"
  }

  $resourceIds = foreach ($record in $records) {
    $parts = $record -split '\|', 2
    if ($parts.Count -eq 2 -and $parts[1] -match $namePattern) {
      $parts[0]
    }
  }
  return @($resourceIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-ExactNamedProjectImageIds {
  $escapedProject = [Regex]::Escape($phaseProjectName)
  $servicePattern = ($phaseServiceNames | ForEach-Object { [Regex]::Escape($_) }) -join '|'
  $records = @(& docker image ls --format '{{.ID}}|{{.Repository}}')
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not enumerate exact-name Phase 0 images'
  }

  $imageIds = foreach ($record in $records) {
    $parts = $record -split '\|', 2
    if (
      $parts.Count -eq 2 -and
      $parts[1] -match "^$escapedProject[-_](?:$servicePattern)$"
    ) {
      $parts[0]
    }
  }
  return @($imageIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Assert-ResourceIdentity {
  param(
    [ValidateSet('container', 'network', 'volume')][string]$ResourceType,
    [string]$ResourceId
  )

  $resourceJson = & docker $ResourceType inspect $ResourceId
  if ($LASTEXITCODE -ne 0) {
    throw "Refusing cleanup: could not inspect $ResourceType identity"
  }
  $resource = @($resourceJson | ConvertFrom-Json)[0]
  $labels = if ($ResourceType -eq 'container') { $resource.Config.Labels } else { $resource.Labels }
  if ($labels.'com.docker.compose.project' -ne $phaseProjectName) {
    throw "Refusing cleanup: $ResourceType has the wrong Compose project label"
  }

  $escapedProject = [Regex]::Escape($phaseProjectName)
  switch ($ResourceType) {
    'container' {
      $service = [string]$labels.'com.docker.compose.service'
      $containerNumber = [string]$labels.'com.docker.compose.container-number'
      $containerName = ([string]$resource.Name).TrimStart('/')
      if (
        $phaseServiceNames -notcontains $service -or
        $containerNumber -notmatch '^[0-9]+$' -or
        $containerName -notmatch "^$escapedProject[-_]$([Regex]::Escape($service))[-_]$containerNumber$"
      ) {
        throw 'Refusing cleanup: container name/service/number identity is unexpected'
      }
    }
    'network' {
      $network = [string]$labels.'com.docker.compose.network'
      if (
        $phaseNetworkNames -notcontains $network -or
        [string]$resource.Name -notmatch "^$escapedProject[-_]$([Regex]::Escape($network))$"
      ) {
        throw 'Refusing cleanup: network name/label identity is unexpected'
      }
    }
    'volume' {
      $volume = [string]$labels.'com.docker.compose.volume'
      if (
        $volume -ne 'postgres_data' -or
        [string]$resource.Name -notmatch "^$escapedProject[-_]postgres_data$"
      ) {
        throw 'Refusing cleanup: PostgreSQL volume name/label identity is unexpected'
      }
    }
  }
}

function Assert-ComposeResourcesOwned {
  $composeContainerIds = @(& docker compose -f docker-compose.yml -p $phaseProjectName ps -aq)
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not resolve isolated Compose containers before cleanup'
  }

  foreach ($resourceType in @('container', 'network', 'volume')) {
    $resourceIds = @(
      @(Get-ProjectResourceIds $resourceType) +
      @(Get-ExactNamedProjectResourceIds $resourceType) |
        Sort-Object -Unique
    )
    foreach ($resourceId in $resourceIds) {
      Assert-ResourceIdentity $resourceType $resourceId
    }
  }

  foreach ($containerId in @($composeContainerIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
    Assert-ResourceIdentity container $containerId
  }
}

function Assert-NoComposeResourcesRemain {
  foreach ($resourceType in @('container', 'network', 'volume')) {
    if (
      @(Get-ProjectResourceIds $resourceType).Count -ne 0 -or
      @(Get-ExactNamedProjectResourceIds $resourceType).Count -ne 0
    ) {
      throw "Cleanup left Phase 0 $resourceType resources behind"
    }
  }

  if (@(Get-ExactNamedProjectImageIds).Count -ne 0) {
    throw 'Cleanup left Phase 0 images behind'
  }
}

function Restore-EnvironmentVariable {
  param(
    [string]$Name,
    [AllowNull()][string]$PreviousValue
  )

  if ($null -eq $PreviousValue) {
    Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
  }
  else {
    Set-Item "Env:$Name" $PreviousValue
  }
}

try {
  $composeInvoked = $true
  Invoke-PhaseCompose up --detach --build --wait --wait-timeout 300

  [void](Wait-HttpStatus "$baseUrl/health" 200 45)
  Assert-HealthContract "$baseUrl/health" 200 web ok
  Assert-HealthContract "$baseUrl/api/v1/health" 200 api ok
  Assert-HealthContract "$baseUrl/api/v1/health/db" 200 database ok
  Assert-HealthContract "$baseUrl/api/v1/health/worker" 200 worker ok
  Assert-HealthContract "$baseUrl/api/v1/health/collectors" 200 collectors disabled collectors PHASE_NOT_ENABLED
  Assert-HealthContract "$baseUrl/api/v1/health/ai" 200 ai disabled ai AI_DISABLED

  Assert-NoPublishedPort postgres
  Assert-NoPublishedPort api
  Assert-NoPublishedPort worker
  Assert-WebLoopbackPort
  Assert-NetworkIsolation

  Invoke-PhaseCompose -ComposeArguments @(
    'run',
    '--rm',
    '-e',
    "DATABASE_URL=$integrationDatabaseUrl",
    'db-migrate'
  )
  Invoke-PhaseCompose -ComposeArguments @(
    'run',
    '--rm',
    '-e',
    "DATABASE_URL=$integrationDatabaseUrl",
    'db-migrate',
    'pnpm',
    'test:db:integration'
  )

  Invoke-PhaseCompose run --rm db-migrate

  $heartbeatCount = (& docker compose -f docker-compose.yml -p $phaseProjectName exec -T postgres psql -U $env:POSTGRES_USER -d $env:POSTGRES_DB -tAc "SELECT COUNT(*) FROM worker_heartbeats WHERE worker_id = 'worker-primary';").Trim()
  if ($LASTEXITCODE -ne 0 -or $heartbeatCount -ne '1') {
    throw "Expected one idempotent worker heartbeat row, received '$heartbeatCount'"
  }

  Invoke-PhaseCompose stop worker
  $staleResponse = Wait-HttpStatus "$baseUrl/api/v1/health/worker" 503 30
  if ($staleResponse.Content -match 'postgresql://' -or $staleResponse.Content.Contains($phaseDatabasePassword)) {
    throw 'Worker health response leaked a connection detail'
  }
  Assert-HealthContract "$baseUrl/api/v1/health/worker" 503 worker unavailable worker WORKER_HEARTBEAT_STALE
  Assert-HealthContract "$baseUrl/api/v1/health" 503 api unavailable worker WORKER_HEARTBEAT_STALE
  Assert-HealthContract "$baseUrl/api/v1/health/db" 200 database ok
  Assert-HealthContract "$baseUrl/health" 200 web ok

  # Recreate API/Web while Worker remains stopped. This proves a failed Worker
  # cannot block a cold start of the user-facing services.
  Invoke-PhaseCompose stop web api
  Invoke-PhaseCompose up --detach api web --wait --wait-timeout 90
  $workerContainerId = (& docker compose -f docker-compose.yml -p $phaseProjectName ps -aq worker).Trim()
  $workerRunning = (& docker container inspect $workerContainerId --format '{{.State.Running}}').Trim()
  if ($LASTEXITCODE -ne 0 -or $workerRunning -ne 'false') {
    throw 'Worker unexpectedly restarted during the API/Web cold-start test'
  }
  Assert-HealthContract "$baseUrl/health" 200 web ok
  Assert-HealthContract "$baseUrl/api/v1/health/worker" 503 worker unavailable worker WORKER_HEARTBEAT_STALE
  Assert-HealthContract "$baseUrl/api/v1/health" 503 api unavailable worker WORKER_HEARTBEAT_STALE
  Assert-HealthContract "$baseUrl/api/v1/health/db" 200 database ok

  Invoke-PhaseCompose up --detach worker --wait --wait-timeout 90
  [void](Wait-HttpStatus "$baseUrl/api/v1/health/worker" 200 45)
  Assert-HealthContract "$baseUrl/api/v1/health/worker" 200 worker ok
  Assert-HealthContract "$baseUrl/api/v1/health" 200 api ok

  Invoke-PhaseCompose stop postgres
  $databaseFailure = Wait-HttpStatus "$baseUrl/api/v1/health/db" 503 30
  if ($databaseFailure.Content -match 'postgresql://' -or $databaseFailure.Content.Contains($phaseDatabasePassword)) {
    throw 'Database health response leaked a connection detail'
  }
  Assert-HealthContract "$baseUrl/api/v1/health/db" 503 database unavailable database DATABASE_UNAVAILABLE
  Assert-HealthContract "$baseUrl/api/v1/health" 503 api unavailable database DATABASE_UNAVAILABLE
  Assert-HealthContract "$baseUrl/health" 200 web ok
}
catch {
  $phaseFailure = $_
  if ($composeInvoked) {
    & docker compose -f docker-compose.yml -p $phaseProjectName logs --no-color --tail 200
  }
}
finally {
  try {
    if ($composeInvoked -and $phaseProjectName -match '^ytmonitor-phase0-[0-9]+-[a-f0-9]{8}$') {
      Assert-ComposeResourcesOwned
      & docker compose -f docker-compose.yml -p $phaseProjectName down --volumes --remove-orphans --rmi local
      if ($LASTEXITCODE -ne 0) {
        throw 'Phase 0 Docker cleanup command failed'
      }
      Assert-NoComposeResourcesRemain
    }
  }
  catch {
    $cleanupFailure = $_
  }

  Restore-EnvironmentVariable WEB_PORT $previousWebPort
  Restore-EnvironmentVariable WORKER_HEARTBEAT_INTERVAL_SECONDS $previousHeartbeatInterval
  Restore-EnvironmentVariable WORKER_HEARTBEAT_STALE_SECONDS $previousHeartbeatStale
  Restore-EnvironmentVariable POSTGRES_USER $previousPostgresUser
  Restore-EnvironmentVariable POSTGRES_PASSWORD $previousPostgresPassword
  Restore-EnvironmentVariable POSTGRES_DB $previousPostgresDatabase
  Restore-EnvironmentVariable DATABASE_URL $previousDatabaseUrl
  Restore-EnvironmentVariable BUILDKIT_PROGRESS $previousBuildkitProgress
  Restore-EnvironmentVariable COMPOSE_COMPATIBILITY $previousComposeCompatibility
}

if ($phaseFailure -and $cleanupFailure) {
  throw "Phase 0 integration failed: $($phaseFailure.Exception.Message). Cleanup also failed: $($cleanupFailure.Exception.Message)"
}
if ($phaseFailure) {
  throw $phaseFailure
}
if ($cleanupFailure) {
  throw $cleanupFailure
}
