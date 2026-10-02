# Installs Void Client into every Discord channel found on this PC.
param(
    [Parameter(Mandatory = $true)][string]$InstallDir
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function New-ProgressForm([string]$heading) {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Void Client Setup"
    $form.StartPosition = "CenterScreen"
    $form.FormBorderStyle = "FixedDialog"
    $form.ControlBox = $false
    $form.TopMost = $true
    $form.ClientSize = New-Object System.Drawing.Size(440, 150)
    $form.BackColor = [System.Drawing.Color]::FromArgb(30, 31, 34)
    $title = New-Object System.Windows.Forms.Label
    $title.AutoSize = $false
    $title.Location = New-Object System.Drawing.Point(20, 18)
    $title.Size = New-Object System.Drawing.Size(400, 24)
    $title.Font = New-Object System.Drawing.Font("Segoe UI", 12, [System.Drawing.FontStyle]::Bold)
    $title.ForeColor = [System.Drawing.Color]::White
    $title.Text = $heading
    $form.Controls.Add($title)
    $detail = New-Object System.Windows.Forms.Label
    $detail.AutoSize = $false
    $detail.Location = New-Object System.Drawing.Point(20, 50)
    $detail.Size = New-Object System.Drawing.Size(400, 40)
    $detail.Font = New-Object System.Drawing.Font("Segoe UI", 9)
    $detail.ForeColor = [System.Drawing.Color]::FromArgb(181, 186, 193)
    $form.Controls.Add($detail)
    $bar = New-Object System.Windows.Forms.ProgressBar
    $bar.Location = New-Object System.Drawing.Point(20, 100)
    $bar.Size = New-Object System.Drawing.Size(400, 18)
    $bar.Minimum = 0
    $bar.Maximum = 100
    $form.Controls.Add($bar)
    $form.Tag = @{ Title = $title; Detail = $detail; Bar = $bar }
    return $form
}

function Set-Step($form, [int]$pct, [string]$heading, [string]$line) {
    $ui = $form.Tag
    $ui.Title.Text = $heading
    $ui.Detail.Text = $line
    $ui.Bar.Value = [Math]::Min(100, [Math]::Max(0, $pct))
    [System.Windows.Forms.Application]::DoEvents()
}

function Get-DiscordRoots {
    $names = @("Discord", "DiscordCanary", "DiscordPTB", "DiscordDevelopment")
    $roots = @()
    foreach ($name in $names) {
        $dir = Join-Path $env:LOCALAPPDATA $name
        if (Test-Path -LiteralPath $dir) { $roots += $dir }
    }
    return $roots
}

function Get-LatestApp([string]$root) {
    $apps = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "app-*" })
    if (-not $apps.Count) { return $null }
    return ($apps | Sort-Object {
        try { [version]($_.Name.Substring(4)) } catch { [version]"0.0.0.0" }
    } | Select-Object -Last 1)
}

function Stop-DiscordIn([string]$root) {
    $names = @("Discord.exe", "DiscordCanary.exe", "DiscordPTB.exe", "DiscordDevelopment.exe")
    foreach ($name in $names) {
        $rows = @(Get-CimInstance Win32_Process -Filter "Name = '$name'" -ErrorAction SilentlyContinue)
        foreach ($row in $rows) {
            $path = [string]$row.ExecutablePath
            if ($path -and $path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
                Stop-Process -Id ([int]$row.ProcessId) -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Start-Sleep -Milliseconds 700
}

function Install-Channel([string]$root, [string]$asar) {
    $app = Get-LatestApp $root
    if (-not $app) { return "no app folder" }
    $resources = Join-Path $app.FullName "resources"
    if (-not (Test-Path -LiteralPath $resources)) { return "no resources folder" }
    Stop-DiscordIn $root
    $current = Join-Path $resources "app.asar"
    $backup = Join-Path $resources "_app.asar"
    if ((Test-Path -LiteralPath $current) -and -not (Test-Path -LiteralPath $backup)) {
        $size = (Get-Item -LiteralPath $current).Length
        if ($size -lt 100000) { throw "Discord in $root is already modified and the original app is missing." }
        Rename-Item -LiteralPath $current -NewName "_app.asar"
    }
    Copy-Item -LiteralPath $asar -Destination $current -Force
    return $app.Name
}

$form = New-ProgressForm "Installing Void Client"
$script:failed = ""
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150
$timer.Add_Tick({
    $timer.Stop()
    try {
        Set-Step $form 15 "Installing Void Client" "Copying Void Client files."
        $dist = Join-Path $InstallDir "dist"
        $appDataDist = Join-Path $env:APPDATA "Vencord\dist"
        New-Item -ItemType Directory -Force -Path $appDataDist | Out-Null
        Copy-Item -Path (Join-Path $dist "*") -Destination $appDataDist -Force

        $asar = Join-Path $InstallDir "installer\app.asar"
        if (-not (Test-Path -LiteralPath $asar)) { throw "The Void Client injector is missing." }

        $roots = @(Get-DiscordRoots)
        if (-not $roots.Count) { throw "Discord is not installed. Install Discord, then run this setup again." }

        $done = @()
        $i = 0
        foreach ($root in $roots) {
            $i++
            $pct = 30 + [int](50 * $i / $roots.Count)
            Set-Step $form $pct "Installing Void Client" "Patching $(Split-Path $root -Leaf)."
            $done += Install-Channel $root $asar
        }

        Set-Step $form 90 "Installing Void Client" "Turning on automatic updates."
        $updater = Join-Path $InstallDir "installer\Update-VoidClient.ps1"
        $arg = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$updater`" -InstallDir `"$InstallDir`""
        New-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Void Client Updater" -Value $arg -PropertyType String -Force | Out-Null

        Set-Step $form 100 "Void Client is installed" ($done -join ", ")
        Start-Sleep -Milliseconds 900
        $form.Close()
    } catch {
        $script:failed = $_.Exception.Message
        $ui = $form.Tag
        $ui.Title.Text = "Install stopped"
        $ui.Detail.Text = $script:failed
        $form.ControlBox = $true
        $close = New-Object System.Windows.Forms.Button
        $close.Text = "Close"
        $close.Location = New-Object System.Drawing.Point(340, 112)
        $close.Size = New-Object System.Drawing.Size(80, 26)
        $close.Add_Click({ $form.Close() })
        $form.Controls.Add($close)
    }
})
$form.Add_Shown({ $form.Activate(); $timer.Start() })
[void]$form.ShowDialog()
if ($script:failed) { exit 1 }
