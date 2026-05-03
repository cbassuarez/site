// Render orchestrates parsing → scheduling → synth → mixdown → WAV. Used by
// the SSH `repl` command on the Fly machine. All audio is rendered offline
// into a stereo float32 buffer, then quantized to 16-bit PCM in the WAV
// writer.
package repl

import (
	"io"
	"math"
	"math/rand"
)

const (
	OutputSampleRate = 22050
	MaxRenderSeconds = 60
	DefaultBars      = 8
	TailSeconds      = 2.5 // extra silence after last event so decays finish
)

type RenderOptions struct {
	Bars int // number of bars to render; capped to fit MaxRenderSeconds
}

// Render reads a patch text, returns rendered WAV bytes ready to stream.
func Render(patchText string, bank *SampleBank, opts RenderOptions) ([]byte, error) {
	prog, err := Parse(patchText)
	if err != nil {
		return nil, err
	}

	bars := opts.Bars
	if bars <= 0 {
		bars = DefaultBars
	}

	beatSec := 60.0 / prog.Tempo
	barSec := float64(prog.Meter.Num) * beatSec
	totalSec := float64(bars)*barSec + TailSeconds
	if totalSec > MaxRenderSeconds {
		totalSec = MaxRenderSeconds
		bars = int((totalSec - TailSeconds) / barSec)
		if bars < 1 {
			bars = 1
		}
	}

	totalFrames := int(math.Ceil(totalSec * float64(OutputSampleRate)))
	buf := make([]float32, totalFrames*2)

	if bank != nil {
		// Best-effort pre-load of manifest; not fatal if it fails.
		_ = bank.Ensure()
	}

	rnd := rand.New(rand.NewSource(rand.Int63()))

	for blockIdx := range prog.Blocks {
		block := &prog.Blocks[blockIdx]
		slotSec := barSec / float64(block.SlotsPerBar)
		// Walk top-level slot indices for the duration of the render.
		barsToRender := bars
		topSlots := barsToRender * block.SlotsPerBar
		for slotIdx := 0; slotIdx < topSlots; slotIdx++ {
			slotAbsTime := float64(slotIdx) * slotSec
			barIdx := slotIdx / block.SlotsPerBar
			beatIdx := int(math.Floor(slotAbsTime / beatSec))
			inBlockIdx := slotIdx % len(block.Slots)

			if block.Every != nil {
				var period int
				if block.Every.Bars {
					period = block.Every.Count * block.SlotsPerBar
				} else {
					slotsPerBeat := float64(block.SlotsPerBar) / float64(prog.Meter.Num)
					period = int(math.Round(float64(block.Every.Count) * slotsPerBeat))
					if period < 1 {
						period = 1
					}
				}
				positionInPeriod := slotIdx % period
				if positionInPeriod >= len(block.Slots) {
					continue
				}
				inBlockIdx = positionInPeriod
			}
			_ = barIdx
			_ = beatIdx

			slot := &block.Slots[inBlockIdx]
			startFrame := int(math.Round(slotAbsTime * float64(OutputSampleRate)))
			dispatch(buf, OutputSampleRate, startFrame, slotSec, slot, block, inBlockIdx, slotAbsTime, bank, rnd)
		}
	}

	// Soft normalize: scale down if any peak exceeds 0.95.
	var peak float32
	for _, s := range buf {
		v := s
		if v < 0 {
			v = -v
		}
		if v > peak {
			peak = v
		}
	}
	if peak > 0.95 {
		scale := 0.95 / peak
		for i := range buf {
			buf[i] *= scale
		}
	}

	pr, pw := io.Pipe()
	errCh := make(chan error, 1)
	go func() {
		err := WriteWAV(pw, buf, OutputSampleRate)
		_ = pw.CloseWithError(err)
		errCh <- err
	}()
	wavBytes, readErr := io.ReadAll(pr)
	if readErr != nil {
		return nil, readErr
	}
	if err := <-errCh; err != nil {
		return nil, err
	}
	return wavBytes, nil
}

// dispatch is the recursive entry into the slot tree. duration is the time
// span (in seconds) of this slot/group.
func dispatch(buf []float32, sampleRate, startFrame int, duration float64, slot *Slot, block *Block, slotIdx int, slotAbsTime float64, bank *SampleBank, rnd *rand.Rand) {
	if slot.Kind == SlotGroup {
		n := len(slot.Children)
		if n == 0 {
			return
		}
		subDur := duration / float64(n)
		subFrames := int(math.Round(subDur * float64(sampleRate)))
		for i := range slot.Children {
			child := &slot.Children[i]
			childStart := startFrame + i*subFrames
			dispatch(buf, sampleRate, childStart, subDur, child, block, slotIdx, slotAbsTime+float64(i)*subDur, bank, rnd)
		}
		return
	}

	leaf := slot.Leaf
	if leaf.Kind == LeafRest || leaf.Kind == LeafSustain {
		return
	}

	if block.Voice == VoiceString {
		if leaf.Kind != LeafNote {
			return
		}
		params := StringParams{
			Freq:   leaf.Note.Freq,
			Force:  paramFor(block, "force", slotIdx, 0.7),
			Decay:  paramFor(block, "decay", slotIdx, 4.2),
			Crush:  paramFor(block, "crush", slotIdx, 0),
			Tone:   paramFor(block, "tone", slotIdx, 0.6),
			Harm:   paramFor(block, "harm", slotIdx, 2),
			Octave: paramFor(block, "octave", slotIdx, 0),
			Pan:    paramFor(block, "pan", slotIdx, 0),
			Gain:   paramFor(block, "gain", slotIdx, 1),
		}
		renderString(buf, sampleRate, startFrame, params)
		return
	}

	if block.Voice == VoiceSample {
		var name string
		switch leaf.Kind {
		case LeafSample:
			name = leaf.Sample
		case LeafSampleSelector:
			name = resolveSelectorAt(slot, leaf.Selector, slotAbsTime, bank, rnd)
		}
		if name == "" || bank == nil {
			return
		}
		pcm, err := bank.Get(name, sampleRate)
		if err != nil || len(pcm) == 0 {
			return
		}
		params := SampleParams{
			Gain:  paramFor(block, "gain", slotIdx, 1),
			Pan:   paramFor(block, "pan", slotIdx, 0),
			Rate:  paramFor(block, "rate", slotIdx, 1),
			Start: paramFor(block, "start", slotIdx, 0),
		}
		renderSample(buf, sampleRate, startFrame, pcm, params)
	}
}

// paramFor returns the resolved value for parameter `name` at slot index
// `idx`, falling back to `def`.
func paramFor(block *Block, name string, idx int, def float64) float64 {
	pv, ok := block.Params[name]
	if !ok {
		return def
	}
	if pv.Scalar {
		return pv.Value
	}
	if len(pv.Vector) == 0 {
		return def
	}
	return pv.Vector[((idx%len(pv.Vector))+len(pv.Vector))%len(pv.Vector)]
}

// resolveSelectorAt mirrors the JS scheduler's selector logic — picks per
// event, with frozen / gradient state cached on the slot itself.
func resolveSelectorAt(slot *Slot, sel *Selector, t float64, bank *SampleBank, rnd *rand.Rand) string {
	if bank == nil {
		return ""
	}
	if len(slot.pool) == 0 {
		slot.pool = expandSelector(sel, bank)
		if len(slot.pool) == 0 {
			return ""
		}
	}
	pool := slot.pool

	// No gradient.
	if sel.GradientSec == 0 {
		if sel.Frozen {
			if slot.frozenPick == "" {
				slot.frozenPick = pool[rnd.Intn(len(pool))]
			}
			return slot.frozenPick
		}
		return pool[rnd.Intn(len(pool))]
	}

	N := sel.GradientSec
	if sel.Frozen {
		if !slot.frozenPairD {
			a := pool[rnd.Intn(len(pool))]
			b := pool[rnd.Intn(len(pool))]
			if len(pool) > 1 && b == a {
				b = pool[(rnd.Intn(len(pool)-1)+1)%len(pool)]
			}
			slot.frozenPair = [2]string{a, b}
			slot.frozenPairD = true
		}
		windowIdx := int(math.Floor(t / N))
		f := (t - float64(windowIdx)*N) / N
		var from, to string
		if windowIdx%2 == 0 {
			from, to = slot.frozenPair[0], slot.frozenPair[1]
		} else {
			from, to = slot.frozenPair[1], slot.frozenPair[0]
		}
		if rnd.Float64() < f {
			return to
		}
		return from
	}

	// Unfrozen rolling-window gradient.
	if !slot.gradInit {
		slot.gradLeft = pool[rnd.Intn(len(pool))]
		slot.gradRight = pool[rnd.Intn(len(pool))]
		slot.gradStart = t
		slot.gradInit = true
	}
	for t-slot.gradStart >= N {
		slot.gradLeft = slot.gradRight
		slot.gradRight = pool[rnd.Intn(len(pool))]
		slot.gradStart += N
	}
	f := (t - slot.gradStart) / N
	if rnd.Float64() < f {
		return slot.gradRight
	}
	return slot.gradLeft
}

func expandSelector(sel *Selector, bank *SampleBank) []string {
	if sel == nil || bank == nil {
		return nil
	}
	seen := map[string]bool{}
	out := []string{}
	for _, p := range sel.Pieces {
		if p.Wildcard {
			for _, n := range bank.ExpandPrefix(p.Prefix) {
				if !seen[n] {
					seen[n] = true
					out = append(out, n)
				}
			}
			continue
		}
		if bank.Has(p.Name) && !seen[p.Name] {
			seen[p.Name] = true
			out = append(out, p.Name)
		}
	}
	return out
}

