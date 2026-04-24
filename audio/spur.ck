// title: spur-ck — metallic polyrhythm engine (3/4/5/7)
// engine: chuck
// desc: Layered "rail spikes": short metallic pings from modal stacks.
// usage: play spur-ck

4::second => dur BAR;          // 60 bpm bar
[ 3, 4, 5, 7 ] @=> int DIVS[]; // polymeter divisions
0.18 => float MASTER;          // global output gain

Gain master => dac;
master.gain(MASTER);

// metallic ping (3 partials, short exp decay)
fun void ping(float f, float loud){
    [1.00, 2.01, 2.62] @=> float ratio[];
    [0.9 , 0.4 , 0.25] @=> float amp[];

    for (0 => int i; i < ratio.size(); i++){
        SinOsc s => Gain g => master;
        s.freq(f * ratio[i]);
        g.gain(loud * amp[i]);

        0.12 => float dur;   // seconds
        (dur::second / samp) $ int => int N;
        for (0 => int n; n < N; n++){
            Math.exp(-10.0 * (n $ float / N)) * loud * amp[i] => float env;
            env => g.gain;
            1::samp => now;
        }
        0 => g.gain; 2::ms => now; g =< master; s =< g;
    }
}

fun void railVoice(float freq, int div, float loud){
    (BAR / div) => dur T;
    Std.rand2f(0.0, 0.15) * T => now; // de-lock phase
    while(true){ spork ~ ping(freq, loud); T => now; }
}

// choose rails across spectrum
[ 220.0, 330.0, 495.0, 742.5 ] @=> float rails[];
[ 0.25 , 0.20 , 0.18 , 0.15  ] @=> float louds[];

for (0 => int i; i < 4; i++)
    spork ~ railVoice(rails[i], DIVS[i%DIVS.size()], louds[i]);

while(true) 1::second => now;
