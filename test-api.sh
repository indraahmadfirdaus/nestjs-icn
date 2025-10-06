#!/bin/bash

# ------------------------------------------------------------
# Task Board API Integration Tests (Backend Real Endpoints)
# ------------------------------------------------------------

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

set -o pipefail

# Config: can be overridden via env or flags
API_URL_DEFAULT="http://localhost:3001"
API_URL="${API_URL:-$API_URL_DEFAULT}"
EMAIL_ARG=""
PASSWORD_ARG=""
EMAIL_DOMAIN_ARG=""

usage() {
  echo "Usage: $0 [-u API_URL] [-e EMAIL] [-p PASSWORD] [-d EMAIL_DOMAIN]" >&2
  echo "  -u API_URL     Base URL backend (default: $API_URL_DEFAULT)"
  echo "  -e EMAIL       Email untuk register/login (default: random)"
  echo "  -p PASSWORD    Password untuk register/login (default: testpass123)"
  echo "  -d EMAIL_DOMAIN  Domain email untuk random (default: mock=example.com, real=gmail.com)"
}

while getopts ":u:e:p:d:h" opt; do
  case $opt in
    u) API_URL="$OPTARG" ;;
    e) EMAIL_ARG="$OPTARG" ;;
    p) PASSWORD_ARG="$OPTARG" ;;
    d) EMAIL_DOMAIN_ARG="$OPTARG" ;;
    h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
done

# Dependencies
require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo -e "${RED}Missing dependency: $1${NC}"
    exit 1
  fi
}
require_tool curl
require_tool jq

# Counters
PASSED=0
FAILED=0

echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Task Board API Integration Tests      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo -e "Target: ${API_URL}"
echo ""

# Result printing
print_result() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✓ PASSED${NC} - $2"
        ((PASSED++))
    else
        echo -e "${RED}✗ FAILED${NC} - $2"
        if [ -n "$3" ]; then
          echo -e "${RED}   Response:${NC} $3"
        fi
        ((FAILED++))
    fi
}

# Wait backend
wait_backend() {
  echo -e "${YELLOW}[1/10] Menunggu backend siap...${NC}"
  for i in {1..30}; do
    status=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL")
    if [ "$status" = "200" ] || [ "$status" = "404" ]; then
      print_result 0 "Backend tersedia"
      echo ""
      return 0
    fi
    sleep 1
  done
  print_result 1 "Backend tidak merespon" "HTTP $status"
  echo -e "${RED}Pastikan backend berjalan: docker-compose up atau npm run start:dev${NC}"
  exit 1
}

# Context
TIMESTAMP=$(date +%s)
TEST_EMAIL="$EMAIL_ARG"
TEST_PASSWORD=${PASSWORD_ARG:-"testpass123"}
TOKEN=""
USER_ID=""
TASK_ID=""

# 2: Register
test_register() {
  echo -e "${YELLOW}[2/10] Register user...${NC}"
  local payload
  payload=$(jq -n --arg email "$TEST_EMAIL" --arg pass "$TEST_PASSWORD" --arg name "Test User" '{email:$email, password:$pass, name:$name}')
  local response
  response=$(curl -sS -X POST "$API_URL/auth/register" -H "Content-Type: application/json" -d "$payload")
  local token
  token=$(echo "$response" | jq -r '.accessToken // empty')
  if [ -n "$token" ]; then
    TOKEN="$token"
    USER_ID=$(echo "$response" | jq -r '.user.id')
    print_result 0 "Register berhasil (${TEST_EMAIL})"
  else
    # Jika gagal karena duplikat, coba login
    if echo "$response" | grep -qi 'already'; then
      print_result 0 "Register skip (email sudah ada), lanjut login"
    else
      print_result 1 "Register gagal" "$response"
      exit 1
    fi
  fi
  echo ""
}

# 3: Login
test_login() {
  echo -e "${YELLOW}[3/10] Login user...${NC}"
  local payload
  payload=$(jq -n --arg email "$TEST_EMAIL" --arg pass "$TEST_PASSWORD" '{email:$email, password:$pass}')
  local response
  response=$(curl -sS -X POST "$API_URL/auth/login" -H "Content-Type: application/json" -d "$payload")
  local token
  token=$(echo "$response" | jq -r '.accessToken // empty')
  if [ -n "$token" ]; then
    TOKEN="$token"
    print_result 0 "Login berhasil"
  else
    print_result 1 "Login gagal" "$response"
  fi
  echo ""
}

# 4: Get Profile
test_get_profile() {
  echo -e "${YELLOW}[4/10] Ambil profil /auth/me...${NC}"
  local response
  response=$(curl -sS -X GET "$API_URL/auth/me" -H "Authorization: Bearer $TOKEN")
  if echo "$response" | jq -e --arg email "$TEST_EMAIL" '.email == $email' >/dev/null; then
    print_result 0 "Profil sesuai"
  else
    print_result 1 "Profil tidak sesuai" "$response"
  fi
  echo ""
}

# 5: Unauthorized tasks
test_tasks_unauthorized() {
  echo -e "${YELLOW}[5/10] Cek /tasks tanpa auth (harus 401)...${NC}"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/tasks")
  if [ "$status" = "401" ]; then
    print_result 0 "Unauthorized OK"
  else
    print_result 1 "Unauthorized tidak sesuai" "HTTP $status"
  fi
  echo ""
}

# 6: Create task
test_create_task() {
  echo -e "${YELLOW}[6/10] Buat task...${NC}"
  local payload
  payload=$(jq -n '{title:"Test Task", description:"This is a test task", status:"todo"}')
  local response
  response=$(curl -sS -X POST "$API_URL/tasks" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$payload")
  local id
  id=$(echo "$response" | jq -r '.id // empty')
  if [ -n "$id" ]; then
    TASK_ID="$id"
    print_result 0 "Create task berhasil (id=$TASK_ID)"
  else
    print_result 1 "Create task gagal" "$response"
  fi
  echo ""
}

# 7: Get all tasks
test_get_tasks() {
  echo -e "${YELLOW}[7/10] Ambil semua task...${NC}"
  local response
  response=$(curl -sS -X GET "$API_URL/tasks" -H "Authorization: Bearer $TOKEN")
  local count
  count=$(echo "$response" | jq 'length // 0')
  if [ "$count" -ge 1 ]; then
    print_result 0 "Get tasks berhasil (count=$count)"
  else
    print_result 1 "Get tasks gagal" "$response"
  fi
  echo ""
}

# 8: Update task
test_update_task() {
  echo -e "${YELLOW}[8/10] Update task...${NC}"
  local payload
  payload=$(jq -n '{status:"in_progress", description:"Updated description"}')
  local response
  response=$(curl -sS -X PATCH "$API_URL/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$payload")
  if echo "$response" | jq -e '.status == "in_progress"' >/dev/null; then
    print_result 0 "Update task berhasil"
  else
    print_result 1 "Update task gagal" "$response"
  fi
  echo ""
}

# 9: AI suggestions
test_ai_suggestions() {
  echo -e "${YELLOW}[9/10] Cek AI suggestions...${NC}"
  local payload
  payload=$(jq -n '{context:"software developer tasks"}')
  local response
  response=$(curl -sS -X POST "$API_URL/ai/suggestions" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "$payload")
  local count
  count=$(echo "$response" | jq '.suggestions | length // 0')
  if [ "$count" -ge 1 ]; then
    print_result 0 "AI suggestions OK (count=$count)"
  else
    print_result 1 "AI suggestions gagal" "$response"
  fi
  echo ""
}

# 10: Delete + verify
test_delete_task() {
  echo -e "${YELLOW}[10/10] Hapus task dan verifikasi...${NC}"
  local response
  response=$(curl -sS -X DELETE "$API_URL/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN")
  if echo "$response" | grep -qi 'deleted'; then
    print_result 0 "Delete task berhasil"
  else
    print_result 1 "Delete task gagal" "$response"
  fi
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/tasks/$TASK_ID" -H "Authorization: Bearer $TOKEN")
  if [ "$status" = "404" ]; then
    print_result 0 "Verifikasi delete OK (404)"
  else
    print_result 1 "Verifikasi delete gagal" "HTTP $status"
  fi
  echo ""
}

# Run
wait_backend
HEALTH_RESP=$(curl -sS "$API_URL/health/supabase" 2>/dev/null || echo '{}')
MODE=$(echo "$HEALTH_RESP" | jq -r '.mode // empty')
if [ -z "$MODE" ]; then MODE="unknown"; fi

# Tentukan domain email default berdasarkan mode koneksi
EMAIL_DOMAIN_DEFAULT="example.com"
if [ "$MODE" = "real" ]; then
  EMAIL_DOMAIN_DEFAULT="gmail.com"
fi
EMAIL_DOMAIN=${EMAIL_DOMAIN_ARG:-$EMAIL_DOMAIN_DEFAULT}

# Set TEST_EMAIL jika belum diberikan via -e
if [ -z "$TEST_EMAIL" ]; then
  TEST_EMAIL="user${TIMESTAMP}@${EMAIL_DOMAIN}"
fi

echo -e "Mode Supabase: ${MODE} | Email dipakai: ${TEST_EMAIL}"

test_register
test_login
test_get_profile
test_tasks_unauthorized
test_create_task
test_get_tasks
test_update_task
test_ai_suggestions
test_delete_task

# Summary
echo -e "${BLUE}╔════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Test Summary                  ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════╝${NC}"
echo -e "${GREEN}Passed: $PASSED${NC}"
echo -e "${RED}Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 Semua test lulus!${NC}"
    exit 0
else
    echo -e "${RED}❌ Ada test yang gagal.${NC}"
    exit 1
fi