import './styles/main.css';
import { LensLabApp } from './app';

const container = document.getElementById('app')!;
const app = new LensLabApp(container);
(window as unknown as { lensLab: LensLabApp }).lensLab = app;
