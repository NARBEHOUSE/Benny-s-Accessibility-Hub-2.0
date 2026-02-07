import * as THREE from 'three';
import * as CANNON from 'cannon-es';

// --- App State ---
window.appState = {
    state: 'MENU', // MENU, SETUP, GAME, RULES, PAUSE, SETTINGS
    previousState: 'MENU', // For returning from settings
    gameMode: 'Free Throw',
    players: 1,
    scanIndex: 0,
    diceConfig: { d4: 0, d6: 0, d8: 0, d10: 0, d12: 0, d20: 0 },
    addDie: null, // Will be assigned
    initiativePhase: false // True during initiative roll - locks controls
};

// --- Input State for Backward Scan ---
const inputState = {
    spaceHeld: false,
    spaceTime: 0,
    timers: { space: null, spaceRepeat: null },
    config: { longPress: 3000, repeatInterval: 2000 }
};
// Expose for debugging
window.inputState = inputState;

// Game settings (persisted) - only for local settings, shared settings use managers
const gameSettings = {
    sound: true  // Only local setting - TTS/voice/scan use shared managers
};

// Load/save settings
function loadGameSettings() {
    try {
        const saved = localStorage.getItem('bennysdice_settings');
        if (saved) Object.assign(gameSettings, JSON.parse(saved));
    } catch(e) { console.warn('Failed to load settings', e); }
}
function saveSettings() {
    localStorage.setItem('bennysdice_settings', JSON.stringify(gameSettings));
}
function saveGameSettings() {
    saveSettings();
}

function updateSettingsDisplay() {
    // Update TTS display (from VoiceManager)
    const ttsValue = document.getElementById('setting-tts-value');
    if (ttsValue) {
        const ttsEnabled = window.NarbeVoiceManager ? window.NarbeVoiceManager.getSettings().ttsEnabled : true;
        ttsValue.textContent = ttsEnabled ? 'On' : 'Off';
    }

    // Update Sound display (local setting)
    const soundValue = document.getElementById('setting-sound-value');
    if (soundValue) soundValue.textContent = gameSettings.sound ? 'On' : 'Off';

    // Update Auto Scan display (from ScanManager)
    const autoScanValue = document.getElementById('setting-autoscan-value');
    if (autoScanValue) {
        const autoScan = window.NarbeScanManager ? window.NarbeScanManager.getSettings().autoScan : false;
        autoScanValue.textContent = autoScan ? 'On' : 'Off';
    }

    // Update Scan Speed display (from ScanManager)
    const speedValue = document.getElementById('setting-speed-value');
    if (speedValue) {
        const scanInterval = window.NarbeScanManager ? window.NarbeScanManager.getScanInterval() : 2000;
        speedValue.textContent = (scanInterval / 1000) + 's';
    }

    // Update Voice display (from VoiceManager)
    const voiceValue = document.getElementById('setting-voice-value');
    if (voiceValue) {
        if (window.NarbeVoiceManager) {
            const voice = window.NarbeVoiceManager.getCurrentVoice();
            voiceValue.textContent = voice ? window.NarbeVoiceManager.getVoiceDisplayName(voice) : 'Default';
        } else {
            voiceValue.textContent = 'Default';
        }
    }
}

loadGameSettings();

// Forward declarations for dice glow system (defined later after Three.js setup)
let focusedDieIndex = -1;
let updateDiceGlows = function() {}; // Will be overwritten
const originalDieColors = new Map();

const MODES = ['Free Throw', 'Yarkle', 'Fahtzee'];
let modeIndex = 0;

// --- Sound Effects System ---
const SoundFX = {
    audioContext: null,
    sounds: {},
    buffers: {},

    init() {
        try {
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.loadSound('roll', 'sounds/dice-roll.WAV');
        } catch(e) {
            console.log('Web Audio API not supported');
        }
    },

    async loadSound(name, url) {
        if (!this.audioContext) return;
        try {
            const response = await fetch(url);
            const arrayBuffer = await response.arrayBuffer();
            const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
            this.buffers[name] = audioBuffer;
        } catch (e) {
            console.log(`Failed to load sound ${name}:`, e);
        }
    },

    // Generate sounds programmatically
    play(type) {
        if (!this.audioContext) return;

        // Check if sound is disabled
        if (!gameSettings.sound) return;

        // Resume context if suspended (iOS requirement)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        const ctx = this.audioContext;
        const now = ctx.currentTime;

        // Prefer simple buffer playback for loaded sounds
        if (this.buffers[type]) {
            const source = ctx.createBufferSource();
            source.buffer = this.buffers[type];
            source.connect(ctx.destination);
            source.start(now);
            // Don't return, allow fall-through if we want layered sounds? 
            // No, usually we want to replace.
            return;
        }

        switch(type) {
            /* case 'roll': REMOVED FALLBACK to rely only on loaded WAV
                break; */

            case 'select':
                // Click sound
                const osc1 = ctx.createOscillator();
                const gain1 = ctx.createGain();
                osc1.connect(gain1);
                gain1.connect(ctx.destination);
                osc1.frequency.value = 800;
                osc1.type = 'sine';
                gain1.gain.setValueAtTime(0.2, now);
                gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
                osc1.start(now);
                osc1.stop(now + 0.1);
                break;

            case 'score':
                // Positive ding
                [523, 659, 784].forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = freq;
                    osc.type = 'sine';
                    gain.gain.setValueAtTime(0.15, now + i * 0.1);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.3);
                    osc.start(now + i * 0.1);
                    osc.stop(now + i * 0.1 + 0.3);
                });
                break;

            case 'bust':
                // Sad trombone / failure sound
                const osc2 = ctx.createOscillator();
                const gain2 = ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(ctx.destination);
                osc2.frequency.setValueAtTime(400, now);
                osc2.frequency.exponentialRampToValueAtTime(100, now + 0.5);
                osc2.type = 'sawtooth';
                gain2.gain.setValueAtTime(0.15, now);
                gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
                osc2.start(now);
                osc2.stop(now + 0.5);
                break;

            case 'fahtzee':
                // Victory fanfare!
                const notes = [523, 659, 784, 1047, 784, 1047];
                notes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = freq;
                    osc.type = 'square';
                    gain.gain.setValueAtTime(0.12, now + i * 0.12);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.15);
                    osc.start(now + i * 0.12);
                    osc.stop(now + i * 0.12 + 0.15);
                });
                break;

            case 'bank':
                // Cash register / coin sound
                const osc3 = ctx.createOscillator();
                const gain3 = ctx.createGain();
                osc3.connect(gain3);
                gain3.connect(ctx.destination);
                osc3.frequency.value = 1200;
                osc3.type = 'sine';
                gain3.gain.setValueAtTime(0.2, now);
                gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc3.start(now);
                osc3.stop(now + 0.15);
                // Second ding
                const osc4 = ctx.createOscillator();
                const gain4 = ctx.createGain();
                osc4.connect(gain4);
                gain4.connect(ctx.destination);
                osc4.frequency.value = 1600;
                osc4.type = 'sine';
                gain4.gain.setValueAtTime(0.2, now + 0.1);
                gain4.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
                osc4.start(now + 0.1);
                osc4.stop(now + 0.25);
                break;

            case 'hover':
                // Soft blip for scanning
                const osc5 = ctx.createOscillator();
                const gain5 = ctx.createGain();
                osc5.connect(gain5);
                gain5.connect(ctx.destination);
                osc5.frequency.value = 600;
                osc5.type = 'sine';
                gain5.gain.setValueAtTime(0.08, now);
                gain5.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
                osc5.start(now);
                osc5.stop(now + 0.05);
                break;

            case 'win':
                // Victory music
                const winNotes = [523, 659, 784, 1047, 784, 659, 784, 1047, 1319];
                winNotes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = freq;
                    osc.type = 'triangle';
                    gain.gain.setValueAtTime(0.12, now + i * 0.15);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 0.2);
                    osc.start(now + i * 0.15);
                    osc.stop(now + i * 0.15 + 0.2);
                });
                break;

            case 'lose':
                // Losing sound
                [400, 350, 300, 250].forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = freq;
                    osc.type = 'sawtooth';
                    gain.gain.setValueAtTime(0.1, now + i * 0.2);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.2 + 0.25);
                    osc.start(now + i * 0.2);
                    osc.stop(now + i * 0.2 + 0.25);
                });
                break;
        }
    }
};

// Initialize sound on first user interaction
document.addEventListener('click', () => SoundFX.init(), { once: true });
document.addEventListener('keydown', () => SoundFX.init(), { once: true });

// --- TTS System (integrated with NarbeVoiceManager) ---
function speak(text, interrupt = true) {
    // Use NarbeVoiceManager if available - it handles ttsEnabled internally
    if (window.NarbeVoiceManager) {
        window.NarbeVoiceManager.speak(text, interrupt);
        return;
    }

    // Fallback to basic speech synthesis
    if ('speechSynthesis' in window && text) {
        // Strip emojis from text
        const cleanText = text.replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '');

        if (interrupt) {
            speechSynthesis.cancel();
        }
        const utterance = new SpeechSynthesisUtterance(cleanText);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        speechSynthesis.speak(utterance);
    }
}

// Announce focused element
function announceElement(el) {
    if (!el) return;
    let text = el.getAttribute('aria-label') || el.textContent || el.innerText || '';
    // Clean up the text
    text = text.replace(/\s+/g, ' ').trim();
    if (text) {
        speak(text);
        if (gameSettings.sound) SoundFX.play('hover');
    }
}

// --- Settings UI Update ---
function updateSettingsUI() {
    // TTS status
    const ttsEl = document.getElementById('tts-status');
    if (ttsEl) ttsEl.textContent = gameSettings.tts ? 'On' : 'Off';

    // Voice display
    const voiceEl = document.getElementById('voice-display');
    if (voiceEl && window.NarbeVoiceManager) {
        const voices = window.NarbeVoiceManager.getVoices();
        const settings = window.NarbeVoiceManager.getSettings();
        if (voices && voices.length > 0) {
            const voice = voices[settings.voiceIndex];
            voiceEl.textContent = voice ? voice.name.split(' ')[0] : 'Default';
        } else {
            voiceEl.textContent = 'Default';
        }
    }

    // Auto Scan status
    const autoScanEl = document.getElementById('autoscan-status');
    if (autoScanEl && window.NarbeScanManager) {
        autoScanEl.textContent = window.NarbeScanManager.getSettings().autoScan ? 'On' : 'Off';
    }

    // Scan Speed display
    const speedEl = document.getElementById('scanspeed-display');
    if (speedEl && window.NarbeScanManager) {
        speedEl.textContent = (window.NarbeScanManager.getScanInterval() / 1000) + 's';
    }

    // Sound status
    const soundEl = document.getElementById('sound-status');
    if (soundEl) soundEl.textContent = gameSettings.sound ? 'On' : 'Off';
}

// --- Auto Scan Integration ---
let autoScanTimer = null;

function startAutoScan() {
    stopAutoScan();
    if (!window.NarbeScanManager) return;
    const scanSettings = window.NarbeScanManager.getSettings();
    if (!scanSettings.autoScan) return;

    autoScanTimer = setInterval(() => {
        // Pause auto scanning while user holds input
        if (inputState.spaceHeld) return;

        moveScan(1);
    }, scanSettings.scanInterval);
}

function stopAutoScan() {
    if (autoScanTimer) {
        clearInterval(autoScanTimer);
        autoScanTimer = null;
    }
}

// Subscribe to scan manager changes
if (window.NarbeScanManager) {
    window.NarbeScanManager.subscribe(() => {
        if (window.NarbeScanManager.getSettings().autoScan) {
            startAutoScan();
        } else {
            stopAutoScan();
        }
        updateSettingsUI();
    });
    // Initial check
    if (window.NarbeScanManager.getSettings().autoScan) {
        startAutoScan();
    }
}

// --- Setup Scene ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x222222);

// Aspect ratio handling for the game area div
const gameArea = document.getElementById('game-area');
const camera = new THREE.PerspectiveCamera(35, gameArea.clientWidth / gameArea.clientHeight, 0.1, 100);
camera.position.set(0, 45, 1);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(gameArea.clientWidth, gameArea.clientHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
gameArea.appendChild(renderer.domElement);


// --- Lights ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(20, 40, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.left = -25;
dirLight.shadow.camera.right = 25;
dirLight.shadow.camera.top = 25;
dirLight.shadow.camera.bottom = -25;
scene.add(dirLight);

// --- Physics World ---
const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.82 * 4, 0),
    allowSleep: true
});
world.defaultContactMaterial.contactEquationStiffness = 1e8; // Very stiff
world.defaultContactMaterial.contactEquationRelaxation = 3;
world.solver.iterations = 50; // High precision
world.solver.tolerance = 0.0001; 
world.solver.splitImpulse = true; // Prevents overlapping

// Materials
const groundMaterial = new CANNON.Material();
const diceMaterial = new CANNON.Material();

const groundDiceContact = new CANNON.ContactMaterial(groundMaterial, diceMaterial, {
    friction: 0.3,
    restitution: 0.3
});
world.addContactMaterial(groundDiceContact);

const diceDiceContact = new CANNON.ContactMaterial(diceMaterial, diceMaterial, {
    friction: 0.0, // Low friction between dice to prevent sticking/climbing
    restitution: 0.2
});
world.addContactMaterial(diceDiceContact);

// --- Floor ---
const floorGeo = new THREE.PlaneGeometry(100, 100);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x224422, roughness: 0.9 });
const floorMesh = new THREE.Mesh(floorGeo, floorMat);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const floorBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Plane(),
    material: groundMaterial
});
floorBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
world.addBody(floorBody);

// --- Walls ---
// Constrain dice to stay within the visible area above the control bar
// Camera is at (0, 45, 1) looking at (0, 0, 0)
// The visible floor area depends on camera FOV and height
// With camera at y=45 and FOV=35, the visible area is roughly:
// - Left/Right: about ±12 units at z=0
// - Back (negative Z): about -8 units  
// - Front (positive Z toward camera): about +4 units (closer to camera = control bar area)

const wallDistX = 12;    // Left/right walls
const wallDistZBack = 8; // Back wall (far from camera)
const wallDistZFront = 3; // Front wall (close to camera - prevents dice going under control bar)

function createWall(x, z, w, h, rotationY) {
    const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(w/2, 10, h/2)),
        material: groundMaterial
    });
    body.position.set(x, 5, z);
    if(rotationY) body.quaternion.setFromEuler(0, rotationY, 0);
    world.addBody(body);
}

// Back wall (far from camera, top of screen)
createWall(0, -wallDistZBack, 30, 1, 0); 
// Front wall (close to camera, bottom of screen - above control bar)
createWall(0, wallDistZFront, 30, 1, 0); 
// Left wall
createWall(-wallDistX, 0, 1, 20, 0); 
// Right wall
createWall(wallDistX, 0, 1, 20, 0); 


// --- Texture Generation ---
function createTexture(type, text, backgroundColor) {
    const cvs = document.createElement('canvas');
    cvs.width = 128;
    cvs.height = 128;
    const context = cvs.getContext('2d');

    context.fillStyle = backgroundColor || '#eeeeee';
    context.fillRect(0,0,128,128);

    context.strokeStyle = 'rgba(0,0,0,0.2)';
    context.lineWidth = 4;
    context.strokeRect(0,0,128,128);

    context.fillStyle = 'black';
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    if (type === 'dot') {
        const num = parseInt(text);
        const r = 12;
        const c = 64;
        const q1 = 32;
        const q3 = 96;
        const drawDot = (x, y) => {
            context.beginPath(); context.arc(x,y,r,0,Math.PI*2); context.fill();
        };
        if(num===1) drawDot(c,c);
        if(num===2) { drawDot(q1,q1); drawDot(q3,q3); }
        if(num===3) { drawDot(q1,q1); drawDot(c,c); drawDot(q3,q3); }
        if(num===4) { drawDot(q1,q1); drawDot(q3,q1); drawDot(q1,q3); drawDot(q3,q3); }
        if(num===5) { drawDot(q1,q1); drawDot(q3,q1); drawDot(c,c); drawDot(q1,q3); drawDot(q3,q3); }
        if(num===6) { drawDot(q1,q1); drawDot(q3,q1); drawDot(q1,c); drawDot(q3,c); drawDot(q1,q3); drawDot(q3,q3); }
    } else if (type === 'd4_face') {
        // Text is an object {top, left, right}
        context.font = 'bold 30px Arial';
        context.fillStyle = 'black';
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        // Helper to draw rotated text
        // UV Mapping: Top=(64, ~12), Left=(~12, ~115), Right=(~115, ~115)
        const drawNum = (num, x, y, rotation) => {
            context.save();
            context.translate(x, y);
            context.rotate(rotation);
            context.fillText(num, 0, 0);
            context.restore();
        };

        // Top Corner Number (Upright)
        drawNum(text.top, 64, 35, 0);

        // Left Corner Number (Rotated to be legible when this corner is top)
        // 120 degrees = 2.094 rad
        drawNum(text.left, 35, 95, 2.094); 

        // Right Corner Number
        drawNum(text.right, 93, 95, -2.094);

    } else {
        context.font = 'bold 36px Arial'; 
        let yPos = 80; // Default for triangular faces (D8, D10, D20)

        if (type === 'number_centered') {
            yPos = 64; // Center for D12 (pentagonal)
        }

        if (text == '6' || text == '9') {
             context.font = 'bold 30px Arial';
             context.fillText(text + '.', 64, yPos);
        } else {
             context.fillText(text, 64, yPos);
        }
    }
    return new THREE.CanvasTexture(cvs);
}

function alignUVs(geometry) {
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    // Map triangle vertices to roughly the center triangle of the texture
    for (let i = 0; i < pos.count; i += 3) {
         uv.setXY(i, 0.5, 0.9);   
         uv.setXY(i+1, 0.1, 0.1); 
         uv.setXY(i+2, 0.9, 0.1); 
    }
    geometry.attributes.uv.needsUpdate = true;
}

function alignFaceUVs(geometry, verticesPerFace) {
    const pos = geometry.attributes.position;
    const uv = geometry.attributes.uv;
    const tempVec = new THREE.Vector3();
    const centroid = new THREE.Vector3();
    const normal = new THREE.Vector3();
    const up = new THREE.Vector3();
    const right = new THREE.Vector3();
    const diff = new THREE.Vector3();

    for (let i = 0; i < pos.count; i += verticesPerFace) {
        // 1. Calculate Centroid
        centroid.set(0,0,0);
        for(let j=0; j<verticesPerFace; j++) {
            tempVec.fromBufferAttribute(pos, i+j);
            centroid.add(tempVec);
        }
        centroid.divideScalar(verticesPerFace);

        // 2. Calculate Normal (using first triangle)
        const v0 = new THREE.Vector3().fromBufferAttribute(pos, i);
        const v1 = new THREE.Vector3().fromBufferAttribute(pos, i+1);
        const v2 = new THREE.Vector3().fromBufferAttribute(pos, i+2);
        normal.subVectors(v1, v0).cross(new THREE.Vector3().subVectors(v2, v0)).normalize();

        // 3. Define Tangent Space
        // Up = vector from centroid to first vertex (approx)
        up.subVectors(v0, centroid).normalize();
        right.crossVectors(normal, up).normalize();
        // Re-orthogonalize up
        up.crossVectors(right, normal).normalize();

        // 4. Project vertices to UV
        const scale = 0.8; // Scaling factor to fit in texture
        for(let j=0; j<verticesPerFace; j++) {
             tempVec.fromBufferAttribute(pos, i+j);
             diff.subVectors(tempVec, centroid);

             const u = 0.5 - (diff.dot(right) * scale);
             const v = diff.dot(up) * scale + 0.5;

             uv.setXY(i+j, u, v);
        }
    }
    geometry.attributes.uv.needsUpdate = true;
}

function createShapeFromGeometry(geo) {
    // Robust parsing by converting to non-indexed first
    if (geo.index) {
        geo = geo.toNonIndexed();
    }

    const pos = geo.attributes.position;
    const vertices = [];
    const keyToId = {};

    function getId(x, y, z) {
        // Merge vertices that are close enough (precision fix)
        const key = Math.round(x*100)+'_'+Math.round(y*100)+'_'+Math.round(z*100);
        if(keyToId[key] === undefined) {
            vertices.push(new CANNON.Vec3(x, y, z));
            keyToId[key] = vertices.length - 1;
        }
        return keyToId[key];
    }

    const faces = [];
    for(let i=0; i<pos.count; i+=3) {
        faces.push([
            getId(pos.getX(i), pos.getY(i), pos.getZ(i)),
            getId(pos.getX(i+1), pos.getY(i+1), pos.getZ(i+1)),
            getId(pos.getX(i+2), pos.getY(i+2), pos.getZ(i+2))
        ]);
    }

    // Create valid ConvexPolyhedron
    const shape = new CANNON.ConvexPolyhedron({ vertices: vertices, faces: faces });
    return shape;
}

function createDieMesh(type) {
    let geometry, shape, matArray = [];
    let color = '#fff';

    // Standard Dice Number Layouts (Approximate for standard manufacturing patterns)
    const valueMaps = {
        d8:  [1, 5, 2, 3, 4, 8, 6, 7],
        d10: [0, 8, 6, 4, 2, 1, 3, 5, 7, 9], 
        d12: [12, 5, 9, 6, 2, 10, 11, 3, 4, 8, 1, 7],
        d20: [20, 8, 14, 2, 10, 12, 16, 4, 18, 6, 15, 13, 9, 5, 17, 19, 11, 3, 7, 1]
    };

    if (type === 'd6') {
        color = '#eeeeee';
        geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        shape = new CANNON.Box(new CANNON.Vec3(0.6, 0.6, 0.6));
        const order = [1, 6, 2, 5, 3, 4];
        matArray = order.map(n => new THREE.MeshStandardMaterial({ 
            map: createTexture('dot', n, color), roughness: 0.2
        }));
    }
    else if (type === 'd4') {
        color = '#ffaaaa';
        const baseGeo = new THREE.TetrahedronGeometry(1.2);
        geometry = baseGeo.toNonIndexed();
        shape = createShapeFromGeometry(geometry);

        alignUVs(geometry);

        // Identify vertices to assign values 1, 2, 3, 4
        // A tetrahedron has 4 vertices. We map each spatial vertex to a number.
        const pos = geometry.attributes.position;
        const vertexValues = {}; 
        const vertexIds = [];
        let nextVal = 1;

        // Pass 1: Assign values to unique vertices
        const simVertices = [];
        for(let i=0; i<pos.count; i++) {
            const x = Math.round(pos.getX(i)*100);
            const y = Math.round(pos.getY(i)*100);
            const z = Math.round(pos.getZ(i)*100);
            const key = `${x},${y},${z}`;
            if(!vertexValues[key]) {
                const val = nextVal++;
                vertexValues[key] = val;
                simVertices.push({ x: x/100, y: y/100, z: z/100, value: val });
            }
            vertexIds[i] = vertexValues[key];
        }
        geometry.userData = { simVertices };

        // Pass 2: Create materials for each face
        // Each face has 3 vertices (Top, Left, Right in UV mapping)
        // We draw the number associated with that vertex at that position.
        for(let i=0; i<pos.count; i+=3) {
            geometry.addGroup(i, 3, i/3);
            const vTop = vertexIds[i];
            const vLeft = vertexIds[i+1];
            const vRight = vertexIds[i+2];

            matArray.push(new THREE.MeshStandardMaterial({ 
                map: createTexture('d4_face', { top: vTop, left: vLeft, right: vRight }, color) 
            }));
        }
    }
    else if (type === 'd8') {
        color = '#aaaaff';
        const baseGeo = new THREE.OctahedronGeometry(1);
        geometry = baseGeo.toNonIndexed();
        shape = createShapeFromGeometry(geometry);

        alignUVs(geometry);
        const nums = valueMaps.d8; // Use standard map
        const pos = geometry.attributes.position;
        for(let i=0; i<pos.count/3; i++){
            geometry.addGroup(i*3, 3, i);
            matArray.push(new THREE.MeshStandardMaterial({ map: createTexture('number', nums[i%8], color) }));
        }
    }
    else if (type === 'd10') {
        color = '#ffccff';
        const vertices = [];
        vertices.push(0, 1.2, 0); vertices.push(0, -1.2, 0); // Poles
        for(let i=0; i<5; i++){ const a = (i/5)*Math.PI*2; vertices.push(Math.sin(a), 0, Math.cos(a)); } // Equator
        const indices = [];
        for(let i=0; i<5; i++){
            const next = (i+1)%5;
            indices.push(0, 2+i, 2+next); 
            indices.push(1, 2+next, 2+i);
        }
        const baseGeo = new THREE.PolyhedronGeometry(vertices, indices, 1, 0);
        geometry = baseGeo.toNonIndexed();
        shape = createShapeFromGeometry(geometry);

        alignUVs(geometry);
        const pos = geometry.attributes.position;
        for(let i=0; i<10; i++){
            geometry.addGroup(i*3, 3, i);
            matArray.push(new THREE.MeshStandardMaterial({ map: createTexture('number', valueMaps.d10[i].toString(), color) }));
        }
    }
    else if (type === 'd12') {
        color = '#ffcc88';
        const baseGeo = new THREE.DodecahedronGeometry(0.9);
        geometry = baseGeo.toNonIndexed();
        shape = createShapeFromGeometry(geometry);

        // D12 has pentagonal faces. Three.js splits each into 3 triangles (9 vertices).
        // We use a planar projection to map the whole pentagon to the texture once.
        alignFaceUVs(geometry, 9); 

        for(let i=0; i<12; i++) {
             geometry.addGroup(i * 9, 9, i);
             matArray.push(new THREE.MeshStandardMaterial({ map: createTexture('number_centered', valueMaps.d12[i].toString(), color) }));
        }
    }
    else if (type === 'd20') {
        color = '#ffff88';
        const baseGeo = new THREE.IcosahedronGeometry(0.9);
        geometry = baseGeo.toNonIndexed();
        shape = createShapeFromGeometry(geometry);

        alignUVs(geometry);
        const pos = geometry.attributes.position;
        for(let i=0; i<20; i++) {
            geometry.addGroup(i * 3, 3, i);
            matArray.push(new THREE.MeshStandardMaterial({ map: createTexture('number', valueMaps.d20[i].toString(), color) }));
        }
    }

    const mesh = new THREE.Mesh(geometry, matArray);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Allow raycasting
    mesh.userData = { type: 'die', body: shape, diceType: type };
    if (geometry.userData && geometry.userData.simVertices) {
        mesh.userData.simVertices = geometry.userData.simVertices;
    }

    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial( { color: 0x000000, transparent: true, opacity: 0.3 } ) );
    mesh.add(line);

    const body = new CANNON.Body({
        mass: 5, 
        shape: shape,
        material: diceMaterial,
        linearDamping: 0.5, 
        angularDamping: 0.5,
        sleepSpeedLimit: 0.5, 
        sleepTimeLimit: 0.5
    });
    // Ensure bounds are updated
    shape.updateBoundingSphereRadius();

    return { mesh, body };
}

// --- Logic Refactored ---
const diceObjects = [];

// Expose addDie to global for UI
appState.addDie = (type) => {
    appState.diceConfig[type]++;
    updateUI();
    SoundFX.play('select');

    // Immediately spawn the die if in Free Throw mode
    if (appState.gameMode === 'Free Throw') {
        spawnSingleDie(type);
        updateCameraPosition();
    }

    speak(`Added ${type}`);
};

// Spawn a single die into the scene (for adding dice)
function spawnSingleDie(type) {
    const obj = createDieMesh(type);
    scene.add(obj.mesh);
    world.addBody(obj.body);
    diceObjects.push(obj);

    // Position it high up and random spread
    const spread = 2;
    obj.body.position.set(
        (Math.random()-0.5)*spread, 
        15 + diceObjects.length * 2, // Drop from height based on count
        (Math.random()-0.5)*spread
    );

    // Give it a little spin
    const spin = 5;
    obj.body.angularVelocity.set(Math.random()*spin, Math.random()*spin, Math.random()*spin);
    obj.body.quaternion.setFromEuler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
}

function updateCameraPosition() {
     // 1 die = 15 height, 10 dice = 35 height (roughly)
     // Count total dice
     const count = diceObjects.length || 1;
     const targetHeight = 12 + (count * 2.5);
     const clampedHeight = Math.min(Math.max(targetHeight, 15), 60);

     // Smooth lerp would be nice but direct set is fine for now
     camera.position.set(0, clampedHeight, 1);
     camera.lookAt(0, 0, 0);
}

// Expose functions for inline HTML handlers
window.setAppState = setAppState;
window.throwDice = throwDice;
window.clearDice = () => {
     for(let key in appState.diceConfig) appState.diceConfig[key] = 0;
     updateUI();
     clearSceneDice();
     SoundFX.play('select');
     speak('Cleared all dice');
};

function updateUI() {
    // Update counts in menu
    for(let key in appState.diceConfig) {
        const el = document.getElementById('count-' + key);
        if(el) {
            el.textContent = appState.diceConfig[key];
            // Fix TTS reading "D200" instead of "D20 count 0"
            if(el.parentElement && el.parentElement.tagName === 'BUTTON') {
                 // Insert space between type and count for better reading, e.g. "D4 0"
                 // Or use full description
                 const label = key.toUpperCase().replace('D', 'D ') + ', ' + appState.diceConfig[key];
                 el.parentElement.setAttribute('aria-label', label);
            }
        }
    }

    // Update Mode Display
    const modeDisplay = document.getElementById('mode-display');
    if(modeDisplay) modeDisplay.textContent = appState.gameMode;

    const playerCount = document.getElementById('player-count');
    if(playerCount) playerCount.textContent = appState.players;
}

function clearSceneDice() {
    diceObjects.forEach(obj => {
        scene.remove(obj.mesh);
        world.removeBody(obj.body);
    });
    diceObjects.length = 0;
    const halo = document.getElementById('scan-halo');
    if(halo) halo.style.display = 'none';
}

function throwDice() {
    clearSceneDice();

    const types = [];
    for(let key in appState.diceConfig) {
        for(let i=0; i<appState.diceConfig[key]; i++) types.push(key);
    }
    if(types.length === 0) { types.push('d6'); appState.diceConfig['d6'] = 1; updateUI(); }

    updateCameraPosition();

    // Adjust camera height based on count handled by updateCameraPosition() actually
    // But we need to make sure types.length matches what updateCameraPosition reads (diceObjects)
    // But here diceObjects is empty!
    // So we can manually set it or just let it update as we add.

    // Better: use types.length to preemptively set camera
    const targetHeight = 12 + (types.length * 2.5);
    camera.position.set(0, Math.min(Math.max(targetHeight, 15), 60), 1);
    camera.lookAt(0, 0, 0);

    types.forEach((type, index) => {
        const obj = createDieMesh(type);
        scene.add(obj.mesh);
        world.addBody(obj.body);
        diceObjects.push(obj);

        // Constrain spawn to visible area (walls at x=±12, z=-8 to +3)
        const spreadX = 6; 
        const spreadZ = 4;
        const xPos = (Math.random()-0.5) * spreadX;
        const zPos = (Math.random()-0.5) * spreadZ - 1; // Bias toward center
        obj.body.position.set(xPos, 5 + index * 2.5, zPos);

        // Reduced force to keep dice in bounds
        const force = 10;
        obj.body.applyImpulse(
            new CANNON.Vec3((Math.random()-0.5)*force, force * 0.8, (Math.random()-0.5)*force * 0.5),
            new CANNON.Vec3(0,0,0)
        );

        const spin = 10;
        obj.body.angularVelocity.set(Math.random()*spin, Math.random()*spin, Math.random()*spin);
        obj.body.quaternion.setFromEuler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

        // Play roll sound for each die (staggered slightly for realism)
        setTimeout(() => SoundFX.play('roll'), index * 60 + Math.random() * 40);
    });

    // Announce result after dice settle
    setTimeout(() => {
        if (appState.gameMode === 'Free Throw' && diceObjects.length > 0) {
            // Read and announce results
            let total = 0;
            const results = [];
            diceObjects.forEach(obj => {
                const val = readDieValueGeneric(obj);
                results.push(val);
                total += val;
            });
            const resultStr = results.join(', ');
            speak(`You rolled ${resultStr}. Total: ${total}`);
            document.getElementById('instructions').textContent = `Rolled: ${resultStr} (Total: ${total})`;
        }
    }, 2500);
}

const VALUE_MAPS = {
    d8:  [1, 5, 2, 3, 4, 8, 6, 7],
    d10: [0, 8, 6, 4, 2, 1, 3, 5, 7, 9], 
    d12: [12, 5, 9, 6, 2, 10, 11, 3, 4, 8, 1, 7],
    d20: [20, 8, 14, 2, 10, 12, 16, 4, 18, 6, 15, 13, 9, 5, 17, 19, 11, 3, 7, 1]
};

// Generic die value reader (Updated for real physics readout)
function readDieValueGeneric(diceObj) {
    const type = diceObj.mesh.userData.diceType || 'd6';
    if (type === 'd6') return readDieValue(diceObj);

    const mesh = diceObj.mesh;
    const worldUp = new THREE.Vector3(0, 1, 0);

    // D4: Highest vertex matches the upright number
    if (type === 'd4') {
        const vertices = mesh.userData.simVertices; 
        if (!vertices) return 1;

        let maxY = -Infinity;
        let bestVal = 1;
        const vector = new THREE.Vector3();

        vertices.forEach(v => {
            vector.set(v.x, v.y, v.z).applyMatrix4(mesh.matrixWorld);
            if (vector.y > maxY) {
                maxY = vector.y;
                bestVal = v.value;
            }
        });
        return bestVal;
    }

    // Other Polyhedra: Face Normal closest to Up (0,1,0)
    const map = VALUE_MAPS[type];
    if (!map) return 1;

    const geometry = mesh.geometry;
    const pos = geometry.attributes.position;
    const stride = (type === 'd12') ? 9 : 3;
    const numFaces = map.length;

    let bestDot = -Infinity;
    let bestVal = 1;

    const vA = new THREE.Vector3();
    const vB = new THREE.Vector3();
    const vC = new THREE.Vector3();
    const cb = new THREE.Vector3();
    const ab = new THREE.Vector3();

    for (let i = 0; i < numFaces; i++) {
        // Get first triangle of the face
        const idx = i * stride;
        vA.fromBufferAttribute(pos, idx);
        vB.fromBufferAttribute(pos, idx+1);
        vC.fromBufferAttribute(pos, idx+2);

        // Compute Normal
        cb.subVectors(vC, vB);
        ab.subVectors(vA, vB);
        cb.cross(ab).normalize();

        // Transform to World
        cb.transformDirection(mesh.matrixWorld);

        const dot = cb.dot(worldUp);
        if (dot > bestDot) {
            bestDot = dot;
            bestVal = map[i];
        }
    }
    return bestVal;
}

// 3D dice rolling for Yarkle/Fahtzee (d6 only)
// heldData: array of { index: number, value: number } for dice to KEEP visual
function throw3DDice(numDice, heldData = [], callback) {
    // Clear existing dice
    clearSceneDice();

    // Clear saved original colors for new dice
    originalDieColors.clear();

    // Re-create Held/Locked Dice
    const lockedIndices = heldData.map(d => d.index);

    heldData.forEach(d => {
        const obj = createDieMesh('d6');
        scene.add(obj.mesh);
        world.addBody(obj.body);
        diceObjects.push(obj); // We need them in array to match indices
        // Hack: we need diceObjects to be sorted by index eventually?
        // throw3DDice logic relied on diceMap.
        // Let's attach metadata.
        obj.mesh.userData.originalIndex = d.index;

        // Position in "Held Zone"
        // Put held dice at the back of the visible area (negative Z)
        // Back wall is at z=-8, so we place held dice at z=-6
        const spread = 2.0;
        const xPos = (d.index - numDice/2) * spread;

        obj.body.position.set(xPos, 1.0, -6);
        obj.body.velocity.set(0,0,0);
        obj.body.angularVelocity.set(0,0,0);
        obj.body.type = CANNON.Body.STATIC; // Freeze them
        obj.body.mass = 0;
        obj.body.updateMassProperties();

        // Set Face Up
        const rot = {
            1: new THREE.Euler(0, 0, Math.PI/2),
            6: new THREE.Euler(0, 0, -Math.PI/2),
            2: new THREE.Euler(0, 0, 0),
            5: new THREE.Euler(Math.PI, 0, 0),
            3: new THREE.Euler(-Math.PI/2, 0, 0),
            4: new THREE.Euler(Math.PI/2, 0, 0)
        };
        if (rot[d.value]) {
            obj.mesh.quaternion.setFromEuler(rot[d.value]);
            obj.body.quaternion.copy(obj.mesh.quaternion);
        }
    });

    // Set camera for dice viewing
    const targetHeight = 12 + (numDice * 2);
    const clampedHeight = Math.min(Math.max(targetHeight, 15), 35);
    camera.position.set(0, clampedHeight, 1);
    camera.lookAt(0, 0, 0);

    // Create dice for rolling
    const diceMap = []; // maps diceObjects index (of ROLLING dice) to original index
    for (let i = 0; i < numDice; i++) {
        if (lockedIndices.includes(i)) continue;

        const obj = createDieMesh('d6');
        scene.add(obj.mesh);
        world.addBody(obj.body);
        diceObjects.push(obj);
                obj.mesh.userData.originalIndex = i;
        diceMap.push(i); // This works if we iterate diceObjects and filter?
        // Actually diceObjects now contains mixed (held and rolling).

        // Use random rotation to ensure variety in rolls
        obj.mesh.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

        // Spread dice across the area - constrain to visible bounds
        // Walls are at x=±12, z=-8 to z=+3
        const spreadX = 8; // Stay within ±8 on X
        const xPos = (i - numDice/2) * 1.5 + (Math.random() - 0.5) * 2;
        // Keep Z between -4 and +1 (middle of play area)
        const zPos = (Math.random() - 0.5) * 3 - 1;
        obj.body.position.set(
            Math.max(-spreadX, Math.min(spreadX, xPos)), 
            8 + Math.random() * 2, 
            zPos
        );

        // Reduced force to prevent dice from bouncing too far
        const force = 8;
        obj.body.applyImpulse(
            new CANNON.Vec3((Math.random()-0.5)*force, force, (Math.random()-0.5)*force),
            new CANNON.Vec3(0,0,0)
        );

        const spin = 15;
        obj.body.angularVelocity.set(Math.random()*spin, Math.random()*spin, Math.random()*spin);
        obj.body.quaternion.setFromEuler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

        // Play roll sound per die, slightly staggered
        setTimeout(() => SoundFX.play('roll'), i * 60 + Math.random() * 40);
    }

    // Wait for dice to settle and read results
    setTimeout(() => {
        const results = new Array(numDice).fill(0);

        // Sort objects by original index so array order matches logic order?
        // Or just read using userData.originalIndex
        diceObjects.forEach((obj) => {
            const idx = obj.mesh.userData.originalIndex;
            if (idx !== undefined && idx < numDice) {
                // If it's held (static), value is already known, but reading it physically is safer/consistent
                // Since we set it physically static, readDieValue should return the correct value!
                results[idx] = readDieValue(obj);
            }
        });

        if (callback) callback(results);
    }, 2000); 
}

// Read the top face value of a d6
// BoxGeometry face order: +X(1), -X(6), +Y(2), -Y(5), +Z(3), -Z(4)
function readDieValue(diceObj) {
    // Get the world up vector and transform to local space
    const worldUp = new THREE.Vector3(0, 1, 0);
    const invQuat = diceObj.mesh.quaternion.clone().invert();
    const localUp = worldUp.clone().applyQuaternion(invQuat);

    // d6 face normals in local space and their values
    // Based on: order = [1, 6, 2, 5, 3, 4] for +X, -X, +Y, -Y, +Z, -Z
    const faceNormals = [
        { normal: new THREE.Vector3(1, 0, 0), value: 1 },   // +X
        { normal: new THREE.Vector3(-1, 0, 0), value: 6 },  // -X
        { normal: new THREE.Vector3(0, 1, 0), value: 2 },   // +Y
        { normal: new THREE.Vector3(0, -1, 0), value: 5 },  // -Y
        { normal: new THREE.Vector3(0, 0, 1), value: 3 },   // +Z
        { normal: new THREE.Vector3(0, 0, -1), value: 4 }   // -Z
    ];

    let maxDot = -Infinity;
    let result = 1;
    for (const face of faceNormals) {
        const dot = localUp.dot(face.normal);
        if (dot > maxDot) {
            maxDot = dot;
            result = face.value;
        }
    }
    return result;
}

// --- Interaction Handlers ---
// Handlers are now attached via onclick in HTML for better dynamic control
/*
document.getElementById('throwBtn').addEventListener('click', throwDice);
document.getElementById('clearBtn').addEventListener('click', () => {
     for(let key in appState.diceConfig) appState.diceConfig[key] = 0;
     updateUI();
     clearSceneDice();
});
document.getElementById('pauseBtn').addEventListener('click', () => {
     setAppState('PAUSE');
});
*/

// Ensure pause btn (if using ID) has handler if not inline
const pauseBtn = document.getElementById('pauseBtn');
if(pauseBtn && !pauseBtn.getAttribute('onclick')) {
    pauseBtn.addEventListener('click', () => setAppState('PAUSE'));
}

// --- Input Manager & State Machine ---
function setAppState(newState) {
    // Store previous state before changing (for resume logic)
    appState.previousState = appState.state;
    appState.state = newState;

    // Clear instructions text (score display for Free Throw)
    const instructions = document.getElementById('instructions');
    if (instructions) instructions.textContent = '';

    // Hide everything first
    document.getElementById('menu-layer').classList.add('hidden');
    document.getElementById('main-menu').classList.add('hidden');
    document.getElementById('setup-panel').classList.add('hidden');
    document.getElementById('pause-menu').classList.add('hidden');
    document.getElementById('settings-menu').classList.add('hidden');
    document.getElementById('rules-freethrow').classList.add('hidden');
    document.getElementById('rules-yarkle').classList.add('hidden');
    document.getElementById('rules-fahtzee').classList.add('hidden');

    const ui = document.getElementById('ui-container');
    ui.classList.add('hidden');
    ui.style.display = 'none'; // Explicitly hide

    // Reset scan Index whenever we change screens
    appState.scanIndex = 0;

    if (newState === 'MENU') {
        // STOP GAME AND RESET
        if (window.stopAllGameLogic) window.stopAllGameLogic();

        document.getElementById('menu-layer').classList.remove('hidden');
        document.getElementById('main-menu').classList.remove('hidden');
        speak("Benny's Dice. Use space to scan, enter to select.");
    } else if (newState === 'SETUP') {
        document.getElementById('menu-layer').classList.remove('hidden');
        document.getElementById('setup-panel').classList.remove('hidden');
        speak("Game Setup");
    } else if (newState === 'PAUSE') {
        document.getElementById('menu-layer').classList.remove('hidden');
        document.getElementById('pause-menu').classList.remove('hidden');
        speak("Game Paused");
    } else if (newState === 'SETTINGS') {
        document.getElementById('menu-layer').classList.remove('hidden');
        document.getElementById('settings-menu').classList.remove('hidden');
        updateSettingsDisplay();
        speak("Settings");
    } else if (newState === 'RULES') {
        document.getElementById('menu-layer').classList.remove('hidden');

        // Show appropriate rules panel
        let rulesId = 'rules-freethrow';
        if (appState.gameMode === 'Yarkle') {
            rulesId = 'rules-yarkle';
        } else if (appState.gameMode === 'Fahtzee') {
            rulesId = 'rules-fahtzee';
        }
        const rulesEl = document.getElementById(rulesId);
        rulesEl.classList.remove('hidden');

        // Read the full rules text
        speak(rulesEl.innerText, true); // true = interrupt current speech

        // Don't speak the button focus immediately, so rules can be heard
        refreshScanFocus(false);
        return; // Exit early to avoid refreshScanFocus() call at end of function
    } else if (newState === 'GAME') {
        const ui = document.getElementById('ui-container');
        ui.classList.remove('hidden');
        ui.style.display = 'flex'; // Force flex display

        // Switch controls based on Game Mode
        document.querySelectorAll('.game-controls-set').forEach(el => {
            el.classList.add('hidden');
            el.style.display = 'none'; // Force hide
        });

        let modeId = 'controls-Fahtzee'; // Default
        if (appState.gameMode === 'Free Throw') modeId = 'controls-Free-Throw';
        else if (appState.gameMode === 'Yarkle') modeId = 'controls-Yarkle';

        const activeControls = document.getElementById(modeId);
        if(activeControls) {
            activeControls.classList.remove('hidden');
            activeControls.style.display = 'flex'; // Force show
        }

        // Force resize now that UI is visible
        setTimeout(handleResize, 50);

        // Only initialize game if we're not resuming from pause
        const isResuming = (appState.previousState === 'PAUSE');

        console.log('[setAppState] GAME state, previousState:', appState.previousState, 'isResuming:', isResuming, 'gameMode:', appState.gameMode);

        // Initialize game based on mode (only if not resuming)
        if (!isResuming) {
            if (appState.gameMode === 'Yarkle') {
                initYarkle();
                // Speech handled by initiative roll
            } else if (appState.gameMode === 'Fahtzee') {
                initFahtzee();
                // Speech handled by initiative roll
            } else if (appState.gameMode === 'Free Throw') {
                // Free Throw mode - use 3D dice
                // Ensure at least one d6 if config is empty
                let hasDice = false;
                for(let k in appState.diceConfig) if(appState.diceConfig[k]>0) hasDice=true;
                if(!hasDice) appState.diceConfig['d6'] = 1;

                updateUI();
                throwDice(); // Always throw on entering game mode
                speak("Free Throw! Rolling dice.");
                SoundFX.play('roll');
            }
        }
    }

    refreshScanFocus();
}

// Action Handlers for Menu
function handleMenuAction(action) {
    SoundFX.play('select');

    if (action === 'toggle-mode') {
        modeIndex = (modeIndex + 1) % MODES.length;
        appState.gameMode = MODES[modeIndex];
        updateUI();
        speak(appState.gameMode);
    }
    if (action === 'toggle-players') {
        appState.players = (appState.players % 4) + 1;
        updateUI();
        speak(appState.players + " players");
    }
    if (action === 'play') {
        // If Yarkle or Fahtzee, go to Setup first to choose players
        if (appState.gameMode === 'Yarkle' || appState.gameMode === 'Fahtzee') {
            setAppState('SETUP');
        } else {
            // Show rules first for Free Throw (or straight to game?)
            // Free Throw usually doesn't need setup
             setAppState('RULES');
        }
    }
    if (action === 'settings') {
        setAppState('SETTINGS');
    }
    if (action === 'toggle-tts') {
        if (window.NarbeVoiceManager) {
            const newState = window.NarbeVoiceManager.toggleTTS();
            updateSettingsDisplay();
            // Temporarily enable to speak the status
            const origState = window.NarbeVoiceManager.getSettings().ttsEnabled;
            if (!origState) window.NarbeVoiceManager.updateSettings({ ttsEnabled: true });
            speak(newState ? "Speech on" : "Speech off");
            if (!origState) window.NarbeVoiceManager.updateSettings({ ttsEnabled: origState });
        }
    }
    if (action === 'toggle-sound') {
        gameSettings.sound = !gameSettings.sound;
        updateSettingsDisplay();
        speak(gameSettings.sound ? "Sound effects on" : "Sound effects off");
        saveSettings();
    }
    if (action === 'toggle-autoscan') {
        if (window.NarbeScanManager) {
            window.NarbeScanManager.toggleAutoScan();
            updateSettingsDisplay();
            const autoScan = window.NarbeScanManager.getSettings().autoScan;
            speak(autoScan ? "Auto scan on" : "Auto scan off");
        }
    }
    if (action === 'cycle-speed') {
        if (window.NarbeScanManager) {
            window.NarbeScanManager.cycleScanSpeed();
            updateSettingsDisplay();
            const scanInterval = window.NarbeScanManager.getScanInterval();
            speak("Scan speed " + (scanInterval / 1000) + " seconds");
        }
    }
    if (action === 'cycle-voice') {
        if (window.NarbeVoiceManager) {
            window.NarbeVoiceManager.cycleVoice();
            updateSettingsDisplay();
            const voice = window.NarbeVoiceManager.getCurrentVoice();
            const displayName = voice ? window.NarbeVoiceManager.getVoiceDisplayName(voice) : 'Default';
            speak("Voice " + displayName);
        }
    }
    if (action === 'back-from-settings') {
        setAppState(appState.previousState || 'MENU');
    }
    if (action === 'exit') {
        // Navigate back to bennyshub
        if (window.parent && window.parent !== window) {
            window.parent.postMessage({ action: 'focusBackButton' }, '*');
        } else {
            location.href = '../../../index.html';
        }
    }
    if (action === 'start-game') {
        setAppState('RULES'); // Show rules before game
    }
    if (action === 'start-after-rules') {
        SoundFX.play('score');
        speak("Game Started");
        setAppState('GAME');
        // Note: initGameMode is called inside setAppState('GAME')
    }
    if (action === 'back-from-setup') {
        SoundFX.play('select');
        setAppState('MENU');
    }
    if (action === 'resume-game') {
        SoundFX.play('select');
        setAppState('GAME');
    }
    if (action === 'confirm-quit') {
        // Return to Main Menu
        setAppState('MENU');
    }
}

// --- Scanning System ---
function getFocusables() {
     if (appState.state === 'MENU') {
         return Array.from(document.querySelectorAll('#main-menu .menu-item'));
     }
     if (appState.state === 'SETUP') {
         return Array.from(document.querySelectorAll('#setup-panel .menu-item'));
     }
     if (appState.state === 'PAUSE') {
         return Array.from(document.querySelectorAll('#pause-menu .menu-item'));
     }
     if (appState.state === 'SETTINGS') {
         return Array.from(document.querySelectorAll('#settings-menu .menu-item'));
     }
     if (appState.state === 'RULES') {
         // Rules screen - just the start button
         let rulesId = 'rules-freethrow';
         if (appState.gameMode === 'Yarkle') rulesId = 'rules-yarkle';
         else if (appState.gameMode === 'Fahtzee') rulesId = 'rules-fahtzee';
         return Array.from(document.querySelectorAll(`#${rulesId} .start-btn`));
     }
     if (appState.state === 'GAME') {
         // During initiative phase, no controls are scannable
         if (appState.initiativePhase) {
             return [];
         }

         // In game, we cycle dice first (for Yarkle/Fahtzee), then action buttons
         let elements = [];

         // Check if player has rolled this turn - only allow dice selection AFTER rolling
         let hasRolledThisTurn = false;
         let isPlayerTurn = true;

         if (appState.gameMode === 'Yarkle' && window.yarkleState) {
             hasRolledThisTurn = window.yarkleState.hasRolled;
             isPlayerTurn = window.yarkleState.isPlayerTurn;
         } else if (appState.gameMode === 'Fahtzee' && window.fahtzeeState) {
             hasRolledThisTurn = window.fahtzeeState.rollsLeft < 3; // Has rolled if less than 3 rolls left
             isPlayerTurn = window.fahtzeeState.isPlayerTurn;
         }

         // Only include dice overlays if it's player's turn AND they have rolled,
         // BUT EXCLUDE Yarkle since it uses auto-hold now.
         let diceOverlays = [];
         if (appState.gameMode === 'Fahtzee' && isPlayerTurn && hasRolledThisTurn) {
             diceOverlays = Array.from(document.querySelectorAll('#dice-overlays [data-scan="true"]'));
         }

         // Get visible control set buttons
         let modeId = 'controls-Free-Throw';
         if (appState.gameMode === 'Yarkle') modeId = 'controls-Yarkle';
         else if (appState.gameMode === 'Fahtzee') modeId = 'controls-Fahtzee';

         const controlSet = document.getElementById(modeId);
         if (controlSet) {
             // Before rolling, only show Roll and Pause buttons
             if ((appState.gameMode === 'Yarkle' || appState.gameMode === 'Fahtzee') && isPlayerTurn && !hasRolledThisTurn) {
                 // Only Roll and Pause are scannable before first roll
                 const rollBtn = controlSet.querySelector('#yarkleRollBtn, #fahtzeeRollBtn');
                 const pauseBtn = controlSet.querySelector('#yarklePauseBtn, #fahtzeePauseBtn');
                 if (rollBtn) elements.push(rollBtn);
                 if (pauseBtn) elements.push(pauseBtn);
             } else {
                 // For Fahtzee, we want buttons FIRST, then dice (so user stays on Roll easily)
                 // For others, order doesn't matter much or dice aren't scanned

                 const controls = Array.from(controlSet.querySelectorAll('[data-scan="true"]'));
                 elements = elements.concat(controls);
             }
         }

         // Append dice last (specifically for Fahtzee)
         if (diceOverlays.length > 0) {
             elements = elements.concat(diceOverlays);
         }

         return elements;
     }
     if (appState.state === 'FAHTZEE_SCORE') {
         // Scorecard selection
         return Array.from(document.querySelectorAll('#fahtzee-categories .fahtzee-cat:not(.used), #fahtzee-cancel-score'));
     }
     return [];
}

function refreshScanFocus(shouldSpeak = true) {
    const targets = getFocusables();
    // Clear all focus
    document.querySelectorAll('.focused').forEach(el => el.classList.remove('focused'));

    // Clear dice focus
    focusedDieIndex = -1;
    updateDiceGlows();

    if (targets.length === 0) return;

    if (appState.scanIndex >= targets.length) appState.scanIndex = 0;

    const target = targets[appState.scanIndex];
    target.classList.add('focused');

    // Check if this is a dice overlay
    if (target.id && target.id.startsWith('die-overlay-')) {
        const dieIdx = parseInt(target.id.replace('die-overlay-', ''));
        focusedDieIndex = dieIdx;
        updateDiceGlows();
    }

    // Announce the focused element
    if (shouldSpeak) {
        announceElement(target);
    }
}

function activateFocused() {
    const targets = getFocusables();
    if (appState.scanIndex >= targets.length) return;
    const target = targets[appState.scanIndex];

    // Visual and audio feedback
    target.classList.add('active');
    SoundFX.play('select');
    setTimeout(() => target.classList.remove('active'), 200);

    if (target.dataset.action) {
        handleMenuAction(target.dataset.action);
    } else {
        target.click(); // Standard click for buttons
    }
}

function moveScan(direction) {
    const targets = getFocusables();
    if (targets.length === 0) return;
    appState.scanIndex = (appState.scanIndex + direction + targets.length) % targets.length;
    refreshScanFocus();
}

function onSpaceShortPress() {
    moveScan(1);
}

function onSpaceLongPress() {
    moveScan(-1); // Move backward immediately
    // Get speed from manager if available
    const speed = (window.NarbeScanManager) ? window.NarbeScanManager.getScanInterval() : inputState.config.repeatInterval;
    inputState.timers.spaceRepeat = setInterval(() => {
        moveScan(-1);
    }, speed);
}

// Input Listener
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        if (!inputState.spaceHeld) {
            inputState.spaceHeld = true;
            inputState.spaceTime = Date.now();
            inputState.timers.space = setTimeout(onSpaceLongPress, inputState.config.longPress);
        }
    }
});

window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
        e.preventDefault(); 
        clearTimeout(inputState.timers.space);
        clearInterval(inputState.timers.spaceRepeat);

        if (inputState.spaceHeld) {
            const duration = Date.now() - inputState.spaceTime;
            if (duration < inputState.config.longPress) {
                onSpaceShortPress();
            }
        }
        inputState.spaceHeld = false;
    }
    if (e.code === 'Enter') { 
        activateFocused();
    }
    if (e.code === 'Escape') {
        if(appState.state === 'GAME') setAppState('MENU');
    }
});

// Initialize

// --- Global Mouse Support (Event Delegation) ---
// Handle clicks on any actionable item
document.body.addEventListener('click', (e) => {
    const target = e.target.closest('[data-action]');

    if (target) {
        // Determine if this element is currently interactable based on state
        // (Optional: filter based on visibility if needed, but usually hidden elements can't be clicked)

        e.stopPropagation();
        handleMenuAction(target.dataset.action);
    }
});

// Handle hover for flexible input (Mouse + Keyboard/Switch)
document.body.addEventListener('mousemove', (e) => {
     // Use mousemove/mouseover to update scan index when hovering items
     // We use closest to find the container
     const target = e.target.closest('[data-scan="true"], .menu-item, .start-btn');
     if (target) {
         const focusables = getFocusables();
         const idx = focusables.indexOf(target);
         if (idx >= 0 && idx !== appState.scanIndex) {
             appState.scanIndex = idx;
             refreshScanFocus(false); // Update visual but don't announce constantly
         }
     }
});

updateUI();
setAppState('MENU');
refreshScanFocus();

// ============================================
// INITIATIVE SYSTEM (WHO GOES FIRST)
// ============================================
function runInitiativeRoll(callback) {
    try {
    appState.players = parseInt(appState.players) || 1;
    console.log('[INITIATIVE] runInitiativeRoll called, players:', appState.players);
    // Lock controls during initiative
    appState.initiativePhase = true;
    refreshScanFocus(); // Clear any focused elements

    clearSceneDice();
    const instructionsEl = document.getElementById('instructions');
    instructionsEl.innerHTML = "Rolling for initiative...<br><span style='font-size:16px'>Players: " + appState.players + "</span>";
    instructionsEl.style.display = 'block'; // Make sure it's visible
    instructionsEl.style.color = '#ffeb3b'; // Yellow for visibility
    instructionsEl.style.fontSize = '24px';

    camera.position.set(0, 18, 1);
    camera.lookAt(0,0,0);

    // Dice Data Setup
    let diceData = [];
    const isSinglePlayer = (appState.players === 1);

    console.log('[INITIATIVE] isSinglePlayer:', isSinglePlayer);

    if (isSinglePlayer) {
        // Player vs CPU
        diceData = [
            { id: 'player', color: '#2e7d32', label: 'You' }, // Player 1 (Green)
            { id: 'cpu', color: '#c62828', label: 'CPU' }     // CPU (Red)
        ];
        speak("Let's see who goes first! Rolling off.");
    } else {
        // Multiplayer (2-4 Players)
        // P1: Red, P2: Blue, P3: Green, P4: Yellow
        const colors = ['#ff0000', '#0000ff', '#00ff00', '#ffff00'];
        const labels = ['Player 1', 'Player 2', 'Player 3', 'Player 4'];

        for(let i=0; i<appState.players; i++) {
            diceData.push({ id: `p${i+1}`, idx: i, color: colors[i], label: labels[i] });
        }
        speak("Rolling initiative for " + appState.players + " players.");
    }

    diceObjects = []; // Reset global tracker

    console.log('[INITIATIVE] Creating', diceData.length, 'dice');

    diceData.forEach((d, i) => {
        // Custom colored dice
        const geometry = new THREE.BoxGeometry(1.2, 1.2, 1.2);
        const shape = new CANNON.Box(new CANNON.Vec3(0.6, 0.6, 0.6));
        const order = [1, 6, 2, 5, 3, 4];
        const matArray = order.map(n => new THREE.MeshStandardMaterial({ 
            map: createTexture('dot', n, d.color), roughness: 0.2
        }));

        const mesh = new THREE.Mesh(geometry, matArray);
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { type: 'die', body: shape, diceType: 'd6', label: d.label, id: d.id, ownerIdx: d.idx };

        const body = new CANNON.Body({ mass: 5, shape: shape, material: diceMaterial });

        // Position dice nicely
         const spread = 2.5;
        const startX = -((diceData.length - 1) * spread) / 2;
        const x = startX + (i * spread);

        body.position.set(x, 10, 0);
        body.angularVelocity.set(Math.random()*20, Math.random()*20, Math.random()*20);

        scene.add(mesh);
        world.addBody(body);
        diceObjects.push({ mesh, body }); // Use standard array so physics updates them

        setTimeout(() => SoundFX.play('roll'), i * 300);
    });

    // Wait and read
    setTimeout(() => {
        // Collect results
        let rollResults = [];
        try {
            rollResults = diceObjects.filter(o=>o&&o.mesh).map(obj => {
                let val = 1;
                try { val = readDieValue(obj); } catch(e){ val = Math.floor(Math.random()*6)+1; }
                const u = obj.mesh.userData || {};
                // Ensure idx is valid for multiplayer
                let idx = u.ownerIdx;
                if (idx === undefined && u.id && typeof u.id === 'string' && u.id.startsWith('p')) {
                     idx = parseInt(u.id.substring(1)) - 1;
                }
                return { val: val, id: u.id, label: u.label, idx: idx };
            });
        } catch(e){}

        if(rollResults.length === 0) {
            setTimeout(() => runInitiativeRoll(callback), 1000);
            return;
        }

        // Announce
        const resultText = rollResults.map(r => `${r.label} rolled ${r.val}`).join(", ");
        speak(resultText);

        // Determine Winner
        rollResults.sort((a,b) => b.val - a.val); // Descending

        const winner = rollResults[0];
        const tie = (rollResults.length > 1 && rollResults[0].val === rollResults[1].val);

        if (tie) {
            speak("It's a tie for first! Reroll.");
            setTimeout(() => runInitiativeRoll(callback), 3000);
        } else {
            speak(`${winner.label} goes first!`);
            document.getElementById('instructions').textContent = `${winner.label} starts!`;

            setTimeout(() => {
                appState.initiativePhase = false;
                document.getElementById('instructions').textContent = ''; 

                if (isSinglePlayer) {
                     // Original Callback Signature: true/false for Player/CPU
                    callback(winner.id === 'player');
                } else {
                    // New Multiplayer Signature: index of starting player
                    callback(winner.idx);
                }
                refreshScanFocus();
            }, 2000);
        }
    }, 4000);
    } catch (err) {
        console.error('[INITIATIVE] Critical Error:', err);
        alert("Initiative Error: " + err.message);
        appState.initiativePhase = false;
        callback(0);
    }
}

// ============================================
// FARKLE GAME ENGINE
// ============================================
const yarkleState = {
    dice: [0, 0, 0, 0, 0, 0], // 6 dice values (1-6)
    held: [false, false, false, false, false, false], // Which dice are held/scored
    locked: [false, false, false, false, false, false], // Locked after scoring
    turnScore: 0,
    totalScore: 0,
    aiScore: 0,
    isPlayerTurn: true,
    rollCount: 0,
    hasRolled: false,
    targetScore: 10000,
    currentPlayer: 0, // 0-indexed current player
    scores: [0, 0, 0, 0] // Multiplayer scores
};
window.yarkleState = yarkleState; // Expose for getFocusables

const YARKLE_SCORING = {
    // Single dice
    1: 100,
    5: 50,
    // Three of a kind
    '111': 1000, '222': 200, '333': 300, '444': 400, '555': 500, '666': 600,
    // Four/Five/Six of a kind (doubling rule)
    '1111': 2000, '2222': 400, '3333': 600, '4444': 800, '5555': 1000, '6666': 1200,
    '11111': 4000, '22222': 800, '33333': 1200, '44444': 1600, '55555': 2000, '66666': 2400,
    '111111': 8000, '222222': 1600, '333333': 2400, '444444': 3200, '555555': 4000, '666666': 4800,
    // Special
    'threePairs': 1500,
    'straight': 2500
};

function calculateYarkleScore(diceValues) {
    // Count occurrences
    const counts = [0, 0, 0, 0, 0, 0, 0]; // index 1-6
    diceValues.forEach(v => counts[v]++);

    let score = 0;
    const usedDice = []; // Tracks VALUES used, not indices

    // Check for straight (1-2-3-4-5-6)
    if (diceValues.length === 6 && counts[1] === 1 && counts[2] === 1 && counts[3] === 1 && counts[4] === 1 && counts[5] === 1 && counts[6] === 1) {
        return { score: 2500, allScoring: true, usedDice: [1,2,3,4,5,6] };
    }

    // Check for three pairs
    let pairCount = 0;
    for (let i = 1; i <= 6; i++) {
        if (counts[i] === 2) pairCount++;
    }
    if (diceValues.length === 6 && pairCount === 3) {
        return { score: 1500, allScoring: true, usedDice: diceValues };
    }

    // Check for sets of 3 or more
    for (let face = 1; face <= 6; face++) {
        if (counts[face] >= 3) {
            const key = String(face).repeat(counts[face]);
            if (YARKLE_SCORING[key]) {
                score += YARKLE_SCORING[key];
                for (let i = 0; i < counts[face]; i++) usedDice.push(face);
                counts[face] = 0;
            } else if (counts[face] >= 3) {
                // Fallback: three of a kind base
                const baseKey = String(face).repeat(3);
                score += YARKLE_SCORING[baseKey] || (face === 1 ? 1000 : face * 100);
                for (let i = 0; i < 3; i++) usedDice.push(face);
                counts[face] -= 3;
            }
        }
    }

    // Remaining 1s and 5s
    if (counts[1] > 0) {
        score += counts[1] * 100;
        for (let i = 0; i < counts[1]; i++) usedDice.push(1);
    }
    if (counts[5] > 0) {
         score += counts[5] * 50;
         for (let i = 0; i < counts[5]; i++) usedDice.push(5);
    }

    return { score, usedDice, allScoring: usedDice.length === diceValues.length };
}

// Dice face rendering with dots
function createDiceFaceHTML(value) {
    const dotPositions = {
        1: [[50, 50]],
        2: [[25, 25], [75, 75]],
        3: [[25, 25], [50, 50], [75, 75]],
        4: [[25, 25], [75, 25], [25, 75], [75, 75]],
        5: [[25, 25], [75, 25], [50, 50], [25, 75], [75, 75]],
        6: [[25, 25], [75, 25], [25, 50], [75, 50], [25, 75], [75, 75]]
    };

    if (!value || value < 1 || value > 6) return '?';

    const dots = dotPositions[value];
    let html = '';
    dots.forEach(([x, y]) => {
        html += `<div style="position:absolute; width:12px; height:12px; background:#222; border-radius:50%; left:${x}%; top:${y}%; transform:translate(-50%,-50%);"></div>`;
    });
    return html;
}

function renderYarkleDice() {
    console.log('[YARKLE] renderYarkleDice called, players:', appState.players, 'currentPlayer:', yarkleState.currentPlayer);
    // NOTE: DOM Elements for dice row were removed in favor of 3D overlay interaction.
    // This function now primarily updates the text scores.
    // But we keep the logic clean to avoid crashes if someone tries to reference removed elements.

    const row = document.getElementById('yarkle-dice-row');
    if(row) {
        row.innerHTML = '';
        // (Old DOM rendering logic skipped since element is removed from HTML)
    }

    // Update info
    document.getElementById('yarkle-turn-score').textContent = yarkleState.turnScore;

    // Player score colors: Red, Blue, Green, Yellow
    const mpColors = ['#ff0000', '#0055ff', '#00aa00', '#eebd00'];

    if (appState.players === 1) {
        // 1P Mode Labels (YOU vs CPU)
        document.getElementById('yarkle-score-p1').style.display = '';
        document.getElementById('yarkle-score-cpu').style.display = '';
        document.getElementById('yarkle-mp-scoreboard').style.display = 'none';

        document.getElementById('yarkle-total-score').textContent = yarkleState.totalScore;
        document.getElementById('yarkle-ai-score').textContent = yarkleState.aiScore;
        document.getElementById('yarkle-turn-indicator').textContent = yarkleState.isPlayerTurn ? 'Your Turn' : "CPU's Turn";
        document.getElementById('yarkle-turn-indicator').style.color = '';
    } else {
        // Multiplayer - Hide 1P elements, show scoreboard
        document.getElementById('yarkle-score-p1').style.display = 'none';
        document.getElementById('yarkle-score-cpu').style.display = 'none';

        const scoreboard = document.getElementById('yarkle-mp-scoreboard');
        scoreboard.style.display = 'flex';
        scoreboard.innerHTML = '';

        for (let i = 0; i < appState.players; i++) {
            const isCurrentPlayer = (i === yarkleState.currentPlayer);
            const span = document.createElement('span');
            span.style.background = mpColors[i];
            span.style.padding = '3px 10px';
            span.style.borderRadius = '5px';
            span.style.border = isCurrentPlayer ? '2px solid #fff' : '2px solid transparent';
            span.style.fontWeight = isCurrentPlayer ? 'bold' : 'normal';
            span.innerHTML = `P${i+1}: <strong>${yarkleState.scores[i]}</strong>`;
            scoreboard.appendChild(span);
        }

        const pColor = mpColors[yarkleState.currentPlayer];
        const ind = document.getElementById('yarkle-turn-indicator');
        if(ind) {
            ind.textContent = `Player ${yarkleState.currentPlayer + 1}'s Turn`;
            ind.style.color = pColor;
        }
    }

    // Update Overlays (since dice state changed)
    updateDiceOverlays();
}

function toggleYarkleHold(index) {
    if (yarkleState.locked[index]) return;
    if (!yarkleState.hasRolled) {
        // Can't select dice before rolling
        document.getElementById('yarkle-message').textContent = 'Roll the dice first!';
        speak('Roll the dice first!');
        return;
    }
    yarkleState.held[index] = !yarkleState.held[index];
    SoundFX.play('select');

    const v = yarkleState.dice[index];
    if (yarkleState.held[index]) {
        speak(`Holding ${v}`);
    }

    renderYarkleDice();
    updateYarklePreview();
    updateDiceGlows();
}

function updateYarklePreview() {
    const heldValues = yarkleState.dice.filter((v, i) => yarkleState.held[i] && !yarkleState.locked[i]);
    const result = calculateYarkleScore(heldValues);
    const msg = document.getElementById('yarkle-message');
    if (heldValues.length > 0) {
        msg.textContent = `Selected: ${result.score} points`;
        speak(`${result.score} points selected`, false);
    } else {
        msg.textContent = '';
    }
}

function yarkleRoll() {
    const msg = document.getElementById('yarkle-message');

    // Lock held dice and add their score
    const heldValues = yarkleState.dice.filter((v, i) => yarkleState.held[i] && !yarkleState.locked[i]);
    if (yarkleState.hasRolled && heldValues.length === 0) {
        msg.textContent = 'You must set aside at least one scoring die!';
        return;
    }

    if (yarkleState.hasRolled && heldValues.length > 0) {
        const result = calculateYarkleScore(heldValues);

        // Rule Enforcement: Cannot hold non-scoring dice
        // Verify that ALL held dice are actually used in the scoring combination
        // result.usedDice contains the VALUES used. We must check counts.
        const usedCounts = [0,0,0,0,0,0,0];
        result.usedDice.forEach(v => usedCounts[v]++);

        const heldCounts = [0,0,0,0,0,0,0];
        heldValues.forEach(v => heldCounts[v]++);

        let invalidHold = false;
        for(let v=1; v<=6; v++) {
            if (heldCounts[v] > usedCounts[v]) {
                invalidHold = true;
                break;
            }
        }

        if (result.score === 0 || invalidHold) {
             msg.textContent = 'You can only hold dice that score points!';
             speak('You can only hold dice that score points! Uncheck non-scoring dice.');
             return;
        }

        yarkleState.turnScore += result.score;

        // Lock the held dice
        for (let i = 0; i < 6; i++) {
            if (yarkleState.held[i]) yarkleState.locked[i] = true;
        }
    }

    // Check for hot dice (all 6 locked)
    const allLocked = yarkleState.locked.every(l => l);
    if (allLocked) {
        // Hot dice! Reset all locks
        yarkleState.locked = [false, false, false, false, false, false];
        yarkleState.held = [false, false, false, false, false, false];
        msg.textContent = 'HOT DICE! Roll all 6 again!';
    }

    // Disable buttons during roll
    document.getElementById('yarkleRollBtn').disabled = true;
    document.getElementById('yarkleBankBtn').disabled = true;

    // Get locked indices data (skip these)
    const lockedData = [];
    for (let i = 0; i < 6; i++) {
        if (yarkleState.locked[i]) lockedData.push({ index: i, value: yarkleState.dice[i] });
    }

    msg.textContent = 'Rolling...';
    speak('Rolling!');
    SoundFX.play('roll');

    // Roll 3D dice and get results
    throw3DDice(6, lockedData, (results) => {
        // Apply results to unlocked dice
        for (let i = 0; i < 6; i++) {
            if (!yarkleState.locked[i]) {
                yarkleState.dice[i] = results[i] || Math.floor(Math.random() * 6) + 1;
                yarkleState.held[i] = false;
            }
        }
        yarkleState.rollCount++;
        yarkleState.hasRolled = true;

        // Re-enable buttons
        document.getElementById('yarkleRollBtn').disabled = false;
        document.getElementById('yarkleBankBtn').disabled = false;

        // Check for yarkle
        const unlockedValues = yarkleState.dice.filter((v, i) => !yarkleState.locked[i]);
        const yarkleCheck = calculateYarkleScore(unlockedValues);
        if (yarkleCheck.score === 0) {
            msg.textContent = 'BUST! You lose all turn points!';
            speak('Bust! You lose all turn points!');
            SoundFX.play('bust');
            yarkleState.turnScore = 0;
            setTimeout(() => yarkleEndTurn(true), 5000);
        } else {
            // Announce what they rolled
            const diceStr = unlockedValues.join(', ');
            msg.textContent = 'Select ROLL or BANK';
            speak(`Rolled ${diceStr}. ${yarkleCheck.score} points available.`);

            // Reset scan index to start at first die
            appState.scanIndex = 0;

            // Feature: Auto-Highlight Max Points
            // Logic: Find the best scoring strategy using ALL unlocked dice
            // We assume the user wants to score the MAX possible points from this roll.
            // Scoring logic is complex because multiple combinations might exist.
            // Simple heuristic: Count occurrences, prioritize large combos, then singles.

            const counts = [0, 0, 0, 0, 0, 0, 0];
            yarkleState.dice.forEach((v, i) => {
                if (!yarkleState.locked[i]) counts[v]++;
            });

            const toHold = new Set(); // Indices to hold

            // 1. Check for Straight (1-6)
            const isStraight = (unlockedValues.length === 6 && counts[1]===1 && counts[2]===1 && counts[3]===1 && counts[4]===1 && counts[5]===1 && counts[6]===1);
            if (isStraight) {
                 // Hold everything
                 for(let i=0; i<6; i++) if(!yarkleState.locked[i]) toHold.add(i);
            } else {
                 // 2. Check for Three Pairs
                 // Check for pairs...
                 let pairs = 0;
                 for(let v=1; v<=6; v++) if(counts[v] === 2) pairs++;
                 if(unlockedValues.length === 6 && pairs === 3) {
                     // Hold everything
                     for(let i=0; i<6; i++) if(!yarkleState.locked[i]) toHold.add(i);
                 } else {
                     // 3. Standard Combos
                     // Prioritize trips/quads
                     for(let v=1; v<=6; v++) {
                         if(counts[v] >= 3) {
                             // Find indices for this value and add them
                             let needed = counts[v];
                             for(let i=0; i<6; i++) {
                                 if(!yarkleState.locked[i] && yarkleState.dice[i] === v && needed > 0) {
                                     toHold.add(i);
                                     needed--;
                                 }
                             }
                         }
                     }
                     // 4. Single 1s and 5s
                     // Only add if not part of a bigger combo (already handled by counts[v] check above since we only looked for >=3)
                     // Actually, if we had 4 ones, the loop above took all 4. 
                     // If we had 1 or 2 ones, loop skipped. We take them now.
                     [1, 5].forEach(v => {
                         if (counts[v] < 3) {
                             for(let i=0; i<6; i++) {
                                 if(!yarkleState.locked[i] && yarkleState.dice[i] === v) {
                                     toHold.add(i);
                                 }
                             }
                         }
                     });
                 }
            }

            // Apply Holds
            toHold.forEach(idx => {
                yarkleState.held[idx] = true;
            });

            if (toHold.size > 0) {
                updateYarklePreview(); // Updates points display
            }

            // Highlight scoring dice (visual update)
            highlightScoringYarkleDice();
        }

        renderYarkleDice();
    });
}

// Highlight dice that are scoring
function highlightScoringYarkleDice() {
    // Note: DOM-based highlights replaced by updateDiceOverlays() in game loop.
    // This function is kept to avoid runtime errors if still called,
    // but the visual logic is now handled in updateDiceOverlays.
}

function yarkleBank() {
    if (!yarkleState.hasRolled) return;

    // Add any currently held dice
    const heldValues = yarkleState.dice.filter((v, i) => yarkleState.held[i] && !yarkleState.locked[i]);
    const result = calculateYarkleScore(heldValues);
    yarkleState.turnScore += result.score;

    // Update score for current player
    if (appState.players === 1) {
         yarkleState.totalScore += yarkleState.turnScore;
    } else {
         yarkleState.scores[yarkleState.currentPlayer] += yarkleState.turnScore;
    }

    const currentTotal = (appState.players === 1) ? yarkleState.totalScore : yarkleState.scores[yarkleState.currentPlayer];
    const pLabel = (appState.players === 1) ? "You" : `Player ${yarkleState.currentPlayer+1}`;

    const msg = document.getElementById('yarkle-message');
    msg.textContent = `Banked ${yarkleState.turnScore}! ${pLabel} Total: ${currentTotal}`;
    speak(`Banked ${yarkleState.turnScore}! Total is ${currentTotal}.`);
    SoundFX.play('bank');

    if (currentTotal >= yarkleState.targetScore) {
        SoundFX.play('win');
        const winText = (pLabel === 'You') ? 'You Win' : `${pLabel} Wins`;
        speak(`${winText}!`);
        msg.textContent = `${winText.toUpperCase()}! Final score: ${currentTotal}`;
        setTimeout(() => {
            setAppState('MENU');
        }, 5000);
    } else {
        setTimeout(() => yarkleEndTurn(false), 5000);
    }
}

function yarkleEndTurn(wasYarkle) {
    yarkleState.dice = [0, 0, 0, 0, 0, 0];
    yarkleState.held = [false, false, false, false, false, false];
    yarkleState.locked = [false, false, false, false, false, false];
    yarkleState.turnScore = 0;
    yarkleState.rollCount = 0;
    yarkleState.hasRolled = false;

    if (appState.players === 1) {
        // Single Player (Player vs CPU) Logic
        if (yarkleState.isPlayerTurn) {
            yarkleState.isPlayerTurn = false;
            renderYarkleDice();
            document.getElementById('yarkle-message').textContent = "CPU is thinking...";
            speak("CPU's turn");
            setTimeout(yarkleAITurn, 1000);
        } else {
            yarkleState.isPlayerTurn = true;
            appState.scanIndex = 0;
            renderYarkleDice();
            document.getElementById('yarkle-message').textContent = 'Your turn - click ROLL';
            speak('Your turn! Click roll.');
            setTimeout(() => refreshScanFocus(false), 100);
        }
    } else {
        // Multiplayer Turn Switch
        yarkleState.currentPlayer = (yarkleState.currentPlayer + 1) % appState.players;
        appState.scanIndex = 0; // Reset scan to start

        renderYarkleDice();

        const pNum = yarkleState.currentPlayer + 1;
        document.getElementById('yarkle-message').textContent = `Player ${pNum}'s Turn`;
        speak(`Player ${pNum}'s turn! Click roll.`);
        setTimeout(() => refreshScanFocus(false), 100);
    }
}

// Yarkle AI logic
function yarkleAITurn() {
    if (appState.state !== 'GAME') return; // STOP if menu opened

    const msg = document.getElementById('yarkle-message');
    msg.textContent = 'CPU rolling...';
    SoundFX.play('roll');

    // Get locked indices
    const lockedData = [];
    for (let i = 0; i < 6; i++) {
        if (yarkleState.locked[i]) lockedData.push({ index: i, value: yarkleState.dice[i] });
    }

    // Roll 3D dice for AI
    throw3DDice(6, lockedData, (results) => {
        for (let i = 0; i < 6; i++) {
            if (!yarkleState.locked[i]) {
                yarkleState.dice[i] = results[i] || Math.floor(Math.random() * 6) + 1;
                yarkleState.held[i] = false;
            }
        }
        renderYarkleDice();

        // Check for yarkle
        const unlockedValues = yarkleState.dice.filter((v, i) => !yarkleState.locked[i]);
        const yarkleCheck = calculateYarkleScore(unlockedValues);

        if (yarkleCheck.score === 0) {
            msg.textContent = 'CPU BUSTED!';
            speak('CPU busted!');
            SoundFX.play('bust');
            yarkleState.turnScore = 0;
            setTimeout(() => yarkleEndTurn(true), 3000);
            return;
        }

        // AI Strategy: Set aside all scoring dice
        const counts = [0, 0, 0, 0, 0, 0, 0];
        unlockedValues.forEach(v => counts[v]++);

        // Find scoring dice indices and hold them
        for (let i = 0; i < 6; i++) {
            if (yarkleState.locked[i]) continue;
            const v = yarkleState.dice[i];
            if (v === 1 || v === 5 || counts[v] >= 3) {
                yarkleState.held[i] = true;
            }
        }

        // Calculate score from held dice
        const heldValues = yarkleState.dice.filter((v, i) => yarkleState.held[i] && !yarkleState.locked[i]);
        const result = calculateYarkleScore(heldValues);
        yarkleState.turnScore += result.score;

        // Lock held dice
        for (let i = 0; i < 6; i++) {
            if (yarkleState.held[i]) yarkleState.locked[i] = true;
        }

        renderYarkleDice();
        msg.textContent = `CPU scored ${result.score} (Turn: ${yarkleState.turnScore})`;

        // Check for hot dice
        const allLocked = yarkleState.locked.every(l => l);
        if (allLocked) {
            yarkleState.locked = [false, false, false, false, false, false];
            yarkleState.held = [false, false, false, false, false, false];
            msg.textContent = 'CPU got HOT DICE! Rolling again...';
            setTimeout(yarkleAITurn, 1500);
            return;
        }

        // Decide: bank or roll again
        const unlockedCount = yarkleState.locked.filter(l => !l).length;
        const shouldBank = yarkleState.turnScore >= 300 && (unlockedCount <= 2 || yarkleState.turnScore >= 500);

        if (shouldBank || yarkleState.aiScore + yarkleState.turnScore >= yarkleState.targetScore) {
            setTimeout(() => {
                yarkleState.aiScore += yarkleState.turnScore;
                msg.textContent = `CPU banked ${yarkleState.turnScore}! CPU Total: ${yarkleState.aiScore}`;
                speak(`CPU banked ${yarkleState.turnScore} points. CPU total: ${yarkleState.aiScore}`);
                SoundFX.play('bank');
                renderYarkleDice();

                if (yarkleState.aiScore >= yarkleState.targetScore) {
                    SoundFX.play('lose');
                    speak('CPU wins!');
                    msg.textContent = `CPU WINS! Final score: You: ${yarkleState.totalScore} vs CPU: ${yarkleState.aiScore}`;
                    setTimeout(() => {
                        setAppState('MENU');
                    }, 5000);
                } else {
                    setTimeout(() => yarkleEndTurn(false), 6000);
                }
            }, 1000);
        } else {
            setTimeout(yarkleAITurn, 1500);
        }
    });
}

function initYarkle() {
    console.log('[YARKLE] initYarkle called, players:', appState.players);
    yarkleState.dice = [0, 0, 0, 0, 0, 0];
    yarkleState.held = [false, false, false, false, false, false];
    yarkleState.locked = [false, false, false, false, false, false];
    yarkleState.turnScore = 0;

    // Multiplayer Setup
    yarkleState.scores = [0, 0, 0, 0]; // P1-P4 scores
    yarkleState.totalScore = 0; // Legacy P1 score
    yarkleState.aiScore = 0;    // Legacy CPU score
    yarkleState.currentPlayer = 0; // Initialize before initiative roll

    yarkleState.rollCount = 0;
    yarkleState.hasRolled = false;

    // --- RANDOM START (NO INITIATIVE ROLL) ---
    const isSinglePlayer = (appState.players === 1);
    let startVal;

    if (isSinglePlayer) {
        // 50/50 chance for single player vs CPU
        startVal = Math.random() < 0.5; // boolean: true=Player
        speak(startVal ? "You go first!" : "CPU goes first!");
    } else {
        // Random player index
        startVal = Math.floor(Math.random() * appState.players);
        speak(`Player ${startVal + 1} goes first!`);
    }

    // Small delay for speech, then start
    setTimeout(() => {
        console.log('[YARKLE] Starting game, startVal:', startVal);
        // Determine Starting Player
        if (appState.players === 1) {
            yarkleState.isPlayerTurn = startVal; // boolean in 1-player mode
            yarkleState.currentPlayer = 0; // 0=Player, 1=CPU (simulated)
        } else {
            yarkleState.currentPlayer = startVal; // index 0-3
            yarkleState.isPlayerTurn = true; // Always player turn in multiplayer
        }

        clearSceneDice();

        // Initialize UI text
        renderYarkleDice(); 

        if (appState.players === 1) {
             if (yarkleState.isPlayerTurn) {
                document.getElementById('yarkle-message').textContent = 'Your turn - click ROLL';
                speak('Your turn! Click roll.');
            } else {
                document.getElementById('yarkle-message').textContent = "CPU's turn...";
                speak("CPU's turn");
                setTimeout(yarkleAITurn, 1000);
            }
        } else {
            // Multiplayer Start
            const pNum = yarkleState.currentPlayer + 1;
            document.getElementById('yarkle-message').textContent = `Player ${pNum}'s Turn`;
            speak(`Player ${pNum}'s turn! Click roll.`);
            setTimeout(() => refreshScanFocus(false), 50);
        }
    }, 1500);
}

// Yarkle event listeners - MOVED TO INLINE ONCLICK HANDLERS
// document.getElementById('yarkleRollBtn').addEventListener('click', () => { ... });
// document.getElementById('yarkleBankBtn').addEventListener('click', () => { ... });
// document.getElementById('yarklePauseBtn').addEventListener('click', () => setAppState('PAUSE'));

// ============================================
// FAHTZEE GAME ENGINE  
// ============================================
const fahtzeeState = {
    dice: [0, 0, 0, 0, 0], // 5 dice
    held: [false, false, false, false, false],
    rollsLeft: 3,
    round: 1,
    totalScore: 0,
    aiScore: 0,
    isPlayerTurn: true,
    upperBonus: false,
    aiUpperBonus: false,
    currentPlayer: 0, // 0-indexed current player
    playerScores: [0, 0, 0, 0], // Multiplayer scores
    scorecard: {
        // Upper section
        ones: null, twos: null, threes: null, fours: null, fives: null, sixes: null,
        // Lower section
        threeOfAKind: null, fourOfAKind: null, fullHouse: null,
        smallStraight: null, largeStraight: null, fahtzee: null, chance: null
    },
    aiScorecard: {
        ones: null, twos: null, threes: null, fours: null, fives: null, sixes: null,
        threeOfAKind: null, fourOfAKind: null, fullHouse: null,
        smallStraight: null, largeStraight: null, fahtzee: null, chance: null
    },
    fahtzeeBonus: 0,
    aiFahtzeeBonus: 0
};
window.fahtzeeState = fahtzeeState; // Expose for getFocusables

const FAHTZEE_CATEGORIES = {
    ones: { name: 'Ones', section: 'upper', calc: (d) => d.filter(v => v === 1).reduce((a, b) => a + b, 0) },
    twos: { name: 'Twos', section: 'upper', calc: (d) => d.filter(v => v === 2).reduce((a, b) => a + b, 0) },
    threes: { name: 'Threes', section: 'upper', calc: (d) => d.filter(v => v === 3).reduce((a, b) => a + b, 0) },
    fours: { name: 'Fours', section: 'upper', calc: (d) => d.filter(v => v === 4).reduce((a, b) => a + b, 0) },
    fives: { name: 'Fives', section: 'upper', calc: (d) => d.filter(v => v === 5).reduce((a, b) => a + b, 0) },
    sixes: { name: 'Sixes', section: 'upper', calc: (d) => d.filter(v => v === 6).reduce((a, b) => a + b, 0) },
    threeOfAKind: { name: 'Three of a Kind', section: 'lower', calc: (d) => {
        const counts = [0,0,0,0,0,0,0];
        d.forEach(v => counts[v]++);
        return counts.some(c => c >= 3) ? d.reduce((a, b) => a + b, 0) : 0;
    }},
    fourOfAKind: { name: 'Four of a Kind', section: 'lower', calc: (d) => {
        const counts = [0,0,0,0,0,0,0];
        d.forEach(v => counts[v]++);
        return counts.some(c => c >= 4) ? d.reduce((a, b) => a + b, 0) : 0;
    }},
    fullHouse: { name: 'Full House', section: 'lower', calc: (d) => {
        const counts = [0,0,0,0,0,0,0];
        d.forEach(v => counts[v]++);
        const vals = counts.filter(c => c > 0);
        return (vals.includes(3) && vals.includes(2)) ? 25 : 0;
    }},
    smallStraight: { name: 'Small Straight', section: 'lower', calc: (d) => {
        const unique = [...new Set(d)].sort().join('');
        return (unique.includes('1234') || unique.includes('2345') || unique.includes('3456')) ? 30 : 0;
    }},
    largeStraight: { name: 'Large Straight', section: 'lower', calc: (d) => {
        const sorted = [...d].sort().join('');
        return (sorted === '12345' || sorted === '23456') ? 40 : 0;
    }},
    fahtzee: { name: 'FAHTZEE', section: 'lower', calc: (d) => {
        const counts = [0,0,0,0,0,0,0];
        d.forEach(v => counts[v]++);
        return counts.some(c => c >= 5) ? 50 : 0;
    }},
    chance: { name: 'Chance', section: 'lower', calc: (d) => d.reduce((a, b) => a + b, 0) }
};

function renderFahtzeeDice() {
    console.log('[FAHTZEE] renderFahtzeeDice called, players:', appState.players, 'currentPlayer:', fahtzeeState.currentPlayer);
     // NOTE: DOM Elements for dice row were removed in favor of 3D overlay interaction.
     const row = document.getElementById('fahtzee-dice-row');
     if (row) {
         row.innerHTML = '';
     }

    document.getElementById('fahtzee-round').textContent = fahtzeeState.round;
    document.getElementById('fahtzee-rolls-left').textContent = fahtzeeState.rollsLeft;

    // Player score colors: Red, Blue, Green, Yellow
    const mpColors = ['#ff0000', '#0055ff', '#00aa00', '#eebd00'];

    if (appState.players === 1) {
        // 1P Mode Labels (YOU vs CPU)
        document.getElementById('fahtzee-score-p1').style.display = '';
        document.getElementById('fahtzee-score-cpu').style.display = '';
        document.getElementById('fahtzee-mp-scoreboard').style.display = 'none';

        document.getElementById('fahtzee-total-score').textContent = fahtzeeState.totalScore;
        document.getElementById('fahtzee-ai-score').textContent = fahtzeeState.aiScore;
        document.getElementById('fahtzee-turn-indicator').textContent = fahtzeeState.isPlayerTurn ? 'Your Turn' : "CPU's Turn";
        document.getElementById('fahtzee-turn-indicator').style.color = '';
    } else {
        // Multiplayer - Hide 1P elements, show scoreboard
        document.getElementById('fahtzee-score-p1').style.display = 'none';
        document.getElementById('fahtzee-score-cpu').style.display = 'none';

        const scoreboard = document.getElementById('fahtzee-mp-scoreboard');
        scoreboard.style.display = 'flex';
        scoreboard.innerHTML = '';

        for (let i = 0; i < appState.players; i++) {
            const isCurrentPlayer = (i === fahtzeeState.currentPlayer);
            const span = document.createElement('span');
            span.style.background = mpColors[i];
            span.style.padding = '3px 10px';
            span.style.borderRadius = '5px';
            span.style.border = isCurrentPlayer ? '2px solid #fff' : '2px solid transparent';
            span.style.fontWeight = isCurrentPlayer ? 'bold' : 'normal';
            span.innerHTML = `P${i+1}: <strong>${fahtzeeState.playerScores[i]}</strong>`;
            scoreboard.appendChild(span);
        }

        const pColor = mpColors[fahtzeeState.currentPlayer];
        const ind = document.getElementById('fahtzee-turn-indicator');
        if(ind) {
            ind.textContent = `Player ${fahtzeeState.currentPlayer + 1}'s Turn`;
            ind.style.color = pColor;
        }
    }

    // Update Overlays
    updateDiceOverlays();
}

function toggleFahtzeeHold(index) {
    if (fahtzeeState.rollsLeft === 3) {
        // Can't hold before first roll
        document.getElementById('fahtzee-message').textContent = 'Roll the dice first!';
        speak('Roll the dice first!');
        return;
    }
    fahtzeeState.held[index] = !fahtzeeState.held[index];
    SoundFX.play('select');
    if (fahtzeeState.held[index]) {
        speak(`Selected to keep ${fahtzeeState.dice[index]}`);
    }
    renderFahtzeeDice();
    updateDiceGlows();
}

function fahtzeeRoll() {
    if (fahtzeeState.rollsLeft <= 0) {
        document.getElementById('fahtzee-message').textContent = 'No rolls left! Choose a category.';
        speak('No rolls left! Choose a category.');
        return;
    }

    // Disable buttons during roll
    document.getElementById('fahtzeeRollBtn').disabled = true;
    document.getElementById('fahtzeeScoreBtn').disabled = true;

    const msg = document.getElementById('fahtzee-message');
    msg.textContent = 'Rolling...';
    speak('Rolling!');
    SoundFX.play('roll');

    // Logic Reversion: User expects standard "Highlight/Select to HOLD/KEEP".
    const heldData = [];
    const heldCounts = [0, 0, 0, 0, 0, 0, 0];
    
    // Check if this is the final roll to detect "bust" later
    const isFinalGamble = (fahtzeeState.rollsLeft === 1); 

    for (let i = 0; i < 5; i++) {
        if (fahtzeeState.held[i]) {
            heldData.push({ index: i, value: fahtzeeState.dice[i] });
            heldCounts[fahtzeeState.dice[i]]++;
        }
    }
    
    // Helper to calculate longest straight for bust check
    const longestSequence = (d) => {
        const unique = [...new Set(d)].sort((a,b)=>a-b);
        let max = 0, cur = 0, last = -1;
        unique.forEach(v => {
            if (v === last + 1) cur++;
            else cur = 1;
            last = v;
            max = Math.max(max, cur);
        });
        return max;
    };
    const heldSeq = longestSequence(heldData.map(d=>d.value));


    // Roll 3D dice
    throw3DDice(5, heldData, (results) => {
        for (let i = 0; i < 5; i++) {
            // Update only if NOT in heldData (meaning it rolled)
            // heldData contains indices that were KEPT.
            // So if i is NOT in heldData, it rolled.
            const wasKept = heldData.some(h => h.index === i);
            if (!wasKept) {
                fahtzeeState.dice[i] = results[i] || Math.floor(Math.random() * 6) + 1;
                // Also clear the selection (held state) for the rolled dice
                fahtzeeState.held[i] = false;
            }
        }
        fahtzeeState.rollsLeft--;

        // BUST CHECK logic for final roll
        if (isFinalGamble) {
            // Ensure we only bust if they HELD something (attempting a strategy)
            const wasHolding = heldData.length > 0;
            
            if (wasHolding) {
                let busted = true;
                const finalCounts = [0, 0, 0, 0, 0, 0, 0];
                fahtzeeState.dice.forEach(v => finalCounts[v]++);
                
                // 1. Check Set Continuation (freq increased)
                // If aiming for sets, the count of held numbers should go up
                for (let v = 1; v <= 6; v++) {
                    if (heldCounts[v] > 0 && finalCounts[v] > heldCounts[v]) {
                        busted = false;
                        console.log("Safe: Set continuation");
                        break;
                    }
                }
                
                // 2. Check Straight Continuation
                // If the straight sequence got longer
                if (busted) {
                    const finalSeq = longestSequence(fahtzeeState.dice);
                    // Only counts if we were already holding meaningful straight pieces (>=2)
                    // or if we just somehow got a straight 
                    if (finalSeq > heldSeq) {
                         busted = false;
                         console.log("Safe: Straight connection");
                    }
                }
                
                // 3. Combo Rescue (Lucky roll into a high value hand)
                if (busted) {
                    const maxC = Math.max(...finalCounts);
                    // Full House logic
                    const isFH = (finalCounts.includes(3) && finalCounts.includes(2));
                    const isSmall = longestSequence(fahtzeeState.dice) >= 4;
                    
                    if (maxC >= 3 || isFH || isSmall) {
                         busted = false;
                         console.log("Safe: Combo Rescue");
                    }
                }
                
                if (busted) {
                    SoundFX.play('lose');
                    speak('Busted! No improvement.');
                    
                    document.getElementById('fahtzee-message').textContent = 'BUSTED! Turn Score: 0';
                    setTimeout(() => {
                        // Force end turn with 0
                        alert("BUSTED! You didn't improve your hand on the final roll. Turn scores 0.");
                        
                        // Advance turn logic (Duplicated from selectFahtzeeCategory)
                        // In a cleaner refactor, advanceTurn would be a separate function.
                        if (appState.players > 1) {
                             fahtzeeState.playerScores[fahtzeeState.currentPlayer] = fahtzeeState.totalScore; // Unchanged
                             fahtzeeState.currentPlayer = (fahtzeeState.currentPlayer + 1) % appState.players;
                             fahtzeeState.dice = [0,0,0,0,0]; 
                             fahtzeeState.held = [false,false,false,false,false];
                             fahtzeeState.rollsLeft = 3;
                             loadPlayerScorecard(fahtzeeState.currentPlayer); // Reload next player
                             fahtzeeState.totalScore = fahtzeeState.playerScores[fahtzeeState.currentPlayer];
                             
                             renderFahtzeeDice();
                             const pNum = fahtzeeState.currentPlayer + 1;
                             document.getElementById('fahtzee-message').textContent = `Player ${pNum}'s Turn`;
                             speak(`Player ${pNum}'s turn!`);
                        } else {
                             // Single player: Move to AI
                             fahtzeeState.isPlayerTurn = false;
                             renderFahtzeeDice();
                             document.getElementById('fahtzee-message').textContent = "CPU's turn...";
                             setTimeout(fahtzeeAITurn, 2000);
                        }
                    }, 500);
                    return; // EXIT EARLY - Skip button re-enable
                }
            }
        }

        // Re-enable buttons
        document.getElementById('fahtzeeRollBtn').disabled = false;
        document.getElementById('fahtzeeScoreBtn').disabled = false;

        renderFahtzeeDice();

        // Reset scan index to start at first die
        appState.scanIndex = 0;


        // Highlight potential scoring dice logic (Simplified Rules)
        // Default: Hold the "best" dice, but allow user to change

        // Reset held only for newly affected dice if we want strictly standard rules,
        // but for "Simplified" we re-evaluate EVERYTHING.
        // However, users might be annoyed if we uncheck things they really wanted.
        // Compromise: Only apply auto-hold if they didn't manually lock anything?
        // No, simplified means "Help me every turn".

        const counts = [0, 0, 0, 0, 0, 0, 0];
        fahtzeeState.dice.forEach(v => counts[v]++);

        // Determine best keep strategy
        let bestMove = []; // indices to hold

        const hasSequence = (start, len) => {
            for (let i = start; i < start + len; i++) if (counts[i] === 0) return false;
            return true;
        };

        // 1. FAHTZEE (5 of a kind)
        if (Math.max(...counts) === 5) {
            bestMove = [0,1,2,3,4];
        }
        // 2. Large Straight (1-5 or 2-6)
        else if (hasSequence(1, 5) || hasSequence(2, 5)) {
             bestMove = [0,1,2,3,4];
        }
        // 3. Four of a Kind
        else if (Math.max(...counts) === 4) {
             const val = counts.findIndex(c => c === 4);
             fahtzeeState.dice.forEach((d, i) => { if(d === val) bestMove.push(i); });
        }
        // 4. Full House (3 + 2)
        else if (counts.includes(3) && counts.includes(2)) {
             bestMove = [0,1,2,3,4];
        }
        // 5. Small Straight (Sequence of 4)
        else if (hasSequence(1,4) || hasSequence(2,4) || hasSequence(3,4)) {
             // Find which sequence
             let seq = [];
             if(hasSequence(1,4)) seq = [1,2,3,4];
             else if(hasSequence(2,4)) seq = [2,3,4,5];
             else seq = [3,4,5,6];

             // Mark one of each value in sequence
             seq.forEach(val => {
                 const idx = fahtzeeState.dice.findIndex((d, i) => d === val && !bestMove.includes(i));
                 if(idx !== -1) bestMove.push(idx);
             });
        }
        // 6. Three of a kind
        else if (Math.max(...counts) === 3) {
             const val = counts.findIndex(c => c === 3);
             fahtzeeState.dice.forEach((d, i) => { if(d === val) bestMove.push(i); });
        }
        // 7. Pairs or High Match (Simplified "many of same dice")
        else {
             const max = Math.max(...counts);
             if (max >= 2) {
                 // Keep the highest value pair/set
                 let bestVal = 0;
                 for(let i=6; i>=1; i--) {
                     if(counts[i] === max) { bestVal = i; break; }
                 }
                 fahtzeeState.dice.forEach((d, i) => { if(d === bestVal) bestMove.push(i); });
             }
        }

        // Apply our "Helpful AI" suggestion
        // Only if rolls left > 0? No, even on last roll it helps to see what you got.
        // But specifically for rolling again:
        if (fahtzeeState.rollsLeft > 0) {
             fahtzeeState.held = [false, false, false, false, false];
             bestMove.forEach(i => fahtzeeState.held[i] = true);
        } else {
             // Keep held state in scoring phase too
             fahtzeeState.held = [false, false, false, false, false];
             bestMove.forEach(i => fahtzeeState.held[i] = true);
        }

        // Announce hand
        let handAnnouncement = "";
        const maxC = Math.max(...counts);

        if (maxC === 5) handAnnouncement = "Fahtzee!";
        else if (maxC === 4) handAnnouncement = "Four of a Kind";
        else if (counts.includes(3) && counts.includes(2)) handAnnouncement = "Full House";
        else if (hasSequence(1, 5) || hasSequence(2, 5)) handAnnouncement = "Large Straight";
        else if (hasSequence(1, 4) || hasSequence(2, 4) || hasSequence(3, 4)) handAnnouncement = "Small Straight";
        else if (maxC === 3) handAnnouncement = "Three of a Kind";
        else {
            const sum = fahtzeeState.dice.reduce((a,b)=>a+b, 0);
            handAnnouncement = sum.toString();
        }

        speak(handAnnouncement);

        updateDiceGlows();
    });
}

// Check for notable fahtzee combinations
function checkFahtzeePotential() {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    fahtzeeState.dice.forEach(v => counts[v]++);

    const maxCount = Math.max(...counts);

    if (maxCount === 5) {
        // SoundFX.play('fahtzee'); // Removed duplicate sound trigger
        return 'FAHTZEE!';
    }
    if (maxCount === 4) return 'Four of a kind!';
    if (maxCount === 3) {
        // Check for full house
        if (counts.includes(2)) return 'Full House potential!';
        return 'Three of a kind!';
    }
    // Check for straights
    const hasSequence = (start, len) => {
        for (let i = start; i < start + len; i++) {
            if (counts[i] === 0) return false;
        }
        return true;
    };
    if (hasSequence(1, 5) || hasSequence(2, 5)) return 'Large Straight!';
    if (hasSequence(1, 4) || hasSequence(2, 4) || hasSequence(3, 4)) return 'Small Straight potential!';

    return '';
}

// Highlight dice based on scoring potential
function highlightFahtzeeDice() {
     // Note: DOM-based highlights replaced by updateDiceOverlays() in game loop.
}

function showFahtzeeScorecard() {
    if (fahtzeeState.dice.every(d => d === 0)) {
        document.getElementById('fahtzee-message').textContent = 'Roll first!';
        return;
    }

    const container = document.getElementById('fahtzee-categories');
    container.innerHTML = '';

    // Upper section
    const upperHeader = document.createElement('div');
    upperHeader.style.cssText = 'color:#ffeb3b; font-weight:bold; margin:10px 0 5px 0;';
    upperHeader.textContent = '— UPPER SECTION —';
    container.appendChild(upperHeader);

    let upperTotal = 0;
    for (const key of ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']) {
        const cat = FAHTZEE_CATEGORIES[key];
        const div = document.createElement('div');
        div.className = 'fahtzee-cat';
        if (fahtzeeState.scorecard[key] !== null) {
            div.classList.add('used');
            upperTotal += fahtzeeState.scorecard[key];
            div.innerHTML = `<span>${cat.name}</span><span class="score">${fahtzeeState.scorecard[key]}</span>`;
        } else {
            const potential = cat.calc(fahtzeeState.dice);
            div.innerHTML = `<span>${cat.name}</span><span class="score">${potential}</span>`;
            div.onclick = () => selectFahtzeeCategory(key);
        }
        container.appendChild(div);
    }

    // Upper bonus display
    const bonusDiv = document.createElement('div');
    bonusDiv.style.cssText = 'color:#aaa; font-size:12px; padding:5px;';
    bonusDiv.textContent = `Upper Total: ${upperTotal}/63 ${upperTotal >= 63 ? '(+35 BONUS!)' : ''}`;
    container.appendChild(bonusDiv);

    // Lower section
    const lowerHeader = document.createElement('div');
    lowerHeader.style.cssText = 'color:#ffeb3b; font-weight:bold; margin:10px 0 5px 0;';
    lowerHeader.textContent = '— LOWER SECTION —';
    container.appendChild(lowerHeader);

    for (const key of ['threeOfAKind', 'fourOfAKind', 'fullHouse', 'smallStraight', 'largeStraight', 'fahtzee', 'chance']) {
        const cat = FAHTZEE_CATEGORIES[key];
        const div = document.createElement('div');
        div.className = 'fahtzee-cat';
        if (fahtzeeState.scorecard[key] !== null) {
            div.classList.add('used');
            div.innerHTML = `<span>${cat.name}</span><span class="score">${fahtzeeState.scorecard[key]}</span>`;
        } else {
            const potential = cat.calc(fahtzeeState.dice);
            div.innerHTML = `<span>${cat.name}</span><span class="score">${potential}</span>`;
            div.onclick = () => selectFahtzeeCategory(key);
        }
        container.appendChild(div);
    }

    document.getElementById('fahtzee-scorecard-overlay').classList.remove('hidden'); // We might not need this anymore if auto-scoring
    // appState.state = 'FAHTZEE_SCORE'; // Removed manual state switch for auto-score
    // appState.scanIndex = 0;
    // refreshScanFocus();
    // speak('Choose a scoring category'); // No longer needed
}

function selectFahtzeeCategory(key) {
    if (fahtzeeState.scorecard[key] !== null) return;

    const cat = FAHTZEE_CATEGORIES[key];
    const score = cat.calc(fahtzeeState.dice);
    fahtzeeState.scorecard[key] = score;

    // Sound and announcement
    if (key === 'fahtzee' && score === 50) {
        SoundFX.play('fahtzee');
        speak(`FAHTZEE! 50 points!`);
    } else if (score > 0) {
        SoundFX.play('score');
        speak(`Scored ${score} points in ${cat.name}`);
    } else {
        SoundFX.play('select');
        speak(`Scratched ${cat.name} for zero points`);
    }

    // Check for Fahtzee bonus
    if (key === 'fahtzee' && score === 50) {
        // First fahtzee
    } else if (fahtzeeState.scorecard.fahtzee === 50) {
        // Check if current roll is a fahtzee for bonus
        const counts = [0,0,0,0,0,0,0];
        fahtzeeState.dice.forEach(v => counts[v]++);
        if (counts.some(c => c >= 5)) {
            fahtzeeState.fahtzeeBonus += 100;
            SoundFX.play('fahtzee');
            speak('Fahtzee bonus! Plus 100 points!');
        }
    }

    // Calculate total
    let total = 0;
    let upperTotal = 0;
    for (const k in fahtzeeState.scorecard) {
        if (fahtzeeState.scorecard[k] !== null) {
            total += fahtzeeState.scorecard[k];
            if (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(k)) {
                upperTotal += fahtzeeState.scorecard[k];
            }
        }
    }
    if (upperTotal >= 63 && !fahtzeeState.upperBonus) {
        fahtzeeState.upperBonus = true;
        total += 35;
        SoundFX.play('score');
        speak('Upper section bonus! Plus 35 points!');
    }
    total += fahtzeeState.fahtzeeBonus;
    fahtzeeState.totalScore = total;

    document.getElementById('fahtzee-scorecard-overlay').classList.add('hidden'); // Ensure hidden
    appState.state = 'GAME'; // Ensure back to GAME state

    // Multiplayer State Handling
    if (appState.players > 1) {
        // Save current card to memory
        savePlayerScorecard(fahtzeeState.currentPlayer);
        fahtzeeState.playerScores[fahtzeeState.currentPlayer] = fahtzeeState.totalScore;

        setTimeout(() => {
            // End Turn / Switch Player
             // Reset dice and round data for next player
            fahtzeeState.dice = [0, 0, 0, 0, 0];
            fahtzeeState.held = [false, false, false, false, false];
            fahtzeeState.rollsLeft = 3;

            // Check if Game Over? (Everyone full?)
            // Just check current player's card for nulls
            const cardFull = Object.values(fahtzeeState.scorecard).every(v => v !== null);

            // Advance Turn
            fahtzeeState.currentPlayer = (fahtzeeState.currentPlayer + 1) % appState.players;

            // Load Next Player Card
            loadPlayerScorecard(fahtzeeState.currentPlayer);
            // Update totalScore view variable
            fahtzeeState.totalScore = fahtzeeState.playerScores[fahtzeeState.currentPlayer];

            // Check if ALL Players finished
            const nextCardFull = Object.values(fahtzeeState.scorecard).every(v => v !== null);
            if (nextCardFull) {
                 // Game Over
                SoundFX.play('win');
                speak('Game Over!');

                // Find Winner
                let maxScore = -1;
                let winners = [];
                fahtzeeState.playerScores.forEach((s, i) => {
                    if (s > maxScore) { maxScore = s; winners = [i+1]; }
                    else if (s === maxScore) winners.push(i+1);
                });

                const winMsg = `Winner: Player ${winners.join(' & ')} with ${maxScore} points!`;
                setTimeout(() => {
                    alert(winMsg);
                    setAppState('MENU');
                }, 1000);
                return;
            }

            renderFahtzeeDice();
            const pNum = fahtzeeState.currentPlayer + 1;
            document.getElementById('fahtzee-message').textContent = `Player ${pNum}'s Turn`;
            speak(`Player ${pNum}'s turn! Click roll.`);
            setTimeout(() => refreshScanFocus(false), 100);
        }, 3000);

    } else {
        // Single Player Logic (Player -> CPU)

        setTimeout(() => {
        // Check if game over (Player scorecard full)
        const gameOver = Object.values(fahtzeeState.scorecard).every(v => v !== null);

        if (gameOver) {
             // Game Over
            SoundFX.play('win');
            speak('Game Over!');
            let msg = "";
            if (fahtzeeState.totalScore > fahtzeeState.aiScore) msg = "You Win!";
            else if (fahtzeeState.aiScore > fahtzeeState.totalScore) msg = "CPU Wins!";
            else msg = "It's a tie!";

            setTimeout(() => {
                alert(`GAME OVER! ${msg} Final: You: ${fahtzeeState.totalScore} vs CPU: ${fahtzeeState.aiScore}`);
                setAppState('MENU');
            }, 1000);
            return;
        }

        // After player scores, CPU takes turn
        fahtzeeState.isPlayerTurn = false;
        renderFahtzeeDice();
        document.getElementById('fahtzee-message').textContent = "CPU's turn...";
        // speak("CPU's turn"); // Redundant if we just spoke the score
            setTimeout(fahtzeeAITurn, 2000);
        }, 3000);
    }
}

// Fahtzee AI logic
function fahtzeeAITurn() {
    const msg = document.getElementById('fahtzee-message');
    msg.textContent = 'CPU rolling...';
    SoundFX.play('roll');

    // Reset held for AI turn
    fahtzeeState.held = [false, false, false, false, false];

    // AI rolls all dice using 3D
    throw3DDice(5, [], (results) => {
        for (let i = 0; i < 5; i++) {
            fahtzeeState.dice[i] = results[i] || Math.floor(Math.random() * 6) + 1;
        }
        renderFahtzeeDice();
        msg.textContent = 'CPU rolled...';

        // Simple AI: roll up to 3 times, then pick best available category
        let rollsLeft = 2;

        function aiDecideAndRoll() {
            if (rollsLeft > 0) {
                // Hold dice that are part of potential scoring combos
                const counts = [0, 0, 0, 0, 0, 0, 0];
                fahtzeeState.dice.forEach(v => counts[v]++);

                // Find the most common value
                let maxCount = 0;
                let maxValue = 0;
                for (let i = 1; i <= 6; i++) {
                    if (counts[i] > maxCount) {
                        maxCount = counts[i];
                        maxValue = i;
                    }
                }

                // Hold dice matching the most common value
                if (maxCount >= 2) {
                    for (let i = 0; i < 5; i++) {
                        fahtzeeState.held[i] = (fahtzeeState.dice[i] === maxValue);
                    }
                }

                // Get held indices
                const heldData = [];
                for (let i = 0; i < 5; i++) {
                    if (fahtzeeState.held[i]) heldData.push({ index: i, value: fahtzeeState.dice[i] });
                }

                // Roll unheld dice using 3D
                throw3DDice(5, heldData, (results2) => {
                    for (let i = 0; i < 5; i++) {
                        if (!fahtzeeState.held[i]) {
                            fahtzeeState.dice[i] = results2[i] || Math.floor(Math.random() * 6) + 1;
                        }
                    }
                    rollsLeft--;
                    renderFahtzeeDice();

                    setTimeout(aiDecideAndRoll, 800);
                });
            } else {
                // Pick best category
                aiSelectCategory();
            }
        }

        setTimeout(aiDecideAndRoll, 800);
    });
}

function aiSelectCategory() {
    const msg = document.getElementById('fahtzee-message');

    // Priority list for breaking ties (same as player auto-score)
    const priorityOrder = [
        'fahtzee', 'fullHouse', 'largeStraight', 'smallStraight', 
        'fourOfAKind', 'threeOfAKind', 
        'sixes', 'fives', 'fours', 'threes', 'twos', 'ones', 
        'chance'
    ];

    // Find best available category
    let bestKey = null;
    let bestScore = -1;

    for (const key in fahtzeeState.aiScorecard) {
        if (fahtzeeState.aiScorecard[key] === null) {
            const cat = FAHTZEE_CATEGORIES[key];
            const score = cat.calc(fahtzeeState.dice);

            if (score > bestScore) {
                bestScore = score;
                bestKey = key;
            } else if (score === bestScore && score > 0) {
                // Tie-breaker
                 const oldIdx = priorityOrder.indexOf(bestKey);
                 const newIdx = priorityOrder.indexOf(key);
                 if (newIdx !== -1 && newIdx < oldIdx) {
                     bestKey = key;
                 }
            }
        }
    }

    // If no scoring options, pick first available (score 0)
    if (bestKey === null || bestScore === 0) {
        for (const key in fahtzeeState.aiScorecard) {
            if (fahtzeeState.aiScorecard[key] === null) {
                bestKey = key;
                bestScore = FAHTZEE_CATEGORIES[key].calc(fahtzeeState.dice);
                break;
            }
        }
    }

    if (bestKey) {
        fahtzeeState.aiScorecard[bestKey] = bestScore;
        msg.textContent = `CPU scored ${bestScore} in ${FAHTZEE_CATEGORIES[bestKey].name}`;
        speak(`CPU scored ${bestScore} in ${FAHTZEE_CATEGORIES[bestKey].name}`);

        if (bestKey === 'fahtzee' && bestScore === 50) {
            SoundFX.play('fahtzee');
        } else {
            SoundFX.play('score');
        }

        // Calculate AI total
        let total = 0;
        let upperTotal = 0;
        for (const k in fahtzeeState.aiScorecard) {
            if (fahtzeeState.aiScorecard[k] !== null) {
                total += fahtzeeState.aiScorecard[k];
                if (['ones', 'twos', 'threes', 'fours', 'fives', 'sixes'].includes(k)) {
                    upperTotal += fahtzeeState.aiScorecard[k];
                }
            }
        }
        if (upperTotal >= 63 && !fahtzeeState.aiUpperBonus) {
            fahtzeeState.aiUpperBonus = true;
            total += 35;
        }
        total += fahtzeeState.aiFahtzeeBonus;
        fahtzeeState.aiScore = total;
    }

    renderFahtzeeDice();

    // Check if game is over (both players have filled all 13)
    const playerFilled = Object.values(fahtzeeState.scorecard).every(v => v !== null);
    const aiFilled = Object.values(fahtzeeState.aiScorecard).every(v => v !== null);

    if (playerFilled && aiFilled) {
        setTimeout(() => {
            const winner = fahtzeeState.totalScore > fahtzeeState.aiScore ? 'YOU WIN!' : 
                           fahtzeeState.totalScore < fahtzeeState.aiScore ? 'CPU WINS!' : "IT'S A TIE!";

            if (fahtzeeState.totalScore > fahtzeeState.aiScore) {
                SoundFX.play('win');
                speak(`Game over! You win! ${fahtzeeState.totalScore} to ${fahtzeeState.aiScore}`);
            } else if (fahtzeeState.totalScore < fahtzeeState.aiScore) {
                SoundFX.play('lose');
                speak(`Game over! CPU wins. ${fahtzeeState.aiScore} to ${fahtzeeState.totalScore}`);
            } else {
                speak(`Game over! It's a tie at ${fahtzeeState.totalScore} points!`);
            }

            msg.textContent = `GAME OVER! ${winner} You: ${fahtzeeState.totalScore} | CPU: ${fahtzeeState.aiScore}`;
            setTimeout(() => {
                setAppState('MENU');
            }, 6000);
        }, 1000);
    } else {
        // Next round - player's turn
        fahtzeeState.round++;
        setTimeout(() => {
            fahtzeeState.dice = [0, 0, 0, 0, 0];
            fahtzeeState.held = [false, false, false, false, false];
            fahtzeeState.rollsLeft = 3;
            fahtzeeState.isPlayerTurn = true;
            renderFahtzeeDice();
            msg.textContent = `Round ${fahtzeeState.round} - Your turn! Click ROLL`;
            speak(`Round ${fahtzeeState.round}. Your turn!`);
        }, 5000);
    }
}

function initFahtzee() {
    console.log('[FAHTZEE] initFahtzee called, players:', appState.players);
    fahtzeeState.dice = [0, 0, 0, 0, 0];
    fahtzeeState.held = [false, false, false, false, false];
    fahtzeeState.rollsLeft = 3;
    fahtzeeState.round = 1;
    fahtzeeState.currentPlayer = 0; // Initialize before initiative roll

    // Multiplayer Setup
    // We need separate scorecards and bonus flags for each player
    fahtzeeState.playerScores = Array(appState.players).fill(0);
    fahtzeeState.playerScorecards = Array(appState.players).fill(null).map(() => {
         // Create clean scorecard object
         const card = {};
         const keys = Object.keys(fahtzeeState.scorecard || FAHTZEE_CATEGORIES);
         // Need keys. If fahtzeeState.scorecard is defined at init, grab keys.
         // FAHTZEE_CATEGORIES keys is safer.
         Object.keys(FAHTZEE_CATEGORIES).forEach(k => card[k] = null);
         return card;
    });
    fahtzeeState.playerBonus = Array(appState.players).fill(false);
    fahtzeeState.playerFahtzeeBonus = Array(appState.players).fill(0);

    // Legacy Single Player State (keep for compatibility or map to index 0/1)
    fahtzeeState.totalScore = 0;
    fahtzeeState.aiScore = 0;
    fahtzeeState.upperBonus = false;
    fahtzeeState.aiUpperBonus = false;
    fahtzeeState.fahtzeeBonus = 0;
    fahtzeeState.aiFahtzeeBonus = 0;

    // Reset "Main" scorecard used by active player UI logic
    for (const key in fahtzeeState.scorecard) fahtzeeState.scorecard[key] = null;
    for (const key in fahtzeeState.aiScorecard) fahtzeeState.aiScorecard[key] = null;

    // --- RANDOM START (NO INITIATIVE ROLL) ---
    const isSinglePlayer = (appState.players === 1);
    let startVal;

    if (isSinglePlayer) {
        // 50/50 chance for single player vs CPU
        startVal = Math.random() < 0.5; // boolean: true=Player
        speak(startVal ? "You go first!" : "CPU goes first!");
    } else {
        // Random player index
        startVal = Math.floor(Math.random() * appState.players);
        speak(`Player ${startVal + 1} goes first!`);
    }

    // Small delay for speech, then start
    setTimeout(() => {
        console.log('[FAHTZEE] Starting game, startVal:', startVal);
        // Determine Starting Player
        if (appState.players === 1) {
            fahtzeeState.currentPlayer = 0; // 0=Player, 1=CPU
            fahtzeeState.isPlayerTurn = startVal; // boolean
        } else {
            fahtzeeState.currentPlayer = startVal;
            fahtzeeState.isPlayerTurn = true; // Always true
        }

        clearSceneDice();
        renderFahtzeeDice();

         if (appState.players === 1) {
            if (fahtzeeState.isPlayerTurn) {
                document.getElementById('fahtzee-message').textContent = 'Click ROLL to start!';
                speak('Your turn! Click roll.');
            } else {
                document.getElementById('fahtzee-message').textContent = "CPU's turn...";
                speak("CPU's turn");
                setTimeout(fahtzeeAITurn, 1000);
            }
         } else {
             const pNum = fahtzeeState.currentPlayer + 1;
             document.getElementById('fahtzee-message').textContent = `Player ${pNum}'s Turn`;
            speak(`Player ${pNum}'s turn! Click roll.`);
            setTimeout(() => refreshScanFocus(false), 50);
         }

        // Load correct scorecard for first player
        loadPlayerScorecard(fahtzeeState.currentPlayer);
    }, 1500);
}

// Helper to swap active scorecard state
function loadPlayerScorecard(playerIdx) {
    // If Single Player Mode
    if (appState.players === 1) {
        // We use fahtzeeState.scorecard for Player and .aiScorecard for CPU
        // Logic updates normally based on isPlayerTurn flag
        return; 
    }

    // Multiplayer Mode
    // Swap the active "fahtzeeState.scorecard" object with the current player's data
    // This allows the rest of the UI code to work without change
    const savedCard = fahtzeeState.playerScorecards[playerIdx];
    // Copy values into reference
    for (const key in fahtzeeState.scorecard) {
        fahtzeeState.scorecard[key] = savedCard[key];
    }
}

// Helper to save current scorecard state
function savePlayerScorecard(playerIdx) {
     if (appState.players === 1) return;

     const currentCard = fahtzeeState.scorecard;
     const targetCard = fahtzeeState.playerScorecards[playerIdx];

     for (const key in currentCard) {
         targetCard[key] = currentCard[key];
     }
}

// Fahtzee event listeners - MOVED TO INLINE ONCLICK HANDLERS
// document.getElementById('fahtzeeRollBtn').addEventListener('click', ...);
// document.getElementById('fahtzeeScoreBtn').addEventListener('click', ...);
// document.getElementById('fahtzeePauseBtn').addEventListener('click', () => setAppState('PAUSE'));
// document.getElementById('fahtzee-cancel-score').addEventListener('click', ...);

// ============================================
// GLOBAL EXPORTS FOR HTML HANDLERS
// ============================================
window.playerYarkleRoll = () => {
    if (typeof yarkleState !== 'undefined' && !yarkleState.isPlayerTurn) return; 
    yarkleRoll();
};
window.playerYarkleBank = () => {
    if (typeof yarkleState !== 'undefined' && !yarkleState.isPlayerTurn) return;
    yarkleBank();
};
window.playerFahtzeeRoll = () => {
    if (typeof fahtzeeState !== 'undefined' && !fahtzeeState.isPlayerTurn) return;
    fahtzeeRoll();
};
window.playerFahtzeeScore = () => {
     // AUTO-SCORE LOGIC REPLACEMENT
     if (typeof fahtzeeState !== 'undefined' && !fahtzeeState.isPlayerTurn) return;

     // Reuse AI Logic to find best score
     const priorityOrder = [
        'fahtzee', 'fullHouse', 'largeStraight', 'smallStraight', 
        'fourOfAKind', 'threeOfAKind', 
        'sixes', 'fives', 'fours', 'threes', 'twos', 'ones', 
        'chance'
     ];

     let bestKey = null;
     let bestScore = -1;

     // 1. Find Max Score across all open categories
    for (const key in fahtzeeState.scorecard) {
        if (fahtzeeState.scorecard[key] === null) {
            const cat = FAHTZEE_CATEGORIES[key];
            const score = cat.calc(fahtzeeState.dice);

            if (score > bestScore) {
                bestScore = score;
                bestKey = key;
            } else if (score === bestScore && score > 0) {
                // Tie-breaker: Use priority order
                // If new key has LOWER index in priority list (higher priority), take it.
                // But wait, bestKey might not be in the list? (It should be)
                const oldIdx = priorityOrder.indexOf(bestKey);
                const newIdx = priorityOrder.indexOf(key);
                if (newIdx !== -1 && newIdx < oldIdx) {
                    bestKey = key;
                }
            }
        }
    }

    // 2. If all remaining categories score 0, must sacrifice one
    if (bestKey === null || bestScore === 0) {
         // Prioritize sacrificing lower section hard ones (Fahtzee, Large Straight) 
         // over easy ones (Chance, Ones) if they are 0.
         // Simple logic: just pick the first available one for now as "best of bad options"
         for (const key in fahtzeeState.scorecard) {
            if (fahtzeeState.scorecard[key] === null) {
                bestKey = key;
                bestScore = FAHTZEE_CATEGORIES[key].calc(fahtzeeState.dice); // Likely 0
                break;
            }
        }
    }

    if (bestKey) {
        const catName = FAHTZEE_CATEGORIES[bestKey].name;
        selectFahtzeeCategory(bestKey); // Reuse existing scoring function

        // Override the message/speech since selectFahtzeeCategory is designed for Click-UI
        // (Actually selectFahtzeeCategory handles speech well, but we might want to emphasize it was auto-picked)
        const msg = `Auto-scored: ${catName} (${bestScore} pts)`;
        document.getElementById('fahtzee-message').textContent = msg;
        // Speak is already called inside selectFahtzeeCategory, so we are good.
    }
};
window.closeFahtzeeScorecard = () => {
    document.getElementById('fahtzee-scorecard-overlay').classList.add('hidden');
};

// GAME INITIALIZATION ON MODE CHANGE
window.initGameMode = function(mode) {
    if (mode === 'Yarkle') {
        initYarkle();
    } else if (mode === 'Fahtzee') {
        initFahtzee();
    }
};

// Stop all game loops and sounds
window.stopAllGameLogic = function() {
    // Stop background music if any
    // Stop specific game intervals

    // Note: We rely on "guard clauses" in async functions (setTimeout callbacks)
    // checking if (appState.state === 'GAME') to abort execution.
    // But we can also clear scene.
    clearSceneDice();

    // Reset scan focus
    focusedDieIndex = -1;
    updateDiceGlows();

    // Reset specific game states to prevent "zombie" logic
    if (typeof yarkleState !== 'undefined') {
        yarkleState.isPlayerTurn = false; // Stop accepting input
    }
    if (typeof fahtzeeState !== 'undefined') {
        fahtzeeState.isPlayerTurn = false;
    }
};

// --- Physics Loop Fix (Matches Basketball Shooter) ---
const clock = new THREE.Clock();
let physicsAccumulator = 0;
const TIME_STEP = 1 / 60;
const GAME_SPEED = 1.6; // Speed up the physics by 60% relative to "Real Time" to counter floaty scale

function animate() {
    try {
    requestAnimationFrame(animate);

    const dt = clock.getDelta();
    // Multiply by GAME_SPEED so the accumulator fills up faster -> more world steps per real second
    const frameTime = Math.min(dt, 0.1) * GAME_SPEED;

    // Update Dice Overlays
    updateDiceOverlays();

    // Only update physics if in GAME mode (Pause freezes simulation)
    if (appState.state === 'GAME') {
        
        physicsAccumulator += frameTime;
        while (physicsAccumulator >= TIME_STEP) {
            world.step(TIME_STEP);
            physicsAccumulator -= TIME_STEP;
        }

        diceObjects.forEach(obj => {
            obj.mesh.position.copy(obj.body.position);
            obj.mesh.quaternion.copy(obj.body.quaternion);

            if(obj.body.position.y < -10) {
                obj.body.position.set(0, 10, 0);
                obj.body.velocity.set(0,0,0);
            }
        });
    }

    renderer.render(scene, camera);
    } catch(e) { console.error("Animate Error:", e); }
}

function handleResize() {
    if (!gameArea) return;
    // Force display check
    const width = gameArea.clientWidth;
    const height = gameArea.clientHeight;
    if(width === 0 || height === 0) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
}

window.addEventListener('resize', handleResize);

// --- 3D Dice Highlight System ---
// focusedDieIndex and originalDieColors are declared at top of script

function saveDieOriginalColors(dieIndex) {
    const obj = diceObjects[dieIndex];
    if (!obj || !obj.mesh) return;
    if (originalDieColors.has(dieIndex)) return; // Already saved

    const materials = Array.isArray(obj.mesh.material) ? obj.mesh.material : [obj.mesh.material];
    const colors = materials.map(mat => mat && mat.color ? mat.color.getHex() : 0xffffff);
    originalDieColors.set(dieIndex, colors);
}

function setDieHighlight(dieIndex, highlightColor, emissiveColor, emissiveIntensity) {
    const obj = diceObjects[dieIndex];
    if (!obj || !obj.mesh) return;

    // Save original colors first time
    saveDieOriginalColors(dieIndex);

    const materials = Array.isArray(obj.mesh.material) ? obj.mesh.material : [obj.mesh.material];
    materials.forEach((mat, idx) => {
        if (!mat) return;

        // Change the base color of the die
        if (mat.color && highlightColor !== null) {
            mat.color.set(highlightColor);
        }

        // Also apply emissive for extra glow effect
        if (mat.emissive) {
            mat.emissive.set(emissiveColor);
            mat.emissiveIntensity = emissiveIntensity;
        }
    });
}

function restoreDieColor(dieIndex) {
    const obj = diceObjects[dieIndex];
    if (!obj || !obj.mesh) return;

    const savedColors = originalDieColors.get(dieIndex);
    if (!savedColors) return;

    const materials = Array.isArray(obj.mesh.material) ? obj.mesh.material : [obj.mesh.material];
    materials.forEach((mat, idx) => {
        if (!mat) return;
        if (mat.color && savedColors[idx] !== undefined) {
            mat.color.set(savedColors[idx]);
        }
        if (mat.emissive) {
            mat.emissive.set(0x000000);
            mat.emissiveIntensity = 0;
        }
    });
}

function clearAllDiceGlow() {
    diceObjects.forEach((obj, i) => {
        restoreDieColor(i);
    });
}

updateDiceGlows = function() {
    // Update highlight states for all dice based on game state and focus
    diceObjects.forEach((obj, i) => {
        if (!obj || !obj.mesh) return;

        const logicalIndex = obj.mesh.userData.originalIndex;
        let isSelected = false;
        let isLocked = false;
        let isFocused = (focusedDieIndex === i);

        // Check game mode states
        if (appState.gameMode === 'Yarkle' && typeof yarkleState !== 'undefined' && logicalIndex !== undefined) {
            if (yarkleState.held[logicalIndex]) isSelected = true;
            if (yarkleState.locked[logicalIndex]) { isLocked = true; isSelected = false; }
        } else if (appState.gameMode === 'Fahtzee' && typeof fahtzeeState !== 'undefined' && logicalIndex !== undefined) {
            if (fahtzeeState.held[logicalIndex]) isSelected = true;
        }

        // Apply appropriate highlight - changes the entire die color!
        // Priority: locked > (selected+focused combo) > selected > focused > normal
        if (isLocked) {
            // Locked: Dark gray die
            setDieHighlight(i, 0x555555, 0x222222, 0.2);
        } else if (isSelected && isFocused) {
            // Selected AND focused: Bright green to show both states
            setDieHighlight(i, 0x00ff88, 0x88ffbb, 1.2);
        } else if (isSelected) {
            // Held: Bright yellow/gold die
            setDieHighlight(i, 0xffd700, 0xffeb3b, 0.8);
        } else if (isFocused) {
            // Focused/Scanned: Bright cyan/blue die
            setDieHighlight(i, 0x00bfff, 0x4fc3f7, 0.9);
        } else {
            // Normal: Restore original color
            restoreDieColor(i);
        }
    });
}

// --- Dice Overlay System (Invisible Hitboxes for Accessibility) ---
function updateDiceOverlays() {
    const container = document.getElementById('dice-overlays');

    // Container doesn't intercept clicks
    container.style.pointerEvents = 'none';

    if (appState.state !== 'GAME') {
        container.innerHTML = '';
        focusedDieIndex = -1;
        return;
    }

    // Force rebuild if count mismatches
    if (container.children.length !== diceObjects.length) {
        container.innerHTML = '';
        diceObjects.forEach((obj, i) => {
            const div = document.createElement('div');
            div.style.position = 'absolute';
            div.style.width = '100px'; 
            div.style.height = '100px';
            div.style.transform = 'translate(-50%, -50%)'; 
            div.style.borderRadius = '50%';
            div.style.cursor = 'pointer';
            div.style.zIndex = '50';
            div.style.pointerEvents = 'auto';
            // INVISIBLE - no border, no background
            div.style.border = 'none'; 
            div.style.backgroundColor = 'transparent';
            div.setAttribute('data-scan', 'true');
            div.role = "button"; 
            div.tabIndex = 0;
            div.setAttribute('aria-label', `Die ${i+1}`); 
            div.id = `die-overlay-${i}`;

            // Click handler
            div.onclick = (e) => { 
                e.stopPropagation(); 
                handleDieClick(i); 
            };

            // Keyboard handler for scan selection
            div.onkeydown = (e) => { 
                if (e.key === 'Enter' || e.key === ' ' || e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter') { 
                   e.stopPropagation(); 
                   e.preventDefault(); 
                   handleDieClick(i); 
                }
            };

            // Focus/blur to track which die is scanned
            div.onfocus = () => {
                focusedDieIndex = i;
                updateDiceGlows();
                // Announce the die value
                const val = readDieValueGeneric(diceObjects[i]);
                if (window.NarbeVoiceManager) {
                    window.NarbeVoiceManager.speak(`Die ${i+1}, Value ${val}`);
                }
            };
            div.onblur = () => {
                if (focusedDieIndex === i) {
                    focusedDieIndex = -1;
                    updateDiceGlows();
                }
            };

            // Mouse hover also highlights
            div.onmouseenter = () => {
                focusedDieIndex = i;
                updateDiceGlows();
            };
            div.onmouseleave = () => {
                if (focusedDieIndex === i) {
                    focusedDieIndex = -1;
                    updateDiceGlows();
                }
            };

            container.appendChild(div);
        });
    }

    // Update positions and labels
    diceObjects.forEach((obj, i) => {
        const div = container.children[i];
        if (!div || !obj.mesh) return;

        // Project 3D position to 2D screen
        const pos = obj.mesh.position.clone();
        pos.project(camera);

        const x = (pos.x * 0.5 + 0.5) * container.clientWidth;
        const y = (-pos.y * 0.5 + 0.5) * container.clientHeight;

        // Hide if behind camera
        if (pos.z > 1) {
           div.style.display = 'none';
        } else {
           div.style.display = 'block';
           div.style.left = `${x}px`;
           div.style.top = `${y}px`;

           // Check lock state
           const logicalIndex = obj.mesh.userData.originalIndex;
           let isLocked = false;
           let isSelected = false;

           if (appState.gameMode === 'Yarkle' && typeof yarkleState !== 'undefined' && logicalIndex !== undefined) {
               if (yarkleState.held[logicalIndex]) isSelected = true;
               if (yarkleState.locked[logicalIndex]) isLocked = true;
               // Yarkle Special Rule: Dice cannot be manually held via click (Auto-hold only)
               if (appState.gameMode === 'Yarkle') isLocked = true; // Use locked state to prevent click
           } else if (appState.gameMode === 'Fahtzee' && typeof fahtzeeState !== 'undefined' && logicalIndex !== undefined) {
               if (fahtzeeState.held[logicalIndex]) isSelected = true;
               // In Fahtzee, disable clicks if not player turn
               if (!fahtzeeState.isPlayerTurn) isLocked = true; 
           }

           // Locked dice can't be clicked
           div.style.pointerEvents = isLocked ? 'none' : 'auto';

           // Dynamic label update
           const val = readDieValueGeneric(obj);
           // Logic Update: Selection now means Rolling in Fahtzee
           const selectionLabel = (appState.gameMode === 'Fahtzee') ? "Rolling" : "Held";
           const selSuffix = isSelected ? `, ${selectionLabel}` : "";

           div.setAttribute('aria-label', `Die ${i+1}: Value ${val}${selSuffix}${isLocked ? ", Locked" : ""}`);
           div.title = `Die ${i+1}: Value ${val} ${isSelected ? "("+selectionLabel.toUpperCase()+")" : (isLocked ? "(LOCKED)" : "")}`;
        }
    });

    // Update 3D glows
    updateDiceGlows();
}

function handleDieClick(index) {
     // We passed 'i' which is the index in diceObjects array.
     // We need the LOGICAL index for game state!
     const obj = diceObjects[index];
     if(!obj) return;
     const logicalIndex = obj.mesh.userData.originalIndex;
     if (logicalIndex === undefined) return;

    if (appState.gameMode === 'Yarkle') {
        // Disabled manual hold in Yarkle - Auto score only
        // toggleYarkleHold(logicalIndex); 
    } else if (appState.gameMode === 'Fahtzee') {
        if (typeof fahtzeeState !== 'undefined' && fahtzeeState.isPlayerTurn) {
             toggleFahtzeeHold(logicalIndex);
        }
    }

    // Update glows immediately after state change
    updateDiceGlows();
}

// Start animation loop
animate();