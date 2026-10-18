// V5RC 2026–2027 "Override" game definitions (from the official game manual v2.1):
// alliance-coloured Pin Half 5 pts, Owned yellow Pin Half 10 pts, Robot ending in the Midfield 8 pts,
// Autonomous Bonus 12 pts (6 each on a tie). Matches: 0:15 autonomous + 1:45 driver. Skills: 1:00.

export const GAME = {
  name: 'Override',
  program: 'V5RC',
  season: '2026–2027',
  manualUrl: 'https://manuals.vex.com/v5/override/v2.1/game/',
  points: { allianceHalf: 5, yellowHalf: 10, midfield: 8, autoBonus: 12, autoTie: 6 },
  awp: {
    standard: { halves: 6, goals: 2 },
    qualifying: { halves: 7, goals: 3 }
  }
};

export function matchScore({ halves = 0, yellow = 0, midfield = 0 }, bonus = 'none') {
  const p = GAME.points;
  return halves * p.allianceHalf + yellow * p.yellowHalf + midfield * p.midfield +
    (bonus === 'win' ? p.autoBonus : bonus === 'tie' ? p.autoTie : 0);
}

export function skillsScore({ halves = 0, yellow = 0, midfield = 0 }) {
  const p = GAME.points;
  return halves * p.allianceHalf + yellow * p.yellowHalf + midfield * p.midfield;
}

export const TIMERS = [
  {
    id: 'v5-match', name: 'V5RC Match', desc: '0:15 auton + 1:45 driver',
    phases: [{ name: 'Autonomous', secs: 15, kind: 'auto' }, { name: 'Driver Control', secs: 105, kind: 'driver' }],
    holdBetween: true
  },
  { id: 'v5-driver-skills', name: 'Driving Skills', desc: '1:00 driver', phases: [{ name: 'Driving Skills', secs: 60, kind: 'driver' }] },
  { id: 'v5-auto-skills', name: 'Auton Skills', desc: '1:00 autonomous', phases: [{ name: 'Autonomous Skills', secs: 60, kind: 'auto' }] },
  { id: 'iq-teamwork', name: 'VIQRC Teamwork', desc: '1:00 teamwork', phases: [{ name: 'Teamwork', secs: 60, kind: 'driver' }] },
  { id: 'iq-skills', name: 'VIQRC Skills', desc: '1:00 driver or coding', phases: [{ name: 'Skills', secs: 60, kind: 'driver' }] },
  { id: 'v5-auto', name: 'Auton Only', desc: '0:15 autonomous', phases: [{ name: 'Autonomous', secs: 15, kind: 'auto' }] }
];

// ---------- Scouting forms ----------
export const MATCH_FORM = [
  {
    section: 'Autonomous', fields: [
      { key: 'autoHalves', label: 'Pin halves scored', type: 'counter' },
      { key: 'autoGoals', label: 'Goals with 2+ halves', type: 'counter' },
      { key: 'autoResult', label: 'Auton result', type: 'choice', options: ['None', 'Failed', 'Partial', 'Full'] },
      { key: 'awp', label: 'Earned Auton Win Point', type: 'bool' }
    ]
  },
  {
    section: 'Driver control', fields: [
      { key: 'halves', label: 'Alliance pin halves', hint: '5 pts each', type: 'counter' },
      { key: 'yellow', label: 'Yellow pin halves', hint: '10 pts when owned', type: 'counter' },
      { key: 'cups', label: 'Cups placed', type: 'counter' },
      { key: 'toggles', label: 'Toggles set', type: 'counter' },
      { key: 'midfield', label: 'Ended in the Midfield', hint: '8 pts', type: 'bool' },
      { key: 'defense', label: 'Defense played', type: 'choice', options: ['None', 'Some', 'Heavy'] }
    ]
  },
  {
    section: 'Assessment', fields: [
      { key: 'driving', label: 'Driving skill', type: 'stars' },
      { key: 'speed', label: 'Speed', type: 'stars' },
      { key: 'issues', label: 'Issues', type: 'multi', options: ['Tipped', 'Disconnected', 'Broke', 'Got stuck', 'Fouls', 'No-show'] }
    ]
  }
];

export const PIT_FORM = [
  {
    section: 'Drivetrain', fields: [
      { key: 'drive', label: 'Drive type', type: 'choice', options: ['Tank', 'X-Drive', 'Mecanum', 'Asterisk', 'Other'] },
      { key: 'driveMotors', label: 'Drive motors', type: 'counter' },
      { key: 'wheel', label: 'Wheels', type: 'choice', options: ['2.75"', '3.25"', '4"', 'Other'] },
      { key: 'rpm', label: 'Drive RPM', type: 'number', placeholder: 'e.g. 450' }
    ]
  },
  {
    section: 'Mechanisms', fields: [
      { key: 'mechs', label: 'Can handle', type: 'multi', options: ['Pins', 'Yellow pins', 'Cups', 'Toggles', 'Midfield', 'Tall goal', 'Descoring'] },
      { key: 'pneumatics', label: 'Uses pneumatics', type: 'bool' },
      { key: 'sensors', label: 'Sensors', type: 'multi', options: ['GPS', 'Optical', 'Distance', 'Rotation', 'Inertial', 'AI vision'] }
    ]
  },
  {
    section: 'Autonomous', fields: [
      { key: 'autos', label: 'Routines', type: 'multi', options: ['Left side', 'Right side', 'Solo AWP', 'Elims', 'Skills'] },
      { key: 'autoHalves', label: 'Typical auton halves', type: 'counter' },
      { key: 'skillsClaim', label: 'Best skills score', type: 'number', placeholder: 'Claimed total' }
    ]
  },
  {
    section: 'Strategy', fields: [
      { key: 'role', label: 'Preferred role', type: 'choice', options: ['Scorer', 'Toggles', 'Defense', 'Flexible'] },
      { key: 'impression', label: 'Overall impression', type: 'stars' }
    ]
  }
];

export const SCOUT_TAGS = ['Fast', 'Strong auton', 'Consistent', 'Great driver', 'Defense', 'Midfield', 'Toggle control',
  'Yellow pins', 'Cups', 'Good partner', 'Inconsistent', 'Fragile', 'Avoid'];

export const DEFAULT_CHECKLISTS = [
  {
    name: 'Competition packing list',
    items: ['Robot', 'Controllers (charged)', 'Batteries ×4 + chargers', 'Spare motors & cartridges', 'Tool box & hex keys',
      'Spare screws, nuts, spacers', 'Zip ties & rubber bands', 'Laptop + USB cable', 'Field tiles/game elements for practice',
      'Engineering notebook', 'Team shirts & safety glasses', 'Extension cord / power board', 'Snacks & water']
  },
  {
    name: 'Pre-match checklist',
    items: ['Battery charged & swapped', 'Radio linked to controller', 'Correct auton selected', 'Preload loaded',
      'Robot fits 18" sizing', 'Pneumatics pumped', 'Brain screen clear of errors', 'Know alliance partner plan']
  }
];
