# Changelog

## 0.1.0

Initial release.

- Inject an execution directive into outgoing user messages via
  `chat.message.willSend`.
- Three presets: `minimal`, `standard`, `strict`.
- Optional tail-end reinforcement line.
- Custom instructions appended after the preset.
- Fixed marker (`[purge:active]`) makes injection idempotent across repeated
  `willSend` fires.
- Consolidates text parts into a single part, so a message with multiple text
  parts does not receive the directive more than once. (The skeleton this was
  based on had this bug: setting only `content` makes the host stamp it onto
  every text part, duplicating the whole directive.)
- Commands: `toggle`, `status`.
- 31 assertions across 11 test cases.
