param(
  [switch]$NoOpen,
  [switch]$UsePrebuilt
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'local-env.ps1')

function New-RandomBase64Url {
  param([ValidateRange(16, 128)][int]$ByteCount)

  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
  }
  finally {
    [Array]::Clear($bytes, 0, $bytes.Length)
    $generator.Dispose()
  }
}

function Add-MissingLocalEncryptionKey {
  param([string]$Path)

  $lines = [IO.File]::ReadAllLines($Path)
  if (@($lines | Where-Object { $_ -match '^SECRET_ENCRYPTION_KEY=' }).Count -ne 0) {
    return
  }

  $encryptionKey = New-RandomBase64Url 32
  $temporaryPath = "$Path.ai-key-$([Guid]::NewGuid().ToString('N')).tmp"
  $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
  try {
    $content = (($lines -join "`r`n").TrimEnd("`r", "`n") +
      "`r`nSECRET_ENCRYPTION_KEY=$encryptionKey`r`n")
    [IO.File]::WriteAllText($temporaryPath, $content, $utf8WithoutBom)
    Move-Item -LiteralPath $temporaryPath -Destination $Path -Force
  }
  finally {
    if (Test-Path -LiteralPath $temporaryPath) {
      Remove-Item -LiteralPath $temporaryPath -Force
    }
    $content = $null
    $encryptionKey = $null
  }
}

function Restore-ProcessEnvironment {
  param(
    [string]$Name,
    [AllowNull()][string]$Value
  )

  if ($null -eq $Value) {
    Remove-Item "Env:$Name" -ErrorAction SilentlyContinue
  }
  else {
    Set-Item "Env:$Name" $Value
  }
}

function Invoke-NativeCapture {
  param([scriptblock]$Command)

  $previousNativeErrorActionPreference = $ErrorActionPreference
  $nativeOutput = @()
  $nativeExitCode = $null
  try {
    # Windows PowerShell 5.1 represents native stderr as ErrorRecord objects.
    # Docker writes normal status/progress to stderr, so capture it without
    # weakening the script-wide terminating-error policy outside this call.
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

function Get-UnicodeCodePointCount {
  param([AllowEmptyString()][string]$Text)

  $count = 0
  for ($index = 0; $index -lt $Text.Length; $index += 1) {
    if (
      [char]::IsHighSurrogate($Text[$index]) -and
      $index + 1 -lt $Text.Length -and
      [char]::IsLowSurrogate($Text[$index + 1])
    ) {
      $index += 1
    }
    $count += 1
  }
  return $count
}

function Test-LocalAdminEmail {
  param([AllowEmptyString()][string]$Email)

  if ($Email.Length -eq 0 -or $Email.Length -gt 320) { return $false }
  for ($index = 0; $index -lt $Email.Length; $index += 1) {
    $character = $Email[$index]
    if ([char]::IsControl($character)) { return $false }
    if ([char]::IsHighSurrogate($character)) {
      if (
        $index + 1 -ge $Email.Length -or
        -not [char]::IsLowSurrogate($Email[$index + 1])
      ) {
        return $false
      }
      $index += 1
    }
    elseif ([char]::IsLowSurrogate($character)) {
      return $false
    }
  }
  return $Email -match '^[^\s@]+@[^\s@]+\.[^\s@]+$'
}

function Assert-NoLocalSecretMarkers {
  param(
    [AllowNull()][string]$Text,
    [string]$Surface
  )

  if ($null -eq $Text) { return }
  foreach ($marker in $localSecretMarkers) {
    if ($Text.Contains($marker)) {
      throw "Phát hiện dấu bí mật trong $Surface; nội dung được giữ lại và dừng an toàn."
    }
  }
}

function Get-SharedLocalFileText {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
  $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::UTF8, $true)
  try { return $reader.ReadToEnd() }
  finally {
    $reader.Dispose()
    $stream.Dispose()
  }
}

function Test-CompletedLocalImage {
  param(
    [ValidateSet('db-migrate', 'db-seed', 'worker', 'api', 'web')][string]$Service,
    [string]$BuildOutput,
    [switch]$RequireFinalExportEvidence
  )

  $imageName = "$localProjectName-$Service`:latest"
  $inspection = Invoke-NativeCapture { & docker image inspect $imageName }
  if ($inspection.ExitCode -ne 0) { return $false }
  $inspectionOutput = @($inspection.Output)
  $images = @((($inspectionOutput -join "`n") | ConvertFrom-Json))
  if ($images.Count -ne 1) { return $false }
  $image = $images[0]
  if (
    @($image.RepoTags) -notcontains $imageName -or
    [string]$image.Config.Labels.'com.docker.compose.project' -ne $localProjectName -or
    [string]$image.Config.Labels.'com.docker.compose.service' -ne $Service -or
    [string]$image.Config.Labels.'com.docker.compose.version' -notmatch '^[0-9]+\.[0-9]+\.[0-9]+'
  ) {
    return $false
  }
  $expectedCommand = switch ($Service) {
    'db-migrate' { @('node', '/app/node_modules/prisma/build/index.js', 'migrate', 'deploy') }
    'db-seed' { @('node', '--import', 'tsx', 'prisma/seed.ts') }
    'worker' { @('node', 'apps/worker/dist/main.js') }
    'api' { @('node', 'apps/api/dist/main.js') }
    'web' { @('node', 'apps/web/start-standalone.mjs') }
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

function Stop-LocalBuildProcessTree {
  param([int]$RootProcessId)

  $processes = @(Get-CimInstance Win32_Process)
  $pending = @($RootProcessId)
  $processIds = @()
  while ($pending.Count -ne 0) {
    $currentId = [int]$pending[0]
    if ($pending.Count -eq 1) { $pending = @() } else { $pending = @($pending[1..($pending.Count - 1)]) }
    if ($processIds -contains $currentId) { continue }
    $processIds += $currentId
    $pending += @($processes | Where-Object { [int]$_.ParentProcessId -eq $currentId } | ForEach-Object { [int]$_.ProcessId })
  }
  [Array]::Reverse($processIds)
  foreach ($processId in $processIds) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
  Start-Sleep -Milliseconds 250
}

function Assert-NoLocalBuildProcessRemains {
  $matching = @(
    Get-CimInstance Win32_Process |
      Where-Object {
        $_.Name -in @('docker.exe', 'docker-compose.exe', 'docker-buildx.exe') -and
        [string]$_.CommandLine -like "*$localProjectName*"
      }
  )
  if ($matching.Count -ne 0) { throw 'Tiến trình Docker build cục bộ không kết thúc an toàn.' }
}

function Remove-LocalBuildFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path)) { return }
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    try {
      Remove-Item -LiteralPath $Path -Force
      return
    }
    catch [IO.IOException] { Start-Sleep -Milliseconds 100 }
  }
  throw 'Không thể xóa tệp log build tạm đã được xác minh.'
}

function Invoke-LocalBuild {
  param([ValidateSet('db-migrate', 'db-seed', 'worker', 'api', 'web')][string]$Service)

  if ($UsePrebuilt) {
    Write-Output "Đang tải image dựng sẵn: $Service..."
    $pull = Invoke-NativeCapture {
      & docker compose -p $localProjectName --profile seed pull $Service
    }
    $pullOutput = @($pull.Output)
    Assert-NoLocalSecretMarkers ($pullOutput -join "`n") "log pull $Service"
    if ($pull.ExitCode -eq 0) {
      Write-Output "Đã tải image dựng sẵn: $Service"
      return
    }

    $safeFailureTail = @(
      $pullOutput |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Last 20
    )
    Write-Warning 'Registry chưa sẵn sàng; chuyển sang build cục bộ một lần.'
    if ($safeFailureTail.Count -ne 0) {
      Write-Output 'Chi tiết Docker pull an toàn (20 dòng cuối):'
      Write-Output ($safeFailureTail -join "`n")
    }
    $script:UsePrebuilt = $false
    $env:COMPOSE_FILE = Join-Path $repositoryRoot 'docker-compose.yml'
    $sourceConfig = Invoke-NativeCapture { & docker compose config --quiet }
    if ($sourceConfig.ExitCode -ne 0) {
      throw 'Không thể chuyển sang cấu hình build cục bộ an toàn.'
    }
  }

  $safeStem = "ytmonitor-local-build-$PID-$localBuildRunId-$Service"
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
      throw 'Từ chối đường dẫn log build cục bộ không an toàn.'
    }
  }

  [IO.File]::WriteAllText($inputPath, '')
  $process = $null
  $verifiedAfterForcedExit = $false
  try {
    Write-Output "Đang build image: $Service..."
    $dockerCommand = Get-Command docker.exe -CommandType Application -ErrorAction Stop |
      Select-Object -First 1
    $arguments = @(
      'compose', '--progress', 'plain', '-p', $localProjectName,
      '--profile', 'seed', 'build', '--provenance=false', $Service
    )
    $process = Start-Process -FilePath ([string]$dockerCommand.Source) -ArgumentList $arguments `
      -WindowStyle Hidden -PassThru `
      -RedirectStandardInput $inputPath `
      -RedirectStandardOutput $stdoutPath `
      -RedirectStandardError $stderrPath
    $deadline = [DateTime]::UtcNow.AddMinutes(15)
    while (-not $process.WaitForExit(1000)) {
      $partialOutput = "$(Get-SharedLocalFileText $stdoutPath)`n$(Get-SharedLocalFileText $stderrPath)"
      Assert-NoLocalSecretMarkers $partialOutput "log build $Service"
      if (Test-CompletedLocalImage $Service $partialOutput -RequireFinalExportEvidence) {
        if (-not $process.WaitForExit(2000)) {
          Stop-LocalBuildProcessTree $process.Id
          $process.WaitForExit()
          Assert-NoLocalBuildProcessRemains
          $verifiedAfterForcedExit = $true
        }
        break
      }
      if ([DateTime]::UtcNow -ge $deadline) { break }
    }
    if (-not $process.HasExited) {
      Stop-LocalBuildProcessTree $process.Id
      $process.WaitForExit()
      Assert-NoLocalBuildProcessRemains
      throw "Build image $Service vượt quá thời gian chờ an toàn."
    }
    $buildOutput = "$(Get-SharedLocalFileText $stdoutPath)`n$(Get-SharedLocalFileText $stderrPath)"
    Assert-NoLocalSecretMarkers $buildOutput "log build $Service"
    if (-not $verifiedAfterForcedExit -and $process.ExitCode -ne 0) {
      Write-Output 'Docker build nền không tương thích trên máy này; đang thử lại ở chế độ trực tiếp...'
      $directBuild = Invoke-NativeCapture {
        & docker compose --progress plain -p $localProjectName `
          --profile seed build --provenance=false $Service
      }
      $directBuildLines = @($directBuild.Output)
      $directBuildExitCode = $directBuild.ExitCode
      $buildOutput = $directBuildLines -join "`n"
      Assert-NoLocalSecretMarkers $buildOutput "log build trực tiếp $Service"
      if ($directBuildExitCode -ne 0) {
        $safeFailureTail = @(
          $directBuildLines |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Select-Object -Last 30
        )
        if ($safeFailureTail.Count -ne 0) {
          Write-Output 'Chi tiết Docker build an toàn (30 dòng cuối):'
          Write-Output ($safeFailureTail -join "`n")
        }
        throw "Build image $Service thất bại ở cả chế độ nền và trực tiếp."
      }
    }
    if (-not (Test-CompletedLocalImage $Service $buildOutput)) {
      throw "Image $Service không khớp project Docker cục bộ đã xác minh."
    }
    Write-Output "Đã build image cục bộ: $Service"
  }
  finally {
    $cleanupErrors = @()
    if ($null -ne $process) {
      if (-not $process.HasExited) {
        try {
          Stop-LocalBuildProcessTree $process.Id
          $process.WaitForExit()
          Assert-NoLocalBuildProcessRemains
        }
        catch { $cleanupErrors += 'process' }
      }
      $process.Dispose()
    }
    foreach ($path in @($inputPath, $stdoutPath, $stderrPath)) {
      try { Remove-LocalBuildFile $path } catch { $cleanupErrors += 'log' }
    }
    if ($cleanupErrors.Count -ne 0) {
      throw 'Không thể hoàn tất cleanup build cục bộ đã xác minh.'
    }
  }
}

function Invoke-Compose {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$ComposeArguments)

  & docker compose -p $localProjectName @ComposeArguments
  if ($LASTEXITCODE -ne 0) {
    throw 'Docker Compose failed. Command arguments were omitted to protect credentials.'
  }
}

function Get-IdentityAggregate {
  $sql = @'
SELECT json_build_object(
  'totalUsers', COUNT(*),
  'totalAdmins', COUNT(*) FILTER (WHERE role = 'ADMIN'),
  'enabledAdmins', COUNT(*) FILTER (WHERE role = 'ADMIN' AND is_enabled)
) FROM users;
'@
  $identityQuery = Invoke-NativeCapture {
    $sql |
      & docker compose -p $localProjectName exec -T postgres sh -c `
        'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'
  }
  if ($identityQuery.ExitCode -ne 0) {
    throw 'Không thể kiểm tra trạng thái tài khoản. Dữ liệu lỗi đã được ẩn để bảo vệ bí mật.'
  }
  $output = @($identityQuery.Output)
  $text = ($output -join "`n").Trim()
  try {
    $aggregate = $text | ConvertFrom-Json
  }
  catch {
    throw 'Kết quả kiểm tra tài khoản không hợp lệ; dừng an toàn.'
  }
  $keys = @($aggregate.PSObject.Properties.Name)
  $expectedKeys = @('totalUsers', 'totalAdmins', 'enabledAdmins')
  if (
    $keys.Count -ne $expectedKeys.Count -or
    @(Compare-Object -ReferenceObject $expectedKeys -DifferenceObject $keys).Count -ne 0
  ) {
    throw 'Kết quả kiểm tra tài khoản không đúng cấu trúc an toàn.'
  }
  return $aggregate
}

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$envPath = Join-Path $repositoryRoot '.env'
$previousLocation = Get-Location
$bootstrapPassword = $null
$bootstrapPasswordPointer = [IntPtr]::Zero
$createdEnvironment = $false
$localProjectName = $null
$localSecretMarkers = @()
$localBuildRunId = [Guid]::NewGuid().ToString('N').Substring(0, 8)
$previousBuildkitProgress = $env:BUILDKIT_PROGRESS
$previousBuildxNoDefaultAttestations = $env:BUILDX_NO_DEFAULT_ATTESTATIONS
$previousComposeBake = $env:COMPOSE_BAKE
$previousComposeFile = $env:COMPOSE_FILE
$previousComposeProgress = $env:COMPOSE_PROGRESS
$previousComposeProjectName = $env:COMPOSE_PROJECT_NAME
$previousDashboardImageTag = $env:DASHBOARD_IMAGE_TAG
$previousLocalComposeEnvironment = $null
$previousComposeControlEnvironment = $null

try {
  Set-Location -LiteralPath $repositoryRoot
  $previousComposeControlEnvironment = Clear-LocalComposeControlEnvironment
  $env:BUILDKIT_PROGRESS = 'plain'
  $env:BUILDX_NO_DEFAULT_ATTESTATIONS = '1'
  $env:COMPOSE_BAKE = 'true'
  if ($UsePrebuilt) {
    $prebuiltComposePath = Join-Path $repositoryRoot 'docker-compose.prebuilt.yml'
    if (-not (Test-Path -LiteralPath $prebuiltComposePath)) {
      throw 'Không tìm thấy gói Docker dựng sẵn trong bản clone này.'
    }
    $env:COMPOSE_FILE = $prebuiltComposePath
  }
  else {
    $env:COMPOSE_FILE = Join-Path $repositoryRoot 'docker-compose.yml'
  }
  $env:COMPOSE_PROGRESS = 'plain'
  Remove-Item Env:COMPOSE_PROJECT_NAME -ErrorAction SilentlyContinue

  $dockerVersion = Invoke-NativeCapture { & docker version }
  if ($dockerVersion.ExitCode -ne 0) {
    throw 'Docker Desktop chưa chạy hoặc lệnh docker chưa có trong PATH.'
  }
  $composeVersion = Invoke-NativeCapture { & docker compose version }
  if ($composeVersion.ExitCode -ne 0) {
    throw 'Docker Compose v2 chưa sẵn sàng.'
  }

  if ($UsePrebuilt) {
    if (Get-Command git -ErrorAction SilentlyContinue) {
      $imageRevisionRead = Invoke-NativeCapture { & git rev-parse --verify HEAD }
      if ($imageRevisionRead.ExitCode -eq 0 -and $imageRevisionRead.Output.Count -eq 1) {
        $imageRevision = ([string]$imageRevisionRead.Output[0]).Trim().ToLowerInvariant()
        if ($imageRevision -match '^[0-9a-f]{40}$') {
          $env:DASHBOARD_IMAGE_TAG = "sha-$imageRevision"
        }
      }
    }
  }

  $writeEnvironment = -not (Test-Path -LiteralPath $envPath)
  if (-not $writeEnvironment) {
    $existing = Get-Item -LiteralPath $envPath
    $writeEnvironment = $existing.Length -eq 0
  }

  if ($writeEnvironment) {
    $postgresPassword = "yhm_$(New-RandomBase64Url 24)"
    $sessionSecret = New-RandomBase64Url 32
    $encryptionKey = New-RandomBase64Url 32
    $content = @"
NODE_ENV=production
DEPLOYMENT_MODE=LOCAL
APP_VERSION=0.1.0
APP_PUBLIC_URL=http://127.0.0.1:3000
APP_ALLOWED_ORIGINS=http://127.0.0.1:3000
WEB_PORT=3000
API_PORT=5000
API_INTERNAL_URL=http://api:5000
POSTGRES_USER=youtube_monitor
POSTGRES_PASSWORD=$postgresPassword
POSTGRES_DB=youtube_monitor
DATABASE_URL=postgresql://youtube_monitor:$postgresPassword@postgres:5432/youtube_monitor
SESSION_SECRET=$sessionSecret
SECRET_ENCRYPTION_KEY=$encryptionKey
SESSION_IDLE_MINUTES=120
SESSION_ABSOLUTE_HOURS=24
LOGIN_MAX_ATTEMPTS=5
LOGIN_LOCK_MINUTES=15
APP_TIMEZONE=Asia/Bangkok
WORKER_HEARTBEAT_INTERVAL_SECONDS=15
WORKER_HEARTBEAT_STALE_SECONDS=45
"@
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($envPath, $content.TrimStart(), $utf8WithoutBom)
    $createdEnvironment = $true
    $content = $null
    $postgresPassword = $null
    $sessionSecret = $null
    $encryptionKey = $null
    Write-Output 'Đã tạo cấu hình .env cục bộ an toàn (không hiển thị bí mật).'
  }

  if (-not $createdEnvironment) {
    $legacyEnvironment = Read-ValidatedLocalEnvironment $envPath -AllowMissingEncryptionKey
    if (-not $legacyEnvironment.ContainsKey('SECRET_ENCRYPTION_KEY')) {
      Add-MissingLocalEncryptionKey $envPath
      Write-Output 'Đã bổ sung khóa mã hóa AI vào cấu hình LOCAL cũ; các giá trị khác được giữ nguyên.'
    }
    $legacyEnvironment = $null
  }

  try {
    $localEnvironment = Read-ValidatedLocalEnvironment $envPath
  }
  catch {
    if ($createdEnvironment) {
      throw 'Cấu hình .env vừa tạo không hợp lệ; dừng mà không thay đổi volume.'
    }
    throw
  }
  $previousLocalComposeEnvironment = Set-ValidatedLocalComposeEnvironment $localEnvironment
  $localSecretMarkers = @(
    [string]$localEnvironment.POSTGRES_PASSWORD,
    [string]$localEnvironment.SESSION_SECRET,
    [string]$localEnvironment.SECRET_ENCRYPTION_KEY,
    [string]$localEnvironment.GEMINI_API_KEY,
    [string]$localEnvironment.NVIDIA_API_KEY
  ) | Where-Object { -not [string]::IsNullOrEmpty($_) }

  $configCheck = Invoke-NativeCapture { & docker compose config --quiet }
  if ($configCheck.ExitCode -ne 0) {
    if ($createdEnvironment) {
      throw 'Cấu hình .env vừa tạo không hợp lệ; không khởi động dịch vụ.'
    }
    throw 'Tệp .env hiện có không hợp lệ. Script từ chối ghi đè hoặc xoay bí mật tự động.'
  }
  $configCheck = $null
  $projectConfigRead = Invoke-NativeCapture {
    & docker compose config --format json --no-interpolate
  }
  if ($projectConfigRead.ExitCode -ne 0) {
    throw 'Không thể xác định project Docker cục bộ; dữ liệu cấu hình được giữ kín.'
  }
  $projectConfigOutput = @($projectConfigRead.Output)
  try {
    $projectConfig = ($projectConfigOutput -join "`n") | ConvertFrom-Json
    $localProjectName = [string]$projectConfig.name
  }
  catch {
    throw 'Tên project Docker cục bộ không hợp lệ; dừng an toàn.'
  }
  finally {
    $projectConfigOutput = $null
    $projectConfig = $null
  }
  if ($localProjectName -notmatch '^[a-z0-9][a-z0-9_-]*$') {
    throw 'Tên project Docker cục bộ nằm ngoài định dạng an toàn.'
  }
  $env:COMPOSE_PROJECT_NAME = $localProjectName

  Invoke-Compose up --detach --wait --wait-timeout 180 postgres
  Invoke-LocalBuild db-migrate
  try {
    Invoke-Compose run --rm db-migrate
  }
  catch {
    if ($createdEnvironment) {
      throw 'Migration không đăng nhập được PostgreSQL. Nếu máy còn volume cũ, hãy khôi phục tệp .env gốc; script sẽ không xóa volume hoặc xoay mật khẩu.'
    }
    throw
  }

  $identity = Get-IdentityAggregate
  if ([int]$identity.totalUsers -eq 0) {
    Invoke-LocalBuild db-seed
    while ($true) {
      $bootstrapEmail = (Read-Host 'Email ADMIN khởi tạo').Trim().ToLowerInvariant()
      if (Test-LocalAdminEmail $bootstrapEmail) { break }
      Write-Warning 'Email ADMIN không hợp lệ. Ví dụ hợp lệ: admin@example.com'
    }
    while ($true) {
      $securePassword = Read-Host 'Mật khẩu ADMIN (6-128 ký tự, ẩn)' -AsSecureString
      $bootstrapPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR(
        $securePassword
      )
      $bootstrapPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        $bootstrapPasswordPointer
      )
      $passwordCodePointCount = Get-UnicodeCodePointCount $bootstrapPassword
      if ($passwordCodePointCount -ge 6 -and $passwordCodePointCount -le 128) { break }

      $bootstrapPassword = $null
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bootstrapPasswordPointer)
      $bootstrapPasswordPointer = [IntPtr]::Zero
      Write-Warning 'Mật khẩu ADMIN phải có từ 6 đến 128 ký tự. Vui lòng nhập lại.'
    }

    $env:SEED_ADMIN_EMAIL = $bootstrapEmail
    $env:SEED_ADMIN_PASSWORD = $bootstrapPassword
    try {
      $seedRun = Invoke-NativeCapture {
        & docker compose -p $localProjectName --profile seed run --rm db-seed
      }
      if ($seedRun.ExitCode -ne 0) {
        throw 'Khởi tạo ADMIN thất bại; nội dung lỗi đã được ẩn để bảo vệ mật khẩu.'
      }
      $seedOutput = @($seedRun.Output)
      $statusLines = @($seedOutput | Where-Object { ([string]$_).Trim() -eq 'CREATED' })
      if ($statusLines.Count -ne 1) {
        throw 'Khởi tạo ADMIN không trả về trạng thái CREATED duy nhất.'
      }
    }
    finally {
      Remove-Item Env:SEED_ADMIN_EMAIL -ErrorAction SilentlyContinue
      Remove-Item Env:SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
      $bootstrapEmail = $null
      $bootstrapPassword = $null
      if ($bootstrapPasswordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bootstrapPasswordPointer)
        $bootstrapPasswordPointer = [IntPtr]::Zero
      }
    }

    $identity = Get-IdentityAggregate
  }

  if ([int]$identity.totalAdmins -ne 1 -or [int]$identity.enabledAdmins -ne 1) {
    throw 'Trạng thái tài khoản không an toàn. Cần đúng một ADMIN đang hoạt động; script không tự sửa dữ liệu.'
  }

  foreach ($service in @('worker', 'api', 'web')) {
    Invoke-LocalBuild $service
  }
  $finalUpArguments = @('up', '--detach', '--wait', '--wait-timeout', '300')
  if ($UsePrebuilt) {
    # A previous failed setup can leave stopped containers bound to an older
    # image filesystem. Recreate them after pulls without deleting named data.
    $finalUpArguments += '--force-recreate'
  }
  Invoke-Compose @finalUpArguments
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File `
    (Join-Path $PSScriptRoot 'health-check.ps1')
  if ($LASTEXITCODE -ne 0) {
    throw 'Dịch vụ đã khởi động nhưng kiểm tra process health thất bại.'
  }

  if (Get-Command git -ErrorAction SilentlyContinue) {
    $revisionRead = Invoke-NativeCapture { & git rev-parse --verify HEAD }
    if ($revisionRead.ExitCode -eq 0 -and $revisionRead.Output.Count -eq 1) {
      $revision = ([string]$revisionRead.Output[0]).Trim().ToLowerInvariant()
      if ($revision -match '^[0-9a-f]{40}$') {
        $runtimeMode = if ($UsePrebuilt) { 'prebuilt' } else { 'source' }
        [IO.File]::WriteAllText(
          (Join-Path $repositoryRoot '.local-runtime-revision'),
          "${runtimeMode}:$revision`r`n"
        )
      }
    }
  }

  $loginUrl = 'http://127.0.0.1:3000/login'
  Write-Output "Dịch vụ sẵn sàng: $loginUrl"
  if (-not $NoOpen) {
    Start-Process $loginUrl
  }
}
finally {
  Remove-Item Env:SEED_ADMIN_EMAIL -ErrorAction SilentlyContinue
  Remove-Item Env:SEED_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $bootstrapPassword = $null
  if ($bootstrapPasswordPointer -ne [IntPtr]::Zero) {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bootstrapPasswordPointer)
  }
  $localSecretMarkers = @()
  $localEnvironment = $null
  Restore-ValidatedLocalComposeEnvironment $previousLocalComposeEnvironment
  Restore-ValidatedLocalComposeEnvironment $previousComposeControlEnvironment
  Restore-ProcessEnvironment BUILDKIT_PROGRESS $previousBuildkitProgress
  Restore-ProcessEnvironment BUILDX_NO_DEFAULT_ATTESTATIONS $previousBuildxNoDefaultAttestations
  Restore-ProcessEnvironment COMPOSE_BAKE $previousComposeBake
  Restore-ProcessEnvironment COMPOSE_FILE $previousComposeFile
  Restore-ProcessEnvironment COMPOSE_PROGRESS $previousComposeProgress
  Restore-ProcessEnvironment COMPOSE_PROJECT_NAME $previousComposeProjectName
  Restore-ProcessEnvironment DASHBOARD_IMAGE_TAG $previousDashboardImageTag
  Set-Location -LiteralPath $previousLocation.Path
}
