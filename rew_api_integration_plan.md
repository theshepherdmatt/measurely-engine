# REW 5.40 API Integration Technical Spec

This document outlines the exact technical requirements and code necessary to build a "1-click" sweep integration between the Measurely web app and Room EQ Wizard (REW) V5.40's local HTTP API running on port `4735`.

## 1. Network & CORS Probing
Since REW runs on the user's localhost, the browser will attempt to make Cross-Origin Resource Sharing (CORS) requests. `measurely.uk` runs on `HTTPS`, while localhost is `HTTP`. Modern browsers (Chrome/Edge/Safari) deliberately allow "Mixed Content" when the target is `127.0.0.1` or `localhost`, but REW must return the `Access-Control-Allow-Origin: *` header for the browser to accept it.

On dashboard load, Measurely should ping the endpoint to verify it's active:
```javascript
const REW_API = 'http://localhost:4735';

async function pingREW() {
    try {
        const res = await fetch(`${REW_API}/application/blocking`, { method: 'GET' });
        return res.ok;
    } catch (e) {
        return false; // REW is closed, or CORS headers are blocking it
    }
}
```

## 2. Triggering the Measurement
The measurement sequence requires three specific API calls in order:

```javascript
async function runRewSweep() {
    // 1. Force the API to block until the sweep is completed
    await fetch(`${REW_API}/application/blocking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'true'
    });

    // 2. Configure the exact sweep parameters Measurely requires
    await fetch(`${REW_API}/measure/sweep/configuration`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            startFreq: 20,
            endFreq: 20000,
            length: "512k",
            fillSilenceWithDither: true
        })
    });

    // 3. Trigger the sweep (this request will hang until the sweep finishes)
    await fetch(`${REW_API}/measure/command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: 'SPL' })
    });
}
```

## 3. Pulling and Decoding the Impulse Response
Once the measurement finishes, we need to download the raw acoustic data. Instead of exporting a `.wav` file, REW's API provides the raw floating-point samples directly as a Base64 string.

```javascript
async function fetchLatestImpulseResponse() {
    // 1. Find out the ID of the measurement we just took
    const listRes = await fetch(`${REW_API}/measurements`);
    const list = await listRes.json();
    const latestId = list[list.length - 1].id;

    // 2. Download the raw impulse response (Base64 string)
    const irRes = await fetch(`${REW_API}/measurements/${latestId}/impulse-response?unit=dBFS&normalised=true`);
    const irData = await irRes.json();
    
    // 3. Decode Base64 to ArrayBuffer
    const binaryStr = atob(irData.data);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    
    // 4. CRITICAL: REW serves the floats in Big-Endian, but Web Browsers use Little-Endian.
    // We must invert the byte order for every 4-byte chunk before creating the Float32Array.
    const view = new DataView(bytes.buffer);
    const floatArray = new Float32Array(bytes.length / 4);
    for (let i = 0; i < floatArray.length; i++) {
        floatArray[i] = view.getFloat32(i * 4, false); // false = read as Big-Endian
    }
    
    return {
        ir: floatArray,
        fs: irData.sampleRate || 48000
    };
}
```

## 4. Integration with Measurely
Once the `floatArray` is extracted, Measurely can completely skip the [fileLoader.js](file:///c:/Users/Matt/Dropbox/Measurely/measurely-web/js/engine/fileLoader.js) WAV ingestion code ([loadIr](file:///c:/Users/Matt/Dropbox/Measurely/measurely-web/js/engine/fileLoader.js#39-82)). 

Instead, inside [dashboard.js](file:///c:/Users/Matt/Dropbox/Measurely/measurely-web/js/dashboard.js), we can directly assemble the `session` object:
```javascript
const { ir, fs } = await fetchLatestImpulseResponse();

// Generate the magnitude/frequency response using our existing FFT engine
const { freq, mag } = window.MeasurelyFileLoader.irToFreqMag(ir, fs);

const sessionData = {
    id: 'upload_rew_' + Date.now(),
    ir,
    fs,
    freq,
    mag,
    calibrationCurve: null,
    label: "REW Auto-sync",
    timestamp: new Date().toISOString()
};

// 1. Save to cloud/local storage
window.MeasurelySessions.saveSession(sessionData);

// 2. Push directly into the active dashboard UI
window.dashboard.loadLatestAnalysis(sessionData);
```

### Next Steps When Ready to Build:
- Update [app.html](file:///c:/Users/Matt/Dropbox/Measurely/measurely-web/app.html) to inject a `btn-secondary` next to "Upload Measurement".
- Bind `pingREW()` to toggle the button's visibility.
- Drop the code blocks above into a new `js/rew-api.js` script.
