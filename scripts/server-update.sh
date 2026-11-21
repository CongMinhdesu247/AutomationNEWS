#!/usr/bin/env bash
# Incremental, zero-data-loss update script for an existing AutomationNEWS Local Server.
# Preserves .env.home, .env.premium, secrets/, automationnews_hub_data, and sibling apps.
set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-$HOME/apps/AutomationNEWS}"
PROJECT="${COMPOSE_PROJECT_NAME:-automationnews}"
ARCHIVE_PATH=""
PREBUILT=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      ARCHIVE_PATH="${2:?Missing path after --archive}"
      shift 2
      ;;
    --app-dir)
      APP_DIR="${2:?Missing directory after --app-dir}"
      shift 2
      ;;
    --prebuilt)
      PREBUILT=true
      shift
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [[ ! -d "$APP_DIR" ]]; then
  printf 'ERROR: Existing installation directory not found: %s\n' "$APP_DIR" >&2
  exit 1
fi

if [[ -n "$ARCHIVE_PATH" ]]; then
  ARCHIVE_PATH="$(realpath "$ARCHIVE_PATH")"
  if [[ ! -f "$ARCHIVE_PATH" ]]; then
    printf 'ERROR: Archive file not found: %s\n' "$ARCHIVE_PATH" >&2
    exit 1
  fi
fi

# Auto-detect SERVER_CONTEXT.md ./source/ layout vs flat repo layout
if [[ -f "$APP_DIR/source/infra/compose.yaml" ]]; then
  SRC_DIR="$APP_DIR/source"
else
  SRC_DIR="$APP_DIR"
fi

# Auto-detect production env files without overwriting or printing secrets
MAIN_ENV=""
for candidate in "$APP_DIR/.env.home" "$SRC_DIR/.env.home" "$APP_DIR/.env" "$SRC_DIR/.env"; do
  if [[ -f "$candidate" ]]; then
    MAIN_ENV="$candidate"
    break
  fi
done
if [[ -z "$MAIN_ENV" ]]; then
  printf 'ERROR: Could not find .env.home or .env in %s\n' "$APP_DIR" >&2
  exit 1
fi
chmod 600 "$MAIN_ENV"

PREMIUM_ENV=""
for candidate in "$APP_DIR/.env.premium" "$SRC_DIR/.env.premium"; do
  if [[ -f "$candidate" ]]; then
    PREMIUM_ENV="$candidate"
    chmod 600 "$PREMIUM_ENV"
    break
  fi
done

mkdir -p "$APP_DIR/data/backups"
chmod 700 "$APP_DIR/data" "$APP_DIR/data/backups"
if [[ -d "$APP_DIR/secrets" ]]; then
  chmod 700 "$APP_DIR/secrets"
fi

WEB_PORT="$(grep -E '^WEB_PORT=' "$MAIN_ENV" | tail -n1 | cut -d= -f2- | tr -d '"\r ' || true)"
WEB_PORT="${WEB_PORT:-8091}"

compose_cmd() {
  local args=(docker compose -p "$PROJECT" --env-file "$MAIN_ENV")
  if [[ -n "$PREMIUM_ENV" ]]; then
    args+=(--env-file "$PREMIUM_ENV")
  fi
  args+=(-f "$SRC_DIR/infra/compose.yaml" -f "$SRC_DIR/infra/compose.home.yaml")
  if [[ "$PREBUILT" == true && -f "$SRC_DIR/infra/compose.premium.yaml" ]]; then
    args+=(-f "$SRC_DIR/infra/compose.premium.yaml")
  fi
  "${args[@]}" "$@"
}

RELEASE_ID="upd_$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$APP_DIR/data/backups/$RELEASE_ID"
RESTORE_DB="hub_restore_$(date -u +%Y%m%d_%H%M%S)"
DB_CONTAINER="${PROJECT}-db-1"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

printf '[1/7] Snapshotting current state into %s\n' "$BACKUP_DIR"
cp -p "$MAIN_ENV" "$BACKUP_DIR/env.main.before"
if [[ -n "$PREMIUM_ENV" ]]; then
  cp -p "$PREMIUM_ENV" "$BACKUP_DIR/env.premium.before"
fi

HAVE_ROLLBACK_IMAGES=true
for svc in api worker scheduler web; do
  if image_id="$(docker inspect "${PROJECT}-${svc}-1" --format '{{.Image}}' 2>/dev/null)"; then
    docker tag "$image_id" "automationnews-rollback-${svc}:${RELEASE_ID}"
    printf '%s %s\n' "$svc" "$image_id" >> "$BACKUP_DIR/images.before"
  else
    HAVE_ROLLBACK_IMAGES=false
  fi
done

if [[ "$HAVE_ROLLBACK_IMAGES" == true ]]; then
  cat > "$BACKUP_DIR/compose.rollback.yaml" <<YAML
services:
  api:
    image: automationnews-rollback-api:${RELEASE_ID}
  migrate:
    image: automationnews-rollback-api:${RELEASE_ID}
  worker:
    image: automationnews-rollback-worker:${RELEASE_ID}
  scheduler:
    image: automationnews-rollback-scheduler:${RELEASE_ID}
  web:
    image: automationnews-rollback-web:${RELEASE_ID}
YAML
fi

tar \
  --exclude=./node_modules \
  --exclude=./output \
  --exclude=./backups \
  --exclude=./data \
  --exclude=./.git \
  --exclude=./secrets \
  --exclude=./.env \
  --exclude='./.env.*' \
  -czf "$BACKUP_DIR/source.before.tar.gz" -C "$SRC_DIR" .

STOPPED=false
RESTORE_DB_CREATED=false
SOURCE_EXTRACTED=false
BUILD_DONE=false

cleanup() {
  local exit_code=$?
  trap - EXIT
  if [[ "$RESTORE_DB_CREATED" == true ]]; then
    docker exec "$DB_CONTAINER" sh -c 'exec dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$RESTORE_DB" >/dev/null 2>&1 || true
  fi
  if [[ $exit_code -ne 0 ]]; then
    printf 'ERROR: Update failed (exit %d). Restoring previous source & services...\n' "$exit_code" >&2
    if [[ "$SOURCE_EXTRACTED" == true && -f "$BACKUP_DIR/source.before.tar.gz" ]]; then
      (umask 022 && tar --no-same-permissions -xzf "$BACKUP_DIR/source.before.tar.gz" -C "$SRC_DIR") || true
    fi
    if [[ "$STOPPED" == true && "$HAVE_ROLLBACK_IMAGES" == true ]]; then
      local rb_args=(docker compose -p "$PROJECT" --env-file "$MAIN_ENV")
      if [[ -n "$PREMIUM_ENV" ]]; then
        rb_args+=(--env-file "$PREMIUM_ENV")
      fi
      rb_args+=(-f "$SRC_DIR/infra/compose.yaml" -f "$SRC_DIR/infra/compose.home.yaml" -f "$BACKUP_DIR/compose.rollback.yaml")
      "${rb_args[@]}" up -d --no-build --no-deps --wait api worker scheduler web || true
    fi
  fi
  exit "$exit_code"
}
trap cleanup EXIT

if [[ -n "$ARCHIVE_PATH" ]]; then
  printf '[2/7] Extracting updated source archive into %s\n' "$SRC_DIR"
  (umask 022 && tar --no-same-permissions -xzf "$ARCHIVE_PATH" -C "$SRC_DIR")
  chmod -R a+rX \
    "$SRC_DIR/package.json" \
    "$SRC_DIR/pnpm-lock.yaml" \
    "$SRC_DIR/pnpm-workspace.yaml" \
    "$SRC_DIR/tsconfig.base.json" \
    "$SRC_DIR/apps" \
    "$SRC_DIR/packages" \
    "$SRC_DIR/db" \
    "$SRC_DIR/infra"
  chmod 600 "$MAIN_ENV"
  if [[ -n "$PREMIUM_ENV" ]]; then
    chmod 600 "$PREMIUM_ENV"
  fi
  SOURCE_EXTRACTED=true
else
  printf '[2/7] Using existing source tree at %s\n' "$SRC_DIR"
  chmod -R a+rX \
    "$SRC_DIR/package.json" \
    "$SRC_DIR/pnpm-lock.yaml" \
    "$SRC_DIR/pnpm-workspace.yaml" \
    "$SRC_DIR/tsconfig.base.json" \
    "$SRC_DIR/apps" \
    "$SRC_DIR/packages" \
    "$SRC_DIR/db" \
    "$SRC_DIR/infra"
fi

compose_cmd config --quiet

if [[ "$PREBUILT" == false ]]; then
  printf '[3/7] Building updated images while existing services stay online...\n'
  compose_cmd build api worker scheduler web
else
  printf '[3/7] Prebuilt mode enabled; skipping docker compose build.\n'
fi
BUILD_DONE=true

printf '[4/7] Pausing scheduler, worker, and api for consistent PostgreSQL backup...\n'
STOPPED=true
compose_cmd stop scheduler worker api

docker exec "$DB_CONTAINER" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' > "$BACKUP_DIR/database.dump"
test -s "$BACKUP_DIR/database.dump"
docker exec "$DB_CONTAINER" sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only --no-owner --no-acl' > "$BACKUP_DIR/schema.sql"
sha256sum "$BACKUP_DIR/database.dump" > "$BACKUP_DIR/database.sha256"
chmod 600 "$BACKUP_DIR/"*

printf '[5/7] Verifying backup restore & dry-running migrations on isolated DB %s...\n' "$RESTORE_DB"
docker exec "$DB_CONTAINER" sh -c 'exec createdb -U "$POSTGRES_USER" --template=template0 "$1"' sh "$RESTORE_DB"
RESTORE_DB_CREATED=true
docker exec -i "$DB_CONTAINER" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --single-transaction --exit-on-error --no-owner --no-acl' sh "$RESTORE_DB" < "$BACKUP_DIR/database.dump"

compose_cmd run --rm --no-deps -T --workdir /app/apps/api --entrypoint node api --import tsx --input-type module -e '
process.env.TEST_DATABASE_URL = process.env.DATABASE_URL;
const target = new URL(process.env.DATABASE_URL);
target.pathname = "/" + process.argv[1];
process.env.RESTORE_DATABASE_URL = target.href;
await import("/app/apps/api/src/operations/verify-restore.ts");
' "$RESTORE_DB" > "$BACKUP_DIR/restore-verification.jsonl"
chmod 600 "$BACKUP_DIR/restore-verification.jsonl"

MATCHED_TABLES="$(grep -c '"match":true' "$BACKUP_DIR/restore-verification.jsonl" || true)"
MISMATCHED_TABLES="$(grep -c '"match":false' "$BACKUP_DIR/restore-verification.jsonl" || true)"
if [[ "$MATCHED_TABLES" -lt 10 || "$MISMATCHED_TABLES" -ne 0 ]]; then
  printf 'ERROR: Restore verification mismatch (matched=%s, mismatched=%s)\n' "$MATCHED_TABLES" "$MISMATCHED_TABLES" >&2
  exit 1
fi

compose_cmd run --rm --no-deps -T --workdir /app/apps/api --entrypoint node api --import tsx --input-type module -e '
import fs from "node:fs";
import { createPool } from "/app/apps/api/src/db.ts";
import { migrate } from "/app/apps/api/src/migrate.ts";
const expected = fs.readdirSync("/app/db/migrations").filter((f) => f.endsWith(".sql")).length;
const target = new URL(process.env.DATABASE_URL);
target.pathname = "/" + process.argv[1];
const pool = createPool(target.href, { max: 2, statementTimeoutMs: 0 });
try {
  await migrate(pool);
  const res = await pool.query("SELECT count(*)::int AS count FROM schema_migrations");
  if (res.rows[0].count !== expected) {
    throw new Error(`Expected ${expected} migrations, got ${res.rows[0].count}`);
  }
} finally {
  await pool.end();
}
' "$RESTORE_DB"

docker exec "$DB_CONTAINER" sh -c 'exec dropdb -U "$POSTGRES_USER" --if-exists "$1"' sh "$RESTORE_DB"
RESTORE_DB_CREATED=false

printf '[6/7] Running production database migrations and starting updated services...\n'
compose_cmd run --rm --no-deps -T migrate
compose_cmd up -d --no-build --no-deps --wait api worker scheduler web

printf '[7/7] Verifying local loopback readiness on http://127.0.0.1:%s/api/ready...\n' "$WEB_PORT"
READY_BODY="$(curl --noproxy '*' --max-time 15 --fail --silent --show-error "http://127.0.0.1:${WEB_PORT}/api/ready")"
printf 'Readiness: %s\n' "$READY_BODY"

STOPPED=false
compose_cmd ps
printf '\nUPDATE_OK\nBACKUP_DIR=%s\nMATCHED_TABLES=%s\n' "$BACKUP_DIR" "$MATCHED_TABLES"
