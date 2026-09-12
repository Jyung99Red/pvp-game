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
    const EPS = 1e-7;
    function rectEdges(rect) {
        const x2 = rect.x + rect.width, y2 = rect.y + rect.height;
        return [
            [{ x: rect.x, y: rect.y }, { x: x2, y: rect.y }],
            [{ x: x2, y: rect.y }, { x: x2, y: y2 }],
            [{ x: x2, y: y2 }, { x: rect.x, y: y2 }],
            [{ x: rect.x, y: y2 }, { x: rect.x, y: rect.y }]
        ];
    }
    function circleIntersectsRect(body, x, y, rect) {
        const nearX = clamp(x, rect.x, rect.x + rect.width), nearY = clamp(y, rect.y, rect.y + rect.height);
        const dx = x - nearX, dy = y - nearY;
        return dx * dx + dy * dy < body.radius * body.radius - EPS;
    }
    function segmentIntersectsRect(a, b, rect) {
        const minX = rect.x, maxX = rect.x + rect.width, minY = rect.y, maxY = rect.y + rect.height;
        const dx = b.x - a.x, dy = b.y - a.y;
        let lo = 0, hi = 1;
        const clip = (p, q) => {
            if (Math.abs(p) <= EPS) return q >= -EPS;
            const t = q / p;
            if (p < 0) { if (t > hi + EPS) return false; if (t > lo) lo = t; }
            else { if (t < lo - EPS) return false; if (t < hi) hi = t; }
            return true;
        };
        return clip(-dx, a.x - minX) && clip(dx, maxX - a.x) &&
            clip(-dy, a.y - minY) && clip(dy, maxY - a.y) && lo <= hi + EPS;
    }
    function segmentBlocked(a, b, walls = []) {
        return (walls || []).some(rect => segmentIntersectsRect(a, b, rect));
    }
    function hasLineOfSight(a, b, walls = []) { return !segmentBlocked(a, b, walls); }
    function canOccupy(body, x, y, bounds, walls = [], obstacle = null) {
        if (x < body.radius - EPS || x > bounds.width - body.radius + EPS ||
            y < body.radius - EPS || y > bounds.height - body.radius + EPS) return false;
        if ((walls || []).some(rect => circleIntersectsRect(body, x, y, rect))) return false;
        return !obstacle || Math.hypot(x - obstacle.x, y - obstacle.y) >= body.radius + obstacle.radius - EPS;
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
    function move(body, vx, vy, dt, bounds, obstacle, wallList = bounds?.walls || []) {
        const previous = { x: body.x, y: body.y }, travel = Math.hypot(vx, vy) * dt;
        const stepLength = Math.max(1, body.radius * .5), steps = Math.max(1, Math.ceil(travel / stepLength));
        const dx = vx * dt / steps, dy = vy * dt / steps;
        const walls = wallList || [];
        const position = (x, y) => ({
            x: clamp(x, body.radius, bounds.width - body.radius),
            y: clamp(y, body.radius, bounds.height - body.radius)
        });
        const valid = point => canOccupy(body, point.x, point.y, bounds, walls, obstacle);
        for (let i = 0; i < steps; i++) {
            const start = { x: body.x, y: body.y }, target = position(start.x + dx, start.y + dy);
            if (valid(target)) { body.x = target.x; body.y = target.y; continue; }
            const candidates = [position(start.x + dx, start.y), position(start.x, start.y + dy)];
            const usable = candidates.filter(valid);
            if (usable.length) {
                usable.sort((a, b) => Math.hypot(b.x - target.x, b.y - target.y) - Math.hypot(a.x - target.x, a.y - target.y));
                body.x = usable[0].x; body.y = usable[0].y;
            }
            // An invalid substep is deliberately left at its last valid point;
            // the next substep can continue along the wall and cannot tunnel
            // through a corner or a fast-moving thin section.
        }
        return body.x !== previous.x || body.y !== previous.y;
    }
    function separate(a, b, bounds, wallList = bounds?.walls || [], fallback = null) {
        const walls = wallList || [], radius = a.radius + b.radius;
        let gap = distance(a, b);
        if (gap >= radius - EPS) return true;
        const originalA = { x: a.x, y: a.y }, originalB = { x: b.x, y: b.y };
        const fallbackA = fallback?.[0] || originalA, fallbackB = fallback?.[1] || originalB;
        for (let pass = 0; pass < 3 && gap < radius - EPS; pass++) {
            const dx = gap > EPS ? (b.x - a.x) / gap : 0, dy = gap > EPS ? (b.y - a.y) / gap : -1;
            const push = (radius - gap) / 2, aNext = { x: a.x - dx * push, y: a.y - dy * push };
            const bNext = { x: b.x + dx * push, y: b.y + dy * push };
            const pairValid = (pa, pb) => canOccupy(a, pa.x, pa.y, bounds, walls, { ...b, ...pb }) &&
                canOccupy(b, pb.x, pb.y, bounds, walls, { ...a, ...pa }) && distance(pa, pb) >= radius - EPS;
            if (pairValid(aNext, bNext)) {
                Object.assign(a, aNext); Object.assign(b, bNext); gap = distance(a, b); continue;
            }
            const options = [[aNext, { x: b.x, y: b.y }], [{ x: a.x, y: a.y }, bNext]];
            const usable = options.find(([pa, pb]) => pairValid(pa, pb));
            if (usable) { Object.assign(a, usable[0]); Object.assign(b, usable[1]); gap = distance(a, b); }
            else break;
        }
        if (distance(a, b) < radius - EPS) {
            const fallbackPair = (pa, pb) => canOccupy(a, pa.x, pa.y, bounds, walls, { ...b, ...pb }) &&
                canOccupy(b, pb.x, pb.y, bounds, walls, { ...a, ...pa }) && distance(pa, pb) >= radius - EPS;
            if (fallbackPair(fallbackA, fallbackB)) { Object.assign(a, fallbackA); Object.assign(b, fallbackB); }
            else { Object.assign(a, originalA); Object.assign(b, originalB); }
        }
        return distance(a, b) >= radius - EPS;
    }
    function raySegment(origin, direction, start, end) {
        const cross = (a, b) => a.x * b.y - a.y * b.x;
        const segment = { x: end.x - start.x, y: end.y - start.y };
        const fromOrigin = { x: start.x - origin.x, y: start.y - origin.y };
        const denom = cross(direction, segment);
        if (Math.abs(denom) <= EPS) return null;
        const t = cross(fromOrigin, segment) / denom, u = cross(fromOrigin, direction) / denom;
        return t >= -EPS && u >= -EPS && u <= 1 + EPS ? Math.max(0, t) : null;
    }
    // Ray-cast around wall and arena corners. The polygon is display-only;
    // simulation uses segmentBlocked for the authoritative center-line rule.
    function visibilityPolygon(origin, bounds, walls = []) {
        const corners = [
            { x: 0, y: 0 }, { x: bounds.width, y: 0 },
            { x: bounds.width, y: bounds.height }, { x: 0, y: bounds.height }
        ];
        for (const wall of walls || []) corners.push(...rectEdges(wall).map(edge => edge[0]));
        const angles = [];
        for (const point of corners) {
            const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
            angles.push(angle - 1e-6, angle, angle + 1e-6);
        }
        const edges = [];
        const boundary = { x: 0, y: 0, width: bounds.width, height: bounds.height };
        edges.push(...rectEdges(boundary));
        for (const wall of walls || []) edges.push(...rectEdges(wall));
        return angles.map(angle => {
            const direction = { x: Math.cos(angle), y: Math.sin(angle) };
            let nearest = Infinity;
            for (const [start, end] of edges) {
                const t = raySegment(origin, direction, start, end);
                if (t != null && t < nearest) nearest = t;
            }
            return { x: origin.x + direction.x * nearest, y: origin.y + direction.y * nearest, angle };
        }).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
            .sort((a, b) => a.angle - b.angle)
            .filter((point, i, list) => i === 0 || Math.hypot(point.x - list[i - 1].x, point.y - list[i - 1].y) > .001)
            .map(({ x, y }) => ({ x, y }));
    }
    return { clamp, angleDelta, facing, distance, turn, contains, segmentIntersectsRect, segmentBlocked,
        hasLineOfSight, canOccupy, move, separate, visibilityPolygon };
})();
