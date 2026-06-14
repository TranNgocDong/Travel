import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";

// Firebase web config is public by design, but it should still be provided through env vars
// so each deployment can use the correct Firebase project without editing source code.
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "AIzaSyC3PC4NYk2kTg5anPLe3QFfV9SwtiNPSSI",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "travel-b226f.firebaseapp.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "travel-b226f",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "travel-b226f.firebasestorage.app",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "620185931766",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "1:620185931766:web:59b52e48a261519eaf41d7",
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "G-CJ5X4KT3L6",
};

let firebaseApp: FirebaseApp | null = null;
let firebaseAuth: Auth | null = null;

/**
 * Lazily creates and returns the browser Firebase Auth singleton.
 * Keeping this behind a function avoids initializing Firebase during server rendering.
 */
export function getFirebaseAuth(): Auth {
  // Firebase Auth uses browser APIs, so this helper must not run during Next.js server rendering.
  if (typeof window === "undefined") {
    throw new Error("Firebase Auth is only available in the browser.");
  }

  // Fail fast with a clear message when Netlify/Vercel env vars are missing.
  // Without this, login errors look like random Firebase failures.
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId || !firebaseConfig.appId) {
    throw new Error("Firebase web configuration is missing. Set NEXT_PUBLIC_FIREBASE_* environment variables.");
  }

  // Reuse the singleton app/auth instances across React re-renders and hot reloads.
  firebaseApp ??= getApps().length ? getApp() : initializeApp(firebaseConfig);
  firebaseAuth ??= getAuth(firebaseApp);

  return firebaseAuth;
}
