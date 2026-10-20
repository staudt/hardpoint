import * as THREE from 'three';
import type { ChassisDef, HitLocation } from '../data/chassis';
import { angleDiff } from '../sim/angles';
import { MAX_GROUPS, type MechCombat } from '../sim/combat/mechCombat';
import type { Mech } from '../sim/mech';

export interface HudTarget {
  mech: Mech;
  distance: number;
  /** World points for the bracket box: bottom centre and top centre of the mech. */
  bottom: THREE.Vector3;
  top: THREE.Vector3;
}

export interface HudMission {
  phase: 'intermission' | 'combat' | 'failed';
  wave: number;
  timer: number;
  remaining: number;
  waveSize: number;
  kills: number;
}

export interface RadarBlip {
  x: number;
  z: number;
  hostile: boolean;
  alive: boolean;
  targeted: boolean;
}

export interface HudFrame {
  /** Heading the view faces (rad, yaw convention). */
  viewYaw: number;
  legYaw: number;
  torsoYaw: number;
  /** Signed speed (m/s). */
  speed: number;
  maxSpeed: number;
  /** Where the torso's weapons currently point (torso reticle). */
  torsoAimPoint: THREE.Vector3;
  /** Convergence point of the aim (crosshair). */
  aimPoint: THREE.Vector3;
  camera: THREE.Camera;
  pointerLocked: boolean;
  combat: MechCombat;
  selectedGroup: number;
  configOpen: boolean;
  configWeapon: number;
  override: boolean;
  target: HudTarget | null;
  /** Instant Action state, or null in other modes. */
  mission: HudMission | null;
  /** Player position + every other unit, for the radar. */
  radar: { x: number; z: number; blips: RadarBlip[] };
  dt: number;
}

const RADAR_RANGE = 800;

const LOCATIONS: [HitLocation, string][] = [
  ['head', 'HEAD'], ['ct', 'C TORSO'], ['lt', 'L TORSO'], ['rt', 'R TORSO'],
  ['la', 'L ARM'], ['ra', 'R ARM'], ['ll', 'L LEG'], ['rl', 'R LEG'],
];

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

function integrityColor(f: number): string {
  if (f <= 0) return '#3a3a3a';
  if (f > 0.75) return 'var(--hud)';
  if (f > 0.5) return '#e8e05a';
  if (f > 0.25) return 'var(--warn)';
  return 'var(--danger)';
}

/** Move a centre-anchored HUD element over a projected world point (hidden when off-screen). */
function placeAt(el: HTMLElement, world: THREE.Vector3, camera: THREE.Camera): boolean {
  _p.copy(world).project(camera);
  const onScreen = _p.z < 1 && Math.abs(_p.x) < 1.2 && Math.abs(_p.y) < 1.2;
  el.style.visibility = onScreen ? '' : 'hidden';
  if (onScreen) el.style.translate = `${(_p.x * 50).toFixed(2)}vw ${(-_p.y * 50).toFixed(2)}vh`;
  return onScreen;
}

/** DOM/CSS heads-up display. Layout follows the concept art (see CLAUDE.md). */
export class Hud {
  readonly el: HTMLDivElement;
  private readonly compass: HTMLCanvasElement;
  private readonly heading: HTMLDivElement;
  private readonly reticle: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly twist: HTMLDivElement;
  private readonly twistMarker: HTMLDivElement;
  private readonly speedText: HTMLSpanElement;
  private readonly speedBar: HTMLDivElement;
  private readonly heatBar: HTMLDivElement;
  private readonly heatText: HTMLDivElement;
  private readonly heatExtra: HTMLDivElement;
  private readonly prompt: HTMLDivElement;
  private readonly warning: HTMLDivElement;
  private readonly ticker: HTMLDivElement;
  private readonly brackets: HTMLDivElement;
  private readonly bracketLabel: HTMLDivElement;
  private readonly lockRing: HTMLDivElement;
  private readonly targetPanel: HTMLDivElement;
  private readonly hitFlash: HTMLDivElement;
  private readonly groupHeader: HTMLDivElement;
  private readonly objectives: HTMLDivElement;
  private readonly radar: HTMLCanvasElement;
  private readonly endScreen: HTMLDivElement;
  private readonly weaponRows: HTMLDivElement[];
  private readonly damageRows: Map<HitLocation, { row: HTMLDivElement; bar: HTMLElement }>;
  private readonly targetRows: Map<HitLocation, HTMLElement>;
  private readonly messages: { text: string; ttl: number; cls: string }[] = [];
  private hitTimer = 0;
  private blink = 0;

  constructor(parent: HTMLElement, chassis: ChassisDef, mission: { theatre: string; operation: string }) {
    const el = (this.el = document.createElement('div'));
    el.className = 'hud';
    const locRows = (prefix: string): string =>
      LOCATIONS.map(([id, label]) => `<div class="row" data-${prefix}="${id}"><span>${label}</span><div class="bar"><i style="width:100%"></i></div></div>`).join('');
    el.innerHTML = `
      <div class="hud-title">
        <div class="logo">HARDPOINT</div>
        <div>${chassis.name.toUpperCase()} ${chassis.variant} · ${chassis.tonnage}T</div>
        <div>${mission.theatre}</div>
        <div>${mission.operation}</div>
      </div>
      <div class="hud-compass"><canvas width="560" height="46"></canvas><div class="heading">000</div></div>
      <div class="hud-hitflash"></div>
      <div class="hud-brackets"><i></i><i></i><i></i><i></i><div class="hud-lock"></div><div class="label"></div></div>
      <div class="hud-crosshair"></div>
      <div class="hud-reticle"></div>
      <div class="hud-twist"><div class="track"></div><div class="center"></div><div class="marker"></div></div>
      <div class="hud-warning"></div>
      <div class="hud-ticker"></div>
      <div class="hud-panel hud-objectives" hidden></div>
      <div class="hud-radar"><canvas width="200" height="200"></canvas><span>${RADAR_RANGE}m</span></div>
      <div class="hud-end" hidden></div>
      <div class="hud-panel hud-target" hidden><div class="panel-title"></div><div class="sub"></div>${locRows('tloc')}</div>
      <div class="hud-panel hud-damage">
        <div class="panel-title">${chassis.name.toUpperCase()}</div>
        ${locRows('loc')}
      </div>
      <div class="hud-panel hud-weapons">
        <div class="groups"></div>
        <div class="list"></div>
        <div class="speed"><span>SPD</span><span class="value">0</span><small>KPH</small><div class="bar"><i></i></div></div>
      </div>
      <div class="hud-heat"><span>HEAT</span><div class="heat-pct">0%</div><div class="column"><i></i><b style="bottom:50%"></b><b style="bottom:70%"></b><b style="bottom:90%"></b></div><div class="heat-extra"></div></div>
      <div class="hud-prompt">CLICK TO TAKE CONTROL<small>WASD move · mouse aim · LMB/RMB/Q fire groups 1–3 · F alpha · E target · Tab groups · V view · M mute</small></div>
    `;
    parent.appendChild(el);
    const q = <T extends HTMLElement>(sel: string): T => el.querySelector(sel) as T;
    this.compass = q('.hud-compass canvas');
    this.heading = q('.hud-compass .heading');
    this.reticle = q('.hud-reticle');
    this.crosshair = q('.hud-crosshair');
    this.twist = q('.hud-twist');
    this.twistMarker = q('.hud-twist .marker');
    this.speedText = q('.speed .value');
    this.speedBar = q('.speed .bar i');
    this.heatBar = q('.hud-heat .column i');
    this.heatText = q('.hud-heat .heat-pct');
    this.heatExtra = q('.hud-heat .heat-extra');
    this.prompt = q('.hud-prompt');
    this.warning = q('.hud-warning');
    this.ticker = q('.hud-ticker');
    this.brackets = q('.hud-brackets');
    this.bracketLabel = q('.hud-brackets .label');
    this.lockRing = q('.hud-lock');
    this.targetPanel = q('.hud-target');
    this.hitFlash = q('.hud-hitflash');
    this.groupHeader = q('.hud-weapons .groups');
    this.objectives = q('.hud-objectives');
    this.radar = q('.hud-radar canvas');
    this.endScreen = q('.hud-end');

    const list = q('.hud-weapons .list');
    this.weaponRows = chassis.loadout.map(() => {
      const row = document.createElement('div');
      row.className = 'row weapon';
      row.innerHTML = `<b></b><span class="name"></span><em class="ammo"></em><div class="bar"><i></i></div><span class="badges">${'<u></u>'.repeat(MAX_GROUPS)}</span>`;
      list.appendChild(row);
      return row;
    });
    this.damageRows = new Map(
      LOCATIONS.map(([id]) => {
        const row = el.querySelector(`[data-loc="${id}"]`) as HTMLDivElement;
        return [id, { row, bar: row.querySelector('i') as HTMLElement }];
      }),
    );
    this.targetRows = new Map(LOCATIONS.map(([id]) => [id, el.querySelector(`[data-tloc="${id}"] i`) as HTMLElement]));
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  /** Scrolling event line ("L ARM DESTROYED", …). */
  message(text: string, cls = ''): void {
    this.messages.unshift({ text, ttl: 3.5, cls });
    this.messages.length = Math.min(this.messages.length, 4);
  }

  /** Flash a damage indicator; `relYaw` = direction of the hit relative to the view (rad, 0 = ahead). */
  hit(relYaw: number): void {
    this.hitTimer = 0.6;
    this.hitFlash.style.rotate = `${(-relYaw * 180) / Math.PI}deg`;
  }

  update(f: HudFrame): void {
    this.blink = (this.blink + f.dt) % 1;
    this.drawCompass(f.viewYaw);
    placeAt(this.crosshair, f.aimPoint, f.camera);
    placeAt(this.twist, f.aimPoint, f.camera);
    placeAt(this.reticle, f.torsoAimPoint, f.camera);

    const twist = angleDiff(f.torsoYaw, f.legYaw);
    this.twistMarker.style.left = `${50 - (twist / Math.PI) * 50}%`;

    const kph = Math.abs(f.speed) * 3.6;
    this.speedText.textContent = `${f.speed < -0.1 ? '-' : ''}${kph.toFixed(0)}`;
    this.speedBar.style.width = `${Math.min(100, (Math.abs(f.speed) / f.maxSpeed) * 100)}%`;
    this.prompt.hidden = f.pointerLocked;

    this.updateHeat(f);
    this.updateWeapons(f);
    this.updateDamage(f.combat);
    this.updateTarget(f);
    this.updateMission(f.mission);
    this.drawRadar(f);

    this.hitTimer = Math.max(0, this.hitTimer - f.dt);
    this.hitFlash.style.opacity = (this.hitTimer / 0.6).toFixed(2);

    for (const m of this.messages) m.ttl -= f.dt;
    while (this.messages.length && this.messages.at(-1)!.ttl <= 0) this.messages.pop();
    const html = this.messages.map((m) => `<div class="${m.cls}">${m.text}</div>`).join('');
    if (this.ticker.innerHTML !== html) this.ticker.innerHTML = html;
  }

  private updateHeat(f: HudFrame): void {
    const c = f.combat;
    const h = c.heatFrac;
    this.heatBar.style.height = `${Math.min(100, h * 100).toFixed(1)}%`;
    this.heatText.textContent = `${Math.round(h * 100)}%`;
    this.heatExtra.innerHTML = `CLNT ${c.coolant}${f.override ? '<br><span class="ovr">OVR</span>' : ''}`;
    let warn = '';
    let cls = '';
    if (!c.alive) {
      warn = f.mission ? '' : 'MECH DESTROYED<small>R to redeploy</small>';
      cls = 'danger';
    } else if (c.shutdown) {
      warn = 'SHUTDOWN<small>cooling down…</small>';
      cls = 'danger';
    } else if (h >= 1 && f.override) {
      warn = 'OVERRIDE — CRITICAL HEAT';
      cls = 'danger';
    } else if (h >= 0.9) {
      warn = this.blink < 0.5 ? 'HEAT CRITICAL' : '';
      cls = 'danger';
    } else if (h >= 0.7) {
      warn = 'HEAT HIGH';
      cls = 'warn';
    }
    if (this.warning.innerHTML !== warn) this.warning.innerHTML = warn;
    this.warning.className = `hud-warning ${cls}`;
  }

  private updateWeapons(f: HudFrame): void {
    const c = f.combat;
    let header = '';
    for (let g = 0; g < MAX_GROUPS; g++) {
      const sel = g === f.selectedGroup ? ' sel' : '';
      header += `<span class="g${sel}">${g + 1}${c.chainMode[g] ? '<small>C</small>' : ''}</span>`;
    }
    header += f.configOpen ? '<span class="cfg">CONFIG ↑↓ + 1–5 · TAB done</span>' : '<span class="hint">WHEEL sel · T chain · TAB cfg</span>';
    if (this.groupHeader.innerHTML !== header) this.groupHeader.innerHTML = header;

    c.weapons.forEach((w, i) => {
      const row = this.weaponRows[i];
      if (!row) return;
      const name = row.querySelector('.name')!;
      if (name.textContent !== w.def.name) name.textContent = w.def.name;
      (row.querySelector('b') as HTMLElement).textContent = String(i + 1);
      const ammo = Number.isFinite(w.ammo) ? String(w.ammo) : '∞';
      const ammoEl = row.querySelector('.ammo')!;
      if (ammoEl.textContent !== ammo) ammoEl.textContent = ammo;
      const ready = w.def.cooldown > 0 ? 1 - w.cooldown / w.def.cooldown : 1;
      (row.querySelector('.bar i') as HTMLElement).style.width = `${(ready * 100).toFixed(0)}%`;
      const badges = row.querySelectorAll('u');
      badges.forEach((b, g) => b.classList.toggle('on', (w.groups & (1 << g)) !== 0));
      row.classList.toggle('dead', w.destroyed);
      row.classList.toggle('empty', !w.destroyed && w.ammo <= 0);
      row.classList.toggle('ingroup', (w.groups & (1 << f.selectedGroup)) !== 0);
      row.classList.toggle('cursor', f.configOpen && i === f.configWeapon);
    });
  }

  private updateDamage(c: MechCombat): void {
    for (const [loc, { row, bar }] of this.damageRows) {
      const k = c.integrity(loc);
      bar.style.width = `${(k * 100).toFixed(0)}%`;
      bar.style.background = integrityColor(k);
      row.classList.toggle('dead', c.destroyed[loc]);
    }
  }

  private updateTarget(f: HudFrame): void {
    const t = f.target;
    this.targetPanel.hidden = !t;
    if (!t) {
      this.brackets.style.visibility = 'hidden';
      return;
    }
    // Brackets sized from the projected top/bottom of the target.
    _p.copy(t.bottom).project(f.camera);
    _q.copy(t.top).project(f.camera);
    const visible = _p.z < 1 && _q.z < 1 && Math.abs(_p.x) < 1.1 && Math.abs(_q.y) < 1.2;
    this.brackets.style.visibility = visible ? '' : 'hidden';
    if (visible) {
      const hPx = Math.max(24, Math.abs(_q.y - _p.y) * 0.5 * window.innerHeight);
      const wPx = Math.max(24, hPx * 0.8);
      const cx = ((_p.x + _q.x) / 2) * 50;
      const cy = (-(_p.y + _q.y) / 2) * 50;
      this.brackets.style.translate = `${cx.toFixed(2)}vw ${cy.toFixed(2)}vh`;
      this.brackets.style.width = `${wPx.toFixed(0)}px`;
      this.brackets.style.height = `${hPx.toFixed(0)}px`;
      this.brackets.style.marginLeft = `${(-wPx / 2).toFixed(0)}px`;
      this.brackets.style.marginTop = `${(-hPx / 2).toFixed(0)}px`;
    }
    const name = `${t.mech.def.name.toUpperCase()} ${t.mech.def.variant}`;
    const label = `${name}<br>${Math.round(t.distance)}m`;
    if (this.bracketLabel.innerHTML !== label) this.bracketLabel.innerHTML = label;
    const lock = f.combat.lock;
    const hasLauncher = f.combat.weapons.some((w) => !w.destroyed && w.def.lockTime !== undefined);
    this.lockRing.style.display = hasLauncher && lock > 0 ? '' : 'none';
    this.lockRing.style.setProperty('--lock', `${(lock * 360).toFixed(0)}deg`);
    this.lockRing.classList.toggle('locked', lock >= 1);

    (this.targetPanel.querySelector('.panel-title') as HTMLElement).textContent = name;
    (this.targetPanel.querySelector('.sub') as HTMLElement).textContent =
      `${Math.round(t.distance)} m · ${t.mech.def.tonnage}T${lock >= 1 ? ' · LOCKED' : ''}`;
    for (const [loc, bar] of this.targetRows) {
      const k = t.mech.combat.integrity(loc);
      bar.style.width = `${(k * 100).toFixed(0)}%`;
      bar.style.background = integrityColor(k);
    }
  }

  private updateMission(m: HudMission | null): void {
    this.objectives.hidden = !m;
    this.endScreen.hidden = !m || m.phase !== 'failed';
    if (!m) return;
    const box = (done: boolean): string => `<i class="box${done ? ' done' : ''}"></i>`;
    const primary =
      m.phase === 'intermission'
        ? `${box(m.wave > 0)}${m.wave === 0 ? 'Hostiles inbound' : `Wave ${m.wave} cleared`} — next wave in ${Math.ceil(m.timer)}s`
        : `${box(false)}Destroy wave ${m.wave} hostiles (${m.waveSize - m.remaining}/${m.waveSize})`;
    const html = `<div class="label">PRIMARY</div><div class="obj">${primary}</div>
      <div class="label">SECONDARY</div><div class="obj">${box(false)}Survive — kills ${m.kills}</div>`;
    if (this.objectives.innerHTML !== html) this.objectives.innerHTML = html;
    if (m.phase === 'failed') {
      const end = `<div class="title">MISSION FAILED</div><div>Waves cleared: ${Math.max(0, m.wave - 1)} · Kills: ${m.kills}</div><small>R to restart</small>`;
      if (this.endScreen.innerHTML !== end) this.endScreen.innerHTML = end;
    }
  }

  /** Top-down radar, rotated so the view direction points up. */
  private drawRadar(f: HudFrame): void {
    const c = this.radar;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const r = c.width / 2;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = 'rgba(8, 20, 12, 0.55)';
    ctx.strokeStyle = 'rgba(157,255,157,0.35)';
    ctx.beginPath();
    ctx.arc(r, r, r - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    for (const k of [0.33, 0.66]) {
      ctx.beginPath();
      ctx.arc(r, r, (r - 1) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    // View cone.
    ctx.fillStyle = 'rgba(157,255,157,0.08)';
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.arc(r, r, r - 1, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
    ctx.fill();
    // Legs heading tick relative to view.
    const legRel = angleDiff(f.viewYaw, f.legYaw);
    ctx.strokeStyle = 'rgba(255,179,71,0.8)';
    ctx.beginPath();
    ctx.moveTo(r, r);
    ctx.lineTo(r - Math.sin(legRel) * 16, r - Math.cos(legRel) * 16);
    ctx.stroke();

    const cos = Math.cos(f.viewYaw);
    const sin = Math.sin(f.viewYaw);
    const scale = (r - 6) / RADAR_RANGE;
    for (const b of f.radar.blips) {
      const dx = b.x - f.radar.x;
      const dz = b.z - f.radar.z;
      // Rotate world offset into view space (view forward = screen up).
      const sx = dx * cos - dz * sin;
      const sy = dx * sin + dz * cos;
      let px = sx * scale;
      let py = sy * scale;
      const len = Math.hypot(px, py);
      const edge = len > r - 6;
      if (edge) {
        px *= (r - 6) / len;
        py *= (r - 6) / len;
      }
      ctx.fillStyle = !b.alive ? 'rgba(120,120,120,0.6)' : b.hostile ? '#ff4a3a' : '#7ad8ff';
      ctx.beginPath();
      ctx.arc(r + px, r + py, edge ? 2.5 : b.alive ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (b.targeted) {
        ctx.strokeStyle = '#ffb347';
        ctx.strokeRect(r + px - 7, r + py - 7, 14, 14);
      }
    }
    // Player marker.
    ctx.fillStyle = '#9dff9d';
    ctx.beginPath();
    ctx.moveTo(r, r - 7);
    ctx.lineTo(r - 5, r + 5);
    ctx.lineTo(r + 5, r + 5);
    ctx.closePath();
    ctx.fill();
  }

  private drawCompass(yaw: number): void {
    const c = this.compass;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const heading = ((((-yaw * 180) / Math.PI) % 360) + 360) % 360;
    this.heading.textContent = heading.toFixed(0).padStart(3, '0');
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.strokeStyle = ctx.fillStyle = 'rgba(157,255,157,0.9)';
    ctx.font = '15px "Share Tech Mono", monospace';
    ctx.textAlign = 'center';
    const pxPerDeg = c.width / 120;
    for (let d = Math.floor(heading - 60); d <= heading + 60; d++) {
      const deg = ((d % 360) + 360) % 360;
      const x = c.width / 2 + (d - heading) * pxPerDeg;
      if (deg % 45 === 0) {
        const label = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][deg / 45]!;
        ctx.fillText(label, x, 15);
        ctx.fillRect(x - 1, 22, 2, 14);
      } else if (deg % 5 === 0) {
        ctx.fillRect(x - 0.5, deg % 15 === 0 ? 26 : 30, 1, deg % 15 === 0 ? 10 : 6);
      }
    }
    ctx.fillRect(0, 36, c.width, 1);
  }
}
