var config = require('./config.json');
var http = require('http');
var MjpegCamera = require('../lib/mjpeg-camera');
var through = require('through2');
var WriteStream = require('stream').Writable;

// Create a new MjpegCamera object
var camera = new MjpegCamera(config);
camera.start();

var boundary = '--boundandrebound';
var port = config.serverport || 8080;

console.log('===', camera.name, 'camera server listening on', port, '===');

var server = http.createServer(function(req, res) {
  // A request to http://localhost/stream returns an unending sequence of jpegs
  // Listen for a disconnect from the client to properly unpipe the jpeg stream
  if (/stream/.test(req.url)) {
    res.writeHead(200, {'Content-Type': 'multipart/x-mixed-replace; boundary=' + boundary});
    var ws = new WriteStream();
    ws._write = function(jpeg, enc, next) {
      res.write(boundary + '\nContent-Type: image/jpeg\nContent-Length: '+ jpeg.length + '\n\n');
      res.write(jpeg);
      next();
    };
    camera.live.pipe(ws);
    res.on('close', function() {
      camera.live.unpipe(ws);
    });
  } 
  // A request to http://localhost/frame returns a single frame as a jpeg
  else if (/frame/.test(req.url)) {
    res.writeHead(200, {'Content-Type': 'image/jpeg'});
    res.end(camera.frame);
  } 
  // A request to http://localhost returns a simple webpage that will render
  // a livestream of jpegs from the camera
  else {
    res.writeHead(200, {'Content-Type': 'text/html'});
    res.end('<!doctype html>\
              <html>\
                <head>\
                  <title>'+camera.name+'</title>\
                </head>\
                <body>\
                  <img src="/stream" style="width:100%;height:auto;">\
                </body>\
              </html>');
  }
});

server.listen(port);