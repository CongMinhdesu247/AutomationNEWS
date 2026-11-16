param(
    [string]$OutputDirectory = 'output'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    $destination = New-Item -ItemType Directory -Path $OutputDirectory -Force
    $files = @(git ls-files --cached --others --exclude-standard | Where-Object {
        $_ -notmatch '(^|/)(node_modules|dist|output|secrets|\.git|\.playwright-cli)/' -and
        ($_ -notmatch '(^|/)\.env($|\.)' -or $_ -match '\.example$')
    })
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate project source files.' }
    $listPath = Join-Path $destination.FullName 'home-package-files.txt'
    $archivePath = Join-Path $destination.FullName 'automationnews-home.tar.gz'
    [IO.File]::WriteAllLines($listPath, $files, [Text.UTF8Encoding]::new($false))
    tar -czf $archivePath -T $listPath
    if ($LASTEXITCODE -ne 0) { throw 'Source packaging failed.' }
    Get-FileHash $archivePath -Algorithm SHA256
} finally { Pop-Location }
