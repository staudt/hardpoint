# Future ideas: user's wishlist (not scheduled)

Captured 2026-10-19. Design properly before building; nothing here is approved yet.

## Heavy kinetic and "blunt" weapons
- **Chain-shot cannon** (inspired by Doom: The Dark Ages' Chainshot): a big heavy ball on a chain.
  - Slow, arcing, gravity-affected projectile with huge impact.
  - Knockback and stagger; possibly a tether effect (the chain wraps or drags the target).
- **Impaling spears / harpoons**: they embed in the target.
  - Ideas: damage over time, pinning or slowing, a tether that reels the target in or anchors it.
- General direction: weight and impact matter, not just damage numbers.

## Melee: machine-like, not humanoid
- **Avoid** Gundam-style human strikes and swords.
- **Wanted:** industrial and hydraulic weapons:
  - high-pressure piston hammers
  - pneumatic or hydraulic rams
  - crusher claws
  - drills
- **Feel:** wind-up and charge (pressure build-up), a heavy punch with steam venting, then a recovery delay. Heat cost and maybe a pressure resource.

## What the engine will need (notes for later)
- **Sim:**
  - A `ballistic` delivery mode with gravity, already sketched by the LRM arc.
  - Projectiles that stay attached to a target (embed, tether) as sim-side constraints.
  - Knockback impulses on mechs: a velocity/stagger state in `Mech`, pushing pose and speed.
- **Melee:**
  - A short swept volume tested against hit boxes over the strike's active frames.
  - Attack phases (wind-up, active, recovery) as sim state, so the strike stays deterministic.
- **Render:**
  - Animated melee hardpoints: a piston extension on an arm node.
  - Chain rendering as a segmented rope.
  - Steam particles; camera punch on impact.
- **Data:**
  - New `WeaponDef` deliveries (e.g. `chain`, `harpoon`, `melee`) and new hardpoint types (e.g. `melee`).
  - The mechlab must handle mounting them.
