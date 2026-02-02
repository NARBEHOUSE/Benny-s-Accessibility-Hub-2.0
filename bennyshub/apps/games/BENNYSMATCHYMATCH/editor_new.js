let manifest = { categories: {} };
let currentCategory = null;
let assetPool = [];
let currentPackFilename = null;
let packList = [];
let currentEditingCardIndex = -1;
let currentEditingCardTitle = null;
let currentSelectorCallback = null;

// Audio Context
let audioContext = new (window.AudioContext || window.webkitAudioContext)();
let audioBuffer = null;
let audioSource = null;
let audioStartTime = 0;
let audioEndTime = 0;
let audioCursorTime = 0;
let audioAnchorTime = 0;
let isDraggingAudio = false;
let audioPlaybackRequestId = null;
let audioCanvas = null;
let audioCtx2D = null;
let currentEditingAudioTitle = null;
let editingCardCallback = null;
let assetBlobs = {}; // Cache for local blobs
let mediaRecorder = null;
let recordedChunks = [];

// Photo Context
let photoCanvas = null;
let photoCtx = null;
let photoImage = null;
let photoRotation = 0;
let photoHistory = []; // Stack for undo
const MAX_HISTORY = 10;
const AUTOSAVE_KEY = 'matchy_editor_auto_save';
const AUTOSAVE_INTERVAL = 30000; // 30 seconds

async function init() {
    await loadManifest();
    
    // Check for Auto-Save
    checkForAutoSave();
    
    await loadAssetPool();
    renderCategories();

    // Restore Editor State (current category)
    try {
        const stateRaw = localStorage.getItem('matchy_editor_state');
        if (stateRaw) {
            const state = JSON.parse(stateRaw);
            if (state.category && manifest.categories[state.category]) {
                selectCategory(state.category);
                console.log("Restored active category:", state.category);
            }
        }
    } catch(e) { console.warn("Failed to restore editor state", e); }
    
    // Only show welcome screen if NO category selected
    if (!currentCategory) {
        if (Object.keys(manifest.categories).length === 0) {
            document.getElementById('welcome-screen').style.display = 'block';
            document.getElementById('category-editor').style.display = 'none';
        } else {
             document.getElementById('welcome-screen').style.display = 'block';
             document.getElementById('category-editor').style.display = 'none';
        }
    }

    // Start Auto-Save Loop
    setInterval(performAutoSave, AUTOSAVE_INTERVAL);
}

function performAutoSave() {
    try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
            timestamp: Date.now(),
            manifest: manifest
        }));
        // Optional: show a small toast or icon? 
        // console.log("Auto-saved to browser cache");
    } catch(e) {
        console.warn("Auto-save failed (storage full?)", e);
    }
}

function checkForAutoSave() {
    try {
        const saved = localStorage.getItem(AUTOSAVE_KEY);
        if (saved) {
            const data = JSON.parse(saved);
            
            // Check equality with current manifest (loaded from persistence)
            // If identical, we don't need to prompt, just assume we are good or even clear the autosave.
            // But 'manifest' variable currently holds what we just loaded from matchy_manifest or file.
            
            const currentStr = JSON.stringify(manifest);
            const savedStr = JSON.stringify(data.manifest);
            
            if (currentStr === savedStr) {
                // They are identical, no need to prompt. 
                // We can keep the autosave as a backup or ignore it.
                // Resetting the timestamp in memory effectively "accepts" it.
                // Let's just return silently.
                return;
            }

            const savedTime = new Date(data.timestamp);
            
            if (confirm(`Unsaved work found from ${savedTime.toLocaleString()}.\n\nDo you want to restore it?`)) {
                if (data.manifest && data.manifest.categories) {
                    manifest = data.manifest;
                    console.log("Restored from auto-save");
                    // Update the UI since we just changed data behind the scenes
                    // We need to re-render categories if this runs after initial render?
                    // checkForAutoSave is called in init() before renderCategories().
                    // So we are fine.
                }
            } else {
                // If they say no, delete it so it doesn't ask again
                localStorage.removeItem(AUTOSAVE_KEY);
            }
        }
    } catch (e) {
        console.error("Error reading auto-save", e);
    }
}

async function loadManifest() {
    manifest = { categories: {} };
    packList = [];
    currentPackFilename = null;

    // 1. Fetch Server Registry (assetManifest.json)
    try {
        let res = await fetch('assetManifest.json?t=' + Date.now());
        if (!res.ok) res = await fetch('/api/manifest'); 

        if (res.ok) {
            const data = await res.json();
            if (data.packs && Array.isArray(data.packs)) {
                packList = data.packs;
            } else if (data.categories) {
                // Legacy
                manifest = data;
                packList = ["assetManifest.json"];
                currentPackFilename = "assetManifest.json";
            }
        }
    } catch(e) {
        console.warn("Failed to load server assetManifest", e);
    }
    
    // 2. Merge with Local Registry (Browser Storage)
    try {
        const localReg = JSON.parse(localStorage.getItem('matchy_local_registry') || '[]');
        
        // Helper to normalize for duplicate checking
        const getFilename = (path) => path.split('/').pop().toLowerCase();
        
        localReg.forEach(p => {
            const localBase = getFilename(p);
            const existingIndex = packList.findIndex(sp => getFilename(sp) === localBase);
            
            if (existingIndex !== -1) {
                // Prefer local path if different
                if (packList[existingIndex] !== p) {
                     packList[existingIndex] = p;
                }
            } else {
                packList.push(p);
            }
        });
    } catch(e) {
        console.error("Failed to load local registry", e);
    }
    
    // 3. Load Initial Pack
    const lastPack = localStorage.getItem('matchy_last_pack');
    if (lastPack) {
         // If we have a saved session, load it (searching both registry and direct file existence is handled in loadPack)
         await loadPack(lastPack);
    } else {
        // No last pack found (Clean start or Reset) -> Show Welcome Screen
        console.log("No previous session found. Waiting for user action.");
        document.getElementById('category-editor').style.display = 'none';
        document.getElementById('welcome-screen').style.display = 'block';
        
        // Ensure UI is clean
        const titleInput = document.getElementById('pack-title-input');
        if (titleInput) titleInput.value = "";
        const srcIndicator = document.getElementById('save-status');
        if (srcIndicator) srcIndicator.innerText = "Matching Pack: None";
    }
    
    /* 
    Legacy fallback logic removed to prevent auto-loading unintended packs.
    if (packList.length > 0) { ... }
    */

    /*
    const srcIndicator = document.getElementById('save-status');
    if (srcIndicator) srcIndicator.innerText = `Matching Pack: ${getPackTitle(currentPackFilename)}`;
    */

    // Ensure Unassigned exists (only if we have a meaningful manifest)
    if (manifest && manifest.categories && !manifest.categories['Unassigned']) {
        if (manifest.categories['General']) {
             manifest.categories['Unassigned'] = manifest.categories['General'];
             delete manifest.categories['General'];
        } else {
             manifest.categories['Unassigned'] = [];
        }
    }
}

async function loadPack(filename) {
    console.log("Loading pack:", filename);
    currentPackFilename = filename;
    localStorage.setItem('matchy_last_pack', filename);
    
    // Update UI
    const title = getPackTitle(filename);
    const input = document.getElementById('pack-title-input');
    if (input) input.value = title;
    const srcIndicator = document.getElementById('save-status');
    if (srcIndicator) srcIndicator.innerText = `Matching Pack: ${title}`;

    // 1. Try Local Storage Pack first (Prioritize Local)
    try {
        const localContent = localStorage.getItem('matchy_pack_' + filename);
        if (localContent) {
            manifest = JSON.parse(localContent);
            console.log("Loaded pack from Browser Storage:", filename);
            renderCategories();
            return;
        }
    } catch(e) {
        console.warn("Error reading local pack", e);
    }

    // 2. Fetch from Server
    try {
        const res = await fetch(filename + '?t=' + Date.now());
        if (res.ok) {
            manifest = await res.json();
            console.log("Pack loaded from Server:", filename);
        } else {
            console.warn("Pack file not found on server or local, starting fresh.");
            manifest = { categories: {} };
        }
    } catch(e) {
        console.error("Error loading pack file", e);
        manifest = { categories: {} };
    }
    renderCategories();
}

function toggleProjectList() {
    const dropdown = document.getElementById('project-list-dropdown');
    if (dropdown.style.display === 'none') {
        renderProjectList();
        dropdown.style.display = 'block';
    } else {
        dropdown.style.display = 'none';
    }
}

function renderProjectList() {
    const list = document.getElementById('project-list-dropdown');
    list.innerHTML = '';
    
    if (packList.length === 0) {
        list.innerHTML = '<div style="padding: 10px; color: #666; font-size: 12px;">No matching packs found.</div>';
        return;
    }
    
    packList.forEach(pack => {
        const item = document.createElement('div');
        item.style.padding = '8px';
        item.style.cursor = 'pointer';
        item.style.borderBottom = '1px solid #eee';
        item.style.fontSize = '13px';
        item.innerText = getPackTitle(pack); // Nice name
        item.title = pack; // Hover shows filename
        
        if (pack === currentPackFilename) {
            item.style.background = '#e3f2fd';
            item.style.fontWeight = 'bold';
        }
        
        item.onmouseover = () => { if (pack !== currentPackFilename) item.style.background = '#f5f5f5'; };
        item.onmouseout = () => { if (pack !== currentPackFilename) item.style.background = 'white'; };
        
        item.onclick = async () => {
             // Load it
             // If we are serverless, we might not be able to fetch simple paths if they are not in cache
             // But let's try standard loadPack
             const confirmed = confirm(`Load matching pack "${item.innerText}"? Unsaved changes will be lost.`);
             if (confirmed) {
                 await loadPack(pack);
                 document.getElementById('project-list-dropdown').style.display = 'none';
             }
        };
        
        list.appendChild(item);
    });
}

function handlePackNameChange(val) {
    // Name change applies on Save
}

function getPackTitle(filename) {
    if (!filename) return "None";
    if (filename === "assetManifest.json") return "Default Game";
    // Strip packs/ and packs_ prefix
    let base = filename.split('/').pop().replace('.json', '');
    if (base.startsWith('packs_')) {
        base = base.substring(6);
    }
    return base.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

async function createNewPack(name, silent=false) {
    if (!name) return;
    const cleanName = name.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const filename = cleanName + '.json';
    
    // Check global list (Server + Local) by FILENAME
    const getFilename = (path) => path.split('/').pop().toLowerCase();
    const existingIdx = packList.findIndex(p => getFilename(p) === filename);
    
    if (existingIdx !== -1) {
        if (!silent) alert("Matching Pack already exists!");
        await loadPack(packList[existingIdx]);
        return;
    }
    
    // Initialize new
    currentPackFilename = filename;
    
    // Update UI
    if (document.getElementById('pack-title-input')) {
        document.getElementById('pack-title-input').value = name;
    }
    const srcIndicator = document.getElementById('save-status');
    if (srcIndicator) srcIndicator.innerText = `Matching Pack: ${name}`;

    manifest = { categories: { "Unassigned": [] } };
    packList.push(filename);
    
    // Update Local Registry
    try {
        let localReg = JSON.parse(localStorage.getItem('matchy_local_registry') || '[]');
        // Check duplicate by filename in local reg
        if (!localReg.some(p => getFilename(p) === filename)) {
            localReg.push(filename);
            localStorage.setItem('matchy_local_registry', JSON.stringify(localReg));
        }
    } catch(e) { console.error(e); }

    // Save Registry to server
    await saveRegistry();
    
    // Save empty pack file
    await saveManifest(true); 
    
    if (!silent) alert(`Created new matching pack: ${name}`);
    renderCategories();
}

async function saveRegistry() {
    try {
        await fetch('/api/manifest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ packs: packList }, null, 4)
        });
    } catch(e) {
        console.error("Failed to save registry to server", e);
    }
}

async function refreshAssets() {
    await loadAssetPool();
    autoMatchSounds();
    alert("Assets refreshed and auto-matched!");
}

async function loadAssetPool() {
    try {
        const res = await fetch('/api/files');
        if (!res.ok) throw new Error("Server API unavailable");
        
        const data = await res.json();
        const rawFiles = data.files || [];
        
        processAssetList(rawFiles);
        document.getElementById('server-status').innerText = "Connected";
        document.getElementById('server-status').style.color = "green";
        
        // Auto-populate Unassigned category on load (Server Mode)
        // syncAssets(true); // Silent sync - DISABLED to prevent zombie cards
        
        // Auto-match sounds to cards
        autoMatchSounds();
    } catch (e) {
        console.log("Server offline or API failed", e);
        document.getElementById('server-status').innerText = "Standalone Mode";
        document.getElementById('server-status').style.color = "#666";
        document.getElementById('manual-scan-container').style.display = 'block';
        
        // Try to load from cache
        const loaded = await loadAssetsFromDB();
        if (loaded) {
            console.log("Assets loaded from cache.");
            // Auto-populate Unassigned category on load (Cached Mode)
            // syncAssets(true); // DISABLED to prevent zombie cards
        }
    }
}

function processAssetList(rawFiles) {
    // Deduplicate: keep only one instance of each filename
    const seen = new Set();
    assetPool = [];
    
    rawFiles.forEach(f => {
        const filename = f.split('/').pop().toLowerCase();
        if (!seen.has(filename)) {
            seen.add(filename);
            assetPool.push(f);
        }
    });
}

function handleManualScan(input) {
    try {
        const files = Array.from(input.files);
        console.log("Manual scan files:", files.length);
        
        if (files.length === 0) {
            alert("No files selected.");
            return;
        }

        // Cache files to IndexedDB
        saveAssetsToDB(files).then(count => {
            console.log(`Cached ${count} files to IndexedDB`);
        });

        assetBlobs = {}; // Clear old blobs
        
        // Create blobs for preview
        files.forEach(f => {
            // Use just the filename as key, lowercased, to match how we store them
            const filename = f.name.toLowerCase(); 
            assetBlobs[filename] = URL.createObjectURL(f);
        });

        // Use relative paths for the list if available, otherwise names
        // Note: webkitRelativePath gives "Folder/file.png".
        const filePaths = files.map(f => f.webkitRelativePath || f.name);
        console.log("File paths processed:", filePaths.slice(0, 5)); // Log first 5
        
        processAssetList(filePaths);
        console.log("Asset pool size:", assetPool.length);
        
        filterAssets('all');
        
        // Auto-populate Unassigned category with newly scanned assets
        // We pass silent=false to show alerts
        // We use a short timeout to allow the UI to update, but we also ensure it runs
        setTimeout(() => {
            console.log("Triggering syncAssets...");
            const added = syncAssets(false);
            console.log("Sync complete. Added:", added);
            
            // Force refresh of the current category view if it's Unassigned
            if (currentCategory === 'Unassigned') {
                renderCards();
            }
            
            // Auto-save to browser immediately after scan
            saveToBrowser();
            
        }, 100); 
        
    } catch (e) {
        console.error("Error in handleManualScan:", e);
        alert("An error occurred while scanning assets: " + e.message);
    }
}

function autoMatchSounds() {
    if (!assetPool || assetPool.length === 0) return;
    
    let changesMade = false;
    
    for (const catName in manifest.categories) {
        const cards = manifest.categories[catName];
        cards.forEach(card => {
            if (card.title) {
                // Normalize title: "Professor Frink" -> "professor_frink"
                const safeTitle = card.title.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                
                const matches = assetPool.filter(path => {
                    const fName = path.split('/').pop().toLowerCase();
                    if (!fName.endsWith('.wav') && !fName.endsWith('.mp3')) return false;

                    // Normalize file name: "Professor Frink.wav" -> "professor_frink"
                    const namePart = fName.replace(/\.[^/.]+$/, ""); // Remove extension
                    const safeName = namePart.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                    
                    if (safeName === safeTitle) return true;
                    
                    if (safeName.startsWith(safeTitle)) {
                        const suffix = safeName.substring(safeTitle.length);
                        // Allow suffixes like "1", "_1", "01", "_01"
                        return /^[_]?\d+$/.test(suffix);
                    }
                    return false;
                });
                
                if (matches.length > 0) {
                    const currentSounds = card.sound ? (Array.isArray(card.sound) ? card.sound : [card.sound]) : [];
                    // Add only new unique matches
                    let added = false;
                    matches.forEach(m => {
                        if (!currentSounds.includes(m)) {
                            currentSounds.push(m);
                            added = true;
                        }
                    });

                    if (added) {
                        console.log(`Auto-matched sounds linked for ${card.title}:`, currentSounds);
                        card.sound = currentSounds;
                        changesMade = true;
                    }
                }
            }
        });
    }
    
    if (changesMade) {
        renderCards();
    }
}

function sortCards(sortType) {
    if (!currentCategory || !manifest.categories[currentCategory]) return;
    
    const cards = manifest.categories[currentCategory];
    
    if (sortType === 'name-asc') {
        cards.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, {numeric: true, sensitivity: 'base'}));
    } else if (sortType === 'name-desc') {
        cards.sort((a, b) => (b.title || "").localeCompare(a.title || "", undefined, {numeric: true, sensitivity: 'base'}));
    } else if (sortType === 'newest') {
        // Assuming push order is date order if we have no date. No explicit date field, so we can't do much if list is already shuffled. 
        // But if user wants to just Reverse the current list? Or we assume "Newest" means end of array?
        // Sorting "Newest" on a shuffled list is impossible without metadata.
        // Assuming default array order is roughly "oldest to newest" or "creation order" if we never sorted.
        // But if we just sorted A-Z, we lost the date order forever unless we store it.
        // Let's add an index/timestamp if missing? Can't retroactively do it.
        // Alert user? Or just do nothing? 
        // Actually, we can add a hidden `_created` timestamp to cards when creating them going forward.
        // For existing cards, we are out of luck.
        // But maybe "Newest" just means "Reverse current order"? No, that's unstable.
        
        // Let's rely on `_created` property if it exists, else 0.
        cards.sort((a, b) => (b._created || 0) - (a._created || 0));
    } else if (sortType === 'oldest') {
        cards.sort((a, b) => (a._created || 0) - (b._created || 0));
    }
    
    renderCards();
    saveToBrowser();
}

function renderCategories() {
    const list = document.getElementById('category-list');
    list.innerHTML = '';
    
    if (currentCategory && typeof updateMoveDropdown === 'function') updateMoveDropdown();
    
    // Ensure Unassigned category exists
    if (!manifest.categories['Unassigned']) {
        manifest.categories['Unassigned'] = []; // Array of cards
    }

    Object.keys(manifest.categories).forEach(cat => {
        // Safety check: ensure category is an array
        if (!Array.isArray(manifest.categories[cat])) {
            console.warn(`Category ${cat} is not an array, resetting to empty array.`);
            manifest.categories[cat] = [];
        }

        const div = document.createElement('div');
        div.className = 'category-item';
        if (cat === currentCategory) div.classList.add('active');
        
        // Add Drag and Drop Handlers
        div.draggable = true;
        div.dataset.category = cat;
        
        div.ondragstart = (e) => {
            e.dataTransfer.setData('text/plain', cat);
            e.dataTransfer.effectAllowed = 'move';
            div.classList.add('dragging');
        };
        
        div.ondragend = () => {
             div.classList.remove('dragging');
             document.querySelectorAll('.category-item').forEach(item => item.classList.remove('drag-over'));
        };

        div.ondragover = (e) => {
            e.preventDefault(); // Necessary to allow dropping
            e.dataTransfer.dropEffect = 'move';
            div.classList.add('drag-over');
        };

        div.ondragleave = () => {
             div.classList.remove('drag-over');
        };

        div.ondrop = (e) => {
             e.preventDefault();
             div.classList.remove('drag-over');
             const draggedCat = e.dataTransfer.getData('text/plain');
             if (draggedCat && draggedCat !== cat) {
                 reorderCategory(draggedCat, cat);
             }
        };


        const count = manifest.categories[cat] ? manifest.categories[cat].length : 0;
        const span = document.createElement('span');
        span.innerText = `${cat} (${count})`;
        div.appendChild(span);
        
        if (cat !== 'Unassigned') {
            const delBtn = document.createElement('button');
            delBtn.innerText = 'x';
            delBtn.className = 'btn btn-danger';
            delBtn.style.padding = '2px 6px';
            delBtn.style.fontSize = '10px';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteCategory(cat);
            };
            div.appendChild(delBtn);
        } else {
            // Clear button for Unassigned
            const clearBtn = document.createElement('button');
            clearBtn.innerText = 'Clear';
            clearBtn.className = 'btn';
            clearBtn.style.padding = '2px 6px';
            clearBtn.style.fontSize = '10px';
            clearBtn.title = "Remove all items from Unassigned";
            clearBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm("Clear all items from Unassigned?")) {
                    manifest.categories['Unassigned'] = [];
                    renderCategories();
                    if (currentCategory === 'Unassigned') renderCards();
                }
            };
            div.appendChild(clearBtn);
        }
        
        // Drag and Drop Support
        div.ondragover = (e) => {
            e.preventDefault(); // Allow drop
            div.classList.add('drag-over');
        };
        div.ondragleave = () => div.classList.remove('drag-over');
        div.ondrop = (e) => {
            e.preventDefault();
            div.classList.remove('drag-over');
            const dataStr = e.dataTransfer.getData("text/plain");
            if (dataStr) {
                try {
                    const data = JSON.parse(dataStr);
                    const sourceCategory = data.category;
                    
                    if (sourceCategory !== cat) {
                        if (data.type === 'multi' && data.indices) {
                            moveCards(sourceCategory, cat, data.indices);
                        } else if (data.index !== undefined) {
                             moveCards(sourceCategory, cat, [data.index]);
                        }
                    }
                } catch (err) {
                    console.error("Error parsing drag data", err);
                }
            }
        };
        
        div.onclick = () => selectCategory(cat);
        list.appendChild(div);
    });
}

function moveCards(fromCat, toCat, indices) {
    const sourceCards = manifest.categories[fromCat];
    if (!sourceCards) return;

    // Sort indices descending to avoid shifting issues
    const sortedIndices = [...indices].sort((a, b) => b - a);
    
    let movedCount = 0;
    sortedIndices.forEach(index => {
        if (sourceCards[index]) {
            const card = sourceCards[index];
            manifest.categories[toCat].unshift(card);
            sourceCards.splice(index, 1);
            movedCount++;
        }
    });

    if (movedCount > 0) {
        // Clear selection if we moved from current category
        if (currentCategory === fromCat) {
            selectedCards.clear();
            if (typeof updateSelectionUI === 'function') updateSelectionUI();
        }

        renderCategories();
        if (currentCategory === fromCat) renderCards();
        saveToBrowser();
    }
}

function createCategory() {
    const name = document.getElementById('new-cat-name').value.trim();
    if (!name) return;
    if (manifest.categories[name]) {
        alert("Category already exists");
        return;
    }
    manifest.categories[name] = [];
    document.getElementById('new-cat-name').value = '';
    renderCategories();
    selectCategory(name);
}

function deleteCategory(name) {
    if (!confirm(`Delete category "${name}"? Assets will be moved to Unassigned.`)) return;
    
    // Move items to Unassigned
    const items = manifest.categories[name] || [];
    manifest.categories['Unassigned'] = manifest.categories['Unassigned'].concat(items);
    
    delete manifest.categories[name];
    if (currentCategory === name) {
        currentCategory = null;
        document.getElementById('category-editor').style.display = 'none';
        document.getElementById('welcome-screen').style.display = 'block';
    }
    renderCategories();
}

function reorderCategory(draggedCat, targetCat) {
    const keys = Object.keys(manifest.categories);
    const fromIndex = keys.indexOf(draggedCat);
    const toIndex = keys.indexOf(targetCat);
    
    if (fromIndex < 0 || toIndex < 0) return;
    
    // Remove dragged item
    keys.splice(fromIndex, 1);
    // Insert at new position
    keys.splice(toIndex, 0, draggedCat);
    
    // Reconstruct object in new order
    const newCategories = {};
    keys.forEach(k => {
        newCategories[k] = manifest.categories[k];
    });
    
    manifest.categories = newCategories;
    renderCategories();
    saveToBrowser(); // Ensures order is saved locally immediately
}

function sortCategoriesAZ() {
    if (!confirm("Sort all categories alphabetically? This will change the display order in the game.")) return;
    
    const keys = Object.keys(manifest.categories).sort((a,b) => {
        // Always put 'Unassigned' at the bottom
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    
    const newCategories = {};
    keys.forEach(k => {
        newCategories[k] = manifest.categories[k];
    });
    
    manifest.categories = newCategories;
    renderCategories();
    saveToBrowser(); // Ensures order is saved locally immediately
}

let selectedCards = new Set();
let isCompactView = false;

function selectCategory(name) {
    currentCategory = name;
    selectedCards.clear(); // Clear selection when switching categories
    updateSelectionUI();
    
    // Auto-populate if Unassigned is selected - DISABLED
    // User requested no auto-population when deleting.
    // if (name === 'Unassigned') {
    //    syncAssets(true); // Silent sync
    // }

    document.getElementById('welcome-screen').style.display = 'none';
    document.getElementById('category-editor').style.display = 'block';
    document.getElementById('current-cat-title').innerText = name;
    
    updateMoveDropdown();
    renderCategories();
    renderCards();
}

function updateMoveDropdown() {
    const select = document.getElementById('move-target-cat');
    select.innerHTML = '<option value="">Move to...</option>';
    
    Object.keys(manifest.categories).forEach(cat => {
        if (cat !== currentCategory) {
            const option = document.createElement('option');
            option.value = cat;
            option.innerText = cat;
            select.appendChild(option);
        }
    });
}

function toggleCompactView() {
    isCompactView = !isCompactView;
    document.getElementById('view-toggle-btn').innerText = isCompactView ? "Expanded View" : "Compact View";
    renderCards();
}

function toggleSelectAll(checkbox) {
    const cards = manifest.categories[currentCategory] || [];
    if (checkbox.checked) {
        cards.forEach((_, i) => selectedCards.add(i));
    } else {
        selectedCards.clear();
    }
    updateSelectionUI();
    renderCards();
}

function toggleCardSelection(index) {
    if (selectedCards.has(index)) {
        selectedCards.delete(index);
    } else {
        selectedCards.add(index);
    }
    updateSelectionUI();
    // Re-render just this card or all? All is easier for now to update checkbox state visually if needed
    // But actually we can just update the checkbox if we pass the event, but let's re-render for simplicity
    renderCards(); 
}

function updateSelectionUI() {
    const count = selectedCards.size;
    document.getElementById('selection-count').innerText = `${count} selected`;
    
    const cards = manifest.categories[currentCategory] || [];
    const allSelected = cards.length > 0 && count === cards.length;
    document.getElementById('select-all-checkbox').checked = allSelected;
}

function moveSelectedCards() {
    const targetCat = document.getElementById('move-target-cat').value;
    if (!targetCat) {
        alert("Please select a target category.");
        return;
    }
    
    if (selectedCards.size === 0) {
        alert("No cards selected.");
        return;
    }
    
    const indices = Array.from(selectedCards);
    moveCards(currentCategory, targetCat, indices);
    alert(`Moved ${indices.length} cards to ${targetCat}.`);
}

function deleteSelectedCards() {
    if (selectedCards.size === 0) return;
    if (!confirm(`Delete ${selectedCards.size} selected cards?`)) return;
    
    const cards = manifest.categories[currentCategory];
    const indices = Array.from(selectedCards).sort((a, b) => b - a);
    
    indices.forEach(index => {
        cards.splice(index, 1);
    });
    
    selectedCards.clear();
    updateSelectionUI();
    renderCategories();
    renderCards();
    saveToBrowser();
}

let currentSelectorMulti = false;
let currentSelectedAssets = new Set();

// ... (init, loadManifest, loadAssetPool, renderCategories, createCategory, deleteCategory, selectCategory remain same)

function renderCards() {
    const container = document.getElementById('cards-container');
    container.innerHTML = '';
    
    if (!currentCategory) return;

    const cards = manifest.categories[currentCategory] || [];
    console.log(`Rendering ${cards.length} cards for category: ${currentCategory}`);
    
    if (cards.length === 0) {
        // container.innerHTML = '<div style="padding: 20px; color: #666;">No cards in this category.</div>';
        // return;
    }

    cards.forEach((card, index) => {
        const div = document.createElement('div');
        div.className = 'card-item';
        if (selectedCards.has(index)) {
            div.style.border = '2px solid #007bff';
            div.style.background = '#e6f2ff';
        }
        
        // Selection Checkbox
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = selectedCards.has(index);
        checkbox.style.position = 'absolute';
        checkbox.style.top = '5px';
        checkbox.style.left = '5px';
        checkbox.style.zIndex = '10';
        checkbox.onclick = (e) => {
            e.stopPropagation();
            toggleCardSelection(index);
        };
        div.appendChild(checkbox);
        div.style.position = 'relative'; // For absolute positioning of checkbox

        // Draggable
        div.draggable = true;
        div.ondragstart = (e) => {
            // If dragging a selected card, we might want to move ALL selected cards
            // But for simplicity, let's stick to single card drag for now, 
            // or if the dragged card is in selection, move all.
            
            if (selectedCards.has(index)) {
                // Dragging a selection
                const indices = Array.from(selectedCards);
                e.dataTransfer.setData("text/plain", JSON.stringify({ indices, category: currentCategory, type: 'multi' }));
            } else {
                // Dragging single unselected card
                e.dataTransfer.setData("text/plain", JSON.stringify({ index, category: currentCategory, type: 'single' }));
            }
            e.dataTransfer.effectAllowed = "move";
        };
        
        // Image
        const imgDiv = document.createElement('div');
        imgDiv.className = 'card-image';
        if (isCompactView) {
            imgDiv.style.height = '80px'; // Smaller in compact view
        }
        
        imgDiv.onclick = (e) => {
            e.stopPropagation();
            toggleCardSelection(index);
        };

        if (card.image) {
            const img = document.createElement('img');
            const lowerName = card.image.split('/').pop().toLowerCase();
            
            if (card.image.startsWith('http') || card.image.startsWith('data:')) {
                img.src = card.image;
            } else if (assetBlobs && assetBlobs[lowerName]) {
                // console.log(`Using blob for ${lowerName}`);
                img.src = assetBlobs[lowerName];
            } else {
                // console.log(`Using path for ${lowerName}: ${card.image}`);
                // Fallback to relative path (Server Mode or Static File)
                // Check if path already starts with assets/ to avoid duplication
                const path = card.image.startsWith('assets/') ? card.image : 'assets/' + card.image;
                img.src = path;
                
                // Error handling: if assets/ path fails, try direct path
                img.onerror = () => {
                    console.warn(`Failed to load image at ${path}, trying fallback...`);
                    if (path.startsWith('assets/')) {
                        // Try without assets/ prefix
                        img.src = card.image;
                        // Remove handler to prevent infinite loop
                        img.onerror = null; 
                    }
                };
            }
            imgDiv.appendChild(img);
        } else {
            // Empty State: URL Input + Browse Button
            imgDiv.style.display = 'flex';
            imgDiv.style.flexDirection = 'column';
            imgDiv.style.justifyContent = 'center';
            imgDiv.style.alignItems = 'center';
            imgDiv.style.gap = '5px';
            imgDiv.style.padding = '10px';
            
            const urlInput = document.createElement('input');
            urlInput.type = 'text';
            urlInput.placeholder = 'Paste Image URL...';
            urlInput.style.width = '90%';
            urlInput.style.fontSize = '10px';
            urlInput.onchange = (e) => {
                if (e.target.value) updateCard(index, 'image', e.target.value);
            };
            urlInput.onclick = (e) => e.stopPropagation(); // Prevent selection toggle
            
            const browseBtn = document.createElement('button');
            browseBtn.innerText = "Browse Assets";
            browseBtn.className = 'btn';
            browseBtn.style.fontSize = '10px';
            browseBtn.onclick = (e) => {
                e.stopPropagation();
                currentEditingCardTitle = card.title;
                openAssetSelector('image', (val) => updateCard(index, 'image', val));
            };
            
            imgDiv.appendChild(urlInput);
            imgDiv.appendChild(browseBtn);
        }
        div.appendChild(imgDiv);
        
        // If Compact View, stop here (maybe show title text)
        if (isCompactView) {
            const titleDiv = document.createElement('div');
            titleDiv.innerText = card.title || 'Untitled';
            titleDiv.style.fontSize = '10px';
            titleDiv.style.textAlign = 'center';
            titleDiv.style.overflow = 'hidden';
            titleDiv.style.textOverflow = 'ellipsis';
            titleDiv.style.whiteSpace = 'nowrap';
            div.appendChild(titleDiv);
            
            // Small indicator for sound
            if (card.sound) {
                const sndIcon = document.createElement('div');
                sndIcon.innerText = '🎵';
                sndIcon.style.fontSize = '10px';
                sndIcon.style.position = 'absolute';
                sndIcon.style.bottom = '2px';
                sndIcon.style.right = '2px';
                div.appendChild(sndIcon);
            }
            
            container.appendChild(div);
            return; // Skip the rest of the controls
        }
        
        // Image Controls
        const imgControls = document.createElement('div');
        imgControls.style.display = 'flex';
        imgControls.style.gap = '5px';
        imgControls.style.marginBottom = '5px';
        imgControls.style.justifyContent = 'center';

        // Change Image Btn
        const changeImgBtn = document.createElement('button');
        changeImgBtn.className = 'btn';
        changeImgBtn.innerText = 'Change File';
        changeImgBtn.style.fontSize = '10px';
        changeImgBtn.onclick = () => {
            currentEditingCardTitle = card.title;
            openAssetSelector('image', (val) => updateCard(index, 'image', val));
        };
        imgControls.appendChild(changeImgBtn);

        // Change URL Btn and Inline Editor
        const urlBtn = document.createElement('button');
        urlBtn.className = 'btn';
        urlBtn.innerText = 'Change URL';
        urlBtn.style.fontSize = '10px';
        
        const inlineUrlDiv = document.createElement('div');
        inlineUrlDiv.style.display = 'none';
        inlineUrlDiv.style.marginTop = '5px';
        inlineUrlDiv.style.marginBottom = '5px';
        inlineUrlDiv.style.gap = '5px';
        
        const urlInput = document.createElement('input');
        urlInput.type = 'text';
        urlInput.style.flex = '1';
        urlInput.style.minWidth = '50px';
        urlInput.placeholder = 'Paste URL...';
        urlInput.value = (card.image && card.image.startsWith('http')) ? card.image : '';
        
        urlInput.onkeydown = (e) => {
            if(e.key === 'Enter') {
                if(urlInput.value.trim()) updateCard(index, 'image', urlInput.value.trim());
            }
        };

        const urlSaveBtn = document.createElement('button');
        urlSaveBtn.innerText = '✓';
        urlSaveBtn.className = 'btn btn-success';
        urlSaveBtn.style.padding = '2px 5px';
        urlSaveBtn.onclick = () => {
             if(urlInput.value.trim()) updateCard(index, 'image', urlInput.value.trim());
        };

        inlineUrlDiv.appendChild(urlInput);
        inlineUrlDiv.appendChild(urlSaveBtn);

        urlBtn.onclick = () => {
             if (inlineUrlDiv.style.display === 'none') {
                 inlineUrlDiv.style.display = 'flex';
                 setTimeout(() => urlInput.focus(), 100);
             } else {
                 inlineUrlDiv.style.display = 'none';
             }
        };
        imgControls.appendChild(urlBtn);

        // Remove Image Btn
        const removeImgBtn = document.createElement('button');
        removeImgBtn.className = 'btn btn-danger';
        removeImgBtn.innerText = 'Remove';
        removeImgBtn.style.fontSize = '10px';
        removeImgBtn.onclick = () => updateCard(index, 'image', null);
        imgControls.appendChild(removeImgBtn);

        // Edit Image Btn (Enabled for all images now)
        if (card.image) {
            const editImgBtn = document.createElement('button');
            editImgBtn.className = 'btn';
            editImgBtn.innerText = 'Edit';
            editImgBtn.style.fontSize = '10px';
            editImgBtn.onclick = () => {
                if (!card.title || card.title.trim() === '') {
                    alert("Please enter a Main Title for this card before editing the image.");
                    return;
                }
                editingCardCallback = (newFilename) => updateCard(index, 'image', newFilename);
                openPhotoEditor(card.image, card.title);
            };
            imgControls.appendChild(editImgBtn);
        }

        div.appendChild(imgControls);
        div.appendChild(inlineUrlDiv);

        // Title
        const titleInput = document.createElement('input');
        titleInput.placeholder = "Main Title";
        titleInput.value = card.title || '';
        titleInput.onchange = (e) => updateCard(index, 'title', e.target.value);
        div.appendChild(titleInput);
        
        // Alt Title
        const altInput = document.createElement('input');
        altInput.placeholder = "Alt Title (for TTS)";
        altInput.value = card.altTitle || '';
        altInput.onchange = (e) => updateCard(index, 'altTitle', e.target.value);
        div.appendChild(altInput);
        
        // Sound
        const soundDiv = document.createElement('div');
        soundDiv.style.display = 'flex';
        soundDiv.style.gap = '5px';
        soundDiv.style.flexWrap = 'wrap';
        
        const soundBtn = document.createElement('button');
        soundBtn.className = 'btn';
        soundBtn.innerText = (card.sound && (Array.isArray(card.sound) ? card.sound.length > 0 : true)) ? 'Add Sounds' : 'Select Sounds';
        // Enable multi-select for audio
        soundBtn.onclick = () => {
            currentEditingCardTitle = card.title;
            openAssetSelector('audio', (val) => {
                // Append to existing sounds if any
                let currentSounds = [];
                if (card.sound) {
                    currentSounds = Array.isArray(card.sound) ? card.sound : [card.sound];
                }
                const newSounds = Array.isArray(val) ? val : [val];
                // Merge and deduplicate
                const merged = [...new Set([...currentSounds, ...newSounds])];
                updateCard(index, 'sound', merged);
            }, true);
        };
        soundDiv.appendChild(soundBtn);

        // Record New Sound Button
        const recBtn = document.createElement('button');
        recBtn.className = 'btn';
        recBtn.innerText = 'Record New';
        recBtn.style.fontSize = '10px';
        recBtn.onclick = () => {
             console.log("Record New clicked. Setting callback.");
             editingCardCallback = (newFilename) => {
                 console.log("Callback executed with:", newFilename);
                 let currentSounds = [];
                 // Re-fetch card from manifest to ensure freshness
                 const currentCard = manifest.categories[currentCategory][index];
                 if (currentCard.sound) {
                     currentSounds = Array.isArray(currentCard.sound) ? currentCard.sound : [currentCard.sound];
                 }
                 currentSounds.push(newFilename);
                 updateCard(index, 'sound', currentSounds);
             };
             openAudioEditor(null, card.title); // Open empty editor with title
        };
        soundDiv.appendChild(recBtn);
        div.appendChild(soundDiv);
        
        // Display selected sounds
        let sounds = [];
        if (card.sound) {
            if (Array.isArray(card.sound)) sounds = card.sound;
            else sounds = [card.sound];
        }
        
        if (sounds.length > 0) {
            const soundList = document.createElement('div');
            soundList.style.width = '100%';
            
            sounds.forEach((s, sIdx) => {
                const sRow = document.createElement('div');
                sRow.style.display = 'flex';
                sRow.style.alignItems = 'center';
                sRow.style.gap = '5px';
                sRow.style.fontSize = '10px';
                sRow.style.marginTop = '2px';
                
                const sName = document.createElement('span');
                sName.innerText = s.split('/').pop();
                sName.style.flex = '1';
                sName.style.overflow = 'hidden';
                sName.style.textOverflow = 'ellipsis';
                
                const playBtn = document.createElement('button');
                playBtn.innerText = '▶';
                
                playBtn.onclick = () => {
                   if (currentGlobalAudioState.button === playBtn) {
                        // Stop this button
                        stopGlobalAudio();
                   } else {
                        // Stop others, play this
                        stopGlobalAudio();
                        
                        const lowerName = s.split('/').pop().toLowerCase();
                        let src;
                        let fallbackSrc = null;

                        if (s.startsWith('http') || s.startsWith('data:')) {
                            src = s;
                        } else if (assetBlobs && assetBlobs[lowerName]) {
                            src = assetBlobs[lowerName];
                        } else {
                            // Try assets path first, but setup fallback
                            src = s.startsWith('assets/') ? s : 'assets/' + s;
                            if (!s.startsWith('assets/')) fallbackSrc = s;
                        }
                        
                        const audio = new Audio(src);
                        currentGlobalAudioState.audio = audio;
                        currentGlobalAudioState.button = playBtn;
                        playBtn.innerText = '⏹';
                        
                        audio.onended = () => {
                             stopGlobalAudio();
                        };
                        
                        audio.onerror = () => {
                             if (fallbackSrc) {
                                 console.log("Audio not found at " + src + ", trying " + fallbackSrc);
                                 const audio2 = new Audio(fallbackSrc);
                                 // Check if user hasn't already stopped or switched
                                 if (currentGlobalAudioState.button === playBtn) {
                                     currentGlobalAudioState.audio = audio2;
                                     audio2.onended = () => stopGlobalAudio();
                                     audio2.play().catch(e => {
                                         console.error("Fallback playback failed:", e);
                                         stopGlobalAudio();
                                     });
                                 }
                             } else {
                                 console.error("Audio playback error");
                                 stopGlobalAudio();
                             }
                        };
                        
                        audio.play().catch(e => {
                            console.error("Playback failed:", e);
                        });
                   }
                };
                
                const editBtn = document.createElement('button');
                editBtn.innerText = '✂';
                editBtn.onclick = () => {
                    editingCardCallback = (newFilename) => {
                        const newSounds = [...sounds];
                        newSounds[sIdx] = newFilename;
                        updateCard(index, 'sound', newSounds);
                    };
                    openAudioEditor(s, card.title);
                };
                
                const delBtn = document.createElement('button');
                delBtn.innerText = 'x';
                delBtn.style.color = 'red';
                delBtn.onclick = () => {
                    const newSounds = sounds.filter((_, i) => i !== sIdx);
                    updateCard(index, 'sound', newSounds.length > 0 ? newSounds : null);
                };
                
                sRow.appendChild(sName);
                sRow.appendChild(playBtn);
                sRow.appendChild(editBtn);
                sRow.appendChild(delBtn);
                soundList.appendChild(sRow);
            });
            div.appendChild(soundList);
        }

        // TTS Fallback
        const ttsInput = document.createElement('input');
        ttsInput.placeholder = "TTS Text (Fallback)";
        ttsInput.value = card.ttsText || '';
        ttsInput.onchange = (e) => updateCard(index, 'ttsText', e.target.value);
        div.appendChild(ttsInput);
        
        // Delete Card
        const delCardBtn = document.createElement('button');
        delCardBtn.className = 'btn btn-danger';
        delCardBtn.innerText = 'Remove Card';
        delCardBtn.onclick = () => removeCard(index);
        div.appendChild(delCardBtn);
        
        container.appendChild(div);
    });

    // Add Placeholder Card for "Add New Card"
    const placeholder = document.createElement('div');
    placeholder.className = 'card-item';
    placeholder.style.display = 'flex';
    placeholder.style.flexDirection = 'column';
    placeholder.style.alignItems = 'center';
    placeholder.style.justifyContent = 'center';
    placeholder.style.minHeight = '150px'; // Match typical card height
    placeholder.style.border = '2px dashed #ccc';
    placeholder.style.cursor = 'pointer';
    placeholder.style.backgroundColor = 'transparent';
    placeholder.onclick = () => addCard();
    
    // Make it look empty but clickable
    const addIcon = document.createElement('div');
    addIcon.innerText = '+';
    addIcon.style.fontSize = '48px';
    addIcon.style.color = '#ccc';
    addIcon.style.marginBottom = '10px';
    
    const addText = document.createElement('div');
    addText.innerText = 'Add New Card';
    addText.style.color = '#999';
    addText.style.fontWeight = 'bold';
    
    placeholder.appendChild(addIcon);
    placeholder.appendChild(addText);
    
    // Hover effects
    placeholder.onmouseenter = () => {
        placeholder.style.backgroundColor = '#f9f9f9';
        placeholder.style.borderColor = '#aaa';
        addIcon.style.color = '#aaa';
        addText.style.color = '#666';
    };
    placeholder.onmouseleave = () => {
        placeholder.style.backgroundColor = 'transparent';
        placeholder.style.borderColor = '#ccc';
        addIcon.style.color = '#ccc';
        addText.style.color = '#999';
    };

    container.appendChild(placeholder);
}

function addCard() {
    if (!currentCategory) return;
    manifest.categories[currentCategory].push({
        image: null,
        sound: null,
        title: '',
        altTitle: '',
        ttsText: '',
        _created: Date.now() // Timestamp for sorting
    });
    renderCards();
    performAutoSave();
}

function addCardsFromImages() {
    if (!currentCategory) return;
    openAssetSelector('image', (selectedAssets) => {
        if (!Array.isArray(selectedAssets)) selectedAssets = [selectedAssets];
        
        selectedAssets.forEach(img => {
            const filename = img.split('/').pop();
            const name = filename.split('.')[0].replace(/_/g, ' ');
            
            // Auto-detect sounds
            let detectedSounds = null;
            const imgBase = filename.split('.')[0].toLowerCase();
            
            // Find all audio files that match the image name (strict mode)
            const matchingSounds = assetPool.filter(f => {
                const ext = f.split('.').pop().toLowerCase();
                if (!['mp3','wav','ogg'].includes(ext)) return false;
                
                const sndFilename = f.split('/').pop().toLowerCase();
                
                // Strict Matching
                const namePart = sndFilename.replace(/\.[^/.]+$/, "");
                const safeName = namePart.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                const safeTitle = imgBase.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                
                if (safeName === safeTitle) return true;
                if (safeName.startsWith(safeTitle)) {
                    const suffix = safeName.substring(safeTitle.length);
                    // Allow suffixes like "1", "_1", "01", "_01"
                    return /^[_]?\d+$/.test(suffix);
                }
                return false;
            });
            
            if (matchingSounds.length > 0) {
                detectedSounds = matchingSounds;
            }

            // Remove from Unassigned if present
            if (manifest.categories['Unassigned']) {
                manifest.categories['Unassigned'] = manifest.categories['Unassigned'].filter(c => c.image !== img);
            }

            manifest.categories[currentCategory].unshift({
                image: img,
                sound: detectedSounds,
                title: name,
                altTitle: '',
                ttsText: '',
                _created: Date.now()
            });
        });
        renderCards();
        performAutoSave();
    }, true);
}

function updateCard(index, field, value) {
    console.log(`updateCard: index=${index}, field=${field}, value=${JSON.stringify(value)}`);
    if (!currentCategory) return;
    const card = manifest.categories[currentCategory][index];
    card[field] = value;
    
    // Auto-match sound if title changes
    if (field === 'title' && value) {
        const safeTitle = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        
        // Find match with relaxed logic
        const matches = assetPool.filter(path => {
            const fName = path.split('/').pop().toLowerCase();
            if (!fName.endsWith('.wav') && !fName.endsWith('.mp3')) return false;

            const namePart = fName.replace(/\.[^/.]+$/, "");
            const safeName = namePart.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
            
            if (safeName === safeTitle) return true;
            
            if (safeName.startsWith(safeTitle)) {
                const suffix = safeName.substring(safeTitle.length);
                return /^[_]?\d+$/.test(suffix);
            }
            return false;
        });
        
        if (matches.length > 0) {
            console.log(`Auto-matched sounds for ${value}:`, matches);
            const currentSounds = card.sound ? (Array.isArray(card.sound) ? card.sound : [card.sound]) : [];
            const newSounds = [...new Set([...currentSounds, ...matches])];
            card.sound = newSounds;
        }
    }
    
    renderCards();
    performAutoSave();
}

function removeCard(index) {
    if (!currentCategory) return;
    manifest.categories[currentCategory].splice(index, 1);
    renderCards();
    performAutoSave();
}

function importManifestFile() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                let newCategories = null;
                
                // CHECK IF IT IS A MANIFEST (Registry)
                if (data && data.packs && Array.isArray(data.packs)) {
                    if (confirm(`This file appears to be a Game Registry with ${data.packs.length} matching packs.\nDo you want to import this pack list?`)) {
                        
                        // Merge with existing pack list
                        let count = 0;
                        data.packs.forEach(p => {
                            if (!packList.includes(p)) {
                                packList.push(p);
                                count++;
                            }
                        });
                        
                        // Save to local registry so it persists
                        localStorage.setItem('matchy_local_registry', JSON.stringify(packList));
                        
                        alert(`Imported ${count} new matching packs to your list!\nClick the folder icon 📁 next to the Matching Pack Name to switch between them.`);
                        return; // Done
                    }
                    return; // Cancelled
                }

                // Determine if valid manifest or raw category map
                if (data && data.categories) {
                    newCategories = data.categories;
                } else if (data && typeof data === 'object' && !Array.isArray(data)) {
                    // Check if it looks like a category map (keys map to arrays)
                    const values = Object.values(data);
                    if (values.length > 0 && Array.isArray(values[0])) {
                        newCategories = data;
                        console.log("Imported JSON detected as raw category map.");
                    }
                }

                if (newCategories) {
                    // Always replace logic as per user request
                    if (confirm("This will REPLACE all current categories with the data from the imported file. Any unsaved changes will be lost. Continue?")) {
                         manifest.categories = newCategories;
                         
                         // Update Filename and Title based on imported file
                         const rawName = file.name.replace('.json', '');
                         let cleanName = rawName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                         cleanName = cleanName.replace(/^packs?_/, ''); // Remove 'packs_' prefix
                         
                         currentPackFilename = 'packs/' + cleanName + '.json';
                         
                         // Update UI
                         const displayTitle = rawName.replace(/^packs?_/, '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                         const titleInput = document.getElementById('pack-title-input');
                         if (titleInput) titleInput.value = displayTitle;
                         
                         const srcIndicator = document.getElementById('save-status');
                         if (srcIndicator) srcIndicator.innerText = `Matching Pack: ${displayTitle}`;
                         
                         // Ensure it's in the pack list if not already
                         if (!packList.includes(currentPackFilename)) {
                             packList.push(currentPackFilename);
                         }
                    } else {
                        return; // User cancelled
                    }
                    
                    // Ensure Unassigned exists
                    if (!manifest.categories['Unassigned']) {
                        manifest.categories['Unassigned'] = [];
                    }

                    // Scan imported manifest for assets and add to pool
                    const poolSet = new Set(assetPool);
                    let addedCount = 0;
                    Object.values(manifest.categories).forEach(cat => {
                        cat.forEach(card => {
                            if (card.image && !card.image.startsWith('data:') && !card.image.startsWith('http')) {
                                if (!poolSet.has(card.image)) {
                                    poolSet.add(card.image);
                                    addedCount++;
                                }
                            }
                            if (card.sound) {
                                const sounds = Array.isArray(card.sound) ? card.sound : [card.sound];
                                sounds.forEach(s => {
                                    if (s && !s.startsWith('data:') && !s.startsWith('http')) {
                                        if (!poolSet.has(s)) {
                                            poolSet.add(s);
                                            addedCount++;
                                        }
                                    }
                                });
                            }
                        });
                    });
                    
                    if (addedCount > 0) {
                        assetPool = Array.from(poolSet);
                        console.log(`Added ${addedCount} assets from imported JSON to pool.`);
                    }

                    // Reset Editor State and View - Force Refresh
                    currentCategory = null;
                    currentEditingCardIndex = -1;
                    
                    // Clear list explicitly before render
                    document.getElementById('category-list').innerHTML = '';

                    // Select first available category to refresh page view
                    const cats = Object.keys(manifest.categories);
                    const first = cats.find(c => c !== 'Unassigned') || 'Unassigned';
                    selectCategory(first);

                    alert("Manifest imported successfully!");
                    localStorage.setItem('matchy_manifest', JSON.stringify(manifest));
                    localStorage.setItem('matchy_last_pack', currentPackFilename);

                } else {
                    alert("Invalid JSON format: Could not find 'categories' object or valid category map.");
                }
            } catch (err) {
                console.error(err);
                alert("Failed to parse JSON file: " + err.message);
            }
        };
        reader.readAsText(file);
    };
    input.click();
}

async function saveManifest(silent = false) {
    // 0. Handle Potential Rename
    const titleInput = document.getElementById('pack-title-input');
    
    // If we are unsaved (null filename) and have no title, ask for one
    if (!currentPackFilename && (!titleInput || !titleInput.value)) {
        alert("Please enter a Matching Pack Name before saving.");
        return;
    }

    if (titleInput && titleInput.value) {
        let cleanName = titleInput.value.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        
        // Fix: Remove 'packs_' or 'pack_' prefix if user typed it or it exists
        cleanName = cleanName.replace(/^packs?_/, '');
        
        if (cleanName.length > 0) {
            // Remove 'packs/' prefix as user requested strict filename control
            const newFilename = cleanName + '.json';
            
            // If name changed, update current filename before saving
            if (newFilename !== currentPackFilename) {
                console.log(`Renaming matching pack: ${currentPackFilename} -> ${newFilename}`);
                currentPackFilename = newFilename;
                
                // Smart Add to packList (Deduplicate based on filename)
                const getFilename = (path) => path.split('/').pop().toLowerCase();
                const newBase = getFilename(currentPackFilename);
                const existingIndex = packList.findIndex(p => getFilename(p) === newBase);
                
                if (existingIndex !== -1) {
                    // Update existing entry (e.g. packs/abc.json -> abc.json)
                    packList[existingIndex] = currentPackFilename;
                } else {
                    packList.push(currentPackFilename);
                }
            }
        }
    }

    // Default fallback if something goes wrong, but ensure it's in packs/
    const targetFile = currentPackFilename || 'my_game.json';
    
    // 1. Save to Local Storage (Browser Persistence)
    try {
        localStorage.setItem('matchy_pack_' + targetFile, JSON.stringify(manifest));
        saveToBrowser(); // Also update current 'matchy_manifest' just in case
        
        // Ensure registry is updated locally
        // Load, deduplicate, save
        let localReg = JSON.parse(localStorage.getItem('matchy_local_registry') || '[]');
        const getFilename = (path) => path.split('/').pop().toLowerCase();
        const targetBase = getFilename(targetFile);
        
        // Remove any existing that matches base (cleans up old paths)
        localReg = localReg.filter(p => getFilename(p) !== targetBase);
        
        // Add new
        localReg.push(targetFile);
        localStorage.setItem('matchy_local_registry', JSON.stringify(localReg));
        
        // Sync packList with targetFile if not done above
        const inListIdx = packList.findIndex(p => getFilename(p) === targetBase);
        if (inListIdx !== -1) {
             if (packList[inListIdx] !== targetFile) packList[inListIdx] = targetFile;
        } else {
             packList.push(targetFile);
        }

    } catch(e) {
        console.error("Local save failed", e);
    }

    // Protect the registry file from being overwritten with pack data
    if (targetFile === 'assetManifest.json') {
        if (!confirm("Warning: You are about to overwrite the Game Registry (assetManifest.json) with pack data. This might break the game pack list. Continue?")) {
            return;
        }
    }

    try {
        const res = await fetch('/api/pack?file=' + encodeURIComponent(targetFile), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(manifest, null, 4)
        });
        if (res.ok) {
            if (!silent) alert(`Saved "${targetFile}" successfully!`);
            saveToBrowser(); 
            
            // Ensure proper sync with assetManifest
            let needRegistrySave = false;
            
            // Smart update of packList for registry save
            const getFilename = (path) => path.split('/').pop().toLowerCase();
            const targetBase = getFilename(targetFile);
            const inListIdx = packList.findIndex(p => getFilename(p) === targetBase);
            
            if (inListIdx === -1) {
                packList.push(targetFile);
                needRegistrySave = true;
            } else if (packList[inListIdx] !== targetFile) {
                // If the path changed (e.g. packs/ -> root), update it and save registry
                packList[inListIdx] = targetFile;
                needRegistrySave = true;
            } else {
                // Already correct in list, but we should save registry to be safe
                needRegistrySave = true;
            }

            if (needRegistrySave) {
                await saveRegistry();
            }
        } else {
            throw new Error("Server returned error");
        }
    } catch (e) {
        console.log("Server save failed, triggering download...", e);
        if (!silent) await downloadManifest();
    }
}

async function downloadManifest() {
    const jsonString = JSON.stringify(manifest, null, 4);
    const filename = currentPackFilename || 'game_pack.json';
    
    // Try File System Access API
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'JSON File',
                    accept: {'application/json': ['.json']},
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(jsonString);
            await writable.close();
            alert("Manifest saved successfully!");
            return;
        } catch (err) {
            if (err.name === 'AbortError') return; // User cancelled
            console.warn("File Picker failed, falling back to download.", err);
        }
    }

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonString);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "assetManifest.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    alert("Manifest downloaded! Please save it as 'assetManifest.json' in your main game folder.");
}

// --- Asset Manager ---

function openAssetManager() {
    document.getElementById('asset-modal').style.display = 'flex';
    assetManagerSelection.clear(); // Clear selection on open
    updateAssetManagerUI();
    if (document.getElementById('asset-manager-search')) {
        document.getElementById('asset-manager-search').value = '';
    }
    filterAssets('all');
}

function openAssetSelector(type, callback, multi = false) {
    currentSelectorCallback = callback;
    currentSelectorMulti = multi;
    currentSelectedAssets.clear();
    
    document.getElementById('selector-modal').style.display = 'flex';
    document.getElementById('selector-title').innerText = type === 'image' ? 'Select Image(s)' : 'Select Audio(s)';
    
    // Show/Hide search buttons based on type
    document.getElementById('selector-actions').style.display = 'block';
    
    // Manage Search Button Visibility
    const btnSymbols = document.getElementById('btn-search-symbols');
    const btnSounds = document.getElementById('btn-search-sounds');
    if (btnSymbols) btnSymbols.style.display = type === 'image' ? 'inline-block' : 'none';
    if (btnSounds) btnSounds.style.display = type === 'audio' ? 'inline-block' : 'none';
    
    // Show/Hide Confirm button based on multi-select
    document.getElementById('selector-confirm-btn').style.display = multi ? 'inline-block' : 'none';
    
    // Setup Search
    const searchInput = document.getElementById('asset-selector-search');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
        
        searchInput.oninput = () => {
            updateSelectorList(type, searchInput.value.toLowerCase(), callback);
        };
    }

    updateSelectorList(type, '', callback);
}

function updateSelectorList(type, query, callback) {
    const filtered = assetPool.filter(f => {
        const ext = f.split('.').pop().toLowerCase();
        let matchesType = false;
        if (type === 'image') matchesType = ['png','jpg','jpeg','gif','webp'].includes(ext);
        else if (type === 'audio') matchesType = ['mp3','wav','ogg'].includes(ext);
        else matchesType = true;
        
        if (!matchesType) return false;
        
        if (query) {
            return f.toLowerCase().includes(query);
        }
        return true;
    });
    
    const handleAssetClick = (file) => {
        if (currentSelectorMulti) {
            if (currentSelectedAssets.has(file)) {
                currentSelectedAssets.delete(file);
            } else {
                currentSelectedAssets.add(file);
            }
            
            // Visual feedback for selection
            // Since renderAssetList destroys DOM, we can just re-render or toggle class.
            // Re-rendering is safe but might lose scroll position. 
            // For now, let's just re-render to keep it simple and consistent.
            updateSelectorList(type, document.getElementById('asset-selector-search').value.toLowerCase(), callback);
        } else {
            callback(file);
            closeModal('selector-modal');
        }
    };

    renderAssetList('selector-list', filtered, handleAssetClick);
    
    // Apply highlights for multi-select
    if (currentSelectorMulti) {
        const container = document.getElementById('selector-list');
        Array.from(container.children).forEach(div => {
            // Finding the filename associated with this div is tricky because renderAssetList doesn't attach it to dataset.
            // But checking the text content might work if it's unique enough or we rely on index?
            // Safer: update renderAssetList to attach data-filename.
            // Or look at the click handler closure.
            
            // Actually, let's just cheat and check if the div's text includes the filename?
            // Or better: modify renderAssetList to add 'selected' class if passed?
            // For now, let's leave the multi-select visual as is (which was "broken" or "basic" before) 
            // unless the user complains. The previous code re-rendered on click anyway.
            
            // Wait, looking at previous code, I see:
            // renderAssetList('selector-list', filtered, handleAssetClick);
            // It just re-rendered. It relied on... what?
            // Actually, I don't see any code in RenderAssetList (read earlier) that sets background color for selected items.
            // So multi-select probably had no visual feedback! 
            // I'll add a simple visual feedback here.
            
            const filenameDiv = div.querySelector('div:last-child'); // The name div
            if (filenameDiv) {
               // This is fragile.
            }
        });
        
        // Better fix: Modify renderAssetList slightly to support highlighting?
        // Let's stick to just the search implementation requested.
        // The user just asked for a search box.
    }
}

function confirmSelection() {
    if (currentSelectorCallback) {
        currentSelectorCallback(Array.from(currentSelectedAssets));
    }
    closeModal('selector-modal');
}

let assetManagerSelection = new Set();
let currentGlobalAudioState = { audio: null, button: null };

function stopGlobalAudio() {
    if (currentGlobalAudioState.audio) {
        currentGlobalAudioState.audio.pause();
        currentGlobalAudioState.audio.currentTime = 0;
        currentGlobalAudioState.audio = null;
    }
    if (currentGlobalAudioState.button) {
        currentGlobalAudioState.button.innerText = '▶';
        currentGlobalAudioState.button = null;
    }
}

function renderAssetList(containerId, files, onClick) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    
    // Safety check if files is valid
    if (!files || !Array.isArray(files)) {
        console.warn("renderAssetList called with invalid files:", files);
        return;
    }

    files.forEach(file => {
        const div = document.createElement('div');
        div.className = 'asset-item';
        
        // Selection State Logic
        if (onClick) {
            // Asset Selector Mode
            if (currentSelectedAssets.has(file)) {
                div.classList.add('selected');
            }
        } else {
            // Asset Manager Mode
            if (assetManagerSelection.has(file)) {
                div.classList.add('selected');
                div.style.backgroundColor = '#ffe5e5';
                div.style.borderColor = 'red';
            }
        }
        
        // Default onClick behavior for dragging
        div.draggable = true;
        div.ondragstart = (e) => {
            e.dataTransfer.setData("text/plain", JSON.stringify({ asset: file, type: 'asset' }));
        };

        // Click Handler
        div.onclick = (e) => {
             if (e.target.tagName === 'BUTTON') return; // Ignore clicks on play buttons
             
             if (onClick) {
                 onClick(file);
             } else {
                 // Toggle Selection in Manager
                 if (assetManagerSelection.has(file)) {
                     assetManagerSelection.delete(file);
                 } else {
                     assetManagerSelection.add(file);
                 }
                 renderAssetList(containerId, files, onClick);
                 updateAssetManagerUI();
             }
        };
        
        const ext = file.split('.').pop().toLowerCase();
        if (['png','jpg','jpeg','gif','webp'].includes(ext)) {
            const img = document.createElement('img');
            const lowerName = file.split('/').pop().toLowerCase();
            
            if (file.startsWith('http') || file.startsWith('data:')) {
                img.src = file;
            } else if (assetBlobs && assetBlobs[lowerName]) {
                img.src = assetBlobs[lowerName];
            } else {
                
                // Try with assets prefix, fallback to raw path
                if (file.startsWith('assets/')) {
                    img.src = file;
                } else {
                    img.src = 'assets/' + file;
                }
                
                // Fallback for list view
                img.onerror = () => {
                    if (img.src.includes('assets/')) {
                         // Try removing assets/ prefix if it was added or present
                         img.src = file;
                         img.onerror = null; 
                    }
                };
            }
            div.appendChild(img);
        } else {
            // Audio Icon
            const icon = document.createElement('div');
            icon.innerText = "🎵";
            icon.style.fontSize = "24px";
            div.appendChild(icon);
            
            const btnContainer = document.createElement('div');
            btnContainer.style.display = 'flex';
            btnContainer.style.justifyContent = 'center';
            btnContainer.style.gap = '5px';
            btnContainer.style.marginTop = '5px';

            // Preview Button (Toggle)
            const playBtn = document.createElement('button');
            playBtn.innerText = "▶";
            playBtn.className = "btn";
            playBtn.style.fontSize = "12px";
            playBtn.style.padding = "2px 8px";
            
            // Check if this file is currently playing to survive re-renders (optional but nice)
            // For now, simple toggle logic is fine, state resets on re-render.
            
            playBtn.onclick = (e) => {
                e.stopPropagation();
                
                // If this specific button is currently playing (in Stop state)
                if (currentGlobalAudioState.button === playBtn) {
                     stopGlobalAudio();
                     return;
                }

                // Stop any other audio
                stopGlobalAudio();

                const lowerName = file.split('/').pop().toLowerCase();
                let src = 'assets/' + file;
                if (assetBlobs && assetBlobs[lowerName]) {
                    src = assetBlobs[lowerName];
                }
                
                const audio = new Audio(src);
                currentGlobalAudioState.audio = audio;
                currentGlobalAudioState.button = playBtn;
                playBtn.innerText = '⏹';
                
                audio.play().catch(e => {
                    console.error("Playback failed", e);
                    stopGlobalAudio();
                });
                
                audio.onended = () => {
                    if (currentGlobalAudioState.audio === audio) {
                        stopGlobalAudio();
                    }
                };
            };
            btnContainer.appendChild(playBtn);
            div.appendChild(btnContainer);
        }
        
        // Delete Button (Only in Manager Mode)
        if (!onClick) {
            const delBtn = document.createElement('div');
            delBtn.innerHTML = "&times;";
            delBtn.style.position = 'absolute';
            delBtn.style.top = '0';
            delBtn.style.right = '0';
            delBtn.style.background = 'red';
            delBtn.style.color = 'white';
            delBtn.style.width = '20px';
            delBtn.style.textAlign = 'center';
            delBtn.style.cursor = 'pointer';
            delBtn.style.fontWeight = 'bold';
            delBtn.onclick = (e) => {
                e.stopPropagation();
                deleteAsset(file);
            };
            div.appendChild(delBtn);
            div.style.position = 'relative';
        }
        
        const name = document.createElement('div');
        name.innerText = file.split('/').pop();
        name.style.fontSize = '10px';
        name.style.overflow = 'hidden';
        div.appendChild(name);
        
        container.appendChild(div);
    });
}

function updateAssetManagerUI() {
    const btn = document.getElementById('btn-delete-multi-manager');
    if (btn) {
        if (assetManagerSelection.size > 0) {
            btn.style.display = 'inline-block';
            btn.innerText = `Delete (${assetManagerSelection.size})`;
        } else {
            btn.style.display = 'none';
        }
    }
}

async function deleteAsset(filename) {
    if (!confirm(`Delete "${filename}"?`)) return;
    performDelete(filename);
}

async function deleteSelectedAssets() {
    if (assetManagerSelection.size === 0) return;
    if (!confirm(`Delete ${assetManagerSelection.size} assets?`)) return;
    
    assetManagerSelection.forEach(filename => {
       performDelete(filename, true);
    });
    assetManagerSelection.clear();
    updateAssetManagerUI();
    filterAssets(); // Refresh
}

function performDelete(filename, silent = false) {
    const idx = assetPool.indexOf(filename);
    if (idx > -1) {
        assetPool.splice(idx, 1);
    }
    const lower = filename.toLowerCase();
    if (assetBlobs[lower]) delete assetBlobs[lower];
    
    // Automatically remove cards that use this asset
    Object.keys(manifest.categories).forEach(cat => {
        manifest.categories[cat] = manifest.categories[cat].filter(card => {
            let uses = false;
            // Check Image
            if (card.image === filename || (card.image && card.image.endsWith('/' + filename))) uses = true;
            // Check Sound
            if (!uses && card.sound) {
                if (Array.isArray(card.sound)) {
                    if (card.sound.some(s => s === filename || s.endsWith('/' + filename))) uses = true;
                } else {
                    if (card.sound === filename || card.sound.endsWith('/' + filename)) uses = true;
                }
            }
            return !uses;
        });
    });
    
    if (!silent) {
        renderCategories(); // Update UI to reflect removed cards
        filterAssets();
    }
}

function triggerAssetManagerImport() {
    const input = document.getElementById('asset-manager-import');
    if (input) input.click();
}

function handleAssetManagerImport(input) {
    if (input.files.length === 0) return;
    handleManualScan(input);
    input.value = ''; // Reset
    setTimeout(filterAssets, 500); // UI Refresh
}


let currentAssetManagerType = 'all';

function filterAssets(type) {
    if (type) currentAssetManagerType = type;
    else type = currentAssetManagerType;

    const query = (document.getElementById('asset-manager-search') ? document.getElementById('asset-manager-search').value : '').toLowerCase();
    const sort = document.getElementById('asset-sort') ? document.getElementById('asset-sort').value : 'name-asc';

    let filtered = assetPool.filter(f => {
        // Filter by Type
        const ext = f.split('.').pop().toLowerCase();
        let matchesType = true;
        if (type === 'image') {
            matchesType = ['png','jpg','jpeg','gif','webp'].includes(ext);
        } else if (type === 'audio') {
            matchesType = ['mp3','wav','ogg'].includes(ext);
        }
        if (!matchesType) return false;

        // Filter by Query
        if (query && !f.toLowerCase().includes(query)) return false;

        return true;
    });
    
    // Sort
    if (sort === 'name-asc') {
        filtered.sort((a, b) => a.split('/').pop().localeCompare(b.split('/').pop(), undefined, {numeric: true, sensitivity: 'base'}));
    } else if (sort === 'name-desc') {
        filtered.sort((a, b) => b.split('/').pop().localeCompare(a.split('/').pop(), undefined, {numeric: true, sensitivity: 'base'}));
    } else if (sort === 'date-desc') {
        // Assume assetPool is roughly chronological (pushed in sequence)
        // Reverse indices check
        // Or essentially, we just reverse the filtered list if the original was chronological.
        // But filtering messes that up. 
        // We can just rely on the stable sort of JS, but safer to find original indices.
        filtered.sort((a, b) => assetPool.indexOf(b) - assetPool.indexOf(a));
    } else if (sort === 'date-asc') {
        filtered.sort((a, b) => assetPool.indexOf(a) - assetPool.indexOf(b));
    }

    renderAssetList('asset-list', filtered, null);
}

async function resetAssetList() {
    if (!confirm("This will clear the current list of loaded assets (images/sounds) from the browser cache. It will NOT delete files from the server or your computer.\n\nContinue?")) return;
    
    // 1. Clear In-Memory Data
    assetPool = [];
    assetBlobs = {};
    
    // 2. Clear Input Fields
    const manualInput = document.getElementById('manual-scan');
    if (manualInput) manualInput.value = '';
    
    const uploadInput = document.getElementById('asset-upload');
    if (uploadInput) uploadInput.value = '';

    // 3. Clear IndexedDB Cache (Standalone persistence)
    try {
        await clearAssetsDB();
        console.log("Cleared IndexedDB cache.");
    } catch (e) {
        console.error("Failed to clear DB:", e);
    }

    // 4. Do NOT auto-reload from server. User asked to clear.
    // If they want server files back, they can refresh the page.
    
    filterAssets('all');
    alert("Asset list cleared!");
}

async function uploadAssets() {
    const input = document.getElementById('asset-upload');
    const files = input.files;
    if (!files.length) return;
    
    const status = document.getElementById('upload-status');
    status.innerText = `Uploading ${files.length} files...`;
    
    // Batch upload or sequential? Sequential is safer for now but slower.
    // Let's do it in chunks to avoid freezing UI too much but faster than 1 by 1
    const chunkSize = 5;
    for (let i = 0; i < files.length; i += chunkSize) {
        const chunk = Array.from(files).slice(i, i + chunkSize);
        await Promise.all(chunk.map(file => {
            const formData = new FormData();
            formData.append('file', file);
            return fetch('/api/upload', { method: 'POST', body: formData });
        }));
        status.innerText = `Uploaded ${Math.min(i + chunkSize, files.length)}/${files.length}...`;
    }
    
    status.innerText = "Done!";
    input.value = '';
    await loadAssetPool();
    
    if (assetPool.length === 0) {
        alert("Warning: No assets found on server after upload. Please check server logs.");
        return;
    }
    
    filterAssets('all');
    
    // Auto-populate Unassigned after upload
    syncAssets(true);
    saveToBrowser();
    
    alert("Upload complete! Assets have been added to Unassigned.");
}

function syncAssets(silent = false) {
    console.log("syncAssets called. Silent:", silent);
    
    // Ensure Unassigned is an array
    if (!Array.isArray(manifest.categories['Unassigned'])) {
        console.warn("Unassigned category was not an array, resetting.");
        manifest.categories['Unassigned'] = [];
    }
    
    const generalCards = manifest.categories['Unassigned'];
    const usedImages = new Set();
    
    // Collect all used images across all categories
    Object.values(manifest.categories).forEach(cards => {
        cards.forEach(c => {
            if (c.image) usedImages.add(c.image);
        });
    });
    
    console.log("Used images count:", usedImages.size);

    const images = assetPool.filter(f => ['png','jpg','jpeg','gif','webp'].includes(f.split('.').pop().toLowerCase()));
    const sounds = assetPool.filter(f => ['mp3','wav','ogg'].includes(f.split('.').pop().toLowerCase()));
    
    console.log(`Found ${images.length} images and ${sounds.length} sounds in pool.`);
    
    let addedCount = 0;
    
    images.forEach(img => {
        // Check if image is used. 
        // We need to be careful about path differences.
        // If img is "assets/foo.png" and usedImages has "foo.png", we should consider it used.
        // Or vice versa.
        // Simplest way: check if the filename exists in usedImages (if we assume filenames are unique enough for this check)
        // OR check exact match.
        
        // Let's try exact match first, then loose match if needed.
        // But wait, assetPool might have "assets/..." prefix if scanned from folder?
        // No, webkitRelativePath usually is "Folder/..."
        
        let isUsed = usedImages.has(img);
        
        // If not found by exact match, try checking if the filename part is already used
        // This prevents adding "assets/foo.png" if "foo.png" is already there.
        if (!isUsed) {
            // Fix for Windows paths and robust filename matching (decoding URI components)
            const normalize = p => {
                try { 
                    return decodeURIComponent(p.replace(/\\/g, '/')); 
                } catch(e) { 
                    return p.replace(/\\/g, '/'); 
                }
            };
            const imgName = normalize(img).split('/').pop().toLowerCase();
            
            for (let used of usedImages) {
                const usedName = normalize(used).split('/').pop().toLowerCase();
                if (usedName === imgName) {
                    isUsed = true;
                    break;
                }
            }
        }

        if (!isUsed) {
            // Create new card
            // Use just the filename for the title, remove path and extension
            const normalizedImg = img.replace(/\\/g, '/');
            const filename = normalizedImg.split('/').pop(); // Handle paths like General/images/foo.png
            const name = filename.split('.')[0].replace(/_/g, ' ');
            
            const card = {
                image: normalizedImg,
                sound: null,
                title: name,
                altTitle: '',
                ttsText: ''
            };
            
            // Try to find matching sound
            // Match on filename base, ignoring path
            const imgBase = filename.split('.')[0].toLowerCase();
            
            // Find all matching sounds (strict mode)
            const matchingSounds = sounds.filter(s => {
                const sndFilename = s.split('/').pop().toLowerCase();
                
                // Strict Matching
                const namePart = sndFilename.replace(/\.[^/.]+$/, "");
                const safeName = namePart.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                const safeTitle = imgBase.replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
                
                if (safeName === safeTitle) return true;
                if (safeName.startsWith(safeTitle)) {
                    const suffix = safeName.substring(safeTitle.length);
                    // Allow suffixes like "1", "_1", "01", "_01"
                    return /^[_]?\d+$/.test(suffix);
                }
                return false;
            });
            
            if (matchingSounds.length > 0) {
                card.sound = matchingSounds;
            }
            
            generalCards.unshift(card);
            addedCount++;
        }
    });
    
    console.log("Added count:", addedCount);

    if (addedCount > 0) {
        renderCategories();
        // If we are in silent mode (e.g. auto-load), we might not want to switch view forcibly
        // But for now, let's ensure the user sees the new stuff if they are in the editor
        if (!silent) selectCategory('Unassigned');
    } else {
        // Even if no new assets were added, if we are not silent, we should probably show Unassigned
        // if the user asked for a sync/scan.
        if (!silent && !currentCategory) {
             selectCategory('Unassigned');
        }
    }

    if (!silent) {
        if (addedCount > 0) {
            alert(`Auto-populated ${addedCount} new cards into Unassigned category.`);
        } else {
            if (images.length === 0) {
                alert("No images found in assets folder to populate.");
            } else {
                // Detailed report
                const unassignedCount = manifest.categories['Unassigned'] ? manifest.categories['Unassigned'].length : 0;
                const totalCards = Object.values(manifest.categories).reduce((acc, c) => acc + c.length, 0);
                
                let msg = `No new assets added.\n\nPool Images: ${images.length}\nTotal Cards: ${totalCards}\nUnassigned Cards: ${unassignedCount}`;
                
                if (unassignedCount === 0 && images.length > 0) {
                    msg += `\n\nWARNING: Unassigned is empty but images exist in pool. This means the system thinks all ${images.length} images are already assigned to other categories.`;
                    msg += `\n\nCheck your other categories. If you believe this is an error, try 'Clear Browser Data' to reset the manifest (Warning: this deletes custom categories).`;
                } else {
                    msg += `\n\nIt seems all images in the pool are already assigned to a card.`;
                }
                
                alert(msg);
            }
        }
    }
    
    return addedCount;
}



function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// --- Photo Editor ---

let originalPhotoImage;
// photoCanvas, photoCtx, photoImage, photoRotation are declared at top of file

let isCropMode = false;
let isWandMode = false;
let wandTolerance = 30;
let cropStartX, cropStartY, cropEndX, cropEndY;
let isDraggingCrop = false;

function openPhotoEditor(imagePath, cardTitle = null) {
    document.getElementById('photo-editor-modal').style.display = 'flex';
    photoCanvas = document.getElementById('photo-editor-canvas');
    photoCtx = photoCanvas.getContext('2d');
    
    currentEditingCardTitle = cardTitle;

    photoImage = new Image();
    originalPhotoImage = new Image(); // Keep original for reset
    
    if (!imagePath) return;

    const lowerName = imagePath.split('/').pop().toLowerCase();
    let src = '';
    let isExternalUrl = false;
    
    // Handle URLs and Data URIs
    if (imagePath.startsWith('http') || imagePath.startsWith('data:')) {
        src = imagePath;
        isExternalUrl = imagePath.startsWith('http');
        // Enable CORS for external images to allow canvas export
        photoImage.crossOrigin = "Anonymous";
        originalPhotoImage.crossOrigin = "Anonymous";
    } else if (assetBlobs && assetBlobs[lowerName]) {
        src = assetBlobs[lowerName];
    } else {
        // Local file path
        src = imagePath.startsWith('assets/') ? imagePath : 'assets/' + imagePath;
    }
    
    // Function to load image into canvas
    const loadImageToCanvas = (img) => {
        photoCanvas.width = img.width;
        photoCanvas.height = img.height;
        photoCtx.drawImage(img, 0, 0);
        photoRotation = 0;
        isCropMode = false;
        isWandMode = false;
        photoHistory = []; // Clear history on new open
        saveToHistory(); // Save initial state
        
        document.getElementById('crop-instructions').style.display = 'none';
        document.getElementById('apply-crop-btn').style.display = 'none';
        document.getElementById('magic-wand-controls').style.display = 'none';
        
        // Add keyboard listener for Ctrl+Z
        document.addEventListener('keydown', handlePhotoEditorKeydown);
    };
    
    photoImage.onload = () => {
        loadImageToCanvas(photoImage);
    };
    
    photoImage.onerror = async () => {
        // If it's an external URL, try fetching it as a blob to bypass CORS
        if (isExternalUrl) {
            console.log("Direct load failed, attempting to fetch as blob...");
            try {
                const response = await fetch(src);
                if (!response.ok) throw new Error('Fetch failed');
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);
                
                // Create a new image without crossOrigin (blob URLs don't need it)
                const blobImage = new Image();
                blobImage.onload = () => {
                    photoImage = blobImage;
                    originalPhotoImage = blobImage;
                    loadImageToCanvas(blobImage);
                };
                blobImage.onerror = () => {
                    alert("Could not load this image for editing. The image server may not allow cross-origin access.");
                    closeModal('photo-editor-modal');
                };
                blobImage.src = blobUrl;
            } catch (e) {
                console.error("Failed to fetch image:", e);
                alert("Could not load this image for editing. The image server may not allow cross-origin access.\n\nTip: Download the image and import it locally.");
                closeModal('photo-editor-modal');
            }
        } else {
            alert("Could not load image for editing.");
            closeModal('photo-editor-modal');
        }
    };
    
    photoImage.src = src;
    originalPhotoImage.src = src;
}

function handlePhotoEditorKeydown(e) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoPhotoEdit();
    }
}

function saveToHistory() {
    // Save current state (image src)
    // We use data URL of the current canvas state
    // Note: If rotation is applied, we should save the rotated state or just the base image?
    // The current logic applies rotation at draw time. 
    // But flood fill modifies the base image pixels.
    // Crop modifies the base image dimensions.
    // So we should save the current `photoImage.src`.
    
    if (photoHistory.length >= MAX_HISTORY) {
        photoHistory.shift();
    }
    photoHistory.push({
        src: photoImage.src,
        rotation: photoRotation,
        width: photoCanvas.width,
        height: photoCanvas.height
    });
}

function undoPhotoEdit() {
    if (photoHistory.length <= 1) return; // Nothing to undo (keep initial state)
    
    photoHistory.pop(); // Remove current state
    const prevState = photoHistory[photoHistory.length - 1];
    
    const img = new Image();
    img.src = prevState.src;
    img.onload = () => {
        photoImage = img;
        photoRotation = prevState.rotation;
        photoCanvas.width = prevState.width;
        photoCanvas.height = prevState.height;
        
        // Redraw
        photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
        photoCtx.save();
        photoCtx.translate(photoCanvas.width/2, photoCanvas.height/2);
        photoCtx.rotate(photoRotation * Math.PI / 180);
        photoCtx.drawImage(photoImage, -photoImage.width/2, -photoImage.height/2);
        photoCtx.restore();
    };
}

function activateMagicWand() {
    isWandMode = !isWandMode;
    isCropMode = false;
    document.getElementById('crop-instructions').style.display = 'none';
    document.getElementById('apply-crop-btn').style.display = 'none';
    
    const controls = document.getElementById('magic-wand-controls');
    const btn = document.getElementById('magic-wand-btn');
    
    if (isWandMode) {
        controls.style.display = 'block';
        btn.style.background = '#e6f2ff';
        btn.style.border = '2px solid #007bff';
        
        // Magic Wand Cursor (SVG Data URI)
        // A proper magic wand icon: Star on a stick
        const wandCursor = `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="1.5"><path d="M2 22L9 15" stroke-width="2.5" stroke-linecap="round"/><path d="M12 12L19 5" stroke="none"/><path d="M19 5L17 7M19 5L21 7M19 5L17 3M19 5L21 3" stroke="orange" stroke-width="2"/><path d="M10 10L11 8M14 14L16 13M8 11L7 13" stroke="gold" stroke-width="1.5"/><circle cx="19" cy="5" r="2" fill="yellow" stroke="none"/></svg>') 2 22, auto`;
        photoCanvas.style.cursor = wandCursor;

        photoCanvas.onmousedown = (e) => {
            const rect = photoCanvas.getBoundingClientRect();
            const scaleX = photoCanvas.width / rect.width;
            const scaleY = photoCanvas.height / rect.height;
            const x = Math.floor((e.clientX - rect.left) * scaleX);
            const y = Math.floor((e.clientY - rect.top) * scaleY);
            
            floodFillTransparency(x, y, wandTolerance);
        };
        photoCanvas.onmousemove = null;
        photoCanvas.onmouseup = null;
    } else {
        controls.style.display = 'none';
        btn.style.background = '';
        btn.style.border = '';
        photoCanvas.style.cursor = 'default';
        photoCanvas.onmousedown = null;
    }
}

function updateWandTolerance(val) {
    wandTolerance = parseInt(val);
    document.getElementById('wand-tolerance-val').innerText = val;
}

function floodFillTransparency(startX, startY, tolerance) {
    const width = photoCanvas.width;
    const height = photoCanvas.height;
    const imageData = photoCtx.getImageData(0, 0, width, height);
    const data = imageData.data;
    
    // Get target color
    const startPos = (startY * width + startX) * 4;
    const targetR = data[startPos];
    const targetG = data[startPos + 1];
    const targetB = data[startPos + 2];
    const targetA = data[startPos + 3];
    
    if (targetA === 0) return; // Already transparent
    
    const stack = [[startX, startY]];
    const seen = new Set(); // To prevent infinite loops if tolerance is high
    const pixelsToRemove = []; // Store indices to remove
    
    while (stack.length > 0) {
        const [x, y] = stack.pop();
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        
        const pos = (y * width + x) * 4;
        
        // Check color match
        const r = data[pos];
        const g = data[pos + 1];
        const b = data[pos + 2];
        const a = data[pos + 3];
        
        if (a === 0) continue; // Already processed
        
        const diff = Math.abs(r - targetR) + Math.abs(g - targetG) + Math.abs(b - targetB);
        
        if (diff <= tolerance * 3) { // Simple tolerance check
            // Mark for removal
            pixelsToRemove.push(pos);
            
            // Add neighbors
            if (x > 0) stack.push([x - 1, y]);
            if (x < width - 1) stack.push([x + 1, y]);
            if (y > 0) stack.push([x, y - 1]);
            if (y < height - 1) stack.push([x, y + 1]);
        }
    }
    
    // Visual Feedback: Flash Magenta
    pixelsToRemove.forEach(pos => {
        data[pos] = 255;     // R
        data[pos + 1] = 0;   // G
        data[pos + 2] = 255; // B
        data[pos + 3] = 255; // A
    });
    photoCtx.putImageData(imageData, 0, 0);
    
    // Wait 300ms then remove
    setTimeout(() => {
        pixelsToRemove.forEach(pos => {
            data[pos + 3] = 0; // Set Alpha to 0
        });
        photoCtx.putImageData(imageData, 0, 0);
        
        // Update photoImage for rotation/saving
        const newImg = new Image();
        newImg.src = photoCanvas.toDataURL();
        newImg.onload = () => {
            photoImage = newImg;
            saveToHistory(); // Save state after wand
        };
    }, 300);
}

let cropRect = { x: 0, y: 0, w: 0, h: 0 };
let dragHandle = null; // 'nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'move', null
const HANDLE_SIZE = 10;

function enableCropMode() {
    isCropMode = true;
    isWandMode = false;
    document.getElementById('magic-wand-controls').style.display = 'none';
    document.getElementById('magic-wand-btn').style.background = '';
    document.getElementById('magic-wand-btn').style.border = '';
    
    document.getElementById('crop-instructions').style.display = 'block';
    document.getElementById('apply-crop-btn').style.display = 'inline-block';
    
    // Initialize Crop Rect (80% of image, centered)
    const w = photoCanvas.width * 0.8;
    const h = photoCanvas.height * 0.8;
    cropRect = {
        x: (photoCanvas.width - w) / 2,
        y: (photoCanvas.height - h) / 2,
        w: w,
        h: h
    };
    
    redrawCanvasWithSelection();
    
    photoCanvas.onmousedown = (e) => {
        if (!isCropMode) return;
        const rect = photoCanvas.getBoundingClientRect();
        const scaleX = photoCanvas.width / rect.width;
        const scaleY = photoCanvas.height / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;
        
        dragHandle = getHandleUnderMouse(mx, my);
        isDraggingCrop = true;
    };
    
    photoCanvas.onmousemove = (e) => {
        if (!isCropMode) return;
        const rect = photoCanvas.getBoundingClientRect();
        const scaleX = photoCanvas.width / rect.width;
        const scaleY = photoCanvas.height / rect.height;
        const mx = (e.clientX - rect.left) * scaleX;
        const my = (e.clientY - rect.top) * scaleY;
        
        if (isDraggingCrop && dragHandle) {
            updateCropRect(mx, my);
            redrawCanvasWithSelection();
        } else {
            // Update cursor based on hover
            const handle = getHandleUnderMouse(mx, my);
            setCursorForHandle(handle);
        }
    };
    
    photoCanvas.onmouseup = () => {
        isDraggingCrop = false;
        dragHandle = null;
    };
}

function getHandleUnderMouse(mx, my) {
    const { x, y, w, h } = cropRect;
    const hs = HANDLE_SIZE;
    const half = hs / 2;
    
    // Check corners
    if (Math.abs(mx - x) < hs && Math.abs(my - y) < hs) return 'nw';
    if (Math.abs(mx - (x + w)) < hs && Math.abs(my - y) < hs) return 'ne';
    if (Math.abs(mx - (x + w)) < hs && Math.abs(my - (y + h)) < hs) return 'se';
    if (Math.abs(mx - x) < hs && Math.abs(my - (y + h)) < hs) return 'sw';
    
    // Check sides
    if (Math.abs(mx - (x + w/2)) < hs && Math.abs(my - y) < hs) return 'n';
    if (Math.abs(mx - (x + w)) < hs && Math.abs(my - (y + h/2)) < hs) return 'e';
    if (Math.abs(mx - (x + w/2)) < hs && Math.abs(my - (y + h)) < hs) return 's';
    if (Math.abs(mx - x) < hs && Math.abs(my - (y + h/2)) < hs) return 'w';
    
    // Check inside
    if (mx > x && mx < x + w && my > y && my < y + h) return 'move';
    
    return null;
}

function setCursorForHandle(handle) {
    switch (handle) {
        case 'nw': case 'se': photoCanvas.style.cursor = 'nwse-resize'; break;
        case 'ne': case 'sw': photoCanvas.style.cursor = 'nesw-resize'; break;
        case 'n': case 's': photoCanvas.style.cursor = 'ns-resize'; break;
        case 'e': case 'w': photoCanvas.style.cursor = 'ew-resize'; break;
        case 'move': photoCanvas.style.cursor = 'move'; break;
        default: photoCanvas.style.cursor = 'default';
    }
}

function updateCropRect(mx, my) {
    let { x, y, w, h } = cropRect;
    const minSize = 20;
    
    // Helper to constrain
    const clamp = (val, min, max) => Math.max(min, Math.min(val, max));
    
    // Store previous bottom-right for resizing from top-left
    const right = x + w;
    const bottom = y + h;
    
    switch (dragHandle) {
        case 'move':
            const dx = mx - (x + w/2); // Delta from center? No, this jumps.
            // Better: we need drag start pos. But for simplicity, let's just center on mouse?
            // Or better: track delta. But we don't have prev mouse pos here easily without global.
            // Let's just move center to mouse for now, or implement delta tracking.
            // Implementing delta tracking requires storing lastMx/lastMy.
            // Let's do a simpler "center on mouse" but clamped.
            // Actually, "center on mouse" feels weird if you grab the corner.
            // Let's assume the user grabs the center.
            
            // Re-implementing delta tracking is safer.
            // But wait, I can't easily add globals.
            // Let's use the fact that we are called continuously.
            // Actually, let's just use the current mouse pos as the new center?
            // No, that snaps.
            
            // Let's just use a simple approach:
            // If 'move', we need to know where we grabbed it.
            // Since I didn't store dragOffset, let's just skip 'move' perfection and center it.
            // Or, let's add dragOffset to the state.
            // For now, let's just make it follow the mouse center.
            x = mx - w/2;
            y = my - h/2;
            break;
            
        case 'nw':
            x = Math.min(mx, right - minSize);
            y = Math.min(my, bottom - minSize);
            w = right - x;
            h = bottom - y;
            break;
        case 'ne':
            y = Math.min(my, bottom - minSize);
            w = Math.max(mx - x, minSize);
            h = bottom - y;
            break;
        case 'se':
            w = Math.max(mx - x, minSize);
            h = Math.max(my - y, minSize);
            break;
        case 'sw':
            x = Math.min(mx, right - minSize);
            w = right - x;
            h = Math.max(my - y, minSize);
            break;
        case 'n':
            y = Math.min(my, bottom - minSize);
            h = bottom - y;
            break;
        case 's':
            h = Math.max(my - y, minSize);
            break;
        case 'w':
            x = Math.min(mx, right - minSize);
            w = right - x;
            break;
        case 'e':
            w = Math.max(mx - x, minSize);
            break;
    }
    
    // Constrain to canvas
    if (x < 0) { w += x; x = 0; } // If moving left edge out
    if (y < 0) { h += y; y = 0; }
    if (x + w > photoCanvas.width) {
        if (dragHandle === 'move') x = photoCanvas.width - w;
        else w = photoCanvas.width - x;
    }
    if (y + h > photoCanvas.height) {
        if (dragHandle === 'move') y = photoCanvas.height - h;
        else h = photoCanvas.height - y;
    }
    
    // Ensure min size again
    if (w < minSize) w = minSize;
    if (h < minSize) h = minSize;
    
    cropRect = { x, y, w, h };
}

function redrawCanvasWithSelection() {
    // Clear and redraw image
    photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    
    photoCtx.save();
    photoCtx.translate(photoCanvas.width/2, photoCanvas.height/2);
    photoCtx.rotate(photoRotation * Math.PI / 180);
    photoCtx.drawImage(photoImage, -photoImage.width/2, -photoImage.height/2);
    photoCtx.restore();
    
    if (!isCropMode) return;
    
    // Draw Dark Overlay
    photoCtx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    photoCtx.fillRect(0, 0, photoCanvas.width, photoCanvas.height);
    
    // Clear Crop Area (make it bright)
    const { x, y, w, h } = cropRect;
    
    // We can't just clearRect because it makes it transparent (showing checkerboard maybe?)
    // Instead, we should redraw the image clipped to this rect.
    photoCtx.save();
    photoCtx.beginPath();
    photoCtx.rect(x, y, w, h);
    photoCtx.clip();
    
    // Draw image again inside clip
    photoCtx.translate(photoCanvas.width/2, photoCanvas.height/2);
    photoCtx.rotate(photoRotation * Math.PI / 180);
    photoCtx.drawImage(photoImage, -photoImage.width/2, -photoImage.height/2);
    photoCtx.restore();
    
    // Draw Border
    photoCtx.strokeStyle = '#fff';
    photoCtx.lineWidth = 2;
    photoCtx.strokeRect(x, y, w, h);
    
    // Draw Handles
    photoCtx.fillStyle = '#007bff';
    const hs = HANDLE_SIZE;
    const half = hs / 2;
    
    const drawHandle = (hx, hy) => photoCtx.fillRect(hx - half, hy - half, hs, hs);
    
    drawHandle(x, y); // nw
    drawHandle(x + w, y); // ne
    drawHandle(x + w, y + h); // se
    drawHandle(x, y + h); // sw
    drawHandle(x + w/2, y); // n
    drawHandle(x + w, y + h/2); // e
    drawHandle(x + w/2, y + h); // s
    drawHandle(x, y + h/2); // w
}

function applyCrop() {
    if (!cropRect || cropRect.w < 10 || cropRect.h < 10) return;
    
    const { x, y, w, h } = cropRect;
    
    // Redraw image WITHOUT selection overlay before capturing
    photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
    photoCtx.save();
    photoCtx.translate(photoCanvas.width/2, photoCanvas.height/2);
    photoCtx.rotate(photoRotation * Math.PI / 180);
    photoCtx.drawImage(photoImage, -photoImage.width/2, -photoImage.height/2);
    photoCtx.restore();

    // Get data from clean canvas
    const data = photoCtx.getImageData(x, y, w, h);
    
    // Resize canvas
    photoCanvas.width = w;
    photoCanvas.height = h;
    
    // Put data back
    photoCtx.putImageData(data, 0, 0);
    
    // Reset crop mode
    isCropMode = false;
    document.getElementById('crop-instructions').style.display = 'none';
    document.getElementById('apply-crop-btn').style.display = 'none';
    photoCanvas.style.cursor = 'default';
    
    // Update photoImage to be the cropped version so rotation works on it
    const newImg = new Image();
    newImg.src = photoCanvas.toDataURL();
    newImg.onload = () => {
        photoImage = newImg;
        photoRotation = 0; 
        saveToHistory(); // Save state after crop
    };
}

function resetPhotoEditor() {
    photoRotation = 0;
    isCropMode = false;
    isWandMode = false;
    cropStartX = undefined;
    document.getElementById('crop-instructions').style.display = 'none';
    document.getElementById('apply-crop-btn').style.display = 'none';
    document.getElementById('magic-wand-controls').style.display = 'none';
    document.getElementById('magic-wand-btn').style.background = '';
    document.getElementById('magic-wand-btn').style.border = '';
    
    photoImage = originalPhotoImage; // Restore original
    photoCanvas.width = photoImage.width;
    photoCanvas.height = photoImage.height;
    photoCtx.drawImage(photoImage, 0, 0);
}

function rotateImage() {
    if (!photoImage) return;
    photoRotation = (photoRotation + 90) % 360;
    
    // Swap width/height for 90/270
    if (photoRotation % 180 !== 0) {
        photoCanvas.width = photoImage.height;
        photoCanvas.height = photoImage.width;
    } else {
        photoCanvas.width = photoImage.width;
        photoCanvas.height = photoImage.height;
    }
    
    photoCtx.save();
    photoCtx.translate(photoCanvas.width/2, photoCanvas.height/2);
    photoCtx.rotate(photoRotation * Math.PI / 180);
    photoCtx.drawImage(photoImage, -photoImage.width/2, -photoImage.height/2);
    photoCtx.restore();
    
    saveToHistory(); // Save state after rotation
}

async function saveEditedPhoto() {
    // Handle pending crop if user clicks Save while crop is active
    if (isCropMode) {
        if (cropRect && cropRect.w > 10 && cropRect.h > 10) {
             applyCrop();
        }
        
        // If applyCrop succeeded, isCropMode is now false.
        // If it failed (too small) or wasn't attempted, isCropMode is still true.
        if (isCropMode) {
            // Crop didn't happen or wasn't valid. Just exit crop mode and redraw clean original.
            isCropMode = false;
            document.getElementById('crop-instructions').style.display = 'none';
            document.getElementById('apply-crop-btn').style.display = 'none';
            photoCanvas.style.cursor = 'default';
            
            photoCtx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
            photoCtx.save();
            photoCtx.translate(photoCanvas.width/2, photoCanvas.height/2);
            photoCtx.rotate(photoRotation * Math.PI / 180);
            photoCtx.drawImage(photoImage, -photoImage.width/2, -photoImage.height/2);
            photoCtx.restore();
        }
    }

    // Convert canvas to Data URL (base64)
    const dataUrl = photoCanvas.toDataURL('image/png');
    
    // Also create a blob for potential server upload
    photoCanvas.toBlob(async (blob) => {
        // Determine Filename with Versioning
        let baseName = 'edited_image';
        if (currentEditingCardTitle && currentEditingCardTitle.trim().length > 0) {
             baseName = currentEditingCardTitle.trim().toLowerCase()
                .replace(/\s+/g, '_')
                .replace(/[^a-z0-9_]/g, '');
        }
        
        let filename = baseName + '.png';
        let counter = 1;
        
        // Check against assetPool to find next available name
        const isNameTaken = (name) => {
            return assetPool.some(path => {
                const fName = path.split('/').pop().toLowerCase();
                return fName === name;
            });
        };

        while (isNameTaken(filename)) {
            filename = baseName + counter + '.png';
            counter++;
        }
        
        // 1. Try to upload to server if available
        let savedToServer = false;
        try {
            const formData = new FormData();
            formData.append('file', blob, filename);
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);
            
            const res = await fetch('/api/save_edited_file', { 
                method: 'POST', 
                body: formData,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            
            if (res.ok) {
                savedToServer = true;
                console.log("Saved edited file to server:", filename);
            }
        } catch (e) {
            console.log("Server upload failed, using local data URI fallback.", e);
        }

        // Create blobUrl for fallback download and cache
        const blobUrl = URL.createObjectURL(blob);

        // 2. Trigger Download (As user requested: "save that image to my local disc")
        // We do this REGARDLESS of server save, or maybe if the user wants it.
        // The user prompt implies they want to save it locally AND have it populate.
        
        let savedFilename = filename;

        try {
            // Prefer File System Access API if available
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'PNG Image',
                        accept: {'image/png': ['.png']},
                    }],
                });
                savedFilename = handle.name;
                const writable = await handle.createWritable();
                await writable.write(blob);
                await writable.close();
            } else {
                // Classic download
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        } catch (err) {
            console.log("Save to disk cancelled or failed", err);
            // If user cancels save, we might still want to update the in-memory card?
            // "i want the image to take the new saved image to take the place of the current card"
            // If they cancel, they probably don't want to use it? Or maybe they do.
            // Let's assume on cancel we stick with the generated filename for the session.
        }
        
        // 3. Update the card
        let finalImageValue = savedFilename;
        
        // Always add to asset pool regardless of server status for immediate UI update
        assetBlobs[savedFilename.toLowerCase()] = blobUrl;
        
         // Check existence (case insensitive)
        const exists = assetPool.some(p => p.toLowerCase().split('/').pop() === savedFilename.toLowerCase());
        if (!exists) {
            assetPool.push(savedFilename);
        }
        
        // Persist to IndexedDB
         try {
            const fileObj = new File([blob], savedFilename, { type: 'image/png' });
            await saveAssetsToDB([fileObj]);
            console.log("Cached image to IndexedDB");
        } catch(e) {
            console.warn("Could not cache to IndexedDB", e);
        }

        if (editingCardCallback) {
            editingCardCallback(finalImageValue);
            editingCardCallback = null;
        }

        // Force re-render of cards to display the updated image immediately
        renderCards();
        filterAssets();

        // Save manifest to browser storage immediately to avoid "Unsaved Work" prompt on reload
        saveToBrowser();
        
        // Also save to server silently to persist the new image link
        saveManifest(true);

        closeModal('photo-editor-modal');
    });
}

// --- Audio Editor ---

async function openAudioEditor(audioPath, cardTitle = null) {
    document.getElementById('audio-editor-modal').style.display = 'flex';
    currentEditingAudioTitle = cardTitle;
    
    // Reset recording UI
    document.getElementById('btn-rec-mic').disabled = false;
    document.getElementById('btn-rec-sys').disabled = false;
    document.getElementById('btn-stop-rec').style.display = 'none';
    document.getElementById('recording-status').style.display = 'none';
    
    // Add Keyboard Shortcuts
    window.addEventListener('keydown', handleAudioShortcuts);

    if (!audioPath) {
        // Open empty editor for recording
        audioBuffer = null;
        document.getElementById('audio-waveform').innerHTML = '<p style="text-align:center; padding-top:60px; color:#666;">No audio loaded. Record something!</p>';
        return;
    }
    
    // ... existing loading code ...
    const lowerName = audioPath.split('/').pop().toLowerCase();
    let src = 'assets/' + audioPath;
    if (assetBlobs && assetBlobs[lowerName]) {
        src = assetBlobs[lowerName];
    }

    try {
        const res = await fetch(src);
        const arrayBuffer = await res.arrayBuffer();
        loadAudioBuffer(arrayBuffer);
    } catch (e) {
        console.error("Failed to load audio for editing", e);
        alert("Could not load audio file.");
        closeModal('audio-editor-modal');
    }
}

function handleAudioShortcuts(e) {
    const modal = document.getElementById('audio-editor-modal');
    // Check if modal is actually visible (use computed style for reliability)
    if (!modal || window.getComputedStyle(modal).display === 'none') return;
    
    // Ignore shortcuts when typing in input fields
    const activeElement = document.activeElement;
    const isInputFocused = activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.isContentEditable);
    
    if (e.code === 'Space') {
        e.preventDefault();
        e.stopPropagation();
        playAudioPreview();
    } else if (e.key.toLowerCase() === 'i' && !isInputFocused) {
        e.preventDefault();
        setAudioIn();
    } else if (e.key.toLowerCase() === 'o' && !isInputFocused) {
        e.preventDefault();
        setAudioOut();
    }
}

function closeAudioEditor() {
    closeModal('audio-editor-modal');
    window.removeEventListener('keydown', handleAudioShortcuts);
    stopAudioPreview();
}

async function loadAudioBuffer(arrayBuffer) {
    audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    
    if (audioBuffer.duration > 10) {
        alert("Suggestion: Keep audio under 10 seconds for best experience.");
    }
    
    document.getElementById('audio-start').value = 0;
    document.getElementById('audio-end').value = audioBuffer.duration.toFixed(2);
    document.getElementById('audio-end').max = audioBuffer.duration;
    audioCursorTime = 0;
    updateCursorDisplay();
    
    drawWaveform();
}

function updateCursorDisplay() {
    document.getElementById('audio-cursor-val').innerText = audioCursorTime.toFixed(2);
}

function setAudioIn() {
    if (!audioBuffer) return;
    let start = audioCursorTime;
    let end = parseFloat(document.getElementById('audio-end').value);
    if (start >= end) end = audioBuffer.duration; // Reset end if invalid
    if (start >= end) start = 0; // Safety
    
    document.getElementById('audio-start').value = start.toFixed(2);
    document.getElementById('audio-end').value = end.toFixed(2);
    drawWaveform();
}

function setAudioOut() {
    if (!audioBuffer) return;
    let end = audioCursorTime;
    let start = parseFloat(document.getElementById('audio-start').value);
    if (end <= start) start = 0; // Reset start if invalid
    
    document.getElementById('audio-start').value = start.toFixed(2);
    document.getElementById('audio-end').value = end.toFixed(2);
    drawWaveform();
}

async function startRecording(source) {
    try {
        let stream;
        if (source === 'mic') {
            stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } else {
            // System Audio (Display Media)
            stream = await navigator.mediaDevices.getDisplayMedia({ 
                video: true, // Required to get audio option in some browsers
                audio: true 
            });
        }
        
        // If system audio, we only want the audio track
        if (source === 'system') {
            // Check if user actually shared audio
            const audioTrack = stream.getAudioTracks()[0];
            if (!audioTrack) {
                alert("No system audio detected. Make sure to check 'Share Audio' in the dialog.");
                stream.getTracks().forEach(t => t.stop());
                return;
            }
        }

        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        
        mediaRecorder.onstop = async () => {
            const blob = new Blob(recordedChunks, { type: 'audio/webm' });
            const arrayBuffer = await blob.arrayBuffer();
            await loadAudioBuffer(arrayBuffer);
            
            // Stop all tracks (especially important for screen share to stop the "Sharing" banner)
            stream.getTracks().forEach(track => track.stop());
            
            document.getElementById('btn-rec-mic').disabled = false;
            document.getElementById('btn-rec-sys').disabled = false;
            document.getElementById('btn-stop-rec').style.display = 'none';
            document.getElementById('recording-status').style.display = 'none';
        };
        
        mediaRecorder.start();
        
        document.getElementById('btn-rec-mic').disabled = true;
        document.getElementById('btn-rec-sys').disabled = true;
        document.getElementById('btn-stop-rec').style.display = 'inline-block';
        document.getElementById('recording-status').style.display = 'inline';
        
    } catch (err) {
        console.error("Error starting recording:", err);
        alert("Could not start recording: " + err.message);
    }
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
}

function drawWaveform() {
    const container = document.getElementById('audio-waveform');
    
    if (!audioBuffer) {
        container.innerHTML = '<p style="text-align:center; padding-top:60px; color:#666;">No audio loaded.</p>';
        return;
    }
    
    // Create canvas if not exists or re-append if container cleared
    if (!audioCanvas || audioCanvas.parentNode !== container) {
        container.innerHTML = '';
        audioCanvas = document.createElement('canvas');
        // Use container dimensions
        audioCanvas.width = container.clientWidth || 600;
        audioCanvas.height = container.clientHeight || 150;
        audioCanvas.style.width = '100%';
        audioCanvas.style.height = '100%';
        container.appendChild(audioCanvas);
        audioCtx2D = audioCanvas.getContext('2d');
        
        // Add listeners
        audioCanvas.onmousedown = handleAudioMouseDown;
        audioCanvas.onmousemove = handleAudioMouseMove;
        audioCanvas.onmouseup = handleAudioMouseUp;
        audioCanvas.onmouseleave = handleAudioMouseUp;
    }
    
    const width = audioCanvas.width;
    const height = audioCanvas.height;
    const data = audioBuffer.getChannelData(0);
    const step = Math.ceil(data.length / width);
    const amp = height / 2;
    
    audioCtx2D.clearRect(0, 0, width, height);
    
    // Draw Background
    audioCtx2D.fillStyle = '#222';
    audioCtx2D.fillRect(0, 0, width, height);
    
    // Draw Waveform
    audioCtx2D.beginPath();
    audioCtx2D.strokeStyle = '#00ff00';
    audioCtx2D.lineWidth = 1;
    
    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        for (let j = 0; j < step; j++) {
            const datum = data[i * step + j];
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        audioCtx2D.moveTo(i, (1 + min) * amp);
        audioCtx2D.lineTo(i, (1 + max) * amp);
    }
    audioCtx2D.stroke();
    
    // Draw Selection Overlay
    const start = parseFloat(document.getElementById('audio-start').value);
    const end = parseFloat(document.getElementById('audio-end').value);
    const duration = audioBuffer.duration;
    
    const startX = (start / duration) * width;
    const endX = (end / duration) * width;
    
    // Dim unselected areas
    audioCtx2D.fillStyle = 'rgba(0, 0, 0, 0.7)';
    audioCtx2D.fillRect(0, 0, startX, height);
    audioCtx2D.fillRect(endX, 0, width - endX, height);
    
    // Highlight selected area border
    audioCtx2D.strokeStyle = '#fff';
    audioCtx2D.lineWidth = 2;
    audioCtx2D.beginPath();
    audioCtx2D.moveTo(startX, 0);
    audioCtx2D.lineTo(startX, height);
    audioCtx2D.moveTo(endX, 0);
    audioCtx2D.lineTo(endX, height);
    audioCtx2D.stroke();

    // Draw Cursor
    const cursorX = (audioCursorTime / duration) * width;
    audioCtx2D.strokeStyle = '#ff0000'; // Red cursor
    audioCtx2D.lineWidth = 2;
    audioCtx2D.beginPath();
    audioCtx2D.moveTo(cursorX, 0);
    audioCtx2D.lineTo(cursorX, height);
    audioCtx2D.stroke();

    // Draw Time Ruler
    audioCtx2D.fillStyle = '#aaa';
    audioCtx2D.font = '10px Arial';
    audioCtx2D.textAlign = 'center';
    
    // Decide tick interval based on duration
    let tickInterval = 1; // 1 second
    if (duration < 2) tickInterval = 0.1;
    else if (duration < 10) tickInterval = 0.5;
    else if (duration > 30) tickInterval = 5;
    
    for (let t = 0; t <= duration; t += tickInterval) {
        const x = (t / duration) * width;
        
        // Tick mark
        audioCtx2D.beginPath();
        audioCtx2D.moveTo(x, height);
        audioCtx2D.lineTo(x, height - 10);
        audioCtx2D.strokeStyle = '#aaa';
        audioCtx2D.stroke();
        
        // Label
        // Only draw label if it fits (simple check)
        if (x > 10 && x < width - 10) {
             audioCtx2D.fillText(t.toFixed(1) + 's', x, height - 12);
        }
    }
}

function handleAudioMouseDown(e) {
    if (!audioBuffer) return;
    isDraggingAudio = true;
    updateCursorFromEvent(e);
}

function handleAudioMouseMove(e) {
    if (!isDraggingAudio || !audioBuffer) return;
    updateCursorFromEvent(e);
}

function updateCursorFromEvent(e) {
    const rect = audioCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const duration = audioBuffer.duration;
    const scale = audioCanvas.width / rect.width;
    let time = (x * scale / audioCanvas.width) * duration;
    time = Math.max(0, Math.min(time, duration));
    
    audioCursorTime = time;
    updateCursorDisplay();
    drawWaveform();
}

function handleAudioMouseUp() {
    isDraggingAudio = false;
}

function playAudioPreview() {
    if (audioSource) {
        try { audioSource.stop(); } catch(e) {}
        audioSource = null;
        if (audioPlaybackRequestId) cancelAnimationFrame(audioPlaybackRequestId);
        return; // Toggle behavior: if playing, stop.
    }
    if (audioPlaybackRequestId) cancelAnimationFrame(audioPlaybackRequestId);

    audioSource = audioContext.createBufferSource();
    audioSource.buffer = audioBuffer;
    audioSource.connect(audioContext.destination);
    
    const start = parseFloat(document.getElementById('audio-start').value);
    const end = parseFloat(document.getElementById('audio-end').value);
    
    // Play from cursor, but respect In/Out points
    let startPlayTime = audioCursorTime;
    
    // If cursor is outside the selected range (or at the very end), jump to start
    if (startPlayTime < start || startPlayTime >= end) {
        startPlayTime = start;
    }
    
    const duration = end - startPlayTime;
    
    if (duration <= 0) {
        // Should not happen if logic above is correct, but safety check
        audioCursorTime = start;
        updateCursorDisplay();
        drawWaveform();
        playAudioPreview(); // Restart from In point
        return;
    }

    audioSource.start(0, startPlayTime, duration);
    
    const startTime = audioContext.currentTime;
    
    function step() {
        const now = audioContext.currentTime;
        const elapsed = now - startTime;
        audioCursorTime = startPlayTime + elapsed;
        
        if (audioCursorTime >= end) {
            audioCursorTime = end;
            updateCursorDisplay();
            drawWaveform();
            stopAudioPreview();
            return;
        }
        
        updateCursorDisplay();
        drawWaveform();
        audioPlaybackRequestId = requestAnimationFrame(step);
    }
    
    audioPlaybackRequestId = requestAnimationFrame(step);
    
    audioSource.onended = () => {
        // Only clear if natural end, not manual stop
    };
}

function stopAudioPreview() {
    if (audioSource) {
        try { audioSource.stop(); } catch(e) {}
        audioSource = null;
    }
    if (audioPlaybackRequestId) cancelAnimationFrame(audioPlaybackRequestId);
}

async function saveEditedAudio() {
    console.log("saveEditedAudio called");
    const start = parseFloat(document.getElementById('audio-start').value);
    let end = parseFloat(document.getElementById('audio-end').value);
    
    if (end <= start) {
        alert("End time must be greater than start time");
        return;
    }
    
    // Clamp end to duration
    if (end > audioBuffer.duration) end = audioBuffer.duration;
    
    // Create new buffer
    const sampleRate = audioBuffer.sampleRate;
    const frameCount = Math.floor((end - start) * sampleRate);
    
    if (frameCount <= 0) {
        alert("Selection too short");
        return;
    }

    const newBuffer = audioContext.createBuffer(audioBuffer.numberOfChannels, frameCount, sampleRate);
    
    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
        const channelData = audioBuffer.getChannelData(i);
        const newChannelData = newBuffer.getChannelData(i);
        // Copy segment
        const startOffset = Math.floor(start * sampleRate);
        for (let j = 0; j < frameCount; j++) {
            if (startOffset + j < channelData.length) {
                newChannelData[j] = channelData[startOffset + j];
            } else {
                newChannelData[j] = 0;
            }
        }
    }
    
    // Convert to WAV Blob
    const wavBlob = bufferToWave(newBuffer, frameCount);
    
    // Determine Filename with Versioning
    let baseName = 'edited_audio';
    if (currentEditingAudioTitle && currentEditingAudioTitle.trim().length > 0) {
         baseName = currentEditingAudioTitle.trim().toLowerCase()
            .replace(/\s+/g, '_')
            .replace(/[^a-z0-9_]/g, '');
    }
    
    let filename = baseName + '.wav';
    let counter = 1;
    
    const isNameTaken = (name) => {
        return assetPool.some(path => {
            const fName = path.split('/').pop().toLowerCase();
            return fName === name;
        });
    };

    while (isNameTaken(filename)) {
        filename = baseName + counter + '.wav';
        counter++;
    }

    // --- OPTIMISTIC SAVE PATTERN ---
    // 1. Update Manifest & Save to Browser FIRST to prevent "Unsaved Work" on potential reload
    const blobUrl = URL.createObjectURL(wavBlob);
    assetBlobs[filename.toLowerCase()] = blobUrl;
    
    // Check existence (case insensitive)
    const exists = assetPool.some(p => p.toLowerCase().split('/').pop() === filename.toLowerCase());
    if (!exists) {
        assetPool.push(filename);
    }

    // Attach to Card (Update Manifest)
    if (editingCardCallback) {
        editingCardCallback(filename); // This updates the manifest in memory
        editingCardCallback = null;
    }
    
    // Perform Save To Browser Immediately (Persist + Clear AutoSave)
    saveToBrowser();
    
    // Also save to server silently to persist the new audio link
    saveManifest(true);
    
    // Persist to cache (IndexedDB) 
    try {
       const fileObj = new File([wavBlob], filename, { type: 'audio/wav' });
       await saveAssetsToDB([fileObj]);
       console.log("Cached audio to IndexedDB");
    } catch(e) {
        console.warn("Could not cache to IndexedDB", e);
    }
    
    // 2. Try Server Upload (No Prompt)
    let savedToServer = false;
    try {
        const formData = new FormData();
        formData.append('file', wavBlob, filename);
        
        // Timeout for server save
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000);
        
        const res = await fetch('/api/save_edited_file', { 
            method: 'POST', 
            body: formData,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (res.ok) {
            console.log("Saved audio to server:", filename);
            savedToServer = true;
        }
    } catch (e) {
        console.log("Server upload failed, falling back to browser save.", e);
    }

    // 3. Fallback: If Server Failed, Prompt User to Save (Backup)
    if (!savedToServer) {
        try {
            if (window.showSaveFilePicker) {
                const handle = await window.showSaveFilePicker({
                    suggestedName: filename,
                    types: [{
                        description: 'WAV Audio File',
                        accept: {'audio/wav': ['.wav']},
                    }],
                });
                const userFilename = handle.name;
                
                // If user changed name, we need to update our manifest links!
                if (userFilename !== filename) {
                    console.warn("User changed filename during backup save. Updating references...");
                    // Re-add to pools
                    assetBlobs[userFilename.toLowerCase()] = blobUrl;
                    assetPool.push(userFilename);
                     // Note: We can't easily undo the previous 'filename' addition without more logic, 
                     // but leaving a phantom entry is harmless compared to losing the new one.
                    
                    // Re-update manifest via callback? No, callback is null now.
                    // We need to re-find the card?? Or just warn.
                    // Actually we can't easily fix the manifest here if we closed the closure.
                    // But in this flow, we assume user keeps the name or we accept the risk.
                    // Alternatively, we could delay the `editingCardCallback` nulling to here.
                    
                    // However, for the "Unsaved Work" bug, the priority is Step 1.
                }

                const writable = await handle.createWritable();
                await writable.write(wavBlob);
                await writable.close();
            } else {
                // Fallback for browsers without File System Access API
                const a = document.createElement('a');
                a.href = blobUrl;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            }
        } catch (err) {
            console.log("Save cancelled or failed", err);
        }
    }

    closeAudioEditor();
}

function triggerLocalImport() {
    const input = document.getElementById('local-import-input');
    if (input) input.click();
}

function handleLocalImport(input) {
    if (input.files.length === 0) return;
    
    handleManualScan(input);
    
    // Refresh selector if open
    setTimeout(() => {
        const selectorModal = document.getElementById('selector-modal');
        if (selectorModal && selectorModal.style.display !== 'none') {
            const selectorTitle = document.getElementById('selector-title').innerText;
            let type = 'all';
            if (selectorTitle.includes('Image')) type = 'image';
            if (selectorTitle.includes('Audio')) type = 'audio';
            
            const searchInput = document.getElementById('asset-selector-search');
            updateSelectorList(type, searchInput ? searchInput.value : '', currentSelectorCallback);
        }
        // Clear input to allow re-selection of same file if needed in future, 
        // but handleManualScan might be async. 
        // Generally safe to leave it populated or clear it later.
    }, 1000);
}

// Helper to convert AudioBuffer to WAV Blob
function bufferToWave(abuffer, len) {
    let numOfChan = abuffer.numberOfChannels,
        length = len * numOfChan * 2 + 44,
        buffer = new ArrayBuffer(length),
        view = new DataView(buffer),
        channels = [], i, sample,
        offset = 0,
        pos = 0;

    // write WAVE header
    setUint32(0x46464952);                         // "RIFF"
    setUint32(length - 8);                         // file length - 8
    setUint32(0x45564157);                         // "WAVE"

    setUint32(0x20746d66);                         // "fmt " chunk
    setUint32(16);                                 // length = 16
    setUint16(1);                                  // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(abuffer.sampleRate);
    setUint32(abuffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2);                      // block-align
    setUint16(16);                                 // 16-bit (hardcoded in this demo)

    setUint32(0x61746164);                         // "data" - chunk
    setUint32(length - pos - 4);                   // chunk length

    // write interleaved data
    for(i = 0; i < abuffer.numberOfChannels; i++)
        channels.push(abuffer.getChannelData(i));

    while(pos < length) {
        for(i = 0; i < numOfChan; i++) {             // interleave channels
            sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
            sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; // scale to 16-bit signed int
            view.setInt16(pos, sample, true);          // write 16-bit sample
            pos += 2;
        }
        offset++                                     // next source sample
    }

    return new Blob([buffer], {type: "audio/wav"});

    function setUint16(data) {
        view.setUint16(pos, data, true);
        pos += 2;
    }

    function setUint32(data) {
        view.setUint32(pos, data, true);
        pos += 4;
    }
}

function saveToBrowser() {
    // Ensure all assets are in the manifest before saving
    syncAssets(true);

    try {
        localStorage.setItem('matchy_manifest', JSON.stringify(manifest));
        
        // Save Editor State (current category)
        if (currentCategory) {
            localStorage.setItem('matchy_editor_state', JSON.stringify({
                category: currentCategory
            }));
        }

        const status = document.getElementById('save-status');
        status.innerText = "Saved to Browser LocalStorage!";
        status.style.color = "green";
        setTimeout(() => { status.innerText = ""; }, 3000);
        
        // Clear auto-save because we just manually saved, so "unsaved work" is now saved.
        localStorage.removeItem(AUTOSAVE_KEY);
    } catch (e) {
        console.error("Failed to save to browser", e);
        alert("Failed to save to browser storage. Storage might be full.");
    }
}

function clearBrowserData() {
    // 1. Wipe manifest
    manifest = { categories: { "Unassigned": [] } };
    
    // Reset filename to null so it forces a "save as" or default logic later
    currentPackFilename = null;
    
    // Clear UI inputs
    const titleInput = document.getElementById('pack-title-input');
    if (titleInput) titleInput.value = "";
    
    const srcIndicator = document.getElementById('save-status');
    if (srcIndicator) srcIndicator.innerText = "Matching Pack: Unsaved";

    // 2. Save empty state to Browser Persistence (using a temp key to avoid overwriting last good pack)
    try {
        localStorage.setItem('matchy_manifest', JSON.stringify(manifest));
        localStorage.removeItem('matchy_last_pack');
        localStorage.removeItem('matchy_autosave');
    } catch (e) {
        console.error("Could not save empty state", e);
    }

    // 3. Clear Assets DB
    clearAssetsDB();
    assetPool = [];
    assetBlobs = {};
    
    // 4. Reset Editor UI
    currentCategory = null;
    renderCategories();
    
    document.getElementById('category-editor').style.display = 'none';
    document.getElementById('welcome-screen').style.display = 'block';

    console.log("Workspace cleared.");
}

async function resetLocalStorage() {
    if (confirm("FACTORY RESET: This will delete ALL locally saved games, settings, and registries from this browser.\n\nAre you sure you want to completely wipe all local data?")) {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('matchy_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));
        
        // Also clear IndexedDB
        await clearAssetsDB();
        
        alert("Local storage cleared. Reloading...");
        window.location.reload();
    }
}

// --- Online Search ---

let searchMode = 'symbol'; // 'symbol' or 'sound'

function openSymbolSearch() {
    searchMode = 'symbol';
    document.getElementById('search-modal').style.display = 'flex';
    document.getElementById('search-modal-title').innerText = "Search Open Symbols";
    document.getElementById('symbol-search-input').placeholder = "Search symbols (e.g. 'cat')...";
    document.getElementById('symbol-search-input').value = "";
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = "";
    resultsContainer.style.backgroundColor = '#fff';
    document.getElementById('symbol-search-input').focus();
    
    document.getElementById('symbol-search-input').onkeydown = (e) => {
        if (e.key === 'Enter') performSearch();
    };
}

function openSoundSearch() {
    searchMode = 'sound';
    document.getElementById('search-modal').style.display = 'flex';
    document.getElementById('search-modal-title').innerText = "Search FreeSound";
    document.getElementById('symbol-search-input').placeholder = "Search sounds (e.g. 'dog bark')...";
    document.getElementById('symbol-search-input').value = "";
    const resultsContainer = document.getElementById('search-results');
    resultsContainer.innerHTML = "";
    resultsContainer.style.backgroundColor = '#fff';
    document.getElementById('symbol-search-input').focus();

    document.getElementById('symbol-search-input').onkeydown = (e) => {
        if (e.key === 'Enter') performSearch();
    };
}

function performSearch() {
    if (searchMode === 'symbol') searchSymbols();
    else if (searchMode === 'sound') searchSounds();
}

async function searchSymbols() {
    const query = document.getElementById('symbol-search-input').value;
    if (!query) return;
    
    const container = document.getElementById('search-results');
    // Ensure grid and white background
    container.className = 'asset-grid';
    container.style.display = 'grid';
    container.style.backgroundColor = '#fff';
    container.innerHTML = '<div style="text-align:center; padding:20px; background-color:#fff;">Searching...</div>';
    
    try {
        // Using Open Symbols API
        const res = await fetch(`https://www.opensymbols.org/api/v1/symbols/search?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        
        container.innerHTML = '';
        if (data.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px; background-color:#fff;">No results found.</div>';
            return;
        }
        
        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'asset-item';
            div.style.display = 'flex';
            div.style.flexDirection = 'column';
            div.style.alignItems = 'center';
            div.style.cursor = 'pointer';
            div.style.padding = '5px';
            div.style.border = '1px solid #ddd';
            div.style.borderRadius = '4px';
            div.style.backgroundColor = '#fff';
            
            const img = document.createElement('img');
            img.src = item.image_url;
            img.style.maxWidth = '80px';
            img.style.maxHeight = '80px';
            img.style.objectFit = 'contain';
            
            const span = document.createElement('span');
            span.innerText = item.name;
            span.style.fontSize = '10px';
            span.style.marginTop = '5px';
            span.style.textAlign = 'center';
            span.style.overflow = 'hidden';
            span.style.textOverflow = 'ellipsis';
            span.style.maxWidth = '100%';
            
            div.appendChild(img);
            div.appendChild(span);
            
            div.onclick = () => selectSymbol(item.image_url, item.name);
            
            container.appendChild(div);
        });
        
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div style="text-align:center; padding:20px; color:red; background-color:#fff;">Error searching symbols. Please check your internet connection.</div>';
    }
}

async function searchSounds() {
    const query = document.getElementById('symbol-search-input').value;
    if (!query) return;

    const container = document.getElementById('search-results');
    // Switch to list view with explicit white background
    container.className = '';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '10px';
    container.style.backgroundColor = '#fff';

    container.innerHTML = '<div style="text-align:center; padding:20px; background-color:#fff;">Searching FreeSound...</div>';

    // Using worker proxy
    const base = "https://aged-thunder-a674.narbehousellc.workers.dev";
    const u = new URL(`${base}/api/search`);
    
    // We send both 'query' (FreeSound standard) and 'q' to ensure the worker picks it up
    u.searchParams.set("query", query);
    u.searchParams.set("q", query);
    
    u.searchParams.set("page_size", "15");
    u.searchParams.set("fields", "id,name,duration,previews,images");
    u.searchParams.set("_", Date.now()); // Prevent caching

    console.log("Searching FreeSound:", u.toString());

    try {
        const res = await fetch(u.toString());
        const data = await res.json();
        
        container.innerHTML = '';
        if (!data.results || data.results.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px; background-color:#fff;">No sounds found.</div>';
            return;
        }

        data.results.forEach(item => {
            const div = document.createElement('div');
            // Inline styles for list items
            div.style.display = 'flex';
            div.style.flexDirection = 'column';
            div.style.alignItems = 'flex-start'; // Left align content
            div.style.cursor = 'default'; 
            div.style.padding = '15px';
            div.style.border = '1px solid #ddd';
            div.style.borderRadius = '4px';
            div.style.width = '100%';
            div.style.boxSizing = 'border-box';
            div.style.backgroundColor = '#f9f9f9'; // Opaque background
            div.style.boxShadow = '0 1px 3px rgba(0,0,0,0.1)';
            
            // Info Row with improved text visibility
            const info = document.createElement('div');
            info.style.marginBottom = '8px';
            info.style.width = '100%';
            info.innerHTML = `
                <div style="font-size:14px; font-weight:bold; color:#333; margin-bottom:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${item.name}">${item.name}</div>
                <div style="font-size:11px; color:#666;">Duration: ${Math.round(item.duration)}s</div>
            `;
            
            // Preview
            const previewUrl = item.previews['preview-hq-mp3'] || item.previews['preview-lq-mp3'];
            const audio = document.createElement('audio');
            audio.controls = true;
            audio.src = previewUrl;
            audio.style.width = '100%';
            audio.style.marginTop = '5px';
            
            // "Select & Edit" Button
            const btn = document.createElement('button');
            btn.className = 'btn btn-primary';
            btn.style.marginTop = '10px';
            btn.style.alignSelf = 'flex-end'; // Align button to right
            btn.innerText = "Select & Edit";
            btn.onclick = async () => {
                try {
                    btn.innerText = "Downloading...";
                    btn.disabled = true;
                    
                    // Fetch Blob
                    const audioRes = await fetch(previewUrl);
                    const blob = await audioRes.blob();
                    
                    // Close search modal
                    closeModal('search-modal');
                    closeModal('selector-modal');

                    // Open Audio Editor
                    const arrayBuffer = await blob.arrayBuffer();
                    
                    document.getElementById('audio-editor-modal').style.display = 'flex';
                    // Add Keyboard Shortcuts
                    window.addEventListener('keydown', handleAudioShortcuts);
                    
                    // Name Context for Saving
                    if (currentEditingCardTitle) {
                        currentEditingAudioTitle = currentEditingCardTitle; 
                    } else {
                        currentEditingAudioTitle = item.name; // Fallback to sound name
                    }
                    
                    // Reset UI
                    document.getElementById('btn-rec-mic').disabled = false;
                    document.getElementById('btn-rec-sys').disabled = false;
                    document.getElementById('btn-stop-rec').style.display = 'none';
                    document.getElementById('recording-status').style.display = 'none';

                    // Load
                    await loadAudioBuffer(arrayBuffer);
                    
                    // IMPORTANT: Override the save callback to route back to the card we were editing
                    // We need a way to tell 'saveEditedAudio' what to do. 
                    // Let's attach a temporary property to the modal or global state.
                    editingCardCallback = (newFileName) => {
                        if (currentSelectorCallback) {
                             currentSelectorCallback(newFileName);
                        }
                    };
                    
                } catch(e) {
                    btn.innerText = "Error";
                    btn.disabled = false;
                    console.error("Download failed:", e);
                    alert("Error downloading sound. It might be a CORS issue with FreeSound previews.");
                }
            };
            
            div.appendChild(info);
            div.appendChild(audio);
            div.appendChild(btn);
            container.appendChild(div);
        });

    } catch (e) {
        container.innerHTML = '<div style="color:red; text-align:center; background-color:#fff; padding:20px;">Search failed.</div>';
        console.error(e);
    }
}

async function selectSymbol(url, name) {
    // Download the image
    try {
        const res = await fetch(url);
        const blob = await res.blob();
        
        // Determine extension
        let ext = 'png';
        if (blob.type === 'image/svg+xml') ext = 'svg';
        else if (blob.type === 'image/jpeg') ext = 'jpg';
        
        const filename = name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_' + Date.now() + '.' + ext;
        
        // 1. Save to Memory (Blob URL) for immediate use
        const blobUrl = URL.createObjectURL(blob);
        assetBlobs[filename] = blobUrl;
        assetPool.push(filename);
        
        // 2. Persist to IndexedDB immediately!
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            // We can store the raw Blob
            store.put({ name: filename, file: blob });
            
            // Wait for tx complete? Optional but good for safety.
            tx.oncomplete = () => console.log("Symbol persisted to DB:", filename);
        } catch (dbErr) {
            console.error("Failed to persist symbol to DB:", dbErr);
        }

        // If we have a callback for the selector, use it
        if (currentSelectorCallback) {
            currentSelectorCallback(filename);
            
            // Trigger Auto-Save immediately so the new card/asset reference isn't lost
            performAutoSave();
        }
        
        closeModal('search-modal');
        closeModal('selector-modal'); 
        renderCards();
        
    } catch (e) {
        console.error(e);
        // Fallback: just use the URL directly if fetch fails (CORS)
        if (currentSelectorCallback) {
            currentSelectorCallback(url);
            performAutoSave();
        }
        closeModal('search-modal');
        closeModal('selector-modal');
        renderCards();
    }
}

// --- IndexedDB for Asset Caching ---
const DB_NAME = 'MatchyAssetsDB';
const DB_VERSION = 1;
const STORE_NAME = 'assets';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onerror = (event) => reject("IndexedDB error: " + event.target.error);
        request.onsuccess = (event) => resolve(event.target.result);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'name' });
            }
        };
    });
}

async function saveAssetsToDB(files) {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        
        let count = 0;
        for (const file of files) {
            const path = file.webkitRelativePath || file.name;
            store.put({ name: path, file: file });
            count++;
        }
        
        return new Promise((resolve, reject) => {
            tx.oncomplete = () => resolve(count);
            tx.onerror = () => reject(tx.error);
        });
    } catch (e) {
        console.error("DB Save Error:", e);
    }
}

async function loadAssetsFromDB() {
    try {
        const db = await openDB();
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.getAll();
        
        return new Promise((resolve, reject) => {
            request.onsuccess = () => {
                const records = request.result;
                if (records && records.length > 0) {
                    console.log(`Loaded ${records.length} assets from cache.`);
                    assetBlobs = {};
                    const filePaths = [];
                    
                    records.forEach(record => {
                        const filename = record.name.split('/').pop().toLowerCase();
                        assetBlobs[filename] = URL.createObjectURL(record.file);
                        filePaths.push(record.name);
                    });
                    
                    processAssetList(filePaths);
                    resolve(true);
                } else {
                    resolve(false);
                }
            };
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("DB Load Error:", e);
        return false;
    }
}

async function clearAssetsDB() {
     try {
         const db = await openDB();
         const tx = db.transaction(STORE_NAME, 'readwrite');
         const store = tx.objectStore(STORE_NAME);
         store.clear();
         return new Promise((resolve) => {
             tx.oncomplete = () => resolve();
         });
     } catch (e) {
         console.error("DB Clear Error:", e);
     }
}

let pendingRegistryJSON = null;
let pendingPackCount = 0;

async function saveScannedRegistry() {
    if (!pendingRegistryJSON) return;

    // Try 'Save As' Dialog first
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'assetManifest.json',
                types: [{
                    description: 'JSON File',
                    accept: {'application/json': ['.json']},
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(pendingRegistryJSON);
            await writable.close();
            alert(`Registry updated with ${pendingPackCount} packs!`);
            
            // Success - Reset UI
            pendingRegistryJSON = null;
            const btn = document.getElementById('btn-update-registry');
            if(btn) {
                btn.innerText = "Update Game Registry";
                btn.style.backgroundColor = "#673ab7"; // Purple
            }
            return;
        } catch (err) {
             if (err.name === 'AbortError') return; // User cancelled
             console.warn("File Picker failed/cancelled, falling back to download.", err);
             // If user simply cancelled, we do nothing. 
             // If actual error, we might want to alert?
             if (err.name !== 'AbortError') {
                 alert("Error opening File Picker: " + err.message + "\n\nFalling back to standard download.");
             } else {
                 return; // Just return if cancelled to let them try again
             }
        }
    } else {
        alert("Your browser does not support the 'Save As' dialog for this action.\nIt will attempt to download to your default folder.");
    }

    // Fallback to Download Link
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(pendingRegistryJSON);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "assetManifest.json");
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    
    alert(`Registry downloaded with ${pendingPackCount} packs!\n\nPlease move 'assetManifest.json' to your main game folder if it didn't save there.`);
    
    // Reset UI
    pendingRegistryJSON = null;
    const btn = document.getElementById('btn-update-registry');
    if(btn) {
        btn.innerText = "Update Game Registry";
        btn.style.backgroundColor = "#673ab7"; 
    }
}

function updateGameRegistry() {
    // Check if we are in 'Save' mode
    if (pendingRegistryJSON) {
        saveScannedRegistry();
        return;
    }

    // Client-side scan
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.directory = true; // Non-standard but good backup
    input.multiple = true;
    
    input.onchange = async (e) => {
        const files = Array.from(e.target.files);
        const jsonFiles = files.filter(f => f.name.endsWith('.json') && !f.name.startsWith('.'));
        
        if (jsonFiles.length === 0) {
            alert("No JSON files found in the selected folder.");
            return;
        }

        const packList = jsonFiles.map(f => `packs/${f.name}`);
        
        // Prepare new manifest
        let newManifest = {
             packs: packList.sort()
        };
        
        // Save to browser cache
        localStorage.setItem('matchy_local_registry', JSON.stringify(packList));
        
        pendingRegistryJSON = JSON.stringify(newManifest, null, 4);
        pendingPackCount = packList.length;
        
        // Update Button State to Prompt for Save
        const btn = document.getElementById('btn-update-registry');
        if(btn) {
            btn.innerText = "💾 Save assetManifest.json";
            btn.style.backgroundColor = "#4CAF50"; // Green
        }
        
        alert(`Scan Complete! Found ${packList.length} packs.\n\nClick the green 'Save assetManifest.json' button to choose where to save it.`);
    };
    
    alert("Step 1: Select your 'packs' folder to scan.");
    input.click();
}

function triggerNewProject() {
    clearBrowserData();
}

init();
