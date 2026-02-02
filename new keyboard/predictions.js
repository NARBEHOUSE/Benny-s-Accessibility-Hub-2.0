// Prediction system for server-based keyboard
class PredictionSystem {
  constructor() {
    // Single source of truth - direct from server
    this.data = { frequent_words: {}, bigrams: {}, trigrams: {} };
    this.dataLoaded = false;
    this.initializeData();
  }

  async initializeData() {
    // Load ONLY from server
    await this.loadBaseData();
    this.dataLoaded = true;
  }

  async loadBaseData() {
    try {
      // Load from server endpoint
      const response = await fetch('/web_keyboard_predictions.json');
      if (response.ok) {
        this.data = await response.json();
        console.log(`Loaded base data from server: ${Object.keys(this.data.frequent_words || {}).length} words`);
      } else {
        console.log('No base data available from server, using empty data');
        this.data = { frequent_words: {}, bigrams: {}, trigrams: {} };
      }
    } catch (error) {
      console.error('Error loading base data from server:', error);
      this.data = { frequent_words: {}, bigrams: {}, trigrams: {} };
    }
  }

  calculateScore(data) {
    // Calculate a score based on frequency and recency
    const count = data.count || 0;
    const lastUsed = data.last_used ? new Date(data.last_used) : new Date(0);
    const daysSinceUse = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60 * 24);
    
    // Much stronger recency boost - prioritize recent words heavily
    let recencyMultiplier;
    if (daysSinceUse < 1) {
      recencyMultiplier = 1000; // Used today = 1000x boost
    } else if (daysSinceUse < 7) {
      recencyMultiplier = 100; // Used this week = 100x boost
    } else if (daysSinceUse < 30) {
      recencyMultiplier = 10; // Used this month = 10x boost
    } else if (daysSinceUse < 90) {
      recencyMultiplier = 1; // Used in last 3 months = normal
    } else {
      recencyMultiplier = 0.1; // Older = 10x penalty
    }
    
    return count * recencyMultiplier;
  }

  async getHybridPredictions(buffer) {
    // KEPT NAME 'getHybridPredictions' FOR COMPATIBILITY with app.js
    
    const hasTrailingSpace = buffer.replace('|', '').endsWith(' ');
    const cleaned = buffer.toUpperCase().replace('|', '').trim();
    const words = cleaned ? cleaned.split(' ') : [];
    
    // Default words fallback
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
    
    // Create a set of words already in the buffer to avoid duplicates
    const existingWords = new Set(words.map(w => w.toUpperCase()));
    
    let finalPredictions = [];
    
    // Helper function to check if a word should be excluded
    const shouldExcludeWord = (word) => {
      const upperWord = word.toUpperCase();
      // Exclude if the word is already in the buffer (unless we're typing it partially)
      if (hasTrailingSpace && existingWords.has(upperWord)) {
        return true;
      }
      return false;
    };
    
    // PRIORITY 1: N-gram predictions
    const predictionsNgram = {};
    
    if (context) {
      const ctxWords = context.split(' ');
      
      // Trigrams - highest priority
      if (ctxWords.length >= 2) {
        const triCtx = ctxWords.slice(-2).join(' ');
        
        for (const [key, data] of Object.entries(this.data.trigrams || {})) {
          const trigramParts = key.split(' ');
          if (trigramParts.length === 3) {
            const trigramContext = trigramParts.slice(0, 2).join(' ');
            const nextWord = trigramParts[2];
            
            if (trigramContext === triCtx) {
              if ((!currentWord || nextWord.startsWith(currentWord)) && !shouldExcludeWord(nextWord)) {
                const score = this.calculateScore(data) * 100; // Boost trigrams
                predictionsNgram[nextWord] = (predictionsNgram[nextWord] || 0) + score;
              }
            }
          }
        }
      }
      
      // Also check 2-word key match (rare but possible in old data format)
      if (ctxWords.length === 2 && hasTrailingSpace) {
        const exactContext = ctxWords.join(' ');
        for (const [key, data] of Object.entries(this.data.trigrams || {})) {
          if (key.startsWith(exactContext + ' ')) {
            const nextWord = key.split(' ').pop();
            if (nextWord && !shouldExcludeWord(nextWord)) {
              const score = this.calculateScore(data) * 100;
              predictionsNgram[nextWord] = (predictionsNgram[nextWord] || 0) + score;
            }
          }
        }
      }
      
      // Bigrams - medium priority  
      if (ctxWords.length >= 1) {
        const biCtx = ctxWords[ctxWords.length - 1];
        
        for (const [key, data] of Object.entries(this.data.bigrams || {})) {
          // Check for "WORD NEXTWORD" format
          if (key.startsWith(biCtx + ' ')) {
            const parts = key.split(' ');
            // Ensure strict bigram match (must have exactly 2 parts)
            if (parts.length === 2 && parts[0] === biCtx) {
                const nextWord = parts[1];
                if ((!currentWord || nextWord.startsWith(currentWord)) && !shouldExcludeWord(nextWord)) {
                  const score = this.calculateScore(data) * 50; // Boost bigrams
                  predictionsNgram[nextWord] = (predictionsNgram[nextWord] || 0) + score;
                }
            }
          }
        }
      }
    }
    
    // Add N-gram predictions
    const sortedNgrams = Object.entries(predictionsNgram)
      .sort((a, b) => b[1] - a[1])
      .map(([word]) => word);
    
    for (const word of sortedNgrams) {
      if (finalPredictions.length < 6 && !finalPredictions.includes(word)) {
        finalPredictions.push(word);
      }
    }
    
    // PRIORITY 2: Frequent word completions (for partial words)
    if (currentWord && currentWord.length >= 1 && finalPredictions.length < 6) {
      const otherMatches = Object.entries(this.data.frequent_words || {})
        .filter(([word, data]) => {
          return word.startsWith(currentWord) && 
                 word !== currentWord && 
                 !finalPredictions.includes(word) &&
                 !shouldExcludeWord(word);
        })
        .map(([word, data]) => ({ word, score: this.calculateScore(data) }))
        .sort((a, b) => b.score - a.score);
      
      for (const match of otherMatches) {
        if (finalPredictions.length < 6) {
          finalPredictions.push(match.word);
        }
      }
    }
    
    // PRIORITY 3: Most frequent words (when after a space with no partial word)
    if (hasTrailingSpace && !currentWord && finalPredictions.length < 6) {
      const sortedWords = Object.entries(this.data.frequent_words || {})
        .filter(([word, data]) => !finalPredictions.includes(word) && !shouldExcludeWord(word))
        .map(([word, data]) => ({ word, score: this.calculateScore(data) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 20);
      
      for (const match of sortedWords) {
        if (finalPredictions.length < 6) {
          finalPredictions.push(match.word);
        }
      }
    }
    
    // PRIORITY 4: Add default words
    for (const word of DEFAULT_WORDS) {
      if (finalPredictions.length >= 6) break;
      if (!finalPredictions.includes(word) && !shouldExcludeWord(word)) {
        if (currentWord) {
          if (word.startsWith(currentWord)) {
            finalPredictions.push(word);
          }
        } else {
          finalPredictions.push(word);
        }
      }
    }
    
    // Fill remaining slots with empty strings
    while (finalPredictions.length < 6) {
      finalPredictions.push('');
    }
    
    return finalPredictions.slice(0, 6);
  }

  async recordLocalWord(word) {
    try {
      const upperWord = word.toUpperCase();
      const timestamp = new Date().toISOString();
      
      // Update local memory data immediately so we see the change
      if (!this.data.frequent_words[upperWord]) {
        this.data.frequent_words[upperWord] = { count: 0, last_used: timestamp };
      }
      this.data.frequent_words[upperWord].count++;
      this.data.frequent_words[upperWord].last_used = timestamp;
      
      // Save directly to server
      await this.saveToServer(upperWord, timestamp);
    } catch (error) {
      console.error('Error recording word:', error);
    }
  }

  async recordNgram(context, nextWord) {
    try {
      let ctxWords = context.toUpperCase().split(' ').filter(w => w);
      const nextUpper = nextWord.toUpperCase();
      const timestamp = new Date().toISOString();

      // FIX FOR APP.JS BUG:
      // If the context ends with the word we are recording, it means the buffer 
      // was already updated before context was extracted. We must remove it.
      if (ctxWords.length > 0 && ctxWords[ctxWords.length - 1] === nextUpper) {
        console.log(`Correcting context: Removed trailing "${nextUpper}" from context "${ctxWords.join(' ')}"`);
        ctxWords.pop();
      }
      
      // Update local memory data
      if (ctxWords.length >= 1) {
        const bigramKey = `${ctxWords[ctxWords.length - 1]} ${nextUpper}`;
        if (!this.data.bigrams[bigramKey]) {
          this.data.bigrams[bigramKey] = { count: 0, last_used: timestamp };
        }
        this.data.bigrams[bigramKey].count++;
        this.data.bigrams[bigramKey].last_used = timestamp;
      }
      
      if (ctxWords.length >= 2) {
        const trigramKey = `${ctxWords.slice(-2).join(' ')} ${nextUpper}`;
        if (!this.data.trigrams[trigramKey]) {
          this.data.trigrams[trigramKey] = { count: 0, last_used: timestamp };
        }
        this.data.trigrams[trigramKey].count++;
        this.data.trigrams[trigramKey].last_used = timestamp;
      }
      
      // Save to server using the CORRECTED context
      const cleanContext = ctxWords.join(' ');
      if (cleanContext) {
        await this.saveNgramToServer(cleanContext, nextWord, timestamp);
      }
    } catch (error) {
      console.error('Error recording ngram:', error);
    }
  }

  async saveToServer(word, timestamp) {
    try {
      await fetch('/api/save_prediction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, timestamp })
      });
    } catch (error) {
      console.error('Error saving to server:', error);
    }
  }

  async saveNgramToServer(context, nextWord, timestamp) {
    try {
      await fetch('/api/save_ngram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, next_word: nextWord, timestamp })
      });
    } catch (error) {
      console.error('Error saving n-gram to server:', error);
    }
  }
  
  // Debug method
  debugStorage() {
    console.log('=== DEBUG DATA ===');
    console.log(`Loaded ${Object.keys(this.data.frequent_words || {}).length} words.`);
    console.log(`Loaded ${Object.keys(this.data.bigrams || {}).length} bigrams.`);
    console.log(`Loaded ${Object.keys(this.data.trigrams || {}).length} trigrams.`);
    return '=== END DEBUG ===';
  }
}

// Create global instance
window.predictionSystem = new PredictionSystem();

// Add debug command for console
window.debugKeyboard = () => window.predictionSystem.debugStorage();