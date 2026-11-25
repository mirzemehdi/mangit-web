import { initializeApp } from "firebase/app";
import { CustomProvider, initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import {
  ensureInitialized,
  fetchAndActivate,
  getRemoteConfig,
  getValue,
} from "firebase/remote-config";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

// Tunables that we can change without shipping a new extension build.
export const CONFIG_DEFAULTS = {
  // Cost guards: 0 pauses all cloud calls for everyone (kill switch), and a
  // per-browser daily cap on cloud bubble requests (~150 pages in Cloud mode).
  cloud_enabled: 1,
  daily_cloud_requests_per_browser: 800,
  cloud_fast_model: "gemini-3.5-flash-lite",
  cloud_page_model: "gemini-3.8-flash",
  // MINIMAL | LOW | MEDIUM | HIGH, or "" for the model default.
  cloud_page_thinking: "LOW",
  cloud_bubble_thinking: "MINIMAL",
  // Bubbles the on-device model is unsure about get a second opinion in the
  // cloud. 0 turns that off; the page then stays fully on-device.
  max_cloud_escalations_per_page: 4,
  // Below this many detected bubbles we assume the detector missed the layout
  // and ask the cloud model to find bubbles on the whole page.
  min_bubbles_for_device_path: 1,
  // Cloud bubble requests in flight at once (per-user quota is 30/min).
  cloud_concurrency: 6,
  // Hybrid sends vertical CJK bubbles (Nano's weak spot) to the cloud first.
  cloud_first_vertical: 1,
  device_languages: "en,es,ja",
  // Give up on a Gemini Nano answer after this long (it can occasionally hang).
  device_timeout_ms: 20000, // Hybrid: then the cloud reads the bubble
  device_only_timeout_ms: 90000, // On-device: no fallback, only a hang guard
};

export const app = initializeApp(firebaseConfig);

// Firebase AI Logic is protected by App Check.
// - Web demo: reCAPTCHA Enterprise attests real visitors on the site's domain.
// - Extension: a chrome-extension:// page can't be attested by reCAPTCHA, so
//   builds made for local testing and judging carry a registered debug token.
//   The custom provider is only reached when no debug token is configured.
if (process.env.APP_CHECK_DEBUG_TOKEN) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = process.env.APP_CHECK_DEBUG_TOKEN;
}
initializeAppCheck(app, {
  provider:
    process.env.LENS_TARGET === "web" && process.env.RECAPTCHA_SITE_KEY
      ? new ReCaptchaEnterpriseProvider(process.env.RECAPTCHA_SITE_KEY)
      : new CustomProvider({
          getToken: () =>
            Promise.reject(new Error("No App Check debug token configured for this build.")),
        }),
  isTokenAutoRefreshEnabled: true,
});

const remoteConfig = getRemoteConfig(app);
// Short, so the spending shut-off (cloud_enabled) reaches open tabs within
// minutes. refreshConfig() runs before each translation.
remoteConfig.settings.minimumFetchIntervalMillis = 5 * 60 * 1000;
remoteConfig.defaultConfig = CONFIG_DEFAULTS;

// Re-reads Remote Config (at most every 5 minutes) into an existing config
// object, so long-open pages pick up the kill switch.
export async function refreshConfig(config) {
  Object.assign(config, await loadConfig());
  return config;
}

export async function loadConfig() {
  try {
    // Without this, getValue() can return the built-in defaults instead of the
    // stored config when the fetch is skipped (inside the 5-minute window),
    // which would ignore the kill switch.
    await ensureInitialized(remoteConfig);
    await fetchAndActivate(remoteConfig);
  } catch (err) {
    // Offline or not configured yet: the defaults above still apply.
    console.info("Remote Config unavailable, using defaults", err?.message);
  }
  const read = (key) => {
    const fallback = CONFIG_DEFAULTS[key];
    const v = getValue(remoteConfig, key);
    return typeof fallback === "number" ? v.asNumber() : v.asString();
  };
  return Object.fromEntries(Object.keys(CONFIG_DEFAULTS).map((k) => [k, read(k)]));
}
