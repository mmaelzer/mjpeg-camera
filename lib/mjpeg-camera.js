var _ = require('lodash');
var request = require('request');
var MjpegConsumer = require('mjpeg-consumer');
var MotionStream = require('motion').Stream;
var through = require('through2');
var Transform = require('stream').Transform;
var util = require('util');

/**
 *  @param {Object} options
 *    @param {String=} name - camera name
 *    @param {Boolean=} motion - only emit jpegs from motion events
 *    @param {String=} user - the user for auth on the camera
 *    @param {String=} password - the password for auth on the camera
 *  @constructor 
 */
function Camera(options) {
  options = options || {};
  // Streams need this flag to handle object data
  options.objectMode = true;
  Transform.call(this, options);
  this.name = options.name || ('camera' + _.random(1000));
  this.motion = options.motion || false;
  this.url = options.url;
  this.user = options.user;
  this.password = options.password;
  // this.frame will hold onto the last frame
  this.frame = null;

  this.live = through();
}
util.inherits(Camera, Transform);

/**
 *  Open the connection to the camera and begin streaming
 *  and optionally performing motion analysis
 */
Camera.prototype.start = function() {
  var videostream = this._getVideoStream();

  videostream.on('data', this.onFrame.bind(this));
  if (this.motion) {
    this.motionStream = new MotionStream();
    videostream.pipe(this.motionStream).pipe(this);
  } else {
    videostream.pipe(this);
  }
};

/**
 *  Creates an http stream to the camera via request
 *  @private
 */
Camera.prototype._connect = function() {
  this.connection = request({
    url: this.url,
    auth: {
      user: this.user,
      pass: this.password,
      // this is for digest authentication, also works for basic auth
      sendImmediately: false
    }
  });

  this.connection.on('error', this._connect.bind(this));
};

/**
 *  Calls 'connect' if not yet connected and hooks up the MjpegConsumer
 *  @private
 */
Camera.prototype._getVideoStream = function() {
  if (!this.connection) {
    this._connect(); 
  }
  this.consumer = new MjpegConsumer();
  return this.connection.pipe(this.consumer);
};

/**
 *  Closes the connection to the camera and unhooks the streams
 */
Camera.prototype.stop = function() {
  this.connection.abort();
  this.consumer.unpipe();
  this.connection = null;
};

/**
 *  As frames are parsed from the http connection, they are stored
 *  as `frame` and written to the `live` stream
 *
 *  @param {Buffer} frame
 */
Camera.prototype.onFrame = function(frame) {
  this.frame = frame;
  this.live.write(frame);
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
    process.nextTick(function() { return this.frame; });
  } else {
    var videostream = this._getVideoStream();
    
    videostream.on('data', function(frame) {
      this.stop();
      callback(null, frame);
    }.bind(this));

    videostream.on('error', function(err) {
      this.stop();
      callback(err);
    }.bind(this));
  }
};

/**
 *  Implementation of the private `_transform` method of Transform streams.
 *  @param {Buffer|Object} chunk
 *  @param {String} encoding
 *  @param {Function} done
 */
Camera.prototype._transform = function(chunk, encoding, done) {
  // If chunk is a buffer, it's coming from mjpeg-consumer. Convert
  // to an object of the structure provided by the motion stream
  if (Buffer.isBuffer(chunk)) {
    chunk = {time: Date.now(), data: chunk};
  }

  // Pass along the camera name with our data to the next stream
  if (this.name) {
    chunk.name = this.name;
  }

  this.push(chunk);

  done();
};

module.exports = Camera;