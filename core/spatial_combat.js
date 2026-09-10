// Pure spatial helpers. World units are independent of canvas pixels.
const spatialCombat = (() => {
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
    const facing = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
    const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
    function turn(current, target, amount) {
        return current + clamp(angleDelta(target, current), -amount, amount);
    }
    function segmentDistance(px, py, bx, by) {
        const t = clamp((px * bx + py * by) / (bx * bx + by * by || 1), 0, 1);
        return Math.hypot(px - t * bx, py - t * by);
    }
    // Exact disk vs sector intersection, including contact with the radial edges.
    function contains(shape, origin, direction, target) {
        const dx = target.x - origin.x, dy = target.y - origin.y;
        const d = Math.hypot(dx, dy), radius = target.radius || 0;
        if (d > shape.range + radius) return false;
        if (shape.kind === 'circle' || d <= radius) return true;
        const delta = angleDelta(Math.atan2(dy, dx), direction);
        if (Math.abs(delta) <= shape.arc / 2) return true;
        return [-1, 1].some(sign => {
            const edge = direction + sign * shape.arc / 2;
            return segmentDistance(dx, dy, Math.cos(edge) * shape.range, Math.sin(edge) * shape.range) <= radius;
        });
    }
    function move(body, vx, vy, dt, bounds, obstacle) {
        const previous = { x: body.x, y: body.y };
        body.x += vx * dt;
        body.y += vy * dt;
        if (obstacle) {
            const d = distance(body, obstacle), min = body.radius + obstacle.radius;
            if (d < min) {
                const a = d > .001 ? facing(obstacle, body) : Math.PI / 2;
                body.x = obstacle.x + Math.cos(a) * min;
                body.y = obstacle.y + Math.sin(a) * min;
            }
        }
        body.x = clamp(body.x, body.radius, bounds.width - body.radius);
        body.y = clamp(body.y, body.radius, bounds.height - body.radius);
        // Clamping a collision correction at a wall can reintroduce overlap.
        // Keep the stationary collider fixed and reject this movement step.
        if (obstacle && distance(body, obstacle) < body.radius + obstacle.radius - 1e-7) {
            body.x = previous.x; body.y = previous.y;
        }
    }
    return { clamp, angleDelta, facing, distance, turn, contains, move };
})();
