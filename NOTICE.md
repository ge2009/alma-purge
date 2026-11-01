# NOTICE

## Inherited

The activation skeleton — `activate(context)`, the `PluginContext` destructuring
(`logger`, `events`, `settings`, `commands`, `ui`), the manifest shape, and the
`events.on('chat.message.willSend', handler, { priority })` call pattern — is
adapted from:

- **prompt-enhancer** — https://github.com/yetone/alma-plugins/tree/main/plugins/prompt-enhancer
- Author: Alma Team
- License: MIT

The MIT terms and original authorship for that skeleton are retained.

## Changed

| Area | prompt-enhancer | Purge |
| --- | --- | --- |
| Repeat fires | appends every time, text stacks | fixed marker, skips when present |
| Content | generic formatting guidelines | execution-directive presets |
| Tail | none | optional boost line |
| Commands | toggle only | toggle + status |
| Settings | 4 keys, one unused in practice | 5 keys, all wired |
| Tests | none in repo | 24 assertions, 9 cases |

## Not derived from dsh-purge

This plugin borrows the *idea* of reducing interaction friction, which is what
`dsh-purge` does for DeepSeek Harness (originally by YuJunZhiXue, maintained
as a community fork by kingcharleslzy-ai). No code
is shared: dsh-purge patches a host binary; this uses Alma's own plugin runtime.
