# Benny's Accessibility Hub 2.0

**A bespoke software suite for one- and two-switch accessibility, built with Electron.**

This project provides an accessible computing environment designed for users who operate a computer with limited input methods (such as a single switch or two-button switch control). The hub includes games, communication tools, an AI-powered conversation board, journaling, media streaming control, and more — all navigable via switch scanning.

---

## ⚠️ Disclaimer

This software was created by caregivers for a specific individual with TUBB4A-related Leukodystrophy (H-ABC). It is **not** professional medical software.

This repository serves as an open-source example of how families can use modern development tools (including AI-assisted workflows like ChatGPT and GitHub Copilot) to build accessible technology tailored to specific needs.

---

## Architecture

The system is built on **Electron** (Node.js + Chromium) with specific Python components for features that require system-level access.

### Core (Electron / Node.js)

* `main.js` — Electron main process, launches the hub
* `preload.js` — Secure bridge between web pages and Node.js
* `bennyshub/` — All HTML/CSS/JS applications (games, tools, hub interface)

### Python Components (Windows-specific)

These run as separate processes when needed:

* `messenger/backend.py` — Discord client backend with WebSocket bridge for the Electron UI
* `messenger/simple_dm_listener.py` — Background service announcing incoming DMs via TTS
* `search/narbe_scan_browser.py` — Web search with accessible scanning interface
* `streaming/server.py` — Local server for streaming app control
* `streaming/utils/control_bar.py` — Always-on-top overlay for controlling streaming apps

---

## Features

### 🎮 Games (18 total)

Located in `bennyshub/apps/games/`:

* **Benny's Baseball** — Full season simulation; pick plays, no reaction time needed
* **Benny's Basketball Shooter** — Arcade shooter with bonus mode
* **Benny's Battle Boats** — Battleship-style fleet game; vs computer or 2-player
* **Benny's Bowling** — 3D physics-based bowling (Three.js / Ammo.js)
* **Benny's Bug Blaster** — Tower defense; place boots and defenses against waves of bugs
* **Benny's Chess & Checkers** — Classic board games vs computer or friend
* **Benny's Connect Four** — Drop pieces and connect four in a row; vs computer or friend
* **Benny's Dice** — 3D dice with Free Throw, Yarkle, and Fahtzee modes
* **Benny's Football** — 16-game season; call plays, time passes, make the playoffs
* **Benny's Matchy Match** — Memory matching with competitive mode and a built-in card editor
* **Benny's Mega Slot** — Casino-style slot machine with bonus modes and themes
* **Benny's Mini Golf** — Top-down golf for up to 4 players with a course creator
* **Benny's P3GL** — Peggle-style arcade game with campaign and level editor
* **Benny Says** — Simon-style memory sequence game
* **Benny's Tic Tac Toe** — vs computer or friend
* **Benny's Word Jumble** — Unscramble the word to advance
* **Trivia Master** — Build your own trivia games with images and video support
* **Benny's Dice** — Roll dice with realistic physics

### 🛠️ Tools

Located in `bennyshub/apps/tools/`:

* **Keyboard** — Predictive on-screen keyboard with KenLM n-gram suggestions, two-button accessible
* **Phrase & Media Board** — Quick-access communication tiles with scanning; fully editable
* **Journal** — Voice-enabled daily journal
* **Day Hub** — Date, time, weather, and spoken news (local / NPR / BBC)
* **Search** — Accessible web / YouTube search (Python backend)
* **RT Convo** *(New)* — AI-powered real-time AAC conversation board (see below)

#### 🗣️ RT Convo — Real-Time AAC Conversation Board

Located in `bennyshub/apps/tools/rt-convo/`:

An AI-powered augmentative and alternative communication (AAC) board designed to help users participate in real-time conversations.

**Key features:**

* **Ambient Listen Mode** — Web Speech API transcribes surrounding conversation locally; no audio leaves the device
* **AI Suggestions** — Press "Get Suggestions" to send recent transcript to your chosen AI provider; returns contextual phrases, sentence starters, and word completions
* **Static Topic Board** — Curated words/phrases organized by topic categories; fully local, no API call needed, editable via Settings
* **Personality Quiz** — Optional questionnaire that builds a profile to make AI suggestions feel more natural and personalized
* **Multi-Provider Support** — Works with Anthropic Claude, OpenAI GPT, or Google Gemini; auto-detected from key format
* **Scan & Select Navigation** — Full two-button switch control (spacebar to advance, enter to select)
* **Privacy-first** — Audio never sent to any server; only text transcripts sent to your chosen AI provider; API key stored in localStorage only

**Setup:** Copy `api.example.txt` → `api.txt` and paste your API key. Optionally copy `context.example.json` → `context.json` and fill in a personality profile.

### 💬 Messenger (Discord)

A fully rewritten switch-accessible Discord client:

* Full DM and channel support with message history
* AI-powered keyboard context suggestions
* TTS announcements for incoming messages
* WebSocket bridge between Electron UI and Python Discord backend
* Background DM listener with voice notifications
* Requires your own Discord bot token — see `config.example.json`

### 📺 Streaming Dashboard

Switch-accessible streaming control:

* Unified launcher across services
* Episode tracking
* Always-on-top control bar (Play, Pause, Volume, Skip, Exit)
* Requires your own streaming service API keys — see `timd-api.example.json`

---

## Installation

### Prerequisites

* Windows 10/11 (required for Python components)
* Node.js 18+
* Python 3.10+
* Git (optional)

### Clone

```bash
git clone https://github.com/NARBEHOUSE/Benny-s-Accessibility-Hub-2.0.git
cd Benny-s-Accessibility-Hub-2.0
```

### Install Dependencies

```bash
npm install
pip install -r requirements.txt
```

### Run

```bash
npm start
```

Or double-click `start_hub.bat`.

---

## Configuration

Most tools work out of the box. Tools that connect to external services need a config file:

| Tool | File to create | Template |
|------|---------------|----------|
| Messenger (Discord) | `bennyshub/apps/tools/messenger/config.json` | `config.example.json` |
| Streaming | `bennyshub/apps/tools/streaming/timd-api.json` | `timd-api.example.json` |
| RT Convo | `bennyshub/apps/tools/rt-convo/api.txt` | `api.example.txt` |

Copy the `.example` file, rename it (remove `.example`), and fill in your credentials.

---

## License

This project is licensed under the **MIT License**.

You are free to use, modify, distribute, and even use this software commercially, provided the original copyright notice and license are included.

See the [LICENSE](LICENSE) file for full details.

---

## Trademark & Attribution

"Benny's Accessibility Hub" and "NarbeHouse" are identifiers associated with the original project.

While the code is licensed under MIT, use of the project name, branding, or representation as the official project requires permission.

Forks and derivative works must not imply endorsement or affiliation with NarbeHouse without explicit approval.

---

## Third-Party Components

This project includes third-party libraries and dependencies (Electron, Three.js, Ammo.js, Discord.py, PySide6, websockets, and others). These retain their original licenses.

Users are responsible for complying with the respective third-party license terms.

---

## Credits

Concept & Caregiving: Nancy & Ari

Development: AI-assisted (ChatGPT / Claude / GitHub Copilot) & NarbeHouse

Libraries: Electron, Three.js, Ammo.js, Discord.py, PySide6, websockets

---

**Dedicated to Ben. 💙**
