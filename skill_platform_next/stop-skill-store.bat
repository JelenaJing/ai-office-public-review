@echo off
setlocal

cd /d "%~dp0"

if not exist ".pids\skill-platform-pids.json" (
  echo PID file not found, trying to stop by ports...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ports = 4010,4020,4030;" ^
    "foreach ($port in $ports) {" ^
    "  $lines = netstat -ano | Select-String (':'+$port+' ');" ^
    "  foreach ($line in $lines) {" ^
    "    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' };" ^
    "    if ($parts.Length -ge 5) { $procId = [int]$parts[-1]; try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {} }" ^
    "  }" ^
    "}"
  echo Done.
  endlocal
  exit /b 0
)

echo Stopping services from PID file...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$pidFile = '.pids\skill-platform-pids.json';" ^
  "$data = Get-Content $pidFile -Raw | ConvertFrom-Json;" ^
  "foreach ($p in $data.services) {" ^
  "  if ($p.pid) {" ^
  "    try { Stop-Process -Id $p.pid -Force -ErrorAction Stop; Write-Output ('Stopped '+$p.name+' (PID '+$p.pid+')') }" ^
  "    catch { Write-Output ('Skip '+$p.name+' (PID '+$p.pid+')') }" ^
  "  }" ^
  "}"

echo Ensuring ports 4010/4020/4030 are released...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ports = 4010,4020,4030;" ^
  "foreach ($port in $ports) {" ^
  "  $lines = netstat -ano | Select-String (':'+$port+' ');" ^
  "  foreach ($line in $lines) {" ^
  "    $parts = ($line.ToString() -split '\s+') | Where-Object { $_ -ne '' };" ^
  "    if ($parts.Length -ge 5) { $procId = [int]$parts[-1]; try { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue } catch {} }" ^
  "  }" ^
  "}"

del /q ".pids\library.pid" 2>nul
del /q ".pids\engine.pid" 2>nul
del /q ".pids\store.pid" 2>nul
del /q ".pids\skill-platform-pids.json" 2>nul

echo All done.
endlocal
