import { PlaybackFault } from './playback-errors.mjs';
export const cancelled = () => new PlaybackFault('cancelled', 'A newer playback command superseded this request.');
/** Observe intent BEFORE queueing work; a pause can cancel play behind a slow load. */
export class NativeCommandGuard {
  current;
  accept(value) {
    if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.id)
      || !['generation', 'intent', 'seek'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0)
      || typeof value.playing !== 'boolean') throw new Error('Invalid native command context.');
    const next = { ...value }, current = this.current;
    if (!current || next.generation > current.generation) this.current = { ...next };
    else if (next.generation < current.generation || next.id !== current.id) throw cancelled();
    else {
      if (next.intent > current.intent) { current.intent = next.intent; current.playing = next.playing; }
      else if (next.intent === current.intent && next.playing !== current.playing) throw cancelled();
      current.seek = Math.max(current.seek, next.seek);
    }
    return next;
  }
  valid(token, command = 'load') {
    const current = this.current;
    return !!current && token.generation === current.generation && token.id === current.id
      && (!['play', 'pause'].includes(command) || token.intent === current.intent && current.playing === (command === 'play'))
      && (command !== 'seek' || token.seek === current.seek);
  }
  check(token, command) { if (!this.valid(token, command)) throw cancelled(); }
}
