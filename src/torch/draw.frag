precision highp float;

#pragma glslify: import(./head)

uniform sampler2D audio;
uniform sampler2D form;

uniform float peak;
uniform float peakPos;
uniform float mean;

uniform float frequencies;
uniform float harmonies;
uniform float silent;
uniform float soundSmooth;
uniform float soundWarp;

uniform float noiseWarp;
uniform float noiseSpeed;
uniform float noiseScale;

uniform float attenuate;

uniform float spin;

uniform float radius;
uniform float thick;

uniform float otherRadius;
uniform float otherThick;
uniform float otherEdge;

uniform vec4 ambient;
uniform vec4 emit;

// @todo Noise in form as well?
#pragma glslify: noise = require(glsl-noise/simplex/3d)

#pragma glslify: hsv2rgb = require(../../libs/glsl-hsv/hsv-rgb)

#pragma glslify: preAlpha = require(../tendrils/utils/pre-alpha)

#pragma glslify: posToAngle = require(./pos-to-angle)

#pragma glslify: sampleSound = require(./sample-sound)
#pragma glslify: toCircle = require(./sdf/circle)
#pragma glslify: toTriangle = require(./sdf/triangle)

void main() {
    vec2 uv = gl_FragCoord.xy/viewRes;
    vec2 pos = uvToPos(uv)/viewSize;

    float dist = length(pos);
    float angle = abs(mod(posToAngle(pos)+(spin*time), 1.0)/harmonies);

    float frequencyOffset = 1.0/frequencies;

    float soundKernel = sampleSound(audio, angle).x+
        (sampleSound(audio, angle-frequencyOffset).x*soundSmooth)+
        (sampleSound(audio, angle+frequencyOffset).x*soundSmooth);

    float sound = max(abs(soundKernel/(1.0+(2.0*soundSmooth))), silent);


    // The light ring

    float warp = (mean*sound*soundWarp)+
        (noise(vec3(pos*(1.0+noiseScale*(0.3+peak)), time*noiseSpeed))
            *noiseWarp*(0.3+mean));

    float ringSDF = clamp(abs(dist-radius-warp)-thick, 0.0, 1.0)/sound;


    // Other circle

    vec2 otherPos = vec2(noise(vec3(peakPos, peak+(time*noiseSpeed), mean)),
            noise(vec3(peakPos+0.972, peak+(time*noiseSpeed)+0.234, mean+0.3785)));

    float otherRad = otherRadius*length(otherPos)*peakPos;

    float otherSDF = clamp(abs(toCircle(pos, otherPos, otherRad))-
                abs(otherThick*mean),
            0.0, 1.0)/
        step(otherEdge, abs(peak));


    // Other triangle


    float sdf = min(ringSDF, otherSDF);

    // Light attenuation
    // @see Attenuation: http://gamedev.stackexchange.com/questions/56897/glsl-light-attenuation-color-and-intensity-formula
    // float fade = 1.0/(1.0+(0.1*sdf)+(0.01*sdf*sdf));
    // float fade = pow(clamp(1.0-(sdf/radius), 0.0, 1.0), 2.0);
    // float fade = pow(clamp(1.0-sdf, 0.0, 1.0), 2.0);
    float fade = 1.0/sdf/sdf;
    // float fade = 1.0/sdf;


    // Accumulate color

    vec4 light = vec4(fade*attenuate)*emit;
    vec4 geom = texture2D(form, uv)*ambient;

    // vec4 color = preAlpha(light)+preAlpha(geom);
    vec4 color = light+geom;

    gl_FragColor = color;
}
