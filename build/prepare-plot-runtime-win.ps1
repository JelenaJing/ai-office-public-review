param(
  [string]$PythonVersion = "3.10.11",
  [string]$RuntimeRoot = "build/plot-agent-runtime"
)

$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeRootPath = Join-Path $projectRoot $RuntimeRoot
$agentRoot = Resolve-Path (Join-Path $projectRoot "../merged-plot-agent")

Write-Host "[plot-runtime] projectRoot=$projectRoot"
Write-Host "[plot-runtime] runtimeRoot=$runtimeRootPath"
Write-Host "[plot-runtime] agentRoot=$agentRoot"

if (Test-Path $runtimeRootPath) {
  Remove-Item $runtimeRootPath -Recurse -Force
}
New-Item -ItemType Directory -Path $runtimeRootPath | Out-Null

$embedZip = Join-Path $env:TEMP "python-$PythonVersion-embed-amd64.zip"
$pythonUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"

Write-Host "[plot-runtime] downloading embedded python from $pythonUrl"
Invoke-WebRequest -Uri $pythonUrl -OutFile $embedZip
Expand-Archive -Path $embedZip -DestinationPath $runtimeRootPath -Force

$pthFile = Get-ChildItem -Path $runtimeRootPath -Filter "python*._pth" | Select-Object -First 1
if (-not $pthFile) {
  throw "未找到 python._pth 文件，无法启用 site-packages"
}

$pthContent = Get-Content $pthFile.FullName
$updatedPth = $pthContent | ForEach-Object {
  if ($_ -match '^#import site$') { 'import site' }
  elseif ($_ -match '^Lib\\site-packages$') { $_ }
  else { $_ }
}
if (-not ($updatedPth -contains 'Lib\site-packages')) {
  $updatedPth += 'Lib\site-packages'
}
Set-Content -Path $pthFile.FullName -Value $updatedPth -Encoding ASCII

$pythonExe = Join-Path $runtimeRootPath "python.exe"
if (-not (Test-Path $pythonExe)) {
  throw "未找到内嵌 python.exe"
}

$getPip = Join-Path $env:TEMP "get-pip.py"
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip

Write-Host "[plot-runtime] installing pip"
& $pythonExe $getPip --no-warn-script-location

Write-Host "[plot-runtime] installing merged-plot-agent dependencies"
& $pythonExe -m pip install --upgrade pip setuptools wheel --no-warn-script-location
& $pythonExe -m pip install -r (Join-Path $agentRoot "requirements.txt") --no-warn-script-location

$markerPath = Join-Path $runtimeRootPath "RUNTIME_READY.txt"
@(
  "plot-agent-runtime prepared successfully",
  "python=$PythonVersion",
  "generated_at=$(Get-Date -Format o)",
  "agent_root=$agentRoot"
) | Set-Content -Path $markerPath -Encoding UTF8

Write-Host "[plot-runtime] ready: $runtimeRootPath"