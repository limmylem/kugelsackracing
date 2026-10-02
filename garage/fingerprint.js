// A build's fingerprint: a hash of everything that decides its physics — the car, the part in each
// socket, each part's condition, tuning and mechanical damage, and whether it's hanging loose or torn
// off (not its paint or finish, which only change how it looks).
// The same fingerprint means the same physics spec. Plain JavaScript, the same in the page and Node.

// owned: the garage's owned parts ({ instanceId: { partId, condition, tuning, damage, attach } })
export function fingerprint(build, owned) {
  const sockets = Object.keys(build.sockets || {}).sort().map(s => {
    const inst = build.sockets[s] ? owned[build.sockets[s]] : null;
    if (!inst) return [s, null];
    const tuning = Object.keys(inst.tuning || {}).sort().map(k => [k, inst.tuning[k]]);
    // (mechanical damage too, and loose or torn off, when it has any: a copy with none hashes as it always has)
    const out = inst.damage && Object.keys(inst.damage).length ? [s, inst.partId, inst.condition ?? 100, tuning, sorted(inst.damage)] : [s, inst.partId, inst.condition ?? 100, tuning];
    if (inst.attach && inst.attach !== 'attached') out.push(inst.attach);
    return out;
  });
  return hash(JSON.stringify([build.carId, sockets]));
}

const sorted = v => v && typeof v === 'object' ? Object.keys(v).sort().map(k => [k, sorted(v[k])]) : v;

// cyrb53: a fast 53-bit string hash, as 14 hex digits
export function hash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}
