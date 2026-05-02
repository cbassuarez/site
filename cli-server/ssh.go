package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/gliderlabs/ssh"
)

// startSSHServer runs the one-shot SSH front-end. Each connection prints
// either the canonical letter (when no command is given) or the rendered
// page named by the command (`feed`, `room`, ...). All auth is anonymous.
func startSSHServer(ctx context.Context, cfg Config, content *Content) error {
	srv := &ssh.Server{
		Addr: cfg.SSHAddr,
		Handler: func(s ssh.Session) {
			handleSSHSession(s, content)
		},
		PasswordHandler: func(_ ssh.Context, _ string) bool {
			return true // anonymous
		},
		PublicKeyHandler: func(_ ssh.Context, _ ssh.PublicKey) bool {
			return true // anonymous
		},
		KeyboardInteractiveHandler: func(_ ssh.Context, _ ssh.KeyboardInteractiveChallenge) bool {
			return true // anonymous
		},
	}

	loadedAny := false
	for _, path := range cfg.SSHHostKeys {
		if path == "" {
			continue
		}
		if _, err := os.Stat(path); err != nil {
			log.Printf("ssh: host key %q unavailable: %v", path, err)
			continue
		}
		if err := srv.SetOption(ssh.HostKeyFile(path)); err != nil {
			log.Printf("ssh: failed to load host key %q: %v", path, err)
			continue
		}
		loadedAny = true
		log.Printf("ssh: loaded host key %q", path)
	}
	if !loadedAny {
		log.Printf("ssh: no host key loaded; gliderlabs/ssh will generate an ephemeral one (clients will see a key change on every restart)")
	}

	go func() {
		<-ctx.Done()
		_ = srv.Close()
	}()

	log.Printf("ssh: listening on %s", cfg.SSHAddr)
	err := srv.ListenAndServe()
	if err == ssh.ErrServerClosed {
		return nil
	}
	return err
}

func handleSSHSession(s ssh.Session, content *Content) {
	cmd := strings.TrimSpace(strings.Join(s.Command(), " "))
	if cmd == "" {
		fmt.Fprint(s, content.Letter())
		return
	}
	// One-shot command mode: ssh ssh.cbassuarez.com feed
	page := strings.Fields(cmd)[0]
	fmt.Fprint(s, content.RenderPage(page))
}
