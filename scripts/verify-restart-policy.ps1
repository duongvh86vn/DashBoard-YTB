[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$json = & docker compose config --format json
if ($LASTEXITCODE -ne 0) { throw "docker compose config failed" }
$config = $json | ConvertFrom-Json
foreach ($service in @("postgres", "worker", "api", "web")) {
  if ([string]$config.services.$service.restart -ne "unless-stopped") {
    throw "$service must use restart: unless-stopped"
  }
}
if ([string]$config.services."db-migrate".restart -ne "no") {
  throw "db-migrate must remain a one-shot service"
}
Write-Output "Compose restart policy assertions passed."
