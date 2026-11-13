param(
 [Parameter(Mandatory=$true)][string]$BackupFile,
 [Parameter(Mandatory=$true)][ValidatePattern('^hub_restore_[a-z0-9_]{1,40}$')][string]$Database,
 [string]$ComposeFile='infra/compose.yaml',[string]$EnvFile='.env'
)
$ErrorActionPreference='Stop'
$composeArgs=@('compose');if($EnvFile){$composeArgs+=@('--env-file',$EnvFile)};$composeArgs+=@('-f',$ComposeFile)
$source=(Resolve-Path -LiteralPath $BackupFile).Path
$archive='/tmp/hub-restore-'+[guid]::NewGuid().ToString('N')+'.dump'
try {
 # createdb fails if the named database already exists. No --clean/drop/overwrite.
 & docker @composeArgs exec -T db sh -c 'createdb -U "$POSTGRES_USER" --template=template0 "$1"' sh $Database
 if($LASTEXITCODE -ne 0){throw 'New restore database could not be created; existing databases are never overwritten.'}
 & docker @composeArgs cp $source "db:$archive"
 if($LASTEXITCODE -ne 0){throw 'Copy archive failed'}
 & docker @composeArgs exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --single-transaction --exit-on-error --no-owner --no-acl "$2"' sh $Database $archive
 if($LASTEXITCODE -ne 0){throw 'Restore failed; inspect the new database before reusing it.'}
 Write-Output "Restored into new database: $Database"
}finally{& docker @composeArgs exec -T db rm -f $archive | Out-Null}
