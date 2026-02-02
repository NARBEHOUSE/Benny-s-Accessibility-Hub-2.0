class Editor {
    constructor() {
        this.canvas = document.getElementById('editorCanvas');
        this.ctx = this.canvas.getContext('2d');
        
        // Design resolution (same as game)
        this.width = 1280;
        this.height = 720;
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        
        // Scale canvas to fit container
        this.resize();
        window.addEventListener('resize', () => this.resize());

        // State
        this.course = {
            name: "My Custom Course",
            holes: [this.createDefaultHole()]
        };
        this.currentHoleIndex = 0;
        this.selectedTool = 'select'; // select, wall, water, sand
        this.selectedObjects = []; // Array of selected objects
        this.clipboard = []; // For copy/paste
        this.currentPoly = null; // { points: [], type: 'water'|'sand' }
        
        // Input State
        this.interactionMode = 'NONE'; // NONE, DRAGGING, ROTATING, BOX_SELECT
        this.dragStart = { x: 0, y: 0 };
        this.dragOffsets = []; // Offsets for all selected objects
        this.mousePos = { x: 0, y: 0 };
        this.boxSelectStart = null; // Start point for box selection
        
        // Brush Settings
        this.brushSize = 50;

        this.brickPattern = this.createBrickPattern();
        this.icePattern = this.createIcePattern();
        this.boostPattern = this.createBoostPattern();
        this.bridgePattern = this.createBridgePattern();

        this.setupUI();
        this.setupInput();
        this.render();
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
        
        // Arrows
        ctx.fillStyle = 'rgba(255, 255, 0, 0.5)'; // Yellow
        ctx.beginPath();
        ctx.moveTo(16, 5);
        ctx.lineTo(26, 15);
        ctx.lineTo(21, 15);
        ctx.lineTo(21, 27);
        ctx.lineTo(11, 27);
        ctx.lineTo(11, 15);
        ctx.lineTo(6, 15);
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

    createDefaultHole() {
        return {
            par: 3,
            start: { x: 100, y: 360, radius: 15 },
            end: { x: 1180, y: 360, radius: 23 },
            walls: [],
            waters: [],
            sands: [],
            ice: [],
            boosts: [],
            bridges: [],
            trees: []
        };
    }

    resize() {
        const container = document.getElementById('canvas-container');
        const aspect = this.width / this.height;
        const contAspect = container.clientWidth / container.clientHeight;
        
        let w, h;
        if (contAspect > aspect) {
            h = container.clientHeight - 40;
            w = h * aspect;
        } else {
            w = container.clientWidth - 40;
            h = w / aspect;
        }
        
        this.canvas.style.width = `${w}px`;
        this.canvas.style.height = `${h}px`;
        this.scale = w / this.width; // Display scale
    }

    setupUI() {
        // Course Name
        document.getElementById('courseName').addEventListener('input', (e) => {
            this.course.name = e.target.value;
        });

        // Hole Navigation
        document.getElementById('prevHole').addEventListener('click', () => this.changeHole(-1));
        document.getElementById('nextHole').addEventListener('click', () => this.changeHole(1));
        document.getElementById('addHole').addEventListener('click', () => this.addHole());
        document.getElementById('duplicateHole').addEventListener('click', () => this.duplicateHole());
        document.getElementById('deleteHole').addEventListener('click', () => this.deleteHole());
        document.getElementById('newCourse').addEventListener('click', () => this.newCourse());
        
        // Par
        document.getElementById('holePar').addEventListener('change', (e) => {
            this.getCurrentHole().par = parseInt(e.target.value);
        });

        // Tools
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.selectedTool = btn.dataset.tool;
                this.selectedObjects = [];
                this.currentPoly = null; // Reset poly if switching tools
                this.updatePropertiesPanel();
                this.render();
            });
        });

        // Properties
        const updateProp = (key, val) => {
            this.selectedObjects.forEach(obj => {
                obj[key] = parseFloat(val);
            });
            this.render();
        };
        
        document.getElementById('propSize').addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            const hole = this.getCurrentHole();
            this.selectedObjects.forEach(obj => {
                if (obj.radius !== undefined) {
                    obj.radius = val;
                    // Link Start and Hole size
                    if (obj === hole.start || obj === hole.end) {
                        hole.start.radius = val;
                        hole.end.radius = val;
                    }
                }
                else if (obj.width !== undefined) obj.width = val;
            });
            this.render();
        });
        document.getElementById('propHeight').addEventListener('input', (e) => updateProp('height', e.target.value));
        document.getElementById('propRotation').addEventListener('input', (e) => {
            updateProp('angle', e.target.value);
            // Update dial
            const arrow = document.querySelector('#angleArrow');
            if(arrow) arrow.style.transform = `rotate(${e.target.value}deg)`;
        });

        // Angle Dial
        const dial = document.getElementById('angleDial');
        let isDraggingDial = false;
        
        dial.addEventListener('mousedown', (e) => {
            isDraggingDial = true;
            updateDial(e);
        });
        
        window.addEventListener('mousemove', (e) => {
            if (isDraggingDial) {
                updateDial(e);
            }
        });
        
        window.addEventListener('mouseup', () => {
            isDraggingDial = false;
        });

        const updateDial = (e) => {
            e.preventDefault();
            const rect = dial.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            
            const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * 180 / Math.PI;
            // Snap to 15 degrees if shift held
            let rotation = angle;
            if (e.shiftKey) {
                rotation = Math.round(rotation / 15) * 15;
            }
            
            document.getElementById('propRotation').value = Math.round(rotation);
            updateProp('angle', rotation);
            document.querySelector('#angleArrow').style.transform = `rotate(${rotation}deg)`;
        };
        document.getElementById('propSmooth').addEventListener('change', (e) => {
            this.selectedObjects.forEach(obj => {
                if (obj.points) obj.smooth = e.target.checked;
            });
            this.render();
        });

        // Save/Load
        document.getElementById('saveCourse').addEventListener('click', () => this.saveCourse());
        document.getElementById('loadCourse').addEventListener('change', (e) => this.loadCourse(e));
    }

    getResizeHandles(obj) {
        // For bridges and walls
        // Returns object with width and height handles
        const halfW = obj.width / 2;
        const halfH = obj.height / 2;
        const cx = obj.x + halfW;
        const cy = obj.y + halfH;
        
        // Rotate offsets based on object angle
        const angle = (obj.angle || 0) * (Math.PI / 180);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        // Width handle (Right side) - Controls Width (Span)
        // Position: Right center (halfW, 0)
        const wx = halfW * cos - 0 * sin;
        const wy = halfW * sin + 0 * cos;

        // Height handle (Bottom side) - Controls Height (Road Width)
        // Position: Bottom center (0, halfH)
        const hx = 0 * cos - halfH * sin;
        const hy = 0 * sin + halfH * cos;

        return {
            width: {
                x: cx + wx,
                y: cy + wy
            },
            height: {
                x: cx + hx,
                y: cy + hy
            }
        };
    }

    setupInput() {
        const getPos = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return {
                x: (e.clientX - rect.left) * (this.width / rect.width),
                y: (e.clientY - rect.top) * (this.height / rect.height)
            };
        };

        this.canvas.addEventListener('mousedown', (e) => {
            const pos = getPos(e);
            this.mousePos = pos;
            
            // Check Resize Handles (Only if single selection and is Bridge or Wall)
            if (this.selectedObjects.length === 1 && this.selectedTool === 'select') {
                const obj = this.selectedObjects[0];
                const hole = this.getCurrentHole();
                const isBridge = hole.bridges && hole.bridges.includes(obj);
                const isWall = hole.walls && hole.walls.includes(obj);
                
                if (isBridge || isWall) {
                    const handles = this.getResizeHandles(obj);
                    if (Utils.distance(pos.x, pos.y, handles.width.x, handles.width.y) < 10) {
                        this.interactionMode = 'RESIZING_WIDTH';
                        this.resizeStart = { ...pos };
                        this.initialSize = obj.width;
                        return;
                    }
                    if (Utils.distance(pos.x, pos.y, handles.height.x, handles.height.y) < 10) {
                        this.interactionMode = 'RESIZING_HEIGHT';
                        this.resizeStart = { ...pos };
                        this.initialSize = obj.height;
                        return;
                    }
                }
            }

            // Check Rotation Handle First (Only if single selection)
            if (this.selectedObjects.length === 1 && this.selectedTool === 'select') {
                const obj = this.selectedObjects[0];
                if (obj.width || obj.points) {
                    const handle = this.getRotationHandlePos(obj);
                    if (Utils.distance(pos.x, pos.y, handle.x, handle.y) < 10) {
                        this.interactionMode = 'ROTATING';
                        // Store initial angle for polygons
                        if (obj.points) {
                            // Calculate centroid
                            let cx = 0, cy = 0;
                            obj.points.forEach(p => { cx += p.x; cy += p.y; });
                            this.rotateCenter = { x: cx / obj.points.length, y: cy / obj.points.length };
                            this.rotateStartAngle = Math.atan2(pos.y - this.rotateCenter.y, pos.x - this.rotateCenter.x);
                            this.initialPoints = obj.points.map(p => ({...p}));
                            this.initialObjAngle = obj.angle || 0;
                        }
                        return;
                    }
                }
            }

            // Check Polygon Points (If selected)
            if (this.selectedTool === 'select') {
                for (const obj of this.selectedObjects) {
                    if (obj.points) {
                        for (let i = 0; i < obj.points.length; i++) {
                            const p = obj.points[i];
                            if (Utils.distance(pos.x, pos.y, p.x, p.y) < 8) {
                                this.interactionMode = 'DRAGGING_POINT';
                                this.dragPoint = { obj, index: i };
                                return;
                            }
                        }
                    }
                }
            }

            if (this.selectedTool === 'select') {
                const clickedObj = this.getObjectAt(pos);
                
                if (clickedObj) {
                    // Clicked on an object
                    if (e.shiftKey) {
                        // Toggle selection
                        const idx = this.selectedObjects.indexOf(clickedObj);
                        if (idx === -1) this.selectedObjects.push(clickedObj);
                        else this.selectedObjects.splice(idx, 1);
                    } else {
                        // If not already selected, select only this
                        if (!this.selectedObjects.includes(clickedObj)) {
                            this.selectedObjects = [clickedObj];
                        }
                        // If already selected, keep selection (for dragging multiple)
                    }
                    
                    this.interactionMode = 'DRAGGING';
                    this.dragStart = pos;
                    // Calculate offsets for all selected objects
                    this.dragOffsets = this.selectedObjects.map(obj => {
                        if (obj.points) {
                            return {
                                obj: obj,
                                initialPoints: obj.points.map(p => ({...p})),
                                startX: pos.x,
                                startY: pos.y
                            };
                        } else {
                            return {
                                obj: obj,
                                dx: pos.x - obj.x,
                                dy: pos.y - obj.y
                            };
                        }
                    });
                } else {
                    // Clicked on empty space
                    if (!e.shiftKey) {
                        this.selectedObjects = [];
                    }
                    this.interactionMode = 'BOX_SELECT';
                    this.boxSelectStart = pos;
                }
            } else if (this.selectedTool === 'wall') {
                // Place Wall
                const hole = this.getCurrentHole();
                const newWall = { x: pos.x - 50, y: pos.y - 10, width: 100, height: 20, angle: 0 };
                hole.walls.push(newWall);
                this.selectedObjects = [newWall];
                
                // Switch to select tool manually to avoid clearing selection
                this.selectedTool = 'select';
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-tool="select"]').classList.add('active');

                this.interactionMode = 'DRAGGING';
                this.dragStart = pos;
                this.dragOffsets = [{ obj: newWall, dx: 50, dy: 10 }];
            } else if (this.selectedTool === 'bridge') {
                // Place Bridge
                const hole = this.getCurrentHole();
                const newBridge = { x: pos.x - 60, y: pos.y - 25, width: 120, height: 50, angle: 0 };
                if (!hole.bridges) hole.bridges = [];
                hole.bridges.push(newBridge);
                this.selectedObjects = [newBridge];
                
                // Switch to select tool manually to avoid clearing selection
                this.selectedTool = 'select';
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-tool="select"]').classList.add('active');

                this.interactionMode = 'DRAGGING';
                this.dragStart = pos;
                this.dragOffsets = [{ obj: newBridge, dx: 60, dy: 25 }];
            } else if (this.selectedTool === 'tree') {
                // Place Tree
                const hole = this.getCurrentHole();
                const newTree = { x: pos.x, y: pos.y, radius: 20 }; // Radius is trunk size
                if (!hole.trees) hole.trees = [];
                hole.trees.push(newTree);
                this.selectedObjects = [newTree];
                
                // Switch to select tool manually to avoid clearing selection
                this.selectedTool = 'select';
                document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
                document.querySelector('[data-tool="select"]').classList.add('active');

                this.interactionMode = 'DRAGGING';
                this.dragStart = pos;
                this.dragOffsets = [{ obj: newTree, dx: 0, dy: 0 }];
            } else if (this.selectedTool === 'water-poly' || this.selectedTool === 'sand-poly' || this.selectedTool === 'ice-poly' || this.selectedTool === 'boost-poly') {
                if (!this.currentPoly) {
                    let type = 'water';
                    if (this.selectedTool === 'sand-poly') type = 'sand';
                    else if (this.selectedTool === 'ice-poly') type = 'ice';
                    else if (this.selectedTool === 'boost-poly') type = 'boost';

                    this.currentPoly = {
                        points: [{x: pos.x, y: pos.y}],
                        type: type,
                        smooth: true // Default to smooth
                    };
                } else {
                    // Add point
                    // Check if closing (near start)
                    if (Utils.distance(pos.x, pos.y, this.currentPoly.points[0].x, this.currentPoly.points[0].y) < 20 && this.currentPoly.points.length > 2) {
                        this.finishPoly();
                    } else {
                        this.currentPoly.points.push({x: pos.x, y: pos.y});
                    }
                }
            }
            
            this.updatePropertiesPanel();
            this.render();
        });

        this.canvas.addEventListener('mousemove', (e) => {
            const pos = getPos(e);
            this.mousePos = pos;

            if (this.interactionMode === 'NONE') {
                this.render(); // Update brush cursor or poly preview
                return;
            }

            if (this.interactionMode === 'RESIZING_WIDTH' || this.interactionMode === 'RESIZING_HEIGHT') {
                const obj = this.selectedObjects[0];
                const dx = pos.x - this.resizeStart.x;
                const dy = pos.y - this.resizeStart.y;
                
                // Project drag vector onto object's local axes
                const angle = (obj.angle || 0) * Math.PI / 180;
                const cos = Math.cos(angle);
                const sin = Math.sin(angle);
                
                // Local delta
                const localDx = dx * cos + dy * sin;
                const localDy = -dx * sin + dy * cos;

                if (this.interactionMode === 'RESIZING_WIDTH') {
                    // Resize width (Span)
                    // Handle is at Top (0, -halfH).
                    // Dragging it should change Width (Span).
                    // This is weird, but requested.
                    // If I drag it along X (local), it changes Width.
                    const newWidth = Math.max(20, this.initialSize + localDx * 2);
                    obj.width = newWidth;
                } else {
                    // Resize height (Road Width)
                    // Handle is at Right (halfW, 0).
                    // Dragging it should change Height.
                    // If I drag it along Y (local), it changes Height.
                    const newHeight = Math.max(20, this.initialSize + localDy * 2);
                    obj.height = newHeight;
                }
                this.updatePropertiesPanel();
                this.render();
                return;
            }

            if (this.interactionMode === 'ROTATING' && this.selectedObjects.length === 1) {
                const obj = this.selectedObjects[0];
                
                if (obj.points) {
                    // Rotate Polygon Points
                    const currentAngle = Math.atan2(pos.y - this.rotateCenter.y, pos.x - this.rotateCenter.x);
                    let diff = currentAngle - this.rotateStartAngle;
                    
                    if (e.shiftKey) {
                        // Snap to 15 degrees
                        const deg = diff * (180 / Math.PI);
                        const snapped = Math.round(deg / 15) * 15;
                        diff = snapped * (Math.PI / 180);
                    }

                    const cos = Math.cos(diff);
                    const sin = Math.sin(diff);
                    const cx = this.rotateCenter.x;
                    const cy = this.rotateCenter.y;

                    obj.points.forEach((p, i) => {
                        const ox = this.initialPoints[i].x - cx;
                        const oy = this.initialPoints[i].y - cy;
                        p.x = cx + (ox * cos - oy * sin);
                        p.y = cy + (ox * sin + oy * cos);
                    });
                    
                    // Update angle for texture
                    if (this.initialObjAngle !== undefined) {
                        obj.angle = this.initialObjAngle + (diff * 180 / Math.PI);
                    }
                } else {
                    const cx = obj.x + obj.width/2;
                    const cy = obj.y + obj.height/2;
                    const angle = Math.atan2(pos.y - cy, pos.x - cx);
                    let deg = angle * (180 / Math.PI);
                    if (e.shiftKey) {
                        deg = Math.round(deg / 15) * 15;
                    }
                    obj.angle = deg;
                }
                this.updatePropertiesPanel();
                this.render();
            } else if (this.interactionMode === 'DRAGGING_POINT') {
                if (this.dragPoint) {
                    this.dragPoint.obj.points[this.dragPoint.index].x = pos.x;
                    this.dragPoint.obj.points[this.dragPoint.index].y = pos.y;
                    this.render();
                }
            } else if (this.interactionMode === 'DRAGGING') {
                if (this.selectedTool === 'select') {
                    this.dragOffsets.forEach(item => {
                        if (item.obj.points) {
                            const dx = pos.x - item.startX;
                            const dy = pos.y - item.startY;
                            item.obj.points.forEach((p, i) => {
                                p.x = item.initialPoints[i].x + dx;
                                p.y = item.initialPoints[i].y + dy;
                            });
                        } else {
                            item.obj.x = pos.x - item.dx;
                            item.obj.y = pos.y - item.dy;
                        }
                    });
                    this.render();
                }
            } else if (this.interactionMode === 'BOX_SELECT') {
                this.render(); // Render will draw the box
            }
        });

        this.canvas.addEventListener('mouseup', () => {
            if (this.interactionMode === 'BOX_SELECT') {
                this.selectObjectsInBox(this.boxSelectStart, this.mousePos);
            }
            this.interactionMode = 'NONE';
            this.render();
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const delta = Math.sign(e.deltaY) * -1; // Up is positive
            
            if (this.selectedObjects.length > 0) {
                this.selectedObjects.forEach(obj => {
                    if (e.shiftKey) {
                        // Rotate
                        if (obj.points) {
                            // Rotate Polygon Points
                            const rad = (delta * 5) * (Math.PI / 180);
                            const cos = Math.cos(rad);
                            const sin = Math.sin(rad);
                            
                            // Calculate Center
                            let cx = 0, cy = 0;
                            obj.points.forEach(p => { cx += p.x; cy += p.y; });
                            cx /= obj.points.length;
                            cy /= obj.points.length;
                            
                            obj.points.forEach(p => {
                                const ox = p.x - cx;
                                const oy = p.y - cy;
                                p.x = cx + (ox * cos - oy * sin);
                                p.y = cy + (ox * sin + oy * cos);
                            });
                            
                            obj.angle = (obj.angle || 0) + (delta * 5);
                        } else if (obj.angle !== undefined) {
                            obj.angle = (obj.angle || 0) + delta * 5;
                        }
                    } else {
                        // Resize
                        if (obj.points) {
                            // Scale Polygon
                            const scale = delta > 0 ? 1.05 : 0.95;
                            // Calculate Center
                            let cx = 0, cy = 0;
                            obj.points.forEach(p => { cx += p.x; cy += p.y; });
                            cx /= obj.points.length;
                            cy /= obj.points.length;
                            
                            // Apply Scale
                            obj.points.forEach(p => {
                                p.x = cx + (p.x - cx) * scale;
                                p.y = cy + (p.y - cy) * scale;
                            });
                        } else if (obj.radius !== undefined) {
                            obj.radius = Math.max(5, obj.radius + delta);
                            
                            // Link Start and Hole size
                            const hole = this.getCurrentHole();
                            if (obj === hole.start || obj === hole.end) {
                                hole.start.radius = obj.radius;
                                hole.end.radius = obj.radius;
                            }
                        } else if (obj.width !== undefined) {
                            if (obj.height !== undefined) {
                                const ratio = obj.height / obj.width;
                                obj.width = Math.max(10, obj.width + delta * 5);
                                obj.height = obj.width * ratio;
                            } else {
                                obj.width = Math.max(10, obj.width + delta * 5);
                            }
                        }
                    }
                });
                this.updatePropertiesPanel();
                this.render();
            } else if (this.selectedTool === 'water-poly' || this.selectedTool === 'sand-poly' || this.selectedTool === 'ice-poly' || this.selectedTool === 'boost-poly') {
                // Change brush size
                this.brushSize = Math.max(10, this.brushSize + delta * 5);
                this.render(); // To show brush cursor
            }
        });
        
        // Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                if (this.currentPoly && this.currentPoly.points.length > 2) {
                    this.finishPoly();
                }
            }
            if (e.key === 'Delete' || e.key === 'Backspace') {
                if (this.selectedObjects.length > 0 && this.selectedTool === 'select') {
                    this.deleteSelection();
                }
            }
            // Copy/Paste
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 'c') {
                    this.copySelection();
                } else if (e.key === 'v') {
                    this.pasteSelection();
                } else if (e.key === 'd') {
                    e.preventDefault(); // Prevent bookmark
                    this.duplicateSelection();
                }
            }
        });

        // Right Click Context Menu (Duplicate)
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const pos = getPos(e);
            const clickedObj = this.getObjectAt(pos);
            
            if (clickedObj) {
                // If clicked object is not in selection, select it
                if (!this.selectedObjects.includes(clickedObj)) {
                    this.selectedObjects = [clickedObj];
                    this.updatePropertiesPanel();
                    this.render();
                }
                
                // Duplicate
                this.duplicateSelection();
            }
        });
    }

    getRotationHandlePos(obj) {
        if (obj.points) {
            // For polygons, place handle above the centroid
            let cx = 0, cy = 0;
            let minY = Infinity;
            obj.points.forEach(p => { 
                cx += p.x; 
                cy += p.y; 
                if (p.y < minY) minY = p.y;
            });
            cx /= obj.points.length;
            cy /= obj.points.length;
            
            // Place handle 30px above the highest point, or just above center
            // Let's use center - 50px for consistency, rotated if we tracked angle (but we don't track poly angle separately, we just rotate points)
            // Since we modify points directly, the "angle" is implicit. 
            // So we just place a handle above the centroid.
            return { x: cx, y: cy - 50 };
        }

        const cx = obj.x + obj.width/2;
        const cy = obj.y + obj.height/2;
        const w = obj.width;
        const h = obj.height;
        
        // Local TR corner relative to center
        const lx = w/2;
        const ly = -h/2;
        
        const rad = (obj.angle || 0) * (Math.PI / 180);
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        
        return {
            x: cx + (lx * cos - ly * sin),
            y: cy + (lx * sin + ly * cos)
        };
    }

    finishPoly() {
        if (!this.currentPoly) return;
        
        const hole = this.getCurrentHole();
        let list;
        if (this.currentPoly.type === 'water') list = hole.waters;
        else if (this.currentPoly.type === 'sand') list = hole.sands;
        else if (this.currentPoly.type === 'ice') {
            if (!hole.ice) hole.ice = [];
            list = hole.ice;
        }
        else if (this.currentPoly.type === 'boost') {
            if (!hole.boosts) hole.boosts = [];
            list = hole.boosts;
        }
        
        // Close loop if needed (not strictly necessary for fill, but good for logic)
        // Actually, we just store points.
        
        list.push({
            points: this.currentPoly.points,
            smooth: this.currentPoly.smooth,
            angle: 0 // Initialize angle for texture rotation
        });
        
        this.currentPoly = null;
        this.render();
    }

    getCurrentHole() {
        return this.course.holes[this.currentHoleIndex];
    }

    newCourse() {
        if (confirm("Are you sure you want to create a new course? Any unsaved changes will be lost.")) {
            this.course = {
                name: "My Custom Course",
                holes: [this.createDefaultHole()]
            };
            this.currentHoleIndex = 0;
            this.selectedObjects = [];
            document.getElementById('courseName').value = this.course.name;
            this.updateUI();
            this.render();
        }
    }

    changeHole(dir) {
        const newIndex = this.currentHoleIndex + dir;
        if (newIndex >= 0 && newIndex < this.course.holes.length) {
            this.currentHoleIndex = newIndex;
            this.selectedObjects = [];
            this.updateUI();
            this.render();
        }
    }

    addHole() {
        this.course.holes.push(this.createDefaultHole());
        this.changeHole(1);
    }

    duplicateHole() {
        const currentHole = this.getCurrentHole();
        // Deep clone the hole
        const newHole = JSON.parse(JSON.stringify(currentHole));
        
        // Insert after current hole
        this.course.holes.splice(this.currentHoleIndex + 1, 0, newHole);
        
        // Switch to new hole
        this.changeHole(1);
    }

    deleteHole() {
        if (this.course.holes.length > 1) {
            this.course.holes.splice(this.currentHoleIndex, 1);
            if (this.currentHoleIndex >= this.course.holes.length) {
                this.currentHoleIndex = this.course.holes.length - 1;
            }
            this.selectedObjects = [];
            this.updateUI();
            this.render();
        }
    }

    getObjectAt(pos) {
        const hole = this.getCurrentHole();
        
        // Check Start/End first (circles)
        if (Utils.distance(pos.x, pos.y, hole.start.x, hole.start.y) < hole.start.radius) {
            return hole.start;
        }
        if (Utils.distance(pos.x, pos.y, hole.end.x, hole.end.y) < hole.end.radius) {
            return hole.end;
        }

        // Check Walls (Rotated Rects)
        const checkRect = (obj) => {
            let localX = pos.x;
            let localY = pos.y;
            
            if (obj.angle) {
                const cx = obj.x + obj.width/2;
                const cy = obj.y + obj.height/2;
                const rad = -obj.angle * (Math.PI / 180); // Inverse rotate
                const dx = pos.x - cx;
                const dy = pos.y - cy;
                localX = cx + (dx * Math.cos(rad) - dy * Math.sin(rad));
                localY = cy + (dx * Math.sin(rad) + dy * Math.cos(rad));
            }
            
            return localX >= obj.x && localX <= obj.x + obj.width &&
                   localY >= obj.y && localY <= obj.y + obj.height;
        };

        for (let i = hole.walls.length - 1; i >= 0; i--) {
            if (checkRect(hole.walls[i])) {
                return hole.walls[i];
            }
        }

        // Check Bridges
        if (hole.bridges) {
            for (let i = hole.bridges.length - 1; i >= 0; i--) {
                if (checkRect(hole.bridges[i])) {
                    return hole.bridges[i];
                }
            }
        }
        
        // Check Hazards (Circles or Rects or Polys)
        const checkHazard = (obj) => {
            if (obj.points) {
                return Utils.pointInPolygon(pos.x, pos.y, obj.points);
            } else if (obj.radius) {
                return Utils.distance(pos.x, pos.y, obj.x, obj.y) < obj.radius;
            } else {
                return checkRect(obj);
            }
        };

        const hazards = [...hole.waters, ...hole.sands, ...(hole.ice || []), ...(hole.boosts || []), ...(hole.trees || [])];
        for (let i = hazards.length - 1; i >= 0; i--) {
            if (checkHazard(hazards[i])) {
                return hazards[i];
            }
        }

        return null;
    }

    selectObjectsInBox(start, end) {
        const x = Math.min(start.x, end.x);
        const y = Math.min(start.y, end.y);
        const w = Math.abs(end.x - start.x);
        const h = Math.abs(end.y - start.y);
        
        const hole = this.getCurrentHole();
        const objects = [hole.start, hole.end, ...hole.walls, ...hole.waters, ...hole.sands, ...(hole.ice || []), ...(hole.boosts || []), ...(hole.bridges || []), ...(hole.trees || [])];
        
        this.selectedObjects = objects.filter(obj => {
            // Simple center check for now
            let cx, cy;
            if (obj.points) {
                // Average point
                cx = 0; cy = 0;
                obj.points.forEach(p => { cx += p.x; cy += p.y; });
                cx /= obj.points.length;
                cy /= obj.points.length;
            } else if (obj.radius) {
                cx = obj.x;
                cy = obj.y;
            } else {
                cx = obj.x + obj.width/2;
                cy = obj.y + obj.height/2;
            }
            return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
        });
    }

    deleteSelection() {
        const hole = this.getCurrentHole();
        
        this.selectedObjects.forEach(obj => {
            if (obj === hole.start || obj === hole.end) return; // Can't delete start/end

            const remove = (arr) => {
                if (!arr) return false;
                const idx = arr.indexOf(obj);
                if (idx !== -1) {
                    arr.splice(idx, 1);
                    return true;
                }
                return false;
            };

            if (!remove(hole.walls)) {
                if (!remove(hole.waters)) {
                    if (!remove(hole.sands)) {
                        if (!remove(hole.ice)) {
                            if (!remove(hole.boosts)) {
                                if (!remove(hole.bridges)) {
                                    remove(hole.trees);
                                }
                            }
                        }
                    }
                }
            }
        });
        
        this.selectedObjects = [];
        this.updatePropertiesPanel();
        this.render();
    }

    copySelection() {
        // Deep copy selected objects (excluding start/end)
        const hole = this.getCurrentHole();
        this.clipboard = this.selectedObjects
            .filter(obj => obj !== hole.start && obj !== hole.end)
            .map(obj => {
                let type = 'wall';
                if (hole.waters && hole.waters.includes(obj)) type = 'water';
                else if (hole.sands && hole.sands.includes(obj)) type = 'sand';
                else if (hole.ice && hole.ice.includes(obj)) type = 'ice';
                else if (hole.boosts && hole.boosts.includes(obj)) type = 'boost';
                else if (hole.bridges && hole.bridges.includes(obj)) type = 'bridge';
                else if (hole.trees && hole.trees.includes(obj)) type = 'tree';
                
                return {
                    data: JSON.parse(JSON.stringify(obj)),
                    type: type
                };
            });
    }

    pasteSelection() {
        if (this.clipboard.length === 0) return;
        
        const hole = this.getCurrentHole();
        const newSelection = [];
        
        this.clipboard.forEach(item => {
            const obj = JSON.parse(JSON.stringify(item.data)); // Clone again to allow multiple pastes
            
            // Offset slightly
            if (obj.points) {
                obj.points.forEach(p => { p.x += 20; p.y += 20; });
            } else {
                obj.x += 20;
                obj.y += 20;
            }
            
            if (item.type === 'wall') {
                if (!hole.walls) hole.walls = [];
                hole.walls.push(obj);
            }
            else if (item.type === 'water') {
                if (!hole.waters) hole.waters = [];
                hole.waters.push(obj);
            }
            else if (item.type === 'sand') {
                if (!hole.sands) hole.sands = [];
                hole.sands.push(obj);
            }
            else if (item.type === 'ice') {
                if (!hole.ice) hole.ice = [];
                hole.ice.push(obj);
            }
            else if (item.type === 'boost') {
                if (!hole.boosts) hole.boosts = [];
                hole.boosts.push(obj);
            }
            else if (item.type === 'bridge') {
                if (!hole.bridges) hole.bridges = [];
                hole.bridges.push(obj);
            }
            else if (item.type === 'tree') {
                if (!hole.trees) hole.trees = [];
                hole.trees.push(obj);
            }
            
            newSelection.push(obj);
        });
        
        this.selectedObjects = newSelection;
        this.render();
    }

    duplicateSelection() {
        this.copySelection();
        this.pasteSelection();
    }

    updateUI() {
        document.getElementById('holeLabel').textContent = `Hole ${this.currentHoleIndex + 1}`;
        document.getElementById('holePar').value = this.getCurrentHole().par;
        this.updatePropertiesPanel();
    }

    updatePropertiesPanel() {
        const panel = document.getElementById('propertiesPanel');
        const info = document.getElementById('selectedInfo');
        const pSize = document.getElementById('propSize');
        const pHeight = document.getElementById('propHeight');
        const pRot = document.getElementById('propRotation');
        const pSmoothRow = document.getElementById('propSmoothRow');
        const pSmooth = document.getElementById('propSmooth');
        const angleDial = document.getElementById('angleDial');
        const angleArrow = document.getElementById('angleArrow');

        if (!this.selectedObjects || this.selectedObjects.length === 0) {
            info.textContent = "No selection";
            pSize.disabled = true;
            pHeight.disabled = true;
            pRot.disabled = true;
            pSize.value = '';
            pHeight.value = '';
            pRot.value = '';
            pSmoothRow.style.display = 'none';
            angleDial.style.display = 'none';
            return;
        }

        // Just check first object for type
        const obj = this.selectedObjects[0];
        const hole = this.getCurrentHole();
        const isBoost = hole.boosts && hole.boosts.includes(obj);

        pSize.disabled = false;
        pSmoothRow.style.display = 'none';
        
        if (obj.points) {
            // Polygon
            info.textContent = isBoost ? "Boost Pad" : "Hazard (Shape)";
            pSize.disabled = true;
            pHeight.disabled = true;
            
            if (isBoost) {
                pRot.disabled = false;
                pRot.value = Math.round(obj.angle || 0);
                angleDial.style.display = 'inline-block';
                if(angleArrow) angleArrow.style.transform = `rotate(${obj.angle || 0}deg)`;
            } else {
                pRot.disabled = true;
                pRot.value = '';
                angleDial.style.display = 'none';
            }
            
            pSmoothRow.style.display = 'flex';
            pSmooth.checked = obj.smooth || false;
        } else if (obj.radius !== undefined) {
            // Circle (Start/Hole/Hazard)
            if (obj === this.getCurrentHole().start) info.textContent = "Start Position";
            else if (obj === this.getCurrentHole().end) info.textContent = "Hole";
            else info.textContent = "Hazard (Circle)";
            
            pSize.previousElementSibling.textContent = "Radius:";
            pSize.value = Math.round(obj.radius);
            pHeight.disabled = true;
            pRot.disabled = true;
            pHeight.value = '';
            pRot.value = '';
            angleDial.style.display = 'none';
        } else {
            // Rect
            info.textContent = "Wall/Object";
            pSize.previousElementSibling.textContent = "Width:";
            pSize.value = Math.round(obj.width);
            pHeight.disabled = false;
            pHeight.value = Math.round(obj.height);
            pRot.disabled = false;
            pRot.value = Math.round(obj.angle || 0);
            
            angleDial.style.display = 'inline-block';
            if(angleArrow) angleArrow.style.transform = `rotate(${obj.angle || 0}deg)`;
        }
    }

    async saveCourse() {
        const data = JSON.stringify(this.course, null, 2);
        const suggestedName = this.course.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json';

        // Try to save to server first
        try {
            const response = await fetch('/api/save_course', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    filename: suggestedName,
                    data: this.course
                })
            });
            
            if (response.ok) {
                alert('Course saved to server successfully!');
                return;
            } else {
                console.warn('Server save failed, falling back to local save.');
            }
        } catch (e) {
            console.warn('Server not reachable, falling back to local save.', e);
        }

        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: suggestedName,
                    types: [{
                        description: 'JSON File',
                        accept: {'application/json': ['.json']},
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(data);
                await writable.close();
            } else {
                // Fallback for browsers that don't support File System Access API
                const blob = new Blob([data], {type: 'application/json'});
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = suggestedName;
                a.click();
            }
        } catch (err) {
            // User cancelled or error occurred
            console.log("Save cancelled or failed", err);
        }
    }

    loadCourse(e) {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                this.course = JSON.parse(e.target.result);
                this.currentHoleIndex = 0;
                document.getElementById('courseName').value = this.course.name;
                this.updateUI();
                this.render();
            } catch (err) {
                alert("Invalid JSON file");
            }
        };
        reader.readAsText(file);
    }

    render() {
        // Clear
        this.ctx.fillStyle = '#2E8B57';
        this.ctx.fillRect(0, 0, this.width, this.height);

        const hole = this.getCurrentHole();

        // Helper to create poly path
        const createPolyPath = (obj) => {
            this.ctx.beginPath();
            if (obj.points.length < 2) return;
            
            if (obj.smooth && obj.points.length > 2) {
                const len = obj.points.length;
                const pLast = obj.points[len - 1];
                const pFirst = obj.points[0];
                let midX = (pLast.x + pFirst.x) / 2;
                let midY = (pLast.y + pFirst.y) / 2;
                
                this.ctx.moveTo(midX, midY);
                
                for (let i = 0; i < len; i++) {
                    const p = obj.points[i];
                    const nextP = obj.points[(i + 1) % len];
                    const nextMidX = (p.x + nextP.x) / 2;
                    const nextMidY = (p.y + nextP.y) / 2;
                    
                    this.ctx.quadraticCurveTo(p.x, p.y, nextMidX, nextMidY);
                }
            } else {
                this.ctx.moveTo(obj.points[0].x, obj.points[0].y);
                for (let i = 1; i < obj.points.length; i++) {
                    this.ctx.lineTo(obj.points[i].x, obj.points[i].y);
                }
            }
            this.ctx.closePath();
        };

        // Draw Hazards
        this.ctx.fillStyle = '#F0E68C'; // Sand
        hole.sands.forEach(s => {
            if (s.points) {
                createPolyPath(s);
                this.ctx.fill();
            } else {
                this.ctx.beginPath();
                if (s.radius) this.ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
                else this.ctx.rect(s.x, s.y, s.width, s.height);
                this.ctx.fill();
            }
        });
        
        this.ctx.fillStyle = '#4FA4F4'; // Water
        hole.waters.forEach(w => {
            if (w.points) {
                createPolyPath(w);
                this.ctx.fill();
            } else {
                this.ctx.beginPath();
                if (w.radius) this.ctx.arc(w.x, w.y, w.radius, 0, Math.PI * 2);
                else this.ctx.rect(w.x, w.y, w.width, w.height);
                this.ctx.fill();
            }
        });

        // Draw Ice
        if (hole.ice) {
            hole.ice.forEach(i => {
                this.ctx.save();
                if (i.points) {
                    if (this.icePattern) {
                        if (i.angle) {
                            const matrix = new DOMMatrix();
                            matrix.rotateSelf(i.angle);
                            this.icePattern.setTransform(matrix);
                        } else {
                            this.icePattern.setTransform(new DOMMatrix());
                        }
                        this.ctx.fillStyle = this.icePattern;
                    } else {
                        this.ctx.fillStyle = '#E0FFFF';
                    }
                    createPolyPath(i);
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#B0E0E6';
                    this.ctx.lineWidth = 2;
                    this.ctx.stroke();
                }
                this.ctx.restore();
            });
        }

        // Draw Boosts
        if (hole.boosts) {
            hole.boosts.forEach(b => {
                this.ctx.save();
                if (b.points) {
                    if (this.boostPattern) {
                        if (b.angle) {
                            const matrix = new DOMMatrix();
                            matrix.rotateSelf(b.angle);
                            this.boostPattern.setTransform(matrix);
                        } else {
                            this.boostPattern.setTransform(new DOMMatrix());
                        }
                        this.ctx.fillStyle = this.boostPattern;
                    } else {
                        this.ctx.fillStyle = '#FFA500';
                    }
                    createPolyPath(b);
                    this.ctx.fill();
                    this.ctx.strokeStyle = '#FF8C00';
                    this.ctx.lineWidth = 2;
                    this.ctx.stroke();
                }
                this.ctx.restore();
            });
        }

        // Draw Bridges
        if (hole.bridges) {
            hole.bridges.forEach(b => {
                this.ctx.save();
                const cx = b.x + b.width/2;
                const cy = b.y + b.height/2;
                this.ctx.translate(cx, cy);
                this.ctx.rotate((b.angle || 0) * (Math.PI / 180));
                
                const w = b.width;
                const h = b.height;

                if (this.bridgePattern) {
                    this.ctx.fillStyle = this.bridgePattern;
                } else {
                    this.ctx.fillStyle = '#DEB887';
                }
                
                // Draw centered
                this.ctx.fillRect(-w/2, -h/2, w, h);
                this.ctx.strokeStyle = '#8B4513';
                this.ctx.lineWidth = 2;
                this.ctx.strokeRect(-w/2, -h/2, w, h);

                // Walls (Visual only in editor)
                this.ctx.fillStyle = '#5D4037';
                this.ctx.fillRect(-w/2, -h/2, w, 5); // Top Wall
                this.ctx.fillRect(-w/2, h/2 - 5, w, 5); // Bottom Wall

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
        }

        // Draw Trees (Bushes)
        if (hole.trees) {
            hole.trees.forEach(t => {
                this.ctx.save();
                
                // Draw "Bush" style - Simple Circle with Texture
                // We don't have the bushPattern here, so just use color
                this.ctx.fillStyle = '#006400'; // Dark Green
                
                this.ctx.beginPath();
                this.ctx.arc(t.x, t.y, t.radius, 0, Math.PI * 2);
                this.ctx.fill();
                
                // Simple border
                this.ctx.strokeStyle = '#004d00';
                this.ctx.lineWidth = 2;
                this.ctx.stroke();
                
                // Simple texture dots for editor
                this.ctx.fillStyle = 'rgba(34, 139, 34, 0.5)';
                for(let i=0; i<5; i++) {
                    const angle = Math.random() * Math.PI * 2;
                    const r = Math.random() * t.radius * 0.6;
                    const x = t.x + Math.cos(angle) * r;
                    const y = t.y + Math.sin(angle) * r;
                    this.ctx.beginPath();
                    this.ctx.arc(x, y, t.radius * 0.2, 0, Math.PI * 2);
                    this.ctx.fill();
                }
                
                this.ctx.restore();
            });
        }

        // Draw Walls
        this.ctx.fillStyle = this.brickPattern;
        this.ctx.strokeStyle = 'black';
        this.ctx.lineWidth = 2;
        
        hole.walls.forEach(w => {
            this.ctx.save();
            if (w.angle) {
                const cx = w.x + w.width/2;
                const cy = w.y + w.height/2;
                this.ctx.translate(cx, cy);
                this.ctx.rotate(w.angle * (Math.PI / 180));
                this.ctx.translate(-cx, -cy);
            }
            this.ctx.fillRect(w.x, w.y, w.width, w.height);
            this.ctx.strokeRect(w.x, w.y, w.width, w.height);
            this.ctx.restore();
        });

        // Draw Hole
        this.ctx.beginPath();
        this.ctx.arc(hole.end.x, hole.end.y, hole.end.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = 'black';
        this.ctx.fill();
        this.ctx.strokeStyle = '#333';
        this.ctx.stroke();

        // Draw Start
        this.ctx.beginPath();
        this.ctx.arc(hole.start.x, hole.start.y, hole.start.radius, 0, Math.PI * 2);
        this.ctx.fillStyle = 'white';
        this.ctx.fill();
        this.ctx.strokeStyle = 'black';
        this.ctx.stroke();
        
        // Draw Brush Cursor
        if (this.selectedTool === 'water-poly' || this.selectedTool === 'sand-poly' || this.selectedTool === 'ice-poly' || this.selectedTool === 'boost-poly') {
            // No brush cursor for poly tools, maybe just a crosshair?
            // The mouse cursor is enough usually.
        }

        // Draw Current Poly
        if (this.currentPoly) {
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 2;
            this.ctx.beginPath();
            this.ctx.moveTo(this.currentPoly.points[0].x, this.currentPoly.points[0].y);
            for (let i = 1; i < this.currentPoly.points.length; i++) {
                this.ctx.lineTo(this.currentPoly.points[i].x, this.currentPoly.points[i].y);
            }
            this.ctx.lineTo(this.mousePos.x, this.mousePos.y); // Preview line
            this.ctx.stroke();
            
            // Draw points
            this.ctx.fillStyle = 'white';
            this.currentPoly.points.forEach(p => {
                this.ctx.beginPath();
                this.ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                this.ctx.fill();
            });
        }

        // Draw Selection Box
        if (this.interactionMode === 'BOX_SELECT' && this.boxSelectStart) {
            const w = this.mousePos.x - this.boxSelectStart.x;
            const h = this.mousePos.y - this.boxSelectStart.y;
            this.ctx.strokeStyle = 'white';
            this.ctx.lineWidth = 1;
            this.ctx.setLineDash([5, 5]);
            this.ctx.strokeRect(this.boxSelectStart.x, this.boxSelectStart.y, w, h);
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
            this.ctx.fillRect(this.boxSelectStart.x, this.boxSelectStart.y, w, h);
            this.ctx.setLineDash([]);
        }

        // Draw Selection Highlights
        this.selectedObjects.forEach(obj => {
            this.ctx.strokeStyle = 'red';
            this.ctx.lineWidth = 3;
            this.ctx.setLineDash([5, 5]);
            
            if (obj.points) {
                // Poly Highlight
                this.ctx.beginPath();
                if (obj.smooth && obj.points.length > 2) {
                    const len = obj.points.length;
                    const pLast = obj.points[len - 1];
                    const pFirst = obj.points[0];
                    let midX = (pLast.x + pFirst.x) / 2;
                    let midY = (pLast.y + pFirst.y) / 2;
                    this.ctx.moveTo(midX, midY);
                    for (let i = 0; i < len; i++) {
                        const p = obj.points[i];
                        const nextP = obj.points[(i + 1) % len];
                        const nextMidX = (p.x + nextP.x) / 2;
                        const nextMidY = (p.y + nextP.y) / 2;
                        this.ctx.quadraticCurveTo(p.x, p.y, nextMidX, nextMidY);
                    }
                } else {
                    this.ctx.moveTo(obj.points[0].x, obj.points[0].y);
                    for (let i = 1; i < obj.points.length; i++) {
                        this.ctx.lineTo(obj.points[i].x, obj.points[i].y);
                    }
                }
                this.ctx.closePath();
                this.ctx.stroke();
                
                // Draw vertices
                this.ctx.fillStyle = 'red';
                obj.points.forEach(p => {
                    this.ctx.beginPath();
                    this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
                    this.ctx.fill();
                });
            } else if (obj.radius !== undefined) {
                this.ctx.beginPath();
                this.ctx.arc(obj.x, obj.y, obj.radius + 5, 0, Math.PI * 2);
                this.ctx.stroke();
            } else {
                this.ctx.save();
                if (obj.angle) {
                    const cx = obj.x + obj.width/2;
                    const cy = obj.y + obj.height/2;
                    this.ctx.translate(cx, cy);
                    this.ctx.rotate(obj.angle * (Math.PI / 180));
                    this.ctx.translate(-cx, -cy);
                }
                this.ctx.strokeRect(obj.x - 5, obj.y - 5, obj.width + 10, obj.height + 10);
                this.ctx.restore();
                
                // Draw Resize Handles (Only if single selection and is Bridge or Wall)
                const isBridge = hole.bridges && hole.bridges.includes(obj);
                const isWall = hole.walls && hole.walls.includes(obj);
                
                if (this.selectedObjects.length === 1 && (isBridge || isWall)) {
                    const handles = this.getResizeHandles(obj);
                    
                    // Width Handle
                    this.ctx.beginPath();
                    this.ctx.arc(handles.width.x, handles.width.y, 6, 0, Math.PI * 2);
                    this.ctx.fillStyle = 'white';
                    this.ctx.fill();
                    this.ctx.strokeStyle = 'blue';
                    this.ctx.stroke();

                    // Height Handle
                    this.ctx.beginPath();
                    this.ctx.arc(handles.height.x, handles.height.y, 6, 0, Math.PI * 2);
                    this.ctx.fillStyle = 'white';
                    this.ctx.fill();
                    this.ctx.strokeStyle = 'blue';
                    this.ctx.stroke();
                }

                // Draw Rotation Handle (Only if single selection)
                if (this.selectedObjects.length === 1) {
                    this.ctx.setLineDash([]);
                    const handle = this.getRotationHandlePos(obj);
                    this.ctx.beginPath();
                    this.ctx.moveTo(handle.x, handle.y);
                    // Draw line to center
                    if (obj.points) {
                        let cx = 0, cy = 0;
                        obj.points.forEach(p => { cx += p.x; cy += p.y; });
                        cx /= obj.points.length;
                        cy /= obj.points.length;
                        this.ctx.lineTo(cx, cy);
                    } else {
                        const cx = obj.x + obj.width/2;
                        const cy = obj.y + obj.height/2;
                        this.ctx.lineTo(cx, cy);
                    }
                    this.ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
                    this.ctx.stroke();

                    this.ctx.beginPath();
                    this.ctx.arc(handle.x, handle.y, 8, 0, Math.PI * 2);
                    this.ctx.fillStyle = 'white';
                    this.ctx.fill();
                    this.ctx.strokeStyle = 'red';
                    this.ctx.stroke();
                }
            }
            this.ctx.setLineDash([]);
        });
    }
}

// Init
window.onload = () => {
    const editor = new Editor();
};
