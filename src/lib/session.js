// Anonymous Firebase sign-in, shared by glossaries and usage stats. No account
// and no personal data: just a random ID per browser, reused across visits.
import { getFirestore } from "firebase/firestore";
import { getAuth, signInAnonymously } from "firebase/auth/web-extension";
import { app } from "./firebase.js";

export const db = getFirestore(app);
const auth = getAuth(app);
let signedIn = null;

export function ensureSignedIn() {
  signedIn ??= (async () => {
    // Wait for a saved session first, so a returning browser keeps its ID.
    await auth.authStateReady();
    return auth.currentUser ?? (await signInAnonymously(auth)).user;
  })().catch((err) => {
    signedIn = null;
    throw err;
  });
  return signedIn;
}
