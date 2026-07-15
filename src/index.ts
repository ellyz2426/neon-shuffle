import { World } from '@iwsdk/core';
import { GameSystem } from './game-system';

async function main() {
  const container = document.getElementById('scene-container')! as HTMLDivElement;

  const world = await World.create(container, {
    xr: { offer: 'once' },
    render: {
      fov: 60,
      near: 0.01,
      far: 200,
      defaultLighting: false,
      camera: { position: [0, 2.8, 1.0], lookAt: [0, 1.0, -2.5] },
    },
    input: { canvasPointerEvents: true },
    features: {
      locomotion: false,
      grabbing: false,
      physics: false,
      spatialUI: true,
    },
  });

  world.registerSystem(GameSystem);
}

main();
