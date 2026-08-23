$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}

$phaseRunId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$phaseProjectName = "ytmonitor-phase1-$PID-$phaseRunId"
if ($phaseProjectName -notmatch '^ytmonitor-phase1-[0-9]+-[a-f0-9]{8}$') {
  throw 'Unsafe Phase 1 Compose project name'
}

$phaseServiceNames = @('postgres', 'db-migrate', 'db-seed', 'worker', 'api', 'web', 'e2e')
$phaseNetworkNames = @('frontend', 'database', 'egress')
$phaseEnvironmentNames = @(
  'WEB_PORT',
  'POSTGRES_USER',
  'POSTGRES_PASSWORD',
  'POSTGRES_DB',
  'DATABASE_URL',
  'DEPLOYMENT_MODE',
  'APP_PUBLIC_URL',
  'APP_ALLOWED_ORIGINS',
  'SESSION_SECRET',
  'SESSION_IDLE_MINUTES',
  'SESSION_ABSOLUTE_HOURS',
  'LOGIN_MAX_ATTEMPTS',
  'LOGIN_LOCK_MINUTES',
  'WORKER_HEARTBEAT_INTERVAL_SECONDS',
  'WORKER_HEARTBEAT_STALE_SECONDS',
  'SEED_ADMIN_EMAIL',
  'SEED_ADMIN_PASSWORD',
  'E2E_BASE_URL',
  'E2E_ADMIN_EMAIL',
  'E2E_ADMIN_PASSWORD',
  'E2E_MATRIX_VIEWER_EMAIL',
  'E2E_MATRIX_VIEWER_UPDATED_EMAIL',
  'E2E_MATRIX_VIEWER_PASSWORD',
  'E2E_MATRIX_VIEWER_RESET_PASSWORD',
  'E2E_LOGOUT_VIEWER_EMAIL',
  'E2E_LOGOUT_VIEWER_PASSWORD',
  'E2E_CHANGE_VIEWER_EMAIL',
  'E2E_CHANGE_VIEWER_PASSWORD',
  'E2E_CHANGE_VIEWER_NEW_PASSWORD',
  'E2E_BROWSER_VIEWER_EMAIL',
  'E2E_BROWSER_VIEWER_PASSWORD',
  'E2E_RAW_SESSION_TOKEN_MARKER',
  'BUILDKIT_PROGRESS',
  'BUILDX_NO_DEFAULT_ATTESTATIONS',
  'COMPOSE_BAKE',
  'COMPOSE_PROGRESS',
  'COMPOSE_COMPATIBILITY',
  'TRUST_PROXY'
)
$previousEnvironment = @{}
foreach ($name in $phaseEnvironmentNames) {
  $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function New-RandomBase64Url {
  param([ValidateRange(16, 128)][int]$ByteCount)

  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  }
  finally {
    $generator.Dispose()
  }

  return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Get-AvailableHostPort {
  for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
    $candidate = Get-Random -Minimum 20000 -Maximum 40000
    $listener = New-Object System.Net.Sockets.TcpListener(
      [System.Net.IPAddress]::Loopback,
      $candidate
    )
    $listener.Server.ExclusiveAddressUse = $true
    try {
      $listener.Start()
      return $candidate
    }
    catch [System.Net.Sockets.SocketException] {
      continue
    }
    finally {
      $listener.Stop()
    }
  }

  throw 'Could not reserve an unused loopback port for the Phase 1 Docker test'
}

$phaseWebPort = Get-AvailableHostPort
$phaseBaseUrl = "http://127.0.0.1:$phaseWebPort"
$phaseDatabasePassword = "p1db_$(New-RandomBase64Url 24)"
$phaseSessionSecret = "p1session_$(New-RandomBase64Url 32)"
$phaseAdminPassword = "p1admin_$(New-RandomBase64Url 24)"
$matrixViewerPassword = "p1matrix_$(New-RandomBase64Url 24)"
$matrixViewerResetPassword = "p1reset_$(New-RandomBase64Url 24)"
$logoutViewerPassword = "p1logout_$(New-RandomBase64Url 24)"
$changeViewerPassword = "p1change_$(New-RandomBase64Url 24)"
$changeViewerNewPassword = "p1changed_$(New-RandomBase64Url 24)"
$browserViewerPassword = "p1browser_$(New-RandomBase64Url 24)"
$rawSessionTokenMarker = New-RandomBase64Url 32
$phaseAdminEmail = "admin-$phaseRunId@example.test"
$matrixViewerEmail = "matrix-$phaseRunId@example.test"
$matrixViewerUpdatedEmail = "matrix-updated-$phaseRunId@example.test"
$logoutViewerEmail = "logout-$phaseRunId@example.test"
$changeViewerEmail = "change-$phaseRunId@example.test"
$browserViewerEmail = "browser-$phaseRunId@example.test"
$phaseSecretMarkers = @(
  $phaseDatabasePassword,
  $phaseSessionSecret,
  $phaseAdminPassword,
  $matrixViewerPassword,
  $matrixViewerResetPassword,
  $logoutViewerPassword,
  $changeViewerPassword,
  $changeViewerNewPassword,
  $browserViewerPassword,
  $rawSessionTokenMarker
)

$env:WEB_PORT = [string]$phaseWebPort
$env:POSTGRES_USER = 'phase1_test'
$env:POSTGRES_PASSWORD = $phaseDatabasePassword
$env:POSTGRES_DB = 'phase1_test'
$env:DATABASE_URL = "postgresql://phase1_test:$phaseDatabasePassword@postgres:5432/phase1_test"
$env:DEPLOYMENT_MODE = 'LOCAL'
$env:APP_PUBLIC_URL = $phaseBaseUrl
$env:APP_ALLOWED_ORIGINS = "$phaseBaseUrl,http://web:3000"
$env:SESSION_SECRET = $phaseSessionSecret
$env:SESSION_IDLE_MINUTES = '120'
$env:SESSION_ABSOLUTE_HOURS = '24'
$env:LOGIN_MAX_ATTEMPTS = '5'
$env:LOGIN_LOCK_MINUTES = '15'
$env:WORKER_HEARTBEAT_INTERVAL_SECONDS = '2'
$env:WORKER_HEARTBEAT_STALE_SECONDS = '6'
$env:SEED_ADMIN_EMAIL = $phaseAdminEmail
$env:SEED_ADMIN_PASSWORD = $phaseAdminPassword
$env:E2E_BASE_URL = 'http://web:3000'
$env:E2E_ADMIN_EMAIL = $phaseAdminEmail
$env:E2E_ADMIN_PASSWORD = $phaseAdminPassword
$env:E2E_MATRIX_VIEWER_EMAIL = $matrixViewerEmail
$env:E2E_MATRIX_VIEWER_UPDATED_EMAIL = $matrixViewerUpdatedEmail
$env:E2E_MATRIX_VIEWER_PASSWORD = $matrixViewerPassword
$env:E2E_MATRIX_VIEWER_RESET_PASSWORD = $matrixViewerResetPassword
$env:E2E_LOGOUT_VIEWER_EMAIL = $logoutViewerEmail
$env:E2E_LOGOUT_VIEWER_PASSWORD = $logoutViewerPassword
$env:E2E_CHANGE_VIEWER_EMAIL = $changeViewerEmail
$env:E2E_CHANGE_VIEWER_PASSWORD = $changeViewerPassword
$env:E2E_CHANGE_VIEWER_NEW_PASSWORD = $changeViewerNewPassword
$env:E2E_BROWSER_VIEWER_EMAIL = $browserViewerEmail
$env:E2E_BROWSER_VIEWER_PASSWORD = $browserViewerPassword
$env:E2E_RAW_SESSION_TOKEN_MARKER = $rawSessionTokenMarker
$env:BUILDKIT_PROGRESS = 'plain'
$env:BUILDX_NO_DEFAULT_ATTESTATIONS = '1'
$env:COMPOSE_BAKE = 'true'
$env:COMPOSE_PROGRESS = 'plain'
Remove-Item Env:COMPOSE_COMPATIBILITY -ErrorAction SilentlyContinue
Remove-Item Env:TRUST_PROXY -ErrorAction SilentlyContinue

$integrationSchema = "phase1_integration_$phaseRunId"
$integrationDatabaseUrl = "$($env:DATABASE_URL)?schema=$integrationSchema"
$composeInvoked = $false
$forcedBuildServices = @()
$phaseFailure = $null
$cleanupFailure = $null
$safeFailureLogs = $null
$artifactDirectory = Join-Path ([IO.Path]::GetTempPath()) "ytmonitor-phase1-artifacts-$PID-$phaseRunId"

function Assert-NoSecretMarkers {
  param(
    [AllowNull()][string]$Text,
    [string]$Surface
  )

  if ($null -eq $Text) { return }
  foreach ($marker in $phaseSecretMarkers) {
    if ($Text.Contains($marker)) {
      throw "A planted secret marker was found on the $Surface surface"
    }
  }
}

function ConvertTo-RedactedText {
  param([AllowNull()][string]$Text)

  if ($null -eq $Text) { return '' }
  $redacted = $Text
  foreach ($marker in $phaseSecretMarkers) {
    $redacted = $redacted.Replace($marker, '[REDACTED]')
  }
  return $redacted
}

function Invoke-PhaseCompose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)

  $script:composeInvoked = $true
  & docker compose -f docker-compose.yml -p $phaseProjectName @ComposeArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'A Phase 1 Docker Compose command failed; arguments were omitted to protect secrets'
  }
}

function Get-SharedFileText {
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

function Test-CompletedPhaseImage {
  param(
    [string]$Service,
    [string]$BuildOutput,
    [switch]$RequireFinalExportEvidence
  )

  $imageName = "$phaseProjectName-$Service`:latest"
  $inspectionOutput = @(& docker image inspect $imageName 2>$null)
  if ($LASTEXITCODE -ne 0) { return $false }
  $images = @(($inspectionOutput -join "`n") | ConvertFrom-Json)
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

  $actualCommand = @($image.Config.Cmd | ForEach-Object { [string]$_ })
  $expectedCommand = switch ($Service) {
    'db-migrate' { @('node', '/app/node_modules/prisma/build/index.js', 'migrate', 'deploy') }
    'db-seed' { @('node', '--import', 'tsx', 'prisma/seed.ts') }
    'worker' { @('node', 'apps/worker/dist/main.js') }
    'api' { @('node', 'apps/api/dist/main.js') }
    'web' { @('node', 'apps/web/start-standalone.mjs') }
    'e2e' { @('sh', '-c') }
  }
  if (
    $actualCommand.Count -lt $expectedCommand.Count -or
    @(Compare-Object -ReferenceObject $expectedCommand -DifferenceObject $actualCommand[0..($expectedCommand.Count - 1)]).Count -ne 0 -or
    ($Service -eq 'e2e' -and ($actualCommand.Count -ne 3 -or $actualCommand[2] -notmatch 'pnpm test:e2e$'))
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

function Assert-NoPhaseBuildProcessRemains {
  $matchingProcesses = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -in @('docker.exe', 'docker-compose.exe', 'docker-buildx.exe') -and
        [string]$_.CommandLine -like "*$phaseProjectName*"
      }
  )
  if ($matchingProcesses.Count -ne 0) {
    throw 'A Phase 1 Docker build process remained after bounded termination'
  }
}

function Remove-PhaseBuildFile {
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
  throw 'Could not remove a validated Phase 1 build log file'
}

function Invoke-PhaseBuild {
  param([ValidateSet('db-migrate', 'db-seed', 'worker', 'api', 'web', 'e2e')][string]$Service)

  $script:composeInvoked = $true
  $safeStem = "ytmonitor-phase1-build-$PID-$phaseRunId-$Service"
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
      throw 'Refusing to use an unexpected Phase 1 build log path'
    }
  }

  [IO.File]::WriteAllText($inputPath, '')
  $process = $null
  $verifiedAfterForcedExit = $false
  try {
    $imageName = "$phaseProjectName-$Service`:latest"
    & docker image inspect $imageName *> $null
    if ($LASTEXITCODE -eq 0) {
      throw "$Service image unexpectedly existed before its isolated build"
    }

    $dockerCommand = Get-Command docker.exe -CommandType Application -ErrorAction Stop |
      Select-Object -First 1
    $dockerPath = [string]$dockerCommand.Source
    $arguments = @(
      'compose', '--progress', 'plain', '-f', 'docker-compose.yml', '-p', $phaseProjectName,
      '--profile', 'seed', '--profile', 'e2e',
      'build', '--provenance=false', $Service
    )
    $process = Start-Process -FilePath $dockerPath -ArgumentList $arguments `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardInput $inputPath `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath

    $deadline = [DateTime]::UtcNow.AddMinutes(10)
    while (-not $process.WaitForExit(1000)) {
      $partialOutput = "$(Get-SharedFileText $stdoutPath)`n$(Get-SharedFileText $stderrPath)"
      Assert-NoSecretMarkers $partialOutput "$Service build output"
      if (Test-CompletedPhaseImage $Service $partialOutput -RequireFinalExportEvidence) {
        if (-not $process.WaitForExit(2000)) {
          try { $process.Kill($true) } catch { $process.Kill() }
          $process.WaitForExit()
          Start-Sleep -Milliseconds 250
          Assert-NoPhaseBuildProcessRemains
          $verifiedAfterForcedExit = $true
          $script:forcedBuildServices += $Service
        }
        break
      }
      if ([DateTime]::UtcNow -ge $deadline) { break }
    }

    if (-not $process.HasExited) {
      try { $process.Kill($true) } catch { $process.Kill() }
      $process.WaitForExit()
      Start-Sleep -Milliseconds 250
      Assert-NoPhaseBuildProcessRemains
      throw "The bounded $Service image build timed out"
    }

    $stdout = Get-SharedFileText $stdoutPath
    $stderr = Get-SharedFileText $stderrPath
    $buildOutput = "$stdout`n$stderr"
    Assert-NoSecretMarkers $buildOutput "$Service build output"
    if (-not $verifiedAfterForcedExit -and $process.ExitCode -ne 0) {
      if (-not [string]::IsNullOrWhiteSpace($buildOutput)) {
        Write-Output (ConvertTo-RedactedText $buildOutput)
      }
      throw "$Service image build failed"
    }
    if (-not (Test-CompletedPhaseImage $Service $buildOutput)) {
      throw "$Service image identity did not match its isolated Compose project"
    }
    $completionMode = if ($verifiedAfterForcedExit) { 'verified post-DONE renderer termination' } else { 'normal exit' }
    Write-Output "Built Phase 1 image: $Service ($completionMode)"
  }
  finally {
    $buildCleanupErrors = @()
    if ($null -ne $process) {
      if (-not $process.HasExited) {
        try {
          try { $process.Kill($true) } catch { $process.Kill() }
          $process.WaitForExit()
          Start-Sleep -Milliseconds 250
          Assert-NoPhaseBuildProcessRemains
        }
        catch {
          $buildCleanupErrors += 'bounded build process cleanup failed'
        }
      }
      $process.Dispose()
    }
    foreach ($path in @($inputPath, $stdoutPath, $stderrPath)) {
      try { Remove-PhaseBuildFile $path } catch { $buildCleanupErrors += 'build log cleanup failed' }
    }
    if ($buildCleanupErrors.Count -ne 0) {
      throw ($buildCleanupErrors -join '; ')
    }
  }
}

function Invoke-CapturedCompose {
  param(
    [string[]]$ComposeArguments,
    [string]$Surface,
    [switch]$PrintSafeOutput
  )

  $script:composeInvoked = $true
  $output = @(& docker compose -f docker-compose.yml -p $phaseProjectName @ComposeArguments 2>&1)
  $exitCode = $LASTEXITCODE
  $text = $output -join "`n"
  Assert-NoSecretMarkers $text $Surface
  if ($PrintSafeOutput -and -not [string]::IsNullOrWhiteSpace($text)) {
    Write-Output (ConvertTo-RedactedText $text)
  }
  if ($exitCode -ne 0) {
    throw "A captured Phase 1 Docker command failed on the $Surface surface"
  }
  return $text
}

function Assert-ComposeProfileCredentialsAreOptionalAtParseTime {
  $profileCredentialNames = @(
    'SEED_ADMIN_EMAIL',
    'SEED_ADMIN_PASSWORD',
    'E2E_BASE_URL',
    'E2E_ADMIN_EMAIL',
    'E2E_ADMIN_PASSWORD',
    'E2E_MATRIX_VIEWER_EMAIL',
    'E2E_MATRIX_VIEWER_UPDATED_EMAIL',
    'E2E_MATRIX_VIEWER_PASSWORD',
    'E2E_MATRIX_VIEWER_RESET_PASSWORD',
    'E2E_LOGOUT_VIEWER_EMAIL',
    'E2E_LOGOUT_VIEWER_PASSWORD',
    'E2E_CHANGE_VIEWER_EMAIL',
    'E2E_CHANGE_VIEWER_PASSWORD',
    'E2E_CHANGE_VIEWER_NEW_PASSWORD',
    'E2E_BROWSER_VIEWER_EMAIL',
    'E2E_BROWSER_VIEWER_PASSWORD',
    'E2E_RAW_SESSION_TOKEN_MARKER'
  )
  $values = @{}
  foreach ($name in $profileCredentialNames) {
    $values[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    Remove-Item "Env:$name" -ErrorAction SilentlyContinue
  }

  try {
    $output = @(& docker compose -f docker-compose.yml -p $phaseProjectName config --quiet 2>&1)
    $exitCode = $LASTEXITCODE
    Assert-NoSecretMarkers ($output -join "`n") 'ordinary Compose parse'
    if ($exitCode -ne 0) {
      throw 'Ordinary Compose parsing must not require disabled-profile credentials'
    }
  }
  finally {
    foreach ($name in $profileCredentialNames) {
      Set-Item "Env:$name" $values[$name]
    }
  }
}

function Assert-ComposeRequiresSessionSecret {
  $savedSecret = $env:SESSION_SECRET
  Remove-Item Env:SESSION_SECRET -ErrorAction SilentlyContinue
  try {
    $output = @(& docker compose -f docker-compose.yml -p $phaseProjectName config --quiet 2>&1)
    $exitCode = $LASTEXITCODE
    $text = $output -join "`n"
    Assert-NoSecretMarkers $text 'missing-session-secret Compose parse'
    if ($exitCode -eq 0) {
      throw 'Compose unexpectedly accepted a missing required API session secret'
    }
  }
  finally {
    $env:SESSION_SECRET = $savedSecret
  }
}

function Get-ServiceContainerId {
  param([string]$Service)

  $ids = @(& docker compose -f docker-compose.yml -p $phaseProjectName ps -aq $Service)
  $ids = @($ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) {
    throw "Expected exactly one Compose container for $Service"
  }
  return ([string]$ids[0]).Trim()
}

function Assert-NoPublishedPort {
  param([string]$Service)

  $containerId = Get-ServiceContainerId $Service
  $published = @(& docker port $containerId 2>$null)
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect published ports for $Service"
  }
  if (@($published | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count -ne 0) {
    throw "$Service unexpectedly publishes a host port"
  }
}

function Assert-WebLoopbackPort {
  $containerId = Get-ServiceContainerId web
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

function Get-ContainerNetworks {
  param([string]$ContainerId)

  $json = & docker inspect $ContainerId --format '{{json .NetworkSettings.Networks}}'
  if ($LASTEXITCODE -ne 0) { throw 'Could not inspect container networks' }
  return @(($json | ConvertFrom-Json).PSObject.Properties.Name)
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

function Assert-NetworkTopology {
  $frontend = "${phaseProjectName}_frontend"
  $database = "${phaseProjectName}_database"
  $egress = "${phaseProjectName}_egress"
  Assert-ExactStringSet (Get-ContainerNetworks (Get-ServiceContainerId web)) @($frontend) 'Web networks'
  Assert-ExactStringSet (Get-ContainerNetworks (Get-ServiceContainerId api)) @($frontend, $database) 'API networks'
  Assert-ExactStringSet (Get-ContainerNetworks (Get-ServiceContainerId postgres)) @($database) 'PostgreSQL networks'
  Assert-ExactStringSet (Get-ContainerNetworks (Get-ServiceContainerId worker)) @($database, $egress) 'Worker networks'
  Assert-ExactStringSet (Get-ContainerNetworks (Get-ServiceContainerId db-migrate)) @($database) 'Migration networks'

  if ((& docker network inspect $frontend --format '{{.Internal}}').Trim() -ne 'false') {
    throw 'Frontend network must permit only the explicit Web loopback publication'
  }
  if ((& docker network inspect $database --format '{{.Internal}}').Trim() -ne 'true') {
    throw 'Database network must remain internal'
  }
  if ((& docker network inspect $egress --format '{{.Internal}}').Trim() -ne 'false') {
    throw 'Worker egress network must permit outbound provider traffic'
  }
}

function Assert-ContainerEnvironmentBoundaries {
  $productionServices = @('postgres', 'worker', 'api', 'web')
  foreach ($service in $productionServices) {
    $environment = @(& docker inspect (Get-ServiceContainerId $service) --format '{{range .Config.Env}}{{println .}}{{end}}')
    $environmentText = $environment -join "`n"
    foreach ($bootstrapSecret in @(
      $phaseAdminPassword,
      $matrixViewerPassword,
      $matrixViewerResetPassword,
      $logoutViewerPassword,
      $changeViewerPassword,
      $changeViewerNewPassword,
      $browserViewerPassword
    )) {
      if ($environmentText.Contains($bootstrapSecret)) {
        throw "$service received a bootstrap or E2E password"
      }
    }
  }

  $apiEnvironment = @(& docker inspect (Get-ServiceContainerId api) --format '{{range .Config.Env}}{{println .}}{{end}}')
  $apiEnvironmentText = $apiEnvironment -join "`n"
  foreach ($required in @(
    "DEPLOYMENT_MODE=LOCAL",
    "APP_PUBLIC_URL=$phaseBaseUrl",
    "APP_ALLOWED_ORIGINS=$phaseBaseUrl,http://web:3000",
    "SESSION_SECRET=$phaseSessionSecret",
    'SESSION_IDLE_MINUTES=120',
    'SESSION_ABSOLUTE_HOURS=24',
    'LOGIN_MAX_ATTEMPTS=5',
    'LOGIN_LOCK_MINUTES=15',
    'TRUST_PROXY=false',
    'WORKER_HEARTBEAT_STALE_SECONDS=6'
  )) {
    if ($apiEnvironment -notcontains $required) {
      throw 'API container is missing an exact required Phase 1 environment value'
    }
  }
}

function Assert-ProcessHealth {
  foreach ($service in @('postgres', 'worker', 'api', 'web')) {
    $status = (& docker inspect (Get-ServiceContainerId $service) --format '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}').Trim()
    if ($LASTEXITCODE -ne 0 -or $status -ne 'running|healthy') {
      throw "$service is not running and healthy"
    }
  }

  $migrationStatus = (& docker inspect (Get-ServiceContainerId db-migrate) --format '{{.State.Status}}|{{.State.ExitCode}}').Trim()
  if ($LASTEXITCODE -ne 0 -or $migrationStatus -ne 'exited|0') {
    throw 'db-migrate did not complete successfully'
  }
}

function Wait-HttpStatus {
  param(
    [string]$Url,
    [int[]]$ExpectedStatuses,
    [int]$TimeoutSeconds = 45,
    [Microsoft.PowerShell.Commands.WebRequestSession]$WebSession
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $lastStatus = $null
  do {
    try {
      $parameters = @{
        Uri = $Url
        SkipHttpErrorCheck = $true
        TimeoutSec = 3
      }
      if ($null -ne $WebSession) { $parameters.WebSession = $WebSession }
      $response = Invoke-WebRequest @parameters
      $lastStatus = [int]$response.StatusCode
      if ($ExpectedStatuses -contains $lastStatus) { return $response }
    }
    catch {
      $lastStatus = $null
    }
    Start-Sleep -Seconds 1
  } while ([DateTime]::UtcNow -lt $deadline)

  throw "Timed out waiting for an expected bounded HTTP state; last status was $lastStatus"
}

function New-AdminWebSession {
  $session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $response = Invoke-WebRequest `
    -Uri "$phaseBaseUrl/api/v1/auth/login" `
    -Method Post `
    -WebSession $session `
    -Headers @{ Origin = $phaseBaseUrl; 'X-CSRF-Protection' = '1' } `
    -ContentType 'application/json' `
    -Body (@{ email = $phaseAdminEmail; password = $phaseAdminPassword } | ConvertTo-Json -Compress) `
    -SkipHttpErrorCheck `
    -TimeoutSec 10
  if ([int]$response.StatusCode -ne 200) {
    throw 'ADMIN login failed in the host-side lifecycle probe'
  }
  Assert-NoSecretMarkers ([string]$response.Content) 'ADMIN login response'
  return $session
}

function Assert-HealthResponse {
  param(
    [Microsoft.PowerShell.Commands.WebRequestSession]$Session,
    [string]$Path,
    [int]$ExpectedHttpStatus,
    [string]$ExpectedService,
    [string]$ExpectedStatus,
    [string[]]$ExpectedCheckKeys,
    [string]$ExpectedCheckCode = ''
  )

  $response = Wait-HttpStatus "$phaseBaseUrl$Path" @($ExpectedHttpStatus) 45 $Session
  Assert-NoSecretMarkers ([string]$response.Content) 'authenticated health response'
  $body = $response.Content | ConvertFrom-Json
  if ([string]$body.service -ne $ExpectedService -or [string]$body.status -ne $ExpectedStatus) {
    throw 'Authenticated health response service/status did not match'
  }
  $actualKeys = @($body.checks.PSObject.Properties.Name)
  Assert-ExactStringSet $actualKeys $ExpectedCheckKeys "Health checks for $Path"
  if ($ExpectedCheckCode) {
    $check = $body.checks.PSObject.Properties.Value | Where-Object { $_.code -eq $ExpectedCheckCode }
    if (@($check).Count -ne 1) { throw "Health response did not include $ExpectedCheckCode" }
  }
}

function Invoke-PsqlScalar {
  param([string]$Sql)

  $output = @(
    $Sql |
      & docker compose -f docker-compose.yml -p $phaseProjectName exec -T postgres `
        psql -X -v ON_ERROR_STOP=1 -U $env:POSTGRES_USER -d $env:POSTGRES_DB -tA 2>&1
  )
  if ($LASTEXITCODE -ne 0) {
    throw 'A PostgreSQL assertion query failed; output was omitted'
  }
  $text = ($output -join "`n").Trim()
  Assert-NoSecretMarkers $text 'database assertion output'
  return $text
}

function Invoke-OneShotService {
  param(
    [ValidateSet('db-seed', 'e2e')][string]$Service,
    [string]$ContainerName,
    [string]$ExpectedSeedStatus = ''
  )

  $profile = if ($Service -eq 'db-seed') { 'seed' } else { 'e2e' }
  $containerIdOutput = @(
    & docker compose -f docker-compose.yml -p $phaseProjectName --profile $profile run `
      --name $ContainerName --detach $Service 2>&1
  )
  if ($LASTEXITCODE -ne 0) {
    throw "$Service could not be started; output was omitted"
  }
  $containerId = ([string]$containerIdOutput[-1]).Trim()
  if ($containerId -notmatch '^[a-f0-9]{12,64}$') {
    throw "$Service did not return a safe container ID"
  }

  $exitOutput = @(& docker wait $containerId 2>&1)
  if ($LASTEXITCODE -ne 0 -or $exitOutput.Count -ne 1) {
    throw "$Service did not produce a bounded exit result"
  }
  $exitCode = [int]([string]$exitOutput[0]).Trim()
  $logOutput = @(& docker logs $containerId 2>&1)
  if ($LASTEXITCODE -ne 0) { throw "$Service logs could not be captured safely" }
  $logText = $logOutput -join "`n"
  Assert-NoSecretMarkers $logText "$Service logs"
  if ($exitCode -ne 0) {
    if (-not [string]::IsNullOrWhiteSpace($logText)) {
      Write-Output (ConvertTo-RedactedText $logText)
    }
    throw "$Service exited unsuccessfully"
  }

  if ($ExpectedSeedStatus) {
    $statusLines = @($logOutput | Where-Object { ([string]$_).Trim() -in @('CREATED', 'UNCHANGED') })
    if ($statusLines.Count -ne 1 -or ([string]$statusLines[0]).Trim() -ne $ExpectedSeedStatus) {
      throw "db-seed did not emit exactly the expected non-sensitive $ExpectedSeedStatus status"
    }
  }

  return $containerId
}

function Assert-ArtifactsContainNoSecrets {
  param([string]$ContainerId)

  [void](New-Item -ItemType Directory -Path $artifactDirectory -Force)
  & docker cp "${ContainerId}:/tmp/yhm-playwright-output/." $artifactDirectory 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not inspect the isolated Playwright artifact surface'
  }
  foreach ($file in @(Get-ChildItem -LiteralPath $artifactDirectory -Recurse -File)) {
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    Assert-NoSecretMarkers $text 'Playwright artifact'
  }
}

function Get-ProjectResourceIds {
  param([ValidateSet('container', 'network', 'volume')][string]$ResourceType)

  $ids = if ($ResourceType -eq 'container') {
    @(& docker container ls -aq --no-trunc --filter "label=com.docker.compose.project=$phaseProjectName")
  }
  else {
    @(& docker $ResourceType ls -q --filter "label=com.docker.compose.project=$phaseProjectName")
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not enumerate project $ResourceType resources" }
  return @($ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-ExactNamedProjectResourceIds {
  param([ValidateSet('container', 'network', 'volume')][string]$ResourceType)

  $escapedProject = [Regex]::Escape($phaseProjectName)
  $servicePattern = ($phaseServiceNames | ForEach-Object { [Regex]::Escape($_) }) -join '|'
  $networkPattern = ($phaseNetworkNames | ForEach-Object { [Regex]::Escape($_) }) -join '|'
  $namePattern = switch ($ResourceType) {
    'container' { "^$escapedProject[-_](?:$servicePattern)[-_](?:[0-9]+|run[-_][a-z0-9-]+)$" }
    'network' { "^$escapedProject[-_](?:$networkPattern)$" }
    'volume' { "^$escapedProject[-_]postgres_data$" }
  }
  $records = if ($ResourceType -eq 'container') {
    @(& docker container ls -a --no-trunc --format '{{.ID}}|{{.Names}}')
  }
  elseif ($ResourceType -eq 'volume') {
    @(& docker volume ls --format '{{.Name}}|{{.Name}}')
  }
  else {
    @(& docker network ls --format '{{.ID}}|{{.Name}}')
  }
  if ($LASTEXITCODE -ne 0) { throw "Could not enumerate exact-name $ResourceType resources" }
  $ids = foreach ($record in $records) {
    $parts = $record -split '\|', 2
    if ($parts.Count -eq 2 -and $parts[1] -match $namePattern) { $parts[0] }
  }
  return @($ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Get-ExactNamedProjectImageIds {
  $escapedProject = [Regex]::Escape($phaseProjectName)
  $servicePattern = ($phaseServiceNames | ForEach-Object { [Regex]::Escape($_) }) -join '|'
  $records = @(& docker image ls --format '{{.ID}}|{{.Repository}}')
  if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate exact-name Phase 1 images' }
  $ids = foreach ($record in $records) {
    $parts = $record -split '\|', 2
    if ($parts.Count -eq 2 -and $parts[1] -match "^$escapedProject[-_](?:$servicePattern)$") {
      $parts[0]
    }
  }
  return @($ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Assert-ResourceIdentity {
  param(
    [ValidateSet('container', 'network', 'volume')][string]$ResourceType,
    [string]$ResourceId
  )

  $json = & docker $ResourceType inspect $ResourceId
  if ($LASTEXITCODE -ne 0) { throw "Refusing cleanup: cannot inspect $ResourceType identity" }
  $resource = @($json | ConvertFrom-Json)[0]
  $labels = if ($ResourceType -eq 'container') { $resource.Config.Labels } else { $resource.Labels }
  if ($labels.'com.docker.compose.project' -ne $phaseProjectName) {
    throw "Refusing cleanup: $ResourceType has a different Compose project label"
  }
  $escapedProject = [Regex]::Escape($phaseProjectName)
  switch ($ResourceType) {
    'container' {
      $service = [string]$labels.'com.docker.compose.service'
      $name = ([string]$resource.Name).TrimStart('/')
      if (
        $phaseServiceNames -notcontains $service -or
        $name -notmatch "^$escapedProject[-_]$([Regex]::Escape($service))[-_](?:[0-9]+|run[-_][a-z0-9-]+)$"
      ) {
        throw 'Refusing cleanup: container service/name identity is unexpected'
      }
    }
    'network' {
      $network = [string]$labels.'com.docker.compose.network'
      if (
        $phaseNetworkNames -notcontains $network -or
        [string]$resource.Name -notmatch "^$escapedProject[-_]$([Regex]::Escape($network))$"
      ) {
        throw 'Refusing cleanup: network identity is unexpected'
      }
    }
    'volume' {
      if (
        [string]$labels.'com.docker.compose.volume' -ne 'postgres_data' -or
        [string]$resource.Name -notmatch "^$escapedProject[-_]postgres_data$"
      ) {
        throw 'Refusing cleanup: volume identity is unexpected'
      }
    }
  }
}

function Assert-ComposeResourcesOwned {
  foreach ($type in @('container', 'network', 'volume')) {
    $ids = @(@(Get-ProjectResourceIds $type) + @(Get-ExactNamedProjectResourceIds $type) | Sort-Object -Unique)
    foreach ($id in $ids) { Assert-ResourceIdentity $type $id }
  }
}

function Assert-NoComposeResourcesRemain {
  foreach ($type in @('container', 'network', 'volume')) {
    if (
      @(Get-ProjectResourceIds $type).Count -ne 0 -or
      @(Get-ExactNamedProjectResourceIds $type).Count -ne 0
    ) {
      throw "Cleanup left Phase 1 $type resources behind"
    }
  }
  if (@(Get-ExactNamedProjectImageIds).Count -ne 0) {
    throw 'Cleanup left Phase 1 images behind'
  }
}

function Get-SafeComposeLogs {
  $output = @(& docker compose -f docker-compose.yml -p $phaseProjectName logs --no-color --tail 300 2>&1)
  if ($LASTEXITCODE -ne 0) { throw 'Could not capture Compose logs for safe inspection' }
  $text = $output -join "`n"
  Assert-NoSecretMarkers $text 'Compose log'
  return (ConvertTo-RedactedText $text)
}

function Restore-PhaseEnvironment {
  foreach ($name in $phaseEnvironmentNames) {
    $value = $previousEnvironment[$name]
    if ($null -eq $value) {
      Remove-Item "Env:$name" -ErrorAction SilentlyContinue
    }
    else {
      Set-Item "Env:$name" $value
    }
  }
}

function Remove-SafeArtifactDirectory {
  if (-not (Test-Path -LiteralPath $artifactDirectory)) { return }
  $resolved = (Resolve-Path -LiteralPath $artifactDirectory).Path
  $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (
    -not $resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -or
    [IO.Path]::GetFileName($resolved) -notmatch '^ytmonitor-phase1-artifacts-[0-9]+-[a-f0-9]{8}$'
  ) {
    throw 'Refusing to remove an unexpected artifact directory'
  }
  Remove-Item -LiteralPath $resolved -Recurse -Force
}

try {
  Assert-ComposeProfileCredentialsAreOptionalAtParseTime
  Assert-ComposeRequiresSessionSecret

  $declaredServices = @(
    & docker compose -f docker-compose.yml -p $phaseProjectName --profile seed --profile e2e config --services
  )
  if ($LASTEXITCODE -ne 0) { throw 'Could not enumerate the Phase 1 Compose service topology' }
  Assert-ExactStringSet $declaredServices $phaseServiceNames 'Compose services'

  $composeInvoked = $true
  Invoke-PhaseCompose up --detach --wait --wait-timeout 120 postgres
  foreach ($service in @('db-migrate', 'db-seed', 'worker', 'api', 'web', 'e2e')) {
    Invoke-PhaseBuild $service
  }

  Invoke-CapturedCompose @('run', '--rm', 'db-migrate') 'clean migration deploy'
  Invoke-CapturedCompose @('run', '--rm', 'db-migrate') 'repeat migration deploy'
  $stackDatabaseUrl = $env:DATABASE_URL
  try {
    $env:DATABASE_URL = $integrationDatabaseUrl
    Invoke-CapturedCompose @('run', '--rm', '-e', 'DATABASE_URL', 'db-migrate') 'integration schema migration'
    Invoke-CapturedCompose @(
      'run', '--rm', '-e', 'DATABASE_URL', 'db-migrate',
      'pnpm', 'test:db:integration'
    ) 'raw database integration' -PrintSafeOutput
  }
  finally {
    $env:DATABASE_URL = $stackDatabaseUrl
  }

  $seedCreatedId = Invoke-OneShotService db-seed "${phaseProjectName}-db-seed-run-created" CREATED
  $seedUnchangedId = Invoke-OneShotService db-seed "${phaseProjectName}-db-seed-run-unchanged" UNCHANGED
  Assert-ExactStringSet (Get-ContainerNetworks $seedCreatedId) @("${phaseProjectName}_database") 'db-seed networks'
  Assert-ExactStringSet (Get-ContainerNetworks $seedUnchangedId) @("${phaseProjectName}_database") 'repeat db-seed networks'

  $identityAggregate = Invoke-PsqlScalar @'
SELECT json_build_object(
  'totalUsers', COUNT(*),
  'totalAdmins', COUNT(*) FILTER (WHERE role = 'ADMIN'),
  'enabledAdmins', COUNT(*) FILTER (WHERE role = 'ADMIN' AND is_enabled)
) FROM users;
'@
  $identity = $identityAggregate | ConvertFrom-Json
  $identityKeys = @($identity.PSObject.Properties.Name)
  Assert-ExactStringSet $identityKeys @('totalUsers', 'totalAdmins', 'enabledAdmins') 'Identity aggregate keys'
  if ([int]$identity.totalUsers -ne 1 -or [int]$identity.totalAdmins -ne 1 -or [int]$identity.enabledAdmins -ne 1) {
    throw 'Seed did not converge to exactly one enabled ADMIN'
  }

  Invoke-PhaseCompose up --detach --wait --wait-timeout 180 worker api web
  [void](Wait-HttpStatus "$phaseBaseUrl/login" @(200) 45)
  [void](Wait-HttpStatus "$phaseBaseUrl/health" @(404) 45)
  Assert-NoPublishedPort postgres
  Assert-NoPublishedPort worker
  Assert-NoPublishedPort api
  Assert-WebLoopbackPort
  Assert-NetworkTopology
  Assert-ContainerEnvironmentBoundaries
  Assert-ProcessHealth

  $adminSession = New-AdminWebSession
  Assert-HealthResponse $adminSession '/api/v1/health' 200 api ok @('database', 'worker', 'collectors', 'ai')
  Assert-HealthResponse $adminSession '/api/v1/health/db' 200 database ok @('database')
  Assert-HealthResponse $adminSession '/api/v1/health/worker' 200 worker ok @('worker')

  $heartbeatCount = Invoke-PsqlScalar "SELECT COUNT(*) FROM worker_heartbeats WHERE worker_id = 'worker-primary';"
  if ($heartbeatCount -ne '1') { throw 'Worker heartbeat upsert was not idempotent' }

  Invoke-PhaseCompose stop worker
  Assert-HealthResponse $adminSession '/api/v1/health/worker' 503 worker unavailable @('worker') WORKER_HEARTBEAT_STALE
  Assert-HealthResponse $adminSession '/api/v1/health' 503 api unavailable @('database', 'worker', 'collectors', 'ai') WORKER_HEARTBEAT_STALE
  [void](Wait-HttpStatus "$phaseBaseUrl/api/v1/auth/me" @(200) 15 $adminSession)

  Invoke-PhaseCompose stop web api
  Invoke-PhaseCompose up --detach --wait --wait-timeout 120 api web
  $workerRunning = (& docker inspect (Get-ServiceContainerId worker) --format '{{.State.Running}}').Trim()
  if ($workerRunning -ne 'false') { throw 'Worker restarted during the API/Web cold-start assertion' }
  Assert-HealthResponse $adminSession '/api/v1/health/worker' 503 worker unavailable @('worker') WORKER_HEARTBEAT_STALE
  [void](Wait-HttpStatus "$phaseBaseUrl/api/v1/auth/me" @(200) 15 $adminSession)

  Invoke-PhaseCompose up --detach --wait --wait-timeout 120 worker
  Assert-HealthResponse $adminSession '/api/v1/health/worker' 200 worker ok @('worker')
  Assert-HealthResponse $adminSession '/api/v1/health' 200 api ok @('database', 'worker', 'collectors', 'ai')

  Invoke-PhaseCompose stop postgres
  $databaseFailure = Wait-HttpStatus "$phaseBaseUrl/api/v1/auth/me" @(500, 502, 503, 504) 30 $adminSession
  Assert-NoSecretMarkers ([string]$databaseFailure.Content) 'database outage response'
  Invoke-PhaseCompose up --detach --wait --wait-timeout 120 postgres
  [void](Wait-HttpStatus "$phaseBaseUrl/api/v1/auth/me" @(200) 45 $adminSession)
  Assert-HealthResponse $adminSession '/api/v1/health/db' 200 database ok @('database')

  $e2eContainerId = Invoke-OneShotService e2e "${phaseProjectName}-e2e-run-1"
  Assert-ExactStringSet (Get-ContainerNetworks $e2eContainerId) @("${phaseProjectName}_frontend") 'E2E networks'
  Assert-ArtifactsContainNoSecrets $e2eContainerId

  $protectedAdminAuditCount = Invoke-PsqlScalar @'
SELECT COUNT(*)
FROM audit_logs
WHERE action = 'AUTHORIZATION_DENIED'
  AND outcome = 'FAILURE'
  AND metadata->>'reason' = 'ADMIN_TARGET_PROTECTED'
  AND metadata->>'operation' IN (
    'UPDATE_EMAIL', 'RESET_PASSWORD', 'REVOKE_SESSIONS', 'DISABLE', 'ENABLE', 'DELETE_ALIAS'
  );
'@
  if ([int]$protectedAdminAuditCount -lt 6) {
    throw 'The six protected ADMIN target denials were not durably audited'
  }

  $databaseSurface = Invoke-PsqlScalar @'
SELECT COALESCE(string_agg(value, E'\n'), '')
FROM (
  SELECT password_hash AS value FROM users
  UNION ALL SELECT encode(token_hash, 'hex') FROM sessions
  UNION ALL SELECT COALESCE(metadata::text, '') FROM audit_logs
  UNION ALL SELECT encode(key_hash, 'hex') FROM login_throttles
) AS identity_surface;
'@
  Assert-NoSecretMarkers $databaseSurface 'identity database'

  $safeFailureLogs = Get-SafeComposeLogs
  Write-Output "Phase 1 verified post-DONE renderer terminations: $($forcedBuildServices.Count)"
  Write-Output 'Phase 1 Docker/API/browser integration acceptance passed.'
}
catch {
  $phaseFailure = $_
  if ($composeInvoked) {
    try {
      $safeFailureLogs = Get-SafeComposeLogs
    }
    catch {
      $safeFailureLogs = 'Compose logs were withheld because their safe scan failed.'
    }
  }
}
finally {
  $cleanupErrors = @()
  try {
    Remove-SafeArtifactDirectory
  }
  catch {
    $cleanupErrors += 'validated Playwright artifact cleanup failed'
  }

  if ($composeInvoked -and $phaseProjectName -match '^ytmonitor-phase1-[0-9]+-[a-f0-9]{8}$') {
    $resourcesOwned = $false
    try {
      Assert-ComposeResourcesOwned
      $resourcesOwned = $true
    }
    catch {
      $cleanupErrors += 'Compose resource ownership validation failed'
    }

    if ($resourcesOwned) {
      try {
      & docker compose -f docker-compose.yml -p $phaseProjectName --profile seed --profile e2e down `
        --volumes --remove-orphans --rmi local
        if ($LASTEXITCODE -ne 0) { throw 'Phase 1 Docker cleanup command failed' }
      }
      catch {
        $cleanupErrors += 'Compose teardown failed'
      }

      try {
      Assert-NoComposeResourcesRemain
      }
      catch {
        $cleanupErrors += 'Compose teardown left isolated resources behind'
      }
    }
  }

  if ($cleanupErrors.Count -ne 0) {
    $cleanupFailure = New-Object InvalidOperationException ($cleanupErrors -join '; ')
  }

  Restore-PhaseEnvironment
}

if ($phaseFailure) {
  if (-not [string]::IsNullOrWhiteSpace($safeFailureLogs)) {
    Write-Output $safeFailureLogs
  }
  if ($cleanupFailure) {
    throw "Phase 1 integration failed: $($phaseFailure.Exception.Message). Cleanup also failed: $($cleanupFailure.Exception.Message)"
  }
  throw $phaseFailure
}
if ($cleanupFailure) { throw $cleanupFailure }
