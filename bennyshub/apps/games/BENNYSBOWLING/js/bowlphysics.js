
const MAX_SUB_STEPS = 20;
const FIXED_TIME_STEP = 0.01;
const TIME_STEP_MAX = MAX_SUB_STEPS * FIXED_TIME_STEP;

const GRAVITY = 9.81;

const BOTTOM_HEIGHT = 0.05;
const BASE_HEIGHT = 0.15;
const TOP_HEIGHT = 0.65;
const TRACK_WIDTH = 1.54;
const TRACK_HALF_WIDTH = 0.5 * TRACK_WIDTH;
const TRACK_START_Z = 3.0;
const TRACK_END_Z = -1.6;
const TRACK_MID_Z = 0.5 * (TRACK_START_Z + TRACK_END_Z);
const TRACK_LENGTH = TRACK_START_Z - TRACK_END_Z;
const TRACK_HALF_LENGTH = 0.5 * TRACK_LENGTH;
const TRACK_HEIGHT = TOP_HEIGHT - BOTTOM_HEIGHT;
const TRACK_HALF_HEIGHT = 0.5 * TRACK_HEIGHT;
const TRACK_MID_Y = BOTTOM_HEIGHT + TRACK_HALF_HEIGHT;
const LANE_HEIGHT = BASE_HEIGHT - BOTTOM_HEIGHT;
const LANE_HALF_HEIGHT = 0.5 * LANE_HEIGHT;
const LANE_WIDTH = 1.06;
const LANE_HALF_WIDTH = 0.5 * LANE_WIDTH;
const LANE_END_Z = -0.9;
const LANE_MID_Z = 0.5 * (TRACK_START_Z + LANE_END_Z);
const LANE_MID_Y = BOTTOM_HEIGHT + LANE_HALF_HEIGHT;
const LANE_LENGTH = TRACK_START_Z - LANE_END_Z;
const LANE_HALF_LENGTH = 0.5 * LANE_LENGTH;
const GUTTER_WIDTH = TRACK_HALF_WIDTH - LANE_HALF_WIDTH;
const GUTTER_HALF_WIDTH = 0.5 * GUTTER_WIDTH;
const GUTTER_DEPTH = 0.05;
const GUTTER_HEIGHT = LANE_HEIGHT - GUTTER_DEPTH;
const GUTTER_HALF_HEIGHT = 0.5 * GUTTER_HEIGHT;
const GUTTER_MID_Y = BOTTOM_HEIGHT + GUTTER_HALF_HEIGHT;
const BORDER_THICKNESS = 1.0;
const BORDER_HALF_THICKNESS = 0.5 * BORDER_THICKNESS;

const GROUP_PIN = 0x01;
const GROUP_BALL = 0x02;
const GROUP_LANE = 0x04;
const GROUP_GUTTER = 0x08;
const GROUP_KICKBACK = 0x10;
const GROUP_PIT_WALL = 0x20;
const GROUP_PIT_FLOOR = 0x40;
const GROUP_BOX = 0x80;

const MASK_DYNAMIC = GROUP_PIN | GROUP_BALL;
const MASK_STATIC = GROUP_LANE | GROUP_GUTTER | GROUP_KICKBACK
		| GROUP_PIT_WALL | GROUP_PIT_FLOOR | GROUP_BOX;
const MASK_ALL = MASK_DYNAMIC | MASK_STATIC;

const BALL_RADIUS = 0.109;
const BALL_WEIGHT = 13;
const BALL_LBS_TO_KG = 0.45359237;
const BALL_MASS = BALL_WEIGHT * BALL_LBS_TO_KG;
const BALL_RG_MIN = 0.065;
const BALL_RG_MAX = 0.066;
const BALL_I11 = BALL_MASS * BALL_RG_MIN * BALL_RG_MIN;
const BALL_I22 = BALL_MASS * BALL_RG_MAX * BALL_RG_MAX;
const BALL_I33 = BALL_I22;
const BALL_POSITION_MAX = 0.53;
const BALL_POSITION_MIN = -BALL_POSITION_MAX;
const BALL_ANGLE_MAX = Math.PI / 12.0;
const BALL_ANGLE_MIN = -BALL_ANGLE_MAX;
const BALL_VELOCITY_MIN = 3.0;
const BALL_VELOCITY_MAX = 6.0;
const BALL_LINE = TRACK_START_Z - 0.15;
const BALL_HEIGHT = BASE_HEIGHT + BALL_RADIUS;

const PIN_RADIUS_MAX = 0.06;
const PIN_HEIGHT = 0.38;
const PIN_CG = 0.145;
const PIN_MASS = 1.53;
const PIN_I11 = 0.013;
const PIN_I22 = 0.002;
const PIN_I33 = 0.013;
const PIN_DISTANCE = 0.304;
const PIN_DX = 0.5 * PIN_DISTANCE;
const PIN_DY = PIN_DISTANCE * Math.cos(Math.PI / 6.0);
const PIN_Y = BASE_HEIGHT + PIN_CG;
const PIN_SPHERE_RADIUS = PIN_RADIUS_MAX;
const PIN_SPHERE_Y = -0.034;
const PIN_HEAD_RADIUS = 0.032;
const PIN_HEAD_Y = PIN_HEIGHT - PIN_CG - PIN_HEAD_RADIUS;
const PIN_KNEE_RADIUS = 0.045;
const PIN_KNEE_HEIGHT = 0.015;
const PIN_KNEE_HALF_HEIGHT = 0.5 * PIN_KNEE_HEIGHT;
const PIN_KNEE_Y = PIN_SPHERE_Y - PIN_SPHERE_RADIUS - PIN_KNEE_HALF_HEIGHT;
const PIN_FOOT_RADIUS = 0.025;
const PIN_FOOT_HEIGHT = PIN_CG + PIN_SPHERE_Y - PIN_SPHERE_RADIUS - PIN_KNEE_HEIGHT;
const PIN_FOOT_HALF_HEIGHT = 0.5 * PIN_FOOT_HEIGHT;
const PIN_FOOT_Y = PIN_SPHERE_Y - PIN_SPHERE_RADIUS - PIN_KNEE_HEIGHT - PIN_FOOT_HALF_HEIGHT;
const PIN_NECK_RADIUS = PIN_HEAD_RADIUS;
const PIN_NECK_HEIGHT = PIN_HEAD_Y - PIN_HEAD_RADIUS - PIN_SPHERE_Y - PIN_SPHERE_RADIUS;
const PIN_NECK_HALF_HEIGHT = 0.5 * PIN_NECK_HEIGHT;
const PIN_NECK_Y = PIN_HEAD_Y - PIN_HEAD_RADIUS - PIN_NECK_HALF_HEIGHT;

const FRICTION_LANE = 0.3;
const FRICTION_KICKBACK = 0.5;
const FRICTION_PIT = 0.7;
const FRICTION_BALL = 0.3;
const FRICTION_PIN = 0.3;
const RESTITUTION_LANE = 0.55;
const RESTITUTION_KICKBACK = 0.8;
const RESTITUTION_PIT = 0.1;
const RESTITUTION_BALL = 0.75;
const RESTITUTION_PIN = 0.75;
const SPINNING_FRICTION_BALL = 0.01;
const SPINNING_FRICTION_PIN = 0.01;
const ROLLING_FRICTION_TRACK = 1.0;
const ROLLING_FRICTION_BALL = 0.002;
const ROLLING_FRICTION_PIN = 0.002;

const GRAB_BALL_INERTIA_TIME = 0.5;

const STANDING_PIN_OFFSET_MAX = 0.03;
const STANDING_PIN_SQUARED_OFFSET_MAX = STANDING_PIN_OFFSET_MAX * STANDING_PIN_OFFSET_MAX;
const STANDING_PIN_ANGLE_Y_MAX = Math.PI / 36.0;
const STANDING_PIN_COS_ANGLE_Y_MIN = Math.cos(STANDING_PIN_ANGLE_Y_MAX);

const PIN_POSITIONS = [
	[ 0.0, PIN_Y, 0.0 ],
	[ -PIN_DX, PIN_Y, -PIN_DY ],
	[ PIN_DX, PIN_Y, -PIN_DY ],
	[ -2.0 * PIN_DX, PIN_Y, -2.0 * PIN_DY ],
	[ 0.0, PIN_Y, -2.0 * PIN_DY ],
	[ 2.0 * PIN_DX, PIN_Y, -2.0 * PIN_DY ],
	[ -3.0 * PIN_DX, PIN_Y, -3.0 * PIN_DY ],
	[ -PIN_DX, PIN_Y, -3.0 * PIN_DY ],
	[ PIN_DX, PIN_Y, -3.0 * PIN_DY ],
	[ 3.0 * PIN_DX, PIN_Y, -3.0 * PIN_DY ],
];
const PIN_COUNT = PIN_POSITIONS.length;

const STATIC_BOXES = [
	[ // lane
		[ LANE_HALF_WIDTH, LANE_HALF_HEIGHT, LANE_HALF_LENGTH ],
		[ 0.0, LANE_MID_Y, LANE_MID_Z ],
		GROUP_LANE, MASK_DYNAMIC, FRICTION_LANE, ROLLING_FRICTION_TRACK, RESTITUTION_LANE
	],
	[ // bottom
		[ TRACK_HALF_WIDTH + BORDER_THICKNESS, BORDER_HALF_THICKNESS, TRACK_HALF_LENGTH + BORDER_THICKNESS ],
		[ 0.0, BOTTOM_HEIGHT - BORDER_HALF_THICKNESS, TRACK_MID_Z ],
		GROUP_PIT_FLOOR, MASK_DYNAMIC, FRICTION_PIT, ROLLING_FRICTION_TRACK, RESTITUTION_PIT
	],
	[ // top
		[ TRACK_HALF_WIDTH + BORDER_THICKNESS, BORDER_HALF_THICKNESS, TRACK_HALF_LENGTH + BORDER_THICKNESS ],
		[ 0.0, TOP_HEIGHT + BORDER_HALF_THICKNESS, TRACK_MID_Z ],
		GROUP_BOX, MASK_DYNAMIC, FRICTION_KICKBACK, ROLLING_FRICTION_TRACK, RESTITUTION_KICKBACK
	],
	[ // left
		[ BORDER_HALF_THICKNESS, TRACK_HALF_HEIGHT, TRACK_HALF_LENGTH + BORDER_THICKNESS ],
		[ -TRACK_HALF_WIDTH - BORDER_HALF_THICKNESS, TRACK_MID_Y, TRACK_MID_Z ],
		GROUP_KICKBACK, MASK_DYNAMIC, FRICTION_KICKBACK, ROLLING_FRICTION_TRACK, RESTITUTION_KICKBACK
	],
	[ // right
		[ BORDER_HALF_THICKNESS, TRACK_HALF_HEIGHT, TRACK_HALF_LENGTH + BORDER_THICKNESS ],
		[ TRACK_HALF_WIDTH + BORDER_HALF_THICKNESS, TRACK_MID_Y, TRACK_MID_Z ],
		GROUP_KICKBACK, MASK_DYNAMIC, FRICTION_KICKBACK, ROLLING_FRICTION_TRACK, RESTITUTION_KICKBACK
	],
	[ // front
		[ TRACK_HALF_WIDTH, TRACK_HALF_HEIGHT, BORDER_HALF_THICKNESS ],
		[ 0.0, TRACK_MID_Y, TRACK_END_Z - BORDER_HALF_THICKNESS ],
		GROUP_PIT_WALL, MASK_DYNAMIC, FRICTION_PIT, ROLLING_FRICTION_TRACK, RESTITUTION_PIT
	],
	[ // back
		[ TRACK_HALF_WIDTH, TRACK_HALF_HEIGHT, BORDER_HALF_THICKNESS ],
		[ 0.0, TRACK_MID_Y, TRACK_START_Z + BORDER_HALF_THICKNESS ],
		GROUP_BOX, MASK_DYNAMIC, FRICTION_KICKBACK, ROLLING_FRICTION_TRACK, RESTITUTION_KICKBACK
	],
	[ // left gutter
		[ GUTTER_HALF_WIDTH, GUTTER_HALF_HEIGHT, LANE_HALF_LENGTH ],
		[ -LANE_HALF_WIDTH - GUTTER_HALF_WIDTH, GUTTER_MID_Y, LANE_MID_Z ],
		GROUP_GUTTER, MASK_DYNAMIC, FRICTION_KICKBACK, ROLLING_FRICTION_TRACK, RESTITUTION_KICKBACK
	],
	[ // right gutter
		[ GUTTER_HALF_WIDTH, GUTTER_HALF_HEIGHT, LANE_HALF_LENGTH ],
		[ LANE_HALF_WIDTH + GUTTER_HALF_WIDTH, GUTTER_MID_Y, LANE_MID_Z ],
		GROUP_GUTTER, MASK_DYNAMIC, FRICTION_KICKBACK, ROLLING_FRICTION_TRACK, RESTITUTION_KICKBACK
	]
];

class BowlPhysics {
	constructor() {
		this.simulationActive = false;
		this.simulationTime = 0.0;
		this.ballTransformDirty = true;
		this.currentPinsMask = 0;
		this.releasePosition = 0.0;
		this.lastPosition = 0.0;
		this.targetPosition = 0.0;
		this.ballInertiaTime = GRAB_BALL_INERTIA_TIME;

		this.collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
		this.dispatcher = new Ammo.btCollisionDispatcher(this.collisionConfiguration);
		this.overlappingPairCache = new Ammo.btDbvtBroadphase();
		this.solver = new Ammo.btSequentialImpulseConstraintSolver();
		this.dynamicsWorld = new Ammo.btDiscreteDynamicsWorld(this.dispatcher,
				this.overlappingPairCache, this.solver, this.collisionConfiguration);
		this.transformAux = new Ammo.btTransform();

		this.dynamicsWorld.setGravity(new Ammo.btVector3(0.0, -GRAVITY, 0.0));

		for (var i = 0; i < STATIC_BOXES.length; i++) {
			var sb = STATIC_BOXES[i];
			var halfExtents = sb[0];
			var position = sb[1];
			var group = sb[2];
			var mask = sb[3];
			var friction = sb[4];
			var rollingFriction = sb[5];
			var restitution = sb[6];
			var boxShape = new Ammo.btBoxShape(new Ammo.btVector3(
					halfExtents[0], halfExtents[1], halfExtents[2]));
			this.createStaticBody(boxShape, position[0], position[1], position[2],
					0.0, 0.0, 0.0, 1.0, group, mask, friction, rollingFriction, restitution);
		}

		this.resetPhysics();
	}

	updatePhysics(dt) {
		if (this.simulationActive) {
			var clampedDt = Math.min(dt, TIME_STEP_MAX);
			this.simulationTime += clampedDt;

			// Clamp the Bullet step to avoid large frame jumps that can cause tunneling
			this.dynamicsWorld.stepSimulation(clampedDt, MAX_SUB_STEPS, FIXED_TIME_STEP);
		} else {
			if (this.ballInertiaTime < GRAB_BALL_INERTIA_TIME) {
				this.ballInertiaTime += dt;
				var k = Math.min(this.ballInertiaTime / GRAB_BALL_INERTIA_TIME, 1.0);
				this.releasePosition = this.lastPosition + (this.targetPosition - this.lastPosition)
						* k * k * (3.0 - 2.0 * k); // smooth Hermite interpolation
				this.ballTransformDirty = true;
			}

			this.syncBallPosition();
		}
	}

	syncBallPosition() {
		if (!this.ballTransformDirty || !this.ballBody) {
			return;
		}

		this.transformAux.setIdentity();
		this.transformAux.setOrigin(new Ammo.btVector3(this.releasePosition,
				BALL_HEIGHT, BALL_LINE));

		this.ballBody.setCenterOfMassTransform(this.transformAux);
		this.dynamicsWorld.updateSingleAabb(this.ballBody);
		this.ballTransformDirty = false;
	}

	createBody(collisionShape, mass, I11, I22, I33, x, y, z, qx, qy, qz, qw,
			group, mask, friction, rollingFriction, restitution) {
		var transform = new Ammo.btTransform();
		transform.setIdentity();
		transform.setOrigin(new Ammo.btVector3(x, y, z));
		transform.setRotation(new Ammo.btQuaternion(qx, qy, qz, qw));
		var motionState = new Ammo.btDefaultMotionState(transform);
		var constructionInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState,
				collisionShape, new Ammo.btVector3(I11, I22, I33));
		constructionInfo.set_m_friction(friction);
		constructionInfo.set_m_rollingFriction(rollingFriction);
		constructionInfo.set_m_restitution(restitution);
		var body = new Ammo.btRigidBody(constructionInfo);
		this.dynamicsWorld.addRigidBody(body, group, mask);
		return body;
	}

	destroyBody(body) {
		this.dynamicsWorld.removeRigidBody(body);
	}

	getBallShape() {
		if (this.ballShape) {
			return this.ballShape;
		}

		this.ballShape = new Ammo.btSphereShape(BALL_RADIUS);
		return this.ballShape;
	}

	getPinShape() {
		if (this.pinShape) {
			return this.pinShape;
		}

		this.pinShape = new Ammo.btCompoundShape();

		this.transformAux.setIdentity();

		var footShape = new Ammo.btCylinderShape(new Ammo.btVector3(
				PIN_FOOT_RADIUS, PIN_FOOT_HALF_HEIGHT, PIN_FOOT_RADIUS));
		this.transformAux.setOrigin(new Ammo.btVector3(0.0, PIN_FOOT_Y, 0.0));
		this.pinShape.addChildShape(this.transformAux, footShape);

		var kneeShape = new Ammo.btCylinderShape(new Ammo.btVector3(
				PIN_KNEE_RADIUS, PIN_KNEE_HALF_HEIGHT, PIN_KNEE_RADIUS));
		this.transformAux.setOrigin(new Ammo.btVector3(0.0, PIN_KNEE_Y, 0.0));
		this.pinShape.addChildShape(this.transformAux, kneeShape);

		var neckShape = new Ammo.btCylinderShape(new Ammo.btVector3(
				PIN_NECK_RADIUS, PIN_NECK_HALF_HEIGHT, PIN_NECK_RADIUS));
		this.transformAux.setOrigin(new Ammo.btVector3(0.0, PIN_NECK_Y, 0.0));
		this.pinShape.addChildShape(this.transformAux, neckShape);

		var sphereShape = new Ammo.btSphereShape(PIN_SPHERE_RADIUS);
		this.transformAux.setOrigin(new Ammo.btVector3(0.0, PIN_SPHERE_Y, 0.0));
		this.pinShape.addChildShape(this.transformAux, sphereShape);

		var headShape = new Ammo.btSphereShape(PIN_HEAD_RADIUS);
		this.transformAux.setOrigin(new Ammo.btVector3(0.0, PIN_HEAD_Y, 0.0));
		this.pinShape.addChildShape(this.transformAux, headShape);

		return this.pinShape;
	}

	createBallBody() {
		var ballBody = this.createBody(this.getBallShape(), BALL_MASS, BALL_I11, BALL_I22, BALL_I33,
				0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, GROUP_BALL, MASK_ALL, FRICTION_BALL, ROLLING_FRICTION_BALL, RESTITUTION_BALL);
		// Enable continuous collision detection to prevent tunneling
		if (typeof ballBody.setCcdMotionThreshold === 'function') {
			ballBody.setCcdMotionThreshold(BALL_RADIUS);
		}
		if (typeof ballBody.setCcdSweptSphereRadius === 'function') {
			ballBody.setCcdSweptSphereRadius(BALL_RADIUS * 0.9);
		}
		// XXX Not available in 2.82
		//ballBody.setSpinningFriction(SPINNING_FRICTION_BALL);
		return ballBody;
	}

	createPinBody(x, y, z) {
		var pinBody = this.createBody(this.getPinShape(), PIN_MASS, PIN_I11, PIN_I22, PIN_I33,
				x, y, z, 0.0, 0.0, 0.0, 1.0, GROUP_PIN, MASK_ALL, FRICTION_PIN, ROLLING_FRICTION_PIN, RESTITUTION_PIN);
		// Enable CCD on pins as well (use a small swept-sphere radius around the foot)
		if (typeof pinBody.setCcdMotionThreshold === 'function') {
			pinBody.setCcdMotionThreshold(PIN_FOOT_RADIUS);
		}
		if (typeof pinBody.setCcdSweptSphereRadius === 'function') {
			pinBody.setCcdSweptSphereRadius(Math.max(0.5 * PIN_FOOT_RADIUS, 0.01));
		}
		// XXX Not available in 2.82
		//pinBody.setSpinningFriction(SPINNING_FRICTION_PIN);
		return pinBody;
	}

	createStaticBody(collisionShape, x, y, z, qx, qy, qz, qw,
			group, mask, friction, rollingFriction, restitution) {
		var staticBody = this.createBody(collisionShape, 0.0, 0.0, 0.0, 0.0,
				x, y, z, qx, qy, qz, qw, group, mask, friction, rollingFriction, restitution);
		return staticBody;
	}

	resetPhysics(clearPosition = true, pinsMask = -1) {
		this.currentPinsMask = pinsMask;
		if (this.ballBody) {
			this.dynamicsWorld.removeRigidBody(this.ballBody);
		}
		this.ballBody = this.createBallBody();

		if (!this.pinBodies) {
			this.pinBodies = new Array(PIN_COUNT);
		}
		for (var i = 0; i < this.pinBodies.length; i++) {
			var pinBody = this.pinBodies[i];
			if (pinBody) {
				this.dynamicsWorld.removeRigidBody(pinBody);
			}
			var position = PIN_POSITIONS[i];
			pinBody = ((pinsMask & (1 << i)) != 0)
					? this.createPinBody(position[0], position[1], position[2])
					: null;
			this.pinBodies[i] = pinBody;
		}

		this.simulationActive = false;
		this.simulationTime = 0.0;
		this.ballTransformDirty = true;
		if (clearPosition) {
			this.releasePosition = 0.0;
		}
		this.ballInertiaTime = GRAB_BALL_INERTIA_TIME;
	}

	positionBall(position, smooth = true) {
		if (this.simulationActive || !this.ballBody) {
			return;
		}
		this.ballTransformDirty = true;
		this.targetPosition = Math.max(BALL_POSITION_MIN, Math.min(BALL_POSITION_MAX, position));
		if (smooth) {
			this.ballInertiaTime = Math.min(this.ballInertiaTime, 0.5 * GRAB_BALL_INERTIA_TIME);
		} else {
			this.releasePosition = this.targetPosition;
			this.ballInertiaTime = GRAB_BALL_INERTIA_TIME;
			this.syncBallPosition();
		}
		this.lastPosition = this.releasePosition;
	}

	releaseBall(velocity, angle) {
		if (this.simulationActive || !this.ballBody || (velocity < BALL_VELOCITY_MIN)) {
			return;
		}
		var releaseVelocity = Math.min(BALL_VELOCITY_MAX, velocity);
		var releaseAngle = Math.max(BALL_ANGLE_MIN, Math.min(BALL_ANGLE_MAX, angle));
		var linearVelocity = new Ammo.btVector3(0.0, 0.0, -releaseVelocity)
				.rotate(new Ammo.btVector3(0, 1, 0), releaseAngle);
		this.ballBody.setLinearVelocity(linearVelocity);
		this.simulationActive = true;
	}

	detectStandingPins() {
		var pinsMask = 0;
		for (var i = 0; i < PIN_COUNT; i++) {
			var pinBody = this.pinBodies[i];
			if (!pinBody) {
				continue;
			}
			var transform = pinBody.getCenterOfMassTransform();
			var p = transform.getOrigin();
			var origin = PIN_POSITIONS[i];
			var dx = p.x() - origin[0];
			var dy = p.y() - origin[1];
			var dz = p.z() - origin[2];
			var distanceSquared = dx * dx + dy * dy + dz * dz;
			if ((distanceSquared < STANDING_PIN_SQUARED_OFFSET_MAX)
					&& (transform.getBasis().getRow(1).y() > STANDING_PIN_COS_ANGLE_Y_MIN)) {
				pinsMask |= (1 << i);
			}
		}
		return pinsMask;
	}

	countPins(pinsMask) {
		var amount = 0;
		var indexMask = 1;
		for (var i = 0; i < PIN_COUNT; i++) {
			if ((pinsMask & indexMask) == indexMask) {
				amount++;
			}
			indexMask <<= 1;
		}
		return amount;
	}
}
