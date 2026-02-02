/* 
    Simple Chess Engine for Benny's Hub
    Includes: Move Generation, Validation, and Minimax AI
*/

const CHESS_PIECES = {
    w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
    b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
};

const PIECE_VALUES = {
    p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000
};

// Piece Square Tables (Simplified)
const PST = {
    p: [
        [0,  0,  0,  0,  0,  0,  0,  0],
        [50, 50, 50, 50, 50, 50, 50, 50],
        [10, 10, 20, 30, 30, 20, 10, 10],
        [5,  5, 10, 25, 25, 10,  5,  5],
        [0,  0,  0, 20, 20,  0,  0,  0],
        [5, -5,-10,  0,  0,-10, -5,  5],
        [5, 10, 10,-20,-20, 10, 10,  5],
        [0,  0,  0,  0,  0,  0,  0,  0]
    ],
    n: [
        [-50,-40,-30,-30,-30,-30,-40,-50],
        [-40,-20,  0,  0,  0,  0,-20,-40],
        [-30,  0, 10, 15, 15, 10,  0,-30],
        [-30,  5, 15, 20, 20, 15,  5,-30],
        [-30,  0, 15, 20, 20, 15,  0,-30],
        [-30,  5, 10, 15, 15, 10,  5,-30],
        [-40,-20,  0,  5,  5,  0,-20,-40],
        [-50,-40,-30,-30,-30,-30,-40,-50]
    ],
    // ... Others can be approximated or added for strength
};
// Add simple mirroring for black or other pieces if needed. 
// For this simple version, we'll mostly rely on material and center control.

class ChessGame {
    constructor() {
        this.reset();
    }

    reset() {
        // 'w' (White) or 'b' (Black)
        // Pieces: { type: 'p'|'r'|'n'|'b'|'q'|'k', color: 'w'|'b' } or null
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        this.turn = 'w';
        this.castling = { w: {k: true, q: true}, b: {k: true, q: true} };
        this.enPassant = null; // {r, c} target square
        this.halfMoves = 0;
        this.moveHistory = [];
        
        this.setupBoard();
    }

    setupBoard() {
        const setupRow = (row, color, types) => {
            types.forEach((type, col) => {
                this.board[row][col] = { type, color, hasMoved: false };
            });
        };
        
        const backRow = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
        const pawnRow = Array(8).fill('p');
        
        setupRow(0, 'b', backRow);
        setupRow(1, 'b', pawnRow);
        setupRow(6, 'w', pawnRow);
        setupRow(7, 'w', backRow);
    }

    getPiece(r, c) {
        if (!this.isValidPos(r, c)) return null;
        return this.board[r][c];
    }
    
    isValidPos(r, c) {
        return r >= 0 && r < 8 && c >= 0 && c < 8;
    }

    switchTurn() {
        this.turn = this.turn === 'w' ? 'b' : 'w';
    }

    // --- Move Generation ---

    getAllMoves(color) {
        const moves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && piece.color === color) {
                    const pieceMoves = this.getMovesForPiece(r, c, piece);
                    moves.push(...pieceMoves);
                }
            }
        }
        
        // Filter moves that leave king in check
        return moves.filter(m => {
            this.makeMove(m, true); // pseudo execution
            const inCheck = this.isInCheck(color);
            this.undoMove(true);
            return !inCheck;
        });
    }

    getMovesForPiece(r, c, piece) {
        const moves = [];
        const type = piece.type;
        const color = piece.color;
        
        const directions = {
            r: [[0,1], [0,-1], [1,0], [-1,0]],
            b: [[1,1], [1,-1], [-1,1], [-1,-1]],
            n: [[2,1], [2,-1], [-2,1], [-2,-1], [1,2], [1,-2], [-1,2], [-1,-2]],
            q: [[0,1], [0,-1], [1,0], [-1,0], [1,1], [1,-1], [-1,1], [-1,-1]],
            k: [[0,1], [0,-1], [1,0], [-1,0], [1,1], [1,-1], [-1,1], [-1,-1]]
        };

        const addMove = (tr, tc) => {
             moves.push({ from: {r, c}, to: {r: tr, c: tc}, piece: piece, captured: this.board[tr][tc] });
        };

        if (type === 'p') {
            const dir = color === 'w' ? -1 : 1;
            const startRow = color === 'w' ? 6 : 1;
            
            // Forward 1
            if (this.isValidPos(r + dir, c) && !this.board[r + dir][c]) {
                let isPromo = (r + dir === 0 || r + dir === 7);
                if (isPromo) {
                    ['q','r','b','n'].forEach(promo => {
                        moves.push({ from: {r, c}, to: {r: r+dir, c}, piece, promotion: promo });
                    });
                } else {
                    moves.push({ from: {r, c}, to: {r: r+dir, c}, piece, promotion: null });
                }
                
                // Forward 2
                if (r === startRow && !this.board[r + dir * 2][c]) {
                    moves.push({ from: {r, c}, to: {r: r+dir*2, c}, piece, isDoublePawn: true });
                }
            }
            
            // Capture
            [[dir, 1], [dir, -1]].forEach(d => {
                const tr = r + d[0], tc = c + d[1];
                if (this.isValidPos(tr, tc)) {
                    const target = this.board[tr][tc];
                    if (target && target.color !== color) {
                         let isPromo = (tr === 0 || tr === 7);
                         if (isPromo) {
                            ['q','r','b','n'].forEach(promo => {
                                moves.push({ from: {r, c}, to: {r: tr, c: tc}, piece, captured: target, promotion: promo });
                            });
                         } else {
                            moves.push({ from: {r, c}, to: {r: tr, c: tc}, piece, captured: target, promotion: null });
                         }
                    }
                    // En Passant
                    if (this.enPassant && this.enPassant.r === tr && this.enPassant.c === tc) {
                        moves.push({ from: {r, c}, to: {r: tr, c: tc}, piece, isEnPassant: true, captured: {color: color==='w'?'b':'w', type:'p'} });
                    }
                }
            });
        }
        else if (type === 'n' || type === 'k') {
            directions[type].forEach(d => {
                const tr = r + d[0], tc = c + d[1];
                if (this.isValidPos(tr, tc)) {
                    const target = this.board[tr][tc];
                    if (!target || target.color !== color) {
                        addMove(tr, tc);
                    }
                }
            });
        }
        else { // Sliding pieces (r, b, q)
            directions[type].forEach(d => {
                let tr = r + d[0], tc = c + d[1];
                while(this.isValidPos(tr, tc)) {
                    const target = this.board[tr][tc];
                    if (!target) {
                        addMove(tr, tc);
                    } else {
                        if (target.color !== color) addMove(tr, tc);
                        break; // Blocked
                    }
                    tr += d[0];
                    tc += d[1];
                }
            });
        }
        
        // Castling
        if (type === 'k' && !piece.hasMoved) {
            // Kingside
            if (this.canCastle(color, 'k')) {
                moves.push({ from: {r, c}, to: {r, c: 6}, piece, isCastle: 'k' });
            }
            // Queenside
            if (this.canCastle(color, 'q')) {
                moves.push({ from: {r, c}, to: {r, c: 2}, piece, isCastle: 'q' });
            }
        }

        return moves;
    }

    canCastle(color, side) {
        // Simplified check: Rooks must not have moved, path clear, not in check
        if (!this.castling[color][side]) return false;
        
        // Cannot castle if IN check provided by isInCheck check outside or check here
        if (this.isInCheck(color)) return false;

        const row = color === 'w' ? 7 : 0;
        const kingCol = 4;
        const rookCol = side === 'k' ? 7 : 0;
        
        // Check rook existence (in case captured but flag not updated yet/weird state)
        const rook = this.board[row][rookCol];
        if (!rook || rook.type !== 'r' || rook.hasMoved) return false;
        
        const opp = color === 'w' ? 'b' : 'w';

        // Check path
        const start = side === 'k' ? 5 : 1;
        const end = side === 'k' ? 6 : 3;
        
        // Squares between King and Rook must be empty
        // King passes through King+1, King+2 (Kingside) or King-1, King-2 (Queenside)
        // Validating attacks: King cannot pass through check.
        // Destination: C or G file
        // For Kingside (col 4 -> 6): King passes through 5.
        // For Queenside (col 4 -> 2): King passes through 3.
        
        // Check Empty: 
        // K-side: 5, 6
        // Q-side: 1, 2, 3 (Rook is at 0, King at 4)
        
        if (side === 'k') {
            if (this.board[row][5] || this.board[row][6]) return false;
            if (this.isSquareAttacked(row, 5, opp) || this.isSquareAttacked(row, 6, opp)) return false;
        } else {
            if (this.board[row][1] || this.board[row][2] || this.board[row][3]) return false;
            // King moves 4->2. Passes through 3. Destination is 2. Both must be safe.
            if (this.isSquareAttacked(row, 3, opp) || this.isSquareAttacked(row, 2, opp)) return false;
        }
        
        return true;
    }

    // --- Execution ---

    makeMove(move, pseudo = false) {
        
        const { from, to, piece } = move;

        // Save state for undo
        this.moveHistory.push({
            move: move,
            boardState: pseudo ? null : this.cloneBoard(this.board), // Deep copy expensive? Just copy criticals
            enPassant: this.enPassant,
            castling: JSON.parse(JSON.stringify(this.castling)),
            turn: this.turn,
            pieceHasMoved: piece.hasMoved, // Save hasMoved state
            rookHasMoved: move.isCastle ? (move.isCastle === 'k' ? (this.board[from.r][7] ? this.board[from.r][7].hasMoved : false) : (this.board[from.r][0] ? this.board[from.r][0].hasMoved : false)) : null
        });

        // Execute Update
        this.board[to.r][to.c] = piece;
        this.board[from.r][from.c] = null;
        piece.hasMoved = true; // Mark moved
        
        // En Passant Capture Logic
        if (move.isEnPassant) {
            const capRow = from.r; // The pawn being captured is on the same row as 'from'
            const capCol = to.c;
            this.board[capRow][capCol] = null;
        }

        // Set En Passant Target
        if (move.isDoublePawn) {
            this.enPassant = { r: (from.r + to.r) / 2, c: from.c };
        } else {
            this.enPassant = null;
        }
        
        // Castling Move Rook
        if (move.isCastle) {
            const row = from.r;
            if (move.isCastle === 'k') { // King side
                const rook = this.board[row][7];
                this.board[row][5] = rook;
                this.board[row][7] = null;
                if(rook) rook.hasMoved = true;
            } else { // Queen side
                const rook = this.board[row][0];
                this.board[row][3] = rook;
                this.board[row][0] = null;
                if(rook) rook.hasMoved = true;
            }
        }
        
        // Promotion
        if (move.promotion) {
            piece.type = move.promotion;
        }
        
        // Update Castling Rights if King or Rook moves
        if (piece.type === 'k') {
            this.castling[this.turn].k = false;
            this.castling[this.turn].q = false;
        }
        if (piece.type === 'r') {
             if (from.c === 0) this.castling[this.turn].q = false;
             if (from.c === 7) this.castling[this.turn].k = false;
        }

        // If a Rook is captured, update opponent's castling rights
        if (move.captured && move.captured.type === 'r') {
            const opp = this.turn === 'w' ? 'b' : 'w'; // Opponent is the one who LOST the piece (current turn is playing move) Wait.
            // this.turn is actually swapped at end of makeMove.
            // Here we are BEFORE switchTurn().
            // So if White (this.turn) moves and captures Black's rook using move.captured.
            // We need to update castling for BLACK (the non-moving side).
            
            const r = to.r;
            const c = to.c;
            const oppColor = this.turn === 'w' ? 'b' : 'w';

            if (oppColor === 'b') {
                if (r === 0 && c === 0) this.castling.b.q = false;
                if (r === 0 && c === 7) this.castling.b.k = false;
            } else {
                if (r === 7 && c === 0) this.castling.w.q = false;
                if (r === 7 && c === 7) this.castling.w.k = false;
            }
        }

        this.switchTurn();
    }

    undoMove(pseudo = false) {
        const last = this.moveHistory.pop();
        if (!last) return;
        
        const m = last.move;
        const piece = this.board[m.to.r][m.to.c];
        
        // Restore Piece Properties
        if (piece) piece.hasMoved = last.pieceHasMoved;

        // Restore Piece Position
        this.board[m.from.r][m.from.c] = piece;
        this.board[m.to.r][m.to.c] = m.captured && !m.isEnPassant ? m.captured : null;
        
        // Restore En Passant Capture
        if (m.isEnPassant) {
            // Captured pawn was at [from.r][to.c]
            this.board[m.from.r][m.to.c] = m.captured; 
        }
        
        // Restore Castling Rook
        if (m.isCastle) {
            const row = m.from.r;
            if (m.isCastle === 'k') {
                const rook = this.board[row][5];
                this.board[row][7] = rook;
                this.board[row][5] = null;
                if(rook) rook.hasMoved = last.rookHasMoved; 
            } else {
                const rook = this.board[row][3];
                this.board[row][0] = rook;
                this.board[row][3] = null;
                 if(rook) rook.hasMoved = last.rookHasMoved;
            }
        }
        
        // Restore Promo
        if (m.promotion) {
            piece.type = 'p';
        }
        
        // Restore Meta
        this.enPassant = last.enPassant;
        this.castling = last.castling;
        this.turn = last.turn;
        
        // If not pseudo, we might have a full state, but since we manually restored, we are good.
        // The manual restore is faster and keeps object references better for the UI unless UI rebuilds from scratch.
    }

    cloneBoard(board) {
        return board.map(row => row.map(p => p ? {...p} : null));
    }

    isInCheck(color) {
        // Find King
        let kr, kc;
        for(let r=0; r<8; r++) {
            for(let c=0; c<8; c++) {
                const p = this.board[r][c];
                if (p && p.type === 'k' && p.color === color) {
                    kr = r; kc = c; break;
                }
            }
        }
        if (kr === undefined) return true; // lost king?

        // Check if attacked by Opponent
        const opp = color === 'w' ? 'b' : 'w';
        
        // Sliders (Queen, Rook, Bishop)
        const dirs = [
            [0,1], [0,-1], [1,0], [-1,0], // R/Q
            [1,1], [1,-1], [-1,1], [-1,-1] // B/Q
        ];
        
        for (let i=0; i<dirs.length; i++) {
             let tr = kr + dirs[i][0], tc = kc + dirs[i][1];
             while(this.isValidPos(tr, tc)) {
                 const p = this.board[tr][tc];
                 if (p) {
                     if (p.color === opp) {
                         const isOrtho = i < 4;
                         const type = p.type;
                         if (type === 'q' || (isOrtho && type === 'r') || (!isOrtho && type === 'b')) return true;
                     }
                     break;
                 }
                 tr += dirs[i][0];
                 tc += dirs[i][1];
             }
        }
        
        // Knights
        const kn = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
        for(let m of kn) {
            const tr = kr+m[0], tc = kc+m[1];
            if (this.isValidPos(tr, tc)) {
                const p = this.board[tr][tc];
                if (p && p.color === opp && p.type === 'n') return true;
            }
        }
        
        // Pawns
        const pDir = color === 'w' ? -1 : 1; // incoming pawns come from opp direction? No, White King (row 7) attacked by Black Pawn (row 6) which moves +1. 
        // Opponent pawn direction relative to opponent.
        // Black paws move +1. White King at r. Black pawn at r-1. Black pawn moves +1 to hit King.
        // So we look in reverse of Pown Move direction?
        // Look for pawns at [r - oppDir]
        const oppDir = opp === 'w' ? -1 : 1;
        [[ -oppDir, 1], [-oppDir, -1]].forEach(d => {
             const tr = kr + d[0], tc = kc + d[1];
             if (this.isValidPos(tr, tc)) {
                 const p = this.board[tr][tc];
                 if (p && p.color === opp && p.type === 'p') return true;
             }
        });

        // King proximity (impossible in valid game but good for check)
        return false;
    }

    isSquareAttacked(r, c, attackerColor) {
        // Based on isInCheck logic but for specific square
        
        // Check if attacked by Opponent
        const opp = attackerColor;
        
        // Sliders (Queen, Rook, Bishop)
        const dirs = [
            [0,1], [0,-1], [1,0], [-1,0], // R/Q
            [1,1], [1,-1], [-1,1], [-1,-1] // B/Q
        ];
        
        for (let i=0; i<dirs.length; i++) {
             let tr = r + dirs[i][0], tc = c + dirs[i][1];
             while(this.isValidPos(tr, tc)) {
                 const p = this.board[tr][tc];
                 if (p) {
                     if (p.color === opp) {
                         const isOrtho = i < 4;
                         const type = p.type;
                         if (type === 'q' || (isOrtho && type === 'r') || (!isOrtho && type === 'b')) return true;
                     }
                     break; 
                 }
                 tr += dirs[i][0];
                 tc += dirs[i][1];
             }
        }
        
        // Knights
        const kn = [[2,1],[2,-1],[-2,1],[-2,-1],[1,2],[1,-2],[-1,2],[-1,-2]];
        for(let m of kn) {
            const tr = r+m[0], tc = c+m[1];
            if (this.isValidPos(tr, tc)) {
                const p = this.board[tr][tc];
                if (p && p.color === opp && p.type === 'n') return true;
            }
        }
        
        // Pawns
        // Opponent pawn direction relative to opponent.
        // If checking if White Square is attacked by Black Pawn (which moves Down/+1)
        // Then Black pawn must be at [r-1].
        const pDir = opp === 'w' ? -1 : 1; 
        // Attack comes from [r - pDir]
        // Example: White King at 6,4. Black Pawn at 5,3 (moves to 6,4). 
        // pDir (Black) is 1. We check 6-1 = 5. Correct.
        [[ -pDir, 1], [-pDir, -1]].forEach(d => {
             const tr = r + d[0], tc = c + d[1];
             if (this.isValidPos(tr, tc)) {
                 const p = this.board[tr][tc];
                 if (p && p.color === opp && p.type === 'p') return true;
             }
        });
        
        // King
        const kDir = [[0,1], [0,-1], [1,0], [-1,0], [1,1], [1,-1], [-1,1], [-1,-1]];
        for(let d of kDir) {
            const tr = r+d[0], tc = c+d[1];
            if (this.isValidPos(tr, tc)) {
                const p = this.board[tr][tc];
                if (p && p.color === opp && p.type === 'k') return true;
            }
        }

        return false;
    }

    // --- AI ---
    
    evaluate() {
        let score = 0;
        for(let r=0; r<8; r++) {
            for(let c=0; c<8; c++) {
                const p = this.board[r][c];
                if (p) {
                    const val = PIECE_VALUES[p.type];
                    // Position Bonus
                    let pstVal = 0;
                    if (PST[p.type]) {
                        pstVal = p.color === 'w' ? PST[p.type][r][c] : PST[p.type][7-r][c];
                    }
                    
                    if (p.color === 'w') score += val + pstVal;
                    else score -= (val + pstVal);
                }
            }
        }
        return score;
    }

    minimax(depth, alpha, beta, isMaximizing) {
        if (depth === 0) return this.evaluate();

        const color = isMaximizing ? 'w' : 'b';
        const moves = this.getAllMoves(color);
        
        if (moves.length === 0) {
            if (this.isInCheck(color)) return isMaximizing ? -99999 : 99999; // Date Checkmate
            return 0; // Stalemate
        }

        if (isMaximizing) {
            let maxEval = -Infinity;
            for (const move of moves) {
                this.makeMove(move, true);
                const ev = this.minimax(depth - 1, alpha, beta, false);
                this.undoMove(true);
                maxEval = Math.max(maxEval, ev);
                alpha = Math.max(alpha, ev);
                if (beta <= alpha) break;
            }
            return maxEval;
        } else {
            let minEval = Infinity;
            for (const move of moves) {
                this.makeMove(move, true);
                const ev = this.minimax(depth - 1, alpha, beta, true);
                this.undoMove(true);
                minEval = Math.min(minEval, ev);
                beta = Math.min(beta, ev);
                if (beta <= alpha) break;
            }
            return minEval;
        }
    }

    getBestMove(color, depth = 3) {
        const moves = this.getAllMoves(color);
        if (moves.length === 0) return null;
        
        let bestMove = null;
        let bestValue = color === 'w' ? -Infinity : Infinity;

        // Shuffle moves to add randomness to equal moves
        moves.sort(() => Math.random() - 0.5);

        for (const move of moves) {
            this.makeMove(move, true);
            const boardValue = this.minimax(depth - 1, -Infinity, Infinity, color !== 'w');
            this.undoMove(true);

            if (color === 'w') {
                if (boardValue > bestValue) {
                    bestValue = boardValue;
                    bestMove = move;
                }
            } else {
                if (boardValue < bestValue) {
                    bestValue = boardValue;
                    bestMove = move;
                }
            }
        }
        return bestMove;
    }

    // --- Validation ---

    getValidMoves(r, c) {
        const piece = this.getPiece(r, c);
        if (!piece) return [];
        const moves = this.getMovesForPiece(r, c, piece);
        
        // Filter out moves that leave own king in check
        return moves.filter(m => {
            this.makeMove(m, true);
            const inCheck = this.isInCheck(piece.color);
            this.undoMove(true);
            return !inCheck;
        });
    }
}
