# Chrome Web Store listing: Mangit

Upload: `store/mangit-chrome-0.2.4.zip`

## Store listing tab

**Name** (from manifest): Mangit: Manga Translator for Chrome

**Summary** (132 max, from manifest description, 118 chars):
Translate manga, manhwa and manhua on any website. Free, about 2 seconds a page, with on-device AI when Chrome has it.

> If the manifest description differs, the store shows the manifest one. Keep them in sync.

**Category:** Tools
**Language:** English

**Description:**

```
Read raw manga, manhwa and manhua in English (or 13 other languages) right on the page you're reading. Open the side panel, press Translate, and the translation is lettered into each speech bubble in about two seconds.

FREE, NO ACCOUNT, NO API KEY
Install and press Translate. Nothing to sign up for, nothing to paste in.

FAST
Every bubble is read at the same time, so a full page usually takes 2 to 4 seconds in Cloud mode.

PRIVATE WHEN YOU WANT IT
Choose where the AI runs:
• On-device: Gemini Nano, the AI built into Chrome, reads every bubble on your computer. Nothing leaves it.
• Hybrid: Gemini Nano first, and only the hard bubbles (like vertical Japanese) go to the cloud.
• Cloud: Gemini in the cloud reads everything at once. Fastest, and works in any Chrome.
If Gemini Nano isn't available, Mangit asks before anything goes to the cloud. It never switches silently.

MADE FOR READING
• Japanese, Korean and Chinese pages, vertical and horizontal text
• Lettering fitted to each bubble's shape
• Hover a bubble to see the original text and who translated it
• Character names: add a spelling once and every page uses it, optionally shared with other readers of the series
• Auto-translate as you scroll: new bubbles and next pages translate by themselves
• Show original / clear with one click, keyboard shortcut Alt+T

WHOLE CHAPTERS TOO
Open a PDF, CBZ, CBR or EPUB file (or a single image), translate one page or the whole chapter, and download it translated as PNG, CBZ or PDF. Files are read in your browser and never uploaded.

OPEN SOURCE
The code is public at github.com/mirzemehdi/mangit-web. Built with Firebase AI Logic hybrid inference.

ALSO ON YOUR PHONE
The free Mangit app for iPhone and Android redraws whole pages with cleaned art: mangit.app

Questions or bugs? Use the Feedback button in the side panel. We read every message.
```

**Graphic assets:**
- Store icon 128×128: `dist/icons/icon128.png`
- Screenshots 1280×800: `store/1-translate-japanese.png`, `store/2-hover-original.png`, `store/3-open-chapters.png`
- Small promo tile 440×280: `store/promo-small-440x280.png`
- Marquee 1400×560: `store/promo-marquee-1400x560.png`

**Official URL:** mangit.app (pick it if the domain is verified in Search Console for this Google account; otherwise leave empty)
**Homepage URL:** https://mangit.app/translate/
**Support URL:** https://github.com/mirzemehdi/mangit-web/issues

## Privacy practices tab

**Single purpose:**
Translate the text in manga and comic speech bubbles on the page the user is reading (or in a file they open) and show the translation over each bubble.

**Permission justifications:**
- `sidePanel`: The translator's controls (Translate button, mode, language, character names) live in Chrome's side panel next to the page.
- `activeTab`: When the user presses Translate, the extension takes a screenshot of the visible tab to find the speech bubbles on that page.
- `scripting`: Injects the content script and stylesheet that draw the translated lettering over each bubble on the current page, only after the user presses Translate.
- `storage`: Saves the user's settings (mode, target language) and the character names they add, on their device.
- Host permission: none at install. `<all_urls>` is an optional permission, requested only if the user clicks "Allow on all sites" in the side panel, so they don't have to click the toolbar icon again on every new page. Pages are only read when the user presses Translate.

**Remote code:** No, I am not using remote code. (All JavaScript is in the package. Network calls go to Firebase/Gemini APIs and return data, not code.)

**Data usage (tick these):**
- **Website content**: yes. When the user translates in Hybrid or Cloud mode, cropped images of speech bubbles are sent to Google Gemini via Firebase AI Logic to read and translate them. Not stored.
- Everything else (personally identifiable info, health, financial, authentication, personal communications, location, web history, user activity): **no**.
  - Anonymous usage counts (number of pages, mode, timings) are not tied to a person and contain no browsing data. If the form insists, tick "User activity" and explain: anonymous counts of translations, no page addresses.
  - Feedback is only sent when the user writes it themselves; the optional email is typed by the user.

**Certify (tick all three):**
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** https://mangit.app/translate/privacy

## Distribution tab

- Visibility: Public
- Regions: All regions
- Price: Free (no in-app purchases)

## Test instructions (for the reviewer)

```
No login needed. Open any page with manga images, for example the demo at https://mangit.app/translate/ (or open the side panel's "Open a PDF, CBZ, CBR or EPUB…" and use a sample from https://mangit.app/translate/samples/monday-team-lead-ep1.cbz). Click the extension icon to open the side panel, choose "Cloud" and press "Translate this page". Translations appear over the speech bubbles in a few seconds; hover one to see the original. On-device and Hybrid modes need Gemini Nano (desktop Chrome 139+); without it the extension asks before using the cloud.
```
