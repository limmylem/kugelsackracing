// Placeholder cars: until a car's real model is made, the starter coupe's model reshaped to the car's design
// (data/cars/<id>/design.json; tools/content/coupeCar.mjs) — its body, glass and lights, dashboard and every panel in
// the car's proportions, every socket node the car uses, and its stock parts' meshes under their sockets (panels,
// wheels, seats, steering wheel, engine, exhaust tip), laid out like a modelled car's source, so npm run import checks
// it and splits it into the body and the stock part models the same way.
//
//   const doc = await placeholderCar(design)          (tools/placeholder-car.mjs writes incoming/car_<id>.glb)
//   carSockets(design) → { name: { position, rotation? } }: where each socket goes (car.json matches)
//
// design (metres, car frame: +z forward, +x left, +y up, the ground at y = 0):
//   { id, style: coupe | roadster | suv | hatch | muscle | sedan | mid, length, width, height, clearance,
//     beltline, frontAxle, rearAxle, track, wheel: { radius, rimDiameter (inches), width },
//     bonnet: { rear (z: the windscreen's foot), front (y at the nose), back (y at the windscreen) },
//     roof: { front, rear (z), height }, deck: { front (z), height }, engine: { at, size },
//     paint (#rrggbb), convertible, engineCover (a mid engine's lid), frontDrive (its differential at the
//     front axle), extraSockets ({ name: position }: the car's own), sockets (the socket nodes to make:
//     car.json's; all of them if it's missing) }

import { coupeCar } from './coupeCar.mjs';

const round = v => +v.toFixed(3);
const HALF_TURN_Y = [0, 1, 0, 0];
const quatX = deg => { const a = deg * Math.PI / 360; return [Math.sin(a), 0, 0, Math.cos(a)]; };

// Where every socket goes, from the design (the model's panels' sockets then go where its reshaped panels are:
// coupeCar; tools/placeholder-car.mjs puts the model's positions in car.json)
export function carSockets(D) {
  const W = D.width, L = D.length, half = W / 2, s = W / 1.74, fa = D.frontAxle, ra = D.rearAxle, r = D.wheel.radius, t = D.track / 2;
  const seatZ = D.seatZ ?? (D.roof.front + D.roof.rear) / 2 - 0.15, seatY = D.floor ?? D.clearance + 0.1;
  const E = D.engine.at, mid = E[2] < 0, belt = D.beltline;
  const out = {
    socket_wheel_FL: [t, r, fa], socket_wheel_FR: [-t, r, fa], socket_wheel_RL: [t, r, ra], socket_wheel_RR: [-t, r, ra],
    socket_bonnet: [0, D.bonnet.back, D.bonnet.rear],
    socket_boot: [0, D.deck.height, D.deck.front],
    socket_bumper_front: [0, D.clearance + 0.14, L / 2 - 0.05], socket_bumper_rear: [0, D.clearance + 0.14, -L / 2 + 0.05],
    socket_spoiler: [0, D.deck.height, -L / 2 + 0.12],
    // (doors hang from their front edge, halfway up; wings bolt on at their inner top edge)
    socket_door_left: [half - 0.01, (D.clearance + 0.12 + belt) / 2, D.doorFront ?? D.bonnet.rear - 0.05], socket_door_right: [-half + 0.01, (D.clearance + 0.12 + belt) / 2, D.doorFront ?? D.bonnet.rear - 0.05],
    socket_fender_FL: [half - 0.1, belt, fa + 0.1], socket_fender_FR: [-half + 0.1, belt, fa + 0.1],
    socket_skirt_left: [half - 0.03, D.clearance + 0.06, (fa + ra) / 2], socket_skirt_right: [-half + 0.03, D.clearance + 0.06, (fa + ra) / 2],
    socket_mirror_left: [half - 0.06, belt + 0.1, D.bonnet.rear - 0.12], socket_mirror_right: [-half + 0.06, belt + 0.1, D.bonnet.rear - 0.12],
    socket_seat_driver: [0.38 * s, seatY, seatZ], socket_seat_passenger: [-0.38 * s, seatY, seatZ],
    socket_steering_wheel: [0.38 * s, belt + 0.06, seatZ + 0.55],
    socket_engine: [E[0], E[1] - D.engine.size[1] / 2, E[2]], socket_pistons: [E[0], E[1] + 0.15, E[2]],        // (the engine sits on its mounts: its origin at the middle of its base)
    socket_intake: [E[0] + 0.24 * s, E[1] + 0.26, E[2]], socket_turbo: [E[0] - 0.26 * s, E[1] + 0.2, E[2]],
    socket_header: [E[0] + 0.2 * s, E[1] + 0.05, E[2] - (mid ? -0.1 : 0.05)],
    socket_intercooler: mid ? [0, D.clearance + 0.25, ra - 0.45] : [0, D.clearance + 0.25, L / 2 - 0.25],
    socket_exhaust_tip: [-0.45 * s, D.clearance + 0.05, -L / 2 + 0.05], socket_exhaust: [0.15 * s, D.clearance + 0.05, mid ? ra + 0.3 : (fa + ra) / 2 - 0.3],
    socket_ecu: [0.3 * s, belt - 0.1, D.bonnet.rear - 0.06],
    socket_gearbox: mid ? [0, E[1] + 0.05, E[2] - 0.55] : [0, D.clearance + 0.2, E[2] - 0.8], socket_clutch: mid ? [0, E[1] + 0.1, E[2] - 0.35] : [0, D.clearance + 0.25, E[2] - 0.6],
    socket_flywheel: mid ? [0, E[1] + 0.1, E[2] - 0.28] : [0, D.clearance + 0.25, E[2] - 0.53],
    socket_differential: [0, r, D.frontDrive ? fa - 0.05 : ra], socket_diff_front: [0, r, fa - 0.05], socket_centre_diff: [0, D.clearance + 0.15, (fa + ra) / 2 + 0.3], socket_transfer_case: [0, D.clearance + 0.2, (fa + ra) / 2 + 0.2],
    socket_suspension: [0, r + 0.1, (fa + ra) / 2], socket_arb_front: [0, D.clearance + 0.05, fa], socket_arb_rear: [0, D.clearance + 0.05, ra],
    socket_brakes: [0, r, (fa + ra) / 2], socket_brake_pads: [0, r, (fa + ra) / 2],
    socket_weight_rear_seats: [0, seatY + 0.05, seatZ - 0.55], socket_weight_sound_deadening: [0, seatY + 0.1, seatZ + 0.05],
    socket_roof: [0, D.roof.height, (D.roof.front + D.roof.rear) / 2],
    socket_engine_cover: [0, D.deck.height, D.engineCover ?? D.roof.rear - 0.1],
    socket_radiator: mid ? [0, D.clearance + 0.3, L / 2 - 0.35] : [0, D.clearance + 0.35, L / 2 - 0.3],
    socket_cage: [0, seatY + 0.5, seatZ - 0.1], socket_harness: [0.38 * s, seatY + 0.45, seatZ - 0.2], socket_gauges: [0.38 * s, belt + 0.12, seatZ + 0.75], socket_shifter: [0, seatY + 0.3, seatZ + 0.35],
    socket_strut_brace: [0, belt - 0.02, mid ? ra : fa], socket_window_tint: [0, D.roof.height - 0.25, (D.roof.front + D.roof.rear) / 2], socket_tyre_smoke: [0, 0.05, ra],
    socket_underglow: [0, D.clearance, (fa + ra) / 2], socket_fog_lights: [0, D.clearance + 0.12, L / 2 - 0.03],
    socket_engine_swap: [E[0], E[1] - 0.12, E[2]], socket_supercharger: [E[0], E[1] + D.engine.size[1] / 2 + 0.12, E[2] + (mid ? -0.1 : 0.1)],
    ...D.extraSockets,
  };
  const rot = { socket_wheel_FR: HALF_TURN_Y, socket_wheel_RR: HALF_TURN_Y, socket_steering_wheel: quatX(D.columnDeg ?? 30) };
  return Object.fromEntries(Object.entries(out).map(([k, p]) => [k, { position: p.map(round), ...(rot[k] && { rotation: rot[k] }) }]));
}

// The model: the starter coupe's, reshaped to the design (tools/content/coupeCar.mjs)
export const placeholderCar = D => coupeCar(D);
