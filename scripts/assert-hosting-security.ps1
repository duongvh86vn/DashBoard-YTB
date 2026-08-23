[CmdletBinding()]
param(
  [switch]$HostingProfile
)

$ErrorActionPreference = "Stop"
$composeArgs = @()
if ($HostingProfile) { $composeArgs += @("--profile", "hosting") }
$composeArgs += @("config", "--format", "json")
$json = & docker compose @composeArgs
if ($LASTEXITCODE -ne 0) { throw "docker compose config failed" }
$config = $json | ConvertFrom-Json
$services = $config.services

foreach ($name in @("postgres", "api", "worker")) {
  $ports = @($services.$name.ports | Where-Object { $null -ne $_ })
  if ($ports.Count -gt 0) { throw "$name must not publish host ports" }
}

$webPorts = @($services.web.ports | Where-Object { $null -ne $_ })
if (-not $HostingProfile -and $webPorts.Count -ne 1 -or -not $HostingProfile -and $webPorts[0].published -ne 3000) {
  throw "default Web port contract is not present"
}
if (-not $HostingProfile -and $webPorts[0].host_ip -ne "127.0.0.1") {
  throw "default Web bind must remain loopback"
}

if ($HostingProfile) {
  if ($webPorts.Count -ne 1 -or $webPorts[0].host_ip -ne "127.0.0.1") {
    throw "hosting profile must keep Web loopback-bound"
  }
  $caddyPorts = @($services.caddy.ports | Where-Object { $null -ne $_ })
  if ($caddyPorts.Count -ne 1) { throw "hosting profile must publish only Caddy HTTP" }
  if ($null -eq $services.caddy.volumes) { throw "Caddy config/data volumes are required" }

  $caddyfile = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot "..\docker\Caddyfile")
  if ($caddyfile -notmatch '(?s)handle /api/\*.*reverse_proxy api:5000') {
    throw "Caddy must route /api/* to the internal API"
  }
  if ($caddyfile -notmatch '(?s)handle \{.*reverse_proxy web:3000') {
    throw "Caddy must route the remaining paths to Web"
  }
}

Write-Output "Hosting security assertions passed ($($HostingProfile ? 'hosting profile' : 'default profile'))."
