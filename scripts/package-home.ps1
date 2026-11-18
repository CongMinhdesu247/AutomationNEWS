param(
    [string]$OutputDirectory = 'output'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $destination = New-Item -ItemType Directory -Path $OutputDirectory -Force
    # Include tracked + untracked non-ignored files that actually exist on disk,
    # strictly excluding build outputs, data/backups, secrets, and real .env files.
    $rawFiles = @(git ls-files --cached --others --exclude-standard)
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate project source files.' }

    $files = @(
        $rawFiles | Where-Object {
            $_ -and
            (Test-Path -LiteralPath $_ -PathType Leaf) -and
            $_ -notmatch '(^|/)(node_modules|dist|output|backups|data|releases|pages|secrets|artifacts|\.git|\.playwright-cli)/' -and
            $_ -notmatch '(^|/)PUBLIC_URL\.txt$' -and
            $_ -notmatch '\.rollback\.local\.ya?ml$' -and
            $_ -notmatch '\.(tar|tar\.gz|tgz|dump|bak)$' -and
            ($_ -notmatch '(^|/)\.env($|\.)' -or $_ -match '\.example$')
        } | Sort-Object -Unique
    )

    if ($files.Count -eq 0) { throw 'No source files matched packaging filter.' }

    $listPath = Join-Path $destination.FullName 'home-package-files.txt'
    $archiveName = 'automationnews-home.tar.gz'
    $archivePath = Join-Path $destination.FullName $archiveName
    $shaPath = Join-Path $destination.FullName 'SHA256SUMS'

    [IO.File]::WriteAllLines($listPath, $files, [Text.UTF8Encoding]::new($false))
    & "$env:SystemRoot\System32\tar.exe" -czf $archivePath -T $listPath
    if ($LASTEXITCODE -ne 0) { throw 'Source packaging failed.' }

    $hash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($shaPath, "$hash  $archiveName`n", [Text.UTF8Encoding]::new($false))

    Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
} finally {
    Pop-Location
}
