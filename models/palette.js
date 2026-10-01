// Colour names used by every model and texture. Models name a colour; only
// this table holds values, so a restyle touches one file
// (3d-migration-concept.md 12.1).
const palette = Object.freeze({
    // characters
    skin: '#e2b48b', hair: '#5a3a24', eye: '#2a2d38',
    tunic: '#3d6db3', tunicTrim: '#e9e4d6', pants: '#4a3a2c', boots: '#33261c',
    rivalTunic: '#b8443a', rivalTrim: '#f0d9a8',
    belt: '#5b3b22', leather: '#7a5233', gold: '#d8b04a',
    // equipment
    steel: '#dfe5ec', steelDark: '#9aa2aa', wood: '#8a5a2e', woodDark: '#6b4423',
    // training dummy
    sack: '#c9b48a', rope: '#7b6243', straw: '#e3c76a', target: '#c8433a',
    // goblin
    goblin: '#7fb550', goblinLight: '#8cc25a', goblinDark: '#6fa244', goblinEye: '#f6d84a', pupil: '#1f1a12', mouth: '#3a2a1a',
    rag: '#6b4a2a', ragDark: '#5a3e23', ragLight: '#8a6a3c', clubGrip: '#6b4a2b', club: '#4f3a24', goblinFoot: '#5a4027',
    // wolf
    wolf: '#9c9ea3', wolfLight: '#b5b7bc', wolfHead: '#a7a9ae', wolfMuzzle: '#cbccd0', wolfDark: '#8d8f94', wolfLeg: '#8f9196',
    wolfNose: '#26272b', wolfEye: '#f2c94c', fang: '#f4f1e6',
    // terrain
    grass: '#6aa94b', grassLight: '#8cc95e', dirt: '#8b5d3c', path: '#b4925e', pebble: '#8e8a83',
    stone: '#8e9297', stoneDark: '#5f6368', stoneLight: '#b8bcc0', moss: '#5d8a3c',
    bark: '#6c4a2c', leaves: '#3f8b3c', leavesDark: '#1f4d22', leavesLight: '#6dbb57',
    stem: '#4f8f36', flowerRed: '#d9473f', flowerYellow: '#f0cf3c', flowerWhite: '#f2f0ea', flowerViolet: '#8a6ad8',
    // world
    sky: '#a9cdea', skyLight: '#e7f2ff', groundLight: '#6f5d47', sun: '#fff2d8'
});
