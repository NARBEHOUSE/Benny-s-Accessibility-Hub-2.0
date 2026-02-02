class PhysicsEngine {
    constructor() {
        this.friction = 0.98;
        this.wallBounciness = 0.8;
        this.worldWidth = 1200;
        this.worldHeight = 800;
    }

    setWorldSize(width, height) {
        this.worldWidth = width;
        this.worldHeight = height;
    }

    update(balls, walls, waters, sands, ice, boosts, bridges, trees, dt, isPrediction = false) {
        // Handle single ball or array
        const ballArray = Array.isArray(balls) ? balls : [balls];
        const results = [];

        // 1. Move and Wall/Hazard Collisions for each ball
        ballArray.forEach(ball => {
            let result = { inWater: false, ball: ball };
            
            // Check if on Bridge
            let onBridge = false;
            if (bridges) {
                bridges.forEach(b => {
                    // Transform ball point to bridge local space
                    const cx = b.x + b.width/2;
                    const cy = b.y + b.height/2;
                    const rad = -Utils.degToRad(b.angle || 0);
                    const cos = Math.cos(rad);
                    const sin = Math.sin(rad);
                    
                    const dx = ball.x - cx;
                    const dy = ball.y - cy;
                    
                    const localX = dx * cos - dy * sin;
                    const localY = dx * sin + dy * cos;
                    
                    // Check bounds (localX/Y are relative to center)
                    if (Math.abs(localX) < b.width/2 && Math.abs(localY) < b.height/2) {
                        onBridge = true;
                    }
                });
            }

            // Check Hazards for Friction/Boost BEFORE movement (or during)
            // We need to check position to know if we are in Ice/Boost
            
            let inIce = false;
            if (ice && !onBridge) {
                ice.forEach(i => {
                    if (i.points) {
                        if (Utils.pointInPolygon(ball.x, ball.y, i.points)) inIce = true;
                    }
                });
            }

            // Apply friction (time-step corrected)
            let currentFriction = this.friction;
            if (inIce) {
                currentFriction = 0.998; // Very low friction (Ice)
                
                // Ice Random Skate Logic (On Enter)
                if (!ball.wasInIce && !isPrediction) {
                    // Randomize direction in 50 degree cone (+/- 25 degrees)
                    const angle = (Math.random() * 50 - 25) * (Math.PI / 180);
                    const cos = Math.cos(angle);
                    const sin = Math.sin(angle);
                    const newVx = ball.vx * cos - ball.vy * sin;
                    const newVy = ball.vx * sin + ball.vy * cos;
                    ball.vx = newVx;
                    ball.vy = newVy;
                }
            }
            ball.wasInIce = inIce;
            
            const frictionFactor = Math.pow(currentFriction, dt);
            ball.vx *= frictionFactor;
            ball.vy *= frictionFactor;

            // Stop if slow
            if (Math.abs(ball.vx) < 0.05 && Math.abs(ball.vy) < 0.05) {
                ball.vx = 0;
                ball.vy = 0;
            }

            // Move ball
            let nextX = ball.x + ball.vx * dt;
            let nextY = ball.y + ball.vy * dt;

            // Wall Collisions
            if (nextX - ball.radius < 0 || nextX + ball.radius > this.worldWidth) {
                ball.vx *= -this.wallBounciness;
                nextX = Utils.clamp(nextX, ball.radius, this.worldWidth - ball.radius);
            }
            if (nextY - ball.radius < 0 || nextY + ball.radius > this.worldHeight) {
                ball.vy *= -this.wallBounciness;
                nextY = Utils.clamp(nextY, ball.radius, this.worldHeight - ball.radius);
            }

            walls.forEach(wall => {
                if (wall.angle && wall.angle !== 0) {
                    const res = this.resolveRotatedWall(nextX, nextY, ball.vx, ball.vy, ball.radius, wall);
                    nextX = res.x;
                    nextY = res.y;
                    ball.vx = res.vx;
                    ball.vy = res.vy;
                } else {
                    const res = this.resolveAABBWall(nextX, nextY, ball.vx, ball.vy, ball.radius, wall);
                    nextX = res.x;
                    nextY = res.y;
                    ball.vx = res.vx;
                    ball.vy = res.vy;
                }
            });

            // Tree (Bush) Collisions
            // Logic: 
            // 1. If entering bush (and not UNLOCKED), stop and set STUCK.
            // 2. If inside bush and UNLOCKED, apply friction.
            // 3. If inside bush and stops, set STUCK.
            
            let insideBush = false;
            if (trees) {
                const ballX = ball.x;
                const ballY = ball.y;
                for (let i = 0; i < trees.length; i++) {
                    const tree = trees[i];
                    const dx = ballX - tree.x;
                    const dy = ballY - tree.y;
                    // Optimization: Check squared distance to avoid sqrt
                    if (dx * dx + dy * dy < tree.radius * tree.radius) {
                        insideBush = true;
                        break; // Stop checking if we are already inside a bush
                    }
                }
            }

            if (insideBush) {
                if (ball.bushState === 'NONE' || ball.bushState === undefined) {
                    // Just entered
                    ball.vx = 0;
                    ball.vy = 0;
                    ball.bushState = 'STUCK';
                } else if (ball.bushState === 'UNLOCKED') {
                    // Moving through bush
                    const bushFriction = 0.9; // Heavy drag
                    const f = Math.pow(bushFriction, dt);
                    ball.vx *= f;
                    ball.vy *= f;
                }
                // If STUCK, velocity is already 0
            } else {
                // Exited bush
                ball.bushState = 'NONE';
            }

            // Check for stop inside bush
            if (insideBush && Math.abs(ball.vx) < 0.05 && Math.abs(ball.vy) < 0.05) {
                // If it was moving and stopped inside, it gets stuck again
                // But we need to know if it was moving.
                // The main loop sets vx=0 if slow.
                // If we are here, vx is effectively 0.
                // If bushState is UNLOCKED, it means we just took a shot (or were moving).
                // If we stopped, we are now STUCK.
                if (ball.bushState === 'UNLOCKED') {
                     // Wait, if we just unlocked it (stroke 1), velocity is 0.
                     // We need to distinguish "Just Unlocked" from "Moved and Stopped".
                     // But shoot() sets UNLOCKED and velocity 0.
                     // Physics runs. Velocity 0. Sets STUCK.
                     // This is the problem.
                     
                     // We can check if velocity WAS high? No, we don't have history here.
                     // Maybe we only set STUCK if we were moving fast enough previously?
                     // Or we rely on the fact that shoot() sets velocity > 0 for the second shot.
                     // But for the first shot (unlock), velocity is 0.
                     
                     // Actually, if shoot() sets UNLOCKED, we want it to STAY UNLOCKED until the player shoots again.
                     // But physics runs every frame.
                     
                     // If velocity is 0, and UNLOCKED, it means we are waiting for the second shot.
                     // So we should NOT set STUCK here.
                     
                     // But what if we took the second shot, moved a bit, and stopped inside?
                     // Then we should be STUCK.
                     
                     // How to distinguish?
                     // 1. Unlock Shot: UNLOCKED, V=0.
                     // 2. Move Shot: UNLOCKED, V>0.
                     // 3. Stop: UNLOCKED, V=0 -> Should be STUCK.
                     
                     // We can't distinguish V=0 (Case 1) from V=0 (Case 3) without extra state.
                     // Let's assume if you are UNLOCKED and V=0, you are just waiting.
                     // If you shoot and stop inside, you are still UNLOCKED?
                     // If so, you can just shoot again without unlocking.
                     // That violates "2 strokes to get out" if you fail the second stroke.
                     // If you fail the second stroke (stop inside), you should be STUCK.
                     
                     // Maybe we check if we moved?
                     // Or we add a 'hasMoved' flag to ball?
                     // Or we change logic:
                     // STUCK -> (Shoot 1) -> UNLOCKED_WAITING
                     // UNLOCKED_WAITING -> (Shoot 2) -> UNLOCKED_MOVING
                     // UNLOCKED_MOVING -> (Stop) -> STUCK
                     
                     // Let's use bushState values: 'STUCK', 'UNLOCKED', 'MOVING_IN_BUSH'
                     // Shoot 1: STUCK -> UNLOCKED. V=0.
                     // Shoot 2: UNLOCKED -> V>0.
                     // Physics:
                     // If UNLOCKED and V>0 -> MOVING_IN_BUSH.
                     // If MOVING_IN_BUSH and V=0 -> STUCK.
                     
                     // Let's try this.
                }
                
                if (ball.bushState === 'MOVING_IN_BUSH') {
                    ball.bushState = 'STUCK';
                }
            }
            
            // Transition UNLOCKED -> MOVING_IN_BUSH
            if (insideBush && ball.bushState === 'UNLOCKED' && (Math.abs(ball.vx) > 0.1 || Math.abs(ball.vy) > 0.1)) {
                ball.bushState = 'MOVING_IN_BUSH';
            }
            
            // Apply friction for MOVING_IN_BUSH too
            if (insideBush && ball.bushState === 'MOVING_IN_BUSH') {
                const bushFriction = 0.9;
                const f = Math.pow(bushFriction, dt);
                ball.vx *= f;
                ball.vy *= f;
            }

            // Check Hazards
            if (!onBridge) {
                waters.forEach(water => {
                    if (water.points) {
                        if (Utils.pointInPolygon(nextX, nextY, water.points)) {
                            result.inWater = true;
                        }
                    } else if (water.radius) {
                        if (Utils.distance(nextX, nextY, water.x, water.y) < water.radius + ball.radius) {
                            result.inWater = true;
                        }
                    } else {
                        if (Utils.circleRectCollision(nextX, nextY, ball.radius, water.x, water.y, water.width, water.height)) {
                            result.inWater = true;
                        }
                    }
                });

                // Sand Logic
                let inSand = false;
                if (sands) {
                    sands.forEach(sand => {
                        if (sand.points) {
                            if (Utils.pointInPolygon(nextX, nextY, sand.points)) inSand = true;
                        } else if (sand.radius) {
                            if (Utils.distance(nextX, nextY, sand.x, sand.y) < sand.radius + ball.radius) inSand = true;
                        } else {
                            if (Utils.circleRectCollision(nextX, nextY, ball.radius, sand.x, sand.y, sand.width, sand.height)) inSand = true;
                        }
                    });
                }

                if (inSand) {
                    if (!ball.wasInSand) {
                        // Enter Sand: Drop velocity by 50%
                        ball.vx *= 0.5;
                        ball.vy *= 0.5;
                    }
                    // Continuous drag in sand (optional, but realistic)
                    ball.vx *= 0.98; 
                    ball.vy *= 0.98;
                } else {
                    if (ball.wasInSand && !isPrediction) {
                        // Exit Sand: Randomize direction by 10 degrees
                        const angle = (Math.random() * 20 - 10) * (Math.PI / 180); // -10 to 10 degrees
                        const cos = Math.cos(angle);
                        const sin = Math.sin(angle);
                        const newVx = ball.vx * cos - ball.vy * sin;
                        const newVy = ball.vx * sin + ball.vy * cos;
                        ball.vx = newVx;
                        ball.vy = newVy;
                    }
                }
                ball.wasInSand = inSand;
            } else {
                // If on bridge, ensure we don't trigger "exit sand" logic if we were just in sand
                // Actually, if we go from sand -> bridge, we technically exited sand.
                // But if the bridge is OVER the sand, we shouldn't have been in sand in the first place?
                // If we are on bridge, we are NOT in sand.
                ball.wasInSand = false; 
            }

            // Boost Logic
            let inAnyBoost = false;
            let activeBoost = null;

            if (boosts && !isPrediction) {
                for (const boost of boosts) {
                    if (boost.points && Utils.pointInPolygon(nextX, nextY, boost.points)) {
                        inAnyBoost = true;
                        activeBoost = boost;
                        break; 
                    }
                }
            }

            if (inAnyBoost) {
                ball.boostTimer = (ball.boostTimer || 0) + dt;
                // Trigger every 0.2 seconds
                if (ball.boostTimer >= 0.2) {
                    ball.boostTimer = 0;
                    
                    // Increase velocity by 10%
                    const currentSpeed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
                    const boostAmount = currentSpeed * 0.10;

                    if (activeBoost.boostAngle !== undefined) {
                        // Directional Boost
                        const angleRad = activeBoost.boostAngle * Math.PI / 180;
                        ball.vx += Math.cos(angleRad) * boostAmount;
                        ball.vy += Math.sin(angleRad) * boostAmount;
                    } else {
                        // Omni-directional Boost
                        ball.vx *= 1.10;
                        ball.vy *= 1.10;
                    }
                }
            } else {
                ball.boostTimer = 0;
            }

            ball.x = nextX;
            ball.y = nextY;
            results.push(result);
        });

        // 2. Ball-vs-Ball Collisions
        for (let i = 0; i < ballArray.length; i++) {
            for (let j = i + 1; j < ballArray.length; j++) {
                this.resolveBallCollision(ballArray[i], ballArray[j]);
            }
        }

        // Return single result or array based on input
        return Array.isArray(balls) ? results : results[0];
    }

    resolveBallCollision(b1, b2) {
        const dx = b2.x - b1.x;
        const dy = b2.y - b1.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = b1.radius + b2.radius;

        if (dist < minDist) {
            // Collision detected
            const angle = Math.atan2(dy, dx);
            const sin = Math.sin(angle);
            const cos = Math.cos(angle);

            // Rotate ball positions
            const pos1 = { x: 0, y: 0 };
            const pos2 = { x: dx * cos + dy * sin, y: dy * cos - dx * sin };

            // Rotate velocities
            const vel1 = { x: b1.vx * cos + b1.vy * sin, y: b1.vy * cos - b1.vx * sin };
            const vel2 = { x: b2.vx * cos + b2.vy * sin, y: b2.vy * cos - b2.vx * sin };

            // Check relative velocity for sound
            // Only play sound if they are approaching each other with some speed
            const relativeVelocity = vel1.x - vel2.x;
            if (relativeVelocity > 0.5) {
                 if (typeof AudioSys !== 'undefined') {
                    AudioSys.playSound('click');
                }
            }

            // Collision reaction (1D elastic)
            const vx1Final = vel2.x;
            const vx2Final = vel1.x;

            vel1.x = vx1Final;
            vel2.x = vx2Final;

            // Update velocities
            const bounciness = 0.9;
            b1.vx = (vel1.x * cos - vel1.y * sin) * bounciness;
            b1.vy = (vel1.y * cos + vel1.x * sin) * bounciness;
            b2.vx = (vel2.x * cos - vel2.y * sin) * bounciness;
            b2.vy = (vel2.y * cos + vel2.x * sin) * bounciness;

            // Separate balls to prevent sticking
            const overlap = minDist - dist;
            const separationX = (overlap / 2) * Math.cos(angle);
            const separationY = (overlap / 2) * Math.sin(angle);

            b1.x -= separationX;
            b1.y -= separationY;
            b2.x += separationX;
            b2.y += separationY;
        }
    }

    resolveAABBWall(cx, cy, vx, vy, radius, wall) {
        // Find closest point on rect to circle center
        const closestX = Utils.clamp(cx, wall.x, wall.x + wall.width);
        const closestY = Utils.clamp(cy, wall.y, wall.y + wall.height);

        const dx = cx - closestX;
        const dy = cy - closestY;
        const dist = Math.hypot(dx, dy);

        if (dist < radius) {
            // Collision
            // Normal
            let nx = dx / dist;
            let ny = dy / dist;
            
            if (dist === 0) { // Center is inside
                nx = 1; ny = 0; 
            }

            // Push out
            const penetration = radius - dist;
            cx += nx * penetration;
            cy += ny * penetration;

            // Reflect velocity
            const dot = vx * nx + vy * ny;
            vx = (vx - 2 * dot * nx) * this.wallBounciness;
            vy = (vy - 2 * dot * ny) * this.wallBounciness;
        }
        return { x: cx, y: cy, vx, vy };
    }

    resolveRotatedWall(cx, cy, vx, vy, radius, wall) {
        // Transform circle to wall's local space
        const angleRad = Utils.degToRad(wall.angle);
        const cos = Math.cos(-angleRad);
        const sin = Math.sin(-angleRad);
        
        const centerX = wall.x + wall.width / 2;
        const centerY = wall.y + wall.height / 2;

        const dx = cx - centerX;
        const dy = cy - centerY;

        const localX = cos * dx - sin * dy;
        const localY = sin * dx + cos * dy;

        // Wall in local space is centered at 0,0 with width/height
        const halfW = wall.width / 2;
        const halfH = wall.height / 2;

        const closestX = Utils.clamp(localX, -halfW, halfW);
        const closestY = Utils.clamp(localY, -halfH, halfH);

        const ldx = localX - closestX;
        const ldy = localY - closestY;
        const dist = Math.hypot(ldx, ldy);

        if (dist < radius) {
            let nx = ldx / dist;
            let ny = ldy / dist;
            if (dist === 0) { nx = 1; ny = 0; }

            const penetration = radius - dist;
            const newLocalX = localX + nx * penetration;
            const newLocalY = localY + ny * penetration;

            // Transform back
            const cosR = Math.cos(angleRad);
            const sinR = Math.sin(angleRad);

            const finalX = cosR * newLocalX - sinR * newLocalY + centerX;
            const finalY = sinR * newLocalX + cosR * newLocalY + centerY;

            // Reflect velocity (rotate velocity to local, reflect, rotate back)
            const localVx = cos * vx - sin * vy;
            const localVy = sin * vx + cos * vy;

            const dot = localVx * nx + localVy * ny;
            const newLocalVx = (localVx - 2 * dot * nx) * this.wallBounciness;
            const newLocalVy = (localVy - 2 * dot * ny) * this.wallBounciness;

            const finalVx = cosR * newLocalVx - sinR * newLocalVy;
            const finalVy = sinR * newLocalVx + cosR * newLocalVy;

            return { x: finalX, y: finalY, vx: finalVx, vy: finalVy };
        }

        return { x: cx, y: cy, vx, vy };
    }
}
