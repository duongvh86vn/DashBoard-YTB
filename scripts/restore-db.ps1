[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory = $true)]
  [string]$InputPath,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
$resolved = [IO.Path]::GetFullPath((Join-Path (Get-Location) $InputPath))
if (-not (Test-Path -LiteralPath $resolved -PathType Leaf)) { throw "Backup not found: $resolved" }
if (-not $Force) {
  throw "Restore replaces database contents. Re-run with -Force after verifying the backup checksum."
}
if (-not $PSCmdlet.ShouldProcess($resolved, "restore PostgreSQL database")) { return }

$containerPath = "/tmp/yt-monitor-restore-$([Guid]::NewGuid().ToString('N')).dump"
try {
  & docker compose cp $resolved "postgres:$containerPath"
  if ($LASTEXITCODE -ne 0) { throw "Could not copy backup into postgres container" }
  $restoreCommand = 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" "' + $containerPath + '"'
  & docker compose exec -T postgres sh -c $restoreCommand
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed" }
}
finally {
  & docker compose exec -T postgres rm -f $containerPath 2>$null | Out-Null
}

$hash = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
Write-Output "Database restored from: $resolved"
Write-Output "SHA256 verified for input: $hash"
