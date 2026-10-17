// Steering wheels, pedals and shifters (testtrack/input.js, testtrack/wheelSetup.js), as Chrome reports them: a
// Thrustmaster T300 with its pedals on the base gets its own layout — the throttle drives, the clutch isn't the
// throttle; a shifter on its own USB plug never changes the camera or takes the controls from the wheel; the set-up
// binds whatever moves on whichever device, an H-shifter's gears included, and clears what else was on those
// buttons; a gear held is that gear in the car, none held neutral.
// npm run test:unit
import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.addEventListener ??= () => {};
const { InputManager, DEFAULT_WHEEL, DEFAULT_PAD, DEFAULT_KEYS, DEFAULT_INPUT, wheelProfile, usbIds, deviceKind } = await import('../../testtrack/input.js');
const { createWheelSetup, applyWheelSetup, SETUP_STEPS } = await import('../../testtrack/wheelSetup.js');

const T300 = 'Thrustmaster T300RS Racing wheel (Vendor: 044f Product: b66e)', TH8A = 'Thrustmaster TH8A Shifter (Vendor: 044f Product: b66a)', G29 = 'Logitech G29 Driving Force Racing Wheel (Vendor: 046d Product: c24f)';
// a device as the Gamepad API has it: axes (pedals at +1 released; a hat switch at 1.2857 at rest) and buttons
const device = (id, index, { axes = [0, 1, 0, 0, 0, 1, 1, 0, 0, 1.2857], buttons = 16 } = {}) => ({ id, index, axes: [...axes], buttons: Array.from({ length: buttons }, () => ({ pressed: false, value: 0 })) });
const press = (d, b, on = true) => { d.buttons[b] = { pressed: on, value: on ? 1 : 0 }; };
const settings = () => structuredClone({ input: DEFAULT_INPUT, keys: DEFAULT_KEYS, pad: DEFAULT_PAD, wheel: DEFAULT_WHEEL, toggles: {} });
const manager = (S, pads) => { const I = new InputManager(S, () => pads); I.enabled = true; return I; };

test('the devices: wheels by name, shifters and handbrakes on their own as extras; USB ids from Chrome and Firefox', () => {
  assert.equal(deviceKind(T300), 'wheel'); assert.equal(deviceKind(TH8A), 'extra'); assert.equal(deviceKind('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)'), 'gamepad');
  assert.deepEqual(usbIds(T300), { vendor: '044f', product: 'b66e' }); assert.deepEqual(usbIds('44f-b66e-Thrustmaster T300RS'), { vendor: '044f', product: 'b66e' });
  assert.equal(wheelProfile(T300).name, 'Thrustmaster'); assert.equal(wheelProfile(G29).name, 'Logitech'); assert.equal(wheelProfile(TH8A), null);
});

test('a T300 with its pedals: its layout the first time it\'s seen — the throttle drives, the brake brakes, the clutch is the clutch', () => {
  const S = settings(), wheel = device(T300, 0), I = manager(S, [wheel]);
  let notified = null; I.onProfile = name => { notified = name; };
  I.poll();
  assert.equal(notified, 'Thrustmaster'); assert.ok(S.wheelProfile.startsWith('Thrustmaster'));
  wheel.axes[1] = -1;                 // the throttle all the way down
  let o = I.poll();
  assert.equal(o.device, 'wheel'); assert.equal(o.throttle, 1); assert.equal(o.clutch, 0, 'not the clutch'); assert.equal(o.brake, 0);
  wheel.axes[1] = 1; wheel.axes[5] = 0; wheel.axes[6] = -1; o = I.poll();
  assert.equal(o.throttle, 0); assert.equal(o.brake, 0.5); assert.equal(o.clutch, 1);
  wheel.axes[0] = -0.5; assert.equal(I.poll().steer, 0.5, 'turned left: + left');
  press(wheel, 0); assert.ok(I.poll().pressed.has('shiftUp'), 'the right paddle shifts up'); press(wheel, 0, false); I.poll();
  // (rebound afterwards: kept — the layout's only given once)
  S.wheel.throttle = { type: 'axis', index: 2, rest: 1, full: -1 }; I.poll();
  assert.equal(S.wheel.throttle.index, 2);
});

test('a shifter on its own USB plug: its buttons don\'t change the camera, and it never takes the controls from the wheel', () => {
  const S = settings(), wheel = device(T300, 0), shifter = device(TH8A, 1, { axes: [], buttons: 12 }), I = manager(S, [wheel, shifter]);
  wheel.axes[1] = -1; I.poll(); wheel.axes[1] = 1;
  for (let b = 0; b < 12; b++) { press(shifter, b); const o = I.poll(); assert.equal(o.pressed.size, 0, `shifter button ${b}: nothing`); assert.equal(o.device, 'wheel'); press(shifter, b, false); I.poll(); }
  // (a gamepad's buttons alone don't take it either; its stick does)
  const pad = device('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 2, { axes: [0, 0, 0, 0] });
  const J = manager(settings(), [wheel, pad]); wheel.axes[1] = -1; J.poll(); wheel.axes[1] = 1;
  press(pad, 3); assert.equal(J.poll().device, 'wheel'); press(pad, 3, false);
  pad.axes[0] = 0.9; assert.equal(J.poll().device, 'gamepad');
});

test('the set-up: the wheel, each pedal (its own rest and travel), the paddles, an H-shifter on its own device — then a gear held is that gear', () => {
  const wheel = device(T300, 0), shifter = device(TH8A, 1, { axes: [], buttons: 12 }), devs = () => [wheel, shifter].map(d => ({ id: d.id, index: d.index, kind: deviceKind(d.id), axes: [...d.axes], buttons: d.buttons.map(b => b.pressed) }));
  const W = createWheelSetup(), feed = () => W.feed(devs());
  const step = () => W.step?.id;
  feed();                                                        // (where everything rests)
  wheel.axes[0] = -0.6; assert.ok(feed()); assert.equal(step(), 'throttle'); wheel.axes[0] = 0;
  feed(); wheel.axes[1] = 0.6; feed(); wheel.axes[1] = -0.98; feed(); assert.equal(step(), 'throttle', 'held: not yet'); wheel.axes[1] = 1; assert.ok(feed());
  assert.deepEqual(W.found.throttle, { type: 'axis', index: 1, rest: 1, full: -0.921, dev: T300 });
  feed(); wheel.axes[5] = -1; feed(); wheel.axes[5] = 1; feed(); assert.equal(W.found.brake.index, 5);
  feed(); W.skip(); assert.equal(step(), 'shiftUp', 'no clutch');
  feed(); press(wheel, 4); feed(); press(wheel, 4, false); assert.equal(W.found.shiftUp.index, 4);
  feed(); press(wheel, 5); feed(); press(wheel, 5, false);
  feed(); W.skip(); assert.equal(step(), 'hShifter');
  W.answer(true);
  for (let g = 0; g < 6; g++) { feed(); press(shifter, g); feed(); press(shifter, g, false); }
  assert.equal(step(), 'gear7'); W.skip(); feed(); press(shifter, 7); feed();
  assert.ok(W.done);
  assert.equal(W.found.gear1.dev, TH8A); assert.equal(W.found.gearR.index, 7); assert.equal(W.found.gear7, undefined);
  // into the settings: and what else was on those buttons cleared (the wheel's camera was its button 2…)
  const S = settings(); S.pad.camera = { type: 'button', index: 3, dev: TH8A };
  applyWheelSetup(S, W.found);
  assert.equal(S.pad.camera, null, 'the shifter\'s button no longer the camera'); assert.equal(S.wheel.clutch, null); assert.equal(S.wheel.steer.index, 0); assert.equal(S.wheel.steer.invert, false);
  // driving: 3rd held is 3rd, none held neutral
  S.wheelProfile = 'set'; const I = manager(S, [wheel, shifter]);
  wheel.axes[1] = -1; I.poll(); wheel.axes[1] = 1;
  press(shifter, 2); assert.equal(I.poll().gear, 3);
  press(shifter, 2, false); press(shifter, 7); assert.equal(I.poll().gear, -1);
  press(shifter, 7, false); assert.equal(I.poll().gear, 0, 'neutral');
  assert.equal(SETUP_STEPS.at(-1).id, 'gearR');
});
