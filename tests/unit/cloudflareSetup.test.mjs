// tools/cloudflare-setup.mjs's pure parts (the run itself needs Cloudflare: the infra workflow's dry run)
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, inTheWay, hintFor, lifecycleWith, resendName, ingressOf, TAG, BACKUP_DAYS } from '../../tools/cloudflare-setup.mjs';

test('the plan: the addresses, the buckets, the tunnel routes', () => {
  const P = plan('ognistrada.com');
  assert.equal(P.api, 'api.ognistrada.com');
  assert.equal(P.tilesBucket, 'ognistrada-tiles');
  assert.equal(P.backupsBucket, 'ognistrada-backups');
  assert.deepEqual(P.ingress, [{ hostname: 'api.ognistrada.com', service: 'http://api:8787' }, { hostname: 'rt.ognistrada.com', service: 'http://rt:2567' }, { service: 'http_status:404' }]);
});

test('records in the way: parking A records and stray CNAMEs go; MX and TXT never', () => {
  const parking = [
    { id: 1, type: 'A', name: 'ognistrada.com', content: '192.64.119.1' },
    { id: 2, type: 'MX', name: 'ognistrada.com', content: 'mx.example.com' },
    { id: 3, type: 'TXT', name: 'ognistrada.com', content: 'v=spf1 include:example.com ~all' },
  ];
  const apex = inTheWay(parking, { type: 'CNAME', content: 'ognistrada.pages.dev' }, { apex: true });
  assert.deepEqual(apex.del.map(r => r.id), [1]);
  assert.deepEqual(apex.report, []);           // (on the domain itself a flattened CNAME lives beside MX and TXT)
  const www = inTheWay([{ id: 4, type: 'CNAME', name: 'www.ognistrada.com', content: 'parkingpage.namecheap.com.' }, { id: 5, type: 'TXT', name: 'www.ognistrada.com', content: 'x' }], { type: 'CNAME', content: 'ognistrada.pages.dev' });
  assert.deepEqual(www.del.map(r => r.id), [4]);
  assert.deepEqual(www.report.map(r => r.id), [5]);
  // (ours already: kept)
  assert.deepEqual(inTheWay([{ id: 6, type: 'CNAME', name: 'api.ognistrada.com', content: 'abc.cfargotunnel.com' }], { type: 'CNAME', content: 'ABC.cfargotunnel.com.' }).del, []);
  // (read-only records — R2's own — are left alone)
  assert.deepEqual(inTheWay([{ id: 7, type: 'CNAME', meta: { read_only: true }, content: 'x' }], { type: 'R2' }).del, []);
  // (a TXT name: only a CNAME there is in the way)
  assert.deepEqual(inTheWay([{ id: 8, type: 'CNAME', content: 'x' }, { id: 9, type: 'TXT', content: 'y' }], { type: 'TXT' }).del.map(r => r.id), [8]);
});

test('a refusal names the missing permission', () => {
  assert.match(hintFor('/accounts/a/cfd_tunnel?name=x', 403), /Cloudflare Tunnel → Edit/);
  assert.match(hintFor('/zones/z/rulesets/phases/http_request_dynamic_redirect/entrypoint', 403), /Single Redirect/);
  assert.match(hintFor('/accounts/a/r2/buckets/b', 400, [{ code: 10042 }]), /R2 isn't switched on/);
  assert.equal(hintFor('/zones/z/dns_records', 500), null);
});

test('the backups bucket lifecycle: ours added, anyone else\'s kept, unchanged when right', () => {
  const others = [{ id: 'Default Multipart Abort Rule', enabled: true }];
  const first = lifecycleWith(others);
  assert.equal(first.same, false);
  assert.equal(first.rules.length, 2);
  const ours = first.rules.find(r => r.id.startsWith(TAG));
  assert.equal(ours.deleteObjectsTransition.condition.maxAge, BACKUP_DAYS * 86400);
  assert.equal(lifecycleWith(first.rules).same, true);
});

test('Resend record names and the tunnel routes as Cloudflare returns them', () => {
  assert.equal(resendName('send', 'ognistrada.com'), 'send.ognistrada.com');
  assert.equal(resendName('@', 'ognistrada.com'), 'ognistrada.com');
  assert.equal(resendName('resend._domainkey.ognistrada.com', 'ognistrada.com'), 'resend._domainkey.ognistrada.com');
  assert.deepEqual(ingressOf({ ingress: [{ hostname: 'a', service: 'http://x', originRequest: {} }, { service: 'http_status:404' }] }), [{ hostname: 'a', service: 'http://x' }, { service: 'http_status:404' }]);
});
