// title: hopper-ck — percussive grain bursts (no samples)
// engine: chuck
// usage: play hopper-ck

4::second => dur BAR;     // 60 bpm bar
[3,5,7] @=> int DIVS[];   // burst clocks
0.12 => float MASTER;     // output level
220.0 => float CENTER;    // center pitch
0.06 => float GRAIN;      // grain length (s)
12.0 => float JITC;       // cents jitter per grain
4 => int BURST_MIN;
9 => int BURST_MAX;

Gain master => dac;
master.gain(MASTER);

// Hanning-windowed sine grain
fun void grain(float hz, float dur, float amp, float pan){
    SinOsc s => Pan2 p => master;
    p.pan(pan);
    s.freq(hz);
    (dur::second / samp) $ int => int N;
    for (0 => int n; n < N; n++){
        (0.5 - 0.5*Math.cos(2.0*Math.PI * (n $ float / N))) * amp => float env;
        env => s.gain;
        1::samp => now;
    }
    0 => s.gain; 2::ms => now; s =< p; p =< master;
}

// one burst: 4..9 grains with slight detune/pan drift
fun void burst(float center){
    Std.rand2(BURST_MIN, BURST_MAX) => int n;
    Std.rand2f(-0.6, 0.6) => float basePan;
    for(0 => int i; i < n; i++){
        Math.pow(2.0, Std.rand2f(-JITC, JITC)/1200.0) * center => float hz;
        Math.max(-1.0, Math.min(1.0, basePan + Std.rand2f(-0.2,0.2))) => float pan;
        spork ~ grain(hz, GRAIN, 0.12, pan);
        Std.rand2f(0.010, 0.030)::second => now; // intra-burst spacing
    }
}

// burst lane
fun void burstLane(int div, float mult){
    (BAR / div) => dur T;
    Std.rand2f(0.0, 0.25) * T => now; // phase offset
    while(true){ spork ~ burst(CENTER * mult); T => now; }
}

for (0 => int i; i < DIVS.size(); i++) spork ~ burstLane(DIVS[i], Math.pow(2.0, i-1));

while(true) 1::second => now;
