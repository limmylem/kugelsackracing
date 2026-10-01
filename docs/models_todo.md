# Models to make

Made by `npm run models-todo` from the car and part data (each one's `modelTodo`): 7 cars and 67 parts are drawn as placeholders until their model is made. Sizes are the placeholder boxes' (the part's bounds, in its socket's frame: +z forward, +x left, +y up). Positions are in the car's frame, metres, the ground at y = 0. A part's model has its origin at its socket. Make one, then `npm run import -- incoming/<type>_<name>.glb` (a car: `incoming/car_<id>.glb`, its parts under their socket nodes).

Variants (sizes and finishes of a rim, a tyre in more sizes) use their base part's model: only the base is listed.

## Kaze GT (`kaze_gt`)

**The car** — Kaze GT, a sports coupe: A light 2+2 coupe with a flat-four up front driving the rear wheels: playful, balanced and easy to drift. About 4.24 × 1.78 × 1.29 m, wheelbase 2.57 m. Until it's made: a placeholder from data/cars/kaze_gt/design.json (node tools/placeholder-car.mjs kaze_gt --import).

- body: 4.24 × 1.78 × 1.29 m (l × w × h), 0.13 m ground clearance; axles at z = 1.25 and -1.32, track 1.52 m; wheels 17" rims, 626 mm across the tyre
- collider: centre [0, 0.75, 0], half extents [0.85, 0.5, 2.09]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_front_lip`, `socket_canards`, `socket_widebody`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Canards (Kaze GT)** (`kaze_gt_canards`) — Kaze GT canards: two pairs of small carbon dive planes (about 25 × 8 cm each) on the front bumper corners.
  - size: 180 × 12 × 25 cm (w × h × l) · mass 1.2 kg · goes on `socket_canards` at [0, 0.4, 1.98]
- **Front lip (Kaze GT)** (`kaze_gt_front_lip`) — Kaze GT front lip: a 160 cm carbon blade, 18 cm deep, following the underside of the front bumper.
  - size: 160 × 5 × 18 cm (w × h × l) · mass 3 kg · goes on `socket_front_lip` at [0, 0.15, 2.07]
- **Side skirt, left (Kaze GT)** (`kaze_gt_side_skirt_left`) — Kaze GT left side skirt: a 260 cm moulded sill extension, 14 cm tall, a small splitter edge at the bottom.
  - size: 8 × 14 × 260 cm (w × h × l) · mass 3 kg · goes on `socket_skirt_left` at [0.86, 0.19, -0.04]
- **Side skirt, right (Kaze GT)** (`kaze_gt_side_skirt_right`) — Kaze GT right side skirt: a 260 cm moulded sill extension, 14 cm tall, a small splitter edge at the bottom.
  - size: 6 × 14 × 260 cm (w × h × l) · mass 3 kg · goes on `socket_skirt_right` at [-0.86, 0.19, -0.04]
- **Ducktail spoiler (Kaze GT)** (`kaze_gt_ducktail`) — Kaze GT ducktail: a flip-up lip across the boot lid edge, 130 cm wide, 8 cm tall.
  - size: 130 cm span × 9 cm tall × 15 cm chord · mass 3 kg · goes on `socket_spoiler` at [0, 0.92, -2]
- **GT wing (Kaze GT)** (`kaze_gt_gt_wing`) — Kaze GT GT wing: a 150 cm carbon aerofoil (30 cm chord) with end plates on two swan-neck uprights 28 cm tall.
  - size: 150 cm span × 31 cm tall × 30 cm chord · mass 6 kg · goes on `socket_spoiler` at [0, 0.92, -2]
- **Supercharger kit (Kaze GT flat-four)** (`kaze_gt_supercharger`) — Kaze GT supercharger: a centrifugal compressor (22 cm) on a bracket at the front of the flat-four, belt-driven, with a pipe over the engine to the intake.
  - size: 26 × 22 × 26 cm (w × h × l) · mass 17 kg · goes on `socket_supercharger` at [0, 0.68, 1.22]
- **Turbo kit (Kaze GT flat-four)** (`kaze_gt_turbo_kit`) — Kaze GT turbo kit: a twin-scroll turbo (25 cm) with equal-length stainless manifold pipes from both cylinder banks, under the front of the flat-four.
  - size: 30 × 26 × 30 cm (w × h × l) · mass 20 kg · goes on `socket_turbo` at [-0.27, 0.56, 1.12]
- **Widebody kit (Kaze GT)** (`kaze_gt_widebody`) — Kaze GT widebody kit: four bolt-on fender flares, 6 cm wider each side, riveted over the arches, with matching skirt extensions.
  - size: 205 × 35 × 300 cm (w × h × l) · mass 14 kg · goes on `socket_widebody` at [0, 0.7, 0]

## Hana Roadster (`hana_roadster`)

**The car** — Hana Roadster, a roadster: A light two-seat roadster, its soft top down in a moment: nimble, and it leans into every corner. About 3.95 × 1.72 × 1.23 m, wheelbase 2.31 m. Until it's made: a placeholder from data/cars/hana_roadster/design.json (node tools/placeholder-car.mjs hana_roadster --import).

- body: 3.95 × 1.72 × 1.23 m (l × w × h), 0.12 m ground clearance; axles at z = 1.08 and -1.23, track 1.49 m; wheels 16" rims, 602 mm across the tyre
- collider: centre [0, 0.71, 0], half extents [0.82, 0.47, 1.95]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_roof`, `socket_front_lip`, `socket_widebody`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Front lip (Hana Roadster)** (`hana_roadster_front_lip`) — Hana Roadster front lip: a 150 cm black lip, 16 cm deep, under the front bumper.
  - size: 150 × 5 × 16 cm (w × h × l) · mass 2.5 kg · goes on `socket_front_lip` at [0, 0.14, 1.93]
- **Roll hoop (Hana Roadster)** (`hana_roadster_roll_hoop`) — Hana Roadster roll hoop: a 45 mm tube hoop behind both seats, 120 cm wide and 75 cm tall, with two short braces back to the deck.
  - size: 120 × 75 × 20 cm (w × h × l) · mass 11 kg · goes on `socket_cage` at [0, 0.69, -0.6]
- **Removable hardtop (Hana Roadster)** (`hana_roadster_hardtop`) — Hana Roadster hardtop: a fibreglass hard roof with a glass rear window, about 140 × 30 × 90 cm, over the cockpit.
  - size: 140 × 30 × 90 cm (w × h × l) · mass 32 kg · goes on `socket_roof` at [0, 1.23, -0.47]
- **Small wing (Hana Roadster)** (`hana_roadster_wing`) — Hana Roadster small wing: a 120 cm aerofoil (20 cm chord) on two short uprights (12 cm) on the rear deck.
  - size: 120 cm span × 15 cm tall × 20 cm chord · mass 3.5 kg · goes on `socket_spoiler` at [0, 0.86, -1.85]
- **Turbo kit (Hana Roadster)** (`hana_roadster_turbo_kit`) — Hana Roadster turbo kit: a small turbo (20 cm) on a cast manifold at the side of the four-cylinder, with its intake pipe.
  - size: 26 × 24 × 26 cm (w × h × l) · mass 18 kg · goes on `socket_turbo` at [-0.26, 0.65, 0.92]
- **Widebody kit (Hana Roadster)** (`hana_roadster_widebody`) — Hana Roadster widebody kit: four round bolt-on fender flares, 5 cm wider each side, over the arches.
  - size: 205 × 35 × 300 cm (w × h × l) · mass 12 kg · goes on `socket_widebody` at [0, 0.65, 0]

## Ridgeback 4x4 (`ridgeback_4x4`)

**The car** — Ridgeback 4x4, a off-roader: A body-on-frame 4x4 with a V6, a two-speed transfer case and a lockable rear diff: slow and wallowy on tarmac, unstoppable off it. About 4.75 × 1.9 × 1.84 m, wheelbase 2.79 m. Until it's made: a placeholder from data/cars/ridgeback_4x4/design.json (node tools/placeholder-car.mjs ridgeback_4x4 --import).

- body: 4.75 × 1.9 × 1.84 m (l × w × h), 0.28 m ground clearance; axles at z = 1.45 and -1.34, track 1.6 m; wheels 17" rims, 802 mm across the tyre
- collider: centre [0, 1.1, 0], half extents [0.91, 0.7, 2.35]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_diff_front`, `socket_transfer_case`, `socket_bull_bar`, `socket_snorkel`, `socket_winch`, `socket_roof_rack`, `socket_light_bar`, `socket_skid_plates`, `socket_rock_sliders`, `socket_lift_kit`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Steel bull bar (Ridgeback 4x4)** (`ridgeback_4x4_bull_bar`) — Ridgeback bull bar: a 60 mm steel tube frame across the front, 175 cm wide and 70 cm tall, a centre hoop and light mounts.
  - size: 175 × 70 × 25 cm (w × h × l) · mass 38 kg · goes on `socket_bull_bar` at [0, 0.75, 2.42]
- **2-inch lift kit (Ridgeback 4x4)** (`ridgeback_4x4_lift_kit_2in`) — Ridgeback 2-inch lift kit: taller coil springs with 2-inch spacer blocks and longer shock absorbers at each corner (drawn as a frame the car's size under it).
  - size: 150 × 10 × 280 cm (w × h × l) · mass 14 kg · goes on `socket_lift_kit` at [0, 0.55, 0]
- **4-inch lift kit (Ridgeback 4x4)** (`ridgeback_4x4_lift_kit_4in`) — Ridgeback 4-inch lift kit: taller coil springs with 4-inch spacer blocks and longer shock absorbers at each corner (drawn as a frame the car's size under it).
  - size: 150 × 10 × 280 cm (w × h × l) · mass 26 kg · goes on `socket_lift_kit` at [0, 0.55, 0]
- **LED light bar (Ridgeback 4x4)** (`ridgeback_4x4_light_bar`) — Ridgeback LED light bar: a 120 cm straight light bar (8 cm tall) with brackets, on the front of the roof.
  - size: 120 × 8 × 10 cm (w × h × l) · mass 4 kg · goes on `socket_light_bar` at [0, 1.88, 0.35]
- **Rock sliders (Ridgeback 4x4)** (`ridgeback_4x4_rock_sliders`) — Ridgeback rock sliders: two 50 mm steel tube rails along the sills (260 cm long), bolted to the frame.
  - size: 195 × 10 × 260 cm (w × h × l) · mass 20 kg · goes on `socket_rock_sliders` at [0, 0.33, 0.05]
- **Roof rack (Ridgeback 4x4)** (`ridgeback_4x4_roof_rack`) — Ridgeback roof rack: a flat tube-frame basket, 130 × 180 cm, 12 cm tall, on four feet on the roof.
  - size: 130 × 12 × 180 cm (w × h × l) · mass 18 kg · goes on `socket_roof_rack` at [0, 1.86, -0.6]
- **Skid plates (Ridgeback 4x4)** (`ridgeback_4x4_skid_plates`) — Ridgeback skid plates: 5 mm steel plates bolted under the engine, gearbox and transfer case, about 110 × 250 cm (a flat shape under the car).
  - size: 110 × 2 × 250 cm (w × h × l) · mass 22 kg · goes on `socket_skid_plates` at [0, 0.3, 1.1]
- **Snorkel (Ridgeback 4x4)** (`ridgeback_4x4_snorkel`) — Ridgeback snorkel: a 9 cm black pipe from the right front wing up the windscreen pillar to a ram head at roof height, about 1.1 m tall.
  - size: 12 × 110 × 20 cm (w × h × l) · mass 4 kg · goes on `socket_snorkel` at [-0.9, 1.35, 0.85]
- **Recovery winch (Ridgeback 4x4)** (`ridgeback_4x4_winch`) — Ridgeback winch: a drum winch (50 × 20 × 20 cm) with a fairlead and hook, mounted in the bull bar or bumper.
  - size: 50 × 20 × 20 cm (w × h × l) · mass 35 kg · goes on `socket_winch` at [0, 0.55, 2.36]

## Vortex R (`vortex_r`)

**The car** — Vortex R, a hot hatch: A turbocharged hot hatch: grippy and quick, it tugs at the wheel under full power and runs wide at the limit. About 4.3 × 1.8 × 1.45 m, wheelbase 2.64 m. Until it's made: a placeholder from data/cars/vortex_r/design.json (node tools/placeholder-car.mjs vortex_r --import).

- body: 4.3 × 1.8 × 1.45 m (l × w × h), 0.12 m ground clearance; axles at z = 1.35 and -1.29, track 1.55 m; wheels 18" rims, 638 mm across the tyre
- collider: centre [0, 0.82, 0], half extents [0.86, 0.58, 2.12]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_front_lip`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Front splitter (Vortex R)** (`vortex_r_front_splitter`) — Vortex R front splitter: a 170 cm flat carbon splitter sticking out 12 cm under the front bumper, on two small struts.
  - size: 170 × 3 × 22 cm (w × h × l) · mass 3.5 kg · goes on `socket_front_lip` at [0, 0.14, 2.1]
- **Rear roof wing (Vortex R)** (`vortex_r_roof_wing`) — Vortex R roof wing: a 115 cm spoiler (22 cm chord) off the rear roof edge, over the tailgate, with side plates.
  - size: 115 cm span × 8 cm tall × 22 cm chord · mass 3.5 kg · goes on `socket_spoiler` at [0, 1.43, -1.6]
- **Big turbo upgrade (Vortex R)** (`vortex_r_big_turbo`) — Vortex R big turbo: a larger turbo (26 cm) with a bigger compressor inlet, at the back of the transverse four.
  - size: 30 × 26 × 28 cm (w × h × l) · mass 6 kg · goes on `socket_turbo` at [-0.27, 0.7, 1.28]

## Brute 500 (`brute_500`)

**The car** — Brute 500, a muscle car: A big V8 muscle car: huge torque and easy burnouts, heavy and a bit clumsy when the road bends. About 4.8 × 1.92 × 1.38 m, wheelbase 2.72 m. Until it's made: a placeholder from data/cars/brute_500/design.json (node tools/placeholder-car.mjs brute_500 --import).

- body: 4.8 × 1.92 × 1.38 m (l × w × h), 0.13 m ground clearance; axles at z = 1.42 and -1.3, track 1.6 m; wheels 19" rims, 686 mm across the tyre
- collider: centre [0, 0.8, 0], half extents [0.92, 0.55, 2.37]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_widebody`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Scoop bonnet (Brute 500)** (`brute_500_bonnet_scoop`) — Brute 500 scoop bonnet: the stock bonnet shape (150 × 115 cm) with a raised open scoop 60 cm wide and 12 cm tall in the middle.
  - size: 150 × 20 × 115 cm (w × h × l) · mass 16 kg · goes on `socket_bonnet` at [0, 0.95, 0.5]
- **Supercharger with bonnet scoop (Brute 500)** (`brute_500_supercharger`) — Brute 500 supercharger: a twin-screw blower (55 × 45 × 25 cm) on top of the V8, with a throttle body facing forward into the bonnet scoop.
  - size: 45 × 25 × 55 cm (w × h × l) · mass 32 kg · goes on `socket_supercharger` at [0, 0.92, 1.25]
- **Wide rear arches (Brute 500)** (`brute_500_widebody`) — Brute 500 wide rear arches: two bolt-on rear fender flares, 5 cm wider each side, over the rear wheels.
  - size: 204 × 35 × 120 cm (w × h × l) · mass 9 kg · goes on `socket_widebody` at [0, 0.75, -1.3]

## Strada Evo (`strada_evo`)

**The car** — Strada Evo, a rally saloon: A turbocharged four-wheel-drive saloon born on the stages: an adjustable centre diff, and brilliant on gravel. About 4.5 × 1.77 × 1.45 m, wheelbase 2.63 m. Until it's made: a placeholder from data/cars/strada_evo/design.json (node tools/placeholder-car.mjs strada_evo --import).

- body: 4.5 × 1.77 × 1.45 m (l × w × h), 0.15 m ground clearance; axles at z = 1.37 and -1.26, track 1.52 m; wheels 17" rims, 644 mm across the tyre
- collider: centre [0, 0.84, 0], half extents [0.84, 0.57, 2.22]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_diff_front`, `socket_centre_diff`, `socket_rally_lights`, `socket_mud_flaps`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Mud flaps (Strada Evo)** (`strada_evo_mud_flaps`) — Strada Evo mud flaps: four red rubber flaps (30 × 35 cm) behind the wheels with the car's name on them.
  - size: 170 × 35 × 2 cm (w × h × l) · mass 3 kg · goes on `socket_mud_flaps` at [0, 0.22, -1.72]
- **Rally lights pod (Strada Evo)** (`strada_evo_rally_lights`) — Strada Evo rally lights pod: a black pod (110 × 22 × 15 cm) holding four 15 cm round spot lamps, strapped on the front of the bonnet.
  - size: 110 × 22 × 15 cm (w × h × l) · mass 6 kg · goes on `socket_rally_lights` at [0, 0.78, 1.95]
- **Large rear wing (Strada Evo)** (`strada_evo_rear_wing`) — Strada Evo large rear wing: a 140 cm aerofoil (26 cm chord) with big end plates on two uprights (20 cm) on the boot lid.
  - size: 140 cm span × 23 cm tall × 26 cm chord · mass 5 kg · goes on `socket_spoiler` at [0, 1, -2.13]

## Apex V8 (`apex_v8`)

**The car** — Apex V8, a supercar: A mid-engined twin-turbo V8 supercar with a seven-speed paddle-shift gearbox and big aero: fast, and demanding. About 4.55 × 1.93 × 1.2 m, wheelbase 2.67 m. Until it's made: a placeholder from data/cars/apex_v8/design.json (node tools/placeholder-car.mjs apex_v8 --import).

- body: 4.55 × 1.93 × 1.2 m (l × w × h), 0.1 m ground clearance; axles at z = 1.45 and -1.22, track 1.63 m; wheels 20" rims, 694 mm across the tyre
- collider: centre [0, 0.69, 0], half extents [0.93, 0.47, 2.25]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_engine_cover`, `socket_aero_kit`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Carbon aero kit (Apex V8)** (`apex_v8_aero_kit`) — Apex V8 carbon aero kit: a front splitter (190 cm), two pairs of dive planes, carbon side blades and a big rear diffuser with five strakes — drawn as a frame the car's size.
  - size: 195 × 25 × 430 cm (w × h × l) · mass 7 kg · goes on `socket_aero_kit` at [0, 0.12, 0]
- **Carbon engine cover (Apex V8)** (`apex_v8_carbon_engine_cover`) — Apex V8 carbon engine cover: a louvred carbon lid (150 × 110 cm) with a glass panel showing the engine, hinged at the front.
  - size: 150 × 5 × 110 cm (w × h × l) · mass 5 kg · goes on `socket_engine_cover` at [0, 0.95, -0.8]
- **Active rear wing (Apex V8)** (`apex_v8_active_wing`) — Apex V8 active wing: a 150 cm carbon aerofoil (30 cm chord) on two hydraulic struts rising from the engine cover (up to 25 cm).
  - size: 150 cm span × 23 cm tall × 30 cm chord · mass 7 kg · goes on `socket_spoiler` at [0, 0.95, -2.15]

## Parts for every car

Each goes on every car it fits (its socket there is listed per car in the car's data); one model for all of them, at the size below.

### exhaust

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Cat-back exhaust (street)** (`catback_street`) — Cat-back exhaust (street): the tail pipe (a 90 mm tip) out of the rear bumper, 20 cm of pipe, origin at the tip.
  - size: 9 × 9 × 20 cm (w × h × l) · mass 14 kg · goes on slot `exhaust`
- **Cat-back exhaust, stainless (sport)** (`catback_sport`) — Cat-back exhaust, stainless (sport): the tail pipe (a 90 mm tip) out of the rear bumper, 20 cm of pipe, origin at the tip.
  - size: 9 × 9 × 20 cm (w × h × l) · mass 11 kg · goes on slot `exhaust`
- **Straight-through race exhaust** (`catback_race`) — Straight-through race exhaust: the tail pipes (twin 90 mm tips) out of the rear bumper, 20 cm of pipe, origin at the tip.
  - size: 9 × 9 × 20 cm (w × h × l) · mass 8 kg · goes on slot `exhaust`

### fog lights

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Round fog lights** (`fog_lights_round`) — Round fog lights: two 10 cm round lamps with chrome bezels, 110 cm apart, low in the front bumper.
  - size: 120 × 10 × 8 cm (w × h × l) · mass 1.5 kg · goes on slot `fog_lights`
- **Yellow fog lights** (`fog_lights_yellow`) — Yellow fog lights: two 14 × 7 cm rectangular lamps with yellow lenses, 110 cm apart, low in the front bumper.
  - size: 120 × 8 × 8 cm (w × h × l) · mass 1.6 kg · goes on slot `fog_lights`

### gauges

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Gauge pod (boost, oil, water)** (`gauge_pod`) — An A-pillar gauge pod: three 52 mm round gauges stacked in a moulded pod, about 8 × 26 × 8 cm.
  - size: 8 × 26 × 8 cm (w × h × l) · mass 0.8 kg · goes on slot `gauges`

### harness

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Race harness (6-point)** (`race_harness`) — A six-point harness: two shoulder straps, lap belts and crotch straps in red webbing, laid over a bucket seat.
  - size: 40 × 70 × 10 cm (w × h × l) · mass 2 kg · goes on slot `harness`

### intercooler

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Front-mount intercooler** (`front_mount_intercooler`) — A front-mount intercooler: a finned core about 60 × 24 × 6 cm with two pipes out of its ends, sitting behind the front bumper.
  - size: 60 × 24 × 6 cm (w × h × l) · mass 9 kg · goes on slot `intercooler`
- **Race intercooler (bar and plate)** (`intercooler_race`) — A big bar-and-plate intercooler core about 68 × 28 × 8 cm with end tanks and pipes, behind the front bumper.
  - size: 68 × 28 × 8 cm (w × h × l) · mass 12 kg · goes on slot `intercooler`

### radiator

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Aluminium radiator** (`radiator_aluminium`) — Aluminium radiator: an aluminium radiator core about 64 × 40 × 6 cm with its fan shroud, behind the front bumper.
  - size: 64 × 40 × 6 cm (w × h × l) · mass 1 kg · goes on slot `radiator`
- **Race radiator and oil cooler** (`radiator_race`) — Race radiator and oil cooler: an aluminium radiator core about 64 × 40 × 6 cm with its fan shroud, behind the front bumper.
  - size: 64 × 40 × 6 cm (w × h × l) · mass 3 kg · goes on slot `radiator`

### roll cage

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Bolt-in roll cage** (`roll_cage_bolt_in`) — A bolt-in roll cage: 40 mm tubes — a main hoop behind the seats, two A-pillar bars, a diagonal and two rear stays, about 130 × 90 × 150 cm.
  - size: 130 × 90 × 150 cm (w × h × l) · mass 28 kg · goes on slot `roll_cage`
- **Welded race cage** (`roll_cage_welded`) — A welded race cage: 45 mm tubes — main hoop, A-pillar bars, door bars, a roof X and rear stays, about 135 × 95 × 190 cm.
  - size: 135 × 95 × 190 cm (w × h × l) · mass 42 kg · goes on slot `roll_cage`

### seat

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Sport bucket seat** (`bucket_seat_street`) — A sport bucket seat: a fixed-back shell with side bolsters and harness slots, about 50 × 95 × 72 cm.
  - size: 50 × 95 × 72 cm (w × h × l) · mass 11 kg · goes on slot `seat`
- **Carbon race bucket** (`bucket_seat_race`) — A carbon race bucket: a deep one-piece shell with head wings and harness slots, about 50 × 95 × 72 cm.
  - size: 50 × 95 × 72 cm (w × h × l) · mass 5 kg · goes on slot `seat`

### shifter

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Short shifter** (`short_shifter`) — A short shift lever: a 20 cm metal stalk with a round knob and a small gaiter plate.
  - size: 5 × 25 × 5 cm (w × h × l) · mass 0.5 kg · goes on slot `shifter`

### steering wheel

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Quick-release steering wheel** (`quick_release_wheel`) — A 350 mm suede-rimmed steering wheel with three flat spokes on a quick-release boss (origin at the column).
  - size: 35 × 35 × 7 cm (w × h × l) · mass 1.2 kg · goes on slot `steering_wheel`

### strut brace

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Front strut brace** (`strut_brace`) — A strut brace: a 110 cm polished alloy bar with a mounting plate at each end, across the engine bay between the strut towers.
  - size: 110 × 5 × 8 cm (w × h × l) · mass 2.5 kg · goes on slot `strut_brace`
- **Carbon strut brace, front and rear** (`strut_brace_carbon`) — A carbon strut brace: a 110 cm carbon bar with alloy end plates (the front one; the rear sits out of sight).
  - size: 110 × 5 × 8 cm (w × h × l) · mass 3 kg · goes on slot `strut_brace`

### supercharger

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Brute 500

- **Centrifugal supercharger kit** (`supercharger_centrifugal`) — A centrifugal supercharger: a polished snail-shell compressor about 25 cm across on a bracket at the front of the engine, a belt pulley and an intake pipe.
  - size: 26 × 24 × 28 cm (w × h × l) · mass 18 kg · goes on slot `supercharger`
- **Twin-screw supercharger kit (V6, V8)** (`supercharger_twin_screw`) — A twin-screw supercharger: a long ribbed case about 50 × 40 × 20 cm sitting on top of the engine, a pulley at the front and a throttle body.
  - size: 40 × 20 × 50 cm (w × h × l) · mass 28 kg · goes on slot `supercharger`

### turbo

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Brute 500

- **Large turbo kit** (`turbo_large`) — A large turbocharger: a snail-shell housing about 30 cm across with its downpipe and intake pipe, sitting beside the engine.
  - size: 34 × 30 × 30 cm (w × h × l) · mass 30 kg · goes on slot `turbo`

### underglow

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Brute 500, Strada Evo, Apex V8

- **Underglow (blue)** (`underglow_blue`) — Underglow: four thin LED strips (2 cm) along the sills and under the bumpers, a frame about 150 × 320 cm under the floor.
  - size: 150 × 2 × 320 cm (w × h × l) · mass 1 kg · goes on slot `underglow`
- **Underglow (green)** (`underglow_green`) — Underglow: four thin LED strips (2 cm) along the sills and under the bumpers, a frame about 150 × 320 cm under the floor.
  - size: 150 × 2 × 320 cm (w × h × l) · mass 1 kg · goes on slot `underglow`
- **Underglow (purple)** (`underglow_purple`) — Underglow: four thin LED strips (2 cm) along the sills and under the bumpers, a frame about 150 × 320 cm under the floor.
  - size: 150 × 2 × 320 cm (w × h × l) · mass 1 kg · goes on slot `underglow`
- **Underglow (red)** (`underglow_red`) — Underglow: four thin LED strips (2 cm) along the sills and under the bumpers, a frame about 150 × 320 cm under the floor.
  - size: 150 × 2 × 320 cm (w × h × l) · mass 1 kg · goes on slot `underglow`
- **Underglow (white)** (`underglow_white`) — Underglow: four thin LED strips (2 cm) along the sills and under the bumpers, a frame about 150 × 320 cm under the floor.
  - size: 150 × 2 × 320 cm (w × h × l) · mass 1 kg · goes on slot `underglow`

### wheels

fits: Starter coupe, Kaze GT, Hana Roadster, Ridgeback 4x4, Vortex R, Strada Evo

- **17" multi-spoke wheel, silver** (`rim_multispoke`) — A multi-spoke rim: ten thin spokes in pairs, a shallow dish, origin at the hub face; one model for every size (scaled).
  - size: 15 × 43 × 43 cm (w × h × l) · mass 8.5 kg · goes on slot `wheels`
- **15" rally gravel wheel, white** (`rim_rally`) — A rally gravel rim: a tough flat six-spoke face with round holes, a plain lip, origin at the hub face; one model for every size (scaled).
  - size: 15 × 38 × 38 cm (w × h × l) · mass 8 kg · goes on slot `wheels`
- **17" off-road beadlock wheel, black** (`rim_beadlock`) — An off-road beadlock rim: a steel eight-spoke face and a bolted beadlock ring (24 bolts) round the outer lip, origin at the hub face; one model for every size (scaled).
  - size: 15 × 43 × 43 cm (w × h × l) · mass 14 kg · goes on slot `wheels`
- **17" deep-dish wheel, polished** (`rim_deepdish`) — A deep-dish rim: a wide polished lip (8 cm) around a flat five-spoke face, origin at the hub face; one model for every size (scaled).
  - size: 15 × 43 × 43 cm (w × h × l) · mass 9.5 kg · goes on slot `wheels`
