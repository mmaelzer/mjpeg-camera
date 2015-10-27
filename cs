#!/usr/bin/env node

var http = require('http');
var MjpegCamera = require('./mjpeg-camera');
var WriteStream = require('stream').Writable;
var program = require('commander');
var pack = require('./package.json');
var unpipe = require('unpipe');

program
  .version(pack.version)
  .option('-u --user []', 'Set the username for camera authentication')
  .option('-pw --password []', 'Set the password for camera authentication')
  .option('-l --url []', 'Set the url for the camera')
  .option('-p --port [8080]', 'Set the port for the http server to listen on', parseInt)
  .option('-n --name [camera]', 'Set the name of the camera')
  .parse(process.argv);

if (!program.url) {
  program.help();
}

// Create a new MjpegCamera object
var camera = new MjpegCamera({
  user: program.user || '',
  password: program.password || '',
  url: program.url,
  name: typeof program.name === 'function' ? '' : program.name
});
camera.start();

var boundary = '--boundandrebound';
var port = program.port || 8080;

console.log('===', camera.name, 'camera server listening on', port, '===');

http.createServer(function(req, res) {
  // A request to http://localhost/stream returns an unending sequence of jpegs
  // Listen for a disconnect from the client to properly unpipe the jpeg stream
  if (/stream/.test(req.url)) {
    res.writeHead(200, {'Content-Type': 'multipart/x-mixed-replace; boundary=' + boundary});
    var ws = new WriteStream({objectMode: true});
    ws._write = function(chunk, enc, next) {
      var jpeg = chunk.data;
      res.write(boundary + '\nContent-Type: image/jpeg\nContent-Length: '+ jpeg.length + '\n\n');
      res.write(jpeg);
      next();
    };
    camera.pipe(ws);
    res.on('close', function() {
      unpipe(camera);
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
                <body style="background:#000;">\
                  <img src="/stream" style="width:100%;height:auto;">\
                </body>\
              </html>');
  }
}).listen(port);
