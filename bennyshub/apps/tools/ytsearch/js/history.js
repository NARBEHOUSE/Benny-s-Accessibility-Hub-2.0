// Search history management
class HistoryManager {
    constructor() {
        this.storageKey = 'narbe_search_history';
        this.maxHistoryItems = 100; // Increase storage capacity
        this.displayItems = 30; // Show 30 items total
        this.itemsPerRow = 5; // 5 items per row
        this.totalRows = 6; // 6 rows total
        this.history = this.loadHistory();
        this.isHistoryMode = false;
    }
    
    loadHistory() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const parsed = JSON.parse(stored);
                return Array.isArray(parsed) ? parsed : [];
            }
        } catch (error) {
            console.log('Error loading search history:', error);
        }
        return [];
    }
    
    saveHistory() {
        try {
            localStorage.setItem(this.storageKey, JSON.stringify(this.history));
        } catch (error) {
            console.log('Error saving search history:', error);
        }
    }
    
    addToHistory(searchTerm) {
        if (!searchTerm || searchTerm.trim() === '') return;
        
        const term = searchTerm.trim().toLowerCase();
        
        // Find existing entry
        const existingIndex = this.history.findIndex(item => item.term === term);
        
        if (existingIndex !== -1) {
            // Update count and move to front
            this.history[existingIndex].count++;
            this.history[existingIndex].lastUsed = Date.now();
            const item = this.history.splice(existingIndex, 1)[0];
            this.history.unshift(item);
        } else {
            // Add new entry
            this.history.unshift({
                term: term,
                count: 1,
                lastUsed: Date.now()
            });
        }
        
        // Limit history size
        if (this.history.length > this.maxHistoryItems) {
            this.history = this.history.slice(0, this.maxHistoryItems);
        }
        
        // Sort by frequency and recency
        this.sortHistory();
        this.saveHistory();
        
        // Update display if in history mode
        if (this.isHistoryMode) {
            this.updateHistoryDisplay();
        }
    }
    
    sortHistory() {
        this.history.sort((a, b) => {
            // Primary sort by count (frequency)
            if (a.count !== b.count) {
                return b.count - a.count;
            }
            // Secondary sort by recency
            return b.lastUsed - a.lastUsed;
        });
    }
    
    getTopHistory(limit = this.displayItems) {
        return this.history.slice(0, limit);
    }
    
    clearHistory() {
        this.history = [];
        this.saveHistory();
        
        if (this.isHistoryMode) {
            this.updateHistoryDisplay();
        }
        
        window.speechManager.speak('history cleared');
    }
    
    toggleHistoryMode() {
        this.isHistoryMode = !this.isHistoryMode;
        
        const historyRows = document.querySelectorAll('[data-row-id^="row_history"]');
        const alphaRows = document.querySelectorAll('[data-row-id^="row"]:not([data-row-id="row_text"]):not([data-row-id="row_modes"]):not([data-row-id="row_controls"]):not([data-row-id^="row_history"]):not([data-row-id="predRow"])');
        const predRow = document.querySelector('[data-row-id="predRow"]');
        
        if (this.isHistoryMode) {
            // Show history rows, hide alpha rows and predictions
            historyRows.forEach(row => row.classList.remove('hidden'));
            alphaRows.forEach(row => row.classList.add('hidden'));
            predRow?.classList.add('hidden');
            
            this.updateHistoryDisplay();
        } else {
            // Hide history rows, show alpha rows and predictions
            historyRows.forEach(row => row.classList.add('hidden'));
            alphaRows.forEach(row => row.classList.remove('hidden'));
            predRow?.classList.remove('hidden');
        }
        
        // Update the button text
        this.updateHistoryButtonText();
        
        // Update scanning manager rows
        if (window.scanningManager) {
            window.scanningManager.updateRows();
        }
        
        return this.isHistoryMode;
    }
    
    updateHistoryDisplay() {
        const topHistory = this.getTopHistory(this.displayItems);
        
        // Update all history buttons across all rows
        for (let i = 0; i < this.displayItems; i++) {
            const button = document.getElementById(`history-${i}`);
            if (button) {
                if (i < topHistory.length) {
                    const item = topHistory[i];
                    button.textContent = item.term.toUpperCase();
                    button.style.opacity = '1';
                    button.style.pointerEvents = 'auto';
                } else {
                    button.textContent = '';
                    button.style.opacity = '0.3';
                    button.style.pointerEvents = 'none';
                }
            }
        }
        
        // Update the search history button text
        this.updateHistoryButtonText();
    }
    
    updateHistoryButtonText() {
        const historyButton = document.querySelector('[data-action="toggle_history"]');
        if (historyButton) {
            if (this.isHistoryMode) {
                historyButton.textContent = 'KEYBOARD';
            } else {
                historyButton.textContent = 'SEARCH HISTORY';
            }
        }
    }
    
    selectHistoryItem(index) {
        const topHistory = this.getTopHistory();
        
        if (index >= 0 && index < topHistory.length) {
            const selectedTerm = topHistory[index].term;
            
            // Set the text input
            const textInput = document.getElementById('text-input');
            if (textInput) {
                textInput.value = selectedTerm.toUpperCase();
            }
            
            // Exit history mode
            this.toggleHistoryMode();
            
            // Trigger predictions update
            if (window.narbe) {
                window.narbe.schedulePredictions();
            }
            
            window.speechManager.speak(selectedTerm);
        }
    }
}

// Global history manager instance
window.historyManager = new HistoryManager();
