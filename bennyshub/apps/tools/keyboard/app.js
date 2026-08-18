(() => {
  const $ = (sel) => document.querySelector(sel);
  const textBar = $("#textBar");
  const predictBar = $("#predictBar");
  const letterPredictBar = $("#letterPredictBar");
  const kb = $("#keyboard");
  const settingsMenu = $("#settingsMenu");

  const defaultSettings = {
    autocapI: true,
    theme: "default",
    scanSpeed: "medium",
    highlightColor: "yellow",
    autoScan: false  // Changed from true to false
  };

  let settings = loadSettings();
  function loadSettings() {
    try { 
      const v = JSON.parse(localStorage.getItem("kb_settings")); 
      // Remove voiceIndex from keyboard settings as it's now handled by voice manager
      if (v && 'voiceIndex' in v) delete v.voiceIndex;
      return { ...defaultSettings, ...v }; 
    }
    catch { 
      return { ...defaultSettings }; 
    }
  }

  // INTEGRATION: Sync with Shared Scan Manager
  if (window.NarbeScanManager) {
      console.log("🔗 Connected to NarbeScanManager");
      
      // Update local logic when manager changes
      window.NarbeScanManager.subscribe((newSettings) => {
          console.log("🔄 Scan settings updated from Hub:", newSettings);
          
          // Restart auto-scan if active to apply new speed
          if (isAutoScanning) {
              stopAutoScan();
              startAutoScan();
          }
          updateScanSpeedDisplay();
      });
  }

  function saveSettings() {
    localStorage.setItem("kb_settings", JSON.stringify(settings));
  }

  // TTS functionality using unified voice manager with interruption
  function speak(text) {
    // Always cancel any currently speaking TTS first
    if (window.NarbeVoiceManager && window.NarbeVoiceManager.cancel) {
      window.NarbeVoiceManager.cancel();
    }
    
    // Small delay to ensure cancellation takes effect
    setTimeout(() => {
      if (window.NarbeVoiceManager && window.NarbeVoiceManager.speakProcessed) {
        window.NarbeVoiceManager.speakProcessed(text);
      }
    }, 50);
  }

  // Scan timing configuration - derived from Manager when possible
  // We keep this structure for manual interaction timeouts (Long Press) which aren't in Manager yet
  // But we will try to scale them relative to the main speed if we can, or just keep fixed defaults for hold durations.
  const scanSpeeds = {
    slow: { forward: 1500, backward: 3000, longPress: 2000 },
    medium: { forward: 1000, backward: 2000, longPress: 2000 },
    fast: { forward: 500, backward: 1000, longPress: 2000 }
  };
  
  // Helper to get current interval from Manager
  function getScanInterval() {
      if (window.NarbeScanManager) {
          return window.NarbeScanManager.getSettings().scanInterval;
      }
      return 2000; // Fallback default
  }

  let autoScanInterval = null;
  let isAutoScanning = false;

  // Theme management
  const themes = ["default", "light", "dark", "blue", "green", "purple", "orange", "red"];
  let currentThemeIndex = themes.indexOf(settings.theme) || 0;

  // Highlight color management
  const highlightColors = ["yellow", "pink", "green", "orange", "black", "white", "purple", "red"];
  let currentHighlightIndex = highlightColors.indexOf(settings.highlightColor) || 0;

  function applyTheme(theme) {
    themes.forEach(t => document.body.classList.remove(`theme-${t}`));
    if (theme !== "default") {
      document.body.classList.add(`theme-${theme}`);
    }
    settings.theme = theme;
    saveSettings();
    updateThemeDisplay();
  }

  function applyHighlightColor(color) {
    highlightColors.forEach(c => document.body.classList.remove(`highlight-${c}`));
    document.body.classList.add(`highlight-${color}`);
    settings.highlightColor = color;
    saveSettings();
    updateHighlightDisplay();
  }

  // Settings menu state
  let inSettingsMode = false;
  let settingsRowIndex = 0;
  let settingsItems = [];

  // Scanning state
  let inRowSelectionMode = true;
  let currentRowIndex = 0;
  let currentButtonIndex = 0;
  let spacebarPressed = false;
  let returnPressed = false;
  let spacebarPressTime = null;
  let returnPressTime = null;
  let longPressTriggered = false;
  let backwardScanInterval = null;
  let backwardScanningOccurred = false; // Track if backward scanning actually happened

  // Text state
  let buffer = "";
  let ttsUseCount = 0;

  function setBuffer(txt) {
    buffer = txt;
    // Use innerHTML with a wrapper span so text and cursor flow together when wrapping
    // Only convert trailing space to &nbsp; so it's visible, keep other spaces for word wrap
    let escapedText = buffer
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    // If there's a trailing space, convert it to &nbsp; so cursor trails it
    if (escapedText.endsWith(' ')) {
      escapedText = escapedText.slice(0, -1) + '&nbsp;';
    }
    textBar.innerHTML = '<span class="text-content">' + escapedText + '<span class="cursor">|</span></span>';
    
    // Dynamically adjust text size based on length
    adjustTextSize(buffer);
    
    ttsUseCount = 0;
    renderPredictions();
  }

  function adjustTextSize(text) {
    // Remove all size classes first
    textBar.classList.remove('text-medium', 'text-small', 'text-tiny');
    
    // Get the text length without the cursor
    const textLength = text.replace('|', '').length;
    
    // Apply appropriate class based on text length
    if (textLength > 100) {
      textBar.classList.add('text-tiny');
    } else if (textLength > 50) {
      textBar.classList.add('text-small');
    } else if (textLength > 25) {
      textBar.classList.add('text-medium');
    }
    // Otherwise use default size (no class needed)
  }

  // Keyboard layout with symbols for control buttons
  const rows = [
    ["Space", "Del Letter", "Del Word", "Clear", "Settings", "Exit"],
    ["A","B","C","D","E","F"],
    ["G","H","I","J","K","L"],
    ["M","N","O","P","Q","R"],
    ["S","T","U","V","W","X"],
    ["Y","Z","0","1","2","3"],
    ["4","5","6","7","8","9"]
  ];

  // Control button symbols
  const controlSymbols = {
    "Space": "—",        // Em dash symbol (changed from underscore)
    "Del Letter": "⌫",   // Backspace symbol
    "Del Word": "⌦",     // Delete forward symbol
    "Clear": "✕",        // Clear/X symbol
    "Settings": "⚙",     // Gear symbol
    "Exit": "⏻"          // Power/Exit symbol
  };

  function renderKeyboard() {
    kb.innerHTML = "";
    rows.forEach((row, rIdx) => {
      row.forEach((key) => {
        const btn = document.createElement("button");
        btn.className = "key" + (rIdx === 0 ? " ctrl" : "");
        
        if (key === "Settings") {
          btn.classList.add("settings");
        } else if (key === "Exit") {
          btn.classList.add("exit");
        }
        
        // For control buttons, add symbol and text
        if (rIdx === 0 && controlSymbols[key]) {
          btn.innerHTML = `
            <span class="ctrl-symbol">${controlSymbols[key]}</span>
            <span class="ctrl-text">${key}</span>
          `;
        } else {
          btn.textContent = key;
        }
        
        btn.addEventListener("click", () => {
          if (rIdx === 0) {
            handleControl(key);
          } else {
            insertKey(key);
          }
        });
        kb.appendChild(btn);
      });
    });
    highlightTextBox();
  }

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      startScanning();
    } else if (e.code === "Enter") {
      e.preventDefault();
      startSelecting();
    }
  });

  document.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      stopScanning();
    } else if (e.code === "Enter") {
      e.preventDefault();
      stopSelecting();
    }
  });

  // Listen for cancelled inputs from scan-manager (e.g., too-short presses blocked by anti-tremor)
  // This is CRITICAL to prevent stuck input state when spamming spacebar/enter rapidly
  document.addEventListener('narbe-input-cancelled', (e) => {
    if (e.detail && (e.detail.key === ' ' || e.detail.code === 'Space')) {
      const wasBackScanning = !!backwardScanInterval;
      // Reset space input state
      spacebarPressed = false;
      spacebarPressTime = null;
      if (backwardScanInterval) {
        clearInterval(backwardScanInterval);
        backwardScanInterval = null;
      }
      // If cancelled due to 'too-short', still perform forward scan - user intended to press
      if (e.detail.reason === 'too-short' && !wasBackScanning) {
        if (inSettingsMode) {
          scanSettingsForward();
        } else {
          scanForward();
        }
      }
      backwardScanningOccurred = false;
      console.log("Spacebar input cancelled by scan-manager, state reset");
    }
    if (e.detail && (e.detail.key === 'Enter' || e.detail.code === 'Enter' || e.detail.code === 'NumpadEnter')) {
      // Reset enter input state
      const wasLongPressTriggered = longPressTriggered;
      returnPressed = false;
      returnPressTime = null;
      longPressTriggered = false;
      // Perform select for short Enter presses if not already triggered
      if (e.detail.reason === 'too-short' && !wasLongPressTriggered) {
        selectButton();
      }
      console.log("Enter input cancelled by scan-manager, state reset");
    }
  });

  function startScanning() {
    if (!spacebarPressed) {
      spacebarPressed = true;
      spacebarPressTime = Date.now();
      backwardScanningOccurred = false; // Reset backward scanning flag
      console.log("Spacebar pressed");
      
      // Use NarbeScanManager's interval for backward scanning, with local fallback
      const managerInterval = getScanInterval();
      const longPressThreshold = scanSpeeds[currentScanSpeed].longPress;
      
      setTimeout(() => {
        if (spacebarPressed && (Date.now() - spacebarPressTime) >= longPressThreshold) {
          console.log("Long press detected - starting backward scanning at " + managerInterval + "ms");
          backwardScanInterval = setInterval(() => {
            if (spacebarPressed) {
              backwardScanningOccurred = true; // Mark that backward scanning is happening
              if (inSettingsMode) {
                scanSettingsBackward();
              } else {
                scanBackward();
              }
            }
          }, managerInterval); // Use Manager's scan interval
        }
      }, longPressThreshold);
    }
  }

  function stopScanning() {
    if (spacebarPressed) {
      spacebarPressed = false;
      const pressDuration = Date.now() - spacebarPressTime;
      console.log(`Spacebar released after ${pressDuration}ms, backward scanning occurred: ${backwardScanningOccurred}`);
      
      if (backwardScanInterval) {
        clearInterval(backwardScanInterval);
        backwardScanInterval = null;
      }
      
      // Use longPress threshold from local config (this determines hold duration, not scan interval)
      const longPressThreshold = scanSpeeds[currentScanSpeed].longPress;
      
      // Forward scan if:
      // 1. Short press (250ms to longPress threshold), OR
      // 2. Long press but no backward scanning actually occurred
      if ((pressDuration >= 250 && pressDuration <= longPressThreshold) || 
          (pressDuration > longPressThreshold && !backwardScanningOccurred)) {
        console.log("Triggering forward scan - either short press or long press without backward scanning");
        if (inSettingsMode) {
          scanSettingsForward();
        } else {
          scanForward();
        }
      } else if (backwardScanningOccurred) {
        console.log("Long press with backward scanning - no forward scan on release");
      }
      
      spacebarPressTime = null;
      backwardScanningOccurred = false; // Reset for next press
    }
  }

  function startSelecting() {
    if (!returnPressed) {
      returnPressed = true;
      returnPressTime = Date.now();
      longPressTriggered = false;
      console.log("Return pressed");
      
      setTimeout(() => {
        if (returnPressed && (Date.now() - returnPressTime) >= 3000) {
          handleLongPress();
        }
      }, 3000);
    }
  }

  function stopSelecting() {
    if (returnPressed) {
      returnPressed = false;
      const pressDuration = Date.now() - returnPressTime;
      console.log(`Return released after ${pressDuration}ms`);
      
      if (!longPressTriggered && pressDuration >= 100) {
        console.log("Short press - selecting");
        selectButton();
      }
      
      returnPressTime = null;
      longPressTriggered = false;
    }
  }

  function handleLongPress() {
    longPressTriggered = true;
    clearAllHighlights();
    
    if (inRowSelectionMode) {
      // Jump to word predictive text row (at the very bottom)
      currentRowIndex = rows.length + 2; // Last row index (textbar=0, keyboard=1-7, letter predict=8, word predict=9)
      inRowSelectionMode = true;
      highlightPredictiveRow();
      console.log("Long press: Jumped to word predictive text row (bottom)");

      // Read all predictive text words when entering predictive mode
      speakPredictions();
    } else {
      inRowSelectionMode = true;
      if (currentRowIndex === 0) {
        highlightTextBox();
      } else if (currentRowIndex === rows.length + 1) {
        highlightLetterPredictRow();
        speakLetterPredictions();
      } else if (currentRowIndex === rows.length + 2) {
        highlightPredictiveRow();
        speakPredictions();
      } else {
        highlightRow(currentRowIndex - 1); // Adjust for keyboard rows (1-7)
        speakRowTitle(currentRowIndex - 1);
      }
      console.log("Long press: Returned to row selection mode");
    }
  }

  function scanForward() {
    if (inRowSelectionMode) {
      const prevRow = currentRowIndex;
      // Navigation: textbar(0) -> keyboard(1-7) -> letter predict(8) -> word predict(9)
      currentRowIndex = (currentRowIndex + 1) % (rows.length + 3);
      console.log(`Scanning forward to row ${currentRowIndex}`);
      
      clearAllHighlights();
      if (currentRowIndex === 0) {
        highlightTextBox();
      } else if (currentRowIndex === rows.length + 1) {
        highlightLetterPredictRow();
        speakLetterPredictions();
      } else if (currentRowIndex === rows.length + 2) {
        highlightPredictiveRow();
        speakPredictions();
      } else {
        highlightRow(currentRowIndex - 1); // Keyboard rows (adjust index)
        speakRowTitle(currentRowIndex - 1);
      }
    } else {
      const prevButton = currentButtonIndex;
      if (currentRowIndex === 0) {
        return; // Can't navigate buttons in textbar
      } else if (currentRowIndex === rows.length + 1) {
        // Letter prediction row navigation
        const chips = letterPredictBar.querySelectorAll(".letter-chip");
        currentButtonIndex = (currentButtonIndex + 1) % chips.length;
        highlightLetterPredictButton(currentButtonIndex, prevButton);
        speakLetterPredictButtonLabel(currentButtonIndex);
      } else if (currentRowIndex === rows.length + 2) {
        // Word prediction row navigation
        const chips = predictBar.querySelectorAll(".chip");
        currentButtonIndex = (currentButtonIndex + 1) % chips.length;
        highlightPredictiveButton(currentButtonIndex, prevButton);
        speakPredictiveButtonLabel(currentButtonIndex);
      } else {
        // Keyboard row navigation
        currentButtonIndex = (currentButtonIndex + 1) % rows[currentRowIndex - 1].length;
        highlightButton(currentButtonIndex, prevButton);
        speakButtonLabel(currentButtonIndex);
      }
    }
  }

  function scanBackward() {
    if (inRowSelectionMode) {
      const prevRow = currentRowIndex;
      currentRowIndex = (currentRowIndex - 1 + (rows.length + 3)) % (rows.length + 3);
      console.log(`Scanning backward to row ${currentRowIndex}`);
      
      clearAllHighlights();
      if (currentRowIndex === 0) {
        highlightTextBox();
      } else if (currentRowIndex === rows.length + 1) {
        highlightLetterPredictRow();
        speakLetterPredictions();
      } else if (currentRowIndex === rows.length + 2) {
        highlightPredictiveRow();
        speakPredictions();
      } else {
        highlightRow(currentRowIndex - 1);
        speakRowTitle(currentRowIndex - 1);
      }
    } else {
      const prevButton = currentButtonIndex;
      if (currentRowIndex === 0) {
        return;
      } else if (currentRowIndex === rows.length + 1) {
        // Letter prediction row navigation
        const chips = letterPredictBar.querySelectorAll(".letter-chip");
        currentButtonIndex = (currentButtonIndex - 1 + chips.length) % chips.length;
        highlightLetterPredictButton(currentButtonIndex, prevButton);
        speakLetterPredictButtonLabel(currentButtonIndex);
      } else if (currentRowIndex === rows.length + 2) {
        // Word prediction row navigation
        const chips = predictBar.querySelectorAll(".chip");
        currentButtonIndex = (currentButtonIndex - 1 + chips.length) % chips.length;
        highlightPredictiveButton(currentButtonIndex, prevButton);
        speakPredictiveButtonLabel(currentButtonIndex);
      } else {
        // Keyboard row navigation
        currentButtonIndex = (currentButtonIndex - 1 + rows[currentRowIndex - 1].length) % rows[currentRowIndex - 1].length;
        highlightButton(currentButtonIndex, prevButton);
        speakButtonLabel(currentButtonIndex);
      }
    }
  }

  async function updatePredictiveButtons() {
    await renderPredictions();
  }

  function selectButton() {
    if (inSettingsMode) {
      selectSettingsItem();
      return;
    }
    
    if (inRowSelectionMode) {
      if (currentRowIndex === 0) {
        // Textbar selection
        const text = buffer.replace(/\|/g, "").trim();
        if (text) {
          speak(text);
          ttsUseCount++;
          console.log(`TTS use count: ${ttsUseCount} for text: "${text}"`);
          
          if (ttsUseCount >= 3) {
            console.log("3x TTS usage detected - recording words");
            saveTextToPredictive(text);
            ttsUseCount = 0;
          }
        }
      } else if (currentRowIndex === rows.length + 1) {
        // Letter prediction row selection - enter button mode
        inRowSelectionMode = false;
        currentButtonIndex = 0;
        clearAllHighlights();
        const chips = letterPredictBar.querySelectorAll(".letter-chip");
        if (chips.length > 0) {
          highlightLetterPredictButton(0);
          speakLetterPredictButtonLabel(0);
        }
      } else if (currentRowIndex === rows.length + 2) {
        // Word prediction row selection - enter button mode
        inRowSelectionMode = false;
        currentButtonIndex = 0;
        clearAllHighlights();
        const chips = predictBar.querySelectorAll(".chip");
        if (chips.length > 0) {
          highlightPredictiveButton(0);
          speakPredictiveButtonLabel(0);
        }
      } else {
        // Keyboard row selection - enter button mode
        inRowSelectionMode = false;
        currentButtonIndex = 0;
        clearAllHighlights();
        highlightButton(0);
        speakButtonLabel(0);
      }
    } else {
      if (currentRowIndex === 0) {
        return;
      } else if (currentRowIndex === rows.length + 1) {
        // Letter prediction button selection
        const chips = letterPredictBar.querySelectorAll(".letter-chip");
        if (chips[currentButtonIndex] && chips[currentButtonIndex].textContent.trim()) {
          const letter = chips[currentButtonIndex].textContent.trim();
          insertKey(letter);
        }
        
        // Return to row selection mode for Letter Prediction Row
        inRowSelectionMode = true;
        clearAllHighlights();
        
        // Wait for predictions to update then highlight and speak
        updatePredictiveButtons().then(() => {
            highlightLetterPredictRow();
            speakLetterPredictions();
        });
        return;
        
      } else if (currentRowIndex === rows.length + 2) {
        // Word prediction button selection
        const chips = predictBar.querySelectorAll(".chip");
        if (chips[currentButtonIndex] && chips[currentButtonIndex].textContent.trim()) {
          const word = chips[currentButtonIndex].textContent.trim();
          const currentPartialWord = currentWord();
          let newBuffer = buffer;
          
          if (currentPartialWord && !buffer.endsWith(" ")) {
            newBuffer = buffer.slice(0, -currentPartialWord.length) + word + " ";
          } else {
            if (!buffer.endsWith(" ") && buffer.length) newBuffer += " ";
            newBuffer += word + " ";
          }
          
          setBuffer(newBuffer);
          
          // Record the selected word and context
          if (window.predictionSystem) {
            try {
              window.predictionSystem.recordLocalWord(word);
              const context = buffer.replace("|", "").trim();
              if (context) {
                window.predictionSystem.recordNgram(context, word);
              }
            } catch (e) {
              console.error('Error recording prediction:', e);
            }
          }
        }
        
        // Return to row selection mode for Word Prediction Row
        inRowSelectionMode = true;
        clearAllHighlights();
        
        // Wait for predictions to update then highlight and speak
        updatePredictiveButtons().then(() => {
            highlightPredictiveRow();
            speakPredictions();
        });
        return;

      } else {
        // Keyboard button selection
        const key = rows[currentRowIndex - 1][currentButtonIndex];
        if (currentRowIndex - 1 === 0) {
          handleControl(key);
        } else {
          insertKey(key);
        }
      }
      
      // Return to row selection mode for Keyboard Rows
      inRowSelectionMode = true;
      clearAllHighlights();
      if (currentRowIndex === 0) {
        highlightTextBox();
      } else {
        highlightRow(currentRowIndex - 1);
        speakRowTitle(currentRowIndex - 1);
      }
    }
  }

  async function renderPredictions() {
    try {
      const wasPredictiveRowHighlighted = (currentRowIndex === rows.length + 2 && inRowSelectionMode);
      const wasInButtonMode = (currentRowIndex === rows.length + 2 && !inRowSelectionMode);
      const wasLetterPredictRowHighlighted = (currentRowIndex === rows.length + 1 && inRowSelectionMode);
      const wasLetterPredictInButtonMode = (currentRowIndex === rows.length + 1 && !inRowSelectionMode);
      const savedButtonIndex = currentButtonIndex;
      
      // Get word predictions FIRST
      let predictions = ["YES", "NO", "HELP", "THE", "I", "YOU"]; // Default fallback
      
      if (window.predictionSystem && window.predictionSystem.getHybridPredictions) {
        try {
          predictions = await window.predictionSystem.getHybridPredictions(buffer);
        } catch (e) {
          console.error('Error getting predictions:', e);
        }
      }
      
      // Now render letter predictions with the word predictions for context
      renderLetterPredictions(predictions);
      
      console.log("Final predictions to render:", predictions);

      predictBar.innerHTML = "";
      predictions.slice(0, 6).forEach(w => {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = w;
        chip.addEventListener("click", () => {
          const partial = currentWord();
          let newBuf = buffer;
          if (partial && !buffer.endsWith(" ")) {
            newBuf = buffer.slice(0, -partial.length) + w + " ";
          } else {
            if (!buffer.endsWith(" ") && buffer.length) newBuf += " ";
            newBuf += w + " ";
          }
          setBuffer(newBuf);
          
          // Record if prediction system available
          if (window.predictionSystem) {
            try {
              window.predictionSystem.recordLocalWord(w);
              const context = buffer.replace("|", "").trim();
              if (context) {
                window.predictionSystem.recordNgram(context, w);
              }
            } catch (e) {
              console.error('Error recording prediction:', e);
            }
          }
        });
        predictBar.appendChild(chip);
      });

      while (predictBar.children.length < 6) {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = "";
        chip.disabled = true;
        predictBar.appendChild(chip);
      }
      
      if (wasPredictiveRowHighlighted) {
        highlightPredictiveRow();
      } else if (wasInButtonMode) {
        const chips = predictBar.querySelectorAll(".chip");
        if (chips[savedButtonIndex]) {
          highlightPredictiveButton(savedButtonIndex);
        }
      } else if (wasLetterPredictRowHighlighted) {
        highlightLetterPredictRow();
      } else if (wasLetterPredictInButtonMode) {
        const chips = letterPredictBar.querySelectorAll(".letter-chip");
        if (chips[savedButtonIndex]) {
          highlightLetterPredictButton(savedButtonIndex);
        }
      }
    } catch (error) {
      console.error('Error in renderPredictions:', error);
    }
  }

  function renderLetterPredictions(wordPredictions = []) {
    let letterPredictions = ['E', 'T', 'A', 'O', 'I', 'N']; // Default
    
    console.log(`[renderLetterPredictions] Word predictions passed:`, wordPredictions);
    console.log(`[renderLetterPredictions] Buffer:`, buffer);
    
    if (window.predictionSystem && window.predictionSystem.getLetterPredictions) {
      try {
        letterPredictions = window.predictionSystem.getLetterPredictions(buffer, wordPredictions);
        console.log(`[renderLetterPredictions] Letter predictions result:`, letterPredictions);
      } catch (e) {
        console.error('Error getting letter predictions:', e);
      }
    }
    
    letterPredictBar.innerHTML = "";
    letterPredictions.slice(0, 6).forEach(letter => {
      const chip = document.createElement("button");
      chip.className = "letter-chip";
      chip.textContent = letter;
      chip.addEventListener("click", () => {
        insertKey(letter);
      });
      letterPredictBar.appendChild(chip);
    });
    
    // Fill remaining slots
    while (letterPredictBar.children.length < 6) {
      const chip = document.createElement("button");
      chip.className = "letter-chip";
      chip.textContent = "";
      chip.disabled = true;
      letterPredictBar.appendChild(chip);
    }
  }

  function currentWord() {
    const trimmed = buffer.replace(/\|/g, "").trimEnd();
    const parts = trimmed.split(/\s+/);
    if (buffer.endsWith(" ")) return "";
    return parts[parts.length - 1] || "";
  }

  function clearAllHighlights() {
    textBar.classList.remove("highlighted");
    const allKeys = kb.querySelectorAll(".key");
    allKeys.forEach(key => key.classList.remove("highlighted"));
    const allChips = predictBar.querySelectorAll(".chip");
    allChips.forEach(chip => chip.classList.remove("highlighted"));
    const allLetterChips = letterPredictBar.querySelectorAll(".letter-chip");
    allLetterChips.forEach(chip => chip.classList.remove("highlighted"));
  }

  function highlightTextBox() {
    clearAllHighlights();
    textBar.classList.add("highlighted");
  }

  function highlightRow(rowIndex) {
    clearAllHighlights();
    const rowStart = rowIndex * 6;
    const allKeys = kb.querySelectorAll(".key");
    
    for (let i = 0; i < 6; i++) {
      if (allKeys[rowStart + i]) {
        allKeys[rowStart + i].classList.add("highlighted");
      }
    }
  }

  function highlightButton(buttonIndex, prevButtonIndex = null) {
    const rowStart = (currentRowIndex - 1) * 6; // Adjust for keyboard rows starting at index 1
    const allKeys = kb.querySelectorAll(".key");
    
    if (prevButtonIndex !== null && allKeys[rowStart + prevButtonIndex]) {
      allKeys[rowStart + prevButtonIndex].classList.remove("highlighted");
    }
    
    if (allKeys[rowStart + buttonIndex]) {
      allKeys[rowStart + buttonIndex].classList.add("highlighted");
    }
  }

  function highlightPredictiveRow() {
    clearAllHighlights();
    const allChips = predictBar.querySelectorAll(".chip");
    allChips.forEach(chip => chip.classList.add("highlighted"));
  }

  function highlightPredictiveButton(buttonIndex, prevButtonIndex = null) {
    const chips = predictBar.querySelectorAll(".chip");
    
    if (prevButtonIndex !== null && chips[prevButtonIndex]) {
      chips[prevButtonIndex].classList.remove("highlighted");
    }
    
    if (chips[buttonIndex]) {
      chips[buttonIndex].classList.add("highlighted");
    }
  }

  function highlightLetterPredictRow() {
    clearAllHighlights();
    const allChips = letterPredictBar.querySelectorAll(".letter-chip");
    allChips.forEach(chip => chip.classList.add("highlighted"));
  }

  function highlightLetterPredictButton(buttonIndex, prevButtonIndex = null) {
    const chips = letterPredictBar.querySelectorAll(".letter-chip");
    
    if (prevButtonIndex !== null && chips[prevButtonIndex]) {
      chips[prevButtonIndex].classList.remove("highlighted");
    }
    
    if (chips[buttonIndex]) {
      chips[buttonIndex].classList.add("highlighted");
    }
  }

  function speakLetterPredictButtonLabel(buttonIndex) {
    const chips = letterPredictBar.querySelectorAll(".letter-chip");
    if (chips[buttonIndex] && chips[buttonIndex].textContent.trim()) {
      const letter = chips[buttonIndex].textContent.trim();
      speak(letter);
    }
  }

  function speakLetterPredictions() {
    const letterChips = letterPredictBar.querySelectorAll('.letter-chip');
    if (letterChips.length > 0) {
      const letters = Array.from(letterChips)
        .map(chip => chip.textContent)
        .filter(text => text.trim())
        .join(", ");
      
      if (letters) {
        speak(letters);
      } else {
        speak("no letter predictions");
      }
    }
  }

  function speakRowTitle(rowIndex) {
    const rowTitles = [
      "controls", 
      "a b c d e f", 
      "g h i j k l", 
      "m n o p q r", 
      "s t u v w x", 
      "y z 0 1 2 3", 
      "4 5 6 7 8 9", 
      "letter predictions",
      "word predictions"
    ];
    
    // Check if it's the letter predictions row (index 7)
    if (rowIndex === 7) {
      speakLetterPredictions();
      return;
    }
    
    // Check if it's the word predictions row (index 8)
    if (rowIndex === 8) {
      speakPredictions();
      return;
    }
    
    if (rowIndex < rowTitles.length) {
      speak(rowTitles[rowIndex]);
    }
  }

  function speakButtonLabel(buttonIndex) {
    const label = rows[currentRowIndex - 1][buttonIndex];
    let spokenLabel = label.toLowerCase();
    
    if (spokenLabel === "del letter") spokenLabel = "delete letter";
    if (spokenLabel === "del word") spokenLabel = "delete word";
    
    // For single letters and short words, let the voice manager handle pronunciation
    // Remove the special case handling here since voice manager now handles it
    speak(spokenLabel);
  }

  function speakPredictiveButtonLabel(buttonIndex) {
    const chips = predictBar.querySelectorAll(".chip");
    if (chips[buttonIndex] && chips[buttonIndex].textContent.trim()) {
      const word = chips[buttonIndex].textContent.trim();
      console.log(`Speaking predictive button: "${word}"`);
      speak(word); // Voice manager will handle proper pronunciation processing
    }
  }

  function speakPredictions() {
    const predictButtons = document.querySelectorAll('#predictBar .chip');
    if (predictButtons.length > 0) {
      const predictions = Array.from(predictButtons)
        .map(btn => btn.textContent)
        .filter(text => text.trim());
      
      if (predictions.length > 0) {
        // Process each prediction individually through the voice manager BEFORE joining
        console.log(`Speaking predictions: ${predictions}`);
        
        // Process each word through the voice manager's pronunciation mapping
        const processedPredictions = predictions.map(word => {
          let processed = word;
          // Fix for short uppercase words (like "IT", "IS") being read as letters
          if (processed && processed.length > 1 && processed.length <= 4 && processed === processed.toUpperCase()) {
            processed = processed.toLowerCase();
          }

          if (window.NarbeVoiceManager && window.NarbeVoiceManager.processTextForSpeech) {
            return window.NarbeVoiceManager.processTextForSpeech(processed);
          }
          return processed;
        });
        
        const announcement = processedPredictions.join(", ");
        console.log(`Processed predictions announcement: "${announcement}"`);
        
        // Use the voice manager's speak function directly to avoid double-processing
        if (window.NarbeVoiceManager && window.NarbeVoiceManager.speak) {
          window.NarbeVoiceManager.speak(announcement);
        } else {
          speak(announcement);
        }
      } else {
        speak("no predictions available");
      }
    } else {
      speak("no predictions available");
    }
  }

  function openSettings() {
    inSettingsMode = true;
    settingsMenu.classList.remove("hidden");
    kb.style.display = "none";
    predictBar.style.display = "none";
    letterPredictBar.style.display = "none";
    textBar.style.display = "none"; // Hide text bar too
    
    settingsItems = Array.from(settingsMenu.querySelectorAll(".settings-item"));
    settingsRowIndex = 0;
    highlightSettingsItem(0);
    
    updateThemeDisplay();
    updateScanSpeedDisplay();
    updateVoiceDisplay();
    updateHighlightDisplay();
    updateTTSToggleDisplay(); // Add TTS toggle display update
    updateAutoScanDisplay(); // Add Auto Scan display update
  }
  
  // Initialize settings click handlers ONCE using event delegation
  function initSettingsClickHandlers() {
    const settingsGrid = document.getElementById('settingsGrid');
    if (!settingsGrid) return;
    
    settingsGrid.addEventListener('click', (e) => {
      const item = e.target.closest('.settings-item');
      if (!item) return;
      
      const allItems = Array.from(settingsMenu.querySelectorAll(".settings-item"));
      const index = allItems.indexOf(item);
      if (index !== -1) {
        settingsRowIndex = index;
        highlightSettingsItem(settingsRowIndex);
        selectSettingsItem();
      }
    });
    
    settingsGrid.addEventListener('mouseenter', (e) => {
      const item = e.target.closest('.settings-item');
      if (!item) return;
      
      const allItems = Array.from(settingsMenu.querySelectorAll(".settings-item"));
      const index = allItems.indexOf(item);
      if (index !== -1) {
        settingsRowIndex = index;
        highlightSettingsItem(settingsRowIndex);
        
        const label = item.querySelector(".setting-label");
        if (label) speak(label.textContent.toLowerCase());
      }
    }, true); // Use capture to catch mouseenter on child elements
  }

  function closeSettings() {
    inSettingsMode = false;
    settingsMenu.classList.add("hidden");
    kb.style.display = "grid";
    predictBar.style.display = "grid";
    letterPredictBar.style.display = "grid";
    textBar.style.display = "flex"; // Show text bar again
    
    // No need to clone/replace elements - we use event delegation now
    
    inRowSelectionMode = true;
    currentRowIndex = 0;
    highlightTextBox();
  }

  function highlightSettingsItem(index) {
    settingsItems.forEach(item => item.classList.remove("highlighted"));
    if (settingsItems[index]) {
      settingsItems[index].classList.add("highlighted");
    }
  }

  function scanSettingsForward() {
    settingsRowIndex = (settingsRowIndex + 1) % settingsItems.length;
    highlightSettingsItem(settingsRowIndex);
    
    const item = settingsItems[settingsRowIndex];
    const label = item.querySelector(".setting-label").textContent;
    speak(label.toLowerCase());
  }

  function scanSettingsBackward() {
    settingsRowIndex = (settingsRowIndex - 1 + settingsItems.length) % settingsItems.length;
    highlightSettingsItem(settingsRowIndex);
    
    const item = settingsItems[settingsRowIndex];
    const label = item.querySelector(".setting-label").textContent;
    speak(label.toLowerCase());
  }

  function selectSettingsItem() {
    const item = settingsItems[settingsRowIndex];
    const setting = item.dataset.setting;
    
    switch (setting) {
      case "theme":
        cycleTheme();
        break;
        
      case "scan-speed":
        cycleScanSpeed();
        break;
        
      case "voice":
        cycleVoice();
        break;
        
      case "highlight":
        cycleHighlightColor();
        break;
        
      case "tts-toggle":
        toggleTTS();
        break;
        
      case "auto-scan":
        toggleAutoScan();
        break;
        
      case "volume-up":
        adjustVolume("up");
        break;
        
      case "volume-down":
        adjustVolume("down");
        break;
        
      case "close":
        closeSettings();
        speak("settings closed");
        break;
    }
  }

  async function adjustVolume(direction) {
    try {
      // Use Electron API for volume control
      if (window.electronAPI && window.electronAPI.system) {
        let result;
        if (direction === "up") {
          result = await window.electronAPI.system.volumeUp();
        } else {
          result = await window.electronAPI.system.volumeDown();
        }
        
        if (result && result.success) {
          console.log('Volume adjusted:', direction);
          speak(direction === "up" ? "volume up" : "volume down");
        } else {
          console.error('Failed to control volume');
          speak("volume control failed");
        }
      } else {
        console.error('Electron API not available for volume control');
        speak("volume control not available");
      }
    } catch (error) {
      console.error('Error controlling volume:', error);
      speak("volume control error");
    }
  }

  function cycleTheme() {
    currentThemeIndex = (currentThemeIndex + 1) % themes.length;
    const newTheme = themes[currentThemeIndex];
    applyTheme(newTheme);
    speak(newTheme);
  }

  function updateThemeDisplay() {
    const themeValue = $("#themeValue");
    if (themeValue) {
      themeValue.textContent = themes[currentThemeIndex];
    }
  }

  function cycleScanSpeed() {
    if (window.NarbeScanManager) {
        window.NarbeScanManager.cycleScanSpeed();
        // Update is handled by subscription
        const speed = getScanInterval();
        speak(`scan speed ${speed/1000} seconds`);
    } else {
        // Fallback if manager missing
        const speeds = ["slow", "medium", "fast"];
        const currentIndex = speeds.indexOf(currentScanSpeed);
        const nextIndex = (currentIndex + 1) % speeds.length;
        currentScanSpeed = speeds[nextIndex];
        
        settings.scanSpeed = currentScanSpeed;
        saveSettings();
        updateScanSpeedDisplay();
        speak(currentScanSpeed);
        
        if (isAutoScanning) {
          stopAutoScan();
          startAutoScan();
        }
    }
  }

  function updateScanSpeedDisplay() {
    const speedValue = $("#scanSpeedValue");
    if (speedValue) {
      if (window.NarbeScanManager) {
          const names = ["Fast (1s)", "Medium (2s)", "Slow (3s)", "Extra Slow (4s)"];
          const idx = window.NarbeScanManager.getSettings().scanSpeedIndex;
          speedValue.textContent = names[idx] || "Medium (2s)";
      } else {
        speedValue.textContent = "Medium";
      }
    }
  }

  function cycleVoice() {
    // Check if voices are loaded using shared manager API
    if (window.NarbeVoiceManager && window.NarbeVoiceManager.areVoicesLoaded && !window.NarbeVoiceManager.areVoicesLoaded()) {
      if (window.NarbeVoiceManager.waitForVoices) {
          window.NarbeVoiceManager.waitForVoices().then(() => {
            updateVoiceDisplay();
          });
      }
      speak("initializing voices");
      return;
    }
    
    // Cycle voice using shared manager
    if (window.NarbeVoiceManager && window.NarbeVoiceManager.cycleVoice) {
        const voiceChanged = window.NarbeVoiceManager.cycleVoice();
        if (voiceChanged) {
            updateVoiceDisplay();
            const currentVoice = window.NarbeVoiceManager.getCurrentVoice();
            const displayName = window.NarbeVoiceManager.getVoiceDisplayName(currentVoice);
            speak(`voice changed to ${displayName}`);
        } else {
             speak("refreshing voice list");
        }
    }
  }

  function updateVoiceDisplay() {
    const voiceValue = $("#voiceValue");
    if (voiceValue && window.NarbeVoiceManager) {
      const currentVoice = window.NarbeVoiceManager.getCurrentVoice();
      const displayName = window.NarbeVoiceManager.getVoiceDisplayName(currentVoice);
      voiceValue.textContent = displayName;
    }
  }

  function cycleHighlightColor() {
    currentHighlightIndex = (currentHighlightIndex + 1) % highlightColors.length;
    const newColor = highlightColors[currentHighlightIndex];
    applyHighlightColor(newColor);
    speak(newColor);
  }

  function updateHighlightDisplay() {
    const highlightValue = $("#highlightValue");
    if (highlightValue) {
      const colorName = highlightColors[currentHighlightIndex];
      highlightValue.textContent = colorName.charAt(0).toUpperCase() + colorName.slice(1);
    }
  }

  function toggleTTS() {
    const ttsEnabled = window.NarbeVoiceManager.toggleTTS();
    updateTTSToggleDisplay();
    speak(ttsEnabled ? "TTS enabled" : "TTS disabled");
  }

  function updateTTSToggleDisplay() {
    const ttsValue = $("#ttsToggleValue");
    if (ttsValue) {
      const voiceSettings = window.NarbeVoiceManager.getSettings();
      ttsValue.textContent = voiceSettings.ttsEnabled ? "On" : "Off";
    }
  }

  function toggleAutoScan() {
    isAutoScanning = !isAutoScanning;
    settings.autoScan = isAutoScanning;
    saveSettings();
    updateAutoScanDisplay();
    speak(isAutoScanning ? "Auto Scan enabled" : "Auto Scan disabled");
    
    if (isAutoScanning) {
      startAutoScan();
    } else {
      stopAutoScan();
    }
  }

  function updateAutoScanDisplay() {
    const autoScanValue = $("#autoScanValue");
    if (autoScanValue) {
      autoScanValue.textContent = isAutoScanning ? "On" : "Off";
    }
  }

  function startAutoScan() {
    if (autoScanInterval) return;
    
    // Use unified speed from manager
    const speed = getScanInterval();
    
    autoScanInterval = setInterval(() => {
      if (inSettingsMode) {
        scanSettingsForward();
      } else {
        scanForward();
      }
    }, speed);
  }

  function stopAutoScan() {
    if (autoScanInterval) {
      clearInterval(autoScanInterval);
      autoScanInterval = null;
    }
  }

  function readInstructions() {
    const instructions = `
      Welcome to Ben's Keyboard. Here are the instructions for using this keyboard.
      
      Navigation controls:
      Spacebar short press will advance forward through rows and buttons.
      Spacebar long hold will move backward through rows and buttons until released.
      
      Selection controls:
      Return key short press will select the highlighted item.
      Return key long press in button mode will return you to row selection mode.
      Return key long hold in row selection mode will jump directly to predictive text.
      
      The keyboard has several rows:
      First is the text bar where your typed text appears. Click or select it to hear your text read aloud.
      Second is the predictive text row with word suggestions.
      Third is the controls row with space, delete, clear, settings, and exit.
      Then letter rows A through Z and number rows 0 through 9.
      
      Tips:
      Saying the same text three times will save those words to your predictions for faster typing later.
      You can change themes, scan speed, voice, and highlight colors in settings.
      The TTS toggle controls whether items are read aloud as you navigate.
      The Auto Scan toggle enables automatic scanning through rows and buttons.
      
      Press return to continue using the keyboard.
    `;
    
    if (window.NarbeVoiceManager) {
      window.NarbeVoiceManager.cancel();
      window.NarbeVoiceManager.speak(instructions, { rate: 0.9 });
    }
  }

  function handleControl(key) {
    if (key === "Space") return insertKey(" ");
    if (key === "Del Letter") { setBuffer(buffer.slice(0, -1)); return; }
    if (key === "Del Word")   { setBuffer(buffer.trimEnd().replace(/\S+\s*$/, "")); return; }
    if (key === "Clear")      { setBuffer(""); return; }
    if (key === "Settings")   { 
      openSettings();
      return; 
    }
    if (key === "Exit")       { 
      console.log("Exit button pressed - closing Chrome");
      closeChrome();
      return; 
    }
  }

  async function closeChrome() {
      speak("exiting");
      // Since we are running in an iframe within Benny's Hub, we should communicate with the parent
      // to close this app (which just hides the iframe).
      try {
          window.parent.postMessage({ action: 'closeApp' }, '*');
      } catch (e) {
          console.error("Failed to post message to parent:", e);
          speak("error exiting");
      }
  }

  function insertKey(k) {
    // Auto-capitalize first letter of every word (start of buffer or after a space)
    if (k.length === 1 && /[a-zA-Z]/.test(k)) {
      const prev = buffer.replace('|', '').slice(-1);
      if (!prev || /\s/.test(prev)) k = k.toUpperCase();
    }

    if (k === " ") {
      const currentText = buffer.replace('|', '').trim();
      const words = currentText.split(' ');
      if (words.length > 0) {
        const lastWord = words[words.length - 1];
        if (lastWord && lastWord.length > 0 && window.predictionSystem) {
          try {
            window.predictionSystem.recordLocalWord(lastWord);
            console.log(`Auto-learned word: ${lastWord}`);
            
            if (words.length > 1) {
              const context = words.slice(0, -1).join(' ');
              window.predictionSystem.recordNgram(context, lastWord);
            }
          } catch (e) {
            console.error('Error recording word:', e);
          }
        }
      }
    }
    
    setBuffer(buffer + k);
  }

  function saveTextToPredictive(text) {
    console.log(`Text spoken 3 times via TTS - SAVING TO FILE: "${text}"`);
    const words = text.split(/\s+/).filter(word => word.trim().length > 0);
    
    // Save each word to file (this is the ONLY place words get saved to file)
    words.forEach((word, index) => {
      if (word && word.trim().length > 0 && window.predictionSystem) {
        try {
          const cleanWord = word.trim().toUpperCase();
          
          // Save the word to file with high priority (5 counts)
          for (let i = 0; i < 5; i++) {
            window.predictionSystem.saveWordToFile(cleanWord);
          }
          console.log(`[SAVED TO FILE] Word "${cleanWord}" with 5x priority`);
          
          // Learn letter n-grams from the word for letter predictions
          window.predictionSystem.recordLetterNgrams(cleanWord);
          
          // Save n-grams for context to file
          if (index > 0) {
            const context = words.slice(0, index).join(' ');
            for (let i = 0; i < 3; i++) {
              window.predictionSystem.saveNgramToFile(context, cleanWord);
            }
            console.log(`[SAVED TO FILE] N-gram: "${context}" -> "${cleanWord}" 3x`);
          }
        } catch (e) {
          console.error('Error saving word to file:', e);
        }
      }
    });
    
    // Force immediate re-render
    setTimeout(() => {
      renderPredictions();
      console.log('Predictions updated after TTS file save');
    }, 200);
  }

  textBar.addEventListener("click", () => {
    const text = buffer.replace(/\|/g, "").trim();
    if (text) {
      window.NarbeVoiceManager.speakProcessed(text);
      
      ttsUseCount++;
      console.log(`TTS use count: ${ttsUseCount} for text: "${text}"`);
      
      if (ttsUseCount >= 3) {
        console.log("3x TTS usage detected - recording words with high priority");
        saveTextToPredictive(text);
        ttsUseCount = 0;
      }
    }
  });

  const originalSetBuffer = setBuffer;
  setBuffer = function(newBuffer) {
    const wasLetterPredictRowHighlighted = (currentRowIndex === rows.length + 1 && inRowSelectionMode);
    const wasPredictiveRowHighlighted = (currentRowIndex === rows.length + 2 && inRowSelectionMode);
    
    originalSetBuffer(newBuffer);
    updatePredictiveButtons().then(() => {
      if (wasLetterPredictRowHighlighted) {
        setTimeout(() => {
          highlightLetterPredictRow();
        }, 50);
      } else if (wasPredictiveRowHighlighted) {
        setTimeout(() => {
          highlightPredictiveRow();
        }, 50);
      }
    });
  };

  function init() {
    console.log('Initializing keyboard...');
    
    // Wait for voice manager to load voices, then update display
    if (window.NarbeVoiceManager && window.NarbeVoiceManager.waitForVoices) {
      window.NarbeVoiceManager.waitForVoices().then(() => {
        console.log('Voice manager initialized with', window.NarbeVoiceManager.voices.length, 'voices');
        updateVoiceDisplay();
        updateTTSToggleDisplay();
      }).catch(e => {
        console.log('Voice manager error:', e);
        updateVoiceDisplay();
        updateTTSToggleDisplay();
      });
    } else {
      // Fallback if voice manager not available
      setTimeout(() => {
        updateVoiceDisplay();
        updateTTSToggleDisplay();
      }, 100);
    }
    
    // Listen for voice settings changes from other apps or voice manager
    if (window.NarbeVoiceManager && window.NarbeVoiceManager.onSettingsChange) {
      window.NarbeVoiceManager.onSettingsChange(() => {
        updateVoiceDisplay();
        updateTTSToggleDisplay();
      });
    }
    
    
    // Periodic voice validation handled by Shared Manager events
    // (setInterval removed as it used deprecated local methods)

    
    applyTheme(settings.theme);
    applyHighlightColor(settings.highlightColor || "yellow");
    currentScanSpeed = settings.scanSpeed || "medium";
    
    console.log('Rendering keyboard...');
    renderKeyboard();
    
    console.log('Setting initial buffer...');
    setBuffer("");
    
    // Wait for prediction system to initialize
    const initPredictions = () => {
      if (window.predictionSystem && window.predictionSystem.dataLoaded) {
        console.log('Prediction system ready, rendering predictions');
        renderPredictions();
      } else {
        console.log('Waiting for prediction system...');
        setTimeout(initPredictions, 100);
      }
    };
    
    setTimeout(initPredictions, 100);
    
    // Initialize settings click handlers (event delegation)
    initSettingsClickHandlers();
    
    if (settings.autoScan) {
      isAutoScanning = true;
      startAutoScan();
    }
    
    console.log('Keyboard initialization complete');
  }

  init();
})();
