// title: grainmill-ck — granular/no-sample grain cloud (sine grains)
// engine: chuck
// usage: play grainmill-ck

220.0 => float CENTER_HZ; // center pitch
24    => int   GRAINS_PS; // grains per second
0.08  => float GRAIN_SEC; // grain length (s)
12.0  => float JITTER_CT; // cents detune ±
0.030 => float SPRAY_SEC; // timing jitter ± (s)
0.18  => float MASTER;    // master gain
0.10  => float GLITCH_P;  // chance/sec for glitch sweep

Gain master => dac;
master.gain(MASTER);

// Hanning-windowed sine grain
fun void grain(float hz, float dur, float amp, float panL){
    SinOsc s => Pan2 p => master;
    s.freq(hz);
    p.pan(panL);
    (dur::second / samp) $ int => int N;
    for (0 => int n; n < N; n++){
        (0.5 - 0.5*Math.cos(2.0*Math.PI * (n $ float / N))) * amp => float env;
        env => s.gain;
        1::samp => now;
    }
    0 => s.gain; 2::ms => now; s =< p; p =< master;
}

(1.0 / Math.max(1, GRAINS_PS))::second => dur step;

// regular grain clock
fun void grainClock(){
    while(true){
        Std.rand2f(-SPRAY_SEC, SPRAY_SEC)::second => now;
        Math.pow(2.0, Std.rand2f(-JITTER_CT, JITTER_CT)/1200.0) * CENTER_HZ => float hz;
        Std.rand2f(-0.8, 0.8) => float pan;
        spork ~ grain(hz, GRAIN_SEC, 0.11, pan);
        step => now;
    }
}

// occasional glitch burst: fast rising sweep of micro grains
fun void glitcher(){
    while(true){
        1::second => now;
        if(Std.rand2f(0.0,1.0) < GLITCH_P){
            14 => int n;
            for(0 => int i; i < n; i++){
                (CENTER_HZ * Math.pow(2.0, (i $ float / n) * 0.33)) => float hz;
                spork ~ grain(hz, 0.03, 0.12, Std.rand2f(-1.0,1.0));
                20::ms => now;
            }
        }
    }
}

spork ~ grainClock();
spork ~ glitcher();

while(true) 1::second => now;
