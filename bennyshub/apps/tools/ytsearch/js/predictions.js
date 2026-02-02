// Predictive text functionality
class PredictionsManager {
    constructor() {
        this.debounceTimer = null;
        this.debounceDelay = 120;
        this.requestId = 0;
        
        // Default words for fallback
        this.defaultWords = ["yes", "no", "help", "the", "you", "to"];
        
        // Local n-gram data (simplified version)
        this.localNgrams = {
            frequent: {
                "THE": 100, "AND": 90, "YOU": 85, "TO": 80, "A": 75, "OF": 70,
                "I": 65, "IT": 60, "IN": 55, "THAT": 50, "HAVE": 45, "FOR": 40,
                "NOT": 35, "WITH": 30, "HE": 25, "AS": 20, "IS": 18, "ON": 16,
                "BE": 14, "AT": 12, "BY": 10, "THIS": 8, "WE": 6, "CAN": 5,
                "WILL": 4, "ARE": 3, "FROM": 2, "THEY": 1
            },
            bigrams: {
                "THE ": ["BEST", "FIRST", "LAST", "MOST", "OTHER", "SAME"],
                "YOU ": ["ARE", "CAN", "WILL", "HAVE", "KNOW", "SEE"],
                "I ": ["AM", "HAVE", "WILL", "CAN", "THINK", "KNOW"],
                "TO ": ["BE", "THE", "DO", "GET", "MAKE", "HAVE"],
                "AND ": ["THE", "I", "YOU", "IT", "WE", "THEY"],
                "OF ": ["THE", "A", "AN", "THIS", "THAT", "MY"]
            }
        };
        
        // KenLM API configuration
        this.kenlmAPI = "https://api.imagineville.org/word/predict";
        this.kenlmTimeout = 3000;
    }
    
    async fetchPredictions(text) {
        const currentId = ++this.requestId;
        
        try {
            // Parse input text
            const { context, prefix } = this.parseInput(text);
            
            // Try KenLM API first
            const kenlmResults = await this.fetchKenLM(context, prefix);
            
            // Check if request is still current
            if (currentId !== this.requestId) return [];
            
            if (kenlmResults && kenlmResults.length > 0) {
                return this.processPredictions(kenlmResults, prefix);
            }
            
            // Fallback to local n-grams
            return this.fallbackNgrams(text);
            
        } catch (error) {
            console.log('Prediction error, using fallback:', error);
            return this.fallbackNgrams(text);
        }
    }
    
    parseInput(text) {
        const raw = text || "";
        const endsWithSpace = raw.endsWith(" ");
        const words = raw.trim().split(/\s+/).filter(w => w.length > 0);
        
        if (endsWithSpace || words.length === 0) {
            return {
                context: words.slice(-2),
                prefix: ""
            };
        } else {
            return {
                context: words.slice(-3, -1),
                prefix: words[words.length - 1]
            };
        }
    }
    
    async fetchKenLM(context, prefix) {
        try {
            // Try POST request first
            const postResponse = await fetch(this.kenlmAPI, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    context: context || [],
                    prefix: prefix || "",
                    limit: 6
                }),
                signal: AbortSignal.timeout(this.kenlmTimeout)
            });
            
            if (postResponse.ok) {
                const data = await postResponse.json();
                const results = this.parseKenLMResponse(data);
                if (results.length > 0) return results;
            }
        } catch (error) {
            // POST failed, try GET fallback
        }
        
        try {
            // GET fallback
            const params = new URLSearchParams({
                num: "6",
                sort: "logprob",
                safe: "true",
                lang: "en"
            });
            
            if (prefix) params.set("prefix", prefix.toLowerCase());
            if (context && context.length > 0) {
                params.set("left", context.join(" ").toLowerCase());
            }
            
            const getResponse = await fetch(`${this.kenlmAPI}?${params}`, {
                signal: AbortSignal.timeout(this.kenlmTimeout)
            });
            
            if (getResponse.ok) {
                const data = await getResponse.json();
                return this.parseKenLMResponse(data);
            }
        } catch (error) {
            // Both requests failed
        }
        
        return [];
    }
    
    parseKenLMResponse(data) {
        if (Array.isArray(data)) {
            return data.map(item => String(item)).filter(s => s.length > 0);
        }
        
        if (typeof data === 'object' && data !== null) {
            for (const key of ['suggestions', 'result', 'results', 'candidates']) {
                if (Array.isArray(data[key])) {
                    const results = [];
                    for (const item of data[key]) {
                        if (typeof item === 'string') {
                            results.push(item);
                        } else if (typeof item === 'object' && item !== null) {
                            const text = item.text || item.token || item.word;
                            if (text) results.push(String(text));
                        }
                    }
                    if (results.length > 0) return results;
                }
            }
        }
        
        return [];
    }
    
    fallbackNgrams(text) {
        const { context, prefix } = this.parseInput(text);
        const scores = {};
        const prefixUpper = prefix.toUpperCase();
        
        // Try bigrams first if we have context
        if (context.length > 0) {
            const lastWord = context[context.length - 1].toUpperCase() + " ";
            const bigramSuggestions = this.localNgrams.bigrams[lastWord] || [];
            
            for (const word of bigramSuggestions) {
                if (!prefix || word.startsWith(prefixUpper)) {
                    scores[word] = (scores[word] || 0) + 50;
                }
            }
        }
        
        // Add frequent words that match prefix
        for (const [word, freq] of Object.entries(this.localNgrams.frequent)) {
            if (!prefix || word.startsWith(prefixUpper)) {
                scores[word] = (scores[word] || 0) + freq;
            }
        }
        
        // Sort by score and return top 6
        const results = Object.entries(scores)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 6)
            .map(([word]) => word.toLowerCase());
        
        // Fill with defaults if needed
        while (results.length < 6) {
            for (const defaultWord of this.defaultWords) {
                if (results.length >= 6) break;
                if (!results.includes(defaultWord)) {
                    results.push(defaultWord);
                }
            }
            break;
        }
        
        return this.processPredictions(results, prefix);
    }
    
    processPredictions(words, prefix) {
        const results = [];
        const seen = new Set();
        
        // Add hardcoded injections for specific prefixes
        if (prefix.toLowerCase() === 'n' && !seen.has('narbe')) {
            results.push('narbe');
            seen.add('narbe');
        } else if (prefix.toLowerCase() === 'b' && !seen.has('beaminbenny')) {
            results.push('beaminbenny');
            seen.add('beaminbenny');
        }
        
        // Add other predictions
        for (const word of words) {
            if (results.length >= 6) break;
            const cleanWord = word.toLowerCase().trim();
            if (cleanWord && !seen.has(cleanWord)) {
                results.push(cleanWord);
                seen.add(cleanWord);
            }
        }
        
        // Fill with defaults if needed
        for (const defaultWord of this.defaultWords) {
            if (results.length >= 6) break;
            if (!seen.has(defaultWord)) {
                results.push(defaultWord);
                seen.add(defaultWord);
            }
        }
        
        return results.slice(0, 6);
    }
    
    schedulePredictions(text, callback) {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(async () => {
            const predictions = await this.fetchPredictions(text);
            callback(predictions);
        }, this.debounceDelay);
    }
}

// Global predictions manager instance
window.predictionsManager = new PredictionsManager();