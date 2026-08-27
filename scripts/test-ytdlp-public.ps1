[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ImageRef,

    [string]$ChannelId = "UCwG3OsiBqh8Ey--Te89kpOQ"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if ($ChannelId -notmatch '^UC[A-Za-z0-9_-]{22}$') {
    throw "ChannelId must be a canonical YouTube channel ID."
}

$uploadsPlaylistId = "UU$($ChannelId.Substring(2))"
$uploadsUrl = "https://www.youtube.com/playlist?list=$uploadsPlaylistId"
$version = (& docker run --rm --entrypoint yt-dlp $ImageRef --version | Out-String).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Could not execute yt-dlp in image '$ImageRef'."
}

$raw = & docker run --rm --entrypoint yt-dlp $ImageRef `
    --dump-single-json `
    --skip-download `
    --no-warnings `
    --flat-playlist `
    $uploadsUrl
if ($LASTEXITCODE -ne 0) {
    throw "yt-dlp public catalog probe failed."
}

try {
    $payload = (($raw -join "`n") | ConvertFrom-Json)
}
catch {
    throw "yt-dlp public catalog probe returned invalid JSON."
}

$catalogRows = @($payload.entries)
$declaredCount = if ($null -eq $payload.playlist_count) { 0 } else { [int]$payload.playlist_count }
$matchingRows = @($catalogRows | Where-Object { $_.channel_id -eq $ChannelId })
$rowsWithViews = @($matchingRows | Where-Object { $null -ne $_.view_count })

if ($declaredCount -gt 0 -and $catalogRows.Count -eq 0) {
    throw "yt-dlp declared $declaredCount catalog entries but emitted none."
}
if ($matchingRows.Count -eq 0) {
    throw "yt-dlp emitted no entries for the requested channel."
}
if ($rowsWithViews.Count -eq 0) {
    throw "yt-dlp emitted no usable public view counters."
}

Write-Output "yt-dlp public catalog probe passed."
Write-Output "version=$version declared=$declaredCount emitted=$($catalogRows.Count) matching=$($matchingRows.Count) views=$($rowsWithViews.Count)"
