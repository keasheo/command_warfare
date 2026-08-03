/**
 * Second-pass renames on already-renamed cards to finish breaking prefix clusters.
 */
export const RENAMES2 = {
  // Vein* (4 → unique)
  'Vein Guide': 'Scorch Guide',
  'Vein Raider': 'Embertrail Raider',
  'Vein Hellhounds': 'Hellhound Pack',
  'Vein Flamecaller': 'Flamecaller',

  // Gate* 
  'Gate Sentry': 'Hellgate Sentry',
  'Gate Hound': 'Mawhound',
  'Gate Marauder': 'Cinder Marauder',
  'Gatebreak Engine': 'Gatebreak Engine', // keep unique compound

  // Chain*
  'Chain Cultist': 'Doom Cultist',
  'Chain Flayer': 'Link Flayer',

  // Brim*
  'Brim Hellknight': 'Hellknight',
  'Brim Crawler': 'Sulfur Crawler',

  // Bog*
  'Bog Handler': 'Mud Handler',
  'Bog Spears': 'Marsh Spears',

  // Silt*
  'Silt Scout': 'Reed Scout',
  'Silt Stalker': 'Muck Stalker',

  // Marshstone*
  'Marshstone Guard': 'Lith Guard',
  'Marshstone Pillar': 'Lith Pillar',

  // Mire*
  'Mire Naga': 'Fen Naga',
}
