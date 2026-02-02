class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.physics = new PhysicsEngine();
        this.particles = new ParticleSystem(this.ctx);
        this.brickPattern = this.createBrickPattern();
        this.waterPattern = this.createWaterPattern();
        this.sandPattern = this.createSandPattern();
        this.icePattern = this.createIcePattern();
        this.boostPattern = this.createBoostPattern();
        this.bridgePattern = this.createBridgePattern();
        this.bushPattern = this.createBushPattern();
        this.ballPattern = this.createBallPattern();
        
        // Set canvas size
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.state = 'MENU'; // MENU, PLAYING, LEVEL_TRANSITION, GAME_OVER
        this.menu = new MenuSystem(this);
        
        this.courseData = null;
        this.currentHoleIndex = 0;
        this.gameMode = 'CASUAL'; // CASUAL, CHALLENGE, MULTIPLAYER
        this.players = []; // For multiplayer
        this.currentPlayerIndex = 0;
        
        // Game Objects
        // Initialize default single player
        this.players.push({
            id: 0,
            name: 'Player 1',
            color: 'white',
            ball: { x: 0, y: 0, vx: 0, vy: 0, radius: 15, color: 'white', textureX: 0, textureY: 0, bushState: 'NONE' },
            strokes: 0,
            totalStrokes: 0,
            finishedHole: false
        });
        
        this.hole = { x: 0, y: 0, radius: 23 };
        this.walls = [];
        this.waters = [];
        this.sands = [];
        this.ice = [];
        this.boosts = [];
        this.bridges = [];
        this.trees = [];
        
        // Gameplay State
        this.aimAngle = 0;
        this.aimRotating = false;
        this.aimRotateDir = 1;
        this.power = 0;
        this.charging = false;
        this.canShoot = true;
        
        // Alligator Hazard
        this.alligatorTimer = 0;
        this.activeAlligator = null;

        // Aimer Settings
        this.aimerThickness = Settings.get('aimerThickness') || 3;
        this.aimerThicknessName = Settings.get('aimerThicknessName') || 'Medium';
        this.holeGlow = false;
        
        // Apply Settings
        this.updateBallColor();

        this.lastTime = 0;
        
        this.transitionTimer = null;
        this.transitionCallback = null;

        // Setup Input Routing
        Input.onEvent = (event, data) => this.handleInput(event, data);
        Input.setMode('MENU');

        // Mouse Input
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        // Touch Input
        this.canvas.addEventListener('touchstart', (e) => this.handleTouchStart(e), {passive: false});
        this.canvas.addEventListener('touchmove', (e) => this.handleTouchMove(e), {passive: false});
        this.canvas.addEventListener('touchend', (e) => this.handleTouchEnd(e), {passive: false});

        // Start loop
        requestAnimationFrame((t) => this.loop(t));
    }

    // Getter for current active ball
    get ball() {
        return this.players[this.currentPlayerIndex].ball;
    }
    
    // Getters for strokes to maintain compatibility
    get strokes() { return this.players[this.currentPlayerIndex].strokes; }
    set strokes(val) { this.players[this.currentPlayerIndex].strokes = val; }
    
    get totalStrokes() { return this.players[this.currentPlayerIndex].totalStrokes; }
    set totalStrokes(val) { this.players[this.currentPlayerIndex].totalStrokes = val; }

    setGameMode(mode) {
        this.gameMode = mode;
        if (mode !== 'MULTIPLAYER') {
            // Reset to single player
            this.players = [{
                id: 0,
                name: 'Player 1',
                color: 'white',
                ball: { x: 0, y: 0, vx: 0, vy: 0, radius: 15, color: 'white', textureX: 0, textureY: 0 },
                strokes: 0,
                totalStrokes: 0,
                finishedHole: false
            }];
            this.currentPlayerIndex = 0;
            this.updateBallColor();
        }
    }

    setupMultiplayer(config) {
        this.gameMode = 'MULTIPLAYER';
        this.players = [];
        
        let colors = [];
        let count = 0;

        if (Array.isArray(config)) {
            // Config is array of colors
            colors = config;
            count = config.length;
        } else {
            // Config is number (legacy/fallback)
            count = config;
            const available = [...Utils.BALL_COLORS];
            // Try to respect the Settings color for Player 1 if possible
            const p1Color = Settings.get('ballColor');
            const p1Idx = available.indexOf(p1Color);
            if (p1Idx !== -1) {
                available.splice(p1Idx, 1);
                available.unshift(p1Color); // Put at front
            }
            for(let i=0; i<count; i++) colors.push(available[i % available.length]);
        }

        for(let i=0; i<count; i++) {
            const color = colors[i];
            this.players.push({
                id: i,
                name: `Player ${i+1}`,
                color: color,
                ball: { x: 0, y: 0, vx: 0, vy: 0, radius: 15, color: color, textureX: 0, textureY: 0 },
                strokes: 0,
                totalStrokes: 0,
                finishedHole: false,
                hasStartedHole: false
            });
        }
        this.currentPlayerIndex = 0;
    }

    updateBallColor() {
        if (this.gameMode !== 'MULTIPLAYER') {
            this.players[0].ball.color = Settings.get('ballColor');
            this.players[0].color = Settings.get('ballColor');
        }
    }

    getMousePos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        return {
            x: (x - this.offsetX) / this.scale,
            y: (y - this.offsetY) / this.scale
        };
    }

    handleMouseMove(e) {
        if (this.state !== 'PLAYING' || !this.canShoot) return;
        
        const pos = this.getMousePos(e);
        const angle = Math.atan2(pos.y - this.ball.y, pos.x - this.ball.x);
        this.aimAngle = angle * (180 / Math.PI);
    }

    handleMouseDown(e) {
        if (this.state !== 'PLAYING') return;

        const pos = this.getMousePos(e);
        
        // Check Pause Button Click
        // Button area: x=20, y=720-60 (660), w=40, h=40
        // Note: pos is in design coordinates (1280x720)
        if (pos.x >= 20 && pos.x <= 60 && pos.y >= 660 && pos.y <= 700) {
            this.pauseGame();
            return;
        }

        if (!this.canShoot) return;
        this.charging = true;
        AudioSys.startChargeSound();
    }

    handleMouseUp(e) {
        if (this.state !== 'PLAYING') return;
        if (this.charging) {
            this.shoot();
        }
    }

    getTouchPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        const touch = e.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        return {
            x: (x - this.offsetX) / this.scale,
            y: (y - this.offsetY) / this.scale
        };
    }

    handleTouchStart(e) {
        if (this.state !== 'PLAYING') return;
        e.preventDefault();
        
        const pos = this.getTouchPos(e);
        
        // Check Pause Button (Same coords as mouse)
        if (pos.x >= 20 && pos.x <= 60 && pos.y >= 660 && pos.y <= 700) {
            this.pauseGame();
            return;
        }

        if (!this.canShoot) return;

        // Aim immediately
        const angle = Math.atan2(pos.y - this.ball.y, pos.x - this.ball.x);
        this.aimAngle = angle * (180 / Math.PI);
        
        // Start Charge Timer
        this.touchChargeTimer = setTimeout(() => {
            this.charging = true;
            AudioSys.startChargeSound();
            this.touchChargeTimer = null;
        }, 1000);
    }

    handleTouchMove(e) {
        if (this.state !== 'PLAYING' || !this.canShoot) return;
        e.preventDefault();
        
        const pos = this.getTouchPos(e);
        const angle = Math.atan2(pos.y - this.ball.y, pos.x - this.ball.x);
        this.aimAngle = angle * (180 / Math.PI);
    }

    handleTouchEnd(e) {
        if (this.state !== 'PLAYING') return;
        e.preventDefault();
        
        if (this.touchChargeTimer) {
            clearTimeout(this.touchChargeTimer);
            this.touchChargeTimer = null;
        }
        
        if (this.charging) {
            this.shoot();
        }
    }

    cycleAimerThickness() {
        const thicknesses = [
            { name: 'Thin', value: 3 },
            { name: 'Medium', value: 6 },
            { name: 'Thick', value: 10 },
            { name: 'Extra Thick', value: 15 }
        ];
        let idx = thicknesses.findIndex(t => t.name === this.aimerThicknessName);
        idx = (idx + 1) % thicknesses.length;
        this.aimerThickness = thicknesses[idx].value;
        this.aimerThicknessName = thicknesses[idx].name;
        
        Settings.set('aimerThickness', this.aimerThickness);
        Settings.set('aimerThicknessName', this.aimerThicknessName);
    }

    resumeGame() {
        this.state = 'PLAYING';
        Input.setMode('GAMEPLAY');
        this.menu.active = false;
        this.menu.render(); // Clear menu
        AudioSys.speak("Resuming");
    }

    handleInput(event, data) {
        if (this.state === 'MENU') {
            this.menu.handleInput(event);
        } else if (['COURSE_INTRO', 'HOLE_INTRO', 'HOLE_OUTRO', 'GAME_OVER', 'CHALLENGE_FAIL'].includes(this.state)) {
            if (event === 'SELECT' || event === 'GAME_ENTER_DOWN' || event === 'GAME_SPACE_DOWN') {
                this.skipTransition();
            }
        } else if (this.state === 'PLAYING') {
            const autoScan = (typeof NarbeScanManager !== 'undefined' && NarbeScanManager.getSettings().autoScan);
            
            if (event === 'PAUSE') {
                this.pauseGame();
            } else if (event === 'GAME_SPACE_DOWN') {
                if (this.canShoot) {
                    if (!this.aimRotating) {
                        this.aimRotating = true;
                        this.aimRotateDir *= -1;
                    }
                }
            } else if (event === 'GAME_SPACE_UP') {
                this.aimRotating = false;
            } else if (event === 'GAME_ENTER_DOWN') {
                if (this.canShoot) {
                    if (autoScan) {
                        this.aimRotating = false; // Stop rotating
                        this.charging = true; // Start charging
                    } else {
                        // Regular behavior
                        this.charging = true;
                    }
                }
            } else if (event === 'GAME_ENTER_UP') {
                if (this.charging) {
                    this.shoot();
                    // Note: Auto-scan rotation restarts in the loop when canShoot becomes true
                }
            }
        } else if (this.state === 'PAUSED') {
             this.menu.handleInput(event);
        }
    }

    setTransition(callback, delay) {
        if (this.transitionTimer) clearTimeout(this.transitionTimer);
        this.transitionCallback = callback;
        this.transitionTimer = setTimeout(() => {
            this.transitionCallback = null;
            this.transitionTimer = null;
            callback();
        }, delay);
    }

    skipTransition() {
        if (this.transitionTimer && this.transitionCallback) {
            clearTimeout(this.transitionTimer);
            const cb = this.transitionCallback;
            this.transitionCallback = null;
            this.transitionTimer = null;
            cb();
        }
    }

    pauseGame() {
        // Reset charge mechanism
        this.charging = false;
        this.power = 0;
        this.aimRotating = false;
        AudioSys.stopChargeSound();

        this.state = 'PAUSED';
        Input.setMode('MENU');
        this.menu.active = true;
        this.menu.showPauseMenu();
    }

    resize() {
        // Fix for mobile browser address bars
        const vh = window.innerHeight;
        document.getElementById('game-container').style.height = `${vh}px`;
        
        this.canvas.width = window.innerWidth;
        this.canvas.height = vh;
        
        // Design resolution: 1280x720
        const designW = 1280;
        const designH = 720;
        
        const scaleX = this.canvas.width / designW;
        const scaleY = this.canvas.height / designH;
        
        // Fit to screen (maintain aspect ratio)
        this.scale = Math.min(scaleX, scaleY);
        
        this.offsetX = (this.canvas.width - (designW * this.scale)) / 2;
        this.offsetY = (this.canvas.height - (designH * this.scale)) / 2;

        this.physics.setWorldSize(designW, designH);

        // Update UI Scale
        const uiLayer = document.getElementById('ui-layer');
        if (uiLayer) {
            // We scale the UI layer to match the game scale
            // But we need to center it properly
            // Actually, it's better to scale the content inside ui-layer
            document.documentElement.style.setProperty('--game-scale', this.scale);
        }
    }

    async loadCourse(pathOrData) {
        if (typeof pathOrData === 'string') {
            this.courseData = await Utils.loadJSON(pathOrData);
        } else {
            this.courseData = pathOrData;
        }

        if (this.courseData) {
            this.currentHoleIndex = 0;
            this.totalStrokes = 0;
            
            // Course Intro
            this.state = 'COURSE_INTRO';
            Input.setMode('MENU');
            this.menu.active = false;
            this.menu.render(); // Clear menu
            
            const courseName = this.courseData.name || "Mini Golf Course";
            const holeCount = this.courseData.holes.length;
            AudioSys.speak(`Welcome to ${courseName}. ${holeCount} holes.`);
            
            this.setTransition(() => {
                this.loadHole(0);
            }, 4000);

        } else {
            console.error("Failed to load course");
            this.menu.showMainMenu();
        }
    }

    loadHole(index) {
        if (index >= this.courseData.holes.length) {
            this.finishGame();
            return;
        }

        this.finishOrder = [];

        const holeData = this.courseData.holes[index];
        
        // Reset all players
        this.players.forEach((p, i) => {
            // In multiplayer, only position the first player initially
            // Others will be positioned when their turn starts
            if (this.gameMode === 'MULTIPLAYER') {
                if (i === 0) {
                    p.ball.x = holeData.start.x;
                    p.ball.y = holeData.start.y;
                    p.hasStartedHole = true;
                } else {
                    // Place off-screen or just mark inactive
                    p.ball.x = -1000; 
                    p.ball.y = -1000;
                    p.hasStartedHole = false;
                }
            } else {
                // Single player modes
                p.ball.x = holeData.start.x;
                p.ball.y = holeData.start.y;
                p.hasStartedHole = true;
            }

            if (holeData.start.radius) {
                p.ball.radius = holeData.start.radius;
            } else {
                p.ball.radius = 15; // Default
            }
            p.ball.vx = 0;
            p.ball.vx = 0;
            p.ball.vy = 0;
            p.ball.bushState = 'NONE';
            p.strokes = 0;
            p.finishedHole = false;
        });
        
        // Reset turn to first player
        this.currentPlayerIndex = 0;
        
        this.hole.x = holeData.end.x;
        this.hole.y = holeData.end.y;
        if (holeData.end.radius) {
            this.hole.radius = holeData.end.radius;
        } else {
            this.hole.radius = 23; // Default
        }
        
        this.walls = holeData.walls || [];
        this.waters = holeData.waters || [];
        this.sands = holeData.sands || [];
        this.ice = holeData.ice || [];
        this.boosts = holeData.boosts || [];
        this.bridges = holeData.bridges || [];
        this.trees = holeData.trees || [];
        
        // Generate Bridge Walls
        if (this.bridges.length > 0) {
            // We need to add walls for the sides of the bridge
            // But we don't want to modify the original holeData.walls
            // So we clone walls first if we haven't already (holeData.walls is ref)
            this.walls = [...(holeData.walls || [])];
            
            this.bridges.forEach(b => {
                // Bridge is a rect (x, y, width, height, angle)
                // We need two walls along the "width" (top and bottom in local space)
                // Wall thickness = 5
                
                // Top Wall (Local y=0)
                // We need to calculate world coordinates if rotated
                // But Physics engine handles rotated walls if we provide them correctly
                // Actually, we can just add them as rotated walls relative to the bridge center
                
                // Wait, the physics engine expects walls in world space.
                // If the bridge is rotated, we need to calculate the wall positions/rotation.
                
                // Simplest way: Create walls that match the bridge's top and bottom edges
                // Bridge center
                const cx = b.x + b.width/2;
                const cy = b.y + b.height/2;
                
                // Top Wall
                // Local center of top wall: (width/2, 2.5) relative to bridge top-left
                // Relative to bridge center: (0, -height/2 + 2.5)
                
                // We can just define the wall with the same rotation as the bridge
                // But we need its top-left x,y.
                
                // Let's use a helper or just math it out.
                // Actually, if we just add them as objects with the same angle, 
                // we just need to find their center and width/height.
                
                // Top Wall
                // Width: b.width
                // Height: 5
                // Center relative to bridge center: 0, -b.height/2 + 2.5
                
                // Bottom Wall
                // Width: b.width
                // Height: 5
                // Center relative to bridge center: 0, b.height/2 - 2.5
                
                const rad = (b.angle || 0) * (Math.PI / 180);
                const cos = Math.cos(rad);
                const sin = Math.sin(rad);
                
                const createWall = (offsetY) => {
                    // Rotate offset
                    const dx = 0 * cos - offsetY * sin;
                    const dy = 0 * sin + offsetY * cos;
                    
                    const wCenterX = cx + dx;
                    const wCenterY = cy + dy;
                    
                    // Wall x,y is top-left
                    // We need to un-rotate the center to find the top-left? 
                    // No, the physics engine takes x,y as top-left of the unrotated rect, then rotates around center.
                    // So we need the top-left of the wall IF it were unrotated at that position?
                    // Actually, PhysicsEngine.resolveRotatedWall rotates the ball around the wall's center.
                    // So we just need the wall's center and dimensions.
                    // But the data structure stores x,y as top-left.
                    
                    // So: x = center.x - width/2, y = center.y - height/2
                    return {
                        x: wCenterX - b.width/2,
                        y: wCenterY - 2.5,
                        width: b.width,
                        height: 5,
                        angle: b.angle || 0
                    };
                };
                
                this.walls.push(createWall(-b.height/2 + 2.5));
                this.walls.push(createWall(b.height/2 - 2.5));
            });
        }
        
        this.canShoot = true;
        this.charging = false;
        this.power = 0;
        this.aimAngle = 0;
        
        // Hole Intro
        this.state = 'HOLE_INTRO';
        Input.setMode('MENU');
        // Use phonetic "paar" to help TTS pronunciation
        AudioSys.speak(`Hole ${index + 1}. paar ${holeData.par}. ${this.gameMode === 'MULTIPLAYER' ? this.players[0].name + " Start" : ""}`);
        
        this.setTransition(() => {
            this.state = 'PLAYING';
            Input.setMode('GAMEPLAY');
            if (this.gameMode !== 'MULTIPLAYER') AudioSys.speak("Start");
        }, 3000);
    }

    finishGame() {
        this.state = 'GAME_OVER';
        Input.setMode('MENU'); 
        AudioSys.speak(`Course Completed. Total strokes: ${this.totalStrokes}`);
        
        this.setTransition(() => {
            this.menu.active = true;
            this.menu.showMainMenu();
            this.state = 'MENU';
        }, 5000);
    }

    update(dt) {
        if (this.state !== 'PLAYING') return;
        if (isNaN(dt) || dt > 0.1) dt = 0.016; // Safety cap for large dt (lag spikes)

        // Alligator Logic
        if (!this.activeAlligator) {
            this.alligatorTimer += dt;
            if (this.alligatorTimer > 30) {
                // Check for balls near water
                const activePlayers = this.players.filter(p => p.hasStartedHole && !p.finishedHole);
                
                for (const player of activePlayers) {
                    const ball = player.ball;
                    // Only attack if ball is stopped or moving slowly
                    if (Math.abs(ball.vx) > 0.1 || Math.abs(ball.vy) > 0.1) continue;

                    // Check if on Bridge (Safe from Alligator)
                    let onBridge = false;
                    if (this.bridges) {
                        for (const b of this.bridges) {
                            const cx = b.x + b.width/2;
                            const cy = b.y + b.height/2;
                            const rad = -Utils.degToRad(b.angle || 0);
                            const cos = Math.cos(rad);
                            const sin = Math.sin(rad);
                            
                            const dx = ball.x - cx;
                            const dy = ball.y - cy;
                            
                            const localX = dx * cos - dy * sin;
                            const localY = dx * sin + dy * cos;
                            
                            if (Math.abs(localX) < b.width/2 && Math.abs(localY) < b.height/2) {
                                onBridge = true;
                                break;
                            }
                        }
                    }
                    if (onBridge) continue;

                    let nearWater = false;
                    let waterX = 0, waterY = 0;

                    for (const water of this.waters) {
                        let dist = 0;
                        if (water.points) {
                            dist = Utils.pointPolygonDistance(ball.x, ball.y, water.points);
                            const closest = Utils.closestPointOnPolygon(ball.x, ball.y, water.points);
                            waterX = closest.x;
                            waterY = closest.y;
                        } else if (water.radius) {
                            // Circle
                            dist = Utils.distance(ball.x, ball.y, water.x, water.y) - water.radius;
                            // Point on edge closest to ball
                            const angle = Math.atan2(ball.y - water.y, ball.x - water.x);
                            waterX = water.x + Math.cos(angle) * water.radius;
                            waterY = water.y + Math.sin(angle) * water.radius;
                        } else {
                            // Rect
                            dist = Utils.pointRectDistance(ball.x, ball.y, water.x, water.y, water.width, water.height);
                            // Simple approximation for spawn point (clamped center)
                            waterX = Utils.clamp(ball.x, water.x, water.x + water.width);
                            waterY = Utils.clamp(ball.y, water.y, water.y + water.height);
                        }

                        // Check if close (e.g. within 60px) but NOT inside (dist > 0)
                        // Note: pointRectDistance returns 0 if inside.
                        if (dist > 0 && dist < 60) {
                            nearWater = true;
                            break;
                        }
                    }

                    if (nearWater) {
                        this.activeAlligator = {
                            x: waterX,
                            y: waterY,
                            ball: player, // Store player ref
                            timer: 0,
                            state: 'EMERGE', // EMERGE, BITE, SUBMERGE
                            angle: Math.atan2(ball.y - waterY, ball.x - waterX)
                        };
                        this.alligatorTimer = 0;
                        AudioSys.playSound('splash'); // Emerge sound
                        break; // One alligator at a time
                    }
                }
            }
        } else {
            // Update Alligator
            const gator = this.activeAlligator;
            gator.timer += dt;
            
            if (gator.state === 'EMERGE') {
                if (gator.timer > 0.5) {
                    gator.state = 'BITE';
                    gator.timer = 0;
                    AudioSys.playSound('click'); // Snap sound
                }
            } else if (gator.state === 'BITE') {
                if (gator.timer > 0.2) {
                    // Eat the ball
                    const player = gator.ball;
                    if (!player.finishedHole) { // Double check
                        AudioSys.playSound('splash');
                        AudioSys.speak("Oh no! The alligator got it!");
                        
                        player.strokes++;
                        player.totalStrokes++;
                        
                        // Reset ball
                        const holeData = this.courseData.holes[this.currentHoleIndex];
                        player.ball.x = holeData.start.x;
                        player.ball.y = holeData.start.y;
                        player.ball.vx = 0;
                        player.ball.vy = 0;
                    }
                    
                    gator.state = 'SUBMERGE';
                    gator.timer = 0;
                }
            } else if (gator.state === 'SUBMERGE') {
                if (gator.timer > 0.5) {
                    this.activeAlligator = null;
                    this.alligatorTimer = 0;
                }
            }
        }

        // Input Handling is now done via handleInput event routing
        if (this.canShoot) {
            // Auto Scan Aim Logic
            const autoScan = (typeof NarbeScanManager !== 'undefined' && NarbeScanManager.getSettings().autoScan);
            if (autoScan && !this.charging) {
                this.aimRotating = true;
            }

            if (this.aimRotating) {
                const speedSetting = Settings.get('aimerSpeed');
                let speed = 18; // Medium: 360/20
                if (speedSetting === 'Super Slow') speed = 6; // 360/60
                else if (speedSetting === 'Slow') speed = 12; // 360/30
                else if (speedSetting === 'Fast') speed = 36; // 360/10
                
                this.aimAngle += this.aimRotateDir * speed * dt;
            }
            
            if (this.charging) {
                this.power += dt * 0.6; // Charge speed (3.0 power / 5.0 seconds = 0.6)
                if (this.power > 3) this.power = 3; // Max power
                AudioSys.updateChargeSound(this.power / 3.0);
            }
        }

        // Physics
        // Sub-step physics for stability
        const steps = 5;
        const subDt = (dt * 60) / steps;
        
        // Collect all balls that have started the hole
        const activePlayers = this.players.filter(p => p.hasStartedHole);
        const balls = activePlayers.map(p => p.ball);
        
        // Store start positions for texture rolling
        const startPositions = balls.map(b => ({ x: b.x, y: b.y }));

        let results = [];
        if (balls.length > 0) {
            for (let i = 0; i < steps; i++) {
                const res = this.physics.update(balls, this.walls, this.waters, this.sands, this.ice, this.boosts, this.bridges, this.trees, subDt);
                // res is array of { inWater, ball }
                if (i === 0) results = res; // Capture first step results for water check
                else {
                    // Merge water results
                    res.forEach((r, idx) => {
                        if (r.inWater) results[idx].inWater = true;
                    });
                }
            }
        }
        
        // Update texture offset based on movement (Rolling effect)
        balls.forEach((b, i) => {
            b.textureX += (b.x - startPositions[i].x);
            b.textureY += (b.y - startPositions[i].y);
        });
        
        // Handle Water Hazards
        results.forEach((res, idx) => {
            const player = activePlayers[idx];
            if (res.inWater && !player.finishedHole) {
                AudioSys.playSound('splash');
                if (this.gameMode === 'MULTIPLAYER') {
                    AudioSys.speak(`${player.name} Water Hazard.`);
                } else {
                    AudioSys.speak("Water Hazard. Penalty Stroke.");
                }
                
                player.strokes++;
                player.totalStrokes++;
                
                // Reset to start of hole
                const holeData = this.courseData.holes[this.currentHoleIndex];
                // In multiplayer, if multiple people water hazard, offset them? 
                // For now, just put them at start.
                player.ball.x = holeData.start.x;
                player.ball.y = holeData.start.y;
                player.ball.vx = 0;
                player.ball.vy = 0;
            }
        });

        // Check if ALL active balls stopped
        const allStopped = balls.every(b => Math.abs(b.vx) < 0.05 && Math.abs(b.vy) < 0.05);

        if (!this.canShoot && allStopped) {
            this.canShoot = true;
            
            // Challenge Mode Check: If stopped and over par and not in hole -> Fail
            if (this.gameMode === 'CHALLENGE') {
                const par = this.courseData.holes[this.currentHoleIndex].par;
                const player = this.players[this.currentPlayerIndex];
                
                // If we haven't finished the hole (ball didn't go in) and we are at or over par
                if (!player.finishedHole && player.strokes >= par) {
                    AudioSys.playSound('splash'); // Fail sound
                    this.state = 'CHALLENGE_FAIL';
                    this.setTransition(() => {
                        // Reset to Hole 1
                        this.loadCourse(this.courseData);
                    }, 4000);
                    return;
                }
            }

            if (this.gameMode === 'MULTIPLAYER') {
                // Switch Turn
                let nextIdx = (this.currentPlayerIndex + 1) % this.players.length;
                let loops = 0;
                while (this.players[nextIdx].finishedHole && loops < this.players.length) {
                    nextIdx = (nextIdx + 1) % this.players.length;
                    loops++;
                }
                
                if (loops < this.players.length) {
                    this.currentPlayerIndex = nextIdx;
                    
                    // Activate the next player if they haven't started yet
                    if (!this.players[this.currentPlayerIndex].hasStartedHole) {
                        const holeData = this.courseData.holes[this.currentHoleIndex];
                        this.players[this.currentPlayerIndex].ball.x = holeData.start.x;
                        this.players[this.currentPlayerIndex].ball.y = holeData.start.y;
                        this.players[this.currentPlayerIndex].hasStartedHole = true;
                    }
                    
                    AudioSys.speak(`${this.players[this.currentPlayerIndex].name}'s Turn`);
                }
            } else {
                AudioSys.speak("Ready");
            }
        }

        // Check Hole for each player
        activePlayers.forEach(player => {
            if (player.finishedHole) return;
            
            const distToHole = Utils.distance(player.ball.x, player.ball.y, this.hole.x, this.hole.y);
            if (distToHole < this.hole.radius) {
                AudioSys.playSound('hole');
                player.finishedHole = true;
                
                if (this.gameMode === 'MULTIPLAYER') {
                    this.finishOrder.push(player);
                }

                // Move ball off screen or hide it? 
                // For now, just stop it and maybe hide it in draw
                player.ball.vx = 0;
                player.ball.vy = 0;
                player.ball.x = -1000; // Hack to hide
                
                if (this.gameMode === 'MULTIPLAYER') {
                    AudioSys.speak(`${player.name} Holed Out! ${player.strokes} strokes.`);
                } else {
                    this.handleHoleOutro();
                }
            }
        });
        
        // Multiplayer: Check if all finished
        if (this.gameMode === 'MULTIPLAYER') {
            if (this.players.every(p => p.finishedHole)) {
                this.handleHoleOutro();
            }
        }
    }
    
    handleHoleOutro() {
        // Hole Outro
        this.state = 'HOLE_OUTRO';
        Input.setMode('MENU');
        
        const par = this.courseData.holes[this.currentHoleIndex].par;
        
        if (this.gameMode === 'MULTIPLAYER') {
             // Show scoreboard or summary
             AudioSys.speak("Hole Complete.");
        } else {
            let resultText = "";
            let celebrationLevel = 0; // 0: None, 1: Small, 2: Big

            if (this.strokes === 1) {
                resultText = "Hole in One!";
                celebrationLevel = 2;
            } else if (this.strokes <= par - 2) {
                resultText = "Eagle!";
                celebrationLevel = 2;
            } else if (this.strokes <= par - 1) {
                resultText = "Birdie!";
                celebrationLevel = 1;
            } else if (this.strokes === par) {
                resultText = "paar.";
                celebrationLevel = 0;
            } else if (this.strokes === par + 1) {
                resultText = "Bogey.";
                celebrationLevel = 0;
            } else if (this.strokes === par + 2) {
                resultText = "Double Bogey.";
                celebrationLevel = 0;
            } else {
                resultText = "Triple Bogey.";
                celebrationLevel = 0;
            }
            
            // Challenge Mode Check
            if (this.gameMode === 'CHALLENGE' && this.strokes > par) {
                AudioSys.speak(`Failed. You went over Par. Game Over.`);
                this.state = 'GAME_OVER';
                this.setTransition(() => {
                    this.menu.showMainMenu();
                }, 4000);
                return;
            }
            
            AudioSys.speak(`${resultText} ${this.strokes} strokes.`);
            
            if (celebrationLevel > 0) {
                AudioSys.playSound('cheer');
                // Emit particles
                const count = celebrationLevel === 2 ? 200 : 50;
                this.particles.emit(this.canvas.width/2, this.canvas.height/2, 'confetti', count);
                if (celebrationLevel === 2) {
                    // Extra burst
                    setTimeout(() => this.particles.emit(this.canvas.width/4, this.canvas.height/3, 'confetti', 100), 500);
                    setTimeout(() => this.particles.emit(3*this.canvas.width/4, this.canvas.height/3, 'confetti', 100), 1000);
                }
            }
        }

        this.setTransition(() => {
            if (this.gameMode === 'MULTIPLAYER' && this.finishOrder && this.finishOrder.length > 0) {
                const finishedIds = new Set(this.finishOrder.map(p => p.id));
                const notFinished = this.players.filter(p => !finishedIds.has(p.id));
                this.players = [...this.finishOrder, ...notFinished];
            }
            this.currentHoleIndex++;
            this.loadHole(this.currentHoleIndex);
        }, 4000);
    }

    getPredictedPath() {
        const wasGlowing = this.holeGlow;
        this.holeGlow = false;
        if (!this.canShoot) return [];

        const path = [];
        const rad = Utils.degToRad(this.aimAngle);
        const startDist = 30;
        
        // Start point (offset from ball)
        const startX = this.ball.x + Math.cos(rad) * startDist;
        const startY = this.ball.y + Math.sin(rad) * startDist;
        
        path.push({ x: startX, y: startY });

        // Simulation
        const ghostBall = { ...this.ball }; 
        if (ghostBall.bushState === undefined) ghostBall.bushState = 'NONE';

        // Start simulation at the offset to avoid "reset" visual
        ghostBall.x = startX;
        ghostBall.y = startY;
        
        // Always simulate with Max Power (3.0) to show full trajectory
        const simPower = 3.0;
        const speed = simPower * 20; 
        ghostBall.vx = Math.cos(rad) * speed;
        ghostBall.vy = Math.sin(rad) * speed;

        // Limit steps to show trajectory (Shortened by 50%)
        // Increased steps, decreased dt for accuracy
        const maxSteps = Math.floor((simPower * 60 + 25) * 0.5); 
        const dt = 0.2; 

        for (let i = 0; i < maxSteps; i++) {
            this.physics.update(ghostBall, this.walls, this.waters, this.sands, this.ice, this.boosts, this.bridges, this.trees, dt, true);
            path.push({ x: ghostBall.x, y: ghostBall.y });

            if (Math.abs(ghostBall.vx) < 0.05 && Math.abs(ghostBall.vy) < 0.05) break;
            
            if (Utils.distance(ghostBall.x, ghostBall.y, this.hole.x, this.hole.y) < this.hole.radius) {
                path.push({ x: this.hole.x, y: this.hole.y });
                this.holeGlow = true;
                break;
            }
        }
        
        // Ensure minimum length (Stub behavior) to prevent flickering at low power
        const lastPt = path[path.length - 1];
        const dist = Utils.distance(startX, startY, lastPt.x, lastPt.y);
        
        if (dist < 30) {
             path.push({
                x: startX + Math.cos(rad) * 30,
                y: startY + Math.sin(rad) * 30
             });
        }
        
        // Play sound if glow just activated
        if (!wasGlowing && this.holeGlow) {
            AudioSys.playSound('glow');
        }

        return path;
    }

    getAimerColor() {
        // Always white for the trajectory line now, since power is shown on bar
        return 'white';
    }

    shoot() {
        AudioSys.stopChargeSound();
        this.charging = false;
        this.canShoot = false;
        this.strokes++;
        this.totalStrokes++;
        
        // Ensure bushState is valid
        if (this.ball.bushState === undefined) this.ball.bushState = 'NONE';

        // Check Bush State
        if (this.ball.bushState === 'STUCK') {
            this.ball.bushState = 'UNLOCKED';
            AudioSys.playSound('bush'); // Low pitch sound
            AudioSys.speak("Bush Unlocked!");
            this.power = 0;
            // No velocity applied
            return;
        }

        const rad = Utils.degToRad(this.aimAngle);
        const speed = this.power * 20; // Slightly reduced power for golf feel
        
        this.ball.vx = Math.cos(rad) * speed;
        this.ball.vy = Math.sin(rad) * speed;
        
        AudioSys.playSound('putt');
        this.power = 0;
    }

    draw() {
        // Clear background (Letterbox)
        this.ctx.save();
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.fillStyle = '#111'; 
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.restore();

        // Apply Scale & Center
        this.ctx.save();
        this.ctx.translate(this.offsetX, this.offsetY);
        this.ctx.scale(this.scale, this.scale);

        // Clip to design area
        this.ctx.beginPath();
        this.ctx.rect(0, 0, 1280, 720);
        this.ctx.clip();

        // Draw Background Gradient
        const grad = this.ctx.createRadialGradient(640, 360, 0, 640, 360, 1280);
        grad.addColorStop(0, '#2E8B57'); // SeaGreen
        grad.addColorStop(1, '#006400'); // DarkGreen
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(0, 0, 1280, 720);

        if (this.state === 'PLAYING' || this.state === 'HOLE_OUTRO' || this.state === 'HOLE_INTRO') {
            // Draw Hazards - Sand
            this.ctx.save();
            this.ctx.shadowColor = 'rgba(0,0,0,0.2)';
            this.ctx.shadowBlur = 5;
            this.sands.forEach(s => {
                this.ctx.fillStyle = this.sandPattern || '#F0E68C'; 
                this.ctx.strokeStyle = '#DAA520'; // Goldenrod
                this.ctx.lineWidth = 3;
                this.ctx.beginPath();
                
                if (s.points) {
                    if (s.smooth && s.points.length > 2) {
                        const len = s.points.length;
                        const pLast = s.points[len - 1];
                        const pFirst = s.points[0];
                        let midX = (pLast.x + pFirst.x) / 2;
                        let midY = (pLast.y + pFirst.y) / 2;
                        this.ctx.moveTo(midX, midY);
                        for (let i = 0; i < len; i++) {
                            const p = s.points[i];
                            const nextP = s.points[(i + 1) % len];
                            const nextMidX = (p.x + nextP.x) / 2;
                            const nextMidY = (p.y + nextP.y) / 2;
                            this.ctx.quadraticCurveTo(p.x, p.y, nextMidX, nextMidY);
                        }
                    } else {
                        this.ctx.moveTo(s.points[0].x, s.points[0].y);
                        for (let i = 1; i < s.points.length; i++) {
                            this.ctx.lineTo(s.points[i].x, s.points[i].y);
                        }
                    }
                    this.ctx.closePath();
                } else if (s.radius) {
                    this.ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
                } else {
                    this.ctx.rect(s.x, s.y, s.width, s.height);
                }
                
                this.ctx.fill();
                this.ctx.stroke();
            });
            this.ctx.restore();
            
            // Draw Hazards - Water
            this.ctx.save();
            this.ctx.shadowColor = 'rgba(0,0,0,0.2)';
            this.ctx.shadowBlur = 5;
            this.waters.forEach(w => {
                this.ctx.fillStyle = this.waterPattern || '#4FA4F4'; 
                this.ctx.strokeStyle = 'rgba(41, 128, 185, 0.5)'; // Darker Blue, semi-transparent
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                
                if (w.points) {
                    if (w.smooth && w.points.length > 2) {
                        const len = w.points.length;
                        const pLast = w.points[len - 1];
                        const pFirst = w.points[0];
                        let midX = (pLast.x + pFirst.x) / 2;
                        let midY = (pLast.y + pFirst.y) / 2;
                        this.ctx.moveTo(midX, midY);
                        for (let i = 0; i < len; i++) {
                            const p = w.points[i];
                            const nextP = w.points[(i + 1) % len];
                            const nextMidX = (p.x + nextP.x) / 2;
                            const nextMidY = (p.y + nextP.y) / 2;
                            this.ctx.quadraticCurveTo(p.x, p.y, nextMidX, nextMidY);
                        }
                    } else {
                        this.ctx.moveTo(w.points[0].x, w.points[0].y);
                        for (let i = 1; i < w.points.length; i++) {
                            this.ctx.lineTo(w.points[i].x, w.points[i].y);
                        }
                    }
                    this.ctx.closePath();
                } else if (w.radius) {
                    this.ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
                } else {
                    this.ctx.rect(w.x, w.y, w.width, w.height);
                }
                
                this.ctx.fill();
                this.ctx.stroke();
            });
            this.ctx.restore();

            // Draw Hazards - Ice
            this.ctx.save();
            this.ctx.shadowColor = 'rgba(255,255,255,0.4)';
            this.ctx.shadowBlur = 8;
            this.ice.forEach(i => {
                this.ctx.fillStyle = this.icePattern || '#E0FFFF'; 
                this.ctx.strokeStyle = '#B0E0E6'; // PowderBlue
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                
                if (i.points) {
                    if (i.smooth && i.points.length > 2) {
                        const len = i.points.length;
                        const pLast = i.points[len - 1];
                        const pFirst = i.points[0];
                        let midX = (pLast.x + pFirst.x) / 2;
                        let midY = (pLast.y + pFirst.y) / 2;
                        this.ctx.moveTo(midX, midY);
                        for (let j = 0; j < len; j++) {
                            const p = i.points[j];
                            const nextP = i.points[(j + 1) % len];
                            const nextMidX = (p.x + nextP.x) / 2;
                            const nextMidY = (p.y + nextP.y) / 2;
                            this.ctx.quadraticCurveTo(p.x, p.y, nextMidX, nextMidY);
                        }
                    } else {
                        this.ctx.moveTo(i.points[0].x, i.points[0].y);
                        for (let j = 1; j < i.points.length; j++) {
                            this.ctx.lineTo(i.points[j].x, i.points[j].y);
                        }
                    }
                    this.ctx.closePath();
                }
                
                this.ctx.fill();
                this.ctx.stroke();
            });
            this.ctx.restore();

            // Draw Hazards - Boosts
            this.ctx.save();
            this.ctx.shadowColor = 'rgba(255,165,0,0.4)';
            this.ctx.shadowBlur = 8;
            this.boosts.forEach(b => {
                if (this.boostPattern) {
                    const angle = (b.boostAngle !== undefined) ? b.boostAngle : (b.angle || 0);
                    const matrix = new DOMMatrix();
                    if (angle) matrix.rotateSelf(angle);
                    this.boostPattern.setTransform(matrix);
                    this.ctx.fillStyle = this.boostPattern;
                } else {
                    this.ctx.fillStyle = '#FFA500'; 
                }
                
                this.ctx.strokeStyle = '#FF8C00'; // DarkOrange
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                
                if (b.points) {
                    if (b.smooth && b.points.length > 2) {
                        const len = b.points.length;
                        const pLast = b.points[len - 1];
                        const pFirst = b.points[0];
                        let midX = (pLast.x + pFirst.x) / 2;
                        let midY = (pLast.y + pFirst.y) / 2;
                        this.ctx.moveTo(midX, midY);
                        for (let j = 0; j < len; j++) {
                            const p = b.points[j];
                            const nextP = b.points[(j + 1) % len];
                            const nextMidX = (p.x + nextP.x) / 2;
                            const nextMidY = (p.y + nextP.y) / 2;
                            this.ctx.quadraticCurveTo(p.x, p.y, nextMidX, nextMidY);
                        }
                    } else {
                        this.ctx.moveTo(b.points[0].x, b.points[0].y);
                        for (let j = 1; j < b.points.length; j++) {
                            this.ctx.lineTo(b.points[j].x, b.points[j].y);
                        }
                    }
                    this.ctx.closePath();
                }
                
                this.ctx.fill();
                this.ctx.stroke();
            });
            this.ctx.restore();

            // Draw Bridges
            this.ctx.save();
            this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
            this.ctx.shadowBlur = 5;
            this.ctx.shadowOffsetY = 5;
            this.bridges.forEach(b => {
                this.ctx.save();
                const cx = b.x + b.width/2;
                const cy = b.y + b.height/2;
                this.ctx.translate(cx, cy);
                this.ctx.rotate(Utils.degToRad(b.angle));
                
                const w = b.width;
                const h = b.height;
                
                this.ctx.fillStyle = this.bridgePattern || '#DEB887'; 
                this.ctx.strokeStyle = '#8B4513'; 
                this.ctx.lineWidth = 2;
                
                // Draw centered
                this.ctx.fillRect(-w/2, -h/2, w, h);
                this.ctx.strokeRect(-w/2, -h/2, w, h);
                
                // Draw Rails (Visual only, physics handled by invisible walls)
                this.ctx.fillStyle = '#8B4513';
                this.ctx.fillRect(-w/2, -h/2, w, 5); // Top Rail
                this.ctx.fillRect(-w/2, h/2 - 5, w, 5); // Bottom Rail

                // Blending (Ramps)
                // Gradient at left end (-w/2)
                const rampSize = 25;
                const gradLeft = this.ctx.createLinearGradient(-w/2, 0, -w/2 + rampSize, 0);
                gradLeft.addColorStop(0, 'rgba(0, 100, 0, 0.8)'); // Greenish transparent
                gradLeft.addColorStop(1, 'rgba(0, 100, 0, 0)');
                this.ctx.fillStyle = gradLeft;
                this.ctx.fillRect(-w/2, -h/2 + 5, rampSize, h - 10); // Inside walls

                // Gradient at right end (w/2)
                const gradRight = this.ctx.createLinearGradient(w/2, 0, w/2 - rampSize, 0);
                gradRight.addColorStop(0, 'rgba(0, 100, 0, 0.8)');
                gradRight.addColorStop(1, 'rgba(0, 100, 0, 0)');
                this.ctx.fillStyle = gradRight;
                this.ctx.fillRect(w/2 - rampSize, -h/2 + 5, rampSize, h - 10);
                
                this.ctx.restore();
            });
            this.ctx.restore();

            // Draw Trees (Bushes)
            this.ctx.save();
            this.ctx.shadowColor = 'rgba(0,0,0,0.4)';
            this.ctx.shadowBlur = 10;
            this.ctx.shadowOffsetY = 5;
            if (this.trees && this.trees.length > 0) {
                // Optimization: Batch drawing calls
                if (this.bushPattern) {
                    this.ctx.fillStyle = this.bushPattern;
                } else {
                    this.ctx.fillStyle = '#006400'; // Fallback
                }
                this.ctx.strokeStyle = '#004d00';
                this.ctx.lineWidth = 2;

                this.ctx.beginPath();
                this.trees.forEach(t => {
                    if (t.x === undefined || t.y === undefined || !t.radius) return;
                    
                    // Move to start of arc to avoid connecting lines
                    this.ctx.moveTo(t.x + t.radius, t.y);
                    this.ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
                });
                this.ctx.fill();
                this.ctx.stroke();
            }
            this.ctx.restore();

            // Draw Walls
            this.ctx.save();
            this.ctx.shadowColor = 'rgba(0,0,0,0.5)';
            this.ctx.shadowBlur = 10;
            this.ctx.shadowOffsetY = 5;
            
            this.walls.forEach(w => {
                this.ctx.save();
                if (w.angle) {
                    const cx = w.x + w.width/2;
                    const cy = w.y + w.height/2;
                    this.ctx.translate(cx, cy);
                    this.ctx.rotate(Utils.degToRad(w.angle));
                    this.ctx.translate(-cx, -cy);
                }
                
                // Wall Body
                this.ctx.fillStyle = this.brickPattern || '#A52A2A'; 
                this.ctx.strokeStyle = '#000000'; // Black Border
                this.ctx.lineWidth = 4;
                
                this.ctx.beginPath();
                this.ctx.rect(w.x, w.y, w.width, w.height);
                this.ctx.fill();
                this.ctx.stroke();
                
                // Inner Bevel/Highlight
                this.ctx.strokeStyle = 'rgba(255,255,255,0.3)';
                this.ctx.lineWidth = 2;
                this.ctx.beginPath();
                this.ctx.moveTo(w.x + 4, w.y + w.height - 4);
                this.ctx.lineTo(w.x + 4, w.y + 4);
                this.ctx.lineTo(w.x + w.width - 4, w.y + 4);
                this.ctx.stroke();

                this.ctx.restore();
            });
            this.ctx.restore();

            // Draw Hole
            if (this.holeGlow) {
                this.ctx.save();
                // Pulsing effect
                const pulse = (Math.sin(Date.now() / 150) + 1) / 2; // Faster pulse
                const glowSize = 40 + pulse * 20; // Much larger glow
                
                this.ctx.shadowColor = '#FFD700'; // Gold
                this.ctx.shadowBlur = glowSize;
                this.ctx.beginPath();
                this.ctx.arc(this.hole.x, this.hole.y, this.hole.radius + 8 + pulse * 8, 0, Math.PI * 2);
                this.ctx.fillStyle = `rgba(255, 215, 0, ${0.6 + pulse * 0.3})`; // More opaque gold
                this.ctx.fill();
                
                // Extra ring
                this.ctx.strokeStyle = 'white';
                this.ctx.lineWidth = 4; // Thicker ring
                this.ctx.stroke();

                // Second outer ring for visibility
                this.ctx.beginPath();
                this.ctx.arc(this.hole.x, this.hole.y, this.hole.radius + 15 + pulse * 10, 0, Math.PI * 2);
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${0.5 + pulse * 0.5})`;
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
                
                this.ctx.restore();
            }

            // Hole Body
            this.ctx.beginPath();
            this.ctx.arc(this.hole.x, this.hole.y, this.hole.radius, 0, Math.PI * 2);
            this.ctx.fillStyle = 'black';
            this.ctx.fill();
            
            // Hole Rim
            this.ctx.strokeStyle = '#333';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();

            // Draw Balls
            this.players.forEach(player => {
                if (player.finishedHole) return; // Don't draw if finished
                if (!player.hasStartedHole) return; // Don't draw if not started yet
                
                const ball = player.ball;
                
                this.ctx.save();
                this.ctx.shadowColor = 'rgba(0,0,0,0.7)'; // Darker shadow
                this.ctx.shadowBlur = 6;
                this.ctx.shadowOffsetX = 3;
                this.ctx.shadowOffsetY = 3;
                
                // Base Ball
                this.ctx.beginPath();
                this.ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
                this.ctx.fillStyle = player.color || 'white';
                this.ctx.fill();
                
                this.ctx.shadowColor = 'transparent'; // Reset shadow for texture

                // Dimple Pattern (Clipped)
                this.ctx.save();
                this.ctx.clip(); // Clip to the ball circle
                
                // Make pattern move with ball but shift opposite to simulate rolling
                const matrix = new DOMMatrix();
                matrix.translateSelf(ball.x + ball.textureX, ball.y + ball.textureY);
                
                // Scale pattern based on ball size (Default radius 15)
                const patternScale = ball.radius / 15;
                matrix.scaleSelf(patternScale, patternScale);
                
                this.ballPattern.setTransform(matrix);
                
                this.ctx.fillStyle = this.ballPattern;
                this.ctx.fillRect(ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
                
                // 3D Shading Overlay (Inner Shadow)
                // Reset transform for shading so it stays fixed relative to the ball shape, not the texture
                this.ballPattern.setTransform(new DOMMatrix()); 
                
                const shading = this.ctx.createRadialGradient(
                    ball.x - ball.radius * 0.3, 
                    ball.y - ball.radius * 0.3, 
                    ball.radius * 0.2, 
                    ball.x, 
                    ball.y, 
                    ball.radius
                );
                shading.addColorStop(0, 'rgba(255,255,255,0)');
                shading.addColorStop(0.7, 'rgba(0,0,0,0.05)');
                shading.addColorStop(1, 'rgba(0,0,0,0.3)'); // Darker edge
                
                this.ctx.fillStyle = shading;
                this.ctx.fillRect(ball.x - ball.radius, ball.y - ball.radius, ball.radius * 2, ball.radius * 2);
                
                this.ctx.restore();

                // Specular Highlight
                this.ctx.fillStyle = 'rgba(255,255,255,0.9)';
                this.ctx.beginPath();
                this.ctx.arc(ball.x - ball.radius*0.3, ball.y - ball.radius*0.3, ball.radius * 0.25, 0, Math.PI * 2);
                this.ctx.fill();
                
                // Draw Player Name above ball if Multiplayer
                if (this.gameMode === 'MULTIPLAYER') {
                    this.ctx.fillStyle = 'white';
                    this.ctx.font = '12px Arial';
                    this.ctx.textAlign = 'center';
                    this.ctx.strokeStyle = 'black';
                    this.ctx.lineWidth = 2;
                    this.ctx.strokeText(player.name, ball.x, ball.y - 15);
                    this.ctx.fillText(player.name, ball.x, ball.y - 15);
                    
                    // Highlight current player
                    if (player === this.players[this.currentPlayerIndex] && this.canShoot) {
                        this.ctx.strokeStyle = 'yellow';
                        this.ctx.lineWidth = 2;
                        this.ctx.beginPath();
                        this.ctx.arc(ball.x, ball.y, ball.radius + 5, 0, Math.PI * 2);
                        this.ctx.stroke();
                    }
                }
                
                this.ctx.restore();
            });

            // Draw Alligator
            if (this.activeAlligator) {
                const gator = this.activeAlligator;
                this.ctx.save();
                this.ctx.translate(gator.x, gator.y);
                this.ctx.rotate(gator.angle);
                
                // Scale based on animation state
                let scale = 0;
                if (gator.state === 'EMERGE') {
                    scale = Math.min(1, gator.timer / 0.5);
                } else if (gator.state === 'BITE') {
                    scale = 1;
                } else if (gator.state === 'SUBMERGE') {
                    scale = Math.max(0, 1 - (gator.timer / 0.5));
                }
                
                this.ctx.scale(scale, scale);
                
                // Draw Alligator Head (Top Down - Simplified)
                
                // Lunge effect during BITE
                let lunge = 0;
                if (gator.state === 'BITE') {
                    // Quick lunge forward and back
                    lunge = Math.sin(gator.timer * Math.PI * 5) * 10; 
                    if (lunge < 0) lunge = 0;
                }

                this.ctx.translate(lunge, 0); // Move along local X (which is rotated towards ball)

                // Body/Neck (fading into water)
                this.ctx.fillStyle = '#1a5c1a'; // Darker Green
                this.ctx.beginPath();
                this.ctx.ellipse(-20, 0, 25, 20, 0, 0, Math.PI*2);
                this.ctx.fill();

                // Head/Snout
                this.ctx.fillStyle = '#228B22'; // Forest Green
                this.ctx.strokeStyle = '#004d00';
                this.ctx.lineWidth = 2;
                
                // Main Snout Shape
                this.ctx.beginPath();
                this.ctx.moveTo(-10, -15);
                this.ctx.lineTo(60, -10); // Snout tip left
                this.ctx.quadraticCurveTo(70, 0, 60, 10); // Nose rounded
                this.ctx.lineTo(-10, 15); // Snout base right
                this.ctx.quadraticCurveTo(-15, 0, -10, -15); // Back of head
                this.ctx.fill();
                this.ctx.stroke();
                
                // Ridge/Nose details
                this.ctx.fillStyle = 'rgba(0,0,0,0.2)';
                this.ctx.beginPath();
                this.ctx.ellipse(60, -5, 2, 1, 0, 0, Math.PI*2); // Nostril L
                this.ctx.ellipse(60, 5, 2, 1, 0, 0, Math.PI*2); // Nostril R
                this.ctx.fill();
                
                // Eyes (Bulging on top)
                const eyeX = 0;
                const eyeY = 12;
                
                // Left Eye
                this.ctx.fillStyle = '#228B22';
                this.ctx.beginPath();
                this.ctx.arc(eyeX, -eyeY, 8, 0, Math.PI*2);
                this.ctx.fill();
                this.ctx.stroke();
                
                this.ctx.fillStyle = 'yellow';
                this.ctx.beginPath();
                this.ctx.ellipse(eyeX, -eyeY, 6, 3, 0, 0, Math.PI*2); // Slit eye shape
                this.ctx.fill();
                
                this.ctx.fillStyle = 'black'; // Pupil
                this.ctx.beginPath();
                this.ctx.ellipse(eyeX, -eyeY, 1, 3, 0, 0, Math.PI*2); // Vertical slit
                this.ctx.fill();

                // Right Eye
                this.ctx.fillStyle = '#228B22';
                this.ctx.beginPath();
                this.ctx.arc(eyeX, eyeY, 8, 0, Math.PI*2);
                this.ctx.fill();
                this.ctx.stroke();
                
                this.ctx.fillStyle = 'yellow';
                this.ctx.beginPath();
                this.ctx.ellipse(eyeX, eyeY, 6, 3, 0, 0, Math.PI*2);
                this.ctx.fill();
                
                this.ctx.fillStyle = 'black'; // Pupil
                this.ctx.beginPath();
                this.ctx.ellipse(eyeX, eyeY, 1, 3, 0, 0, Math.PI*2);
                this.ctx.fill();

                this.ctx.restore();
            }

            // Draw Aim Line (Trajectory)
            if (this.canShoot) {
                const aimerStyle = Settings.get('aimerStyle');
                
                if (aimerStyle === 'BASIC') {
                    // Basic Arrow
                    this.ctx.save();
                    const rad = Utils.degToRad(this.aimAngle);
                    const arrowLen = 80; // Increased length slightly
                    const arrowSize = 15 + (this.aimerThickness - 3) * 2;
                    
                    // Start off the ball
                    const startDist = this.ball.radius + 5;
                    const startX = this.ball.x + Math.cos(rad) * startDist;
                    const startY = this.ball.y + Math.sin(rad) * startDist;
                    
                    // Tip of the arrow
                    const tipDist = arrowLen;
                    const tipX = this.ball.x + Math.cos(rad) * tipDist;
                    const tipY = this.ball.y + Math.sin(rad) * tipDist;
                    
                    // End of the line (base of arrow)
                    const lineEndDist = tipDist - arrowSize + 2; // +2 for overlap
                    const lineEndX = this.ball.x + Math.cos(rad) * lineEndDist;
                    const lineEndY = this.ball.y + Math.sin(rad) * lineEndDist;
                    
                    this.ctx.beginPath();
                    this.ctx.moveTo(startX, startY);
                    this.ctx.lineTo(lineEndX, lineEndY);
                    
                    this.ctx.strokeStyle = 'white';
                    this.ctx.lineWidth = this.aimerThickness;
                    this.ctx.shadowColor = 'black';
                    this.ctx.shadowBlur = 4;
                    this.ctx.lineCap = 'round';
                    this.ctx.stroke();
                    
                    // Arrowhead
                    this.ctx.translate(tipX, tipY);
                    this.ctx.rotate(rad);
                    this.ctx.beginPath();
                    this.ctx.moveTo(0, 0);
                    this.ctx.lineTo(-arrowSize, -arrowSize/2);
                    this.ctx.lineTo(-arrowSize, arrowSize/2);
                    this.ctx.closePath();
                    this.ctx.fillStyle = 'white';
                    this.ctx.fill();
                    this.ctx.restore();
                    
                } else {
                    // Trajectory
                    const path = this.getPredictedPath();
                    const aimColor = this.getAimerColor();
                    
                    if (path.length > 1) {
                        this.ctx.save();
                        
                        const lastPt = path[path.length - 1];
                        const prevPt = path[path.length - 2] || path[0];
                        const angle = Math.atan2(lastPt.y - prevPt.y, lastPt.x - prevPt.x);
                        const arrowSize = 15 + (this.aimerThickness - 3) * 2; // Scale arrow

                        // Outline (Black under-stroke)
                        this.ctx.beginPath();
                        this.ctx.moveTo(path[0].x, path[0].y);
                        for (let i = 1; i < path.length; i++) {
                             // Stop drawing line if we are close to the arrow
                            if (Utils.distance(path[i].x, path[i].y, lastPt.x, lastPt.y) > arrowSize) {
                                this.ctx.lineTo(path[i].x, path[i].y);
                            } else {
                                break;
                            }
                        }
                        
                        // Scale dash size with thickness to prevent merging
                        const dashSize = 20 + (this.aimerThickness * 2);
                        
                        this.ctx.strokeStyle = 'black';
                        this.ctx.lineWidth = this.aimerThickness + 4; 
                        this.ctx.setLineDash([dashSize, dashSize]);
                        this.ctx.lineCap = 'round';
                        this.ctx.stroke();

                        // Inner Line with Glow
                        this.ctx.shadowColor = aimColor;
                        this.ctx.shadowBlur = 10;
                        this.ctx.strokeStyle = aimColor;
                        this.ctx.lineWidth = this.aimerThickness;
                        this.ctx.stroke();
                        this.ctx.shadowBlur = 0; // Reset
                        
                        this.ctx.setLineDash([]);

                        // Arrowhead at the end
                        this.ctx.translate(lastPt.x, lastPt.y);
                        this.ctx.rotate(angle);
                        
                        // Arrow Outline
                        this.ctx.beginPath();
                        this.ctx.moveTo(0, 0);
                        this.ctx.lineTo(-arrowSize, -arrowSize/2);
                        this.ctx.lineTo(-arrowSize, arrowSize/2);
                        this.ctx.closePath();
                        this.ctx.fillStyle = aimColor;
                        this.ctx.strokeStyle = 'black';
                        this.ctx.lineWidth = 3;
                        this.ctx.stroke();
                        this.ctx.fill();

                        this.ctx.restore();
                    }
                }
            }

            // UI - HUD Box
            this.ctx.save();
            
            // Check for ball overlap with Top Left HUD
            // HUD Rect: x=20, y=20, w=220, h=110
            // We add a buffer so it fades before the ball goes under
            if (this.ball.x < 20 + 220 + 50 && this.ball.y < 20 + 110 + 50) {
                this.ctx.globalAlpha = 0.1; // Almost transparent
            } else {
                this.ctx.globalAlpha = 1.0;
            }

            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.lineWidth = 2;
            
            // Top Left Info Box
            this.ctx.beginPath();
            this.ctx.roundRect(20, 20, 220, 110, 10);
            this.ctx.fill();
            this.ctx.stroke();
            
            this.ctx.fillStyle = 'white';
            this.ctx.textAlign = 'left';
            this.ctx.font = 'bold 18px Arial';
            this.ctx.fillText(`HOLE: ${this.currentHoleIndex + 1} / ${this.courseData ? this.courseData.holes.length : '-'}`, 35, 50);
            this.ctx.fillText(`PAR: ${this.courseData ? this.courseData.holes[this.currentHoleIndex].par : '-'}`, 35, 80);
            
            // Strokes (Larger)
            this.ctx.font = 'bold 24px Arial';
            this.ctx.fillStyle = '#4facfe';
            
            if (this.gameMode === 'MULTIPLAYER') {
                const player = this.players[this.currentPlayerIndex];
                this.ctx.fillText(`${player.name}: ${player.strokes}`, 35, 115);
            } else {
                this.ctx.fillText(`STROKES: ${this.strokes}`, 35, 115);
            }
            
            // Reset Alpha for other UI elements
            this.ctx.globalAlpha = 1.0;

            // Total Score (Top Right)
            // Check overlap for Top Right HUD as well
            // Rect: x=1100, y=20, w=160, h=50
            if (this.ball.x > 1280 - 180 - 50 && this.ball.y < 20 + 50 + 50) {
                this.ctx.globalAlpha = 0.1;
            }

            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            this.ctx.beginPath();
            this.ctx.roundRect(1280 - 180, 20, 160, 50, 10);
            this.ctx.fill();
            this.ctx.stroke();
            
            this.ctx.fillStyle = 'white';
            this.ctx.textAlign = 'center';
            this.ctx.font = 'bold 20px Arial';
            
            if (this.gameMode === 'MULTIPLAYER') {
                 const player = this.players[this.currentPlayerIndex];
                 this.ctx.fillText(`TOTAL: ${player.totalStrokes}`, 1280 - 100, 52);
            } else {
                this.ctx.fillText(`TOTAL: ${this.totalStrokes}`, 1280 - 100, 52);
            }
            this.ctx.restore();

            // Pause Button
            const pbX = 20;
            const pbY = 720 - 60;
            const pbSize = 40;
            
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            this.ctx.fillRect(pbX, pbY, pbSize, pbSize);
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(pbX, pbY, pbSize, pbSize);
            
            // Pause Icon (||)
            this.ctx.fillStyle = 'white';
            this.ctx.fillRect(pbX + 12, pbY + 10, 6, 20);
            this.ctx.fillRect(pbX + 22, pbY + 10, 6, 20);

            // Draw Power Bar
            if (this.charging) {
                const barW = 400;
                const barH = 30;
                const barX = (1280 - barW) / 2;
                const barY = 720 - 50;
                
                // Background
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
                this.ctx.fillRect(barX, barY, barW, barH);
                this.ctx.strokeStyle = 'white';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(barX, barY, barW, barH);
                
                // Fill
                const pct = this.power / 3.0;
                const fillW = barW * pct;
                
                // Color Gradient
                // Green (0,255,0) -> Yellow (255,255,0) -> Red (255,0,0)
                let r, g;
                if (pct < 0.5) {
                    // Green to Yellow
                    r = Math.floor(255 * (pct * 2));
                    g = 255;
                } else {
                    // Yellow to Red
                    r = 255;
                    g = Math.floor(255 * (1 - (pct - 0.5) * 2));
                }
                
                this.ctx.fillStyle = `rgb(${r}, ${g}, 0)`;
                this.ctx.fillRect(barX, barY, fillW, barH);
                
                // Text
                this.ctx.fillStyle = 'white';
                this.ctx.font = 'bold 20px Arial';
                this.ctx.textAlign = 'center';
                this.ctx.shadowColor = 'black';
                this.ctx.shadowBlur = 4;
                this.ctx.fillText("POWER", 1280/2, barY - 10);
                this.ctx.shadowBlur = 0;
            }
        }
        
        // Overlays
        if (this.state === 'COURSE_INTRO') {
            this.drawOverlay("COURSE START", [
                this.courseData.name || "Mini Golf Course",
                `${this.courseData.holes.length} Holes`,
                "Get Ready!"
            ]);
        } else if (this.state === 'HOLE_INTRO') {
            const hole = this.courseData.holes[this.currentHoleIndex];
            // Draw a semi-transparent overlay so we can see the course
            this.drawOverlay(`HOLE ${this.currentHoleIndex + 1}`, [
                `Par: ${hole.par}`,
                "Good Luck!"
            ], true);
        } else if (this.state === 'HOLE_OUTRO') {
             if (this.gameMode === 'MULTIPLAYER') {
                 const lines = this.players.map(p => `${p.name}: ${p.strokes} (Total: ${p.totalStrokes})`);
                 this.drawOverlay("HOLE COMPLETE", lines, true);
             } else {
                 const par = this.courseData.holes[this.currentHoleIndex].par;
                 let resultText = "Par";
                 if (this.strokes === 1) resultText = "HOLE IN ONE!";
                 else if (this.strokes < par) resultText = "UNDER PAR";
                 else if (this.strokes > par) resultText = "OVER PAR";
                 else resultText = "PAR";
                 
                 this.drawOverlay(resultText, [
                     `${this.strokes} Strokes`,
                     `Total: ${this.totalStrokes}`
                 ], true);
             }
        } else if (this.state === 'GAME_OVER') {
            if (this.gameMode === 'MULTIPLAYER') {
                this.ctx.save();
                // Background
                this.ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
                this.ctx.fillRect(0, 0, 1280, 720);
                
                // Title
                this.ctx.shadowColor = '#4facfe';
                this.ctx.shadowBlur = 20;
                this.ctx.fillStyle = 'white';
                this.ctx.textAlign = 'center';
                this.ctx.font = 'bold 60px Arial';
                this.ctx.fillText("COURSE COMPLETE", 1280/2, 100);
                this.ctx.shadowBlur = 0;

                // Sort Players
                const sortedPlayers = [...this.players].sort((a, b) => a.totalStrokes - b.totalStrokes);
                
                const startY = 250;
                const rowHeight = 100;
                
                let currentRank = 1;

                sortedPlayers.forEach((p, i) => {
                    // Update rank if score is worse than previous
                    if (i > 0 && p.totalStrokes > sortedPlayers[i-1].totalStrokes) {
                        currentRank = i + 1;
                    }

                    const y = startY + (i * rowHeight);
                    
                    // Rank Text
                    let rankText = "";
                    
                    if (currentRank === 1) {
                         // Check for tie at 1st place
                         const isTie = (sortedPlayers.length > 1 && sortedPlayers[1].totalStrokes === sortedPlayers[0].totalStrokes);
                         
                         if (isTie) {
                             rankText = "Tie";
                         } else {
                             rankText = "1st";
                         }
                    } else {
                        let rankSuffix = "th";
                        if (currentRank === 2) rankSuffix = "nd";
                        else if (currentRank === 3) rankSuffix = "rd";
                        rankText = `${currentRank}${rankSuffix}`;
                    }

                    // Rank Text
                    this.ctx.fillStyle = currentRank === 1 ? '#FFD700' : 'white'; // Gold for winner
                    this.ctx.font = 'bold 40px Arial';
                    this.ctx.textAlign = 'right';
                    this.ctx.fillText(rankText, 1280/2 - 150, y + 15);
                    
                    // Ball
                    let ballY = y;
                    if (currentRank === 1) {
                        // Jump Animation for Winner(s)
                        const jump = Math.abs(Math.sin(Date.now() / 150)) * 30;
                        ballY -= jump;
                    }
                    
                    const ballX = 1280/2 - 80;
                    const radius = 25;
                    
                    // Draw Ball (Simplified)
                    this.ctx.beginPath();
                    this.ctx.arc(ballX, ballY, radius, 0, Math.PI * 2);
                    this.ctx.fillStyle = p.color || 'white';
                    this.ctx.fill();
                    
                    // Highlight
                    this.ctx.beginPath();
                    this.ctx.arc(ballX - radius*0.3, ballY - radius*0.3, radius * 0.25, 0, Math.PI * 2);
                    this.ctx.fillStyle = 'rgba(255,255,255,0.5)';
                    this.ctx.fill();
                    
                    // Name & Score
                    this.ctx.fillStyle = 'white';
                    this.ctx.textAlign = 'left';
                    this.ctx.font = 'bold 40px Arial';
                    this.ctx.fillText(`${p.name}`, 1280/2 - 20, y + 15);
                    
                    this.ctx.font = '30px Arial';
                    this.ctx.fillStyle = '#ccc';
                    this.ctx.fillText(`${p.totalStrokes} Strokes`, 1280/2 + 250, y + 15);
                });
                
                this.ctx.restore();
            } else {
                this.drawOverlay("COURSE COMPLETE", [
                     `Final Score: ${this.totalStrokes}`,
                     "Thanks for playing!"
                 ]);
            }
        } else if (this.state === 'CHALLENGE_FAIL') {
            this.drawOverlay("TRY AGAIN", [
                 "Par Exceeded",
                 "Course Resetting..."
             ]);
        }
        
        this.ctx.restore();
    }

    drawOverlay(title, lines, transparent = false) {
        this.ctx.save();
        
        const lineHeight = 40;
        const numLines = lines.length;
        const bannerHeight = numLines > 2 ? 200 + (numLines - 2) * lineHeight : 200;
        
        if (!transparent) {
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            this.ctx.fillRect(0, 0, 1280, 720);
        } else {
            // Just a banner
            this.ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            this.ctx.fillRect(0, 720/2 - bannerHeight/2, 1280, bannerHeight);
        }
        
        this.ctx.shadowColor = '#4facfe';
        this.ctx.shadowBlur = 20;
        this.ctx.fillStyle = 'white';
        this.ctx.textAlign = 'center';
        
        const yOffset = numLines > 2 ? -((numLines - 2) * lineHeight) / 2 : 0;
        
        this.ctx.font = 'bold 60px Arial';
        this.ctx.fillText(title, 1280/2, 720/2 - 40 + yOffset);
        
        this.ctx.shadowBlur = 0;
        this.ctx.font = '30px Arial';
        lines.forEach((line, i) => {
            this.ctx.fillText(line, 1280/2, 720/2 + 20 + (i * 40) + yOffset);
        });
        
        this.ctx.restore();
    }

    createBrickPattern() {
        const canvas = document.createElement('canvas');
        canvas.width = 40;
        canvas.height = 20;
        const ctx = canvas.getContext('2d');
        // Brick Color
        ctx.fillStyle = '#A52A2A'; // Brown/Red
        ctx.fillRect(0, 0, 40, 20);
        // Mortar
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 20);
        ctx.lineTo(40, 20);
        ctx.moveTo(20, 0);
        ctx.lineTo(20, 20);
        ctx.stroke();
        return this.ctx.createPattern(canvas, 'repeat');
    }

    createWaterPattern() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // Base Water Color
        ctx.fillStyle = '#4FA4F4'; 
        ctx.fillRect(0, 0, 64, 64);
        
        // Wave Lines (Subtle and broken)
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)'; // Very subtle
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        
        // Draw a few random, small wavelets
        for(let i=0; i<4; i++) {
            const x = Math.random() * 50;
            const y = Math.random() * 50;
            const w = 10 + Math.random() * 10; 
            
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.quadraticCurveTo(x + w/2, y - 3, x + w, y);
            ctx.stroke();
        }
        
        return this.ctx.createPattern(canvas, 'repeat');
    }

    createSandPattern() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // Base Sand Color
        ctx.fillStyle = '#F0E68C'; // Khaki
        ctx.fillRect(0, 0, 64, 64);
        
        // Grains
        ctx.fillStyle = 'rgba(184, 134, 11, 0.3)'; // Dark Goldenrod, transparent
        for(let i=0; i<100; i++) {
            const x = Math.random() * 64;
            const y = Math.random() * 64;
            const s = Math.random() * 2;
            ctx.fillRect(x, y, s, s);
        }
        
        return this.ctx.createPattern(canvas, 'repeat');
    }

    createIcePattern() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // Base Ice Color
        ctx.fillStyle = '#E0FFFF'; // Light Cyan
        ctx.fillRect(0, 0, 64, 64);
        
        // Glint lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(10, 10);
        ctx.lineTo(30, 30);
        ctx.moveTo(40, 10);
        ctx.lineTo(20, 50);
        ctx.stroke();
        
        return this.ctx.createPattern(canvas, 'repeat');
    }

    createBoostPattern() {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        // Base Boost Color
        ctx.fillStyle = '#FFA500'; // Orange
        ctx.fillRect(0, 0, 32, 32);
        
        // Arrows (Pointing RIGHT by default for 0 degrees)
        ctx.fillStyle = 'rgba(255, 255, 0, 0.5)'; // Yellow
        ctx.beginPath();
        ctx.moveTo(27, 16); // Tip
        ctx.lineTo(17, 6);  // Top Wing
        ctx.lineTo(17, 11); // Shaft Top Start
        ctx.lineTo(5, 11);  // Shaft End Top
        ctx.lineTo(5, 21);  // Shaft End Bottom
        ctx.lineTo(17, 21); // Shaft Bottom Start
        ctx.lineTo(17, 26); // Bottom Wing
        ctx.closePath();
        ctx.fill();
        
        return this.ctx.createPattern(canvas, 'repeat');
    }

    createBridgePattern() {
        const canvas = document.createElement('canvas');
        canvas.width = 64;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        // Wood Color
        ctx.fillStyle = '#DEB887'; // Burlywood
        ctx.fillRect(0, 0, 64, 64);
        
        // Planks
        ctx.strokeStyle = '#8B4513'; // SaddleBrown
        ctx.lineWidth = 2;
        ctx.beginPath();
        // Horizontal lines for planks
        for(let y=0; y<=64; y+=16) {
            ctx.moveTo(0, y);
            ctx.lineTo(64, y);
        }
        // Vertical lines (staggered)
        for(let y=0; y<64; y+=16) {
            let offset = (y/16) % 2 === 0 ? 0 : 32;
            for(let x=offset; x<=64; x+=64) {
                ctx.moveTo(x, y);
                ctx.lineTo(x, y+16);
            }
        }
        ctx.stroke();
        
        return this.ctx.createPattern(canvas, 'repeat');
    }

    createBushPattern() {
        const canvas = document.createElement('canvas');
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        // Base Dark Green
        ctx.fillStyle = '#006400'; 
        ctx.fillRect(0, 0, 32, 32);
        
        // Leafy Texture (Lighter Green splotches)
        ctx.fillStyle = 'rgba(34, 139, 34, 0.4)'; // Forest Green
        for(let i=0; i<10; i++) {
            const x = Math.random() * 32;
            const y = Math.random() * 32;
            const s = 4 + Math.random() * 6;
            ctx.beginPath();
            ctx.arc(x, y, s, 0, Math.PI * 2);
            ctx.fill();
        }
        
        // Darker shadows
        ctx.fillStyle = 'rgba(0, 50, 0, 0.3)';
        for(let i=0; i<5; i++) {
            const x = Math.random() * 32;
            const y = Math.random() * 32;
            const s = 3 + Math.random() * 5;
            ctx.beginPath();
            ctx.arc(x, y, s, 0, Math.PI * 2);
            ctx.fill();
        }
        
        return this.ctx.createPattern(canvas, 'repeat');
    }

    createBallPattern() {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const ctx = canvas.getContext('2d');
        
        // Transparent background
        ctx.clearRect(0, 0, 8, 8);
        
        // Dimple (Small gray dot)
        ctx.fillStyle = 'rgba(0, 0, 0, 0.15)'; 
        ctx.beginPath();
        ctx.arc(4, 4, 1.5, 0, Math.PI * 2);
        ctx.fill();
        
        return this.ctx.createPattern(canvas, 'repeat');
    }

    loop(timestamp) {
        const dt = (timestamp - this.lastTime) / 1000;
        this.lastTime = timestamp;

        this.update(dt);
        this.particles.update();
        this.draw();
        this.particles.draw();

        requestAnimationFrame((t) => this.loop(t));
    }
}
