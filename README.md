# CrowTube

A minimal YouTube video repeater with queue management, custom play ranges, and ambient rain.

**[Live Demo](https://curiouscrow123.github.io/CrowTube)**

## Features

- **Queue** — Add multiple videos, play them in sequence or shuffle through randomly; drag and drop to reorder
- **Loop** — Loop the entire queue endlessly, with a counter tracking completed cycles
- **Play Range** — Set start/end trim points on any video to loop specific sections
- **Shuffle** — Plays every video once in random order before starting a new round
- **Rain Ambience** — Toggle soft rain background audio with adjustable volume and falling rain canvas animation
- **Share Links** — Copy a URL that encodes your full queue (with play ranges) so anyone can import it
- **Persistence** — Queue, settings, and rain state save to localStorage automatically

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
style.css     Styles
app.js        Application logic
```

No frameworks, no build tools, no package.json. Vanilla HTML/CSS/JS.

## How It Works

Paste a YouTube URL or video ID into the input field. **Play** loads it immediately; **+Queue** adds it to the end of the playlist. Click any video in the queue to jump to it. Drag items to rearrange the play order.

**Play Range** lets you trim a video to a specific segment (e.g., `0:30` to `1:45`). The trim is saved per-video and encoded in share links.

**Shuffle** picks a random unplayed video each time. Once all videos have played, it starts a fresh round (if looping is on) or stops.

**Rain** plays a looped MP3 with a full-screen canvas animation of falling rain streaks. Volume is adjustable via the slider that appears when rain is toggled on.

## Credits

Rain audio: [Light Rain](https://pixabay.com/sound-effects/light-rain-109591/) by Liecio on Pixabay
