# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> This project is an independent fork of Feishin. The upstream changelog no longer applies; entries below describe this fork's own releases.

## [0.1.0] - 2026-11-16

### Added

- Apple Music-style lyrics (AMLL) with word-level highlighting and fluid background.
- Word-level lyrics upgrade pipeline (NetEase YRC, QQ QRC, Kugou KRC) on top of the library LRC.

### Changed

- Lyrics display settings wired to AMLL; unsupported legacy display settings removed.
- Auto-update, release channel, and changelog are stubs pending this fork's own release feed.

### Fixed

- Interlude dots flickering during intermissions.
- Pausing no longer steps word-level lyric progress backward.
- Out-of-order lyric timestamps no longer crash the lyric view.
- "Clear" no longer permanently disables the word-level lyric upgrade.
