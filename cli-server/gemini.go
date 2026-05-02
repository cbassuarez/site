package main

import (
	"bufio"
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/url"
	"strings"
	"time"
)

// startGeminiServer implements the Gemini protocol on cfg.GeminiAddr. Routes
// mirror the SSH page names; the body is text/gemini with `=>` links.
func startGeminiServer(ctx context.Context, cfg Config, content *Content) error {
	if cfg.GeminiCert == "" || cfg.GeminiKey == "" {
		return errors.New("gemini: GEMINI_CERT_PATH and GEMINI_KEY_PATH must be set")
	}
	cert, err := tls.LoadX509KeyPair(cfg.GeminiCert, cfg.GeminiKey)
	if err != nil {
		return fmt.Errorf("gemini: load cert: %w", err)
	}
	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
		ClientAuth:   tls.RequestClientCert, // Gemini supports client certs but doesn't require them.
	}

	listener, err := tls.Listen("tcp", cfg.GeminiAddr, tlsConfig)
	if err != nil {
		return fmt.Errorf("gemini: listen: %w", err)
	}
	defer listener.Close()

	go func() {
		<-ctx.Done()
		_ = listener.Close()
	}()

	log.Printf("gemini: listening on %s (TLS) for host %s", cfg.GeminiAddr, cfg.GeminiHost)
	for {
		conn, err := listener.Accept()
		if err != nil {
			if ctx.Err() != nil {
				return nil
			}
			var netErr net.Error
			if errors.As(err, &netErr) && netErr.Timeout() {
				continue
			}
			log.Printf("gemini: accept: %v", err)
			continue
		}
		go handleGeminiConn(conn, cfg, content)
	}
}

func handleGeminiConn(conn net.Conn, cfg Config, content *Content) {
	defer conn.Close()
	_ = conn.SetDeadline(time.Now().Add(15 * time.Second))

	reader := bufio.NewReader(io.LimitReader(conn, 1026)) // 1024 + CRLF
	rawLine, err := reader.ReadString('\n')
	if err != nil {
		return
	}
	requestLine := strings.TrimRight(rawLine, "\r\n")
	if len(requestLine) > 1024 {
		writeGeminiHeader(conn, 59, "request too long")
		return
	}
	u, err := url.Parse(requestLine)
	if err != nil || u.Scheme != "gemini" {
		writeGeminiHeader(conn, 59, "bad request")
		return
	}

	page := classifyGeminiPath(u.Path)
	body := renderGeminiPage(page, content)
	writeGeminiHeader(conn, 20, "text/gemini; charset=utf-8")
	_, _ = io.WriteString(conn, body)
}

func classifyGeminiPath(path string) string {
	trimmed := strings.TrimRight(path, "/")
	switch trimmed {
	case "", "/index.gmi", "/letter":
		return "letter"
	case "/feed", "/feed.gmi":
		return "feed"
	case "/string", "/string.gmi":
		return "string"
	case "/room", "/room.gmi", "/anteroom":
		return "room"
	case "/works", "/works.gmi":
		return "works"
	case "/contact", "/contact.gmi":
		return "contact"
	case "/version", "/version.gmi":
		return "version"
	case "/humans", "/humans.txt":
		return "humans"
	case "/help":
		return "help"
	default:
		return "404"
	}
}

func renderGeminiPage(page string, content *Content) string {
	if page == "404" {
		return "# not found\n\nno page matches that path.\n\n=> / letter\n=> /feed feed\n=> /room /404 anteroom\n=> /works works\n=> /contact contact\n=> /version build\n"
	}
	body := content.RenderPage(page)
	footer := "\n=> / back to the letter\n=> /feed feed\n=> /string /labs/string\n=> /room /404 anteroom\n=> /works works\n=> /contact contact\n=> /version build\n=> /humans humans.txt\n"
	if !strings.HasSuffix(body, "\n") {
		body += "\n"
	}
	return body + footer
}

// writeGeminiHeader writes a Gemini status line: "<code> <meta>\r\n".
func writeGeminiHeader(w io.Writer, code int, meta string) {
	fmt.Fprintf(w, "%02d %s\r\n", code, meta)
}
