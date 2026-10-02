# Starts Discord. Void Client loads with it after setup.
$ErrorActionPreference = "Stop"
$stable = Join-Path $env:LOCALAPPDATA "Discord"
$update = Join-Path $stable "Update.exe"
if (Test-Path -LiteralPath $update) {
    Start-Process -FilePath $update -ArgumentList @("--processStart", "Discord.exe") -WorkingDirectory $stable
    exit 0
}
$exe = Get-ChildItem -Path $stable -Filter "Discord.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) { Start-Process -FilePath $exe.FullName; exit 0 }
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.MessageBox]::Show("Discord is not installed yet. Install Discord, then open Void Client again.", "Void Client") | Out-Null
