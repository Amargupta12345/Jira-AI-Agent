#!/usr/bin/env bash
# Dr. Nexus — Team Setup Script
# Run from inside Dr.-Nexus/: bash setup.sh

set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

ok()   { echo -e "${GREEN}  ✓ $1${RESET}"; }
warn() { echo -e "${YELLOW}  ⚠ $1${RESET}"; }
fail() { echo -e "${RED}  ✗ $1${RESET}"; }
info() { echo -e "${CYAN}  → $1${RESET}"; }
head() { echo -e "\n${BOLD}$1${RESET}"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║     Dr. Nexus — Team Setup           ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""

# ── Check we're in the right directory ──────────────────────────────
if [ ! -f "package.json" ] || [ ! -f "src/index.js" ]; then
  fail "Run this script from inside the Dr.-Nexus/ directory."
  echo "  cd ~/Documents/AI-Agent/Dr.-Nexus && bash setup.sh"
  exit 1
fi

NEXUS_DIR="$(pwd)"
JIRA_DIR="$(cd ../jira-creator 2>/dev/null && pwd || echo '')"

# ── 1. Check prerequisites ───────────────────────────────────────────
head "1. Checking prerequisites"

check_tool() {
  local name="$1"
  local cmd="$2"
  local install_hint="$3"
  if command -v "$cmd" &>/dev/null; then
    ok "$name found: $(${cmd} --version 2>&1 | head -1)"
  else
    fail "$name not found."
    warn "Install: $install_hint"
    PREREQ_FAIL=1
  fi
}

PREREQ_FAIL=0

NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ -z "$NODE_VERSION" ]; then
  fail "Node.js not found. Install from https://nodejs.org (v18+)"
  PREREQ_FAIL=1
elif [ "$NODE_VERSION" -lt 18 ]; then
  fail "Node.js v${NODE_VERSION} is too old. Need v18+."
  PREREQ_FAIL=1
else
  ok "Node.js $(node --version)"
fi

check_tool "pnpm"   "pnpm"   "npm install -g pnpm"
check_tool "git"    "git"    "Install from https://git-scm.com"
check_tool "az"     "az"     "https://learn.microsoft.com/en-us/cli/azure/install-azure-cli"
check_tool "claude" "claude" "https://docs.anthropic.com/en/docs/claude-code"

if command -v aisum &>/dev/null; then
  ok "aisum found (better PR/Slack summaries)"
else
  warn "aisum not found — non-blocking, falls back to truncation"
fi

if [ "$PREREQ_FAIL" = "1" ]; then
  echo ""
  fail "Fix the missing prerequisites above, then re-run this script."
  exit 1
fi

# ── 2. Install Dr. Nexus dependencies ────────────────────────────────
head "2. Installing Dr. Nexus dependencies"
info "Running pnpm install..."
pnpm install --silent
ok "Dependencies installed"

# ── 3. Install jira-creator dependencies ─────────────────────────────
head "3. Installing jira-creator dependencies"

if [ -z "$JIRA_DIR" ]; then
  warn "jira-creator folder not found at ../jira-creator — skipping"
  warn "Make sure jira-creator is in the parent AI-Agent directory"
else
  info "Installing jira-creator npm packages..."
  (cd "$JIRA_DIR" && npm install --silent)
  ok "jira-creator dependencies installed"

  info "Installing Playwright Chromium browser..."
  (cd "$JIRA_DIR" && npx playwright install chromium --quiet 2>&1 | tail -2)
  ok "Playwright ready"
fi

# ── 4. Config file ────────────────────────────────────────────────────
head "4. Setting up config.json"

if [ -f "config.json" ]; then
  ok "config.json already exists — skipping copy"
else
  cp config.example.json config.json
  ok "config.json created from template"
  echo ""
  warn "ACTION NEEDED: Open config.json and fill in your credentials"
  echo "  Fields to fill:"
  echo "    jira.email, jira.apiToken"
  echo "    azureDevOps.pat"
  echo "    sentry.authToken"
  echo "    slack.botToken, slack.userId"
  echo ""
  echo "  See TEAM_SETUP.md for step-by-step instructions."
fi

# ── 5. Check config values ────────────────────────────────────────────
head "5. Validating config.json"

check_config_field() {
  local field="$1"
  local placeholder="$2"
  local value
  value=$(node -e "
    try {
      const c = JSON.parse(require('fs').readFileSync('config.json','utf8'));
      const parts = '$field'.split('.');
      let v = c;
      for (const p of parts) v = v?.[p];
      console.log(v || '');
    } catch(e) { console.log(''); }
  " 2>/dev/null)

  if [ -z "$value" ] || [ "$value" = "$placeholder" ] || [[ "$value" == YOUR* ]]; then
    warn "config.json: $field is not set — fill this in before running the agent"
  else
    ok "config.json: $field is set"
  fi
}

check_config_field "jira.email"           "you@example.com"
check_config_field "jira.apiToken"        "YOUR_JIRA_API_TOKEN"
check_config_field "azureDevOps.pat"      "YOUR_AZURE_DEVOPS_PAT"
check_config_field "sentry.authToken"     "YOUR_SENTRY_AUTH_TOKEN"
check_config_field "slack.botToken"       "xoxb-YOUR-SLACK-BOT-TOKEN"

# ── 6. Check Azure CLI auth ───────────────────────────────────────────
head "6. Checking Azure CLI authentication"

AZ_ACCOUNT=$(az account show --output json 2>/dev/null | grep '"name"' | head -1 || echo "")
if [ -z "$AZ_ACCOUNT" ]; then
  warn "Not logged in to Azure CLI"
  info "Run: az login"
  info "Then: az devops login --organization https://dev.azure.com/YOUR_ORG"
else
  ok "Azure CLI authenticated: $AZ_ACCOUNT"
fi

# ── 7. Check Claude CLI auth ──────────────────────────────────────────
head "7. Checking Claude CLI"

CLAUDE_TEST=$(claude -p "say the word ready" --output-format text 2>/dev/null | head -1 || echo "")
if [ -z "$CLAUDE_TEST" ]; then
  warn "Claude CLI may not be authenticated"
  info "Run: claude login"
else
  ok "Claude CLI is working"
fi

# ── 8. Check SSH access ───────────────────────────────────────────────
head "8. Checking SSH access to Azure DevOps"

SSH_TEST=$(ssh -T git@ssh.dev.azure.com 2>&1 || true)
if echo "$SSH_TEST" | grep -q "Shell access is not supported"; then
  ok "SSH to Azure DevOps is working"
elif echo "$SSH_TEST" | grep -q "denied\|refused\|Could not"; then
  warn "SSH to Azure DevOps failed"
  info "Add your SSH public key at: Azure DevOps → User Settings → SSH Public Keys"
  info "Your public key: cat ~/.ssh/id_rsa.pub (or id_ed25519.pub)"
else
  warn "SSH test inconclusive — verify manually if git clone fails"
fi

# ── Done ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║         Setup Complete               ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Fill in config.json with your credentials (if not done yet)"
echo "     → See TEAM_SETUP.md for step-by-step credential instructions"
echo ""
echo "  2. Test your Sentry connection:"
echo "     node src/index.js sentry-poll"
echo ""
echo "  3. Run the full interactive Sentry → fix workflow:"
echo "     node src/index.js sentry-select"
echo ""
echo "  4. Quick command reference:"
echo "     cat COMMANDS.md"
echo ""
