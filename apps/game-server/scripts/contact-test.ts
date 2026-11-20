/** Car-to-car contact: cars are car-shaped, cannot overlap nose to tail or door to door, and trade speed when they meet. */
import { bumpKart, collideKarts, createKartState, type KartState } from "@office-kart/shared";

let failed = 0;
const check = (ok: boolean, text: string): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${text}`);
  if (!ok) failed++;
};
const car = (x: number, z: number, speed: number, heading = 0): KartState => Object.assign(createKartState(), { x, z, speed, heading, vAngle: heading });

{
  const front = car(0, 3.2, 10);
  const rear = car(0, 0, 25);
  const hit = collideKarts(rear, front);
  check(hit && front.z - rear.z >= 3.89, `a car cannot drive into the back of another (gap ${(front.z - rear.z).toFixed(2)} m)`);
  check(rear.speed < 25 && front.speed > 10, `the one behind loses speed and the one ahead gains it (${rear.speed.toFixed(1)}, ${front.speed.toFixed(1)})`);
}
{
  const a = car(0, 0, 20);
  const b = car(1.6, 0, 20);
  check(collideKarts(a, b) && b.x - a.x >= 1.85, `cars side by side cannot overlap (${(b.x - a.x).toFixed(2)} m apart)`);
  check(!collideKarts(car(0, 0, 20), car(2.1, 0, 20)), "cars a door's width apart do not touch");
  check(!collideKarts(car(0, 0, 20), car(0, 4.2, 20)), "cars a length apart do not touch");
}
{
  const me = car(0, 0, 26);
  const other = car(0, 3, 12);
  const closing = bumpKart(me, other);
  check(closing > 10 && other.z - me.z >= 3.89 && me.speed < 26 && other.z === 3, `a player's own car feels the contact at once and is kept out of the other (closing ${closing.toFixed(1)} m/s)`);
}
{
  const bike = Object.assign(car(0, 0, 20), { veh: 1 });
  check(!collideKarts(bike, car(1.7, 0, 20)), "a motorbike is narrower than a car");
}
process.exitCode = failed ? 1 : 0;
