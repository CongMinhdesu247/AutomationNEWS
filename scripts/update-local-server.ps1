param(
    [string]$SshTarget = $env:AUTOMATIONNEWS_SSH,
    [string]$RemoteAppDir = '/home/congminh/apps/AutomationNEWS',
    [switch]$SyncPremiumEnv,
    [switch]$PackageOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    Write-Host '[1/3] Packaging clean AutomationNEWS source archive...' -ForegroundColor Cyan
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'package-home.ps1') -OutputDirectory 'output'
    if ($LASTEXITCODE -ne 0) { throw 'Packaging failed.' }

    $archivePath = Join-Path $projectRoot 'output\automationnews-home.tar.gz'
    $shaPath = Join-Path $projectRoot 'output\SHA256SUMS'
    $updateScriptPath = Join-Path $PSScriptRoot 'server-update.sh'

    if ($PackageOnly -or [string]::IsNullOrWhiteSpace($SshTarget)) {
        Write-Host "`nArchive ready at: $archivePath" -ForegroundColor Green
        Write-Host "SHA256SUMS ready at: $shaPath" -ForegroundColor Green
        if ([string]::IsNullOrWhiteSpace($SshTarget) -and -not $PackageOnly) {
            Write-Host "`nTip: Pass -SshTarget 'congminh@<SERVER_IP>' (or set `$env:AUTOMATIONNEWS_SSH) to push & update automatically over SSH." -ForegroundColor Yellow
        }
        return
    }

    Write-Host "[2/3] Checking SSH connection to $SshTarget..." -ForegroundColor Cyan
    & ssh -o BatchMode=yes -o ConnectTimeout=8 $SshTarget 'echo SSH_OK' | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot connect to '$SshTarget' over non-interactive SSH. Ensure your SSH public key is authorized on the server, or copy output\automationnews-home.tar.gz + scripts\server-update.sh manually."
    }

    $stageDir = "/tmp/automationnews-release-$([DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ'))"
    & ssh $SshTarget "umask 077 && mkdir -p '$stageDir'"
    if ($LASTEXITCODE -ne 0) { throw 'Failed to create staging directory on server.' }

    $scpItems = @($archivePath, $shaPath, $updateScriptPath)
    $localPremiumEnv = Join-Path $projectRoot 'secrets\.env.premium'
    if ($SyncPremiumEnv) {
        if (-not (Test-Path -LiteralPath $localPremiumEnv -PathType Leaf)) {
            throw "secrets\.env.premium not found on PC, cannot use -SyncPremiumEnv."
        }
        $scpItems += $localPremiumEnv
    }

    Write-Host "[3/3] Uploading package to $SshTarget`:$stageDir and running incremental server update..." -ForegroundColor Cyan
    & scp @scpItems "${SshTarget}:${stageDir}/"
    if ($LASTEXITCODE -ne 0) { throw 'SCP upload failed.' }

    $remoteCmd = "set -euo pipefail; cd '$stageDir'; sha256sum -c SHA256SUMS"
    if ($SyncPremiumEnv) {
        $remoteCmd += "; install -m 600 .env.premium '$RemoteAppDir/.env.premium'"
    }
    $remoteCmd += "; bash server-update.sh --app-dir '$RemoteAppDir' --archive '$stageDir/automationnews-home.tar.gz'; rm -rf '$stageDir'"

    & ssh $SshTarget $remoteCmd
    if ($LASTEXITCODE -ne 0) { throw 'Remote server update failed (auto-rollback triggered if services were paused).' }

    Write-Host "`nLocal Server updated successfully with zero data loss!" -ForegroundColor Green
} finally {
    Pop-Location
}
