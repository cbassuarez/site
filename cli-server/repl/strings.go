// String voice — additive sine stack with attack/exp-decay envelope, optional
// bitcrush, optional 1-pole lowpass, stereo pan. Mirrors the parameter mapping
// used by public/labs/repl/voices/string.js so a patch sounds the same in
// either runtime.
package repl

import (
	"math"
)

const (
	pitchLowHz   = 41.2
	pitchHighHz  = 1046.5
	voiceAttackS = 0.030
	decayFloor   = 0.0005
)

type StringParams struct {
	Freq   float64 // Hz
	Force  float64 // 0..1
	Decay  float64 // seconds
	Crush  float64 // 0 or 4..16
	Tone   float64 // 0..1
	Harm   float64 // 0..4 (number of partials beyond fundamental)
	Octave float64 // -2..2
	Pan    float64 // -1..1
	Gain   float64 // 0..1.5
}

func freqToX01(f float64) float64 {
	if f < pitchLowHz {
		f = pitchLowHz
	}
	if f > pitchHighHz {
		f = pitchHighHz
	}
	return math.Log(f/pitchLowHz) / math.Log(pitchHighHz/pitchLowHz)
}

func edgeExcitation(x01 float64) float64 {
	center := 1 - math.Abs(x01-0.5)*2
	return 0.28 + (1-0.28)*center
}

// renderString writes a single string event into the stereo `buf` starting at
// `startFrame`. Buf is interleaved L,R,L,R; len(buf) = 2 * totalFrames.
func renderString(buf []float32, sampleRate int, startFrame int, p StringParams) {
	x01 := freqToX01(p.Freq)
	edge := edgeExcitation(x01)
	pickBright := clampFf(0.45+math.Abs(x01-0.5)*1.2+p.Force*0.35, 0.2, 1.55)
	playFreq := p.Freq * math.Pow(2, p.Octave)

	// Envelope params.
	attack := voiceAttackS * (1.48 - p.Tone*0.75)
	if attack < 0.003 {
		attack = 0.003
	}
	gainScale := clampFf(p.Gain*(0.68+edge*0.42+p.Force*0.26), 0, 1.25) * 0.40

	durationFrames := int(math.Ceil((p.Decay + 0.05) * float64(sampleRate)))
	attackFrames := int(math.Round(attack * float64(sampleRate)))
	totalFrames := len(buf) / 2

	// Lowpass filter state (1-pole) — frequency from tone+brightness.
	cutoff := 900 + (p.Tone*6200 + pickBright*2500)
	if cutoff > float64(sampleRate)/2-100 {
		cutoff = float64(sampleRate)/2 - 100
	}
	rc := 1.0 / (2 * math.Pi * cutoff)
	dt := 1.0 / float64(sampleRate)
	alpha := dt / (rc + dt)
	var lpfState float64

	// Bitcrush levels (2^bits).
	var crushLevels float64
	if p.Crush >= 4 {
		crushLevels = math.Pow(2, p.Crush)
	}

	// Pan gains (constant-power approx).
	pan := clampFf(p.Pan, -1, 1)
	leftG := math.Sqrt((1 - pan) / 2)
	rightG := math.Sqrt((1 + pan) / 2)

	// Partials: addPartial(freq * n, partialGain * pickMode, n).
	type partial struct {
		freq float64
		gain float64
	}
	partials := []partial{
		{playFreq, 1},
	}
	if p.Harm >= 1 {
		partials = append(partials, partial{playFreq * 2, 0.12 + pickBright*0.22})
	}
	if p.Harm >= 2 {
		partials = append(partials, partial{playFreq * 3, 0.04 + pickBright*0.18})
	}
	if p.Harm >= 3 {
		partials = append(partials, partial{playFreq * 4, 0.02 + pickBright*0.14})
	}
	if p.Harm >= 4 {
		partials = append(partials, partial{playFreq * 5, 0.01 + pickBright*0.10})
	}
	// pickMode shapes per-partial response by harmonic number and pluck position.
	for i := range partials {
		n := float64(i + 1)
		pickMode := 0.20 + 0.80*math.Abs(math.Sin(math.Pi*n*x01))
		partials[i].gain *= pickMode
	}

	// Phase accumulators (one per partial).
	phase := make([]float64, len(partials))

	// Decay multiplier per frame: env reaches DECAY_FLOOR over decaySec frames.
	decayFrames := math.Max(1, p.Decay*float64(sampleRate))
	expFactor := math.Pow(decayFloor, 1.0/decayFrames)

	envelope := func(frame int) float64 {
		// Linear ramp from 0 → gainScale during attack.
		// Then exponential decay from gainScale → DECAY_FLOOR over decayFrames.
		if frame <= attackFrames {
			if attackFrames == 0 {
				return gainScale
			}
			return gainScale * (float64(frame) / float64(attackFrames))
		}
		// Exponential decay, indexed from end-of-attack.
		k := frame - attackFrames
		return gainScale * math.Pow(expFactor, float64(k))
	}

	for i := 0; i < durationFrames; i++ {
		out := startFrame + i
		if out < 0 || out >= totalFrames {
			continue
		}
		env := envelope(i)
		// Sum partials.
		var s float64
		for j, pa := range partials {
			phase[j] += 2 * math.Pi * pa.freq / float64(sampleRate)
			if phase[j] > 2*math.Pi {
				phase[j] -= 2 * math.Pi
			}
			s += math.Sin(phase[j]) * pa.gain
		}
		s *= env
		// Bitcrush.
		if crushLevels > 0 {
			s = math.Round(s*crushLevels) / crushLevels
		}
		// 1-pole LPF.
		lpfState += alpha * (s - lpfState)
		s = lpfState
		// Pan into stereo.
		buf[out*2] += float32(s * leftG)
		buf[out*2+1] += float32(s * rightG)
	}
}

func clampFf(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}
