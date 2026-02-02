# Trivia Level Editor

A standalone HTML5 application for creating and editing trivia question packs for the Trivia Game.

## Features

- **Category Management**: Create, rename, and delete categories.
- **Question Editor**: Add questions with 4 choices. The first choice is always the correct answer (handled automatically by the game logic).
- **Media Support**: Attach Images, Audio, or Video to questions via URL or local file upload (saved as Data URI).
- **JSON Support**: Load existing `questions.json` or `trivia_data.json` files, and save your work back to JSON.

## How to Use

1.  **Open the Editor**: Double-click `index.html` to open it in your web browser.
2.  **Load Data**:
    *   Click "Load JSON" to open an existing trivia file (e.g., `questions.json`).
3.  **Edit**:
    *   **Add Category**: Click the big "Add New Category" button at the bottom.
    *   **Add Question**: Open a category and click "Add Question".
    *   **Set Answers**: The **first** answer slot (green) is the Correct Answer. The other three are distractors.
    *   **Add Media**: Select the media type (Image/Audio/Video) and paste a URL or click the upload icon to select a file from your computer.
4.  **Save**:
    *   Click "Save JSON" to download the file (default name `trivia_data.json`).
    *   Rename this file to `questions.json` and place it in your game folder to update the game data.

## Integration with Game

The editor exports a JSON object:
```json
{
    "Category Name": [
        {
            "question": "...",
            "choices": ["Correct", "Wrong1", "Wrong2", "Wrong3"],
            "correct": 0,
            "media": { "type": "image", "src": "..." }
        }
    ]
}
```

Ensure your game's `script.js` is set up to fetch this JSON or include it as a variable.
