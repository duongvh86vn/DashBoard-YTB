$ErrorActionPreference = 'Stop'

function Get-ServiceContainerId {
  param([string]$Service)

  $ids = @(& docker compose ps -aq $Service)
  $ids = @($ids | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
  if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) {
    throw "Expected exactly one Compose container for $Service"
  }
  return ([string]$ids[0]).Trim()
}

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

docker compose ps
if ($LASTEXITCODE -ne 0) { throw 'Could not display Compose process health' }
