// hematite-reson.ck — AUDIBLE MODAL RESONATOR (NO FEEDBACK)
// ---------------------------------------------------------
// If you need it louder/softer, tweak just MASTER.
0.40 => float MASTER;   // try 0.50 if quiet, 0.28 if hot

// ---------- transport ----------
135.0 => float bpm;
(60.0/bpm)::second => dur spb;
spb/2 => dur hitInt;    // 8ths

// ---------- output bus ----------
Gain sum => NRev rev => Gain out => dac;
0.18  => rev.mix;
MASTER => out.gain;

// ---------- exciters ----------
Impulse imp => Gain dry => sum;           // tiny click to mark onset
Noise n     => LPF nlpf => ADSR env => Gain push => sum;

4500 => nlpf.freq;
0.030 => dry.gain;        // small direct tick (audible, not hot)
0.6   => push.gain;       // noise drive *before* env (env scales further)
env.set(1::ms, 70::ms, 0.0, 10::ms);

// ---------- modal bank (purely feed-forward) ----------
class Mode {
    ResonZ f;
    Gain   g;
}

// build a balanced “gong-ish” bank near ~A3
fun void buildBank(float baseHz)
{
    Mode m[6];
    [1.00, 1.41, 1.79, 2.15, 2.32, 2.63] @=> float r[];
    [0.24, 0.21, 0.18, 0.15, 0.12, 0.10] @=> float t[]; // per-mode taps (audible)

    for (0 => int i; i < m.size(); i++)
    {
        m[i] <- new Mode;
        // wire: exc (noise+tick) -> reson -> per-mode tap -> sum
        push => m[i].f => m[i].g => sum;
        baseHz * r[i] => m[i].f.freq;
        Math.max(30.0, 110.0 - i*12.0) => m[i].f.Q;   // moderate Q
        t[i] => m[i].g.gain;
    }
}

// center around A3
buildBank(220.0);

// ---------- strike (clearly audible) ----------
fun void strike(float amt)
{
    Math.min(1.0, Math.max(0.0, amt)) => float a;

    // onset tick
    a => imp.next; 1::samp => now;

    // brief noise puff
    a => env.gain;
    env.keyOn();
    60::ms => now;
    env.keyOff();
}

// boot confirm
strike(0.95);

// simple ostinato
while (true)
{
    hitInt => now;
    strike(0.75);
}
