# Restores original Discord, removes Void Client files, then opens Discord.
param(
    [Parameter(Mandatory = $true)][string]$InstallDir
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

function New-ProgressForm {
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Uninstalling Void Client"
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
    $title.Text = "Uninstalling Void Client"
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
    $roots = @()
    foreach ($name in @("Discord", "DiscordCanary", "DiscordPTB", "DiscordDevelopment")) {
        $dir = Join-Path $env:LOCALAPPDATA $name
        if (Test-Path -LiteralPath $dir) { $roots += $dir }
    }
    return $roots
}

function Stop-OurDiscord([string]$root) {
    $prefix = $root.TrimEnd("\") + "\"
    foreach ($name in @("Discord.exe", "DiscordCanary.exe", "DiscordPTB.exe", "DiscordDevelopment.exe", "Update.exe")) {
        $rows = @(Get-CimInstance Win32_Process -Filter "Name = '$name'" -ErrorAction SilentlyContinue)
        foreach ($row in $rows) {
            $path = [string]$row.ExecutablePath
            if ($path -and ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or ($path.TrimEnd("\") -eq $root.TrimEnd("\")))) {
                Stop-Process -Id ([int]$row.ProcessId) -Force -ErrorAction SilentlyContinue
            }
        }
    }
}

function Restore-Channel([string]$root) {
    $apps = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "app-*" })
    foreach ($app in $apps) {
        $resources = Join-Path $app.FullName "resources"
        $current = Join-Path $resources "app.asar"
        $backup = Join-Path $resources "_app.asar"
        if (-not (Test-Path -LiteralPath $backup)) { continue }
        $backupFile = Get-Item -LiteralPath $backup
        if ($backupFile.Length -lt 100000) { throw "The saved Discord app in $($app.FullName) is too small to restore." }
        $restored = $false
        for ($try = 0; $try -lt 30; $try++) {
            Stop-OurDiscord $root
            Start-Sleep -Milliseconds 400
            try {
                if (Test-Path -LiteralPath $current) {
                    $live = Get-Item -LiteralPath $current
                    $live.Attributes = "Normal"
                }
                [System.IO.File]::Copy($backup, $current, $true)
                $size = (Get-Item -LiteralPath $current).Length
                if ($size -eq $backupFile.Length) {
                    [System.IO.File]::Delete($backup)
                    $restored = $true
                    break
                }
            } catch {}
        }
        if (-not $restored) { throw "Original Discord could not be restored in $($app.FullName)." }
    }
}

$form = New-ProgressForm
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150
$timer.Add_Tick({
    $timer.Stop()
    try {
        Set-Step $form 20 "Closing Discord" "Stopping Void Client so the original app can be restored."
        foreach ($root in @(Get-DiscordRoots)) { Restore-Channel $root }

        Set-Step $form 55 "Removing Void Client" "Deleting settings, updates, and saved plugin files."
        Remove-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "Void Client Updater" -ErrorAction SilentlyContinue
        foreach ($path in @(
            (Join-Path $env:APPDATA "Vencord"),
            (Join-Path $env:USERPROFILE "Documents\StalkerMode"),
            (Join-Path ([Environment]::GetFolderPath("Desktop")) "Void Client.lnk"),
            (Join-Path ([Environment]::GetFolderPath("Desktop")) "Void Client Installer.lnk")
        )) {
            if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue }
        }

        Set-Step $form 85 "Opening Discord" "Starting the original Discord app."
        $stable = Join-Path $env:LOCALAPPDATA "Discord"
        $update = Join-Path $stable "Update.exe"
        $opened = $false
        if (Test-Path -LiteralPath $update) {
            Start-Process -FilePath $update -ArgumentList @("--processStart", "Discord.exe") -WorkingDirectory $stable | Out-Null
            $opened = $true
        }
        if (-not $opened) {
            $exe = Get-ChildItem -Path $stable -Filter "Discord.exe" -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($exe) { Start-Process -FilePath $exe.FullName | Out-Null }
        }

        Set-Step $form 100 "Discord is open" "Void Client has been removed."
        Start-Sleep -Milliseconds 1000
        $form.Close()
    } catch {
        $ui = $form.Tag
        $ui.Title.Text = "Uninstall stopped"
        $ui.Detail.Text = $_.Exception.Message
        $form.ControlBox = $true
    }
})
$form.Add_Shown({ $form.Activate(); $timer.Start() })
[void]$form.ShowDialog()
