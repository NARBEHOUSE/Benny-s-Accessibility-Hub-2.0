"""
Editor Server - Serves editors in Chrome browser for proper mouse/keyboard support.

This server is used to launch editors (Trivia Master, Streaming, Mini Golf, etc.)
in Chrome instead of Electron's iframe, which fixes scanning and input issues.

Also provides API proxy functionality to bypass CORS restrictions when making
external API calls (TMDB, OpenSymbols, FreeSound, etc.) from Electron.

Usage:
    python editor_server.py --editor streaming
    python editor_server.py --editor triviamaster
    python editor_server.py --editor golf
    python editor_server.py --editor matchymatch
    python editor_server.py --editor wordjumble
    python editor_server.py --editor phraseboard
"""

import http.server
import socketserver
import json
import os
import sys
import threading
import webbrowser
import argparse
import subprocess
import time
import urllib.request
import urllib.error
import ssl
from urllib.parse import urlparse, parse_qs, unquote, urlencode

# Base directory is the bennyshub folder
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Editor configurations: editor_name -> (relative_path, html_file)
EDITORS = {
    'streaming': ('apps/tools/streaming', 'editor.html'),
    'triviamaster': ('apps/games/TRIVIAMASTER/trivia editor', 'index.html'),
    'trivia': ('apps/games/TRIVIAMASTER/trivia editor', 'index.html'),  # alias
    'golf': ('apps/games/BENNYSMINIGOLF/COURSE CREATOR', 'index.html'),
    'minigolf': ('apps/games/BENNYSMINIGOLF/COURSE CREATOR', 'index.html'),  # alias
    'matchymatch': ('apps/games/BENNYSMATCHYMATCH', 'editor.html'),
    'matchy': ('apps/games/BENNYSMATCHYMATCH', 'editor.html'),  # alias
    'wordjumble': ('apps/games/BENNYSWORDJUMBLE', 'editor.html'),
    'jumble': ('apps/games/BENNYSWORDJUMBLE', 'editor.html'),  # alias
    'phraseboard': ('apps/tools/phraseboard', 'phrase-builder.html'),
    'phrase': ('apps/tools/phraseboard', 'phrase-builder.html'),  # alias
    'peggle': ('apps/games/BENNYSPEGGLE', 'editor.html'),
}

# Chrome path
CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# API Proxy allowed hosts - these external APIs can be proxied
ALLOWED_API_HOSTS = {
    'api.themoviedb.org': 'tmdb',
    'www.opensymbols.org': 'opensymbols', 
    'freesound.org': 'freesound',
    'api.freesound.org': 'freesound',
    'aged-thunder-a674.narbehousellc.workers.dev': 'freesound-proxy',
}

# Create SSL context that doesn't verify certificates (for proxy requests)
ssl_context = ssl.create_default_context()
ssl_context.check_hostname = False
ssl_context.verify_mode = ssl.CERT_NONE

class EditorHandler(http.server.SimpleHTTPRequestHandler):
    """Handler that serves files from bennyshub directory and handles API requests."""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)
    
    def log_message(self, format, *args):
        """Print logs to console."""
        sys.stderr.write(f"[EditorServer] {format % args}\n")
    
    def do_GET(self):
        """Handle GET requests including API endpoints."""
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        
        # API Proxy: /api/proxy/<service>/<path>
        if path.startswith('/api/proxy/'):
            self.handle_api_proxy('GET')
            return
        
        # API: List available editors
        if path == '/api/editors':
            self.send_json({
                'editors': list(EDITORS.keys()),
                'detail': {name: {'path': info[0], 'file': info[1]} 
                          for name, info in EDITORS.items()}
            })
            return
        
        # API: Trivia Master games list
        if path == '/api/games':
            self.handle_trivia_games_api()
            return
        
        # Serve static files from bennyshub
        return super().do_GET()
    
    def do_POST(self):
        """Handle POST requests for saving data."""
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        
        # API Proxy: /api/proxy/<service>/<path>
        if path.startswith('/api/proxy/'):
            self.handle_api_proxy('POST')
            return
        
        # Handle Streaming editor save
        if path == '/api/save-data':
            self.handle_save_streaming_data()
            return
        
        # Handle Streaming genres save
        if path == '/api/save-genres':
            self.handle_save_streaming_genres()
            return
        
        # Handle Trivia save
        if path.startswith('/trivia_games/') and path.endswith('.json'):
            self.handle_save_trivia_game(path)
            return
        
        # Handle golf course save
        if path.startswith('/courses/') and path.endswith('.json'):
            self.handle_save_golf_course(path)
            return
        
        # Handle matchymatch pack save
        if path.startswith('/packs/') and path.endswith('.json'):
            self.handle_save_matchymatch_pack(path)
            return
        
        # Handle word jumble save
        if path == '/words.json' or path.startswith('/words'):
            self.handle_save_wordjumble()
            return
        
        # Handle phraseboard save
        if path.startswith('/boards/') and path.endswith('.json'):
            self.handle_save_phraseboard(path)
            return
        
        # Default: Method not allowed
        self.send_error(405, 'Method Not Allowed')
    
    def do_PUT(self):
        """Handle PUT requests (alias for POST for some editors)."""
        return self.do_POST()
    
    def send_json(self, data, status=200):
        """Send JSON response."""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def handle_trivia_games_api(self):
        """List trivia games for the editor."""
        games_dir = os.path.join(BASE_DIR, 'apps', 'games', 'TRIVIAMASTER', 'trivia_games')
        games = []
        
        if os.path.exists(games_dir):
            for filename in os.listdir(games_dir):
                if filename.endswith('.json'):
                    name = os.path.splitext(filename)[0].replace('_', ' ')
                    game_info = {
                        'filename': filename,
                        'name': name,
                        'path': f'trivia_games/{filename}',
                        'image': None
                    }
                    
                    try:
                        with open(os.path.join(games_dir, filename), 'r', encoding='utf-8') as f:
                            data = json.load(f)
                            if 'meta' in data:
                                if 'image' in data['meta']:
                                    game_info['image'] = data['meta']['image']
                                if 'title' in data['meta']:
                                    game_info['name'] = data['meta']['title']
                    except:
                        pass
                    
                    games.append(game_info)
        
        self.send_json(games)
    
    def handle_save_streaming_data(self):
        """Save streaming data.json."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            
            data_path = os.path.join(BASE_DIR, 'apps', 'tools', 'streaming', 'data.json')
            with open(data_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            
            self.send_json({'success': True})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
    
    def handle_save_streaming_genres(self):
        """Save streaming genres.json."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            
            genres_path = os.path.join(BASE_DIR, 'apps', 'tools', 'streaming', 'genres.json')
            with open(genres_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            
            self.send_json({'success': True})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
    
    def handle_save_trivia_game(self, path):
        """Save a trivia game JSON file."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            
            # Extract filename from path
            filename = os.path.basename(path)
            games_dir = os.path.join(BASE_DIR, 'apps', 'games', 'TRIVIAMASTER', 'trivia_games')
            os.makedirs(games_dir, exist_ok=True)
            
            file_path = os.path.join(games_dir, filename)
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            
            self.send_json({'success': True})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
    
    def handle_save_golf_course(self, path):
        """Save a golf course JSON file."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            
            filename = os.path.basename(path)
            courses_dir = os.path.join(BASE_DIR, 'apps', 'games', 'BENNYSMINIGOLF', 'courses')
            os.makedirs(courses_dir, exist_ok=True)
            
            file_path = os.path.join(courses_dir, filename)
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            
            self.send_json({'success': True})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
    
    def handle_save_matchymatch_pack(self, path):
        """Save a matchy match pack JSON file."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            
            filename = os.path.basename(path)
            packs_dir = os.path.join(BASE_DIR, 'apps', 'games', 'BENNYSMATCHYMATCH', 'packs')
            os.makedirs(packs_dir, exist_ok=True)
            
            file_path = os.path.join(packs_dir, filename)
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            
            self.send_json({'success': True})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
    
    def handle_save_wordjumble(self):
        """Save word jumble words.json."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            
            words_path = os.path.join(BASE_DIR, 'apps', 'games', 'BENNYSWORDJUMBLE', 'words.json')
            with open(words_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            
            self.send_json({'success': True})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
    
    def handle_save_phraseboard(self, path):
        """Save a phrase board JSON file."""
        try:
            length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(length)
            data = json.loads(body)
            
            filename = os.path.basename(path)
            boards_dir = os.path.join(BASE_DIR, 'apps', 'tools', 'phraseboard', 'boards')
            os.makedirs(boards_dir, exist_ok=True)
            
            file_path = os.path.join(boards_dir, filename)
            with open(file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2)
            
            self.send_json({'success': True})
        except Exception as e:
            self.send_json({'error': str(e)}, 500)
    
    def end_headers(self):
        """Add CORS headers."""
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()
    
    def do_OPTIONS(self):
        """Handle CORS preflight."""
        self.send_response(200)
        self.end_headers()
    
    def handle_api_proxy(self, method='GET'):
        """
        Proxy external API requests to bypass CORS restrictions.
        
        URL format: /api/proxy/<service>/<api_path>?<query_params>
        
        Supported services:
        - tmdb: api.themoviedb.org/3/...
        - opensymbols: www.opensymbols.org/api/v1/...
        - freesound: api.freesound.org/...
        - freesound-proxy: aged-thunder-a674.narbehousellc.workers.dev/...
        """
        try:
            parsed = urlparse(self.path)
            path_parts = unquote(parsed.path).split('/')
            
            # Expected format: ['', 'api', 'proxy', '<service>', '<rest_of_path>...']
            if len(path_parts) < 5:
                self.send_json({'error': 'Invalid proxy URL format. Use /api/proxy/<service>/<path>'}, 400)
                return
            
            service = path_parts[3].lower()
            api_path = '/'.join(path_parts[4:])
            query_string = parsed.query
            
            # Build the target URL based on service
            if service == 'tmdb':
                target_host = 'https://api.themoviedb.org'
                target_url = f"{target_host}/{api_path}"
            elif service == 'opensymbols':
                target_host = 'https://www.opensymbols.org'
                target_url = f"{target_host}/api/v1/{api_path}"
            elif service == 'freesound':
                target_host = 'https://api.freesound.org'
                target_url = f"{target_host}/{api_path}"
            elif service == 'freesound-proxy':
                target_host = 'https://aged-thunder-a674.narbehousellc.workers.dev'
                target_url = f"{target_host}/{api_path}"
            else:
                self.send_json({'error': f'Unknown service: {service}. Supported: tmdb, opensymbols, freesound, freesound-proxy'}, 400)
                return
            
            # Add query string
            if query_string:
                target_url = f"{target_url}?{query_string}"
            
            self.log_message(f"Proxying {method} -> {target_url}")
            
            # Make the request to the external API
            req = urllib.request.Request(target_url, method=method)
            req.add_header('User-Agent', 'BennysHub/1.0')
            req.add_header('Accept', 'application/json')
            
            # For POST requests, forward the body
            body_data = None
            if method == 'POST':
                content_length = int(self.headers.get('Content-Length', 0))
                if content_length > 0:
                    body_data = self.rfile.read(content_length)
                    req.add_header('Content-Type', self.headers.get('Content-Type', 'application/json'))
            
            try:
                with urllib.request.urlopen(req, data=body_data, timeout=30, context=ssl_context) as response:
                    response_data = response.read()
                    content_type = response.headers.get('Content-Type', 'application/json')
                    
                    self.send_response(response.status)
                    self.send_header('Content-Type', content_type)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.end_headers()
                    self.wfile.write(response_data)
                    
            except urllib.error.HTTPError as e:
                error_body = e.read().decode('utf-8', errors='replace')
                self.log_message(f"Proxy HTTP Error {e.code}: {error_body[:200]}")
                self.send_json({'error': f'API returned {e.code}', 'details': error_body[:500]}, e.code)
                
            except urllib.error.URLError as e:
                self.log_message(f"Proxy URL Error: {e.reason}")
                self.send_json({'error': f'Failed to connect to API: {e.reason}'}, 502)
                
        except Exception as e:
            self.log_message(f"Proxy Error: {str(e)}")
            self.send_json({'error': str(e)}, 500)


class ThreadingServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    """Threading HTTP server."""
    allow_reuse_address = True


def find_free_port(start=8800, end=8900):
    """Find a free port in the given range."""
    import socket
    for port in range(start, end):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    return None


def open_chrome(url, fullscreen=False):
    """Open URL in Chrome browser."""
    chrome_path = CHROME_PATH
    if not os.path.exists(chrome_path):
        chrome_path = r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
    if not os.path.exists(chrome_path):
        # Fall back to system default
        webbrowser.open(url)
        return
    
    args = [chrome_path, "--new-window"]
    if fullscreen:
        args.append("--start-fullscreen")
    args.append(url)
    
    subprocess.Popen(args)


def start_server(editor=None, port=None, open_browser=True, fullscreen=False):
    """
    Start the editor server and optionally open the editor in Chrome.
    
    Args:
        editor: Name of editor to open (streaming, triviamaster, golf, etc.)
        port: Specific port to use (None = auto-find free port)
        open_browser: Whether to open Chrome with the editor
        fullscreen: Whether to open Chrome in fullscreen
    
    Returns:
        (server, port, url) tuple
    """
    if port is None:
        port = find_free_port()
    
    if port is None:
        print("[EditorServer] ERROR: Could not find a free port")
        return None, None, None
    
    try:
        server = ThreadingServer(('127.0.0.1', port), EditorHandler)
    except OSError as e:
        print(f"[EditorServer] ERROR: Could not start server on port {port}: {e}")
        return None, None, None
    
    # Determine editor URL
    if editor and editor.lower() in EDITORS:
        editor_path, editor_file = EDITORS[editor.lower()]
        url = f"http://127.0.0.1:{port}/{editor_path}/{editor_file}"
    else:
        # Default to base URL if no editor specified
        url = f"http://127.0.0.1:{port}/"
    
    print(f"[EditorServer] Starting server at http://127.0.0.1:{port}")
    print(f"[EditorServer] Serving from: {BASE_DIR}")
    
    if editor:
        print(f"[EditorServer] Editor: {editor} -> {url}")
    
    # Start server in background thread
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    
    # Open in Chrome if requested
    if open_browser:
        time.sleep(0.5)  # Give server a moment to start
        print(f"[EditorServer] Opening Chrome: {url}")
        open_chrome(url, fullscreen)
    
    return server, port, url


def main():
    """Main entry point when run as script."""
    parser = argparse.ArgumentParser(description='Editor Server - Launch editors in Chrome')
    parser.add_argument('--editor', '-e', 
                       choices=list(EDITORS.keys()),
                       help='Editor to open')
    parser.add_argument('--port', '-p', type=int,
                       help='Specific port to use')
    parser.add_argument('--no-browser', action='store_true',
                       help='Do not open browser')
    parser.add_argument('--fullscreen', '-f', action='store_true',
                       help='Open Chrome in fullscreen mode')
    parser.add_argument('--list', '-l', action='store_true',
                       help='List available editors')
    
    args = parser.parse_args()
    
    if args.list:
        print("Available editors:")
        for name, (path, file) in EDITORS.items():
            print(f"  {name:15} -> {path}/{file}")
        return
    
    server, port, url = start_server(
        editor=args.editor,
        port=args.port,
        open_browser=not args.no_browser,
        fullscreen=args.fullscreen
    )
    
    if server:
        print(f"\n[EditorServer] Server running at http://127.0.0.1:{port}")
        print("[EditorServer] Press Ctrl+C to stop\n")
        try:
            # Keep main thread alive
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            print("\n[EditorServer] Shutting down...")
            server.shutdown()


if __name__ == '__main__':
    main()
