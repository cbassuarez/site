// Minimal RIFF/WAVE writer — 16-bit PCM stereo at the configured sample rate.
package repl

import (
	"encoding/binary"
	"io"
)

// WriteWAV emits a stereo (interleaved L/R) 16-bit PCM WAV file.
//   pcm: float32 samples in [-1, 1], length must be 2 * frames (L,R,L,R,...).
//   sampleRate: e.g. 22050.
func WriteWAV(w io.Writer, pcm []float32, sampleRate int) error {
	const channels = 2
	const bitsPerSample = 16
	frames := len(pcm) / channels
	dataBytes := frames * channels * (bitsPerSample / 8)
	totalBytes := 36 + dataBytes
	byteRate := sampleRate * channels * (bitsPerSample / 8)
	blockAlign := channels * (bitsPerSample / 8)

	if _, err := w.Write([]byte("RIFF")); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(totalBytes)); err != nil {
		return err
	}
	if _, err := w.Write([]byte("WAVEfmt ")); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(16)); err != nil { // fmt chunk size
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(1)); err != nil { // PCM
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(channels)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(sampleRate)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(byteRate)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(blockAlign)); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint16(bitsPerSample)); err != nil {
		return err
	}
	if _, err := w.Write([]byte("data")); err != nil {
		return err
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(dataBytes)); err != nil {
		return err
	}

	buf := make([]byte, 2)
	for _, s := range pcm {
		// Soft-limit then quantize.
		if s > 1 {
			s = 1
		} else if s < -1 {
			s = -1
		}
		v := int16(s * 32767)
		buf[0] = byte(v)
		buf[1] = byte(v >> 8)
		if _, err := w.Write(buf); err != nil {
			return err
		}
	}
	return nil
}
