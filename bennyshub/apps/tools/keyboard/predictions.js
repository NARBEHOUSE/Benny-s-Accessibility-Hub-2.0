// Prediction system for keyboard
// Supports both Electron (via electronAPI) and standalone server mode

class PredictionSystem {
  constructor() {
    // Single source of truth
    this.data = { frequent_words: {}, bigrams: {}, trigrams: {} };
    // Letter n-grams for letter prediction
    this.letterData = { unigrams: {}, bigrams: {}, trigrams: {} };
    this.dataLoaded = false;
    this.isElectron = typeof window !== 'undefined' && window.electronAPI;
    this.initializeData();
    this.initializeLetterFrequencies();
  }

  // Initialize default English letter frequencies
  initializeLetterFrequencies() {
    // Default English letter frequencies (as starting point)
    const defaultFrequencies = {
      'E': 127, 'T': 91, 'A': 82, 'O': 75, 'I': 70,
      'N': 67, 'S': 63, 'H': 61, 'R': 60, 'D': 43,
      'L': 40, 'C': 28, 'U': 28, 'M': 24, 'W': 24,
      'F': 22, 'G': 20, 'Y': 20, 'P': 19, 'B': 15,
      'V': 10, 'K': 8, 'J': 2, 'X': 2, 'Q': 1, 'Z': 1
    };
    
    // Common letter bigrams
    const commonBigrams = {
      'TH': 100, 'HE': 95, 'IN': 90, 'ER': 85, 'AN': 80,
      'RE': 75, 'ON': 70, 'AT': 65, 'EN': 60, 'ND': 55,
      'TI': 50, 'ES': 48, 'OR': 46, 'TE': 44, 'OF': 42,
      'ED': 40, 'IS': 38, 'IT': 36, 'AL': 34, 'AR': 32,
      'ST': 30, 'TO': 28, 'NT': 26, 'NG': 24, 'SE': 22,
      'HA': 20, 'AS': 18, 'OU': 16, 'IO': 14, 'LE': 12,
      'VE': 10, 'CO': 9, 'ME': 8, 'DE': 7, 'HI': 6
    };
    
    // Common letter trigrams
    const commonTrigrams = {
      'THE': 100, 'AND': 90, 'ING': 85, 'ION': 80, 'TIO': 75,
      'ENT': 70, 'ATI': 65, 'FOR': 60, 'HER': 55, 'TER': 50,
      'HAT': 48, 'THA': 46, 'ERE': 44, 'ATE': 42, 'HIS': 40,
      'CON': 38, 'RES': 36, 'VER': 34, 'ALL': 32, 'ONS': 30,
      'NCE': 28, 'MEN': 26, 'ITH': 24, 'TED': 22, 'ERS': 20
    };
    
    // Set defaults
    for (const [letter, count] of Object.entries(defaultFrequencies)) {
      this.letterData.unigrams[letter] = { count, last_used: new Date().toISOString() };
    }
    for (const [bigram, count] of Object.entries(commonBigrams)) {
      this.letterData.bigrams[bigram] = { count, last_used: new Date().toISOString() };
    }
    for (const [trigram, count] of Object.entries(commonTrigrams)) {
      this.letterData.trigrams[trigram] = { count, last_used: new Date().toISOString() };
    }
  }

  async initializeData() {
    await this.loadBaseData();
    this.dataLoaded = true;
  }

  async loadBaseData() {
    try {
      if (this.isElectron) {
        // Use Electron IPC
        this.data = await window.electronAPI.keyboard.getPredictions();
        console.log(`[Electron] Loaded predictions: ${Object.keys(this.data.frequent_words || {}).length} words`);
      } else {
        // Fallback to HTTP fetch (for testing outside Electron)
        const response = await fetch('/shared/predictive_ngrams.json');
        if (response.ok) {
          this.data = await response.json();
          console.log(`[HTTP] Loaded predictions: ${Object.keys(this.data.frequent_words || {}).length} words`);
        }
      }
    } catch (error) {
      console.error('Error loading predictions:', error);
      this.data = { frequent_words: {}, bigrams: {}, trigrams: {} };
    }
  }

  calculateScore(data) {
    // Calculate a score based on frequency and recency
    // PRIORITIZE RECENCY MORE STRONGLY - most recently used words should come first
    const count = data.count || 0;
    const lastUsed = data.last_used ? new Date(data.last_used) : new Date(0);
    const hoursSinceUse = (Date.now() - lastUsed.getTime()) / (1000 * 60 * 60);
    const daysSinceUse = hoursSinceUse / 24;
    
    // Much stronger recency boost - prioritize recent words heavily
    // Now uses finer time granularity to differentiate within same day
    let recencyMultiplier;
    if (hoursSinceUse < 0.5) {
      recencyMultiplier = 100000; // Used in last 30 minutes = 100,000x boost
    } else if (hoursSinceUse < 1) {
      recencyMultiplier = 50000; // Used in last hour = 50,000x boost  
    } else if (hoursSinceUse < 4) {
      recencyMultiplier = 20000; // Used in last 4 hours = 20,000x boost
    } else if (daysSinceUse < 1) {
      recencyMultiplier = 5000; // Used today (but over 4 hours ago) = 5,000x boost
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

  // Get letter predictions based on current typing context and word predictions
  getLetterPredictions(buffer, wordPredictions = []) {
    const cleaned = buffer.toUpperCase().replace('|', '');
    const hasTrailingSpace = cleaned.endsWith(' ');
    const trimmedCleaned = cleaned.trim();
    
    // Get the current partial word being typed
    const words = trimmedCleaned.split(' ').filter(w => w);
    const currentPartialWord = hasTrailingSpace ? '' : (words[words.length - 1] || '');
    
    console.log(`[LetterPredict] Buffer: "${cleaned}", hasTrailingSpace: ${hasTrailingSpace}, Partial word: "${currentPartialWord}"`);
    console.log(`[LetterPredict] Word predictions received:`, wordPredictions);
    
    // Default letter order (by frequency)
    const DEFAULT_LETTERS = ['E', 'T', 'A', 'O', 'I', 'N'];
    
    if (!currentPartialWord && hasTrailingSpace && words.length > 0) {
      // User has typed words and ended with a space - use bigram/trigram word predictions
      // Get the starting letters of the predicted next words
      console.log(`[LetterPredict] Using word predictions for next word start letters`);
      
      const letterScores = {};
      const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      
      // Initialize all letters with minimal base score
      for (const letter of allLetters) {
        letterScores[letter] = 1;
      }
      
      // Get starting letters from word predictions (these are the predicted next words)
      if (wordPredictions && wordPredictions.length > 0) {
        wordPredictions.forEach((word, index) => {
          const cleanWord = (word || '').toUpperCase().trim();
          if (cleanWord && cleanWord.length > 0) {
            const startLetter = cleanWord[0];
            // Higher priority for earlier predictions
            const priorityBoost = (6 - index) * 1000;
            letterScores[startLetter] = (letterScores[startLetter] || 0) + priorityBoost;
            console.log(`[LetterPredict] Word pred "${cleanWord}" -> start letter "${startLetter}" (boost: ${priorityBoost})`);
          }
        });
      }
      
      // Also boost common word starting letters from dictionary based on context
      const lastWord = words[words.length - 1] || '';
      const secondLastWord = words.length > 1 ? words[words.length - 2] : '';
      
      // Check bigrams: lastWord -> nextWord
      for (const [ngram, data] of Object.entries(this.data.ngrams || {})) {
        if (ngram.startsWith(lastWord + ' ')) {
          const nextWord = ngram.split(' ')[1];
          if (nextWord && nextWord.length > 0) {
            const startLetter = nextWord[0].toUpperCase();
            letterScores[startLetter] = (letterScores[startLetter] || 0) + (data.count * 50);
          }
        }
      }
      
      // Check trigrams: secondLastWord + lastWord -> nextWord
      if (secondLastWord) {
        const trigramPrefix = secondLastWord + ' ' + lastWord + ' ';
        for (const [ngram, data] of Object.entries(this.data.ngrams || {})) {
          if (ngram.startsWith(trigramPrefix)) {
            const nextWord = ngram.split(' ')[2];
            if (nextWord && nextWord.length > 0) {
              const startLetter = nextWord[0].toUpperCase();
              letterScores[startLetter] = (letterScores[startLetter] || 0) + (data.count * 100);
            }
          }
        }
      }
      
      // Sort by score and return top 6
      const sortedLetters = Object.entries(letterScores)
        .sort((a, b) => b[1] - a[1])
        .map(([letter]) => letter)
        .slice(0, 6);
      
      console.log(`[LetterPredict] Next word start letter scores:`, Object.entries(letterScores).sort((a,b) => b[1]-a[1]).slice(0,10));
      
      return sortedLetters;
    }
    
    if (!currentPartialWord) {
      // No word started yet and no context - return most common starting letters
      const startingLetters = ['T', 'A', 'I', 'S', 'W', 'H'];
      return startingLetters;
    }
    
    const letterScores = {};
    const allLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    
    // Initialize all letters with minimal base score
    for (const letter of allLetters) {
      letterScores[letter] = 1;
    }
    
    // HIGHEST PRIORITY: Letters from word predictions that match the partial word
    // This is the smartest source - if we're showing DOOR, DOG, etc, 
    // we should suggest O, G, etc. as next letters
    let hasWordPredictionMatches = false;
    if (wordPredictions && wordPredictions.length > 0) {
      const partialLen = currentPartialWord.length;
      
      wordPredictions.forEach((word, index) => {
        // Clean the word prediction
        const cleanWord = (word || '').toUpperCase().trim();
        if (cleanWord && cleanWord.length > partialLen && cleanWord.startsWith(currentPartialWord)) {
          hasWordPredictionMatches = true;
          const nextLetter = cleanWord[partialLen];
          // Higher priority for earlier predictions (index 0 = most likely word)
          const priorityBoost = (6 - index) * 1000; // Increased boost
          letterScores[nextLetter] = (letterScores[nextLetter] || 0) + priorityBoost;
          console.log(`[LetterPredict] Word "${cleanWord}" -> next letter "${nextLetter}" (boost: ${priorityBoost})`);
        } else {
          console.log(`[LetterPredict] Word "${cleanWord}" did NOT match partial "${currentPartialWord}"`);
        }
      });
    }
    
    console.log(`[LetterPredict] hasWordPredictionMatches: ${hasWordPredictionMatches}`);
    
    // PRIORITY 2: ALWAYS look at frequent_words that start with the partial word
    // This catches words not in the top 6 predictions (like LUCK when L is typed)
    const partialLen = currentPartialWord.length;
    for (const [word, data] of Object.entries(this.data.frequent_words || {})) {
      if (word.length > partialLen && word.startsWith(currentPartialWord)) {
        const nextLetter = word[partialLen];
        const score = this.calculateScore(data) * 100; // Good boost for dictionary words
        letterScores[nextLetter] = (letterScores[nextLetter] || 0) + score;
      }
    }
    
    // PRIORITY 3: Trigrams within the CURRENT WORD (not whole buffer) - lower priority
    if (currentPartialWord.length >= 2) {
      const last2 = currentPartialWord.slice(-2);
      for (const [trigram, data] of Object.entries(this.letterData.trigrams)) {
        if (trigram.startsWith(last2) && trigram.length === 3) {
          const nextLetter = trigram[2];
          letterScores[nextLetter] = (letterScores[nextLetter] || 0) + (data.count * 2);
        }
      }
    }
    
    // PRIORITY 4: Bigrams within the CURRENT WORD (not whole buffer) - lowest priority
    if (currentPartialWord.length >= 1) {
      const last1 = currentPartialWord.slice(-1);
      for (const [bigram, data] of Object.entries(this.letterData.bigrams)) {
        if (bigram.startsWith(last1) && bigram.length === 2) {
          const nextLetter = bigram[1];
          letterScores[nextLetter] = (letterScores[nextLetter] || 0) + (data.count * 1);
        }
      }
    }
    
    // Sort by score and return top 6
    const sortedLetters = Object.entries(letterScores)
      .sort((a, b) => b[1] - a[1])
      .map(([letter]) => letter)
      .slice(0, 6);
    
    console.log(`[LetterPredict] Final scores:`, Object.entries(letterScores).sort((a,b) => b[1]-a[1]).slice(0,10));
    
    return sortedLetters;
  }

  // Record letter n-grams from typed text (for learning)
  recordLetterNgrams(word) {
    const upperWord = word.toUpperCase().replace(/[^A-Z]/g, '');
    const timestamp = new Date().toISOString();
    
    for (let i = 0; i < upperWord.length; i++) {
      const letter = upperWord[i];
      
      // Unigram
      if (!this.letterData.unigrams[letter]) {
        this.letterData.unigrams[letter] = { count: 0, last_used: timestamp };
      }
      this.letterData.unigrams[letter].count++;
      this.letterData.unigrams[letter].last_used = timestamp;
      
      // Bigram
      if (i >= 1) {
        const bigram = upperWord.slice(i - 1, i + 1);
        if (!this.letterData.bigrams[bigram]) {
          this.letterData.bigrams[bigram] = { count: 0, last_used: timestamp };
        }
        this.letterData.bigrams[bigram].count++;
        this.letterData.bigrams[bigram].last_used = timestamp;
      }
      
      // Trigram
      if (i >= 2) {
        const trigram = upperWord.slice(i - 2, i + 1);
        if (!this.letterData.trigrams[trigram]) {
          this.letterData.trigrams[trigram] = { count: 0, last_used: timestamp };
        }
        this.letterData.trigrams[trigram].count++;
        this.letterData.trigrams[trigram].last_used = timestamp;
      }
    }
  }

  async recordLocalWord(word) {
    try {
      const upperWord = word.toUpperCase();
      const timestamp = new Date().toISOString();
      
      // Update local memory data immediately so we see the change
      // This does NOT save to file - only updates in-memory for predictions
      if (!this.data.frequent_words[upperWord]) {
        this.data.frequent_words[upperWord] = { count: 0, last_used: timestamp };
      }
      this.data.frequent_words[upperWord].count++;
      this.data.frequent_words[upperWord].last_used = timestamp;
      
      // NOTE: We do NOT save to server here. Saving only happens via saveWordToFile()
      // after the user speaks the text 3 times.
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
      
      // NOTE: We do NOT save to server here. Saving only happens via saveNgramToFile()
      // after the user speaks the text 3 times.
    } catch (error) {
      console.error('Error recording ngram:', error);
    }
  }

  // Save word to file - only called after user speaks text 3 times
  async saveWordToFile(word) {
    try {
      const upperWord = word.toUpperCase();
      const timestamp = new Date().toISOString();
      
      // Ensure local data is updated
      if (!this.data.frequent_words[upperWord]) {
        this.data.frequent_words[upperWord] = { count: 0, last_used: timestamp };
      }
      this.data.frequent_words[upperWord].count++;
      this.data.frequent_words[upperWord].last_used = timestamp;
      
      // Actually save to file
      await this.saveToServer(upperWord, timestamp);
      console.log(`[SAVED TO FILE] Word: ${upperWord}`);
    } catch (error) {
      console.error('Error saving word to file:', error);
    }
  }

  // Save n-gram to file - only called after user speaks text 3 times
  async saveNgramToFile(context, nextWord) {
    try {
      const timestamp = new Date().toISOString();
      const ctxWords = context.toUpperCase().split(' ').filter(w => w);
      const nextUpper = nextWord.toUpperCase();
      
      // Update local memory
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
      
      // Actually save to file
      const cleanContext = ctxWords.join(' ');
      if (cleanContext) {
        await this.saveNgramToServer(cleanContext, nextWord, timestamp);
        console.log(`[SAVED TO FILE] N-gram: "${cleanContext}" -> "${nextUpper}"`);
      }
    } catch (error) {
      console.error('Error saving n-gram to file:', error);
    }
  }

  async saveToServer(word, timestamp) {
    try {
      if (this.isElectron) {
        await window.electronAPI.keyboard.savePrediction({ word, timestamp });
      } else {
        await fetch('/api/save_prediction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ word, timestamp })
        });
      }
    } catch (error) {
      console.error('Error saving to server:', error);
    }
  }

  async saveNgramToServer(context, nextWord, timestamp) {
    try {
      if (this.isElectron) {
        await window.electronAPI.keyboard.saveNgram({ context, next_word: nextWord, timestamp });
      } else {
        await fetch('/api/save_ngram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ context, next_word: nextWord, timestamp })
        });
      }
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