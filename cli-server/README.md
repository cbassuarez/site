# cli-server

The SSH and Gemini front-end for cbassuarez.com. Both surfaces are one-shot
(no REPL, no auth) and share one content layer that fetches live state from
the Cloudflare worker.

```
ssh ssh.cbassuarez.com              # the hand-typed letter
ssh ssh.cbassuarez.com feed         # what's been happening online today
ssh ssh.cbassuarez.com room         # /404 anteroom state
ssh ssh.cbassuarez.com works        # list of works
ssh ssh.cbassuarez.com contact      # how to reach
ssh ssh.cbassuarez.com version      # build label

gemini://gemini.cbassuarez.com/     # the letter (with => links)
```

## Layout

| File | Role |
|---|---|
| `main.go`    | boots SSH + Gemini servers from env config |
| `content.go` | letter loader + per-page renderers (calls the worker) |
| `ssh.go`     | one-shot SSH session handler (gliderlabs/ssh) |
| `gemini.go`  | Gemini protocol over TLS |
| `Dockerfile` | multi-stage Go build → small alpine image |
| `fly.toml`   | Fly.io app config (TCP services on :22 and :1965) |

The canonical letter lives at `https://cbassuarez.com/.well-known/cli-letter.txt`
(in the main repo's `public/.well-known/`). The binary fetches it on demand,
caches for 5 min, and falls back to a hard-coded copy if the site is down.

## Local dev

```sh
# Generate an ephemeral host key
ssh-keygen -t ed25519 -f /tmp/ssh_host_ed25519 -N ""

# Generate a self-signed cert for Gemini
openssl req -x509 -newkey ed25519 -nodes -days 365 \
  -subj "/CN=localhost" \
  -keyout /tmp/gemini.key -out /tmp/gemini.crt

# Run
SSH_HOST_KEY_PATHS=/tmp/ssh_host_ed25519 \
GEMINI_CERT_PATH=/tmp/gemini.crt \
GEMINI_KEY_PATH=/tmp/gemini.key \
GEMINI_ENABLED=true \
SSH_ADDR=:2222 GEMINI_ADDR=:1965 \
go run .
```

Verify:

```sh
ssh -p 2222 anyone@localhost                # letter
ssh -p 2222 anyone@localhost feed           # feed prose

# Gemini (use a Gemini browser like amfora, lagrange, or `gmni`)
gmni gemini://localhost/feed
```

## Deploy to Fly.io

```sh
# One-time
fly auth signup
fly launch --no-deploy           # creates the app, picks region

# Generate persistent secrets
ssh-keygen -t ed25519 -f /tmp/ssh_host_ed25519 -N ""
openssl req -x509 -newkey ed25519 -nodes -days 3650 \
  -subj "/CN=gemini.cbassuarez.com" \
  -keyout /tmp/gemini.key -out /tmp/gemini.crt

fly secrets set \
  SSH_HOST_KEY="$(cat /tmp/ssh_host_ed25519)" \
  GEMINI_CERT="$(cat /tmp/gemini.crt)" \
  GEMINI_KEY="$(cat /tmp/gemini.key)"

# Ship
fly deploy
fly ips list                     # copy the v4 / v6 anycast IPs
```

Then in Cloudflare DNS for `cbassuarez.com` (DNS-only, gray cloud):

```
ssh.cbassuarez.com      A     <Fly v4>
ssh.cbassuarez.com      AAAA  <Fly v6>
gemini.cbassuarez.com   A     <Fly v4>
gemini.cbassuarez.com   AAAA  <Fly v6>
```

Verify in the wild:

```sh
ssh ssh.cbassuarez.com feed
gmni gemini://gemini.cbassuarez.com/
```

## Notes

- **Anonymous auth.** The SSH server accepts any password / pubkey. There's no
  shell, only the one-shot output, so there's nothing for an attacker to do
  with a "valid" connection beyond reading what curl already shows. Rate
  limiting is implicit via Fly's per-IP limits.
- **Self-signed Gemini cert** is normal for the protocol (TOFU model). The
  cert lasts 10 years (`-days 3650`) so you don't have to rotate often.
- **Persistent host key** matters: regenerating it on every deploy makes
  every SSH client see "host key changed" warnings. The `release_command` in
  `fly.toml` materializes the secret to disk on each boot from the same
  stored value, so the key stays stable across deploys.
