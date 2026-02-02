import os
from flask import Flask, send_from_directory

app = Flask(__name__, static_folder='.', static_url_path='')
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory(BASE_DIR, path)

if __name__ == '__main__':
    print("Starting Benny's TicTacToe Server...")
    # Port 8000 to be different from others if needed, or 5000 is default
    app.run(host='0.0.0.0', port=8000, debug=True)
