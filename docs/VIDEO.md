# Demo video

**Mangit Web: hybrid manga translation with Firebase AI Logic** — 2:04, 1920×1080, English on-screen text, music and sound effects.

- File: `video/mangit-web-demo.mp4` (not in git; attached to the [v0.2.4 release](https://github.com/mirzemehdi/mangit-web/releases/tag/v0.2.4) as `mangit-web-demo.mp4`).
- Footage: real screen recordings of mangit.app/translate and the Chrome extension running in Chrome with Gemini Nano, on our own demo chapters only.
- Music, sound effects and fonts: see [`video/CREDITS.md`](../video/CREDITS.md).
- Made with HyperFrames; the project files were removed from the repo after the film was approved.

| Time | Scene | What the judge sees |
|---|---|---|
| 0:00 | Hook | A raw Japanese page turns English in under 2 s; hover card shows the original and "Cloud · vertical text". |
| 0:08 | Reveal | Mangit Web · Free · No account · No API key · Open source; mangit.app/translate. |
| 0:14 | One click | Click the Mangit icon: the side panel opens and translates (Hybrid, ~2 s); hover card. |
| 0:26 | The idea | "The small model where it's good. The cloud only where it isn't." A detector boxes the real page: 3 horizontal bubbles to Gemini Nano, 1 vertical to Gemini in the cloud, at the same time. Firebase AI Logic code: `InferenceMode.PREFER_ON_DEVICE`, `response.inferenceSource`. |
| 0:44 | Where it ran | Hybrid on a Chinese page (Nano sped up, labelled); cyan "On your computer · Gemini Nano" and amber cloud hover cards; 3 on-device, 1 cloud. |
| 0:56 | Numbers | 94% of text right in Hybrid (15 test pages); 62% of bubbles never left the computer; Nano alone on vertical Japanese 51%. |
| 1:05 | Auto-translate | Scroll the chapter in the extension; each new page letters itself in (waits trimmed, labelled). |
| 1:15 | Modes + offline | Hybrid / Cloud / On-device; network off, a Korean page read on-device: "Nothing left this computer." |
| 1:27 | Chapters | PDF, CBZ, CBR, EPUB; open an EPUB, translate all 5 pages (11 s), download the English CBZ. |
| 1:41 | Cost | ~2 s per page in Cloud; ~$0.0005 per cloud bubble; a $10 monthly guard switches the cloud off. |
| 1:48 | Feedback | "Send us feedback" dialog. |
| 1:54 | End card | mangit.app/translate · GitHub · Firebase AI Logic; the Mangit app at mangit.app. |

All numbers come from the README, `docs/SUBMISSION.md` and `functions/index.js`. Speed-ups are labelled on screen.
