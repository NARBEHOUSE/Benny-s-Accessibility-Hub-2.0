// Simplified Turnstile Token Manager
const TurnstileTokenManager = (() => {
    async function getFresh() {
        // Wait for Turnstile script to be ready
        await new Promise((resolve, reject) => {
            const ready = () => window.turnstile && typeof window.turnstile.ready === 'function';
            if (ready()) return window.turnstile.ready(resolve);
            const t = setTimeout(() => reject(new Error('Turnstile script not loaded')), 8000);
            window.addEventListener('load', () => {
                if (ready()) {
                    clearTimeout(t);
                    window.turnstile.ready(resolve);
                }
            }, { once: true });
        });

        // Ensure widget is rendered
        if (!window.__ts?.widgetId) {
            const el = document.getElementById('turnstile-widget');
            if (!el) throw new Error('Turnstile mount not found');
            window.__ts = window.__ts || { waiters: [] };
            window.__ts.widgetId = window.turnstile.render(el, {
                sitekey: el.dataset.sitekey,
                size: 'invisible',
                callback: window.onTurnstileToken,
                'expired-callback': window.onTurnstileExpired,
                'error-callback': window.onTurnstileError,
            });
        }

        // Use existing token if available
        if (window.turnstile.getResponse) {
            const existing = window.turnstile.getResponse(window.__ts.widgetId);
            if (existing) return existing;
        }

        // Execute and wait for token via the global callback
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Token timeout')), 8000);
            window.__ts.waiters = window.__ts.waiters || [];
            window.__ts.waiters.push((token) => {
                clearTimeout(timeout);
                resolve(token);
            });
            window.turnstile.execute(window.__ts.widgetId);
        });
    }

    async function getForRequest() {
        return getFresh();
    }

    async function retryToken() {
        try { 
            if (window.__ts?.widgetId) window.turnstile.reset(window.__ts.widgetId); 
        } catch (e) {
            console.log('Reset error during retry (non-fatal):', e);
        }
        return getFresh();
    }

    return { getForRequest, retryToken };
})();

// Global callback for Turnstile widget (referenced in HTML)
window.onTurnstileReady = function(token) {
    console.log('🔒 HTML Turnstile widget ready with token:', token ? 'YES' : 'NO');
    // Store the token for later use
    if (window.searchManager) {
        window.searchManager.htmlTurnstileToken = token || null;
        window.searchManager.turnstileReady = true;
        console.log('✅ Turnstile token stored in searchManager');
    }
};

// YouTube Shorts search functionality
class SearchManager {
    constructor() {
        this.currentSearch = null;
        this.searchTimeout = 15000;
        this.shortsResults = [];
        this.currentShortsIndex = 0;
        
        // Updated Cloudflare Worker endpoint for shorts
        this.shortsEndpoint = 'https://dawn-star-cad3.narbehousellc.workers.dev/';
        
        // Turnstile security with serialization
        this.turnstileReady = false;
        this.htmlTurnstileToken = null;
        
        // Autoplay state
        this.autoplayEnabled = true;
        this.currentPlayer = null;
        this.playerState = {
            isPlaying: false,
            isMuted: false,
            currentVideoId: null
        };
        
        // Initialize Turnstile when ready
        this.initTurnstile();
    }
    
    initTurnstile() {
        console.log('🔒 Initializing Turnstile (using HTML widget)...');
        
        // Check if the HTML widget container exists
        const widgetContainer = document.getElementById('turnstile-widget');
        if (!widgetContainer) {
            console.error('❌ Turnstile widget container not found in HTML');
            this.turnstileReady = false;
            return;
        }
        
        console.log('✅ Found HTML Turnstile widget container');
        this.turnstileReady = true;
    }

    _setToken(token) {
        this.htmlTurnstileToken = token || null;
        this.turnstileReady = true;
        console.log('🔒 Token set via callback:', token ? 'YES' : 'NO');
    }

    _clearToken() {
        this.htmlTurnstileToken = null;
    }

    clearTurnstileToken() {
        this.htmlTurnstileToken = null;
        try {
            if (window.turnstile) window.turnstile.reset('#turnstile-widget');
        } catch (e) {
            console.log('Error resetting widget:', e);
        }
    }

    /**
     * Mobile-safe token acquisition that works with callback-based flow
     */
    async getTsToken() {
        // 1) If the HTML callback already stored a token, use it
        if (this.htmlTurnstileToken) {
            console.log('🔒 Using stored HTML Turnstile token');
            const t = this.htmlTurnstileToken;
            this.htmlTurnstileToken = null; // single-use
            return t;
        }

        // 2) If Turnstile isn't ready, bail gracefully
        if (!this.turnstileReady || !window.turnstile) {
            console.warn('Turnstile not ready, proceeding without token');
            return null;
        }

        // 3) Ask the widget for its current token (mobile-safe)
        try {
            const t0 = window.turnstile.getResponse?.('#turnstile-widget');
            if (t0) {
                console.log('🔒 Read token via getResponse');
                return t0;
            }
        } catch (e) {
            console.log('Error reading token:', e);
        }

        // 4) Execute the widget, then poll getResponse briefly
        try {
            console.log('🔒 Executing Turnstile widget...');
            await window.turnstile.execute('#turnstile-widget'); // returns after solving
            const deadline = Date.now() + 4000;
            while (Date.now() < deadline) {
                const t = window.turnstile.getResponse?.('#turnstile-widget');
                if (t) {
                    console.log('🔒 Got fresh token after execute');
                    return t;
                }
                await new Promise(r => setTimeout(r, 50));
            }
        } catch (e) {
            console.warn('Turnstile execute failed:', e);
        }
        return null;
    }

    async searchShorts(query) {
        if (!query || query.trim() === '') {
            window.speechManager.speak('Please enter a search term');
            return [];
        }

        try {
            console.log(`🔍 Starting YouTube search for: "${query}"`);
            this.showLoading('Searching videos');
            
            // Use new token flow
            const results = await this.searchCloudflareShorts(query);
            
            if (results.length > 0) {
                console.log(`✅ Found ${results.length} videos`);
                this.shortsResults = results;
                this.currentShortsIndex = 0;
                this.hideLoading();
                window.speechManager.speak(`Found ${results.length} videos`);
                
                return results;
            } else {
                console.log('❌ No videos found');
                this.hideLoading();
                window.speechManager.speak('No videos found');
                return [];
            }
            
        } catch (error) {
            console.error('❌ Video search failed:', error);
            this.hideLoading();
            this.handleSearchError('video search', error);
            return [];
        }
    }

    // Cloudflare Worker Shorts Search with proper token management
    async searchCloudflareShorts(query) {
        const url = `${this.shortsEndpoint}?q=${encodeURIComponent(query)}&limit=50`;
        console.log('📹 Searching videos via Cloudflare Worker...');
        console.log('🔗 Worker request URL:', url);

        const doRequest = async (token) => {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.searchTimeout);

            const headers = { 
                'Accept': 'application/json',
                'X-App-Key': 'banana-dragon-sky-88',
                // Always send desktop-like headers to avoid mobile API restrictions
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
                'Sec-Ch-Ua-Mobile': '?0',
                'Sec-Ch-Ua-Platform': '"Windows"',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'cross-site'
            };
            
            if (token) {
                headers['cf-turnstile-response'] = token;
                console.log('🔒 Sending request with Turnstile token');
            } else {
                console.warn('⚠️ No Turnstile token available for request');
            }

            const t0 = Date.now();
            const res = await fetch(url, { 
                method: 'GET', 
                headers, 
                signal: controller.signal,
                credentials: 'omit',
                mode: 'cors'
            });
            clearTimeout(timeoutId);
            console.log('📊 Worker response status:', res.status);
            console.log('⏱️ Request took:', Date.now() - t0, 'ms');
            return res;
        };

        // 1) Try to get a token using multiple methods
        let token = null;
        
        // Method 1: Check if we have a stored token
        if (this.htmlTurnstileToken) {
            token = this.htmlTurnstileToken;
            console.log('🔒 Using stored token from callback');
            this.htmlTurnstileToken = null; // Use once
        }
        
        // Method 2: Try to get existing response from widget
        if (!token && window.turnstile && window.__ts?.widgetId) {
            try {
                token = window.turnstile.getResponse(window.__ts.widgetId);
                if (token) {
                    console.log('🔒 Got existing token from widget');
                }
            } catch (e) {
                console.log('Could not get existing token:', e);
            }
        }
        
        // Method 3: Execute widget and wait for new token
        if (!token && window.turnstile && window.__ts?.widgetId) {
            try {
                console.log('🔒 Executing widget for fresh token...');
                await new Promise((resolve, reject) => {
                    const timeout = setTimeout(() => reject(new Error('Token timeout')), 10000);
                    
                    // Add ourselves to the waiters list
                    if (!window.__ts.waiters) window.__ts.waiters = [];
                    window.__ts.waiters.push((newToken) => {
                        clearTimeout(timeout);
                        token = newToken;
                        console.log('🔒 Got fresh token from execute');
                        resolve();
                    });
                    
                    // Execute the widget
                    window.turnstile.execute(window.__ts.widgetId);
                });
            } catch (error) {
                console.warn('⚠️ Could not get fresh token:', error);
            }
        }

        let res = await doRequest(token);

        // 2) On 401, reset widget and try one more time
        if (res.status === 401) {
            console.warn('🔁 Token rejected (401), resetting widget and retrying...');
            try {
                // Reset the widget
                if (window.turnstile && window.__ts?.widgetId) {
                    window.turnstile.reset(window.__ts.widgetId);
                }
                
                // Wait a moment then try to get a new token
                await new Promise(resolve => setTimeout(resolve, 1000));
                
                token = null;
                if (window.turnstile && window.__ts?.widgetId) {
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => reject(new Error('Retry token timeout')), 10000);
                        
                        if (!window.__ts.waiters) window.__ts.waiters = [];
                        window.__ts.waiters.push((newToken) => {
                            clearTimeout(timeout);
                            token = newToken;
                            console.log('🔒 Got retry token');
                            resolve();
                        });
                        
                        window.turnstile.execute(window.__ts.widgetId);
                    });
                }
                
                res = await doRequest(token);
            } catch (error) {
                console.warn('⚠️ Could not get retry token:', error);
                // Continue with the 401 response to handle below
            }
        }

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            console.error('❌ Worker API error:', res.status, txt);
            if (res.status === 401 || res.status === 403) {
                throw new Error('Access denied - please refresh the page');
            }
            if (res.status >= 500) {
                throw new Error('Search service error - try again');
            }
            throw new Error(`Search failed with ${res.status}`);
        }

        const payload = await res.json().catch(() => null);
        if (!payload || !Array.isArray(payload.items)) {
            console.warn('⚠️ Unexpected response format:', payload);
            return [];
        }
        
        console.log('📊 Raw items count from worker:', payload.items.length);
        return payload.items.map((it, i) => ({
            videoId: it.videoId,
            title: it.title || `Video ${i + 1}`,
            author: it.channelTitle || 'YouTube',
            thumbnail: `https://i.ytimg.com/vi/${it.videoId}/hqdefault.jpg`,
            url: `https://www.youtube.com/watch?v=${it.videoId}`
        }));
    }

    // Load YouTube API if not already loaded
    async loadYouTubeAPI() {
        return new Promise((resolve) => {
            // If API is already loaded and ready
            if (window.YT && window.YT.Player) {
                console.log('YouTube API already loaded and ready');
                resolve();
                return;
            }
            
            // Set up the callback before loading the script
            window.onYouTubeIframeAPIReady = () => {
                console.log('YouTube API ready callback fired');
                resolve();
            };
            
            // Load the API script if not already present
            if (!document.querySelector('script[src*="iframe_api"]')) {
                const script = document.createElement('script');
                script.src = 'https://www.youtube.com/iframe_api';
                script.async = true;
                document.head.appendChild(script);
            } else {
                // Script already exists, API should be ready soon
                setTimeout(() => resolve(), 100);
            }
        });
    }

    // Play a video by videoId - let YouTube API manage everything
    async playVideoId(videoId) {
        console.log('🎥 Playing video ID:', videoId);
        
        try {
            // Ensure API is loaded
            await this.loadYouTubeAPI();
            
            // Destroy previous player instance (important!)
            if (this.ytPlayer && this.ytPlayer.destroy) {
                try {
                    console.log('Destroying previous player instance');
                    this.ytPlayer.destroy();
                } catch (e) {
                    console.log('Error destroying player:', e);
                }
                this.ytPlayer = null;
            }
            
            // Create new player - let YouTube API create the iframe
            console.log('Creating new YouTube player for host element');
            this.ytPlayer = new YT.Player('youtube-player-host', {
                width: '100%',
                height: '100%',
                videoId: videoId,
                playerVars: {
                    autoplay: 1,
                    mute: 1,                // Start muted for autoplay compliance, but will unmute after ready
                    playsinline: 1,
                    rel: 0,
                    modestbranding: 1,
                    controls: 0,            // Hide default controls since we have our own
                    fs: 0,                  // No fullscreen
                    iv_load_policy: 3,      // No annotations
                    disablekb: 1,           // No keyboard controls
                    // CRITICAL: Must match exact origin
                    origin: window.location.origin,
                    enablejsapi: 1
                },
                events: {
                    onReady: (event) => {
                        console.log('✅ YouTube player ready');
                        this.onPlayerReady(event);
                    },
                    onStateChange: (event) => {
                        console.log('🔄 Player state change:', event.data);
                        this.onPlayerStateChange(event);
                    },
                    onError: (event) => {
                        console.error('❌ YouTube player error:', event.data);
                        this.onPlayerError(event);
                    }
                }
            });
            
            // Update our state - videos will start unmuted
            this.playerState = {
                isPlaying: true,    // Will start playing when ready
                isMuted: false,     // Will be unmuted automatically after ready
                currentVideoId: videoId
            };
            
        } catch (error) {
            console.error('❌ Error playing video:', error);
            window.speechManager.speak('player error');
            this.handleVideoError();
        }
    }
    
    onPlayerReady(event) {
        try {
            console.log('Player ready - starting playback and auto-unmuting');
            const player = event.target;
            
            // Start muted for autoplay compliance, then unmute after a brief delay
            player.mute();
            player.playVideo();
            
            // Auto-unmute after player starts (gives time for autoplay to work)
            setTimeout(() => {
                try {
                    player.unMute();
                    player.setVolume(50); // Set reasonable volume
                    console.log('🔊 Auto-unmuted video and set volume to 50%');
                    this.playerState.isMuted = false;
                    
                    // Update button labels
                    this.updatePlayerButtons();
                } catch (error) {
                    console.log('Could not auto-unmute video:', error);
                    this.playerState.isMuted = true;
                }
            }, 1000); // Wait 1 second for autoplay to establish
            
            console.log('✅ Player initialized successfully');
            
        } catch (error) {
            console.error('Error in onPlayerReady:', error);
        }
    }
    
    onPlayerStateChange(event) {
        const state = event.data;
        
        switch (state) {
            case YT.PlayerState.UNSTARTED:
                this.playerState.isPlaying = false;
                break;
            case YT.PlayerState.ENDED:
                console.log('Video ended, auto-advancing...');
                this.playerState.isPlaying = false;
                if (this.autoplayEnabled) {
                    setTimeout(() => {
                        this.autoAdvanceToNext();
                    }, 1500);
                }
                break;
            case YT.PlayerState.PLAYING:
                this.playerState.isPlaying = true;
                break;
            case YT.PlayerState.PAUSED:
                this.playerState.isPlaying = false;
                break;
            case YT.PlayerState.BUFFERING:
                // Don't change state during buffering
                break;
            case YT.PlayerState.CUED:
                this.playerState.isPlaying = false;
                break;
        }
        
        // Update button labels after state change
        this.updatePlayerButtons();
    }
    
    onPlayerError(event) {
        const errorCode = event.data;
        console.error('❌ YouTube player error code:', errorCode);
        
        let shouldSkip = true;
        
        switch (errorCode) {
            case 2:
                console.log('Invalid video ID, silently skipping to next video');
                break;
            case 5:
                console.log('HTML5 player error, silently skipping to next video');
                break;
            case 100:
                console.log('Video not found or private, silently skipping to next video');
                break;
            case 101:
            case 150:
                console.log('Video not embeddable, silently skipping to next video');
                break;
            default:
                console.log('Unknown video error, silently skipping to next video');
                break;
        }
        
        // No TTS announcement - just silently skip
        
        if (shouldSkip) {
            // Mark current video as unplayable
            this.markVideoAsUnplayable(this.currentShortsIndex);
            
            // Try to skip to next playable video immediately (no delay)
            this.skipToNextPlayableVideo();
        }
    }
    
    markVideoAsUnplayable(index) {
        if (this.shortsResults[index]) {
            this.shortsResults[index].unplayable = true;
            console.log(`❌ Marked video ${index + 1} as unplayable: ${this.shortsResults[index].title}`);
        }
    }
    
    findNextPlayableVideo(startIndex, direction = 1) {
        const totalVideos = this.shortsResults.length;
        if (totalVideos === 0) return -1;
        
        let attempts = 0;
        let currentIndex = startIndex;
        
        // Try to find a playable video within reasonable attempts
        while (attempts < totalVideos) {
            currentIndex = direction > 0 
                ? (currentIndex + 1) % totalVideos
                : (currentIndex - 1 + totalVideos) % totalVideos;
            
            const video = this.shortsResults[currentIndex];
            if (video && !video.unplayable) {
                console.log(`✅ Found playable video at index ${currentIndex}: ${video.title}`);
                return currentIndex;
            }
            
            attempts++;
        }
        
        console.log('❌ No playable videos found in results');
        return -1;
    }
    
    skipToNextPlayableVideo() {
        const nextIndex = this.findNextPlayableVideo(this.currentShortsIndex, 1);
        
        if (nextIndex !== -1) {
            this.currentShortsIndex = nextIndex;
            const nextVideo = this.shortsResults[nextIndex];
            console.log(`⏭️ Silently skipping to next playable video: ${nextVideo.title}`);
            this.playVideoId(nextVideo.videoId);
        } else {
            // All videos are unplayable - only speak if absolutely no videos work
            console.log('❌ All videos in search results are unplayable');
            window.speechManager.speak('No playable videos found');
            
            // Close the video player
            setTimeout(() => {
                if (window.narbe && window.narbe.closeShortsFeed) {
                    window.narbe.closeShortsFeed();
                }
            }, 2000);
        }
    }
    
    skipToPreviousPlayableVideo() {
        const prevIndex = this.findNextPlayableVideo(this.currentShortsIndex, -1);
        
        if (prevIndex !== -1) {
            this.currentShortsIndex = prevIndex;
            const prevVideo = this.shortsResults[prevIndex];
            console.log(`⏮️ Silently skipping to previous playable video: ${prevVideo.title}`);
            this.playVideoId(prevVideo.videoId);
        } else {
            // No TTS - just silently stay on current video
            console.log('No previous playable videos available');
        }
    }
    
    handleVideoError() {
        // Mark current video as unplayable and try next one silently
        this.markVideoAsUnplayable(this.currentShortsIndex);
        this.skipToNextPlayableVideo();
    }

    // Update button labels based on current state
    updatePlayerButtons() {
        const playPauseBtn = document.querySelector('[data-action="shorts_play_pause"]');
        const muteBtn = document.querySelector('[data-action="shorts_mute_toggle"]');
        
        if (playPauseBtn) {
            playPauseBtn.textContent = this.playerState.isPlaying ? 'PAUSE' : 'PLAY';
        }
        
        if (muteBtn && this.ytPlayer && this.ytPlayer.isMuted) {
            const actuallyMuted = this.ytPlayer.isMuted();
            muteBtn.textContent = actuallyMuted ? 'UNMUTE' : 'MUTE';
        } else if (muteBtn) {
            muteBtn.textContent = this.playerState.isMuted ? 'UNMUTE' : 'MUTE';
        }
    }
    
    // Control methods using YouTube API
    togglePlayPause() {
        if (!this.ytPlayer || !this.ytPlayer.getPlayerState) {
            console.log('❌ No YouTube player available');
            window.speechManager.speak('player not ready');
            return;
        }
        
        try {
            const state = this.ytPlayer.getPlayerState();
            console.log('Current player state:', state);
            
            if (state === YT.PlayerState.PLAYING) {
                console.log('▶️ Pausing video');
                this.ytPlayer.pauseVideo();
                this.playerState.isPlaying = false;
                window.speechManager.speak('paused');
            } else if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.CUED) {
                console.log('⏸️ Playing video');
                this.ytPlayer.playVideo();
                this.playerState.isPlaying = true;
                window.speechManager.speak('playing');
            } else {
                console.log('🔄 Player in transitional state, trying to play');
                this.ytPlayer.playVideo();
                this.playerState.isPlaying = true;
                window.speechManager.speak('playing');
            }
            
            // Update button labels immediately
            this.updatePlayerButtons();
            
        } catch (error) {
            console.error('❌ Error in togglePlayPause:', error);
            window.speechManager.speak('play pause failed');
        }
    }
    
    toggleMute() {
        if (!this.ytPlayer || !this.ytPlayer.isMuted) {
            console.log('❌ No YouTube player available');
            window.speechManager.speak('player not ready');
            return;
        }
        
        try {
            const isMuted = this.ytPlayer.isMuted();
            console.log('Current mute state:', isMuted);
            
            if (isMuted) {
                console.log('🔊 Unmuting video');
                this.ytPlayer.unMute();
                // Set reasonable volume
                if (this.ytPlayer.setVolume) {
                    this.ytPlayer.setVolume(50);
                }
                this.playerState.isMuted = false;
                window.speechManager.speak('unmuted');
            } else {
                console.log('🔇 Muting video');
                this.ytPlayer.mute();
                this.playerState.isMuted = true;
                window.speechManager.speak('muted');
            }
            
            // Update button labels immediately
            this.updatePlayerButtons();
            
        } catch (error) {
            console.error('❌ Error in toggleMute:', error);
            window.speechManager.speak('mute toggle failed');
        }
    }
    
    rewindVideo() {
        if (!this.ytPlayer || !this.ytPlayer.getCurrentTime || !this.ytPlayer.seekTo) {
            console.log('❌ No YouTube player available for rewind');
            window.speechManager.speak('player not ready');
            return;
        }
        
        try {
            const currentTime = this.ytPlayer.getCurrentTime();
            const newTime = Math.max(0, currentTime - 10); // Go back 10 seconds, but not below 0
            
            console.log(`⏪ Rewinding from ${currentTime}s to ${newTime}s`);
            this.ytPlayer.seekTo(newTime, true);
            window.speechManager.speak('rewind');
            
        } catch (error) {
            console.error('❌ Error in rewindVideo:', error);
            window.speechManager.speak('rewind failed');
        }
    }
    
    fastForwardVideo() {
        if (!this.ytPlayer || !this.ytPlayer.getCurrentTime || !this.ytPlayer.seekTo || !this.ytPlayer.getDuration) {
            console.log('❌ No YouTube player available for fast forward');
            window.speechManager.speak('player not ready');
            return;
        }
        
        try {
            const currentTime = this.ytPlayer.getCurrentTime();
            const duration = this.ytPlayer.getDuration();
            const newTime = Math.min(duration, currentTime + 10); // Go forward 10 seconds, but not beyond video end
            
            console.log(`⏩ Fast forwarding from ${currentTime}s to ${newTime}s (duration: ${duration}s)`);
            this.ytPlayer.seekTo(newTime, true);
            window.speechManager.speak('fast forward');
            
        } catch (error) {
            console.error('❌ Error in fastForwardVideo:', error);
            window.speechManager.speak('fast forward failed');
        }
    }

    // Navigation methods - now work with videoId
    getCurrentVideoId() {
        if (this.shortsResults && this.shortsResults[this.currentShortsIndex]) {
            return this.shortsResults[this.currentShortsIndex].videoId;
        }
        return null;
    }
    
    nextShorts() {
        if (this.shortsResults.length > 0) {
            this.currentShortsIndex = (this.currentShortsIndex + 1) % this.shortsResults.length;
            const currentVideo = this.shortsResults[this.currentShortsIndex];
            console.log(`Next video: ${this.currentShortsIndex + 1}/${this.shortsResults.length} - ${currentVideo?.title}`);
            return this.currentShortsIndex;
        }
        return 0;
    }
    
    prevShorts() {
        if (this.shortsResults.length > 0) {
            this.currentShortsIndex = (this.currentShortsIndex - 1 + this.shortsResults.length) % this.shortsResults.length;
            const currentVideo = this.shortsResults[this.currentShortsIndex];
            console.log(`Previous video: ${this.currentShortsIndex + 1}/${this.shortsResults.length} - ${currentVideo?.title}`);
            return this.currentShortsIndex;
        }
        return 0;
    }

    autoAdvanceToNext() {
        // Only auto-advance if we're still in the overlay
        const shortsFeed = document.getElementById('shorts-feed');
        if (shortsFeed && !shortsFeed.classList.contains('hidden')) {
            console.log(`Auto-advancing to next video...`);
            
            const nextIndex = this.findNextPlayableVideo(this.currentShortsIndex, 1);
            if (nextIndex !== -1) {
                this.currentShortsIndex = nextIndex;
                const nextVideo = this.shortsResults[nextIndex];
                console.log(`Loading next playable video: ${nextVideo.title}`);
                this.playVideoId(nextVideo.videoId);
            } else {
                console.log('No more playable videos for auto-advance');
                // Only speak if we reach the absolute end
                window.speechManager.speak('End of videos');
            }
        }
    }
    
    loadNewVideo() {
        const videoId = this.getCurrentVideoId();
        if (videoId) {
            const currentVideo = this.shortsResults[this.currentShortsIndex];
            if (currentVideo && currentVideo.unplayable) {
                console.log('Current video marked as unplayable, finding alternative...');
                this.skipToNextPlayableVideo();
            } else {
                console.log('🔄 Loading new video:', videoId);
                this.playVideoId(videoId);
            }
        }
    }
    
    // Simplified setup method
    setupPlayer() {
        console.log('🎬 Setting up initial player...');
        const videoId = this.getCurrentVideoId();
        if (videoId) {
            this.playVideoId(videoId);
        } else {
            console.error('❌ No video ID available for setup');
        }
    }
    
    cleanup() {
        console.log('🧹 Cleaning up player...');
        
        // Destroy YouTube player properly
        if (this.ytPlayer) {
            try {
                console.log('Destroying YouTube player...');
                this.ytPlayer.destroy();
            } catch (error) {
                console.log('Error destroying player:', error);
            }
            this.ytPlayer = null;
        }
        
        // Reset state
        this.playerState = {
            isPlaying: false,
            isMuted: true,
            currentVideoId: null
        };
        
        console.log('✅ Cleanup complete');
    }

    handleSearchError(type, error) {
        console.error(`${type} search error:`, error);
        
        if (error.message.includes('403') || error.message.includes('quotaExceeded')) {
            window.speechManager.speak(`${type} search quota exceeded. Try again later.`);
        } else if (error.message.includes('400') || error.message.includes('invalid')) {
            window.speechManager.speak(`Invalid ${type} search request.`);
        } else if (error.message.includes('timeout')) {
            window.speechManager.speak(`${type} search timed out. Check connection.`);
        } else {
            window.speechManager.speak(`${type} search failed. Try again.`);
        }
    }

    // Utility methods
    showLoading(message) {
        const overlay = document.getElementById('loading-overlay');
        const label = document.getElementById('loading-label');
        
        if (overlay && label) {
            label.textContent = message || 'Loading...';
            overlay.classList.remove('hidden');
        }
    }
    
    hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }
}

// Global search manager instance
window.searchManager = new SearchManager();