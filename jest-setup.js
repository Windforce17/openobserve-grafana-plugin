// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';
import { TextDecoder, TextEncoder } from 'util';

Object.assign(globalThis, {
  TextDecoder: globalThis.TextDecoder || TextDecoder,
  TextEncoder: globalThis.TextEncoder || TextEncoder,
});

Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
  value: () => ({
    measureText: (text) => ({ width: String(text).length * 8 }),
  }),
});

Object.defineProperty(document, 'fonts', {
  value: {
    ready: Promise.resolve(),
  },
});

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});
