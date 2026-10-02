/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Delexo contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { spawn } from "child_process";
import { app } from "electron";
import { existsSync, readdirSync, writeFileSync } from "original-fs";
import { homedir, tmpdir } from "os";
import { basename, dirname, join } from "path";

import { DATA_DIR } from "./utils/constants";

function psQuote(value: string) {
    return `'${value.replace(/'/g, "''")}'`;
}

export function scheduleReturnToDiscord() {
    if (process.platform !== "win32") {
        throw new Error("Uninstall from settings is available on Windows.");
    }

    const appDir = dirname(process.execPath);
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
    const channels = ["Discord", "DiscordCanary", "DiscordPTB", "DiscordDevelopment"];
    const hasBackup = channels.some(name => {
        const root = join(localAppData, name);
        if (!existsSync(root)) return false;
        try {
            return readdirSync(root).some(entry =>
                entry.startsWith("app-") && existsSync(join(root, entry, "resources", "_app.asar"))
            );
        } catch {
            return false;
        }
    });
    if (!hasBackup) {
        throw new Error("Original Discord files were not found, so Void Client was left in place.");
    }
    process.env.DISABLE_UPDATER_AUTO_PATCHING = "1";

    const updateExe = join(dirname(appDir), "Update.exe");
    const exeName = basename(process.execPath);
    const scriptPath = join(tmpdir(), `void-client-uninstall-${process.pid}.ps1`);
    const targets = {
        dataDir: DATA_DIR,
        installerDir: join(localAppData, "DelexooVencord"),
        stalkerDir: join(app.getPath("documents"), "StalkerMode"),
        userData: app.getPath("userData"),
        desktop: app.getPath("desktop"),
        oneDriveDesktop: join(homedir(), "OneDrive", "Desktop")
    };

    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$root = ${psQuote(appDir)}
$update = ${psQuote(updateExe)}
$exeName = ${psQuote(exeName)}
$dataDir = ${psQuote(targets.dataDir)}
$installerDir = ${psQuote(targets.installerDir)}
$stalkerDir = ${psQuote(targets.stalkerDir)}
$userData = ${psQuote(targets.userData)}
$desktop = ${psQuote(targets.desktop)}
$oneDriveDesktop = ${psQuote(targets.oneDriveDesktop)}
$scriptFile = ${psQuote(scriptPath)}

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Uninstalling Void Client'
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.ControlBox = $false
$form.TopMost = $true
$form.ClientSize = New-Object System.Drawing.Size(420, 168)
$form.BackColor = [System.Drawing.Color]::FromArgb(30, 31, 34)
$form.ForeColor = [System.Drawing.Color]::White

$title = New-Object System.Windows.Forms.Label
$title.AutoSize = $false
$title.Location = New-Object System.Drawing.Point(20, 18)
$title.Size = New-Object System.Drawing.Size(380, 24)
$title.Font = New-Object System.Drawing.Font('Segoe UI', 12, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::White
$title.Text = 'Closing Void Client'
$form.Controls.Add($title)

$detail = New-Object System.Windows.Forms.Label
$detail.AutoSize = $false
$detail.Location = New-Object System.Drawing.Point(20, 48)
$detail.Size = New-Object System.Drawing.Size(380, 36)
$detail.Font = New-Object System.Drawing.Font('Segoe UI', 9)
$detail.ForeColor = [System.Drawing.Color]::FromArgb(181, 186, 193)
$detail.Text = 'Waiting for Discord to close.'
$form.Controls.Add($detail)

$bar = New-Object System.Windows.Forms.ProgressBar
$bar.Location = New-Object System.Drawing.Point(20, 96)
$bar.Size = New-Object System.Drawing.Size(380, 18)
$bar.Minimum = 0
$bar.Maximum = 100
$bar.Value = 4
$bar.Style = 'Continuous'
$form.Controls.Add($bar)

$close = New-Object System.Windows.Forms.Button
$close.Text = 'Close'
$close.Visible = $false
$close.Location = New-Object System.Drawing.Point(324, 126)
$close.Size = New-Object System.Drawing.Size(76, 28)
$close.FlatStyle = 'Flat'
$close.BackColor = [System.Drawing.Color]::FromArgb(88, 101, 242)
$close.ForeColor = [System.Drawing.Color]::White
$close.Add_Click({ $form.Close() })
$form.Controls.Add($close)

function Update-Step([int]$pct, [string]$heading, [string]$line) {
  if ($pct -lt 0) { $pct = 0 }
  if ($pct -gt 100) { $pct = 100 }
  $title.Text = $heading
  $detail.Text = $line
  $bar.Value = $pct
  [System.Windows.Forms.Application]::DoEvents()
}

function Wait-Ms([int]$ms) {
  $end = [DateTime]::UtcNow.AddMilliseconds($ms)
  while ([DateTime]::UtcNow -lt $end) {
    Start-Sleep -Milliseconds 40
    [System.Windows.Forms.Application]::DoEvents()
  }
}

function Get-DiscordRoots {
  $found = @()
  foreach ($name in @('Discord','DiscordCanary','DiscordPTB','DiscordDevelopment')) {
    $dir = Join-Path $env:LOCALAPPDATA $name
    if (Test-Path -LiteralPath $dir) { $found += $dir }
  }
  return @($found)
}

function Test-UnderRoot([string]$path, [string]$root) {
  if (-not $path -or -not $root) { return $false }
  $prefix = $root.TrimEnd('\\') + '\\'
  return $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or ($path.TrimEnd('\\') -eq $root.TrimEnd('\\'))
}

function Get-OurDiscord {
  $roots = @(Get-DiscordRoots)
  $found = @()
  foreach ($name in @('Discord.exe','DiscordCanary.exe','DiscordPTB.exe','DiscordDevelopment.exe','Update.exe')) {
    $rows = @(Get-CimInstance Win32_Process -Filter "Name = '$name'" -ErrorAction SilentlyContinue)
    foreach ($row in $rows) {
      $path = [string]$row.ExecutablePath
      foreach ($dir in $roots) {
        if (Test-UnderRoot $path $dir) { $found += [int]$row.ProcessId }
      }
    }
  }
  return @($found | Select-Object -Unique)
}

function Test-DiscordAppOpen {
  foreach ($name in @('Discord.exe','DiscordCanary.exe','DiscordPTB.exe','DiscordDevelopment.exe')) {
    $rows = @(Get-CimInstance Win32_Process -Filter "Name = '$name'" -ErrorAction SilentlyContinue)
    foreach ($row in $rows) {
      foreach ($dir in @(Get-DiscordRoots)) {
        if (Test-UnderRoot ([string]$row.ExecutablePath) $dir) { return $true }
      }
    }
  }
  return $false
}

function Stop-OurDiscord {
  $deadline = [DateTime]::UtcNow.AddSeconds(25)
  while ((@(Get-OurDiscord).Count -gt 0) -and ([DateTime]::UtcNow -lt $deadline)) {
    foreach ($id in @(Get-OurDiscord)) {
      try { Stop-Process -Id $id -Force -ErrorAction SilentlyContinue } catch {}
    }
    Wait-Ms 250
  }
}

function Restore-OriginalAsar([string]$resources) {
  $current = Join-Path $resources 'app.asar'
  $backup = Join-Path $resources '_app.asar'
  if (-not (Test-Path -LiteralPath $backup)) { return $true }
  $backupFile = Get-Item -LiteralPath $backup
  if ($backupFile.Length -lt 100000) { throw 'The saved Discord app is too small to restore.' }
  if (Test-Path -LiteralPath $current) {
    $live = Get-Item -LiteralPath $current -ErrorAction SilentlyContinue
    if ($live) { $live.Attributes = 'Normal' }
  }
  for ($try = 0; $try -lt 30; $try++) {
    try {
      [System.IO.File]::Copy($backup, $current, $true)
      $restored = Get-Item -LiteralPath $current
      if ($restored.Length -eq $backupFile.Length) {
        [System.IO.File]::Delete($backup)
        return $true
      }
    } catch {}
    Wait-Ms 400
  }
  return $false
}

function Remove-Tree([string]$path) {
  if (-not $path) { return }
  if (-not (Test-Path -LiteralPath $path)) { return }
  for ($i = 0; $i -lt 15; $i++) {
    try {
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
      return
    } catch {
      Wait-Ms 350
    }
  }
}

function Remove-Link([string]$path) {
  if ($path -and (Test-Path -LiteralPath $path)) {
    Remove-Item -LiteralPath $path -Force -ErrorAction SilentlyContinue
  }
}

$failed = ''
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 150
$timer.Add_Tick({
  $timer.Stop()
  try {
    Update-Step 8 'Closing Void Client' 'Waiting for Discord to exit.'
    $deadline = [DateTime]::UtcNow.AddSeconds(8)
    while ((@(Get-OurDiscord).Count -gt 0) -and ([DateTime]::UtcNow -lt $deadline)) {
      Wait-Ms 250
    }
    if (@(Get-OurDiscord).Count -gt 0) {
      Update-Step 18 'Closing Void Client' 'Stopping Discord so the original app can be restored.'
      Stop-OurDiscord
    }
    if (@(Get-OurDiscord).Count -gt 0) {
      throw 'Discord is still running. Quit it from the tray, then try uninstall again.'
    }
    Wait-Ms 800

    Update-Step 36 'Restoring Discord' 'Putting the original Discord files back.'
    $restoredAny = $false
    foreach ($installRoot in @(Get-DiscordRoots)) {
      $apps = @(Get-ChildItem -LiteralPath $installRoot -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'app-*' })
      foreach ($appFolder in $apps) {
        $resources = Join-Path $appFolder.FullName 'resources'
        $backup = Join-Path $resources '_app.asar'
        if (-not (Test-Path -LiteralPath $backup)) { continue }
        if (-not (Restore-OriginalAsar $resources)) {
          throw 'Original Discord could not be restored. Void Client was left in place.'
        }
        $restoredAny = $true
      }
    }
    if (-not $restoredAny) {
      throw 'Original Discord files were not found, so Void Client was left in place.'
    }

    Update-Step 58 'Removing Void Client' 'Deleting settings and installed files.'
    Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name 'Void Client Updater' -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{A7B3E1C4-6D28-4F0A-9C55-1B2C3D4E5F60}_is1' -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Tree $dataDir
    Remove-Tree $installerDir
    $yt = Join-Path (Join-Path $userData 'Partitions') 'vc-youtube-tab'
    Remove-Tree $yt

    Update-Step 74 'Removing Void Client' 'Deleting saved plugin files and shortcuts.'
    Remove-Tree $stalkerDir
    Remove-Link (Join-Path $desktop 'Void Client.lnk')
    Remove-Link (Join-Path $desktop 'Void Client Installer.lnk')
    Remove-Link (Join-Path $oneDriveDesktop 'Void Client.lnk')
    Remove-Link (Join-Path $oneDriveDesktop 'Void Client Installer.lnk')
    $programs = [Environment]::GetFolderPath('Programs')
    if ($programs -and (Test-Path -LiteralPath $programs)) {
      Get-ChildItem -LiteralPath $programs -Filter '*Void Client*' -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        Remove-Link $_.FullName
      }
    }

    Update-Step 88 'Opening Discord' 'Starting the original Discord app.'
    $exe = Join-Path $root $exeName
    $started = $false
    if (Test-Path -LiteralPath $update) {
      Start-Process -FilePath $update -ArgumentList @('--processStart', $exeName) -WorkingDirectory (Split-Path -Parent $update) | Out-Null
      $waitUntil = [DateTime]::UtcNow.AddSeconds(12)
      while ([DateTime]::UtcNow -lt $waitUntil) {
        if (Test-DiscordAppOpen) { $started = $true; break }
        Wait-Ms 300
      }
    }
    if (-not $started -and (Test-Path -LiteralPath $exe)) {
      Start-Process -FilePath $exe -WorkingDirectory $root | Out-Null
      $waitUntil = [DateTime]::UtcNow.AddSeconds(8)
      while ([DateTime]::UtcNow -lt $waitUntil) {
        if (Test-DiscordAppOpen) { $started = $true; break }
        Wait-Ms 300
      }
    }
    if (-not $started) {
      throw 'Discord was restored, but it did not open. Start Discord from the Start menu.'
    }

    Update-Step 100 'Discord is open' 'Void Client has been removed.'
    Wait-Ms 1200
    $form.Close()
  } catch {
    $failed = $_.Exception.Message
    $title.Text = 'Uninstall stopped'
    $detail.Text = $failed
    $form.ControlBox = $true
    $close.Visible = $true
  }
})

$form.Add_Shown({
  $form.Activate()
  $timer.Start()
})
[void]$form.ShowDialog()
Remove-Item -LiteralPath $scriptFile -Force -ErrorAction SilentlyContinue
`;

    writeFileSync(scriptPath, script, "utf8");
    const child = spawn("powershell.exe", [
        "-NoProfile",
        "-STA",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-File", scriptPath
    ], {
        detached: true,
        stdio: "ignore",
        windowsHide: false
    });
    child.unref();
    setTimeout(() => app.quit(), 1200);
}