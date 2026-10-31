# ==============================================================================
# Self-Healing SDN Control Center - Windows 1-Click Launcher
# ==============================================================================

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   SELF-HEALING SDN CONTROL CENTER - LAUNCHER (WSL2)     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$PreferredDistro = "Ubuntu-22.04"
$PORT = 8000

# ------------------------------------------------------------------------------
# 1. Detect WSL
# ------------------------------------------------------------------------------

Write-Host "[1/4] Checking WSL environment..." -ForegroundColor Yellow

$wslList = wsl.exe -l -q

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: WSL is not available." -ForegroundColor Red
    exit 1
}

if ($wslList -match [regex]::Escape($PreferredDistro)) {
    $WSL_DISTRO = $PreferredDistro
    Write-Host "  Found $WSL_DISTRO." -ForegroundColor Green
}
else {
    $WSL_DISTRO = $null
    Write-Host "  Ubuntu-22.04 not found. Using default WSL distribution." -ForegroundColor Yellow
}

# ------------------------------------------------------------------------------
# 2. Detect project location
# ------------------------------------------------------------------------------

Write-Host "[2/4] Locating project and starting backend..." -ForegroundColor Yellow

$projectPath = $PSScriptRoot

if ([string]::IsNullOrWhiteSpace($projectPath)) {
    $projectPath = (Get-Location).Path
}

# Convert:
# E:\Projects\self-healing-sdn
# to:
# /mnt/e/Projects/self-healing-sdn

if ($projectPath -notmatch '^[A-Za-z]:\\') {
    Write-Host "ERROR: Project must be located on a Windows drive." -ForegroundColor Red
    exit 1
}

$driveLetter = $projectPath.Substring(0, 1).ToLower()
$pathWithoutDrive = $projectPath.Substring(2).Replace('\', '/')
$wslProjectPath = "/mnt/$driveLetter$pathWithoutDrive"

$scriptPath = "$wslProjectPath/scripts/start.sh"

Write-Host "  Windows project: $projectPath" -ForegroundColor Gray
Write-Host "  WSL project:     $wslProjectPath" -ForegroundColor Gray

# Verify start.sh exists
if ($null -ne $WSL_DISTRO) {
    wsl.exe -d $WSL_DISTRO test -f $scriptPath
}
else {
    wsl.exe test -f $scriptPath
}

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: scripts/start.sh was not found." -ForegroundColor Red
    exit 1
}

# Start backend in a separate WSL window
if ($null -ne $WSL_DISTRO) {
    Start-Process `
        -FilePath "wsl.exe" `
        -ArgumentList "-d", $WSL_DISTRO, "bash", $scriptPath
}
else {
    Start-Process `
        -FilePath "wsl.exe" `
        -ArgumentList "bash", $scriptPath
}

# ------------------------------------------------------------------------------
# 3. Detect WSL IP and wait for backend
# ------------------------------------------------------------------------------

Write-Host "[3/4] Waiting for SDN Control Center to initialize..." -ForegroundColor Yellow

# Give WSL a moment to initialize
Start-Sleep -Seconds 1

if ($null -ne $WSL_DISTRO) {
    $ipOutput = wsl.exe -d $WSL_DISTRO hostname -I
}
else {
    $ipOutput = wsl.exe hostname -I
}

$WSL_IP = ($ipOutput.Trim() -split '\s+')[0]

if ([string]::IsNullOrWhiteSpace($WSL_IP)) {
    Write-Host "ERROR: Could not determine WSL IP address." -ForegroundColor Red
    exit 1
}

$URL = "http://${WSL_IP}:$PORT"
$HEALTH_URL = "$URL/api/system/health"

Write-Host "  WSL IP: $WSL_IP" -ForegroundColor Gray
Write-Host "  Waiting for: $HEALTH_URL" -ForegroundColor Gray
Write-Host "  Enter your WSL sudo password in the opened WSL window if requested." -ForegroundColor Yellow

$maxRetries = 120
$retry = 0
$serverReady = $false

while ($retry -lt $maxRetries) {

    try {
        $response = Invoke-RestMethod `
            -Uri $HEALTH_URL `
            -Method Get `
            -TimeoutSec 2 `
            -ErrorAction Stop

        if ($response.status -eq "healthy") {
            $serverReady = $true
            break
        }
    }
    catch {
        # Backend is still starting
    }

    Start-Sleep -Seconds 1
    $retry++
    Write-Host -NoNewline "."
}

Write-Host ""

if (-not $serverReady) {
    Write-Host "ERROR: Backend did not become healthy." -ForegroundColor Red
    Write-Host "Check the WSL backend window for errors." -ForegroundColor Yellow
    exit 1
}

Write-Host "  SDN Backend is healthy and ready!" -ForegroundColor Green

# ------------------------------------------------------------------------------
# 4. Open dashboard
# ------------------------------------------------------------------------------

Write-Host "[4/4] Opening NOC Dashboard..." -ForegroundColor Yellow

Start-Process $URL

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Control Center is LIVE at $URL" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green