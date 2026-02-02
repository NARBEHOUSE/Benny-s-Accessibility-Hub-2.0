// Prediction system for GitHub Pages using localStorage-first approach
class HybridPredictionSystem {
  constructor() {
    this.baseData = { frequent_words: {}, bigrams: {}, trigrams: {} };
    this.userData = { frequent_words: {}, bigrams: {}, trigrams: {} };
    this.mergedData = { frequent_words: {}, bigrams: {}, trigrams: {} };
    this.dataLoaded = false;
    this.initializeData();
  }

  async initializeData() {
    // Try to load user data from localStorage first
    this.loadUserData();
    
    // Load base data from GitHub
    await this.loadBaseData();
    
    // Merge the data
    this.mergeData();
    
    this.dataLoaded = true;
  }

  loadUserData() {
    try {
      const stored = localStorage.getItem('userKeyboardData');
      if (stored) {
        this.userData = JSON.parse(stored);
        console.log(`Loaded user data from localStorage: ${Object.keys(this.userData.frequent_words || {}).length} words`);
      }
    } catch (error) {
      console.error('Error loading user data from localStorage:', error);
      this.userData = { frequent_words: {}, bigrams: {}, trigrams: {} };
    }
  }

  async loadBaseData() {
    try {
      // Check if we have a cached version in localStorage
      const cachedBase = localStorage.getItem('baseKeyboardData');
      const cacheTime = localStorage.getItem('baseKeyboardDataTime');
      const ONE_DAY = 24 * 60 * 60 * 1000;
      
      // Use cache if it's less than a day old
      if (cachedBase && cacheTime && (Date.now() - parseInt(cacheTime)) < ONE_DAY) {
        this.baseData = JSON.parse(cachedBase);
        console.log('Using cached base data from localStorage');
      } else {
        // Fetch fresh data from GitHub
        const response = await fetch('./web_keyboard_predictions.json');
        if (response.ok) {
          this.baseData = await response.json();
          // Cache the base data
          localStorage.setItem('baseKeyboardData', JSON.stringify(this.baseData));
          localStorage.setItem('baseKeyboardDataTime', Date.now().toString());
          console.log(`Loaded fresh base data: ${Object.keys(this.baseData.frequent_words || {}).length} words`);
        }
      }
    } catch (error) {
      console.error('Error loading base data:', error);
      // Fall back to cached data if available
      const cachedBase = localStorage.getItem('baseKeyboardData');
      if (cachedBase) {
        this.baseData = JSON.parse(cachedBase);
        console.log('Using cached base data due to fetch error');
      }
    }
  }

  mergeData() {
    // Create a merged dataset that prioritizes user data
    this.mergedData = {
      frequent_words: { ...this.baseData.frequent_words },
      bigrams: { ...this.baseData.bigrams },
      trigrams: { ...this.baseData.trigrams }
    };
    
    // Merge user's frequent words with higher weight
    for (const [word, userData] of Object.entries(this.userData.frequent_words || {})) {
      if (this.mergedData.frequent_words[word]) {
        // Combine counts, giving user data 3x weight
        const baseCount = this.mergedData.frequent_words[word].count || 0;
        const userCount = (userData.count || 0) * 3;
        this.mergedData.frequent_words[word] = {
          count: baseCount + userCount,
          last_used: userData.last_used || this.mergedData.frequent_words[word].last_used,
          user_count: userData.count || 0
        };
      } else {
        // New word from user
        this.mergedData.frequent_words[word] = {
          ...userData,
          count: (userData.count || 0) * 3,
          user_count: userData.count || 0
        };
      }
    }
    
    // Merge bigrams with user priority
    for (const [bigram, userData] of Object.entries(this.userData.bigrams || {})) {
      if (this.mergedData.bigrams[bigram]) {
        const baseCount = this.mergedData.bigrams[bigram].count || 0;
        const userCount = (userData.count || 0) * 3;
        this.mergedData.bigrams[bigram] = {
          count: baseCount + userCount,
          last_used: userData.last_used || this.mergedData.bigrams[bigram].last_used,
          user_count: userData.count || 0
        };
      } else {
        this.mergedData.bigrams[bigram] = {
          ...userData,
          count: (userData.count || 0) * 3,
          user_count: userData.count || 0
        };
      }
    }
    
    // Merge trigrams with user priority
    for (const [trigram, userData] of Object.entries(this.userData.trigrams || {})) {
      if (this.mergedData.trigrams[trigram]) {
        const baseCount = this.mergedData.trigrams[trigram].count || 0;
        const userCount = (userData.count || 0) * 3;
        this.mergedData.trigrams[trigram] = {
          count: baseCount + userCount,
          last_used: userData.last_used || this.mergedData.trigrams[trigram].last_used,
          user_count: userData.count || 0
        };
      } else {
        this.mergedData.trigrams[trigram] = {
          ...userData,
          count: (userData.count || 0) * 3,
          user_count: userData.count || 0
        };
      }
    }
    
    console.log(`Merged data: ${Object.keys(this.mergedData.frequent_words).length} words, ${Object.keys(this.mergedData.bigrams).length} bigrams, ${Object.keys(this.mergedData.trigrams).length} trigrams`);
  }

  calculateScore(data, isUserData = false) {
    // Calculate a score based on frequency and recency
    const count = data.count || 0;
    const userCount = data.user_count || 0;
    const lastUsed = data.last_used ? new Date(data.last_used) : new Date(0);
    const daysSinceUse = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);
    
    // Recency boost: more recent = higher score
    const recencyMultiplier = Math.max(0.5, 1 - (daysSinceUse / 365));
    
    // User data gets MASSIVE weight - increase from 5x to 100x for absolute priority
    const userMultiplier = userCount > 0 ? 100 : 1;
    
    return count * recencyMultiplier * userMultiplier;
  }

  async getHybridPredictions(buffer) {
    // Use mergedData instead of webData
    const hasTrailingSpace = buffer.replace('|', '').endsWith(' ');
    const cleaned = buffer.toUpperCase().replace('|', '').trim();
    const words = cleaned ? cleaned.split(' ') : [];
    
    console.log(`DEBUG: Buffer: '${buffer}', Cleaned: '${cleaned}', Has trailing space: ${hasTrailingSpace}`);
    
    const DEFAULT_WORDS = ["YES", "NO", "HELP", "THE", "I", "YOU"];
    
    if (!words.length) {
      return DEFAULT_WORDS;
    }
    
    let context = '';
    let currentWord = '';
    
    if (hasTrailingSpace) {
      context = cleaned;
      currentWord = '';
    } else {
      currentWord = words[words.length - 1];
      context = words.slice(0, -1).join(' ');
    }
    
    console.log(`DEBUG: Context: '${context}', Current word: '${currentWord}'`);
    
    // TIER 1: N-gram predictions from merged data
    const predictionsNgram = {};
    
    if (context && (hasTrailingSpace || context !== currentWord)) {
      const ctxWords = context.split(' ');
      
      // Trigrams - highest priority
      if (ctxWords.length >= 2) {
        const triCtx = ctxWords.slice(-2).join(' ');
        
        for (const [key, data] of Object.entries(this.mergedData.trigrams || {})) {
          const trigramParts = key.split(' ');
          if (trigramParts.length === 3) {
            const trigramContext = trigramParts.slice(0, 2).join(' ');
            const nextWord = trigramParts[2];
            
            if (trigramContext === triCtx) {
              if ((!currentWord || nextWord.startsWith(currentWord)) && nextWord.length >= 2) {
                const score = this.calculateScore(data) * 10000000;
                predictionsNgram[nextWord] = (predictionsNgram[nextWord] || 0) + score;
              }
            }
          }
        }
      }
      
      // Bigrams - medium priority  
      if (ctxWords.length >= 1) {
        const biCtx = ctxWords[ctxWords.length - 1];
        
        for (const [key, data] of Object.entries(this.mergedData.bigrams || {})) {
          if (key.startsWith(biCtx + ' ')) {
            const nextWord = key.split(' ').pop();
            if ((!currentWord || nextWord.startsWith(currentWord)) && nextWord.length >= 2) {
              const score = this.calculateScore(data) * 500000;
              predictionsNgram[nextWord] = (predictionsNgram[nextWord] || 0) + score;
            }
          }
        }
      }
    }
    
    // TIER 2: Frequent word completions (for partial words)
    const predictionsFreq = {};
    if (currentWord && currentWord.length >= 1) {
      console.log(`DEBUG: Checking word completions for: '${currentWord}'`);
      
      // Check ALL words in merged data (which includes user data with high priority)
      for (const [word, data] of Object.entries(this.mergedData.frequent_words || {})) {
        // Check if word starts with the current partial word
        if (word.startsWith(currentWord) && word !== currentWord && word.length >= 2) {
          // Calculate score with user data getting massive boost
          const score = this.calculateScore(data) * 100000;
          predictionsFreq[word] = score;
          
          // Special logging for user words
          if (data.user_count && data.user_count > 0) {
            console.log(`DEBUG: Found USER word completion: ${word} (user_count: ${data.user_count}, score: ${score})`);
          }
        }
      }
      
      console.log(`DEBUG: Total freq predictions found: ${Object.keys(predictionsFreq).length}`);
    }
    
    // TIER 3: Most frequent words (when after a space with no partial word)
    const predictionsCommon = {};
    if (hasTrailingSpace && !currentWord) {
      // Sort frequent words by score (frequency + recency)
      const sortedWords = Object.entries(this.mergedData.frequent_words || {})
        .filter(([word, data]) => word.length >= 2)
        .map(([word, data]) => [word, this.calculateScore(data)])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20);
      
      for (const [word, score] of sortedWords) {
        predictionsCommon[word] = score * 10000;
      }
    }
    
    // Combine all predictions
    let finalPredictions = [];
    
    // First add n-gram predictions (highest priority)
    const sortedNgrams = Object.entries(predictionsNgram)
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);
    finalPredictions.push(...sortedNgrams);
    
    // Then add frequency-based completions
    if (finalPredictions.length < 6) {
      const sortedFreq = Object.entries(predictionsFreq)
        .sort((a, b) => b[1] - a[1])
        .map(([word]) => word);
      
      for (const word of sortedFreq) {
        if (!finalPredictions.includes(word)) {
          finalPredictions.push(word);
          if (finalPredictions.length >= 6) break;
        }
      }
    }
    
    // Then add common words
    if (finalPredictions.length < 6) {
      const sortedCommon = Object.entries(predictionsCommon)
        .sort((a, b) => b[1] - a[1])
        .map(([word]) => word);
      
      for (const word of sortedCommon) {
        if (!finalPredictions.includes(word)) {
          finalPredictions.push(word);
          if (finalPredictions.length >= 6) break;
        }
      }
    }
    
    // Finally, add default words if still need more
    for (const word of DEFAULT_WORDS) {
      if (finalPredictions.length >= 6) break;
      if (!finalPredictions.includes(word)) {
        // If we're typing a partial word, only show defaults that match
        if (currentWord) {
          if (word.startsWith(currentWord)) {
            finalPredictions.push(word);
          }
        } else {
          finalPredictions.push(word);
        }
      }
    }
    
    // Ensure we always return 6 predictions (empty strings if needed)
    while (finalPredictions.length < 6) {
      finalPredictions.push('');
    }
    
    console.log(`DEBUG: Final predictions: ${finalPredictions.slice(0, 6)}`);
    return finalPredictions.slice(0, 6);
  }

  recordLocalWord(word) {
    try {
      const upperWord = word.toUpperCase();
      const timestamp = new Date().toISOString();
      
      // Update user data
      if (!this.userData.frequent_words) {
        this.userData.frequent_words = {};
      }
      
      if (!this.userData.frequent_words[upperWord]) {
        this.userData.frequent_words[upperWord] = { count: 0, last_used: timestamp };
      }
      this.userData.frequent_words[upperWord].count++;
      this.userData.frequent_words[upperWord].last_used = timestamp;
      
      console.log(`Recorded word "${upperWord}" to userData - count: ${this.userData.frequent_words[upperWord].count}`);
      console.log('Current userData words:', Object.keys(this.userData.frequent_words));
      
      // Save to localStorage IMMEDIATELY
      this.saveUserData();
      
      // Re-merge data to reflect changes immediately
      this.mergeData();
      
      // Force verify the word is in merged data
      if (this.mergedData.frequent_words[upperWord]) {
        console.log(`Verified: ${upperWord} is now in mergedData with user_count: ${this.mergedData.frequent_words[upperWord].user_count}`);
      } else {
        console.error(`ERROR: ${upperWord} failed to merge into mergedData!`);
      }
    } catch (error) {
      console.error('Error recording word:', error);
    }
  }

  recordNgram(context, nextWord) {
    try {
      const ctxWords = context.toUpperCase().split(' ').filter(w => w);
      const nextUpper = nextWord.toUpperCase();
      const timestamp = new Date().toISOString();
      
      // Record bigram in user data
      if (ctxWords.length >= 1) {
        const bigramKey = `${ctxWords[ctxWords.length - 1]} ${nextUpper}`;
        if (!this.userData.bigrams[bigramKey]) {
          this.userData.bigrams[bigramKey] = { count: 0, last_used: timestamp };
        }
        this.userData.bigrams[bigramKey].count++;
        this.userData.bigrams[bigramKey].last_used = timestamp;
      }
      
      // Record trigram in user data
      if (ctxWords.length >= 2) {
        const trigramKey = `${ctxWords.slice(-2).join(' ')} ${nextUpper}`;
        if (!this.userData.trigrams[trigramKey]) {
          this.userData.trigrams[trigramKey] = { count: 0, last_used: timestamp };
        }
        this.userData.trigrams[trigramKey].count++;
        this.userData.trigrams[trigramKey].last_used = timestamp;
      }
      
      // Save to localStorage
      this.saveUserData();
      
      // Re-merge data
      this.mergeData();
    } catch (error) {
      console.error('Error recording ngram:', error);
    }
  }

  saveUserData() {
    try {
      // Clean up old entries (optional: remove items not used in 90 days)
      const THREE_MONTHS = 90 * 24 * 60 * 60 * 1000;
      const now = Date.now();
      
      // Clean old words with very low counts
      for (const [word, data] of Object.entries(this.userData.frequent_words)) {
        if (data.last_used) {
          const lastUsed = new Date(data.last_used).getTime();
          if (now - lastUsed > THREE_MONTHS && (data.count || 0) < 3) {
            delete this.userData.frequent_words[word];
          }
        }
      }
      
      // Save to localStorage
      localStorage.setItem('userKeyboardData', JSON.stringify(this.userData));
      console.log('Saved user data to localStorage');
    } catch (error) {
      console.error('Error saving user data:', error);
    }
  }

  // Method to export user data (for backup)
  exportUserData() {
    return JSON.stringify(this.userData, null, 2);
  }

  // Method to import user data (for restore)
  importUserData(jsonString) {
    try {
      const imported = JSON.parse(jsonString);
      this.userData = imported;
      this.saveUserData();
      this.mergeData();
      console.log('User data imported successfully');
    } catch (error) {
      console.error('Error importing user data:', error);
    }
  }

  // Method to clear user data
  clearUserData() {
    this.userData = { frequent_words: {}, bigrams: {}, trigrams: {} };
    localStorage.removeItem('userKeyboardData');
    this.mergeData();
    console.log('User data cleared');
  }

  // Method to clear cache (alias for clearUserData for the Clear Cache button)
  clearCache() {
    this.clearUserData();
  }

  // Method to debug what's in storage
  debugStorage() {
    console.log('=== DEBUG STORAGE ===');
    console.log('User Data Words:', Object.keys(this.userData.frequent_words || {}));
    console.log('User Data Details:', this.userData.frequent_words);
    console.log('Merged Data has', Object.keys(this.mergedData.frequent_words || {}).length, 'words');
    
    // Check if ARIANNA is in any dataset
    const checkWord = 'ARIANNA';
    console.log(`Checking for ${checkWord}:`);
    console.log('- In userData?', checkWord in (this.userData.frequent_words || {}));
    console.log('- In baseData?', checkWord in (this.baseData.frequent_words || {}));
    console.log('- In mergedData?', checkWord in (this.mergedData.frequent_words || {}));
    
    if (this.userData.frequent_words && this.userData.frequent_words[checkWord]) {
      console.log(`- userData[${checkWord}]:`, this.userData.frequent_words[checkWord]);
    }
    if (this.mergedData.frequent_words && this.mergedData.frequent_words[checkWord]) {
      console.log(`- mergedData[${checkWord}]:`, this.mergedData.frequent_words[checkWord]);
    }
    
    // Also check localStorage directly
    const storedData = localStorage.getItem('userKeyboardData');
    if (storedData) {
      const parsed = JSON.parse(storedData);
      console.log('localStorage userKeyboardData:', parsed);
    } else {
      console.log('No userKeyboardData in localStorage');
    }
    
    return '=== END DEBUG ===';
  }
}

// Create global instance
window.predictionSystem = new HybridPredictionSystem();

// Add debug command for console
window.debugKeyboard = () => window.predictionSystem.debugStorage();