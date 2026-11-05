// Balance simulator: plays the mission many times with a simple squad bot against the real enemy AI.
// The bot never uses abilities, hatches, or the fans, so real players should do better than this.
// Run with `npm run sim`.
import { it } from 'vitest';
import { createMission01 } from '../src/data/mission01';
import { runSquadBot } from '../src/logic/ai';
import { endPlayerTurn } from '../src/logic/turn';
import { isActive, unitsOf } from '../src/logic/units';

const RUNS = 200;

function report(label: string, setup: (s: ReturnType<typeof createMission01>) => void): void {
  const results = { victory: 0, defeat: 0 };
  const reasons = new Map<string, number>();
  const winRounds: number[] = [];
  const lossRounds: number[] = [];
  const firstContact: number[] = [];
  let squadLeft = 0;
  let killed = 0;
  for (let seed = 1; seed <= RUNS; seed++) {
    const s = createMission01(seed * 977);
    setup(s);
    let contact = 0;
    while (s.outcome === 'ongoing') {
      if (!contact && s.log.some((l) => l.includes(' fires at ') || l.includes('overwatch at'))) contact = s.round;
      runSquadBot(s);
      if (s.outcome !== 'ongoing') break;
      endPlayerTurn(s);
      s.fx = [];
    }
    results[s.outcome as 'victory' | 'defeat']++;
    const key = s.outcomeReason.replace(/^[A-Z]+ [A-Za-z]+ [A-Za-z]+ /, '<unit> ');
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
    if (s.outcome === 'victory') winRounds.push(s.round);
    else lossRounds.push(s.round);
    if (contact) firstContact.push(contact);
    squadLeft += unitsOf(s, 'player').filter(isActive).length;
    killed += unitsOf(s, 'enemy').filter((u) => !isActive(u)).length;
  }
  const avg = (a: number[]) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-');
  console.log(`\n=== ${label}: ${RUNS} runs, squad bot vs enemy AI ===`);
  console.log(`victory ${results.victory}  defeat ${results.defeat}  (win rate ${((100 * results.victory) / RUNS).toFixed(0)}%)`);
  console.log(`average loss round ${avg(lossRounds)}; first shots exchanged by round ${avg(firstContact)}`);
  console.log(`average win round ${avg(winRounds)}; squad standing at end ${(squadLeft / RUNS).toFixed(2)}; enemies killed ${(killed / RUNS).toFixed(2)} of 7`);
  for (const [r, n] of [...reasons].sort((a, b) => b[1] - a[1])) console.log(`  ${n}x  ${r}`);
}

it('balance report', () => {
  report('Baseline', () => {});
  // What flooding the engine room is worth: fans reversed from round 1 (the bot never does this itself).
  report('Fans reversed at start', (s) => {
    s.ventDirection = -1;
  });
});
