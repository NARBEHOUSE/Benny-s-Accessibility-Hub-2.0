
class JumbleEditor {
    constructor() {
        this.words = [];
        this.filteredWords = [];
        this.currentIndex = -1; // Primary active index (edit target)
        this.selectedIndices = new Set(); // Multi-selection set
        
        // File Management
        this.currentFileName = "default";
        this.availableFiles = ["default"];

        // Bind UI
        this.wordInput = document.getElementById('word-input');
        this.sentenceInput = document.getElementById('sentence-input');
        this.imageInput = document.getElementById('image-input');
        this.previewImg = document.getElementById('image-preview');
        this.filterInput = document.getElementById('filter-input');
        this.listContainer = document.getElementById('word-list');
        this.countDisplay = document.getElementById('count-display');
        this.fileNameInput = document.getElementById('filename-input');
        this.sortSelect = document.getElementById('sort-select');
        
        // Enter key for symbol search
        document.getElementById('symbol-search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.performSearch();
        });

        this.init();
    }

    async init() {
        // Load default server words.json
        this.fileNameInput.value = "words";
        this.currentFileName = "words";
        
        try {
            const res = await fetch('words.json');
            if (res.ok) {
                this.words = await res.json();
            } else {
                throw new Error("Failed to load words.json");
            }
            
            // Check if local storage overrides exist? 
            // In the simplified model, we just load default. 
            // If user wants local, they can "Load" or we could auto-load last session.
            // For now, prompt implies clean separation: "words.json ... loaded ... show words"
            
            this.cleanData();
            this.filterList();
        } catch(e) { 
            console.error("Init error", e);
            this.words = [];
        }
        
        this.createNew(); // Reset editor inputs
    }
    
    // Removed refreshFileList and loadSelectedFile as dropdown is gone

    cleanData() {
        // Remove duplicates based on 'word' property
        const unique = new Map();
        this.words.forEach(item => {
            if (item.word) {
                // Normalize word
                const w = item.word.trim().toLowerCase();
                if (!unique.has(w)) {
                    // Start clean object, stripping 'mode' if present implicitly by reconstruction
                    unique.set(w, {
                        word: w,
                        sentence: item.sentence || "",
                        image: item.image || ""
                    });
                } else {
                    // Update existing if new one has image or better sentence?
                    const existing = unique.get(w);
                    if (!existing.image && item.image) existing.image = item.image;
                }
            }
        });
        
        this.words = Array.from(unique.values());
        this.performSort();
    }
    
    sortList() {
        this.performSort();
        this.filterList();
    }
    
    performSort() {
        const mode = this.sortSelect ? this.sortSelect.value : 'alpha';
        
        this.words.sort((a, b) => {
            if (mode === 'alpha') return a.word.localeCompare(b.word);
            if (mode === 'alpha_rev') return b.word.localeCompare(a.word);
            if (mode === 'length_asc') {
                if (a.word.length !== b.word.length) return a.word.length - b.word.length;
                return a.word.localeCompare(b.word);
            }
            if (mode === 'length_desc') {
                 if (a.word.length !== b.word.length) return b.word.length - a.word.length;
                 return a.word.localeCompare(b.word);
            }
            return 0;
        });
    }

    filterList() {
        const query = this.filterInput.value.toLowerCase();
        this.filteredWords = this.words.filter(w => w.word.toLowerCase().includes(query));
        this.renderList();
    }

    renderList() {
        this.listContainer.innerHTML = '';
        this.filteredWords.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'word-item';
            
            // Find actual index in main array
            const realIndex = this.words.indexOf(item);
            const isSelected = this.selectedIndices.has(realIndex);
            
            if (isSelected) div.classList.add('active');
            
            const checkbox = `<input type="checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); editor.toggleSelection(${realIndex})" style="margin-right: 10px; transform: scale(1.2);">`;

            div.innerHTML = `
                <div style="display:flex; align-items:center; width: 100%;">
                    ${checkbox}
                    <div style="flex-grow: 1;">
                        <strong>${item.word}</strong> <span style="color:#888">(${item.word.length})</span>
                        <div style="font-size:12px; color:#666; margin-top:2px;">${item.sentence.substring(0, 30)}${item.sentence.length > 30 ? '...' : ''}</div>
                    </div>
                    ${item.image ? '<span style="font-size:12px">🖼️</span>' : ''}
                </div>
            `;
            
            div.onclick = (e) => this.selectWord(realIndex, e);
            
            this.listContainer.appendChild(div);
        });
        
        this.countDisplay.innerText = `${this.filteredWords.length} words`;
    }

    toggleSelection(index) {
        if (this.selectedIndices.has(index)) {
            this.selectedIndices.delete(index);
        } else {
            this.selectedIndices.add(index);
            // If selecting via checkbox, also load it into editor so user sees what they picked
            this.loadToEditor(index);
        }
        this.renderList();
    }
    
    loadToEditor(index) {
        this.currentIndex = index;
        const item = this.words[index];
        if (item) {
            this.wordInput.value = item.word || "";
            this.sentenceInput.value = item.sentence || "";
            this.imageInput.value = item.image || "";
            this.renderImagePreview();
        }
    }

    selectWord(index, event) {
        if (!event) {
            // Direct select (programmatic)
            this.selectedIndices.clear();
            this.selectedIndices.add(index);
        } else if (event.ctrlKey || event.metaKey) {
            // Toggle
            if (this.selectedIndices.has(index)) this.selectedIndices.delete(index);
            else this.selectedIndices.add(index);
        } else if (event.shiftKey && this.currentIndex !== -1) {
            // Range
            const start = Math.min(this.currentIndex, index);
            const end = Math.max(this.currentIndex, index);
            this.selectedIndices.clear();
            for (let i = start; i <= end; i++) {
                // Must verify i is visible if filtering? 
                // For simplicity, range in filtered view vs all words view is complex.
                // Let's do range on filteredWords, map to real indices.
                // This is simpler:
                // Find visible indices
                const visibleIndices = this.filteredWords.map(w => this.words.indexOf(w));
                const rangeStart = visibleIndices.indexOf(this.currentIndex);
                const rangeEnd = visibleIndices.indexOf(index);
                
                if (rangeStart !== -1 && rangeEnd !== -1) {
                     const s = Math.min(rangeStart, rangeEnd);
                     const e = Math.max(rangeStart, rangeEnd);
                     for(let k=s; k<=e; k++) {
                         this.selectedIndices.add(visibleIndices[k]);
                     }
                }
            }
        } else {
            // Single select (Row Click)
            // If clicking row, usually select exclusively
            this.selectedIndices.clear();
            this.selectedIndices.add(index);
        }
        
        // If we just selected one item or the last clicked item, that becomes current for editing
        if (this.selectedIndices.has(index) || (event && !event.shiftKey && !event.ctrlKey)) {
             this.loadToEditor(index);
        } else if (this.selectedIndices.size === 0) {
             this.clearEditor();
        }
        
        this.renderList();
    }
    
    highlightSelection() {
        this.renderList();
    }

    clearEditor() {
        this.currentIndex = -1;
        // Don't clear selections here? Or do we? 
        // "New Word" button calls this. 
        // "New Word" implies "I want to type a new word", so deselecting list items makes sense.
        this.selectedIndices.clear();
        
        this.wordInput.value = "";
        this.sentenceInput.value = "";
        this.imageInput.value = "";
        this.previewImg.style.display = 'none';
        this.renderList();
        this.wordInput.focus();
    }

    createNewList() {
        if (this.words.length > 0) {
            if (!confirm("Start a new list? Unsaved changes to the current list will be lost unless you saved them.")) return;
        }
        this.words = [];
        this.currentFileName = "untitled";
        this.fileNameInput.value = "";
        this.cleanData(); // resets sort/filter
        this.filterList();
        this.clearEditor();
        this.showStatus("Started new empty list");
    }

    createNew() { 
        this.clearEditor(); 
    }

    updatePreview() {
        // Optional: validate word or show length
    }

    renderImagePreview() {
        const url = this.imageInput.value;
        if (url) {
            this.previewImg.src = url;
            this.previewImg.style.display = 'block';
            this.previewImg.onerror = () => { this.previewImg.style.display = 'none'; };
        } else {
            this.previewImg.style.display = 'none';
        }
    }

    applyChanges() {
        const word = this.wordInput.value.trim().toLowerCase();
        const sentence = this.sentenceInput.value.trim();
        const image = this.imageInput.value.trim();
        
        if (!word) { alert("Word is required"); return; }
        if (!sentence) { alert("Sentence is required"); return; }

        const newItem = { word, sentence, image };
        
        // Handle logic for update vs new
        if (this.currentIndex >= 0) {
            const originalWord = this.words[this.currentIndex].word;
            if (originalWord !== word) {
                if (this.words.some(w => w.word === word)) {
                    if (!confirm("This word already exists. Overwrite?")) return;
                     // Remove the other instance to avoid duplicates
                     this.words = this.words.filter(w => w.word !== word);
                     // If we removed something, indices shift, but we are about to re-sort/re-find
                }
            }
            this.words[this.currentIndex] = newItem;
        } else {
            // New Item
             if (this.words.some(w => w.word === word)) {
                alert("Word already exists!");
                return;
            }
            this.words.push(newItem);
        }
        
        // Sort
        this.performSort();
        
        // Find new location and select it
        const newIndex = this.words.indexOf(newItem);
        this.selectWord(newIndex);
        
        this.filterList();
        this.showStatus("Applied. Unsaved changes.");
    }

    deleteSelected() {
        if (this.selectedIndices.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${this.selectedIndices.size} word(s)?`)) return;
        
        const indices = Array.from(this.selectedIndices).sort((a,b) => b-a);
        indices.forEach(idx => {
            if (idx >= 0 && idx < this.words.length) {
                this.words.splice(idx, 1);
            }
        });
        
        this.clearEditor();
        this.filterList();
        this.showStatus("Words deleted.");
    }

    deleteCurrent() {
        this.deleteSelected();
    }

    async saveToFile() {
        try {
            const btn = document.querySelector('.btn-success');
            // If button doesn't exist (if I changed HTML class?)
            // Just protecting
            const originalText = btn ? btn.innerText : "Save Server";
            if (btn) {
                btn.innerText = "Saving...";
                btn.disabled = true;
            }

            const res = await fetch('/api/save_words', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(this.words)
            });
            
            if (res.ok) {
                this.showStatus("File Saved Successfully!");
            } else {
                // If API is missing/mock, this fails silently usually or throws
                console.warn("Server save might not be implemented.");
                this.showStatus("Server save failed (is API running?)");
            }
            
            if (btn) {
                btn.innerText = originalText;
                btn.disabled = false;
            }
        } catch (e) {
            console.error(e);
            this.showStatus("Error saving to server.");
            const btn = document.querySelector('.btn-success');
            if (btn) btn.disabled = false;
        }
    }

    saveToLocalStorage() {
        let name = this.fileNameInput.value.trim();
        if (!name) name = "my_words"; // default if empty
        
        const key = 'wordjumble_list_' + name;
        
        try {
            localStorage.setItem(key, JSON.stringify(this.words));
            // Also store to default key so game picks it up immediately as 'Local' source
            localStorage.setItem('wordjumble_custom_words', JSON.stringify(this.words));
            localStorage.setItem('wordjumble_custom_name', name);
            
            this.showStatus(`Saved '${name}' to browser & set active!`);
        } catch (e) {
            alert("Failed to save: " + e.message);
        }
    }

    async downloadJSON() {
        let name = this.fileNameInput.value.trim().replace(/[^a-zA-Z0-9_\-\s]/g, ''); // Sanitize
        if (!name) name = "words";
        if (!name.toLowerCase().endsWith('.json')) name += ".json";

        const content = JSON.stringify(this.words, null, 2);
        
        if (window.showSaveFilePicker) {
            try {
                const handle = await window.showSaveFilePicker({
                    suggestedName: name,
                    types: [{
                        description: 'JSON File',
                        accept: {'application/json': ['.json']},
                    }],
                });
                const writable = await handle.createWritable();
                await writable.write(content);
                await writable.close();
                this.showStatus("File Saved");
                return;
            } catch (err) {
                if (err.name !== 'AbortError') console.error(err);
                if (err.name === 'AbortError') return; 
            }
        }
        
        // Fallback
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(content);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", dataStr);
        downloadAnchorNode.setAttribute("download", name);
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
    }

    showStatus(msg) {
        const el = document.getElementById('status-bar');
        el.innerText = msg;
        el.style.display = 'block';
        setTimeout(() => el.style.display = 'none', 3000);
    }

    uploadJSON(input) {
        const file = input.files[0];
        if (!file) return;
        
        // Update filename input with the uploaded file name (minus extension)
        const name = file.name.replace(/\.json$/i, '');
        this.fileNameInput.value = name;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (Array.isArray(data)) {
                    if (confirm("This will replace your current list. Continue?")) {
                        this.words = data;
                        this.cleanData();
                        this.filterList();
                        this.showStatus("Loaded file: " + file.name);
                    }
                } else {
                    alert("Invalid file format. Expected a list of words.");
                }
            } catch (err) {
                alert("Error reading file: " + err.message);
            }
        };
        reader.readAsText(file);
        input.value = ''; // Reset
    }

    // --- Open Symbols Handling ---
    openSymbolSearch() {
        document.getElementById('search-modal').style.display = 'flex';
        document.getElementById('symbol-search-input').focus();
    }

    async performSearch() {
        const query = document.getElementById('symbol-search-input').value;
        if (!query) return;
        
        const container = document.getElementById('search-results');
        container.innerHTML = "Loading...";
        
        try {
            // Using Open Symbols API directly
            const res = await fetch(`https://www.opensymbols.org/api/v1/symbols/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            
            container.innerHTML = "";
            if (!data || data.length === 0) {
                container.innerHTML = "No results found.";
                return;
            }
            
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'symbol-item';
                div.innerHTML = `
                    <img src="${item.image_url}" loading="lazy">
                    <div style="font-size:10px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${item.name}</div>
                `;
                div.onclick = () => {
                    this.imageInput.value = item.image_url;
                    this.renderImagePreview();
                    document.getElementById('search-modal').style.display = 'none';
                };
                container.appendChild(div);
            });
            
        } catch (e) {
            console.error(e);
            container.innerHTML = "Error fetching symbols.";
        }
    }
}

const editor = new JumbleEditor();
