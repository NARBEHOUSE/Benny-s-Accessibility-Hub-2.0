// Main application controller
class NARBEApp {
    constructor() {
        this.textInput = document.getElementById('text-input');
        this.predictionButtons = Array.from(document.querySelectorAll('[data-pred="true"]'));
        this.historyButtons = Array.from(document.querySelectorAll('[data-history]'));
        
        // Video player state tracking
        this.videoState = {
            isPlaying: true,
            isMuted: true, // Start muted to allow autoplay
            currentIframe: null
        };

        // Shorts player state tracking
        this.shortsState = {
            isPlaying: false,
            isMuted: false,
            currentIframe: null,
            autoplayEnabled: true
        };
        
        this.init();
    }
    
    init() {
        // Check if served over proper protocol
        this.checkProtocol();
        
        this.setupEventListeners();
        this.setupButtonHandlers();
        this.schedulePredictions();
        
        // Focus the body to ensure keyboard events work
        document.body.focus();
        
        // Disable context menus
        document.addEventListener('contextmenu', e => e.preventDefault());
        
        // Prevent text selection
        document.addEventListener('selectstart', e => e.preventDefault());
        
        console.log('NARBE Scan Keyboard initialized');
    }
    
    checkProtocol() {
        const origin = window.location.origin;
        
        if (!origin || origin === 'null' || window.location.protocol === 'file:') {
            console.warn('⚠️ App is not served over HTTP(S). YouTube player controls may not work.');
            console.warn('Please serve this app over HTTP(S) using a local server:');
            console.warn('Example: python -m http.server 8080');
            
            // Still allow the app to run, but warn user
            setTimeout(() => {
                if (window.speechManager) {
                    window.speechManager.speak('Warning: Please serve over HTTP for full functionality');
                }
            }, 2000);
        } else {
            console.log('✅ App served over valid origin:', origin);
        }
    }
    
    setupEventListeners() {
        // Text input changes trigger predictions
        this.textInput.addEventListener('input', () => {
            this.schedulePredictions();
        });
        
        // Prevent focus on readonly input
        this.textInput.addEventListener('focus', () => {
            this.textInput.blur();
        });
    }
    
    setupButtonHandlers() {
        // Set up click handlers for all scan buttons
        document.querySelectorAll('.scan-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                this.handleButtonClick(button);
            });
        });
        
        // Set up slideshow controls
        this.setupSlideshowControls();

        // Set up shorts feed controls
        this.setupShortsControls();
        
        console.log('All button handlers set up');
    }
    
    setupSlideshowControls() {
        // Image slideshow controls
        const imageSlideshow = document.getElementById('image-slideshow');
        const imageControls = imageSlideshow.querySelectorAll('.scan-btn');
        
        imageControls.forEach(button => {
            const action = button.dataset.action;
            button.addEventListener('click', () => {
                this.handleImageAction(action);
            });
        });
        
        // Video slideshow controls
        const videoSlideshow = document.getElementById('video-slideshow');
        const videoControls = videoSlideshow.querySelectorAll('.scan-btn');
        
        videoControls.forEach(button => {
            const action = button.dataset.action;
            button.addEventListener('click', () => {
                this.handleVideoAction(action);
            });
        });
    }

    setupShortsControls() {
        const shortsFeed = document.getElementById('shorts-feed');
        if (!shortsFeed) {
            console.error('Shorts feed element not found');
            return;
        }
        
        const shortsControls = shortsFeed.querySelectorAll('.scan-btn');
        console.log('Setting up', shortsControls.length, 'shorts control buttons');
        
        shortsControls.forEach((button, index) => {
            const action = button.dataset.action;
            console.log(`Setting up shorts button ${index}:`, action, button.textContent);
            
            // Remove existing listeners to avoid duplicates
            button.removeEventListener('click', button._shortsClickHandler);
            
            // Create new click handler
            button._shortsClickHandler = (e) => {
                e.preventDefault();
                e.stopPropagation();
                console.log('Shorts button clicked:', action);
                this.handleShortsAction(action);
            };
            
            button.addEventListener('click', button._shortsClickHandler);
        });
    }
    
    handleButtonClick(button) {
        const action = button.dataset.action;
        const char = button.dataset.char;
        const isPred = button.dataset.pred === 'true';
        const historyIndex = button.dataset.history;
        
        if (char) {
            this.addCharacter(char);
        } else if (isPred) {
            this.addPrediction(button.textContent);
        } else if (historyIndex !== undefined) {
            window.historyManager.selectHistoryItem(parseInt(historyIndex));
        } else if (action) {
            this.handleAction(action);
        }
    }
    
    addCharacter(char) {
        this.textInput.value = (this.textInput.value + char).toUpperCase();
        window.speechManager.speak(char);
        this.schedulePredictions();
    }
    
    addPrediction(prediction) {
        const text = this.textInput.value;
        const hasSpace = text.endsWith(' ');
        const trimmed = text.trim();
        const parts = trimmed.split(' ').filter(p => p.length > 0);
        const current = parts[parts.length - 1] || '';
        const before = parts.slice(0, -1).join(' ');
        
        let newText = '';
        
        if (hasSpace || current === '') {
            // Add prediction as new word
            newText = trimmed + ' ' + prediction + ' ';
        } else if (prediction.toLowerCase().startsWith(current.toLowerCase())) {
            // Replace current partial word
            newText = (before ? before + ' ' : '') + prediction + ' ';
        } else {
            // Add prediction as new word
            newText = trimmed + ' ' + prediction + ' ';
        }
        
        // Normalize spaces
        newText = newText.replace(/\s+/g, ' ').trim();
        if (newText && !newText.endsWith(' ')) {
            newText += ' ';
        }
        
        this.textInput.value = newText.toUpperCase();
        window.speechManager.speak(prediction);
        this.schedulePredictions();
    }
    
    handleAction(action) {
        switch (action) {
            case 'space_char':
                this.textInput.value = this.textInput.value + ' ';
                window.speechManager.speak('space');
                this.schedulePredictions();
                break;
            case 'del_letter':
                window.speechManager.speak('delete letter');
                this.textInput.value = this.textInput.value.slice(0, -1);
                this.schedulePredictions();
                break;
            case 'del_word':
                window.speechManager.speak('delete word');
                const text = this.textInput.value;
                const trimmed = text.trimEnd();
                if (!trimmed) {
                    this.textInput.value = '';
                } else {
                    const lastSpaceIndex = trimmed.lastIndexOf(' ');
                    if (lastSpaceIndex === -1) {
                        this.textInput.value = '';
                    } else {
                        this.textInput.value = trimmed.substring(0, lastSpaceIndex + 1);
                    }
                }
                this.schedulePredictions();
                break;
            case 'clear':
                window.speechManager.speak('clear');
                this.textInput.value = '';
                this.schedulePredictions();
                break;
            case 'search_images':
                this.searchImages();
                break;
            case 'search_video':
                this.searchVideos();
                break;
            case 'search_shorts':
                this.searchShorts();
                break;
            case 'toggle_history':
                this.toggleSearchHistory();
                break;
            case 'clear_history':
                window.historyManager.clearHistory();
                break;
            case 'settings':
                window.settingsManager.openSettings();
                break;
            case 'exit':
                this.handleExit();
                break;
        }
    }
    
    handleExit() {
        console.log("Exit button pressed");
        window.speechManager.speak('exit');
        
        try {
            // First try to message the parent window to focus the back button (like keyboard app)
            if (window.parent && window.parent !== window) {
                window.parent.postMessage({ action: 'focusBackButton' }, '*');
            } else {
                // Fallback for standalone usage - try to go back in history
                if (window.history.length > 1) {
                    window.history.back();
                } else {
                    // Final fallback - show exit message
                    this.showExitMessage();
                }
            }
        } catch (err) {
            console.error('Failed to exit properly:', err);
            // Fallback to showing exit message
            this.showExitMessage();
        }
    }
    
    async searchImages() {
        const query = this.textInput.value.trim();
        if (!query) return;
        
        window.speechManager.speak('search images');
        
        try {
            const results = await window.searchManager.searchImages(query);
            if (results && results.length > 0) {
                this.showImageSlideshow();
            }
        } catch (error) {
            console.error('Image search failed:', error);
        }
    }
    
    async searchVideos() {
        const query = this.textInput.value.trim();
        if (!query) return;
        
        window.speechManager.speak('search video');
        
        try {
            const results = await window.searchManager.searchVideos(query);
            if (results && results.length > 0) {
                this.showVideoSlideshow();
            }
        } catch (error) {
            console.error('Video search failed:', error);
        }
    }

    async searchShorts() {
        const query = this.textInput.value.trim();
        if (!query) return;
        
        window.speechManager.speak('searching videos');
        
        // Save to search history before searching
        if (window.historyManager) {
            window.historyManager.addToHistory(query);
        }
        
        try {
            const results = await window.searchManager.searchShorts(query);
            console.log(`Search completed: ${results.length} results found`);
            
            if (results && results.length > 0) {
                this.showShortsFeed();
            } else {
                window.speechManager.speak('No videos found');
            }
        } catch (error) {
            console.error('Video search failed:', error);
            window.speechManager.speak('Search failed');
        }
    }
    
    toggleSearchHistory() {
        const isHistoryMode = window.historyManager.toggleHistoryMode();
        
        if (isHistoryMode) {
            window.speechManager.speak('history mode');
        } else {
            window.speechManager.speak('keyboard mode');
        }
    }
    
    showImageSlideshow() {
        const slideshow = document.getElementById('image-slideshow');
        const image = document.getElementById('slideshow-image');
        
        // Load first image
        const imageUrl = window.searchManager.getImageUrl(0);
        if (imageUrl) {
            image.src = imageUrl;
            image.onerror = () => {
                // Try next image if current one fails
                window.searchManager.nextImage();
                const nextUrl = window.searchManager.getImageUrl(window.searchManager.currentImageIndex);
                if (nextUrl && nextUrl !== imageUrl) {
                    image.src = nextUrl;
                }
            };
        }
        
        slideshow.classList.remove('hidden');
        window.scanningManager.openOverlay();
    }
    
    showVideoSlideshow() {
        const slideshow = document.getElementById('video-slideshow');
        const iframe = document.getElementById('youtube-player');
        
        // Reset video state
        this.videoState.isPlaying = true;
        this.videoState.isMuted = true;
        this.videoState.currentIframe = iframe;
        
        // Load first video
        const videoUrl = window.searchManager.getVideoEmbedUrl(0);
        if (videoUrl) {
            iframe.src = videoUrl;
            
            // Add load event listener to setup player communication
            iframe.onload = () => {
                // Wait for the video to initialize
                setTimeout(() => {
                    this.setupYouTubePlayerAPI(iframe);
                }, 2000);
            };
        }
        
        slideshow.classList.remove('hidden');
        window.scanningManager.openOverlay();
    }

    showShortsFeed() {
        const feed = document.getElementById('shorts-feed');
        const hostDiv = document.getElementById('youtube-player-host');
        
        console.log('🎬 Showing video feed...');
        
        if (!feed || !hostDiv) {
            console.error('❌ Video feed elements not found');
            return;
        }
        
        // Reset shorts state
        this.shortsState.isPlaying = false;
        this.shortsState.isMuted = true;
        
        // Show the feed first
        feed.classList.remove('hidden');
        window.scanningManager.openOverlay();
        
        // Setup player with first video
        setTimeout(() => {
            window.searchManager.setupPlayer();
            this.setupShortsControls();
        }, 500);
        
        console.log('✅ Video feed shown successfully');
    }

    handleShortsAction(action) {
        console.log('🎮 Handling video action:', action);
        
        try {
            switch (action) {
                case 'shorts_prev':
                    console.log('⏮️ Previous video');
                    const prevIndex = window.searchManager.findNextPlayableVideo(window.searchManager.currentShortsIndex, -1);
                    if (prevIndex !== -1) {
                        window.searchManager.currentShortsIndex = prevIndex;
                        window.searchManager.loadNewVideo();
                        window.speechManager.speak('previous');
                    } else {
                        // Silent - no TTS for no previous videos
                        console.log('No previous playable videos available');
                    }
                    break;
                    
                case 'shorts_next':
                    console.log('⏭️ Next video');
                    const nextIndex = window.searchManager.findNextPlayableVideo(window.searchManager.currentShortsIndex, 1);
                    if (nextIndex !== -1) {
                        window.searchManager.currentShortsIndex = nextIndex;
                        window.searchManager.loadNewVideo();
                        window.speechManager.speak('next');
                    } else {
                        // Silent - no TTS for no more videos
                        console.log('No more playable videos available');
                    }
                    break;
                    
                case 'shorts_rewind':
                    console.log('⏪ Rewind 10 seconds');
                    window.searchManager.rewindVideo();
                    break;
                    
                case 'shorts_fast_forward':
                    console.log('⏩ Fast forward 10 seconds');
                    window.searchManager.fastForwardVideo();
                    break;
                    
                case 'shorts_play_pause':
                    console.log('⏯️ Play/pause');
                    window.searchManager.togglePlayPause();
                    break;
                    
                case 'shorts_mute_toggle':
                    console.log('🔇 Mute toggle');
                    window.searchManager.toggleMute();
                    break;
                    
                case 'shorts_close':
                    console.log('❌ Close video player');
                    this.closeShortsFeed();
                    break;
                    
                default:
                    console.warn('❓ Unknown video action:', action);
                    break;
            }
        } catch (error) {
            console.error('❌ Error handling video action:', error);
            window.speechManager.speak('action failed');
        }
    }
    
    // Setup YouTube Player API communication
    setupYouTubePlayerAPI(iframe) {
        try {
            // Enable JS API communication
            iframe.contentWindow.postMessage('{"event":"listening"}', '*');
            
            // Try to unmute after a short delay if user wants sound
            setTimeout(() => {
                if (!this.videoState.isMuted) {
                    this.toggleMute();
                }
            }, 1000);
            
            console.log('YouTube Player API setup complete');
        } catch (error) {
            console.log('Could not setup YouTube Player API:', error);
        }
    }
    
    // Toggle play/pause state
    togglePlayPause() {
        const iframe = this.videoState.currentIframe;
        if (!iframe) return;
        
        try {
            if (this.videoState.isPlaying) {
                // Pause the video
                iframe.contentWindow.postMessage('{"event":"command","func":"pauseVideo","args":""}', '*');
                this.videoState.isPlaying = false;
                window.speechManager.speak('paused');
            } else {
                // Play the video
                iframe.contentWindow.postMessage('{"event":"command","func":"playVideo","args":""}', '*');
                this.videoState.isPlaying = true;
                window.speechManager.speak('playing');
            }
        } catch (error) {
            console.log('Could not toggle play/pause:', error);
            window.speechManager.speak('play pause failed');
        }
    }
    
    // Toggle mute state
    toggleMute() {
        const iframe = this.videoState.currentIframe;
        if (!iframe) return;
        
        try {
            if (this.videoState.isMuted) {
                // Unmute the video
                iframe.contentWindow.postMessage('{"event":"command","func":"unMute","args":""}', '*');
                iframe.contentWindow.postMessage('{"event":"command","func":"setVolume","args":[75]}', '*');
                this.videoState.isMuted = false;
                window.speechManager.speak('unmuted');
            } else {
                // Mute the video
                iframe.contentWindow.postMessage('{"event":"command","func":"mute","args":""}', '*');
                this.videoState.isMuted = true;
                window.speechManager.speak('muted');
            }
        } catch (error) {
            console.log('Could not toggle mute:', error);
            window.speechManager.speak('mute toggle failed');
        }
    }
    
    handleImageAction(action) {
        const image = document.getElementById('slideshow-image');
        
        switch (action) {
            case 'img_prev':
                window.searchManager.prevImage();
                const prevUrl = window.searchManager.getImageUrl(window.searchManager.currentImageIndex);
                if (prevUrl) {
                    image.src = prevUrl;
                }
                window.speechManager.speak('previous');
                break;
                
            case 'img_next':
                window.searchManager.nextImage();
                const nextUrl = window.searchManager.getImageUrl(window.searchManager.currentImageIndex);
                if (nextUrl) {
                    image.src = nextUrl;
                }
                window.speechManager.speak('next');
                break;
                
            case 'img_close':
                this.closeImageSlideshow();
                window.speechManager.speak('close');
                break;
        }
    }
    
    handleVideoAction(action) {
        const iframe = document.getElementById('youtube-player');
        
        // Determine which video source we're currently using
        const hasYouTubeResults = window.searchManager.videoResults.length > 0;
        
        switch (action) {
            case 'vd_prev':
                if (hasYouTubeResults) {
                    // Use YouTube results
                    window.searchManager.prevVideo();
                    const prevUrl = window.searchManager.getVideoEmbedUrl(window.searchManager.currentVideoIndex);
                    if (prevUrl) {
                        iframe.src = prevUrl;
                        // Reset state for new video
                        this.videoState.isPlaying = true;
                        // Keep mute state as user preference
                    }
                }
                window.speechManager.speak('previous');
                break;
                
            case 'vd_next':
                if (hasYouTubeResults) {
                    // Use YouTube results
                    window.searchManager.nextVideo();
                    const nextUrl = window.searchManager.getVideoEmbedUrl(window.searchManager.currentVideoIndex);
                    if (nextUrl) {
                        iframe.src = nextUrl;
                        // Reset state for new video
                        this.videoState.isPlaying = true;
                        // Keep mute state as user preference
                    }
                }
                window.speechManager.speak('next');
                break;
                
            case 'vd_play_pause':
                this.togglePlayPause();
                break;
                
            case 'vd_mute_toggle':
                this.toggleMute();
                break;
                
            case 'vd_close':
                this.closeVideoSlideshow();
                window.speechManager.speak('close');
                break;
        }
    }

    closeImageSlideshow() {
        const slideshow = document.getElementById('image-slideshow');
        slideshow.classList.add('hidden');
        window.scanningManager.closeOverlay();
    }
    
    closeVideoSlideshow() {
        const slideshow = document.getElementById('video-slideshow');
        const iframe = document.getElementById('youtube-player');
        
        // Reset video state
        this.videoState.currentIframe = null;
        this.videoState.isPlaying = true;
        this.videoState.isMuted = true;
        
        // Stop video playback
        iframe.src = 'about:blank';
        
        slideshow.classList.add('hidden');
        window.scanningManager.closeOverlay();
    }

    closeShortsFeed() {
        try {
            console.log('🔒 Closing video feed...');
            const feed = document.getElementById('shorts-feed');
            
            if (!feed) {
                console.error('❌ Video feed element not found during close');
                return;
            }
            
            // Cleanup player first
            window.searchManager.cleanup();
            
            // Reset state
            this.shortsState.currentIframe = null;
            this.shortsState.isPlaying = false;
            this.shortsState.isMuted = false;
            
            // Hide the overlay
            feed.classList.add('hidden');
            window.scanningManager.closeOverlay();
            
            // Speak feedback
            window.speechManager.speak('closed');
            
            console.log('✅ Video feed closed successfully');
        } catch (error) {
            console.error('❌ Error closing video feed:', error);
            // Force close anyway
            const feed = document.getElementById('shorts-feed');
            if (feed) {
                feed.classList.add('hidden');
                window.scanningManager.closeOverlay();
            }
        }
    }
    
    schedulePredictions() {
        const text = this.textInput.value;
        window.predictionsManager.schedulePredictions(text, (predictions) => {
            this.updatePredictions(predictions);
        });
    }
    
    updatePredictions(predictions) {
        this.predictionButtons.forEach((button, index) => {
            if (index < predictions.length) {
                button.textContent = predictions[index].toUpperCase();
                button.style.opacity = '1';
                button.style.pointerEvents = 'auto';
            } else {
                button.textContent = '';
                button.style.opacity = '0.3';
                button.style.pointerEvents = 'none';
            }
        });
    }
    
    showExitMessage() {
        // For web version, just show an alert
        // In the original, this would launch another application
        alert('NARBE Scan Keyboard\n\nTo exit, simply close this browser tab or window.');
    }
}

// Settings Manager
class SettingsManager {
    constructor() {
        this.settingsMenu = document.getElementById('settingsMenu');
        this.settingsGrid = document.getElementById('settingsGrid');
        this.settingsItems = [];
        this.currentIndex = 0;
        this.isOpen = false;
        
        // Settings state (load from localStorage)
        this.settings = {
            ttsEnabled: localStorage.getItem('tts_enabled') !== 'false',
            voiceIndex: parseInt(localStorage.getItem('voice_index') || '0'),
            autoScan: localStorage.getItem('auto_scan') !== 'false',
            scanSpeed: localStorage.getItem('scan_speed') || 'medium'
        };
        
        this.init();
    }
    
    init() {
        // Get all settings items
        this.settingsItems = Array.from(this.settingsGrid.querySelectorAll('.settings-item'));
        
        // Sync with global managers if available
        if (typeof NarbeScanManager !== 'undefined') {
             const s = NarbeScanManager.getSettings();
             this.settings.autoScan = s.autoScan;
             const interval = NarbeScanManager.getScanInterval();
             this.settings.scanSpeed = (interval/1000).toFixed(0) + 's';
        }

        // Set up click handlers
        this.settingsItems.forEach(item => {
            item.addEventListener('click', () => {
                this.handleSettingClick(item.dataset.setting);
            });
        });
        
        // Apply saved settings
        this.applySettings();
        this.updateSettingsDisplay();
        
        console.log('Settings Manager initialized');
    }
    
    openSettings() {
        this.isOpen = true;
        this.settingsMenu.classList.remove('hidden');
        this.currentIndex = 0;
        
        // Open overlay mode in scanning manager
        window.scanningManager.overlayOpen = true;
        window.scanningManager.overlayIndex = 0;
        
        // Start autoscan for settings menu
        this.startAutoScan();
        
        // Apply initial focus
        setTimeout(() => {
            this.applyFocus();
        }, 100);
        
        window.speechManager.speak('settings');
    }
    
    closeSettings() {
        this.isOpen = false;
        this.settingsMenu.classList.add('hidden');
        
        // Stop autoscan
        this.stopAutoScan();
        
        // Close overlay mode in scanning manager
        window.scanningManager.closeOverlay();
        
        // Clear focus
        this.clearFocus();
        
        window.speechManager.speak('settings closed');
    }
    
    handleSettingClick(setting) {
        switch (setting) {
            case 'tts-toggle':
                this.toggleTTS();
                break;
            case 'voice':
                this.cycleVoice();
                break;
            case 'auto-scan':
                this.toggleAutoScan();
                break;
            case 'scan-speed':
                this.cycleScanSpeed();
                break;
            case 'close':
                this.closeSettings();
                break;
        }
    }
    
    toggleTTS() {
        this.settings.ttsEnabled = !this.settings.ttsEnabled;
        localStorage.setItem('tts_enabled', this.settings.ttsEnabled);
        
        window.speechManager.enabled = this.settings.ttsEnabled;
        
        this.updateSettingsDisplay();
        window.speechManager.speak(this.settings.ttsEnabled ? 'TTS on' : 'TTS off');
    }
    
    cycleVoice() {
        if (!window.voiceManager) {
            console.warn('Voice manager not available');
            return;
        }
        
        const voices = window.voiceManager.getAvailableVoices();
        if (voices.length === 0) {
            window.speechManager.speak('No voices available');
            return;
        }
        
        this.settings.voiceIndex = (this.settings.voiceIndex + 1) % voices.length;
        localStorage.setItem('voice_index', this.settings.voiceIndex);
        
        window.voiceManager.setVoice(this.settings.voiceIndex);
        
        this.updateSettingsDisplay();
        
        const voiceName = voices[this.settings.voiceIndex].name.split(' ')[0];
        window.speechManager.speak(voiceName);
    }
    
    toggleAutoScan() {
        let newValue;
        if (typeof NarbeScanManager !== 'undefined') {
            const current = NarbeScanManager.getSettings().autoScan;
            newValue = !current;
            NarbeScanManager.setAutoScan(newValue);
            this.settings.autoScan = newValue;
        } else {
            this.settings.autoScan = !this.settings.autoScan;
            localStorage.setItem('auto_scan', this.settings.autoScan);
            newValue = this.settings.autoScan;
        }
        
        // Scan manager should update via subscription, but we update locally to be responsive
        if (window.scanningManager) {
            window.scanningManager.updateSettingsFromManager();
            // Ensure internal flag is set
            window.scanningManager.autoScanEnabled = this.settings.autoScan;
            window.scanningManager.setAutoScan(this.settings.autoScan);
        }
        
        this.updateSettingsDisplay();
        window.speechManager.speak(this.settings.autoScan ? 'auto scan on' : 'auto scan off');
        
        // Settings menu autoscan
        if (this.isOpen) {
            if (this.settings.autoScan) {
                this.startAutoScan();
            } else {
                this.stopAutoScan();
            }
        }
    }
    
    cycleScanSpeed() {
        if (typeof NarbeScanManager !== 'undefined') {
            NarbeScanManager.cycleScanSpeed();
            const interval = NarbeScanManager.getScanInterval();
            this.settings.scanSpeed = (interval/1000).toFixed(0) + 's';
        } else {
            const speeds = ['slow', 'medium', 'fast'];
            const currentIndex = speeds.indexOf(this.settings.scanSpeed);
            const nextIndex = (currentIndex + 1) % speeds.length;
            this.settings.scanSpeed = speeds[nextIndex];
            
            localStorage.setItem('scan_speed', this.settings.scanSpeed);
        }
        
        // Apply the setting to scanning manager
        if (window.scanningManager) {
            window.scanningManager.updateSettingsFromManager();
            if (typeof NarbeScanManager === 'undefined') {
                 // Fallback legacy set
                 window.scanningManager.setScanSpeed(this.settings.scanSpeed);
            }
        }
        
        // Restart settings autoscan with new speed if settings menu is open
        if (this.isOpen) {
             // Stop usually first
             this.stopAutoScan();
             // Start if allowed
             if (window.scanningManager.autoScanEnabled) {
                this.startAutoScan();
             }
        }
        
        this.updateSettingsDisplay();
        window.speechManager.speak('speed ' + this.settings.scanSpeed);
    }
    
    applySettings() {
        // Apply TTS setting
        if (window.speechManager) {
            window.speechManager.enabled = this.settings.ttsEnabled;
        }
        
        // Apply voice setting
        if (window.voiceManager) {
            window.voiceManager.setVoice(this.settings.voiceIndex);
        }
    }
    
    updateSettingsDisplay() {
        // Update TTS toggle
        const ttsValue = document.getElementById('ttsToggleValue');
        if (ttsValue) {
            ttsValue.textContent = this.settings.ttsEnabled ? 'On' : 'Off';
        }
        
        // Update voice
        const voiceValue = document.getElementById('voiceValue');
        if (voiceValue && window.voiceManager) {
            const voices = window.voiceManager.getAvailableVoices();
            if (voices.length > 0 && voices[this.settings.voiceIndex]) {
                const voiceName = voices[this.settings.voiceIndex].name.split(' ')[0];
                voiceValue.textContent = voiceName;
            } else {
                voiceValue.textContent = 'Default';
            }
        }
        
        // Update auto scan
        const autoScanValue = document.getElementById('autoScanValue');
        if (autoScanValue) {
            autoScanValue.textContent = this.settings.autoScan ? 'On' : 'Off';
        }
        
        // Update scan speed
        const scanSpeedValue = document.getElementById('scanSpeedValue');
        if (scanSpeedValue) {
            const val = String(this.settings.scanSpeed);
            if (['slow', 'medium', 'fast'].includes(val)) {
                scanSpeedValue.textContent = val.charAt(0).toUpperCase() + val.slice(1);
            } else {
                scanSpeedValue.textContent = val;
            }
        }
    }
    
    // Scanning support methods
    focusNext() {
        if (this.settingsItems.length === 0) return;
        
        this.currentIndex = (this.currentIndex + 1) % this.settingsItems.length;
        this.applyFocus();
    }
    
    focusPrev() {
        if (this.settingsItems.length === 0) return;
        
        this.currentIndex = (this.currentIndex - 1 + this.settingsItems.length) % this.settingsItems.length;
        this.applyFocus();
    }
    
    applyFocus() {
        this.clearFocus();
        
        const currentItem = this.settingsItems[this.currentIndex];
        if (currentItem) {
            currentItem.classList.add('focused');
            
            // Speak the setting label
            const label = currentItem.querySelector('.setting-label');
            const value = currentItem.querySelector('.setting-value');
            if (label && value) {
                window.speechManager.speak(label.textContent + ' ' + value.textContent);
            }
        }
    }
    
    clearFocus() {
        this.settingsItems.forEach(item => {
            item.classList.remove('focused');
        });
    }
    
    activate() {
        const currentItem = this.settingsItems[this.currentIndex];
        if (currentItem) {
            currentItem.click();
        }
    }
    
    // Auto scan methods for settings
    startAutoScan() {
        if (!window.scanningManager.autoScanEnabled) return;
        
        this.stopAutoScan();
        
        let interval = window.scanningManager.currentScanInterval;
        if (!interval) {
             const speedKey = window.scanningManager.scanSpeed;
             interval = window.scanningManager.scanSpeeds[speedKey] || 2000;
        }
        
        // Safety
        if (interval < 500) interval = 2000;
        
        this.autoScanTimer = setInterval(() => {
            // Don't auto scan if user is interacting
            if (window.scanningManager.spaceDown || window.scanningManager.enterDown) {
                return;
            }
            
            this.focusNext();
        }, interval);
        
        console.log(`Settings auto scan started: ${window.scanningManager.scanSpeed} (${interval}ms)`);
    }
    
    stopAutoScan() {
        if (this.autoScanTimer) {
            clearInterval(this.autoScanTimer);
            this.autoScanTimer = null;
            console.log('Settings auto scan stopped');
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    // Initialize settings manager first
    window.settingsManager = new SettingsManager();
    // Then initialize the main app
    window.narbe = new NARBEApp();
});

// Handle page visibility changes to manage speech
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        window.speechManager.stop();
    }
});

// Prevent page unload during important operations
window.addEventListener('beforeunload', (e) => {
    if (window.searchManager && (window.searchManager.imageResults.length > 0 || window.searchManager.videoResults.length > 0)) {
        e.preventDefault();
        e.returnValue = '';
    }
});

// YouTube API ready callback (required by YouTube IFrame API)
window.onYouTubeIframeAPIReady = function() {
    console.log('YouTube IFrame API is ready');
    window.youTubeAPIReady = true;
};