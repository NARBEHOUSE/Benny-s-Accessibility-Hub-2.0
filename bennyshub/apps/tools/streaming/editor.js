let allData = [];
let genreData = {}; // Map: "Action" -> "http://image.url"
const TMDB_KEY_STORAGE = 'tmdb_api_key';

// API Proxy helper - routes external API calls through local proxy to bypass CORS
// Works in both Chrome (direct) and Electron (via localhost proxy)
function getApiUrl(service, path) {
    // When running in Electron or on localhost, use the proxy
    const isLocalhost = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
    if (isLocalhost) {
        // Use the local server's API proxy (same origin, avoids CORS)
        return `/api/proxy/${service}/${path}`;
    }
    // Direct API access (for testing in browser outside of Electron)
    const baseUrls = {
        'tmdb': 'https://api.themoviedb.org',
        'opensymbols': 'https://www.opensymbols.org/api/v1',
        'freesound': 'https://api.freesound.org',
        'freesound-proxy': 'https://aged-thunder-a674.narbehousellc.workers.dev'
    };
    return `${baseUrls[service]}/${path}`;
}

// Non-blocking confirm dialog (replaces confirm() to avoid focus issues)
function showConfirm(message) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
        const dialog = document.createElement('div');
        dialog.style.cssText = 'background:#1b1b1b;border:1px solid #333;padding:24px;border-radius:12px;max-width:400px;text-align:center;color:#f5f5f5;';
        dialog.innerHTML = `<p style="margin:0 0 20px 0;font-size:16px;white-space:pre-wrap;">${message}</p>
            <div style="display:flex;gap:12px;justify-content:center;">
                <button id="confirm-ok" style="padding:10px 24px;background:#2b6cf0;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">OK</button>
                <button id="confirm-cancel" style="padding:10px 24px;background:#333;color:white;border:none;border-radius:8px;cursor:pointer;font-size:14px;">Cancel</button>
            </div>`;
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);
        dialog.querySelector('#confirm-ok').onclick = () => { document.body.removeChild(overlay); resolve(true); };
        dialog.querySelector('#confirm-cancel').onclick = () => { document.body.removeChild(overlay); resolve(false); };
        dialog.querySelector('#confirm-ok').focus();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    fetchData();
    setupForm();
    loadTMDBKey();
});

function loadTMDBKey() {
    const k = localStorage.getItem(TMDB_KEY_STORAGE);
    if (k) document.getElementById('tmdb-key').value = k;
}

async function fetchData() {
    try {
        // Load Item Data
        const dataRes = await fetch('data.json');
        if (dataRes.ok) allData = await dataRes.json();
        
        // Load Genre Data
        try {
            const genreRes = await fetch('genres.json');
            if (genreRes.ok) genreData = await genreRes.json();
        } catch (e) { console.log('No genres.json found, starting fresh'); }

        renderTable();
        renderGenreManager();
    } catch (error) {
        console.error('Error loading data:', error);
        const tbody = document.querySelector('#data-table tbody');
        if (tbody) tbody.innerHTML = `<tr><td colspan="4" style="color:red; text-align:center;">Error loading data: ${error.message}</td></tr>`;
        showToast("Critical Error: Could not load data.json. Ensure server is running.");
    }
}

function renderGenreManager() {
    const container = document.getElementById('genre-manager-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Extract unique genres from Items - split comma-separated genres into individual ones
    const uniqueGenres = new Set();
    allData.forEach(item => {
        if (item.genre) {
            // Split by comma and add each individual genre
            item.genre.split(',').forEach(g => {
                const trimmed = g.trim();
                if (trimmed) uniqueGenres.add(trimmed);
            });
        }
    });
    const sortedGenres = Array.from(uniqueGenres).sort();

    sortedGenres.forEach(g => {
        const div = document.createElement('div');
        div.style.padding = '10px';
        div.style.background = '#2c2c2c';
        div.style.borderRadius = '5px';
        
        const label = document.createElement('div');
        label.textContent = g;
        label.style.fontWeight = 'bold';
        label.style.marginBottom = '5px';
        
        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Image URL';
        input.value = genreData[g] || '';
        input.style.width = '100%';
        input.style.padding = '5px';
        input.dataset.genre = g;
        
        div.appendChild(label);
        div.appendChild(input);
        container.appendChild(div);
    });
}

function setupForm() {
    document.getElementById('save-btn').addEventListener('click', saveItem);
    document.getElementById('cancel-btn').addEventListener('click', clearForm);
    document.getElementById('save-genres-btn') && document.getElementById('save-genres-btn').addEventListener('click', saveGenres);
    
    // Auto-detect service from URL
    document.getElementById('url').addEventListener('input', (e) => detectService(e.target.value));
    
    // Handle Service Change -> Icon
    document.getElementById('service').addEventListener('change', updateServiceIcon);
    
    // Handle Image Preview
    document.getElementById('image').addEventListener('input', (e) => {
        const img = document.getElementById('poster-preview');
        img.src = e.target.value;
        img.style.display = e.target.value ? 'block' : 'none';
    });

    // Handle Trailer Preview
    document.getElementById('trailer').addEventListener('input', updateTrailerPreview);

    // Accordion Logic
    // We delegate because we added nested ones
    document.querySelectorAll('.accordion').forEach(acc => {
        acc.addEventListener('click', function() {
           this.classList.toggle("active");
           const panel = this.nextElementSibling;
           if (panel.style.maxHeight && panel.style.maxHeight !== '0px') {
               panel.style.maxHeight = null;
               panel.style.overflow = null;
           } else {
               // Use scrollHeight for perfect fit, or a massive value. 
               // For the data table, it can be huge, so we usually want 'none' or huge.
               // But transitions require a pixel value. 
               // Let's use a dynamic check: if it contains the table, use huge.
               if (panel.querySelector('#data-table')) {
                   panel.style.maxHeight = "none";
                   panel.style.overflow = "visible"; 
               } else {
                   panel.style.maxHeight = panel.scrollHeight + 500 + "px"; // +buffer
               }
           } 
        });
    });

    const search = document.getElementById('table-search');
    if (search) search.addEventListener('input', renderTable);
    
    // TMDB Integration
    document.getElementById('btn-fetch-tmdb').addEventListener('click', handleTMDBFetch);
    document.getElementById('tmdb-key').addEventListener('change', (e) => localStorage.setItem(TMDB_KEY_STORAGE, e.target.value));
    document.getElementById('btn-batch-tmdb').addEventListener('click', handleBatchUpdate);
    
    // Auto-load Key
    fetch('timd-api.json')
        .then(r => r.json())
        .then(d => {
            if(d.key) {
                document.getElementById('tmdb-key').value = d.key;
                localStorage.setItem(TMDB_KEY_STORAGE, d.key);
            }
        })
        .catch(e => console.log('No local API key file found'));
        
    // Select All Listener
    const selectAllBox = document.getElementById('select-all-checkbox');
    if (selectAllBox) {
        selectAllBox.addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.item-checkbox').forEach(cb => cb.checked = checked);
        });
    }
}

// --- UTILS ---
function getSelectedIds() {
    return Array.from(document.querySelectorAll('.item-checkbox:checked')).map(cb => cb.value);
}

// --- TMDB INTEGRATION ---
async function handleTMDBFetch() {
    const key = document.getElementById('tmdb-key').value;
    const title = document.getElementById('title').value;
    const yearInput = document.getElementById('year').value.trim();
    const directorInput = document.getElementById('director').value.toLowerCase().trim();
    
    if (!key) { showToast("Please enter a TMDB API Key."); return; }
    if (!title) { showToast("Please enter a Title to search."); return; }
    
    document.getElementById('btn-fetch-tmdb').textContent = "Searching...";
    
    // Track if user provided specific criteria - if so, we MUST match them
    const hasSpecificCriteria = yearInput || directorInput;
    
    try {
        const res = await fetch(getApiUrl('tmdb', `3/search/multi?api_key=${key}&query=${encodeURIComponent(title)}`));
        const data = await res.json();
        
        if (data.results && data.results.length > 0) {
            let best = null;
            let candidates = data.results.filter(x => x.media_type === 'movie' || x.media_type === 'tv');

            if (candidates.length === 0) {
                showToast("No movies or TV shows found for that title.");
                document.getElementById('btn-fetch-tmdb').textContent = "Auto-Fill (TMDB)";
                return;
            }

            // Check each candidate against the user's criteria
            for (const candidate of candidates) {
                const type = candidate.media_type;
                const detailsRes = await fetch(getApiUrl('tmdb', `3/${type}/${candidate.id}?api_key=${key}&append_to_response=credits`));
                const details = await detailsRes.json();
                
                // Check Year Match (STRICT if provided)
                let yearMatch = true;
                if (yearInput) {
                    const date = details.release_date || details.first_air_date || "";
                    const y = parseInt(date.substring(0, 4));
                    const targetY = parseInt(yearInput);
                    // Exact year match only
                    yearMatch = !isNaN(y) && !isNaN(targetY) && y === targetY;
                }
                
                // Check Director Match (STRICT if provided)
                let directorMatch = true;
                if (directorInput && details.credits) {
                    directorMatch = false; // Assume no match until found
                    const dirs = details.credits.crew.filter(c => c.job === 'Director');
                    const creators = details.created_by || [];
                    const allDirectors = [...dirs.map(d => d.name.toLowerCase()), ...creators.map(c => c.name.toLowerCase())];
                    
                    // Check if any director name matches (full name or last name)
                    for (const dirName of allDirectors) {
                        // Full name match OR last name match
                        if (dirName === directorInput || 
                            dirName.includes(directorInput) || 
                            directorInput.includes(dirName)) {
                            directorMatch = true;
                            break;
                        }
                        // Also check last name
                        const dirParts = dirName.split(' ');
                        const inputParts = directorInput.split(' ');
                        const dirLastName = dirParts[dirParts.length - 1];
                        const inputLastName = inputParts[inputParts.length - 1];
                        if (dirLastName === inputLastName && dirLastName.length > 2) {
                            directorMatch = true;
                            break;
                        }
                    }
                }
                
                // Both criteria must match if they were provided
                if (yearMatch && directorMatch) {
                    best = candidate;
                    break; // Found exact match
                }
                
                // Rate limit protection
                await new Promise(r => setTimeout(r, 250));
            }

            // If user provided criteria but no match found, DO NOT FALLBACK
            if (!best && hasSpecificCriteria) {
                let criteria = [];
                if (yearInput) criteria.push(`year ${yearInput}`);
                if (directorInput) criteria.push(`director "${directorInput}"`);
                showToast(`No match found for "${title}" with ${criteria.join(' and ')}.\n\nTMDB may not have this exact movie, or the criteria don't match their records.\n\nTry removing some criteria or check spelling.`);
                document.getElementById('btn-fetch-tmdb').textContent = "Auto-Fill (TMDB)";
                return;
            }
            
            // Only use first result if NO criteria were provided
            if (!best && !hasSpecificCriteria) {
                best = candidates[0];
            }
            
            if (best) {
                const type = best.media_type;
                const detailsRes = await fetch(getApiUrl('tmdb', `3/${type}/${best.id}?api_key=${key}&append_to_response=credits,videos`));
                const details = await detailsRes.json();
                
                populateFormFromTMDB(details, type);
            } else {
                showToast("No movies or TV shows found matching your criteria.");
            }
        } else {
            showToast("No results found on TMDB for that title.");
        }
    } catch(e) {
        console.error(e);
        showToast("TMDB Error: " + e.message);
    }
    
    document.getElementById('btn-fetch-tmdb').textContent = "Auto-Fill (TMDB)";
}

function populateFormFromTMDB(data, type) {
    if(!data) return;
    
    const year = (data.release_date || data.first_air_date || "").substring(0, 4);
    const desc = data.overview;
    const poster = data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : "";
    
    // Genres (Get ALL genres, comma separated)
    const genre = (data.genres && data.genres.length > 0) ? data.genres.map(g => g.name).join(", ") : "";
    
    // Credits
    let director = "";
    let actors = "";
    
    if (data.credits) {
        // cast
        actors = data.credits.cast.slice(0, 5).map(c => c.name).join(", ");
        
        // crew
        const dirs = data.credits.crew.filter(c => c.job === 'Director');
        if (dirs.length > 0) director = dirs.map(d => d.name).join(", ");
        else if (data.created_by) director = data.created_by.map(c => c.name).join(", "); // for TV Creators
    }
    
    // Trailer
    let trailer = "";
    if (data.videos && data.videos.results) {
        const t = data.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
        if (t) trailer = `https://www.youtube.com/watch?v=${t.key}`;
    }

    // Apply
    document.getElementById('description').value = desc;
    document.getElementById('year').value = year;
    document.getElementById('image').value = poster;
    document.getElementById('poster-preview').src = poster;
    document.getElementById('poster-preview').style.display = poster ? 'block' : 'none';
    
    document.getElementById('genre').value = genre;
    document.getElementById('director').value = director;
    document.getElementById('actors').value = actors;
    document.getElementById('trailer').value = trailer;
    updateTrailerPreview(); 
    
    document.getElementById('title').value = (type === 'movie' ? data.title : data.name);
    
    const titleText = type === 'movie' ? data.title : data.name;
    
    // Check if URL is filled
    const url = document.getElementById('url').value.trim();
    if (url) {
        showToast(`Found: ${titleText} (${year}) - Click Add to save.`);
    } else {
        showToast(`Found: ${titleText} (${year}) - Enter a URL first, then click Add.`, 'warning');
        // Highlight URL field to show it's required
        const urlField = document.getElementById('url');
        urlField.focus();
        urlField.style.border = '2px solid #ffc107';
        setTimeout(() => { urlField.style.border = ''; }, 3000);
    }
}

async function handleBatchUpdate() {
    const key = document.getElementById('tmdb-key').value;
    if (!key) { showToast("Please enter TMDB Key first."); return; }
    
    if (!await showConfirm("This will attempt to update MISSING fields for items using TMDB search. This may take a while. Continue?")) return;
    
    const btn = document.getElementById('btn-batch-tmdb');
    btn.textContent = "Processing...";
    btn.disabled = true;
    
    let updatedCount = 0;
    
    // Determine target items
    const selectedIds = getSelectedIds();
    const targetItems = selectedIds.length > 0 
        ? allData.filter(i => selectedIds.includes(i.id)) 
        : allData; 
        
    // 1. Batch Service Detection (Local)
    for (const item of targetItems) {
        if (!item.service || !item.service_icon) {
             const detected = detectServiceType(item.url || "");
             if (detected) {
                 if (!item.service) item.service = detected;
                 if (!item.service_icon && SERVICE_LOGOS[detected]) {
                     item.service_icon = SERVICE_LOGOS[detected];
                 }
                 updatedCount++;
             }
        }
    }
    
    // 2. Batch TMDB Update (Remote)
    // Slower pacing to avoid rate limits (approx 2 per sec)
    const DELAY_MS = 600; 
    let consecutiveErrors = 0;

    for (const item of targetItems) {
        // Stop if too many errors
        if (consecutiveErrors > 5) {
            console.error("Too many consecutive API errors. Aborting batch update to prevent lock.");
            showToast("Batch update aborted due to API errors (Rate Limit?). Try again later.");
            break;
        }

        // Only update if missing key fields. Also respect existing year if user provided it to help search.
        if (item.image && item.description && item.trailer && item.image.length > 5) continue;
        
        try {
            // Search
            const res = await fetch(getApiUrl('tmdb', `3/search/multi?api_key=${key}&query=${encodeURIComponent(item.title)}`));
            
            if (res.status === 429) {
                // Rate limited - wait longer and retry or skip
                console.warn("Rate limit hit (429). Pausing for 5 seconds...");
                await new Promise(r => setTimeout(r, 5000));
                consecutiveErrors++;
                continue; 
            }

            if (!res.ok) throw new Error(`API Error ${res.status}`);

            const searchData = await res.json();
            consecutiveErrors = 0; // Reset on success

            if (searchData.results && searchData.results.length > 0) {
                let best = null;
                
                // Prioritize Year Match if item has year
                if (item.year) {
                    best = searchData.results.find(x => {
                        if ((x.media_type !== 'movie' && x.media_type !== 'tv')) return false;
                        const date = x.release_date || x.first_air_date || "";
                        const y = parseInt(date.substring(0, 4));
                        const targetY = parseInt(item.year);
                        return !isNaN(y) && !isNaN(targetY) && Math.abs(y - targetY) <= 1;
                    });
                }

                if (!best) {
                     best = searchData.results.find(x => x.media_type === 'movie' || x.media_type === 'tv');
                }
                
                if (best) {
                    const type = best.media_type;
                    const detailsRes = await fetch(getApiUrl('tmdb', `3/${type}/${best.id}?api_key=${key}&append_to_response=credits,videos`));
                     if (detailsRes.status === 429) {
                        console.warn("Rate limit hit during details fetch. Pausing...");
                        await new Promise(r => setTimeout(r, 5000));
                        continue;
                    }
                    const data = await detailsRes.json();
                    
                    // Update Item fields if they are empty
                    if (!item.image) item.image = data.poster_path ? `https://image.tmdb.org/t/p/w780${data.poster_path}` : "";
                    if (!item.description) item.description = data.overview;
                    if (!item.year) item.year = (data.release_date || data.first_air_date || "").substring(0, 4);
                    
                    if (data.videos && data.videos.results) {
                         if (!item.trailer) {
                             const t = data.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
                             if (t) item.trailer = `https://www.youtube.com/watch?v=${t.key}`;
                         }
                    }

                    // Get ALL genres if missing
                    if (!item.genre) item.genre = (data.genres && data.genres.length > 0) ? data.genres.map(g => g.name).join(", ") : "";
                    
                    // Actors/Director
                    if (data.credits) {
                         if (!item.actors) item.actors = data.credits.cast.slice(0, 5).map(c => c.name).join(", ");
                         if (!item.director) {
                             const dirs = data.credits.crew.filter(c => c.job === 'Director');
                             if (dirs.length > 0) item.director = dirs.map(d => d.name).join(", ");
                             else if (data.created_by) item.director = data.created_by.map(c => c.name).join(", "); 
                         }
                    }
                    
                    updatedCount++;
                    btn.textContent = `Updated ${updatedCount}...`;
                }
            }
            
            // Pacing delay
            await new Promise(r => setTimeout(r, DELAY_MS));
            
        } catch(e) { 
            console.error(e); 
            consecutiveErrors++;
        }
    }
    
    btn.textContent = "Saving...";
    await saveData();
    showToast(`Batch Update Complete. Updated ${updatedCount} items.`);
    btn.textContent = "Batch Update Missing Info";
    btn.disabled = false;
    renderTable();
}

// LOGO MAPPING CONSTANTS - Using Wikimedia Thumbs
const SERVICE_LOGOS = {
    "Netflix": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/08/Netflix_2015_logo.svg/1024px-Netflix_2015_logo.svg.png",
    "Disney+": "https://upload.wikimedia.org/wikipedia/commons/thumb/3/3e/Disney%2B_logo.svg/1024px-Disney%2B_logo.svg.png",
    "Hulu": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e4/Hulu_Logo.svg/1024px-Hulu_Logo.svg.png",
    "Prime Video": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/11/Amazon_Prime_Video_logo.svg/1024px-Amazon_Prime_Video_logo.svg.png",
    "YouTube": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/09/YouTube_full-color_icon_%282017%29.svg/1024px-YouTube_full-color_icon_%282017%29.svg.png", 
    "Plex": "https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/Plex_logo_2022.svg/800px-Plex_logo_2022.svg.png",
    "Max": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/ce/Max_logo.svg/1024px-Max_logo.svg.png",
    "Paramount+": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Paramount_Plus.svg/1024px-Paramount_Plus.svg.png",
    "PlutoTV": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/Pluto_TV_logo_2024.svg/1024px-Pluto_TV_logo_2024.svg.png" 
};

function detectService(url) {
    if (!url) return;
    url = url.toLowerCase();
    
    let detected = "";
    if (url.includes('netflix')) detected = "Netflix";
    else if (url.includes('disney')) detected = "Disney+";
    else if (url.includes('hulu')) detected = "Hulu";
    else if (url.includes('amazon') || url.includes('prime')) detected = "Prime Video";
    else if (url.includes('youtube') || url.includes('youtu.be')) detected = "YouTube";
    else if (url.includes('plex.tv') || url.includes('app.plex.tv')) detected = "Plex";
    else if (url.includes('max.com') || url.includes('hbomax')) detected = "Max";
    else if (url.includes('paramount')) detected = "Paramount+";
    else if (url.includes('pluto')) detected = "PlutoTV";

    if (detected) {
        const sel = document.getElementById('service');
        // Only override if current value is empty or not matching specific override intent
        // But user asked for "auto detect", so we just set it.
        sel.value = detected;
        updateServiceIcon();
    }
}

function updateServiceIcon() {
    const service = document.getElementById('service').value;
    const iconInput = document.getElementById('service_icon');
    const customGroup = document.getElementById('custom-icon-group');
    const preview = document.getElementById('service-icon-preview');

    if (service === "Other") {
        customGroup.style.display = 'block';
        preview.style.display = 'none';
        // Keep existing value in input if manually typed
    } else if (SERVICE_LOGOS[service]) {
        customGroup.style.display = 'none';
        iconInput.value = SERVICE_LOGOS[service];
        preview.src = SERVICE_LOGOS[service];
        preview.style.display = 'block';
    } else {
        // Fallback for empty or unknown
        customGroup.style.display = 'none';
        preview.style.display = 'none';
    }
}

function updateTrailerPreview() {
    const url = document.getElementById('trailer').value;
    const container = document.getElementById('trailer-preview');
    if(!container) return; 
    const iframe = container.querySelector('iframe');
    
    if (!url) {
        container.style.display = 'none';
        return;
    }
    
    let videoId = null;
    try {
        if (url.includes('youtube.com/watch?v=')) {
            videoId = url.split('v=')[1].split('&')[0];
        } else if (url.includes('youtu.be/')) {
            videoId = url.split('youtu.be/')[1].split('?')[0];
        } else if (url.includes('youtube.com/embed/')) {
             videoId = url.split('embed/')[1].split('?')[0];
        }
    } catch(e) {}
    
    if (videoId) {
        iframe.src = "https://www.youtube.com/embed/" + videoId;
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
    }
}

async function saveGenres() {
    const inputs = document.querySelectorAll('#genre-manager-list input');
    const newGenreData = {};
    
    inputs.forEach(input => {
        const key = input.dataset.genre;
        const val = input.value.trim();
        if (key && val) {
            newGenreData[key] = val;
        }
    });

    try {
        const response = await fetch('/api/save-genres', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newGenreData)
        });
        if (response.ok) {
            genreData = newGenreData;
            showToast('Genre images saved!');
        } else {
            showToast('Error saving genres');
        }
    } catch (e) {
        console.error(e);
        showToast('Error saving genres');
    }
}

function renderTable() {
    const tbody = document.querySelector('#data-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const search = document.getElementById('table-search') ? document.getElementById('table-search').value.toLowerCase() : '';

    const filtered = allData.filter(item => {
        const title = (item.title || '').toLowerCase();
        const genre = (item.genre || '').toLowerCase();
        const year = (item.year || '').toString();
        const director = (item.director || '').toLowerCase();
        const actors = (item.actors || '').toLowerCase();
        
        return title.includes(search) || 
               genre.includes(search) || 
               year.includes(search) || 
               director.includes(search) || 
               actors.includes(search);
    });
    
    filtered.sort((a, b) => a.title.localeCompare(b.title));

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">No videos found. (Total Items: ' + allData.length + ')</td></tr>';
        return;
    }

    filtered.forEach(item => {
        const tr = document.createElement('tr');
        
        let serviceDisplay = item.service || '-';
        if (SERVICE_LOGOS[item.service]) {
            serviceDisplay = `<img src="${SERVICE_LOGOS[item.service]}" style="height: 30px; vertical-align: middle;" title="${item.service}">`;
        } else if (item.service_icon) {
            serviceDisplay = `<img src="${item.service_icon}" style="height: 30px; vertical-align: middle;" title="${item.service}">`;
        }

        tr.innerHTML = `
            <td style="text-align:center;">
                <input type="checkbox" class="item-checkbox" value="${item.id}">
            </td>
            <td>
                <div style="font-weight:bold;">${item.title}</div>
                <div style="font-size:0.8em; color:#888;">${item.director || 'No Director'}</div>
            </td>
            <td>${serviceDisplay}</td>
            <td>${item.year || ''}</td>
            <td>${item.genre || ''}</td>
            <td>
                <button class="btn btn-primary" onclick="editItem('${item.id}')">Edit</button>
                <button class="btn btn-danger" onclick="deleteItem('${item.id}')">Delete</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function collapseAllEditors() {
    document.querySelectorAll('.editor-row').forEach(el => el.remove());
}

function expandAllEditors() {
    // Legacy function, replaced by usage logic but user might still want "current filter" expand
    const buttons = document.querySelector('#data-table tbody').querySelectorAll('.btn-primary');
    buttons.forEach(btn => {
        if(btn.textContent === 'Edit') btn.click();
    });
}

async function expandSelectedEditors() {
    const selectedIds = getSelectedIds();
    if (selectedIds.length === 0) {
        if(await showConfirm("No items checked. Expand ALL visible items?")) {
            expandAllEditors();
        }
        return;
    }
    
    // Find rows for these IDs
    selectedIds.forEach(id => {
        const item = allData.find(x => x.id === id);
        // Find the edit button or row.. easier to just call logic if we can find the element.
        // We rendered checkbox with value=id.
        const checkbox = document.querySelector(`.item-checkbox[value="${id}"]`);
        if (checkbox) {
            const row = checkbox.closest('tr');
            // Check if already open (next sibling is editor-row)
            if (row.nextElementSibling && row.nextElementSibling.classList.contains('editor-row')) {
                // already open
            } else {
                renderInlineEditor(item, row);
            }
        }
    });
}

async function deleteSelectedItems() {
    const selectedIds = getSelectedIds();
    if (selectedIds.length === 0) {
        showToast("Please select items to delete.");
        return;
    }
    
    if (!await showConfirm(`Are you sure you want to delete ${selectedIds.length} items? This cannot be undone.`)) return;
    
    // Remove from allData
    allData = allData.filter(item => !selectedIds.includes(item.id));
    
    saveData();
    renderTable(); // Re-render to show removal
    showToast("Deleted selected items.");
}

function renderInlineEditor(item, row) {
    const editRowId = `edit-row-${item.id}`;
    
    // Check if open
    const existing = document.getElementById(editRowId);
    if (existing) {
        existing.remove();
        return;
    }

    // Create row
    const editRow = document.createElement('tr');
    editRow.id = editRowId;
    editRow.className = 'editor-row';
    
    const td = document.createElement('td');
    td.colSpan = 6;
    
    // Generate Form HTML
    // We scope IDs with the Item ID to prevent conflicts
    const sid = item.id;
    
    td.innerHTML = `
        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 30px;">
            <div>
                <div class="form-group"><label>Title</label><input type="text" id="title-${sid}" value="${item.title.replace(/"/g, '&quot;')}"></div>
                <div class="form-group"><label>URL</label><input type="text" id="url-${sid}" value="${item.url.replace(/"/g, '&quot;')}"></div>
                <div class="form-group"><label>Service</label>
                    <select id="service-${sid}">
                         <option value="">Select...</option>
                         ${Object.keys(SERVICE_LOGOS).map(k => `<option value="${k}" ${item.service === k ? 'selected' : ''}>${k}</option>`).join('')}
                         <option value="Other" ${!SERVICE_LOGOS[item.service] && item.service ? 'selected' : ''}>Other</option>
                    </select>
                </div>
                <div class="form-group"><label>Service Icon URL</label><input type="text" id="service_icon-${sid}" value="${item.service_icon || ''}"></div>
            </div>
            
            <div>
                 <div class="form-group"><label>Genre</label><input type="text" id="genre-${sid}" value="${item.genre || ''}"></div>
                 <div class="form-group"><label>Year</label><input type="number" id="year-${sid}" value="${item.year || ''}"></div>
                 <div class="form-group"><label>Director</label><input type="text" id="director-${sid}" value="${item.director || ''}"></div>
                 <div class="form-group"><label>Actors</label><input type="text" id="actors-${sid}" value="${item.actors || ''}"></div>
            </div>
            
            <div>
                <div class="form-group" style="display: flex; gap: 15px; align-items: start;">
                     <div style="flex: 1;">
                          <label>Poster URL</label>
                          <input type="text" id="image-${sid}" value="${item.image || ''}">
                     </div>
                     <img id="preview-image-${sid}" src="${item.image || ''}" style="height: 120px; display: ${item.image ? 'block' : 'none'}; border-radius: 6px; margin-top: 25px;">
                </div>
                
                <div class="form-group">
                     <label>Trailer URL</label>
                     <input type="text" id="trailer-${sid}" value="${item.trailer || ''}">
                     <div id="preview-trailer-${sid}" style="margin-top: 10px; display: none;">
                          <iframe width="100%" height="150" src="" frameborder="0" allowfullscreen style="border-radius: 6px;"></iframe>
                     </div>
                </div>
            </div>
        </div>
        
        <div style="margin-top: 20px;">
            <div class="form-group"><label>Description</label><textarea id="description-${sid}" rows="3">${item.description || ''}</textarea></div>
        </div>
        
        <div style="display: flex; justify-content: space-between; align-items: center;">
            <button class="btn btn-primary" onclick="autoFillInline('${sid}')">Auto-Fill (TMDB)</button>
             <div style="display: flex; gap: 10px;">
                <button class="btn btn-success" onclick="saveInlineItem('${sid}')">Save Changes</button>
                <button class="btn btn-danger" onclick="document.getElementById('${editRowId}').remove()">Cancel</button>
            </div>
        </div>
    `;
    
    editRow.appendChild(td);
    row.after(editRow);
    
    // Wire up auto-detect logic for this specific row
    const urlInput = document.getElementById(`url-${sid}`);
    const srvSelect = document.getElementById(`service-${sid}`);
    const iconInput = document.getElementById(`service_icon-${sid}`);
    
    urlInput.addEventListener('input', (e) => {
        const detected = detectServiceType(e.target.value);
        if (detected) {
            srvSelect.value = detected;
            if (SERVICE_LOGOS[detected]) iconInput.value = SERVICE_LOGOS[detected];
        }
    });

    // Check on load if service is missing/incorrect
    const initialDetect = detectServiceType(urlInput.value);
    if(initialDetect) {
         if(!srvSelect.value) {
             srvSelect.value = initialDetect;
             // Only auto-fill icon if empty
             if(SERVICE_LOGOS[initialDetect] && !iconInput.value) {
                 iconInput.value = SERVICE_LOGOS[initialDetect];
             }
         }
    }
    
    srvSelect.addEventListener('change', (e) => {
        if (SERVICE_LOGOS[e.target.value]) {
            iconInput.value = SERVICE_LOGOS[e.target.value];
        }
    });

    // Wire up Image Preview
    const imgInput = document.getElementById(`image-${sid}`);
    const imgPreview = document.getElementById(`preview-image-${sid}`);
    imgInput.addEventListener('input', (e) => {
        imgPreview.src = e.target.value;
        imgPreview.style.display = e.target.value ? 'block' : 'none';
    });

    // Wire up Trailer Preview
    const trlInput = document.getElementById(`trailer-${sid}`);
    const trlPreview = document.getElementById(`preview-trailer-${sid}`);
    const updateInlineTrailer = () => {
        const url = trlInput.value;
        const iframe = trlPreview.querySelector('iframe');
        if (!url) { trlPreview.style.display = 'none'; return; }
        
        let vid = null;
        try {
            if (url.includes('v=')) vid = url.split('v=')[1].split('&')[0];
            else if (url.includes('youtu.be/')) vid = url.split('youtu.be/')[1].split('?')[0];
            else if (url.includes('embed/')) vid = url.split('embed/')[1].split('?')[0];
        } catch(e) {}
        
        if (vid) {
            iframe.src = `https://www.youtube.com/embed/${vid}`;
            trlPreview.style.display = 'block';
        } else {
            trlPreview.style.display = 'none';
        }
    };
    trlInput.addEventListener('input', updateInlineTrailer);
    if (trlInput.value) updateInlineTrailer(); // Init on open
}

async function autoFillInline(sid) {
    const key = document.getElementById('tmdb-key').value;
    const titleVal = document.getElementById(`title-${sid}`).value;
    const yearInput = document.getElementById(`year-${sid}`).value.trim();
    const directorInput = document.getElementById(`director-${sid}`).value.toLowerCase().trim();
    
    if (!key) { showToast("Please enter TMDB API Key at top of page."); return; }
    if (!titleVal) { showToast("Enter a Title first."); return; }
    
    const hasSpecificCriteria = yearInput || directorInput;
    
    const btn = document.querySelector(`#edit-row-${sid} button[onclick="autoFillInline('${sid}')"]`);
    const originalText = btn.textContent;
    btn.textContent = "Searching...";
    btn.disabled = true;

    try {
        const res = await fetch(getApiUrl('tmdb', `3/search/multi?api_key=${key}&query=${encodeURIComponent(titleVal)}`));
        const searchData = await res.json();
        
        if (searchData.results && searchData.results.length > 0) {
            let best = null;
            let candidates = searchData.results.filter(x => x.media_type === 'movie' || x.media_type === 'tv');
            
            if (candidates.length === 0) {
                showToast("No movies or TV shows found for that title.");
                btn.textContent = originalText;
                btn.disabled = false;
                return;
            }

            // Check each candidate against the user's criteria
            for (const candidate of candidates) {
                const type = candidate.media_type;
                const detailsRes = await fetch(getApiUrl('tmdb', `3/${type}/${candidate.id}?api_key=${key}&append_to_response=credits`));
                const details = await detailsRes.json();
                
                // Check Year Match (STRICT if provided)
                let yearMatch = true;
                if (yearInput) {
                    const date = details.release_date || details.first_air_date || "";
                    const y = parseInt(date.substring(0, 4));
                    const targetY = parseInt(yearInput);
                    yearMatch = !isNaN(y) && !isNaN(targetY) && y === targetY;
                }
                
                // Check Director Match (STRICT if provided)
                let directorMatch = true;
                if (directorInput && details.credits) {
                    directorMatch = false;
                    const dirs = details.credits.crew.filter(c => c.job === 'Director');
                    const creators = details.created_by || [];
                    const allDirectors = [...dirs.map(d => d.name.toLowerCase()), ...creators.map(c => c.name.toLowerCase())];
                    
                    for (const dirName of allDirectors) {
                        if (dirName === directorInput || 
                            dirName.includes(directorInput) || 
                            directorInput.includes(dirName)) {
                            directorMatch = true;
                            break;
                        }
                        const dirParts = dirName.split(' ');
                        const inputParts = directorInput.split(' ');
                        const dirLastName = dirParts[dirParts.length - 1];
                        const inputLastName = inputParts[inputParts.length - 1];
                        if (dirLastName === inputLastName && dirLastName.length > 2) {
                            directorMatch = true;
                            break;
                        }
                    }
                }
                
                if (yearMatch && directorMatch) {
                    best = candidate;
                    break;
                }
                
                await new Promise(r => setTimeout(r, 250));
            }

            // If user provided criteria but no match found, DO NOT FALLBACK
            if (!best && hasSpecificCriteria) {
                let criteria = [];
                if (yearInput) criteria.push(`year ${yearInput}`);
                if (directorInput) criteria.push(`director "${directorInput}"`);
                showToast(`No match found for "${titleVal}" with ${criteria.join(' and ')}.\n\nTMDB may not have this exact movie, or the criteria don't match their records.`);
                btn.textContent = originalText;
                btn.disabled = false;
                return;
            }
            
            // Only use first result if NO criteria were provided
            if (!best && !hasSpecificCriteria) {
                best = candidates[0];
            }
            
            if (best) {
                const type = best.media_type;
                const detailsRes = await fetch(getApiUrl('tmdb', `3/${type}/${best.id}?api_key=${key}&append_to_response=credits,videos`));
                const data = await detailsRes.json();
                
                // Populate Inline Form - ONLY fill fields that are empty or update all
                document.getElementById(`description-${sid}`).value = data.overview || "";
                document.getElementById(`year-${sid}`).value = (data.release_date || data.first_air_date || "").substring(0, 4);
                if (data.poster_path) {
                    document.getElementById(`image-${sid}`).value = `https://image.tmdb.org/t/p/w780${data.poster_path}`;
                }
                if (data.genres && data.genres.length > 0) {
                    document.getElementById(`genre-${sid}`).value = data.genres.map(g => g.name).join(", ");
                }
                
                let director = "";
                let actors = "";
                if (data.credits) {
                    actors = data.credits.cast.slice(0, 5).map(c => c.name).join(", ");
                    const dirs = data.credits.crew.filter(c => c.job === 'Director');
                    if (dirs.length > 0) director = dirs.map(d => d.name).join(", ");
                    else if (data.created_by) director = data.created_by.map(c => c.name).join(", "); 
                }
                document.getElementById(`director-${sid}`).value = director;
                document.getElementById(`actors-${sid}`).value = actors;
                
                if (data.videos && data.videos.results) {
                    const t = data.videos.results.find(v => v.type === 'Trailer' && v.site === 'YouTube');
                    if (t) document.getElementById(`trailer-${sid}`).value = `https://www.youtube.com/watch?v=${t.key}`;
                }
                
                // Trigger Previews
                document.getElementById(`image-${sid}`).dispatchEvent(new Event('input'));
                document.getElementById(`trailer-${sid}`).dispatchEvent(new Event('input'));

                const foundTitle = type === 'movie' ? data.title : data.name;
                const foundYear = (data.release_date || data.first_air_date || "").substring(0, 4);
                showToast(`Found and filled: ${foundTitle} (${foundYear})`);
            } else {
                showToast("No movies or TV shows found matching your criteria.");
            }
        } else {
            showToast("No results found on TMDB for that title.");
        }
    } catch(e) {
        console.error(e);
        showToast("Error fetching TMDB data: " + e.message);
    }
    
    btn.textContent = originalText;
    btn.disabled = false;
}

// Replaced global detectService with pure function
function detectServiceType(url) {
    if (!url) return null;
    url = url.toLowerCase();
    
    if (url.includes('netflix')) return "Netflix";
    if (url.includes('disney')) return "Disney+";
    if (url.includes('hulu')) return "Hulu";
    if (url.includes('amazon') || url.includes('prime')) return "Prime Video";
    if (url.includes('youtube') || url.includes('youtu.be')) return "YouTube";
    if (url.includes('plex.tv') || url.includes('app.plex.tv')) return "Plex";
    if (url.includes('max.com') || url.includes('hbomax')) return "Max";
    if (url.includes('paramount')) return "Paramount+";
    if (url.includes('pluto')) return "PlutoTV";
    return null;
}

async function saveInlineItem(id) {
    const itemIndex = allData.findIndex(i => i.id === id);
    if (itemIndex === -1) return;
    
    const sid = id;
    const existing = allData[itemIndex];
    
    const newItem = {
        ...existing,
        title: document.getElementById(`title-${sid}`).value,
        url: document.getElementById(`url-${sid}`).value,
        service: document.getElementById(`service-${sid}`).value,
        service_icon: document.getElementById(`service_icon-${sid}`).value,
        genre: document.getElementById(`genre-${sid}`).value,
        year: document.getElementById(`year-${sid}`).value,
        director: document.getElementById(`director-${sid}`).value,
        actors: document.getElementById(`actors-${sid}`).value,
        image: document.getElementById(`image-${sid}`).value,
        description: document.getElementById(`description-${sid}`).value,
        trailer: document.getElementById(`trailer-${sid}`).value,
    };
    
    allData[itemIndex] = newItem;
    
    // Use silent save - no re-render, no alert
    const success = await saveDataSilent();
    
    // Update the row in place without re-rendering the whole table
    const checkbox = document.querySelector(`.item-checkbox[value="${id}"]`);
    if (checkbox) {
        const row = checkbox.closest('tr');
        if (row) {
            // Update the title/director cell
            const titleCell = row.querySelector('td:nth-child(2)');
            if (titleCell) {
                titleCell.innerHTML = `
                    <div style="font-weight:bold;">${newItem.title}</div>
                    <div style="font-size:0.8em; color:#888;">${newItem.director || 'No Director'}</div>
                `;
            }
            // Update service cell with logo
            const serviceCell = row.querySelector('td:nth-child(3)');
            if (serviceCell) {
                const iconUrl = newItem.service_icon || SERVICE_LOGOS[newItem.service] || '';
                if (iconUrl) {
                    serviceCell.innerHTML = `<img src="${iconUrl}" style="height:30px; border-radius:4px;" title="${newItem.service || ''}">`;
                } else {
                    serviceCell.textContent = newItem.service || '';
                }
            }
            // Update year cell
            const yearCell = row.querySelector('td:nth-child(4)');
            if (yearCell) yearCell.textContent = newItem.year || '';
            // Update genre cell
            const genreCell = row.querySelector('td:nth-child(5)');
            if (genreCell) genreCell.textContent = newItem.genre || '';
        }
    }
    
    // Show a brief save confirmation
    showSaveNotification(success ? `Saved: ${newItem.title}` : `Error saving: ${newItem.title}`);
}

function showSaveNotification(message, type = 'success') {
    // Create or reuse notification element
    let notif = document.getElementById('save-notification');
    if (!notif) {
        notif = document.createElement('div');
        notif.id = 'save-notification';
        notif.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            color: white;
            padding: 15px 25px;
            border-radius: 8px;
            font-weight: bold;
            z-index: 9999;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            transition: opacity 0.3s;
            max-width: 400px;
            word-wrap: break-word;
        `;
        document.body.appendChild(notif);
    }
    
    // Set background based on type
    notif.style.background = type === 'error' ? '#dc3545' : type === 'warning' ? '#ffc107' : '#28a745';
    notif.style.color = type === 'warning' ? '#000' : '#fff';
    
    notif.textContent = message;
    notif.style.opacity = '1';
    notif.style.display = 'block';
    
    // Auto-hide after 3 seconds (longer for errors)
    const duration = type === 'error' ? 4000 : 2500;
    clearTimeout(notif._hideTimeout);
    notif._hideTimeout = setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => { notif.style.display = 'none'; }, 300);
    }, duration);
}

// Alias for convenience
function showToast(message, type = 'success') {
    showSaveNotification(message, type);
}

function uuidv4() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

function editItem(id) {
    // Old implementation replaced with inline logic
    const item = allData.find(i => i.id === id);
    if (!item) return;
    
    // Find the row
    const buttons = document.querySelectorAll('button');
    let row = null;
    buttons.forEach(b => {
        if (b.getAttribute('onclick') === `editItem('${id}')`) {
            row = b.closest('tr');
        }
    });
    
    if (row) {
        renderInlineEditor(item, row);
    }
}

async function deleteItem(id) {
    if (!await showConfirm('Are you sure you want to delete this item?')) return;
    
    // Find and remove the row from DOM first
    const checkbox = document.querySelector(`.item-checkbox[value="${id}"]`);
    let rowToRemove = null;
    let editorRowToRemove = null;
    
    if (checkbox) {
        rowToRemove = checkbox.closest('tr');
        // Also check for expanded editor row
        if (rowToRemove && rowToRemove.nextElementSibling && rowToRemove.nextElementSibling.classList.contains('editor-row')) {
            editorRowToRemove = rowToRemove.nextElementSibling;
        }
    }
    
    // Remove from data
    const item = allData.find(i => i.id === id);
    const itemTitle = item ? item.title : 'Item';
    allData = allData.filter(i => i.id !== id);
    
    // Save silently
    await saveDataSilent();
    
    // Remove from DOM in place
    if (editorRowToRemove) editorRowToRemove.remove();
    if (rowToRemove) rowToRemove.remove();
    
    showSaveNotification(`Deleted: ${itemTitle}`);
}

async function saveItem() {
    // STRICTLY FOR ADD NEW ITEM NOW
    const title = document.getElementById('title').value;
    const url = document.getElementById('url').value;
    
    if (!title || !url) {
        showToast('Title and URL are required for new items.');
        return;
    }

    let type = 'movies';
    if (document.getElementById('service').value === 'YouTube') type = 'video';
    else if (title.toLowerCase().includes('season') || title.toLowerCase().includes('simpsons')) type = 'shows';

    const newItem = {
        id: uuidv4(),
        type: type,
        title: title,
        url: url,
        image: document.getElementById('image').value,
        genre: document.getElementById('genre').value,
        director: document.getElementById('director').value,
        actors: document.getElementById('actors').value,
        year: document.getElementById('year').value,
        trailer: document.getElementById('trailer').value,
        description: document.getElementById('description').value,
        service: document.getElementById('service').value,
        service_icon: document.getElementById('service_icon').value
    };

    allData.push(newItem);
    
    try {
        const success = await saveDataSilent();
        if (success) {
            clearForm();
            renderTable();  // Re-render the table to show the new item
            renderGenreManager();
            showSaveNotification(`Added: ${newItem.title}`);
        } else {
            // Remove from local array if save failed
            allData.pop();
            showToast('Error saving item. Please try again.');
        }
    } catch (error) {
        // Remove from local array if save failed
        allData.pop();
        console.error('Error in saveItem:', error);
        showToast('Error saving item: ' + error.message);
    }
}

async function saveData() {
    try {
        const response = await fetch('/api/save-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(allData)
        });
        
        if (response.ok) {
            renderTable();
            showToast('Data saved successfully!');
        } else {
            showToast('Error saving data.');
        }
    } catch (error) {
        console.error('Error saving:', error);
        showToast('Error saving data.');
    }
}

// Silent save for inline edits - no re-render, no alert
async function saveDataSilent() {
    try {
        const response = await fetch('/api/save-data', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(allData)
        });
        
        if (!response.ok) {
            console.error('Error saving data silently');
            return false;
        }
        return true;
    } catch (error) {
        console.error('Error saving:', error);
        return false;
    }
}

function clearForm() {
    document.getElementById('item-id').value = '';
    document.getElementById('title').value = '';
    document.getElementById('url').value = '';
    document.getElementById('image').value = '';
    document.getElementById('genre').value = '';
    document.getElementById('director').value = '';
    document.getElementById('actors').value = '';
    document.getElementById('year').value = '';
    document.getElementById('trailer').value = '';
    document.getElementById('description').value = '';
    document.getElementById('service').value = '';
    document.getElementById('service_icon').value = '';
    document.getElementById('form-title').textContent = 'Add New Video';
    updateServiceIcon(); // Reset UI
    document.getElementById('poster-preview').style.display = 'none';
    document.getElementById('poster-preview').src = '';
    
    // Clear trailer preview
    const trailerPreview = document.getElementById('trailer-preview');
    if (trailerPreview) {
        trailerPreview.style.display = 'none';
        const iframe = trailerPreview.querySelector('iframe');
        if (iframe) iframe.src = '';
    }
}
