#!/usr/bin/env bash
set -euo pipefail

container="vpn-user-bot-test-pg-$$"
cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --rm --name "$container" \
  --env POSTGRES_USER=vpn_user_bot_test \
  --env POSTGRES_PASSWORD=vpn_user_bot_test \
  --env POSTGRES_DB=vpn_user_bot_test \
  --publish 127.0.0.1::5432 postgres:16-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U vpn_user_bot_test -d vpn_user_bot_test >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "$container" pg_isready -U vpn_user_bot_test -d vpn_user_bot_test >/dev/null

port="$(docker port "$container" 5432/tcp | sed 's/.*://')"
export DATABASE_URL="postgresql://vpn_user_bot_test:vpn_user_bot_test@127.0.0.1:${port}/vpn_user_bot_test?schema=public"
export TEST_DATABASE_URL="$DATABASE_URL"

npx prisma migrate deploy
npx jest --config jest.integration.config.js --runInBand
