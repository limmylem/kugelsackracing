# Car prompts for Claude Design

One prompt for each car: paste it into Claude Design, and it makes the car's whole model as one `.glb` — the body with its glass and lights, every stock part (bonnet, bumpers, wings, doors, sills, mirrors, boot or engine cover, seats, steering wheel, engine, exhaust tip, wheels, a soft top) under its socket, and the empty sockets the upgrades go on. `npm run import` then splits it into the body and a model per part, exactly as for a hand-made car, so every part can be taken off, swapped and upgraded in the garage ([the modelling guide](MODELLING_GUIDE.md)).

To put a car in the game:

1. Paste its prompt into Claude Design. Look at what it made (front, back, both sides, underneath; with a panel hidden: is the car behind it finished?). Ask it for changes until it's right — but keep the node names, socket positions and sizes as they are.
2. Download the `.glb`, named as the prompt says (`car_<id>.glb`), and put it in `incoming/`.
3. Run `npm run import -- incoming/car_<id>.glb` (or ask Claude Code to). It checks the model against the rules (sizes, the sockets, the wheels on the ground, left and right mirroring, the paint material, the triangle budget), fixes what it can, says what to change if anything fails, then splits the car into its parts.
4. Look at it in the garage (`dev/garage.html`) and on the road (`dev/world.html`), and its parts in the part preview (`dev/parts.html`).

Socket positions and the wheels' size are exact: they're what the car's physics and every part are fitted to. The parts' sizes are the current ones (the placeholder boxes): a little bigger or smaller is fine; the import measures each part again. The **Starter coupe** is the physics reference car: its tests measure its parts' sizes, so after its new model is imported its reference figures are checked and updated with it.

## Making it look more real: follow-up prompts

One prompt rarely gets a racing-game car first time. After the first model, send these one at a time in the same Claude Design conversation, looking at the car after each (close up, from every side), and repeat any that still needs it. Each keeps the names, sockets and sizes.

**1. The shape**

```text
Make the body's shape more realistic. Compare it with photos of real cars of this kind from the side, front, rear and three-quarters: fix the proportions (the overhangs, the glasshouse, the wheel arches round the wheels with a small even gap), make every surface curved and smooth (no flat or faceted areas: more vertices where it curves, subdivided), round off every corner, add the shoulder line and the tumblehome, flare the arches with rolled lips. Keep every node name, socket position, part size and material name exactly as they are, and the glb's structure the same.
```

**2. Panel gaps and edges**

```text
Add the details that make it look manufactured: a 4 mm shut line round every panel (bonnet, boot, doors, wings, bumpers) with the edges turned in, a 2–5 mm bevel on every edge, black rubber seals round the glass, the black frit band round the windscreen, door handles, a fuel filler flap, wiper arms, washer jets, a fictional number plate in its recess. Keep every node name, socket position, part size and material name exactly as they are, and the glb's structure the same.
```

**3. The lights**

```text
Make the headlights and tail lights look like real light units: a chrome reflector bowl or a projector lens behind a clear outer lens with thickness, a black inner surround, the indicator and side lamp in their own sections, LED strips or bulbs inside; the tail lights with a deep red lens, inner segments, the reversing light and indicator. Add a third brake light and the side repeaters. Keep every node name, socket position, part size and material name exactly as they are, and the glb's structure the same.
```

**4. The wheels**

```text
Make the wheels look real: shape each spoke (tapered, with depth and rounded edges), add the outer lip, the wheel nuts and centre cap, the barrel behind the spokes and a ventilated brake disc behind them; a rounded sidewall on the tyre. Line the wheel arches in black and show the suspension behind the wheels. Keep every node name, socket position, part size and material name exactly as they are, and the glb's structure the same.
```

**5. Grilles, intakes and underneath**

```text
Give every grille and intake real depth: slats or a honeycomb mesh with black behind it, never a flat shape; add the tow hook cover, fog lights or reflectors where they suit; model the underside (floor, exhaust pipe running back, fuel tank, suspension arms) in dark finishes. Keep every node name, socket position, part size and material name exactly as they are, and the glb's structure the same.
```

**6. The interior**

```text
Make the interior look real through the windows: a dashboard with instrument dials, vents and a centre stack; door cards with handles and armrests; seats with bolsters, seams and headrests; a gear lever and handbrake; the headlining, sun visors and a rear-view mirror. Keep every node name, socket position, part size and material name exactly as they are, and the glb's structure the same.
```

**7. The materials**

```text
Tune the materials so it looks like a photo: the paint glossy (roughness about 0.1, like clear-coated paint), chrome mirror-like (metalness 1, roughness about 0.05), the glass clear and slightly tinted, the rubber and black plastics rough (0.6–0.8), the lenses clear with the lamps behind them. Show me the car close up from the front three-quarters in daylight. Keep every node name, socket position, part size and material name exactly as they are, and the glb's structure the same.
```

_Written by `npm run car-prompts` (`tools/car-prompts.mjs`) from each car's data: change the data (or the looks in the tool) and run it again, rather than editing this file._

## Starter coupe (`car_starter_car.glb`)

```text
Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the Starter coupe, an honest, slightly boxy 1980s two-door economy coupe, the car every player starts with. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.

The look:
- Crisp, mostly flat panels with soft radii; an upright glasshouse with thin pillars and a near-vertical rear window over a short notchback boot.
- Front: rectangular headlights in black surrounds, a slatted grille between them with a small round badge, an indicator under each headlight, a body-colour bumper with a black rubbing strip and a slim lower intake.
- Rear: wide rectangular tail lights (red with amber indicators and a clear reversing section), the number plate recessed between them, a single exhaust tip.
- Wheels: plain 15" eight-hole steel-look wheels in silver with a small centre cap.
- Inside: a simple dashboard with a two-dial binnacle, cloth seats, a thin-rimmed three-spoke steering wheel.
- Its factory paint: #6d9a91 (the "paint" material's colour; the player can change it).

Size and stance (metres; the ground at y = 0): about 3.958 m long, 1.7 m wide (without mirrors) and 1.307 m tall. The wheel centres (exactly): front axle at z = 1.2, rear axle at z = -1.2, x = ±0.74, y = 0.29 — each wheel 0.579 m across: a 15" rim in a 180/55 R15 tyre (180 mm wide). The tyres' bottoms touch y = 0.

Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car's LEFT (as you sit in it), so −X is its right.

How to model it so it looks real (this matters most — the car must not look blocky or like a toy):
- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car's lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.
- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.
- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen's edge.
- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing's black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.
- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.
- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.
- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.
- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.
- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.

How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):
1. One root node named "starter_car".
2. The body, as meshes directly under the root, named exactly: "body_shell", "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right", "light_head_left", "light_head_right", "light_tail_left", "light_tail_right", "dashboard".
   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.
   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body's, not the door's).
   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.
   - "dashboard": the dashboard and instruments.
3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.
4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket's empty, modelled in the empty's own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.

The parts to model, each under its socket:
- socket_engine at (0, 0.3, 1.25): the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket — "RS17 1.7 L twin-cam four (stock)", about 0.48 × 0.48 × 0.81 m, from (-0.24, -0.04, -0.47) to (0.24, 0.44, 0.34) in the socket's frame.
- socket_exhaust_tip at (-0.45, 0.19, -1.9): the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal" — "Exhaust system (stock)", about 0.068 × 0.072 × 0.18 m, from (-0.034, -0.036, -0.18) to (0.034, 0.036, 0) in the socket's frame.
- socket_wheel_FL at (0.74, 0.29, 1.2), socket_wheel_FR at (-0.74, 0.29, 1.2) (turned 180° round Y), socket_wheel_RL at (0.74, 0.29, -1.2), socket_wheel_RR at (-0.74, 0.29, -1.2) (turned 180° round Y): the wheel: the axle along the socket's X, the wheel's outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part's size, so the tyre only needs to be the right size — the same model under each of these sockets — "15" steel wheel (stock)", about 0.135 × 0.38 × 0.38 m, from (-0.06, -0.19, -0.19) to (0.075, 0.19, 0.19) in the socket's frame.
- socket_bonnet at (0, 0.795, 0.76): the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge — "Bonnet (stock)", about 1.4 × 0.072 × 1.14 m, from (-0.7, -0.06, 0) to (0.7, 0.012, 1.14) in the socket's frame.
- socket_bumper_front at (0, 0.32, 1.95): the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate — "Front bumper (stock)", about 1.74 × 0.2 × 0.305 m, from (-0.87, -0.1, -0.2) to (0.87, 0.1, 0.105) in the socket's frame.
- socket_bumper_rear at (0, 0.32, -1.95): the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser — "Rear bumper (stock)", about 1.74 × 0.2 × 0.305 m, from (-0.87, -0.1, -0.105) to (0.87, 0.1, 0.2) in the socket's frame.
- socket_boot at (0, 0.87, -1.4): the boot lid, hinged at its front edge (the socket), its underside modelled too — "Boot lid (stock)", about 1.4 × 0.038 × 0.57 m, from (-0.7, -0.03, -0.57) to (0.7, 0.008, 0) in the socket's frame.
- socket_door_left at (0.85, 0.56, 0.7): the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body's) — "Door, left (stock)", about 0.122 × 0.56 × 1.15 m, from (-0.11, -0.28, -1.15) to (0.012, 0.28, 0) in the socket's frame.
- socket_door_right at (-0.85, 0.56, 0.7): the right door, as the left one mirrored — "Door, right (stock)", about 0.122 × 0.56 × 1.15 m, from (-0.012, -0.28, -1.15) to (0.11, 0.28, 0) in the socket's frame.
- socket_fender_FL at (0.705, 0.78, 1.3): the left front wing, from the front bumper to the door, over the front wheel with its arch lip — "Front fender, left (stock)", about 0.145 × 0.51 × 1.21 m, from (0, -0.49, -0.58) to (0.145, 0.02, 0.63) in the socket's frame.
- socket_fender_FR at (-0.705, 0.78, 1.3): the right front wing, as the left one mirrored — "Front fender, right (stock)", about 0.145 × 0.51 × 1.21 m, from (-0.145, -0.49, -0.58) to (0, 0.02, 0.63) in the socket's frame.
- socket_skirt_left at (0.83, 0.24, 0): the left sill cover, between the wheel arches under the door — "Side skirt, left (stock)", about 0.06 × 0.09 × 1.68 m, from (-0.03, -0.05, -0.84) to (0.03, 0.04, 0.84) in the socket's frame.
- socket_skirt_right at (-0.83, 0.24, 0): the right sill cover, as the left one mirrored — "Side skirt, right (stock)", about 0.06 × 0.09 × 1.68 m, from (-0.03, -0.05, -0.84) to (0.03, 0.04, 0.84) in the socket's frame.
- socket_mirror_left at (0.8, 0.885, 0.63): the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X — "Door mirror, left (stock)", about 0.18 × 0.09 × 0.075 m, from (0, -0.015, -0.035) to (0.18, 0.075, 0.04) in the socket's frame.
- socket_mirror_right at (-0.8, 0.885, 0.63): the right door mirror, as the left one mirrored — reaching out to −X — "Door mirror, right (stock)", about 0.18 × 0.09 × 0.075 m, from (-0.18, -0.015, -0.035) to (0, 0.075, 0.04) in the socket's frame.
- socket_seat_driver at (0.38, 0.25, -0.22), socket_seat_passenger at (-0.38, 0.25, -0.22): a seat: its base's middle at the socket, facing +Z — the same model under each of these sockets — "Seat (stock)", about 0.48 × 0.882 × 0.74 m, from (-0.24, 0, -0.48) to (0.24, 0.882, 0.26) in the socket's frame.
- socket_steering_wheel at (0.38, 0.86, 0.31) (tilted 30° round X (its top towards the driver)): the steering wheel: its rim in the socket's X–Y plane centred on the socket, the driver on the socket's −Z side (the socket is turned to tilt it), the boss and a fictional badge — "Steering wheel (stock)", about 0.396 × 0.396 × 0.04 m, from (-0.198, -0.198, -0.02) to (0.198, 0.198, 0.02) in the socket's frame.

The empty sockets (no mesh under them: for parts fitted in the game):
socket_pistons (0, 0.45, 1.25); socket_intake (0.24, 0.56, 1.25); socket_turbo (-0.26, 0.5, 1.25); socket_intercooler (0, 0.4, 1.75); socket_header (0.2, 0.35, 1.2); socket_ecu (0.3, 0.6, 0.7); socket_gearbox (0, 0.35, 0.45); socket_clutch (0, 0.4, 0.65); socket_flywheel (0, 0.4, 0.72); socket_differential (0, 0.29, -1.2); socket_suspension (0, 0.4, 0); socket_arb_front (0, 0.25, 1.2); socket_arb_rear (0, 0.25, -1.2); socket_brakes (0, 0.29, 0.1); socket_brake_pads (0, 0.29, 0.1); socket_spoiler (0, 0.87, -1.85); socket_weight_rear_seats (0, 0.3, -0.75); socket_weight_sound_deadening (0, 0.35, -0.2); socket_supercharger (0, 0.68, 1.3); socket_radiator (0, 0.4, 1.7); socket_engine_swap (0, 0.18, 1.25); socket_shifter (0, 0.55, 0.13); socket_cage (0, 0.75, -0.32); socket_harness (0.38, 0.7, -0.42); socket_gauges (0.38, 0.92, 0.53); socket_strut_brace (0, 0.78, 1.2); socket_window_tint (0, 1, -0.2); socket_tyre_smoke (0, 0.05, -1.2); socket_underglow (0, 0.12, 0); socket_fog_lights (0, 0.28, 1.92); socket_aero_kit (0, 0.15, 0).

Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.

Rules:
- Up to 135,000 triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.
- Left and right mirror each other exactly (the left parts at +X, the right at −X).
- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.
- Export as glTF Binary (.glb), +Y up.
Save it as car_starter_car.glb.
```

## Kaze GT (`car_kaze_gt.glb`)

```text
Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the Kaze GT, a light 1990s-style 2+2 sports coupe. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.

The look:
- A long bonnet, a low nose, the cabin set back, a flowing roofline into a short boot with a small integrated lip; strong front and rear wheel arches with a crisp shoulder line between them.
- Front: slim swept-back headlights (projector lamps and a running-light strip in each), a wide lower grille opening with a fine black mesh, small corner intakes.
- Rear: slim horizontal tail lights reaching round the corners, a black diffuser-style lower valance, twin round exhaust tips.
- Wheels: 17" five split-spoke wheels in silver.
- Inside: a driver-focused dashboard with a hooded three-dial binnacle, sports seats with side bolsters, a leather three-spoke wheel.
- Its factory paint: #c93a2b (the "paint" material's colour; the player can change it).

Size and stance (metres; the ground at y = 0): about 4.24 m long, 1.78 m wide (without mirrors) and 1.29 m tall, 0.13 m ground clearance; the belt line (the bottom of the side windows) about 0.9 m up, the bonnet 0.62 m up at the nose rising to 0.86 m at the windscreen's foot (z = 0.55), the roof 1.29 m up from z = 0.05 to -0.95, the boot lid 0.92 m up from z = -1.35 back to the tail. The wheel centres (exactly): front axle at z = 1.25, rear axle at z = -1.32, x = ±0.76, y = 0.313 — each wheel 0.625 m across: a 17" rim in a 215/45 R17 tyre (215 mm wide). The tyres' bottoms touch y = 0.

Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car's LEFT (as you sit in it), so −X is its right.

How to model it so it looks real (this matters most — the car must not look blocky or like a toy):
- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car's lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.
- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.
- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen's edge.
- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing's black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.
- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.
- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.
- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.
- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.
- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.

How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):
1. One root node named "kaze_gt".
2. The body, as meshes directly under the root, named exactly: "body_shell", "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right", "light_head_left", "light_head_right", "light_tail_left", "light_tail_right", "dashboard".
   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.
   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body's, not the door's).
   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.
   - "dashboard": the dashboard and instruments.
3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.
4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket's empty, modelled in the empty's own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.

The parts to model, each under its socket:
- socket_engine at (0, 0.16, 1.12): the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket — "2.0 L flat-four (Kaze GT, stock)", about 0.72 × 0.46 × 0.55 m, from (-0.36, 0, -0.275) to (0.36, 0.46, 0.275) in the socket's frame.
- socket_exhaust_tip at (-0.46, 0.18, -2.07): the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal" — "Exhaust system (Kaze GT, stock)", about 0.09 × 0.09 × 0.1 m, from (-0.045, -0.045, -0.1) to (0.045, 0.045, 0) in the socket's frame.
- socket_wheel_FL at (0.76, 0.313, 1.25), socket_wheel_FR at (-0.76, 0.313, 1.25) (turned 180° round Y), socket_wheel_RL at (0.76, 0.313, -1.32), socket_wheel_RR at (-0.76, 0.313, -1.32) (turned 180° round Y): the wheel: the axle along the socket's X, the wheel's outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part's size, so the tyre only needs to be the right size — the same model under each of these sockets — "17" wheel (Kaze GT, stock)", about 0.181 × 0.432 × 0.432 m, from (-0.09, -0.216, -0.216) to (0.09, 0.216, 0.216) in the socket's frame.
- socket_bonnet at (0, 0.86, 0.55): the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge — "Bonnet (Kaze GT, stock)", about 1.46 × 0.27 × 1.37 m, from (-0.73, -0.27, 0) to (0.73, 0, 1.37) in the socket's frame.
- socket_bumper_front at (0, 0.27, 2.07): the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate — "Front bumper (Kaze GT, stock)", about 1.7 × 0.26 × 0.24 m, from (-0.85, -0.1, -0.19) to (0.85, 0.16, 0.05) in the socket's frame.
- socket_bumper_rear at (0, 0.27, -2.07): the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser — "Rear bumper (Kaze GT, stock)", about 1.7 × 0.26 × 0.2 m, from (-0.85, -0.1, -0.05) to (0.85, 0.16, 0.15) in the socket's frame.
- socket_boot at (0, 0.92, -1.35): the boot lid, hinged at its front edge (the socket), its underside modelled too — "Boot lid (Kaze GT, stock)", about 1.54 × 0.04 × 0.59 m, from (-0.77, -0.04, -0.59) to (0.77, 0, 0) in the socket's frame.
- socket_door_left at (0.88, 0.575, 0.5): the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body's) — "Door, left (Kaze GT, stock)", about 0.06 × 0.65 × 1.18 m, from (-0.07, -0.325, -1.18) to (-0.01, 0.325, 0) in the socket's frame.
- socket_door_right at (-0.88, 0.575, 0.5): the right door, as the left one mirrored — "Door, right (Kaze GT, stock)", about 0.06 × 0.65 × 1.18 m, from (0.01, -0.325, -1.18) to (0.07, 0.325, 0) in the socket's frame.
- socket_fender_FL at (0.79, 0.9, 1.35): the left front wing, from the front bumper to the door, over the front wheel with its arch lip — "Front fender, left (Kaze GT, stock)", about 0.1 × 0.65 × 1.063 m, from (-0.02, -0.65, -0.533) to (0.08, 0, 0.53) in the socket's frame.
- socket_fender_FR at (-0.79, 0.9, 1.35): the right front wing, as the left one mirrored — "Front fender, right (Kaze GT, stock)", about 0.1 × 0.65 × 1.063 m, from (-0.08, -0.65, -0.533) to (0.02, 0, 0.53) in the socket's frame.
- socket_skirt_left at (0.86, 0.19, -0.035): the left sill cover, between the wheel arches under the door — "Side skirt, left (Kaze GT, stock)", about 0.06 × 0.12 × 1.784 m, from (-0.04, -0.06, -0.892) to (0.02, 0.06, 0.892) in the socket's frame.
- socket_skirt_right at (-0.86, 0.19, -0.035): the right sill cover, as the left one mirrored — "Side skirt, right (Kaze GT, stock)", about 0.06 × 0.12 × 1.784 m, from (-0.02, -0.06, -0.892) to (0.04, 0.06, 0.892) in the socket's frame.
- socket_mirror_left at (0.83, 1, 0.43): the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X — "Door mirror, left (Kaze GT, stock)", about 0.16 × 0.1 × 0.1 m, from (0.02, -0.06, -0.06) to (0.18, 0.04, 0.04) in the socket's frame.
- socket_mirror_right at (-0.83, 1, 0.43): the right door mirror, as the left one mirrored — reaching out to −X — "Door mirror, right (Kaze GT, stock)", about 0.16 × 0.1 × 0.1 m, from (-0.18, -0.06, -0.06) to (-0.02, 0.04, 0.04) in the socket's frame.
- socket_seat_driver at (0.389, 0.2, -0.4), socket_seat_passenger at (-0.389, 0.2, -0.4): a seat: its base's middle at the socket, facing +Z — the same model under each of these sockets — "Seat (Kaze GT, stock)", about 0.48 × 0.62 × 0.58 m, from (-0.24, 0, -0.3) to (0.24, 0.62, 0.28) in the socket's frame.
- socket_steering_wheel at (0.389, 0.96, 0.15) (tilted 30° round X (its top towards the driver)): the steering wheel: its rim in the socket's X–Y plane centred on the socket, the driver on the socket's −Z side (the socket is turned to tilt it), the boss and a fictional badge — "Steering wheel (Kaze GT, stock)", about 0.38 × 0.38 × 0.03 m, from (-0.19, -0.19, -0.015) to (0.19, 0.19, 0.015) in the socket's frame.

The empty sockets (no mesh under them: for parts fitted in the game):
socket_pistons (0, 0.51, 1.12); socket_intake (0.246, 0.62, 1.12); socket_turbo (-0.266, 0.56, 1.12); socket_intercooler (0, 0.38, 1.87); socket_header (0.205, 0.41, 1.07); socket_ecu (0.307, 0.8, 0.49); socket_gearbox (0, 0.33, 0.32); socket_clutch (0, 0.38, 0.52); socket_flywheel (0, 0.38, 0.59); socket_differential (0, 0.313, -1.32); socket_suspension (0, 0.413, -0.035); socket_arb_front (0, 0.18, 1.25); socket_arb_rear (0, 0.18, -1.32); socket_brakes (0, 0.313, -0.035); socket_brake_pads (0, 0.313, -0.035); socket_spoiler (0, 0.92, -2); socket_weight_rear_seats (0, 0.25, -0.95); socket_weight_sound_deadening (0, 0.3, -0.35); socket_supercharger (0, 0.68, 1.22); socket_radiator (0, 0.48, 1.82); socket_engine_swap (0, 0.24, 1.12); socket_shifter (0, 0.5, -0.05); socket_cage (0, 0.7, -0.5); socket_harness (0.389, 0.65, -0.6); socket_gauges (0.389, 1.02, 0.35); socket_strut_brace (0, 0.88, 1.25); socket_window_tint (0, 1.04, -0.45); socket_tyre_smoke (0, 0.05, -1.32); socket_underglow (0, 0.13, -0.035); socket_fog_lights (0, 0.25, 2.09); socket_front_lip (0, 0.15, 2.07); socket_canards (0, 0.4, 1.98); socket_widebody (0, 0.7, 0); socket_aero_kit (0, 0.15, 0).

Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.

Rules:
- Up to 135,000 triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.
- Left and right mirror each other exactly (the left parts at +X, the right at −X).
- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.
- Export as glTF Binary (.glb), +Y up.
Save it as car_kaze_gt.glb.
```

## Hana Roadster (`car_hana_roadster.glb`)

```text
Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the Hana Roadster, a small, light two-seat roadster with a folding fabric soft top. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.

The look:
- Rounded, friendly, compact: a short nose, a low windscreen in a slim frame, the cockpit set well back, a short rounded tail; smooth curved wings over each wheel.
- Front: oval headlights with a chrome-ringed projector in each, a small oval grille "mouth" with fine mesh, a slim lower lip.
- Rear: round tail lights (two each side), a recessed number plate, a single exhaust tip.
- Wheels: 16" six-spoke wheels.
- Inside: a simple, sporty cockpit open to the sky: a round-dial instrument pod, bucket seats, a small three-spoke wheel. The soft top is its own part (raised), so the cockpit must look finished without it.
- Its factory paint: #2f7fc1 (the "paint" material's colour; the player can change it).

Size and stance (metres; the ground at y = 0): about 3.95 m long, 1.72 m wide (without mirrors) and 1.23 m tall, 0.12 m ground clearance; the belt line (the bottom of the side windows) about 0.85 m up, the bonnet 0.6 m up at the nose rising to 0.82 m at the windscreen's foot (z = 0.35), the roof 1.23 m up from z = -0.1 to -0.85, the boot lid 0.86 m up from z = -1.2 back to the tail. The wheel centres (exactly): front axle at z = 1.08, rear axle at z = -1.23, x = ±0.745, y = 0.301 — each wheel 0.601 m across: a 16" rim in a 195/50 R16 tyre (195 mm wide). The tyres' bottoms touch y = 0.

Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car's LEFT (as you sit in it), so −X is its right.

How to model it so it looks real (this matters most — the car must not look blocky or like a toy):
- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car's lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.
- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.
- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen's edge.
- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing's black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.
- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.
- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.
- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.
- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.
- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.

How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):
1. One root node named "hana_roadster".
2. The body, as meshes directly under the root, named exactly: "body_shell", "glass_windscreen", "glass_side_left", "glass_side_right", "light_head_left", "light_head_right", "light_tail_left", "light_tail_right", "dashboard".
   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.
   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body's, not the door's).
   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.
   - "dashboard": the dashboard and instruments.
3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.
4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket's empty, modelled in the empty's own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.

The parts to model, each under its socket:
- socket_engine at (0, 0.175, 0.92): the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket — "1.8 L inline-four (Hana Roadster, stock)", about 0.5 × 0.61 × 0.6 m, from (-0.25, 0, -0.3) to (0.25, 0.61, 0.3) in the socket's frame.
- socket_exhaust_tip at (-0.445, 0.17, -1.925): the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal" — "Exhaust system (Hana Roadster, stock)", about 0.09 × 0.09 × 0.1 m, from (-0.045, -0.045, -0.1) to (0.045, 0.045, 0) in the socket's frame.
- socket_wheel_FL at (0.745, 0.301, 1.08), socket_wheel_FR at (-0.745, 0.301, 1.08) (turned 180° round Y), socket_wheel_RL at (0.745, 0.301, -1.23), socket_wheel_RR at (-0.745, 0.301, -1.23) (turned 180° round Y): the wheel: the axle along the socket's X, the wheel's outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part's size, so the tyre only needs to be the right size — the same model under each of these sockets — "16" wheel (Hana Roadster, stock)", about 0.164 × 0.406 × 0.406 m, from (-0.082, -0.203, -0.203) to (0.082, 0.203, 0.203) in the socket's frame.
- socket_bonnet at (0, 0.82, 0.35): the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge — "Bonnet (Hana Roadster, stock)", about 1.4 × 0.25 × 1.425 m, from (-0.7, -0.25, 0) to (0.7, 0, 1.425) in the socket's frame.
- socket_bumper_front at (0, 0.26, 1.925): the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate — "Front bumper (Hana Roadster, stock)", about 1.64 × 0.26 × 0.24 m, from (-0.82, -0.1, -0.19) to (0.82, 0.16, 0.05) in the socket's frame.
- socket_bumper_rear at (0, 0.26, -1.925): the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser — "Rear bumper (Hana Roadster, stock)", about 1.64 × 0.26 × 0.2 m, from (-0.82, -0.1, -0.05) to (0.82, 0.16, 0.15) in the socket's frame.
- socket_boot at (0, 0.86, -1.2): the boot lid, hinged at its front edge (the socket), its underside modelled too — "Boot lid (Hana Roadster, stock)", about 1.48 × 0.04 × 0.595 m, from (-0.74, -0.04, -0.595) to (0.74, 0, 0) in the socket's frame.
- socket_door_left at (0.85, 0.545, 0.3): the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body's) — "Door, left (Hana Roadster, stock)", about 0.06 × 0.61 × 1.18 m, from (-0.07, -0.305, -1.18) to (-0.01, 0.305, 0) in the socket's frame.
- socket_door_right at (-0.85, 0.545, 0.3): the right door, as the left one mirrored — "Door, right (Hana Roadster, stock)", about 0.06 × 0.61 × 1.18 m, from (0.01, -0.305, -1.18) to (0.07, 0.305, 0) in the socket's frame.
- socket_fender_FL at (0.76, 0.85, 1.18): the left front wing, from the front bumper to the door, over the front wheel with its arch lip — "Front fender, left (Hana Roadster, stock)", about 0.1 × 0.61 × 1.076 m, from (-0.02, -0.61, -0.521) to (0.08, 0, 0.555) in the socket's frame.
- socket_fender_FR at (-0.76, 0.85, 1.18): the right front wing, as the left one mirrored — "Front fender, right (Hana Roadster, stock)", about 0.1 × 0.61 × 1.076 m, from (-0.08, -0.61, -0.521) to (0.02, 0, 0.555) in the socket's frame.
- socket_skirt_left at (0.83, 0.18, -0.075): the left sill cover, between the wheel arches under the door — "Side skirt, left (Hana Roadster, stock)", about 0.06 × 0.12 × 1.548 m, from (-0.04, -0.06, -0.774) to (0.02, 0.06, 0.774) in the socket's frame.
- socket_skirt_right at (-0.83, 0.18, -0.075): the right sill cover, as the left one mirrored — "Side skirt, right (Hana Roadster, stock)", about 0.06 × 0.12 × 1.548 m, from (-0.02, -0.06, -0.774) to (0.04, 0.06, 0.774) in the socket's frame.
- socket_mirror_left at (0.8, 0.95, 0.23): the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X — "Door mirror, left (Hana Roadster, stock)", about 0.16 × 0.1 × 0.1 m, from (0.02, -0.06, -0.06) to (0.18, 0.04, 0.04) in the socket's frame.
- socket_mirror_right at (-0.8, 0.95, 0.23): the right door mirror, as the left one mirrored — reaching out to −X — "Door mirror, right (Hana Roadster, stock)", about 0.16 × 0.1 × 0.1 m, from (-0.18, -0.06, -0.06) to (-0.02, 0.04, 0.04) in the socket's frame.
- socket_seat_driver at (0.376, 0.19, -0.5), socket_seat_passenger at (-0.376, 0.19, -0.5): a seat: its base's middle at the socket, facing +Z — the same model under each of these sockets — "Seat (Hana Roadster, stock)", about 0.48 × 0.62 × 0.58 m, from (-0.24, 0, -0.3) to (0.24, 0.62, 0.28) in the socket's frame.
- socket_steering_wheel at (0.376, 0.91, 0.05) (tilted 30° round X (its top towards the driver)): the steering wheel: its rim in the socket's X–Y plane centred on the socket, the driver on the socket's −Z side (the socket is turned to tilt it), the boss and a fictional badge — "Steering wheel (Hana Roadster, stock)", about 0.38 × 0.38 × 0.03 m, from (-0.19, -0.19, -0.015) to (0.19, 0.19, 0.015) in the socket's frame.
- socket_roof at (0, 1.23, -0.475): the folding fabric soft top, raised: from the windscreen's top frame back to behind the seats, with its small rear window — "Folding soft top (Hana Roadster, stock)", about 1.48 × 0.36 × 1.3 m, from (-0.74, -0.36, -0.825) to (0.74, 0, 0.475) in the socket's frame.

The empty sockets (no mesh under them: for parts fitted in the game):
socket_pistons (0, 0.6, 0.92); socket_intake (0.237, 0.71, 0.92); socket_turbo (-0.257, 0.65, 0.92); socket_intercooler (0, 0.37, 1.725); socket_header (0.198, 0.5, 0.87); socket_ecu (0.297, 0.75, 0.29); socket_gearbox (0, 0.32, 0.12); socket_clutch (0, 0.37, 0.32); socket_flywheel (0, 0.37, 0.39); socket_differential (0, 0.301, -1.23); socket_suspension (0, 0.401, -0.075); socket_arb_front (0, 0.17, 1.08); socket_arb_rear (0, 0.17, -1.23); socket_brakes (0, 0.301, -0.075); socket_brake_pads (0, 0.301, -0.075); socket_spoiler (0, 0.86, -1.855); socket_weight_rear_seats (0, 0.24, -1.05); socket_weight_sound_deadening (0, 0.29, -0.45); socket_supercharger (0, 0.845, 1.02); socket_radiator (0, 0.47, 1.675); socket_engine_swap (0, 0.33, 0.92); socket_shifter (0, 0.49, -0.15); socket_cage (0, 0.69, -0.6); socket_harness (0.376, 0.64, -0.7); socket_gauges (0.376, 0.97, 0.25); socket_strut_brace (0, 0.83, 1.08); socket_window_tint (0, 0.98, -0.475); socket_tyre_smoke (0, 0.05, -1.23); socket_underglow (0, 0.12, -0.075); socket_fog_lights (0, 0.24, 1.945); socket_front_lip (0, 0.14, 1.93); socket_widebody (0, 0.65, 0); socket_aero_kit (0, 0.15, 0).

Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.

Rules:
- Up to 135,000 triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.
- Left and right mirror each other exactly (the left parts at +X, the right at −X).
- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.
- Export as glTF Binary (.glb), +Y up.
Save it as car_hana_roadster.glb.
```

## Ridgeback 4x4 (`car_ridgeback_4x4.glb`)

```text
Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the Ridgeback 4x4, a tough, upright body-on-frame four-wheel-drive off-roader. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.

The look:
- Square, flat-sided and tall, with high ground clearance, a near-vertical windscreen, a long roof and a flat tail with a side-hinged rear door look; black plastic wheel-arch flares and lower cladding all round.
- Front: big rectangular headlights, a tall grille of thick horizontal bars, a steel bumper with a skid plate and recovery points.
- Rear: tall vertical tail lights at the corners, a spare-wheel carrier on the tail, a step bumper.
- Wheels: 17" six-spoke wheels on chunky all-terrain tyres.
- Inside: an upright, practical dashboard, high-backed seats, a large four-spoke wheel.
- Its factory paint: #6b7a4a (the "paint" material's colour; the player can change it).

Size and stance (metres; the ground at y = 0): about 4.75 m long, 1.9 m wide (without mirrors) and 1.84 m tall, 0.28 m ground clearance; the belt line (the bottom of the side windows) about 1.2 m up, the bonnet 1.05 m up at the nose rising to 1.15 m at the windscreen's foot (z = 0.75), the roof 1.84 m up from z = 0.45 to -1.9, the boot lid 1.3 m up from z = -2.2 back to the tail. The wheel centres (exactly): front axle at z = 1.45, rear axle at z = -1.34, x = ±0.8, y = 0.401 — each wheel 0.803 m across: a 17" rim in a 265/70 R17 tyre (265 mm wide). The tyres' bottoms touch y = 0.

Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car's LEFT (as you sit in it), so −X is its right.

How to model it so it looks real (this matters most — the car must not look blocky or like a toy):
- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car's lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.
- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.
- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen's edge.
- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing's black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.
- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.
- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.
- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.
- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.
- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.

How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):
1. One root node named "ridgeback_4x4".
2. The body, as meshes directly under the root, named exactly: "body_shell", "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right", "light_head_left", "light_head_right", "light_tail_left", "light_tail_right", "dashboard".
   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.
   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body's, not the door's).
   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.
   - "dashboard": the dashboard and instruments.
3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.
4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket's empty, modelled in the empty's own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.

The parts to model, each under its socket:
- socket_engine at (0, 0.525, 1.42): the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket — "4.0 L V6 (Ridgeback 4x4, stock)", about 0.66 × 0.61 × 0.6 m, from (-0.33, 0, -0.3) to (0.33, 0.61, 0.3) in the socket's frame.
- socket_exhaust_tip at (-0.491, 0.33, -2.325): the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal" — "Exhaust system (Ridgeback 4x4, stock)", about 0.09 × 0.09 × 0.1 m, from (-0.045, -0.045, -0.1) to (0.045, 0.045, 0) in the socket's frame.
- socket_wheel_FL at (0.8, 0.401, 1.45), socket_wheel_FR at (-0.8, 0.401, 1.45) (turned 180° round Y), socket_wheel_RL at (0.8, 0.401, -1.34), socket_wheel_RR at (-0.8, 0.401, -1.34) (turned 180° round Y): the wheel: the axle along the socket's X, the wheel's outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part's size, so the tyre only needs to be the right size — the same model under each of these sockets — "17" wheel (Ridgeback 4x4, stock)", about 0.223 × 0.432 × 0.432 m, from (-0.111, -0.216, -0.216) to (0.111, 0.216, 0.216) in the socket's frame.
- socket_bonnet at (0, 1.15, 0.75): the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge — "Bonnet (Ridgeback 4x4, stock)", about 1.58 × 0.13 × 1.425 m, from (-0.79, -0.13, 0) to (0.79, 0, 1.425) in the socket's frame.
- socket_bumper_front at (0, 0.42, 2.325): the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate — "Front bumper (Ridgeback 4x4, stock)", about 1.82 × 0.26 × 0.24 m, from (-0.91, -0.1, -0.19) to (0.91, 0.16, 0.05) in the socket's frame.
- socket_bumper_rear at (0, 0.42, -2.325): the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser — "Rear bumper (Ridgeback 4x4, stock)", about 1.82 × 0.26 × 0.2 m, from (-0.91, -0.1, -0.05) to (0.91, 0.16, 0.15) in the socket's frame.
- socket_door_left at (0.94, 0.8, 0.7): the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body's) — "Door, left (Ridgeback 4x4, stock)", about 0.06 × 0.8 × 1.18 m, from (-0.07, -0.4, -1.18) to (-0.01, 0.4, 0) in the socket's frame.
- socket_door_right at (-0.94, 0.8, 0.7): the right door, as the left one mirrored — "Door, right (Ridgeback 4x4, stock)", about 0.06 × 0.8 × 1.18 m, from (0.01, -0.4, -1.18) to (0.07, 0.4, 0) in the socket's frame.
- socket_fender_FL at (0.85, 1.2, 1.55): the left front wing, from the front bumper to the door, over the front wheel with its arch lip — "Front fender, left (Ridgeback 4x4, stock)", about 0.1 × 0.8 × 1.206 m, from (-0.02, -0.8, -0.621) to (0.08, 0, 0.585) in the socket's frame.
- socket_fender_FR at (-0.85, 1.2, 1.55): the right front wing, as the left one mirrored — "Front fender, right (Ridgeback 4x4, stock)", about 0.1 × 0.8 × 1.206 m, from (-0.08, -0.8, -0.621) to (0.02, 0, 0.585) in the socket's frame.
- socket_skirt_left at (0.92, 0.34, 0.055): the left sill cover, between the wheel arches under the door — "Side skirt, left (Ridgeback 4x4, stock)", about 0.06 × 0.12 × 1.828 m, from (-0.04, -0.06, -0.914) to (0.02, 0.06, 0.914) in the socket's frame.
- socket_skirt_right at (-0.92, 0.34, 0.055): the right sill cover, as the left one mirrored — "Side skirt, right (Ridgeback 4x4, stock)", about 0.06 × 0.12 × 1.828 m, from (-0.02, -0.06, -0.914) to (0.04, 0.06, 0.914) in the socket's frame.
- socket_mirror_left at (0.89, 1.3, 0.63): the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X — "Door mirror, left (Ridgeback 4x4, stock)", about 0.16 × 0.1 × 0.1 m, from (0.02, -0.06, -0.06) to (0.18, 0.04, 0.04) in the socket's frame.
- socket_mirror_right at (-0.89, 1.3, 0.63): the right door mirror, as the left one mirrored — reaching out to −X — "Door mirror, right (Ridgeback 4x4, stock)", about 0.16 × 0.1 × 0.1 m, from (-0.18, -0.06, -0.06) to (-0.02, 0.04, 0.04) in the socket's frame.
- socket_seat_driver at (0.415, 0.45, -0.15), socket_seat_passenger at (-0.415, 0.45, -0.15): a seat: its base's middle at the socket, facing +Z — the same model under each of these sockets — "Seat (Ridgeback 4x4, stock)", about 0.48 × 0.62 × 0.58 m, from (-0.24, 0, -0.3) to (0.24, 0.62, 0.28) in the socket's frame.
- socket_steering_wheel at (0.415, 1.26, 0.4) (tilted 24° round X (its top towards the driver)): the steering wheel: its rim in the socket's X–Y plane centred on the socket, the driver on the socket's −Z side (the socket is turned to tilt it), the boss and a fictional badge — "Steering wheel (Ridgeback 4x4, stock)", about 0.38 × 0.38 × 0.03 m, from (-0.19, -0.19, -0.015) to (0.19, 0.19, 0.015) in the socket's frame.

The empty sockets (no mesh under them: for parts fitted in the game):
socket_pistons (0, 0.95, 1.42); socket_intake (0.262, 1.06, 1.42); socket_turbo (-0.284, 1, 1.42); socket_intercooler (0, 0.53, 2.125); socket_header (0.218, 0.85, 1.37); socket_ecu (0.328, 1.1, 0.69); socket_gearbox (0, 0.48, 0.62); socket_clutch (0, 0.53, 0.82); socket_flywheel (0, 0.53, 0.89); socket_differential (0, 0.401, -1.34); socket_suspension (0, 0.501, 0.055); socket_arb_front (0, 0.33, 1.45); socket_arb_rear (0, 0.33, -1.34); socket_brakes (0, 0.401, 0.055); socket_brake_pads (0, 0.401, 0.055); socket_spoiler (0, 1.3, -2.255); socket_weight_rear_seats (0, 0.5, -0.7); socket_weight_sound_deadening (0, 0.55, -0.1); socket_supercharger (0, 1.195, 1.52); socket_radiator (0, 0.63, 2.075); socket_engine_swap (0, 0.68, 1.42); socket_shifter (0, 0.75, 0.2); socket_cage (0, 0.95, -0.25); socket_harness (0.415, 0.9, -0.35); socket_gauges (0.415, 1.32, 0.6); socket_strut_brace (0, 1.18, 1.45); socket_window_tint (0, 1.59, -0.725); socket_tyre_smoke (0, 0.05, -1.34); socket_underglow (0, 0.28, 0.055); socket_fog_lights (0, 0.4, 2.345); socket_diff_front (0, 0.401, 1.4); socket_transfer_case (0, 0.48, 0.255); socket_bull_bar (0, 0.75, 2.42); socket_snorkel (-0.9, 1.35, 0.85); socket_winch (0, 0.55, 2.36); socket_roof_rack (0, 1.86, -0.6); socket_light_bar (0, 1.88, 0.35); socket_skid_plates (0, 0.3, 1.1); socket_rock_sliders (0, 0.33, 0.05); socket_lift_kit (0, 0.55, 0); socket_aero_kit (0, 0.3, 0).

Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.

Rules:
- Up to 135,000 triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.
- Left and right mirror each other exactly (the left parts at +X, the right at −X).
- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.
- Export as glTF Binary (.glb), +Y up.
Save it as car_ridgeback_4x4.glb.
```

## Vortex R (`car_vortex_r.glb`)

```text
Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the Vortex R, an aggressive turbocharged hot hatch. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.

The look:
- Compact and wide: short overhangs, flared arches over big wheels, a steeply raked windscreen, a roof spoiler over a near-vertical hatch.
- Front: sharp angular headlights with LED-style running lights, a honeycomb mesh grille, big corner intakes, a splitter-style lower lip.
- Rear: tail lights wrapping round the corners, a black diffuser with a centre twin exhaust.
- Wheels: 18" ten-spoke wheels in dark grey.
- Inside: sporty bucket seats, a flat-bottomed three-spoke wheel, a dashboard with a digital-style instrument panel.
- Its factory paint: #e8c21c (the "paint" material's colour; the player can change it).

Size and stance (metres; the ground at y = 0): about 4.3 m long, 1.8 m wide (without mirrors) and 1.45 m tall, 0.12 m ground clearance; the belt line (the bottom of the side windows) about 0.95 m up, the bonnet 0.68 m up at the nose rising to 0.92 m at the windscreen's foot (z = 0.75), the roof 1.45 m up from z = 0.3 to -1.55, the boot lid 1 m up from z = -1.75 back to the tail. The wheel centres (exactly): front axle at z = 1.35, rear axle at z = -1.29, x = ±0.775, y = 0.319 — each wheel 0.637 m across: a 18" rim in a 225/40 R18 tyre (225 mm wide). The tyres' bottoms touch y = 0.

Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car's LEFT (as you sit in it), so −X is its right.

How to model it so it looks real (this matters most — the car must not look blocky or like a toy):
- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car's lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.
- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.
- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen's edge.
- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing's black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.
- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.
- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.
- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.
- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.
- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.

How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):
1. One root node named "vortex_r".
2. The body, as meshes directly under the root, named exactly: "body_shell", "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right", "light_head_left", "light_head_right", "light_tail_left", "light_tail_right", "dashboard".
   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.
   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body's, not the door's).
   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.
   - "dashboard": the dashboard and instruments.
3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.
4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket's empty, modelled in the empty's own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.

The parts to model, each under its socket:
- socket_engine at (0, 0.25, 1.28): the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket — "2.0 L turbo inline-four (Vortex R, stock)", about 0.66 × 0.56 × 0.5 m, from (-0.33, 0, -0.25) to (0.33, 0.56, 0.25) in the socket's frame.
- socket_exhaust_tip at (-0.466, 0.17, -2.1): the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal" — "Exhaust system (Vortex R, stock)", about 0.09 × 0.09 × 0.1 m, from (-0.045, -0.045, -0.1) to (0.045, 0.045, 0) in the socket's frame.
- socket_wheel_FL at (0.775, 0.319, 1.35), socket_wheel_FR at (-0.775, 0.319, 1.35) (turned 180° round Y), socket_wheel_RL at (0.775, 0.319, -1.29), socket_wheel_RR at (-0.775, 0.319, -1.29) (turned 180° round Y): the wheel: the axle along the socket's X, the wheel's outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part's size, so the tyre only needs to be the right size — the same model under each of these sockets — "18" wheel (Vortex R, stock)", about 0.189 × 0.457 × 0.457 m, from (-0.094, -0.229, -0.229) to (0.095, 0.229, 0.229) in the socket's frame.
- socket_bonnet at (0, 0.92, 0.75): the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge — "Bonnet (Vortex R, stock)", about 1.48 × 0.27 × 1.2 m, from (-0.74, -0.27, 0) to (0.74, 0, 1.2) in the socket's frame.
- socket_bumper_front at (0, 0.26, 2.1): the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate — "Front bumper (Vortex R, stock)", about 1.72 × 0.26 × 0.24 m, from (-0.86, -0.1, -0.19) to (0.86, 0.16, 0.05) in the socket's frame.
- socket_bumper_rear at (0, 0.26, -2.1): the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser — "Rear bumper (Vortex R, stock)", about 1.72 × 0.26 × 0.2 m, from (-0.86, -0.1, -0.05) to (0.86, 0.16, 0.15) in the socket's frame.
- socket_door_left at (0.89, 0.595, 0.7): the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body's) — "Door, left (Vortex R, stock)", about 0.06 × 0.71 × 1.18 m, from (-0.07, -0.355, -1.18) to (-0.01, 0.355, 0) in the socket's frame.
- socket_door_right at (-0.89, 0.595, 0.7): the right door, as the left one mirrored — "Door, right (Vortex R, stock)", about 0.06 × 0.71 × 1.18 m, from (0.01, -0.355, -1.18) to (0.07, 0.355, 0) in the socket's frame.
- socket_fender_FL at (0.8, 0.95, 1.45): the left front wing, from the front bumper to the door, over the front wheel with its arch lip — "Front fender, left (Vortex R, stock)", about 0.1 × 0.71 × 0.999 m, from (-0.02, -0.71, -0.539) to (0.08, 0, 0.46) in the socket's frame.
- socket_fender_FR at (-0.8, 0.95, 1.45): the right front wing, as the left one mirrored — "Front fender, right (Vortex R, stock)", about 0.1 × 0.71 × 0.999 m, from (-0.08, -0.71, -0.539) to (0.02, 0, 0.46) in the socket's frame.
- socket_skirt_left at (0.87, 0.18, 0.03): the left sill cover, between the wheel arches under the door — "Side skirt, left (Vortex R, stock)", about 0.06 × 0.12 × 1.842 m, from (-0.04, -0.06, -0.921) to (0.02, 0.06, 0.921) in the socket's frame.
- socket_skirt_right at (-0.87, 0.18, 0.03): the right sill cover, as the left one mirrored — "Side skirt, right (Vortex R, stock)", about 0.06 × 0.12 × 1.842 m, from (-0.02, -0.06, -0.921) to (0.04, 0.06, 0.921) in the socket's frame.
- socket_mirror_left at (0.84, 1.05, 0.63): the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X — "Door mirror, left (Vortex R, stock)", about 0.16 × 0.1 × 0.1 m, from (0.02, -0.06, -0.06) to (0.18, 0.04, 0.04) in the socket's frame.
- socket_mirror_right at (-0.84, 1.05, 0.63): the right door mirror, as the left one mirrored — reaching out to −X — "Door mirror, right (Vortex R, stock)", about 0.16 × 0.1 × 0.1 m, from (-0.18, -0.06, -0.06) to (-0.02, 0.04, 0.04) in the socket's frame.
- socket_seat_driver at (0.393, 0.22, -0.2), socket_seat_passenger at (-0.393, 0.22, -0.2): a seat: its base's middle at the socket, facing +Z — the same model under each of these sockets — "Seat (Vortex R, stock)", about 0.48 × 0.62 × 0.58 m, from (-0.24, 0, -0.3) to (0.24, 0.62, 0.28) in the socket's frame.
- socket_steering_wheel at (0.393, 1.01, 0.35) (tilted 30° round X (its top towards the driver)): the steering wheel: its rim in the socket's X–Y plane centred on the socket, the driver on the socket's −Z side (the socket is turned to tilt it), the boss and a fictional badge — "Steering wheel (Vortex R, stock)", about 0.38 × 0.38 × 0.03 m, from (-0.19, -0.19, -0.015) to (0.19, 0.19, 0.015) in the socket's frame.

The empty sockets (no mesh under them: for parts fitted in the game):
socket_pistons (0, 0.65, 1.28); socket_intake (0.248, 0.76, 1.28); socket_turbo (-0.269, 0.7, 1.28); socket_intercooler (0, 0.37, 1.9); socket_header (0.207, 0.55, 1.23); socket_ecu (0.31, 0.85, 0.69); socket_gearbox (0, 0.32, 0.48); socket_clutch (0, 0.37, 0.68); socket_flywheel (0, 0.37, 0.75); socket_differential (0, 0.319, 1.3); socket_suspension (0, 0.419, 0.03); socket_arb_front (0, 0.17, 1.35); socket_arb_rear (0, 0.17, -1.29); socket_brakes (0, 0.319, 0.03); socket_brake_pads (0, 0.319, 0.03); socket_spoiler (0, 1.43, -1.6); socket_weight_rear_seats (0, 0.27, -0.75); socket_weight_sound_deadening (0, 0.32, -0.15); socket_supercharger (0, 0.87, 1.38); socket_radiator (0, 0.47, 1.85); socket_engine_swap (0, 0.38, 1.28); socket_shifter (0, 0.52, 0.15); socket_cage (0, 0.72, -0.3); socket_harness (0.393, 0.67, -0.4); socket_gauges (0.393, 1.07, 0.55); socket_strut_brace (0, 0.93, 1.35); socket_window_tint (0, 1.2, -0.625); socket_tyre_smoke (0, 0.05, -1.29); socket_underglow (0, 0.12, 0.03); socket_fog_lights (0, 0.24, 2.12); socket_front_lip (0, 0.14, 2.1); socket_aero_kit (0, 0.15, 0).

Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.

Rules:
- Up to 135,000 triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.
- Left and right mirror each other exactly (the left parts at +X, the right at −X).
- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.
- Export as glTF Binary (.glb), +Y up.
Save it as car_vortex_r.glb.
```

## Brute 500 (`car_brute_500.glb`)

```text
Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the Brute 500, a big, 1970s-inspired V8 muscle car. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.

The look:
- Long and wide: a very long bonnet with a raised power bulge, a fastback roof sweeping down to a short deck with a ducktail lip, strong haunches over the rear wheels.
- Front: a full-width black grille with twin round headlights each side set into it, a chrome-edged bumper.
- Rear: a full-width tail-light bar, a chrome bumper, twin exhaust tips either side.
- Wheels: 19" five-spoke "star" wheels.
- Inside: a long dashboard with deep round dials, wide seats, a large three-spoke wheel with a big centre pad.
- Its factory paint: #d35400 (the "paint" material's colour; the player can change it).

Size and stance (metres; the ground at y = 0): about 4.8 m long, 1.92 m wide (without mirrors) and 1.38 m tall, 0.13 m ground clearance; the belt line (the bottom of the side windows) about 0.95 m up, the bonnet 0.7 m up at the nose rising to 0.95 m at the windscreen's foot (z = 0.5), the roof 1.38 m up from z = -0.05 to -1, the boot lid 0.98 m up from z = -1.6 back to the tail. The wheel centres (exactly): front axle at z = 1.42, rear axle at z = -1.3, x = ±0.8, y = 0.343 — each wheel 0.687 m across: a 19" rim in a 255/40 R19 tyre (255 mm wide). The tyres' bottoms touch y = 0.

Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car's LEFT (as you sit in it), so −X is its right.

How to model it so it looks real (this matters most — the car must not look blocky or like a toy):
- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car's lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.
- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.
- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen's edge.
- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing's black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.
- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.
- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.
- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.
- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.
- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.

How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):
1. One root node named "brute_500".
2. The body, as meshes directly under the root, named exactly: "body_shell", "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right", "light_head_left", "light_head_right", "light_tail_left", "light_tail_right", "dashboard".
   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.
   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body's, not the door's).
   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.
   - "dashboard": the dashboard and instruments.
3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.
4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket's empty, modelled in the empty's own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.

The parts to model, each under its socket:
- socket_engine at (0, 0.2, 1.15): the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket — "5.0 L V8 (Brute 500, stock)", about 0.76 × 0.66 × 0.75 m, from (-0.38, 0, -0.375) to (0.38, 0.66, 0.375) in the socket's frame.
- socket_exhaust_tip at (-0.497, 0.18, -2.35): the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal" — "Exhaust system (Brute 500, stock)", about 0.09 × 0.09 × 0.1 m, from (-0.045, -0.045, -0.1) to (0.045, 0.045, 0) in the socket's frame.
- socket_wheel_FL at (0.8, 0.343, 1.42), socket_wheel_FR at (-0.8, 0.343, 1.42) (turned 180° round Y), socket_wheel_RL at (0.8, 0.343, -1.3), socket_wheel_RR at (-0.8, 0.343, -1.3) (turned 180° round Y): the wheel: the axle along the socket's X, the wheel's outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part's size, so the tyre only needs to be the right size — the same model under each of these sockets — "19" wheel (Brute 500, stock)", about 0.214 × 0.483 × 0.483 m, from (-0.107, -0.241, -0.241) to (0.107, 0.241, 0.241) in the socket's frame.
- socket_bonnet at (0, 0.95, 0.5): the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge — "Bonnet (Brute 500, stock)", about 1.6 × 0.28 × 1.7 m, from (-0.8, -0.28, 0) to (0.8, 0, 1.7) in the socket's frame.
- socket_bumper_front at (0, 0.27, 2.35): the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate — "Front bumper (Brute 500, stock)", about 1.84 × 0.26 × 0.24 m, from (-0.92, -0.1, -0.19) to (0.92, 0.16, 0.05) in the socket's frame.
- socket_bumper_rear at (0, 0.27, -2.35): the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser — "Rear bumper (Brute 500, stock)", about 1.84 × 0.26 × 0.2 m, from (-0.92, -0.1, -0.05) to (0.92, 0.16, 0.15) in the socket's frame.
- socket_boot at (0, 0.98, -1.6): the boot lid, hinged at its front edge (the socket), its underside modelled too — "Boot lid (Brute 500, stock)", about 1.68 × 0.04 × 0.62 m, from (-0.84, -0.04, -0.62) to (0.84, 0, 0) in the socket's frame.
- socket_door_left at (0.95, 0.6, 0.45): the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body's) — "Door, left (Brute 500, stock)", about 0.06 × 0.7 × 1.18 m, from (-0.07, -0.35, -1.18) to (-0.01, 0.35, 0) in the socket's frame.
- socket_door_right at (-0.95, 0.6, 0.45): the right door, as the left one mirrored — "Door, right (Brute 500, stock)", about 0.06 × 0.7 × 1.18 m, from (0.01, -0.35, -1.18) to (0.07, 0.35, 0) in the socket's frame.
- socket_fender_FL at (0.86, 0.95, 1.52): the left front wing, from the front bumper to the door, over the front wheel with its arch lip — "Front fender, left (Brute 500, stock)", about 0.1 × 0.7 × 1.203 m, from (-0.02, -0.7, -0.563) to (0.08, 0, 0.64) in the socket's frame.
- socket_fender_FR at (-0.86, 0.95, 1.52): the right front wing, as the left one mirrored — "Front fender, right (Brute 500, stock)", about 0.1 × 0.7 × 1.203 m, from (-0.08, -0.7, -0.563) to (0.02, 0, 0.64) in the socket's frame.
- socket_skirt_left at (0.93, 0.19, 0.06): the left sill cover, between the wheel arches under the door — "Side skirt, left (Brute 500, stock)", about 0.06 × 0.12 × 1.874 m, from (-0.04, -0.06, -0.937) to (0.02, 0.06, 0.937) in the socket's frame.
- socket_skirt_right at (-0.93, 0.19, 0.06): the right sill cover, as the left one mirrored — "Side skirt, right (Brute 500, stock)", about 0.06 × 0.12 × 1.874 m, from (-0.02, -0.06, -0.937) to (0.04, 0.06, 0.937) in the socket's frame.
- socket_mirror_left at (0.9, 1.05, 0.38): the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X — "Door mirror, left (Brute 500, stock)", about 0.16 × 0.1 × 0.1 m, from (0.02, -0.06, -0.06) to (0.18, 0.04, 0.04) in the socket's frame.
- socket_mirror_right at (-0.9, 1.05, 0.38): the right door mirror, as the left one mirrored — reaching out to −X — "Door mirror, right (Brute 500, stock)", about 0.16 × 0.1 × 0.1 m, from (-0.18, -0.06, -0.06) to (-0.02, 0.04, 0.04) in the socket's frame.
- socket_seat_driver at (0.419, 0.2, -0.5), socket_seat_passenger at (-0.419, 0.2, -0.5): a seat: its base's middle at the socket, facing +Z — the same model under each of these sockets — "Seat (Brute 500, stock)", about 0.48 × 0.62 × 0.58 m, from (-0.24, 0, -0.3) to (0.24, 0.62, 0.28) in the socket's frame.
- socket_steering_wheel at (0.419, 1.01, 0.05) (tilted 30° round X (its top towards the driver)): the steering wheel: its rim in the socket's X–Y plane centred on the socket, the driver on the socket's −Z side (the socket is turned to tilt it), the boss and a fictional badge — "Steering wheel (Brute 500, stock)", about 0.38 × 0.38 × 0.03 m, from (-0.19, -0.19, -0.015) to (0.19, 0.19, 0.015) in the socket's frame.

The empty sockets (no mesh under them: for parts fitted in the game):
socket_pistons (0, 0.65, 1.15); socket_intake (0.265, 0.76, 1.15); socket_turbo (-0.287, 0.7, 1.15); socket_intercooler (0, 0.38, 2.15); socket_header (0.221, 0.55, 1.1); socket_ecu (0.331, 0.85, 0.44); socket_gearbox (0, 0.33, 0.35); socket_clutch (0, 0.38, 0.55); socket_flywheel (0, 0.38, 0.62); socket_differential (0, 0.343, -1.3); socket_suspension (0, 0.443, 0.06); socket_arb_front (0, 0.18, 1.42); socket_arb_rear (0, 0.18, -1.3); socket_brakes (0, 0.343, 0.06); socket_brake_pads (0, 0.343, 0.06); socket_spoiler (0, 0.98, -2.28); socket_weight_rear_seats (0, 0.25, -1.05); socket_weight_sound_deadening (0, 0.3, -0.45); socket_supercharger (0, 0.92, 1.25); socket_radiator (0, 0.48, 2.1); socket_engine_swap (0, 0.38, 1.15); socket_shifter (0, 0.5, -0.15); socket_cage (0, 0.7, -0.6); socket_harness (0.419, 0.65, -0.7); socket_gauges (0.419, 1.07, 0.25); socket_strut_brace (0, 0.93, 1.42); socket_window_tint (0, 1.13, -0.525); socket_tyre_smoke (0, 0.05, -1.3); socket_underglow (0, 0.13, 0.06); socket_fog_lights (0, 0.25, 2.37); socket_widebody (0, 0.75, -1.3); socket_aero_kit (0, 0.15, 0).

Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.

Rules:
- Up to 135,000 triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.
- Left and right mirror each other exactly (the left parts at +X, the right at −X).
- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.
- Export as glTF Binary (.glb), +Y up.
Save it as car_brute_500.glb.
```

## Strada Evo (`car_strada_evo.glb`)

```text
Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the Strada Evo, a 1990s rally-homologation four-wheel-drive saloon. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.

The look:
- A practical three-box saloon made aggressive: boxy, flared front and rear arches, a bonnet with a big air vent, a tall boot lid (the spoiler is a part of its own: leave socket_spoiler empty).
- Front: rectangular headlights with twin round projectors in each, a small upper grille, a big lower intake with a mesh, fog-light recesses.
- Rear: rectangular tail lights, a black lower valance, a single large exhaust.
- Wheels: 17" six-spoke wheels in white or gold.
- Inside: bucket seats, a three-spoke wheel, a dashboard with a boost gauge.
- Its factory paint: #2a4fa6 (the "paint" material's colour; the player can change it).

Size and stance (metres; the ground at y = 0): about 4.5 m long, 1.77 m wide (without mirrors) and 1.45 m tall, 0.15 m ground clearance; the belt line (the bottom of the side windows) about 0.95 m up, the bonnet 0.68 m up at the nose rising to 0.92 m at the windscreen's foot (z = 0.7), the roof 1.45 m up from z = 0.25 to -1.05, the boot lid 1 m up from z = -1.55 back to the tail. The wheel centres (exactly): front axle at z = 1.37, rear axle at z = -1.26, x = ±0.76, y = 0.322 — each wheel 0.643 m across: a 17" rim in a 235/45 R17 tyre (235 mm wide). The tyres' bottoms touch y = 0.

Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car's LEFT (as you sit in it), so −X is its right.

How to model it so it looks real (this matters most — the car must not look blocky or like a toy):
- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car's lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.
- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.
- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen's edge.
- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing's black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.
- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.
- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.
- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.
- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.
- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.

How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):
1. One root node named "strada_evo".
2. The body, as meshes directly under the root, named exactly: "body_shell", "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right", "light_head_left", "light_head_right", "light_tail_left", "light_tail_right", "dashboard".
   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.
   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body's, not the door's).
   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.
   - "dashboard": the dashboard and instruments.
3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.
4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket's empty, modelled in the empty's own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.

The parts to model, each under its socket:
- socket_engine at (0, 0.25, 1.28): the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket — "2.0 L turbo inline-four (Strada Evo, stock)", about 0.6 × 0.56 × 0.55 m, from (-0.3, 0, -0.275) to (0.3, 0.56, 0.275) in the socket's frame.
- socket_exhaust_tip at (-0.458, 0.2, -2.2): the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal" — "Exhaust system (Strada Evo, stock)", about 0.09 × 0.09 × 0.1 m, from (-0.045, -0.045, -0.1) to (0.045, 0.045, 0) in the socket's frame.
- socket_wheel_FL at (0.76, 0.322, 1.37), socket_wheel_FR at (-0.76, 0.322, 1.37) (turned 180° round Y), socket_wheel_RL at (0.76, 0.322, -1.26), socket_wheel_RR at (-0.76, 0.322, -1.26) (turned 180° round Y): the wheel: the axle along the socket's X, the wheel's outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part's size, so the tyre only needs to be the right size — the same model under each of these sockets — "17" wheel (Strada Evo, stock)", about 0.197 × 0.432 × 0.432 m, from (-0.099, -0.216, -0.216) to (0.099, 0.216, 0.216) in the socket's frame.
- socket_bonnet at (0, 0.92, 0.7): the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge — "Bonnet (Strada Evo, stock)", about 1.45 × 0.27 × 1.35 m, from (-0.725, -0.27, 0) to (0.725, 0, 1.35) in the socket's frame.
- socket_bumper_front at (0, 0.29, 2.2): the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate — "Front bumper (Strada Evo, stock)", about 1.69 × 0.26 × 0.24 m, from (-0.845, -0.1, -0.19) to (0.845, 0.16, 0.05) in the socket's frame.
- socket_bumper_rear at (0, 0.29, -2.2): the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser — "Rear bumper (Strada Evo, stock)", about 1.69 × 0.26 × 0.2 m, from (-0.845, -0.1, -0.05) to (0.845, 0.16, 0.15) in the socket's frame.
- socket_boot at (0, 1, -1.55): the boot lid, hinged at its front edge (the socket), its underside modelled too — "Boot lid (Strada Evo, stock)", about 1.53 × 0.04 × 0.52 m, from (-0.765, -0.04, -0.52) to (0.765, 0, 0) in the socket's frame.
- socket_door_left at (0.875, 0.61, 0.65): the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body's) — "Door, left (Strada Evo, stock)", about 0.06 × 0.68 × 1.18 m, from (-0.07, -0.34, -1.18) to (-0.01, 0.34, 0) in the socket's frame.
- socket_door_right at (-0.875, 0.61, 0.65): the right door, as the left one mirrored — "Door, right (Strada Evo, stock)", about 0.06 × 0.68 × 1.18 m, from (0.01, -0.34, -1.18) to (0.07, 0.34, 0) in the socket's frame.
- socket_fender_FL at (0.785, 0.95, 1.47): the left front wing, from the front bumper to the door, over the front wheel with its arch lip — "Front fender, left (Strada Evo, stock)", about 0.1 × 0.68 × 1.082 m, from (-0.02, -0.68, -0.542) to (0.08, 0, 0.54) in the socket's frame.
- socket_fender_FR at (-0.785, 0.95, 1.47): the right front wing, as the left one mirrored — "Front fender, right (Strada Evo, stock)", about 0.1 × 0.68 × 1.082 m, from (-0.08, -0.68, -0.542) to (0.02, 0, 0.54) in the socket's frame.
- socket_skirt_left at (0.855, 0.21, 0.055): the left sill cover, between the wheel arches under the door — "Side skirt, left (Strada Evo, stock)", about 0.06 × 0.12 × 1.826 m, from (-0.04, -0.06, -0.913) to (0.02, 0.06, 0.913) in the socket's frame.
- socket_skirt_right at (-0.855, 0.21, 0.055): the right sill cover, as the left one mirrored — "Side skirt, right (Strada Evo, stock)", about 0.06 × 0.12 × 1.826 m, from (-0.02, -0.06, -0.913) to (0.04, 0.06, 0.913) in the socket's frame.
- socket_mirror_left at (0.825, 1.05, 0.58): the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X — "Door mirror, left (Strada Evo, stock)", about 0.16 × 0.1 × 0.1 m, from (0.02, -0.06, -0.06) to (0.18, 0.04, 0.04) in the socket's frame.
- socket_mirror_right at (-0.825, 1.05, 0.58): the right door mirror, as the left one mirrored — reaching out to −X — "Door mirror, right (Strada Evo, stock)", about 0.16 × 0.1 × 0.1 m, from (-0.18, -0.06, -0.06) to (-0.02, 0.04, 0.04) in the socket's frame.
- socket_seat_driver at (0.387, 0.24, -0.35), socket_seat_passenger at (-0.387, 0.24, -0.35): a seat: its base's middle at the socket, facing +Z — the same model under each of these sockets — "Seat (Strada Evo, stock)", about 0.48 × 0.62 × 0.58 m, from (-0.24, 0, -0.3) to (0.24, 0.62, 0.28) in the socket's frame.
- socket_steering_wheel at (0.387, 1.01, 0.2) (tilted 30° round X (its top towards the driver)): the steering wheel: its rim in the socket's X–Y plane centred on the socket, the driver on the socket's −Z side (the socket is turned to tilt it), the boss and a fictional badge — "Steering wheel (Strada Evo, stock)", about 0.38 × 0.38 × 0.03 m, from (-0.19, -0.19, -0.015) to (0.19, 0.19, 0.015) in the socket's frame.

The empty sockets (no mesh under them: for parts fitted in the game):
socket_pistons (0, 0.65, 1.28); socket_intake (0.244, 0.76, 1.28); socket_turbo (-0.264, 0.7, 1.28); socket_intercooler (0, 0.4, 2); socket_header (0.203, 0.55, 1.23); socket_ecu (0.305, 0.85, 0.64); socket_gearbox (0, 0.35, 0.48); socket_clutch (0, 0.4, 0.68); socket_flywheel (0, 0.4, 0.75); socket_differential (0, 0.322, -1.26); socket_suspension (0, 0.422, 0.055); socket_arb_front (0, 0.2, 1.37); socket_arb_rear (0, 0.2, -1.26); socket_brakes (0, 0.322, 0.055); socket_brake_pads (0, 0.322, 0.055); socket_spoiler (0, 1, -2.13); socket_weight_rear_seats (0, 0.29, -0.9); socket_weight_sound_deadening (0, 0.34, -0.3); socket_supercharger (0, 0.87, 1.38); socket_radiator (0, 0.5, 1.95); socket_engine_swap (0, 0.38, 1.28); socket_shifter (0, 0.54, 0); socket_cage (0, 0.74, -0.45); socket_harness (0.387, 0.69, -0.55); socket_gauges (0.387, 1.07, 0.4); socket_strut_brace (0, 0.93, 1.37); socket_window_tint (0, 1.2, -0.4); socket_tyre_smoke (0, 0.05, -1.26); socket_underglow (0, 0.15, 0.055); socket_fog_lights (0, 0.27, 2.22); socket_diff_front (0, 0.322, 1.32); socket_centre_diff (0, 0.3, 0.355); socket_rally_lights (0, 0.78, 1.95); socket_mud_flaps (0, 0.22, -1.72); socket_aero_kit (0, 0.15, 0).

Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.

Rules:
- Up to 135,000 triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.
- Left and right mirror each other exactly (the left parts at +X, the right at −X).
- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.
- Export as glTF Binary (.glb), +Y up.
Save it as car_strada_evo.glb.
```

## Apex V8 (`car_apex_v8.glb`)

```text
Make a detailed 3D model of a car for a racing game, as one glTF Binary (.glb) file: the Apex V8, a mid-engined V8 supercar. It is an original, fictional design — no real car's shape, lights, grille, badge or name; any badge is a simple made-up emblem. Aim for the look of the cars in a modern racing game such as Assetto Corsa: accurate, smooth panels with tight shut lines between them, detailed light units, grilles and wheels, and a real interior — not low-poly.

The look:
- Very low and wide, a wedge: a short sloping nose, the cabin pushed forward, a long engine cover behind it (its own part), big intakes in the sides ahead of the rear wheels, flying-buttress rear pillars.
- Front: slim slit-like headlights high on the wings, a low splitter, two large intakes.
- Rear: a full-width light bar, louvres in the engine cover, a big diffuser with the exhaust tips in its middle.
- Wheels: 20" ten-spoke wheels in black with a polished lip.
- Inside: a race-inspired cockpit: carbon-shell seats, a flat-bottomed wheel, a digital instrument pod.
- Its factory paint: #b01818 (the "paint" material's colour; the player can change it).

Size and stance (metres; the ground at y = 0): about 4.55 m long, 1.93 m wide (without mirrors) and 1.2 m tall, 0.1 m ground clearance; the belt line (the bottom of the side windows) about 0.82 m up, the bonnet 0.55 m up at the nose rising to 0.78 m at the windscreen's foot (z = 0.55), the roof 1.2 m up from z = 0.1 to -0.75, the tail deck 0.95 m up from z = -1.95 back to the tail. The wheel centres (exactly): front axle at z = 1.45, rear axle at z = -1.22, x = ±0.815, y = 0.347 — each wheel 0.694 m across: a 20" rim in a 265/35 R20 tyre (265 mm wide). The tyres' bottoms touch y = 0.

Axes and units: metres at real size; +Y up; +Z is the front of the car; +X is the car's LEFT (as you sit in it), so −X is its right.

How to model it so it looks real (this matters most — the car must not look blocky or like a toy):
- Build every panel as a smooth surface, never from boxes, cylinders or extruded flat shapes: lay out the car's lines first (the side profile, the plan view and cross-sections every 10–15 cm along the car), then skin dense grids of vertices through them (at least 60 along and 30 across a big panel) with gentle curvature everywhere — no flat faces on the body. Subdivide (Catmull–Clark or equivalent) and keep the mesh even.
- Real car surfaces: the sides curve in towards the roof (tumblehome) and are slightly convex; a crisp shoulder line runs from the headlight to the tail light; the wheel arches have rolled lips and a slight flare; the bonnet and roof are domed, not flat; the corners are rounded with radii of 5–30 cm, never sharp.
- Every edge bevelled (2–5 mm), with a 4 mm shut line between each panel and the next, its edges turned in so the gap looks deep. Window glass sits in black rubber seals; a black-painted band (the frit) round the windscreen's edge.
- Light units like real ones: a reflector bowl or projector in chrome behind a clear lens with thickness, the indicator and side lamps as separate shapes, LED strips or bulbs inside, the housing's black inner surround. The tail lights: red lens with depth, inner segments, the reversing light and indicator in their own sections.
- Grilles and intakes as real mesh or slats with depth, black behind them (never a flat painted shape); a number plate (a fictional plate) recessed; tow hook cover, washer jets, door handles, key lock, fuel filler flap, wiper arms, a third brake light, aerials and badges as small separate shapes.
- Wheels like a real one: the rim with its spokes shaped (tapered, with depth and draft), the outer lip, wheel nuts, the barrel behind, a ventilated brake disc behind the spokes (it turns with the wheel, so no caliper on it). The tyre only needs its right size and a rounded sidewall: the game draws its own tyres. The wheel arches lined in black, the suspension and underside visible behind the wheels.
- Underneath: a flat-ish floor with the exhaust pipe running back, the fuel tank, suspension arms — dark, but there.
- Inside, seen through the glass: a dashboard with real instrument dials, vents and a centre stack; door cards; seats with bolsters, seams and headrests; a gear lever and handbrake; a headlining and a rear-view mirror.
- Check it as you go against how a real car would look from the front, side, rear and three-quarters, close up: if any part looks simplified, give it more detail.

How the file is built — exactly this, because the game takes the car apart into its parts (in the garage every panel and part can be taken off, swapped and upgraded):
1. One root node named "apex_v8".
2. The body, as meshes directly under the root, named exactly: "body_shell", "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right", "light_head_left", "light_head_right", "light_tail_left", "light_tail_right", "dashboard".
   - "body_shell": everything that stays when every part below is taken off — the roof and pillars, the rear quarters, the floor, the inner wheel arches, the engine bay (finished: inner wings, firewall, radiator support — it is seen with the bonnet off), the door openings and sills' inner faces, the boot or cargo floor, and the interior (floor, centre console, rear seats or shelf, door shut faces). Nothing of a part below is modelled into it.
   - Each window is its own mesh in the material "glass": "glass_windscreen", "glass_rear", "glass_side_left", "glass_side_right" (the side glass is the body's, not the door's).
   - "light_head_left" / "light_head_right" in "light_head" (the glowing lamps; the housings around them can be chrome or black finishes), "light_tail_left" / "light_tail_right" in "light_tail". They break in a crash, so each is its own mesh.
   - "dashboard": the dashboard and instruments.
3. An empty node for EVERY socket below, a child of the root, named exactly, at exactly its position (and turned only where it says). They are where parts attach; most are only for upgrades and stay empty.
4. Each part below is ONE node (a mesh, or a group of meshes) that is the ONLY child of its socket's empty, modelled in the empty's own frame: its origin at the socket. Model each part whole and finished on its own — as a thin closed shell with both sides showing (1–2 cm thick), with its edges, its inside and its fixings — because it is seen off the car in the garage and the shop, and the car must look right with it removed.

The parts to model, each under its socket:
- socket_engine at (0, 0.145, -1.12): the engine, what is seen with the bonnet off: the block, cam covers, intake, the middle of its base at the socket — "4.0 L twin-turbo V8 (Apex V8, stock)", about 0.75 × 0.61 × 0.7 m, from (-0.375, 0, -0.35) to (0.375, 0.61, 0.35) in the socket's frame.
- socket_exhaust_tip at (-0.499, 0.15, -2.225): the exhaust tip(s), pointing backwards (−Z) out of the rear bumper from the socket, about 10–15 cm long, in "chrome" or "raw_metal" — "Exhaust system (Apex V8, stock)", about 0.09 × 0.09 × 0.1 m, from (-0.045, -0.045, -0.1) to (0.045, 0.045, 0) in the socket's frame.
- socket_wheel_FL at (0.815, 0.347, 1.45), socket_wheel_FR at (-0.815, 0.347, 1.45) (turned 180° round Y), socket_wheel_RL at (0.815, 0.347, -1.22), socket_wheel_RR at (-0.815, 0.347, -1.22) (turned 180° round Y): the wheel: the axle along the socket's X, the wheel's outer face towards +X (the right-hand sockets are turned 180° round Y, so it faces out on both sides). The rim in "rim_finish" with its spokes, lip, barrel (seen through the spokes) and centre cap; the tyre round it in "rubber" — the game draws its own tyres to the tyre part's size, so the tyre only needs to be the right size — the same model under each of these sockets — "20" wheel (Apex V8, stock)", about 0.223 × 0.508 × 0.508 m, from (-0.111, -0.254, -0.254) to (0.111, 0.254, 0.254) in the socket's frame.
- socket_bonnet at (0, 0.78, 0.55): the bonnet: one panel with its underside modelled too (it is seen open or off), hinged at its rear edge — the socket is the middle of that edge — "Front lid (Apex V8, stock)", about 1.285 × 0.26 × 1.525 m, from (-0.642, -0.26, 0) to (0.643, 0, 1.525) in the socket's frame.
- socket_bumper_front at (0, 0.24, 2.225): the front bumper cover, wrapping round to the front wheel arches: its grille openings, intakes and lower lip, the number plate — "Front bumper (Apex V8, stock)", about 1.85 × 0.26 × 0.24 m, from (-0.925, -0.1, -0.19) to (0.925, 0.16, 0.05) in the socket's frame.
- socket_bumper_rear at (0, 0.24, -2.225): the rear bumper cover, wrapping round to the rear wheel arches: the number plate recess, the lower valance or diffuser — "Rear bumper (Apex V8, stock)", about 1.85 × 0.26 × 0.2 m, from (-0.925, -0.1, -0.05) to (0.925, 0.16, 0.15) in the socket's frame.
- socket_door_left at (0.955, 0.52, 0.5): the left door, hinged at its front edge (the socket): the outer skin, the inner trim panel (handle, armrest) and the window frame — no glass (the side glass is the body's) — "Door, left (Apex V8, stock)", about 0.06 × 0.6 × 1.18 m, from (-0.07, -0.3, -1.18) to (-0.01, 0.3, 0) in the socket's frame.
- socket_door_right at (-0.955, 0.52, 0.5): the right door, as the left one mirrored — "Door, right (Apex V8, stock)", about 0.06 × 0.6 × 1.18 m, from (0.01, -0.3, -1.18) to (0.07, 0.3, 0) in the socket's frame.
- socket_fender_FL at (0.865, 0.82, 1.55): the left front wing, from the front bumper to the door, over the front wheel with its arch lip — "Front fender, left (Apex V8, stock)", about 0.1 × 0.6 × 1.052 m, from (-0.02, -0.6, -0.567) to (0.08, 0, 0.485) in the socket's frame.
- socket_fender_FR at (-0.865, 0.82, 1.55): the right front wing, as the left one mirrored — "Front fender, right (Apex V8, stock)", about 0.1 × 0.6 × 1.052 m, from (-0.08, -0.6, -0.567) to (0.02, 0, 0.485) in the socket's frame.
- socket_skirt_left at (0.935, 0.16, 0.115): the left sill cover, between the wheel arches under the door — "Side skirt, left (Apex V8, stock)", about 0.06 × 0.12 × 1.816 m, from (-0.04, -0.06, -0.908) to (0.02, 0.06, 0.908) in the socket's frame.
- socket_skirt_right at (-0.935, 0.16, 0.115): the right sill cover, as the left one mirrored — "Side skirt, right (Apex V8, stock)", about 0.06 × 0.12 × 1.816 m, from (-0.02, -0.06, -0.908) to (0.04, 0.06, 0.908) in the socket's frame.
- socket_mirror_left at (0.905, 0.92, 0.43): the left door mirror: the housing (paint), its arm, the glass (chrome) — reaching out to +X — "Door mirror, left (Apex V8, stock)", about 0.16 × 0.1 × 0.1 m, from (0.02, -0.06, -0.06) to (0.18, 0.04, 0.04) in the socket's frame.
- socket_mirror_right at (-0.905, 0.92, 0.43): the right door mirror, as the left one mirrored — reaching out to −X — "Door mirror, right (Apex V8, stock)", about 0.16 × 0.1 × 0.1 m, from (-0.18, -0.06, -0.06) to (-0.02, 0.04, 0.04) in the socket's frame.
- socket_seat_driver at (0.421, 0.16, -0.25), socket_seat_passenger at (-0.421, 0.16, -0.25): a seat: its base's middle at the socket, facing +Z — the same model under each of these sockets — "Seat (Apex V8, stock)", about 0.48 × 0.62 × 0.58 m, from (-0.24, 0, -0.3) to (0.24, 0.62, 0.28) in the socket's frame.
- socket_steering_wheel at (0.421, 0.88, 0.3) (tilted 22° round X (its top towards the driver)): the steering wheel: its rim in the socket's X–Y plane centred on the socket, the driver on the socket's −Z side (the socket is turned to tilt it), the boss and a fictional badge — "Steering wheel (Apex V8, stock)", about 0.38 × 0.38 × 0.03 m, from (-0.19, -0.19, -0.015) to (0.19, 0.19, 0.015) in the socket's frame.
- socket_engine_cover at (0, 0.95, -0.8): the engine cover over the mid engine, hinged at its front edge (the socket), with its louvres; its underside modelled too — "Engine cover (Apex V8, stock)", about 1.61 × 0.04 × 1.1 m, from (-0.805, -0.04, -1.1) to (0.805, 0, 0) in the socket's frame.

The empty sockets (no mesh under them: for parts fitted in the game):
socket_pistons (0, 0.57, -1.12); socket_intake (0.266, 0.68, -1.12); socket_turbo (-0.288, 0.62, -1.12); socket_intercooler (0, 0.35, -1.67); socket_header (0.222, 0.47, -1.02); socket_ecu (0.333, 0.72, 0.49); socket_gearbox (0, 0.47, -1.67); socket_clutch (0, 0.52, -1.47); socket_flywheel (0, 0.52, -1.4); socket_differential (0, 0.347, -1.22); socket_suspension (0, 0.447, 0.115); socket_arb_front (0, 0.15, 1.45); socket_arb_rear (0, 0.15, -1.22); socket_brakes (0, 0.347, 0.115); socket_brake_pads (0, 0.347, 0.115); socket_spoiler (0, 0.95, -2.155); socket_weight_rear_seats (0, 0.21, -0.8); socket_weight_sound_deadening (0, 0.26, -0.2); socket_supercharger (0, 0.815, -1.22); socket_radiator (0, 0.4, 1.925); socket_engine_swap (0, 0.3, -1.12); socket_shifter (0, 0.46, 0.1); socket_cage (0, 0.66, -0.35); socket_harness (0.421, 0.61, -0.45); socket_gauges (0.421, 0.94, 0.5); socket_strut_brace (0, 0.8, -1.22); socket_window_tint (0, 0.95, -0.325); socket_tyre_smoke (0, 0.05, -1.22); socket_underglow (0, 0.1, 0.115); socket_fog_lights (0, 0.22, 2.245); socket_aero_kit (0, 0.12, 0).

Materials, named exactly (glTF PBR: the paint glossy, the chrome mirror-like, the rubber and plastics rough): "paint" (every body-colour surface: body_shell, panels, mirror housings), "glass", "light_head", "light_tail", "rim_finish" (the wheels' faces), "rubber" (the tyres, and rubber seals), "seat_fabric" (seat cloth or leather), and for everything else the finishes "matte_black", "gloss_black", "chrome", "carbon", "raw_metal", "titanium" (trim, grilles, mesh, the engine, the interior plastics, exhausts). No textures are needed; if any, at most 1024×1024.

Rules:
- Up to 135,000 triangles for the whole car, its parts included — use them: about 35% the body and glass, 30% the panels, 15% the wheel (with its tyre, disc and caliper), 10% the lights, 10% the interior and engine. Smooth shading on curved panels, with normals; crisp (bevelled) edges where panels meet.
- Left and right mirror each other exactly (the left parts at +X, the right at −X).
- Only meshes and empty nodes: no cameras, lights, animations, armatures or extra scenes. All transforms applied inside each part (scale 1); the socket empties keep their positions and the turns given.
- Export as glTF Binary (.glb), +Y up.
Save it as car_apex_v8.glb.
```
