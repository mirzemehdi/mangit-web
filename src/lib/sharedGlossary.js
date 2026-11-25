// Shared glossaries in Firestore: one document per series, so every reader of
// a series gets the same character names, on-device and in the cloud.
//
// Readers sign in anonymously (no account, no personal data). Security rules
// (firestore.rules) cap what one write can change.

import { collection, doc, getDocs, limit, query, serverTimestamp, setDoc } from "firebase/firestore";
import { db, ensureSignedIn } from "./session.js";

// "One Piece - Chapter 1102 - MangaSite" -> "one-piece"
export function seriesFromTitle(title = "") {
  const cleaned = title
    .split(/\s[|\-–—:]\s/)[0]
    .replace(/\b(ch(apter)?|ep(isode)?|vol(ume)?|#)\s*\.?\s*\d+.*$/i, "")
    .trim();
  return cleaned || title.trim();
}

export function seriesKey(name) {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export async function loadShared(seriesName) {
  const key = seriesKey(seriesName);
  if (!key) return {};
  await ensureSignedIn();
  const snap = await getDocs(query(collection(db, "glossaries", key, "names"), limit(300)));
  const entries = {};
  for (const d of snap.docs) entries[d.data().src] = d.data().dst;
  return entries;
}

export async function shareEntry(seriesName, src, dst) {
  const key = seriesKey(seriesName);
  if (!key) return;
  await ensureSignedIn();
  // Document id from the name itself, so the same name is updated, not duplicated.
  const id = encodeURIComponent(src.normalize("NFKC")).slice(0, 120);
  await setDoc(doc(db, "glossaries", key, "names", id), {
    src,
    dst,
    series: seriesName.slice(0, 120),
    updatedAt: serverTimestamp(),
  });
}
