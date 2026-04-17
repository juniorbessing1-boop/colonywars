# Colony Wars 🚀

A browser-based Clash of Clans-inspired strategy game set on a hostile alien planet.  
**Pure HTML + CSS + JavaScript** — no build tools required.

---

## 🔥 Firebase Setup (Required)

### 1. Firestore Security Rules

In your [Firebase Console](https://console.firebase.google.com/) → **Colony Wars project** → **Firestore Database** → **Rules**, replace the content with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId} {
      // Any logged-in user can read bases (needed for attacks)
      allow read: if request.auth != null;
      // Users can only write their own data
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

Click **Publish**.

### 2. Enable Email/Password Auth

Firebase Console → **Authentication** → **Sign-in method** → **Email/Password** → Enable it.

---

## ▶ Running Locally

Because the game uses **ES Modules**, it must be served over HTTP (not `file://`).

**Option A — Node.js `serve`:**
```bash
cd colony-wars
npx serve .
```
Then open `http://localhost:3000`.

**Option B — Python:**
```bash
cd colony-wars
python -m http.server 8080
```
Then open `http://localhost:8080`.

**Option C — VS Code Live Server:**  
Right-click `index.html` → *Open with Live Server*.

---

## 🎮 How to Play

| Action | How |
|--------|-----|
| **Register** | Click "REGISTER" tab, fill form |
| **Place building** | Click a building in the left panel, then click an empty grid cell |
| **Cancel placement** | Click the ✕ cancel button or click the same building again |
| **Inspect building** | Click any placed building on the grid |
| **Upgrade** | Click building → "UPGRADE TO L2/L3" button |
| **Train units** | Build a Barracks first, then use the Recruit panel |
| **Attack** | Train units → click "⚔ ATTACK" → deploy units → "▶ LAUNCH ATTACK" |
| **Save** | Auto-saves 4s after any change, or click "💾 SAVE" |

---

## 🏗 Buildings

| Building | Cost | Effect |
|----------|------|--------|
| Command Center ⬡ | Free (1 only) | Main objective; upgrading unlocks game |
| Mineral Extractor ⛏ | 100 Minerals | +2–7 Minerals/sec |
| Solar Array ◈ | 80 Energy | +3–9 Energy/sec |
| Oxygen Farm ◎ | 80 Oxygen + 60 Min | +1.5–5 Oxygen/sec |
| Storage Depot ▣ | 200 Minerals | +500–2000 cap per resource |
| Defense Turret ⊕ | 150 Min + 100 Energy | 28–80 DPS, 3–5 cell range |
| Barracks ⊞ | 250 Min + 100 Energy | Unlocks unit training |

All buildings upgrade to Level 3.

---

## ⚔ Units

| Unit | HP | DPS | Speed | Cost |
|------|----|-----|-------|------|
| Scout Drone ◆ | 80 | 15 | Fast | 50M + 30E |
| Combat Robot ◉ | 250 | 38 | Slow | 120M + 80E + 30O |
| Plasma Ranger ◇ | 120 | 48 | Med | 80M + 100E + 50O |

---

## 📁 File Structure

```
colony-wars/
├── index.html   — HTML shell (auth + game screens + modals)
├── style.css    — Complete sci-fi dark theme
├── firebase.js  — Firebase SDK init, auth, Firestore helpers
├── game.js      — Building/unit defs, resource gen, battle sim
└── main.js      — App orchestration, UI, canvas rendering
```

---

## 🛡 Fog of War

Cells more than 3 tiles from any of your buildings are covered in fog.  
Place buildings to reveal new territory.
