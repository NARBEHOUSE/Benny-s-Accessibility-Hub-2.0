
const FRAME_COUNT = 10;

const FRAME_STATE_NONE = 0;
const FRAME_STATE_STRIKE = 1;
const FRAME_STATE_SPARE = 2;
const FRAME_STATE_CLOSED = 3;

class Scores {
	constructor() {
		this.frameStates = new Array(FRAME_COUNT);
		this.throwResults = new Array(FRAME_COUNT);
		this.throwResultChars = new Array(FRAME_COUNT);
		this.frameResults = new Array(FRAME_COUNT);
		this.beatenPins = new Array();
		for (var i = 0; i < FRAME_COUNT; i++) {
			this.frameStates[i] = FRAME_STATE_NONE;
			this.throwResults[i] = [ 0, 0, 0 ];
			this.throwResultChars[i] = [ " ", " ", " " ];
			this.frameResults[i] = 0;
		}
		this.score = 0;
		this.totalScore = 0;
		this.frameNumber = 0;
		this.throwNumber = 0;
		this.gameOver = false;
		this.precomputeScore = true;
	}

	getResultString() {
		var resultString = "";
		for (var i = 0; i < FRAME_COUNT; i++) {
			for (var j = 0; j < 3; j++) {
				resultString += this.throwResultChars[i][j];
			}
		}
		return resultString;
	}

	addThrowResult(result) {
		if (this.gameOver) {
			throw new Error("Game over");
		}
		if ((result < 0) || (result > 10)) {
			throw new Error("Invalid throw result: " + result);
		}

		this.throwResults[this.frameNumber][this.throwNumber] = result;

		if (this.precomputeScore) {
			this.beatenPins.push(result);
			this.totalScore = this.calculateTotalScore();
		}

		var prevState = (this.frameNumber > 0)
				? this.frameStates[this.frameNumber - 1]
				: FRAME_STATE_CLOSED;
		var prevPrevState = (this.frameNumber > 1)
				? this.frameStates[this.frameNumber - 2]
				: FRAME_STATE_CLOSED;

		if (this.frameNumber < FRAME_COUNT - 1) {
			if (this.throwNumber == 0) {
				// First frame throw
				if (prevState == FRAME_STATE_SPARE) {
					// Spare in previous frame
					this.addScore(this.frameNumber - 1, 10 + result);
				}
				if (result == 10) {
					// Strike
					if ((prevState == FRAME_STATE_STRIKE)
							&& (prevPrevState == FRAME_STATE_STRIKE)) {
						// Triple strike
						this.addScore(this.frameNumber - 2, 30);
					}
					this.setThrowResult("X");
					this.closeFrame(FRAME_STATE_STRIKE);
				} else {
					// Frame open
					if ((prevState == FRAME_STATE_STRIKE)
							&& (prevPrevState == FRAME_STATE_STRIKE)) {
						// Double strike in previous frames
						this.addScore(this.frameNumber - 2, 20 + result);
					}
					this.setThrowResult("" + result);
					this.throwNumber++;
				}
			} else {
				// Last frame throw
				if (prevState == FRAME_STATE_STRIKE) {
					// Strike in previous frame
					this.addScore(this.frameNumber - 1, 10 + this.getFrameResult());
				}
				if (this.getFrameResult() == 10) {
					// Spare
					this.setThrowResult("/");
					this.closeFrame(FRAME_STATE_SPARE);
				} else {
					// Frame closed
					if (result == 0) {
						this.setThrowResult("-");
					} else {
						this.setThrowResult("" + result);
					}
					this.addScore(this.frameNumber, this.getFrameResult());
					this.closeFrame(FRAME_STATE_CLOSED);
				}
			}
		} else {
			// Last frame
			if (this.throwNumber == 0) {
				// First throw in last frame
				if ((prevState == FRAME_STATE_STRIKE)
						&& (prevPrevState == FRAME_STATE_STRIKE)) {
					// Double strike in previous frames
					if (result == 10) {
						// Triple strike
						this.addScore(this.frameNumber - 2, 30);
					} else {
						// Double strike
						this.addScore(this.frameNumber - 2, 20 + result);
					}
				} else if (prevState == FRAME_STATE_SPARE) {
					// Spare in previous frame
					this.addScore(this.frameNumber - 1, 10 + result);
				}
				if (result == 10) {
					this.setThrowResult("X");
				} else {
					this.setThrowResult("" + result);
				}
				this.throwNumber++;
			} else if (this.throwNumber == 1) {
				// Second throw in last frame
				if (prevState == FRAME_STATE_STRIKE) {
					// Strike in previous frame
					if (this.getFrameResult() == 20) {
						// Triple strike
						this.addScore(this.frameNumber - 1, 30);
					} else {
						this.addScore(this.frameNumber - 1, 10 + this.getFrameResult());
					}
				}
				if (result == 10) {
					this.setThrowResult("X");
				} else if (this.getResult(0) == 10) {
					this.setThrowResult("" + result);
				} else {
					if (this.getFrameResult() == 10) {
						this.setThrowResult("/");
					} else {
						if (result == 0) {
							this.setThrowResult("-");
						} else {
							this.setThrowResult("" + result);
						}
					}
				}
				if (this.getFrameResult() >= 10) {
					this.throwNumber++;
				} else {
					this.addScore(this.frameNumber, this.getFrameResult());
					this.closeFrame(FRAME_STATE_CLOSED);
				}
			} else {
				// Last throw in last frame
				this.addScore(this.frameNumber, this.getLastFrameResult());
				if (result == 10) {
					this.setThrowResult("X");
				} else {
					if (result == 0) {
						this.setThrowResult("-");
					} else {
						this.setThrowResult("" + result);
					}
				}
				this.closeFrame(FRAME_STATE_CLOSED);
			}
		}
	}

	calculateTotalScore() {
		var scores = new Scores();
		scores.precomputeScore = false;
		for (var i = 0; i < this.beatenPins.length; i++) {
			scores.addThrowResult(this.beatenPins[i]);
		}
		while (!scores.gameOver) {
			scores.addThrowResult(0);
		}
		return scores.score;
	}

	getFrameResult() {
		return this.getResult(0) + this.getResult(1);
	}

	getLastFrameResult() {
		return this.getResult(0) + this.getResult(1) + this.getResult(2);
	}

	getResult(throwNum) {
		return this.throwResults[this.frameNumber][throwNum];
	}

	addScore(frameNumber, score) {
		this.score += score;
		this.frameStates[frameNumber] = FRAME_STATE_CLOSED;
		this.frameResults[frameNumber] = this.score;
	}

	closeFrame(state) {
		this.frameStates[this.frameNumber] = state;
		if (this.frameNumber < FRAME_COUNT - 1) {
			this.frameNumber++;
			this.throwNumber = 0;
		} else {
			this.gameOver = true;
		}
	}

	setThrowResult(result) {
		this.throwResultChars[this.frameNumber][this.throwNumber] = result;
	}
}
