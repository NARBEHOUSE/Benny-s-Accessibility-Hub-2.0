// Prediction system implementation for Streaming Hub
// Recreated to support Custom Vocabulary (Shows/Movies) and Recent Searches

class PredictionSystem {
    constructor() {
        this.customVocabulary = []; // From data.json (titles)
        this.recentSearches = [];   // From search_history.json
        this.frequentWords = {};    // Basic dictionary if needed
        
        // Initialize basic common words
        this.initBasicDictionary();
    }

    initBasicDictionary() {
        // Just some simple basics in case nothing matches
        const basics = ["THE", "SHOW", "MOVIE", "SEASON", "EPISODE", "WATCH"];
        basics.forEach(w => this.frequentWords[w] = 1);
    }

    setCustomVocabulary(vocabList) {
        if (!Array.isArray(vocabList)) return;
        this.customVocabulary = vocabList.filter(v => v && typeof v === 'string');
        console.log(`Prediction: Loaded ${this.customVocabulary.length} custom titles.`);
    }

    setRecentSearches(searchList) {
        if (!Array.isArray(searchList)) return;
        this.recentSearches = searchList.filter(s => s && typeof s === 'string');
        console.log(`Prediction: Loaded ${this.recentSearches.length} recent searches.`);
    }

    async getHybridPredictions(buffer) {
        const input = buffer.toUpperCase().trim();
        let predictions = [];
        
        // 1. Exact Match / Starts With from Custom Vocabulary (Shows/Movies)
        // High priority because user is likely searching for a title
        if (input.length > 0) {
            const titleMatches = this.customVocabulary
                .filter(title => {
                    const T = title.toUpperCase();
                    if (T === input) return false; // Don't predict what's already fully typed
                    return T.includes(input); // Contains search matches (e.g. "Simp" matches "The Simpsons")
                })
                .sort((a, b) => {
                    // Sort order:
                    // 1. Starts with input
                    // 2. Shortest length
                    const A = a.toUpperCase();
                    const B = b.toUpperCase();
                    const aStarts = A.startsWith(input);
                    const bStarts = B.startsWith(input);
                    
                    if (aStarts && !bStarts) return -1;
                    if (!aStarts && bStarts) return 1;
                    return a.length - b.length;
                });
                
            predictions.push(...titleMatches);
        }

        // 2. Recent Searches
        if (input.length > 0) {
             const searchMatches = this.recentSearches
                .filter(term => {
                    const T = term.toUpperCase();
                    return T.includes(input) && T !== input;
                })
                .reverse(); // Newest first (assuming list is chronological)
            
            // Add unique
            searchMatches.forEach(s => {
                if (!predictions.includes(s)) predictions.push(s);
            });
        }

        // 3. Fallback: Recent searches default (if input empty)
        if (input.length === 0) {
            // Show recent searches first
            [...this.recentSearches].reverse().forEach(s => {
                if (!predictions.includes(s)) predictions.push(s);
            });
            
            // Then some random titles? Or just basics
        }

        // Limit
        predictions = predictions.slice(0, 6);
        
        // Pad with empty strings if not enough
        while(predictions.length < 6) {
           // If we have empty input, maybe suggest popular shows if we ran out of history?
           if (input.length === 0 && this.customVocabulary.length > 0) {
                // Just random shuffle or first few?
                // Let's grab a few from the start of vocab if not already there
                const next = this.customVocabulary.find(v => !predictions.includes(v));
                if (next) predictions.push(next);
                else predictions.push(""); 
           } else {
               predictions.push("");
           }
        }
        
        return predictions.slice(0, 6);
    }
    
    // Stub methods for potential compatibility
    recordLocalWord(w) {}
    recordNgram(c, w) {}
}

// Attach to window
window.predictionSystem = new PredictionSystem();
