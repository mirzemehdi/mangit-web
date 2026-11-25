# Demo video plan (≤ 3:00, English captions)

Footage: real screen recordings of the extension and web demo in Chrome with Gemini Nano, on our own demo chapters. Recorded by `scripts/record-demo.mjs`; edited with HyperFrames.

| Time | Scene | On screen | Caption / voice |
|---|---|---|---|
| 0:00–0:08 | Hook | A Japanese manga page; bubbles turn into English one by one | Read manga in English, on your own computer. |
| 0:08–0:22 | Problem | Reader scrolling a raw chapter; upload icons stacking up | Untranslated manga means waiting, or uploading every page you read to someone's server. |
| 0:22–0:52 | Extension, Hybrid | Side panel: Translate this page. Bubbles appear; cyan dots (on your computer) and amber dots (cloud); panel stats | Mangit Lens reads each bubble with Gemini Nano, right in Chrome. Bubbles it finds hard go to Gemini in the cloud, at the same time. |
| 0:52–1:05 | Learner card | Hover a bubble: original, translation, which model read it | Hover any bubble to see the original, and which model read it. |
| 1:05–1:30 | How it works | Animated diagram: detector (no model) → Nano for horizontal text → cloud for vertical Japanese, in parallel → second opinions | One Firebase AI Logic SDK for both. A detector with no model finds bubbles and their text direction; vertical Japanese, Nano's weak spot, goes to the cloud. |
| 1:30–1:48 | Offline | Wi-Fi off; On-device mode translates a Korean page; "Nothing left this computer" | On-device mode never touches the network. It works offline. |
| 1:48–2:08 | Chapter files | Open an EPUB, Translate whole chapter, download CBZ | Open a PDF, CBZ, CBR or EPUB, translate the whole chapter, and download it translated. Files never leave the browser. |
| 2:08–2:28 | Results | Benchmark table animating: On-device / Hybrid / Cloud | On 15 test pages, Hybrid read 94% of the text right with 62% of bubbles kept on the computer, and shared names got 94% of character names right. |
| 2:28–2:45 | Built safe | Icons: App Check, Remote Config kill switch, $10 shut-off, Firestore shared names | App Check on every call, a Remote Config kill switch, a monthly spending shut-off, and character names shared per series in Firestore. |
| 2:45–3:00 | End card | mangit-lens.web.app · GitHub · Mangit app | Try it at mangit-lens.web.app. Free and open source. |

Recordings needed:
1. Reader page + side panel (Hybrid), Japanese chapter
2. Hover card close-up
3. Offline On-device, Korean chapter
4. Chapter page: open EPUB, translate chapter, download
5. Web demo, drop a page
