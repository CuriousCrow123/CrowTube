# CrowTube

A minimal YouTube playlist player with ambient soundscapes and time-based themes.

**[Live Demo](https://curiouscrow123.github.io/CrowTube)**

## Features

- **Playlist** — Add videos by URL or ID, drag and drop to reorder, click to jump; editable playlist title saved across sessions
- **Play Range** — Trim any video to a specific segment (e.g., `0:30` to `1:45`), saved per-video
- **Shuffle** — Plays every video once in random order before starting a fresh round
- **Loop** — Loop the entire playlist endlessly
- **Rain Ambience** — Looped rain audio with adjustable volume and a full-screen falling rain canvas animation
- **Birds Ambience** — Layered bird chirping audio with independent volume control and a 3-second fade-in
- **Themes** — Four color palettes (Morning, Clear Sky, Golden Hour, Night) that auto-switch based on time of day, or can be locked manually via the floating theme picker
- **Share Links** — Copy or drag-to-bookmark a URL encoding your full playlist, play ranges, title, rain/birds state, and volume levels
- **Persistence** — Playlist, title, settings, ambience state, and theme preference save to localStorage automatically

## Getting Started

CrowTube is a static site — no build step, no dependencies. Just serve the files.

### GitHub Pages

Push to a GitHub repo with Pages enabled. Done.

### Local Development

YouTube embeds require an HTTP server (they won't load from `file://`). Any of these work:

```bash
python3 -m http.server 8080
npx serve
php -S localhost:8080
```

Then open [localhost:8080](http://localhost:8080).

## Project Structure

```
index.html    Markup
style.css     Styles and theme palettes
app.js        Application logic
crow-icon.svg Favicon / logo
```

No frameworks, no build tools, no package.json. Vanilla HTML/CSS/JS.

## How It Works

Paste a YouTube URL or video ID into the input field and click **+Queue** to add it to the playlist. Click any video in the playlist to jump to it. Drag items to rearrange the play order. Click the playlist title to rename it.

**Play Range** lets you trim a video to a specific segment. The trim is saved per-video and encoded in share links.

**Shuffle** picks a random unplayed video each time. Once all videos have played, it starts a fresh round (if looping is on) or stops.

**Rain** and **Birds** each play a looped audio track with independent volume sliders. Rain includes a full-screen canvas animation of falling rain streaks that adapts its drop color to the current theme.

**Themes** cycle automatically based on the hour — morning (6-10), day (10-17), sunset (17-20), night (20-6) — or pick one manually from the floating sun/moon button in the bottom-right corner.

**Share** — click the link icon to copy a URL encoding your entire session. Drag it to your bookmark bar for one-step saving.

## Credits

Rain audio: [Light Rain](https://pixabay.com/sound-effects/light-rain-109591/) by Liecio on Pixabay
Birds audio: [Nature Birds](https://pixabay.com/sound-effects/nature-birds-19624/) on Pixabay
