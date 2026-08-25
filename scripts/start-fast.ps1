param(
  [switch]$NoOpen,
  [switch]$ForcePull
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-env.ps1')

function Invoke-NativeCapture {
  param([scriptblock]$Command)

  $previousNativeErrorActionPreference = $ErrorActionPreference
  $nativeOutput = @()
  $nativeExitCode = $null
  try {
    # Windows PowerShell 5.1 surfaces normal Docker stderr as ErrorRecord objects.
    $ErrorActionPreference = 'Continue'
    $nativeOutput = @(
      & $Command 2>&1 |
        ForEach-Object { [string]$_ }
    )
    $nativeExitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousNativeErrorActionPreference
  }

  if ($null -eq $nativeExitCode) {
    throw 'Lệnh native không trả về mã kết thúc hợp lệ.'
  }

  return [pscustomobject]@{
    ExitCode = [int]$nativeExitCode
    Output = [string[]]$nativeOutput
  }
}

function Get-CurrentGitRevision {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { return $null }
  $revisionRead = Invoke-NativeCapture { & git rev-parse --verify HEAD }
  if ($revisionRead.ExitCode -ne 0 -or $revisionRead.Output.Count -ne 1) {
    return $null
  }

  $revision = ([string]$revisionRead.Output[0]).Trim().ToLowerInvariant()
  if ($revision -notmatch '^[0-9a-f]{40}$') {
    return $null
  }
  return $revision
}

function Write-SafeOutput {
  param(
    [string[]]$Lines,
    [string[]]$SecretMarkers,
    [ValidateRange(1, 200)][int]$Tail = 40
  )

  foreach ($line in @($Lines | Select-Object -Last $Tail)) {
    $safeLine = [string]$line
    foreach ($marker in $SecretMarkers) {
      $safeLine = $safeLine.Replace($marker, '[REDACTED]')
    }
    Write-Output $safeLine
  }
}

function Invoke-FullSetup {
  param(
    [switch]$SkipBrowser,
    [switch]$UsePublishedImages
  )

  Write-Output 'Đang chuyển sang setup đầy đủ một lần để chuẩn bị máy này...'
  $setupArguments = @(
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    (Join-Path $PSScriptRoot 'start-local.ps1')
  )
  if ($SkipBrowser) { $setupArguments += '-NoOpen' }
  if ($UsePublishedImages) { $setupArguments += '-UsePrebuilt' }
  & powershell.exe @setupArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'Setup đầy đủ thất bại; không có dữ liệu nào bị tự động xóa.'
  }
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath = Join-Path $repositoryRoot '.env'
$prebuiltComposePath = Join-Path $repositoryRoot 'docker-compose.prebuilt.yml'
$runtimeRevisionPath = Join-Path $repositoryRoot '.local-runtime-revision'
$localProjectName = 'dashboard-ytb'
$previousLocation = Get-Location
$previousDashboardImageTag = $env:DASHBOARD_IMAGE_TAG
$previousLocalComposeEnvironment = $null
$previousComposeControlEnvironment = $null

try {
  Set-Location -LiteralPath $repositoryRoot
  $previousComposeControlEnvironment = Clear-LocalComposeControlEnvironment

  $dockerVersion = Invoke-NativeCapture { & docker version }
  if ($dockerVersion.ExitCode -ne 0) {
    throw 'Docker Desktop chưa chạy hoặc lệnh docker chưa có trong PATH.'
  }
  $composeVersion = Invoke-NativeCapture { & docker compose version }
  if ($composeVersion.ExitCode -ne 0) {
    throw 'Docker Compose v2 chưa sẵn sàng.'
  }

  $currentRevision = Get-CurrentGitRevision
  if (-not [string]::IsNullOrEmpty($currentRevision)) {
    $env:DASHBOARD_IMAGE_TAG = "sha-$currentRevision"
  }

  if (
    -not (Test-Path -LiteralPath $envPath) -or
    (Get-Item -LiteralPath $envPath).Length -eq 0
  ) {
    Write-Output 'Đây là lần chạy đầu tiên; cần tạo cấu hình và tài khoản ADMIN.'
    Invoke-FullSetup -SkipBrowser:$NoOpen -UsePublishedImages
    return
  }

  if (-not (Test-Path -LiteralPath $prebuiltComposePath)) {
    Write-Output 'Bản clone chưa có gói Docker dựng sẵn; dùng setup tương thích.'
    Invoke-FullSetup -SkipBrowser:$NoOpen
    return
  }

  $installedMode = $null
  $installedRevision = $null
  if (Test-Path -LiteralPath $runtimeRevisionPath) {
    $installedRuntime = ([IO.File]::ReadAllText($runtimeRevisionPath)).Trim().ToLowerInvariant()
    if ($installedRuntime -match '^(prebuilt|source):([0-9a-f]{40})$') {
      $installedMode = $Matches[1]
      $installedRevision = $Matches[2]
    }
    elseif ($installedRuntime -match '^[0-9a-f]{40}$') {
      $installedMode = 'prebuilt'
      $installedRevision = $installedRuntime
    }
  }

  if ([string]::IsNullOrEmpty($installedRevision)) {
    Write-Output 'Setup trước chưa hoàn tất; đang kiểm tra migration và tài khoản ADMIN một lần.'
    Invoke-FullSetup -SkipBrowser:$NoOpen -UsePublishedImages
    return
  }

  $localEnvironment = Read-ValidatedLocalEnvironment $envPath
  $previousLocalComposeEnvironment = Set-ValidatedLocalComposeEnvironment $localEnvironment
  $secretMarkers = @(
    [string]$localEnvironment.POSTGRES_PASSWORD,
    [string]$localEnvironment.SESSION_SECRET,
    [string]$localEnvironment.SECRET_ENCRYPTION_KEY,
    [string]$localEnvironment.GEMINI_API_KEY,
    [string]$localEnvironment.NVIDIA_API_KEY
  ) | Where-Object { -not [string]::IsNullOrEmpty($_) }

  $mustPull = [bool]$ForcePull
  if (-not [string]::IsNullOrEmpty($currentRevision) -and $currentRevision -ne $installedRevision) {
    $mustPull = $true
  }

  $usePrebuilt = $installedMode -ne 'source' -or $mustPull
  if ($mustPull) {
    Write-Output 'Đang tải image Docker dựng sẵn cho bản cập nhật (không build trên máy clone)...'
    $pull = Invoke-NativeCapture {
      & docker compose -p $localProjectName -f $prebuiltComposePath pull
    }
    if ($pull.ExitCode -ne 0) {
      Write-Warning 'Chưa tải được image dựng sẵn; chuyển sang build cục bộ một lần.'
      Write-SafeOutput $pull.Output $secretMarkers 20
      Invoke-FullSetup -SkipBrowser:$NoOpen
      if (-not [string]::IsNullOrEmpty($currentRevision)) {
        [IO.File]::WriteAllText($runtimeRevisionPath, "source:$currentRevision`r`n")
      }
      return
    }
    $usePrebuilt = $true
  }

  $composePath = if ($usePrebuilt) {
    $prebuiltComposePath
  }
  else {
    Join-Path $repositoryRoot 'docker-compose.yml'
  }
  $composeConfig = Invoke-NativeCapture {
    & docker compose -p $localProjectName -f $composePath config --quiet
  }
  if ($composeConfig.ExitCode -ne 0) {
    throw 'Tệp .env hoặc cấu hình Docker không hợp lệ; script không ghi đè bí mật.'
  }

  Write-Output 'Đang bật stack Docker...'
  $startup = Invoke-NativeCapture {
    & docker compose -p $localProjectName -f $composePath up --detach --wait --wait-timeout 180
  }
  if ($startup.ExitCode -ne 0) {
    Write-Output 'Chi tiết Docker an toàn:'
    Write-SafeOutput $startup.Output $secretMarkers 60

    $apiLogs = Invoke-NativeCapture {
      & docker compose -p $localProjectName -f $composePath logs --no-color --tail 40 api
    }
    if ($apiLogs.Output.Count -gt 0) {
      Write-Output 'Log API an toàn (40 dòng cuối):'
      Write-SafeOutput $apiLogs.Output $secretMarkers 40
    }
    throw 'Stack Docker không đạt health check; dữ liệu và volume được giữ nguyên.'
  }

  if (-not [string]::IsNullOrEmpty($currentRevision)) {
    $runtimeMode = if ($usePrebuilt) { 'prebuilt' } else { 'source' }
    [IO.File]::WriteAllText($runtimeRevisionPath, "${runtimeMode}:$currentRevision`r`n")
  }

  $loginUrl = 'http://127.0.0.1:3000/login'
  Write-Output "Dịch vụ sẵn sàng: $loginUrl"
  if (-not $NoOpen) { Start-Process $loginUrl }
}
finally {
  $secretMarkers = @()
  $localEnvironment = $null
  Restore-ValidatedLocalComposeEnvironment $previousLocalComposeEnvironment
  Restore-ValidatedLocalComposeEnvironment $previousComposeControlEnvironment
  if ($null -eq $previousDashboardImageTag) {
    Remove-Item Env:DASHBOARD_IMAGE_TAG -ErrorAction SilentlyContinue
  }
  else {
    $env:DASHBOARD_IMAGE_TAG = $previousDashboardImageTag
  }
  Set-Location -LiteralPath $previousLocation.Path
}
