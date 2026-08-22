$ErrorActionPreference = 'Stop'

$phaseRunId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$phaseProjectName = "ytmonitor-authdb-$PID-$phaseRunId"
if ($phaseProjectName -notmatch '^ytmonitor-authdb-[0-9]+-[a-f0-9]{8}$') {
  throw "Unsafe Compose project name: $phaseProjectName"
}

$phaseServiceNames = @('postgres', 'db-migrate', 'db-seed')
$phaseNetworkNames = @('database')
$previousPostgresUser = $env:POSTGRES_USER
$previousPostgresPassword = $env:POSTGRES_PASSWORD
$previousPostgresDatabase = $env:POSTGRES_DB
$previousDatabaseUrl = $env:DATABASE_URL
$previousSeedAdminEmail = $env:SEED_ADMIN_EMAIL
$previousSeedAdminPassword = $env:SEED_ADMIN_PASSWORD
$previousDeploymentMode = $env:DEPLOYMENT_MODE
$previousAppPublicUrl = $env:APP_PUBLIC_URL
$previousAllowedOrigins = $env:APP_ALLOWED_ORIGINS
$previousSessionSecret = $env:SESSION_SECRET
$previousSessionIdleMinutes = $env:SESSION_IDLE_MINUTES
$previousSessionAbsoluteHours = $env:SESSION_ABSOLUTE_HOURS
$previousLoginMaxAttempts = $env:LOGIN_MAX_ATTEMPTS
$previousLoginLockMinutes = $env:LOGIN_LOCK_MINUTES
$previousHeartbeatInterval = $env:WORKER_HEARTBEAT_INTERVAL_SECONDS
$previousHeartbeatStale = $env:WORKER_HEARTBEAT_STALE_SECONDS
$previousBuildkitProgress = $env:BUILDKIT_PROGRESS
$previousBuildxNoDefaultAttestations = $env:BUILDX_NO_DEFAULT_ATTESTATIONS
$previousComposeBake = $env:COMPOSE_BAKE
$previousComposeProgress = $env:COMPOSE_PROGRESS
$previousComposeCompatibility = $env:COMPOSE_COMPATIBILITY
$phaseDatabasePassword = "authdb_$([Guid]::NewGuid().ToString('N'))"
$phaseSchema = "auth_$([Guid]::NewGuid().ToString('N').Substring(0, 8))"
$env:POSTGRES_USER = 'auth_test'
$env:POSTGRES_PASSWORD = $phaseDatabasePassword
$env:POSTGRES_DB = 'auth_test'
$env:DATABASE_URL = "postgresql://auth_test:$phaseDatabasePassword@postgres:5432/auth_test?schema=$phaseSchema"
$env:SEED_ADMIN_EMAIL = 'bootstrap-admin@example.com'
$env:SEED_ADMIN_PASSWORD = 'bootstrap password for isolated tests'
$env:DEPLOYMENT_MODE = 'LOCAL'
$env:APP_PUBLIC_URL = 'http://127.0.0.1:3000'
$env:APP_ALLOWED_ORIGINS = 'http://127.0.0.1:3000'
$env:SESSION_SECRET = "authdb_session_$([Guid]::NewGuid().ToString('N'))"
$env:SESSION_IDLE_MINUTES = '120'
$env:SESSION_ABSOLUTE_HOURS = '24'
$env:LOGIN_MAX_ATTEMPTS = '5'
$env:LOGIN_LOCK_MINUTES = '15'
$env:WORKER_HEARTBEAT_INTERVAL_SECONDS = '2'
$env:WORKER_HEARTBEAT_STALE_SECONDS = '6'
$env:BUILDKIT_PROGRESS = 'plain'
$env:BUILDX_NO_DEFAULT_ATTESTATIONS = '1'
$env:COMPOSE_BAKE = 'true'
$env:COMPOSE_PROGRESS = 'plain'
Remove-Item Env:COMPOSE_COMPATIBILITY -ErrorAction SilentlyContinue
$composeInvoked = $false
$phaseFailure = $null
$cleanupFailure = $null
$safeFailureLogs = $null
$phaseSecretMarkers = @(
  $phaseDatabasePassword,
  $env:SEED_ADMIN_EMAIL,
  $env:SEED_ADMIN_PASSWORD,
  $env:SESSION_SECRET
)

function Assert-NoAuthDbSecretMarkers {
  param(
    [AllowNull()][string]$Text,
    [string]$Surface
  )

  if ($null -eq $Text) { return }
  foreach ($marker in $phaseSecretMarkers) {
    if ($Text.Contains($marker)) {
      throw "A planted credential marker was found on the Phase 1 auth database $Surface surface"
    }
  }
}

function ConvertTo-AuthDbRedactedText {
  param([AllowNull()][string]$Text)

  if ($null -eq $Text) { return '' }
  $redacted = $Text
  foreach ($marker in $phaseSecretMarkers) {
    $redacted = $redacted.Replace($marker, '[REDACTED]')
  }
  return $redacted
}

function Get-SharedAuthDbFileText {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
  try {
    return $reader.ReadToEnd()
  }
  finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}

function Test-CompletedAuthDbImage {
  param(
    [ValidateSet('db-migrate', 'db-seed')][string]$Service,
    [string]$BuildOutput,
    [switch]$RequireFinalExportEvidence
  )

  $imageName = "$phaseProjectName-$Service`:latest"
  $inspectionOutput = @(& docker image inspect $imageName 2>$null)
  if ($LASTEXITCODE -ne 0) { return $false }
  $images = @((($inspectionOutput -join "`n") | ConvertFrom-Json))
  if ($images.Count -ne 1) { return $false }
  $image = $images[0]
  $composeVersion = [string]$image.Config.Labels.'com.docker.compose.version'
  if (
    @($image.RepoTags).Count -ne 1 -or
    [string]$image.RepoTags[0] -ne $imageName -or
    [string]$image.Config.Labels.'com.docker.compose.project' -ne $phaseProjectName -or
    [string]$image.Config.Labels.'com.docker.compose.service' -ne $Service -or
    $composeVersion -notmatch '^[0-9]+\.[0-9]+\.[0-9]+'
  ) {
    return $false
  }
  $expectedCommand = if ($Service -eq 'db-migrate') {
    @('node', '/app/node_modules/prisma/build/index.js', 'migrate', 'deploy')
  }
  else {
    @('node', '--import', 'tsx', 'prisma/seed.ts')
  }
  $actualCommand = @($image.Config.Cmd | ForEach-Object { [string]$_ })
  if (
    $actualCommand.Count -ne $expectedCommand.Count -or
    @(Compare-Object -ReferenceObject $expectedCommand -DifferenceObject $actualCommand).Count -ne 0
  ) {
    return $false
  }

  if ($RequireFinalExportEvidence) {
    $exportName = [Regex]::Escape("docker.io/library/$imageName")
    $naming = [Regex]::Match(
      $BuildOutput,
      "(?m)^#(?<step>[0-9]+) naming to $exportName(?: [^\r\n]+)? done\s*$"
    )
    if (-not $naming.Success) { return $false }
    $step = [Regex]::Escape($naming.Groups['step'].Value)
    if (
      $BuildOutput -notmatch "(?m)^#$step unpacking to $exportName(?: [^\r\n]+)? done\s*$" -or
      $BuildOutput -notmatch "(?m)^#$step DONE [0-9]+(?:\.[0-9]+)?s\s*$"
    ) {
      return $false
    }
  }
  return $true
}

function Assert-NoAuthDbBuildProcessRemains {
  $matchingProcesses = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -in @('docker.exe', 'docker-compose.exe', 'docker-buildx.exe') -and
        [string]$_.CommandLine -like "*$phaseProjectName*"
      }
  )
  if ($matchingProcesses.Count -ne 0) {
    throw 'An auth database Docker build process remained after bounded termination'
  }
}

function Remove-AuthDbBuildFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    try {
      Remove-Item -LiteralPath $Path -Force
      return
    }
    catch [IO.IOException] {
      Start-Sleep -Milliseconds 100
    }
  }
  throw 'Could not remove a validated auth database build log file'
}

function Invoke-AuthDbBuild {
  param([ValidateSet('db-migrate', 'db-seed')][string]$Service)

  $safeStem = "ytmonitor-authdb-build-$PID-$phaseRunId-$Service"
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  $inputPath = Join-Path $tempRoot "$safeStem.in"
  $stdoutPath = Join-Path $tempRoot "$safeStem.stdout.log"
  $stderrPath = Join-Path $tempRoot "$safeStem.stderr.log"
  foreach ($path in @($inputPath, $stdoutPath, $stderrPath)) {
    $fullPath = [IO.Path]::GetFullPath($path)
    if (
      -not $fullPath.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($fullPath) -notmatch "^$([Regex]::Escape($safeStem))\.(?:in|stdout\.log|stderr\.log)$"
    ) {
      throw 'Refusing to use an unexpected auth database build log path'
    }
  }

  $imageName = "$phaseProjectName-$Service`:latest"
  & docker image inspect $imageName *> $null
  if ($LASTEXITCODE -eq 0) { throw "$Service image unexpectedly existed before its isolated build" }
  [IO.File]::WriteAllText($inputPath, '')
  $process = $null
  $verifiedAfterForcedExit = $false
  try {
    $dockerCommand = Get-Command docker.exe -CommandType Application -ErrorAction Stop |
      Select-Object -First 1
    $arguments = @(
      'compose', '--progress', 'plain', '-f', 'docker-compose.yml', '-p', $phaseProjectName,
      '--profile', 'seed', 'build', '--provenance=false', $Service
    )
    $process = Start-Process -FilePath ([string]$dockerCommand.Source) -ArgumentList $arguments `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardInput $inputPath `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath
    $deadline = [DateTime]::UtcNow.AddMinutes(10)
    while (-not $process.WaitForExit(1000)) {
      $partialOutput = "$(Get-SharedAuthDbFileText $stdoutPath)`n$(Get-SharedAuthDbFileText $stderrPath)"
      Assert-NoAuthDbSecretMarkers $partialOutput "$Service build output"
      if (Test-CompletedAuthDbImage $Service $partialOutput -RequireFinalExportEvidence) {
        if (-not $process.WaitForExit(2000)) {
          try { $process.Kill($true) } catch { $process.Kill() }
          $process.WaitForExit()
          Start-Sleep -Milliseconds 250
          Assert-NoAuthDbBuildProcessRemains
          $verifiedAfterForcedExit = $true
        }
        break
      }
      if ([DateTime]::UtcNow -ge $deadline) { break }
    }
    if (-not $process.HasExited) {
      try { $process.Kill($true) } catch { $process.Kill() }
      $process.WaitForExit()
      Start-Sleep -Milliseconds 250
      Assert-NoAuthDbBuildProcessRemains
      throw "The bounded $Service auth database image build timed out"
    }

    $buildOutput = "$(Get-SharedAuthDbFileText $stdoutPath)`n$(Get-SharedAuthDbFileText $stderrPath)"
    Assert-NoAuthDbSecretMarkers $buildOutput "$Service build output"
    if (-not $verifiedAfterForcedExit -and $process.ExitCode -ne 0) {
      if (-not [string]::IsNullOrWhiteSpace($buildOutput)) {
        Write-Output (ConvertTo-AuthDbRedactedText $buildOutput)
      }
      throw "$Service auth database image build failed"
    }
    if (-not (Test-CompletedAuthDbImage $Service $buildOutput)) {
      throw "$Service auth database image identity did not match its isolated Compose project"
    }
    $completionMode = if ($verifiedAfterForcedExit) { 'verified post-DONE renderer termination' } else { 'normal exit' }
    Write-Output "Built auth database image: $Service ($completionMode)"
  }
  finally {
    $buildCleanupErrors = @()
    if ($null -ne $process) {
      if (-not $process.HasExited) {
        try {
          try { $process.Kill($true) } catch { $process.Kill() }
          $process.WaitForExit()
          Start-Sleep -Milliseconds 250
          Assert-NoAuthDbBuildProcessRemains
        }
        catch {
          $buildCleanupErrors += 'bounded auth database build process cleanup failed'
        }
      }
      $process.Dispose()
    }
    foreach ($path in @($inputPath, $stdoutPath, $stderrPath)) {
      try { Remove-AuthDbBuildFile $path } catch { $buildCleanupErrors += 'auth database build log cleanup failed' }
    }
    if ($buildCleanupErrors.Count -ne 0) {
      throw ($buildCleanupErrors -join '; ')
    }
  }
}

function Invoke-PhaseCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)

  & docker compose -f docker-compose.yml -p $phaseProjectName @ComposeArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'A Phase 1 auth database Compose command failed; arguments were omitted to protect secrets'
  }
}

function Get-SafeAuthDbComposeLogs {
  $logOutput = @(
    & docker compose -f docker-compose.yml -p $phaseProjectName logs --no-color --tail 200 2>&1
  )
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not capture auth database Compose logs for safe inspection'
  }
  $logText = $logOutput -join "`n"
  Assert-NoAuthDbSecretMarkers $logText 'Compose log'
  return (ConvertTo-AuthDbRedactedText $logText)
}

function Invoke-SeedAndAssertStatus {
  param([ValidateSet('CREATED', 'UNCHANGED')][string]$ExpectedStatus)

  $seedOutput = @(
    & docker compose -f docker-compose.yml -p $phaseProjectName --profile seed run --rm `
      db-seed 2>&1
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
    if ($parts.Count -eq 2 -and $parts[1] -match "^$escapedProject[-_](?:db-migrate|db-seed)$") {
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
  foreach ($service in @('db-migrate', 'db-seed')) {
    Invoke-AuthDbBuild $service
  }

  Invoke-PhaseCompose run --rm db-migrate
  Invoke-PhaseCompose run --rm db-migrate
  Invoke-PhaseCompose run --rm db-migrate pnpm test:db:integration

  Invoke-SeedAndAssertStatus CREATED
  Invoke-SeedAndAssertStatus UNCHANGED
}
catch {
  $phaseFailure = $_
  if ($composeInvoked) {
    try {
      $safeFailureLogs = Get-SafeAuthDbComposeLogs
    }
    catch {
      $safeFailureLogs = 'Auth database Compose logs were withheld because their safe scan failed.'
    }
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
  Restore-EnvironmentVariable DEPLOYMENT_MODE $previousDeploymentMode
  Restore-EnvironmentVariable APP_PUBLIC_URL $previousAppPublicUrl
  Restore-EnvironmentVariable APP_ALLOWED_ORIGINS $previousAllowedOrigins
  Restore-EnvironmentVariable SESSION_SECRET $previousSessionSecret
  Restore-EnvironmentVariable SESSION_IDLE_MINUTES $previousSessionIdleMinutes
  Restore-EnvironmentVariable SESSION_ABSOLUTE_HOURS $previousSessionAbsoluteHours
  Restore-EnvironmentVariable LOGIN_MAX_ATTEMPTS $previousLoginMaxAttempts
  Restore-EnvironmentVariable LOGIN_LOCK_MINUTES $previousLoginLockMinutes
  Restore-EnvironmentVariable WORKER_HEARTBEAT_INTERVAL_SECONDS $previousHeartbeatInterval
  Restore-EnvironmentVariable WORKER_HEARTBEAT_STALE_SECONDS $previousHeartbeatStale
  Restore-EnvironmentVariable BUILDKIT_PROGRESS $previousBuildkitProgress
  Restore-EnvironmentVariable BUILDX_NO_DEFAULT_ATTESTATIONS $previousBuildxNoDefaultAttestations
  Restore-EnvironmentVariable COMPOSE_BAKE $previousComposeBake
  Restore-EnvironmentVariable COMPOSE_PROGRESS $previousComposeProgress
  Restore-EnvironmentVariable COMPOSE_COMPATIBILITY $previousComposeCompatibility
}

if ($phaseFailure -and $cleanupFailure) {
  if (-not [string]::IsNullOrWhiteSpace($safeFailureLogs)) { Write-Output $safeFailureLogs }
  throw "Phase 1 auth database integration failed: $($phaseFailure.Exception.Message). Cleanup also failed: $($cleanupFailure.Exception.Message)"
}
if ($phaseFailure) {
  if (-not [string]::IsNullOrWhiteSpace($safeFailureLogs)) { Write-Output $safeFailureLogs }
  throw $phaseFailure
}
if ($cleanupFailure) {
  throw $cleanupFailure
}
