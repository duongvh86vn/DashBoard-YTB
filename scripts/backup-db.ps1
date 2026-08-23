[CmdletBinding()]
param(
  [string]$OutputPath = "backups/yt-monitor-$((Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')).dump"
)

$ErrorActionPreference = "Stop"
$resolved = [IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputPath))
$directory = Split-Path -Parent $resolved
New-Item -ItemType Directory -Force -Path $directory | Out-Null
if (Test-Path -LiteralPath $resolved) { throw "Backup already exists: $resolved" }

$containerPath = "/tmp/yt-monitor-backup-$([Guid]::NewGuid().ToString('N')).dump"
try {
  $dumpCommand = 'pg_dump -Fc -U "$POSTGRES_USER" -d "$POSTGRES_DB" > "' + $containerPath + '"'
  & docker compose exec -T postgres sh -c $dumpCommand
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed" }
  & docker compose cp "postgres:$containerPath" $resolved
  if ($LASTEXITCODE -ne 0) { throw "Could not copy backup from postgres container" }
}
finally {
  & docker compose exec -T postgres rm -f $containerPath 2>$null | Out-Null
}

$file = Get-Item -LiteralPath $resolved
if ($file.Length -le 0) { throw "Backup is empty: $resolved" }
$hash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
Write-Output "Backup created: $resolved"
Write-Output "Bytes: $($file.Length)"
Write-Output "SHA256: $hash"
