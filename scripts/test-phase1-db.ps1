$ErrorActionPreference = 'Stop'

$phaseProjectName = "ytmonitor-authdb-$PID-$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
if ($phaseProjectName -notmatch '^ytmonitor-authdb-[0-9]+-[a-f0-9]{8}$') {
  throw "Unsafe Compose project name: $phaseProjectName"
}

$phaseServiceNames = @('postgres', 'db-migrate')
$phaseNetworkNames = @('database')
$previousPostgresUser = $env:POSTGRES_USER
$previousPostgresPassword = $env:POSTGRES_PASSWORD
$previousPostgresDatabase = $env:POSTGRES_DB
$previousDatabaseUrl = $env:DATABASE_URL
$previousSeedAdminEmail = $env:SEED_ADMIN_EMAIL
$previousSeedAdminPassword = $env:SEED_ADMIN_PASSWORD
$previousBuildkitProgress = $env:BUILDKIT_PROGRESS
$previousComposeCompatibility = $env:COMPOSE_COMPATIBILITY
$phaseDatabasePassword = "authdb_$([Guid]::NewGuid().ToString('N'))"
$phaseSchema = "auth_$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$env:POSTGRES_USER = 'auth_test'
$env:POSTGRES_PASSWORD = $phaseDatabasePassword
$env:POSTGRES_DB = 'auth_test'
$env:DATABASE_URL = "postgresql://auth_test:$phaseDatabasePassword@postgres:5432/auth_test?schema=$phaseSchema"
$env:SEED_ADMIN_EMAIL = 'bootstrap-admin@example.com'
$env:SEED_ADMIN_PASSWORD = 'bootstrap password for isolated tests'
$env:BUILDKIT_PROGRESS = 'plain'
Remove-Item Env:COMPOSE_COMPATIBILITY -ErrorAction SilentlyContinue
$composeInvoked = $false
$phaseFailure = $null
$cleanupFailure = $null

function Invoke-PhaseCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)

  & docker compose -f docker-compose.yml -p $phaseProjectName @ComposeArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'A Phase 1 auth database Compose command failed; arguments were omitted to protect secrets'
  }
}

function Invoke-SeedAndAssertStatus {
  param([ValidateSet('CREATED', 'UNCHANGED')][string]$ExpectedStatus)

  $seedOutput = @(
    & docker compose -f docker-compose.yml -p $phaseProjectName run --rm `
      -e SEED_ADMIN_EMAIL `
      -e SEED_ADMIN_PASSWORD `
      db-migrate `
      node --import tsx prisma/seed.ts 2>&1
  )
  if ($LASTEXITCODE -ne 0) {
    throw 'The Phase 1 bootstrap admin command failed; output was omitted to protect secrets'
  }

  $combinedOutput = $seedOutput -join "`n"
  if (
    $combinedOutput.Contains($phaseDatabasePassword) -or
    $combinedOutput.Contains($env:SEED_ADMIN_EMAIL) -or
    $combinedOutput.Contains($env:SEED_ADMIN_PASSWORD)
  ) {
    throw 'The bootstrap admin command emitted a credential value'
  }

  $statusLines = @(
    $seedOutput |
      Where-Object { ([string]$_).Trim() -in @('CREATED', 'UNCHANGED') }
  )
  if ($statusLines.Count -ne 1 -or ([string]$statusLines[0]).Trim() -ne $ExpectedStatus) {
    throw "Bootstrap admin status did not equal $ExpectedStatus"
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
    throw "Could not enumerate Phase 1 auth database $ResourceType resources"
  }

  return @($resourceIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-ExactNamedProjectResourceIds {
  param([ValidateSet('container', 'network', 'volume')][string]$ResourceType)

  $escapedProject = [Regex]::Escape($phaseProjectName)
  $servicePattern = ($phaseServiceNames | ForEach-Object { [Regex]::Escape($_) }) -join '|'
  $networkPattern = ($phaseNetworkNames | ForEach-Object { [Regex]::Escape($_) }) -join '|'
  $namePattern = switch ($ResourceType) {
    'container' { "^$escapedProject[-_](?:$servicePattern)[-_](?:run[-_])?[a-z0-9]+$" }
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
    throw "Could not enumerate exact-name Phase 1 auth database $ResourceType resources"
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
  $records = @(& docker image ls --format '{{.ID}}|{{.Repository}}')
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not enumerate exact-name Phase 1 auth database images'
  }

  $imageIds = foreach ($record in $records) {
    $parts = $record -split '\|', 2
    if ($parts.Count -eq 2 -and $parts[1] -match "^$escapedProject[-_]db-migrate$") {
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
    throw "Refusing cleanup: could not inspect Phase 1 auth database $ResourceType identity"
  }
  $resource = @($resourceJson | ConvertFrom-Json)[0]
  $labels = if ($ResourceType -eq 'container') { $resource.Config.Labels } else { $resource.Labels }
  if ($labels.'com.docker.compose.project' -ne $phaseProjectName) {
    throw "Refusing cleanup: Phase 1 auth database $ResourceType has the wrong project label"
  }

  $escapedProject = [Regex]::Escape($phaseProjectName)
  switch ($ResourceType) {
    'container' {
      $service = [string]$labels.'com.docker.compose.service'
      $containerName = ([string]$resource.Name).TrimStart('/')
      if (
        $phaseServiceNames -notcontains $service -or
        $containerName -notmatch "^$escapedProject[-_]$([Regex]::Escape($service))[-_]"
      ) {
        throw 'Refusing cleanup: Phase 1 auth database container identity is unexpected'
      }
    }
    'network' {
      $network = [string]$labels.'com.docker.compose.network'
      if (
        $phaseNetworkNames -notcontains $network -or
        [string]$resource.Name -notmatch "^$escapedProject[-_]$([Regex]::Escape($network))$"
      ) {
        throw 'Refusing cleanup: Phase 1 auth database network identity is unexpected'
      }
    }
    'volume' {
      $volume = [string]$labels.'com.docker.compose.volume'
      if (
        $volume -ne 'postgres_data' -or
        [string]$resource.Name -notmatch "^$escapedProject[-_]postgres_data$"
      ) {
        throw 'Refusing cleanup: Phase 1 auth database volume identity is unexpected'
      }
    }
  }
}

function Assert-ComposeResourcesOwned {
  $composeContainerIds = @(& docker compose -f docker-compose.yml -p $phaseProjectName ps -aq)
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not resolve isolated Phase 1 auth database containers before cleanup'
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
      throw "Cleanup left Phase 1 auth database $resourceType resources behind"
    }
  }

  if (@(Get-ExactNamedProjectImageIds).Count -ne 0) {
    throw 'Cleanup left Phase 1 auth database images behind'
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
  Invoke-PhaseCompose up --detach --wait --wait-timeout 120 postgres
  Invoke-PhaseCompose build db-migrate

  Invoke-PhaseCompose run --rm db-migrate
  Invoke-PhaseCompose run --rm db-migrate
  Invoke-PhaseCompose run --rm db-migrate pnpm test:db:integration

  Invoke-SeedAndAssertStatus CREATED
  Invoke-SeedAndAssertStatus UNCHANGED
}
catch {
  $phaseFailure = $_
  if ($composeInvoked) {
    & docker compose -f docker-compose.yml -p $phaseProjectName logs --no-color --tail 200
  }
}
finally {
  try {
    if ($composeInvoked -and $phaseProjectName -match '^ytmonitor-authdb-[0-9]+-[a-f0-9]{8}$') {
      Assert-ComposeResourcesOwned
      & docker compose -f docker-compose.yml -p $phaseProjectName down --volumes --remove-orphans --rmi local
      if ($LASTEXITCODE -ne 0) {
        throw 'Phase 1 auth database Docker cleanup command failed'
      }
      Assert-NoComposeResourcesRemain
    }
  }
  catch {
    $cleanupFailure = $_
  }

  Restore-EnvironmentVariable POSTGRES_USER $previousPostgresUser
  Restore-EnvironmentVariable POSTGRES_PASSWORD $previousPostgresPassword
  Restore-EnvironmentVariable POSTGRES_DB $previousPostgresDatabase
  Restore-EnvironmentVariable DATABASE_URL $previousDatabaseUrl
  Restore-EnvironmentVariable SEED_ADMIN_EMAIL $previousSeedAdminEmail
  Restore-EnvironmentVariable SEED_ADMIN_PASSWORD $previousSeedAdminPassword
  Restore-EnvironmentVariable BUILDKIT_PROGRESS $previousBuildkitProgress
  Restore-EnvironmentVariable COMPOSE_COMPATIBILITY $previousComposeCompatibility
}

if ($phaseFailure -and $cleanupFailure) {
  throw "Phase 1 auth database integration failed: $($phaseFailure.Exception.Message). Cleanup also failed: $($cleanupFailure.Exception.Message)"
}
if ($phaseFailure) {
  throw $phaseFailure
}
if ($cleanupFailure) {
  throw $cleanupFailure
}
