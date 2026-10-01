// Class rules (data/content/balance.json): a car is its own class (car.json class) stock, and the most
// powerful build there is for it (tools/content/maxbuild.mjs) is at most maxClassJump classes higher —
// except the cars in exempt (a supercar, already at the top).
//
//   classProblems(db, carId, rules, { stock, max }) → [problem in words]   (stock, max: ratings)

export function classProblems(db, carId, rules, { stock, max }) {
  const car = db.cars[carId], order = db.classes.classes.map(c => c.class), out = [];
  if (car.class && stock.class !== car.class) out.push(`stock it rates ${stock.index}, class ${stock.class} — it should be class ${car.class}`);
  if (!(rules.exempt ?? []).includes(carId)) {
    const jump = order.indexOf(max.class) - order.indexOf(car.class ?? stock.class);
    if (jump > rules.maxClassJump) out.push(`fully upgraded it's class ${max.class} (${max.index}): ${jump} classes up, at most ${rules.maxClassJump}`);
  }
  return out;
}
