function Read-ValidatedLocalEnvironment {
  param(
    [string]$Path,
    [switch]$AllowMissingEncryptionKey
  )

  $values = @{}
  foreach ($line in [IO.File]::ReadAllLines($Path)) {
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    $separator = $line.IndexOf('=')
    if ($separator -le 0) { throw 'Tệp .env không đúng cấu trúc LOCAL bắt buộc.' }
    $name = $line.Substring(0, $separator)
    $value = $line.Substring($separator + 1)
    if ($name -notmatch '^[A-Z][A-Z0-9_]*$' -or $values.ContainsKey($name)) {
      throw 'Tệp .env có khóa trùng hoặc không hợp lệ; script từ chối ghi đè.'
    }
    if (
      $name -match '^COMPOSE_' -or
      $name -in @('DASHBOARD_IMAGE_TAG', 'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD')
    ) {
      throw 'Tệp .env chứa khóa điều khiển Docker không được phép trong cấu hình LOCAL.'
    }
    $values[$name] = $value
  }

  $requiredNames = @(
    'NODE_ENV',
    'DEPLOYMENT_MODE',
    'APP_VERSION',
    'APP_PUBLIC_URL',
    'APP_ALLOWED_ORIGINS',
    'WEB_PORT',
    'API_PORT',
    'API_INTERNAL_URL',
    'POSTGRES_USER',
    'POSTGRES_PASSWORD',
    'POSTGRES_DB',
    'DATABASE_URL',
    'SESSION_SECRET',
    'SECRET_ENCRYPTION_KEY',
    'SESSION_IDLE_MINUTES',
    'SESSION_ABSOLUTE_HOURS',
    'LOGIN_MAX_ATTEMPTS',
    'LOGIN_LOCK_MINUTES',
    'APP_TIMEZONE',
    'WORKER_HEARTBEAT_INTERVAL_SECONDS',
    'WORKER_HEARTBEAT_STALE_SECONDS'
  )
  $missingNames = @($requiredNames | Where-Object { -not $values.ContainsKey($_) })
  if ($AllowMissingEncryptionKey) {
    $missingNames = @($missingNames | Where-Object { $_ -ne 'SECRET_ENCRYPTION_KEY' })
  }
  if ($missingNames.Count -ne 0) {
    throw 'Tệp .env thiếu cấu hình thuộc hợp đồng LOCAL; script từ chối ghi đè.'
  }
  if ($values.ContainsKey('TRUST_PROXY')) {
    throw 'TRUST_PROXY phải vắng mặt cho đến Phase 9; script từ chối cấu hình hiện tại.'
  }

  $fixedValues = @{
    NODE_ENV = 'production'
    DEPLOYMENT_MODE = 'LOCAL'
    APP_VERSION = '0.1.0'
    APP_PUBLIC_URL = 'http://127.0.0.1:3000'
    APP_ALLOWED_ORIGINS = 'http://127.0.0.1:3000'
    WEB_PORT = '3000'
    API_PORT = '5000'
    API_INTERNAL_URL = 'http://api:5000'
    POSTGRES_USER = 'youtube_monitor'
    POSTGRES_DB = 'youtube_monitor'
    SESSION_IDLE_MINUTES = '120'
    SESSION_ABSOLUTE_HOURS = '24'
    LOGIN_MAX_ATTEMPTS = '5'
    LOGIN_LOCK_MINUTES = '15'
    APP_TIMEZONE = 'Asia/Bangkok'
    WORKER_HEARTBEAT_INTERVAL_SECONDS = '15'
    WORKER_HEARTBEAT_STALE_SECONDS = '45'
  }
  foreach ($name in $fixedValues.Keys) {
    if ([string]$values[$name] -cne [string]$fixedValues[$name]) {
      throw 'Tệp .env không đúng cấu hình LOCAL cố định; script từ chối ghi đè hoặc xoay bí mật.'
    }
  }
  if (
    $values.ContainsKey('WEB_BIND_ADDRESS') -and
    [string]$values.WEB_BIND_ADDRESS -cne '127.0.0.1'
  ) {
    throw 'WEB_BIND_ADDRESS phải giữ ở loopback 127.0.0.1 cho cấu hình LOCAL.'
  }

  $postgresPassword = [string]$values.POSTGRES_PASSWORD
  $sessionSecret = [string]$values.SESSION_SECRET
  $encryptionKey = [string]$values.SECRET_ENCRYPTION_KEY
  if (
    $postgresPassword -notmatch '^[A-Za-z0-9_-]{24,128}$' -or
    $sessionSecret -notmatch '^[A-Za-z0-9_-]{43}$' -or
    ($values.ContainsKey('SECRET_ENCRYPTION_KEY') -and $encryptionKey -notmatch '^[A-Za-z0-9_-]{43}$')
  ) {
    throw 'Tệp .env có định dạng bí mật không an toàn; script từ chối hiển thị hoặc thay thế.'
  }
  $expectedDatabaseUrl = "postgresql://youtube_monitor:$postgresPassword@postgres:5432/youtube_monitor"
  if ([string]$values.DATABASE_URL -cne $expectedDatabaseUrl) {
    throw 'DATABASE_URL không nhất quán với cấu hình PostgreSQL LOCAL; script từ chối ghi đè.'
  }
  return $values
}

function Get-LocalComposeEnvironmentNames {
  return @(
    'NODE_ENV', 'DEPLOYMENT_MODE', 'APP_VERSION', 'APP_PUBLIC_URL',
    'APP_ALLOWED_ORIGINS', 'WEB_PORT', 'WEB_BIND_ADDRESS', 'API_PORT',
    'API_INTERNAL_URL', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'POSTGRES_DB',
    'DATABASE_URL', 'SESSION_SECRET', 'SECRET_ENCRYPTION_KEY',
    'SESSION_IDLE_MINUTES', 'SESSION_ABSOLUTE_HOURS', 'LOGIN_MAX_ATTEMPTS',
    'LOGIN_LOCK_MINUTES', 'APP_TIMEZONE', 'WORKER_HEARTBEAT_INTERVAL_SECONDS',
    'WORKER_HEARTBEAT_STALE_SECONDS', 'CHANNEL_ACTIVE_UPLOAD_DAYS',
    'RSS_SCAN_MINUTES', 'CHANNEL_SCAN_HOURS', 'CHANNEL_HEALTH_HOURS',
    'PLAYWRIGHT_CONCURRENCY', 'YTDLP_CONCURRENCY', 'GEMINI_API_KEY',
    'GEMINI_BASE_URL', 'GEMINI_FAST_MODEL', 'GEMINI_ANALYSIS_MODEL',
    'NVIDIA_API_KEY', 'NVIDIA_BASE_URL', 'NVIDIA_FAST_MODEL',
    'NVIDIA_ANALYSIS_MODEL', 'NVIDIA_LONG_CONTEXT_MODEL',
    'AI_DAILY_REPORT_ENABLED', 'AI_WEEKLY_REPORT_ENABLED',
    'AI_DAILY_REPORT_HOUR', 'AI_DAILY_REPORT_MINUTE',
    'AI_WEEKLY_REPORT_DAY', 'AI_WEEKLY_REPORT_HOUR',
    'AI_WEEKLY_REPORT_MINUTE', 'AI_REPORT_RETRY_MINUTES', 'TRUST_PROXY',
    'CADDY_SITE_ADDRESS', 'CADDY_HTTP_BIND', 'CADDY_HTTP_PORT',
    'SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD'
  )
}

function Set-ValidatedLocalComposeEnvironment {
  param([hashtable]$Values)

  $previous = @{}
  foreach ($name in Get-LocalComposeEnvironmentNames) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    if ($Values.ContainsKey($name)) {
      Set-Item -LiteralPath "Env:$name" -Value ([string]$Values[$name])
    }
    else {
      Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
    }
  }
  return $previous
}

function Restore-ValidatedLocalComposeEnvironment {
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

function Clear-LocalComposeControlEnvironment {
  $names = @(
    'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES', 'COMPOSE_DISABLE_ENV_FILE',
    'COMPOSE_PATH_SEPARATOR', 'COMPOSE_CONVERT_WINDOWS_PATHS', 'COMPOSE_IGNORE_ORPHANS',
    'COMPOSE_REMOVE_ORPHANS', 'COMPOSE_PARALLEL_LIMIT', 'COMPOSE_ANSI',
    'COMPOSE_STATUS_STDOUT', 'COMPOSE_MENU', 'COMPOSE_EXPERIMENTAL'
  )
  $previous = @{}
  foreach ($name in $names) {
    $previous[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
  }
  return $previous
}
