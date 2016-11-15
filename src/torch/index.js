import glContext from 'gl-context';
import FBO from 'gl-fbo';
import analyser from 'web-audio-analyser';
import throttle from 'lodash/throttle';
import mapRange from 'range-fit';
import vec2 from 'gl-matrix/src/gl-matrix/vec2';
import shader from 'gl-shader';
import querystring from 'querystring';

import Timer from '../tendrils/timer';

import Screen from '../tendrils/screen';

import screenVert from '../tendrils/screen/index.vert';
// import screenFrag from '../tendrils/screen/index.frag';
import formFrag from './form.frag';
import drawFrag from './draw.frag';
import bokehFrag from '../tendrils/screen/bokeh.frag';

import AudioTrigger from '../tendrils/audio/';
import AudioTexture from '../tendrils/audio/data-texture';
import { peakPos, meanWeight } from '../tendrils/analyse';

import { containAspect } from '../tendrils/utils/aspect';

import each from '../fp/each';
import map from '../fp/map';
import reduce from '../fp/reduce';
import { step } from '../utils';

export default (canvas, settings, debug) => {
    const queries = querystring.parse(location.search.slice(1));

    const gl = glContext(canvas, { preserveDrawingBuffer: true }, render);

    const timer = Object(new Timer(), {
            step: 1000/60
        });

    const viewRes = [0, 0];
    const viewSize = [0, 0];

    const buffers = [FBO(gl, [1, 1]), FBO(gl, [1, 1])];

    const uniforms = {
        head: {},
        form: {},
        draw: {}
    };

    const screen = new Screen(gl);

    // const screenShader = shader(gl, screenVert, screenFrag);
    const formShader = shader(gl, screenVert, formFrag);
    const drawShader = shader(gl, screenVert, drawFrag);
    const bokehShader = shader(gl, screenVert, bokehFrag);


    // Parameters...

    const queryColor = (query) => query.split(',').map((c) =>
                parseFloat(c.replace(/[\[\]]/gi, ''), 10))

    const params = {
        track: (decodeURIComponent(queries.track || '') ||
                prompt('Enter a track URL:')),

        audioMode: (queries.audioMode || 'frequencies'),
        audioOrders: ((queries.audioOrders)? parseInt(queries.audioOrders, 10) : 2),
        harmonies: ((queries.harmonies)? parseFloat(queries.harmonies, 10) : 1),
        falloff: ((queries.falloff)? parseFloat(queries.falloff, 10) : 0.00001),
        attenuate: ((queries.attenuate)? parseFloat(queries.attenuate, 10) : 0.02),
        silent: ((queries.silent)? parseFloat(queries.silent, 10) : 0),
        soundSmooth: ((queries.soundSmooth)? parseFloat(queries.soundSmooth, 10) : 0.3),
        soundWarp: ((queries.soundWarp)? parseFloat(queries.soundWarp, 10) : 0.007),
        noiseWarp: ((queries.noiseWarp)? parseFloat(queries.noiseWarp, 10) : 0.1),
        noiseSpeed: ((queries.noiseSpeed)? parseFloat(queries.noiseSpeed, 10) : 0.001),
        noiseScale: ((queries.noiseScale)? parseFloat(queries.noiseScale, 10) : 0.3),
        meanFulcrum: ((queries.meanFulcrum)? parseFloat(queries.meanFulcrum, 10) : 0.4),
        grow: ((queries.grow)? parseFloat(queries.grow, 10) : 0.0005),
        growLimit: ((queries.growLimit)? parseFloat(queries.growLimit, 10) : 1.6),
        spin: ((queries.spin)? parseFloat(queries.spin, 10) : 0.0001),
        radius: ((queries.radius)? parseFloat(queries.radius, 10) : 0.3),
        thick: ((queries.thick)? parseFloat(queries.thick, 10) : 0.005),
        otherRadius: ((queries.otherRadius)? parseFloat(queries.otherRadius, 10) : 0.2),
        otherThick: ((queries.otherThick)? parseFloat(queries.otherThick, 10) : 0.03),
        otherEdge: ((queries.otherEdge)? parseFloat(queries.otherEdge, 10) : 4),
        jitter: ((queries.jitter)? parseFloat(queries.jitter, 10) : 0.002),
        nowAlpha: ((queries.nowAlpha)? parseFloat(queries.nowAlpha, 10) : 1),
        pastAlpha: ((queries.pastAlpha)? parseFloat(queries.pastAlpha, 10) : 0.99),
        bokehRadius: ((queries.bokehRadius)? parseFloat(queries.bokehRadius, 10) : 8),
        bokehAmount: ((queries.bokehAmount)? parseFloat(queries.bokehAmount, 10) : 60),
        ambient: ((queries.ambient)? queryColor(queries.ambient) : [1, 1, 1, 1]),
        emit: ((queries.emit)? queryColor(queries.emit) : [1, 1, 1, 1])
    };

    Object.assign(self, params);

    self.applyParams = () => map((param, name) => self[name], params, params);

    const paramQuery = () =>
        reduce((out, param, name) => {
                out.push(name+'='+param);

                return out;
            },
            params, []);

    const showState = () => prompt('The URL to this state:',
            location.href.replace(location.search, '')+'?'+
                paramQuery().join('&'));

    console.log(paramQuery().join('\n'));


    const showStateButton = Object.assign(document.createElement('button'), {
            className: 'show-params',
            innerText: 'show state'
        });

    showStateButton.addEventListener('click', showState);

    canvas.parentElement.appendChild(showStateButton);


    // Track

    const audio = Object.assign(new Audio(), {
            crossOrigin: 'anonymous',
            controls: true,
            autoplay: true,
            muted: 'muted' in queries,
            className: 'track',
            src: ((track.match(/^(https)?(:\/\/)?(www\.)?dropbox\.com\/s\//gi))?
                    track.replace(/^((https)?(:\/\/)?(www\.)?)dropbox\.com\/s\/(.*)\?dl=(0)$/gi,
                        'https://dl.dropboxusercontent.com/s/$5?dl=1&raw=1')
                :   track)
        });

    canvas.parentElement.appendChild(audio);
    
    const audioAnalyser = analyser(audio);

    audioAnalyser.analyser.fftSize = 2**11;
    uniforms.frequencies = audioAnalyser.analyser.frequencyBinCount;

    const audioTrigger = new AudioTrigger(audioAnalyser, audioOrders);

    const audioTexture = new AudioTexture(gl, audioTrigger.dataOrder(-1));
    // const audioTexture = new AudioTexture(gl,
    //         audioAnalyser.analyser.frequencyBinCount);


    // The main loop
    function render() {
        const dt = timer.tick().dt;


        // Sample audio

        audioTrigger.sample(dt, audioMode);
        // audioTexture[audioMode](audioTrigger.dataOrder(-1));
        audioTexture.apply();

        let audioPeak = peakPos(audioTexture.array.data);


        // Render

        gl.viewport(0, 0, viewRes[0], viewRes[1]);

        const head = {
            time: timer.time,
            dt: timer.dt,
            viewSize,
            viewRes
        };


        // Buffer pass - develop the form

        buffers[0].bind();
        formShader.bind();

        Object.assign(formShader.uniforms, head, {
                past: buffers[1].color[0].bind(0),
                // @todo Bring audio stuff here as well?
                falloff,
                grow,
                growLimit,
                // @todo Spin form too?
                // spinPast,
                jitter,
                pastAlpha
            });
        
        screen.render();


        // Screen pass - draw the light and form

        buffers[1].bind();
        drawShader.bind();

        Object.assign(drawShader.uniforms, head, {
                form: buffers[0].color[0].bind(0),
                audio: audioTexture.texture.bind(1),
                peak: audioPeak.peak,
                peakPos: audioPeak.pos,
                mean: meanWeight(audioTexture.array.data, meanFulcrum),
                harmonies,
                attenuate,
                silent,
                soundSmooth,
                soundWarp,
                noiseWarp,
                noiseSpeed,
                noiseScale,
                spin,
                radius,
                thick,
                otherRadius,
                otherThick,
                otherEdge,
                bokehRadius,
                bokehAmount,
                ambient,
                emit
            });

        screen.render();


        // Post pass
        // @todo Could be done in draw call

        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        bokehShader.bind();

        Object.assign(bokehShader.uniforms, {
                view: buffers[1].color[0].bind(0),
                resolution: viewRes,
                time: timer.time,
                radius: bokehRadius,
                amount: bokehAmount
            });

        screen.render();
    }

    function resize() {
        canvas.width = self.innerWidth;
        canvas.height = self.innerHeight;

        viewRes[0] = gl.drawingBufferWidth;
        viewRes[1] = gl.drawingBufferHeight;

        containAspect(viewSize, viewRes);

        each((buffer) => buffer.shape = viewRes, buffers);
    }


    // Go

    self.addEventListener('resize', throttle(resize, 200), false);

    resize();
};
