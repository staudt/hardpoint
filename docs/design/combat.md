# Combat design (M3): approved by the user 2026-10-19

The core tension: **energy weapons cost heat, ballistics and missiles cost ammo.** Every loadout trades between the two.

## Weapon classes
| Class | Cost | Delivery |
|---|---|---|
| Energy (lasers, particle cannon) | Heat; unlimited shots | Laser = beam lasting 0.5–1 s; damage applies while it stays on target. Particle cannon = fast bolt. |
| Ballistic (machine gun, autocannon) | Ammo; little heat | Shells/tracers with travel time; lead your target |
| Missile (short- and long-range) | Ammo and moderate heat | Short-range: dumbfire spread volley. Long-range: lock-on, arcing flight, minimum range |

- Stats live in `src/data/weapons.ts`.
- Damage falls off linearly from `range` to `maxRange`.
- Ammo is stored in a body section: arm weapons keep theirs in the matching side torso, torso weapons in their own section. If that section's internal structure is destroyed while ammo remains, **the ammo explodes**.

## Heat
Heat runs 0–100% of the chassis heat capacity and drains through heat sinks. Desert ambient cooling ×0.85.

| Heat | Effect |
|---|---|
| < 50% | Normal |
| 50–70% | Top speed reduced (down to ×0.6 at 100%) |
| 70–90% | Aim wobble |
| 90–100% | Chance of an ammo explosion |
| ≥ 100% | Automatic shutdown, unless override is on. Override: internal damage to the centre torso, plus a higher ammo-explosion chance |

- Shutdown lasts at least 4 s and ends when heat drops below 40%.
- **Coolant flush:** 2 charges per mission, −40% heat each. Built in for now; eventually coolant, heat sinks and similar equipment become mech parts in the mechlab.

## Firing
- Up to 5 weapon groups. Defaults: Group 1 energy, Group 2 ballistic, Group 3 missiles.
- Hold the trigger to fire repeatedly as weapons come off cooldown.
- Each group has a **group fire** mode (all at once) and a **chain fire** mode (cycles through the group's weapons, 0.25 s apart).
- **Bindings:**
  - Left mouse = Group 1, right mouse = Group 2, Q or middle mouse = Group 3, keys 1–5 = any group, F = alpha strike.
  - The mouse wheel selects the active group, which T (chain toggle) and the config screen act on.
  - Tab opens group config: arrow keys pick a weapon, 1–5 toggle its group membership.
  - O = override toggle, C = coolant flush, E = target.

## Aiming
- The sim casts the aim ray from the mech's eye along the aim yaw/pitch, against terrain and mechs, up to 1200 m. The hit is the convergence point, and the HUD crosshair is drawn there.
- Arm weapons converge on that point within ±20° of torso forward. Torso weapons are limited to ±5°, so they land on the torso reticle while the torso is still twisting.
- **Long-range missile lock:**
  - The target must stay within 5° of the aim for 1.5 s.
  - Locked missiles home on the target. Unlocked ones fly to the aim point.
  - Missiles in flight keep homing after the lock breaks, but turn more weakly.

## Damage
- **Sections:** head, centre torso, left/right torso, left/right arm, left/right leg. Each has armour, then internal structure.
- **Hit detection:** boxes per section in the chassis data (`hitBoxes`), in the mech's local space. The torso frame rotates with the torso twist; the legs frame follows the legs' heading.
- **Overflow carries inward:** arm → side torso → centre torso, and leg → side torso.
- **Destroyed sections:**
  - Arm: lost, with its weapons.
  - Side torso: lost, and takes the arm with it.
  - Leg: the mech limps at ×0.3 speed. Both legs destroyed = mech destroyed.
  - Head or centre torso: mech destroyed.
- **Critical hits:** a 15% chance whenever internal structure is hit. Possible outcomes: a weapon is destroyed, an ammo bin explodes, or a heat sink is lost.
- Damage numbers are BattleTech-like, e.g. a 75 t mech has ~40 armour and ~23 internal structure on the centre torso, and a medium laser does 5.

## Architecture
- **`src/sim/combat/`:** deterministic and serialisable.
  - Weapon mounts with cooldown, ammo and groups.
  - Heat, projectiles, beams and missiles.
  - Ray/box and terrain raycasts; damage with overflow and criticals.
- **Sim → render** only through `world.events`, which the renderer drains each frame, plus the projectile/beam lists. Effects never change gameplay.
- **Muzzle offsets** are in the chassis data. A unit test keeps them in sync with the rig's `hp_*` nodes.
- Until enemy AI arrives in M4, the desert spawns dummy target mechs, some standing and some patrolling.

## Later
- The mouse wheel may get further group functions.
- Ammo depots as a mission objective.
- Jets: boost and jump jets, as a separate milestone.
- Mechlab equipment: heat sinks, coolant and ammo bins as slot items.
