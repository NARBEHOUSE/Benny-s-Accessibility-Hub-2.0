# Conversation App for Benny's Hub — Complete Context & Architecture

## Overview
A real-time, context-aware conversational AAC (Augmentative and Alternative Communication) app for Ben and others with speech disabilities who use switch-based scanning. Combines ambient conversation listening, AI-powered contextual suggestions, and user-controlled personality profiling to enable natural, rapid conversational participation.

---

## Core Philosophy
- **Ben Speaks, Not the AI**: The app suggests words and phrases; Ben selects them. The AI never speaks for him — it accelerates his ability to find and select his own voice.
- **Privacy-First Architecture**: Audio is transcribed locally via Web Speech API. Only transcripts are sent to the API, never raw audio. API keys stay in local storage, never transmitted or logged by NARBE.
- **Scan & Select Only**: The entire app uses spacebar (advance) and enter (select) for navigation. Mouse/keyboard input only for personality quiz text answers and API key entry.
- **Dignity-Centered Design**: Reflects Ben's actual communication style, interests, and personality. Adapts over time based on his choices.

---

## Key Features

### 1. Reactive Conversational Board
- **Ambient Listening**: Microphone stays open in background, continuously transcribing via Web Speech API (no server calls, local only).
- **Triggered Suggestions**: Ben presses "Get Suggestions" (spacebar/enter). App sends recent transcript + personality profile to API. API call ONLY happens when Ben triggers it.
- **Three-Tier Response Structure**:
  - **Row 1 (Complete Phrases)**: 4–8 full sentences Ben can say immediately.
  - **Rows 2–3 (Sentence Starters)**: Words like "I," "Yes," "No," "Maybe," "I don't know," weighted by context.
  - **Rows 4–6 (Word Completions)**: Single words that complete a thought naturally given context.
- **More/Reshuffle Button**: Gets new suggestions using same transcript context. Triggers a new API call.
- **Board Size**: Configurable from 3×3 (minimum) up to 7×6 (keyboard-size). Default: 4×4.

### 2. Static Topic Board (Interest Library)
- **Non-AI Controlled**: Curated word library organized by the user's interests (e.g., Sports, Comedy, Gaming, Animals).
- **No API Calls**: This board is entirely local — words are pre-set by the personality quiz or caregiver.
- **Feed into Conversation**: Selections populate his text box. They only enter the transcript when he "Says" them (TTS + transcript append).
- **Completely Editable**: Ben or caregiver can add, remove, or reorganize topics via Settings.

### 3. Adaptive Personality Quiz
- **API-Driven**: Not a fixed questionnaire. The API adapts follow-up questions based on Ben's answers, drilling into detail.
- **Example Flow**:
  - "What interests you?" → Ben selects "Comedy"
  - "What kind of comedy?" → Ben selects "Cartoons"
  - "Which cartoon shows do you like?" → Ben selects "Example Show A, Example Show B"
  - "Anything else to add?" → Continues or finishes
- **Never-Ending**: Ben can always jump back in to add more interests or revise old ones.
- **Two Modes in Settings**:
  - **Revise**: Go back and change previous answers.
  - **Add**: Extend the profile with new topic branches.
- **Stored as JSON**: Personality profile lives in local storage. Export/import supported.

### 4. Settings Panel (Fully Scannable)
All options are scannable via spacebar/enter. Only API key input and personality quiz text entry require mouse/keyboard.
- **Board Size**: Adjust rows and columns.
- **API Key**: Masked input field (paste only). Never leaves local storage.
- **Edit Profile (Revise)**: Re-enter personality quiz to change existing answers.
- **Edit Profile (Add)**: Add new interest branches.
- **Export Profile**: Download personality JSON.
- **Import Profile**: Load previously exported JSON.
- **Edit Topics**: Manually add/remove words on the topic board.
- **Theme / Highlight Color**: Standard Benny's Hub options.
- **Close Settings**.

---

## Technical Architecture

### Frontend Stack
- **Vanilla JavaScript** — no framework, consistent with all Benny's Hub apps.
- **Web Speech API** — client-side continuous transcription. Zero server cost.
- **Local Storage** — personality profile, settings, API key, transcript window, transcript summary.
- **HTML/CSS** — tile-based grid layout like the phrase board. Fully responsive scanning UI.
- **Shared Managers** — uses `/shared/scan-manager.js` and `/shared/voice-manager.js` from Benny's Hub.

### Scan & Select Implementation
Identical to the existing keyboard and phrase board apps:
- **Spacebar short press**: Advance to next item.
- **Spacebar long press**: Move backward.
- **Enter short press**: Select highlighted item.
- **Enter long press**: Toggle row mode / column mode.
- Row-first scanning: spacebar highlights rows, enter drops into row, spacebar highlights individual buttons.

### Data Flow

```
[Mic On Always] → [Web Speech API] → [Rolling Local Transcript]
                                              ↓
                              [Ben Presses "Get Suggestions"]
                                              ↓
                    [App builds API payload]:
                    - Last 300 words of transcript
                    - Compressed summary of older context
                    - Personality profile JSON
                              ↓
                    [API Call → Cheapest available model]
                    Auto-detects provider from API key format:
                    - sk-ant-... → Anthropic (claude-haiku-4-5)
                    - sk-...     → OpenAI (gpt-4o-mini)
                    - AIza...    → Google (gemini-2.0-flash)
                              ↓
                    [API Returns JSON]:
                    { phrases: [...], starters: [...], completions: [...] }
                              ↓
                    [Board Renders Suggestions]
                              ↓
                    [Ben Selects → Text Box]
                              ↓
                    [Ben Hits "Say It" → TTS + Appended to Transcript]
```

### Transcript Management
- **Rolling Window**: Keep last 300–400 words in memory as raw transcript.
- **Auto-Compress**: When transcript exceeds 500 words, summarize the oldest half using a lightweight client-side keyword extraction (strip stop words, keep meaningful nouns/verbs). Store as `transcriptSummary`.
- **API Payload**: Send `transcriptSummary` (older context) + `transcriptWindow` (recent 300 words) + `personalityProfile`.
- **Question Detection**: Simple client-side regex checks transcript for question words ("do you," "would you," "what," "how," "can you") + "?" to trigger a subtle "Someone may have asked you a question" indicator.

### Local Storage Schema
```json
{
  "conv_apiKey": "sk-ant-...",
  "conv_personality": {
    "communicationStyle": {
      "directness": 0.8,
      "humor": 0.7,
      "sarcasm": 0.3,
      "wordiness": 0.4
    },
    "interests": {
      "Comedy": ["Example Show A", "Example Show B"],
      "Superheroes": ["Example Hero A", "Example Hero B"],
      "Gaming": ["Example Game A", "Example Game B"]
    },
    "selectionWeights": {
      "complete_phrase": 45,
      "starter_build": 35,
      "topic_board": 20
    },
    "version": 1
  },
  "conv_topicBoard": {
    "Comedy": ["That's hilarious", "I love that show", "Example Show B is the best"],
    "Superheroes": ["Example Hero A is my favorite", "I love that team", "The other team is cool too"]
  },
  "conv_transcriptWindow": "...[last 300 words]...",
  "conv_transcriptSummary": "...[compressed older context]...",
  "conv_boardSize": { "rows": 4, "cols": 4 },
  "conv_settings": {
    "theme": "default",
    "highlightColor": "yellow",
    "scanSpeed": "medium",
    "listeningEnabled": true
  }
}
```

---

## API System Prompt Template

```
You are a communication assistant for a nonspeaking AAC user.

Their communication style:
- Directness: [0–1]
- Humor: [0–1]  
- Sarcasm: [0–1]
- Wordiness: [0–1, 0=brief, 1=verbose]

Their interests: [list from profile]

Recent conversation context:
[transcriptSummary]
[transcriptWindow]

Generate communication options. Return ONLY valid JSON, no markdown:
{
  "phrases": ["complete sentence 1", "complete sentence 2", "...", "..."],
  "starters": ["I think", "Yes", "No", "Maybe", "I don't know", "That's"],
  "completions": ["great", "funny", "cool", "not sure", "depends", "a lot"]
}

Rules:
- phrases: 6–8 full sentences usable immediately in this conversation.
- starters: 6 words/short phrases to begin a response.
- completions: 6 words that naturally follow common starters in this context.
- Weight toward user's personality style but maintain variety.
- Match the conversational moment (question asked, topic being discussed).
- Keep phrases authentic and natural, not robotic.
```

---

## Privacy & Consent

- **Consent Banner** on first load: "This app listens to your conversation and sends transcripts to your chosen AI provider for smart suggestions. Audio is never sent — only text. Nothing is stored by NARBE. Your API key is stored on this device only."
- **Visible Mic Indicator**: Always show "🎤 Listening" badge when mic is active. Never hidden.
- **User Controls Mic**: Can disable listening in settings. Without listening, app still works with manual "Get Suggestions" but context will be limited.
- **API Key**: Input is type="password". Never logged, never sent to NARBE servers.

---

## UI Layout (HTML Structure)

```
┌─────────────────────────────────────────┐
│  🎤 Listening...        [Settings] [Exit]│  ← Header bar
├─────────────────────────────────────────┤
│  [Text box showing what Ben is building] │  ← Text display row
│                              [Say] [Clear]│
├─────────────────────────────────────────┤
│  [Phrase]  [Phrase]  [Phrase]  [Phrase]  │  ← Row 1: Complete phrases
├─────────────────────────────────────────┤
│  [Phrase]  [Phrase]  [Phrase]  [Phrase]  │  ← Row 2: More phrases / starters
├─────────────────────────────────────────┤
│  [Word]    [Word]    [Word]    [Word]    │  ← Row 3: Starters / completions
├─────────────────────────────────────────┤
│  [Word]    [Word]    [Word]    [Word]    │  ← Row 4: Completions
├─────────────────────────────────────────┤
│  [GET SUGGESTIONS]  [MORE]  [TOPICS]    │  ← Action row
└─────────────────────────────────────────┘
```

- Board grid size is configurable (3×3 min, 7×6 max).
- All buttons are large tiles like the phrase board.
- Tile font size scales based on content length.
- Scanning highlight is the same yellow/color system as the rest of Benny's Hub.

---

## Integration with Benny's Hub

- **File location**: `/bennyshub/apps/tools/rt-convo/index.html`
- **Shared scripts** (relative paths):
  - `../../../shared/scan-manager.js`
  - `../../../shared/voice-manager.js`
  - `../../../shared/electron-bridge.js`
  - `../../../shared/ios-audio-fix.js`
- **Single HTML file** — no build process, no npm, no framework.
- **Theming** — inherits CSS variable system (`--brand`, `--bg`, `--card`, `--text`, `--scanHighlight`, etc.)

---

## What NOT to Do

- Do NOT call the API on a timer. Only call when Ben triggers it.
- Do NOT send raw audio to any server.
- Do NOT store the API key anywhere except localStorage.
- Do NOT make the UI require a mouse for normal use (only for API key input and personality quiz text entry).
- Do NOT use React, Vue, or any npm package. Vanilla JS only.
- Do NOT use localStorage for data that should reset per conversation — only profile and settings persist.

---

## Build Order

1. **Static prototype**: HTML/CSS/JS with hard-coded fake suggestions. Get scan/select working perfectly.
2. **Web Speech API**: Add continuous background transcription + visible indicator.
3. **Settings panel**: Board size, API key input, theme/highlight.
4. **API integration**: Multi-provider adapter. Real suggestions from API.
5. **Personality quiz**: API-driven adaptive quiz. Profile storage + export/import.
6. **Topic board**: Static interest library, scannable, editable from settings.
7. **Learning/drift**: Track selections over time, gently adjust personality weights.
8. **Polish**: Consent banner, error handling, offline graceful degradation.
