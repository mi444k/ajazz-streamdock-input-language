# Input Language for AJAZZ Stream Dock

Current version: **0.1.0**. Independent community plugin by Weboff.

Display and cycle the enabled macOS keyboard input sources from an AJAZZ key or pressable knob.

## Features

- Large primary language codes such as EN, RU and DE; unknown metadata shows --.
- External macOS source changes update visible keys through native notifications.
- A fresh snapshot and conditional selection prevent optimistic or stale language labels.
- Separate source IDs remain separate choices even when their primary languages match.

## Setup and workflow

Assign Input Language to a screen key or pressable knob. Press to cycle through enabled, selectable keyboard input sources in the order returned by macOS. Knob rotation does not switch sources. Manage enabled sources in macOS Keyboard settings; this plugin does not add or remove them. One available source remains selected. No API key or inspector setup is required.

## Privacy

The Swift/Carbon helper reads input-source metadata and selects source IDs. It does not record keystrokes, typed text or clipboard contents, and does not simulate keyboard shortcuts. The only network socket is the local AJAZZ connection. The helper is an owned child process, not a separately installed background service. No personal configuration or machine-specific source snapshots are included.

## Troubleshooting

An unavailable helper or protocol timeout displays -- instead of guessing. Press again, or wake the computer, to request fresh state. An unsuccessful selection alerts and keeps confirmed actual state. A concurrent macOS source change can cancel a selection without an automatic retry. Check that at least one keyboard input source is enabled and selectable. Restart AJAZZ after updating the plugin.

## Development

From the plugin folder run `npm test`; no npm install is required. `npm run build:native` rebuilds the universal helper using Xcode command-line tools and the macOS SDK. It targets macOS 13, combines arm64 and x86_64, and applies an ad-hoc signature. Unit tests use fake native processes and do not switch your keyboard. `node --test tests/native-snapshot.cjs` is an explicit read-only native check if supplied; its available-source assertions may depend on the local machine. `node tests/native-smoke.cjs` uses a local simulated AJAZZ connection and a read-only helper snapshot.

## Download and installation

Download the plugin ZIP from [GitHub Releases](https://github.com/mi444k/ajazz-streamdock-input-language/releases). Extract it and copy the complete `com.weboff.inputlanguage.sdPlugin` folder into:

```text
~/Library/Application Support/HotSpot/StreamDock/plugins/
```

Keep the folder name and its contents intact. Restart AJAZZ Stream Dock, find the plugin category, and drag its action onto the desired control. For an update, replace the runtime folder with AJAZZ closed; preserve your AJAZZ settings separately and never publish their backups. The repository also contains the plugin folder directly, so it can be copied manually without a release archive.

## Compatibility and verification limits

Requires macOS 13 or newer and AJAZZ's Node.js 20 plugin host. Development integration used AJAZZ Stream Dock 2.10.179.426 and an AKP03E revision 2. Other device models and host versions have not been exhaustively verified. The bundled helper contains arm64 and x86_64 code; native execution was verified on Apple Silicon, not Intel. The helper is ad-hoc signed and is not notarized; macOS security policy may require additional review before execution. Automated fake-transport tests and browser previews do not establish behavior on every physical key or knob. No Windows support is claimed.

## License and attribution

Project code is MIT-licensed, copyright 2026 Ilias Martis / Weboff. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Third-party dependencies retain their own rights. The supplied stock artwork is original MIT-licensed project artwork. This is an independent project and is not affiliated with or endorsed by AJAZZ.
