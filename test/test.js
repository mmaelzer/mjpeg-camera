var test = require('node:test');
var assert = require('node:assert');

var Camera = require('../mjpeg-camera');
var auth = require('../auth');
var server = require('./server');

/** Resolves with the first frame the camera emits, then shuts it down. */
function firstFrame(camera) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() {
      reject(new Error('no frame within 5s'));
    }, 5000);

    camera.on('data', function(chunk) {
      clearTimeout(timer);
      resolve(chunk);
    });
  });
}

test('streams frames from a camera with no authentication', async function() {
  var cam = await server.start();
  var camera = new Camera({ url: cam.url, name: 'front' });

  try {
    camera.start();
    var chunk = await firstFrame(camera);
    assert.deepStrictEqual(chunk.data, server.FRAME);
    assert.strictEqual(chunk.name, 'front');
    assert.strictEqual(typeof chunk.time, 'number');
  } finally {
    camera.stop();
    await cam.stop();
  }
});

test('sends basic credentials preemptively', async function() {
  var cam = await server.start({ auth: 'basic' });
  var camera = new Camera({ url: cam.url, user: cam.user, password: cam.password });

  try {
    camera.start();
    assert.deepStrictEqual((await firstFrame(camera)).data, server.FRAME);
    // Preemptive means the server never had to ask.
    assert.strictEqual(cam.challenges(), 0);
  } finally {
    camera.stop();
    await cam.stop();
  }
});

test('answers a basic challenge when not sending immediately', async function() {
  var cam = await server.start({ auth: 'basic' });
  var camera = new Camera({
    url: cam.url, user: cam.user, password: cam.password, sendImmediately: false
  });

  try {
    camera.start();
    assert.deepStrictEqual((await firstFrame(camera)).data, server.FRAME);
    assert.strictEqual(cam.challenges(), 1);
  } finally {
    camera.stop();
    await cam.stop();
  }
});

/**
 * The capability that would have been lost by moving to fetch. Plenty of IP
 * cameras speak only Digest.
 */
var digestCases = [
  ['legacy digest, no qop', {}],
  ['digest with qop=auth', { qop: 'auth' }],
  ['digest with MD5-sess', { qop: 'auth', algorithm: 'MD5-sess' }],
  ['digest offered alongside basic', { qop: 'auth', both: true }]
];

digestCases.forEach(function(entry) {
  test('authenticates against ' + entry[0], async function() {
    var settings = Object.assign({ auth: 'digest' }, entry[1]);
    var cam = await server.start(settings);
    var camera = new Camera({ url: cam.url, user: cam.user, password: cam.password });

    try {
      camera.start();
      assert.deepStrictEqual((await firstFrame(camera)).data, server.FRAME);
      assert.strictEqual(cam.challenges(), 1);
    } finally {
      camera.stop();
      await cam.stop();
    }
  });
});

test('reports a non-200 response through the error callback', async function() {
  var cam = await server.start({ status: 404 });
  var camera = new Camera({ url: cam.url });

  try {
    var err = await new Promise(function(resolve) {
      camera.start(resolve);
    });
    assert.match(err.message, /responded 404/);
  } finally {
    camera.stop();
    await cam.stop();
  }
});

test('getScreenshot resolves one frame and closes the connection', async function() {
  var cam = await server.start();
  var camera = new Camera({ url: cam.url });

  try {
    var frame = await new Promise(function(resolve, reject) {
      camera.getScreenshot(function(err, f) { return err ? reject(err) : resolve(f); });
    });
    assert.deepStrictEqual(frame, server.FRAME);
    assert.strictEqual(camera.connection, null);
  } finally {
    camera.stop();
    await cam.stop();
  }
});

test('stop clears the connection and is safe to call twice', async function() {
  var cam = await server.start();
  var camera = new Camera({ url: cam.url });

  try {
    camera.start();
    await firstFrame(camera);
    camera.stop();
    assert.strictEqual(camera.connection, null);
    camera.stop();
  } finally {
    await cam.stop();
  }
});

test('parses a challenge that offers several schemes', function() {
  var header = 'Basic realm="a", Digest realm="b", nonce="n", qop="auth"';

  assert.strictEqual(auth.parseChallenge(header, 'Basic').realm, 'a');

  var d = auth.parseChallenge(header, 'Digest');
  assert.strictEqual(d.realm, 'b');
  assert.strictEqual(d.nonce, 'n');
  assert.strictEqual(d.qop, 'auth');
});

test('declines a challenge it cannot answer', function() {
  assert.strictEqual(auth.answer('Negotiate', { username: 'u', password: 'p' }), null);
  // auth-int would require hashing a request body these requests do not have.
  assert.strictEqual(
    auth.digest({ realm: 'r', nonce: 'n', qop: 'auth-int' },
      { username: 'u', password: 'p', method: 'GET', uri: '/' }),
    null
  );
});

test('computes the RFC 7616 digest response', function() {
  // The worked example from RFC 7616 section 3.9.1, with its fixed cnonce
  // swapped out -- ours is random, so the check is against a recomputation.
  var crypto = require('node:crypto');
  var header = auth.digest(
    { realm: 'http-auth@example.org', nonce: 'abc123', qop: 'auth', algorithm: 'MD5' },
    { username: 'Mufasa', password: 'Circle of Life', method: 'GET', uri: '/dir/index.html' }
  );

  var params = auth.parseChallenge(header, 'Digest');
  function md5(s) { return crypto.createHash('md5').update(s).digest('hex'); }
  var ha1 = md5('Mufasa:http-auth@example.org:Circle of Life');
  var ha2 = md5('GET:/dir/index.html');
  var expected = md5([ha1, 'abc123', '00000001', params.cnonce, 'auth', ha2].join(':'));

  assert.strictEqual(params.response, expected);
  assert.strictEqual(params.uri, '/dir/index.html');
  assert.strictEqual(params.nc, '00000001');
});
