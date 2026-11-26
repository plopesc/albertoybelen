import profile from '../frontend/config/pages-live.json' with {type:'json'};

export const OFFICIAL_CHALLENGE = Object.freeze({
  goalKm: 500,
  startDate: profile.game.startDate,
  timeZone: 'Europe/Madrid',
});
