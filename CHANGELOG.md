# @andypai/orb

## 0.2.1

### Patch Changes

- Fix streaming TTS playback so ffplay pipe writes settle on stop or player exit,
  and raw PCM playback starts after a bounded preroll timeout without dropping the
  pending audio chunk.
