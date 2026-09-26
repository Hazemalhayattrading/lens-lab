import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/main.css';
import './styles/lab.css';
import { LensLabApp } from './app';

declare global {
  interface Window {
    lensLab?: LensLabApp;
  }
}

async function fontsReady(): Promise<void> {
  // Canvas textures (distance scale, labels) need the real fonts before they are drawn.
  const loads = [
    document.fonts.load('600 64px "Inter Variable"'),
    document.fonts.load('700 64px "JetBrains Mono Variable"'),
  ];
  await Promise.race([Promise.all(loads), new Promise((r) => setTimeout(r, 2500))]);
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const loader = document.getElementById('loader');
  if (!webglAvailable()) {
    loader?.querySelector('.loader-sub')?.replaceChildren('This demo needs WebGL 2. Please try a recent Chrome, Edge, Firefox or Safari.');
    return;
  }
  await fontsReady();
  // let the loader paint before the (synchronous) scene construction
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const container = document.getElementById('app')!;
  const app = new LensLabApp(container);
  window.lensLab = app;
  await app.start();
  app.route();
  if (new URLSearchParams(location.search).has('capture')) {
    loader?.remove();
    return;
  }
  const hide = () => loader?.classList.add('done');
  const wait = () => (app.frameCount > 2 ? setTimeout(hide, 150) : requestAnimationFrame(wait));
  wait();
}

boot();
