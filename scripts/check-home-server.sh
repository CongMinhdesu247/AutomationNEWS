#!/usr/bin/env bash
# Read-only inventory for an existing installation. Does not print secrets.
set -euo pipefail
APP_DIR="${APP_DIR:-$HOME/apps/AutomationNEWS}"
PROJECT="${COMPOSE_PROJECT_NAME:-automationnews}"
WEB_PORT="${WEB_PORT:-8091}"
cd "$APP_DIR"
printf 'HOST\n'
hostname
uname -m
docker compose version --short
printf '\nAPPLICATION\n'
docker ps --filter "label=com.docker.compose.project=${PROJECT}" --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'
printf '\nDATABASE STORAGE\n'
docker inspect "${PROJECT}-db-1" --format '{{range .Mounts}}{{println .Name .Destination}}{{end}}'
printf '\nLATEST MIGRATIONS\n'
docker exec "${PROJECT}-db-1" sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 6"'
printf '\nCAPACITY\n'
free -h
df -h . /var/lib/docker
printf '\nPUBLIC ORIGIN AND PREMIUM SWITCHES\n'
docker exec "${PROJECT}-api-1" node -e 'console.log(JSON.stringify({origin:process.env.APP_ORIGIN,freeOnly:process.env.NEWS_FREE_ONLY,aiDisabled:process.env.NEWS_AI_KILL_SWITCH,searchDisabled:process.env.NEWS_SEARCH_KILL_SWITCH}))'
printf '\nWORKER KEY PRESENCE\n'
docker exec "${PROJECT}-worker-1" node -e 'console.log(JSON.stringify({geminiConfigured:!!process.env.GEMINI_API_KEY,braveConfigured:!!process.env.BRAVE_SEARCH_API_KEY}))'
printf '\nREADINESS\n'
curl --noproxy '*' --max-time 10 --fail --silent --show-error "http://127.0.0.1:${WEB_PORT}/api/ready"
printf '\n'
