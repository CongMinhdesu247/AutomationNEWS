param(
 [string]$ComposeFile='infra/compose.yaml', [string]$EnvFile='.env',
 [string]$OutputFile=('output/backups/hub-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.dump')
)
$ErrorActionPreference='Stop'
$composeArgs=@('compose');if($EnvFile){$composeArgs+=@('--env-file',$EnvFile)};$composeArgs+=@('-f',$ComposeFile)
$resolvedOutput=[IO.Path]::GetFullPath($OutputFile)
if(Test-Path -LiteralPath $resolvedOutput){throw 'Backup file already exists; choose a new path.'}
$backupDirectory=Split-Path -Parent $resolvedOutput;New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$archive='/tmp/hub-backup-'+[guid]::NewGuid().ToString('N')+'.dump'
try {
 & docker @composeArgs exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl -f "$1"' sh $archive
 if($LASTEXITCODE -ne 0){throw 'pg_dump failed'}
 & docker @composeArgs cp "db:$archive" $resolvedOutput
 if($LASTEXITCODE -ne 0){throw 'Copy archive failed'}
 Get-FileHash -LiteralPath $resolvedOutput -Algorithm SHA256
}finally{& docker @composeArgs exec -T db rm -f $archive | Out-Null}
