/**
 * Colony Wars — Firebase Integration
 * Uses Firebase Web SDK v10 (Modular) via CDN — no build step required.
 *
 * Handles:
 *  - App initialization
 *  - Email/password authentication
 *  - Firestore CRUD for player data
 *  - Async attack system (opponent fetching, battle result writes)
 *
 * Firestore Security Rules (add in Firebase Console → Firestore → Rules):
 *
 *   rules_version = '2';
 *   service cloud.firestore {
 *     match /databases/{database}/documents {
 *       match /users/{userId} {
 *         allow read: if request.auth != null;
 *         allow write: if request.auth != null && request.auth.uid == userId;
 *       }
 *     }
 *   }
 */

// ── Firebase SDK imports via CDN ────────────────────────────────────────────
import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  collection,
  getDocs,
  query,
  limit,
  serverTimestamp,
  arrayUnion,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';


// ── Firebase Configuration ──────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            'AIzaSyARoAShZRGcwDgV0oRDJyTsTWiVWIR2_uE',
  authDomain:        'colony-wars2026.firebaseapp.com',
  projectId:         'colony-wars2026',
  storageBucket:     'colony-wars2026.firebasestorage.app',
  messagingSenderId: '543531553144',
  appId:             '1:543531553144:web:94ffb45ce641aec70c388d',
};

// ── Initialization ──────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

const USERS = 'users'; // Firestore collection name


// ════════════════════════════════════════════════════════════════════════════
// Authentication
// ════════════════════════════════════════════════════════════════════════════

/**
 * Register a new account and set the commander's display name.
 * @param {string} email
 * @param {string} password
 * @param {string} displayName
 * @returns {Promise<import('firebase/auth').UserCredential>}
 */
export async function registerUser(email, password, displayName) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName });
  return credential;
}

/**
 * Sign in with email and password.
 */
export async function loginUser(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Sign out the current user.
 */
export async function logoutUser() {
  return signOut(auth);
}

/**
 * Subscribe to auth state changes.
 * @param {(user: import('firebase/auth').User | null) => void} callback
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}


// ════════════════════════════════════════════════════════════════════════════
// Player Data — Create / Read / Update
// ════════════════════════════════════════════════════════════════════════════

/**
 * Write the initial player document when a new account is created.
 * @param {string} uid
 * @param {string} displayName
 * @param {Object} initialState - createGameState() result
 */
export async function createPlayerRecord(uid, displayName, initialState) {
  const ref = doc(db, USERS, uid);
  await setDoc(ref, {
    displayName,
    createdAt:   serverTimestamp(),
    lastOnline:  serverTimestamp(),
    resources:   initialState.resources,
    baseLayout:  initialState.baseLayout,
    units:       initialState.units,
    defenseLog:  [],
  });
}

/**
 * Load a player's full data from Firestore.
 * @param {string} uid
 * @returns {Promise<Object|null>}
 */
export async function loadPlayerData(uid) {
  const snap = await getDoc(doc(db, USERS, uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Persist (merge) the current game state to Firestore.
 * Uses setDoc with merge:true so partial updates are safe.
 * @param {string} uid
 * @param {Object} data
 */
export async function savePlayerData(uid, data) {
  const ref = doc(db, USERS, uid);
  await setDoc(ref, { ...data, lastOnline: serverTimestamp() }, { merge: true });
}


// ════════════════════════════════════════════════════════════════════════════
// Async Attack System
// ════════════════════════════════════════════════════════════════════════════

/**
 * Return a random opponent (any other player with a saved base).
 * Fetches up to 20 users and picks one at random that isn't the caller.
 * @param {string} currentUid
 * @returns {Promise<{ uid: string, data: Object } | null>}
 */
export async function getRandomOpponent(currentUid) {
  const q    = query(collection(db, USERS), limit(20));
  const snap = await getDocs(q);

  const others = [];
  snap.forEach((docSnap) => {
    if (docSnap.id !== currentUid) {
      const d = docSnap.data();
      // Only include players who actually have a base layout
      if (d.baseLayout && Object.keys(d.baseLayout).length > 0) {
        others.push({ uid: docSnap.id, data: d });
      }
    }
  });

  if (others.length === 0) return null;
  return others[Math.floor(Math.random() * others.length)];
}

/**
 * Persist battle results.
 *  - Attacker gains loot.
 *  - Defender loses loot and receives a defense log entry.
 *  - Deployed units are deducted from attacker's army (handled in main.js).
 *
 * @param {string} attackerUid
 * @param {string} defenderUid
 * @param {Object} loot         - { minerals, energy, oxygen }
 * @param {boolean} victory
 * @param {string[]} battleLog  - Last N log messages
 */
export async function updateAfterBattle(attackerUid, defenderUid, loot, victory, battleLog) {
  // ── Attacker: credit loot ──────────────────────────────────────────────
  const atkRef  = doc(db, USERS, attackerUid);
  const atkSnap = await getDoc(atkRef);

  if (atkSnap.exists()) {
    const res = atkSnap.data().resources || {};
    await updateDoc(atkRef, {
      'resources.minerals': Math.floor((res.minerals || 0) + loot.minerals),
      'resources.energy':   Math.floor((res.energy   || 0) + loot.energy),
      'resources.oxygen':   Math.floor((res.oxygen   || 0) + loot.oxygen),
      lastOnline: serverTimestamp(),
    });
  }

  // ── Defender: deduct loot + append defense log ─────────────────────────
  const defRef  = doc(db, USERS, defenderUid);
  const defSnap = await getDoc(defRef);

  if (defSnap.exists()) {
    const res = defSnap.data().resources || {};
    const entry = {
      timestamp:   new Date().toISOString(),
      attackerUid,
      victory,                         // true = attacker won
      loot,
      log: battleLog.slice(-5),        // stores last 5 lines for the log panel
    };

    await updateDoc(defRef, {
      'resources.minerals': Math.max(0, Math.floor((res.minerals || 0) - loot.minerals)),
      'resources.energy':   Math.max(0, Math.floor((res.energy   || 0) - loot.energy)),
      'resources.oxygen':   Math.max(0, Math.floor((res.oxygen   || 0) - loot.oxygen)),
      defenseLog: arrayUnion(entry),
    });
  }
}
