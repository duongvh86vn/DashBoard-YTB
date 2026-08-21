$ErrorActionPreference = 'Stop'

$monitorWebPort = if ($env:WEB_PORT) { [int]$env:WEB_PORT } else { 3000 }
$monitorBaseUrl = "http://127.0.0.1:$monitorWebPort"

& corepack pnpm exec tsx scripts/assert-health-response.ts "$monitorBaseUrl/health" 200 web ok
if ($LASTEXITCODE -ne 0) { throw 'Web health failed' }

& corepack pnpm exec tsx scripts/assert-health-response.ts "$monitorBaseUrl/api/v1/health" 200 api ok
if ($LASTEXITCODE -ne 0) { throw 'API aggregate health failed' }

docker compose ps
