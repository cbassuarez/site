// DSL — Go port of public/labs/repl/dsl.js. Parses score-grid notation into
// a Program of voice blocks for the offline renderer. Slot trees can nest;
// sample selectors support `*`, `!`, `&N`, and `/` operators.
package repl

import (
	"errors"
	"fmt"
	"math"
	"regexp"
	"strconv"
	"strings"
)

// ---------- AST ----------

type Voice string

const (
	VoiceString Voice = "string"
	VoiceSample Voice = "sample"
)

type SlotKind int

const (
	SlotLeaf SlotKind = iota
	SlotGroup
)

type LeafKind int

const (
	LeafRest LeafKind = iota
	LeafSustain
	LeafNote
	LeafSample
	LeafSampleSelector
)

type Note struct {
	Name string
	Freq float64
}

type SelectorPiece struct {
	Wildcard bool
	Prefix   string // for wildcard pieces
	Name     string // for concrete pieces
}

type Selector struct {
	Pieces      []SelectorPiece
	GradientSec float64 // 0 means no gradient
	Frozen      bool
	Raw         string
}

type Leaf struct {
	Kind     LeafKind
	Note     Note
	Sample   string
	Selector *Selector
}

type Slot struct {
	Kind     SlotKind
	Leaf     Leaf
	Children []Slot

	// Mutable runtime state for selector slots (set during render). Per-slot
	// so identical tokens in different positions track independent rolls.
	pool        []string
	frozenPick  string
	frozenPair  [2]string
	frozenPairD bool
	gradStart   float64
	gradLeft    string
	gradRight   string
	gradInit    bool
}

type ParamValue struct {
	Scalar bool
	Value  float64
	Vector []float64
}

type Every struct {
	Count int
	Bars  bool // true: bars, false: beats
}

type Block struct {
	Voice       Voice
	Slots       []Slot
	SlotsPerBar int
	Bars        int
	Params      map[string]ParamValue
	Every       *Every
	Line        int
}

type Program struct {
	Tempo  float64
	Meter  Meter
	Blocks []Block
}

type Meter struct {
	Num int
	Den int
}

// ---------- vocabulary ----------

var voiceNames = map[string]Voice{
	"string": VoiceString,
	"sample": VoiceSample,
}

var paramNames = map[string]bool{
	"force": true, "decay": true, "crush": true, "pan": true, "gain": true,
	"tone": true, "harm": true, "octave": true, "every": true, "rate": true, "start": true,
}

var fileDirectives = map[string]bool{"tempo": true, "meter": true}

var forceNamed = map[string]float64{
	"pp": 0.18, "p": 0.32, "mp": 0.50, "mf": 0.70, "f": 0.88, "ff": 1.05, "fff": 1.20,
}
var panNamed = map[string]float64{"left": -0.7, "center": 0, "right": 0.7}
var gainNamed = map[string]float64{"quiet": 0.35, "half": 0.55, "full": 1.0, "loud": 1.3}
var toneNamed = map[string]float64{"dark": 0.2, "bright": 0.85}
var harmNamed = map[string]float64{"simple": 1, "pair": 2, "triad": 3, "rich": 4}

var noteRe = regexp.MustCompile(`^([A-Ga-g])([#b]?)(-?\d{1,2})$`)
var sampleNameRe = regexp.MustCompile(`^[a-z][a-z0-9_-]*$`)

func clampF(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// ---------- comment-stripping (only `//` after start-of-line/whitespace) ----------

func stripComment(line string) string {
	for i := 0; i+1 < len(line); i++ {
		if line[i] == '/' && line[i+1] == '/' {
			if i == 0 || line[i-1] == ' ' || line[i-1] == '\t' {
				return line[:i]
			}
		}
	}
	return line
}

// ---------- slot tokenizer (paren-aware) ----------

func tokenizeSlotLine(text string) []string {
	out := []string{}
	buf := strings.Builder{}
	flush := func() {
		if buf.Len() > 0 {
			out = append(out, buf.String())
			buf.Reset()
		}
	}
	for i := 0; i < len(text); i++ {
		ch := text[i]
		if ch == '(' || ch == ')' {
			flush()
			out = append(out, string(ch))
			continue
		}
		if ch == ' ' || ch == '\t' {
			flush()
			continue
		}
		buf.WriteByte(ch)
	}
	flush()
	return out
}

// ---------- note → Hz ----------

func noteToFreq(tok string) (float64, bool) {
	m := noteRe.FindStringSubmatch(tok)
	if m == nil {
		return 0, false
	}
	name := strings.ToUpper(m[1])
	accidental := m[2]
	octave, err := strconv.Atoi(m[3])
	if err != nil {
		return 0, false
	}
	semis := map[string]int{"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[name]
	if accidental == "#" {
		semis++
	} else if accidental == "b" {
		semis--
	}
	midi := (octave+1)*12 + semis
	return 440 * math.Pow(2, float64(midi-69)/12), true
}

// ---------- selector parser ----------

func parseSampleSelector(tok string) (*Selector, error) {
	frozen := false
	body := tok
	if strings.HasSuffix(body, "!") {
		frozen = true
		body = body[:len(body)-1]
	}
	gradSec := 0.0
	if i := strings.LastIndexByte(body, '&'); i >= 0 {
		head := body[:i]
		tail := body[i+1:]
		if head == "" {
			return nil, errors.New("selector: '&' has no body before it")
		}
		f, err := strconv.ParseFloat(tail, 64)
		if err != nil || f <= 0 || math.IsInf(f, 0) || math.IsNaN(f) {
			return nil, fmt.Errorf("selector: '&%s' isn't a positive number", tail)
		}
		gradSec = f
		body = head
	}
	if body == "" {
		return nil, errors.New("selector: empty body")
	}
	parts := strings.Split(body, "/")
	if len(parts) == 0 {
		return nil, errors.New("selector: empty")
	}
	pieces := []SelectorPiece{}
	hasWildcard := false
	for _, part := range parts {
		if part == "" {
			return nil, errors.New("selector: empty piece in pipeline")
		}
		if part == "*" {
			pieces = append(pieces, SelectorPiece{Wildcard: true, Prefix: ""})
			hasWildcard = true
			continue
		}
		if strings.HasSuffix(part, "*") {
			prefix := part[:len(part)-1]
			if !sampleNameRe.MatchString(prefix) {
				return nil, fmt.Errorf("selector: '%s' isn't a valid prefix", prefix)
			}
			pieces = append(pieces, SelectorPiece{Wildcard: true, Prefix: prefix})
			hasWildcard = true
			continue
		}
		if !sampleNameRe.MatchString(part) {
			return nil, fmt.Errorf("selector: '%s' isn't a valid id", part)
		}
		if voiceNames[part] != "" || paramNames[part] {
			return nil, fmt.Errorf("selector: '%s' is reserved", part)
		}
		pieces = append(pieces, SelectorPiece{Wildcard: false, Name: part})
	}
	isAdvanced := hasWildcard || len(pieces) > 1 || gradSec > 0 || frozen
	_ = isAdvanced
	return &Selector{
		Pieces:      pieces,
		GradientSec: gradSec,
		Frozen:      frozen,
		Raw:         tok,
	}, nil
}

func selectorIsAdvanced(s *Selector) bool {
	if s == nil {
		return false
	}
	if s.GradientSec > 0 || s.Frozen {
		return true
	}
	if len(s.Pieces) > 1 {
		return true
	}
	for _, p := range s.Pieces {
		if p.Wildcard {
			return true
		}
	}
	return false
}

// ---------- main parse ----------

type ParseError struct {
	Line    int
	Message string
}

func (e ParseError) Error() string {
	return fmt.Sprintf("line %d: %s", e.Line, e.Message)
}

type ParseErrors []ParseError

func (e ParseErrors) Error() string {
	parts := make([]string, len(e))
	for i, p := range e {
		parts[i] = p.Error()
	}
	return strings.Join(parts, "\n")
}

// Parse turns a patch string into a Program. Returns ParseErrors if any
// syntactic problem is found.
func Parse(text string) (*Program, error) {
	prog := &Program{Tempo: 110, Meter: Meter{Num: 4, Den: 4}}
	var errs ParseErrors
	var current *Block

	endBlock := func() {
		if current != nil {
			prog.Blocks = append(prog.Blocks, *current)
			current = nil
		}
	}

	rawLines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"), "\n")

	for i, raw := range rawLines {
		lineNo := i + 1
		stripped := strings.TrimRight(stripComment(raw), " \t")
		trimmed := strings.TrimSpace(stripped)
		if trimmed == "" {
			endBlock()
			continue
		}
		firstSpaceIdx := strings.IndexAny(trimmed, " \t")
		var head, tail string
		if firstSpaceIdx < 0 {
			head = strings.ToLower(trimmed)
			tail = ""
		} else {
			head = strings.ToLower(trimmed[:firstSpaceIdx])
			tail = strings.TrimLeft(trimmed[firstSpaceIdx+1:], " \t")
		}

		// File directives.
		if fileDirectives[head] {
			endBlock()
			args := strings.Fields(tail)
			switch head {
			case "tempo":
				if len(args) == 0 {
					errs = append(errs, ParseError{lineNo, "tempo needs a positive bpm number"})
					break
				}
				t, err := strconv.ParseFloat(args[0], 64)
				if err != nil || t <= 0 {
					errs = append(errs, ParseError{lineNo, "tempo needs a positive bpm number"})
					break
				}
				prog.Tempo = t
			case "meter":
				if len(args) == 0 {
					errs = append(errs, ParseError{lineNo, "meter must be like 4/4 or 6/8"})
					break
				}
				m := regexp.MustCompile(`^(\d+)/(\d+)$`).FindStringSubmatch(args[0])
				if m == nil {
					errs = append(errs, ParseError{lineNo, "meter must be like 4/4 or 6/8"})
					break
				}
				n, _ := strconv.Atoi(m[1])
				d, _ := strconv.Atoi(m[2])
				prog.Meter = Meter{Num: n, Den: d}
			}
			continue
		}

		// Voice line.
		if v, ok := voiceNames[head]; ok {
			endBlock()
			tokens := tokenizeSlotLine(tail)
			if len(tokens) == 0 {
				errs = append(errs, ParseError{lineNo, fmt.Sprintf("voice '%s' has no slots", head)})
				continue
			}
			slots, bars, slotErrs := parseSlotStream(tokens, v, lineNo)
			errs = append(errs, slotErrs...)
			if len(slots) == 0 {
				continue
			}
			if len(slots)%bars != 0 {
				errs = append(errs, ParseError{lineNo, fmt.Sprintf("bar count (%d) doesn't divide slot count (%d)", bars, len(slots))})
			}
			current = &Block{
				Voice:       v,
				Slots:       slots,
				SlotsPerBar: max1(len(slots) / bars),
				Bars:        bars,
				Params:      map[string]ParamValue{},
				Line:        lineNo,
			}
			continue
		}

		// Parameter line.
		if paramNames[head] {
			if current == nil {
				errs = append(errs, ParseError{lineNo, fmt.Sprintf("parameter '%s' has no voice above it", head)})
				continue
			}
			if head == "every" {
				args := strings.Fields(tail)
				if len(args) < 2 {
					errs = append(errs, ParseError{lineNo, "every must read like 'every 4 bars' or 'every 8 beats'"})
					continue
				}
				n, err := strconv.Atoi(args[0])
				unit := strings.ToLower(args[1])
				if err != nil || n <= 0 || (unit != "bars" && unit != "beats") {
					errs = append(errs, ParseError{lineNo, "every must read like 'every 4 bars' or 'every 8 beats'"})
					continue
				}
				current.Every = &Every{Count: n, Bars: unit == "bars"}
				continue
			}
			valueTokens := []string{}
			for _, t := range strings.Fields(tail) {
				if t == "|" {
					continue
				}
				valueTokens = append(valueTokens, t)
			}
			if len(valueTokens) == 0 {
				errs = append(errs, ParseError{lineNo, fmt.Sprintf("%s needs at least one value", head)})
				continue
			}
			vals := []float64{}
			fail := false
			for _, v := range valueTokens {
				f, err := resolveParam(head, v)
				if err != nil {
					errs = append(errs, ParseError{lineNo, err.Error()})
					fail = true
					break
				}
				vals = append(vals, f)
			}
			if fail {
				continue
			}
			if len(vals) == 1 {
				current.Params[head] = ParamValue{Scalar: true, Value: vals[0]}
			} else {
				current.Params[head] = ParamValue{Scalar: false, Vector: vals}
			}
			continue
		}

		errs = append(errs, ParseError{lineNo, fmt.Sprintf("don't recognize '%s'", head)})
	}
	endBlock()

	if len(errs) > 0 {
		return nil, errs
	}
	for i := range prog.Blocks {
		resolveSustains(prog.Blocks[i].Slots)
	}
	return prog, nil
}

func max1(n int) int {
	if n < 1 {
		return 1
	}
	return n
}

// parseSlotStream parses a sequence of tokens (with parens) into slots and a bar count.
func parseSlotStream(tokens []string, voice Voice, lineNo int) ([]Slot, int, []ParseError) {
	pos := 0
	bars := 1
	slots := []Slot{}
	errs := []ParseError{}

	classifyLeaf := func(tok string) (Leaf, bool) {
		if tok == "." || tok == "-" {
			return Leaf{Kind: LeafRest}, true
		}
		if tok == "~" {
			return Leaf{Kind: LeafSustain}, true
		}
		if voice == VoiceString {
			if freq, ok := noteToFreq(tok); ok {
				return Leaf{Kind: LeafNote, Note: Note{Name: tok, Freq: freq}}, true
			}
			return Leaf{}, false
		}
		if voice == VoiceSample {
			selector, err := parseSampleSelector(tok)
			if err == nil && selector != nil {
				if selectorIsAdvanced(selector) {
					return Leaf{Kind: LeafSampleSelector, Selector: selector}, true
				}
				// Plain concrete name → simpler leaf shape.
				return Leaf{Kind: LeafSample, Sample: selector.Pieces[0].Name}, true
			}
			return Leaf{}, false
		}
		return Leaf{}, false
	}

	var parseGroup func() Slot
	parseGroup = func() Slot {
		group := Slot{Kind: SlotGroup}
		for pos < len(tokens) {
			t := tokens[pos]
			if t == ")" {
				pos++
				return group
			}
			if t == "(" {
				pos++
				group.Children = append(group.Children, parseGroup())
				continue
			}
			if t == "|" {
				errs = append(errs, ParseError{lineNo, "unexpected '|' inside (...) group"})
				pos++
				continue
			}
			leaf, ok := classifyLeaf(t)
			if !ok {
				errs = append(errs, ParseError{lineNo, fmt.Sprintf("'%s' isn't valid for voice '%s'", t, voice)})
				group.Children = append(group.Children, Slot{Kind: SlotLeaf, Leaf: Leaf{Kind: LeafRest}})
				pos++
				continue
			}
			group.Children = append(group.Children, Slot{Kind: SlotLeaf, Leaf: leaf})
			pos++
		}
		errs = append(errs, ParseError{lineNo, "'(' wasn't closed by ')'"})
		return group
	}

	for pos < len(tokens) {
		t := tokens[pos]
		if t == "|" {
			bars++
			pos++
			continue
		}
		if t == "(" {
			pos++
			slots = append(slots, parseGroup())
			continue
		}
		if t == ")" {
			errs = append(errs, ParseError{lineNo, "extra ')'"})
			pos++
			continue
		}
		leaf, ok := classifyLeaf(t)
		if !ok {
			errs = append(errs, ParseError{lineNo, fmt.Sprintf("'%s' isn't valid for voice '%s'", t, voice)})
			slots = append(slots, Slot{Kind: SlotLeaf, Leaf: Leaf{Kind: LeafRest}})
			pos++
			continue
		}
		slots = append(slots, Slot{Kind: SlotLeaf, Leaf: leaf})
		pos++
	}
	return slots, bars, errs
}

// resolveSustains walks slot trees in DFS order; ~ leaves become repeats of the
// most-recent note (or rests if none preceded).
func resolveSustains(slots []Slot) {
	var lastNote *Note
	var visit func(s *Slot)
	visit = func(s *Slot) {
		if s.Kind == SlotLeaf {
			if s.Leaf.Kind == LeafNote {
				ln := s.Leaf.Note
				lastNote = &ln
				return
			}
			if s.Leaf.Kind == LeafSustain {
				if lastNote != nil {
					s.Leaf = Leaf{Kind: LeafNote, Note: *lastNote}
				} else {
					s.Leaf = Leaf{Kind: LeafRest}
				}
			}
			return
		}
		for i := range s.Children {
			visit(&s.Children[i])
		}
	}
	for i := range slots {
		visit(&slots[i])
	}
}

// resolveParam mirrors the JS resolution: named values + bounded numbers.
func resolveParam(name, raw string) (float64, error) {
	lower := strings.ToLower(raw)
	num, numErr := strconv.ParseFloat(raw, 64)
	switch name {
	case "force":
		if v, ok := forceNamed[lower]; ok {
			return v, nil
		}
		if numErr == nil {
			return clampF(num, 0, 1), nil
		}
		return 0, fmt.Errorf("force '%s' isn't a dynamic", raw)
	case "decay":
		if numErr == nil {
			return clampF(num, 0.4, 8), nil
		}
		return 0, fmt.Errorf("decay must be 0.4–8 seconds")
	case "crush":
		if lower == "off" || raw == "0" {
			return 0, nil
		}
		if numErr == nil {
			return clampF(math.Round(num), 4, 16), nil
		}
		return 0, fmt.Errorf("crush must be 0/off or 4–16")
	case "pan":
		if v, ok := panNamed[lower]; ok {
			return v, nil
		}
		if numErr == nil {
			return clampF(num, -1, 1), nil
		}
		return 0, fmt.Errorf("pan '%s' must be left/center/right or ±1", raw)
	case "gain":
		if v, ok := gainNamed[lower]; ok {
			return v, nil
		}
		if numErr == nil {
			return clampF(num, 0, 1.5), nil
		}
		return 0, fmt.Errorf("gain '%s' must be quiet/half/full/loud or 0–1.5", raw)
	case "tone":
		if v, ok := toneNamed[lower]; ok {
			return v, nil
		}
		if numErr == nil {
			return clampF(num, 0, 1), nil
		}
		return 0, fmt.Errorf("tone '%s' must be dark/bright or 0–1", raw)
	case "harm":
		if v, ok := harmNamed[lower]; ok {
			return v, nil
		}
		if numErr == nil {
			return clampF(math.Round(num), 0, 4), nil
		}
		return 0, fmt.Errorf("harm '%s' must be simple/pair/triad/rich or 0–4", raw)
	case "octave":
		if numErr == nil {
			return clampF(math.Round(num), -2, 2), nil
		}
		return 0, fmt.Errorf("octave must be ±2")
	case "rate":
		if numErr == nil {
			return clampF(num, 0.25, 4), nil
		}
		return 0, fmt.Errorf("rate must be 0.25–4")
	case "start":
		if numErr == nil {
			return math.Max(0, num), nil
		}
		return 0, fmt.Errorf("start must be non-negative")
	}
	return 0, fmt.Errorf("unknown parameter '%s'", name)
}
