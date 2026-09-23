$ErrorActionPreference = "Stop"

$LocalDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Split-Path -Parent $LocalDirectory
$Port = 8765
$BaseUrl = "http://127.0.0.1:$Port"
$ServerScript = Join-Path $RepoRoot "local_server.py"
$DistIndex = Join-Path $RepoRoot "dist\index.html"
$LogDirectory = Join-Path $LocalDirectory "logs"
$StdoutLog = Join-Path $LogDirectory "server.out.log"
$StderrLog = Join-Path $LogDirectory "server.err.log"

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

function Open-LocalApp {
    Start-Process $BaseUrl | Out-Null
}

function Test-LocalServer {
    try {
        $response = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 2
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-LocalServer) {
    Open-LocalApp
    exit 0
}

if (-not (Test-Path -LiteralPath $DistIndex)) {
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    $viteScript = Join-Path $RepoRoot "node_modules\vite\bin\vite.js"
    if (-not $nodeCommand -or -not (Test-Path -LiteralPath $viteScript)) {
        throw "The local app is not built and Node.js/Vite is unavailable. Run the project setup first."
    }
    Push-Location $RepoRoot
    try {
        & $nodeCommand.Source $viteScript build
        if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $DistIndex)) {
            throw "The local frontend build failed."
        }
    } finally {
        Pop-Location
    }
}

$venvPython = Join-Path $RepoRoot ".venv\Scripts\python.exe"
if (Test-Path -LiteralPath $venvPython) {
    $pythonPath = $venvPython
    $pythonArguments = @($ServerScript, "--host", "127.0.0.1", "--port", "$Port")
} else {
    $pythonCommand = Get-Command py -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    }
    if (-not $pythonCommand) {
        throw "Python 3 is required for the local converter."
    }
    $pythonPath = $pythonCommand.Source
    $pythonArguments = @("-3", $ServerScript, "--host", "127.0.0.1", "--port", "$Port")
}

Start-Process `
    -FilePath $pythonPath `
    -ArgumentList $pythonArguments `
    -WorkingDirectory $RepoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog | Out-Null

$deadline = (Get-Date).AddSeconds(30)
while ((Get-Date) -lt $deadline) {
    if (Test-LocalServer) {
        Open-LocalApp
        exit 0
    }
    Start-Sleep -Milliseconds 400
}

throw "The local converter did not start. Check $StderrLog"
