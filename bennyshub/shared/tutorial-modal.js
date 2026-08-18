(function() {
    window.BennyTutorial = {
        config: null,
        iframeSrc: '',

        init: function(config) {
            this.config = config;
            // Convert Youtube watch URL to embed URL if necessary
            this.iframeSrc = this.convertYoutubeUrl(config.videoUrl);

            // Inject Modal HTML
            const modalHtml = `
            <style>
                /* Fix for Beacons Email Form Embed Layout */
                #a567a843-7bc0-405f-ba40-df503d479211 {
                    width: 100% !important;
                }
                /* Hide the internal garbled text and title from the Beacons widget */
                #a567a843-7bc0-405f-ba40-df503d479211 h1,
                #a567a843-7bc0-405f-ba40-df503d479211 h2,
                #a567a843-7bc0-405f-ba40-df503d479211 h3,
                #a567a843-7bc0-405f-ba40-df503d479211 p,
                #a567a843-7bc0-405f-ba40-df503d479211 span:not([class]) {
                    display: none !important;
                }
                /* Style the Beacons image */
                #a567a843-7bc0-405f-ba40-df503d479211 img {
                    width: 360px !important;
                    height: auto !important;
                    object-fit: contain !important;
                    margin: 0 auto 15px auto !important;
                    display: block !important;
                }
                /* Center the form */
                #a567a843-7bc0-405f-ba40-df503d479211 form {
                    margin: 0 auto !important;
                }
                /* Force stacked layout */
                #a567a843-7bc0-405f-ba40-df503d479211 > div {
                    display: flex !important;
                    flex-direction: column !important;
                    align-items: center !important;
                }
            </style>
            <div id="benny-tutorial-modal" role="dialog" aria-modal="true" style="display:none; position:fixed; z-index:99999; top:0; left:0; width:100%; height:100%;">
                <div id="benny-tutorial-overlay" style="position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.7);"></div>
                <div style="position:relative; z-index:100000; margin: 5vh auto; width:90%; max-width:800px; max-height:90vh; background:#fff; border-radius:8px; box-shadow:0 10px 25px rgba(0,0,0,0.5); display:flex; flex-direction:column;">
                    <button id="benny-tutorial-close" style="position:absolute; top:10px; right:15px; background:transparent; border:none; font-size:30px; cursor:pointer; color:#555; line-height:1; z-index:10;">&times;</button>
                    <div style="overflow-y:auto; padding:20px; flex:1; font-family: sans-serif; text-align: left; color: #333;">
                        <h2 style="margin-top:0; margin-bottom:15px; padding-right:30px; font-size: 24px;">${config.title}</h2>

                        <div style="position:relative; padding-bottom:56.25%; height:0; overflow:hidden; margin-bottom:20px; background:#000; border-radius: 4px;">
                             <iframe id="benny-tutorial-iframe" style="position:absolute; top:0; left:0; width:100%; height:100%;" src="" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>
                             <div id="benny-tutorial-video-placeholder" style="display:none; position:absolute; top:0; left:0; width:100%; height:100%; align-items:center; justify-content:center; color:#aaa; font-family:sans-serif; text-align:center; padding:20px; box-sizing:border-box;">The tutorial video isn't recorded yet — check back soon.</div>
                        </div>

                        <div style="background:#f0f7ff; padding:15px; border-left:4px solid #007bff; margin-bottom:20px; border-radius: 4px;">
                            <p style="margin:0 0 10px 0; line-height: 1.5;">Thank you for checking out Benny's Hub and taking the time to explore this game editor/creator. We hope you found it valuable. While these versions are mostly "beta" we plan to improve them over time with Ben's and your feedback. Please use the link below to submit feedback or your custom games you'd like us to consider for uploading to the official hub.</p>
                            <a href="https://forms.gle/FokFXkF6n45VesNH9" target="_blank" style="color:#007bff; font-weight:bold; text-decoration:none;">Submit Feedback</a>
                        </div>

                        <div style="background:#fff3cd; color:#856404; padding:15px; border-left:4px solid #ffeeba; margin-bottom:20px; border-radius: 4px;">
                            <p style="margin:0 0 10px 0; line-height: 1.5;">Additionally, we are full-time caregivers making these games for Ben and making them available publicly, open source and free. The <a href="https://narbefoundation.org" target="_blank" style="color:inherit; font-weight:bold; text-decoration: underline;">NARBE Foundation</a> helps by providing funding for tools and hosting but all of our time is volunteer. If you found value in this hub, and want to show your appreciation, we accept tips at one of the links below. Thank you so much for your support.</p>
                            <div style="display:flex; gap:10px; flex-wrap:wrap;">
                                <a href="https://streamelements.com/narbehouse/tip" target="_blank" style="text-decoration:none; background:#28a745; color:white; padding:8px 15px; border-radius:4px; font-weight:bold; font-size: 14px;">Tip via StreamElements</a>
                                <a href="https://shop.beacons.ai/narbehouse/e6137d30-c44e-4185-98ea-570312516462?pageViewSource=lib_view&referrer=https%3A%2F%2Fbeacons.ai%2Fnarbehouse&show_back_button=true" target="_blank" style="text-decoration:none; background:#17a2b8; color:white; padding:8px 15px; border-radius:4px; font-weight:bold; font-size: 14px;">Tip via Beacons</a>
                            </div>
                        </div>

                        <div style="margin-top:20px; min-height:100px; background:#f8f9fa; padding:20px; border-radius:8px; text-align:center;">
                            <h3 style="margin-top:0; color:#333; margin-bottom:10px;">Subscribe for Benny's Hub Updates!</h3>
                            <p style="color:#555; font-size:14px; margin-bottom:15px; margin-top:0; line-height:1.5;">We'll send emails when we release new games, tools, and exclusive updates from NARBE House. We love sharing what we're building and learning with the assistive tech community.</p>
                            <div id="a567a843-7bc0-405f-ba40-df503d479211"></div>
                        </div>
                    </div>
                </div>
            </div>`;

            const div = document.createElement('div');
            div.innerHTML = modalHtml;
            document.body.appendChild(div);

            // Bind events
            document.getElementById('benny-tutorial-close').onclick = this.hide.bind(this);
            document.getElementById('benny-tutorial-overlay').onclick = this.hide.bind(this);

            // Close on Escape
            document.addEventListener('keydown', (e) => {
                const modal = document.getElementById('benny-tutorial-modal');
                if (e.key === 'Escape' && modal.style.display === 'block') {
                    this.hide();
                }
            });

            // Load Email Script once
            this.loadEmailScript();

            // Auto-open if first time
            const hasSeen = localStorage.getItem(config.localStorageKey);
            if (!hasSeen) {
                this.show();
            }
        },


        convertYoutubeUrl: function(url) {
            if (!url) return '';
            // Handle standard watch URLs and short URLs
            let videoId = '';
            if (url.includes('youtu.be/')) {
                videoId = url.split('youtu.be/')[1].split('?')[0];
            } else if (url.includes('youtube.com/watch')) {
                const params = new URLSearchParams(url.split('?')[1]);
                videoId = params.get('v');
            }
            if (videoId) {
                return `https://www.youtube.com/embed/${videoId}`;
            }
            return url;
        },

        loadEmailScript: function() {
            if (document.getElementById('beacons-email-script')) return;
            var s = document.createElement("script");
            var t = Math.floor(new Date().getTime()/120000);
            s.id = 'beacons-email-script';
            s.type = "module";
            s.async = 1;
            s.src = `https://beacons.ai/embeds/emailForm.js?v=${t}&b=narbehouse&f=a567a843-7bc0-405f-ba40-df503d479211`;
            document.body.appendChild(s);
        },

        show: function() {
            const modal = document.getElementById('benny-tutorial-modal');
            const iframe = document.getElementById('benny-tutorial-iframe');
            const placeholder = document.getElementById('benny-tutorial-video-placeholder');

            // No video yet (e.g. a game whose tutorial recording isn't made
            // yet) -- show a plain placeholder instead of an empty iframe,
            // rather than trying to load a src that isn't there.
            if (this.iframeSrc) {
                iframe.src = this.iframeSrc;
                iframe.style.display = '';
                if (placeholder) placeholder.style.display = 'none';
            } else if (placeholder) {
                placeholder.style.display = 'flex';
                iframe.style.display = 'none';
            }

            modal.style.display = 'block';
            document.body.style.overflow = 'hidden';

            // Trap focus roughly - focus close btn
            setTimeout(() => {
                const closeBtn = document.getElementById('benny-tutorial-close');
                if (closeBtn) closeBtn.focus();
            }, 100);

            // Mark as seen immediately when opened
            if (this.config && this.config.localStorageKey) {
                localStorage.setItem(this.config.localStorageKey, 'true');
            }
        },

        hide: function() {
            const modal = document.getElementById('benny-tutorial-modal');
            const iframe = document.getElementById('benny-tutorial-iframe');

            // Stop video by clearing src
            iframe.src = '';

            modal.style.display = 'none';
            document.body.style.overflow = '';
        }
    };
})();
