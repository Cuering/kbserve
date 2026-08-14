#!/usr/bin/env pwsh
<#
.SYNOPSIS
  kbserve Windows one-click installer: main service + plugins + sandbox.
.DESCRIPTION
  - Ensures bun is installed.
  - Clones the three kbserve repos (or reuses an existing folder).
  - Runs bun install for main and sandbox.
  - Priming plugins (telegram-bot, web-search) into ~/.kbserve/plugins.
  - Writes .env for the main service.
  - Registers two logon auto-start tasks: kbserve-main-3090 / kbserve-sandbox-3099.
  - Opens the dashboard.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1
  powershell -ExecutionPolicy Bypass -File install.ps1 -InstallDir "$HOME\kbserve" -Port 3090 -SandboxPort 3099
#>
[CmdletBinding()]
param(
    [string]$InstallDir = (Join-Path $HOME "kbserve"),
    [int]$Port = 3090,
    [int]$SandboxPort = 3099,
    [switch]$SkipAutoStart,
    [switch]$OpenBrowser = $true
)

$ErrorActionPreference = "Stop"
$REPO_MAIN    = "https://github.com/Cuering/kbserve.git"
$REPO_PLUGINS = "https://github.com/Cuering/kbserve-plugins.git"
$REPO_SANDBOX = "https://github.com/Cuering/kbserve-sandbox.git"
$EvolveHome   = Join-Path $HOME ".kbserve"
$PluginsDir   = Join-Path $EvolveHome "plugins"

function Write-Step([string]$msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg)   { Write-Host "    $msg" -ForegroundColor Green }

# ---------------------------------------------------------------- 1. bun
Write-Step "Checking bun..."
$bunPath = (Get-Command bun -ErrorAction SilentlyContinue).Source
if (-not $bunPath) {
    Write-Step "bun not found. Installing via https://bun.sh/install..."
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
    $env:Path = "$HOME\.bun\bin;$env:Path"
    $bunPath = (Get-Command bun -ErrorAction SilentlyContinue).Source
    if (-not $bunPath) { throw "bun installation failed. Re-run and ensure https://bun.sh/install works." }
}
Write-Ok "bun at: $bunPath"

# ---------------------------------------------------------------- 2. clone / reuse
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Function Get-Repo([string]$url, [string]$dest, [string]$name) {
    $target = Join-Path $dest $name
    if (Test-Path (Join-Path $target ".git")) {
        Write-Step "Updating $name..."
        git -C $target pull --ff-only
    } else {
        Write-Step "Cloning $name..."
        git clone --depth 1 --quiet $url $target
    }
    return $target
}
$MainDir    = Get-Repo $REPO_MAIN    $InstallDir "kbserve"
$PluginsDirRepo = Get-Repo $REPO_PLUGINS $InstallDir "kbserve-plugins"
$SandboxDir = Get-Repo $REPO_SANDBOX $InstallDir "kbserve-sandbox"

# ---------------------------------------------------------------- 3. bun install
Write-Step "Installing dependencies (main)..."
New-Item -ItemType Directory -Path $EvolveHome -Force | Out-Null
Push-Location $MainDir
& $bunPath install --production
if (-not $?) { Pop-Location; throw "bun install failed (main)" }
Pop-Location

if (Test-Path (Join-Path $SandboxDir "package.json")) {
    Write-Step "Installing dependencies (sandbox)..."
    Push-Location $SandboxDir
    & $bunPath install --production
    if (-not $?) { Pop-Location; throw "bun install failed (sandbox)" }
    Pop-Location
}

# ---------------------------------------------------------------- 4. prime plugins
Write-Step "Priming plugins into $PluginsDir..."
New-Item -ItemType Directory -Path $PluginsDir -Force | Out-Null
$candidates = @("telegram-bot", "web-search", "rate-limiter")
foreach ($name in $candidates) {
    $src = Join-Path $PluginsDirRepo $name
    if (Test-Path $src) {
        $dst = Join-Path $PluginsDir $name
        if (-not (Test-Path $dst)) { Copy-Item -Recurse -Path $src -Destination $PluginsDir }
        Write-Ok "plugin: $name"
    }
}

# ---------------------------------------------------------------- 5. .env (main)
$envFile = Join-Path $MainDir ".env"
if (-not (Test-Path $envFile)) {
    Write-Step "Writing .env for main service..."
    @(
        "KBSERVE_PORT=$Port",
        "EVOLVE_HOME=$EvolveHome",
        "NODE_ENV=production"
    ) | Set-Content -Path $envFile -Encoding ascii
    Write-Ok "created: $envFile (edit to customize)"
}

# ---------------------------------------------------------------- 6. logon auto-start tasks
if (-not $SkipAutoStart) {
    Write-Step "Registering logon auto-start tasks..."
    $taskDefs = @(
        @{ Name = "kbserve-main-$Port";      Dir = $MainDir;    EnvPort = $Port },
        @{ Name = "kbserve-sandbox-$SandboxPort"; Dir = $SandboxDir; EnvPort = $SandboxPort }
    )
    foreach ($t in $taskDefs) {
        $existing = Get-ScheduledTask -TaskName $t.Name -ErrorAction SilentlyContinue
        if ($existing) {
            Write-Ok "task exists, skipping: $($t.Name)"
            continue
        }
        # Launch a hidden PowerShell that sets env vars then runs bun serve.ts
        $psCmd = "`$env:KBSERVE_PORT='$($t.EnvPort)'; `$env:EVOLVE_HOME='$EvolveHome'; Set-Location '$($t.Dir)'; & '$bunPath' serve.ts"
        $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($psCmd))
        $action = New-ScheduledTaskAction -Execute "powershell.exe" `
            -Argument "-NoProfile -ExecutionPolicy Bypass -EncodedCommand $encoded"
        $trigger = New-ScheduledTaskTrigger -AtLogOn
        try {
            Register-ScheduledTask -TaskName $t.Name -Action $action -Trigger $trigger `
                -Description "kbserve auto-start ($($t.Name))" -Force | Out-Null
            Write-Ok "registered: $($t.Name)"
        } catch {
            Write-Host "    WARNING: could not register $($t.Name): $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }
}

# ---------------------------------------------------------------- 7. open dashboard
if ($OpenBrowser) {
    Write-Step "Starting main service..."
    try {
        Start-Process powershell -ArgumentList "-NoProfile -ExecutionPolicy Bypass -Command", `
            "`$env:KBSERVE_PORT='$Port'; `$env:EVOLVE_HOME='$EvolveHome'; Set-Location '$MainDir'; & '$bunPath' serve.ts" -WindowStyle Hidden
    } catch { Write-Host "    WARNING: could not auto-start: $($_.Exception.Message)" -ForegroundColor Yellow }
    Start-Sleep -Seconds 2
    try { Start-Process "http://127.0.0.1:$Port" } catch {}
}

Write-Host ""
Write-Host "==> kbserve installation complete!" -ForegroundColor Green
Write-Host "    Main   : http://127.0.0.1:$Port     -> $MainDir"
Write-Host "    Sandbox: http://127.0.0.1:$SandboxPort -> $SandboxDir"
Write-Host "    Data   : $EvolveHome"
Write-Host ""
Write-Host "==> Next steps:"
Write-Host "    1. Edit .env in $MainDir if needed"
Write-Host "    2. Edit HTTPS: see docs/deployment/ssl-setup.md"
Write-Host "    3. Manage plugins:  http://127.0.0.1:$Port -> Plugins / Marketplace tabs"
Write-Host "    4. Remove auto-start: Unregister-ScheduledTask -TaskName kbserve-main-$Port / kbserve-sandbox-$SandboxPort"