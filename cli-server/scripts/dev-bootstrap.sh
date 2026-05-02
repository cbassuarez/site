#!/usr/bin/env bash
# Generate local-only SSH host key and Gemini TLS cert under ./.dev-secrets/.
# These are gitignored. Run once before `make run` / `go run .`.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p .dev-secrets
cd .dev-secrets

if [ ! -f ssh_host_ed25519 ]; then
  echo "→ generating ssh_host_ed25519"
  ssh-keygen -t ed25519 -f ssh_host_ed25519 -N "" -C "cbassuarez-cli-dev" >/dev/null
fi

if [ ! -f gemini.crt ] || [ ! -f gemini.key ]; then
  echo "→ generating self-signed gemini TLS cert (10-year)"
  openssl req -x509 -newkey ed25519 -nodes -days 3650 \
    -subj "/CN=localhost" \
    -keyout gemini.key -out gemini.crt 2>/dev/null
fi

echo
echo "ready. run with:"
echo
echo "  SSH_ADDR=:2222 GEMINI_ADDR=:1965 \\"
echo "  SSH_HOST_KEY_PATHS=\$PWD/.dev-secrets/ssh_host_ed25519 \\"
echo "  GEMINI_CERT_PATH=\$PWD/.dev-secrets/gemini.crt \\"
echo "  GEMINI_KEY_PATH=\$PWD/.dev-secrets/gemini.key \\"
echo "  go run ."
echo
echo "verify (in another shell):"
echo
echo "  ssh -p 2222 anyone@localhost"
echo "  ssh -p 2222 anyone@localhost feed"
echo "  printf 'gemini://localhost/\\r\\n' | openssl s_client -quiet -connect localhost:1965 2>/dev/null"
