// cli-server is the SSH and Gemini front-end for cbassuarez.com.
//
// Both surfaces share one content layer (content.go) which fetches live state
// from the Cloudflare worker (https://seb-feed.cbassuarez.workers.dev) and
// renders the same hand-typed-letter prose for every page.
//
// Connections are one-shot:
//   ssh ssh.cbassuarez.com           -> the letter
//   ssh ssh.cbassuarez.com feed      -> feed prose
//   ssh ssh.cbassuarez.com room      -> /404 anteroom prose
//   gemini://gemini.cbassuarez.com/  -> the letter (with => links)
//
// No REPL, no auth. Match the aesthetic of /humans.txt.
package main

import (
    "context"
    "log"
    "os"
    "os/signal"
    "path/filepath"
    "sync"
    "syscall"

    "github.com/cbassuarez/site/cli-server/repl"
)

type Config struct {
	SSHEnabled    bool
	SSHAddr       string
	SSHHostKeys   []string
	GeminiEnabled bool
	GeminiAddr    string
	GeminiHost    string
	GeminiCert    string
	GeminiKey     string
	WorkerURL     string
	LetterURL     string
	ReplManifestURL string
}

func loadConfig() Config {
	return Config{
		SSHEnabled:    envBool("SSH_ENABLED", true),
		SSHAddr:       envStr("SSH_ADDR", ":2222"),
		SSHHostKeys:   envList("SSH_HOST_KEY_PATHS", "/secrets/ssh_host_ed25519"),
		GeminiEnabled: envBool("GEMINI_ENABLED", true),
		GeminiAddr:    envStr("GEMINI_ADDR", ":1965"),
		GeminiHost:    envStr("GEMINI_HOST", "gemini.cbassuarez.com"),
		GeminiCert:    envStr("GEMINI_CERT_PATH", "/secrets/gemini.crt"),
		GeminiKey:     envStr("GEMINI_KEY_PATH", "/secrets/gemini.key"),
		WorkerURL:     envStr("WORKER_URL", "https://seb-feed.cbassuarez.workers.dev"),
		LetterURL:     envStr("LETTER_URL", "https://cbassuarez.com/.well-known/cli-letter.txt"),
		ReplManifestURL: envStr("REPL_MANIFEST_URL", "https://cbassuarez.com/labs/repl/samples/manifest.json"),
	}
}

func main() {
	cfg := loadConfig()
    log.SetFlags(log.LstdFlags | log.LUTC)
    materializeSecrets(cfg)
    content := NewContent(cfg.WorkerURL, cfg.LetterURL)
    // Wire the REPL sample bank — lazy-loads the manifest on first SSH `repl` call.
    content.SetSampleBank(repl.NewSampleBank(cfg.ReplManifestURL))

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup

	if cfg.SSHEnabled {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := startSSHServer(ctx, cfg, content); err != nil {
				log.Printf("ssh server: %v", err)
			}
		}()
	}

	if cfg.GeminiEnabled {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := startGeminiServer(ctx, cfg, content); err != nil {
				log.Printf("gemini server: %v", err)
			}
		}()
	}

	sig := make(chan os.Signal, 1)
	signal.Notify(sig, syscall.SIGINT, syscall.SIGTERM)
	<-sig
	log.Println("shutdown signal received")
	cancel()
	wg.Wait()
}

func envStr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "TRUE" || v == "yes"
}

func materializeSecretFile(envKey, path string, mode os.FileMode) {
    value := os.Getenv(envKey)
    if value == "" || path == "" {
        return
    }

    if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
        log.Printf("secret: mkdir for %s failed: %v", path, err)
        return
    }

    if err := os.WriteFile(path, []byte(value), mode); err != nil {
        log.Printf("secret: write %s failed: %v", path, err)
        return
    }

    log.Printf("secret: materialized %s", path)
}

func materializeSecrets(cfg Config) {
    materializeSecretFile("SSH_HOST_KEY", cfg.SSHHostKeys[0], 0600)
    materializeSecretFile("GEMINI_CERT", cfg.GeminiCert, 0600)
    materializeSecretFile("GEMINI_KEY", cfg.GeminiKey, 0600)
}

func envList(key, fallback string) []string {
	v := os.Getenv(key)
	if v == "" {
		v = fallback
	}
	out := []string{}
	cur := ""
	for _, ch := range v {
		if ch == ',' || ch == ':' {
			if cur != "" {
				out = append(out, cur)
				cur = ""
			}
			continue
		}
		cur += string(ch)
	}
	if cur != "" {
		out = append(out, cur)
	}
	return out
}
