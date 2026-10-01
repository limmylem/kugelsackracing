# Part prompt templates

Ready-to-use prompts for making each kind of part in Claude Design, following [the modelling guide](MODELLING_GUIDE.md). Copy one, fill in the bits in [brackets], and drop the .glb it makes into `incoming/`, then run `npm run import`.

_Written by `npm run guide` from `data/content/model-rules.json`: change the rules there and run it again, rather than editing this file._

## Every part: the shared rules

Put this at the end of any prompt (the per-part prompts below already include it):

```text
Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
```

## Spoiler or wing

```text
Make a low-poly 3D model of a spoiler or wing for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.8–1.9 m wide (across the car), 0.03–0.6 m tall and 0.05–0.7 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the boot lid where it bolts on, at the bottom of its feet.
Triangles: under 2,000.

Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as spoiler_[name].glb.
```

## Wheel (rim only)

```text
Make a low-poly 3D model of a wheel (rim only) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.1–0.35 m wide (across the car), 0.35–0.55 m tall and 0.35–0.55 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the wheel's centre on its axle; the outer face towards +x.
Triangles: under 3,000.
Only the rim: no tyre (the game makes the tyre to fit). It turns about the X axis (the axle); its outer face points +X.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as rim_[name].glb.
```

## Bonnet

```text
Make a low-poly 3D model of a bonnet for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1–1.9 m wide (across the car), 0.01–0.3 m tall and 0.6–1.8 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of its back edge (the hinge line), level with its top surface.
Triangles: under 1,500.

Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as bonnet_[name].glb.
```

## Boot lid

```text
Make a low-poly 3D model of a boot lid for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1–1.9 m wide (across the car), 0.01–0.5 m tall and 0.2–1.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of its front edge (the hinge line), level with its top surface.
Triangles: under 1,500.

Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as boot_[name].glb.
```

## Front bumper

```text
Make a low-poly 3D model of a front bumper for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1.3–2.1 m wide (across the car), 0.08–0.7 m tall and 0.08–0.7 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of where it meets the body.
Triangles: under 1,500.

Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as bumper_front_[name].glb.
```

## Rear bumper

```text
Make a low-poly 3D model of a rear bumper for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1.3–2.1 m wide (across the car), 0.08–0.7 m tall and 0.08–0.7 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of where it meets the body.
Triangles: under 1,500.

Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as bumper_rear_[name].glb.
```

## Left door

```text
Make a low-poly 3D model of a left door for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.02–0.3 m wide (across the car), 0.3–1.1 m tall and 0.6–1.7 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its front edge (the hinge line), halfway up.
Triangles: under 1,500.

This is the left-hand one (the car's left, +X).
Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as door_left_[name].glb.
```

## Right door

```text
Make a low-poly 3D model of a right door for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.02–0.3 m wide (across the car), 0.3–1.1 m tall and 0.6–1.7 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its front edge (the hinge line), halfway up.
Triangles: under 1,500.

This is the right-hand one (the car's right, −X).
Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as door_right_[name].glb.
```

## Left front wing (fender)

```text
Make a low-poly 3D model of a left front wing (fender) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.02–0.35 m wide (across the car), 0.15–0.9 m tall and 0.5–1.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its inner edge where it bolts to the body, at the top.
Triangles: under 1,500.

This is the left-hand one (the car's left, +X).
Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as fender_left_[name].glb.
```

## Right front wing (fender)

```text
Make a low-poly 3D model of a right front wing (fender) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.02–0.35 m wide (across the car), 0.15–0.9 m tall and 0.5–1.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its inner edge where it bolts to the body, at the top.
Triangles: under 1,500.

This is the right-hand one (the car's right, −X).
Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as fender_right_[name].glb.
```

## Left side skirt

```text
Make a low-poly 3D model of a left side skirt for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.005–0.25 m wide (across the car), 0.02–0.35 m tall and 0.9–2.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its middle.
Triangles: under 1,000.

This is the left-hand one (the car's left, +X).
Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as skirt_left_[name].glb.
```

## Right side skirt

```text
Make a low-poly 3D model of a right side skirt for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.005–0.25 m wide (across the car), 0.02–0.35 m tall and 0.9–2.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its middle.
Triangles: under 1,000.

This is the right-hand one (the car's right, −X).
Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as skirt_right_[name].glb.
```

## Left mirror

```text
Make a low-poly 3D model of a left mirror for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.06–0.4 m wide (across the car), 0.04–0.3 m tall and 0.02–0.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): where its arm meets the door (its innermost point).
Triangles: under 800.

This is the left-hand one (the car's left, +X).
Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as mirror_left_[name].glb.
```

## Right mirror

```text
Make a low-poly 3D model of a right mirror for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.06–0.4 m wide (across the car), 0.04–0.3 m tall and 0.02–0.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): where its arm meets the door (its innermost point).
Triangles: under 800.

This is the right-hand one (the car's right, −X).
Surfaces in the car's body colour use the material "paint"; trim, grilles and anything black or metal use "car_atlas" (a small palette texture: UV each face onto its colour) or a finish material such as "carbon" or "chrome".

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as mirror_right_[name].glb.
```

## Seat

```text
Make a low-poly 3D model of a seat for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.35–0.75 m wide (across the car), 0.5–1.3 m tall and 0.4–1.1 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of its base, on the floor.
Triangles: under 2,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as seat_[name].glb.
```

## Steering wheel

```text
Make a low-poly 3D model of a steering wheel for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.25–0.45 m wide (across the car), 0.25–0.45 m tall and 0.01–0.25 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its hub, on the steering column (the wheel faces +z towards the driver).
Triangles: under 2,000.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as steering_wheel_[name].glb.
```

## Engine

```text
Make a low-poly 3D model of a engine for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.3–1.1 m wide (across the car), 0.25–1 m tall and 0.3–1.2 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of its base, on the engine mounts.
Triangles: under 6,000.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as engine_[name].glb.
```

## Intake (air box, filter)

```text
Make a low-poly 3D model of a intake (air box, filter) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.05–0.7 m wide (across the car), 0.05–0.5 m tall and 0.05–0.8 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): where it joins the engine.
Triangles: under 1,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as intake_[name].glb.
```

## Turbo

```text
Make a low-poly 3D model of a turbo for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.1–0.6 m wide (across the car), 0.1–0.5 m tall and 0.1–0.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): where it bolts to the exhaust manifold.
Triangles: under 2,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as turbo_[name].glb.
```

## Intercooler

```text
Make a low-poly 3D model of a intercooler for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.3–1 m wide (across the car), 0.1–0.5 m tall and 0.03–0.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its middle.
Triangles: under 1,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as intercooler_[name].glb.
```

## Exhaust (tip)

```text
Make a low-poly 3D model of a exhaust (tip) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.03–0.4 m wide (across the car), 0.03–0.3 m tall and 0.05–1.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the front of the tip, where it meets the pipe (the tip points back, towards −z).
Triangles: under 1,200.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as exhaust_[name].glb.
```

## Engine cover

```text
Make a low-poly 3D model of a engine cover for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1–1.9 m wide (across the car), 0.01–0.5 m tall and 0.2–1.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of its front edge (the hinge line), level with its top surface.
Triangles: under 1,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as engine_cover_[name].glb.
```

## Roof (soft top, hardtop)

```text
Make a low-poly 3D model of a roof (soft top, hardtop) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.9–1.9 m wide (across the car), 0.05–1 m tall and 0.4–1.8 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the roof, level with its top.
Triangles: under 1,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as roof_[name].glb.
```

## Brake kit (disc and caliper)

```text
Make a low-poly 3D model of a brake kit (disc and caliper) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.02–0.2 m wide (across the car), 0.2–0.48 m tall and 0.2–0.48 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the wheel hub's centre (the disc's centre on the axle), the outer face towards +x: drawn at every wheel.
Triangles: under 1,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as brakes_[name].glb.
```

## Supercharger

```text
Make a low-poly 3D model of a supercharger for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.15–0.7 m wide (across the car), 0.1–0.5 m tall and 0.15–0.75 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): where it bolts to the engine.
Triangles: under 2,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as supercharger_[name].glb.
```

## Radiator

```text
Make a low-poly 3D model of a radiator for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.3–0.95 m wide (across the car), 0.15–0.65 m tall and 0.03–0.25 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its middle.
Triangles: under 1,200.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as radiator_[name].glb.
```

## Strut brace

```text
Make a low-poly 3D model of a strut brace for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.6–1.6 m wide (across the car), 0.02–0.25 m tall and 0.03–0.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the bar, on the line between the strut tops.
Triangles: under 800.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as strut_brace_[name].glb.
```

## Roll cage or hoop

```text
Make a low-poly 3D model of a roll cage or hoop for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.8–1.85 m wide (across the car), 0.4–1.6 m tall and 0.05–2.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the cabin above the seats (socket_cage): the cage goes where the cabin has room for it, front to back.
Triangles: under 4,000.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as roll_cage_[name].glb.
```

## Harness

```text
Make a low-poly 3D model of a harness for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.2–0.6 m wide (across the car), 0.3–1 m tall and 0.02–1 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the seat back, where the straps cross.
Triangles: under 800.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as harness_[name].glb.
```

## Gauge pod

```text
Make a low-poly 3D model of a gauge pod for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.04–0.45 m wide (across the car), 0.04–0.4 m tall and 0.03–0.25 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): where the pod sits on the dash or pillar.
Triangles: under 1,000.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as gauges_[name].glb.
```

## Gear lever

```text
Make a low-poly 3D model of a gear lever for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.03–0.25 m wide (across the car), 0.1–0.45 m tall and 0.03–0.25 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of its base, on the tunnel.
Triangles: under 600.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as shifter_[name].glb.
```

## Fog lights (a pair)

```text
Make a low-poly 3D model of a fog lights (a pair) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.3–1.9 m wide (across the car), 0.04–0.3 m tall and 0.02–0.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle between the two lamps (socket_fog_lights): they stand on the front bumper's face, in front of the socket.
Triangles: under 1,000.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as fog_lights_[name].glb.
```

## Underglow strips

```text
Make a low-poly 3D model of a underglow strips for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.8–2.1 m wide (across the car), 0.004–0.08 m tall and 1.8–5 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the floor.
Triangles: under 600.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as underglow_[name].glb.
```

## Front lip or splitter

```text
Make a low-poly 3D model of a front lip or splitter for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1–2.2 m wide (across the car), 0.01–0.25 m tall and 0.05–0.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of its front edge, under the bumper (socket_front_lip).
Triangles: under 1,200.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as front_lip_[name].glb.
```

## Canards (dive planes)

```text
Make a low-poly 3D model of a canards (dive planes) for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1–2.2 m wide (across the car), 0.02–0.35 m tall and 0.05–0.5 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle between the bumper corners (socket_canards).
Triangles: under 800.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as canards_[name].glb.
```

## Mud flaps

```text
Make a low-poly 3D model of a mud flaps for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1–2.2 m wide (across the car), 0.15–0.55 m tall and 0.005–3.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): between the flaps, at the height of their tops (socket_mud_flaps): they hang behind the wheels.
Triangles: under 600.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as mud_flaps_[name].glb.
```

## Aero kit

```text
Make a low-poly 3D model of a aero kit for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1.4–2.3 m wide (across the car), 0.05–0.7 m tall and 2.5–5.2 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the car at floor level (socket_aero_kit).
Triangles: under 3,000.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as aero_kit_[name].glb.
```

## Bull bar

```text
Make a low-poly 3D model of a bull bar for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1.2–2.2 m wide (across the car), 0.3–1.1 m tall and 0.05–0.55 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the bar where it bolts to the chassis (socket_bull_bar).
Triangles: under 2,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as bull_bar_[name].glb.
```

## Winch

```text
Make a low-poly 3D model of a winch for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.25–0.75 m wide (across the car), 0.1–0.4 m tall and 0.1–0.45 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): its mounting plate (socket_winch).
Triangles: under 1,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as winch_[name].glb.
```

## Snorkel

```text
Make a low-poly 3D model of a snorkel for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.05–0.35 m wide (across the car), 0.5–1.6 m tall and 0.05–0.6 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): where it goes into the wing (socket_snorkel): it runs up the outside of it.
Triangles: under 800.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as snorkel_[name].glb.
```

## Roof rack

```text
Make a low-poly 3D model of a roof rack for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.8–1.7 m wide (across the car), 0.05–0.35 m tall and 0.8–2.4 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the rack, its feet on the roof (socket_roof_rack).
Triangles: under 2,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as roof_rack_[name].glb.
```

## Light bar

```text
Make a low-poly 3D model of a light bar for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.3–1.6 m wide (across the car), 0.04–0.25 m tall and 0.03–0.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the bar, on its brackets.
Triangles: under 1,000.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as light_bar_[name].glb.
```

## Rally light pod

```text
Make a low-poly 3D model of a rally light pod for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.4–1.5 m wide (across the car), 0.08–0.4 m tall and 0.05–0.35 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the pod where it straps on (socket_rally_lights).
Triangles: under 1,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as rally_lights_[name].glb.
```

## Skid plates

```text
Make a low-poly 3D model of a skid plates for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 0.5–1.7 m wide (across the car), 0.003–0.25 m tall and 0.5–3.2 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the plates, under the car (socket_skid_plates).
Triangles: under 800.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as skid_plates_[name].glb.
```

## Rock sliders

```text
Make a low-poly 3D model of a rock sliders for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1.3–2.3 m wide (across the car), 0.03–0.3 m tall and 1.4–3.3 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle between the two sills (socket_rock_sliders): they hang under the sills.
Triangles: under 1,500.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as rock_sliders_[name].glb.
```

## Lift kit

```text
Make a low-poly 3D model of a lift kit for a stylised racing game: [describe it — e.g. its style, shape and details]. It fits a small 1980s rear-drive coupe (about 4.0 m long and 1.7 m wide).

Size: 1–2.1 m wide (across the car), 0.1–0.8 m tall and 1.8–3.8 m long (front to back).
Origin (the point it attaches by, at 0, 0, 0): the middle of the car between the axles (socket_lift_kit).
Triangles: under 2,000.

Use the material "car_atlas" (a small palette texture: UV each face onto its colour) or finish materials such as "raw_metal", "chrome" or "rubber"; "paint" only for anything in the car's body colour.

Rules:
- Units are metres, at real size. +Y is up, +Z is the front of the car, +X is the car's left.
- Material names, exactly: "paint", "car_atlas", "glass", "rim_finish", "caliper", "seat_fabric", "light_*", or a finish: "gloss", "matte", "metallic", "pearl", "carbon", "chrome", "matte_black", "gloss_black", "raw_metal", "rubber", "titanium".
- Textures at most 1024×1024, square, a power of two.
- Flat-shaded low-poly, with normals; UVs on anything textured. Closed meshes (no holes), so its weight can be worked out.
- Only meshes: no cameras, lights, animations, armatures or extra scenes.
- Export as glTF Binary (.glb), +Y up, with all transforms applied (scale 1).
Save it as lift_kit_[name].glb.
```

## A whole car

```text
Make a low-poly 3D model of [the car] for a stylised racing game, 3–5.6 m long, 1.4–2.2 m wide and 1–2.1 m tall, standing on the ground (y = 0), under 25,000 triangles.

Axes: +Y up, the car's front towards +Z, its left (the driver's left as they sit in it) towards +X. Units: metres.
Every part is its own mesh under an empty named for its socket: socket_wheel_FL, socket_wheel_FR, socket_wheel_RL, socket_wheel_RR, socket_bonnet, socket_boot, socket_bumper_front, socket_bumper_rear, socket_door_left, socket_door_right, socket_fender_FL, socket_fender_FR, socket_skirt_left, socket_skirt_right, socket_mirror_left, socket_mirror_right, socket_seat_driver, socket_seat_passenger, socket_steering_wheel, socket_engine, socket_intake, socket_turbo, socket_exhaust_tip, socket_spoiler. Each empty sits where its part attaches (see the part types for where that is). The wheel sockets are at each wheel's centre; the right-hand ones (socket_wheel_FR, socket_wheel_RR) are turned 180° round Y so their +X points out of the car, like the left ones.
Left and right sockets mirror each other exactly (same y and z, x the other way).
The body's painted surfaces use the material "paint"; glass "glass"; head and tail lights "light_head" and "light_tail"; everything else "car_atlas" (a palette texture) or a finish material.
No cameras, lights or animations. Flat-shaded, with normals. Export as glTF Binary (.glb) with +Y up.
Save it as car_[id].glb.
```
