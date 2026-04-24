// title: fracture-ck — stutter / micro-delay glitcher
// engine: chuck
// usage: play fracture-ck

110.0 => float BASE_HZ;     // internal tone
0.16  => float MASTER;      // output level
20::ms => dur MIN_DLY;      // min delay
45::ms => dur MAX_DLY;      // max delay
0.20  => float JUMP_P;      // prob of time-jump per 100ms tick
0.35  => float CHOP_P;      // prob of a chop window
[3,4,5,7] @=> int PERIOD_DIVS[];

// path: tone → delay → gain → dac, with explicit feedback loop
SinOsc osc => DelayL d => Gain g => dac;
osc.freq(BASE_HZ);
0.15 => osc.gain;
g.gain(MASTER);
MAX_DLY => d.max;
30::ms => d.delay;

// explicit feedback
Gain fb => blackhole;
0.35 => fb.gain;
d => fb; fb => d;

// delay time jumps (100ms control loop)
fun void delayJumps(){
    while(true){
        if(Std.rand2f(0.0,1.0) < JUMP_P){
            Std.rand2f(MIN_DLY/second, MAX_DLY/second) => float secs;
            secs::second => d.delay;
        }
        100::ms => now;
    }
}

// polymetric chopping lane
fun void chopLane(int div){
    (4::second / div) => dur T;
    while(true){
        if(Std.rand2f(0.0,1.0) < CHOP_P){
            0.0 => g.gain;
            (T * Std.rand2f(0.2,0.6)) => now;
            MASTER => g.gain;
            (T * Std.rand2f(0.2,0.8)) => now;
        } else { T => now; }
    }
}

spork ~ delayJumps();
for (0 => int i; i < PERIOD_DIVS.size(); i++) spork ~ chopLane(PERIOD_DIVS[i]);

while(true) 1::second => now;
