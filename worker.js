/**
 * worker.js ΓÇö Measurely Engine ┬╖ Cloudflare Worker entry point
 *
 * Exposes the acoustic analysis pipeline as a JSON HTTP API.
 *
 * Endpoints
 *   GET  /           ΓåÆ service info
 *   GET  /health     ΓåÆ liveness check
 *   POST /analyse    ΓåÆ run acoustic analysis
 *
 * POST /analyse body (JSON)
 *   {
 *     ir:   number[]   ΓÇö impulse response samples (Float32Array serialised)
 *     fs:   number     ΓÇö sample rate in Hz (e.g. 44100 or 48000)
 *     freq: number[]   ΓÇö frequency bins from REW CSV
 *     mag:  number[]   ΓÇö magnitude values (dB) matching freq[]
 *     room: object     ΓÇö room configuration (same schema as room.json)
 *   }
 *
 * Note: fileLoader.js uses the Web Audio API (AudioContext) and is
 * browser-only ΓÇö WAV decoding must happen client-side. Send the decoded
 * Float32Array values in the ir field.
 */

// Wrangler's esbuild bundler handles CommonJS ΓåÆ ESM transformation
// for all engine modules imported here.
import { analyse, assessValidity } from './js/engine/analyse.js';

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function respond(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS },
    });
}

export default {
    async fetch(request, env, ctx) {
        const { method } = request;
        const { pathname } = new URL(request.url);

        // CORS preflight
        if (method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: CORS });
        }

        // GET / ΓÇö service info
        if (method === 'GET' && (pathname === '/' || pathname === '')) {
            return respond({
                service: 'measurely-engine',
                version: '1.0.0',
                endpoints: {
                    'GET /health':   'Liveness check',
                    'POST /analyse': 'Acoustic analysis ΓÇö body: { ir, fs, freq, mag, room }',
                },
            });
        }

        // GET /health
        if (method === 'GET' && pathname === '/health') {
            return respond({ ok: true, service: 'measurely-engine' });
        }

        // POST /analyse
        if (method === 'POST' && pathname === '/analyse') {
            let body;
            try {
                body = await request.json();
            } catch {
                return respond({ error: 'Request body must be valid JSON' }, 400);
            }

            const { ir, fs, freq, mag, room } = body ?? {};

            if (!Array.isArray(ir) || typeof fs !== 'number' ||
                !Array.isArray(freq) || !Array.isArray(mag) || !room) {
                return respond({
                    error: 'Missing or invalid fields',
                    required: { ir: 'number[]', fs: 'number', freq: 'number[]', mag: 'number[]', room: 'object' },
                }, 400);
            }

            try {
                const irF32   = new Float32Array(ir);
                const freqF32 = new Float32Array(freq);
                const magF32  = new Float32Array(mag);

                const validity = assessValidity(irF32, fs);
                if (!validity.valid) {
                    return respond({ error: `Invalid impulse response: ${validity.reason}` }, 422);
                }

                const result = analyse(irF32, fs, freqF32, magF32, room);
                return respond({ ok: true, result });
            } catch (err) {
                return respond({ error: err.message }, 500);
            }
        }

        return respond({ error: 'Not found' }, 404);
    },
};
