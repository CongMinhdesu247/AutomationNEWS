param(
 [Parameter(Mandatory=$true)][ValidateSet('hub-v1-review','hub-v1-demo')][string]$Project,
 [Parameter(Mandatory=$true)][ValidatePattern('^http://127\.0\.0\.1:\d+$')][string]$BaseUrl,
 [string]$ComposeFile='infra/compose.yaml', [string]$EnvFile='.env'
)
$ErrorActionPreference='Stop'
$composeArgs=@('compose','-p',$Project);if($EnvFile){$composeArgs+=@('--env-file',$EnvFile)};$composeArgs+=@('-f',$ComposeFile)
function Docker-Checked([string[]]$Arguments){$result=& docker @Arguments;if($LASTEXITCODE -ne 0){throw 'Docker command failed during isolated DNS test.'};return $result}
$apiId=(Docker-Checked ($composeArgs+@('ps','-q','api'))).Trim()
$webId=(Docker-Checked ($composeArgs+@('ps','-q','web'))).Trim()
if(!$apiId -or !$webId){throw 'Start the isolated project first.'}
$owner=(Docker-Checked @('inspect','-f','{{index .Config.Labels "com.docker.compose.project"}}',$apiId)).Trim()
if($owner -ne $Project){throw 'Project ownership mismatch.'}
$image=(Docker-Checked @('inspect','-f','{{.Config.Image}}',$apiId)).Trim()
Docker-Checked @('image','inspect',$image,'--format','{{.Id}}') | Out-Null
$network=$Project+'_default'
$networks=(Docker-Checked @('inspect','-f','{{json .NetworkSettings.Networks}}',$apiId)) | ConvertFrom-Json
$oldAddress=$networks.$network.IPAddress
if(!$oldAddress){throw 'Expected isolated default network not found.'}
Invoke-RestMethod ($BaseUrl+'/api/ready') -TimeoutSec 5 | Out-Null
$holder=$Project+'-dns-holder';$created=$false
try {
 # Remove only this test project's stateless API. Never remove DB/volume.
 Docker-Checked ($composeArgs+@('stop','api')) | Out-Null
 Docker-Checked ($composeArgs+@('rm','-f','api')) | Out-Null
 # Reserve the old IP so the replacement API must receive a different address.
 Docker-Checked @('run','-d','--name',$holder,'--network',$network,'--ip',$oldAddress,'--entrypoint','node',$image,'-e','setInterval(()=>{},1000)') | Out-Null
 $created=$true
 Docker-Checked ($composeArgs+@('up','-d','--no-deps','--wait','api')) | Out-Null
 $replacement=(Docker-Checked ($composeArgs+@('ps','-q','api'))).Trim()
 $networks=(Docker-Checked @('inspect','-f','{{json .NetworkSettings.Networks}}',$replacement)) | ConvertFrom-Json
 if($networks.$network.IPAddress -eq $oldAddress){throw 'Test did not change API IP.'}
 if((Docker-Checked ($composeArgs+@('ps','-q','web'))).Trim() -ne $webId){throw 'Web was unexpectedly recreated.'}
 $deadline=(Get-Date).AddSeconds(30);$ready=$false
 do {try{$value=Invoke-RestMethod ($BaseUrl+'/api/ready') -TimeoutSec 4;$ready=$value.status -eq 'ready'}catch{};if(!$ready){Start-Sleep -Milliseconds 500}}while(!$ready -and (Get-Date) -lt $deadline)
 if(!$ready){throw 'Nginx did not recover after API changed IP.'}
 Invoke-RestMethod ($BaseUrl+'/api/settings') -TimeoutSec 5 | Out-Null
 Write-Output 'PASS: replacement API has a new IP; unchanged Nginx recovers REST through Docker DNS.'
}finally{if($created){Docker-Checked @('rm','-f',$holder) | Out-Null}}
