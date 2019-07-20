var devnull = require('dev-null');
var MjpegConsumer = require('mjpeg-consumer');
var MotionStream = require('motion-detect').Stream;
var Request = require('request');
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
  this.pipe(devnull(options));
}
util.inherits(Camera, Stream);

/**
 *  Open the connection to the camera and begin streaming
 *  and optionally performing motion analysis
 */
Camera.prototype.start = function() {
  var videostream = this._getVideoStream();
  videostream.on('data', this.onFrame.bind(this));
  if (this.motion) {
    videostream.pipe(new MotionStream()).pipe(this);
  } else {
    videostream.pipe(this);
  }
};

/**
 *  Creates an http stream to the camera via request
 *  @private
 */
Camera.prototype._connect = function(errorCallback) {
  if (this.connection) {
    this.stop();
  }

  var options = { url: this.url };

  if (this.user || this.password) {
    options.auth = {
      user: this.user,
      pass: this.password,
      sendImmediately: this.sendImmediately 
    };
  }

  this.connection = new Request(options);
  if (errorCallback) {
    this.connection.on('error', errorCallback);
  } else {
    this.connection.on('error', this.keepalive.bind(this));
  }
  this.keepalive();
};

/**
 *  Calls 'connect' if not yet connected and hooks up the MjpegConsumer
 *  @private
 */
Camera.prototype._getVideoStream = function(callback) {
  if (!this.connection) {
    this._connect(callback);
  }
  return this.connection.pipe(new MjpegConsumer());
};

/**
 *  Closes the connection to the camera and unhooks the streams
 */
Camera.prototype.stop = function() {
  clearTimeout(this._timeout);
  this.connection.abort();
  this.connection = null;
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
