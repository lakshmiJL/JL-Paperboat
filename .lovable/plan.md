## Plan: Public folder + audio-synced frame animation

### 1. Create the `public/` folder
TanStack Start (Vite) serves files from `public/` at the site root. I'll create:
- `public/frames/` — drop your 240 frames here (e.g. `frame_0001.jpg` … `frame_0240.jpg`)
- `public/audio/paper-boat-drift.mp3` — I'll move your uploaded audio here

Files in `public/` are referenced by absolute URL: `/frames/frame_0001.jpg`, `/audio/paper-boat-drift.mp3` — no import needed.

**Naming convention required**: frames must be zero-padded and sequentially numbered (e.g. `frame_0001.jpg` through `frame_0240.jpg`). If your filenames differ, tell me the pattern.

### 2. Build the synced animation component
A `<FrameAnimation />` component on the home route that:
- Preloads all 240 frames into an array of `Image` objects (with a loading progress indicator — 240 frames is heavy)
- Renders the current frame onto a `<canvas>` (smoother than swapping `<img>` src)
- Plays `paper-boat-drift.mp3` via an `<audio>` element
- On each `requestAnimationFrame`, computes `frameIndex = floor((audio.currentTime / audio.duration) * 240)` and draws that frame
- Play / pause / restart controls

### 3. Home page integration
Replace the placeholder in `src/routes/index.tsx` with the player, centered, with minimal chrome so the animation is the focus. Update route `head()` meta.

### Open questions
- **Frame format & filename pattern?** (jpg/png/webp, and exact naming) — webp recommended for 240-frame payload size.
- **Frame rate / duration?** I'll derive frame index from audio duration so the 240 frames stretch across the full song. Confirm that's what you want vs. a fixed FPS (e.g. 24fps = 10s loop).
- **Autoplay?** Browsers block autoplay with sound — I'll default to a "Play" button.

### How to upload
Once I've created `public/frames/`, drag-and-drop your 240 frames into that folder via the Lovable file UI, or zip them and upload — I'll extract into `public/frames/`.

### Heads up
240 frames in the repo will be large. If total size exceeds ~50MB I'd recommend switching to Lovable Assets (CDN) instead — but per your choice, we'll keep them in `public/`.