#!/bin/bash

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

API_URL_DEFAULT="http://localhost:3001"
API_URL="${API_URL:-$API_URL_DEFAULT}"

usage() {
  echo "Usage: $0 [-u API_URL]" >&2
}

while getopts ":u:h" opt; do
  case $opt in
    u) API_URL="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

for t in curl jq; do
  if ! command -v "$t" >/dev/null 2>&1; then
    echo -e "${RED}Missing dependency: $t${NC}"; exit 1
  fi
done

echo -e "${BLUE}▶ Cek koneksi Supabase di ${API_URL}/health/supabase${NC}"

for i in {1..20}; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL")
  if [ "$status" = "200" ] || [ "$status" = "404" ]; then
    break
  fi
  sleep 1
done

resp=$(curl -sS "$API_URL/health/supabase")
mode=$(echo "$resp" | jq -r '.mode // empty')
status=$(echo "$resp" | jq -r '.status // empty')
err=$(echo "$resp" | jq -r '.error // empty')

if [ "$status" = "ok" ]; then
  echo -e "${GREEN}✓ Supabase health OK${NC} (mode=${mode})"
  exit 0
else
  echo -e "${RED}✗ Supabase health ERROR${NC} (mode=${mode})"
  if [ -n "$err" ]; then
    echo "Error: $err"
  else
    echo "Response: $resp"
  fi
  exit 1
fi