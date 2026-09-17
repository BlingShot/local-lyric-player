# Debugging and cache policy

Enable **Settings → Advanced → Debug mode**, reproduce the issue, then open **Debug Panel**.
The panel keeps the existing settings theme and offers Live Debug, Lyrics, Audio, TTML/API, Performance and Errors.
Copy Debug Info or Export Debug Report produces the same redacted JSON schema. Open Log Folder is available in Electron; the browser can export session logs but has no native log directory.

## Collection and privacy

Debug is off for a new installation. Normal mode keeps INFO/WARN/ERROR events, not word/timeupdate/frame logs.
Debug mode samples live state at 2 Hz, counts animation frames without rendering additional UI, and polls main-process memory/cache/log summaries no more than every 5 seconds. Disabling it cancels its interval and animation-frame callback and clears live snapshots. Existing playback animation and ordinary cache expiry are not diagnostic collectors.

Renderer logs retain at most 500 entries and 512 KiB. The main process keeps 3 files of at most 2 MiB each; writes are serialized and the queue is bounded, with reserved capacity for warnings/errors. The panel shows dropped counts. Reports have a separate 1 MiB budget and mark truncated sections rather than silently producing unbounded files.
Credentials, cookies, common credential formats, URL query strings and user-directory names are redacted before renderer retention, IPC, file writing and report export. Paths retain file names/extensions and directory structure after `[USER]`/`[DRIVE]`/`[NETWORK]` replacements. Reports contain song/lyric text for diagnosis: inspect the report before sharing it publicly. Nothing is automatically uploaded. Desktop report copying uses a trusted, write-only IPC endpoint that validates the 1 MiB input budget and redacts again; clipboard reading is never exposed to the renderer.

## Reading a reproduction

Lyrics shows the offset-adjusted clock, source, neighbours, active voices/words, original word timestamps, stable performer lane decision, interlude presentation and translation status. It observes the existing clock and never seeks or creates another player.
AMLL events share a trace ID and identify ISRC availability, each search/match/download, HTTP status, index/cache use, parsing and conditional save, application and fallback reason. Exact recording checks and protection against late downloads overwriting newer user lyrics are unchanged.
Audio events identify media loads/retries, analysis file/metadata/budget/context/decode/resample stages, and native device discovery, release, output configuration, temporary-file write, decode and output verification. Original errors/stacks are retained after redaction. The Audio view exposes existing metadata and context/output state without initializing a new context.
FPS/JS heap readings are platform-dependent. A missing reading means unavailable, not zero. Native decoder traces require the Windows backend; browser-only reproductions cannot describe a physical WASAPI device.

## Caches and packaging

The configured cache directory now owns the Chromium HTTP cache (128 MiB target), not the data folder. Generated code cache is checked at startup and cleared through Chromium when over 64 MiB. These are soft maintenance targets, not limits on the user music library.
The AMLL index retains at most a 16 MiB source/100,000-row parsed index, expires after 30 minutes, and is invalidated safely on explicit clearing. Its reported source bytes are not a claim of exact JS object heap usage. Completed, unobserved lyric-resolution jobs are capped at 64 and expire after 60 seconds. Active requests/readers are preserved.
Clear cache removes only regenerable Chromium caches and expired/inactive lookup data; it does not delete IndexedDB audio, saved lyrics, Studio drafts, analysis or settings. Native temporary files keep their existing ownership validation and two-file retention policy.
The analysis worker loads one local WASM binary instead of embedding it as a large base64 string. The pinned upstream web loader's environment flags are corrected at bundle time for workers; an unexpected upstream change fails the build. A VM regression initializes the real binary without a DOM, and packaged smoke tests exercise the localmusic:// protocol. Runtime dependencies/codecs and licenses remain. `npm run desktop:budget` checks the staged app payload (<8 MiB), one WASM asset, absence of maps/logs/models/dev dependencies, and records installer sizes when present. This budget excludes Electron and the bundled native decoder; it is not an EXE size claim.

Run `npm test`, `node --test tests/*.test.mjs`, `npm run test:debug`, the existing issue/lyric browser regressions, production audio-analysis tests and `npm run desktop:build` before release. Windows hardware/output-device testing remains separate from a successful cross-platform unit run.
