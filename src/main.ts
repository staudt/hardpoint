import './style.css';
import { parseParams } from './core/params';
import { installDebugHandle } from './debug';
import { Game } from './game';

const debug = installDebugHandle();
const container = document.getElementById('app');
if (!container) throw new Error('#app container missing');

try {
  const game = new Game(container, parseParams(window.location.search));
  debug.game = game;
  game.start();
  debug.ready = true;
} catch (err) {
  debug.errors.push(String(err));
  container.innerHTML = `<pre class="fatal">Failed to start: ${String(err)}</pre>`;
  throw err;
}
