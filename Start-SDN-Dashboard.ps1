# ==============================================================================
# Self-Healing SDN Control Center — Windows 1-Click Launcher
# ==============================================================================
# Launches the FastAPI backend in WSL2 Ubuntu 22.04, serves the React NOC Dashboard,
# and automatically opens your default browser at http://localhost:8000.
# Zero manual terminal commands required!
# ==============================================================================

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   SELF-HEALING SDN CONTROL CENTER — LAUNCHER (WSL2)     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$WSL_DISTRO = "Ubuntu-22.04"
$URL = "http://localhost:8000"
$HEALTH_URL = "$URL/api/system/health"

# 1. Verify WSL is present
Write-Host "[1/4] Checking WSL2 environment..." -ForegroundColor Yellow
$wslList = wsl.exe -l -q
if (-not ($wslList -match "Ubuntu-22.04")) {
    Write-Host "Warning: Ubuntu-22.04 distro not found. Using default WSL distribution." -ForegroundColor Yellow
    $WSL_CMD = "wsl.exe"
} else {
    Write-Host "  ✓ Found Ubuntu-22.04." -ForegroundColor Green
    $WSL_CMD = "wsl.exe -d $WSL_DISTRO"
}

# 2. Start the backend server inside WSL
Write-Host "[2/4] Starting SDN backend server inside WSL..." -ForegroundColor Yellow
$scriptPath = "/mnt/c/Users/mdani/Projects/self-healing-sdn/scripts/start.sh"

# Start the WSL process in background
Start-Process -FilePath "wsl.exe" -ArgumentList "-d", $WSL_DISTRO, "bash", $scriptPath -WindowStyle Hidden

# 3. Wait for backend health check
Write-Host "[3/4] Waiting for SDN Control Center to initialize..." -ForegroundColor Yellow
$maxRetries = 25
$retry = 0
$serverReady = $false

while ($retry -lt $maxRetries) {
    Start-Sleep -Seconds 1
    try {
        $response = Invoke-RestMethod -Uri $HEALTH_URL -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
        if ($response.status -eq "healthy") {
            $serverReady = $true
            break
        }
    } catch {
        # Server still starting
    }
    $retry++
    Write-Host -NoNewline "."
}
Write-Host ""

if ($serverReady) {
    Write-Host "  ✓ SDN Backend is healthy and ready!" -ForegroundColor Green
} else {
    Write-Host "  Notice: Backend is taking longer to respond. Opening browser anyway..." -ForegroundColor Yellow
}

# 4. Open default Windows browser
Write-Host "[4/4] Opening NOC Dashboard in default browser..." -ForegroundColor Yellow
Start-Process $URL

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  ✓ Control Center is LIVE at $URL" -ForegroundColor Green
Write-Host "  Use the web interface to start simulations, select" -ForegroundColor White
Write-Host "  controllers, inject failures, and run experiments." -ForegroundColor White
Write-Host "  To stop: Run .\scripts\stop.sh in WSL or close processes." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Green
