# Song clips for the "Now Playing" island

The game plays a 5-second clip at every 5-step milestone and at the summit.

- With this manifest empty (`[]`), the app plays its own built-in synthesized jingles.
- To use your own clips, drop audio files here (mp3/ogg/m4a) and list them:

```json
[
  { "file": "my-clip.mp3", "title": "Song title", "artist": "Artist", "start": 12.5 },
  { "file": "another.mp3", "title": "Another one", "artist": "Someone" }
]
```

`start` (seconds, optional) is where the 5-second clip begins. Use only audio you have the rights to.
