# Models to make

Made by `npm run models-todo` from the car and part data (each one's `modelTodo`): 7 cars and 8 parts are drawn as placeholders until their model is made. Sizes are the placeholder boxes' (the part's bounds, in its socket's frame: +z forward, +x left, +y up). Positions are in the car's frame, metres, the ground at y = 0. A part's model has its origin at its socket. Make one, then `npm run import -- incoming/<type>_<name>.glb` (a car: `incoming/car_<id>.glb`, its parts under their socket nodes).

Variants (sizes and finishes of a rim, a tyre in more sizes) use their base part's model: only the base is listed.

## Kaze GT (`kaze_gt`)

**The car** — Kaze GT, a sports coupe: A light 2+2 coupe with a flat-four up front driving the rear wheels: playful, balanced and easy to drift. About 4.24 × 1.78 × 1.29 m, wheelbase 2.57 m. Until it's made: a placeholder from data/cars/kaze_gt/design.json (node tools/placeholder-car.mjs kaze_gt --import).

- body: 4.24 × 1.78 × 1.29 m (l × w × h), 0.13 m ground clearance; axles at z = 1.25 and -1.32, track 1.52 m; wheels 17" rims, 626 mm across the tyre
- collider: centre [0, 0.75, 0], half extents [0.85, 0.5, 2.09]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_front_lip`, `socket_canards`, `socket_widebody`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Side skirt, left (Kaze GT)** (`kaze_gt_side_skirt_left`) — Kaze GT left side skirt: a 260 cm moulded sill extension, 14 cm tall, a small splitter edge at the bottom.
  - size: 8 × 14 × 260 cm (w × h × l) · mass 3 kg · goes on `socket_skirt_left` at [0.86, 0.19, -0.04]
- **Side skirt, right (Kaze GT)** (`kaze_gt_side_skirt_right`) — Kaze GT right side skirt: a 260 cm moulded sill extension, 14 cm tall, a small splitter edge at the bottom.
  - size: 6 × 14 × 260 cm (w × h × l) · mass 3 kg · goes on `socket_skirt_right` at [-0.86, 0.19, -0.04]
- **Widebody kit (Kaze GT)** (`kaze_gt_widebody`) — Kaze GT widebody kit: four bolt-on fender flares, 6 cm wider each side, riveted over the arches, with matching skirt extensions.
  - size: 205 × 35 × 300 cm (w × h × l) · mass 14 kg · goes on `socket_widebody` at [0, 0.7, 0]

## Hana Roadster (`hana_roadster`)

**The car** — Hana Roadster, a roadster: A light two-seat roadster, its soft top down in a moment: nimble, and it leans into every corner. About 3.95 × 1.72 × 1.23 m, wheelbase 2.31 m. Until it's made: a placeholder from data/cars/hana_roadster/design.json (node tools/placeholder-car.mjs hana_roadster --import).

- body: 3.95 × 1.72 × 1.23 m (l × w × h), 0.12 m ground clearance; axles at z = 1.08 and -1.23, track 1.49 m; wheels 16" rims, 602 mm across the tyre
- collider: centre [0, 0.71, 0], half extents [0.82, 0.47, 1.95]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_roof`, `socket_front_lip`, `socket_widebody`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Removable hardtop (Hana Roadster)** (`hana_roadster_hardtop`) — Hana Roadster hardtop: a fibreglass hard roof with a glass rear window, about 140 × 30 × 90 cm, over the cockpit.
  - size: 140 × 30 × 90 cm (w × h × l) · mass 32 kg · goes on `socket_roof` at [0, 1.23, -0.47]
- **Widebody kit (Hana Roadster)** (`hana_roadster_widebody`) — Hana Roadster widebody kit: four round bolt-on fender flares, 5 cm wider each side, over the arches.
  - size: 205 × 35 × 300 cm (w × h × l) · mass 12 kg · goes on `socket_widebody` at [0, 0.65, 0]

## Ridgeback 4x4 (`ridgeback_4x4`)

**The car** — Ridgeback 4x4, a off-roader: A body-on-frame 4x4 with a V6, a two-speed transfer case and a lockable rear diff: slow and wallowy on tarmac, unstoppable off it. About 4.75 × 1.9 × 1.84 m, wheelbase 2.79 m. Until it's made: a placeholder from data/cars/ridgeback_4x4/design.json (node tools/placeholder-car.mjs ridgeback_4x4 --import).

- body: 4.75 × 1.9 × 1.84 m (l × w × h), 0.28 m ground clearance; axles at z = 1.45 and -1.34, track 1.6 m; wheels 17" rims, 802 mm across the tyre
- collider: centre [0, 1.1, 0], half extents [0.91, 0.7, 2.35]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_diff_front`, `socket_transfer_case`, `socket_bull_bar`, `socket_snorkel`, `socket_winch`, `socket_roof_rack`, `socket_light_bar`, `socket_skid_plates`, `socket_rock_sliders`, `socket_lift_kit`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

## Vortex R (`vortex_r`)

**The car** — Vortex R, a hot hatch: A turbocharged hot hatch: grippy and quick, it tugs at the wheel under full power and runs wide at the limit. About 4.3 × 1.8 × 1.45 m, wheelbase 2.64 m. Until it's made: a placeholder from data/cars/vortex_r/design.json (node tools/placeholder-car.mjs vortex_r --import).

- body: 4.3 × 1.8 × 1.45 m (l × w × h), 0.12 m ground clearance; axles at z = 1.35 and -1.29, track 1.55 m; wheels 18" rims, 638 mm across the tyre
- collider: centre [0, 0.82, 0], half extents [0.86, 0.58, 2.12]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_front_lip`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

## Brute 500 (`brute_500`)

**The car** — Brute 500, a muscle car: A big V8 muscle car: huge torque and easy burnouts, heavy and a bit clumsy when the road bends. About 4.8 × 1.92 × 1.38 m, wheelbase 2.72 m. Until it's made: a placeholder from data/cars/brute_500/design.json (node tools/placeholder-car.mjs brute_500 --import).

- body: 4.8 × 1.92 × 1.38 m (l × w × h), 0.13 m ground clearance; axles at z = 1.42 and -1.3, track 1.6 m; wheels 19" rims, 686 mm across the tyre
- collider: centre [0, 0.8, 0], half extents [0.92, 0.55, 2.37]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_widebody`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Scoop bonnet (Brute 500)** (`brute_500_bonnet_scoop`) — Brute 500 scoop bonnet: the stock bonnet shape (150 × 115 cm) with a raised open scoop 60 cm wide and 12 cm tall in the middle.
  - size: 150 × 20 × 115 cm (w × h × l) · mass 16 kg · goes on `socket_bonnet` at [0, 0.95, 0.5]
- **Wide rear arches (Brute 500)** (`brute_500_widebody`) — Brute 500 wide rear arches: two bolt-on rear fender flares, 5 cm wider each side, over the rear wheels.
  - size: 204 × 35 × 120 cm (w × h × l) · mass 9 kg · goes on `socket_widebody` at [0, 0.75, -1.3]

## Strada Evo (`strada_evo`)

**The car** — Strada Evo, a rally saloon: A turbocharged four-wheel-drive saloon born on the stages: an adjustable centre diff, and brilliant on gravel. About 4.5 × 1.77 × 1.45 m, wheelbase 2.63 m. Until it's made: a placeholder from data/cars/strada_evo/design.json (node tools/placeholder-car.mjs strada_evo --import).

- body: 4.5 × 1.77 × 1.45 m (l × w × h), 0.15 m ground clearance; axles at z = 1.37 and -1.26, track 1.52 m; wheels 17" rims, 644 mm across the tyre
- collider: centre [0, 0.84, 0], half extents [0.84, 0.57, 2.22]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_boot`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_diff_front`, `socket_centre_diff`, `socket_rally_lights`, `socket_mud_flaps`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

## Apex V8 (`apex_v8`)

**The car** — Apex V8, a supercar: A mid-engined twin-turbo V8 supercar with a seven-speed paddle-shift gearbox and big aero: fast, and demanding. About 4.55 × 1.93 × 1.2 m, wheelbase 2.67 m. Until it's made: a placeholder from data/cars/apex_v8/design.json (node tools/placeholder-car.mjs apex_v8 --import).

- body: 4.55 × 1.93 × 1.2 m (l × w × h), 0.1 m ground clearance; axles at z = 1.45 and -1.22, track 1.63 m; wheels 20" rims, 694 mm across the tyre
- collider: centre [0, 0.69, 0], half extents [0.93, 0.47, 2.25]
- sockets (nodes the model needs, with each stock part's mesh under its socket): `socket_engine`, `socket_pistons`, `socket_intake`, `socket_turbo`, `socket_intercooler`, `socket_exhaust_tip`, `socket_header`, `socket_ecu`, `socket_gearbox`, `socket_clutch`, `socket_flywheel`, `socket_differential`, `socket_suspension`, `socket_arb_front`, `socket_arb_rear`, `socket_brakes`, `socket_brake_pads`, `socket_wheel_FL`, `socket_wheel_FR`, `socket_wheel_RL`, `socket_wheel_RR`, `socket_bonnet`, `socket_bumper_front`, `socket_bumper_rear`, `socket_door_left`, `socket_door_right`, `socket_fender_FL`, `socket_fender_FR`, `socket_skirt_left`, `socket_skirt_right`, `socket_mirror_left`, `socket_mirror_right`, `socket_seat_driver`, `socket_seat_passenger`, `socket_steering_wheel`, `socket_spoiler`, `socket_weight_rear_seats`, `socket_weight_sound_deadening`, `socket_supercharger`, `socket_radiator`, `socket_engine_swap`, `socket_shifter`, `socket_cage`, `socket_harness`, `socket_gauges`, `socket_strut_brace`, `socket_window_tint`, `socket_tyre_smoke`, `socket_underglow`, `socket_fog_lights`, `socket_engine_cover`, `socket_aero_kit`
- materials: `car_atlas` (the palette texture), `paint`, `glass`, `light_head`, `light_tail`; nodes `body_shell`, `glass_*`, `light_*`, `dashboard`

**Its own parts**

- **Carbon engine cover (Apex V8)** (`apex_v8_carbon_engine_cover`) — Apex V8 carbon engine cover: a louvred carbon lid (150 × 110 cm) with a glass panel showing the engine, hinged at the front.
  - size: 150 × 5 × 110 cm (w × h × l) · mass 5 kg · goes on `socket_engine_cover` at [0, 0.95, -0.8]
