GOAL:    A judge finishes knowing Mangit Lens reads manga on the reader's own computer with Gemini Nano,
         sends only hard bubbles to the cloud, and that this was measured, built safe, and works today.
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps
TIME:    167 s x 30 = 5010 frames. No music yet (no music source); captions carry the story.
LOOK:    ground #0B0C0F flat (mangit.app "Midnight Panel"), ink #EEF0F3, secondary #A0A6B1;
         accent #3FE0FF = on your computer; #FFC15E = cloud. Accent only on the word or dot that means it.
         Display: Sora 700, 84 px headlines, tracking -1.5%; body: Inter 400/700, 36-44 px.
         Medium: real product footage (Chrome, web demo) at 1.2x, page pushes to 1.6-1.9x. Footage shadow
         0 30px 80px rgba(0,0,0,.55). No grain, no vignette.
OBJECTS: the manga page (our own demo chapters), the side controls (route picker, stats, privacy line),
         speech bubbles with cyan/amber dots, the hover card.
MOTION:  enter expo.out 0.5 s; camera power3.inOut 0.6 s; exit power2.in 0.3 s; stagger 0.12 s.
         One hero move per shot. Text lands, then holds still while read (0.5 s + 0.3 s/word).
SHOTS:   0-8 hook: page bubbles turn English (real speed) at 1.5x, headline left.
         8-17 problem: untranslated page, two lines of tension.
         17-47 hybrid: Japanese vertical -> cloud (amber), Chinese -> Nano (cyan, 4x labelled), push to stats.
         47-57 hover card: original + which model read it.
         57-82 how it works: page -> detector -> Nano / cloud split; Nano per-language accuracy bars.
         82-100 offline: Network off chip, On-device, 3x labelled, push to "Nothing left this computer".
         100-122 chapter: open EPUB, translate whole chapter 8x labelled, page through, download CBZ.
         122-142 results: measured table as bars, Hybrid row lands last.
         142-157 built safe: App Check, kill switch, $10 shut-off, shared names; each with its real setting.
         157-167 end: logo, mangit-lens.web.app, GitHub, "Free and open source".
BANNED:  invented UI, mock dashboards, glow, gradients, glass cards, centred-everything, fade-up on every
         element, text moving while read, corner labels, numbers not in bench/results.
QA:      frames at 3, 14, 30, 44, 52, 70, 95, 115, 135, 150, 163 s.
