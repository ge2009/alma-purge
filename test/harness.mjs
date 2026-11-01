// Minimal plugin-host simulator: mirrors the real PluginContext surface
// (events.on / commands.register / settings.get+update / logger / ui)
// so we can drive main.ts exactly the way Alma drives it.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const ESBUILD = '/Applications/Alma.app/Contents/Resources/app.asar.unpacked/node_modules/esbuild/bin/esbuild';

export function makeContext(initial = {}) {
  const store = { ...initial };
  const hooks = new Map();
  const listeners = [];
  const commands = new Map();
  const logs = [];
  const notices = [];

  const logger = {
    info: (...a) => logs.push(['info', ...a]),
    warn: (...a) => logs.push(['warn', ...a]),
    error: (...a) => logs.push(['error', ...a]),
    debug: (...a) => logs.push(['debug', ...a]),
  };

  const ctx = {
    id: 'alma-purge',
    logger,
    storage: { local: {}, workspace: {}, secrets: {} },
    settings: {
      get: (k, d) => (k in store ? store[k] : d),
      update: async (k, v) => {
        const old = store[k];
        store[k] = v;
        listeners.forEach((f) => f({ key: k, oldValue: old, newValue: v }));
      },
      onDidChange: (f) => (listeners.push(f), { dispose: () => {} }),
    },
    events: {
      on: (name, handler, opts = {}) => {
        const arr = hooks.get(name) ?? [];
        const entry = { handler, priority: opts.priority ?? 0 };
        // real bus sorts descending by priority
        arr.push(entry);
        arr.sort((a, b) => b.priority - a.priority);
        hooks.set(name, arr);
        // mirrors KS.register().dispose -> splice out of the handler list
        return {
          dispose: () => {
            const i = arr.indexOf(entry);
            if (i !== -1) arr.splice(i, 1);
          },
        };
      },
      once: () => ({ dispose: () => {} }),
    },
    commands: {
      register: (name, fn) => (commands.set(name, fn), { dispose: () => {} }),
      execute: async (name, ...args) => commands.get(name)?.(...args),
    },
    ui: {
      showNotification: (msg, o) => notices.push([msg, o]),
      showError: (m) => notices.push([m, { type: 'error' }]),
      showWarning: (m) => notices.push([m, { type: 'warning' }]),
    },
    tools: { register: () => ({ dispose: () => {} }), unregister: () => {} },
    i18n: { t: (k) => k, locale: 'en', onDidChangeLocale: () => ({ dispose: () => {} }) },
  };

  // fire an event the way the host does: mutate `output` in place
  async function fire(name, input) {
    const output = {};
    const arr = hooks.get(name) ?? [];
    for (const h of arr) await h.handler(input, output);
    return output;
  }

  return { ctx, fire, store, logs, notices, commands, run: (n, ...a) => commands.get(n)?.(...a) };
}

export async function loadPlugin() {
  const { build } = await import('node:child_process');
  return null;
}
