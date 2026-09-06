var auth = require('./auth');
var devnull = require('dev-null');
var http = require('http');
var https = require('https');
var MjpegConsumer = require('mjpeg-consumer');
var MotionStream = require('motion-detect').Stream;
var Stream = require('stream');
var util = require('util');

/**
 *  @param {Object} options
 *    @param {String=} name - camera name
 *    @param {Boolean=} motion - only emit jpegs from motion events
 *    @param {String=} user - the user for auth on the camera
 *    @param {String} url - the url where the camera is serving an mjpeg stream
 *    @param {String=} password - the password for auth on the camera
 *    @param {Boolean=} sendImmediately - when true, causes a basic or bearer authentication header to be sent
 *    @param {Number=} timeout - reconnect if no frames after timeout millseconds
 *  @constructor 
 */
function Camera(options) {
  options = options || {};
  // Streams need this flag to handle object data
  options.objectMode = true;
  options.highWaterMark = 0;

  this.readable = true;
  this.writable = true;

  this.name = options.name || ('camera' + (Math.floor(Math.random() * 1000)));
  this.motion = options.motion || false;
  this.url = options.url;
  this.user = options.user;
  this.password = options.password;

  this.sendImmediately = 'sendImmediately' in options ? options.sendImmediately : true;

  this.timeout = options.timeout || 10000;
  // this.frame will hold onto the last frame
  this.frame = null;

  // Connection-scoped, all set in _connect and cleared in stop.
  this.connection = null;
  this.consumer = null;
  this._target = null;
  this._transport = null;
  this._credentials = null;
  this._onError = null;

  this.pipe(devnull(options));
}
util.inherits(Camera, Stream);

/**
 *  Open the connection to the camera and begin streaming
 *  and optionally performing motion analysis
 *  @param {Function(Error, Buffer)} Error callback
 */
Camera.prototype.start = function(errorCallback) {
  var videostream = this._getVideoStream(errorCallback);
  videostream.on('data', this.onFrame.bind(this));
  if (this.motion) {
    videostream.pipe(new MotionStream()).pipe(this);
  } else {
    videostream.pipe(this);
  }
};

/**
 *  Derives everything the connection needs and opens it. The derived values
 *  live on the instance rather than in a closure: they have exactly the
 *  lifetime of `connection` and are cleared with it in `stop`.
 *  @private
 */
Camera.prototype._connect = function(errorCallback) {
  if (this.connection) {
    this.stop();
  }

  var target = new URL(this.url);

  this._target = target;
  this._transport = target.protocol === 'https:' ? https : http;
  this._onError = errorCallback || this.keepalive.bind(this);
  this._credentials = {
    username: this.user || '',
    password: this.password || '',
    method: 'GET',
    // Digest hashes the request target exactly as it goes out on the wire.
    uri: target.pathname + target.search
  };

  // The consumer is handed back to the caller before the response exists, and
  // is fed once it arrives. `request` was a duplex stream available the moment
  // it was constructed; nothing in the standard library behaves that way.
  this.consumer = new MjpegConsumer();

  var headers = {};
  // Preemptive Basic, as before. A camera that wants Digest answers with a 401
  // and _send handles it, whether or not we led with credentials.
  if (this.sendImmediately && (this.user || this.password)) {
    headers.authorization = auth.basic(
      this._credentials.username, this._credentials.password
    );
  }

  this._send(headers, false);
  this.keepalive();
};

/**
 *  Issues the request and pipes the response into the consumer.
 *
 *  @param {Object} headers - request headers
 *  @param {Boolean} isRetry - set when answering a 401, so a camera that keeps
 *    challenging cannot drive this round forever
 *  @private
 */
Camera.prototype._send = function(headers, isRetry) {
  var self = this;
  var request = this._transport.request(this._target, {
    method: 'GET',
    headers: headers
  });

  request.on('response', function(response) {
    if (response.statusCode === 401 && !isRetry && (self.user || self.password)) {
      var header = auth.answer(response.headers['www-authenticate'], self._credentials);
      // Drain the challenge body so the socket can be reused or closed.
      response.resume();
      if (header) return self._send({ authorization: header }, true);
    }

    if (response.statusCode !== 200) {
      response.resume();
      return self._onError(new Error(
        'camera at ' + self.url + ' responded ' + response.statusCode
      ));
    }

    response.pipe(self.consumer);
  });

  request.on('error', this._onError);
  request.end();
  this.connection = request;
};

/**
 *  Calls 'connect' if not yet connected and hooks up the MjpegConsumer
 *  @private
 */
Camera.prototype._getVideoStream = function(callback) {
  if (!this.connection) {
    this._connect(callback);
  }
  return this.consumer;
};

/**
 *  Closes the connection to the camera and unhooks the streams
 */
Camera.prototype.stop = function() {
  clearTimeout(this._timeout);
  if (this.connection) {
    // destroy, not end: end finishes sending the request, which for a GET that
    // is already in flight does nothing at all. The socket has to be torn down.
    this.connection.destroy();
    this.connection = null;
  }
  if (this.consumer) {
    this.consumer.destroy();
    this.consumer = null;
  }
  this._target = null;
  this._transport = null;
  this._credentials = null;
  this._onError = null;
  // https://github.com/nodejs/node/blob/master/lib/events.js
  // clear out internal event listeners
  this._events = {};
};

/**
 *  As frames are parsed from the http connection, they are stored
 *  as `frame` and written to the `live` stream
 *
 *  @param {Buffer} frame
 */
Camera.prototype.onFrame = function(frame) {
  this.keepalive();
  this.frame = frame;
};

/**
 *  Attempt to refresh the connection to the camera if we don't receive
 *  a frame after `timeout` ms.
 */
Camera.prototype.keepalive = function() {
  clearTimeout(this._timeout);
  this._timeout = setTimeout(function() {
    this.stop();
    this.start();
  }.bind(this), this.timeout);
};

/**
 *  If there's no connection to the camera, open one, grab a frame
 *  and close the connection.
 *
 *  If there is a connection to the camera, just callback with the
 *  most recent frame
 *
 *  @param {Function(Error, Buffer)} callback
 */
Camera.prototype.getScreenshot = function(callback) {
  if (this.connection) {
    process.nextTick(function() {
      callback(null, this.frame);
    }.bind(this));
  } else {
    var handleError = function(err) {
      this.stop();
      callback(err);
    }.bind(this);

    var videostream = this._getVideoStream(handleError);
    videostream.once('error', handleError);

    videostream.once('data', function(frame) {
      this.stop();
      callback(null, frame);
    }.bind(this));
  }
};

/**
 *  @param {Buffer|Object} chunk
 */
Camera.prototype.write = function(chunk) {
  // If we get empty data, ignore
  if (!chunk) return;

  // If chunk is a buffer, it's coming from mjpeg-consumer. Convert
  // to an object of the structure provided by the motion stream
  if (Buffer.isBuffer(chunk)) {
    chunk = {time: Date.now(), data: chunk};
  }

  // Pass along the camera name with our data to the next stream
  if (this.name) {
    chunk.name = this.name;
  }
  this.emit('data', chunk);
};

/**
 *  @param {Buffer|Object} chunk
 */
Camera.prototype.end = function(chunk) {
  if (chunk) this.write(chunk);
};

Camera.prototype.destroy = function() {
  this.writable = false;
};

module.exports = Camera;
