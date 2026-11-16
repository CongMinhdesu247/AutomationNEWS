#!/usr/bin/env bash
# Read-only inventory for the existing HP installation. Does not print secrets.
set -euo pipefail
cd /home/congminh/apps/AutomationNEWS
printf 'HOST\n'
hostname
uname -m
docker compose version --short
printf '\nAPPLICATION\n'
docker ps --filter label=com.docker.compose.project=automationnews --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'
printf '\nDATABASE STORAGE\n'
docker inspect automationnews-db-1 --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
printf '\nLATEST MIGRATIONS\n'
docker exec automationnews-db-1 sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 6"'
printf '\nCAPACITY\n'
free -h
df -h . /var/lib/docker
printf '\nPUBLIC ORIGIN AND PREMIUM SWITCHES\n'
docker exec automationnews-api-1 node -e 'console.log(JSON.stringify({origin:process.env.APP_ORIGIN,freeOnly:process.env.NEWS_FREE_ONLY,aiDisabled:process.env.NEWS_AI_KILL_SWITCH,searchDisabled:process.env.NEWS_SEARCH_KILL_SWITCH}))'
printf '\nWORKER KEY PRESENCE\n'
docker exec automationnews-worker-1 node -e 'console.log(JSON.stringify({geminiConfigured:!!process.env.GEMINI_API_KEY,braveConfigured:!!process.env.BRAVE_SEARCH_API_KEY}))'
printf '\nREADINESS\n'
curl --noproxy '*' --max-time 10 --fail --silent --show-error http://127.0.0.1:8091/api/ready
printf '\n'
