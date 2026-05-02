package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

// FallbackLetter is compiled into the binary; it ships if the canonical letter
// at /.well-known/cli-letter.txt is unreachable.
const FallbackLetter = `hello.

this is cbassuarez.com from the command line.
i'm seb. i make cybernetic music systems.

the live surfaces:
  /labs/string    a shared string instrument
  /labs/feed      everything i did online today
  /labs/guestbook a place to leave a small mark

the offline ones:
  let go / letting go · THE TUB · String · Praetorius

if you want to talk:  contact@cbassuarez.com
if you want to read:  this came from /humans.txt

over ssh:    ssh ssh.cbassuarez.com [feed|string|room|works|contact|version]
over gemini: gemini://gemini.cbassuarez.com/

— seb
`

const (
	letterTTL          = 5 * time.Minute
	letterFailureBackoff = 30 * time.Second
	userAgent          = "cbassuarez-cli/1 (+https://cbassuarez.com)"
)

type Content struct {
	WorkerURL string
	LetterURL string

	mu        sync.Mutex
	letter    string
	letterAt  time.Time // last successful fetch
	nextRetry time.Time // earliest time we may try fetching again after a failure
	client    *http.Client
}

func NewContent(workerURL, letterURL string) *Content {
	return &Content{
		WorkerURL: workerURL,
		LetterURL: letterURL,
		letter:    FallbackLetter,
		client:    &http.Client{Timeout: 5 * time.Second},
	}
}

// Letter returns the canonical hand-typed letter, refreshed at most once per
// letterTTL on success and not more often than letterFailureBackoff on
// failure. The fallback letter is returned if we've never fetched
// successfully.
func (c *Content) Letter() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	now := time.Now()
	if !c.letterAt.IsZero() && now.Sub(c.letterAt) < letterTTL {
		return c.letter
	}
	if now.Before(c.nextRetry) {
		return c.letter
	}
	if c.LetterURL != "" {
		req, err := http.NewRequest("GET", c.LetterURL, nil)
		if err == nil {
			req.Header.Set("Accept", "text/plain")
			req.Header.Set("User-Agent", userAgent)
			resp, err := c.client.Do(req)
			if err == nil {
				defer resp.Body.Close()
				if resp.StatusCode == 200 {
					body, readErr := io.ReadAll(io.LimitReader(resp.Body, 16*1024))
					if readErr == nil && len(body) > 0 {
						c.letter = string(body)
						c.letterAt = now
						c.nextRetry = time.Time{}
						return c.letter
					}
				}
			}
		}
	}
	// Fetch failed (or no URL configured); back off so we don't hammer.
	c.nextRetry = now.Add(letterFailureBackoff)
	if c.letter == "" {
		c.letter = FallbackLetter
	}
	return c.letter
}

// RenderPage returns the prose for one of the named sub-pages. Unknown names
// produce a brief "no such page" reply.
func (c *Content) RenderPage(name string) string {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "letter", "home", "index":
		return c.Letter()
	case "feed":
		return c.renderFeed()
	case "string":
		return c.renderString()
	case "room", "404", "anteroom":
		return c.renderRoom()
	case "works":
		return c.renderWorks()
	case "contact":
		return c.renderContact()
	case "version", "build":
		return c.renderVersion()
	case "humans":
		return c.renderHumans()
	case "help", "?":
		return c.renderHelp()
	default:
		return fmt.Sprintf("no such page: %s\n\ntry: feed, string, room, works, contact, version, humans, help.\n", name)
	}
}

func (c *Content) renderHelp() string {
	return strings.Join([]string{
		"available pages:",
		"",
		"  feed      what's been happening online today",
		"  string    /labs/string state",
		"  room      /404 anteroom state",
		"  works     list of works",
		"  contact   how to reach me",
		"  version   build label and recent commits",
		"  humans    /humans.txt",
		"",
	}, "\n")
}

type feedPayload struct {
	Items []struct {
		Source string `json:"source"`
		Text   string `json:"text"`
		At     string `json:"at"`
	} `json:"items"`
}

func (c *Content) httpGet(url string) (*http.Response, error) {
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/json, text/plain;q=0.9")
	return c.client.Do(req)
}

func (c *Content) renderFeed() string {
	resp, err := c.httpGet(c.WorkerURL + "/api/feed?limit=8")
	if err != nil {
		return "the feed is unreachable right now.\n"
	}
	defer resp.Body.Close()
	var data feedPayload
	if err := json.NewDecoder(io.LimitReader(resp.Body, 256*1024)).Decode(&data); err != nil {
		return "the feed gave an unexpected response.\n"
	}
	var b strings.Builder
	b.WriteString("the feed says, today:\n\n")
	if len(data.Items) == 0 {
		b.WriteString("  (the feed is quiet right now.)\n")
	} else {
		for _, it := range data.Items {
			b.WriteString(fmt.Sprintf("  · %-8s %-9s %s\n",
				relativeTime(it.At), padRight(sourceBase(it.Source), 9), truncate(it.Text, 80)))
		}
	}
	b.WriteString("\nmore at https://cbassuarez.com/labs/feed\n")
	return b.String()
}

func (c *Content) renderString() string {
	return strings.Join([]string{
		"the string lab is a shared instrument that lives in your browser.",
		"every visitor plays one string; every pluck travels outward and",
		"returns as sympathetic sound from other strings nearby.",
		"",
		"pluck it yourself at https://cbassuarez.com/labs/string.",
		"",
	}, "\n")
}

type coroomMember struct {
	Who      string `json:"who"`
	Location string `json:"location"`
}
type coroomInstance struct {
	StartedAt int64          `json:"startedAt"`
	Peak      int            `json:"peak"`
	Members   []coroomMember `json:"members"`
}
type coroomLogEntry struct {
	StartedAt  int64          `json:"startedAt"`
	EndedAt    int64          `json:"endedAt"`
	DurationMs int64          `json:"durationMs"`
	Peak       int            `json:"peak"`
	Members    []coroomMember `json:"members"`
}
type coroomSnapshot struct {
	Count            int               `json:"count"`
	CurrentInstance  *coroomInstance   `json:"currentInstance"`
	Log              []coroomLogEntry  `json:"log"`
}

func (c *Content) renderRoom() string {
	resp, err := c.httpGet(c.WorkerURL + "/api/coroom/snapshot")
	if err != nil {
		return "the /404 anteroom is unreachable right now.\n"
	}
	defer resp.Body.Close()
	var snap coroomSnapshot
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1024*1024)).Decode(&snap); err != nil {
		return "the /404 anteroom returned an unexpected response.\n"
	}
	var b strings.Builder
	if snap.CurrentInstance != nil && snap.Count >= 2 {
		dur := formatDuration(time.Now().UnixMilli() - snap.CurrentInstance.StartedAt)
		places := membersPlaces(snap.CurrentInstance.Members)
		b.WriteString(fmt.Sprintf("the /404 anteroom is open right now.\n"))
		b.WriteString(fmt.Sprintf("%d people are present (peak %d); the instance has been open %s.\n",
			snap.Count, snap.CurrentInstance.Peak, dur))
		if places != "" {
			b.WriteString(fmt.Sprintf("they are connecting from %s.\n", places))
		}
		b.WriteString("\nwander toward https://cbassuarez.com/this-does-not-exist if you want to join.\n")
		return b.String()
	}
	if len(snap.Log) == 0 {
		b.WriteString("the /404 anteroom has never opened. it opens when two strangers are\n")
		b.WriteString("simultaneously asking the site for a page that doesn't exist.\n\n")
		b.WriteString("wander toward https://cbassuarez.com/this-does-not-exist if you want to try.\n")
		return b.String()
	}
	last := snap.Log[0]
	dur := formatDuration(last.DurationMs)
	ago := relativeTimeMs(last.EndedAt)
	places := membersPlaces(last.Members)
	b.WriteString("the /404 anteroom is currently closed.\n")
	noun := "people"
	if last.Peak == 1 {
		noun = "person"
	}
	b.WriteString(fmt.Sprintf("it last opened %s for %s, with %d %s.\n", ago, dur, last.Peak, noun))
	if places != "" {
		b.WriteString(fmt.Sprintf("they were from %s.\n", places))
	}
	b.WriteString("\nwander toward https://cbassuarez.com/this-does-not-exist if you want to try.\n")
	return b.String()
}

func (c *Content) renderWorks() string {
	return strings.Join([]string{
		"the offline works:",
		"",
		"  · let go / letting go    cybernetic performance, ongoing.",
		"  · THE TUB                installation + sonic sculpture.",
		"  · String                 cybernetic strings, multi-visitor.",
		"  · Praetorius             prepared instruments + live system.",
		"",
		"the live (online) ones:",
		"",
		"  · /labs/string           shared string instrument.",
		"  · /labs/feed             a feed of what i did online today.",
		"  · /labs/guestbook        a place to leave a small mark.",
		"  · /404 (anteroom)        opens only when two strangers are",
		"                           simultaneously on a page that doesn't exist.",
		"",
		"more at https://cbassuarez.com/works",
		"",
	}, "\n")
}

func (c *Content) renderContact() string {
	return strings.Join([]string{
		"to reach me:",
		"",
		"  email      contact@cbassuarez.com",
		"  form       https://cbassuarez.com/contact",
		"  github     https://github.com/cbassuarez",
		"  bandcamp   https://cbassuarez.bandcamp.com",
		"",
		"i read every email. i answer most of them.",
		"",
		"— seb",
		"",
	}, "\n")
}

type versionPayload struct {
	Sha      string   `json:"sha"`
	ShortSha string   `json:"shortSha"`
	At       string   `json:"at"`
	Subjects []string `json:"subjects"`
}

func (c *Content) renderVersion() string {
	resp, err := c.httpGet("https://cbassuarez.com/version.json")
	if err != nil {
		return "the live build manifest is unreachable right now.\n"
	}
	defer resp.Body.Close()
	var v versionPayload
	if err := json.NewDecoder(io.LimitReader(resp.Body, 32*1024)).Decode(&v); err != nil {
		return "the build manifest gave an unexpected response.\n"
	}
	if v.ShortSha == "" {
		v.ShortSha = truncate(v.Sha, 7)
	}
	at := strings.TrimSuffix(strings.Replace(v.At, "T", " ", 1), "Z")
	if len(at) > 19 {
		at = at[:19]
	}
	var b strings.Builder
	fmt.Fprintf(&b, "build · %s · %s UTC\n\n", v.ShortSha, at)
	if len(v.Subjects) > 0 {
		b.WriteString("recent work:\n")
		for i, s := range v.Subjects {
			if i >= 8 {
				break
			}
			s = strings.TrimSpace(s)
			if s != "" {
				fmt.Fprintf(&b, "  · %s\n", s)
			}
		}
		b.WriteString("\n")
	}
	b.WriteString("more at https://cbassuarez.com/colophon\n")
	return b.String()
}

func (c *Content) renderHumans() string {
	resp, err := c.httpGet("https://cbassuarez.com/humans.txt")
	if err != nil {
		return "humans.txt is unreachable right now.\n"
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "humans.txt is unreachable right now.\n"
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 32*1024))
	if err != nil {
		return "humans.txt is unreachable right now.\n"
	}
	return string(body)
}

// ---------- helpers ----------

func sourceBase(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if i := strings.IndexAny(s, ":"); i >= 0 {
		return s[:i]
	}
	if s == "" {
		return "feed"
	}
	return s
}

func padRight(s string, n int) string {
	if len(s) >= n {
		return s
	}
	return s + strings.Repeat(" ", n-len(s))
}

func truncate(s string, n int) string {
	if n <= 1 {
		return s
	}
	if len(s) <= n {
		return s
	}
	return s[:n-1] + "…"
}

func relativeTime(at string) string {
	t, err := time.Parse(time.RFC3339, at)
	if err != nil {
		return ""
	}
	return relativeTimeMs(t.UnixMilli())
}

func relativeTimeMs(ms int64) string {
	if ms <= 0 {
		return ""
	}
	d := time.Since(time.UnixMilli(ms))
	if d < time.Minute {
		return "now"
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	}
	if d < 24*time.Hour {
		return fmt.Sprintf("%dh ago", int(d.Hours()))
	}
	return fmt.Sprintf("%dd ago", int(d.Hours()/24))
}

func formatDuration(ms int64) string {
	if ms < 0 {
		ms = 0
	}
	s := ms / 1000
	m := s / 60
	r := s % 60
	if m >= 60 {
		h := m / 60
		rm := m % 60
		return fmt.Sprintf("%dh%02dm", h, rm)
	}
	return fmt.Sprintf("%02dm%02ds", m, r)
}

func membersPlaces(members []coroomMember) string {
	seen := map[string]bool{}
	out := []string{}
	for _, m := range members {
		loc := strings.TrimSpace(m.Location)
		if loc == "" || seen[loc] {
			continue
		}
		seen[loc] = true
		out = append(out, loc)
	}
	return strings.Join(out, ", ")
}
