// The multiplayer protocol (Phase 7 Step 1; docs/MULTIPLAYER.md): message types, close and error codes, and the
// version. Shared by the game, the real-time server and the bots. Every message is binary (net/codec.js); the
// transport carries its type number alongside.
//
// The version: a client says its PROTOCOL when it joins, and a different one is refused with VERSION (and a
// message saying to refresh the page). Raise it with any change to a message's layout.

export const PROTOCOL = 1;

// client → server
export const C2S = {
  STATE: 1,        // the car's state (codec.encodeState): often, latest wins
  EVENT: 2,        // something that must arrive (a crash's damage, a reset, a part off, lights): codec.encodeValue
  PING: 3,         // time sync: [seq u16][client ms f64]
  HELLO: 4,        // the car's look and damage so far (sent on joining and when it changes): codec.encodeValue
  STATS: 5,        // the client's own network numbers, for the server's logs (optional)
};
// server → client
export const S2C = {
  WELCOME: 10,     // codec.encodeValue: { protocol, id, roomEpoch, serverTime, net: { sendHz, … } }
  SNAPSHOT: 11,    // codec.encodeSnapshot: the nearby cars' states
  EVENT: 12,       // codec.encodeValue: { from, ...event }
  PONG: 13,        // [seq u16][client ms f64][server ms f64]
  ROSTER: 14,      // codec.encodeValue: { full: [players] } | { join } | { leave } | { status } | { look }
  NOTICE: 15,      // codec.encodeValue: { code, message }
};

// Why a join was refused, or a connection closed (WebSocket close codes 4000–4999 are the application's)
export const CODES = {
  VERSION: 4010,   // the game is older (or newer) than the server
  BANNED: 4011,
  FULL: 4012,      // the room or the server has no space
  TICKET: 4013,    // no valid join ticket (signed out, expired, used)
  KICKED: 4014,    // an admin, or the live checks
  ELSEWHERE: 4015, // the same account joined from another tab or device
  IDLE: 4016,      // nothing heard for too long (a dead connection)
  CLOSED: 4017,    // the room or server closed (a deploy)
  GUESTS: 4018,    // guests may not join this room
};

// What a player sees for each (and what to do)
export const MESSAGES = {
  [CODES.VERSION]: 'The game has been updated: refresh the page to play online.',
  [CODES.BANNED]: 'This account is suspended or banned.',
  [CODES.FULL]: 'The server is full right now. Try again in a minute.',
  [CODES.TICKET]: 'Couldn\'t sign you in to the game server. Sign in again, then retry.',
  [CODES.KICKED]: 'You were removed from the session.',
  [CODES.ELSEWHERE]: 'You joined from another tab or device, so this one was disconnected.',
  [CODES.IDLE]: 'Lost the connection to the game server.',
  [CODES.CLOSED]: 'The game server is restarting. Reconnecting…',
  [CODES.GUESTS]: 'Make a full account to join this room (your progress comes with you).',
};
export const messageFor = (code, fallback = 'Disconnected from the game server.') => MESSAGES[code] ?? fallback;

// State fields, one bit each in a state's mask (codec.js)
export const F = { POS: 1, ROT: 2, VEL: 4, ANG: 8, CTRL: 16, ENGINE: 32, WHEELS: 64, FLAGS: 128 };
export const ALL = 255;
// FLAGS bits: what a car shows
export const LIGHT = { BRAKE: 1, HEAD: 2, REVERSE: 4, HANDBRAKE: 8, STALLED: 16, AWAY: 32 };
