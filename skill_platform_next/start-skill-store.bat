@echo off
setlocal

cd /d "%~dp0"

if not exist ".pids" mkdir ".pids"

echo [1/4] Checking existing processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pidFile = '.pids\skill-platform-pids.json';" ^
  "if (Test-Path $pidFile) {" ^
  "  try {" ^
  "    $data = Get-Content $pidFile -Raw | ConvertFrom-Json;" ^
  "    foreach ($p in $data.services) { if ($p.pid) { try { Stop-Process -Id $p.pid -Force -ErrorAction SilentlyContinue } catch {} } }" ^
  "  } catch {}" ^
  "}"

echo [2/4] Starting skill-library-backend (4010)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Start-Process -FilePath node -ArgumentList 'services/skill-library-backend/src/server.js' -WorkingDirectory '%cd%' -PassThru;" ^
  "$p.Id | Out-File '.pids\library.pid' -Encoding ascii"

echo [3/4] Starting skill-engine (4020)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Start-Process -FilePath node -ArgumentList 'services/skill-engine/src/server.js' -WorkingDirectory '%cd%' -PassThru;" ^
  "$p.Id | Out-File '.pids\engine.pid' -Encoding ascii"

echo [4/4] Starting skill-store-web (4030)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p = Start-Process -FilePath node -ArgumentList 'apps/skill-store-web/server.js' -WorkingDirectory '%cd%' -PassThru;" ^
  "$p.Id | Out-File '.pids\store.pid' -Encoding ascii"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$lib = (Get-Content '.pids\library.pid' -Raw).Trim();" ^
  "$eng = (Get-Content '.pids\engine.pid' -Raw).Trim();" ^
  "$sto = (Get-Content '.pids\store.pid' -Raw).Trim();" ^
  "$obj = [pscustomobject]@{ started_at = (Get-Date).ToString('s'); services = @(" ^
  "  [pscustomobject]@{name='library';pid=[int]$lib;port=4010}," ^
  "  [pscustomobject]@{name='engine';pid=[int]$eng;port=4020}," ^
  "  [pscustomobject]@{name='store';pid=[int]$sto;port=4030}" ^
  ") };" ^
  "$obj | ConvertTo-Json -Depth 4 | Set-Content '.pids\skill-platform-pids.json' -Encoding UTF8"

echo.
echo Skill Store started.
echo - Login page: http://localhost:4030/login
echo - Store page: http://localhost:4030/store
echo.
echo Use stop-skill-store.bat to stop all services.
endlocal
