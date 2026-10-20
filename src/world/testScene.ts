import * as THREE from 'three';
import type { Battlefield } from './types';

/** Minimal flat scene. `viewer` mode drops the grid/props and uses warmer studio light for model review. */
export function buildTestScene(scene: THREE.Scene, viewer = false): Battlefield {
  scene.background = new THREE.Color(0x87a0b5);
  scene.fog = new THREE.Fog(0x87a0b5, 200, 900);

  scene.add(new THREE.HemisphereLight(0xdde8ff, 0x5a4a3a, 1.2));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.position.set(60, 100, 40);
  sun.castShadow = true;
  sun.shadow.camera.left = sun.shadow.camera.bottom = -60;
  sun.shadow.camera.right = sun.shadow.camera.top = 60;
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5c, flatShading: true }),
  );
  ground.receiveShadow = true;
  scene.add(ground);
  if (viewer) {
    sun.position.set(-30, 50, -45);
    sun.intensity = 3.0;
    scene.add(new THREE.HemisphereLight(0xffe6cc, 0x6a5038, 0.8));
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
    sun.shadow.camera.right = sun.shadow.camera.top = 25;
    return { heightAt: () => 0, spawn: new THREE.Vector3(), radius: 500, update: () => {} };
  }
  scene.add(new THREE.GridHelper(400, 40, 0x444444, 0x666666));

  const mat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, flatShading: true, metalness: 0.3, roughness: 0.6 });
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(4 + i, 0), mat);
    m.position.set((i - 2) * 18, 4 + i, 0);
    m.castShadow = true;
    scene.add(m);
  }

  return {
    heightAt: () => 0,
    spawn: new THREE.Vector3(0, 0, 0),
    radius: 500,
    update: () => {},
  };
}
