// Sample voice — fetches manifest from cbassuarez.com, lazy-loads mp3/wav
// files, decodes to mono float32 at the synth's sample rate, caches in an
// LRU-bounded map. Each render call resolves selectors against the manifest.
package repl

import (
	"bytes"
	"container/list"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/hajimehoshi/go-mp3"
)

func jsonDecode(b []byte, v any) error { return json.Unmarshal(b, v) }

const (
	cacheMaxBytes = 64 * 1024 * 1024 // 64 MB total decoded buffer cap
	httpTimeout   = 10 * time.Second
)

type ManifestSample struct {
	Name  string `json:"name"`
	URL   string `json:"url"`
	File  string `json:"file"`
	Group string `json:"group"`
}

type ManifestGroup struct {
	ID      string   `json:"id"`
	Label   string   `json:"label"`
	Samples []string `json:"samples"`
}

type Manifest struct {
	Version int              `json:"version"`
	Groups  []ManifestGroup  `json:"groups"`
	Samples []ManifestSample `json:"samples"`
}

type SampleBank struct {
	mu          sync.Mutex
	manifest    *Manifest
	manifestURL string
	httpClient  *http.Client

	// LRU.
	cache  map[string]*list.Element // name -> element holding cacheEntry
	order  *list.List
	bytes  int

	manifestPromise chan error
	manifestOnce    sync.Once
}

type cacheEntry struct {
	name   string
	pcm    []float32 // mono, at outputSampleRate
	bytes  int
}

// NewSampleBank constructs a bank that loads its manifest from the given URL.
// The manifest fetch is kicked off lazily on first need.
func NewSampleBank(manifestURL string) *SampleBank {
	return &SampleBank{
		manifestURL: manifestURL,
		httpClient:  &http.Client{Timeout: httpTimeout},
		cache:       map[string]*list.Element{},
		order:       list.New(),
	}
}

// Ensure makes sure the manifest is loaded. Concurrent callers wait on the
// same in-flight fetch.
func (b *SampleBank) Ensure() error {
	b.manifestOnce.Do(func() {
		b.manifestPromise = make(chan error, 1)
		go func() {
			err := b.fetchManifest()
			b.manifestPromise <- err
		}()
	})
	return <-b.manifestPromise
}

func (b *SampleBank) fetchManifest() error {
	resp, err := b.httpClient.Get(b.manifestURL)
	if err != nil {
		return fmt.Errorf("manifest: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("manifest http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 4*1024*1024))
	if err != nil {
		return err
	}
	var m Manifest
	if err := jsonDecode(body, &m); err != nil {
		return fmt.Errorf("manifest decode: %w", err)
	}
	b.mu.Lock()
	b.manifest = &m
	b.mu.Unlock()
	return nil
}

// Has reports whether `name` exists in the manifest.
func (b *SampleBank) Has(name string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.manifest == nil {
		return false
	}
	for _, s := range b.manifest.Samples {
		if s.Name == name {
			return true
		}
	}
	return false
}

// ExpandPrefix returns all sample names beginning with `prefix`. Empty prefix
// matches every sample. Order matches the manifest.
func (b *SampleBank) ExpandPrefix(prefix string) []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.manifest == nil {
		return nil
	}
	out := []string{}
	for _, s := range b.manifest.Samples {
		if prefix == "" || strings.HasPrefix(s.Name, prefix) {
			out = append(out, s.Name)
		}
	}
	return out
}

// Get returns the decoded mono PCM (at outputSampleRate) for `name`. Fetches
// and decodes lazily; touches LRU on hit.
func (b *SampleBank) Get(name string, outputSampleRate int) ([]float32, error) {
	b.mu.Lock()
	if elem, ok := b.cache[name]; ok {
		b.order.MoveToFront(elem)
		entry := elem.Value.(*cacheEntry)
		b.mu.Unlock()
		return entry.pcm, nil
	}
	b.mu.Unlock()

	pcm, err := b.fetchAndDecode(name, outputSampleRate)
	if err != nil {
		return nil, err
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	// Re-check (another goroutine may have populated meanwhile).
	if elem, ok := b.cache[name]; ok {
		b.order.MoveToFront(elem)
		return elem.Value.(*cacheEntry).pcm, nil
	}
	entry := &cacheEntry{name: name, pcm: pcm, bytes: len(pcm) * 4}
	elem := b.order.PushFront(entry)
	b.cache[name] = elem
	b.bytes += entry.bytes
	for b.bytes > cacheMaxBytes && b.order.Len() > 1 {
		oldest := b.order.Back()
		if oldest == nil {
			break
		}
		old := oldest.Value.(*cacheEntry)
		b.order.Remove(oldest)
		delete(b.cache, old.name)
		b.bytes -= old.bytes
	}
	return pcm, nil
}

func (b *SampleBank) fetchAndDecode(name string, outputSampleRate int) ([]float32, error) {
	b.mu.Lock()
	var url string
	if b.manifest != nil {
		for _, s := range b.manifest.Samples {
			if s.Name == name {
				url = s.URL
				if url == "" && s.File != "" {
					url = "https://cbassuarez.com/labs/repl/samples/" + s.File
				}
				break
			}
		}
	}
	b.mu.Unlock()
	if url == "" {
		return nil, fmt.Errorf("sample '%s' not in manifest", name)
	}
	if strings.HasPrefix(url, "/") {
		url = "https://cbassuarez.com" + url
	}

	resp, err := b.httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("sample %s http %d", name, resp.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8*1024*1024))
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(url)
	switch {
	case strings.HasSuffix(lower, ".wav"):
		return decodeWAV(body, outputSampleRate)
	case strings.HasSuffix(lower, ".mp3"):
		return decodeMP3(body, outputSampleRate)
	default:
		// Best-effort: try wav, fall back to mp3.
		if pcm, err := decodeWAV(body, outputSampleRate); err == nil {
			return pcm, nil
		}
		return decodeMP3(body, outputSampleRate)
	}
}

// decodeWAV: minimal PCM WAV reader. Supports 16-bit linear PCM, mono or
// stereo, any sample rate. Resamples (linear) and downmixes to mono at the
// output sample rate.
func decodeWAV(body []byte, outputSampleRate int) ([]float32, error) {
	if len(body) < 44 {
		return nil, fmt.Errorf("wav: too short")
	}
	if string(body[0:4]) != "RIFF" || string(body[8:12]) != "WAVE" {
		return nil, fmt.Errorf("wav: not RIFF/WAVE")
	}
	var fmtChunk, dataChunk []byte
	pos := 12
	for pos+8 <= len(body) {
		chunkID := string(body[pos : pos+4])
		size := int(binary.LittleEndian.Uint32(body[pos+4 : pos+8]))
		pos += 8
		if pos+size > len(body) {
			break
		}
		switch chunkID {
		case "fmt ":
			fmtChunk = body[pos : pos+size]
		case "data":
			dataChunk = body[pos : pos+size]
		}
		pos += size
		if size%2 == 1 {
			pos++ // pad
		}
	}
	if fmtChunk == nil || dataChunk == nil {
		return nil, fmt.Errorf("wav: missing fmt/data")
	}
	if len(fmtChunk) < 16 {
		return nil, fmt.Errorf("wav: short fmt")
	}
	format := binary.LittleEndian.Uint16(fmtChunk[0:2])
	channels := int(binary.LittleEndian.Uint16(fmtChunk[2:4]))
	srcRate := int(binary.LittleEndian.Uint32(fmtChunk[4:8]))
	bits := int(binary.LittleEndian.Uint16(fmtChunk[14:16]))
	if format != 1 || bits != 16 || (channels != 1 && channels != 2) {
		return nil, fmt.Errorf("wav: unsupported format=%d channels=%d bits=%d", format, channels, bits)
	}
	totalSamples := len(dataChunk) / 2
	frames := totalSamples / channels
	monoSrc := make([]float32, frames)
	for i := 0; i < frames; i++ {
		var sum int32
		for c := 0; c < channels; c++ {
			off := (i*channels + c) * 2
			v := int16(binary.LittleEndian.Uint16(dataChunk[off : off+2]))
			sum += int32(v)
		}
		monoSrc[i] = float32(sum) / float32(channels) / 32768
	}
	return resampleLinear(monoSrc, srcRate, outputSampleRate), nil
}

// decodeMP3 uses go-mp3 to decode to 16-bit stereo at the file's rate, then
// downmixes + resamples.
func decodeMP3(body []byte, outputSampleRate int) ([]float32, error) {
	d, err := mp3.NewDecoder(bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	srcRate := d.SampleRate()
	pcm, err := io.ReadAll(io.LimitReader(d, 32*1024*1024))
	if err != nil {
		return nil, err
	}
	// go-mp3 emits 16-bit stereo little-endian.
	frames := len(pcm) / 4
	monoSrc := make([]float32, frames)
	for i := 0; i < frames; i++ {
		l := int16(binary.LittleEndian.Uint16(pcm[i*4 : i*4+2]))
		r := int16(binary.LittleEndian.Uint16(pcm[i*4+2 : i*4+4]))
		monoSrc[i] = (float32(l) + float32(r)) / 2 / 32768
	}
	return resampleLinear(monoSrc, srcRate, outputSampleRate), nil
}

// resampleLinear does cheap linear-interpolation resampling, mono in/out.
func resampleLinear(src []float32, srcRate, dstRate int) []float32 {
	if srcRate == dstRate {
		out := make([]float32, len(src))
		copy(out, src)
		return out
	}
	if len(src) == 0 {
		return nil
	}
	ratio := float64(srcRate) / float64(dstRate)
	dstLen := int(float64(len(src)) / ratio)
	out := make([]float32, dstLen)
	for i := 0; i < dstLen; i++ {
		srcPos := float64(i) * ratio
		idx := int(srcPos)
		frac := float32(srcPos - float64(idx))
		if idx+1 < len(src) {
			out[i] = src[idx]*(1-frac) + src[idx+1]*frac
		} else {
			out[i] = src[idx]
		}
	}
	return out
}

// SampleParams maps DSL parameters for sample voice events.
type SampleParams struct {
	Gain  float64
	Pan   float64
	Rate  float64
	Start float64 // seconds into the buffer
}

// renderSample writes one sample event into the stereo buf at startFrame.
// Resamples buffer in-place via linear interpolation if rate != 1.
func renderSample(buf []float32, sampleRate int, startFrame int, pcm []float32, p SampleParams) {
	if len(pcm) == 0 {
		return
	}
	pan := clampFf(p.Pan, -1, 1)
	leftG := math.Sqrt((1 - pan) / 2)
	rightG := math.Sqrt((1 + pan) / 2)
	gain := clampFf(p.Gain, 0, 1.5)
	rate := clampFf(p.Rate, 0.25, 4)
	startOffset := int(p.Start * float64(sampleRate))
	if startOffset < 0 {
		startOffset = 0
	}
	if startOffset >= len(pcm) {
		return
	}
	totalFrames := len(buf) / 2
	for i := 0; ; i++ {
		out := startFrame + i
		if out < 0 || out >= totalFrames {
			break
		}
		srcPos := float64(startOffset) + float64(i)*rate
		srcIdx := int(srcPos)
		if srcIdx >= len(pcm)-1 {
			break
		}
		frac := float32(srcPos - float64(srcIdx))
		s := pcm[srcIdx]*(1-frac) + pcm[srcIdx+1]*frac
		s *= float32(gain)
		buf[out*2] += s * float32(leftG)
		buf[out*2+1] += s * float32(rightG)
	}
}
