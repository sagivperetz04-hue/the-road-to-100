# Audio: "Now Playing" clips and background music

Everything in this folder ships inside the APK. Use only audio you have the rights to.

## What plays when

| Kind | When | Default (nothing listed) |
| --- | --- | --- |
| **Clips** (5 seconds) | every 5 stairs and at the summit, with the "Now Playing" island | the app's own synthesized jingles |
| **Background music** | looping, per screen: `menu` (course / topic / source screens), `game` (the climb), `summit` (the summit screen) | silence |

Background music fades between screens, drops to a quarter of its volume while a clip plays, pauses when the
app goes to the background (Android `onPause`) and resumes when it comes back. It has its own on/off button
(a note icon) next to the sound button on the first screen; the button appears only when at least one track is
listed. Muting all sound also stops the music.

## manifest.json

The old format, a plain list, still means "clips":

```json
[]
```

The full format:

```json
{
  "clips": [
    { "file": "clips/milestone-1.mp3", "title": "Song title", "artist": "Artist", "start": 12.5 }
  ],
  "music": {
    "menu":   [ { "file": "music/menu.mp3", "title": "Calm loop", "volume": 0.3 } ],
    "game":   [ { "file": "music/climb-1.mp3" }, { "file": "music/climb-2.mp3" } ],
    "summit": [ { "file": "music/summit.mp3", "volume": 0.5 } ]
  }
}
```

- `file`: path inside `app/assets/audio/`. Types: `.mp3`, `.m4a`, `.aac`, `.ogg`, `.wav`.
- `start` (clips only, seconds): where the 5-second clip begins.
- `volume` (music, 0..1, default 0.35): use it to level tracks against each other.
- `loop` (music, default true): a scene with one track loops it; a scene with several plays them in turn.
- A scene can be left out or empty: that screen is silent.
- Keep files small (mono, 96–128 kbps mp3 is plenty). The validator warns above 4 MB per file.

## Adding music later

1. Put the files in `app/assets/audio/` (for example `audio/music/`).
2. List them in `manifest.json` as above.
3. Run `python3 tools/validate_data.py`: it fails on a missing file, an unknown scene, an unsupported type or a
   volume outside 0..1.
4. Run `tests/e2e_test.py` (its `[music]` section runs on generated test tones, so it passes without real tracks) and
   build with `tools/build.sh --bump`.

No code changes are needed. In code, `Sound.music("menu" | "game" | "summit" | null)` picks the playlist,
`Sound.pause()` / `Sound.resume()` follow the app's lifecycle, and `Sound.musicState()` reports what is playing.
