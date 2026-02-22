# PedroMaia OS – Web App

## 📌 Project Overview

**PedroMaia OS** is a modular personal operating system built as a web application and deployed on **Firebase Hosting**.

The goal of the project is to create a structured, scalable, and modular life-management system with independent modules (e.g., Side Quests, Budget, etc.) that can be dynamically loaded without reloading the page.

The app uses a custom client-side router and ES Modules.

---

## 🏗️ Architecture

The project follows a modular structure:

```
/public
│
├── index.html
├── login.html
├── css/
│   ├── base.css
│   ├── components.css
│   └── layout.css
├── js/
│   ├── app.js
│   ├── auth.js
│   ├── config.js
│   ├── firebase.js
│   ├── login.js
│   └── router.js
│
└── modules/
    ├── playlists/
    │   ├── playlists.js
    │   ├── playlists.engine.js
    │   ├── playlists.service.js
    │   └── playlists.js
    │
    └── [futureModules]/
        ├── moduleName.html
        └── moduleName.js
```

---

## ⚙️ Core System Design

### 1️⃣ Single Entry Point

* `index.html` is the only entry page.
* All modules are loaded dynamically inside:

```html
<div id="content"></div>
```

---

### 2️⃣ Custom Router (`router.js`)

The router dynamically loads modules using:

* `fetch()` → loads module HTML
* `import()` → loads module JS (ES module)

Example structure:

```js
export async function loadModule(name) {
  const htmlPath = `/modules/${name}/${name}.html`;
  const res = await fetch(htmlPath);
  const html = await res.text();
  document.getElementById("content").innerHTML = html;

  const jsPath = `/modules/${name}/${name}.js`;
  const module = await import(jsPath);
  module.init();
}
```

Each module must export:

```js
export function init() {
  // module initialization logic
}
```

---

## 🧩 Module Standard

Every module must follow this pattern:

```
/modules/moduleName/
    moduleName.html
    moduleName.js
```

### moduleName.html

Contains only the internal UI of that module (no `<html>`, `<head>`, etc.)

### moduleName.js

Must export an `init()` function:

```js
export function init() {
  console.log("Module initialized");
}
```

---

## 🔥 Firebase Configuration

### Hosting

* App deployed on Firebase Hosting
* Uses SPA rewrite

`firebase.json`:

```json
{
  "hosting": {
    "public": "public",
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

Important:

* All module paths must be correct
* ES modules require proper `.js` extension
* Template literals must use backticks

---

## 🧠 Design Philosophy

This app is designed as:

* Modular
* Expandable
* Scalable
* Clean separation of concerns
* Framework-free (Vanilla JS + ES Modules)

No React / Vue / Angular.

The router is intentionally custom-built for full control and understanding.

---

## 🛠️ Current Implemented Module

### Side Quests

Purpose:

* Manage optional personal missions
* Dynamic content rendering
* Modular UI logic

---

## 📈 Future Modules (Planned)

* Budget
* Habit Tracker
* Long-term Missions
* XP / Leveling System
* Dashboard
* Authentication
* Firestore persistence layer

---

## 🚨 Known Technical Decisions

* ES Modules only
* No bundler (no Vite/Webpack)
* No framework
* Firebase Hosting SPA rewrite enabled
* Dynamic `import()` used for JS modules
* Each module is self-contained

---

## 🎯 Development Rules

1. Every module must be independent.
2. No global variables.
3. All logic must start inside `init()`.
4. Router handles injection — modules never manipulate routing.
5. File names must exactly match folder name.

Example:

```
/modules/budget/budget.html
/modules/budget/budget.js
```

---

## 📌 Deployment

```
firebase deploy
```

Hard refresh after deployment:

```
Ctrl + Shift + R
```

---

## 🔎 Debugging Notes

If you see:

* MIME type error (`text/html`)
  → Usually wrong path or missing `.js`
* `${name}` appearing in URL
  → Backticks missing
* Module not loading
  → Check Network tab for actual file served

---