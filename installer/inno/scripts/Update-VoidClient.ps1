# Downloads a newer Void Client build from the Delexoo/VoidClient GitHub release.
param(
    [Parameter(Mandatory = $true)][string]$InstallDir
)

$ErrorActionPreference = "Stop"
$versionFile = Join-Path $InstallDir "version.txt"
$dist = Join-Path $InstallDir "dist"
$headers = @{ "User-Agent" = "VoidClient"; Accept = "application/vnd.github+json" }

function Get-Release {
    foreach ($url in @(
        "https://api.github.com/repos/Delexoo/VoidClient/releases/tags/void-client",
        "https://api.github.com/repos/Delexoo/VoidClient/releases/latest"
    )) {
        try { return Invoke-RestMethod -Headers $headers -Uri $url } catch {}
    }
    return $null
}

$release = Get-Release
if (-not $release) { exit 0 }

$name = [string]$release.name
$hash = $name.Substring($name.LastIndexOf(" ") + 1)
$installed = ""
if (Test-Path -LiteralPath $versionFile) { $installed = (Get-Content -LiteralPath $versionFile -Raw).Trim() }
if ($hash -and $hash -eq $installed) { exit 0 }

$wanted = @("patcher.js", "preload.js", "renderer.js", "renderer.css", "vencordDesktopMain.js", "vencordDesktopPreload.js", "vencordDesktopRenderer.js", "vencordDesktopRenderer.css")
$assets = @($release.assets | Where-Object { $wanted -contains $_.name })
if (-not $assets.Count) { exit 0 }

New-Item -ItemType Directory -Force -Path $dist | Out-Null
foreach ($asset in $assets) {
    $dest = Join-Path $dist $asset.name
    Invoke-WebRequest -Headers $headers -Uri $asset.browser_download_url -OutFile $dest
}
if ($hash) { Set-Content -LiteralPath $versionFile -Value $hash -Encoding ascii }

$appDataDist = Join-Path $env:APPDATA "Vencord\dist"
New-Item -ItemType Directory -Force -Path $appDataDist | Out-Null
Copy-Item -Path (Join-Path $dist "*") -Destination $appDataDist -Force
