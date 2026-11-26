import assert from 'node:assert/strict';
import test from 'node:test';
import {startInstant} from '../frontend/js/challenge-time.js';
import {shouldWelcome} from '../frontend/js/welcome.js';

test('welcome uses OR and recognizes a numeric zero only', () => {
  const game = {startDate:'2027-07-01',timeZone:'Europe/Madrid'};
  const midnight = startInstant(game.startDate,game.timeZone);
  assert.equal(new Date(midnight).toISOString(),'2027-06-30T22:00:00.000Z');
  assert.equal(shouldWelcome(midnight,midnight-1,0),true);
  assert.equal(shouldWelcome(midnight,midnight-1,123),true);
  assert.equal(shouldWelcome(midnight,midnight,0),true);
  assert.equal(shouldWelcome(midnight,midnight+1,1),false);
  for(const distance of [null,undefined,NaN,'0']) assert.equal(shouldWelcome(midnight,midnight,distance),false);
});
