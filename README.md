# Purge — an Alma plugin

Reduces interaction friction: the agent executes what was asked instead of
stopping to ask whether it should.

## Install

This repository *is* the plugin — `manifest.json` sits at the root, so Alma can
install it straight from the repo URL.

In Alma: **Settings → Plugins → Install from GitHub**, paste:

```
https://github.com/ge2009/alma-purge
```

Then enable **Purge**, and turn on `almaPurge.enabled` in its settings.

No restart, no host patching. Alma compiles the `.ts` entry point on activation
and caches it.

### Manual install

```sh
git clone https://github.com/ge2009/alma-purge
mkdir -p ~/.config/alma/plugins/alma-purge
cp manifest.json main.ts ~/.config/alma/plugins/alma-purge/
```

## What it does

It appends a short directive to the end of your outgoing message, so the agent
finishes the task in one turn instead of coming back with "shall I proceed?".

Three presets:

| Preset | Adds |
| --- | --- |
| `minimal` | don't ask for confirmation on implied steps |
| `standard` | the above, plus finish the whole task and report blockers with what was already tried |
| `strict` | the above, plus no hedging, and never claim a step succeeded unless it was actually verified |

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `almaPurge.enabled` | `false` | master switch — off means zero injection |
| `almaPurge.preset` | `standard` | `minimal` / `standard` / `strict` |
| `almaPurge.boost` | `true` | short reinforcement line at the very end |
| `almaPurge.customInstructions` | `""` | your own rules, appended after the preset |
| `almaPurge.debug` | `false` | log every decision |

## Commands

- `Purge: Toggle`
- `Purge: Show Status`

## Two details that matter

**Idempotency.** Alma fires `chat.message.willSend` more than once for the same
message. Injection is guarded by a fixed marker (`[purge:active]`), so a repeat
pass is a no-op rather than another append.

**Text parts are consolidated.** The host maps modified content onto *every*
text part:

```js
parts.map(p => p.type === 'text' ? { ...p, text: output.content } : p)
```

A message carrying two text parts (for example an injected timestamp part plus
the actual body) would therefore receive the whole directive twice. Purge
replaces the parts array with a single text part instead, preserving any
non-text parts. This bug exists in the plugin this was based on.

## What it does NOT do

- **No system-prompt rewrite.** Alma lists `chat.system.transform` as an event
  and `applyResult` has a branch for it, but the host never triggers it.
  Injecting into the user message is the channel that actually reaches the
  model.
- **No host patching.** Nothing here touches `app.asar`.
- **No tool-permission bypass.** Alma already has
  `security.autoApproveToolRequests`; a second hidden approval layer would make
  behaviour harder to reason about.

## Tests

```sh
node test/run.mjs
```

31 assertions across 11 cases, including the multi-part duplication regression.
`test/harness.mjs` reproduces the real `PluginContext` surface and the host's
`.dispose()` semantics.

## Credit

Skeleton adapted from
[prompt-enhancer](https://github.com/yetone/alma-plugins/tree/main/plugins/prompt-enhancer)
(Alma Team, MIT). See `NOTICE.md`.

## License

MIT — see `LICENSE`.
