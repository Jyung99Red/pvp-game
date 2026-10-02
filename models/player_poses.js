// Key poses of the main character (sparse; see core/rig.js). Animation logic
// lives in core/player_anim.js. Angles in radians: rx > 0 tips a limb
// backwards (a thigh) or bends it (a shin, or a hand towards the palm).
const playerPoses = Object.freeze({
    // Standing, sword forward and low, shield on the left forearm.
    stance: {
        chest: { rx: 0.04 },
        upperArmR: { rx: -0.15, rz: -0.1 }, forearmR: { rx: -0.55 }, handR: { rx: 0.95, ry: -0.2 },
        upperArmL: { rx: -0.1, rz: 0.12 }, forearmL: { rx: -0.5 },
        thighR: { rx: -0.08 }, shinR: { rx: 0.12 },
        thighL: { rx: 0.1 }, shinL: { rx: 0.08 }
    },
    // A full walk cycle is two steps: contact (right foot forward), passing
    // (left leg swinging through), then both mirrored. `legs` replaces the
    // lower body; `arms` is added to the upper body. The stride is measured
    // from these poses, so feet do not slide whatever the angles; long
    // strides keep the steps unhurried at walking speed (user, 2026-10-02).
    walk: {
        legs: [
            { pelvis: { ry: 0.09 }, thighR: { rx: -0.78 }, shinR: { rx: 0.15 }, thighL: { rx: 0.64 }, shinL: { rx: 0.38 } },
            { thighR: { rx: 0.1 }, shinR: { rx: 0.15 }, thighL: { rx: -0.62 }, shinL: { rx: 1.45 } }
        ],
        arms: [
            { chest: { rx: 0.07, ry: -0.1 }, upperArmR: { rx: 0.3 }, upperArmL: { rx: -0.34 } },
            { chest: { rx: 0.07 } }
        ]
    },
    // Running: the same layout as the walk, with longer strides, knees
    // driven high, a forward lean and pumping arms.
    run: {
        legs: [
            { pelvis: { ry: 0.1 }, thighR: { rx: -0.85 }, shinR: { rx: 0.25 }, thighL: { rx: 0.65 }, shinL: { rx: 0.95 } },
            { thighR: { rx: -0.25 }, shinR: { rx: 0.55 }, thighL: { rx: -0.95 }, shinL: { rx: 1.55 } }
        ],
        arms: [
            { chest: { rx: 0.22, ry: -0.12 }, upperArmR: { rx: 0.5 }, forearmR: { rx: -0.35 }, upperArmL: { rx: -0.55 }, forearmL: { rx: -0.45 } },
            { chest: { rx: 0.22 } }
        ]
    },
    // Breathing while idle; drawn only, never part of a hit test.
    breath: { rate: 2.2, chest: 0.012, head: -0.008, arms: 0.02 }
});
