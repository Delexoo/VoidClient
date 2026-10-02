; Void Client installer. Packages the built client and patches Discord on this PC.

#define AppVersion "1.15.3"

[Setup]
AppId={{A7B3E1C4-6D28-4F0A-9C55-1B2C3D4E5F60}
AppName=Void Client
AppVersion={#AppVersion}
AppPublisher=Delexoo
AppPublisherURL=https://github.com/Delexoo/VoidClient
AppSupportURL=https://github.com/Delexoo/VoidClient
DefaultDirName={localappdata}\DelexooVencord\Vencord
DisableDirPage=yes
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=output
OutputBaseFilename=VoidClientSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=Void Client
CloseApplications=no
RestartApplications=no

[Files]
Source: "..\..\dist\patcher.js"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "..\..\dist\preload.js"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "..\..\dist\renderer.js"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "..\..\dist\renderer.css"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "..\..\dist\vencordDesktopMain.js"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "..\..\dist\vencordDesktopPreload.js"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "..\..\dist\vencordDesktopRenderer.js"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "..\..\dist\vencordDesktopRenderer.css"; DestDir: "{app}\dist"; Flags: ignoreversion
Source: "app.asar"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "scripts\Install-VoidClient.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "scripts\Uninstall-VoidClient.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "scripts\Update-VoidClient.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "scripts\Open-VoidClient.ps1"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "version.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autodesktop}\Void Client"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\installer\Open-VoidClient.ps1"""; WorkingDir: "{app}"
Name: "{autoprograms}\Void Client"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\installer\Open-VoidClient.ps1"""; WorkingDir: "{app}"

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\Install-VoidClient.ps1"" -InstallDir ""{app}"""; StatusMsg: "Installing Void Client into Discord..."; Flags: waituntilterminated
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\installer\Open-VoidClient.ps1"""; Description: "Open Discord with Void Client"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\installer\Uninstall-VoidClient.ps1"" -InstallDir ""{app}"""; Flags: waituntilterminated; RunOnceId: "RestoreDiscord"

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\DelexooVencord"
Type: filesandordirs; Name: "{userappdata}\Vencord"
