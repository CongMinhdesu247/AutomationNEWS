param(
    [string]$SshTarget = $(if ($env:AUTOMATIONNEWS_SSH) { $env:AUTOMATIONNEWS_SSH } else { 'congminh@100.95.33.63' }),
    [string]$IdentityFile = $(if (Test-Path "$env:USERPROFILE\.ssh\homeserver_ed25519") { "$env:USERPROFILE\.ssh\homeserver_ed25519" } else { '' }),
    [string]$RemoteAppDir = '/home/congminh/apps/AutomationNEWS',
    [switch]$SyncPremiumEnv,
    [switch]$PackageOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    Write-Host '[1/2] Packaging clean AutomationNEWS source archive...' -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'package-home.ps1') -OutputDirectory 'output'
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }

    $archivePath = Join-Path $projectRoot 'output\automationnews-home.tar.gz'
    $shaPath = Join-Path $projectRoot 'output\SHA256SUMS'
    $updateScriptPath = Join-Path $PSScriptRoot 'server-update.sh'

    if ($PackageOnly -or [string]::IsNullOrWhiteSpace($SshTarget)) {
        Write-Host "`nArchive ready at: $archivePath" -ForegroundColor Green
        Write-Host "SHA256SUMS ready at: $shaPath" -ForegroundColor Green
        return
    }

    # Build a single transfer bundle so SSH only prompts for the key passphrase once
    $bundleStage = Join-Path $projectRoot 'output\deploy-stage'
    if (Test-Path -LiteralPath $bundleStage) { Remove-Item -LiteralPath $bundleStage -Recurse -Force }
    New-Item -ItemType Directory -Path $bundleStage -Force | Out-Null
    Copy-Item -LiteralPath $archivePath -Destination (Join-Path $bundleStage 'automationnews-home.tar.gz')
    Copy-Item -LiteralPath $shaPath -Destination (Join-Path $bundleStage 'SHA256SUMS')
    Copy-Item -LiteralPath $updateScriptPath -Destination (Join-Path $bundleStage 'server-update.sh')

    $localPremiumEnv = Join-Path $projectRoot 'secrets\.env.premium'
    if ($SyncPremiumEnv) {
        if (-not (Test-Path -LiteralPath $localPremiumEnv -PathType Leaf)) {
            throw "secrets\.env.premium not found on PC, cannot use -SyncPremiumEnv."
        }
        Copy-Item -LiteralPath $localPremiumEnv -Destination (Join-Path $bundleStage '.env.premium')
    }

    $bundlePath = Join-Path $projectRoot 'output\automationnews-deploy-bundle.tar.gz'
    & "$env:SystemRoot\System32\tar.exe" -czf $bundlePath -C $bundleStage .
    Remove-Item -LiteralPath $bundleStage -Recurse -Force
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create deployment transfer bundle.' }

    $bashLines = @(
        'set -euo pipefail'
        'umask 077'
        'stage="$(mktemp -d /tmp/automationnews-release.XXXXXX)"'
        'trap ''rm -rf "$stage"'' EXIT'
        'tar -xzf - -C "$stage"'
        'cd "$stage"'
        'sha256sum -c SHA256SUMS'
    )
    if ($SyncPremiumEnv) {
        $escapedAppDir = $RemoteAppDir.Replace("'", "'\''")
        $bashLines += "install -m 600 .env.premium '$escapedAppDir/.env.premium'"
    }
    $escapedAppDir = $RemoteAppDir.Replace("'", "'\''")
    $bashLines += @(
        'sed -i ''s/\r$//'' server-update.sh'
        "bash server-update.sh --app-dir '$escapedAppDir' --archive ""`$stage/automationnews-home.tar.gz"""
    )
    $bashScript = ($bashLines -join "`n")
    $bashB64 = [Convert]::ToBase64String([Text.UTF8Encoding]::new($false).GetBytes($bashScript))

    $sshParts = @('ssh', '-o', 'ConnectTimeout=15')
    if (-not [string]::IsNullOrWhiteSpace($IdentityFile)) {
        if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) {
            throw "SSH identity file not found: $IdentityFile"
        }
        $sshParts += @('-i', "`"$IdentityFile`"")
    }
    $sshParts += @($SshTarget, "`"umask 077 && echo $bashB64 | base64 -d > /tmp/.an_upd.sh && bash /tmp/.an_upd.sh; rc=`$?; rm -f /tmp/.an_upd.sh; exit `$rc`"")
    $cmdLine = ($sshParts -join ' ') + " < `"$bundlePath`""

    Write-Host "[2/2] Streaming package to $SshTarget and running zero-data-loss server update (1 passphrase prompt)..." -ForegroundColor Cyan
    & cmd.exe /c $cmdLine
    if ($LASTEXITCODE -ne 0) {
        throw 'Remote server update failed (auto-rollback triggered if services were paused).'
    }

    Write-Host "`nLocal Server ($SshTarget) updated successfully with zero data loss!" -ForegroundColor Green
} finally {
    Pop-Location
}
