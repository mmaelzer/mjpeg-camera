var crypto = require('crypto');
var http = require('http');

// A stand-in for a camera frame: mjpeg-consumer only cares about the
// start-of-image and end-of-image markers and the declared length.
var FRAME = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  Buffer.alloc(256, 0x41),
  Buffer.from([0xff, 0xd9])
]);

var BOUNDARY = '--frameboundary';

function md5(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

function parse(header) {
  var params = {};
  var re = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi;
  var match;
  while ((match = re.exec(header)) !== null) {
    params[match[1].toLowerCase()] = match[2] !== undefined ? match[2] : match[3];
  }
  return params;
}

/**
 *  @param {Object} options
 *    @param {String=} auth - 'basic', 'digest', or absent for none
 *    @param {String=} qop - digest qop to advertise
 *    @param {String=} algorithm - digest algorithm to advertise
 *    @param {Number=} status - respond with this status and nothing else
 *  @return {Promise<Object>} a started server
 */
function start(options) {
  options = options || {};

  var user = 'admin';
  var pass = 'wordup';
  var realm = 'camera';
  var nonce = 'deadbeef';
  var challenges = 0;
  var run = true;

  function unauthorized(res) {
    challenges++;
    var header;
    if (options.auth === 'digest') {
      header = 'Digest realm="' + realm + '", nonce="' + nonce + '"';
      if (options.qop) header += ', qop="' + options.qop + '"';
      if (options.algorithm) header += ', algorithm=' + options.algorithm;
      if (options.both) header = 'Basic realm="' + realm + '", ' + header;
    } else {
      header = 'Basic realm="' + realm + '"';
    }
    res.writeHead(401, { 'WWW-Authenticate': header });
    res.end();
  }

  function digestOk(header) {
    var p = parse(header.replace(/^Digest\s+/i, ''));
    var ha1 = md5(user + ':' + realm + ':' + pass);
    if (/-sess$/i.test(options.algorithm || '')) {
      ha1 = md5(ha1 + ':' + nonce + ':' + p.cnonce);
    }
    var ha2 = md5('GET:' + p.uri);
    var expected = p.qop
      ? md5([ha1, p.nonce, p.nc, p.cnonce, p.qop, ha2].join(':'))
      : md5([ha1, p.nonce, ha2].join(':'));
    return p.response === expected && p.nonce === nonce;
  }

  var server = http.createServer(function(req, res) {
    if (options.status) {
      res.writeHead(options.status);
      return res.end();
    }

    var header = req.headers.authorization;

    if (options.auth === 'basic') {
      var want = 'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
      if (header !== want) return unauthorized(res);
    } else if (options.auth === 'digest') {
      if (!header || !/^Digest\s/i.test(header) || !digestOk(header)) {
        return unauthorized(res);
      }
    }

    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=' + BOUNDARY
    });

    (function writeFrame() {
      setTimeout(function() {
        if (!run || res.writableEnded) return;
        res.write(BOUNDARY + '\r\nContent-Type: image/jpeg\r\nContent-Length: ' +
          FRAME.length + '\r\n\r\n');
        res.write(FRAME);
        writeFrame();
      }, 20);
    })();

    res.on('close', function() { run = false; });
  });

  return new Promise(function(resolve) {
    server.listen(0, '127.0.0.1', function() {
      resolve({
        url: 'http://127.0.0.1:' + server.address().port + '/stream',
        user: user,
        password: pass,
        challenges: function() { return challenges; },
        stop: function() {
          run = false;
          server.closeAllConnections();
          return new Promise(function(done) { server.close(function() { done(); }); });
        }
      });
    });
  });
}

module.exports = { start: start, FRAME: FRAME };
