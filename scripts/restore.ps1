param(
 [Parameter(Mandatory=$true)][string]$BackupFile,
 [Parameter(Mandatory=$true)][ValidatePattern('^hub_restore_[a-z0-9_]{1,40}$')][string]$Database,
 [string[]]$ComposeFile=@('infra/compose.yaml'),
 [string]$EnvFile='.env',
 [string]$Project='',
 [switch]$DropOnFailure
)
$ErrorActionPreference='Stop'
$composeArgs=@('compose')
if($Project){$composeArgs+=@('-p',$Project)}
if($EnvFile){$composeArgs+=@('--env-file',$EnvFile)}
foreach($file in $ComposeFile){$composeArgs+=@('-f',$file)}
$source=(Resolve-Path -LiteralPath $BackupFile).Path
$archive='/tmp/hub-restore-'+[guid]::NewGuid().ToString('N')+'.dump'
$created=$false
try {
 # createdb fails if the named database already exists. No --clean/drop/overwrite on existing DBs.
 & docker @composeArgs exec -T db sh -c 'createdb -U "$POSTGRES_USER" --template=template0 "$1"' sh $Database
 if($LASTEXITCODE -ne 0){throw 'New restore database could not be created; existing databases are never overwritten.'}
 $created=$true
 & docker @composeArgs cp $source "db:$archive"
 if($LASTEXITCODE -ne 0){throw 'Copy archive failed'}
 & docker @composeArgs exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$1" --single-transaction --exit-on-error --no-owner --no-acl "$2"' sh $Database $archive
 if($LASTEXITCODE -ne 0){
  if($DropOnFailure){& docker @composeArgs exec -T db sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh $Database | Out-Null}
  throw 'Restore failed; inspect or pass -DropOnFailure to clean up the empty target database.'
 }
 Write-Output "Restored into new database: $Database"
}finally{& docker @composeArgs exec -T db rm -f $archive | Out-Null}
