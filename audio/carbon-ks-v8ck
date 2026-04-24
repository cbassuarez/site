// carbon-ks.ck — AUDIBLE & STABLE KARPLUS–STRONG
// ------------------------------------------------
// If you need it louder/softer, tweak just MASTER.
0.35 => float MASTER;   // try 0.45 if quiet, 0.25 if hot

// ---------- transport ----------
135.0 => float bpm;
(60.0/bpm)::second => dur spb;
spb/4 => dur step;  // 16ths

// ---------- tuning (JI degrees from A1) ----------
55.0 => float root;               // A1
[1.0, 7.0/6.0, 3.0/2.0, 2.0] @=> float ji[];

// ---------- graph ----------
Noise exc => LPF excLP => ADSR excEnv => Gain inj => DelayA d
          => LPF lp => Gain post => NRev rv => Gain out => dac;

// feedback loop (loss in loop to keep stable)
d => OnePole loss => Gain fb => d;

// limits
2::second => d.max;

// base voicing
4000 => excLP.freq;
1200 => lp.freq;

// loop stability (don’t push these higher than shown)
0.92  => loss.pole;   // energy loss per cycle (lower = darker/safer)
0.94  => fb.gain;     // must be < 1.0

// loudness staging
0.8   => inj.gain;        // energy injection *before* loop (excEnv scales this)
MASTER => post.gain;      // string post-filter gain
0.14  => rv.mix;          // small space
1.0   => out.gain;        // final trim into dac

// ---------- helpers ----------
fun void tune(float f)
{
    Math.max(25.0, f) => f;
    (1.0/f)::second => d.delay;                 // period
    Math.min(6500.0, Math.max(1000.0, f*70)) => lp.freq;
}

fun void pluck(float v)
{
    // short noise burst into the loop (classic KS)
    excEnv.set(1::ms, 9::ms, 0.0, 2::ms);
    Math.min(1.0, Math.max(0.0, v)) => v;
    v => excEnv.gain;
    excEnv.keyOn();
    12::ms => now;
    excEnv.keyOff();
}

// ---------- boot ping ----------
tune(root);
pluck(0.7);

// ostinato: pitches + velocities (clearly audible)
[0,1,2,1, 0,1,3,2] @=> int pat[];
[0.9,0.7,0.8,0.7, 0.85,0.7,0.75,0.8] @=> float vel[];
0 => int k;

while (true)
{
    pat[k % pat.size()] => int idx;
    vel[k % vel.size()] => float v;

    root * ji[idx % ji.size()] => float f;
    tune(f);
    pluck(v);

    k++;
    step => now;
}
