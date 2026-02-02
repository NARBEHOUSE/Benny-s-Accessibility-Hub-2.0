// State
let triviaData = {};
let gameMeta = { title: "My Custom Trivia", image: "" };
let openCategories = new Set(); // Track open categories to preserve state across renders

// DOM Elements
const container = document.getElementById('categories-container');
const btnNew = document.getElementById('btn-new');
const btnSave = document.getElementById('btn-save');
const btnAddCategory = document.getElementById('btn-add-category');
const btnAddCategoryTop = document.getElementById('btn-add-category-top');
const btnAddQuestionGlobal = document.getElementById('btn-add-question-global');
const fileInput = document.getElementById('file-upload');
const modal = document.getElementById('media-modal');
const modalContent = document.getElementById('media-preview-container');
const closeModal = document.querySelector('.close-modal');
const titleInput = document.getElementById('game-title');
const imageInput = document.getElementById('game-image');
const imagePreview = document.getElementById('game-image-preview');

// Question Modal Elements
const questionModal = document.getElementById('add-question-modal');
const closeQuestionModal = document.getElementById('close-question-modal');
const questionCategorySelect = document.getElementById('new-question-category');
const questionTextInput = document.getElementById('new-question-text');

// New Modal Inputs
const qCorrectText = document.getElementById('new-q-correct-text');
const qCorrectImg = document.getElementById('new-q-correct-img');
const qWrong1Text = document.getElementById('new-q-wrong1-text');
const qWrong1Img = document.getElementById('new-q-wrong1-img');
const qWrong2Text = document.getElementById('new-q-wrong2-text');
const qWrong2Img = document.getElementById('new-q-wrong2-img');
const qWrong3Text = document.getElementById('new-q-wrong3-text');
const qWrong3Img = document.getElementById('new-q-wrong3-img');
// const qMediaType = document.getElementById('new-q-media-type'); // Removed
const qMediaSrc = document.getElementById('new-q-media-src');
const gameDropdown = document.getElementById('game-dropdown');

const btnSubmitQuestion = document.getElementById('btn-submit-question');
const btnUpdateManifest = document.getElementById('btn-update-manifest');
const manifestFilesInput = document.getElementById('manifest-files-upload');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    // Try to load from local storage first
    const savedData = localStorage.getItem('trivia_editor_autosave');
    if (savedData) {
        try {
            const parsed = JSON.parse(savedData);
            // Check if it has meta wrapper
            if (parsed.meta && parsed.categories) {
                triviaData = parsed.categories;
                gameMeta = parsed.meta;
            } else {
                triviaData = parsed;
            }
        } catch (e) {
            console.error("Failed to load autosave", e);
        }
    }

    // Start with a demo category if empty
    if (Object.keys(triviaData).length === 0) {
        triviaData = {
            "New Category": { questions: [], image: "" }
        };
    }
    render();

    // Load Games Manifest for Dropdown
    if (gameDropdown) {
        fetch('../games_manifest.json')
            .then(response => {
                if (!response.ok) {
                     console.warn("Manifest not found or fetch failed");
                     return [];
                }
                return response.json();
            })
            .then(manifest => {
                if (Array.isArray(manifest)) {
                    manifest.forEach(game => {
                        const option = document.createElement('option');
                        option.value = game.path;
                        option.textContent = game.name;
                        gameDropdown.appendChild(option);
                    });
                }
            })
            .catch(err => console.error("Could not load games manifest", err));

        gameDropdown.addEventListener('change', (e) => {
            const gamePath = e.target.value;
            if (!gamePath) return;

            if (!confirm('Load "' + e.target.options[e.target.selectedIndex].text + '"? Unsaved changes will be lost.')) {
                e.target.value = ""; 
                return;
            }
            
            // The manifest paths are relative to the root (e.g. trivia_games/...).
            // Since editor is in 'trivia editor/', we prepend '../'
            const fetchPath = '../' + gamePath;

            fetch(fetchPath)
                .then(response => {
                    if(!response.ok) throw new Error("Failed to load game file: " + fetchPath);
                    return response.json();
                })
                .then(data => {
                    if (data.meta && data.categories) {
                        triviaData = data.categories;
                        gameMeta = data.meta;
                    } else {
                        triviaData = data;
                        // Use name from dropdown as title if meta title is missing, or just keep what's in the json if it has title field?
                        // Usually existing data structure might trigger the else block if it's old format.
                        gameMeta = { title: e.target.options[e.target.selectedIndex].text, image: "" };
                    }
                    render();
                })
                .catch(err => {
                    alert("Error loading game: " + err);
                    e.target.value = "";
                });
        });
    }
});

// Event Listeners
btnNew.addEventListener('click', () => {
    if (confirm('Are you sure? Unsaved changes will be lost.')) {
        triviaData = { "New Category": { questions: [], image: "" } };
        gameMeta = { title: "My Custom Trivia", image: "" };
        render();
    }
});

btnSave.addEventListener('click', saveJSON);

// Manifest Update Logic
if (btnUpdateManifest) {
    btnUpdateManifest.addEventListener('click', () => {
        if (confirm("Select ALL the game JSON files (including existing ones) you want to be in the game list. This will generate a new games_manifest.json.")) {
            manifestFilesInput.click();
        }
    });
}

if (manifestFilesInput) {
    manifestFilesInput.addEventListener('change', handleManifestFilesSelect);
}

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const text = event.target.result;
            let success = false;

            // 1. Try JSON
            try {
                const json = JSON.parse(text);
                if (json.meta && json.categories) {
                    triviaData = json.categories;
                    gameMeta = json.meta;
                } else {
                    triviaData = json;
                    gameMeta = { title: file.name.replace('.json', '').replace(/_/g, ' '), image: "" };
                }
                success = true;
            } catch (jsonErr) {
                // 2. Try JS Variable
                const match = text.match(/const\s+TRIVIA_DATA\s*=\s*({[\s\S]*})/);
                if (match && match[1]) {
                    try {
                        const data = new Function("return " + match[1])();
                        triviaData = data;
                        gameMeta = { title: "Imported Game", image: "" };
                        success = true;
                    } catch (jsErr) {
                        console.error("JS Parse Error", jsErr);
                    }
                }
            }

            if (success) {
                render();
            } else {
                alert('Failed to parse file. Please ensure it is a valid JSON file.');
            }
        } catch (err) {
            console.error("General Error", err);
            alert('An error occurred while loading the file: ' + err.message);
        } finally {
            fileInput.value = ''; // Allow reloading the same file
        }
    };
    reader.readAsText(file);
});

function addBlankCategory() {
    let baseName = "New Category";
    let newName = baseName;
    let counter = 1;
    
    while (triviaData.hasOwnProperty(newName)) {
        newName = `${baseName} ${counter}`;
        counter++;
    }
    
    triviaData[newName] = { questions: [], image: "" };
    // Don't add to openCategories so it stays collapsed
    render();
    
    // Auto-scroll to the new category
    requestAnimationFrame(() => {
        const sections = document.querySelectorAll('.category-section');
        if (sections.length > 0) {
            const lastSection = sections[sections.length - 1];
            lastSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            
            // Highlight effect
            lastSection.style.transition = "background-color 0.5s";
            lastSection.style.backgroundColor = "#e8f0fe";
            setTimeout(() => {
                lastSection.style.backgroundColor = "";
            }, 1000);
        }
    });
}

btnAddCategory.addEventListener('click', addBlankCategory);
btnAddCategoryTop.addEventListener('click', addBlankCategory);

btnAddQuestionGlobal.addEventListener('click', () => {
    openAddQuestionModal();
});

closeQuestionModal.addEventListener('click', () => {
    questionModal.classList.add('hidden');
});

btnSubmitQuestion.addEventListener('click', () => {
    const category = questionCategorySelect.value;
    const question = questionTextInput.value;
    
    // Gather choices
    const choices = [
        { text: qCorrectText.value, image: qCorrectImg.value },
        { text: qWrong1Text.value, image: qWrong1Img.value },
        { text: qWrong2Text.value, image: qWrong2Img.value },
        { text: qWrong3Text.value, image: qWrong3Img.value }
    ];

    // Validate
    if (!category || !question || (!choices[0].text && !choices[0].image)) {
        alert("Please fill in the category, question, and at least the correct answer (text or image).");
        return;
    }

    const newQuestion = {
        question: question,
        choices: choices,
        media: { 
            type: detectMediaType(qMediaSrc.value), 
            src: qMediaSrc.value 
        }
    };

    // Ensure category exists and is an object
    if (!triviaData[category]) {
        triviaData[category] = { questions: [], image: "" };
    } else if (Array.isArray(triviaData[category])) {
        triviaData[category] = { questions: triviaData[category], image: "" };
    }

    // Add to the beginning of the array (most recent)
    triviaData[category].questions.unshift(newQuestion);
    
    render();
    questionModal.classList.add('hidden');
    
    // Clear inputs
    questionTextInput.value = '';
    qCorrectText.value = '';
    qCorrectImg.value = '';
    qWrong1Text.value = '';
    qWrong1Img.value = '';
    qWrong2Text.value = '';
    qWrong2Img.value = '';
    qWrong3Text.value = '';
    qWrong3Img.value = '';
    // qMediaType.value = ''; // Removed
    qMediaSrc.value = '';
});

window.openAddQuestionModal = function(preselectedCategory = null) {
    // Populate categories
    questionCategorySelect.innerHTML = '';
    Object.keys(triviaData).forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        if (cat === preselectedCategory) {
            option.selected = true;
        }
        questionCategorySelect.appendChild(option);
    });

    questionModal.classList.remove('hidden');
};

closeModal.addEventListener('click', () => {
    modal.classList.add('hidden');
    modalContent.innerHTML = '';
});

// Rendering
function render() {
    // Auto-save whenever we render (which happens on every change)
    const fullData = { meta: gameMeta, categories: triviaData };
    localStorage.setItem('trivia_editor_autosave', JSON.stringify(fullData));

    // Update Meta Inputs
    titleInput.value = gameMeta.title || "";
    imageInput.value = gameMeta.image || "";
    
    if (gameMeta.image) {
        imagePreview.innerHTML = `<img src="${gameMeta.image}" style="max-height: 100px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">`;
    } else {
        imagePreview.innerHTML = '';
    }

    container.innerHTML = '';
    
    Object.keys(triviaData).forEach(category => {
        // Migration: Ensure object structure
        if (Array.isArray(triviaData[category])) {
            triviaData[category] = {
                questions: triviaData[category],
                image: ""
            };
        }
        
        const section = createCategorySection(category, triviaData[category]);
        container.appendChild(section);
    });
}

function createCategorySection(name, data) {
    const section = document.createElement('div');
    section.className = 'category-section';
    
    // Restore open state
    if (openCategories.has(name)) {
        section.classList.add('open');
    }
    
    // Header
    const header = document.createElement('div');
    header.className = 'category-header';
    header.innerHTML = `
        <h2>
            <i class="fas fa-chevron-right"></i> 
            ${data.image ? `<img src="${data.image}" style="width:30px; height:30px; object-fit:cover; border-radius:4px; margin-right:5px;">` : ''}
            ${name} 
            <span style="font-size:0.8em; color:#666; margin-left:10px;">(${data.questions.length} Qs)</span>
        </h2>
        <div class="category-controls">
            <button class="btn primary btn-icon" onclick="openAddQuestionModal('${name}')" title="Add Question"><i class="fas fa-plus"></i></button>
            <button class="btn secondary btn-icon" onclick="renameCategory('${name}')" title="Rename"><i class="fas fa-pen"></i></button>
            <button class="btn danger btn-icon" onclick="deleteCategory('${name}')" title="Delete"><i class="fas fa-trash"></i></button>
        </div>
    `;
    
    // Toggle collapse
    header.addEventListener('click', (e) => {
        if (!e.target.closest('button') && !e.target.closest('input')) {
            section.classList.toggle('open');
            if (section.classList.contains('open')) {
                openCategories.add(name);
            } else {
                openCategories.delete(name);
            }
        }
    });

    // Content
    const content = document.createElement('div');
    content.className = 'category-content';

    // Category Image Input
    const imageControl = document.createElement('div');
    imageControl.className = 'form-group';
    imageControl.style.background = '#f8f9fa';
    imageControl.style.padding = '1rem';
    imageControl.style.marginBottom = '1rem';
    imageControl.style.borderRadius = '4px';
    imageControl.innerHTML = `
        <label>Category Image URL (Optional)</label>
        <div style="display:flex; gap:10px;">
            <input type="text" class="form-control" placeholder="https://example.com/image.jpg" value="${escapeHtml(data.image || '')}"
                onchange="updateCategoryImage('${name}', this.value)">
        </div>
    `;
    content.appendChild(imageControl);
    
    // Questions
    data.questions.forEach((q, index) => {
        content.appendChild(createQuestionCard(name, q, index));
    });

    // Add Question Button
    const btnAddQ = document.createElement('button');
    btnAddQ.className = 'btn primary';
    btnAddQ.innerHTML = '<i class="fas fa-plus"></i> Add Question';
    btnAddQ.style.marginTop = '1rem';
    btnAddQ.onclick = () => addQuestion(name);
    content.appendChild(btnAddQ);

    section.appendChild(header);
    section.appendChild(content);
    
    return section;
}

function createQuestionCard(catName, q, index) {
    const card = document.createElement('div');
    card.className = 'question-card';
    
    // Ensure structure
    if (!q.choices) q.choices = ["", "", "", ""];
    if (!q.media) q.media = { type: '', src: '' };

    // Helper to get text/image from choice (string or object)
    const getChoiceData = (choice) => {
        if (typeof choice === 'object' && choice !== null) {
            return { text: choice.text || '', image: choice.image || '' };
        }
        return { text: choice || '', image: '' };
    };

    const choicesHTML = q.choices.map((choice, i) => {
        const data = getChoiceData(choice);
        const isCorrect = i === 0;
        const isDataURI = data.image && data.image.startsWith('data:');
        
        // Detect media type for preview
        const mediaType = detectMediaType(data.image);
        const ytId = mediaType === 'video' ? getYouTubeId(data.image) : null;
        
        let previewHTML = '';
        if (data.image) {
            if (mediaType === 'video' && ytId) {
                previewHTML = `
                    <div style="margin-top: 5px; position: relative; display: inline-block;">
                        <iframe src="https://www.youtube.com/embed/${ytId}" style="height: 100px; width: 177px; border-radius: 4px; border: 1px solid #ddd;" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
                        <button class="btn danger btn-icon" style="position: absolute; top: -5px; right: -5px; padding: 2px 5px; font-size: 10px; border-radius: 50%; z-index: 10;" 
                            onclick="removeAnswerImage('${catName}', ${index}, ${i})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `;
            } else if (mediaType === 'video') {
                previewHTML = `
                    <div style="margin-top: 5px; position: relative; display: inline-block;">
                        <video src="${data.image}" controls style="height: 100px; border-radius: 4px; border: 1px solid #ddd;"></video>
                        <button class="btn danger btn-icon" style="position: absolute; top: -5px; right: -5px; padding: 2px 5px; font-size: 10px; border-radius: 50%; z-index: 10;" 
                            onclick="removeAnswerImage('${catName}', ${index}, ${i})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `;
            } else {
                previewHTML = `
                    <div style="margin-top: 5px; position: relative; display: inline-block;">
                        <img src="${data.image}" style="height: 50px; border-radius: 4px; border: 1px solid #ddd;">
                        <button class="btn danger btn-icon" style="position: absolute; top: -5px; right: -5px; padding: 2px 5px; font-size: 10px; border-radius: 50%;" 
                            onclick="removeAnswerImage('${catName}', ${index}, ${i})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `;
            }
        }

        return `
            <div class="answer-slot ${isCorrect ? 'correct' : ''}">
                <div style="margin-bottom: 5px;">
                    <input type="text" class="form-control" placeholder="${isCorrect ? 'Correct Answer' : 'Incorrect Answer ' + i}" 
                        value="${escapeHtml(data.text)}"
                        onchange="updateChoice('${catName}', ${index}, ${i}, this.value, 'text')"
                        style="width: 100%;">
                </div>
                
                <div style="display: flex; gap: 5px; align-items: center;">
                    <input type="text" class="form-control" 
                        placeholder="${isDataURI ? 'Local Image Set (Type URL to replace)' : 'Image URL (optional)'}" 
                        value="${isDataURI ? '' : escapeHtml(data.image)}"
                        onchange="updateChoice('${catName}', ${index}, ${i}, this.value, 'image')"
                        style="flex: 1; font-size: 0.85em; padding: 4px;">
                </div>

                ${previewHTML}
            </div>
        `;
    }).join('');

    card.innerHTML = `
        <div class="question-header">
            <div style="display:flex; align-items:center; gap:10px;">
                <span class="question-number">Question ${index + 1}</span>
                <button class="btn secondary btn-icon" onclick="previewQuestion('${catName}', ${index})" title="Play/Preview Question" style="background-color: #2ecc71;">
                    <i class="fas fa-play"></i>
                </button>
            </div>
            <button class="btn danger btn-icon" onclick="deleteQuestion('${catName}', ${index})"><i class="fas fa-times"></i></button>
        </div>
        
        <div class="form-group">
            <label>Question Text</label>
            <input type="text" class="form-control" value="${escapeHtml(q.question || '')}" 
                onchange="updateQuestion('${catName}', ${index}, 'question', this.value)">
        </div>

        <div class="answers-grid">
            ${choicesHTML}
        </div>

        <div class="media-controls">
            <label>Media Attachment (Optional)</label>
            <div class="media-inputs">
                <input type="text" class="form-control" placeholder="URL or Data URI (Type auto-detected)" value="${escapeHtml(q.media.src || '')}"
                    onchange="updateMedia('${catName}', ${index}, 'src', this.value)">
                
                <button class="btn secondary media-preview-btn" onclick="previewMedia('${catName}', ${index})">
                    <i class="fas fa-eye"></i> Preview
                </button>
            </div>
            <div style="font-size: 0.8em; color: #666; margin-top: 5px;">
                Detected Type: <strong>${q.media.type || (q.media.src ? detectMediaType(q.media.src) : 'None')}</strong>
            </div>
        </div>
    `;
    
    return card;
}

// Logic Functions

window.renameCategory = (oldName) => {
    const newName = prompt("Rename category:", oldName);
    if (newName && newName !== oldName) {
        if (triviaData[newName]) {
            alert("Category name already exists!");
            return;
        }
        triviaData[newName] = triviaData[oldName];
        delete triviaData[oldName];
        
        // Transfer open state
        if (openCategories.has(oldName)) {
            openCategories.delete(oldName);
            openCategories.add(newName);
        }

        render();
    }
};

window.deleteCategory = (name) => {
    if (confirm(`Delete category "${name}" and all its questions?`)) {
        delete triviaData[name];
        openCategories.delete(name);
        render();
    }
};

window.addQuestion = (catName) => {
    // Ensure structure
    if (Array.isArray(triviaData[catName])) {
        triviaData[catName] = { questions: triviaData[catName], image: "" };
    }
    
    triviaData[catName].questions.push({
        question: "New Question",
        choices: ["Correct Answer", "Wrong 1", "Wrong 2", "Wrong 3"],
        correct: 0,
        media: { type: "", src: "" }
    });
    render();
};

window.deleteQuestion = (catName, index) => {
    if (confirm("Delete this question?")) {
        // Ensure structure
        if (Array.isArray(triviaData[catName])) {
            triviaData[catName] = { questions: triviaData[catName], image: "" };
        }
        triviaData[catName].questions.splice(index, 1);
        render();
    }
};

window.updateQuestion = (catName, index, field, value) => {
    const questions = Array.isArray(triviaData[catName]) ? triviaData[catName] : triviaData[catName].questions;
    questions[index][field] = value;
};

window.updateChoice = (catName, index, choiceIndex, value, type = 'text') => {
    const questions = Array.isArray(triviaData[catName]) ? triviaData[catName] : triviaData[catName].questions;
    let currentChoice = questions[index].choices[choiceIndex];
    
    // Convert string to object if needed
    if (typeof currentChoice !== 'object' || currentChoice === null) {
        currentChoice = { text: String(currentChoice || ''), image: '' };
    }

    if (type === 'text') {
        currentChoice.text = value;
    } else if (type === 'image') {
        currentChoice.image = value;
    }

    // If image is empty, revert to string to keep JSON clean
    if (!currentChoice.image) {
        questions[index].choices[choiceIndex] = currentChoice.text;
    } else {
        questions[index].choices[choiceIndex] = currentChoice;
    }
};

window.removeAnswerImage = (catName, index, choiceIndex) => {
    window.updateChoice(catName, index, choiceIndex, '', 'image');
    render();
};

function detectMediaType(url) {
    if (!url) return "";
    url = url.trim();
    
    // Check for Video Services
    if (url.match(/(youtube\.com|youtu\.be|vimeo\.com|drive\.google\.com)/i)) {
        return "video";
    }
    
    // Check extensions
    if (url.match(/\.(mp4|webm|ogg|mov)$/i)) return "video";
    if (url.match(/\.(mp3|wav|ogg|m4a)$/i)) return "audio";
    if (url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i)) return "image";
    
    // Data URIs
    if (url.startsWith('data:image')) return "image";
    if (url.startsWith('data:audio')) return "audio";
    if (url.startsWith('data:video')) return "video";

    // Default fallback (assume image if unknown, or maybe video if it looks like a link?)
    // Let's default to image as it's most common for direct links without extension
    return "image"; 
}

window.updateMedia = (catName, index, field, value) => {
    const questions = Array.isArray(triviaData[catName]) ? triviaData[catName] : triviaData[catName].questions;
    if (!questions[index].media) {
        questions[index].media = { type: '', src: '' };
    }
    
    if (field === 'src') {
        questions[index].media.src = value;
        questions[index].media.type = detectMediaType(value);
        render(); // Re-render to show detected type
    } else {
        // Fallback if we ever need to manually set type (though UI is gone)
        questions[index].media[field] = value;
    }
};

window.previewMedia = (catName, index) => {
    const questions = Array.isArray(triviaData[catName]) ? triviaData[catName] : triviaData[catName].questions;
    const media = questions[index].media;
    if (!media || !media.src) {
        alert("No media source set.");
        return;
    }

    modalContent.innerHTML = '';
    let el;
    if (media.type === 'image') {
        el = document.createElement('img');
        el.src = media.src;
    } else if (media.type === 'audio') {
        el = document.createElement('audio');
        el.controls = true;
        el.src = media.src;
    } else if (media.type === 'video') {
        const ytId = getYouTubeId(media.src);
        if (ytId) {
            el = document.createElement('iframe');
            el.src = `https://www.youtube.com/embed/${ytId}`;
            el.width = "560";
            el.height = "315";
            el.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            el.allowFullscreen = true;
        } else {
            el = document.createElement('video');
            el.controls = true;
            el.src = media.src;
        }
    } else {
        el = document.createElement('p');
        el.textContent = "Unknown media type or link: " + media.src;
    }
    
    modalContent.appendChild(el);
    modal.classList.remove('hidden');
};

function getYouTubeId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=|shorts\/)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

window.updateCategoryImage = (catName, value) => {
    if (Array.isArray(triviaData[catName])) {
        triviaData[catName] = { questions: triviaData[catName], image: "" };
    }
    triviaData[catName].image = value;
    render(); // Re-render to show thumbnail in header
};

window.updateGameMeta = (field, value) => {
    gameMeta[field] = value;
    render();
};

async function saveJSON() {
    const fullData = { meta: gameMeta, categories: triviaData };
    const dataStr = JSON.stringify(fullData, null, 4);
    
    // Use File System Access API if available
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: (gameMeta.title || "trivia_game").replace(/ /g, '_') + '.json',
                types: [{
                    description: 'JSON File',
                    accept: {'application/json': ['.json']},
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(dataStr);
            await writable.close();
            alert("Saved successfully!");
            return;
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                // Fallback to download
            } else {
                return; // User cancelled
            }
        }
    }

    // Fallback
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = (gameMeta.title || "trivia_game").replace(/ /g, '_') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function handleManifestFilesSelect(e) {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    // Process files
    const manifestPromises = files.map(async (file) => {
        try {
            const text = await readFileAsText(file);
            const json = JSON.parse(text);
            
            // Extract meta info
            let title = file.name.replace('.json', '');
            let image = "";
            
            if (json.meta) {
                if (json.meta.title) title = json.meta.title;
                if (json.meta.image) image = json.meta.image;
            }
            
            return {
                name: title,
                path: `trivia_games/${file.name}`,
                image: image
            };
            
        } catch (err) {
            console.error(`Error processing file ${file.name}:`, err);
            alert(`Error processing ${file.name}. Skipping.`);
            return null;
        }
    });
    
    const results = await Promise.all(manifestPromises);
    const manifest = results.filter(item => item !== null);
    
    // Sort manifest by name
    manifest.sort((a, b) => a.name.localeCompare(b.name));
    
    // JSON Data
    const dataStr = JSON.stringify(manifest, null, 4);

    // Try File System Access API first (Save As)
    if (window.showSaveFilePicker) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'games_manifest.json',
                types: [{
                    description: 'JSON File',
                    accept: { 'application/json': ['.json'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(dataStr);
            await writable.close();
            alert("Manifest saved successfully!");
            e.target.value = ''; // Reset input
            return;
        } catch (err) {
            if (err.name === 'AbortError') {
                e.target.value = ''; // Reset input even if cancelled
                return; 
            }
            console.error("Save As failed:", err);
            // Clean fallback prompt
            if (!confirm("Unable to open 'Save As' dialog. Download 'games_manifest.json' to your default download folder instead?")) {
                e.target.value = '';
                return;
            }
        }
    } 

    // Automatic download fallback
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = 'games_manifest.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    // Reset input
    e.target.value = '';
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(e);
        reader.readAsText(file);
    });
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Question Preview Logic
const previewModal = document.getElementById('question-preview-modal');
const closePreviewModal = document.getElementById('close-preview-modal');
const previewQuestionText = document.getElementById('preview-question-text');
const previewMediaContainer = document.getElementById('preview-media');
const previewAnswersArea = document.getElementById('preview-answers-area');
const previewPopupOverlay = document.getElementById('preview-popup-overlay');
const previewPopupContent = document.getElementById('preview-popup-content');
const previewQuestionArea = document.getElementById('preview-question-area');
const previewPrevBtn = document.getElementById('preview-prev-btn');
const previewNextBtn = document.getElementById('preview-next-btn');

let previewState = {
    activeElements: [],
    currentIndex: -1,
    isScanning: false,
    currentCategory: null,
    currentQuestionIndex: -1
};

if (closePreviewModal) {
    closePreviewModal.addEventListener('click', () => {
        restoreQuestionMedia(); // Restore before closing
        previewModal.classList.add('hidden');
        // Stop any playing media
        previewMediaContainer.innerHTML = '';
        previewState.isScanning = false;
        if (previewPopupOverlay) previewPopupOverlay.classList.add('hidden');
        window.speechSynthesis.cancel(); // Stop TTS
    });
}

if (previewPrevBtn) {
    previewPrevBtn.addEventListener('click', () => navigatePreview(-1));
}

if (previewNextBtn) {
    previewNextBtn.addEventListener('click', () => navigatePreview(1));
}

// Scanning Input Listeners
document.addEventListener('keydown', (e) => {
    if (previewModal.classList.contains('hidden')) return;

    if (e.code === 'Space') {
        e.preventDefault();
        scanNextPreview();
    } else if (e.code === 'Enter') {
        e.preventDefault();
        selectCurrentPreview();
    } else if (e.code === 'ArrowLeft') {
        navigatePreview(-1);
    } else if (e.code === 'ArrowRight') {
        navigatePreview(1);
    }
});

function speak(text) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
}

function scanNextPreview() {
    if (!previewState.activeElements.length) return;

    // Remove previous highlight
    if (previewState.currentIndex >= 0 && previewState.currentIndex < previewState.activeElements.length) {
        previewState.activeElements[previewState.currentIndex].classList.remove('scanned');
    }

    // Move next
    previewState.currentIndex++;
    if (previewState.currentIndex >= previewState.activeElements.length) {
        previewState.currentIndex = 0;
    }

    // Highlight new
    const el = previewState.activeElements[previewState.currentIndex];
    if (el) {
        el.classList.add('scanned');
        updatePreviewPopup(el);
        
        // TTS
        let textToSpeak = "";
        if (el.id === 'preview-question-area') {
            textToSpeak = previewQuestionText.textContent;
        } else {
            textToSpeak = el.dataset.speak || el.textContent;
        }
        speak(textToSpeak);
    }
}

function selectCurrentPreview() {
    if (previewState.currentIndex >= 0 && previewState.currentIndex < previewState.activeElements.length) {
        const el = previewState.activeElements[previewState.currentIndex];
        // If it's the question area, maybe repeat TTS? Or just do nothing special.
        // The game usually repeats question on click.
        if (el.id === 'preview-question-area') {
            speak(previewQuestionText.textContent);
        } else {
            el.click();
        }
    }
}

function restoreQuestionMedia() {
    if (!previewPopupContent || !previewMediaContainer) return;
    
    const popupChild = previewPopupContent.firstElementChild;
    if (popupChild && popupChild.dataset.isQuestionMedia) {
        // Restore to container
        if (popupChild.tagName === 'VIDEO') {
            popupChild.controls = true; // Restore controls for small view
            popupChild.muted = false;
            popupChild.autoplay = false;
            popupChild.pause();
        }
        
        if (popupChild.tagName === 'IFRAME') {
             let src = popupChild.src;
             if (src.includes('autoplay=1')) {
                 src = src.replace('autoplay=1', 'autoplay=0');
             } else {
                 src = src.replace('&autoplay=1', '').replace('?autoplay=1', '');
                 src += (src.includes('?') ? '&' : '?') + 'autoplay=0';
             }
             popupChild.src = src;
        }

        previewMediaContainer.appendChild(popupChild);
    }
    // Don't clear popup content here if we are about to fill it with something else,
    // but usually we call this when we want to clear or switch.
    // Safe to clear if we moved the child.
    if (popupChild && popupChild.dataset.isQuestionMedia) {
        previewPopupContent.innerHTML = '';
    }
}

function updatePreviewPopup(el) {
    if (!previewPopupOverlay || !previewPopupContent) return;

    // Check if it's the question area
    if (el.id === 'preview-question-area') {
        // Restore media to container and hide popup so user focuses on question
        restoreQuestionMedia();
        previewPopupContent.innerHTML = '';
        previewPopupOverlay.classList.add('hidden');
    } else {
        // We are on an answer (or something else).
        // Ensure question media is back in container.
        restoreQuestionMedia();

        // Check if it's an answer with media
        const img = el.querySelector('img');
        const video = el.querySelector('video');
        const iframe = el.querySelector('iframe');
        
        previewPopupContent.innerHTML = '';
        let hasMedia = false;

        if (img) {
            const clone = img.cloneNode(true);
            previewPopupContent.appendChild(clone);
            hasMedia = true;
        } else if (video) {
            const clone = video.cloneNode(true);
            clone.muted = false; 
            clone.controls = false;
            clone.autoplay = true;
            previewPopupContent.appendChild(clone);
            setTimeout(() => {
                clone.play().catch(e => console.log("Autoplay prevented", e));
            }, 100);
            hasMedia = true;
        } else if (iframe) {
            const clone = iframe.cloneNode(true);
            clone.style.pointerEvents = "auto";
            clone.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
            // Unmute and Autoplay for popup
            let src = clone.src;
            if (src.includes('mute=1')) {
                src = src.replace('mute=1', 'mute=0');
            }
            if (src.includes('autoplay=0')) {
                src = src.replace('autoplay=0', 'autoplay=1');
            } else if (!src.includes('autoplay')) {
                src += (src.includes('?') ? '&' : '?') + 'autoplay=1';
            }
            clone.src = src;
            
            previewPopupContent.appendChild(clone);
            hasMedia = true;
        }

        if (hasMedia) {
            previewPopupOverlay.classList.remove('hidden');
        } else {
            previewPopupOverlay.classList.add('hidden');
        }
    }
}

function navigatePreview(direction) {
    const catName = previewState.currentCategory;
    const questions = Array.isArray(triviaData[catName]) ? triviaData[catName] : triviaData[catName].questions;
    
    let newIndex = previewState.currentQuestionIndex + direction;
    
    if (newIndex < 0) {
        newIndex = questions.length - 1; // Loop to end
    } else if (newIndex >= questions.length) {
        newIndex = 0; // Loop to start
    }
    
    window.previewQuestion(catName, newIndex);
}

window.previewQuestion = (catName, index) => {
    // Ensure we clean up previous state if we are switching questions
    restoreQuestionMedia();
    if (previewPopupContent) previewPopupContent.innerHTML = '';
    if (previewPopupOverlay) previewPopupOverlay.classList.add('hidden');

    previewState.currentCategory = catName;
    previewState.currentQuestionIndex = index;

    const questions = Array.isArray(triviaData[catName]) ? triviaData[catName] : triviaData[catName].questions;
    const q = questions[index];
    
    // 1. Set Question Text
    previewQuestionText.textContent = q.question;
    
    // 2. Set Media
    previewMediaContainer.innerHTML = '';
    if (q.media && q.media.src) {
        let el;
        if (q.media.type === 'image') {
            el = document.createElement('img');
            el.src = q.media.src;
        } else if (q.media.type === 'audio') {
            el = document.createElement('audio');
            el.controls = true;
            el.autoplay = true;
            el.src = q.media.src;
        } else if (q.media.type === 'video') {
            const ytId = getYouTubeId(q.media.src);
            if (ytId) {
                el = document.createElement('iframe');
                el.src = `https://www.youtube.com/embed/${ytId}?autoplay=0`;
                el.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                el.style.width = "100%";
                el.style.height = "100%";
            } else {
                el = document.createElement('video');
                el.controls = true;
                el.autoplay = false;
                el.src = q.media.src;
            }
        }
        if (el) previewMediaContainer.appendChild(el);
    }

    // 3. Set Answers
    previewAnswersArea.innerHTML = '';
    
    // Helper to ensure choice data structure
    const getChoiceData = (choice) => {
        if (typeof choice === 'object' && choice !== null) {
            return { text: choice.text || '', image: choice.image || '' };
        }
        return { text: choice || '', image: '' };
    };

    // Shuffle answers for preview (keep track of correct one)
    // We need to know which one is correct. In data, index 0 is always correct.
    let answers = q.choices.map((c, i) => ({ ...getChoiceData(c), originalIndex: i }));
    
    // Simple shuffle
    for (let i = answers.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [answers[i], answers[j]] = [answers[j], answers[i]];
    }

    answers.forEach(ans => {
        const btn = document.createElement('div');
        btn.className = 'preview-answer-card';
        // Add text for TTS
        if (ans.text) btn.dataset.speak = ans.text;
        
        if (ans.image) {
            const mediaType = detectMediaType(ans.image);
            const ytId = mediaType === 'video' ? getYouTubeId(ans.image) : null;

            if (mediaType === 'video' && ytId) {
                const iframe = document.createElement('iframe');
                iframe.src = `https://www.youtube.com/embed/${ytId}?autoplay=0&mute=1&controls=0&disablekb=1&fs=0&modestbranding=1`;
                iframe.style.width = "100%";
                iframe.style.height = "100%";
                iframe.style.pointerEvents = "none"; // Pass click to button
                iframe.frameBorder = "0";
                iframe.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture";
                btn.appendChild(iframe);
            } else if (mediaType === 'video') {
                const video = document.createElement('video');
                video.src = ans.image;
                video.style.width = "100%";
                video.style.height = "100%";
                video.muted = true;
                video.autoplay = false;
                video.loop = true;
                video.playsInline = true;
                btn.appendChild(video);
            } else {
                const img = document.createElement('img');
                img.src = ans.image;
                btn.appendChild(img);
            }
        } else {
            btn.textContent = ans.text;
        }

        btn.onclick = () => {
            if (ans.originalIndex === 0) {
                btn.classList.add('correct-reveal');
                speak("Correct!");
            } else {
                btn.classList.add('wrong-reveal');
                speak("Wrong!");
                // Highlight the correct one too
                Array.from(previewAnswersArea.children).forEach((b, i) => {
                    if (answers[i].originalIndex === 0) {
                        b.classList.add('correct-reveal');
                    }
                });
            }
        };
        
        previewAnswersArea.appendChild(btn);
    });

    previewModal.classList.remove('hidden');
    
    // Initialize Scanning
    // Include Question Area first, then answers
    previewState.activeElements = [previewQuestionArea, ...Array.from(previewAnswersArea.children)];
    previewState.currentIndex = -1;
    previewState.isScanning = true;
    
    // Reset popup
    if (previewPopupOverlay) previewPopupOverlay.classList.add('hidden');
    
    // Speak Question immediately on load (optional, but good for accessibility)
    speak(q.question);
};

