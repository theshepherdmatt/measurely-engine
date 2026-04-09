// Measurely Engine — entry point
// Acoustic analysis pipeline + 3D room visualization
//
// Browser: load individual files via <script> tags; each exposes a window.MeasurelyXXX global
// Node.js: require('@measurely/engine') for the full analysis pipeline
//
// Load order for browser (script tags):
//   1. js/vendor/three/three.min.js
//   2. js/engine/fft.js
//   3. js/engine/signal_math.js
//   4. js/engine/acoustics.js
//   5. js/engine/fileLoader.js
//   6. js/engine/score.js
//   7. js/engine/analyse.js
//   8. js/engine/signalIntegrityCard.js (optional UI card)
//   9. js/vendor/three/OrbitControls.js
//  10. js/vendor/three/DragControls.js
//  11. js/room3d.js

'use strict';

module.exports = {
    ...require('./js/engine/fft.js'),
    ...require('./js/engine/signal_math.js'),
    ...require('./js/engine/acoustics.js'),
    ...require('./js/engine/fileLoader.js'),
    ...require('./js/engine/score.js'),
    analyse: require('./js/engine/analyse.js').analyse,
    assessValidity: require('./js/engine/analyse.js').assessValidity,
    renderSignalIntegrityCard: require('./js/engine/signalIntegrityCard.js').renderSignalIntegrityCard,
};
