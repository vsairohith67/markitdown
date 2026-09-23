$ErrorActionPreference = "Stop"

$LocalDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $LocalDirectory
$Launcher = Join-Path $LocalDirectory "launch-local.ps1"
$IconPath = Join-Path $LocalDirectory "MarkItDownStudio.ico"
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "MarkItDown Studio (Local).lnk"

if (-not (Test-Path -LiteralPath $IconPath)) {
    $pythonPath = Join-Path $RepoRoot ".venv\Scripts\python.exe"
    if (-not (Test-Path -LiteralPath $pythonPath)) {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
        if (-not $pythonCommand) {
            throw "Python is required to create the local app icon."
        }
        $pythonPath = $pythonCommand.Source
    }
    & $pythonPath (Join-Path $LocalDirectory "create_icon.py") $IconPath
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $IconPath)) {
        throw "The MarkItDown Studio icon could not be created."
    }
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Launcher`""
$shortcut.WorkingDirectory = $RepoRoot
$shortcut.IconLocation = "$IconPath,0"
$shortcut.Description = "Run MarkItDown Studio locally on this laptop"
$shortcut.Save()

Write-Output "Created $ShortcutPath"
