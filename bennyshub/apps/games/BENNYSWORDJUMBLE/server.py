import os
from flask import Flask, send_from_directory

app = Flask(__name__, static_folder='.')

@app.route('/')
def index():
    return app.send_static_file('index.html')

if __name__ == '__main__':
    print("Starting Word Jumble Server...")
    # Bind to 0.0.0.0 to be accessible from other devices if needed, port 8000
    app.run(host='0.0.0.0', port=8000, debug=True)
