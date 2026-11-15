$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location -LiteralPath $projectRoot
try {
    New-Item -ItemType Directory -Path output -Force | Out-Null
    $files = @(git ls-files --cached --others --exclude-standard | Where-Object {
        $_ -notmatch '(^|/)(node_modules|dist|output|secrets|\.git|\.playwright-cli)/' -and
        ($_ -notmatch '(^|/)\.env($|\.)' -or $_ -match '\.example$')
    })
    if ($LASTEXITCODE -ne 0) { throw 'Cannot enumerate project source files.' }
    $listPath = Join-Path $projectRoot 'output/home-package-files.txt'
    [IO.File]::WriteAllLines($listPath, $files, [Text.UTF8Encoding]::new($false))
    tar -czf output/automationnews-home.tar.gz -T $listPath
    if ($LASTEXITCODE -ne 0) { throw 'Source packaging failed.' }
    Get-FileHash output/automationnews-home.tar.gz -Algorithm SHA256
} finally { Pop-Location }
