$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$inference = Join-Path $root "inference"
$frontend = Join-Path $root "frontend"
$venvPython = Join-Path $inference ".venv\Scripts\python.exe"

if (-not (Test-Path $venvPython)) {
  Write-Host "Creating inference venv and installing dependencies..."
  Push-Location $inference
  py -m venv .venv
  & .\.venv\Scripts\python.exe -m pip install -U pip
  & .\.venv\Scripts\python.exe -m pip install -e .[dev]
  Pop-Location
}

Write-Host "Starting backend API on http://127.0.0.1:8000 ..."
Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "cd '$inference'; .\.venv\Scripts\python.exe -m uvicorn api.main:app --host 127.0.0.1 --port 8000"

Write-Host "Starting frontend on http://127.0.0.1:5174 ..."
Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoExit", "-Command", "cd '$frontend'; npm run dev -- --host 127.0.0.1 --port 5174 --strictPort"

Write-Host "Done. Open http://127.0.0.1:5174"

