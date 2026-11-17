/**
 * installBridge.js
 * ----------------
 * Platform bridge installer. On Electron, `window.psx` is already provided by
 * the preload script (native main-process data layer), so this is a no-op. On
 * mobile (Capacitor) or a plain web build, `window.psx` is undefined, so we
 * install the Capacitor implementation — giving MarketContext the exact same
 * API on every platform.
 *
 * IMPORTANT: this module MUST be imported before MarketContext, because
 * MarketContext reads `window.psx` at module-evaluation time (`hasBridge`).
 */
import { capacitorPsx } from './capacitorPsx.js';

if (typeof window !== 'undefined' && !window.psx) {
  window.psx = capacitorPsx;
}
