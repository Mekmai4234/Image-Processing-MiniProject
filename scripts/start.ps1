param([string]$Python = '', [string]$NpmCli = '', [int]$Port = 8000)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $projectRoot
$runtimeFile = Join-Path $projectRoot '.tools/runtime.json'
if (Test-Path -LiteralPath $runtimeFile) {
    $runtime = Get-Content -LiteralPath $runtimeFile -Raw | ConvertFrom-Json
    if (-not $Python) { $Python = $runtime.python }
    if (-not $NpmCli) { $NpmCli = $runtime.npmCli }
}
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (-not $Python) {
    if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
        python -m venv .venv
        if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.11+ first.' }
    }
    $Python = Join-Path $projectRoot '.venv/Scripts/python.exe'
    & $Python -m pip install -r apps/backend/requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Backend dependencies failed to install.' }
}
Push-Location -LiteralPath 'apps/web'
try {
    if ($NpmCli) { node $NpmCli ci } else { & npm.cmd ci }
    if ($LASTEXITCODE -ne 0) { throw 'Frontend dependency installation failed.' }
    # Same-origin browser requests work on any chosen port without rebuilding a server URL.
    $env:VITE_API_BASE_URL = "http://127.0.0.1:$Port"
    if ($NpmCli) { node $NpmCli run build } else { & npm.cmd run build }
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Write-Host "Open http://127.0.0.1:$Port/settings to configure your references. Ctrl+C stops the app."
& $Python -m uvicorn app.main:app --app-dir apps/backend --host 127.0.0.1 --port $Port
