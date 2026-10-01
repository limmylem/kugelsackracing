// A part's shape on a car: its model, bounds and mass offset — its own, or the part it's a variant of
// (variantOf, up the chain) — and, for a part made to fit each car (a roll cage, a strut brace: its
// byCar), that car's own model and bounds.
//
//   partShape(part, parts, carId) → { model, bounds, massOffset }

export function partShape(part, parts, carId = null) {
  const chain = [];
  for (let p = part; p && !chain.includes(p) && chain.length < 8; p = p.variantOf ? parts[p.variantOf] : null) chain.push(p);
  const first = key => chain.find(p => p[key] && (typeof p[key] !== 'string' || p[key].length))?.[key] ?? null;
  const own = carId ? chain.find(p => p.byCar?.[carId])?.byCar[carId] ?? null : null;
  return { model: own?.model ?? first('model') ?? '', bounds: own?.bounds ?? first('bounds'), massOffset: first('massOffset') };
}

// Materials that keep their own look whatever finish or colour the part is given (a red caliper on a
// chrome brake kit, a seat's fabric, a lamp's lens) — unless the look names them (look.materials)
export const KEEPS_LOOK = /^(caliper|seat_fabric|titanium|rubber|glass|light_[a-z0-9_]+)$/;
