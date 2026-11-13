# Input Language for AJAZZ Stream Dock

Current version: **0.3.0**. Independent community plugin by Weboff.

Display and cycle keyboard input languages on Windows and macOS from an AJAZZ key or pressable knob.

## Features

- Primary language codes such as EN, RU and DE shown as a native Stream Dock title, so any script renders with system fonts; change font, size, colour and position in the key's title settings. A source without a language tag shows its system name (up to 12 characters). The plugin owns the title text: a custom title typed in Stream Dock is replaced by the live language.
- External source changes refresh visible keys: native notifications on macOS and foreground-layout metadata checks on Windows.
- A fresh snapshot and conditional selection prevent optimistic or stale language labels.
- Separate source IDs remain separate choices even when their primary languages match.

## Setup and workflow

Assign Input Language to a screen key or pressable knob. Press to cycle through enabled, selectable sources in system-provided order: macOS input sources or Windows loaded keyboard layouts. Knob rotation does not switch sources. Manage enabled sources in your operating system keyboard settings; this plugin does not add or remove them. One available source remains selected. No API key or inspector setup is required.

## Privacy

The macOS Swift/Carbon helper and Windows C# helper read input-source metadata and select source IDs. Windows reads the foreground application thread's keyboard layout and requests a change from that application; it never records keyboard events. It does not record keystrokes, typed text or clipboard contents, and does not simulate keyboard shortcuts. The only network socket is the local AJAZZ connection. The helper is an owned child process, not a separately installed background service. No personal configuration or machine-specific source snapshots are included.

## Troubleshooting

An unavailable helper or protocol timeout displays -- instead of guessing. Press again, or wake the computer, to request fresh state. An unsuccessful selection alerts and keeps confirmed actual state. A concurrent source change can cancel a selection without an automatic retry. On Windows, a foreground-window change also cancels an in-flight selection. Some applications reject input-language requests; elevated windows can block a normal-privilege helper. A rejected or unconfirmed request alerts rather than displaying the requested language as if it succeeded. Windows shows the foreground application's layout, which can differ between applications. IME composition modes and every TSF input profile are not individually selectable through this layout interface. Check that at least one keyboard input source is enabled and selectable. Restart AJAZZ after updating the plugin.

## Development

From the plugin folder run `npm test`; no npm install is required. `npm run build:native` rebuilds the universal helper using Xcode command-line tools and the macOS SDK. It targets macOS 13, combines arm64 and x86_64, and applies an ad-hoc signature. Unit tests use fake native processes and do not switch your keyboard. `node --test tests/native-snapshot.cjs` is an explicit read-only native check if supplied; its available-source assertions may depend on the local machine. `node tests/native-smoke.cjs` uses a local simulated AJAZZ connection and a read-only helper snapshot.

On Windows, run `powershell -NoProfile -File scripts/build-windows.ps1` from the plugin folder to rebuild the Windows helper with the .NET Framework compiler. The standard Windows GitHub Actions workflow builds the same source and runs native engine tests before exporting a release helper. No PowerShell execution-policy changes are required by the plugin.

## Download and installation

Download the plugin ZIP from [GitHub Releases](https://github.com/mi444k/ajazz-streamdock-input-language/releases). Extract it and copy the complete `com.weboff.inputlanguage.sdPlugin` folder into:

```text
~/Library/Application Support/HotSpot/StreamDock/plugins/
```

On Windows, copy the same complete plugin folder into the standard SDK location:

```text
%APPDATA%\HotSpot\StreamDock\plugins\
```

The exact vendor directory can differ between host editions; use your AJAZZ installation's plugin folder if it differs. The release ZIP includes both platform helpers.

Keep the folder name and its contents intact. Restart AJAZZ Stream Dock, find the plugin category, and drag its action onto the desired control. For an update, replace the runtime folder with AJAZZ closed; preserve your AJAZZ settings separately and never publish their backups. The repository also contains the plugin folder directly, so it can be copied manually without a release archive.

## Compatibility and verification limits

Requires Windows 10 or newer or macOS 13 or newer and AJAZZ's Node.js 20 plugin host. Standard Stream Dock screen keys and pressable knobs are supported across device families. Development device integration used AJAZZ Stream Dock 2.10.179.426 and an AKP03E revision 2 on macOS. Other models and host versions have not been exhaustively verified.

The macOS helper includes arm64 and x86_64 code; native execution was verified on Apple Silicon, not Intel. It is ad-hoc signed and not notarized. Windows requires an installed .NET Framework 4.x. The Windows helper is not Authenticode-signed; it does not execute PowerShell at runtime. Windows automated build, native protocol and Node behavior checks are separate from real Windows AJAZZ/device acceptance, which has not been performed. Do not interpret simulated host or CI results as physical hardware verification.

## License and attribution

Project code is MIT-licensed, copyright 2026 Ilias Martis / Weboff. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Third-party dependencies retain their own rights. The supplied stock artwork is original MIT-licensed project artwork. This is an independent project and is not affiliated with or endorsed by AJAZZ.
