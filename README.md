# Ben's Accessibility Hub 2.0

**An AI-assisted, bespoke software suite for single-switch accessibility.**

This project is the evolution of Ben's legacy software. It transitions from pure Python applications to a robust **Hybrid Web/Python Architecture**. The core interface is now a locally hosted web hub (`bennyshub`) that integrates games, media tools, and predictive communication, controlled via a Python backend that handles hardware inputs and system-level commands.

## ⚠️ Disclaimer
This software was created by caregivers for a specific individual with TUBB4A-related Leukodystrophy (H-ABC). It is **not** professional medical software. It serves as an open-source example of how families can use AI tools (ChatGPT, GitHub Copilot) to build accessible technology tailored to specific needs.

## Architecture
The system consists of four main components:
1.  **Python Controller (`comm-v10.py`):** The "brain" that runs in the background. It reads switch inputs (Space/Enter), manages system focus, handles TTS (Text-to-Speech), and launches local web servers.
2.  **Ben's Hub (`bennyshub/`):** A suite of HTML5/JS applications (Games, Journal, Bowling, Trivia) that run in the browser but interact with the Python backend for file saving and persistence.
3.  **Discord Messenger (`messenger/`):** A custom Python/Discord integration allowing the user to send/receive DMs using their assistive switch device.
4.  **Streaming Dashboard (`streaming/`):** A unified web launcher for media services (Netflix, Plex, etc.) that acts as a "smart remote," managing episode tracking and playback control via an always-on-top overlay.

## Features

### 🎮 Web-Based Games
Located in `bennyshub/apps/games/`, these are accessible web ports of classic concepts, featuring single-switch scanning modes:
*   **Benny's Bowling:** 3D physics-based bowling (Three.js/Ammo.js) with switch-based aiming and power control.
*   **Trivia Master:** Customizable trivia game loading local/online JSON questions.
*   **Word Jumble & Matchy Match:** Cognitive exercises adapted for switch scanning.
*   **Peggle & Bug Blaster:** Arcade-style games.

### 🏠 Communication & Tools
*   **Phrase Board:** Quick-access tile-based communication board.
*   **Journal:** A voice-enabled daily journal tool.
*   **YouTube Search:** A simplified, scan-accessible interface for searching and playing YouTube videos safe from ad-clutter.

### 📺 Streaming & Entertainment Dashboard
Located in `streaming/`, this is a critical component that solves the challenge of traversing distinct, inaccessible streaming interfaces (Netflix, Plex, Hulu, etc.) with a single switch.
*   **Unified Media Launcher:** A dedicated, high-contrast dashboard to browse and launch favorite shows and movies across different services without needing to navigate their complex native menus.
*   **Smart Tracking:** 
    *   **Marathon Mode:** Automatically remembers the last watched show and resumes playback.
    *   **Episode Selection:** For specific series, allows granular selection of seasons and episodes tracked via local JSON databases.
*   **The Control Bar:** A custom always-on-top Python overlay (`control_bar.py`) that acts as a universal remote. It ensures the user is never "trapped" in a full-screen video, providing accessible buttons for Play/Pause, Volume, Next Episode, and App Exit regardless of the content source.

### 💬 Messenger (Discord Integration)
*   **`ben_discord_app.py`:** A GUI wrapper for Discord.
*   **`simple_dm_listener.py`:** A background bot that listens for incoming DMs and announces them via TTS.
*   **Predictive Keyboard:** A custom onscreen keyboard optimized for scanning that sends messages to a private Discord channel.

## Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/NARBEHOUSE/Benny-s-Accessibility-Hub-2.0.git
    cd "Benny-s-Accessibility-Hub-2.0"
    ```

2.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Setup Browsers:**
    If using the Search tool, ensure Playwright browsers are installed:
    ```bash
    playwright install
    ```

4.  **Configuration:**
    *   **Messenger:** Add your Discord Bot Token to `messenger/config.json` (see `messenger/config_example.json`).
    *   **Streaming:** Get a free API key from [The Movidb.org](https://www.themoviedb.org/) and add it to `streaming/timd-api.json` to enable metadata fetches.
    *   **Data:** Ensure `data/` folder exists for saving local game states.

## Running the App

Run the main communication hub, which will initialize the necessary local servers:

```bash
python comm-v10.py
```

*Note: On Windows, this may require Administrator privileges for certain key-binding features.*

### 🔄 Auto-Start Configuration
For a seamless appliance-like experience, it is recommended to add `comm-v10.py` (the main hub) and `messenger/simple_dm_listener.py` (the background message listener) to your Windows Startup folder.
1.  Create shortcuts for both Python scripts.
2.  Press `Win + R`, type `shell:startup`, and press Enter.
3.  Move the shortcuts into this folder.
This ensures the communication system and background message listener are active immediately when the PC turns on.

## Credits
*   **Concept & Caregiving:** Nancy & Ari
*   **Development:** AI-Assisted (ChatGPT / Copilot) & NarbeHouse, LLC
*   **Physics Engine:** [Ammo.js](https://github.com/kripken/ammo.js) / [Bullet](https://github.com/bulletphysics/bullet3)
*   **Graphics:** [Three.js](https://threejs.org/)

**Dedicated to Ben.**
