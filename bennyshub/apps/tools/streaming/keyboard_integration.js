class KeyboardController {
    constructor(callbacks) {
        this.callbacks = callbacks || {};
        this.isOpen = false;
        this.scanIndex = -1;
        this.inRowMode = true;
        this.currentRowIndex = 0;
        this.currentBtnIndex = 0;
        
        // Journal-style Layout (Alphabetical Blocks of 6)
        this.rows = [
            ["Space", "Del", "Del Word", "Clear", "Search", "Exit"], // Controls
            ["A", "B", "C", "D", "E", "F"],
            ["G", "H", "I", "J", "K", "L"],
            ["M", "N", "O", "P", "Q", "R"],
            ["S", "T", "U", "V", "W", "X"],
            ["Y", "Z", "0", "1", "2", "3"],
            ["4", "5", "6", "7", "8", "9"]
        ];

        this.controlSymbols = {
            "Space": "—",
            "Del": "⌫",
            "Del Word": "⌦",
            "Clear": "✕",
            "Search": "🔍",
            "Exit": "⏻"
        };
        
        // Logical Row Mapping:
        // 0: Input Bar
        // 1: Prediction Row
        // 2: Controls
        // 3+: Alpha rows
        
        this.inputRowIndex = 0;
        this.predictionRowIndex = 1;
        this.firstKeyRowIndex = 2; // Where this.rows starts mapping visually
        
        this.container = document.getElementById('keyboard-container');
        this.keysContainer = document.getElementById('keyboard-keys');
        this.predictionContainer = document.getElementById('prediction-bar');
        this.inputElement = document.getElementById('search-input');
        
        // Ensure elements exist
        if (!this.container) console.error("Keyboard container not found");
        
        this.initDOM();
    }

    initDOM() {
        if (!this.keysContainer) return;
        
        this.keysContainer.innerHTML = '';
        this.rows.forEach((row, rIdx) => {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'kb-row';
            rowDiv.id = `kb-row-${rIdx}`;
            
            row.forEach((key, bIdx) => {
                const btn = document.createElement('button');
                btn.className = 'kb-key';
                // Add specific classes
                if (key === 'Search') btn.classList.add('action-search');
                if (key === 'Exit') btn.classList.add('action-exit');
                if (rIdx === 0) btn.classList.add('key-control');
                
                // Content
                if (this.controlSymbols[key]) {
                    btn.innerHTML = `<span class="symbol">${this.controlSymbols[key]}</span> <span class="label">${key}</span>`;
                } else {
                    btn.textContent = key;
                }
                
                // Click handler (mouse support)
                btn.addEventListener('click', () => {
                    this.handleKeyInput(key);
                });
                
                rowDiv.appendChild(btn);
            });
            this.keysContainer.appendChild(rowDiv);
        });
        
        // Initialize predictions area
        this.renderPredictions([]);
    }

    open() {
        this.isOpen = true;
        this.container.classList.remove('hidden');
        this.inRowMode = true;
        this.currentRowIndex = 0;
        this.currentBtnIndex = 0;
        this.highlightCurrentState();
        this.speak("Keyboard open. Select row.");
        
        // Fetch initial predictions
        this.updatePredictions();
    }

    close(reason) {
        this.isOpen = false;
        this.container.classList.add('hidden');
        this.clearHighlights();
        if (this.callbacks.onClose) this.callbacks.onClose(reason);
    }

    // --- Scanning Logic ---

    scanForward() {
        if (this.inRowMode) {
            // Cycle through logical rows
            // Total = input + prediction + keys
            const totalRows = 2 + this.rows.length; 
            this.currentRowIndex = (this.currentRowIndex + 1) % totalRows;
        } else {
            // Cycle through buttons in the current row
            if (this.currentRowIndex === this.predictionRowIndex) {
                // Prediction row
                const buttons = this.predictionContainer.querySelectorAll('.prediction-chip');
                if (buttons.length > 0) {
                    this.currentBtnIndex = (this.currentBtnIndex + 1) % buttons.length;
                }
            } else if (this.currentRowIndex === this.inputRowIndex) {
                 this.currentBtnIndex = 0;
            } else {
                // Standard row (offset by firstKeyRowIndex)
                const realRowIdx = this.currentRowIndex - this.firstKeyRowIndex;
                const rowItems = this.rows[realRowIdx];
                this.currentBtnIndex = (this.currentBtnIndex + 1) % rowItems.length;
            }
        }
        this.highlightCurrentState();
        this.speakCurrentState();
    }

    scanBackward() {
         if (this.inRowMode) {
             const totalRows = 2 + this.rows.length; 
             this.currentRowIndex = (this.currentRowIndex - 1 + totalRows) % totalRows;
        } else {
             if (this.currentRowIndex === this.predictionRowIndex) {
                 const buttons = this.predictionContainer.querySelectorAll('.prediction-chip');
                 if (buttons.length > 0) {
                     this.currentBtnIndex = (this.currentBtnIndex - 1 + buttons.length) % buttons.length;
                 }
             } else if (this.currentRowIndex === this.inputRowIndex) {
                 this.currentBtnIndex = 0;
             } else {
                 const realRowIdx = this.currentRowIndex - this.firstKeyRowIndex;
                 const rowItems = this.rows[realRowIdx];
                 this.currentBtnIndex = (this.currentBtnIndex - 1 + rowItems.length) % rowItems.length;
             }
        }
        this.highlightCurrentState();
        this.speakCurrentState();
    }

    select() {
        if (this.inRowMode) {
            // Enter the row
            this.inRowMode = false;
            this.currentBtnIndex = 0;
            this.highlightCurrentState();
            
            // Speak immediates
            if (this.currentRowIndex === this.predictionRowIndex) {
                this.speak("Predictions");
            } else if (this.currentRowIndex === this.inputRowIndex) {
                const txt = this.inputElement.value;
                this.speak(txt ? txt : "Empty text box");
            } else {
                const realRowIdx = this.currentRowIndex - this.firstKeyRowIndex;
                const firstKey = this.rows[realRowIdx][0];
                this.speak(firstKey);
            }
        } else {
            // Click the button
            this.executeKey();
            
            if (this.isOpen) {
                this.inRowMode = true;
                this.highlightCurrentState();
                
                // Speak next state
                this.speakRowSummary(this.currentRowIndex);
            }
        }
    }

    executeKey() {
        if (this.currentRowIndex === this.predictionRowIndex) {
            // Prediction
            const chips = this.predictionContainer.querySelectorAll('.prediction-chip');
            if (chips[this.currentBtnIndex]) {
                const text = chips[this.currentBtnIndex].textContent;
                this.applyPrediction(text);
            }
        } else if (this.currentRowIndex === this.inputRowIndex) {
             // Input box
             const txt = this.inputElement.value;
             this.speak(txt ? "Typed: " + txt : "Text box is empty");
        } else {
            // Key
            const realRowIdx = this.currentRowIndex - this.firstKeyRowIndex;
            const key = this.rows[realRowIdx][this.currentBtnIndex];
            this.handleKeyInput(key);
        }
    }
    
    handleKeyInput(key) {
        let val = this.inputElement.value;
        
        switch(key) {
            case "Space":
                this.insertText(" ");
                break;
            case "Del":
                this.inputElement.value = val.slice(0, -1);
                this.speak(this.inputElement.value || "Deleted");
                this.triggerSearchUpdate();
                break;
            case "Del Word":
                const wordsArr = this.inputElement.value.trimEnd().split(' ');
                if (wordsArr.length > 0) wordsArr.pop();
                this.inputElement.value = wordsArr.join(' ') + (wordsArr.length > 0 ? " " : "");
                this.speak(this.inputElement.value || "Deleted word");
                this.triggerSearchUpdate();
                break;
            case "Clear":
                this.inputElement.value = "";
                this.speak("Cleared");
                this.triggerSearchUpdate();
                break;
            case "Search":
                this.close("search");
                // Save Search History
                const term = this.inputElement.value.trim();
                if (term) {
                    const isElectron = typeof window !== 'undefined' && window.electronAPI;
                    if (isElectron) {
                        window.electronAPI.streaming.saveSearch(term).catch(e=>console.error(e));
                    } else {
                        fetch('/api/save_search', {
                            method: 'POST', 
                            headers: {'Content-Type': 'application/json'},
                            body: JSON.stringify({term: term})
                        }).catch(e=>console.error(e));
                    }
                }

                if (this.callbacks.onSearch) this.callbacks.onSearch();
                break;
            case "Exit":
                this.close();
                break;
            default:
                this.insertText(key);
                break;
        }
        
        // Update predictions after input
        this.updatePredictions();
    }

    insertText(text) {
        this.inputElement.value += text;
        this.triggerSearchUpdate();
        this.speak(this.inputElement.value);
    }
    
    triggerSearchUpdate() {
        // Dispatch input event so the editor picks it up
        const event = new Event('input', { bubbles: true });
        this.inputElement.dispatchEvent(event);
    }

    // --- Visuals & TTS ---

    clearHighlights() {
        const allKeys = this.container.querySelectorAll('.highlighted');
        allKeys.forEach(el => el.classList.remove('highlighted'));
        
        const allRows = this.container.querySelectorAll('.kb-row');
        allRows.forEach(el => el.classList.remove('row-highlighted'));
        
        this.predictionContainer.classList.remove('row-highlighted');
    }

    highlightCurrentState() {
        this.clearHighlights();
        
        if (this.inRowMode) {
            // Highlight entire row
            if (this.currentRowIndex === this.predictionRowIndex) {
                 this.predictionContainer.classList.add('row-highlighted');
            } else if (this.currentRowIndex === this.inputRowIndex) {
                 this.inputElement.classList.add('highlighted');
            } else {
                const realRowIdx = this.currentRowIndex - this.firstKeyRowIndex;
                const rowDiv = document.getElementById(`kb-row-${realRowIdx}`);
                if (rowDiv) rowDiv.classList.add('row-highlighted');
            }
        } else {
            // Highlight specific button
            if (this.currentRowIndex === this.predictionRowIndex) {
                const chips = this.predictionContainer.querySelectorAll('.prediction-chip');
                if (chips[this.currentBtnIndex]) chips[this.currentBtnIndex].classList.add('highlighted');
            } else if (this.currentRowIndex === this.inputRowIndex) {
                 this.inputElement.classList.add('highlighted');
            } else {
                const realRowIdx = this.currentRowIndex - this.firstKeyRowIndex;
                const rowDiv = document.getElementById(`kb-row-${realRowIdx}`);
                if (rowDiv) {
                    const btns = rowDiv.querySelectorAll('.kb-key');
                    if (btns[this.currentBtnIndex]) btns[this.currentBtnIndex].classList.add('highlighted');
                }
            }
        }
    }

    speakCurrentState() {
        if (this.inRowMode) {
            this.speakRowSummary(this.currentRowIndex);
        } else {
             if (this.currentRowIndex === this.predictionRowIndex) {
                const chips = this.predictionContainer.querySelectorAll('.prediction-chip');
                if (chips[this.currentBtnIndex]) this.speak(chips[this.currentBtnIndex].textContent);
             } else if (this.currentRowIndex === this.inputRowIndex) {
                const txt = this.inputElement.value;
                this.speak(txt ? txt : "Text box empty");
             } else {
                 const realRowIdx = this.currentRowIndex - this.firstKeyRowIndex;
                 const key = this.rows[realRowIdx][this.currentBtnIndex];
                 if (key === "Del") this.speak("Delete letter");
                 else if (key === "Del Word") this.speak("Delete word");
                 else this.speak(key);
             }
        }
    }

    speakRowSummary(rIdx) {
        if (rIdx === this.predictionRowIndex) {
             const chips = this.predictionContainer.querySelectorAll('.prediction-chip');
             const words = Array.from(chips).map(c => c.textContent).join(', ');
             this.speak(words || "No predictions");
        } else if (rIdx === this.inputRowIndex) {
            const txt = this.inputElement.value;
            // Just speak the text directly, or "Empty" if nothing
            this.speak(txt ? txt : "Empty");
        } else {
            // Controls or Keys
            const realRowIdx = this.currentRowIndex - this.firstKeyRowIndex;
            if (realRowIdx === 0) {
                 this.speak("Controls");
            } else {
                const letters = this.rows[realRowIdx].join(' ');
                this.speak(letters);
            }
        }
    }

    speak(text) {
        // Reuse global speak if available
        if (window.speak) {
            window.speak(text);
        } else if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel();
            const u = new SpeechSynthesisUtterance(text);
            window.speechSynthesis.speak(u);
        }
    }

    // --- Predictions ---
    
    async updatePredictions() {
        const currentVal = this.inputElement.value;
        let preds = [];

        if (window.predictionSystem) {
             preds = await window.predictionSystem.getHybridPredictions(currentVal);
        } else {
             // Fallback
             preds = ["SEARCH", "VIDEO", "PLAY"];
        }
        
        this.renderPredictions(preds);
    }
    
    renderPredictions(words) {
        this.predictionContainer.innerHTML = '';
        words.forEach(w => {
            const chip = document.createElement('button');
            chip.className = 'prediction-chip';
            chip.textContent = w;
            chip.style.minWidth = "60px"; // Ensure touch target
            // Mouse click support
            chip.onclick = () => {
                this.applyPrediction(w);
                this.inRowMode = true; 
                this.highlightCurrentState();
            };
            this.predictionContainer.appendChild(chip);
        });
        
       if (words.length === 0) {
           const empty = document.createElement('span');
           empty.textContent = ""; // Keep empty to avoid clutter
           this.predictionContainer.appendChild(empty);
       }
    }

    applyPrediction(text) {
        // Smart replacement logic
        const currentVal = this.inputElement.value;
        const currentValUpper = currentVal.toUpperCase().trim();
        const textUpper = text.toUpperCase();
        
        // 1. If prediction contains the current input (search improvement)
        // e.g. "SIM" -> "THE SIMPSONS"
        // We prefer full replacement for search field behavior
        if (currentValUpper.length > 0 && textUpper.includes(currentValUpper)) {
             this.inputElement.value = text + " ";
        }
        // 2. If prediction extends the whole current input (standard)
        else if (textUpper.startsWith(currentValUpper) && textUpper !== currentValUpper) {
            this.inputElement.value = text + " ";
        }
        // 2. If prediction extends the last word
        else {
             const words = currentVal.split(' ');
             const lastWord = words.pop() || "";
             
             if (textUpper.startsWith(lastWord.toUpperCase())) {
                  words.push(text);
                  this.inputElement.value = words.join(' ') + " ";
             } else {
                  // Append
                  this.inputElement.value += text + " ";
             }
        }
        
        this.triggerSearchUpdate();
        this.speak(this.inputElement.value); // Confirm new state
    }

    handleLongPressEnter() {
        if (!this.inRowMode) {
             // Button Mode -> Back to Row Mode
            this.inRowMode = true;
            this.highlightCurrentState();
            
             // Announce context immediately
            this.speak("Row mode"); 
            setTimeout(() => this.speakRowSummary(this.currentRowIndex), 800);
        } else {
             // Row Mode -> Jump to Predictions
             this.currentRowIndex = this.predictionRowIndex;
             this.inRowMode = true;
             this.highlightCurrentState();
             
             // Announce predictions
             this.speak("Predictions");
             setTimeout(() => this.speakRowSummary(this.currentRowIndex), 800);
        }
    }
}

// Global instance
window.keyboardController = new KeyboardController({
    onClose: (reason) => {
        // Return focus/highlight to the search button in the main app
        // We can dispatch a custom event or let the app handle state
        if (reason !== 'search') {
            document.dispatchEvent(new CustomEvent('keyboard-closed'));
        }
    },
    onSearch: () => {
        document.dispatchEvent(new CustomEvent('keyboard-search'));
    }
});

// Expose open function globally
window.openKeyboard = () => window.keyboardController.open();
