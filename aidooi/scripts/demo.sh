#!/usr/bin/env bash
# One command to turn this machine into a demo server for the whole platform.
#   scripts/demo.sh up      start Postgres, seed, API, worker, both web consoles and both Expo apps
#   scripts/demo.sh down    stop everything this script started
#   scripts/demo.sh status  what is running, with URLs
#   scripts/demo.sh reset   drop the demo database (next `up` re-seeds)
# DEVELOPMENT ONLY: fixed demo passwords, OTP codes printed to a log, mock payments. Never expose to the internet.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"

LAN="${DEMO_HOST:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo localhost)}"
D=.demo; mkdir -p "$D/logs" "$D/pids"
DB=aidooi_demo
ADMIN="postgres://aidooi:aidooi@localhost:5433/$DB"

secret() { openssl rand -hex 32; }
if [ ! -f "$D/env" ]; then
  KEY="$(openssl genpkey -algorithm ed25519 | awk '{printf "%s\\n", $0}')"
  cat > "$D/env" <<ENV
AUTH_SECRET=$(secret)
VIEWING_PASS_SECRET=$(secret)
PAYMENT_WEBHOOK_SECRET=$(secret)
JWT_PRIVATE_KEY_PEM="$KEY"
ENV
  chmod 600 "$D/env"
fi

svc() { # name, command...  (runs in background, logs to .demo/logs/<name>.log)
  local name="$1"; shift
  if [ -f "$D/pids/$name" ] && kill -0 "$(cat "$D/pids/$name")" 2>/dev/null; then return; fi
  nohup "$@" > "$D/logs/$name.log" 2>&1 &
  echo $! > "$D/pids/$name"
}

wait_http() { for _ in $(seq 1 90); do curl -fs "$1" >/dev/null 2>&1 && return 0; sleep 1; done; echo "timed out waiting for $1" >&2; return 1; }

case "${1:-status}" in
  up)
    docker compose up -d --wait postgres
    docker exec "$(docker compose ps -q postgres)" psql -U aidooi -d postgres -tc "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 \
      || docker exec "$(docker compose ps -q postgres)" psql -U aidooi -d postgres -c "CREATE DATABASE $DB" >/dev/null
    set -a; . "$D/env"; set +a
    export NODE_ENV=development DATABASE_ADMIN_URL="$ADMIN" \
           DATABASE_URL="$ADMIN?options=-c%20role%3Daidooi_app" \
           HOST=0.0.0.0 PORT=3000 DEMO_REVEAL_OTP=true LOG_LEVEL=info \
           CORS_ORIGINS="http://localhost:8081,http://$LAN:8081,http://localhost:8082,http://$LAN:8082"
    pnpm --filter @aidooi/api demo:seed
    svc api node apps/api/src/main.ts
    PORT=3001 svc worker node apps/api/src/worker-main.ts
    wait_http "http://localhost:3000/health/ready"
    API_ORIGIN=http://localhost:3000 svc seller-portal pnpm --filter @aidooi/seller-portal exec vite --host 0.0.0.0 --port 5173 --strictPort
    OPS_API_URL=http://localhost:3000 svc ops-console pnpm --filter @aidooi/ops-console exec vite --host 0.0.0.0 --port 5175 --strictPort
    export CI=1 EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_URL="http://$LAN:3000" EXPO_PUBLIC_ENABLE_MOCK_PAYMENTS=true
    svc buyer pnpm --filter @aidooi/buyer exec expo start --port 8081 --host lan
    svc seller-app pnpm --filter @aidooi/seller-app exec expo start --port 8082 --host lan
    wait_http "http://localhost:5173" && wait_http "http://localhost:5175"
    "$0" status
    ;;
  down)
    for f in "$D"/pids/*; do [ -f "$f" ] || continue; pkill -P "$(cat "$f")" 2>/dev/null || true; kill "$(cat "$f")" 2>/dev/null || true; rm -f "$f"; done
    echo "stopped (Postgres left running: docker compose down to stop it)"
    ;;
  reset)
    "$0" down
    docker exec "$(docker compose ps -q postgres)" psql -U aidooi -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
    rm -f "$D/credentials.json"
    echo "demo database dropped"
    ;;
  status)
    up() { [ -f "$D/pids/$1" ] && kill -0 "$(cat "$D/pids/$1")" 2>/dev/null && echo up || echo DOWN; }
    cat <<TXT

  AIDOOi demo — server: $LAN   (open from this machine or any device on the same Wi-Fi)

  API                http://$LAN:3000/health/ready        $(up api)
  Seller portal      http://$LAN:5173                     $(up seller-portal)
  Ops console        http://$LAN:5175                     $(up ops-console)
  Buyer app (web)    http://$LAN:8081                     $(up buyer)
  Seller app (web)   http://$LAN:8082                     $(up seller-app)
  Phone (Expo Go)    exp://$LAN:8081  (buyer)  ·  exp://$LAN:8082  (seller app)

  Staff logins       cat .demo/credentials.json
  Current 2-step code for a login:   pnpm --filter @aidooi/api demo:totp admin@demo.aidooi.test
  Buyer sign-in      any UAE number, e.g. +971501234567 → the code is printed in:  tail -f .demo/logs/api.log
  Test cards         mock payments are on: tok_ok pays; tok_decline, tok_3ds and tok_flaky_once misbehave on purpose
  Logs               .demo/logs/*.log        Stop: scripts/demo.sh down

TXT
    ;;
  *) echo "usage: $0 up|down|status|reset" >&2; exit 2 ;;
esac
