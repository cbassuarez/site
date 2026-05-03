// URL-hash codec — mirrors the format used by the browser REPL at
// public/labs/repl/repl.js. Two prefixes:
//   v1.<base64url(gzip(text))>
//   v0.<base64url(text)>          (fallback when CompressionStream is missing)
package repl

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

const maxHashBytes = 64 * 1024

// DecodeHash takes a hash string (with or without leading '#') and returns
// the decoded patch text.
func DecodeHash(hash string) (string, error) {
	hash = strings.TrimSpace(hash)
	hash = strings.TrimPrefix(hash, "#")
	if hash == "" {
		return "", errors.New("hash: empty")
	}
	if strings.HasPrefix(hash, "v0.") {
		raw, err := base64URLDecode(hash[3:])
		if err != nil {
			return "", err
		}
		return string(raw), nil
	}
	if strings.HasPrefix(hash, "v1.") {
		raw, err := base64URLDecode(hash[3:])
		if err != nil {
			return "", err
		}
		gz, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			return "", err
		}
		defer gz.Close()
		out, err := io.ReadAll(io.LimitReader(gz, maxHashBytes))
		if err != nil {
			return "", err
		}
		return string(out), nil
	}
	return "", errors.New("hash: unknown prefix (expected v0. or v1.)")
}

// base64URLDecode handles unpadded URL-safe base64.
func base64URLDecode(s string) ([]byte, error) {
	// Pad to multiple of 4.
	pad := len(s) % 4
	if pad != 0 {
		s += strings.Repeat("=", 4-pad)
	}
	return base64.URLEncoding.DecodeString(s)
}
