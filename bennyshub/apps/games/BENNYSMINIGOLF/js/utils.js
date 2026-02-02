const Utils = {
    clamp: (val, min, max) => Math.max(min, Math.min(val, max)),
    
    degToRad: (deg) => deg * (Math.PI / 180),
    
    radToDeg: (rad) => rad * (180 / Math.PI),

    distance: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),

    circleRectCollision: (cx, cy, radius, rx, ry, rw, rh) => {
        let testX = cx;
        let testY = cy;

        if (cx < rx) testX = rx;
        else if (cx > rx + rw) testX = rx + rw;

        if (cy < ry) testY = ry;
        else if (cy > ry + rh) testY = ry + rh;

        let distX = cx - testX;
        let distY = cy - testY;
        let distance = Math.sqrt((distX * distX) + (distY * distY));

        return distance <= radius;
    },

    pointRectDistance: (px, py, rx, ry, rw, rh) => {
        let testX = px;
        let testY = py;

        if (px < rx) testX = rx;
        else if (px > rx + rw) testX = rx + rw;

        if (py < ry) testY = ry;
        else if (py > ry + rh) testY = ry + rh;

        let distX = px - testX;
        let distY = py - testY;
        return Math.sqrt((distX * distX) + (distY * distY));
    },

    pointInPolygon: (x, y, points) => {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = points[i].x, yi = points[i].y;
            const xj = points[j].x, yj = points[j].y;
            
            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    },

    pointLineSegmentDistance: (px, py, x1, y1, x2, y2) => {
        const pt = Utils.closestPointOnLineSegment(px, py, x1, y1, x2, y2);
        const dx = px - pt.x;
        const dy = py - pt.y;
        return Math.sqrt(dx * dx + dy * dy);
    },

    closestPointOnLineSegment: (px, py, x1, y1, x2, y2) => {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const len_sq = C * C + D * D;
        let param = -1;
        if (len_sq !== 0) param = dot / len_sq;

        let xx, yy;

        if (param < 0) { xx = x1; yy = y1; }
        else if (param > 1) { xx = x2; yy = y2; }
        else { xx = x1 + param * C; yy = y1 + param * D; }

        return { x: xx, y: yy };
    },

    closestPointOnPolygon: (x, y, points) => {
        let minDist = Infinity;
        let closest = { x: x, y: y };
        
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const pt = Utils.closestPointOnLineSegment(x, y, p1.x, p1.y, p2.x, p2.y);
            const dx = x - pt.x;
            const dy = y - pt.y;
            const d = Math.sqrt(dx*dx + dy*dy);
            
            if (d < minDist) {
                minDist = d;
                closest = pt;
            }
        }
        return closest;
    },

    pointPolygonDistance: (x, y, points) => {
        if (Utils.pointInPolygon(x, y, points)) return 0; // Inside
        let minDist = Infinity;
        for (let i = 0; i < points.length; i++) {
            const p1 = points[i];
            const p2 = points[(i + 1) % points.length];
            const d = Utils.pointLineSegmentDistance(x, y, p1.x, p1.y, p2.x, p2.y);
            if (d < minDist) minDist = d;
        }
        return minDist;
    },

    // Helper to load JSON
    loadJSON: async (path) => {
        try {
            const response = await fetch(path);
            return await response.json();
        } catch (e) {
            console.error("Failed to load JSON:", path, e);
            return null;
        }
    },
    
    BALL_COLORS: ['white', 'pink', 'lightblue', 'violet', 'orange', 'salmon', 'red', 'yellow', 'lime', 'cyan']
};

const Settings = {
    defaults: {
        aimerStyle: 'TRAJECTORY', // TRAJECTORY, BASIC
        aimerSpeed: 'Medium',
        ballColor: 'white',
        aimerThickness: 3,
        aimerThicknessName: 'Medium',
        sound: true,
        music: true,
        tts: true,
        voiceIndex: 0
    },
    data: {},

    load: function() {
        const stored = localStorage.getItem('bmg_settings');
        if (stored) {
            this.data = { ...this.defaults, ...JSON.parse(stored) };
        } else {
            this.data = { ...this.defaults };
        }
        return this.data;
    },

    save: function() {
        localStorage.setItem('bmg_settings', JSON.stringify(this.data));
    },

    get: function(key) {
        return this.data[key];
    },

    set: function(key, value) {
        this.data[key] = value;
        this.save();
    }
};

// Initialize Settings
Settings.load();

// Polyfill for roundRect if not supported
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
    };
}
