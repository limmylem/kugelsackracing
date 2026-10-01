// Tyre sizes: a tyre part's width and sidewall on the rim it's fitted to (no three.js, so the stats,
// the build scripts and the drawing agree). A 180/55 R15 is 180 mm wide with a sidewall 55% of that,
// on a 15" rim.

export const INCH = 0.0254;

// rim: a wheel part's rim { diameter (inches), width }; size: a tyre part's tyreSize { width (mm), sidewall (%) }
// → metres: rimRadius (where the bead sits), width, sidewall height, radius (the wheel's rolling radius)
export function tyreFit(rim, size) {
  const rimRadius = rim.diameter * INCH / 2, width = size.width / 1000, sidewall = width * size.sidewall / 100;
  return { rimRadius, width, sidewall, radius: rimRadius + sidewall, label: `${size.width}/${size.sidewall} R${rim.diameter}` };
}
