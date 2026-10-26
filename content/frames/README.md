# Warm ink frame

The required asset is `warm-ink-frame.png`. It is pending. No picture engine was called in pass 3.

`server/frames.js` buys one frame per style and writes a receipt before sending. It checks letters, zero characters, and the decorative border using the existing picture checker. It verifies the saved image hash before reuse. A failed or interrupted attempt stays blocked for the lead to inspect, with no automatic second generation.

The poster uses the checked PNG as a placed image. It has no code-drawn ornaments. No placeholder is labelled as engine art.

The prompt in `buildFrameRequest()` is written by Codex for Sunny to read.
