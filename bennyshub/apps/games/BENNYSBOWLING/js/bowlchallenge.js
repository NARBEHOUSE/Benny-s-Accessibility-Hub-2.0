const CAMERA_FOV = 50.0;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 10.0;

const FRAME_ROLL_TIME = 3.0;

const GRAB_BALL_THRESHOLD_INCH = 0.05;
const GRAB_BALL_THRESHOLD_INCH_SQUARED = GRAB_BALL_THRESHOLD_INCH * GRAB_BALL_THRESHOLD_INCH;
const GRAB_BALL_ROLL_POS_RATIO = Math.tan(BALL_ANGLE_MAX);

const TRACK_DISTANCE = TRACK_WIDTH + 0.1;

const IMITATION_EMERGING_TIME_MIN = 2.0;
const IMITATION_EMERGING_TIME_MAX = 10.0;
const IMITATION_THROW_TIME_MIN = 3.5;
const IMITATION_THROW_TIME_MAX = 7.0;
const IMITATION_THROW_POSITION_MAX = 0.3;
const IMITATION_THROW_ANGLE_MAX = Math.PI / 18.0;
const CHARGE_TIME_MAX = 3.0; // seconds for max charge
const CHARGE_POWER_CURVE = 2.5; // >1 makes long holds much stronger vs short taps

var container, scene, camera, clock, renderer, ppi;
var ambientLight = null, dirLight = null; // global lights for theming
var pauseUIButton = null; // clickable pause button for mouse users
var themeEnv = null; // environment meshes (floor, walls, backdrop)
var touchPoint, raycaster, pickPoint, dragPoint, releaseVector, pickSphere;
var trackProtoMesh, ballProtoMesh, pinProtoMesh;
var players, imitations, scoresDiv;
var chargeBar, chargeFill; // UI for charge power

// Add concise help tips overlay
var helpTipsDiv = null;

var imitationPlayerId = 0;
var pickingBall = false;
var positioningBall = false;
var rollingBall = false;
var pickX = 0.0;
var pickY = 0.0;
var pickOffset = 0.0;
var pickTime = 0;

// Keyboard control: spacebar hold toggles left/right lane positioning
var spaceHeld = false;           // whether Space is currently held
var spaceNextDir = 1;            // next direction on hold start: 1 = to right, -1 = to left
var spaceHoldDir = 1;            // direction for the current hold
var spaceStartTime = 0.0;        // time when current hold started (seconds)
var spacePhase = 0.0;            // phase so that oscillation starts from current position

// Aiming state
var aimingMode = false;          // true when in aiming mode
var aimHeld = false;             // whether Space is held for aiming oscillation
var aimNextDir = 1;              // next direction for aiming oscillation
var aimHoldDir = 1;              // direction for the current aiming hold
var aimStartTime = 0.0;          // time when aiming space hold started
var aimPhase = 0.0;              // phase for aim oscillation to avoid snapping
var currentAimAngle = 0.0;       // last/active aim angle in radians
var charging = false;            // charging throw with Enter held
var chargeStartTime = 0.0;       // when Enter was pressed to charge

// Game state, menu and settings
var gameState = 'menu';          // 'menu' | 'playing' | 'paused'
var mainMenuDiv = null;          // main menu overlay
var settingsDiv = null;          // settings overlay
var pauseMenuDiv = null;         // pause menu overlay
var gameOverDiv = null;          // game over overlay
var celebrationDiv = null;       // strike celebration overlay
var celebrationHideTimer = null; // timeout handle for hiding celebration
var musicEl = null;              // background music element (optional)
var ambientEl = null;            // ambient bowling background loop
var SFX_ENABLED = true;          // reflects settings.sfx but cached for quick checks

function playSfx(src, volume) {
	try {
		if (!SFX_ENABLED) return;
        // Use NarbeAudioHelper for solid iOS support if available
        if (window.NarbeAudioHelper && window.NarbeAudioHelper.play) {
            window.NarbeAudioHelper.play(src, (typeof volume === 'number') ? volume : 1.0);
            return;
        }
        // Fallback for older browsers
		var a = new Audio(src);
		a.volume = (typeof volume === 'number') ? Math.max(0, Math.min(1, volume)) : 1.0;
		a.play().catch(function(){});
	} catch(e) {}
}

var ambientController = null;

function ensureAmbient() {
	if (!ambientEl && !window.NarbeAudioHelper) {
		try {
			// Fallback for non-iOS or older environments
			ambientEl = new Audio('sound/bowling-bg.wav');
			ambientEl.loop = true;
			ambientEl.volume = 0.3;
		} catch(e) { ambientEl = null; }
	}
}

function startAmbient() {
	if (window.NarbeAudioHelper && window.NarbeAudioHelper.playLoop) {
		if (!ambientController) {
			ambientController = window.NarbeAudioHelper.playLoop('sound/bowling-bg.wav', 0.3);
		}
	} else {
		try { ensureAmbient(); if (ambientEl) ambientEl.play().catch(function(){}); } catch(e) {}
	}
}
function stopAmbient() {
	if (ambientController) {
		ambientController.stop();
		ambientController = null;
	}
	try { if (ambientEl) { ambientEl.pause(); ambientEl.currentTime = 0; } } catch(e) {}
}
var settings = {
	music: false,
	sfx: true,
	ballStyleIndex: 0,
	themeIndex: 0,
	// Aimer color selection (0..5); default 2 = green
	aimerColorIndex: 2
};
// TTS and voice settings now managed entirely by NarbeVoiceManager
// Track if user has interacted (required for audio autoplay on HTTPS)
var userHasInteracted = false;

// Ball skins: name + preview + apply function
var BALL_SKINS = []; // will be filled by buildBallSkins()
var THEMES = [];

// Aimer color presets
var AIM_COLORS = [
	{ name: 'White',  hex: 0xffffff },
	{ name: 'Blue',   hex: 0x3399ff },
	{ name: 'Green',  hex: 0x00ff66 },
	{ name: 'Yellow', hex: 0xffff66 },
	{ name: 'Red',    hex: 0xff5555 },
	{ name: 'Orange', hex: 0xffaa33 }
];

function buildThemes() {
	// Helper to make a vertical gradient texture
	function gradientTex(top, bottom) {
		var c = document.createElement('canvas'); c.width = 2; c.height = 256;
		var g = c.getContext('2d').createLinearGradient(0,0,0,256);
		g.addColorStop(0, top); g.addColorStop(1, bottom);
		var ctx = c.getContext('2d'); ctx.fillStyle = g; ctx.fillRect(0,0,2,256);
		var tex = new THREE.CanvasTexture(c); tex.needsUpdate = true; tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipMapLinearFilter; tex.wrapS = THREE.ClampToEdgeWrapping; tex.wrapT = THREE.ClampToEdgeWrapping; return tex;
	}

	// Simple canvas texture helpers for floors/walls/backdrops
	function makeCanvas(w,h,draw){ var c=document.createElement('canvas'); c.width=w; c.height=h; var x=c.getContext('2d'); draw(x,w,h); return c; }
	function texFromCanvas(c){ var t=new THREE.CanvasTexture(c); t.needsUpdate=true; t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(1,1); return t; }
	function woodPlanks(){ return texFromCanvas(makeCanvas(512,512,function(ctx,w,h){ ctx.fillStyle='#8b5a2b'; ctx.fillRect(0,0,w,h); for(var y=0;y<h;y+=32){ ctx.fillStyle= (y/32)%2? '#7a4f26':'#6d4522'; ctx.fillRect(0,y,w,32); ctx.strokeStyle='rgba(0,0,0,0.2)'; ctx.lineWidth=2; ctx.beginPath(); for(var x=0;x<w;x+=64){ ctx.moveTo(x,y); ctx.lineTo(x,y+32);} ctx.stroke(); } })); }
	function neonGrid(bg, line){ return texFromCanvas(makeCanvas(512,512,function(ctx,w,h){ ctx.fillStyle=bg; ctx.fillRect(0,0,w,h); ctx.strokeStyle=line; ctx.shadowColor=line; ctx.shadowBlur=6; ctx.lineWidth=1.5; for(var i=0;i<=w;i+=32){ ctx.beginPath(); ctx.moveTo(i,0); ctx.lineTo(i,h); ctx.stroke(); } for(var j=0;j<=h;j+=32){ ctx.beginPath(); ctx.moveTo(0,j); ctx.lineTo(w,j); ctx.stroke(); } })); }
	function sandTexture(){ return texFromCanvas(makeCanvas(512,512,function(ctx,w,h){ for(var y=0;y<h;y++){ var hue=40+Math.random()*2; var sat=60+Math.random()*10; var light=70+Math.random()*6; ctx.fillStyle='hsl('+hue+','+sat+'%,'+light+'%)'; ctx.fillRect(0,y,w,1);} for(var i=0;i<1600;i++){ var x=Math.random()*w, y=Math.random()*h, r=Math.random()*1.2; ctx.fillStyle='rgba(0,0,0,0.06)'; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); } })); }
	function oceanBackdrop(){ return texFromCanvas(makeCanvas(1024,512,function(ctx,w,h){ var g=ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,'#9bd3ff'); g.addColorStop(0.55,'#9bd3ff'); g.addColorStop(0.56,'#2e7bb8'); g.addColorStop(1,'#0c3f66'); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); // sun
		ctx.fillStyle='rgba(255,255,200,0.9)'; ctx.beginPath(); ctx.arc(w*0.75,h*0.2,30,0,Math.PI*2); ctx.fill(); // horizon sparkle
		ctx.strokeStyle='rgba(255,255,255,0.35)'; ctx.lineWidth=1; for(var i=0;i<60;i++){ var y=h*0.56 + i*4; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
	})); }
	function snowTexture(){ return texFromCanvas(makeCanvas(512,512,function(ctx,w,h){ var grd=ctx.createLinearGradient(0,0,0,h); grd.addColorStop(0,'#f7fbff'); grd.addColorStop(1,'#dbe9f6'); ctx.fillStyle=grd; ctx.fillRect(0,0,w,h); ctx.fillStyle='rgba(255,255,255,0.6)'; for(var i=0;i<800;i++){ var x=Math.random()*w, y=Math.random()*h, r=Math.random()*1.5; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); } })); }
	function lavaTexture(){ return texFromCanvas(makeCanvas(512,512,function(ctx,w,h){ ctx.fillStyle='#220000'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='#ff3300'; ctx.lineWidth=3; ctx.shadowColor='#ff5500'; ctx.shadowBlur=8; for(var i=0;i<100;i++){ ctx.beginPath(); var x=Math.random()*w, y=Math.random()*h, len=20+Math.random()*120; ctx.moveTo(x,y); ctx.bezierCurveTo(x+len*0.2,y+len*0.1,x-len*0.3,y+len*0.4,x+len*0.5,y+len*0.6); ctx.stroke(); } })); }
	function starBackdrop(){ return texFromCanvas(makeCanvas(1024,512,function(ctx,w,h){ ctx.fillStyle='#020214'; ctx.fillRect(0,0,w,h); ctx.fillStyle='#fff'; for(var i=0;i<800;i++){ var x=Math.random()*w, y=Math.random()*h, r=Math.random()*1.5; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill(); } })); }
	function auroraBackdrop(){ return texFromCanvas(makeCanvas(1024,512,function(ctx,w,h){ var g=ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,'#081a3a'); g.addColorStop(1,'#083b42'); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); var bands=['#64ffda','#aaffee','#77ff88']; for(var b=0;b<bands.length;b++){ ctx.fillStyle=bands[b]; ctx.globalAlpha=0.18; ctx.beginPath(); ctx.ellipse(w*0.4+b*120,h*0.3+b*30,220,60,0,0,Math.PI*2); ctx.fill(); } ctx.globalAlpha=1; })); }
	function sunsetBackdrop(){ return texFromCanvas(makeCanvas(1024,512,function(ctx,w,h){ var g=ctx.createLinearGradient(0,0,0,h); g.addColorStop(0,'#ff7e5f'); g.addColorStop(1,'#2a2a72'); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); })); }

	function ensureThemeEnvironment(){
		if (themeEnv) return themeEnv;
		var group = new THREE.Group(); group.name = 'ThemeEnvironment';
		// Dimensions
		var laneWidth = (typeof LANE_WIDTH !== 'undefined' ? LANE_WIDTH : 1.06);
		var laneHalf = 0.5 * laneWidth;
		var gutterWidth = (typeof GUTTER_WIDTH !== 'undefined' ? GUTTER_WIDTH : 0.24);
		var gutterHalf = 0.5 * gutterWidth;
		var floorLen = (typeof LANE_LENGTH !== 'undefined' ? LANE_LENGTH : 10.0) + 4.0;
		var zMid = (typeof LANE_MID_Z !== 'undefined' ? LANE_MID_Z : 0);
		// Drop the visual floors a bit further so the ball never appears to clip through them
		var visualClear = 0.06; // 6cm down for safe visual clearance
		var laneY = (typeof BASE_HEIGHT !== 'undefined' ? BASE_HEIGHT : 0) - visualClear; // clearly below lane top
		var gutterY = (typeof BOTTOM_HEIGHT !== 'undefined' ? BOTTOM_HEIGHT : -0.05) - visualClear; // clearly below gutter bottom

		// Three floor strips: center under lane (at laneY), sides under gutters (at gutterY)
		var floorCenter = new THREE.Mesh(
			new THREE.PlaneGeometry(laneWidth, floorLen),
			new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.0 })
		);
		floorCenter.rotation.x = -Math.PI/2; floorCenter.position.set(0, laneY, zMid); group.add(floorCenter);

		var floorLeft = new THREE.Mesh(
			new THREE.PlaneGeometry(gutterWidth, floorLen),
			new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.0 })
		);
		floorLeft.rotation.x = -Math.PI/2; floorLeft.position.set(-(laneHalf + gutterHalf), gutterY, zMid); group.add(floorLeft);

		var floorRight = new THREE.Mesh(
			new THREE.PlaneGeometry(gutterWidth, floorLen),
			new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.9, metalness: 0.0 })
		);
		floorRight.rotation.x = -Math.PI/2; floorRight.position.set(+(laneHalf + gutterHalf), gutterY, zMid); group.add(floorRight);

		var wallWidth = (typeof TRACK_WIDTH !== 'undefined' ? TRACK_WIDTH : (laneWidth + 2*gutterWidth)) * 3.0;
		var wallHeight = 3.0;
		var backGeo = new THREE.PlaneGeometry(wallWidth, wallHeight);
		var backMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.0 });
	var backWallZ = (typeof LANE_END_Z !== 'undefined' ? LANE_END_Z : -1.0) - 0.5;
	var backWall = new THREE.Mesh(backGeo, backMat); backWall.position.set(0, (typeof BASE_HEIGHT !== 'undefined' ? BASE_HEIGHT : 0)+wallHeight*0.5, backWallZ); group.add(backWall);

		// Side walls
		var sideLen = floorLen;
		var sideGeo = new THREE.PlaneGeometry(sideLen, wallHeight);
		var sideMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8, metalness: 0.0 });
	var sideLeft = new THREE.Mesh(sideGeo, sideMat); sideLeft.rotation.y = Math.PI/2; sideLeft.position.set(-wallWidth*0.5, (typeof BASE_HEIGHT !== 'undefined' ? BASE_HEIGHT : 0)+wallHeight*0.5, zMid); group.add(sideLeft);
	var sideRight = new THREE.Mesh(sideGeo, sideMat); sideRight.rotation.y = -Math.PI/2; sideRight.position.set(wallWidth*0.5, (typeof BASE_HEIGHT !== 'undefined' ? BASE_HEIGHT : 0)+wallHeight*0.5, zMid); group.add(sideRight);

		// Backdrop behind back wall
		var backDropGeo = new THREE.PlaneGeometry(wallWidth*3.0, wallHeight*2.5);
		var backDropMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
	var backDropZ = backWallZ - 4.0;
	var backdrop = new THREE.Mesh(backDropGeo, backDropMat); backdrop.position.set(0, (typeof BASE_HEIGHT !== 'undefined' ? BASE_HEIGHT : 0)+wallHeight*0.9, backDropZ); group.add(backdrop);

		scene.add(group);
		themeEnv = {
			group: group,
			floorCenter: floorCenter,
			floorLeft: floorLeft,
			floorRight: floorRight,
			backWall: backWall,
			sideLeft: sideLeft,
			sideRight: sideRight,
			backdrop: backdrop,
			key: null
		};
		return themeEnv;
	}

	function setEnv(themeKey){
		var env = ensureThemeEnvironment();
		if (!env) return;
		// Defaults
		var floorMap=null, floorColor=0x333333, wallMap=null, wallColor=0x222222, backdropMap=null, backdropColor=0x000000;
		// Wall pattern helpers
		function stripes(bg, line, angle){
			return texFromCanvas(makeCanvas(512,512,function(ctx,w,h){
				ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
				ctx.save(); ctx.translate(w/2,h/2); ctx.rotate((angle||45)*Math.PI/180);
				ctx.strokeStyle=line; ctx.lineWidth=6; for(var y=-h; y<=h; y+=40){ ctx.beginPath(); ctx.moveTo(-w,y); ctx.lineTo(w,y); ctx.stroke(); }
				ctx.restore();
			}));
		}
		function dots(bg, dot){
			return texFromCanvas(makeCanvas(512,512,function(ctx,w,h){
				ctx.fillStyle=bg; ctx.fillRect(0,0,w,h);
				ctx.fillStyle=dot; for(var y=0;y<h;y+=48){ for(var x=0;x<w;x+=48){ ctx.beginPath(); ctx.arc(x+12,y+12,3,0,Math.PI*2); ctx.fill(); }}
			}));
		}
		switch(themeKey){
			case 'Classic':
				floorMap = woodPlanks(); floorColor=0xffffff; wallColor=0x444444; wallMap = stripes('#2a2a2a','#555',30); backdropMap = sunsetBackdrop(); break;
			case 'Ocean':
				floorMap = sandTexture(); floorColor=0xffffff; wallColor=0x225577; wallMap = stripes('#0b2a4a','#3da0ff',-20); backdropMap = oceanBackdrop(); break;
			case 'Neon Night':
				floorMap = neonGrid('#050505','#00ff99'); wallColor=0x001a12; wallMap = neonGrid('#000000','#00ffcc'); backdropMap = starBackdrop(); break;
			case 'Retro 80s':
				floorMap = neonGrid('#0a0030','#66ffff'); wallColor=0x2b0057; wallMap = stripes('#1a003a','#ff66ff',45); backdropMap = sunsetBackdrop(); break;
			case 'Cyber Grid':
				floorMap = neonGrid('#000000','#00ffaa'); wallColor=0x001010; wallMap = neonGrid('#000000','#00ffaa'); backdropMap = starBackdrop(); break;
			case 'Sunset Blvd':
				floorMap = woodPlanks(); wallColor=0x442222; wallMap = dots('#2a1010','#ff9966'); backdropMap = sunsetBackdrop(); break;
			case 'Aurora':
				floorMap = neonGrid('#041a2e','#aaffee'); wallColor=0x0a2b3c; wallMap = stripes('#0a2b3c','#64ffda',25); backdropMap = auroraBackdrop(); break;
			case 'Lava Lanes':
				floorMap = lavaTexture(); wallColor=0x330000; wallMap = stripes('#220000','#ff3300',-15); backdropMap = sunsetBackdrop(); break;
			case 'Snow Day':
				floorMap = snowTexture(); wallColor=0x99bbdd; wallMap = dots('#6ea3cc','#ffffff'); backdropMap = snowTexture(); break;
			case 'Cosmic Bowl':
				floorMap = neonGrid('#000010','#6aa2ff'); wallColor=0x110022; wallMap = neonGrid('#000010','#6aa2ff'); backdropMap = starBackdrop(); break;
		}
		[env.floorCenter.material, env.floorLeft.material, env.floorRight.material, env.backWall.material, env.sideLeft.material, env.sideRight.material].forEach(function(m){ m.roughness=0.85; m.metalness=0.05; if (m.emissive) m.emissive.setHex(0x000000); });
		env.floorCenter.material.map = floorMap; env.floorCenter.material.color.setHex(floorColor); env.floorCenter.material.needsUpdate=true;
		env.floorLeft.material.map = floorMap; env.floorLeft.material.color.setHex(floorColor); env.floorLeft.material.needsUpdate=true;
		env.floorRight.material.map = floorMap; env.floorRight.material.color.setHex(floorColor); env.floorRight.material.needsUpdate=true;
		env.backWall.material.map = wallMap; env.backWall.material.color.setHex(wallColor); env.backWall.material.needsUpdate=true;
		env.sideLeft.material.map = wallMap; env.sideLeft.material.color.setHex(wallColor); env.sideLeft.material.needsUpdate=true;
		env.sideRight.material.map = wallMap; env.sideRight.material.color.setHex(wallColor); env.sideRight.material.needsUpdate=true;
		// Give walls a reasonable tiling so patterns aren't overly stretched
		if (wallMap) { try { wallMap.wrapS = wallMap.wrapT = THREE.RepeatWrapping; wallMap.repeat.set(3, 1.5); wallMap.needsUpdate = true; } catch(e){} }
		env.backdrop.material.map = backdropMap; env.backdrop.material.color.setHex(backdropColor); env.backdrop.material.needsUpdate=true;
		env.key = themeKey;
		// Cache wall maps for animation later
		env._wallMaps = [env.backWall.material.map, env.sideLeft.material.map, env.sideRight.material.map];
	}

	THEMES = [
		{ name: 'Classic', apply: function(){ scene.background = new THREE.Color(0x708090); if (ambientLight){ ambientLight.color.set(0xffffff); ambientLight.intensity=0.4;} if(dirLight){ dirLight.color.set(0xffffff); dirLight.intensity=0.6; dirLight.position.set(-0.4,0.6,1.0);} setEnv('Classic'); } },
		{ name: 'Ocean', apply: function(){ scene.background = gradientTex('#004466','#001a33'); if (ambientLight){ ambientLight.color.set(0x66aacc); ambientLight.intensity=0.5;} if(dirLight){ dirLight.color.set(0x99ddff); dirLight.intensity=0.7;} setEnv('Ocean'); } },
		{ name: 'Neon Night', apply: function(){ scene.background = gradientTex('#000000','#001113'); if (ambientLight){ ambientLight.color.set(0x00ffcc); ambientLight.intensity=0.25;} if(dirLight){ dirLight.color.set(0x00ff99); dirLight.intensity=0.9;} setEnv('Neon Night'); } },
		{ name: 'Retro 80s', apply: function(){ scene.background = gradientTex('#2b0057','#0a0030'); if (ambientLight){ ambientLight.color.set(0xff66ff); ambientLight.intensity=0.3;} if(dirLight){ dirLight.color.set(0x66ffff); dirLight.intensity=0.8;} setEnv('Retro 80s'); } },
		{ name: 'Cyber Grid', apply: function(){ scene.background = gradientTex('#001010','#000000'); if (ambientLight){ ambientLight.color.set(0x00ffaa); ambientLight.intensity=0.2;} if(dirLight){ dirLight.color.set(0x00cc88); dirLight.intensity=0.9;} setEnv('Cyber Grid'); } },
		{ name: 'Sunset Blvd', apply: function(){ scene.background = gradientTex('#ff7e5f','#2a2a72'); if (ambientLight){ ambientLight.color.set(0xffc28a); ambientLight.intensity=0.45;} if(dirLight){ dirLight.color.set(0xffd1a8); dirLight.intensity=0.7;} setEnv('Sunset Blvd'); } },
		{ name: 'Aurora', apply: function(){ scene.background = gradientTex('#071b52','#0a2b3c'); if (ambientLight){ ambientLight.color.set(0x88ffdd); ambientLight.intensity=0.35;} if(dirLight){ dirLight.color.set(0xaaffee); dirLight.intensity=0.7;} setEnv('Aurora'); } },
		{ name: 'Lava Lanes', apply: function(){ scene.background = gradientTex('#2a0000','#1a0000'); if (ambientLight){ ambientLight.color.set(0xff6633); ambientLight.intensity=0.35;} if(dirLight){ dirLight.color.set(0xffaa33); dirLight.intensity=0.85;} setEnv('Lava Lanes'); } },
		{ name: 'Snow Day', apply: function(){ scene.background = gradientTex('#ddeeff','#99bbdd'); if (ambientLight){ ambientLight.color.set(0xffffff); ambientLight.intensity=0.6;} if(dirLight){ dirLight.color.set(0xffffff); dirLight.intensity=0.7;} setEnv('Snow Day'); } },
		{ name: 'Cosmic Bowl', apply: function(){ scene.background = gradientTex('#000010','#100022'); if (ambientLight){ ambientLight.color.set(0xbbaaff); ambientLight.intensity=0.35;} if(dirLight){ dirLight.color.set(0x99ccff); dirLight.intensity=0.75;} setEnv('Cosmic Bowl'); } }
	];
}

function applyTheme(index) {
	if (!THEMES || !THEMES.length) return;
	var t = THEMES[Math.abs(index|0) % THEMES.length];
	if (t && typeof t.apply === 'function') {
		try { t.apply(); applyThemeToAlleys(t.name); } catch(e){}
	}
}

function applyThemeToAlleys(themeName) {
	if (!players || !players.length) return;
	var tint = 0x444444;
	switch(themeName){
		case 'Classic': tint = 0x8b5a2b; break;
		case 'Ocean': tint = 0xbfa26a; break; // sandy warm tint
		case 'Neon Night': tint = 0x003322; break;
		case 'Retro 80s': tint = 0x2b0057; break;
		case 'Cyber Grid': tint = 0x001010; break;
		case 'Sunset Blvd': tint = 0x774444; break;
		case 'Aurora': tint = 0x0a2b3c; break;
		case 'Lava Lanes': tint = 0x331100; break;
		case 'Snow Day': tint = 0xbbd5ee; break;
		case 'Cosmic Bowl': tint = 0x110022; break;
	}
	for (var i=0;i<players.length;i++){
		var p = players[i]; if (!p || !p.trackMesh) continue;
		// Only tint the track mesh; do NOT affect pins or ball
		var target = p.trackMesh;
		var mat = target.material;
		if (Array.isArray(mat)) {
			mat.forEach(function(m){ if (m && m.color) { m.color.setHex(tint); if (m.emissive) m.emissive.setHex(0x000000); m.needsUpdate = true; } });
		} else if (mat && mat.color) {
			mat.color.setHex(tint); if (mat.emissive) mat.emissive.setHex(0x000000); mat.needsUpdate = true;
		}
	}
}

// Build a set of ball skins with names, small preview swatches, and an apply(mesh) function
function buildBallSkins() {
	try {
		var makeCanvas = function(w, h, draw) {
			var c = document.createElement('canvas'); c.width = w; c.height = h;
			var ctx = c.getContext('2d');
			draw(ctx, w, h);
			return c;
		};
		var toTex = function(canvas) {
			var tex = new THREE.CanvasTexture(canvas);
			tex.anisotropy = (renderer && renderer.capabilities) ? renderer.capabilities.getMaxAnisotropy() : 1;
			tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
			tex.needsUpdate = true;
			return tex;
		};
		var applyBase = function(mesh, opts) {
			mesh.traverse(function(obj){
				if (obj.isMesh) {
					var mat = obj.material;
					if (Array.isArray(mat)) {
						mat.forEach(function(m){ applyProps(m, opts); });
					} else if (mat) {
						applyProps(mat, opts);
					}
				}
			});
		};
		var applyProps = function(mat, opts) {
			if (!mat) return;
			if (mat.color && opts.color !== undefined) mat.color.set(opts.color);
			if (mat.emissive && opts.emissive !== undefined) mat.emissive.set(opts.emissive);
			if (opts.map !== undefined) { mat.map = opts.map; if (mat.map) mat.map.needsUpdate = true; }
			if (typeof opts.metalness === 'number' && 'metalness' in mat) mat.metalness = opts.metalness;
			if (typeof opts.roughness === 'number' && 'roughness' in mat) mat.roughness = opts.roughness;
			if (typeof opts.envMapIntensity === 'number' && 'envMapIntensity' in mat) mat.envMapIntensity = opts.envMapIntensity;
			mat.needsUpdate = true;
		};

		// Texture generators
		var texSolid = function(color) {
			return toTex(makeCanvas(64, 64, function(ctx, w, h){ ctx.fillStyle = color; ctx.fillRect(0,0,w,h); }));
		};
		var texStripe = function(bg, stripe, count) {
			return toTex(makeCanvas(256, 256, function(ctx, w, h){
				ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
				ctx.save();
				ctx.translate(w/2, h/2); ctx.rotate(-Math.PI/4);
				var spacing = h / count;
				ctx.fillStyle = stripe;
				for (var i=-count; i<=count; i++) {
					ctx.fillRect(-w, i*spacing - (spacing*0.15), w*2, spacing*0.3);
				}
				ctx.restore();
			}));
		};
		var texZebra = function(bg, stripe, count) {
			return toTex(makeCanvas(256,256,function(ctx,w,h){
				ctx.fillStyle = bg; ctx.fillRect(0,0,w,h);
				ctx.fillStyle = stripe; var wStripe = Math.max(2, Math.floor(w/(count||16)));
				for (var i=0;i<w;i+=wStripe*2){ ctx.fillRect(i,0,wStripe,h); }
			}));
		};
		var texStarfield = function(bg, star, stars) {
			return toTex(makeCanvas(256, 256, function(ctx, w, h){
				var grd = ctx.createRadialGradient(w*0.3, h*0.3, 10, w*0.5, h*0.5, w*0.8);
				grd.addColorStop(0, bg);
				grd.addColorStop(1, '#000000');
				ctx.fillStyle = grd; ctx.fillRect(0,0,w,h);
				ctx.fillStyle = star;
				for (var i=0; i<stars; i++) {
					var x = Math.random()*w, y = Math.random()*h, r = Math.random()*1.8+0.2;
					ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
				}
			}));
		};
		var texFlame = function() {
			return toTex(makeCanvas(256, 256, function(ctx, w, h){
				var grd = ctx.createLinearGradient(0, h, 0, 0);
				grd.addColorStop(0, '#200');
				grd.addColorStop(0.3, '#a20');
				grd.addColorStop(0.6, '#ff6600');
				grd.addColorStop(1, '#ffcc00');
				ctx.fillStyle = grd; ctx.fillRect(0,0,w,h);
				ctx.globalAlpha = 0.2; ctx.fillStyle = '#fff';
				for (var i=0;i<20;i++) {
					var px = Math.random()*w, py = h*0.6 + Math.random()*h*0.4;
					var pw = 10+Math.random()*40, ph = 40+Math.random()*120;
					ctx.beginPath();
					ctx.moveTo(px, py);
					ctx.bezierCurveTo(px-pw, py-ph*0.3, px+pw, py-ph*0.7, px, py-ph);
					ctx.bezierCurveTo(px-pw*0.5, py-ph*0.6, px+pw*0.5, py-ph*0.4, px, py);
					ctx.fill();
				}
				ctx.globalAlpha = 1.0;
			}));
		};
		var texMarble = function(base) {
			return toTex(makeCanvas(256, 256, function(ctx, w, h){
				ctx.fillStyle = base; ctx.fillRect(0,0,w,h);
				ctx.strokeStyle = 'rgba(255,255,255,0.15)';
				ctx.lineWidth = 2;
				for (var i=0;i<60;i++) {
					ctx.beginPath();
					var x = Math.random()*w, y = Math.random()*h;
					var len = 20 + Math.random()*100;
					var ang = Math.random()*Math.PI*2;
					for (var t=0; t<10; t++) {
						ctx.lineTo(x + Math.cos(ang+t*0.3)*len*0.1*t, y + Math.sin(ang+t*0.3)*len*0.1*t);
					}
					ctx.stroke();
				}
			}));
		};

		BALL_SKINS = [
			{
				name: 'Classic Red',
				preview: makeCanvas(32, 32, (ctx,w,h)=>{ ctx.fillStyle='#aa1122'; ctx.beginPath(); ctx.arc(w/2,h/2, w/2, 0, Math.PI*2); ctx.fill(); }).toDataURL(),
				apply: function(mesh){
					applyBase(mesh, { color: 0xaa1122, emissive: 0x220000, metalness: 0.1, roughness: 0.6, map: texSolid('#aa1122') });
				}
			},
			{
				name: 'Blue Stripe',
				preview: makeCanvas(32,32,(ctx,w,h)=>{ ctx.fillStyle='#113366'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='#ffffff'; ctx.lineWidth=6; ctx.beginPath(); ctx.moveTo(0,h); ctx.lineTo(w,0); ctx.stroke(); }).toDataURL(),
				apply: function(mesh){
					var map = texStripe('#113366', '#ffffff', 10);
					applyBase(mesh, { color: 0x113366, emissive: 0x000011, metalness: 0.2, roughness: 0.5, map: map });
				}
			},
			{
				name: 'Neon Swirl',
				preview: makeCanvas(32,32,(ctx,w,h)=>{ ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='#00ff99'; ctx.lineWidth=3; ctx.beginPath(); for (var a=0;a<6.28;a+=0.4){ var r=4+a*2; ctx.lineTo(w/2+Math.cos(a)*r, h/2+Math.sin(a)*r);} ctx.stroke(); }).toDataURL(),
				apply: function(mesh){
					var c = makeCanvas(256,256,function(ctx,w,h){ ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='#00ff99'; ctx.lineWidth=3; ctx.shadowColor='#00ff99'; ctx.shadowBlur=8; ctx.beginPath(); for (var a=0;a<Math.PI*8;a+=0.1){ var r=6+a*3; ctx.lineTo(w/2+Math.cos(a)*r, h/2+Math.sin(a)*r);} ctx.stroke(); });
					applyBase(mesh, { color: 0x000000, emissive: 0x001a12, metalness: 0.0, roughness: 0.9, map: toTex(c) });
				}
			},
			{
				name: 'Starfield',
				preview: makeCanvas(32,32,(ctx,w,h)=>{ ctx.fillStyle='#000'; ctx.fillRect(0,0,w,h); ctx.fillStyle='#fff'; for (var i=0;i<25;i++){ ctx.fillRect(Math.random()*w, Math.random()*h, 1,1);} }).toDataURL(),
				apply: function(mesh){
					var map = texStarfield('#001122', '#ffffff', 220);
					applyBase(mesh, { color: 0x001122, emissive: 0x000000, metalness: 0.05, roughness: 0.8, map: map });
				}
			},
			{
				name: 'Flame',
				preview: makeCanvas(32,32,(ctx,w,h)=>{ var g=ctx.createLinearGradient(0,h,0,0); g.addColorStop(0,'#200'); g.addColorStop(1,'#ff0'); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); }).toDataURL(),
				apply: function(mesh){
					var map = texFlame();
					applyBase(mesh, { color: 0x662200, emissive: 0x220000, metalness: 0.15, roughness: 0.6, map: map });
				}
			},
			{
				name: 'Marble Green',
				preview: makeCanvas(32,32,(ctx,w,h)=>{ ctx.fillStyle='#0a3'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='rgba(255,255,255,0.3)'; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(2,10); ctx.lineTo(30,22); ctx.stroke(); }).toDataURL(),
				apply: function(mesh){
					var map = texMarble('#0a3a2a');
					applyBase(mesh, { color: 0x0a3a2a, emissive: 0x001a12, metalness: 0.1, roughness: 0.7, map: map });
				}
			},
			// Additional 12+ styles
			{ name: 'Solid Blue', preview: makeCanvas(32,32,(c,w,h)=>{c.fillStyle='#2244aa'; c.fillRect(0,0,w,h);}).toDataURL(), apply: function(mesh){ applyBase(mesh, { color: 0x2244aa, emissive: 0x000011, metalness:0.1, roughness:0.7, map: texSolid('#2244aa')}); }},
			{ name: 'Solid Green', preview: makeCanvas(32,32,(c,w,h)=>{c.fillStyle='#1ea64a'; c.fillRect(0,0,w,h);}).toDataURL(), apply: function(mesh){ applyBase(mesh, { color: 0x1ea64a, emissive: 0x001a12, metalness:0.1, roughness:0.7, map: texSolid('#1ea64a')}); }},
			{ name: 'Solid Purple', preview: makeCanvas(32,32,(c,w,h)=>{c.fillStyle='#6a22aa'; c.fillRect(0,0,w,h);}).toDataURL(), apply: function(mesh){ applyBase(mesh, { color: 0x6a22aa, emissive: 0x110022, metalness:0.1, roughness:0.7, map: texSolid('#6a22aa')}); }},
			{ name: 'Solid Orange', preview: makeCanvas(32,32,(c,w,h)=>{c.fillStyle='#ff7f11'; c.fillRect(0,0,w,h);}).toDataURL(), apply: function(mesh){ applyBase(mesh, { color: 0xff7f11, emissive: 0x221100, metalness:0.1, roughness:0.7, map: texSolid('#ff7f11')}); }},
			{ name: 'Solid Black', preview: makeCanvas(32,32,(c,w,h)=>{c.fillStyle='#000000'; c.fillRect(0,0,w,h);}).toDataURL(), apply: function(mesh){ applyBase(mesh, { color: 0x000000, emissive: 0x000000, metalness:0.0, roughness:0.9, map: texSolid('#000000')}); }},
			{ name: 'Solid White', preview: makeCanvas(32,32,(c,w,h)=>{c.fillStyle='#ffffff'; c.fillRect(0,0,w,h);}).toDataURL(), apply: function(mesh){ applyBase(mesh, { color: 0xffffff, emissive: 0x111111, metalness:0.0, roughness:0.4, map: texSolid('#ffffff')}); }},
			{ name: 'Bubblegum Pink', preview: makeCanvas(32,32,(c,w,h)=>{c.fillStyle='#ff66cc'; c.fillRect(0,0,w,h);}).toDataURL(), apply: function(mesh){ applyBase(mesh, { color: 0xff66cc, emissive: 0x220011, metalness:0.1, roughness:0.6, map: texSolid('#ff66cc')}); }},
			{ name: 'Checkerboard', preview: makeCanvas(32,32,(ctx,w,h)=>{ for (var y=0;y<8;y++){ for(var x=0;x<8;x++){ ctx.fillStyle=((x+y)%2)?'#000':'#fff'; ctx.fillRect(x*4,y*4,4,4);} } }).toDataURL(), apply: function(mesh){ var c=makeCanvas(256,256,(ctx,w,h)=>{ for (var y=0;y<32;y++){ for(var x=0;x<32;x++){ ctx.fillStyle=((x+y)%2)?'#000':'#fff'; ctx.fillRect(x*8,y*8,8,8);} } }); applyBase(mesh, { color: 0xffffff, emissive: 0x111111, metalness:0.0, roughness:0.7, map: toTex(c)}); }},
			{ name: 'Zebra', preview: makeCanvas(32,32,(ctx,w,h)=>{ ctx.fillStyle='#fff'; ctx.fillRect(0,0,w,h); ctx.fillStyle='#000'; for(var i=0;i<8;i++){ ctx.fillRect(i*4,0,2,32);} }).toDataURL(), apply: function(mesh){ var map=texZebra('#ffffff','#000000',16); applyBase(mesh,{ color:0xffffff, emissive:0x111111, metalness:0.0, roughness:0.8, map: map}); }},
			{ name: 'Rainbow', preview: makeCanvas(32,32,(ctx,w,h)=>{ var g=ctx.createLinearGradient(0,0,32,0); ['#ff0000','#ffa500','#ffff00','#00ff00','#0000ff','#4b0082','#ee82ee'].forEach((c,i)=>g.addColorStop(i/6,c)); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); }).toDataURL(), apply: function(mesh){ var c=makeCanvas(256,256,(ctx,w,h)=>{ var g=ctx.createLinearGradient(0,0,w,0); ['#ff0000','#ffa500','#ffff00','#00ff00','#0000ff','#4b0082','#ee82ee'].forEach((c,i)=>g.addColorStop(i/6,c)); ctx.fillStyle=g; ctx.fillRect(0,0,w,h); }); applyBase(mesh,{ color:0xffffff, emissive:0x111111, metalness:0.0, roughness:0.6, map: toTex(c)}); }},
			{ name: 'Carbon Fiber', preview: makeCanvas(32,32,(ctx,w,h)=>{ ctx.fillStyle='#111'; ctx.fillRect(0,0,w,h); ctx.fillStyle='#222'; for(var y=0;y<32;y+=4){ for(var x=0;x<32;x+=4){ ctx.fillRect(x+(y%8?2:0),y,2,2);} } }).toDataURL(), apply: function(mesh){ var c=makeCanvas(256,256,(ctx,w,h)=>{ ctx.fillStyle='#111'; ctx.fillRect(0,0,w,h); ctx.fillStyle='#222'; for(var y=0;y<h;y+=16){ for(var x=0;x<w;x+=16){ ctx.fillRect(x+((y%32)?8:0),y,8,8);} } }); applyBase(mesh,{ color:0x222222, emissive:0x000000, metalness:0.6, roughness:0.4, map: toTex(c)}); }},
			{ name: 'Chrome', preview: makeCanvas(32,32,(ctx,w,h)=>{ ctx.fillStyle='#aaa'; ctx.fillRect(0,0,w,h); }).toDataURL(), apply: function(mesh){ applyBase(mesh,{ color:0xbbbbbb, emissive:0x000000, metalness:1.0, roughness:0.05, map: null}); }},
			{ name: 'Basketball', preview: makeCanvas(32,32,(ctx,w,h)=>{ ctx.fillStyle='#d35400'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='#000'; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(0,16); ctx.lineTo(32,16); ctx.moveTo(16,0); ctx.lineTo(16,32); ctx.stroke(); }).toDataURL(), apply: function(mesh){ var c=makeCanvas(256,256,(ctx,w,h)=>{ ctx.fillStyle='#d35400'; ctx.fillRect(0,0,w,h); ctx.strokeStyle='#000'; ctx.lineWidth=6; ctx.beginPath(); ctx.moveTo(0,h/2); ctx.lineTo(w,h/2); ctx.moveTo(w/2,0); ctx.lineTo(w/2,h); ctx.stroke(); }); applyBase(mesh,{ color:0xd35400, emissive:0x220a00, metalness:0.1, roughness:0.9, map: toTex(c)}); }}
		];
	} catch(e) {
		// Fallback: at least one solid color skin
		BALL_SKINS = [
			{ name: 'Solid Blue', preview: null, apply: function(mesh){ mesh.traverse(function(obj){ if(obj.isMesh && obj.material && obj.material.color){ obj.material.color.set(0x2244aa);} }); } }
		];
	}
}
// Menu navigation state
var mainMenuItems = [];          // array of elements
var menuFocusIndex = -1;
var menuScanHeld = false;
var menuHoldStart = 0.0;
var menuLastBackStep = 0.0;
var settingsItems = [];          // array of {el, key, type}
var settingsFocusIndex = 0;
var settingsScanHeld = false;
var settingsHoldStart = 0.0;
var settingsLastBackStep = 0.0;
// Pause menu scan state
var pauseMenuItems = [];
var pauseFocusIndex = -1;
var pauseScanHeld = false;
var pauseHoldStart = 0.0;
var pauseLastBackStep = 0.0;
var autoScanLastTime = 0.0; // Added for Auto Scan support
// Enter hold to pause
var enterHeld = false;
var enterHoldStart = 0.0;

class Player {
	constructor(id, local, physics, scores, ballMesh, pinMeshes) {
		this.id = id;
		this.local = local;
		this.physics = physics;
		this.scores = scores;
		this.ballMesh = ballMesh;
		this.pinMeshes = pinMeshes;
		this.aimHelper = null; // THREE.ArrowHelper for aiming visualization
	}
}

class Imitation {
	constructor(frames, emergingTime, slot) {
		this.frames = frames;
		this.waitingTime = emergingTime;
		this.slot = slot;
	}
}

function init() {
	scene = new THREE.Scene();
	scene.background = new THREE.Color(0.7, 0.7, 0.7);

	camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight,
			CAMERA_NEAR, CAMERA_FAR);
	camera.position.set(0.0, 1.7, 5.0);
	camera.rotation.x = -25.0 / 180.0 * Math.PI;

	ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
	scene.add(ambientLight);

	dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
	dirLight.position.set(-0.4, 0.6, 1.0);
	scene.add(dirLight);

	touchPoint = new THREE.Vector2();
	pickPoint = new THREE.Vector3();
	dragPoint = new THREE.Vector3();
	releaseVector = new THREE.Vector3();
	raycaster = new THREE.Raycaster();
	pickSphere = new THREE.Sphere(new THREE.Vector3(), BALL_RADIUS);

	clock = new THREE.Clock();

	container = document.getElementById("container");

	renderer = new THREE.WebGLRenderer({ antialias: false });
	renderer.setPixelRatio(window.devicePixelRatio);
	renderer.setSize(window.innerWidth, window.innerHeight);
	renderer.gammaOutput = true;
	container.appendChild(renderer.domElement);

	scoresDiv = document.createElement("div");
	scoresDiv.style = "position: fixed; left: 50%; top: 8px; transform: translate(-50%, 0); z-index: 1000;";
	container.appendChild(scoresDiv);

	// Charge bar UI (hidden by default)
	chargeBar = document.createElement("div");
	// Position under the scoreboard (will be refined dynamically)
	chargeBar.style = "position: fixed; left: 50%; top: 56px; transform: translateX(-50%); width: 280px; height: 14px; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.5); border-radius: 8px; overflow: hidden; display: none; z-index: 1000;";
	chargeFill = document.createElement("div");
	chargeFill.style = "height: 100%; width: 0%; background: linear-gradient(90deg, #33cc33, #00ff99); box-shadow: 0 0 8px #00ff99;";
	chargeBar.appendChild(chargeFill);
	container.appendChild(chargeBar);

	// Help tips (hidden in menus/paused)
	helpTipsDiv = document.createElement('div');
	helpTipsDiv.style = [
		'position: fixed',
		'left: 50%','bottom: 12px','transform: translateX(-50%)',
		'z-index: 1400','pointer-events: none',
		'padding: 8px 12px','border-radius: 10px',
		'background: rgba(0,0,0,0.55)','color: #eaffff',
		'font: 700 11px "Courier New", monospace',
		'letter-spacing: 0.5px','text-align: center',
		'box-shadow: 0 0 10px rgba(0,255,153,0.35)',
		'border: 1px solid rgba(0,255,153,0.35)',
		'display: none'
	].join(';');
	helpTipsDiv.innerHTML = [
		'<div>Drag ball to position; drag forward to throw.</div>',
		'<div>Keyboard: Space = move, Enter = aim, Space = set angle, Hold Enter = charge, release to bowl.</div>'
	].join('');
	container.appendChild(helpTipsDiv);

	// Pause UI Button (mouse users)
	pauseUIButton = document.createElement('button');
	pauseUIButton.textContent = 'PAUSE';
	pauseUIButton.style = "position: fixed; left: 12px; bottom: 12px; z-index: 1500; padding:8px 12px; color:#00ff99; background:#000000; border:2px solid #00ff99; border-radius:8px; font-weight:800; letter-spacing:1px; cursor:pointer; box-shadow:0 0 8px #00ff99;";
	pauseUIButton.onclick = function(){ if (gameState === 'playing') { openPauseMenu(); } };
	container.appendChild(pauseUIButton);

	// XXX How to get pixel density?
	ppi = 96 * window.devicePixelRatio;

	window.addEventListener("resize", resizeViewport, false);

	var loader = new THREE.GLTFLoader();
	loader.load("res/scene.gltf", (gltf) => {
		trackProtoMesh = gltf.scene.children.find(child => child.name == "Track");
		if (!trackProtoMesh) {
			throw new Error("Track not found");
		}
		ballProtoMesh = gltf.scene.children.find(child => child.name == "Ball");
		if (!ballProtoMesh) {
			throw new Error("Ball not found");
		}
		pinProtoMesh = gltf.scene.children.find(child => child.name == "Pin");
		if (!pinProtoMesh) {
			throw new Error("Pin not found");
		}

		var maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
		setAnisotropy(trackProtoMesh, maxAnisotropy);
		setAnisotropy(ballProtoMesh, maxAnisotropy);
		setAnisotropy(pinProtoMesh, maxAnisotropy);

		Ammo().then((Ammo) => {
			initScene();
		});
	});
}

function setAnisotropy(parent, anisotropy) {
	parent.traverse((object) => {
		if (object.isMesh && object.material && object.material.map) {
			object.material.map.anisotropy = anisotropy;
		}
	});
}

function getLocalPlayer() {
	if (!players) {
		return undefined;
	}
	return players.find(p => p.local);
}

function addPlayer(id, local, slot) {
	var physics = new BowlPhysics();

	var scores = new Scores();

	var group = new THREE.Group();
	group.position.x = slot * TRACK_DISTANCE;
	scene.add(group);

	var trackMesh = trackProtoMesh.clone();
	// Hide the original alley/track object; we now use the themed environment floor/walls
	trackMesh.visible = false;
	group.add(trackMesh);

	var ballMesh = ballProtoMesh.clone();
	group.add(ballMesh);

	var pinMeshes = new Array(PIN_COUNT);
	for (var i = 0; i < pinMeshes.length; i++) {
		var pinMesh = pinProtoMesh.clone();
		// Force pins to be bright white with very subtle lighting
		pinMesh.traverse(function(obj){
			if (obj.isMesh && obj.material) {
				var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
				for (var mi=0; mi<mats.length; mi++) {
					var m = mats[mi];
					if (!m) continue;
					if (m.color) m.color.setHex(0xffffff);
					if ('metalness' in m) m.metalness = 0.0;
					if ('roughness' in m) m.roughness = 0.35;
					if ('emissive' in m && m.emissive) m.emissive.setHex(0x0a0a0a); // very subtle glow to keep readability
					if ('envMapIntensity' in m) m.envMapIntensity = 0.05;
					m.needsUpdate = true;
				}
			}
		});
		group.add(pinMesh);
		pinMeshes[i] = pinMesh;
	}

	var player = new Player(id, local, physics, scores, ballMesh, pinMeshes);
	player.trackMesh = trackMesh;

	if (!players) {
		players = new Array();
	}
	players.push(player);

	return player;
}

function removePlayer(id) {
	if (!players) {
		return;
	}
	for (var i = 0; i < players.length; i++) {
		var player = players[i];
		if (player.id === id) {
			scene.remove(player.ballMesh.parent);
			players.splice(i, 1);
			return;
		}
	}
}

function createImitation(slot) {
	var frames = 1 + Math.floor(Math.random() * FRAME_COUNT);
	var emergingTime = IMITATION_EMERGING_TIME_MIN + Math.random()
			* (IMITATION_EMERGING_TIME_MAX - IMITATION_EMERGING_TIME_MAX);
	return new Imitation(frames, emergingTime, slot);
}

function addImitation(slot) {
	var imitation = createImitation(slot);
	if (!imitations) {
		imitations = new Array();
	}
	imitations.push(imitation);
	return imitation;
}

function restartImitation(imitation) {
	if (imitation.player) {
		removePlayer(imitation.player.id);
	}
	if (!imitations) {
		return;
	}
	var imitationIndex = imitations.findIndex(i => i === imitation);
	if (imitationIndex === undefined) {
		return;
	}
	imitations[imitationIndex] = createImitation(imitation.slot);
}

function updateImitation(imitation, dt) {
	imitation.waitingTime -= dt;
	if (imitation.waitingTime > 0.0) {
		return;
	}

	imitation.waitingTime = IMITATION_THROW_TIME_MIN + Math.random()
			* (IMITATION_THROW_TIME_MAX - IMITATION_THROW_TIME_MIN);

	if (!imitation.player) {
		imitation.player = addPlayer(++imitationPlayerId, false, imitation.slot);
	}

	if (imitation.player.scores.gameOver
			|| (imitation.player.scores.frameNumber >= imitation.frames)) {
		restartImitation(imitation);
		return;
	}

	var position = IMITATION_THROW_POSITION_MAX * 2.0 * (Math.random() - 0.5);
	var angle = IMITATION_THROW_ANGLE_MAX * 2.0 * (Math.random() - 0.5);
	var velocity = BALL_VELOCITY_MIN + Math.random() * (BALL_VELOCITY_MAX - BALL_VELOCITY_MIN);
	imitation.player.physics.positionBall(position, false);
	imitation.player.physics.releaseBall(velocity, angle);
	// SFX: ball rolling for imitation throws too
	playSfx('sound/rolling-ball.wav', 1.0);
}

function initScene() {
	// Start in menu; the player is created when 'Play Game' is pressed

	renderer.domElement.addEventListener("mousedown", onDocumentMouseDown, false);
	renderer.domElement.addEventListener("mousemove", onDocumentMouseMove, false);
	renderer.domElement.addEventListener("mouseup", onDocumentMouseUp, false);
	renderer.domElement.addEventListener("touchstart", onDocumentTouchStart, false);
	renderer.domElement.addEventListener("touchmove", onDocumentTouchMove, false);
	renderer.domElement.addEventListener("touchend", onDocumentTouchEnd, false);

	// Keyboard: Spacebar to move ball left/right across the lane
	window.addEventListener("keydown", onDocumentKeyDown, false);
	window.addEventListener("keyup", onDocumentKeyUp, false);

	// Build UI overlays
	buildMenus();
	showMainMenu();

	// Prepare celebration overlay (hidden by default)
	try {
		celebrationDiv = document.createElement('div');
		celebrationDiv.id = 'bb_celebration';
		celebrationDiv.style = [
			'position:fixed',
			'left:50%','top:22%','transform:translate(-50%, -50%) scale(0.8)',
			'opacity:0','z-index:2300','pointer-events:none',
			'font-family:"Courier New", monospace','font-weight:900','letter-spacing:3px',
			'font-size:64px','color:#ffe066',
			'text-shadow:0 0 12px #ffcc33, 0 0 24px #ffaa00, 0 0 40px #ff8800',
			'filter: drop-shadow(0 0 10px rgba(255,170,0,0.6))',
			'transition: opacity 380ms ease, transform 380ms ease'
		].join(';');
		celebrationDiv.textContent = '';
		document.body.appendChild(celebrationDiv);
	} catch(e) {}

	animate();
}

function updateGame(player, dt) {
	player.physics.updatePhysics(dt);

	// Initialize pin standing state when a new roll starts
	if (!player._prevSimActive && player.physics.simulationActive) {
		player._sfxPinStanding = new Array(PIN_COUNT);
		for (var si = 0; si < PIN_COUNT; si++) player._sfxPinStanding[si] = true;
	}

	// During simulation, detect pin drops and play per-pin SFX
	if (player.physics.simulationActive && player.physics.pinBodies) {
		try {
			for (var i = 0; i < player.physics.pinBodies.length; i++) {
				var pinBody = player.physics.pinBodies[i];
				if (!pinBody) continue;
				var transform = pinBody.getCenterOfMassTransform();
				var p = transform.getOrigin();
				var origin = PIN_POSITIONS[i];
				var dx = p.x() - origin[0];
				var dy = p.y() - origin[1];
				var dz = p.z() - origin[2];
				var distanceSquared = dx * dx + dy * dy + dz * dz;
				var upright = (transform.getBasis().getRow(1).y() > STANDING_PIN_COS_ANGLE_Y_MIN);
				var standingNow = (distanceSquared < STANDING_PIN_SQUARED_OFFSET_MAX) && upright;
				if (player._sfxPinStanding && player._sfxPinStanding[i] && !standingNow) {
					// Transition: standing -> fallen
					playSfx('sound/single-pin.mp3', 0.9);
				}
				if (player._sfxPinStanding) player._sfxPinStanding[i] = standingNow;
			}
		} catch(e) {}
	}

	if (player.physics.simulationActive && (player.physics.simulationTime > FRAME_ROLL_TIME)) {
		var standingPinsMask = player.physics.detectStandingPins();
		var beatenPinsMask = player.physics.currentPinsMask & (~standingPinsMask);
		var beatenPinCount = player.physics.countPins(beatenPinsMask);

		var prevFrameNumber = player.scores.frameNumber;
		// Apply scoring
		player.scores.addThrowResult(beatenPinCount);
		if (player.local) {
			renderScoreboard(player.scores);
			// Announce outcome of this roll (TTS)
			// Prefer an emphatic "Strike!" when applicable
			try {
				var info = getLatestThrowInfo(player.scores);
				if (info && info.ch === 'X') {
					player._spokeStrikeThisRoll = true;
					speakText('Strike!');
					showStrikeCelebration();
				} else {
					speakLatestRollOutcome(player.scores);
				}
			} catch(e) { speakLatestRollOutcome(player.scores); }
		}

		if (!player.scores.gameOver) {
			var pinsMask;
			if ((prevFrameNumber != player.scores.frameNumber) || (standingPinsMask == 0)) {
				pinsMask = -1;
			} else {
				pinsMask = standingPinsMask;
			}
			player.physics.resetPhysics(false, pinsMask);
			if (player.local && (prevFrameNumber != player.scores.frameNumber)) {
				// Announce next frame number; if a strike was just spoken, delay to avoid canceling it
				var announce = function(){ speakText("Frame " + (player.scores.frameNumber + 1)); };
				if (player._spokeStrikeThisRoll) { player._spokeStrikeThisRoll = false; setTimeout(announce, 1200); }
				else { announce(); }
			}
		} else if (player.local) {
			// Game over: show title screen with final score, TTS the score, then return to menu
			var finalScore = player.scores && (typeof player.scores.score === 'number') ? player.scores.score : 0;
			showGameOver(finalScore);
			speakText('Game over. Final score: ' + finalScore);
			return; // stop further processing this frame
		}
	}

	syncView(player);

	// Track simulation state transitions
	player._prevSimActive = player.physics.simulationActive;
}

function updateScene(dt) {
	if (imitations) {
		for (var i = 0; i < imitations.length; i++) {
			updateImitation(imitations[i], dt);
		}
	}

	// Handle menu/pause scanning timers when in menu or paused
	if (gameState === 'menu' || gameState === 'paused') {
		var now = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
		
		// Auto Scan Logic (Forward)
		var sm = (typeof NarbeScanManager !== 'undefined') ? NarbeScanManager : null;
		var scanInt = (sm ? sm.getScanInterval() : 2000) / 1000.0;
		if (sm && sm.getSettings().autoScan) {
			if ((now - autoScanLastTime) >= scanInt) {
				// Settings
				if (settingsDiv && settingsDiv.style.display === 'flex' && !settingsScanHeld) {
					settingsFocusIndex = (settingsFocusIndex + 1) % settingsItems.length;
					applySettingsFocus();
					autoScanLastTime = now;
				}
				// Menu
				else if (gameState === 'menu' && (!settingsDiv || settingsDiv.style.display !== 'flex') && !menuScanHeld) {
					if (menuFocusIndex === -1) menuFocusIndex = 0;
					else menuFocusIndex = (menuFocusIndex + 1) % mainMenuItems.length;
					applyMenuFocus();
					autoScanLastTime = now;
				}
				// Pause
				else if (gameState === 'paused' && (!settingsDiv || settingsDiv.style.display !== 'flex') && !pauseScanHeld) {
					if (pauseFocusIndex === -1) pauseFocusIndex = 0;
					else pauseFocusIndex = (pauseFocusIndex + 1) % pauseMenuItems.length;
					applyPauseFocus();
					autoScanLastTime = now;
				}
			}
		}

		// Main menu backward scan every 2s after 3s hold
		if (gameState === 'menu' && (!settingsDiv || settingsDiv.style.display !== 'flex') && menuScanHeld) {
			var held = Math.max(0.0, now - menuHoldStart);
			if (held >= 3.0) {
				var stepInterval = (typeof NarbeScanManager !== 'undefined') ? (NarbeScanManager.getScanInterval() / 1000.0) : 2.0;
				if ((now - menuLastBackStep) >= stepInterval) {
					menuFocusIndex = (menuFocusIndex - 1 + mainMenuItems.length) % mainMenuItems.length;
					menuLastBackStep = now;
					applyMenuFocus();
				}
			}
		}
		// Pause menu backward scan
		if (gameState === 'paused' && (!settingsDiv || settingsDiv.style.display !== 'flex') && pauseScanHeld) {
			var heldP = Math.max(0.0, now - pauseHoldStart);
			if (heldP >= 3.0) {
				var stepIntervalP = (typeof NarbeScanManager !== 'undefined') ? (NarbeScanManager.getScanInterval() / 1000.0) : 2.0;
				if ((now - pauseLastBackStep) >= stepIntervalP) {
					pauseFocusIndex = (pauseFocusIndex - 1 + pauseMenuItems.length) % pauseMenuItems.length;
					pauseLastBackStep = now;
					applyPauseFocus();
				}
			}
		}
		// Settings backward scan (shared for menu or paused)
		if (settingsDiv && settingsDiv.style.display === 'flex' && settingsScanHeld) {
			var heldS = Math.max(0.0, now - settingsHoldStart);
			if (heldS >= 3.0) {
				var stepIntervalS = (typeof NarbeScanManager !== 'undefined') ? (NarbeScanManager.getScanInterval() / 1000.0) : 2.0;
				if ((now - settingsLastBackStep) >= stepIntervalS) {
					settingsFocusIndex = (settingsFocusIndex - 1 + settingsItems.length) % settingsItems.length;
					settingsLastBackStep = now;
					applySettingsFocus();
				}
			}
		}
		// Skip gameplay updates while in menu
		return;
	}

	var localPlayer = getLocalPlayer();
	if (localPlayer && !localPlayer.physics.simulationActive
			&& !pickingBall && !positioningBall && !rollingBall) {
		var sm = (typeof NarbeScanManager !== 'undefined') ? NarbeScanManager : null;
		var t = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
		// Use slower oscillation for auto-scan to make timing easier
		var isAuto = (sm && sm.getSettings().autoScan);
		
		var T = isAuto ? 10.0 : 20.00; // Auto: Faster/Normal speed? User said "oscillate on its own". Manual uses hold. 
        // Wait, T=20 is slower. T=10 is faster.
        // Original code had T=20.00 "Doubled from 10.00".
        // Let's stick to T=20.00 for accessibility unless requested otherwise. 

		var omega = 2.0 * Math.PI / T;
		
		// Position oscillation
		// Manual: spaceHeld. Auto: always oscillates if not yet aiming.
		if (!aimingMode && (spaceHeld || isAuto)) {
			// For auto, we treat start time as 0 unless we want to sync phase. 
			// Simpler to just use t.
			var Apos = BALL_POSITION_MAX;
			var effectiveStart = spaceHeld ? spaceStartTime : 0.0;
			var effectivePhase = spaceHeld ? spacePhase : 0.0;
			
			var tauPos = Math.max(0.0, t - effectiveStart);
			var x = Apos * Math.sin(omega * tauPos + effectivePhase);
			localPlayer.physics.positionBall(x, false);
		}
		
		// Aim oscillation
		// Manual: aimHeld. Auto: oscillates if aimingMode is active and not yet charging to throw.
		if (aimingMode) {
			if (aimHeld || (isAuto && !charging)) {
				var Aaim = BALL_ANGLE_MAX;
				var effectiveStartA = aimHeld ? aimStartTime : 0.0;
				var effectivePhaseA = aimHeld ? aimPhase : 0.0;
				
				var tauAim = Math.max(0.0, t - effectiveStartA);
				currentAimAngle = Aaim * Math.sin(omega * tauAim + effectivePhaseA);
			}
			updateAimHelper(localPlayer);
		}

		// Update charge bar while charging
		if (aimingMode && charging) {
			var now = t;
			var held = Math.max(0.0, now - chargeStartTime);
			var k = Math.min(1.0, held / CHARGE_TIME_MAX);
			var kVis = Math.pow(k, CHARGE_POWER_CURVE);
			if (chargeBar && chargeFill) {
				chargeBar.style.display = "block";
				chargeFill.style.width = Math.round(kVis * 100) + "%";
				positionChargeBarUnderScore();
			}
		} else {
			if (chargeBar) chargeBar.style.display = "none";
		}
	}

	// Enter hold to open pause menu (5s)
	if (gameState === 'playing' && enterHeld) {
		var now2 = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
		if ((now2 - enterHoldStart) >= 5.0) {
			enterHeld = false;
			openPauseMenu();
		}
	}

	// Animate ambient effects per theme
	if (themeEnv && themeEnv.key) {
		var t = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
		var k = themeEnv.key;
		// Safe checks for maps
		var floorMap = (themeEnv.floorCenter && themeEnv.floorCenter.material && themeEnv.floorCenter.material.map) ? themeEnv.floorCenter.material.map : null;
		var backMap = themeEnv.backdrop && themeEnv.backdrop.material && themeEnv.backdrop.material.map;
		var wallMaps = (themeEnv._wallMaps && themeEnv._wallMaps.filter(function(m){return !!m;})) || [];
		if (k === 'Ocean') {
			if (backMap) { backMap.offset.x = (t*0.01)%1; backMap.needsUpdate = true; }
			if (floorMap) { floorMap.offset.x = (t*0.02)%1; floorMap.needsUpdate = true; }
			// Gentle rolling wave across walls
			wallMaps.forEach(function(wm, i){ wm.offset.x = (t*0.008 + i*0.1)%1; wm.needsUpdate = true; });
			if (ambientLight) ambientLight.intensity = 0.5 + 0.05*Math.sin(t*0.6);
		}
		else if (k === 'Neon Night' || k === 'Cyber Grid' || k === 'Retro 80s') {
			if (floorMap) { floorMap.offset.x = (t*0.03)%1; floorMap.needsUpdate = true; }
			// Sweep neon patterns along walls in opposing directions
			wallMaps.forEach(function(wm, i){ wm.offset.x = (((i%2)===0)?1:-1) * (t*0.025)%1; wm.offset.y = (t*0.005)%1; wm.needsUpdate = true; });
			if (ambientLight) ambientLight.intensity = ((k==='Retro 80s')?0.3:0.25) + 0.05*Math.sin(t*1.2);
		}
		else if (k === 'Aurora') {
			if (backMap) { backMap.offset.x = (t*0.005)%1; backMap.needsUpdate = true; }
			wallMaps.forEach(function(wm){ wm.offset.y = (Math.sin(t*0.2)*0.05 + 0.05)%1; wm.needsUpdate = true; });
			if (dirLight) {
				var hue = (0.5 + 0.1*Math.sin(t*0.3)); // 0..1-ish
				var col = new THREE.Color().setHSL(hue, 0.6, 0.6);
				dirLight.color.copy(col);
			}
		}
		else if (k === 'Lava Lanes') {
			if (floorMap) { floorMap.offset.x = (t*0.02)%1; floorMap.needsUpdate = true; }
			// Lava glow scrolling diagonally on walls
			wallMaps.forEach(function(wm){ wm.offset.x = (t*0.03)%1; wm.offset.y = (t*0.01)%1; wm.needsUpdate = true; });
			var emissHex = (0x22 + Math.floor(0x11 * (1+Math.sin(t*5.0))*0.5))<<16;
			['floorCenter','floorLeft','floorRight'].forEach(function(key){
				var m = themeEnv[key] && themeEnv[key].material;
				if (m && m.emissive) m.emissive.setHex(emissHex);
			});
		}
		else if (k === 'Snow Day') {
			if (backMap) { backMap.offset.y = (t*-0.02)%1; backMap.needsUpdate = true; }
			wallMaps.forEach(function(wm){ wm.offset.y = (t*-0.01)%1; wm.needsUpdate = true; });
			if (ambientLight) ambientLight.intensity = 0.6 + 0.03*Math.sin(t*0.8);
		}
		else if (k === 'Cosmic Bowl') {
			if (backMap) { backMap.offset.x = (t*0.01)%1; backMap.needsUpdate = true; }
			wallMaps.forEach(function(wm){ wm.offset.x = (t*0.012)%1; wm.needsUpdate = true; });
		}
	}

	if (players) {
		for (var i = 0; i < players.length; i++) {
			updateGame(players[i], dt);
		}
	}
}

function resizeViewport() {
	camera.aspect = window.innerWidth / window.innerHeight;
	camera.updateProjectionMatrix();
	renderer.setSize(window.innerWidth, window.innerHeight);
	// Reposition the charge bar under the score after layout changes
	positionChargeBarUnderScore();
}

function syncMeshToBody(mesh, body) {
	var transform = body.getCenterOfMassTransform();
	var p = transform.getOrigin();
	var q = transform.getRotation();
	mesh.position.set(p.x(), p.y(), p.z());
	mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
}

function syncView(player) {
	if (player.local || player.physics.simulationActive) {
		player.ballMesh.visible = true;
		syncMeshToBody(player.ballMesh, player.physics.ballBody);
	} else {
		player.ballMesh.visible = false;
	}
	for (var i = 0; i < player.physics.pinBodies.length; i++) {
		var pinBody = player.physics.pinBodies[i];
		var pinMesh = player.pinMeshes[i];
		if (pinBody) {
			pinMesh.visible = true;
			syncMeshToBody(pinMesh, pinBody);
		} else {
			pinMesh.visible = false;
		}
	}

	// Show/hide aim helper as needed
	if (player.local) {
		if (aimingMode && !player.physics.simulationActive) {
			ensureAimHelper(player);
			setAimHelperVisible(player, true);
		} else {
			setAimHelperVisible(player, false);
		}
	}
}

function render() {
	var dt = clock.getDelta();

	updateScene(dt);

	renderer.render(scene, camera);
}

function animate() {
	requestAnimationFrame(animate);

	render();
}

function updateTouchRay(clientX, clientY) {
	var rect = renderer.domElement.getBoundingClientRect();

	touchPoint.x = ((clientX - rect.left) / rect.width) * 2.0 - 1.0;
	touchPoint.y = -((clientY - rect.top) / rect.height) * 2.0 + 1.0;

	raycaster.setFromCamera(touchPoint, camera);
}

function intersectTouchPlane(ray) {
	if (Math.abs(ray.direction.y) > 1e-5) { // ray direction must not be parallel to base plane
		var t = (BASE_HEIGHT - ray.origin.y) / ray.direction.y;
		if (t >= 0.0) {
			dragPoint.copy(ray.direction).multiplyScalar(t).add(ray.origin);
			return true;
		}
	}
	return false;
}

// Helper for Unified Input (Keyboard Enter, Mouse Click, Touch Tap)
function handleGameInputDown() {
	var localPlayer = getLocalPlayer();
	if (!localPlayer) return;
	if (localPlayer.physics.simulationActive) return;
	if (pickingBall || positioningBall || rollingBall) return;

	var sm = (typeof NarbeScanManager !== 'undefined') ? NarbeScanManager : null;
	var isAuto = (sm && sm.getSettings().autoScan);

	// AUTO SCAN: Input confirms position -> go to Aim
	if (isAuto && !aimingMode && !charging) {
		aimingMode = true;
		playSfx('sound/select.wav', 0.6);
		// Reset aim angle to center
		currentAimAngle = 0.0;
		ensureAimHelper(localPlayer);
		updateAimHelper(localPlayer);
		return;
	}

	// AIMING: Input starts charging (if not already)
	if (aimingMode && !charging) {
		charging = true;
		chargeStartTime = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
		if (chargeBar) {
			chargeBar.style.display = "block";
			chargeFill.style.width = "0%";
		}
	}
}

function handleGameInputUp() {
	var localPlayer = getLocalPlayer();
	if (!localPlayer) return;
	if (localPlayer.physics.simulationActive) return;

	var sm = (typeof NarbeScanManager !== 'undefined') ? NarbeScanManager : null;
	var isAuto = (sm && sm.getSettings().autoScan);

	// MANUAL: Input release confirms position -> go to Aim
	if (!isAuto && !aimingMode && !charging) {
		aimingMode = true;
		currentAimAngle = 0.0;
		ensureAimHelper(localPlayer);
		updateAimHelper(localPlayer);
		return;
	}

	// SHARED: Release shot if charging
	if (aimingMode && charging) {
		var now = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
		// Recalculate aim if manual hold was active
		if (aimHeld) {
			var targetT = (sm ? (sm.getScanInterval() / 200.0) : 20.0);
			var omega = 2.0 * Math.PI / targetT; 
			var tauAim = Math.max(0.0, now - aimStartTime);
			currentAimAngle = BALL_ANGLE_MAX * Math.sin(omega * tauAim + aimPhase);
		}

		var held = Math.max(0.0, now - chargeStartTime);
		var k = Math.min(1.0, held / CHARGE_TIME_MAX);
		var kPow = Math.pow(k, CHARGE_POWER_CURVE);
		var velocity = BALL_VELOCITY_MIN + (BALL_VELOCITY_MAX - BALL_VELOCITY_MIN) * kPow;
		
		localPlayer.physics.releaseBall(velocity, currentAimAngle);
		playSfx('sound/rolling-ball.wav', 1.0);
		
		charging = false;
		aimingMode = false;
		aimHeld = false;
		setAimHelperVisible(localPlayer, false);
		if (chargeBar) chargeBar.style.display = "none";
	}
}

function onActionDown(clientX, clientY, time) {
	// If Auto Scan is ON, act as Enter input
	var sm = (typeof NarbeScanManager !== 'undefined') ? NarbeScanManager : null;
	if (sm && sm.getSettings().autoScan) {
		handleGameInputDown();
		return; // Skip drag logic
	}

	var localPlayer = getLocalPlayer();
	if (!localPlayer) {
		return;
	}

	if (localPlayer.physics.simulationActive) {
		return;
	}

	updateTouchRay(clientX, clientY);

	pickingBall = false;
	positioningBall = false;
	rollingBall = false;

	if (!intersectTouchPlane(raycaster.ray)) {
		return;
	}

	pickSphere.center.set(localPlayer.physics.releasePosition, BALL_HEIGHT, BALL_LINE);
	if (raycaster.ray.intersectsSphere(pickSphere)) {
		pickOffset = dragPoint.x - localPlayer.physics.releasePosition;
		pickPoint.copy(dragPoint);
		pickingBall = true;
		pickX = clientX;
		pickY = clientY;
		pickTime = time;
	}
}

function onActionMove(clientX, clientY, time) {
	var localPlayer = getLocalPlayer();
	if (!localPlayer) {
		return;
	}

	if (localPlayer.physics.simulationActive) {
		return;
	}

	updateTouchRay(clientX, clientY);

	if (!intersectTouchPlane(raycaster.ray)) {
		return;
	}

	if (pickingBall) {
		var distX = clientX - pickX;
		var distY = clientY - pickY;
		var grabDistanceSquared = distX * distX + distY * distY;
		if (grabDistanceSquared > ppi * ppi * GRAB_BALL_THRESHOLD_INCH_SQUARED) {
			if ((pickPoint.z - dragPoint.z) * GRAB_BALL_ROLL_POS_RATIO
					> Math.abs(pickPoint.x - dragPoint.x)) {
				rollingBall = true;
			} else {
				positioningBall = true;
			}
			pickingBall = false;
		}
	}

	if (positioningBall) {
		var position = dragPoint.x - pickOffset;
		localPlayer.physics.positionBall(position);
	}
}

function onActionUp(clientX, clientY, time) {
	// If Auto Scan is ON, act as Enter input
	var sm = (typeof NarbeScanManager !== 'undefined') ? NarbeScanManager : null;
	if (sm && sm.getSettings().autoScan) {
		handleGameInputUp();
		pickingBall = false; // Ensure no lingering drag state
		return;
	}

	var localPlayer = getLocalPlayer();
	if (!localPlayer) {
		return;
	}

	if (localPlayer.physics.simulationActive) {
		return;
	}

	if (rollingBall) {
		releaseVector.copy(dragPoint).sub(pickPoint);
		var velocity = (time > pickTime)
				? releaseVector.length() / (1e-3 * (time - pickTime))
				: BALL_VELOCITY_MAX;
		var angle = Math.atan2(-releaseVector.x, -releaseVector.z);
		localPlayer.physics.releaseBall(velocity, angle);
		// SFX: ball rolling
		playSfx('sound/rolling-ball.wav', 1.0);
	}

	pickingBall = false;
	positioningBall = false;
	rollingBall = false;
}

function onDocumentMouseDown(event) {
	event.preventDefault();

	onActionDown(event.clientX, event.clientY, event.timeStamp);
}

function onDocumentMouseMove(event) {
	event.preventDefault();

	onActionMove(event.clientX, event.clientY, event.timeStamp);
}

function onDocumentMouseUp(event) {
	event.preventDefault();

	onActionUp(event.clientX, event.clientY, event.timeStamp);
}

function onDocumentTouchStart(event) {
	var timeStamp = event.timeStamp;
	event.preventDefault();
	event = event.changedTouches[0];

	onActionDown(event.clientX, event.clientY, timeStamp);
}

function onDocumentTouchMove(event) {
	var timeStamp = event.timeStamp;
	event.preventDefault();
	event = event.changedTouches[0];

	onActionMove(event.clientX, event.clientY, timeStamp);
}

function onDocumentTouchEnd(event) {
	var timeStamp = event.timeStamp;
	event.preventDefault();
	event = event.changedTouches[0];

	onActionUp(event.clientX, event.clientY, timeStamp);
}

function onDocumentKeyDown(event) {
	// Menu/paused keyboard controls override gameplay
	if (gameState === 'menu' || gameState === 'paused') {
		if (settingsDiv && settingsDiv.style.display === 'flex') {
			// Settings menu
			if (event.code === 'Space') {
				event.preventDefault();
				if (!settingsScanHeld) {
					settingsScanHeld = true;
					settingsHoldStart = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
					settingsLastBackStep = settingsHoldStart;
				}
				return;
			}
			// Remove Enter handling from keydown for settings
			return; // ignore other keys in settings
		} else {
			// Primary menu for this state (main or pause)
			if (event.code === 'Space') {
				event.preventDefault();
				if (gameState === 'menu') {
					if (!menuScanHeld) {
						menuScanHeld = true;
						menuHoldStart = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
						menuLastBackStep = menuHoldStart;
					}
				} else {
					if (!pauseScanHeld) {
						pauseScanHeld = true;
						pauseHoldStart = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
						pauseLastBackStep = pauseHoldStart;
					}
				}
				return;
			}
			// Remove Enter handling from keydown for menus
			return;
		}
	}
	if (event.code === "Space") {
		// Prevent page scroll on space
		event.preventDefault();

		var localPlayer = getLocalPlayer();
		if (!localPlayer) return;
		if (localPlayer.physics.simulationActive) return;
		if (pickingBall || positioningBall || rollingBall) return;
		if (event.repeat) return;

		if (aimingMode) {
			if (aimHeld) return;
			// Start aiming oscillation
			aimHoldDir = aimNextDir;
			aimNextDir = -aimNextDir;
			aimHeld = true;
			aimStartTime = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
			// Phase from current aim angle
			var Aaim = BALL_ANGLE_MAX;
			var rAim = Math.max(-1.0, Math.min(1.0, (Aaim !== 0.0) ? (currentAimAngle / Aaim) : 0.0));
			var basePhiAim = Math.asin(rAim);
			aimPhase = (aimHoldDir > 0) ? basePhiAim : (Math.PI - basePhiAim);
		} else {
			if (spaceHeld) return;
			// Start position oscillation
			spaceHoldDir = spaceNextDir;
			spaceNextDir = -spaceNextDir;
			spaceHeld = true;
			spaceStartTime = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
			// Phase from current position
			var p0 = localPlayer.physics.releasePosition;
			var A = BALL_POSITION_MAX;
			var r = Math.max(-1.0, Math.min(1.0, (A !== 0.0) ? (p0 / A) : 0.0));
			var basePhi = Math.asin(r);
			spacePhase = (spaceHoldDir > 0) ? basePhi : (Math.PI - basePhi);
		}
		return;
	}

	if (event.code === "Enter") {
		event.preventDefault();
		// Track Enter hold for pause when playing
		if (!event.repeat) {
			enterHeld = true;
			enterHoldStart = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
		}
		var localPlayer = getLocalPlayer();
		if (!localPlayer) return;
		if (localPlayer.physics.simulationActive) return;
		if (pickingBall || positioningBall || rollingBall) return;

		// Use unified input handler
		handleGameInputDown();
		return;
	}
}

function onDocumentKeyUp(event) {
	if (gameState === 'menu' || gameState === 'paused') {
		if (settingsDiv && settingsDiv.style.display === 'flex') {
			if (event.code === 'Space') {
				event.preventDefault();
				// If released before 3s, move forward one selection; else stop scanning
				var t = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
				var held = Math.max(0.0, t - settingsHoldStart);
				if (held < 3.0) {
					settingsFocusIndex = (settingsFocusIndex + 1) % settingsItems.length;
					applySettingsFocus();
				}
				settingsScanHeld = false;
				return;
			}
			if (event.code === 'Enter') {
				event.preventDefault();
				handleSettingsEnter();
				return;
			}
			return;
		} else {
			if (event.code === 'Space') {
				event.preventDefault();
				var t2 = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
				if (gameState === 'menu') {
					var held2 = Math.max(0.0, t2 - menuHoldStart);
					if (held2 < 3.0) {
						menuFocusIndex = (menuFocusIndex + 1) % mainMenuItems.length;
						applyMenuFocus();
					}
					menuScanHeld = false;
				} else {
					var heldP = Math.max(0.0, t2 - pauseHoldStart);
					if (heldP < 3.0) {
						pauseFocusIndex = (pauseFocusIndex + 1) % pauseMenuItems.length;
						applyPauseFocus();
					}
					pauseScanHeld = false;
				}
				return;
			}
			if (event.code === 'Enter') {
				event.preventDefault();
				// Prevent key-repeat from immediately activating default choice when a menu just opened
				if (event.repeat) return;
				if (gameState === 'menu') handleMainMenuEnter(); else handlePauseMenuEnter();
				return;
			}
			return;
		}
	}
	if (event.code === "Space") {
		event.preventDefault();
		if (aimingMode) {
			if (!aimHeld) return;
			aimHeld = false;
		} else {
			if (!spaceHeld) return;
			spaceHeld = false;
		}
		return;
	}

	if (event.code === "Enter") {
		event.preventDefault();
		// Stop tracking enter hold
		enterHeld = false;
		var localPlayer = getLocalPlayer();
		if (!localPlayer) return;
		if (localPlayer.physics.simulationActive) return;

		// First Enter release: enter aiming mode
		if (!aimingMode && !charging) {
			aimingMode = true;
			currentAimAngle = 0.0; // start centered
			ensureAimHelper(localPlayer);
			updateAimHelper(localPlayer);
			return;
		}

		// If charging, release the shot
		if (aimingMode && charging) {
			var now = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
			// Ensure aim angle is current at release moment
			if (aimHeld) {
				var targetT = (typeof NarbeScanManager !== 'undefined') ? (NarbeScanManager.getScanInterval() / 200.0) : 20.0;
				var T = targetT; 
				var omega = 2.0 * Math.PI / T; var tauAim = Math.max(0.0, now - aimStartTime);
				currentAimAngle = BALL_ANGLE_MAX * Math.sin(omega * tauAim + aimPhase);
			}
			var held = Math.max(0.0, now - chargeStartTime);
			var k = Math.min(1.0, held / CHARGE_TIME_MAX);
			var kPow = Math.pow(k, CHARGE_POWER_CURVE); // non-linear power mapping
			var velocity = BALL_VELOCITY_MIN + (BALL_VELOCITY_MAX - BALL_VELOCITY_MIN) * kPow;

			// Fire!
			localPlayer.physics.releaseBall(velocity, currentAimAngle);
			// SFX: ball rolling
			playSfx('sound/rolling-ball.wav', 1.0);

			// Cleanup aiming state
			charging = false;
			aimingMode = false;
			aimHeld = false;
			setAimHelperVisible(localPlayer, false);
			if (chargeBar) chargeBar.style.display = "none";
			return;
		}
	}
}

function handleMainMenuEnter() {
	if (menuFocusIndex < 0) return; // No selection yet
	var idx = menuFocusIndex % mainMenuItems.length;
	if (idx === 0) { // Play Game
		startGame();
	} else if (idx === 1) { // Settings
		showSettings();
		applySettingsFocus();
	} else if (idx === 2) { // Exit Game
		exitGame();
	}
}

function handlePauseMenuEnter() {
	if (pauseFocusIndex < 0) return; // No selection yet
	var idx = pauseFocusIndex % pauseMenuItems.length;
	if (idx === 0) { // Continue Game
		resumeGame();
	} else if (idx === 1) { // Settings
		showSettings();
		// Reset settings scan for consistent top-to-bottom order
		settingsFocusIndex = 0; settingsScanHeld = false; applySettingsFocus();
	} else if (idx === 2) { // Main Menu
		hidePauseMenu();
		returnToMenu();
	}
}

function handleSettingsEnter() {
	var item = settingsItems[settingsFocusIndex % settingsItems.length];
	if (!item) return;
	if (typeof item.action === 'function') item.action();
}

// ---------- Menu and Settings UI ----------
function loadSettings() {
	try {
		var raw = localStorage.getItem('benny_settings');
		if (raw) {
			var obj = JSON.parse(raw);
			settings.tts = !!obj.tts;
			settings.music = !!obj.music;
			settings.sfx = !!obj.sfx;
			settings.voiceIndex = obj.voiceIndex | 0;
			if (typeof obj.ballStyleIndex === 'number') {
				settings.ballStyleIndex = obj.ballStyleIndex | 0;
			} else if (typeof obj.ballColorIndex === 'number') {
				// Backward compatibility: map old color index to a style
				settings.ballStyleIndex = (obj.ballColorIndex | 0);
			}
			if (typeof obj.themeIndex === 'number') {
				settings.themeIndex = obj.themeIndex | 0;
			}
			// Load aimer color if present (independent of themeIndex)
			if (typeof obj.aimerColorIndex === 'number') {
				settings.aimerColorIndex = obj.aimerColorIndex | 0;
			}
		}
	} catch (e) {}
	
	// Sync with NarbeVoiceManager if available - ALWAYS use voice manager as source of truth
	try {
		if (window.NarbeVoiceManager) {
			// Wait a bit for voice manager to fully initialize
			setTimeout(function() {
				try {
					var vmSettings = window.NarbeVoiceManager.getSettings();
					// Always use voice manager's TTS setting as source of truth
					settings.tts = vmSettings.ttsEnabled;
					// Sync voice index if available
					if (typeof vmSettings.voiceIndex === 'number') {
						settings.voiceIndex = vmSettings.voiceIndex;
					}
					console.log('Bowling: Synced with voice manager - TTS:', settings.tts, 'Voice:', settings.voiceIndex);
					
					// Update localStorage to match voice manager
					try {
						localStorage.setItem('benny_settings', JSON.stringify(settings));
					} catch(e) {}
				} catch(e) {
					console.error('Bowling: Failed to sync with voice manager:', e);
				}
			}, 100);
		} else {
			console.warn('Bowling: Voice manager not available');
		}
	} catch(e) {
		console.error('Bowling: Error accessing voice manager:', e);
	}
}

function saveSettings() {
	try {
		localStorage.setItem('benny_settings', JSON.stringify(settings));
		
		// Sync TTS setting to voice manager without overriding its current voice
		if (window.NarbeVoiceManager) {
			try {
				// Pull current voice index from the manager to keep local settings in sync
				if (typeof window.NarbeVoiceManager.getSettings === 'function') {
					var vmSettings = window.NarbeVoiceManager.getSettings();
					if (vmSettings && typeof vmSettings.voiceIndex === 'number') {
						settings.voiceIndex = vmSettings.voiceIndex;
						try { localStorage.setItem('benny_settings', JSON.stringify(settings)); } catch(_){}
					}
				}
				// Only update TTS enabled flag; do not pass voiceIndex here to avoid unintended resets
				window.NarbeVoiceManager.updateSettings({ 
					ttsEnabled: settings.tts
				});
				console.log('Bowling: Updated voice manager - TTS:', settings.tts);
			} catch(e) {
				console.error('Bowling: Failed to update voice manager:', e);
			}
		}
	} catch (e) {}
}

function buildMenus() {
	loadSettings();
	buildThemes();
	buildBallSkins();

	// Main Menu
	mainMenuDiv = document.createElement('div');
	mainMenuDiv.style = "position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background: radial-gradient(ellipse at center, rgba(10,10,20,0.9) 0%, rgba(5,5,10,0.95) 60%, rgba(0,0,0,1) 100%); z-index:2000;";
	var box = document.createElement('div');
	box.style = "min-width:420px; padding:24px 28px; border:3px solid #00ff99; border-radius:12px; background:rgba(0,0,0,0.4); box-shadow:0 0 24px #00ff99; text-align:center;";
	var title = document.createElement('div');
	title.textContent = "Benny's Bowling";
	title.style = "font-family: 'Courier New', monospace; font-size: 34px; color:#00ffcc; letter-spacing:2px; text-shadow:0 0 8px #00ff99, 0 0 16px #00ffaa; margin-bottom:18px;";
	// Base button: black background with green text
	var btnStyle = "display:block; width:100%; padding:10px 14px; margin:10px 0; color:#00ff99; background:#000000; border:2px solid #00ff99; border-radius:8px; font-weight:800; letter-spacing:1px; cursor:pointer; box-shadow:0 0 10px #00ff99;";
	var playBtn = document.createElement('button');
	playBtn.textContent = 'PLAY GAME';
	playBtn.style = btnStyle;
	playBtn.onclick = () => startGame();
	var settingsBtn = document.createElement('button');
	settingsBtn.textContent = 'SETTINGS';
	settingsBtn.style = btnStyle;
	settingsBtn.onclick = () => showSettings();
	var exitBtn = document.createElement('button');
	exitBtn.textContent = 'EXIT GAME';
	exitBtn.style = btnStyle;
	exitBtn.onclick = () => exitGame();
	box.appendChild(title);
	box.appendChild(playBtn);
	box.appendChild(settingsBtn);
	box.appendChild(exitBtn);
	mainMenuDiv.appendChild(box);
	document.body.appendChild(mainMenuDiv);

	// Settings Panel
	settingsDiv = document.createElement('div');
	settingsDiv.style = "position:fixed; inset:0; display:none; align-items:center; justify-content:center; background: radial-gradient(ellipse at center, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.9) 60%, rgba(0,0,0,1) 100%); z-index:2100;";
	var sbox = document.createElement('div');
	sbox.style = "min-width:480px; padding:20px 24px; border:3px solid #00ff99; border-radius:12px; background:rgba(0,0,0,0.4); color:#eaffff; font-family: 'Courier New', monospace; box-shadow:0 0 24px #00ff99;";
	sbox.innerHTML = "<div style='font-weight:800; font-size:22px; margin-bottom:8px; color:#00ffcc; text-shadow:0 0 8px #00ff99;'>Settings</div>";

	function makeRow(getLabel, getValue, onEnter, withSwatch) {
		var row = document.createElement('div');
		row.style = "display:flex; align-items:center; justify-content:space-between; margin:10px 0; padding:8px 10px; border:2px solid #00ff99; border-radius:8px; background: rgba(0, 20, 14, 0.35); box-shadow: 0 0 8px #00ff99 inset;";
		var left = document.createElement('div'); left.textContent = getLabel(); left.style = 'color:#00ffcc; font-weight:800; letter-spacing:1px;';
		var rightWrap = document.createElement('div'); rightWrap.style = 'display:flex; align-items:center; gap:10px;';
		var val = document.createElement('div'); val.textContent = getValue(); val.style = 'font-weight:700; color:#cffff6;';
		rightWrap.appendChild(val);
		var swatch = null;
		if (withSwatch) {
			swatch = document.createElement('div'); swatch.style = 'width:26px; height:26px; border-radius:50%; border:2px solid #00ffcc; box-shadow:0 0 10px #00ffcc; background:#008866;';
			rightWrap.appendChild(swatch);
		}
		row.appendChild(left); row.appendChild(rightWrap);
		row._update = () => { val.textContent = getValue(); if (swatch) updateBallSwatch(swatch); };
		row.onclick = onEnter;
		sbox.appendChild(row);
		return row;
	}

	function getEnglishVoices() {
		if (!('speechSynthesis' in window)) return [];
		var voices = window.speechSynthesis.getVoices() || [];
		var english = voices.filter(function(v){ return v && v.lang && v.lang.toLowerCase().startsWith('en'); });
		english.sort(function(a,b){
			if (a.default && !b.default) return -1;
			if (!a.default && b.default) return 1;
			var la = (a.lang||''); var lb = (b.lang||'');
			if (la < lb) return -1; if (la > lb) return 1;
			var na = (a.name||''); var nb = (b.name||'');
			if (na < nb) return -1; if (na > nb) return 1;
			return 0;
		});
		var limited = [];
		var seen = new Set();
		for (var i=0; i<english.length && limited.length<8; i++) {
			var nm = english[i].name || ('Voice '+i);
			if (!seen.has(nm)) { limited.push(english[i]); seen.add(nm); }
		}
		return limited;
	}

	function getVoiceName() {
		// Use unified voice manager for current voice and a short display name
		if (window.NarbeVoiceManager) {
			const current = window.NarbeVoiceManager.getCurrentVoice();
			return window.NarbeVoiceManager.getVoiceDisplayName(current);
		}
		return 'Default';
	}

	function cycleVoice() {
		if (!window.NarbeVoiceManager) return;
		window.NarbeVoiceManager.cycleVoice();
		var newVoice = window.NarbeVoiceManager.getCurrentVoice();
		var displayName = window.NarbeVoiceManager.getVoiceDisplayName(newVoice);
		// Persist the selected voice index so later saves do not revert it
		try {
			var vmSettings = window.NarbeVoiceManager.getSettings && window.NarbeVoiceManager.getSettings();
			if (vmSettings && typeof vmSettings.voiceIndex === 'number') {
				settings.voiceIndex = vmSettings.voiceIndex;
				try { localStorage.setItem('benny_settings', JSON.stringify(settings)); } catch(_){}
			}
		} catch(_){}
		speakText('Voice changed to ' + displayName);
	}

	function updateBallSwatch(el) {
		var skin = BALL_SKINS[Math.abs(settings.ballStyleIndex) % BALL_SKINS.length];
		if (skin && skin.preview) {
			el.style.background = `url(${skin.preview}) center/cover no-repeat, #003322`;
		}
	}

	function cycleBallStyle() {
		settings.ballStyleIndex = (settings.ballStyleIndex + 1) % BALL_SKINS.length;
		saveSettings();
		applyBallStyleToLocal();
		try {
			var skin = BALL_SKINS[Math.abs(settings.ballStyleIndex) % BALL_SKINS.length];
			if (skin && skin.name) speakText('Ball style ' + skin.name);
		} catch(e) {}
	}

	var ttsRow = makeRow(()=>'TTS', ()=> window.NarbeVoiceManager ? (window.NarbeVoiceManager.getSettings().ttsEnabled ? 'ON':'OFF') : 'OFF', ()=>{ 
		if (window.NarbeVoiceManager) {
			window.NarbeVoiceManager.toggleTTS(); 
			var newState = window.NarbeVoiceManager.getSettings().ttsEnabled;
			speakText(newState ? 'TTS enabled' : 'TTS disabled');
		}
		ttsRow._update(); 
	}, false);
	var musicRow = makeRow(()=>'Music', ()=> settings.music? 'ON':'OFF', ()=>{ settings.music=!settings.music; saveSettings(); applySettings(); musicRow._update(); }, false);
	var sfxRow = makeRow(()=>'Sound Effects', ()=> settings.sfx? 'ON':'OFF', ()=>{ settings.sfx=!settings.sfx; saveSettings(); SFX_ENABLED = !!settings.sfx; sfxRow._update(); }, false);
	var voiceRow = makeRow(()=>'Voice', ()=> getVoiceName(), ()=>{ cycleVoice(); voiceRow._update(); }, false);
	var autoScanRow = makeRow(()=>'Auto Scan', ()=> (window.NarbeScanManager && window.NarbeScanManager.getSettings().autoScan) ? 'ON' : 'OFF', ()=>{
		if (window.NarbeScanManager) {
			window.NarbeScanManager.toggleAutoScan();
			var newState = window.NarbeScanManager.getSettings().autoScan;
			speakText(newState ? 'Auto scan on' : 'Auto scan off');
			autoScanRow._update();
			scanSpeedRow._update();
		}
	}, false);
	var scanSpeedRow = makeRow(()=>'Scan Speed', ()=> (window.NarbeScanManager ? (window.NarbeScanManager.getScanInterval()/1000).toFixed(1)+'s' : '2.0s'), ()=>{
		if (window.NarbeScanManager) {
			window.NarbeScanManager.cycleScanSpeed();
			var newSpeed = (window.NarbeScanManager.getScanInterval()/1000).toFixed(1)+'s';
			speakText('Scan speed ' + newSpeed);
			scanSpeedRow._update();
		}
	}, false);
	var ballRow = makeRow(()=>'Ball Style', ()=> BALL_SKINS[Math.abs(settings.ballStyleIndex)%BALL_SKINS.length].name, ()=>{ cycleBallStyle(); ballRow._update(); }, true);
	// Alley Theme row (place after Ball Style)
	function getThemeName(){ return THEMES.length ? THEMES[Math.abs(settings.themeIndex)%THEMES.length].name : 'Default'; }
	function cycleTheme(){ settings.themeIndex = (settings.themeIndex + 1) % THEMES.length; saveSettings(); applyTheme(settings.themeIndex); try { var t = THEMES[Math.abs(settings.themeIndex)%THEMES.length]; if (t && t.name) speakText('Theme ' + t.name); } catch(e) {} }
	var themeRow = makeRow(()=>'Alley Theme', ()=> getThemeName(), ()=>{ cycleTheme(); themeRow._update(); }, false);
	// Aimer Color row
	function getAimerColorName(){ var c=AIM_COLORS[Math.abs(settings.aimerColorIndex)%AIM_COLORS.length]; return c?c.name:'Green'; }
	function cycleAimerColor(){ settings.aimerColorIndex=(settings.aimerColorIndex+1)%AIM_COLORS.length; saveSettings(); applyAimerStyleToLocal(); try{ speakText && speakText('Aimer color ' + getAimerColorName()); }catch(e){} }
	var aimerRow = makeRow(()=>'Aimer Color', ()=> getAimerColorName(), ()=>{ cycleAimerColor(); aimerRow._update(); }, false);
	var closeRow = document.createElement('div');
	closeRow.style = 'display:flex; justify-content:flex-end; margin-top:12px;';
	var closeBtn = document.createElement('button'); closeBtn.textContent = 'Close'; closeBtn.style = 'padding:10px 14px; color:#00ff99; background:#000000; border:2px solid #00ff99; border-radius:8px; font-weight:800; letter-spacing:1px; cursor:pointer; box-shadow:0 0 10px #00ff99;';
	closeBtn.onclick = () => hideSettings();
	closeRow.appendChild(closeBtn);
	sbox.appendChild(closeRow);
	settingsDiv.appendChild(sbox);
	document.body.appendChild(settingsDiv);

	// Pause Menu
	pauseMenuDiv = document.createElement('div');
	pauseMenuDiv.style = "position:fixed; inset:0; display:none; align-items:center; justify-content:center; background: radial-gradient(ellipse at center, rgba(10,10,20,0.9) 0%, rgba(5,5,10,0.95) 60%, rgba(0,0,0,1) 100%); z-index:2050;";
	var pbox = document.createElement('div');
	pbox.style = "min-width:420px; padding:24px 28px; border:3px solid #00ff99; border-radius:12px; background:rgba(0,0,0,0.4); box-shadow:0 0 24px #00ff99; text-align:center;";
	var ptitle = document.createElement('div');
	ptitle.textContent = "Paused";
	ptitle.style = "font-family: 'Courier New', monospace; font-size: 30px; color:#00ffcc; letter-spacing:2px; text-shadow:0 0 8px #00ff99, 0 0 16px #00ffaa; margin-bottom:18px;";
	var pbtnStyle = "display:block; width:100%; padding:10px 14px; margin:10px 0; color:#00ff99; background:#000000; border:2px solid #00ff99; border-radius:8px; font-weight:800; letter-spacing:1px; cursor:pointer; box-shadow:0 0 10px #00ff99;";
	var continueBtn = document.createElement('button'); continueBtn.textContent = 'CONTINUE GAME'; continueBtn.style = pbtnStyle; continueBtn.onclick = ()=> resumeGame();
	var psettingsBtn = document.createElement('button'); psettingsBtn.textContent = 'SETTINGS'; psettingsBtn.style = pbtnStyle; psettingsBtn.onclick = ()=> { showSettings(); };
	var pmenuBtn = document.createElement('button'); pmenuBtn.textContent = 'MAIN MENU'; pmenuBtn.style = pbtnStyle; pmenuBtn.onclick = ()=> { hidePauseMenu(); returnToMenu(); };
	pbox.appendChild(ptitle); pbox.appendChild(continueBtn); pbox.appendChild(psettingsBtn); pbox.appendChild(pmenuBtn);
	pauseMenuDiv.appendChild(pbox);
	document.body.appendChild(pauseMenuDiv);

	// Game Over Screen
	gameOverDiv = document.createElement('div');
	gameOverDiv.style = "position:fixed; inset:0; display:none; align-items:center; justify-content:center; background: radial-gradient(ellipse at center, rgba(10,10,20,0.9) 0%, rgba(5,5,10,0.95) 60%, rgba(0,0,0,1) 100%); z-index:2100;";
	var gobox = document.createElement('div');
	gobox.style = "min-width:420px; padding:24px 28px; border:3px solid #00ff99; border-radius:12px; background:rgba(0,0,0,0.55); box-shadow:0 0 24px #00ff99; text-align:center;";
	var gotitle = document.createElement('div');
	gotitle.textContent = "Game Over";
	gotitle.style = "font-family: 'Courier New', monospace; font-size: 32px; color:#00ffcc; letter-spacing:2px; text-shadow:0 0 8px #00ff99, 0 0 16px #00ffaa; margin-bottom:12px;";
	var goscore = document.createElement('div');
	goscore.id = 'bb_game_over_score';
	goscore.style = "font-family: 'Courier New', monospace; font-size: 26px; color:#eaffff; margin-top:6px;";
	gobox.appendChild(gotitle); gobox.appendChild(goscore);
	gameOverDiv.appendChild(gobox);
	document.body.appendChild(gameOverDiv);

	if ('speechSynthesis' in window) {
		window.speechSynthesis.onvoiceschanged = ()=>{ if (voiceRow && typeof voiceRow._update === 'function') voiceRow._update(); };
	}

	applySettings();
	// Apply initial theme
	applyTheme(settings.themeIndex|0);

	// Collect items for keyboard scanning (same order as rendered)
	mainMenuItems = [playBtn, settingsBtn, exitBtn];
	menuFocusIndex = -1;
	// Don't apply focus initially - user must press spacebar first

	pauseMenuItems = [continueBtn, psettingsBtn, pmenuBtn];
	pauseFocusIndex = -1;
	// Don't apply focus initially - user must press spacebar first

	settingsItems = [
		{ el: ttsRow, action: ()=> ttsRow.onclick() },
		{ el: musicRow, action: ()=> musicRow.onclick() },
		{ el: sfxRow, action: ()=> sfxRow.onclick() },
		{ el: voiceRow, action: ()=> voiceRow.onclick() },
		{ el: autoScanRow, action: ()=> autoScanRow.onclick() },
		{ el: scanSpeedRow, action: ()=> scanSpeedRow.onclick() },
		{ el: ballRow, action: ()=> ballRow.onclick() },
		{ el: themeRow, action: ()=> themeRow.onclick() },
		{ el: aimerRow, action: ()=> aimerRow.onclick() },
		{ el: closeBtn, action: ()=> closeBtn.onclick() }
	];
	settingsFocusIndex = 0;
}

function applyMenuFocus() {
	mainMenuItems.forEach((el, idx) => {
		var focused = (idx === menuFocusIndex && menuFocusIndex >= 0);
		el.style.outline = focused ? '3px solid #00ff99' : 'none';
		el.style.boxShadow = focused ? '0 0 16px #00ff99' : '0 0 10px #00ff99';
		el.style.background = focused ? '#00ff99' : '#000000';
		el.style.color = focused ? '#000000' : '#00ff99';
	});
	// TTS announce focused item only if something is selected
	if (menuFocusIndex >= 0) {
		try {
			var label = mainMenuItems[menuFocusIndex] && mainMenuItems[menuFocusIndex].textContent;
			if (label) speakText(label);
		} catch(e) {}
	}
}

function applyPauseFocus() {
	pauseMenuItems.forEach((el, idx) => {
		var focused = (idx === pauseFocusIndex && pauseFocusIndex >= 0);
		el.style.outline = focused ? '3px solid #00ff99' : 'none';
		el.style.boxShadow = focused ? '0 0 16px #00ff99' : '0 0 10px #00ff99';
		el.style.background = focused ? '#00ff99' : '#000000';
		el.style.color = focused ? '#000000' : '#00ff99';
	});
	// TTS announce focused item only if something is selected
	if (pauseFocusIndex >= 0) {
		try {
			var label = pauseMenuItems[pauseFocusIndex] && pauseMenuItems[pauseFocusIndex].textContent;
			if (label) speakText(label);
		} catch(e) {}
	}
}

function applySettingsFocus() {
	settingsItems.forEach((item, idx) => {
		var el = item.el;
		var focused = (idx === settingsFocusIndex);
		el.style.outline = focused ? '3px solid #00ff99' : 'none';
		el.style.boxShadow = focused ? '0 0 14px #00ff99' : 'none';
		el.style.background = focused ? '#00ff99' : 'rgba(0, 20, 14, 0.35)';
		// Tweak child text colors for contrast
		var left = el.firstChild; var right = el.lastChild; // as constructed
		if (left && left.style) left.style.color = focused ? '#000000' : '#00ffcc';
		if (right && right.firstChild && right.firstChild.style) right.firstChild.style.color = focused ? '#000000' : '#cffff6';
	});
	// TTS announce focused setting label
	try {
		var el = settingsItems[settingsFocusIndex] && settingsItems[settingsFocusIndex].el;
		var label = el && el.firstChild && el.firstChild.textContent;
		if (label) speakText(label);
	} catch(e) {}
}

function exitGame() {
	try {
        // Updated Exit Logic:
		// Try to message parent window to focus the back button
		if (window.parent && window.parent !== window) {
			window.parent.postMessage({ action: 'focusBackButton' }, '*');
		} else {
            // Navigate to Hub root if not in iframe
            location.href = '../../../index.html';
        }
	} catch(err) {
		// Fallback
		try {
			window.location.replace('../../../index.html');
		} catch(_) {
			// Last resort
			window.location.href = '../../..';
		}
	}
}

function showMainMenu() { if (mainMenuDiv) mainMenuDiv.style.display = 'flex'; gameState = 'menu'; }
function hideMainMenu() { if (mainMenuDiv) mainMenuDiv.style.display = 'none'; }
function showSettings() {
	if (settingsDiv) {
		settingsDiv.style.display = 'flex';
		// Ensure scanning starts at the top and proceeds one-by-one
		settingsFocusIndex = 0;
		settingsScanHeld = false;
		settingsHoldStart = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
		applySettingsFocus();
	}
}
function hideSettings() { if (settingsDiv) settingsDiv.style.display = 'none'; }
function showPauseMenu() { if (pauseMenuDiv) pauseMenuDiv.style.display = 'flex'; }
function hidePauseMenu() { if (pauseMenuDiv) pauseMenuDiv.style.display = 'none'; }

function openPauseMenu() {
	// Cancel aim/charge UI if any
	var p = getLocalPlayer();
	if (p) {
		aimingMode = false; aimHeld = false; charging = false; setAimHelperVisible(p, false);
	}
	if (chargeBar) chargeBar.style.display = 'none';
	gameState = 'paused';
	showPauseMenu();
	// reset scanning timers for pause menu
	pauseScanHeld = false; pauseFocusIndex = -1;
	// Reset auto scan timer to prevent immediate selection
	autoScanLastTime = (typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : 0.0;
	updatePauseUIButtonVisibility();
	updateHelpTipsVisibility();
}

function resumeGame() {
	hideSettings();
	hidePauseMenu();
	gameState = 'playing';
	// reset scanning states
	pauseScanHeld = false; menuScanHeld = false; settingsScanHeld = false;
	updatePauseUIButtonVisibility();
	updateHelpTipsVisibility();
}

function applySettings() {
	// Music
	if (!musicEl) {
		musicEl = document.createElement('audio');
		musicEl.loop = true; musicEl.volume = 0.25;
		// Use the requested music track
		musicEl.src = 'music/music (1).mp3';
		document.body.appendChild(musicEl);
	}
	if (settings.music && userHasInteracted) { 
		musicEl.play().catch(function(err){
			console.log('Music playback blocked:', err);
		}); 
	} else { 
		try { musicEl.pause(); } catch(e){} 
	}

	// Reflect SFX toggle for helper
	SFX_ENABLED = !!settings.sfx;
}

function updatePauseUIButtonVisibility() {
	try {
		if (!pauseUIButton) return;
		pauseUIButton.style.display = (gameState === 'playing') ? 'block' : 'none';
	} catch(e){}
}

// Toggle help tips visibility based on current game state
function updateHelpTipsVisibility() {
	try {
		if (!helpTipsDiv) return;
		helpTipsDiv.style.display = (gameState === 'playing') ? 'block' : 'none';
	} catch(e){}
}

function startGame() {
	// Mark that user has interacted (required for audio autoplay)
	userHasInteracted = true;
	
	hideMainMenu(); hideSettings();
	// Clean previous players
	if (players && players.length) {
		for (var i = players.length - 1; i >= 0; i--) {
			removePlayer(players[i].id);
		}
	}
	var player = addPlayer(0, true, 0);
	// Apply current ball style to the new player's ball
	applyBallStyle(player.ballMesh, settings.ballStyleIndex);
	// Reset UI elements
	aimingMode = false; aimHeld = false; charging = false;
	if (chargeBar) chargeBar.style.display = 'none';
	renderScoreboard(player.scores);
	gameState = 'playing';
	// Start ambient bowling background (only if user has interacted)
	if (userHasInteracted) {
		ensureAmbient();
		if (ambientEl) { 
			ambientEl.play().catch(function(err){
				console.log('Ambient audio blocked:', err);
			}); 
		}
	}
	// Reset menu scanning states
	menuScanHeld = false; settingsScanHeld = false;
	menuFocusIndex = -1; settingsFocusIndex = 0;
	updatePauseUIButtonVisibility();
	updateHelpTipsVisibility();
}

function returnToMenu() {
	// Remove all players from scene
	if (players && players.length) {
		for (var i = players.length - 1; i >= 0; i--) {
			removePlayer(players[i].id);
		}
	}
	// Hide game over overlay if visible
	if (gameOverDiv) gameOverDiv.style.display = 'none';
	showMainMenu();
	updatePauseUIButtonVisibility();
	updateHelpTipsVisibility();
	// Stop ambient loop
	stopAmbient();
}

function showGameOver(finalScore) {
	try {
		if (!gameOverDiv) returnToMenu();
		var label = document.getElementById('bb_game_over_score');
		if (label) { label.textContent = 'Final Score: ' + (finalScore||0); }
		// End gameplay state
		gameState = 'menu';
		if (pauseUIButton) pauseUIButton.style.display = 'none';
		if (gameOverDiv) gameOverDiv.style.display = 'flex';
		updateHelpTipsVisibility();
		// Return to main menu after a short delay
		setTimeout(function(){ returnToMenu(); }, 7500);
	} catch(e) { returnToMenu(); }
}

// ------- Strike celebration overlay -------
function showStrikeCelebration() {
	try {
		if (!celebrationDiv) return;
		// Set message and reset styles for pop-in
		celebrationDiv.textContent = 'STRIKE!';
		celebrationDiv.style.opacity = '0';
		celebrationDiv.style.transform = 'translate(-50%, -50%) scale(0.8)';

		// Kick in on next frame for transition
		requestAnimationFrame(function(){
			celebrationDiv.style.opacity = '1';
			celebrationDiv.style.transform = 'translate(-50%, -50%) scale(1)';
		});

		// Clear previous timers
		if (celebrationHideTimer) { try { clearTimeout(celebrationHideTimer); } catch(e){} }
		// Hide after a short moment with a slight lift
		celebrationHideTimer = setTimeout(function(){
			celebrationDiv.style.opacity = '0';
			celebrationDiv.style.transform = 'translate(-50%, -58%) scale(1.08)';
		}, 1200);
	} catch(e) {}
}

// Back-compat wrapper now delegates to style-based application
function applyBallColorToLocal() {
	applyBallStyleToLocal();
}

function applyBallStyleToLocal() {
	var p = getLocalPlayer(); if (!p) return;
	applyBallStyle(p.ballMesh, settings.ballStyleIndex);
	// Refresh aimer style as well
	applyAimerStyleToLocal();
}

function applyBallStyle(ballMesh, styleIdx) {
	if (!BALL_SKINS || !BALL_SKINS.length) return;
	var skin = BALL_SKINS[Math.abs(styleIdx|0) % BALL_SKINS.length];
	if (skin && typeof skin.apply === 'function') {
		try { skin.apply(ballMesh); } catch(e) {}
	}
}

function applyBallColor(ballMesh, colorIdx) {
	var hex = BALL_COLORS[(colorIdx|0) % BALL_COLORS.length];
	ballMesh.traverse(function(obj){
		if (obj.isMesh && obj.material) {
			if (obj.material.color) obj.material.color.setHex(hex);
			if (obj.material.emissive) obj.material.emissive.setHex(0x000000);
		}
	});
}

function ensureAimHelper(player) {
	if (player.aimHelper) { return; }
	var group = new THREE.Group();
	// Shorter length so it doesn’t reach pins
	var totalLen = Math.max(3.0, LANE_LENGTH * 0.7);
	var colHex = (AIM_COLORS[Math.abs(settings.aimerColorIndex)%AIM_COLORS.length]||AIM_COLORS[2]).hex;
	var dashSize = 0.35, gapSize = 0.22, lineRadius = 0.045;
	var segCount = Math.max(1, Math.floor(totalLen / (dashSize + gapSize)));
	var segments = [];
	for (var i = 0; i < segCount; i++) {
		var cylGeo = new THREE.CylinderGeometry(lineRadius, lineRadius, dashSize, 14, 1, true);
		var cylMat = new THREE.MeshBasicMaterial({ color: colHex, transparent: true, opacity: 0.7, depthTest: true });
		var seg = new THREE.Mesh(cylGeo, cylMat);
		seg.rotation.x = Math.PI / 2; // align along Z
		var z0 = - (i * (dashSize + gapSize) + dashSize * 0.5);
		seg.position.set(0, 0, z0);
		segments.push(seg);
		group.add(seg);
	}
	// Place below the ball so it renders under it
	var yOffset = -Math.max(0.0, (typeof BALL_RADIUS === 'number' ? BALL_RADIUS : 0.12) * 0.9);
	group.userData = { segments: segments, totalLen: totalLen, dashSize: dashSize, gapSize: gapSize, lineRadius: lineRadius, yOffset: yOffset };
	player.ballMesh.parent.add(group);
	player.aimHelper = group;
	setAimHelperVisible(player, false);
}

function setAimHelperVisible(player, visible) {
	if (player && player.aimHelper) {
		player.aimHelper.visible = !!visible;
	}
}

function updateAimHelper(player) {
	if (!player || !player.aimHelper) return;
	var ballPos = player.ballMesh.position;
	var yOff = (player.aimHelper.userData && typeof player.aimHelper.userData.yOffset === 'number') ? player.aimHelper.userData.yOffset : -0.1;
	player.aimHelper.position.set(ballPos.x, ballPos.y + yOff, ballPos.z);
	player.aimHelper.rotation.set(0, currentAimAngle, 0);
}

function applyAimerStyleToLocal() {
	var p = getLocalPlayer(); 
	if (!p || !p.aimHelper) return;
	
	// Get the new color from settings
	var colHex = (AIM_COLORS[Math.abs(settings.aimerColorIndex)%AIM_COLORS.length]||AIM_COLORS[2]).hex;
	
	// Update all the aim helper segments with the new color
	if (p.aimHelper.userData && p.aimHelper.userData.segments) {
		p.aimHelper.userData.segments.forEach(function(seg) {
			if (seg && seg.material) {
				seg.material.color.setHex(colHex);
				seg.material.needsUpdate = true;
			}
		});
	}
}

function renderScoreboard(scores) {
	// Inline styles for a compact bowling scoreboard
	var sbStyle = "display:flex; gap:6px; align-items:flex-start; background:rgba(0,0,0,0.25); padding:8px 10px; border-radius:10px; backdrop-filter: blur(2px); color:#fff; font-family: system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,sans-serif;";
	var frameStyle = "display:flex; flex-direction:column; border:2px solid rgba(255,255,255,0.6); border-radius:6px; overflow:hidden; background:rgba(0,0,0,0.25);";
	var shotsStyle = "display:flex; gap:2px; padding:2px; justify-content:center; align-items:center; background:rgba(255,255,255,0.08);";
	var boxStyle = "min-width:20px; height:20px; display:flex; align-items:center; justify-content:center; font-weight:600;";
	var totalStyle = "padding:2px 4px; text-align:center; min-height:18px; font-size:12px;";

	function box(content) {
		var txt = (content && content !== " ") ? content : "&nbsp;";
		return '<div style="' + boxStyle + '">' + txt + '</div>';
	}

	function total(val) {
		var txt = (val && val > 0) ? val : "&nbsp;";
		return '<div style="' + totalStyle + '">' + txt + '</div>';
	}

	var html = '<div style="' + sbStyle + '">';

	// Frames 1..9 (index 0..8)
	for (var i = 0; i < FRAME_COUNT - 1; i++) {
		var c1 = scores.throwResultChars[i][0];
		var c2 = scores.throwResultChars[i][1];
		var t = scores.frameResults[i];
		html += '<div style="' + frameStyle + '">';
		html += '<div style="' + shotsStyle + '">';
		html += box(c1) + box(c2);
		html += '</div>';
		html += total(t);
		html += '</div>';
	}

	// Frame 10 (index 9) has three boxes
	var i10 = FRAME_COUNT - 1;
	var c10a = scores.throwResultChars[i10][0];
	var c10b = scores.throwResultChars[i10][1];
	var c10c = scores.throwResultChars[i10][2];
	var t10 = scores.frameResults[i10];
	html += '<div style="' + frameStyle + '">';
	html += '<div style="' + shotsStyle + '">';
	html += box(c10a) + box(c10b) + box(c10c);
	html += '</div>';
	html += total(t10);
	html += '</div>';

	// Overall total at the end
	var totalPanel = '<div style="margin-left:8px; display:flex; flex-direction:column; justify-content:center; align-items:center; padding:4px 8px; border:2px solid rgba(255,255,255,0.6); border-radius:6px; background:rgba(0,0,0,0.25);">'
		+ '<div style="font-size:11px; opacity:0.85;">TOTAL</div>'
		+ '<div style="font-weight:700; font-size:18px; line-height:20px;">' + (scores.totalScore || 0) + '</div>'
		+ '</div>';
	html += totalPanel;

	html += '</div>';

	scoresDiv.innerHTML = html;
	// After rendering, ensure the charge bar sits right below the score UI
	positionChargeBarUnderScore();
}

// Helper: position charge bar right under the scoreboard at the top
function positionChargeBarUnderScore() {
	try {
		if (!chargeBar || !scoresDiv) return;
		var rect = scoresDiv.getBoundingClientRect();
		// Place 8px below the bottom of the scoreboard box
		var y = Math.max(0, Math.round(rect.bottom + 8));
		chargeBar.style.top = y + 'px';
		chargeBar.style.left = '50%';
		chargeBar.style.transform = 'translateX(-50%)';
		// Ensure bottom is not set anymore
		chargeBar.style.bottom = '';
	} catch(e) {}
}

// ---------- Text-to-Speech (TTS) helpers ----------
function speakText(text) {
	if (!window.NarbeVoiceManager) return;
	if (!window.NarbeVoiceManager.getSettings().ttsEnabled) return;
	window.NarbeVoiceManager.speak(text);
}

function getLatestThrowInfo(scores) {
	for (var i = FRAME_COUNT - 1; i >= 0; i--) {
		var maxJ = (i === FRAME_COUNT - 1) ? 2 : 1;
		for (var j = maxJ; j >= 0; j--) {
			var c = scores.throwResultChars[i][j];
			if (c && c !== ' ') {
				return { frame: i, shot: j, ch: c };
			}
		}
	}
	return null;
}

function describeThrowChar(ch) {
	if (ch === 'X') return 'strike';
	if (ch === '/') return 'spare';
	if (ch === '-') return 'gutter';
	var n = parseInt(ch, 10);
	if (!isNaN(n)) return n + (n === 1 ? ' pin' : ' pins');
	return 'roll';
}

function speakLatestRollOutcome(scores) {
	var info = getLatestThrowInfo(scores);
	if (!info) return;
	var frameNum = info.frame + 1;
	var desc = describeThrowChar(info.ch);
	// For frame 10, include shot number verbally when useful
	if (info.frame === FRAME_COUNT - 1) {
		speakText('Frame ' + frameNum + ', ' + (info.shot + 1) + ' ' + (info.shot === 0 ? 'ball' : 'ball') + ': ' + desc);
	} else {
		speakText('Frame ' + frameNum + ': ' + desc);
	}
}

init();
