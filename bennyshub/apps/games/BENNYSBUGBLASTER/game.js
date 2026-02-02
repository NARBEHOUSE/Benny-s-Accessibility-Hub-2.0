const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let SCREEN_WIDTH = window.innerWidth;
let SCREEN_HEIGHT = window.innerHeight;
canvas.width = SCREEN_WIDTH;
canvas.height = SCREEN_HEIGHT;

const BASE_SCREEN_HEIGHT = 900;
let speedMultiplier = 1.0;

function updateSpeedMultiplier() {
    // Distance = (SCREEN_HEIGHT - 180) - 80 = SCREEN_HEIGHT - 260
    let currentDist = Math.max(10, SCREEN_HEIGHT - 260);
    let baseDist = BASE_SCREEN_HEIGHT - 260;
    speedMultiplier = currentDist / baseDist;
}
updateSpeedMultiplier();

// --- Assets ---
const sounds = {
    hitTower: new Audio('sounds/hittower.wav'),
    towerShoot: new Audio('sounds/towershoot.wav'),
    enemyDestroyed: new Audio('sounds/enemydestroyed.wav'),
    bomb: new Audio('sounds/bomb.wav'),
    laser: new Audio('sounds/laserbeam.wav'),
    squish: new Audio('sounds/squish.wav')
};

let audioStarted = false;
let audioCtx = null;
let stomp_ready_sound_played = false;

// --- Settings ---
let tts_enabled = true;
let autoscan_enabled = false;
let auto_stomp_enabled = false;
let scan_speed_options = [1.5, 2.0, 3.0, 5.0];
let scan_speed_index = 1; // Default 2.0s
let last_autoscan_time = 0;
let sfx_enabled = true;
let music_enabled = true;
let music_volume = 0.25;

let bgMusic = new Audio('sounds/bug-defender-cozy.wav');
bgMusic.loop = true;
bgMusic.volume = music_volume;

function playSound(name) {
    if (!sfx_enabled) return;
    if (!sounds[name]) return;
    
    // Prefer shared helper for iOS
    if (window.NarbeAudioHelper && window.NarbeAudioHelper.play) {
        window.NarbeAudioHelper.play(sounds[name].src, 1.0);
        return;
    }

    // Clone to allow overlapping sounds
    const s = sounds[name].cloneNode();
    s.volume = 1.0;
    s.play().catch(e => console.log(e));
}

function playReadySound() {
    if (!sfx_enabled) return;
    try {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
        
        let oscillator = audioCtx.createOscillator();
        let gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        // Gentle "Ding" (E5 -> A5)
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(659.25, audioCtx.currentTime); 
        oscillator.frequency.linearRampToValueAtTime(880, audioCtx.currentTime + 0.1);
        
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.6);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.6);
    } catch (e) {
        console.log("AudioContext error:", e);
    }
}

function startMusic() {
    if (music_enabled && !audioStarted) {
        audioStarted = true;
        bgMusic.play().catch(e => console.log(e));
    }
}

// --- TTS ---
function speak(text) {
    if (!tts_enabled) return;
    if (window.NarbeVoiceManager) {
        window.NarbeVoiceManager.speak(text);
    }
}

// --- Global Constants & Variables ---
let TOWER_SIZE = Math.min(150, window.innerWidth / 3);
const ROUND_DURATION = 150; // seconds
let TOWER_MAX_HP = 100;
let max_tower_hp = TOWER_MAX_HP;

let wave_number = 1;
let points = 0;
let tower_hp = TOWER_MAX_HP;
let enemies = [];

// New: Level Intro State
let level_intro_start_time = 0;
const LEVEL_INTRO_DURATION = 3.0; // Seconds
let tower_projectiles = [];
let enemy_projectiles = [];
let tower_units = [];
let towers = [];
let grass_blades = [];
let garden_flowers = []; // Array to store flower data

// --- Menu Dynamics ---
let menu_enemies = [];
let menu_projectiles = [];
let menu_boot = { active: false, x: 0, y: 0, timer: 0, state: 'idle', target: null }; 
let last_menu_spawn = 0;
let last_boot_attempt = 0;
let menu_grass_blades = [];

function generate_menu_grass() {
    menu_grass_blades = [];
    for(let i=0; i<400; i++) {
        menu_grass_blades.push({
            x: Math.random() * SCREEN_WIDTH,
            y: Math.random() * SCREEN_HEIGHT,
            h: 5 + Math.random() * 8,
            angle: (Math.random() - 0.5) * 0.5
        });
    }
}

// Timers (in seconds)
let game_time_start = 0;
let last_spawn_time = {
    small: 0, medium: 0, large: 0, extra_large: 0, boss: 0
};
let tower_last_unit_spawn_time = 0;
let tower_last_projectile_time = 0;
let last_heal_time = 0;

// Upgrades / Abilities
let shield_hp = 0;
let max_shield_hp = 0;
let shield_active = false;

let laser_active = false;
let laser_start_time = 0;
let laser_hit_enemies = new Set();
let last_laser_time = 0;

let bomb_active = false;
let bomb_start_time = 0;
let bomb_duration = 2.0;
let bomb_damage = 6;
let bomb_hit_enemies = new Set();
let bomb_last_time = 0;

let stomp_level = 1;
let last_stomp_time = 0;
let stomp_anim_active = false;
let stomp_anim_start = 0;
let stomp_target = null; // Reference to Enemy object
let stomp_effect_pos = null; // {x, y} for animation
let stomp_hit_enemies = new Set();
let stomp_cooldown_max = 4.0; 
let stomp_auto_scan_timer = 0;

let glue_trap_active = false;
let glue_traps = []; // Array of {x, y, width, height} for each trap

let focused_enemy = null;

// Layout
let TOWER_X = SCREEN_WIDTH / 2 - TOWER_SIZE / 2;
let TOWER_Y = SCREEN_HEIGHT - 180;

// Game State
let gameState = 'MENU'; // MENU, PLAYING, BUY, PAUSED, GAME_OVER, GAME_WON
let restart_requested = false;

// --- Config Data ---
const spawn_intervals = {
    "small":       [4,3,2,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
    "medium":      [0,0,15,10,8,6,4,3,3,3,2,2,2,2,2,2,2,2,2,1],
    "large":       [0,0,0,0,60,45,30,25,20,15,15,15,15,15,15,15,12,10,9,8],
    "extra_large": [0,0,0,0,0,0,0,0,90,60,45,30,30,25,25,25,25,25,20,20],
    "boss":        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,60,40,30]
};
const quantities = {
    "small":       [1,1,1,1,1,1,1,2,2,2,2,2,2,2,2,2,3,3,3,3],
    "medium":      [0,0,1,1,1,1,1,1,1,1,1,1,1,2,2,2,3,3,3,3],
    "large":       [0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,2,2,3],
    "extra_large": [0,0,0,0,0,0,0,0,1,1,1,1,1,1,1,1,1,1,1,2],
    "boss":        [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,1,1]
};

const initial_buy_menu_options = [
    {name: "Add Salt Shot", cost: 150, max: 6, purchased: 0},
    {name: "Increase Shot Power", cost: 250, max: 3, purchased: 0},
    {name: "Repair Net / Recover Health", cost: 50, max: 100, purchased: 0},
    {name: "Train Defender Bugs", cost: 200, max: 3, purchased: 0},
    {name: "Increase Defender Frequency", cost: 300, max: 2, purchased: 0},
    {name: "Expand House", cost: 2000, max: 2, purchased: 0},
    {name: "Buy Bug Bomb", cost: 3000, max: 1, purchased: 0},
    {name: "Upgrade Bomb Frequency", cost: 3000, max: 1, purchased: 0},
    {name: "Bug Zapper Beam", cost: 1750, max: 1, purchased: 0},
    {name: "Add Healing", cost: 1000, max: 3, purchased: 0},  
    {name: "Add Bug Net", cost: 1250, max: 1, purchased: 0},
    {name: "Upgrade Net", cost: 750, max: 3, purchased: 0},
    {name: "Upgrade Boot Stomp", cost: 500, max: 2, purchased: 0},
    {name: "Glue Traps", cost: 400, max: 999, purchased: 0}
];

let buy_menu_options = JSON.parse(JSON.stringify(initial_buy_menu_options));

// --- Classes ---

class Tower {
    constructor(x, y, type="main") {
        this.x = x;
        this.y = y;
        this.type = type;
        this.size = (type === "main") ? TOWER_SIZE : TOWER_SIZE * 0.7;
        
        // Cracks data
        this.cracks = [];
        let body_x, body_w;
        if (type === "main") {
            body_x = 15; body_w = this.size - 30; // 15 to size-15
        } else {
            body_x = 5; body_w = this.size - 10;
        }
        
        for(let i=0; i<15; i++) {
            this.cracks.push({
                x: body_x + Math.random() * body_w,
                y: 45 + Math.random() * (this.size - 55), // Keep away from roof (40) and bottom
                len: 5 + Math.random() * 10,
                angle: Math.random() * Math.PI * 2
            });
        }
    }
    
    draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);

        // Decay Logic
        let pct = (max_tower_hp > 0) ? (tower_hp / max_tower_hp) : 1;
        let bodyColor = "#f5f5dc"; // Beige
        if (pct <= 0.25) bodyColor = "#a09570"; // Dirty Brown
        else if (pct <= 0.50) bodyColor = "#d4d480"; // Yellowish
        else if (pct <= 0.75) bodyColor = "#e6e6a0"; // Slight decay

        if (this.type === "main") {
            // House Body
            ctx.fillStyle = bodyColor;
            ctx.fillRect(10, 40, this.size - 20, this.size - 40);
            ctx.strokeStyle = "#8b4513"; // SaddleBrown
            ctx.lineWidth = 2;
            ctx.strokeRect(10, 40, this.size - 20, this.size - 40);

            // Roof
            ctx.fillStyle = "#a52a2a"; // Brown
            ctx.beginPath();
            ctx.moveTo(0, 40);
            ctx.lineTo(this.size / 2, 0);
            ctx.lineTo(this.size, 40);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Door - Scaled and positioned
            ctx.fillStyle = "#8b4513";
            let dW = this.size * 0.2; // 20% width
            let dH = this.size * 0.25; // 25% height
            // Align to bottom of house body (which is at this.size?)
            // Body rect is y=40, h=this.size-40. So bottom is this.size.
            ctx.fillRect(this.size / 2 - dW/2, this.size - dH, dW, dH);
            
            // Window - Scaled and positioned
            let winColor = "#87ceeb";
            if (pct <= 0.25) winColor = "#222"; // Broken/Dark
            else if (pct <= 0.50) winColor = "#5f8a9e"; // Cracked/Dull
            
            let wW = this.size * 0.25; // 25% width
            let wH = this.size * 0.20; // 20% height
            // Position in upper portion of body
            // Body starts at 40. Length is size-40.
            let matchY = 40 + (this.size - 40) * 0.15; 
            
            ctx.fillStyle = winColor;
            ctx.fillRect(this.size / 2 - wW/2, matchY, wW, wH);
            ctx.strokeStyle = "white";
            ctx.lineWidth = 2;
            ctx.beginPath();
            // Window Cross
            ctx.moveTo(this.size/2, matchY); ctx.lineTo(this.size/2, matchY + wH);
            ctx.moveTo(this.size/2 - wW/2, matchY + wH/2); ctx.lineTo(this.size/2 + wW/2, matchY + wH/2);
            ctx.stroke();
            
            // Window Cracks (50-25%)
            if (pct <= 0.50 && pct > 0.25) {
                ctx.strokeStyle = "rgba(255,255,255,0.7)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(this.size/2 - wW*0.2, matchY + wH*0.2); ctx.lineTo(this.size/2 + wW*0.1, matchY + wH*0.8);
                ctx.moveTo(this.size/2 + wW*0.2, matchY + wH*0.2); ctx.lineTo(this.size/2 - wW*0.1, matchY + wH*0.9);
                ctx.stroke();
            }

            // Cracks on Wall
            if (pct <= 0.75) {
                ctx.strokeStyle = "rgba(60,40,20,0.5)"; // Darker crack color
                ctx.lineWidth = 1;
                let num = 0;
                if (pct <= 0.25) num = 12;
                else if (pct <= 0.50) num = 8;
                else if (pct <= 0.75) num = 4;
                
                for(let i=0; i<num && i<this.cracks.length; i++) {
                     let c = this.cracks[i];
                     ctx.beginPath();
                     ctx.moveTo(c.x, c.y);
                     ctx.lineTo(c.x + Math.cos(c.angle)*c.len, c.y + Math.sin(c.angle)*c.len);
                     ctx.stroke();
                }
            }

        } else {
            // Wing Addition
             // House Body
             ctx.fillStyle = bodyColor; 
             ctx.fillRect(0, 40, this.size, this.size - 40); 
             ctx.strokeStyle = "#8b4513"; ctx.lineWidth = 2;
             ctx.strokeRect(0, 40, this.size, this.size - 40);
             
             // Roof - simple triangle
             ctx.fillStyle = "#a52a2a";
             ctx.beginPath();
             ctx.moveTo(0, 40);
             ctx.lineTo(this.size/2, 10);
             ctx.lineTo(this.size, 40);
             ctx.closePath(); ctx.fill(); ctx.stroke();
             
             // Window - Scaled and positioned
             let winColor = "#87ceeb";
             if (pct <= 0.25) winColor = "#222"; 
             else if (pct <= 0.50) winColor = "#5f8a9e";

             let wW = this.size * 0.25; // 25% width
             let wH = this.size * 0.20; // 20% height
             let matchY = 40 + (this.size - 40) * 0.15; // Same vertical pos as main

             ctx.fillStyle = winColor; // SkyBlue 
             ctx.fillRect(this.size/2 - wW/2, matchY, wW, wH);
             ctx.strokeStyle = "white"; ctx.beginPath();
             ctx.lineWidth = 2;
             ctx.moveTo(this.size/2, matchY); ctx.lineTo(this.size/2, matchY + wH);
             ctx.moveTo(this.size/2 - wW/2, matchY + wH/2); ctx.lineTo(this.size/2 + wW/2, matchY + wH/2);
             ctx.stroke();
             
             // Window Cracks (50-25%)
            if (pct <= 0.50 && pct > 0.25) {
                ctx.strokeStyle = "rgba(255,255,255,0.7)";
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(this.size/2 - wW*0.2, matchY + wH*0.2); ctx.lineTo(this.size/2 + wW*0.1, matchY + wH*0.8);
                ctx.stroke();
            }

             // Cracks (Wings)
             if (pct <= 0.75) {
                ctx.strokeStyle = "rgba(60,40,20,0.5)";
                ctx.lineWidth = 1;
                let num = 0;
                if (pct <= 0.25) num = 8;
                else if (pct <= 0.50) num = 5;
                else if (pct <= 0.75) num = 2;
                
                for(let i=0; i<num && i<this.cracks.length; i++) { // Reuse cracks data
                     let c = this.cracks[i];
                     ctx.beginPath();
                     ctx.moveTo(c.x, c.y);
                     ctx.lineTo(c.x + Math.cos(c.angle)*c.len, c.y + Math.sin(c.angle)*c.len);
                     ctx.stroke();
                }
            }
        }

        ctx.restore();
    }
}

class Enemy {
    constructor(etype, hp, speed, damage) {
        this.etype = etype;
        this.hp = hp;
        this.baseSpeed = speed / 60; // Python assumes 60fps
        this.damage = damage;
        // Keep enemies within screen bounds (margin 40px)
        this.x = 40 + Math.random() * (SCREEN_WIDTH - 80);
        this.baseX = this.x;
        this.y = 80;
        this.angle = 0;
        
        const size_map = {"small": 15, "medium": 23, "large": 30, "extra_large": 25, "boss": 75};
        this.radius = size_map[etype];
        
        if (etype === "extra_large") {
            this.last_shot_time = Date.now() / 1000;
        }
        
        this.id = Math.random(); // Unique ID for set tracking
        this.isDead = false;
        this.deathTime = 0;
        this.stuckToGlue = false;
        this.stuckStartTime = 0;
        this.hasBeenStuck = false; // Prevent same bug from sticking multiple times
    }

    move() {
        if (this.isDead) return;
        
        // Check if stuck to glue
        if (this.stuckToGlue) {
            let now = Date.now() / 1000;
            if (now - this.stuckStartTime >= 5.0) {
                this.stuckToGlue = false; // Unstuck after 5 seconds
            } else {
                return; // Don't move while stuck
            }
        }

        let currentSpeed = this.baseSpeed * speedMultiplier;
        let onTrap = false;
        
        // Check if on any glue trap and slow down
        if (glue_trap_active) {
            for (let trap of glue_traps) {
                if (this.x >= trap.x && this.x <= trap.x + trap.width &&
                    this.y >= trap.y && this.y <= trap.y + trap.height) {
                    currentSpeed *= 0.6; // 40% slowdown (60% speed)
                    onTrap = true;
                    
                    // Random chance to get stuck (20% chance per frame on trap)
                    if (!this.stuckToGlue && !this.hasBeenStuck && Math.random() < 0.02) {
                        this.stuckToGlue = true;
                        this.stuckStartTime = Date.now() / 1000;
                        this.hasBeenStuck = true;
                        return; // Stop immediately
                    }
                    break;
                }
            }
        }
        
        // Reset stuck eligibility when off trap
        if (!onTrap && !this.stuckToGlue) {
            this.hasBeenStuck = false;
        }
        
        this.y += currentSpeed;
        
        // Zig-Zag for Small Ants
        if (this.etype === 'small') {
            let amp = 30; // Amplitude
            let freq = 0.03; // Frequency
            // x = baseX + sin(y * freq + phase) * amp
            this.x = this.baseX + Math.sin(this.y * freq + this.id * 10) * amp;
            
            // Calculate facing angle
            // dx/dt (approx) = amp * freq * cos(...) * dy/dt
            // dy/dt = speed
            let dx = amp * freq * Math.cos(this.y * freq + this.id * 10) * currentSpeed;
            let dy = currentSpeed;
            
            // Normal heading is Down (+90 deg). We want difference.
            this.angle = Math.atan2(dy, dx) - Math.PI/2;
        }

        // Collision with tower units
        for (let i = tower_units.length - 1; i >= 0; i--) {
            let unit = tower_units[i];
            let dx = unit.x - this.x;
            let dy = unit.y - this.y;
            let dist = Math.hypot(dx, dy);

            if (dist < (this.radius + unit.radius)) {
                this.hp -= unit.damage; // Unit damage usually 1, but check logic
                if (this.hp <= 0) removeEnemy(this);
                tower_units.splice(i, 1);
                break;
            }
        }
    }

    shoot() {
        if (this.isDead) return;
        if (this.etype !== "extra_large") return;
        
        // Scale shot interval inverse to multiplier? (Faster game = faster shots?)
        // If enemy moves 2x faster, they cover ground in 1/2 time.
        // If they shoot every 2s, they might only shoot half as many times.
        // To keep "difficulty" (shots per distance) constant, we should decrease interval.
        // let scaledInterval = 2.0 / speedMultiplier;
        
        let current_time = Date.now() / 1000;
        // Keep 2.0 for now unless requested, but logic implies faster movement = faster everything?
        // User: "gameplay the same relative to the enemies going down the map"
        // If I encounter a shooter, I expect it to shoot me X times before it hits the fence.
        // If it moves fast, it reaches fence fast -> fewer shots.
        // So yes, I should scale interval.
        let interval = 2.0 / speedMultiplier;
        
        if (current_time - this.last_shot_time >= interval) {
            this.last_shot_time = current_time;
            let target;
            if (tower_units.length > 0) {
                target = tower_units.reduce((prev, curr) => {
                    return Math.hypot(curr.x - this.x, curr.y - this.y) < Math.hypot(prev.x - this.x, prev.y - this.y) ? curr : prev;
                });
            } else {
                target = {x: TOWER_X + TOWER_SIZE/2, y: TOWER_Y};
            }
            enemy_projectiles.push(new EnemyProjectile(this.x, this.y, target.x, target.y, 2));
        }
    }

    draw() {
        const size_map = {"small": 15, "medium": 23, "large": 30, "extra_large": 25, "boss": 75};
        
        // Animation Phase
        let now = Date.now();
        // Use currentSpeed for visual pacing
        let currentSpeed = this.baseSpeed * speedMultiplier;
        let walkPhase = Math.sin(now / 100 * (currentSpeed / 15 * 60) + this.id * 10); 
        // id is float, but effectively random offset
        
        ctx.save();
        ctx.translate(this.x, this.y);
        if (this.etype === 'small') ctx.rotate(this.angle);
        
        if (this.isDead) {
            let elapsed = (Date.now() - this.deathTime) / 1000;
            ctx.globalAlpha = Math.max(0, 1 - elapsed * 2); 
            ctx.scale(1, -1); 
        }

        if (this.etype === "small") { 
            // Ant (Red)
            ctx.fillStyle = "rgb(180, 50, 50)"; // Slightly darker red
            // Legs (moving)
            ctx.strokeStyle = "rgb(180, 50, 50)"; ctx.lineWidth = 1;
            ctx.beginPath();
            let leg_y = walkPhase * 2;
            ctx.moveTo(-6, 2 - leg_y); ctx.lineTo(6, 2 + leg_y);
            ctx.moveTo(-6, -2 + leg_y); ctx.lineTo(6, -2 - leg_y);
            ctx.moveTo(-6, -5); ctx.lineTo(6, -5);
            ctx.stroke();

            // Head
            ctx.beginPath(); ctx.arc(0, 5, 4, 0, Math.PI*2); ctx.fill();
            // Thorax
            ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill();
            // Abdomen (larger)
            ctx.beginPath(); ctx.ellipse(0, -7, 4, 6, 0, 0, Math.PI*2); ctx.fill();
            
            // Antennae
            ctx.strokeStyle = "black";
            ctx.beginPath(); 
            ctx.moveTo(2, 8); ctx.lineTo(4, 12);
            ctx.moveTo(-2, 8); ctx.lineTo(-4, 12);
            ctx.stroke();

        } else if (this.etype === "medium") {
            // Beetle (Orange)
            ctx.fillStyle = "rgb(255, 140, 0)";
            
            // Legs
            ctx.strokeStyle = "black"; ctx.lineWidth = 1.5;
            let lo = walkPhase * 2;
            ctx.beginPath(); 
            ctx.moveTo(-10, 5+lo); ctx.lineTo(10, 5-lo); 
            ctx.moveTo(-10, 0-lo); ctx.lineTo(10, 0+lo); 
            ctx.moveTo(-10, -5+lo); ctx.lineTo(10, -5-lo); 
            ctx.stroke();

            // Body
            ctx.beginPath(); ctx.ellipse(0, 0, 10, 14, 0, 0, Math.PI*2); ctx.fill();
            // Head
            ctx.fillStyle = "#111";
            ctx.beginPath(); ctx.arc(0, 12, 5, 0, Math.PI*2); ctx.fill();
            // Stripe
            ctx.strokeStyle = "black"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 8); ctx.stroke();
            
        } else if (this.etype === "large") {
             // Red Mantis / Stag Beetle style
            let c = "rgb(160, 0, 0)";
            ctx.fillStyle = c;
            
            // Legs
            ctx.strokeStyle = "#330000"; ctx.lineWidth = 2;
             let lo = walkPhase * 3;
            ctx.beginPath(); 
            ctx.moveTo(-14, 5+lo); ctx.lineTo(14, 5-lo); 
            ctx.moveTo(-14, -2-lo); ctx.lineTo(14, -2+lo); 
            ctx.moveTo(-14, -8+lo); ctx.lineTo(14, -8-lo); 
            ctx.stroke();

            // Abdomen
            ctx.beginPath(); ctx.ellipse(0, -5, 12, 16, 0, 0, Math.PI*2); ctx.fill();
            // Thorax/Head
            ctx.fillStyle = "#550000";
            ctx.beginPath(); ctx.ellipse(0, 10, 8, 6, 0, 0, Math.PI*2); ctx.fill();
            
            // Pinchers (Animated)
            let p_ang = 0.5 + Math.sin(now/200)*0.2;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(4, 12);
            ctx.lineTo(8 + Math.cos(p_ang)*10, 12 + Math.sin(p_ang)*10);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(-4, 12);
            ctx.lineTo(-8 - Math.cos(p_ang)*10, 12 + Math.sin(p_ang)*10);
            ctx.stroke();

        } else if (this.etype === "extra_large") {
            // Scorpion (Purple)
            ctx.fillStyle = "rgb(75, 0, 130)"; // Indigo
            let legColor = "rgb(55, 0, 100)";
            
            // Legs (8 legs)
            ctx.strokeStyle = legColor; ctx.lineWidth = 2;
            let lo = walkPhase * 2;
             for(let i=0; i<4; i++) {
                 let yoff = 8 - i*5;
                 let off = (i%2==0) ? lo : -lo;
                 ctx.beginPath(); 
                 ctx.moveTo(-15 - Math.abs(off), yoff); ctx.lineTo(0, yoff-2); ctx.lineTo(15+Math.abs(off), yoff);
                 ctx.stroke();
             }

            // Body
            ctx.beginPath(); ctx.ellipse(0, 5, 12, 18, 0, 0, Math.PI*2); ctx.fill();
            
            // Claws
            ctx.fillStyle = legColor;
            ctx.save();
            ctx.translate(14, 20); ctx.rotate(-0.5 + Math.sin(now/300)*0.2);
            ctx.beginPath(); ctx.ellipse(0,0, 6, 10, 0, 0, Math.PI*2); ctx.fill();
            ctx.restore();
            ctx.save();
            ctx.translate(-14, 20); ctx.rotate(0.5 - Math.sin(now/300)*0.2);
            ctx.beginPath(); ctx.ellipse(0,0, 6, 10, 0, 0, Math.PI*2); ctx.fill();
            ctx.restore();

            // Tail (Curved 'C' or 'J' shape)
            ctx.strokeStyle = "rgb(100, 20, 160)";
            ctx.lineWidth = 6;
            ctx.lineCap = "round";
            ctx.beginPath();
            
            // Start from back of body
            ctx.moveTo(0, -10);
            // Curve over to the front-right or front-left, behaving like C/J
            // Control points to arc it forward over the head
            // Shortened tail
            let curveSway = Math.sin(now/500) * 8;
            ctx.bezierCurveTo(0, -35, 15 + curveSway, -30, 10 + curveSway * 0.5, 5);
            
            ctx.stroke();
            
            // Stinger (Red tip at end of curve)
            ctx.fillStyle = "red";
            ctx.beginPath(); ctx.arc(10 + curveSway * 0.5, 5, 4, 0, Math.PI*2); ctx.fill();
        } 
        else if (this.etype === "boss") {
            // Tarantula (Dark Red/Black)
            ctx.fillStyle = "#220000"; // Very dark body
            
            // Hairy Legs (8 long animated legs)
            ctx.strokeStyle = "#3e2723"; ctx.lineWidth = 4;
            let lo = walkPhase * 4;
            
            for(let side of [-1, 1]) { // Left/Right
                for(let i=0; i<4; i++) { // 4 legs per side
                    // i=0 (front), i=3 (back)
                    // Regular spread: 0.5 to 2.5
                    // Modifying back legs (i=3) to point further back
                    
                    let angleBase = (i * 0.5) + 0.5; // Default forward-ish fan
                    if (i === 3) angleBase = 2.8; // Point back (towards -y)
                    if (i === 2) angleBase = 2.0; // Slightly back

                    let angle = angleBase; // Radians 
                    // Adjust for side? No, standard trig covers it if we treat 'side' as X multiplier
                    // Actually, if side is -1, we need to mirror the angle logic or the X coord.
                    // The standard draw uses side * cos.
                    // cos(2.8) is negative (up/back). sin(2.8) is positive (down/front)? No.
                    // In canvas +Y is down. -Y is up (back of bug).
                    // We want legs to go to -Y (Back). 
                    // 0 angle = +X (Right). PI/2 = +Y (Front/Down). PI = -X (Left). 3PI/2 = -Y (Top/Back).
                    
                    // My previous logic: angle = (i*0.5)+0.5. i=0->0.5 (~30deg down). i=3->2.0 (~115deg down/back?).
                    // Let's explicitly set intended directions relative to body center
                    let legDir = 0;
                    if (i===0) legDir = 0.5; // Forward-Side
                    if (i===1) legDir = 0.0; // Side
                    if (i===2) legDir = -0.6; // Back-Side
                    if (i===3) legDir = -1.2; // Back (Supporting butt)

                    let len = 45;
                    let kneeX = side * (Math.cos(legDir)*len*0.6 + 10); // +10 to widen stance
                    let kneeY = Math.sin(legDir)*len*0.6;
                    
                    let footX = side * (Math.cos(legDir)*len + 15);
                    let footY = Math.sin(legDir)*len;
                    
                    // Animate foot tip
                    let mov = (i%2===0) ? lo : -lo;
                    footX += side * (mov * 0.2); // Less side movement
                    footY += mov;
                    
                    ctx.beginPath();
                    ctx.moveTo(0, 0); // Center
                    ctx.lineTo(kneeX, kneeY);
                    ctx.lineTo(footX, footY);
                    ctx.stroke();
                }
            }

            // Abdomen (Big fuzzy butt)
            ctx.fillStyle = "#3e2723"; // Brownish
            ctx.beginPath(); ctx.ellipse(0, -30, 30, 35, 0, 0, Math.PI*2); ctx.fill();
            
            // Cephalothorax (Head/Chest)
            ctx.fillStyle = "#1a1a1a";
            ctx.beginPath(); ctx.ellipse(0, 10, 20, 20, 0, 0, Math.PI*2); ctx.fill();
            
            // Eyes (Many)
            ctx.fillStyle = "red";
            ctx.beginPath(); ctx.arc(-5, 25, 3, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(5, 25, 3, 0, Math.PI*2); ctx.fill();
            ctx.fillStyle = "yellow";
            ctx.beginPath(); ctx.arc(-8, 22, 2, 0, Math.PI*2); ctx.fill();
            ctx.beginPath(); ctx.arc(8, 22, 2, 0, Math.PI*2); ctx.fill();

            // Life bar for Boss above head
            ctx.fillStyle = "red";
            ctx.fillRect(-40, 50, 80, 5);
            ctx.fillStyle = "lime";
            ctx.fillRect(-40, 50, 80 * (this.hp / 100), 5);
        }

        ctx.restore();
    }
}

class TowerProjectile {
    constructor(start_x, start_y, target_x, target_y, damage) {
        this.x = start_x;
        this.y = start_y;
        this.damage = damage;
        let dx = target_x - start_x;
        let dy = target_y - start_y;
        let dist = Math.hypot(dx, dy);
        if (dist === 0) {
            this.vx = 0; this.vy = 0;
        } else {
            this.vx = dx / dist; // Normalized direction
            this.vy = dy / dist;
        }
        this.baseSpeed = 15;
        this.radius = 5;
    }
    move() {
        let currentSpeed = this.baseSpeed * speedMultiplier;
        this.x += this.vx * currentSpeed;
        this.y += this.vy * currentSpeed;
    }
    draw() {
        // Salt Shot (White cloudy spray look)
        // Instead of one circle, draw a few small ones
        ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
        
        // Main pellet
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();

        // Extra "salt" grains
        ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
        for (let i = 0; i < 3; i++) {
            let offset_x = (Math.random() - 0.5) * 8;
            let offset_y = (Math.random() - 0.5) * 8;
            ctx.beginPath();
            ctx.arc(this.x + offset_x, this.y + offset_y, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

class EnemyProjectile {
    constructor(start_x, start_y, target_x, target_y, damage) {
        this.x = start_x;
        this.y = start_y;
        this.damage = damage;
        this.radius = 6;
        let dx = target_x - start_x;
        let dy = target_y - start_y;
        let dist = Math.hypot(dx, dy);
        if (dist === 0) {
            this.vx = 0; this.vy = 0;
        } else {
            this.vx = dx / dist;
            this.vy = dy / dist;
        }
        this.baseSpeed = 8;
    }
    move() {
        let currentSpeed = this.baseSpeed * speedMultiplier;
        this.x += this.vx * currentSpeed;
        this.y += this.vy * currentSpeed;
    }
    draw() {
        ctx.fillStyle = "rgb(200, 50, 50)";
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
    }
}

class TowerUnit {
    constructor(start_x, start_y, damage=1) {
        this.x = start_x;
        this.y = start_y;
        this.damage = damage;
        this.baseSpeed = 20 / 60;
        this.radius = 10;
        this.target = null;
        this.locked_target = null;
        this.random_direction = null;
    }

    move() {
        if (!this.target) {
            // Stop in place if no target
            return;
        } else {
            this.random_direction = null;
            let currentSpeed = this.baseSpeed * speedMultiplier;
            let dx = this.target.x - this.x;
            let dy = this.target.y - this.y;
            let dist = Math.hypot(dx, dy);
            if (dist > 0) {
                this.x += currentSpeed * dx / dist;
                this.y += currentSpeed * dy / dist;
            }
        }
    }

    draw() {
        // Defender Bug (Blue Ant)
        ctx.save();
        ctx.translate(this.x, this.y);
        
        let rotation = Math.PI; // Default Face Up
        if (this.target) {
             let dx = this.target.x - this.x;
             let dy = this.target.y - this.y;
             rotation = Math.atan2(dy, dx) - Math.PI / 2;
        }
        ctx.rotate(rotation); 

        // Similar to Small Enemy but Blue
        ctx.fillStyle = "rgb(0, 100, 255)"; 
        // Legs (moving)
        ctx.strokeStyle = "rgb(0, 50, 200)"; ctx.lineWidth = 1;
        ctx.beginPath();
        let leg_y = Math.sin(Date.now() / 100 * 2 + this.x) * 2; 
        ctx.moveTo(-6, 2 - leg_y); ctx.lineTo(6, 2 + leg_y);
        ctx.moveTo(-6, -2 + leg_y); ctx.lineTo(6, -2 - leg_y);
        ctx.moveTo(-6, -5); ctx.lineTo(6, -5);
        ctx.stroke();

        // Head
        ctx.beginPath(); ctx.arc(0, 5, 4, 0, Math.PI*2); ctx.fill();
        // Thorax
        ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill();
        // Abdomen (larger)
        ctx.beginPath(); ctx.ellipse(0, -7, 4, 6, 0, 0, Math.PI*2); ctx.fill();
        
        // Antennae
        ctx.strokeStyle = "black";
        ctx.beginPath(); 
        ctx.moveTo(2, 8); ctx.lineTo(4, 12);
        ctx.moveTo(-2, 8); ctx.lineTo(-4, 12);
        ctx.stroke();

        ctx.restore();
    }
}

// --- Helpers ---

function removeEnemy(enemy) {
    if (enemies.includes(enemy)) {
        if (!enemy.isDead) { // If not already dead/dying
             enemy.isDead = true;
             enemy.deathTime = Date.now();
             playSound('enemyDestroyed');
             // We don't remove immediately anymore
        }
    }
}

function calculate_glue_trap_positions() {
    if (!glue_trap_active) return;
    
    glue_traps = [];
    let playable_height = SCREEN_HEIGHT - 180 - 80; // Between top (80) and fence (SCREEN_HEIGHT - 180)
    let total_trap_height = playable_height * 0.3;
    let trap_y_start = 80 + (playable_height - total_trap_height) / 2;
    
    // Divide width into 5 equal trap sections with 4 equal gaps
    let num_traps = 5;
    let num_gaps = 4;
    let total_parts = num_traps + num_gaps; // 9 parts total
    let gap_parts = 1; // Each gap is 1 part
    let trap_parts = 1; // Each trap is 1 part
    let part_width = SCREEN_WIDTH / total_parts;
    
    let trap_width = part_width * trap_parts;
    let gap_width = part_width * gap_parts;
    
    for (let i = 0; i < num_traps; i++) {
        glue_traps.push({
            x: i * (trap_width + gap_width),
            y: trap_y_start,
            width: trap_width,
            height: total_trap_height
        });
    }
}

function getEnemyStrength(type) {
    if (type === 'boss') return 5;
    if (type === 'extra_large') return 4;
    if (type === 'large') return 3;
    if (type === 'medium') return 2;
    return 1;
}

function cycle_stomp_target(reverse=false) {
    let valid_enemies = enemies.filter(e => !e.isDead).sort((a,b) => {
        let sa = getEnemyStrength(a.etype);
        let sb = getEnemyStrength(b.etype);
        if (sa !== sb) return sb - sa; // Higher strength first
        return b.y - a.y; // Then closest to fence (larger Y)
    });

    if (valid_enemies.length === 0) {
        stomp_target = null;
        return;
    }
    
    let idx = -1;
    if (stomp_target) {
        idx = valid_enemies.findIndex(e => e.id === stomp_target.id);
    }
    
    let next_idx = 0;
    if (idx !== -1) {
        if (reverse) {
            next_idx = (idx - 1 + valid_enemies.length) % valid_enemies.length;
        } else {
            next_idx = (idx + 1) % valid_enemies.length;
        }
    }
    
    stomp_target = valid_enemies[next_idx];
}
function process_stomp_attack() {
    // Maintenance for target
   if (stomp_target) {
       if (stomp_target.isDead || !enemies.includes(stomp_target)) {
           stomp_target = null;
           cycle_stomp_target(); 
       } else if (auto_stomp_enabled) {
           trigger_player_stomp();
       }
   } else {
       if (enemies.length > 0) cycle_stomp_target();
   }
}

function trigger_player_stomp() {
    let now = Date.now() / 1000;
    if (stomp_anim_active) return;
    if (now - last_stomp_time < stomp_cooldown_max) return;
    
    if (stomp_target && !stomp_target.isDead) {
        last_stomp_time = now;
        stomp_anim_active = true;
        stomp_anim_start = now;
        stomp_effect_pos = {x: stomp_target.x, y: stomp_target.y};
        stomp_hit_enemies.clear();
    }
}

function draw_stomp_effect() {
     // Reticle
     if (stomp_target && !stomp_target.isDead) {
        ctx.save();
        ctx.translate(stomp_target.x, stomp_target.y);
        let now = Date.now() / 1000;
        let pulse = Math.sin(now * 10) * 0.2 + 1; 
        ctx.scale(pulse, pulse);
        
        // Blue Ring (Double Size)
        ctx.strokeStyle = "rgba(0, 0, 255, 0.8)";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(0, 0, 40, 0, Math.PI*2);
        ctx.stroke();

        // Red Lines (Open Center)
        ctx.strokeStyle = "rgba(255, 0, 0, 0.8)";
        ctx.beginPath(); 
        ctx.moveTo(0, -50); ctx.lineTo(0, -15);
        ctx.moveTo(0, 50); ctx.lineTo(0, 15);
        ctx.moveTo(-50, 0); ctx.lineTo(-15, 0);
        ctx.moveTo(50, 0); ctx.lineTo(15, 0);
        ctx.stroke();

        ctx.restore();
    }

    if (!stomp_anim_active || !stomp_effect_pos) return;
    
    let now = Date.now() / 1000;
    let elapsed = now - stomp_anim_start;
    let duration = 0.5; // Stomp speed
    
    let impact_time = 0.3;
    
    if (elapsed > duration) {
        stomp_anim_active = false;
        return;
    }
    
    let upgrade_level = buy_menu_options[12].purchased; // 0, 1, 2
    let base_radius = 40;
    let radius = base_radius * Math.pow(2, upgrade_level); // 40, 80, 160
    
    let x = stomp_effect_pos.x;
    let y = stomp_effect_pos.y;
    
    // Boot Animation
    // Start high, come down fast
    let h_start = 200;
    let h_current = 0;
    
    if (elapsed < impact_time) {
        let t = elapsed / impact_time; // 0 to 1
        h_current = h_start * (1 - t * t); // Parabolic drop roughly
    } else {
         h_current = 0;
         // Impact phase
         // Visual Shockwave
         let shock_progress = (elapsed - impact_time) / (duration - impact_time);
         ctx.save();
         ctx.translate(x, y);
         ctx.scale(1, 0.5); // Perspective oval
         
         ctx.strokeStyle = "rgba(139, 69, 19, " + (1-shock_progress) + ")";
         ctx.lineWidth = 10;
         ctx.beginPath();
         ctx.arc(0, 0, radius * shock_progress, 0, Math.PI*2);
         ctx.stroke();
         ctx.fillStyle = "rgba(139, 69, 19, " + (0.5 * (1-shock_progress)) + ")";
         ctx.fill();
         ctx.restore();
         
         // Apply Damage ONCE
         if (stomp_hit_enemies.size === 0) {
             let damage = 1 + upgrade_level; // 1, 2, 3
             let hit_something = false;
             enemies.filter(e => !e.isDead).forEach(e => {
                 let d = Math.hypot(e.x - x, e.y - y);
                 if (d < radius) {
                     e.hp -= damage;
                     if (e.hp <= 0) removeEnemy(e);
                     hit_something = true;
                 }
             });

             // Friendly Fire (Stomp)
             for(let i=tower_units.length-1; i>=0; i--) {
                 let u = tower_units[i];
                 let d = Math.hypot(u.x - x, u.y - y);
                 if (d < radius) {
                     tower_units.splice(i, 1);
                     hit_something = true;
                 }
             }

             stomp_hit_enemies.add("done");
             if (hit_something) playSound('squish'); 
         }
    }
    
    // Draw Boot
    ctx.save();
    ctx.translate(x, y - h_current - 20); // -20 offset to center sole on target y
    
    // Shadow if high
    if (h_current > 10) {
        ctx.save();
        ctx.translate(0, h_current + 20); // Back to ground
        ctx.scale(1, 0.5);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        let s_rad = 30 * (1 - h_current/200);
        ctx.arc(0, 0, s_rad, 0, Math.PI*2);
        ctx.fill();
        ctx.restore();
    }

    // Leg
    ctx.fillStyle = "#5D4037"; // Brown Pants/Leg
    ctx.fillRect(-15, -100, 30, 100);
    
    // Boot
    ctx.fillStyle = "#3E2723"; // Dark Brown Boot
    ctx.beginPath();
    ctx.rect(-20, -20, 40, 40); // Heel/Ankle
    // Toe
    ctx.moveTo(20, 0);
    ctx.quadraticCurveTo(50, 0, 50, 20); // Toe tip
    ctx.lineTo(20, 20);
    ctx.lineTo(-20, 20); // Sole line
    ctx.lineTo(-20, -20);
    ctx.fill();
    
    ctx.strokeStyle = "black";
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Treads
    ctx.fillStyle = "#111"; // Sole
    ctx.fillRect(-20, 20, 70, 5); 

    ctx.restore();
}

// --- Logic Functions ---

function spawn_enemies() {
    let current_time = Date.now() / 1000;
    
    // Safety check for array bounds
    let waveIdx = wave_number - 1;
    if (waveIdx >= spawn_intervals['small'].length) waveIdx = spawn_intervals['small'].length - 1;

    for (const etype in spawn_intervals) {
        let interval = spawn_intervals[etype][waveIdx];
        let qty = quantities[etype][waveIdx];
        
        if (interval > 0 && (current_time - last_spawn_time[etype] >= interval)) {
            for (let i = 0; i < qty; i++) {
                let damage = 1;
                let hp = 1;
                let speed = 10;
                
                if (etype === "medium") { hp=3; speed=15; damage=3; }
                else if (etype === "large") { hp=5; speed=20; damage=5; }
                else if (etype === "extra_large") { hp=50; speed=4; damage=10; }
                else if (etype === "boss") { hp=100; speed=10; damage=100; } // Increased/Matched to 1hp ant speed (was 4)
                
                enemies.push(new Enemy(etype, hp, speed, damage));
            }
            last_spawn_time[etype] = current_time;
        }
    }
}

function heal_tower() {
    let healing_level = buy_menu_options[9]["purchased"];
    if (healing_level > 0) {
        const healing_intervals = {1: 10, 2: 5, 3: 2};
        let interval = healing_intervals[healing_level];
        if (Date.now() / 1000 - last_heal_time >= interval) {
            tower_hp = Math.min(max_tower_hp, tower_hp + 10);
            last_heal_time = Date.now() / 1000;
        }
    }
    return last_heal_time;
}

function fire_tower_projectile() {
    let upgrade = buy_menu_options[0]["purchased"];
    let cooldown = (upgrade >= 1) ? Math.max(1, 10 - 2 * (upgrade - 1)) : null;
    
    if (cooldown === null) return;

    let current_time = Date.now() / 1000;
    if (current_time - tower_last_projectile_time >= cooldown) {
        if (enemies.length > 0) {
           if (!focused_enemy || !enemies.includes(focused_enemy)) {
               focused_enemy = enemies.reduce((prev, curr) => (prev.hp > curr.hp) ? prev : curr);
           }
           
           for (let tower of towers) {
               let tc_x = tower.x + tower.size / 2;
               let tc_y = tower.y + tower.size / 2;
               let power = buy_menu_options[1]["purchased"];
               let damage = 1 + power;
               tower_projectiles.push(new TowerProjectile(tc_x, tc_y, focused_enemy.x, focused_enemy.y, damage));
           }
           tower_last_projectile_time = current_time;
           playSound('towerShoot');
        }
    }
}

function update_tower_projectiles() {
    for (let i = tower_projectiles.length - 1; i >= 0; i--) {
        let proj = tower_projectiles[i];
        proj.move();
        proj.draw();

        if (proj.x < 0 || proj.x > SCREEN_WIDTH || proj.y < 0 || proj.y > SCREEN_HEIGHT) {
            tower_projectiles.splice(i, 1);
            continue;
        }

        for (let j = enemies.length - 1; j >= 0; j--) {
             let enemy = enemies[j];
             let size_map = {"small": 10, "medium": 15, "large": 20, "extra_large": 25, "boss": 90};
             let enemy_radius = size_map[enemy.etype];
             let dx = enemy.x - proj.x;
             let dy = enemy.y - proj.y;
             if (Math.hypot(dx, dy) < enemy_radius + proj.radius) {
                 enemy.hp -= proj.damage;
                 if (enemy.hp <= 0) removeEnemy(enemy);
                 tower_projectiles.splice(i, 1);
                 break;
             }
        }
    }
}

function update_enemy_projectiles() {
    for (let i = enemy_projectiles.length - 1; i >= 0; i--) {
        let proj = enemy_projectiles[i];
        proj.move();
        proj.draw();

        if (proj.x < 0 || proj.x > SCREEN_WIDTH || proj.y < 0 || proj.y > SCREEN_HEIGHT) {
            enemy_projectiles.splice(i, 1);
            continue;
        }

        if (proj.y >= TOWER_Y) {
            if (shield_active && shield_hp > 0) {
                shield_hp = Math.max(0, shield_hp - proj.damage);
                if (shield_hp === 0) {
                    shield_active = false;
                    speak("Shield broken");
                    // Reset Net Purchases
                    buy_menu_options[10].purchased = 0; 
                    buy_menu_options[11].purchased = 0;
                }
                enemy_projectiles.splice(i, 1);
            } else {
                tower_hp = Math.max(0, tower_hp - proj.damage);
                enemy_projectiles.splice(i, 1);
            }
        }
    }
}

function update_tower_units() {
    // 1. Global Distance-Based Targeting (Greedy Assignment)
    // Clear current targets to re-evaluate based on best position
    tower_units.forEach(u => u.target = null);

    let candidates = [];
    let validEnemies = enemies.filter(e => !e.isDead);
    
    // Create all possible pairs
    tower_units.forEach(u => {
        validEnemies.forEach(e => {
            let d = Math.hypot(e.x - u.x, e.y - u.y);
            candidates.push({unit: u, enemy: e, dist: d});
        });
    });

    // Sort by distance (Closest pairs first)
    candidates.sort((a,b) => a.dist - b.dist);

    let assignedUnits = new Set();
    let assignedEnemies = new Set();

    // Pass 1: Assign 1-to-1 for optimal coverage (Spread out)
    candidates.forEach(c => {
        if (!assignedUnits.has(c.unit) && !assignedEnemies.has(c.enemy)) {
            c.unit.target = c.enemy;
            assignedUnits.add(c.unit);
            assignedEnemies.add(c.enemy);
        }
    });

    // Pass 2: Assign remaining units to their closest enemy (Double team)
    candidates.forEach(c => {
        if (!assignedUnits.has(c.unit)) {
            c.unit.target = c.enemy;
            assignedUnits.add(c.unit);
            // We don't care if enemy is assigned here, we just want the unit to do something
        }
    });

    // 2. Update Actions
    tower_units.forEach(unit => {
        unit.move();
        unit.draw();
        
        if (unit.target) {
            let dx = unit.target.x - unit.x;
            let dy = unit.target.y - unit.y;
            if (Math.hypot(dx, dy) < (unit.radius + unit.target.radius)) {
                unit.target.hp -= unit.damage;
                if (unit.target.hp <= 0) removeEnemy(unit.target);
                unit.isDead = true; 
            }
        }
    });

    // Clean up dead units
    for(let i = tower_units.length - 1; i >= 0; i--) {
        if (tower_units[i].isDead) {
            tower_units.splice(i, 1);
        }
    }
}

function drop_bomb_effect() {
    let bomb_center = {x: SCREEN_WIDTH / 2, y: SCREEN_HEIGHT / 2};
    let elapsed = Date.now() / 1000 - bomb_start_time;
    let max_radius = 1500;
    let current_radius = (elapsed / bomb_duration) * max_radius;

    // Use Smoke Color
    ctx.fillStyle = "rgba(200, 200, 200, 0.4)";
    ctx.beginPath();
    ctx.arc(bomb_center.x, bomb_center.y, current_radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Ring
    ctx.strokeStyle = "rgba(100, 100, 100, 0.5)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(bomb_center.x, bomb_center.y, current_radius, 0, Math.PI * 2);
    ctx.stroke();

    enemies.forEach(enemy => {
        let dist = Math.hypot(enemy.x - bomb_center.x, enemy.y - bomb_center.y);
        if (dist < current_radius) {
            if (!bomb_hit_enemies.has(enemy.id)) {
                enemy.hp -= bomb_damage;
                bomb_hit_enemies.add(enemy.id);
                if (enemy.hp <= 0) removeEnemy(enemy);
            }
        }
    });

    // Friendly Fire (Bomb)
    for(let i=tower_units.length-1; i>=0; i--) {
        let u = tower_units[i];
        let d = Math.hypot(u.x - bomb_center.x, u.y - bomb_center.y);
        if (d < current_radius) {
             // Instant kill or damage? Let's say kill for consistency with "collateral damage"
             tower_units.splice(i, 1);
        }
    }

    if (elapsed >= bomb_duration) {
        bomb_active = false;
    }
}

function draw_laser_beams() {
    if (towers.length === 0) return;
    let main_tower = towers.reduce((prev, curr) => Math.abs((curr.x + curr.size/2) - SCREEN_WIDTH/2) < Math.abs((prev.x + prev.size/2) - SCREEN_WIDTH/2) ? curr : prev);
    let tower_center_x = main_tower.x + main_tower.size/2;
    
    let y_top = 70;
    let y_bottom = TOWER_Y;
    let progress = (Date.now() / 1000 - laser_start_time) / 3.0;
    if (progress > 1) progress = 1;

    let left_bound = 50;
    let right_bound = SCREEN_WIDTH - 50;
    let left_beam_x = tower_center_x - progress * (tower_center_x - left_bound);
    let right_beam_x = tower_center_x + progress * (right_bound - tower_center_x);
    let beam_thickness = 10;

    // Jagged Zapper Beam Look
    ctx.strokeStyle = "#8A2BE2"; // BlueViolet
    ctx.shadowColor = "#FFF"; ctx.shadowBlur = 10;
    ctx.lineWidth = beam_thickness;
    
    // Simple draw
    ctx.beginPath();
    ctx.moveTo(left_beam_x, y_top);
    ctx.lineTo(left_beam_x, y_bottom);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(right_beam_x, y_top);
    ctx.lineTo(right_beam_x, y_bottom);
    ctx.stroke();
    
    // Add "Electricity" pattern overlay
    ctx.strokeStyle = "white";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(left_beam_x, y_top);
    for(let y=y_top; y<y_bottom; y+=20) {
        ctx.lineTo(left_beam_x + (Math.random()-0.5)*15, y);
    }
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(right_beam_x, y_top);
    for(let y=y_top; y<y_bottom; y+=20) {
        ctx.lineTo(right_beam_x + (Math.random()-0.5)*15, y);
    }
    ctx.stroke();
    
    ctx.shadowBlur = 0;

    let tolerance = beam_thickness / 2 + 5;
    enemies.forEach(enemy => {
        if (enemy.y >= y_top && enemy.y <= y_bottom) {
            if (Math.abs(enemy.x - left_beam_x) < tolerance || Math.abs(enemy.x - right_beam_x) < tolerance) {
                if (!laser_hit_enemies.has(enemy.id)) {
                    enemy.hp -= 1;
                    laser_hit_enemies.add(enemy.id);
                    if (enemy.hp <= 0) removeEnemy(enemy);
                }
            }
        }
    });

    // Friendly Fire (Laser)
    for(let i=tower_units.length-1; i>=0; i--) {
        let u = tower_units[i];
         // Simple check against beams
         let hit = false;
         if (u.y >= y_top && u.y <= y_bottom) {
             if (Math.abs(u.x - left_beam_x) < tolerance || Math.abs(u.x - right_beam_x) < tolerance) {
                 hit = true;
             }
         }
         
         // Zapped!
         if (hit) {
             tower_units.splice(i, 1);
         }
    }
}

function draw_shield() {
    if (shield_active && shield_hp > 0) {
        let shield_y = TOWER_Y - 20;
        let h = 40;
        
        ctx.save();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = "#eee"; // White Net
        ctx.lineWidth = 2;
        
        // Horizontal lines
        for(let yy=shield_y; yy<=shield_y+h; yy+=10) {
             ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(SCREEN_WIDTH, yy); ctx.stroke();
        }
        // Vertical lines
        for(let xx=0; xx<=SCREEN_WIDTH; xx+=20) {
             ctx.beginPath(); ctx.moveTo(xx, shield_y); ctx.lineTo(xx, shield_y+h); ctx.stroke();
        }
        
        // Stronger Top/Bottom
        ctx.strokeStyle = "#666";
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, shield_y); ctx.lineTo(SCREEN_WIDTH, shield_y); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, shield_y+h); ctx.lineTo(SCREEN_WIDTH, shield_y+h); ctx.stroke();

        ctx.restore();
    }
}

function check_shield_damage() {
    let damageLine = TOWER_Y - 30; // 30px above the ground (fence level)
    for (let i = enemies.length - 1; i >= 0; i--) {
        let enemy = enemies[i];
        if (enemy.isDead) continue;
        if (enemy.y >= damageLine) {
            if (shield_active && shield_hp > 0) {
                shield_hp -= enemy.damage;
                if (shield_hp <= 0) {
                    shield_hp = 0;
                    shield_active = false;
                    speak("Net broken");
                    // Reset Net Purchases so it can be bought again
                    buy_menu_options[10].purchased = 0; // Add Bug Net
                    buy_menu_options[11].purchased = 0; // Upgrade Net
                }
                removeEnemy(enemy);
                playSound('hitTower');
            } else {
                tower_hp = Math.max(0, tower_hp - enemy.damage);
                removeEnemy(enemy);
                playSound('hitTower');
            }
        }
    }
}

// --- UI / HUD ---

// Helper to lighten hex color (very simple implementation)
function lightenColor(color, percent) {
     return color; // Placeholder - implementing full hex logic is bulky, transparency works better.
}

function draw_health_bar() {
    let bar_width = SCREEN_WIDTH - 100;
    let bar_height = 40;
    let bar_x = 50;
    let bar_y = 20;

    // Background container
    ctx.fillStyle = "#222";
    ctx.strokeStyle = "#555";
    ctx.lineWidth = 2;
    ctx.fillRect(bar_x, bar_y, bar_width, bar_height);
    ctx.strokeRect(bar_x, bar_y, bar_width, bar_height);

    // HP Color Logic
    let ratio = Math.max(0, tower_hp / max_tower_hp);
    let color = "#00FF00"; // Green
    if (ratio <= 0.33) color = "#FF0000"; // Red
    else if (ratio <= 0.66) color = "#FFFF00"; // Yellow
    
    // Fill with gradient for glass effect
    let grad = ctx.createLinearGradient(bar_x, bar_y, bar_x, bar_y + bar_height);
    grad.addColorStop(0, color);
    grad.addColorStop(1, color);

    ctx.fillStyle = grad;
    // Clipped fill
    let fillWidth = Math.max(0, bar_width * ratio);
    ctx.fillRect(bar_x, bar_y, fillWidth, bar_height);
    
    // Text overlay
    ctx.fillStyle = "white";
    ctx.shadowColor = "black"; ctx.shadowBlur = 4;
    ctx.font = "bold 24px 'Segoe UI'";
    let text = `HP: ${Math.floor(tower_hp)} / ${max_tower_hp}`;
    ctx.fillText(text, bar_x + bar_width/2 - ctx.measureText(text).width/2, bar_y + 28);
    ctx.shadowBlur = 0;

    // Shield Bar (Net)
    if (shield_active && max_shield_hp > 0) {
        let shield_bar_y = bar_y + bar_height + 5; // y=65
        let shield_bar_h = 20;
        
        // Background
        ctx.fillStyle = "#1a237e"; // Dark Blue background
        ctx.fillRect(bar_x, shield_bar_y, bar_width, shield_bar_h);
        ctx.strokeStyle = "#3949ab";
        ctx.lineWidth = 1;
        ctx.strokeRect(bar_x, shield_bar_y, bar_width, shield_bar_h);

        // Fill
        let sRatio = Math.max(0, shield_hp / max_shield_hp);
        ctx.fillStyle = "#00e5ff"; // Cyan/Electric Blue
        // Gradient for effect
        let sGrad = ctx.createLinearGradient(bar_x, shield_bar_y, bar_x, shield_bar_y + shield_bar_h);
        sGrad.addColorStop(0, "#00e5ff");
        sGrad.addColorStop(1, "#00bcd4");
        ctx.fillStyle = sGrad;

        ctx.fillRect(bar_x, shield_bar_y, bar_width * sRatio, shield_bar_h);

        // Text
        ctx.fillStyle = "white"; // Black text on cyan is readable? Or white with shadow.
        ctx.shadowColor = "black"; ctx.shadowBlur = 3;
        ctx.font = "bold 14px 'Segoe UI'";
        let sText = `NET: ${Math.floor(shield_hp)} / ${max_shield_hp}`;
        ctx.fillText(sText, bar_x + bar_width/2 - ctx.measureText(sText).width/2, shield_bar_y + 15);
        ctx.shadowBlur = 0;
    }
}

function draw_timer_bar() {
    let bar_width = SCREEN_WIDTH - 100;
    let bar_height = 10; // Thinner
    let bar_x = 50;
    let bar_y = 95; // Moved down to accommodate shield bar 

    let elapsed = Date.now() / 1000 - game_time_start;
    let remaining_ratio = Math.max(0, 1 - elapsed / ROUND_DURATION);

    ctx.fillStyle = "#333";
    ctx.fillRect(bar_x, bar_y, bar_width, bar_height);
    
    ctx.fillStyle = "#5f9ea0"; // CadetBlue (Grayish Blue)
    ctx.shadowColor = "#5f9ea0"; ctx.shadowBlur = 5;
    ctx.fillRect(bar_x, bar_y, bar_width * remaining_ratio, bar_height);
    ctx.shadowBlur = 0;
}

function draw_flower(f, pct=1) {
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(f.scale, f.scale);
    
    // Sway & Wilt
    let sway = Math.sin(Date.now() / 500 + f.swayOffset) * 5 * (Math.PI / 180);
    // If rotting (pct < 0.5), bend over (wilt) significantly
    let wilt = 0;
    if (pct <= 0.5) wilt = 45 * (Math.PI / 180) * ( 1 - pct*2 ); // Grows as pct drops
    ctx.rotate(sway + wilt);

    // Stem
    ctx.strokeStyle = (pct <= 0.25) ? "#5d4037" : "#2e7d32"; // Brown if dead
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    if (pct <= 0.5) {
         ctx.quadraticCurveTo(5, -10, 8, -15); // Drooping
    } else {
         ctx.lineTo(0, -20); // Normal
    }
    ctx.stroke();
    
    // Leaves
    ctx.fillStyle = (pct <= 0.25) ? "#5d4037" : "#388e3c";
    if (pct > 0.25) { 
        ctx.beginPath();
        ctx.ellipse(-5, -10, 8, 3, Math.PI/4, 0, Math.PI*2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(5, -10, 8, 3, -Math.PI/4, 0, Math.PI*2);
        ctx.fill();
    }

    ctx.translate(0, (pct <= 0.5) ? -15 : -20); // Move to flower head

    // If completely dead, maybe no flower head or withered brown head
    if (pct <= 0.25) {
        ctx.fillStyle = "#3e2723"; // Dark Brown
        ctx.beginPath(); ctx.arc(0,0, 4, 0, Math.PI*2); ctx.fill(); 
        ctx.restore();
        return; // No petals
    }
    
    let isWithered = (pct <= 0.5);

    if (f.type === 'sunflower') {
        // Petals
        ctx.fillStyle = isWithered ? "#9e9d24" : "#fdd835";
        for(let i=0; i<8; i++) {
            ctx.beginPath();
            ctx.ellipse(0, 0, 4, 12, i * (Math.PI/4), 0, Math.PI*2);
            ctx.fill();
        }
        // Center
        ctx.fillStyle = "#3e2723";
        ctx.beginPath(); ctx.arc(0,0, 6, 0, Math.PI*2); ctx.fill();
    } 
    else if (f.type === 'rose') {
        // Layers
        ctx.fillStyle = isWithered ? "#8d6e63" : "#d32f2f";
        ctx.beginPath(); ctx.arc(0,0, 8, 0, Math.PI*2); ctx.fill();
        ctx.fillStyle = isWithered ? "#5d4037" : "#b71c1c";
        ctx.beginPath(); ctx.arc(2, -2, 4, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.arc(-2, 2, 4, 0, Math.PI*2); ctx.fill();
    }
    else if (f.type === 'tulip') {
        let col = (f.scale > 1) ? "#ab47bc" : "#f06292";
        if(isWithered) col = "#795548";
        ctx.fillStyle = col;
        ctx.beginPath();
        // Cup shape
        ctx.moveTo(-8, -10);
        ctx.quadraticCurveTo(0, 10, 8, -10); // Bottom curve
        // Zigzag top
        ctx.lineTo(4, -4); ctx.lineTo(0, -10); ctx.lineTo(-4, -4); ctx.lineTo(-8, -10);
        ctx.fill();
    }
    else { // Daisy/Generic
        ctx.fillStyle = isWithered ? "#d7ccc8" : "white";
        for(let i=0; i<6; i++) {
            ctx.beginPath();
            ctx.ellipse(0, 0, 3, 10, i * (Math.PI/3), 0, Math.PI*2);
            ctx.fill();
        }
        ctx.fillStyle = isWithered ? "#5d4037" : "yellow";
        ctx.beginPath(); ctx.arc(0,0,3, 0, Math.PI*2); ctx.fill();
    }

    ctx.restore();
}

function draw_damage_zone() {
    // Decay Logic
    let pct = (max_tower_hp > 0) ? (tower_hp / max_tower_hp) : 1;
    let groundColor = "#81c784";
    if (pct <= 0.25) groundColor = "#a1887f"; // Brown
    else if (pct <= 0.50) groundColor = "#dce775"; // Yellowish
    else if (pct <= 0.75) groundColor = "#aed581"; // Light Green

    // Garden Zone (Green with details)
    ctx.fillStyle = groundColor; 
    ctx.fillRect(0, TOWER_Y, SCREEN_WIDTH, SCREEN_HEIGHT - TOWER_Y);
    
    // Draw Flowers (sorted by Y so lower ones cover higher ones)
    // Actually standard sort might be flickering if y is generated random. 
    // They are static so sort once or just draw. Arrays are stable.
    // garden_flowers.sort((a,b) => a.y - b.y); // Performance hit every frame? No need if static list.
    // Let's just draw them.
    for(let i=0; i<garden_flowers.length; i++) {
        draw_flower(garden_flowers[i], pct);
    }
    
    // White Picket Fence
    let fenceH = 40;
    let fenceW = 15;
    let gap = 5;
    
    ctx.fillStyle = "#FFF";
    ctx.shadowColor = "rgba(0,0,0,0.2)"; ctx.shadowBlur = 2;
    
    // Horizontal Bars
    ctx.fillRect(0, TOWER_Y - 25, SCREEN_WIDTH, 4);
    ctx.fillRect(0, TOWER_Y - 10, SCREEN_WIDTH, 4);

    for(let i=0; i<SCREEN_WIDTH; i+=(fenceW+gap)) {
        // Picket
        ctx.beginPath();
        ctx.moveTo(i, TOWER_Y);
        ctx.lineTo(i+fenceW, TOWER_Y);
        ctx.lineTo(i+fenceW, TOWER_Y - fenceH + 10);
        ctx.lineTo(i+fenceW/2, TOWER_Y - fenceH); // Pointy top
        ctx.lineTo(i, TOWER_Y - fenceH + 10);
        ctx.closePath();
        ctx.fill();
    }
    ctx.shadowBlur = 0;
}

function draw_window_controls() {
    let now = Date.now() / 1000;

    // Timer Icons (Bomb and Laser)
    if (gameState === 'PLAYING') {
        let size = 60;
        let margin = 20;
        // Anchor to Bottom Right Stomp Icon
        let stompX = SCREEN_WIDTH - size - margin;
        let stompY = SCREEN_HEIGHT - size - margin;
        
        // Stack to the left of the Stomp icon
        let iconSize = 40;
        let gap = 10;
        let offsetX = stompX - gap - iconSize;
        let currentY = stompY + (size - iconSize); // Bottom aligned

        // Bomb Timer
        if (buy_menu_options[6].purchased >= 1) {
            let interval = 120;
            if (buy_menu_options[7].purchased >= 1) interval = 60;
            
            let elapsed = now - bomb_last_time;
            if (elapsed > interval) elapsed = interval;
            let pct = elapsed / interval;

            // Draw Background
            ctx.fillStyle = "rgba(0,0,0,0.4)";
            ctx.beginPath(); ctx.arc(offsetX + iconSize/2, currentY + iconSize/2, iconSize/2, 0, Math.PI*2); ctx.fill();

            // Progress Sector
            if (pct < 1.0) {
                 ctx.fillStyle = "rgba(255, 100, 100, 0.6)"; 
                 ctx.beginPath();
                 ctx.moveTo(offsetX + iconSize/2, currentY + iconSize/2);
                 ctx.arc(offsetX + iconSize/2, currentY + iconSize/2, iconSize/2, -Math.PI/2, -Math.PI/2 + pct*Math.PI*2, false);
                 ctx.fill();
            } else {
                 // Ready Glow
                 ctx.strokeStyle = "rgba(255, 50, 50, 0.8)";
                 ctx.lineWidth = 2;
                 ctx.beginPath(); ctx.arc(offsetX + iconSize/2, currentY + iconSize/2, iconSize/2, 0, Math.PI*2); ctx.stroke();
            }

            // Bomb Icon '💣'
            ctx.font = `${iconSize*0.6}px Segoe UI, sans-serif`;
            ctx.fillStyle = "white";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("💣", offsetX + iconSize/2, currentY + iconSize/2);

            offsetX -= (iconSize + gap);
        }

        // Laser Timer
        if (buy_menu_options[8].purchased >= 1) {
            let interval = 30;
            let elapsed = now - last_laser_time;
            if (elapsed > interval) elapsed = interval;
            let pct = elapsed / interval;

            // Draw Background
            ctx.fillStyle = "rgba(0,0,0,0.4)";
            ctx.beginPath(); ctx.arc(offsetX + iconSize/2, currentY + iconSize/2, iconSize/2, 0, Math.PI*2); ctx.fill();

            // Progress Sector
            if (pct < 1.0) {
                 ctx.fillStyle = "rgba(100, 100, 255, 0.6)"; 
                 ctx.beginPath();
                 ctx.moveTo(offsetX + iconSize/2, currentY + iconSize/2);
                 ctx.arc(offsetX + iconSize/2, currentY + iconSize/2, iconSize/2, -Math.PI/2, -Math.PI/2 + pct*Math.PI*2, false);
                 ctx.fill();
            } else {
                 ctx.strokeStyle = "rgba(100, 100, 255, 0.8)";
                 ctx.lineWidth = 2;
                 ctx.beginPath(); ctx.arc(offsetX + iconSize/2, currentY + iconSize/2, iconSize/2, 0, Math.PI*2); ctx.stroke();
            }

            // Laser Icon '⚡'
            ctx.font = `${iconSize*0.6}px Segoe UI, sans-serif`;
            ctx.fillStyle = "yellow";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("⚡", offsetX + iconSize/2, currentY + iconSize/2);

            offsetX -= (iconSize + gap);
        }
        
        ctx.textAlign = "start"; // Reset default
    }

    // Stomp Cooldown Indicator (Bottom Right)
    if (gameState === 'PLAYING') {
        let size = 60;
        let margin = 20;
        let x = SCREEN_WIDTH - size - margin;
        let y = SCREEN_HEIGHT - size - margin;

        // Draw Background
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.beginPath(); ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI*2); ctx.fill();

        // Calculate progress
        let elapsed = now - last_stomp_time;
        if (elapsed > stomp_cooldown_max) elapsed = stomp_cooldown_max;
        let pct = elapsed / stomp_cooldown_max;

        // Draw Boot Print (Faded)
        function drawBootPrint(color, alpha) {
            ctx.save();
            ctx.translate(x + size/2, y + size/2);
            ctx.scale(0.7, 0.7);
            ctx.fillStyle = color;
            ctx.globalAlpha = alpha;
            // Sole
            ctx.beginPath(); ctx.ellipse(0, -10, 14, 18, 0, 0, Math.PI*2); ctx.fill();
            // Heel
            ctx.beginPath(); ctx.ellipse(0, 18, 12, 9, 0, 0, Math.PI*2); ctx.fill();
            // Treads
            if(alpha > 0.8) {
               ctx.globalCompositeOperation = 'destination-out';
               ctx.strokeStyle = "black"; ctx.lineWidth = 3;
               for(let t=-20; t<2; t+=7) {
                   ctx.beginPath(); ctx.moveTo(-10, t); ctx.lineTo(10,t); ctx.stroke();
               }
               ctx.globalCompositeOperation = 'source-over';
            }
            ctx.restore();
        }
        drawBootPrint("#8d6e63", 0.5);

        // Radial Progress
        if (pct < 1.0) {
             ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
             ctx.beginPath();
             ctx.moveTo(x + size/2, y + size/2);
             ctx.arc(x + size/2, y + size/2, size/2, -Math.PI/2, -Math.PI/2 + (1-pct)*Math.PI*2, true);
             ctx.fill();
        } else {
             // Ready Glow
             ctx.strokeStyle = "rgba(0, 255, 0, 0.8)";
             ctx.lineWidth = 3;
             ctx.beginPath(); ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI*2); ctx.stroke();
             
             // Full Opacity Print
             drawBootPrint("#D7B59F", 1.0);
        }
    }

    // Pause Button (Bottom Left)
    if (gameState === 'PLAYING') {
        let size = 60; 
        let margin = 20;
        let x = margin;
        let y = SCREEN_HEIGHT - size - margin;
        
        ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
        ctx.beginPath();
        ctx.arc(x + size/2, y + size/2, size/2, 0, Math.PI*2);
        ctx.fill();
        
        ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
        ctx.lineWidth = 2;
        ctx.stroke();

        // Icon
        ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
        let barW = 8; let barH = 24; let gap = 10;
        ctx.fillRect(x + size/2 - gap/2 - barW, y + size/2 - barH/2, barW, barH);
        ctx.fillRect(x + size/2 + gap/2, y + size/2 - barH/2, barW, barH);
    }
}

// --- Menu Functions ---

let purchaseHistory = [];

// New: Store State Backup
let store_backup_state = null;

function save_store_state() {
    store_backup_state = {
        points: points,
        tower_hp: tower_hp,
        max_tower_hp: max_tower_hp,
        shield_hp: shield_hp,
        max_shield_hp: max_shield_hp,
        shield_active: shield_active,
        stomp_cooldown_max: stomp_cooldown_max,
        // Deep copy buy menu options
        buy_menu_options: JSON.parse(JSON.stringify(buy_menu_options))
    };
    console.log("Store state saved. Points:", points);
}

function restore_store_state() {
    if (!store_backup_state) return;
    
    points = store_backup_state.points;
    tower_hp = store_backup_state.tower_hp;
    max_tower_hp = store_backup_state.max_tower_hp;
    shield_hp = store_backup_state.shield_hp;
    max_shield_hp = store_backup_state.max_shield_hp;
    shield_active = store_backup_state.shield_active;
    stomp_cooldown_max = store_backup_state.stomp_cooldown_max;
    
    // Deep copy back
    buy_menu_options = JSON.parse(JSON.stringify(store_backup_state.buy_menu_options));
    
    purchaseHistory = []; // Clear current session history
    
    console.log("Store state restored. Points:", points);
}

function enter_store(save_state=true) {
    if (save_state) {
        save_store_state();
    }
    
    gameState = 'BUY';
    click_block_time = Date.now() + 300;
    menu_selected_index = -1; 
    
    if (points === 0) {
        speak("Garden store: you don't have any money to make a purchase");
    } else {
        speak(`Garden store: you have ${points} points`);
    }
}

function reset_game_state() {
    wave_number = 1;
    points = 0;
    tower_hp = TOWER_MAX_HP;
    max_tower_hp = TOWER_MAX_HP;
    enemies = [];
    tower_projectiles = [];
    tower_units = [];
    shield_active = false;
    shield_hp = 0;
    max_shield_hp = 0;
    
    purchaseHistory = []; // Clear global history
    
    for (let k in last_spawn_time) last_spawn_time[k] = Date.now() / 1000;
    tower_last_projectile_time = Date.now() / 1000;
    
    // Position
    TOWER_X = SCREEN_WIDTH / 2 - TOWER_SIZE / 2;
    TOWER_Y = SCREEN_HEIGHT - 180;

    // Initialize Flowers if empty (first run) or reset
    if (garden_flowers.length === 0 || garden_flowers.length > 0) { // Force regen for clean layout
        garden_flowers = [];
        let flower_types = ['sunflower', 'rose', 'tulip', 'daisy'];
        
        let left_zone_end = TOWER_X - 20;
        let right_zone_start = TOWER_X + TOWER_SIZE + 20;
        
        // nice pattern: 2 rows?
        // Left Side
        for (let i = 0; i < 8; i++) { // Not too many
            let type = flower_types[i % flower_types.length];
            let fx = (left_zone_end / 9) * (i + 1); 
            let fy = TOWER_Y + 50 + (i%2)*30; // Staggered
            let scale = 0.8 + Math.random() * 0.2;
            garden_flowers.push({x: fx, y: fy, type: type, scale: scale, swayOffset: Math.random() * 100});
        }
        
        // Right Side
        let r_width = SCREEN_WIDTH - right_zone_start;
        for (let i = 0; i < 8; i++) {
            let type = flower_types[(i+2) % flower_types.length];
            let fx = right_zone_start + (r_width / 9) * (i + 1);
            let fy = TOWER_Y + 50 + (i%2)*30;
            let scale = 0.8 + Math.random() * 0.2;
            garden_flowers.push({x: fx, y: fy, type: type, scale: scale, swayOffset: Math.random() * 100});
        }
    }

    towers = [new Tower(TOWER_X, TOWER_Y)];
    
    buy_menu_options = JSON.parse(JSON.stringify(initial_buy_menu_options));
    
    // Generate Grass
    grass_blades = [];
    for(let i=0; i<300; i++) {
        grass_blades.push({
            x: Math.random() * SCREEN_WIDTH,
            y: Math.random() * (SCREEN_HEIGHT - 180), // Above dirt line
            h: 5 + Math.random() * 8,
            angle: (Math.random() - 0.5) * 0.5
        });
    }
}

function start_level() {
    purchaseHistory = []; // Clear session history
    gameState = 'LEVEL_INTRO'; // Was 'PLAYING'
    level_intro_start_time = Date.now() / 1000;
    speak(`Level ${wave_number}`);
    
    // We will set game_time_start when intro finishes
    // game_time_start = Date.now() / 1000; 
    
    last_heal_time = Date.now() / 1000; // Reset timers so things don't accumulation during buy
    
    // But spawn timers, unit timers, etc should be reset when actual play starts?
    // Let's reset them here, but the loop won't run them until PLAYING.
    // However, if we wait 3 seconds, Date.now() increases. 
    // So better to reset them at end of intro.
    
    enemies = [];
    tower_projectiles = [];
    tower_units = [];
    
    // Shield Reset logic
    if (buy_menu_options[10].purchased >= 1) {
        shield_active = true;
        max_shield_hp = 50 + 25 * buy_menu_options[11].purchased;
        shield_hp = max_shield_hp;
    } else {
        shield_active = false;
        shield_hp = 0;
    }

    // Towers Setup
    TOWER_X = SCREEN_WIDTH / 2 - TOWER_SIZE / 2;
    towers = [new Tower(TOWER_X, TOWER_Y, "main")];
    
    let main_size = TOWER_SIZE;
    let wing_size = TOWER_SIZE * 0.7;
    let wing_y_offset = main_size - wing_size;

    if (buy_menu_options[5].purchased >= 1) {
        // Right Wing
        towers.push(new Tower(TOWER_X + main_size, TOWER_Y + wing_y_offset, "wing"));
    }
    if (buy_menu_options[5].purchased >= 2) {
         // Left Wing
         towers.unshift(new Tower(TOWER_X - wing_size, TOWER_Y + wing_y_offset, "wing"));
    }
    
    // Reset effects triggers
    last_laser_time = Date.now() / 1000; // Will be offset by intro duration effectively delaying them
    laser_active = false;
    bomb_last_time = Date.now() / 1000;
    bomb_active = false;
}

function finish_level_intro() {
    gameState = 'PLAYING';
    let now = Date.now() / 1000;
    game_time_start = now;
    
    for (let k in last_spawn_time) last_spawn_time[k] = now;
    tower_last_unit_spawn_time = now;
    
    last_heal_time = now;
    last_laser_time = now; // Ready to charge
    bomb_last_time = now;
    tower_last_projectile_time = now;
    
    stomp_anim_active = false;
    last_stomp_time = now - stomp_cooldown_max; // Ready immediately? No, let it charge? No usually ready.
}

function draw_level_intro() {
    // Draw game briefly in background? Or just black/clean?
    // Let's draw the yard so it looks seamless
    ctx.fillStyle = "#4caf50"; ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    draw_damage_zone();
    draw_grass();
    for (let t of towers) t.draw(ctx);
    
    // Overlay
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    let now = Date.now() / 1000;
    let elapsed = now - level_intro_start_time;
    let remaining = LEVEL_INTRO_DURATION - elapsed;
    
    if (remaining <= 0) {
        finish_level_intro();
        return;
    }
    
    ctx.fillStyle = "white";
    let fontSize = Math.min(80, SCREEN_WIDTH / 8);
    ctx.font = `bold ${fontSize}px 'Segoe UI'`;
    let text = `WAVE ${wave_number}`;
    ctx.shadowColor = "black"; ctx.shadowBlur = 10;
    ctx.fillText(text, SCREEN_WIDTH/2 - ctx.measureText(text).width/2, SCREEN_HEIGHT/2 - 20);
    
    ctx.font = `bold ${fontSize/2}px 'Segoe UI'`;
    let sub = "Get Ready...";
    if (remaining < 1.0) sub = "GO!";
    ctx.fillText(sub, SCREEN_WIDTH/2 - ctx.measureText(sub).width/2, SCREEN_HEIGHT/2 + fontSize);
    ctx.shadowBlur = 0;
}

// --- Menu Rendering & Input Helpers ---
let menu_selected_index = 0;
let last_key_time = 0;

// Need a rect helper for clicks
function isPointInRect(x, y, rect) {
    return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

// Buy Menu State
let buy_rects = [];
let buy_buttons_rects = [];

function draw_buy_menu() {
    // Wood background
    ctx.fillStyle = "#8d6e63"; 
    ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    // Title
    ctx.fillStyle = "#3e2723";
    let titleSize = Math.max(24, Math.min(60, SCREEN_WIDTH / 12));
    ctx.font = `bold ${titleSize}px "Segoe UI", sans-serif`; // Smaller title
    let title = `GARDEN STORE - LEVEL ${wave_number}`;
    ctx.fillText(title, SCREEN_WIDTH/2 - ctx.measureText(title).width/2, SCREEN_HEIGHT * 0.08);
    
    // Points
    ctx.fillStyle = "#ffeb3b"; 
    let budgetSize = Math.max(16, Math.min(26, SCREEN_WIDTH / 20));
    ctx.font = `bold ${budgetSize}px 'Courier New', monospace`;
    let pText = `BUDGET: ${points}`;
    ctx.fillText(pText, SCREEN_WIDTH/2 - ctx.measureText(pText).width/2, SCREEN_HEIGHT * 0.14);

    if (points === 0) {
        ctx.fillStyle = "#ff8a80"; // Light Red
        let warnSize = Math.max(14, budgetSize * 0.7);
        ctx.font = `italic ${warnSize}px 'Segoe UI', sans-serif`;
        let warnText = "No money to purchase items";
        ctx.fillText(warnText, SCREEN_WIDTH/2 - ctx.measureText(warnText).width/2, SCREEN_HEIGHT * 0.14 + budgetSize + 4);
    }

    let top_margin = SCREEN_HEIGHT * 0.2;
    let bottom_margin = SCREEN_HEIGHT * 0.15;
    let side_margin = SCREEN_WIDTH * 0.05;
    let gap_x = SCREEN_WIDTH * 0.02;
    let gap_y = SCREEN_HEIGHT * 0.02;
    
    // Filter options based on visibility rules
    let visible_options = [];
    for (let i = 0; i < buy_menu_options.length; i++) {
        let item = buy_menu_options[i];
        let show = true;
        if (points < item.cost) show = false;
        if (item.purchased >= item.max) show = false;
        // Prerequisites check
        if (i === 1 && buy_menu_options[0].purchased < 1) show = false;
        if (i === 4 && buy_menu_options[3].purchased < 1) show = false;
        if (i === 7 && buy_menu_options[6].purchased < 1) show = false;
        if (i === 11 && buy_menu_options[10].purchased < 1) show = false;
        
        // Healing Visibility
        if (i === 2) {
            let needsHeal = (tower_hp < max_tower_hp);
            if (shield_active && shield_hp < max_shield_hp) needsHeal = true;
            if (!needsHeal) show = false;
        }

        if (show) visible_options.push({item: item, originalIndex: i});
    }

    // Dynamic Columns - Adjusted
    // On large screens (PC), we want more columns to fill width, making buttons larger horizontally?
    // Or just make buttons larger.
    // Let's use a dynamic size calculation.
    let cols = 3; 
    
    // Adjusted logic: Prefer 2 columns on mobile to prevent vertical overflow
    if (SCREEN_WIDTH < 600) cols = 2; 
    if (SCREEN_WIDTH < 340) cols = 1; // Only go to 1 column on extremely narrow devices

    // If on very wide screen, can use 4 or 5
    if (SCREEN_WIDTH > 1200) cols = 4;

    let columns = cols;
    let rows = Math.ceil(visible_options.length / columns);
    if (rows === 0) rows = 1; 

    // Adjust button height based on rows, but don't let them get too small
    let button_area_height = SCREEN_HEIGHT - (top_margin + bottom_margin);
    
    // Reduce gap on mobile if crowded
    if (rows > 6) gap_y = Math.min(gap_y, 4);

    let button_height = (button_area_height - (rows - 1) * gap_y) / rows;
    
    // Limits
    let max_h = 140; // PC comfortable max
    let min_h = 40;  // Allow smaller on mobile
    if (button_height > max_h) button_height = max_h;
    if (button_height < min_h) {
         button_height = min_h;
         // If we still overflow with min_h, we might need to force more columns or scroll
         // But 2 columns usually solves this unless we have 20+ items.
    }
    
    let button_width = (SCREEN_WIDTH - 2 * side_margin - (columns - 1) * gap_x) / columns;
    // If buttons are too squashed, we might need to overlap or scroll (not impl), but 2 cols should help.

    buy_rects = [];

    for (let k = 0; k < visible_options.length; k++) {
        let opt = visible_options[k];
        let col = k % columns;
        let row = Math.floor(k / columns);
        let x = side_margin + col * (button_width + gap_x);
        let y = top_margin + row * (button_height + gap_y);
        
        buy_rects.push({x: x, y: y, w: button_width, h: button_height, item: opt.item, index: opt.originalIndex});
        
        let isSelected = (menu_selected_index === opt.originalIndex);

        ctx.save();
        ctx.fillStyle = isSelected ? "#fff9c4" : "#f5f5f5";
        ctx.beginPath();
        // Round rect check if supported context or polyfill? usually standard now in modern browsers
        // If fails, fillRect.
        if (ctx.roundRect) {
             ctx.roundRect(x, y, button_width, button_height, 10);
        } else {
             ctx.rect(x, y, button_width, button_height);
        }
        ctx.fill();
        ctx.lineWidth = isSelected ? 4 : 2;
        ctx.strokeStyle = isSelected ? "#388e3c" : "#795548";
        ctx.stroke();
        ctx.restore();
        
        // Text - Scaled down
        ctx.fillStyle = "#3e2723";
        // Calculate font based on height primarily if squashed
        let maxH = button_height * 0.3;
        let btnFontSize = Math.max(10, Math.min(16, maxH));
        
        ctx.font = `bold ${btnFontSize}px 'Segoe UI', sans-serif`; 
        
        let icons = {
            "Add Salt Shot": "🧂",
            "Increase Shot Power": "💪",
            "Repair Net / Recover Health": "❤️",
            "Train Defender Bugs": "🐞",
            "Increase Defender Frequency": "⏩",
            "Expand House": "🏠",
            "Buy Bug Bomb": "💣",
            "Upgrade Bomb Frequency": "⏲️",
            "Bug Zapper Beam": "⚡",
            "Add Healing": "💊",  
            "Add Bug Net": "🕸️",
            "Upgrade Net": "🛡️",
            "Upgrade Boot Stomp": "🥾"
        };
        let icon = icons[opt.item.name] || "▪️";
        let text = `${icon} ${opt.item.name}`;
        
        // Wrap text logic if too wide?
        // Simple fitting: shrink if width too big
        let m = ctx.measureText(text);
        if (m.width > button_width - 10) {
             let scale = (button_width - 10) / m.width;
             let newSize = Math.max(8, btnFontSize * scale);
             ctx.font = `bold ${newSize}px 'Segoe UI'`;
        }
        ctx.fillText(text, x + button_width/2 - ctx.measureText(text).width/2, y + button_height/2 - 5);
        
        ctx.fillStyle = "#5d4037";
        ctx.font = `${Math.max(10, btnFontSize * 0.9)}px 'Segoe UI', sans-serif`;
        let costText = `${opt.item.cost} pts`;
        ctx.fillText(costText, x + button_width/2 - ctx.measureText(costText).width/2, y + button_height/2 + 15);
    }
    
    // Bottom Buttons
    let bottom_y = SCREEN_HEIGHT - bottom_margin;
    // 3 Buttons now: Start, Undo, Menu
    let bottom_button_width = (SCREEN_WIDTH - 2 * side_margin - 2 * gap_x) / 3;
    let bottom_box_height = SCREEN_HEIGHT * 0.12;
    
    if (bottom_box_height > 80) bottom_box_height = 80;

    const bButtons = ["Start Level", "Undo", "Main Menu"];
    buy_buttons_rects = [];
    
    for (let j = 0; j < bButtons.length; j++) {
        let x = side_margin + j * (bottom_button_width + gap_x);
        let idx = buy_menu_options.length + j; 
        
        buy_buttons_rects.push({x:x, y:bottom_y, w:bottom_button_width, h:bottom_box_height, name: bButtons[j], index: idx});

        let selected = (idx === menu_selected_index);
        
        ctx.save();
        ctx.fillStyle = selected ? "#a5d6a7" : "#e0e0e0";
         if (bButtons[j] === "Undo" && purchaseHistory.length === 0) {
             ctx.fillStyle = "#bdbdbd"; // Disabled look
             ctx.strokeStyle = "#9e9e9e";
         }
        
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, bottom_y, bottom_button_width, bottom_box_height, 10);
        else ctx.rect(x, bottom_y, bottom_button_width, bottom_box_height);
        ctx.fill();
        
        ctx.strokeStyle = selected ? "#388e3c" : "#9e9e9e";
        ctx.lineWidth = selected ? 3 : 1;
        ctx.stroke();
        ctx.restore();
        
        ctx.fillStyle = "#3e2723";
        // Dynamic font for bottom buttons
        let bLen = bButtons[j].length;
        let bFontSize = Math.min(24, bottom_button_width / (bLen * 0.6));
        bFontSize = Math.min(bFontSize, bottom_box_height * 0.4);
        
        ctx.font = `bold ${bFontSize}px 'Segoe UI', sans-serif`;
        ctx.fillText(bButtons[j], x + bottom_button_width/2 - ctx.measureText(bButtons[j]).width/2, bottom_y + bottom_box_height/2 + bFontSize*0.3);
    }
}

function show_confirm_exit_dialog() {
    gameState = 'CONFIRM_EXIT';
    menu_selected_index = -1; // Default
    click_block_time = Date.now() + 300;
    speak("Are you sure you want to quit to the main menu? Proceed or Cancel.");
}

function handleBuyMenuClick(x, y) {
     for (let b of buy_rects) {
         if (isPointInRect(x, y, b)) {
             tryBuyItem(b.index);
             return;
         }
     }
     for (let b of buy_buttons_rects) {
         if (isPointInRect(x, y, b)) {
             if (b.name === "Start Level") {
                 start_level();
             } else if (b.name === "Undo") {
                 undoLastPurchase();
             } else {
                 show_confirm_exit_dialog();
             }
         }
     }
}

function undoLastPurchase() {
    if (purchaseHistory.length === 0) return;
    
    let last = purchaseHistory.pop();
    let item = buy_menu_options[last.index];
    
    // Refund
    points += last.cost;
    item.purchased -= 1;
    
    // Reverse special effects
    if (last.extra) {
        if (last.extra.type === 'hp' || last.extra.type === 'heal_hp') {
            tower_hp -= last.extra.amount;
            speak("Undoing health restore");
        }
        if (last.extra.type === 'heal_shield') {
            shield_hp -= last.extra.amount;
            speak("Undoing net repair");
        }
        if (last.extra.type === 'shield') {
             // Reset to prev values
             shield_hp = last.extra.prevHp;
             max_shield_hp = last.extra.prevMax;
             shield_active = last.extra.prevActive;
             speak("Undoing net upgrade");
        }
        if (last.extra.type === 'stomp_cost_bump') {
             item.cost = last.extra.prevCost; // Revert cost
             // Also revert cooldown change
             stomp_cooldown_max += 1.0; 
             speak("Undoing stomp upgrade");
        }
        if (last.extra.type === 'house_expand') {
            max_tower_hp -= 50;
            tower_hp -= 50;
            speak("Undoing house expansion");
        }
    } else {
        // If it was a simple stomp upgrade (no cost bump), revert cooldown
        if (item.name === "Upgrade Boot Stomp") {
             stomp_cooldown_max += 1.0; 
        }
        speak("Undoing " + item.name);
    }
}

function tryBuyItem(index) {
     if (index >= buy_menu_options.length) { // Bottom buttons
         let j = index - buy_menu_options.length;
         if (j == 0) start_level();
         else if (j == 1) undoLastPurchase();
         else {
             show_confirm_exit_dialog();
         }
         return;
     }

     let item = buy_menu_options[index];
     
     if (points >= item.cost && item.purchased < item.max) {
         // Special Logic
         // Prerequisites
         if (index === 1 && buy_menu_options[0].purchased < 1) { speak("Buy Salt Shot first"); return; }
         if (index === 11 && buy_menu_options[10].purchased < 1) { speak("Buy Net first"); return; }

         // Deduct cost and mark purchased ahead of time? No, validation first?
         // We do it here assuming valid
         
         let historyItem = {index: index, cost: item.cost, extra: null};
         let is_healing_item = (index === 2);
         let purchase_successful = true;

         // Effects
         if (is_healing_item) {
             let healed = false;
             // Shield Heal First
             if (shield_active && shield_hp < max_shield_hp) {
                 let needed = max_shield_hp - shield_hp;
                 let actual = Math.min(needed, 50);
                 shield_hp += actual;
                 historyItem.extra = {type: 'heal_shield', amount: actual};
                 healed = true;
             } else if (tower_hp < max_tower_hp) {
                 let needed = max_tower_hp - tower_hp;
                 let actual = Math.min(needed, 50);
                 tower_hp += actual;
                 historyItem.extra = {type: 'heal_hp', amount: actual};
                 healed = true;
             }
             
             if (!healed) {
                 speak("Health full");
                 purchase_successful = false;
             }
         }
         else if (index === 0) { max_tower_hp += 0; /* Just unlock */ } 
         else if (index === 1) { tower_hp += 0; /* Just power */ }
         
         else if (index === 5) {
             max_tower_hp += 50; // Expand house
             tower_hp += 50;
             historyItem.extra = {type: 'house_expand', amount: 50};
         }
         else if (index === 10) { // Net
             shield_active = true;
             max_shield_hp = 50;
             shield_hp = 50;
         }
         else if (index === 11) { // Upgrade Net
             historyItem.extra = {type: 'shield', prevHp: shield_hp, prevMax: max_shield_hp, prevActive: shield_active};
             max_shield_hp += 50;
             shield_hp = max_shield_hp;
         }
         
         else if (item.name === "Upgrade Boot Stomp") {
             // Decrease cooldown by 1s (min 2s)
             stomp_cooldown_max -= 1.0;
             if (stomp_cooldown_max < 2.0) stomp_cooldown_max = 2.0;
             
             // Cost bump after first purchase
             if (item.purchased === 1) {
                 historyItem.extra = {type: 'stomp_cost_bump', prevCost: item.cost};
                 item.cost += 200; // Increase cost for lvl 2
             }
         }
         else if (item.name === "Glue Traps") {
             // Activate glue trap for the next level
             glue_trap_active = true;
             calculate_glue_trap_positions();
         }

         if (purchase_successful) {
            points -= item.cost;
            // Only increment persistent upgrades, not consumables like Heal
            if (index !== 2) { 
                item.purchased++;
            }
            speak("Bought " + item.name);
            purchaseHistory.push(historyItem);
         }
     }
}

// MAIN MENU
function draw_main_menu() {
    // --- Dynamic Background Logic ---
    let now = Date.now() / 1000;
    
    // Init Menu Grass
    if (menu_grass_blades.length === 0) generate_menu_grass();

    // 1. Spawn Bugs
    if (now - last_menu_spawn > 0.8) { // Spawn rate
        if (menu_enemies.length < 25) { // More bugs
             // Weighted distribution: Many smalls, fewer bigs
             let types = [
                 'small', 'small', 'small', 'small', 'small', 'small', 'small', 'small', 'small', 'small',
                 'medium', 'medium', 'medium', 'medium', 'medium', 
                 'large', 'large', 'large', 
                 'extra_large', 'extra_large', 
                 'boss'
             ];
             let t = types[Math.floor(Math.random() * types.length)];
             
             // Define speeds to match gameplay requests
             let spd = 10;
             if (t === 'medium') spd = 15;
             if (t === 'large') spd = 20;
             if (t === 'extra_large') spd = 4;
             if (t === 'boss') spd = 10; // Match 1hp ant speed

             let e = new Enemy(t, 1, spd, 1);
             e.y = -50; 
             e.x = 40 + Math.random() * (SCREEN_WIDTH - 80);
             e.baseX = e.x; // Update baseX for zigzag
             // if (t === 'boss') e.speed *= 2.0; // REMOVED speed boost
             menu_enemies.push(e);
        }
        last_menu_spawn = now;
    }
    
    // 2. Update Bugs
    for (let i = menu_enemies.length - 1; i >= 0; i--) {
        let e = menu_enemies[i];
        let currentSpeed = e.baseSpeed * 1.5 * speedMultiplier;
        e.y += currentSpeed; // Move down
        
        // Zig-Zag for Small Ants in Menu
        if (e.etype === 'small') {
            let amp = 30; 
            let freq = 0.03;
            // x = baseX + sin(y * freq + phase) * amp
            e.x = e.baseX + Math.sin(e.y * freq + e.id * 10) * amp;
            
            // Angle for rotation
            let dx = amp * freq * Math.cos(e.y * freq + e.id * 10) * currentSpeed;
            let dy = currentSpeed;
            e.angle = Math.atan2(dy, dx) - Math.PI/2;
        }

        // Shoot (Scorpion/Extra Large)
        if (e.etype === 'extra_large' && !e.isDead) {
             // Init shot time if needed (should be in constructor, but menu spawning might skip if not careful, though constructor handles it)
             if ((now - e.last_shot_time) > 3.0 + (e.id * 2)) { // Slower, somewhat random
                 e.last_shot_time = now;
                 let targetX = e.x + (Math.random() - 0.5) * 600; 
                 let targetY = SCREEN_HEIGHT + 200;
                 menu_projectiles.push(new EnemyProjectile(e.x, e.y, targetX, targetY, 0));
             }
        }

        if (e.y > SCREEN_HEIGHT + 50) {
            menu_enemies.splice(i, 1);
        }
    }
    
    // Update Menu Projectiles
    for (let i = menu_projectiles.length - 1; i >= 0; i--) {
        let p = menu_projectiles[i];
        p.move();
        if (p.x < -100 || p.x > SCREEN_WIDTH + 100 || p.y > SCREEN_HEIGHT + 100) {
            menu_projectiles.splice(i, 1);
        }
    }
    
    // 3. Stomp Logic
    if (!menu_boot.active && (now - last_boot_attempt > 0.5)) {
        last_boot_attempt = now;
        // Low probability to allow travel: 30sec loop feel?
        // If we want them to reach bottom, stomp should be rare or target low.
        if (Math.random() < 0.1) { // Check every 0.5s with 10% chance = avg 5 sec
            let candidates = menu_enemies.filter(e => !e.isDead && e.y > SCREEN_HEIGHT * 0.3);
            if (candidates.length > 0) {
                // Prefer lower bugs
                candidates.sort((a,b) => b.y - a.y);
                // Pick from bottom 50%
                let target = candidates[Math.floor(Math.random() * Math.min(3, candidates.length))];
                
                menu_boot.active = true;
                menu_boot.state = 'descend';
                menu_boot.target = target;
                menu_boot.x = target.x;
                menu_boot.y = -200;
                menu_boot.displayY = -200;
            }
        }
    }
    
    if (menu_boot.active) {
        if (menu_boot.state === 'descend') {
            if (menu_boot.target && !menu_boot.target.isDead) {
                let tx = menu_boot.target.x;
                let ty = menu_boot.target.y;
                menu_boot.x += (tx - menu_boot.x) * 0.1;
                menu_boot.y = ty; // Track target Y
                
                // Move display Y down
                menu_boot.displayY += (ty - 20 - menu_boot.displayY) * 0.15;
                
                if (Math.abs(menu_boot.displayY - (ty - 20)) < 10) {
                    menu_boot.state = 'stomp';
                }
            } else {
                 menu_boot.state = 'retreat';
            }
        } else if (menu_boot.state === 'stomp') {
            menu_boot.displayY += 30; // SMASH
            if (menu_boot.displayY >= menu_boot.y) {
                 if (menu_boot.target) {
                     menu_boot.target.hp = 0;
                     menu_boot.target.isDead = true;
                     menu_boot.target.deathTime = Date.now();
                 }
                 menu_boot.state = 'retreat';
            }
        } else if (menu_boot.state === 'retreat') {
            menu_boot.displayY -= 20;
            if (menu_boot.displayY < -300) {
                menu_boot.active = false;
                menu_boot.target = null;
            }
        }
    }

    // --- Drawing ---
    
    // Backdrop
    ctx.fillStyle = "#4caf50"; // Base Green
    ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    // Draw Menu Grass
    ctx.strokeStyle = "#388e3c"; 
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let g of menu_grass_blades) {
        ctx.moveTo(g.x, g.y);
        ctx.lineTo(g.x + Math.sin(g.angle)*g.h, g.y - g.h);
    }
    ctx.stroke();
    
    // Draw Bugs
    menu_enemies.forEach(e => e.draw());
    
    // Draw Menu Projectiles
    menu_projectiles.forEach(p => p.draw());

    // Draw Boot
    if (menu_boot.active) {
        ctx.save();
        ctx.translate(menu_boot.x, menu_boot.displayY - 20); 
        
        // Leg
        ctx.fillStyle = "#5D4037"; // Brown Pants/Leg
        ctx.fillRect(-15, -100, 30, 100);
        
        // Boot
        ctx.fillStyle = "#3E2723"; // Dark Brown Boot
        ctx.beginPath();
        ctx.rect(-20, -20, 40, 40); // Heel/Ankle
        // Toe
        ctx.moveTo(20, 0);
        ctx.quadraticCurveTo(50, 0, 50, 20); // Toe tip
        ctx.lineTo(20, 20);
        ctx.lineTo(-20, 20); // Sole line
        ctx.lineTo(-20, -20);
        ctx.fill();
        
        ctx.strokeStyle = "black";
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Treads
        ctx.fillStyle = "#111"; // Sole
        ctx.fillRect(-20, 20, 70, 5); 

        ctx.restore();
    }
    
    // Overlay if needed for contrast, but user wants it to look like level
    // Maybe a very light fade?
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    // Title
    ctx.fillStyle = "white";
    ctx.shadowColor = "#1b5e20";
    ctx.shadowBlur = 5;
    
    let titleSize = Math.min(100, SCREEN_WIDTH / 8); 
    ctx.font = `bold ${titleSize}px 'Segoe UI', sans-serif`;
    let title = "BENNYS BUG BLASTER";
    
    // Check if title fits, if not, break it or shrink more
    if (ctx.measureText(title).width > SCREEN_WIDTH - 20) {
        titleSize = (SCREEN_WIDTH - 20) / (title.length * 0.6); // Approximate
        ctx.font = `bold ${titleSize}px 'Segoe UI', sans-serif`;
    }

    let tw = ctx.measureText(title).width;
    ctx.fillText(title, SCREEN_WIDTH/2 - tw/2, SCREEN_HEIGHT * 0.25);
    ctx.shadowBlur = 0;
    
    let options = ["Play Game", "Instructions", "Settings", "Exit Game"];
    let optSize = Math.min(50, SCREEN_WIDTH / 12);
    ctx.font = `${optSize}px 'Segoe UI'`;
    
    for(let i=0; i<options.length; i++) {
        let isSelected = (i === menu_selected_index);
        let txt = options[i];
        
        ctx.font = isSelected ? `bold ${optSize*1.2}px 'Segoe UI'` : `${optSize}px 'Segoe UI'`;
        let color = isSelected ? "#c6ff00" : "#a5d6a7";
        
        // Arrow
        if (isSelected) {
            ctx.fillStyle = color;
            ctx.fillText(">", SCREEN_WIDTH/2 - ctx.measureText(txt).width/2 - optSize, SCREEN_HEIGHT * 0.45 + i*(optSize*1.5));
        }
        
        ctx.fillStyle = color;
        ctx.fillText(txt, SCREEN_WIDTH/2 - ctx.measureText(txt).width/2, SCREEN_HEIGHT * 0.45 + i*(optSize*1.5));
    }
    
    // Version / Status
    ctx.font = `${Math.min(20, SCREEN_WIDTH/25)}px monospace`;
    ctx.fillStyle = "#a5d6a7";
    ctx.fillText("v1.1.0 - YARD EDITION", 20, SCREEN_HEIGHT - 20);
}

const INSTRUCTIONS_TEXT = "Complete each wave by stopping bugs from attacking your home. Use your mouse to click on bugs or use spacebar to cycle through targeting bugs and press enter to squash them. After each wave, you receive points and you can use those points to upgrade your defenses in the garden shop. Good luck and have fun!";

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    let words = text.split(' ');
    let line = '';

    for(let n = 0; n < words.length; n++) {
      let testLine = line + words[n] + ' ';
      let metrics = context.measureText(testLine);
      let testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        context.fillText(line, x, y);
        line = words[n] + ' ';
        y += lineHeight;
      }
      else {
        line = testLine;
      }
    }
    context.fillText(line, x, y);
}

function draw_instructions() {
    draw_main_menu(); // Background context
    
    // Overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    // Panel - Wood Theme
    let w = Math.min(800, SCREEN_WIDTH * 0.9);
    let h = Math.min(600, SCREEN_HEIGHT * 0.8);
    let x = (SCREEN_WIDTH - w) / 2;
    let y = (SCREEN_HEIGHT - h) / 2;
    
    // Board Background
    ctx.save();
    ctx.fillStyle = "#fff3e0"; // Cream/Light Wood
    ctx.strokeStyle = "#5d4037"; // Dark Brown
    ctx.lineWidth = 6;
    ctx.beginPath(); 
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 20); 
    else ctx.rect(x, y, w, h);
    ctx.fill(); 
    ctx.stroke();
    
    // Screws in corners
    ctx.fillStyle = "#a1887f";
    let screwOffset = 15;
    let screwSize = 6;
    ctx.beginPath(); ctx.arc(x+screwOffset, y+screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x+w-screwOffset, y+screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x+screwOffset, y+h-screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x+w-screwOffset, y+h-screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    
    ctx.textAlign = "left";
    
    // Title
    ctx.fillStyle = "#3e2723"; // Dark Brown
    ctx.font = "bold 40px 'Segoe UI'";
    let title = "INSTRUCTIONS";
    let tw = ctx.measureText(title).width;
    ctx.fillText(title, x + (w-tw)/2, y + 60);
    
    // Body Text
    ctx.font = "24px 'Segoe UI'";
    ctx.fillStyle = "#4e342e"; // Readable Dark Brown
    wrapText(ctx, INSTRUCTIONS_TEXT, x + 40, y + 120, w - 80, 36);
    
    // Back Button (Visual only, logic in handleInput)
    let btnW = 200;
    let btnH = 60;
    let bx = SCREEN_WIDTH/2 - btnW/2;
    let by = y + h - 80;
    
    // Highlight if selected (only option)
    if (menu_selected_index === 0) {
         ctx.fillStyle = "#a5d6a7"; // Light green highlight
         ctx.strokeStyle = "#2e7d32"; 
         ctx.lineWidth=3; 
         ctx.strokeRect(bx, by, btnW, btnH);
    } else {
         ctx.fillStyle = "#e0e0e0";
    }
    ctx.fillRect(bx, by, btnW, btnH);
    
    // Button Text Color
    ctx.fillStyle = "#1b5e20"; 
    
    ctx.font = "bold 28px 'Segoe UI'";
    let btnTxt = "Back";
    let bw = ctx.measureText(btnTxt).width;
    ctx.fillText(btnTxt, bx + btnW/2 - bw/2, by + 40);
}

// PAUSED
function draw_pause_menu() {
    // Semi-transparent overlay - lighter to see game
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    // Panel - Wood Theme
    let panelW = Math.min(450, SCREEN_WIDTH * 0.9); 
    let panelH = 450;
    let px = (SCREEN_WIDTH - panelW)/2;
    let py = (SCREEN_HEIGHT - panelH)/2;
    
    // Board Background
    ctx.save();
    ctx.fillStyle = "#fff3e0"; // Cream/Light Wood
    ctx.strokeStyle = "#5d4037"; // Dark Brown
    ctx.lineWidth = 6;
    ctx.beginPath(); 
    if (ctx.roundRect) ctx.roundRect(px, py, panelW, panelH, 20); 
    else ctx.rect(px, py, panelW, panelH);
    ctx.fill(); 
    ctx.stroke();
    
    // Screws in corners (Cosmetic)
    ctx.fillStyle = "#a1887f";
    let screwOffset = 15;
    let screwSize = 6;
    ctx.beginPath(); ctx.arc(px+screwOffset, py+screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px+panelW-screwOffset, py+screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px+screwOffset, py+panelH-screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px+panelW-screwOffset, py+panelH-screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    
    // Title
    ctx.fillStyle = "#3e2723"; // Dark Brown
    let titleSize = Math.min(50, panelW / 6);
    ctx.font = `bold ${titleSize}px 'Segoe UI'`;
    let title = "PAUSED";
    ctx.fillText(title, SCREEN_WIDTH/2 - ctx.measureText(title).width/2, py + 70);
    
    let options = ["Continue", "Restart Level", "Settings", "Main Menu"];
    let optSize = Math.min(28, panelW / 14); 
    
    let startY = py + 140;
    let gap = 70; // More spacing

    for(let i=0; i<options.length; i++) {
        let isSelected = (i === menu_selected_index);
        let txt = options[i];
        
        ctx.font = isSelected ? `bold ${optSize*1.2}px 'Segoe UI'` : `bold ${optSize}px 'Segoe UI'`;
        
        if (isSelected) {
            ctx.fillStyle = "#2e7d32"; // Greenish for selection
            // Arrow
            ctx.fillText(">", px + 40, startY + i*gap);
            ctx.fillText(txt, SCREEN_WIDTH/2 - ctx.measureText(txt).width/2, startY + i*gap);
        } else {
            ctx.fillStyle = "#8d6e63"; // Dim Brown
            ctx.fillText(txt, SCREEN_WIDTH/2 - ctx.measureText(txt).width/2, startY + i*gap);
        }
    }
}

// SETTINGS
function draw_settings_menu() {
    // Semi-transparent overlay
    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    // Panel - Wood Theme
    let panelW = Math.min(600, SCREEN_WIDTH * 0.95); 
    let panelH = 550;
    let px = (SCREEN_WIDTH - panelW)/2;
    let py = (SCREEN_HEIGHT - panelH)/2;
    
    // Board Background
    ctx.save();
    ctx.fillStyle = "#fff3e0"; // Cream/Light Wood
    ctx.strokeStyle = "#5d4037"; // Dark Brown
    ctx.lineWidth = 6;
    ctx.beginPath(); 
    if (ctx.roundRect) ctx.roundRect(px, py, panelW, panelH, 20); 
    else ctx.rect(px, py, panelW, panelH);
    ctx.fill(); 
    ctx.stroke();
    
    // Screws in corners
    ctx.fillStyle = "#a1887f";
    let screwOffset = 15;
    let screwSize = 6;
    ctx.beginPath(); ctx.arc(px+screwOffset, py+screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px+panelW-screwOffset, py+screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px+screwOffset, py+panelH-screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(px+panelW-screwOffset, py+panelH-screwOffset, screwSize, 0, Math.PI*2); ctx.fill();
    ctx.restore();
    
    ctx.fillStyle = "#3e2723"; // Dark Brown
    let titleSize = Math.min(50, panelW / 8);
    ctx.font = `bold ${titleSize}px 'Segoe UI'`;
    let title = "SETTINGS";
    ctx.fillText(title, SCREEN_WIDTH/2 - ctx.measureText(title).width/2, py + 60);

    let autoscanDisplay = autoscan_enabled ? "ON" : "OFF";
    let speedDisplay = scan_speed_options[scan_speed_index] + "s";
    
    if (typeof window.NarbeScanManager !== 'undefined') {
        const s = window.NarbeScanManager.getSettings();
        autoscanDisplay = s.autoScan ? "ON" : "OFF";
        speedDisplay = (window.NarbeScanManager.getScanInterval()/1000) + "s";
    }

    let options = [
        "TTS: " + (tts_enabled ? "ON" : "OFF"),
        "Autoscan: " + autoscanDisplay,
        "Scan Speed: " + speedDisplay,
        "Auto Stomp: " + (auto_stomp_enabled ? "ON" : "OFF"),
        "SFX: " + (sfx_enabled ? "ON" : "OFF"),
        "Music: " + (music_enabled ? "ON" : "OFF"),
        "Back"
    ];
    
    let optSize = Math.min(30, panelW / 18);
    ctx.font = `bold ${optSize}px 'Segoe UI'`;
    let startY = py + 130;
    let gap = 60;

    for (let i = 0; i < options.length; i++) {
        let isSelected = (i === menu_selected_index);
        let txt = options[i];

        if (isSelected) {
             ctx.fillStyle = "#2e7d32"; // Greenish for selection
             // Arrow
             ctx.fillText(">", px + 40, startY + i*gap);
             ctx.fillText(txt, SCREEN_WIDTH/2 - ctx.measureText(txt).width/2, startY + i*gap);
        } else {
             ctx.fillStyle = "#8d6e63"; // Dim Brown
             ctx.fillText(txt, SCREEN_WIDTH/2 - ctx.measureText(txt).width/2, startY + i*gap);
        }
    }
}

function draw_confirm_exit() {
    draw_buy_menu(); 
    
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    // Dialog Box
    let w = Math.min(600, SCREEN_WIDTH * 0.9);
    let h = 300;
    let x = (SCREEN_WIDTH - w)/2;
    let y = (SCREEN_HEIGHT - h)/2;
    
    ctx.fillStyle = "#fff3e0"; // Light wood/cream
    ctx.strokeStyle = "#5d4037"; // Brown
    ctx.lineWidth = 4;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 20); else ctx.fillRect(x,y,w,h);
    ctx.fill();
    ctx.stroke();
    
    // Text
    ctx.fillStyle = "#3e2723";
    let txtSize = Math.min(24, w / 20);
    ctx.font = `bold ${txtSize}px 'Segoe UI'`;
    let txt = "Are you sure you want to quit?";
    let txt2 = "Unsaved progress will be lost.";
    
    ctx.fillText(txt, SCREEN_WIDTH/2 - ctx.measureText(txt).width/2, y + 60);
    ctx.font = `italic ${txtSize*0.8}px 'Segoe UI'`;
    ctx.fillText(txt2, SCREEN_WIDTH/2 - ctx.measureText(txt2).width/2, y + 100);
    
    // Buttons: [Cancel] [Proceed]
    // Index 0: Cancel, 1: Proceed.
    
    let btnW = w * 0.35;
    let btnH = 60;
    let gap = w * 0.1;
    let bx = SCREEN_WIDTH/2 - (btnW*2 + gap)/2;
    let by = y + h - 100;
    
    let buttons = ["Cancel", "Proceed"];
    
    for(let i=0; i<2; i++) {
        let btnX = bx + i*(btnW + gap);
        
        let isSelected = (menu_selected_index === i);
        
        ctx.fillStyle = isSelected ? "#a5d6a7" : "#e0e0e0"; 
        ctx.strokeStyle = isSelected ? "#2e7d32" : "#9e9e9e";
        ctx.lineWidth = isSelected ? 3 : 1;
        
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(btnX, by, btnW, btnH, 10); else ctx.rect(btnX, by, btnW, btnH);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = "#3e2723";
        ctx.font = `bold ${Math.min(20, btnH*0.4)}px 'Segoe UI'`;
        ctx.fillText(buttons[i], btnX + btnW/2 - ctx.measureText(buttons[i]).width/2, by + btnH/2 + 7);
    }
}

// GAME OVER / WON
function draw_game_end_screen(won) {
    ctx.fillStyle = "rgba(0,0,0,0.9)";
    ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
    
    let fontSize = Math.min(120, SCREEN_WIDTH / 6);
    ctx.font = `bold ${fontSize}px 'Segoe UI'`;
    let text = won ? "VICTORY" : "GAME OVER";
    
    ctx.save();
    if (won) {
        ctx.shadowColor = "lime"; ctx.shadowBlur = 30;
        ctx.fillStyle = "#00FF00";
    } else {
        ctx.shadowColor = "red"; ctx.shadowBlur = 30;
        ctx.fillStyle = "#FF0000";
    }
    
    ctx.fillText(text, SCREEN_WIDTH/2 - ctx.measureText(text).width/2, SCREEN_HEIGHT/2);
    ctx.restore();
    
    ctx.font = `${Math.max(16, fontSize/4)}px 'Segoe UI'`;
    ctx.fillStyle = "#AAA";
    let sub = "Returning to Menu...";
    ctx.fillText(sub, SCREEN_WIDTH/2 - ctx.measureText(sub).width/2, SCREEN_HEIGHT/2 + 80);
}

// --- Main Loop ---

let animationId;
let pauseStartTime = 0;

function draw_grass() {
    let pct = (max_tower_hp > 0) ? (tower_hp / max_tower_hp) : 1;
    let bColor = "#388e3c";
    if (pct <= 0.25) bColor = "#5d4037"; // Brown
    else if (pct <= 0.50) bColor = "#9e9d24"; // Olive
    else if (pct <= 0.75) bColor = "#689f38"; // Light Olive

    ctx.strokeStyle = bColor; 
    ctx.lineWidth = 1;
    ctx.beginPath();
    for(let g of grass_blades) {
        ctx.moveTo(g.x, g.y);
        // Tilt based on angle
        ctx.lineTo(g.x + Math.sin(g.angle)*g.h, g.y - g.h);
    }
    ctx.stroke();
}

function draw_glue_trap() {
    if (!glue_trap_active) return;
    
    // Draw each of the 4 glue traps
    for (let trap of glue_traps) {
        // Yellow glue fill
        ctx.fillStyle = "#ffeb3b"; // Bright yellow
        ctx.fillRect(trap.x, trap.y, trap.width, trap.height);
        
        // Add glue texture with darker yellow streaks and spots
        ctx.fillStyle = "rgba(255, 193, 7, 0.4)"; // Darker yellow overlay
        for (let i = 0; i < 30; i++) {
            let spot_x = trap.x + (trap.width / 30) * i + (Math.sin(i * 2.3) * 8);
            let spot_y = trap.y + (trap.height / 2) + (Math.cos(i * 3.1) * trap.height * 0.3);
            ctx.beginPath();
            ctx.arc(spot_x, spot_y, 2 + Math.sin(i * 1.7) * 1.5, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Add glossy highlights (lighter yellow)
        ctx.fillStyle = "rgba(255, 255, 200, 0.3)";
        for (let i = 0; i < 15; i++) {
            let highlight_x = trap.x + (trap.width / 15) * i + (Math.cos(i * 1.9) * 10);
            let highlight_y = trap.y + (trap.height * 0.3) + (Math.sin(i * 2.7) * trap.height * 0.2);
            ctx.beginPath();
            ctx.arc(highlight_x, highlight_y, 3 + Math.cos(i * 1.3), 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Dark brown outline
        ctx.strokeStyle = "#3e2723"; // Dark brown
        ctx.lineWidth = 4;
        ctx.strokeRect(trap.x, trap.y, trap.width, trap.height);
    }
}

function loop() {
    checkInputHolds();

    // Autoscan Logic
    if ((typeof window.NarbeScanManager !== 'undefined' ? window.NarbeScanManager.getSettings().autoScan : autoscan_enabled) && ['MENU', 'BUY', 'PAUSED', 'SETTINGS', 'PLAYING', 'CONFIRM_EXIT'].includes(gameState)) {
        let interval = (typeof window.NarbeScanManager !== 'undefined') ? (window.NarbeScanManager.getScanInterval() / 1000.0) : scan_speed_options[scan_speed_index];
        if (Date.now()/1000 - last_autoscan_time >= interval) {
            scanForward();
            last_autoscan_time = Date.now()/1000;
        }
    }

    if (gameState === 'PLAYING') {
        // Check Stomp Ready Sound
        if (Date.now()/1000 - last_stomp_time >= stomp_cooldown_max) {
            if (!stomp_ready_sound_played) {
                playReadySound();
                stomp_ready_sound_played = true;
            }
        } else {
            stomp_ready_sound_played = false;
        }

        // Events Handling
        last_heal_time = heal_tower();

        // Bomb Activation
        if (buy_menu_options[6].purchased >= 1) {
            let interval = 120;
            if (buy_menu_options[7].purchased >= 1) interval = 60;
            if (Date.now()/1000 - bomb_last_time >= interval) {
                bomb_active = true;
                bomb_start_time = Date.now()/1000;
                bomb_hit_enemies.clear();
                bomb_last_time = Date.now()/1000;
                playSound('bomb');
            }
        }

        // Laser Activation
        if (buy_menu_options[8].purchased >= 1) {
             if (!laser_active && (Date.now()/1000 - last_laser_time >= 30)) {
                 laser_active = true;
                 laser_start_time = Date.now()/1000;
                 laser_hit_enemies.clear();
                 playSound('laser');
             }
        }

        // Calculate Decay
        let pct = (max_tower_hp > 0) ? (tower_hp / max_tower_hp) : 1;
        let bgColor = "#4caf50";
        if (pct <= 0.25) bgColor = "#8d6e63"; // Brown
        else if (pct <= 0.50) bgColor = "#cddc39"; // Lime
        else if (pct <= 0.75) bgColor = "#8bc34a"; // Light Green
        
        // Draw / Update
        // Draw Yard Background
        ctx.fillStyle = bgColor; 
        ctx.fillRect(0,0, SCREEN_WIDTH, SCREEN_HEIGHT);
        
        draw_grass();       // Draws blades (first so they are behind fence)
        draw_glue_trap();   // Draw glue trap on top of grass
        draw_damage_zone(); // Draws dirt at bottom and FENCES (so fences cover grass)

        draw_health_bar();
        draw_timer_bar();
        
        draw_shield();

        // Towers
        // ctx.fillStyle = "blue"; 
        for (let t of towers) {
            // ctx.fillRect(t.x, t.y, t.size, t.size);
            t.draw(ctx);
        }

        spawn_enemies();
        
        // Filter out fully dead enemies before update (Clean up)
        for(let i = enemies.length - 1; i >= 0; i--) {
            let e = enemies[i];
            if (e.isDead && (Date.now() - e.deathTime > 500)) {
                enemies.splice(i, 1);
            }
        }

        for (let e of enemies) {
            e.move();
            e.shoot();
            e.draw();
        }
        check_shield_damage();

        fire_tower_projectile();
        update_tower_projectiles();
        update_enemy_projectiles();

        // Tower Units
        let unit_freq_upgrade = buy_menu_options[4].purchased; // Corrected Index
        let unit_spawn_interval = Math.max(1, 10 - 2 * unit_freq_upgrade); // Faster interval
        
        // Index 3: "Train Defender Bugs"
        // Spawn number of units equal to purchase count
        let defender_count = buy_menu_options[3].purchased; 

        if (defender_count >= 1 && (Date.now()/1000 - tower_last_unit_spawn_time >= unit_spawn_interval)) {
             for (let t of towers) {
                 for(let k=0; k < defender_count; k++) {
                     // Spawn from the fence line with some random offset
                     let tcx = t.x + t.size/2 + (Math.random() - 0.5) * 30; // Spread out slightly
                     let tcy = TOWER_Y - 10; 
                     if (tcy > TOWER_Y - 30) tcy = TOWER_Y - 20; 
                     
                     // Slight time/distance stagger or just spawn together
                     tower_units.push(new TowerUnit(tcx, tcy));
                 }
             }
             tower_last_unit_spawn_time = Date.now()/1000;
        }
        update_tower_units();

        if (laser_active) {
            draw_laser_beams();
            if (Date.now()/1000 - laser_start_time >= 3) {
                laser_active = false;
                last_laser_time = Date.now()/1000;
            }
        }

        if (bomb_active) {
            drop_bomb_effect();
        }

        process_stomp_attack();
        draw_stomp_effect();

        draw_window_controls();

        // Check End Conditions
        if (tower_hp <= 0) {
            gameState = 'GAME_OVER';
            speak("Game Over");
            setTimeout(() => {
                reset_game_state();
                gameState = 'MENU';
            }, 5000);
        }
        if (Date.now()/1000 - game_time_start >= ROUND_DURATION) {
            gameState = 'LEVEL_COMPLETE';
            // Logic for level completion
            let base = 100;
            let mult = 100 * wave_number;
            let bonus = (tower_hp === max_tower_hp) ? 100 : 0;
            let earned = base + mult + bonus;
            points += earned;
            
            let storeMsg = (points === 0) ? "You don't have any money to make a purchase" : `You have ${points} points`;
            
            wave_number++;
            if (wave_number > 20) {
                gameState = 'GAME_WON';
                 speak(`Level complete. You earned ${earned} points.`);
                 setTimeout(() => {
                    reset_game_state();
                    gameState = 'MENU';
                }, 5000);
            } else {
                save_store_state(); // Save before entering store loop
                glue_trap_active = false; // Reset glue trap for next level purchase
                gameState = 'BUY';
                menu_selected_index = -1;
                speak(`Level complete. You earned ${earned} points. Garden store: ${storeMsg}`);
            }
        }
    } 
    else if (gameState === 'MENU') {
        draw_main_menu();
    }
    else if (gameState === 'INSTRUCTIONS') {
        draw_instructions();
    }
    else if (gameState === 'LEVEL_INTRO') {
        draw_level_intro();
    }
    else if (gameState === 'BUY') {
        draw_buy_menu();
    }
    else if (gameState === 'PAUSED') {
        draw_pause_menu();
    }
    else if (gameState === 'SETTINGS') {
        draw_settings_menu();
    }
    else if (gameState === 'CONFIRM_EXIT') {
        draw_confirm_exit();
    }
    else if (gameState === 'GAME_OVER') {
        draw_game_end_screen(false);
    }
    else if (gameState === 'GAME_WON') {
        draw_game_end_screen(true);
    }
    else if (gameState === 'LEVEL_COMPLETE') {
         // Should transition
    }

    requestAnimationFrame(loop);
}

// --- Input Handling ---

let keysPressed = {};
let keyTimers = {};
let spaceHoldInterval = null;

// Re-enable Resize
window.addEventListener('resize', () => {
    let old_w = SCREEN_WIDTH;
    let old_h = SCREEN_HEIGHT;

    SCREEN_WIDTH = window.innerWidth;
    SCREEN_HEIGHT = window.innerHeight;
    canvas.width = SCREEN_WIDTH;
    canvas.height = SCREEN_HEIGHT;
    
    updateSpeedMultiplier();

    // Map entity positions
    if (gameState === 'PLAYING') {
        // Scale X
        if (old_w > 0) {
            let ratioX = SCREEN_WIDTH / old_w;
            enemies.forEach(e => {
                e.x *= ratioX;
                e.baseX *= ratioX;
            });
            tower_units.forEach(u => u.x *= ratioX);
            tower_projectiles.forEach(p => p.x *= ratioX);
            enemy_projectiles.forEach(p => p.x *= ratioX);
        }
        
        // Scale Y relative to gameplay zone
        let old_start = 80;
        let old_end = old_h - 180;
        let new_start = 80;
        let new_end = SCREEN_HEIGHT - 180;
        
        if (old_end > old_start) {
            let range_old = old_end - old_start;
            let range_new = new_end - new_start;
            
            const mapY = (y) => new_start + (y - old_start) * (range_new / range_old);
            
            enemies.forEach(e => e.y = mapY(e.y));
            tower_units.forEach(u => u.y = mapY(u.y));
            tower_projectiles.forEach(p => p.y = mapY(p.y));
            enemy_projectiles.forEach(p => p.y = mapY(p.y));
        }
    }

    // Recalc layout
    TOWER_SIZE = Math.min(150, SCREEN_WIDTH / 3);
    
    // Recalculate glue trap positions if active
    if (glue_trap_active) {
        calculate_glue_trap_positions();
    }
    
    if (gameState === 'PLAYING') {
         TOWER_X = SCREEN_WIDTH / 2 - TOWER_SIZE / 2;
         TOWER_Y = SCREEN_HEIGHT - 180;
         
         // Rebuild towers to ensure correct size/spacing
         towers = [new Tower(TOWER_X, TOWER_Y, "main")];
         let main_size = TOWER_SIZE;
         let wing_size = TOWER_SIZE * 0.7;
         let wing_y_offset = main_size - wing_size;

         if (buy_menu_options[5].purchased >= 1) {
            towers.push(new Tower(TOWER_X + main_size, TOWER_Y + wing_y_offset, "wing"));
         }
         if (buy_menu_options[5].purchased >= 2) {
             towers.unshift(new Tower(TOWER_X - wing_size, TOWER_Y + wing_y_offset, "wing"));
         }
    }
    
    // Regenerate grass
    grass_blades = [];
    for(let i=0; i<300; i++) {
        grass_blades.push({
            x: Math.random() * SCREEN_WIDTH,
            y: Math.random() * (SCREEN_HEIGHT - 180),
            h: 5 + Math.random() * 8,
            angle: (Math.random() - 0.5) * 0.5
        });
    }

    // Regenerate Flowers
    garden_flowers = [];
    let flower_types = ['sunflower', 'rose', 'tulip', 'daisy'];
    let left_zone_end = (SCREEN_WIDTH / 2 - TOWER_SIZE / 2);
    let right_zone_start = (SCREEN_WIDTH / 2 + TOWER_SIZE / 2);
    
    // Padding logic: ensure flowers are not 'inside' the expanded house?
    // The previous logic used TOWER_SIZE assumption.
    // If wings exist, zone pushed out? No, flowers are decorative.
    
    // Left Side
    for (let i = 0; i < 8; i++) {
        let type = flower_types[i % flower_types.length];
        let fx = (left_zone_end / 9) * (i + 1); 
        let fy = (SCREEN_HEIGHT - 180) + 50 + (i%2)*30; 
        let scale = 0.8 + Math.random() * 0.2;
        garden_flowers.push({x: fx, y: fy, type: type, scale: scale, swayOffset: Math.random() * 100});
    }
    
    // Right Side
    let r_width = SCREEN_WIDTH - right_zone_start;
    for (let i = 0; i < 8; i++) {
        let type = flower_types[(i+2) % flower_types.length];
        let fx = right_zone_start + (r_width / 9) * (i + 1);
        let fy = (SCREEN_HEIGHT - 180) + 50 + (i%2)*30;
        let scale = 0.8 + Math.random() * 0.2;
        garden_flowers.push({x: fx, y: fy, type: type, scale: scale, swayOffset: Math.random() * 100});
    }
});

// Helper to cycle buy menu
function getVisibleBuyOptions() {
     let visible_indices = [];
     for (let i = 0; i < buy_menu_options.length; i++) {
            let item = buy_menu_options[i];
            let show = true;
            if (points < item.cost) show = false;
            // Removed max purchase logic hidding to check if user can select refund? 
            // Undo button handles refund.
            // Items are hidden if max purchased.
            if (item.purchased >= item.max) show = false;
            if (i === 1 && buy_menu_options[0].purchased < 1) show = false;
            
            // Fix Heal Visibility for Scan
            if (i === 2) {
                let needsHeal = (tower_hp < max_tower_hp);
                if (shield_active && shield_hp < max_shield_hp) needsHeal = true;
                if (!needsHeal) show = false;
            }
            
            if (i === 4 && buy_menu_options[3].purchased < 1) show = false;
            if (i === 7 && buy_menu_options[6].purchased < 1) show = false;
            if (i === 11 && buy_menu_options[10].purchased < 1) show = false;
            if (show) visible_indices.push(i);
     }
     visible_indices.push(buy_menu_options.length); // Start
     visible_indices.push(buy_menu_options.length + 1); // Undo
     visible_indices.push(buy_menu_options.length + 2); // Menu
     return visible_indices;
}

function speakSelection() {
    let name = "";
    if (menu_selected_index < buy_menu_options.length) name = buy_menu_options[menu_selected_index].name;
    else {
        let j = menu_selected_index - buy_menu_options.length;
        if (j === 0) name = "Start Level";
        else if (j === 1) name = "Undo";
        else name = "Main Menu";
    }
    speak(name);
}

function scanBackward() {
    if (gameState === 'BUY') {
        let visible_indices = getVisibleBuyOptions();
        let current_pos = visible_indices.indexOf(menu_selected_index);
        
        if (current_pos === -1) {
             menu_selected_index = visible_indices[0]; 
        } else {
             // Backward cycle
             let next_pos = (current_pos - 1 + visible_indices.length) % visible_indices.length;
             menu_selected_index = visible_indices[next_pos];
        }
        speakSelection();
    }
}

let settings_return_state = 'MENU';

function scanForward() {
    if (gameState === 'BUY') {
        let visible_indices = getVisibleBuyOptions();
        
        // If nothing selected (-1), prevent crash by just picking first option
        if (menu_selected_index === -1) {
             if (visible_indices.length > 0) {
                 menu_selected_index = visible_indices[0];
                 speakSelection();
             }
             return;
        }

        let current_pos = visible_indices.indexOf(menu_selected_index);
        
        if (current_pos === -1) {
            menu_selected_index = visible_indices[0];
        } else {
            let next_pos = (current_pos + 1) % visible_indices.length;
            menu_selected_index = visible_indices[next_pos];
        }
        speakSelection();
    } 
    else if (gameState === 'MENU') {
         menu_selected_index = (menu_selected_index + 1) % 4;
         let opts = ["Play Game", "Instructions", "Settings", "Exit Game"];
         speak(opts[menu_selected_index]);
    }
    else if (gameState === 'INSTRUCTIONS') {
         menu_selected_index = 0; // Only one option
         speak("Back");
    }
    else if (gameState === 'PAUSED') {
         menu_selected_index = (menu_selected_index + 1) % 4;
         let opts = ["Continue", "Restart Level", "Settings", "Main Menu"];
         speak(opts[menu_selected_index]);
    }
    else if (gameState === 'SETTINGS') {
         menu_selected_index = (menu_selected_index + 1) % 7;
         let opts = ["TTS", "Auto Scan", "Scan Speed", "Auto Stomp", "SFX", "Music", "Back"];
         speak(opts[menu_selected_index]);
    }
    else if (gameState === 'CONFIRM_EXIT') {
        // -1 -> 0 (Cancel) -> 1 (Proceed) -> 0 ...
        if (menu_selected_index === -1) menu_selected_index = 0;
        else menu_selected_index = (menu_selected_index + 1) % 2;
        
        speak(menu_selected_index === 0 ? "Cancel" : "Proceed");
    }
    else if (gameState === 'PLAYING') {
         cycle_stomp_target();
    }
}

// Helper for Return action
function selectAction() {
    if (gameState === 'MENU') {
         if (menu_selected_index === 0) {
             reset_game_state();
             enter_store(true); // Save initial state (0 points)
             menu_selected_index = 0;
         } else if (menu_selected_index === 1) { // Instructions
             gameState = 'INSTRUCTIONS';
             menu_selected_index = 0; // Reset index to highlight Back button
             speak(INSTRUCTIONS_TEXT);
         } else if (menu_selected_index === 2) { // Settings
             settings_return_state = 'MENU';
             gameState = 'SETTINGS';
             menu_selected_index = 0;
         } else {
             speak("Exiting to Hub");
             setTimeout(() => {
                 if (window.parent && window.parent !== window) {
                     window.parent.postMessage({ action: 'focusBackButton' }, '*');
                 } else {
                     window.location.href = '../../../index.html';
                 }
             }, 500);
         }
    } else if (gameState === 'INSTRUCTIONS') {
         gameState = 'MENU';
         menu_selected_index = 0;
         window.speechSynthesis.cancel();
    } else if (gameState === 'BUY') {
        tryBuyItem(menu_selected_index);
        
         let visible_indices = getVisibleBuyOptions();
         if (!visible_indices.includes(menu_selected_index)) {
             menu_selected_index = visible_indices[0]; 
         }
    } else if (gameState === 'PAUSED') {
         if (menu_selected_index === 0) {
             gameState = 'PLAYING';
             game_time_start += (Date.now()/1000 - pauseStartTime);
         } else if (menu_selected_index === 1) { // Restart Level
             // Abort to Buy Menu, Restore Pre-Level State
             restore_store_state();
             enter_store(false);
             
             // Cleanup level objects
             enemies = [];
             tower_projectiles = [];
             enemy_projectiles = [];
             tower_units = [];
             
             speak("Level restarted. Purchases reverted. Back to store.");
         } else if (menu_selected_index === 2) {
             settings_return_state = 'PAUSED';
             gameState = 'SETTINGS';
             menu_selected_index = 0;
         } else if (menu_selected_index === 3) {
             reset_game_state();
             gameState = 'MENU';
         }
    } else if (gameState === 'SETTINGS') {
        if (menu_selected_index === 0) { // TTS
            tts_enabled = !tts_enabled;
            speak("TTS " + (tts_enabled ? "On" : "Off"));
        } else if (menu_selected_index === 1) { // Autoscan
            if (typeof window.NarbeScanManager !== 'undefined') {
                const updated = !window.NarbeScanManager.getSettings().autoScan;
                window.NarbeScanManager.updateSettings({autoScan: updated});
                speak("Autoscan " + (updated ? "On" : "Off"));
            } else {
                autoscan_enabled = !autoscan_enabled;
                speak("Autoscan " + (autoscan_enabled ? "On" : "Off"));
            }
        } else if (menu_selected_index === 2) { // Scan Speed
            if (typeof window.NarbeScanManager !== 'undefined') {
                window.NarbeScanManager.cycleScanSpeed();
                speak("Speed " + (window.NarbeScanManager.getScanInterval()/1000) + "s");
            } else {
                scan_speed_index = (scan_speed_index + 1) % scan_speed_options.length;
                speak("Speed " + scan_speed_options[scan_speed_index]);
            }
        } else if (menu_selected_index === 3) { // Auto Stomp
            auto_stomp_enabled = !auto_stomp_enabled;
            speak("Auto Stomp " + (auto_stomp_enabled ? "On" : "Off"));
        } else if (menu_selected_index === 4) { // SFX
            sfx_enabled = !sfx_enabled;
            speak("SFX " + (sfx_enabled ? "On" : "Off"));
        } else if (menu_selected_index === 5) { // Music
            music_enabled = !music_enabled;
            if (music_enabled) {
                if (audioStarted) bgMusic.play().catch(e=>{});
            } else {
                bgMusic.pause();
            }
            speak("Music " + (music_enabled ? "On" : "Off"));
        } else if (menu_selected_index === 6) { // Back
            gameState = settings_return_state;
            menu_selected_index = 0; 
        }
    } else if (gameState === 'CONFIRM_EXIT') {
        if (menu_selected_index === 0) { // Cancel
            gameState = 'BUY';
            menu_selected_index = -1; // Reset buy menu selection
            speak("Cancelled. Back to store.");
        } else if (menu_selected_index === 1) { // Proceed
            reset_game_state();
            gameState = 'MENU';
        }
    } else if (gameState === 'PLAYING') {
         trigger_player_stomp();
    }
}


window.addEventListener('keydown', (e) => {
    startMusic();
    
    if(["Space","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(e.code) > -1) {
        e.preventDefault();
    }

    if (!keysPressed[e.code]) {
        keysPressed[e.code] = true;
        keyTimers[e.code] = Date.now();
    }
});

window.addEventListener('keyup', (e) => {
    let duration = Date.now() - keyTimers[e.code];
    keysPressed[e.code] = false;
    
    if (e.code === 'Space') {
        if (duration < 3000) {
            scanForward(); // Back to Forward on Tap
        }
    }
    
    if (e.code === 'Enter') {
        if (duration < 6000) {
            selectAction();
        }
    }
});

// Input Loop Check (run effectively every frame via main loop)
function checkInputHolds() {
    let now = Date.now();
    
    // Space Hold Logic -> Scan Backward
    if (keysPressed['Space']) {
        let duration = now - keyTimers['Space'];
        if (duration > 3000) {
            if (!keysPressed['Space_LastScan']) keysPressed['Space_LastScan'] = now;
            
            let interval = (gameState === 'PLAYING') ? 500 : 2000;
            if (now - keysPressed['Space_LastScan'] >= interval) {
                if (gameState === 'PLAYING') cycle_stomp_target();
                else scanBackward(); // REVERSE SCAN
                keysPressed['Space_LastScan'] = now;
            }
        } else {
             delete keysPressed['Space_LastScan'];
        }
    } else {
        delete keysPressed['Space_LastScan'];
    }
    
    // Enter Hold Logic
    if (keysPressed['Enter']) {
        let duration = now - keyTimers['Enter'];
        if (gameState === 'PLAYING') {
            if (duration > 6000) {
                gameState = 'PAUSED';
                pauseStartTime = Date.now()/1000;
                menu_selected_index = -1;
                speak("Paused");
            }
        }
    }
}

let click_block_time = 0;

function handleInput(x, y) {
    if (Date.now() < click_block_time) return;
    if (gameState === 'LEVEL_INTRO') return; // Ignore input during intro

    startMusic();
    
    if (gameState === 'CONFIRM_EXIT') {
        let w = Math.min(600, SCREEN_WIDTH * 0.9);
        let h = 300;
        let dY = (SCREEN_HEIGHT - h)/2;
        let btnW = w * 0.35;
        let btnH = 60;
        let gap = w * 0.1;
        let bx = SCREEN_WIDTH/2 - (btnW*2 + gap)/2;
        let by = dY + h - 100;

        // Cancel
        if (x >= bx && x <= bx + btnW && y >= by && y <= by + btnH) {
             gameState = 'BUY';
             menu_selected_index = -1;
             speak("Cancelled. Back to store.");
             return;
        }
        
        // Proceed
        let bx2 = bx + (btnW + gap);
        if (x >= bx2 && x <= bx2 + btnW && y >= by && y <= by + btnH) {
             reset_game_state();
             gameState = 'MENU';
             return;
        }
    } else if (gameState === 'PLAYING') {
         // Pause Button Check
         let pSize = 60; 
         let pMargin = 20;
         let px = pMargin;
         let py = SCREEN_HEIGHT - pSize - pMargin;
         
         if (Math.hypot(x - (px + pSize/2), y - (py + pSize/2)) < pSize/2 + 10) {
             gameState = 'PAUSED';
             pauseStartTime = Date.now()/1000;
             menu_selected_index = -1;
             speak("Paused");
             click_block_time = Date.now() + 300;
             return;
         }

         // Target Stomp (Enemy Click)
         for (let i = enemies.length - 1; i >= 0; i--) {
             let en = enemies[i];
             // Generous hit area for touch
             let hitR = Math.max(en.radius * 3, 40);
             if (Math.hypot(en.x - x, en.y - y) < hitR) {
                  stomp_target = en;
                  trigger_player_stomp();
                  // Visual feedback?
                  break;
             }
         }
    }
    else if (gameState === 'BUY') {
        handleBuyMenuClick(x, y);
    } else if (gameState === 'MENU') {
        // Adapted for responsive menu
        let optSize = Math.min(50, SCREEN_WIDTH / 12);
        let startY = SCREEN_HEIGHT * 0.45;
        let gap = optSize * 1.5;
        
        for (let i = 0; i < 4; i++) {
             let ty = startY + i * gap;
             // Text is drawn at baseline ty. Height is optSize.
             // Hit box: [ty - optSize, ty + 10]
             if (y >= ty - optSize * 1.2 && y <= ty + optSize * 0.5) {
                 if (i === 0) { // Play
                     reset_game_state();
                     enter_store();
                 } else if (i === 1) { // NEW: Instructions
                     gameState = 'INSTRUCTIONS';
                     speak(INSTRUCTIONS_TEXT);
                     click_block_time = Date.now() + 300;
                 } else if (i === 2) { // Settings
                     settings_return_state = 'MENU';
                     gameState = 'SETTINGS';
                     click_block_time = Date.now() + 300;
                 } else if (i === 3) { // Exit
                     speak("Exiting to Hub");
                     setTimeout(() => {
                         if (window.parent && window.parent !== window) {
                             window.parent.postMessage({ action: 'focusBackButton' }, '*');
                         } else {
                             window.location.href = '../../../index.html';
                         }
                     }, 500);
                 }
             }
        }
    } else if (gameState === 'INSTRUCTIONS') {
        let w = Math.min(800, SCREEN_WIDTH * 0.9);
        let h = Math.min(600, SCREEN_HEIGHT * 0.8);
        let py = (SCREEN_HEIGHT - h) / 2;
        let btnW = 200;
        let btnH = 60;
        let bx = SCREEN_WIDTH/2 - btnW/2;
        let by = py + h - 80;
        
        if (x >= bx && x <= bx + btnW && y >= by && y <= by + btnH) {
             gameState = 'MENU';
             menu_selected_index = 0;
             click_block_time = Date.now() + 300;
             window.speechSynthesis.cancel();
        }
    } else if (gameState === 'SETTINGS') {
        let panelW = Math.min(600, SCREEN_WIDTH * 0.95);
        let panelH = 550;
        let py = (SCREEN_HEIGHT - panelH)/2;
        let startY = py + 130;
        let gap = 60;
        
        let optionsCount = 7; // TTS, Autoscan, Speed, Auto Stomp, SFX, Music, Back
        
        for (let i = 0; i < optionsCount; i++) {
             let ty = startY + i * gap;
             // Fixed gap 60, font max 30.
             if (y >= ty - 40 && y <= ty + 10) {
                 if (i === 0) { // TTS
                    tts_enabled = !tts_enabled;
                    speak("TTS " + (tts_enabled ? "On" : "Off"));
                } else if (i === 1) { // Autoscan
                    if (typeof window.NarbeScanManager !== 'undefined') {
                        const updated = !window.NarbeScanManager.getSettings().autoScan;
                        window.NarbeScanManager.updateSettings({autoScan: updated});
                        speak("Autoscan " + (updated ? "On" : "Off"));
                    } else {
                        autoscan_enabled = !autoscan_enabled;
                        speak("Autoscan " + (autoscan_enabled ? "On" : "Off"));
                    }
                } else if (i === 2) { // Scan Speed
                    if (typeof window.NarbeScanManager !== 'undefined') {
                        window.NarbeScanManager.cycleScanSpeed();
                        speak("Speed " + (window.NarbeScanManager.getScanInterval()/1000) + "s");
                    } else {
                        scan_speed_index = (scan_speed_index + 1) % scan_speed_options.length;
                        speak("Speed " + scan_speed_options[scan_speed_index]);
                    }
                } else if (i === 3) { // Auto Stomp
                    auto_stomp_enabled = !auto_stomp_enabled;
                    speak("Auto Stomp " + (auto_stomp_enabled ? "On" : "Off"));
                } else if (i === 4) { // SFX
                    sfx_enabled = !sfx_enabled;
                    speak("SFX " + (sfx_enabled ? "On" : "Off"));
                } else if (i === 5) { // Music
                    music_enabled = !music_enabled;
                    if (music_enabled) {
                        if (audioStarted) bgMusic.play().catch(e=>{});
                    } else {
                        bgMusic.pause();
                    }
                    speak("Music " + (music_enabled ? "On" : "Off"));
                } else if (i === 6) { // Back
                    gameState = settings_return_state;
                    menu_selected_index = 0; 
                }
                click_block_time = Date.now() + 300;
             }
        }
    } else if (gameState === 'PAUSED') {
         // Pause Menu Click Handling
         let panelW = Math.min(450, SCREEN_WIDTH * 0.9);
         let panelH = 450;
         let py = (SCREEN_HEIGHT - panelH)/2;
         let startY = py + 140;
         let gap = 70;
         
         // 0: Continue, 1: Restart, 2: Settings, 3: Main Menu
         for(let i=0; i<4; i++) {
             let by = startY + i*gap;
             // Larger hit area height
             if (y >= by - 25 && y <= by + 25) {
                 if (i === 0) { // Continue
                     gameState = 'PLAYING';
                     game_time_start += (Date.now()/1000 - pauseStartTime);
                     click_block_time = Date.now() + 300;
                 } else if (i === 1) { // Restart Level
                     restore_store_state(); // Restore PRE-LEVEL state (points, upgrades, everything)
                     enter_store(false); // Do not overwrite backup
                     
                     enemies = [];
                     tower_projectiles = [];
                     enemy_projectiles = [];
                     tower_units = [];
                     
                     speak("Level restarted. Purchases reverted. Back to store.");
                 } else if (i === 2) { // Settings
                     settings_return_state = 'PAUSED';
                     gameState = 'SETTINGS';
                     click_block_time = Date.now() + 300;
                 } else if (i === 3) { // Main Menu
                     reset_game_state();
                     gameState = 'MENU';
                     click_block_time = Date.now() + 300;
                 }
             }
         }
    }
}

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

let lastTouchTime = 0;

window.addEventListener('mousedown', (e) => {
    if (Date.now() - lastTouchTime < 500) return;
    initAudio();
    let rect = canvas.getBoundingClientRect();
    handleInput(e.clientX - rect.left, e.clientY - rect.top);
});

window.addEventListener('touchstart', (e) => {
    initAudio();
    lastTouchTime = Date.now();
    // e.preventDefault(); // can block scrolling
    let rect = canvas.getBoundingClientRect();
    let touch = e.changedTouches[0];
    handleInput(touch.clientX - rect.left, touch.clientY - rect.top);
}, {passive: false});

// Start
reset_game_state();
requestAnimationFrame(loop);

