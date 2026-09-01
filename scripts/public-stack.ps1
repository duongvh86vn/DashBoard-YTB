param(
  [ValidateSet('Start', 'Update')]
  [string]$Mode = 'Start',
  [switch]$NoOpen,
  [ValidateRange(1, 80)]
  [int]$ImagePullAttempts = 40,
  [ValidateRange(1, 60)]
  [int]$ImagePullDelaySeconds = 15,
  [switch]$AfterGitUpdate,
  [string]$ExpectedRevision = ''
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

function Invoke-NativeCapture {
  param([scriptblock]$Command)

  $previousErrorActionPreference = $ErrorActionPreference
  $nativeOutput = @()
  $nativeExitCode = $null
  try {
    # Windows PowerShell 5.1 turns ordinary native stderr into ErrorRecord values.
    $ErrorActionPreference = 'Continue'
    $nativeOutput = @(
      & $Command 2>&1 |
        ForEach-Object { [string]$_ }
    )
    $nativeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  if ($null -eq $nativeExitCode) {
    throw 'The native command did not return a valid exit code.'
  }

  return [pscustomobject]@{
    ExitCode = [int]$nativeExitCode
    Output = [string[]]$nativeOutput
  }
}

function Write-SafeOutput {
  param(
    [string[]]$Lines,
    [string[]]$SecretMarkers,
    [ValidateRange(1, 200)]
    [int]$Tail = 40
  )

  foreach ($line in @($Lines | Select-Object -Last $Tail)) {
    $safeLine = [string]$line
    foreach ($marker in $SecretMarkers) {
      if (-not [string]::IsNullOrEmpty($marker)) {
        $safeLine = $safeLine.Replace($marker, '[REDACTED]')
      }
    }
    Write-Output $safeLine
  }
}

function Read-PublicEnvironmentFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw '.env.public was not found. This script never creates or overwrites PUBLIC configuration.'
  }
  if ((Get-Item -LiteralPath $Path).Length -eq 0) {
    throw '.env.public is empty. This script never generates or overwrites secrets.'
  }

  $values = @{}
  foreach ($rawLine in [IO.File]::ReadAllLines($Path)) {
    $line = $rawLine.Trim()
    if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) { continue }

    $separator = $line.IndexOf('=')
    if ($separator -le 0) {
      throw '.env.public contains a line that is not in NAME=value format.'
    }

    $name = $line.Substring(0, $separator).Trim()
    $value = $line.Substring($separator + 1).Trim()
    if ($name -notmatch '^[A-Z][A-Z0-9_]*$' -or $values.ContainsKey($name)) {
      throw '.env.public contains a duplicate or invalid variable name.'
    }
    $isSingleQuoted = (
      $value.Length -ge 2 -and
      $value.StartsWith("'") -and
      $value.EndsWith("'")
    )
    if (-not $isSingleQuoted -and $value.Contains('$')) {
      throw '.env.public contains an interpolated value. Use a literal value or single quotes around a value containing $.'
    }
    if (
      $value.Length -ge 2 -and
      (($value.StartsWith('"') -and $value.EndsWith('"')) -or
        ($value.StartsWith("'") -and $value.EndsWith("'")))
    ) {
      $value = $value.Substring(1, $value.Length - 2)
    }

    if (
      $name -match '^COMPOSE_' -or
      $name -in @('DASHBOARD_IMAGE_TAG', 'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD')
    ) {
      throw '.env.public contains a forbidden deployment-control variable.'
    }
    $values[$name] = $value
  }

  return $values
}

function Get-RequiredEnvironmentValue {
  param(
    [hashtable]$Values,
    [string]$Name
  )

  if (-not $Values.ContainsKey($Name) -or [string]::IsNullOrWhiteSpace([string]$Values[$Name])) {
    throw ".env.public is missing required variable: $Name."
  }
  return [string]$Values[$Name]
}

function Assert-PublicEnvironment {
  param([hashtable]$Values)

  if ((Get-RequiredEnvironmentValue $Values 'NODE_ENV') -cne 'production') {
    throw 'NODE_ENV in .env.public must be production.'
  }
  if ((Get-RequiredEnvironmentValue $Values 'DEPLOYMENT_MODE') -cne 'PUBLIC') {
    throw 'DEPLOYMENT_MODE in .env.public must be PUBLIC.'
  }
  if ((Get-RequiredEnvironmentValue $Values 'TRUST_PROXY').ToLowerInvariant() -cne 'true') {
    throw 'TRUST_PROXY in .env.public must be true.'
  }

  $publicUrl = Get-RequiredEnvironmentValue $Values 'APP_PUBLIC_URL'
  $publicUri = $null
  if (-not [System.Uri]::TryCreate($publicUrl, [System.UriKind]::Absolute, [ref]$publicUri)) {
    throw 'APP_PUBLIC_URL in .env.public must be a valid HTTPS origin.'
  }
  $publicOrigin = '{0}://{1}' -f $publicUri.Scheme.ToLowerInvariant(), $publicUri.Authority.ToLowerInvariant()
  if (
    $publicUri.Scheme.ToLowerInvariant() -cne 'https' -or
    $publicUrl.ToLowerInvariant() -cne $publicOrigin -or
    $publicUri.AbsolutePath -cne '/' -or
    -not [string]::IsNullOrEmpty($publicUri.Query) -or
    -not [string]::IsNullOrEmpty($publicUri.Fragment)
  ) {
    throw 'APP_PUBLIC_URL must be an HTTPS origin without a path, query, or trailing slash.'
  }

  $allowedOrigins = @(
    (Get-RequiredEnvironmentValue $Values 'APP_ALLOWED_ORIGINS').Split(',') |
      ForEach-Object { $_.Trim().ToLowerInvariant() }
  )
  if ($allowedOrigins.Count -ne 1 -or $allowedOrigins[0] -cne $publicOrigin) {
    throw 'APP_ALLOWED_ORIGINS must contain only the exact APP_PUBLIC_URL origin.'
  }

  if ((Get-RequiredEnvironmentValue $Values 'WEB_BIND_ADDRESS') -cne '127.0.0.1') {
    throw 'WEB_BIND_ADDRESS must be 127.0.0.1 so Web is not directly exposed to the LAN.'
  }
  if ((Get-RequiredEnvironmentValue $Values 'API_INTERNAL_URL') -cne 'http://api:5000') {
    throw 'API_INTERNAL_URL must be http://api:5000 for the PUBLIC Docker stack.'
  }
  if ((Get-RequiredEnvironmentValue $Values 'CADDY_HTTP_BIND') -cne '127.0.0.1') {
    throw 'CADDY_HTTP_BIND must be 127.0.0.1 so the Tunnel uses loopback.'
  }

  $caddySiteAddress = (Get-RequiredEnvironmentValue $Values 'CADDY_SITE_ADDRESS').ToLowerInvariant()
  if ($caddySiteAddress -cne $publicUri.Host.ToLowerInvariant()) {
    throw 'CADDY_SITE_ADDRESS must match the APP_PUBLIC_URL hostname.'
  }

  $caddyPortText = Get-RequiredEnvironmentValue $Values 'CADDY_HTTP_PORT'
  $caddyPort = 0
  if (-not [int]::TryParse($caddyPortText, [ref]$caddyPort) -or $caddyPort -lt 1 -or $caddyPort -gt 65535) {
    throw 'CADDY_HTTP_PORT must be a valid TCP port.'
  }

  foreach ($requiredSecret in @(
    'POSTGRES_PASSWORD',
    'DATABASE_URL',
    'SESSION_SECRET',
    'SECRET_ENCRYPTION_KEY'
  )) {
    [void](Get-RequiredEnvironmentValue $Values $requiredSecret)
  }

  return [pscustomobject]@{
    PublicOrigin = $publicOrigin
    PublicHost = $publicUri.Host.ToLowerInvariant()
    CaddyHost = $caddySiteAddress
    CaddyPort = $caddyPort
  }
}

function Get-SecretMarkers {
  param([hashtable]$Values)

  return [string[]]@(
    foreach ($name in $Values.Keys) {
      if ($name -match '(PASSWORD|SECRET|KEY|TOKEN|DATABASE_URL)$') {
        $value = [string]$Values[$name]
        if (-not [string]::IsNullOrEmpty($value)) { $value }
      }
    }
  )
}

function Get-ComposeInterpolationNames {
  param([string]$Path)

  $composeText = [IO.File]::ReadAllText($Path)
  return [string[]]@(
    [regex]::Matches(
      $composeText,
      '(?<!\$)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))'
    ) |
      ForEach-Object {
        if ($_.Groups[1].Success) { $_.Groups[1].Value }
        else { $_.Groups[2].Value }
      } |
      Sort-Object -Unique
  )
}

function Save-AndClearProcessEnvironment {
  param([string[]]$Names)

  $previous = @{}
  foreach ($name in @($Names | Sort-Object -Unique)) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
  }
  return $previous
}

function Restore-ProcessEnvironment {
  param([AllowNull()][hashtable]$Previous)

  if ($null -eq $Previous) { return }
  foreach ($name in $Previous.Keys) {
    if ($null -eq $Previous[$name]) {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
    else {
      Set-Item -LiteralPath "Env:$name" -Value ([string]$Previous[$name])
    }
  }
}

function Get-GitRevision {
  param([string]$Reference = 'HEAD')

  $read = Invoke-NativeCapture { & git rev-parse --verify $Reference }
  if ($read.ExitCode -ne 0 -or $read.Output.Count -ne 1) {
    throw "Cannot read Git revision: $Reference."
  }
  $revision = ([string]$read.Output[0]).Trim().ToLowerInvariant()
  if ($revision -notmatch '^[0-9a-f]{40}$') {
    throw "Git revision is invalid: $Reference."
  }
  return $revision
}

function Get-CurrentGitBranch {
  $read = Invoke-NativeCapture { & git symbolic-ref --quiet --short HEAD }
  if ($read.ExitCode -ne 0 -or $read.Output.Count -ne 1) {
    throw 'The clone is in detached HEAD state; PUBLIC startup is blocked.'
  }
  return ([string]$read.Output[0]).Trim()
}

function Assert-CleanGitWorktree {
  $status = Invoke-NativeCapture { & git status --porcelain=v1 --untracked-files=all }
  if ($status.ExitCode -ne 0) {
    throw 'Cannot read Git worktree status.'
  }
  if ($status.Output.Count -ne 0) {
    Write-Output 'Changes blocking deployment:'
    Write-SafeOutput $status.Output @() 20
    throw 'The clone has uncommitted changes. This script never resets or overwrites them.'
  }
}

function Test-IsPublicEnvironmentPath {
  param([string]$Path)

  $normalizedPath = $Path.Replace('\', '/').ToLowerInvariant()
  return (
    $normalizedPath -eq '.env.public' -or
    $normalizedPath.EndsWith('/.env.public')
  )
}

function Assert-RevisionDoesNotTrackPublicEnvironment {
  param([string]$Revision)

  $tree = Invoke-NativeCapture { & git ls-tree -r --name-only $Revision }
  if ($tree.ExitCode -ne 0) {
    throw 'Cannot inspect the target commit before updating.'
  }
  foreach ($trackedPath in $tree.Output) {
    if (Test-IsPublicEnvironmentPath ([string]$trackedPath)) {
      throw 'A deployment commit tracks a .env.public file; PUBLIC startup is blocked to protect secrets.'
    }
  }
}

function Assert-UpdateDoesNotChangePublicEnvironment {
  param(
    [string]$FromRevision,
    [string]$ToRevision
  )

  $changes = Invoke-NativeCapture {
    & git diff --name-only --diff-filter=ACDMRTUXB $FromRevision $ToRevision
  }
  if ($changes.ExitCode -ne 0) {
    throw 'Cannot inspect the target update before fast-forwarding.'
  }
  foreach ($changedPath in $changes.Output) {
    if (Test-IsPublicEnvironmentPath ([string]$changedPath)) {
      throw 'The target update changes a .env.public path; fast-forward is blocked to protect local configuration.'
    }
  }
}

function Get-PublicFileHash {
  param([string]$Path)

  $stream = [IO.File]::OpenRead($Path)
  $sha256 = [Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($stream)).Replace('-', '')
  }
  finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

function Assert-EnvironmentFileHash {
  param(
    [string]$Path,
    [string]$ExpectedHash
  )

  $actualHash = Get-PublicFileHash $Path
  if ($actualHash -cne $ExpectedHash) {
    throw '.env.public changed during deployment; startup stopped to protect configuration.'
  }
}

function Assert-RequiredTools {
  param([string[]]$ComposeArguments)

  foreach ($commandName in @('git', 'docker', 'curl.exe')) {
    if (-not (Get-Command $commandName -ErrorAction SilentlyContinue)) {
      throw "Required command was not found: $commandName."
    }
  }

  $dockerVersion = Invoke-NativeCapture { & docker version }
  if ($dockerVersion.ExitCode -ne 0) {
    throw 'Docker Desktop is not running or Docker Engine is not ready.'
  }
  $composeVersion = Invoke-NativeCapture { & docker @ComposeArguments version }
  if ($composeVersion.ExitCode -ne 0) {
    throw 'Docker Compose v2 is not ready.'
  }
}

function Wait-PublicImages {
  param(
    [string]$Revision,
    [int]$Attempts,
    [int]$DelaySeconds,
    [string[]]$SecretMarkers
  )

  $imageTag = "sha-$Revision"
  $images = @(
    'ghcr.io/duongvh86vn/dashboard-ytb-api',
    'ghcr.io/duongvh86vn/dashboard-ytb-web',
    'ghcr.io/duongvh86vn/dashboard-ytb-worker',
    'ghcr.io/duongvh86vn/dashboard-ytb-db-migrate',
    'ghcr.io/duongvh86vn/dashboard-ytb-db-seed'
  )

  $lastFailure = @()
  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    Write-Output "Checking image set $imageTag (attempt $attempt/$Attempts)..."
    $allReady = $true
    foreach ($image in $images) {
      $qualifiedImage = "${image}:$imageTag"
      $pull = Invoke-NativeCapture { & docker pull $qualifiedImage }
      if ($pull.ExitCode -ne 0) {
        $allReady = $false
        $lastFailure = $pull.Output
        $joinedFailure = ($pull.Output -join "`n")
        if ($joinedFailure -match '(?i)(unauthorized|authentication required|access.*denied)') {
          Write-SafeOutput $pull.Output $SecretMarkers 20
          throw 'GitHub Container Registry denied access to the image set.'
        }
        break
      }

      # Windows PowerShell 5 strips nested quotes from native Go-template
      # arguments. Read the labels as JSON so Docker receives no nested quotes.
      $labelJson = Invoke-NativeCapture {
        & docker image inspect --format '{{json .Config.Labels}}' $qualifiedImage
      }
      if ($labelJson.ExitCode -ne 0 -or $labelJson.Output.Count -ne 1) {
        throw "Cannot read OCI labels from image $qualifiedImage."
      }

      $actualRevision = ''
      try {
        $labels = ([string]$labelJson.Output[0]) | ConvertFrom-Json
        if ($null -ne $labels) {
          $revisionProperty = $labels.PSObject.Properties['org.opencontainers.image.revision']
          if ($null -ne $revisionProperty) {
            $actualRevision = ([string]$revisionProperty.Value).Trim().ToLowerInvariant()
          }
        }
      }
      catch {
        throw "Image $qualifiedImage returned invalid OCI label JSON."
      }
      if ($actualRevision -cne $Revision) {
        throw "Image $qualifiedImage does not carry the expected revision label."
      }
    }

    if ($allReady) {
      Write-Output 'The complete immutable image set is ready.'
      return
    }
    if ($attempt -lt $Attempts) {
      Write-Output "Images are not complete yet; the current website stays unchanged. Retrying in $DelaySeconds seconds."
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  Write-SafeOutput $lastFailure $SecretMarkers 20
  throw 'The image set is still incomplete after the retry window. Existing containers were not replaced.'
}

function Invoke-ComposeDiagnostics {
  param(
    [string[]]$ComposeArguments,
    [string[]]$SecretMarkers
  )

  $ps = Invoke-NativeCapture { & docker @ComposeArguments ps --all }
  if ($ps.Output.Count -gt 0) {
    Write-Output 'Current Docker status:'
    Write-SafeOutput $ps.Output $SecretMarkers 40
  }

  $logs = Invoke-NativeCapture {
    & docker @ComposeArguments logs --no-color --tail 40 postgres db-migrate api worker web caddy
  }
  if ($logs.Output.Count -gt 0) {
    Write-Output 'Secret-redacted service log tail:'
    Write-SafeOutput $logs.Output $SecretMarkers 120
  }
}

function Invoke-LocalSmoke {
  param(
    [string]$CaddyHost,
    [int]$CaddyPort
  )

  $localUrl = "http://127.0.0.1:$CaddyPort/login"
  $smoke = Invoke-NativeCapture {
    & curl.exe --fail --silent --show-error --connect-timeout 5 --max-time 20 -H "Host: $CaddyHost" $localUrl -o NUL
  }
  if ($smoke.ExitCode -ne 0) {
    throw 'Local Caddy did not serve /login with the configured Host header.'
  }
  Write-Output "Local health check passed: $localUrl"
}

function Test-PublicEndpoint {
  param([string]$PublicOrigin)

  $publicLoginPageUrl = "$PublicOrigin/login"
  $loginBodyPath = Join-Path ([IO.Path]::GetTempPath()) (
    'dashboard-public-login-{0}.html' -f [Guid]::NewGuid().ToString('N')
  )
  try {
    $loginProbe = Invoke-NativeCapture {
      & curl.exe --silent --show-error --location --max-redirs 3 --connect-timeout 10 --max-time 30 --output $loginBodyPath --write-out '%{http_code}|%{url_effective}|%{content_type}' $publicLoginPageUrl
    }
    if ($loginProbe.ExitCode -ne 0 -or $loginProbe.Output.Count -ne 1) {
      throw 'Public HTTPS did not return a complete login-page response.'
    }

    $loginMetadata = ([string]$loginProbe.Output[0]).Trim().Split('|')
    if ($loginMetadata.Count -ne 3 -or $loginMetadata[0] -cne '200') {
      throw 'Public HTTPS did not return HTTP 200 for the Dashboard login page.'
    }

    $loginEffectiveUri = $null
    if (-not [System.Uri]::TryCreate($loginMetadata[1], [System.UriKind]::Absolute, [ref]$loginEffectiveUri)) {
      throw 'Public login returned an invalid effective URL.'
    }
    $loginEffectiveOrigin = '{0}://{1}' -f $loginEffectiveUri.Scheme.ToLowerInvariant(), $loginEffectiveUri.Authority.ToLowerInvariant()
    if (
      $loginEffectiveOrigin -cne $PublicOrigin -or
      $loginEffectiveUri.AbsolutePath -cne '/login' -or
      $loginMetadata[2].ToLowerInvariant() -notmatch '^text/html(?:;|$)'
    ) {
      throw 'Public HTTPS was redirected away from the expected Dashboard login page.'
    }

    $loginBody = [IO.File]::ReadAllText($loginBodyPath)
    if (
      $loginBody -notmatch '<!DOCTYPE html>' -or
      $loginBody -notmatch '/_next/static/'
    ) {
      throw 'Public HTTPS did not return the Dashboard Web application.'
    }
  }
  finally {
    Remove-Item -LiteralPath $loginBodyPath -Force -ErrorAction SilentlyContinue
  }

  $publicLoginApiUrl = "$PublicOrigin/api/v1/auth/login"
  $apiBodyPath = Join-Path ([IO.Path]::GetTempPath()) (
    'dashboard-public-api-{0}.json' -f [Guid]::NewGuid().ToString('N')
  )
  try {
    $apiProbe = Invoke-NativeCapture {
      & curl.exe --silent --show-error --location --max-redirs 3 --connect-timeout 10 --max-time 30 --request POST --header "Origin: $PublicOrigin" --header 'Content-Type: application/json' --header 'X-CSRF-Protection: 1' --data '{}' --output $apiBodyPath --write-out '%{http_code}|%{url_effective}|%{content_type}' $publicLoginApiUrl
    }
    if ($apiProbe.ExitCode -ne 0 -or $apiProbe.Output.Count -ne 1) {
      throw 'Public HTTPS did not return a complete CSRF probe response.'
    }

    $apiMetadata = ([string]$apiProbe.Output[0]).Trim().Split('|')
    if ($apiMetadata.Count -ne 3 -or $apiMetadata[0] -cne '400') {
      throw 'Public login API did not return the expected validation status.'
    }

    $apiEffectiveUri = $null
    if (-not [System.Uri]::TryCreate($apiMetadata[1], [System.UriKind]::Absolute, [ref]$apiEffectiveUri)) {
      throw 'Public login API returned an invalid effective URL.'
    }
    $apiEffectiveOrigin = '{0}://{1}' -f $apiEffectiveUri.Scheme.ToLowerInvariant(), $apiEffectiveUri.Authority.ToLowerInvariant()
    if (
      $apiEffectiveOrigin -cne $PublicOrigin -or
      $apiEffectiveUri.AbsolutePath -cne '/api/v1/auth/login' -or
      $apiMetadata[2].ToLowerInvariant() -notmatch '^application/json(?:;|$)'
    ) {
      throw 'Public HTTPS was redirected away from the expected Dashboard login API.'
    }

    try {
      $apiBody = [IO.File]::ReadAllText($apiBodyPath) | ConvertFrom-Json
    }
    catch {
      throw 'Public login API returned a non-JSON response.'
    }
    if (
      $null -eq $apiBody.error -or
      [string]$apiBody.error.code -cne 'VALIDATION_ERROR'
    ) {
      throw 'Public login API failed its exact-origin CSRF contract.'
    }
  }
  finally {
    Remove-Item -LiteralPath $apiBodyPath -Force -ErrorAction SilentlyContinue
  }

  Write-Output "Public HTTPS login and CSRF probes passed: $PublicOrigin"
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$publicEnvPath = Join-Path $repositoryRoot '.env.public'
$composePath = Join-Path $repositoryRoot 'docker-compose.prebuilt.yml'
$supportedBranch = 'phase/0-foundation'
$remoteReference = 'refs/remotes/origin/phase/0-foundation'
$projectName = 'dashboard-ytb'
$previousLocation = Get-Location
$savedProcessEnvironment = $null
$environmentValues = $null
$secretMarkers = @()
$publicConfiguration = $null
$composeArguments = @()
$composeReady = $false
$mutex = $null
$mutexAcquired = $false
$delegatedToUpdatedScript = $false
$exitCode = 0

try {
  $mutex = New-Object -TypeName System.Threading.Mutex -ArgumentList @(
    $false,
    'Global\DashboardYtbPublicStack'
  )
  if ($AfterGitUpdate) {
    $unexpectedLockOwnership = $false
    try {
      $unexpectedLockOwnership = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
      $unexpectedLockOwnership = $true
    }
    if ($unexpectedLockOwnership) {
      $mutex.ReleaseMutex()
      throw 'AfterGitUpdate is an internal mode and requires the parent updater lock.'
    }
  }
  else {
    try {
      $mutexAcquired = $mutex.WaitOne(0)
    }
    catch [System.Threading.AbandonedMutexException] {
      $mutexAcquired = $true
    }
    if (-not $mutexAcquired) {
      throw 'Another PUBLIC start/update process is running. Wait for it to finish.'
    }
  }

  Set-Location -LiteralPath $repositoryRoot
  if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) {
    throw 'docker-compose.prebuilt.yml was not found.'
  }

  $environmentValues = Read-PublicEnvironmentFile $publicEnvPath
  $publicConfiguration = Assert-PublicEnvironment $environmentValues
  $secretMarkers = [string[]]@(Get-SecretMarkers $environmentValues)
  $publicEnvHash = Get-PublicFileHash $publicEnvPath

  $composeControlNames = @(
    'COMPOSE_FILE', 'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES',
    'COMPOSE_DISABLE_ENV_FILE', 'COMPOSE_PATH_SEPARATOR',
    'COMPOSE_CONVERT_WINDOWS_PATHS', 'COMPOSE_IGNORE_ORPHANS',
    'COMPOSE_REMOVE_ORPHANS', 'COMPOSE_PARALLEL_LIMIT', 'COMPOSE_ANSI',
    'COMPOSE_STATUS_STDOUT', 'COMPOSE_MENU', 'COMPOSE_EXPERIMENTAL',
    'DASHBOARD_IMAGE_TAG'
  )
  # Docker Compose gives the parent process priority over --env-file. Clear every
  # interpolation variable used by the PUBLIC compose file, including optional
  # values that may be omitted from .env.public, so host-global variables cannot
  # silently change a deployment.
  $composeInterpolationNames = Get-ComposeInterpolationNames $composePath
  $publicEnvironmentNames = [string[]]@(
    $environmentValues.Keys | ForEach-Object { [string]$_ }
  )
  $savedProcessEnvironment = Save-AndClearProcessEnvironment @(
    $composeControlNames + $composeInterpolationNames + $publicEnvironmentNames
  )

  $composeArguments = @(
    'compose',
    '--env-file', $publicEnvPath,
    '--project-name', $projectName,
    '-f', $composePath,
    '--profile', 'hosting'
  )
  Assert-RequiredTools $composeArguments
  if ((Get-CurrentGitBranch) -cne $supportedBranch) {
    throw "The clone must be on branch $supportedBranch before PUBLIC startup."
  }
  Assert-CleanGitWorktree

  $oldRevision = Get-GitRevision
  Assert-RevisionDoesNotTrackPublicEnvironment $oldRevision
  $targetRevision = $oldRevision
  if ($AfterGitUpdate) {
    if (
      $Mode -cne 'Update' -or
      $ExpectedRevision -notmatch '^[0-9a-f]{40}$' -or
      $oldRevision -cne $ExpectedRevision.ToLowerInvariant()
    ) {
      throw 'The internal post-update revision contract is invalid.'
    }
    $remoteRevision = Get-GitRevision $remoteReference
    if ($remoteRevision -cne $oldRevision) {
      throw 'The post-update clone no longer matches the fetched deployment revision.'
    }
    # Re-evaluate the image inventory using the newly pulled script. Cached pulls
    # are cheap, and a release can safely add or rename an image in this function.
    Wait-PublicImages $oldRevision $ImagePullAttempts $ImagePullDelaySeconds $secretMarkers
    Assert-EnvironmentFileHash $publicEnvPath $publicEnvHash
    Write-Output "Continuing deployment with the updated updater at $oldRevision."
  }
  elseif ($Mode -ceq 'Update') {
    Write-Output "Checking origin/$supportedBranch for an update..."
    $fetch = Invoke-NativeCapture { & git fetch --prune origin $supportedBranch }
    if ($fetch.ExitCode -ne 0) {
      throw 'Cannot fetch the current deployment branch from origin.'
    }

    $targetRevision = Get-GitRevision $remoteReference
    $ancestor = Invoke-NativeCapture {
      & git merge-base --is-ancestor $oldRevision $targetRevision
    }
    if ($ancestor.ExitCode -ne 0) {
      throw 'The clone diverged or has local commits; only a fast-forward update is allowed.'
    }

    if ($targetRevision -ceq $oldRevision) {
      Wait-PublicImages $targetRevision $ImagePullAttempts $ImagePullDelaySeconds $secretMarkers
      Assert-EnvironmentFileHash $publicEnvPath $publicEnvHash
      Write-Output 'The clone is already at the latest published commit; no containers will be forced to restart.'
    }
    else {
      Assert-RevisionDoesNotTrackPublicEnvironment $targetRevision
      Assert-UpdateDoesNotChangePublicEnvironment $oldRevision $targetRevision

      # Pull the complete immutable image set before changing Git or replacing containers.
      Wait-PublicImages $targetRevision $ImagePullAttempts $ImagePullDelaySeconds $secretMarkers
      Assert-EnvironmentFileHash $publicEnvPath $publicEnvHash

      $fastForward = Invoke-NativeCapture {
        & git merge --ff-only $remoteReference
      }
      if ($fastForward.ExitCode -ne 0) {
        throw 'Cannot fast-forward the clone to the published commit.'
      }
      Assert-CleanGitWorktree
      Assert-EnvironmentFileHash $publicEnvPath $publicEnvHash

      $deployedRevision = Get-GitRevision
      if ($deployedRevision -cne $targetRevision) {
        throw 'HEAD does not match origin/phase/0-foundation after the update.'
      }
      Write-Output "Git updated: $oldRevision -> $deployedRevision"

      # Relaunch from disk so a release can update its own deployment contract safely.
      $childArguments = @(
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        (Join-Path $PSScriptRoot 'public-stack.ps1'),
        '-Mode',
        'Update',
        '-AfterGitUpdate',
        '-ExpectedRevision',
        $targetRevision,
        '-ImagePullAttempts',
        [string]$ImagePullAttempts,
        '-ImagePullDelaySeconds',
        [string]$ImagePullDelaySeconds
      )
      if ($NoOpen) { $childArguments += '-NoOpen' }
      & powershell.exe @childArguments
      if ($null -eq $LASTEXITCODE) {
        throw 'The updated PUBLIC launcher did not return a valid exit code.'
      }
      $exitCode = [int]$LASTEXITCODE
      $delegatedToUpdatedScript = $true
    }
  }

  if (-not $delegatedToUpdatedScript) {
    $currentRevision = Get-GitRevision
    $env:DASHBOARD_IMAGE_TAG = "sha-$currentRevision"

    $config = Invoke-NativeCapture {
      & docker @composeArguments config --quiet
    }
    if ($config.ExitCode -ne 0) {
      Write-SafeOutput $config.Output $secretMarkers 30
      throw 'The PUBLIC Docker configuration is invalid; .env.public was not overwritten.'
    }
    $composeReady = $true
    Assert-EnvironmentFileHash $publicEnvPath $publicEnvHash

    Write-Output "Starting the PUBLIC stack with image sha-$currentRevision..."
    $upArguments = @(
      'up',
      '--detach',
      '--wait',
      '--wait-timeout',
      '240',
      '--remove-orphans'
    )
    $startup = Invoke-NativeCapture {
      & docker @composeArguments @upArguments
    }
    if ($startup.ExitCode -ne 0) {
      Write-SafeOutput $startup.Output $secretMarkers 60
      throw 'The PUBLIC stack failed Docker health checks. Named volumes were not deleted; a database migration may already have completed.'
    }

    Invoke-LocalSmoke $publicConfiguration.CaddyHost $publicConfiguration.CaddyPort
    Assert-EnvironmentFileHash $publicEnvPath $publicEnvHash

    $status = Invoke-NativeCapture { & docker @composeArguments ps --all }
    if ($status.ExitCode -eq 0 -and $status.Output.Count -gt 0) {
      Write-Output 'PUBLIC stack status:'
      Write-SafeOutput $status.Output $secretMarkers 40
    }

    $cloudflaredService = Get-Service -Name 'cloudflared' -ErrorAction SilentlyContinue
    if ($null -eq $cloudflaredService) {
      Write-Warning 'The cloudflared Windows service was not found. The local stack is healthy, but the Tunnel may be offline.'
    }
    elseif ($cloudflaredService.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
      throw 'The cloudflared Windows service is not Running. Start it to restore Internet access.'
    }

    Test-PublicEndpoint $publicConfiguration.PublicOrigin
    Write-Output "PUBLIC is ready at $($publicConfiguration.PublicOrigin)/login"
    if (-not $NoOpen) {
      Start-Process "$($publicConfiguration.PublicOrigin)/login"
    }
  }
}
catch {
  $exitCode = 1
  Write-Output ''
  Write-Output "PUBLIC ERROR: $($_.Exception.Message)"
  if ($composeReady) {
    try {
      Invoke-ComposeDiagnostics $composeArguments $secretMarkers
    }
    catch {
      Write-Output 'Could not read the secret-redacted Docker diagnostics.'
    }
  }
}
finally {
  Restore-ProcessEnvironment $savedProcessEnvironment
  if ($mutexAcquired -and $null -ne $mutex) {
    try { $mutex.ReleaseMutex() } catch { }
  }
  if ($null -ne $mutex) { $mutex.Dispose() }
  Set-Location -LiteralPath $previousLocation.Path
}

exit $exitCode
