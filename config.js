// Site-wide settings for Override Scout.
// Everything here can also be changed per-device in the app's Settings screen.
window.OVERRIDE_CONFIG = {
  appName: 'Override Scout',

  // The team this app is built around. Shown on the home screen by default.
  homeTeam: '1940D',

  // VEX program the app opens to. V5RC = 1, VIQRC = 41, VEXU = 4.
  defaultProgram: 'V5RC',

  // Season used when the live API can't be asked which season is active.
  // 204 = VEX V5 Robotics Competition 2026-2027: Override.
  fallbackSeasons: { V5RC: 204 },

  // Optional: URL of the Cloudflare Worker in /worker (adds team cloud sync and
  // hides the VEX API key from devices). Leave empty to run without it.
  workerUrl: '',

  // Where the GitHub Action publishes the precomputed season data.
  dataBase: 'data'
};
