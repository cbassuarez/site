package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"strconv"
	"strings"

	"github.com/cbassuarez/site/cli-server/repl"
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
		// Refuse PTY allocation. This is a one-shot text server; without a PTY
		// the client runs in non-interactive (pipe) mode and closes cleanly
		// the instant the handler returns. With a PTY accepted, the channel
		// can hang waiting on a phantom stdin until the user Ctrl-C's.
		PtyCallback: func(_ ssh.Context, _ ssh.Pty) bool {
			return false
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
	args := strings.Fields(cmd)
	page := args[0]
	if page == "repl" {
		handleSSHRepl(s, content, args[1:])
		return
	}
	fmt.Fprint(s, content.RenderPage(page))
}

// handleSSHRepl renders a patch on stdin (or a hash arg) into a WAV stream.
//
//   ssh ssh.cbassuarez.com repl < patch.txt | mpv -
//   ssh ssh.cbassuarez.com repl <hash>     | mpv -
//   ssh ssh.cbassuarez.com repl --bars 16 < patch.txt | mpv -
//   ssh ssh.cbassuarez.com repl --help
func handleSSHRepl(s ssh.Session, content *Content, args []string) {
	bars := repl.DefaultBars
	var hashArg string
	wantHelp := false
	for i := 0; i < len(args); i++ {
		a := args[i]
		switch {
		case a == "--help" || a == "-h":
			wantHelp = true
		case a == "--bars" && i+1 < len(args):
			n, err := strconv.Atoi(args[i+1])
			if err == nil && n > 0 {
				bars = n
			}
			i++
		case strings.HasPrefix(a, "--bars="):
			n, err := strconv.Atoi(strings.TrimPrefix(a, "--bars="))
			if err == nil && n > 0 {
				bars = n
			}
		case strings.HasPrefix(a, "v0.") || strings.HasPrefix(a, "v1.") || strings.HasPrefix(a, "#"):
			hashArg = a
		default:
			// Unknown args are reserved; surface a hint on stderr.
			fmt.Fprintf(s.Stderr(), "repl: unknown arg %q (try --help)\n", a)
		}
	}
	if wantHelp {
		fmt.Fprint(s.Stderr(), replHelpText())
		return
	}

	var patchText string
	if hashArg != "" {
		text, err := repl.DecodeHash(hashArg)
		if err != nil {
			fmt.Fprintf(s.Stderr(), "repl: couldn't decode hash: %v\n", err)
			return
		}
		patchText = text
	} else {
		body, err := io.ReadAll(io.LimitReader(s, 64*1024))
		if err != nil {
			fmt.Fprintf(s.Stderr(), "repl: couldn't read stdin: %v\n", err)
			return
		}
		patchText = string(body)
	}
	if strings.TrimSpace(patchText) == "" {
		fmt.Fprint(s.Stderr(), "repl: no patch given. pipe a patch on stdin or pass a v1.<hash> arg.\nrun `ssh ssh.cbassuarez.com repl --help` for the full usage.\n")
		return
	}

	wav, err := repl.Render(patchText, content.SampleBank(), repl.RenderOptions{Bars: bars})
	if err != nil {
		// Parse errors come through here too.
		fmt.Fprintf(s.Stderr(), "repl: %v\n", err)
		return
	}
	if _, err := s.Write(wav); err != nil {
		log.Printf("repl: write: %v", err)
	}
}

func replHelpText() string {
	return `cbassuarez repl — make music from the command line.

usage:
  ssh ssh.cbassuarez.com repl < patch.txt          render stdin, stream WAV on stdout
  ssh ssh.cbassuarez.com repl --bars 16 < patch    render N bars (default 8, max ~30)
  ssh ssh.cbassuarez.com repl <v1.hash>            render a previously-shared patch
  ssh ssh.cbassuarez.com repl --help               this message

pipe to a local audio player:
  ssh ssh.cbassuarez.com repl < patch.txt | mpv -
  ssh ssh.cbassuarez.com repl < patch.txt | ffplay -nodisp -autoexit -
  ssh ssh.cbassuarez.com repl < patch.txt | sox -t wav - -d
  ssh ssh.cbassuarez.com repl < patch.txt > out.wav    && play it later

the DSL is the same one the browser REPL speaks. ` +
		`a tiny example:

  tempo 110
  meter 4/4

  string  A3   C4   E4   G4
  force   f    mf   p    f
  decay   4
  crush   8

  sample  snm-*&30  .  .  .
  every   2 bars

see https://cbassuarez.com/labs/repl for the full language and the 300-sample bank.

output: 22050 Hz stereo 16-bit WAV.
`
}
