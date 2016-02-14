mjpeg-camera
============

A full-featured mjpeg camera streaming library.

Sometimes you want a slim library that does one thing well, like [mjpeg-consumer](https://github.com/mmaelzer/mjpeg-consumer).  
  
Other times, you want the pieces put together for you so that you can work on more important things.  
  
**mjpeg-camera** is for those __other__ times.


Install
-------
```
npm install mjpeg-camera
```

------------------------

Stand-alone Server Example
-------------------------
```
$ npm install mjpeg-camera -g
$ cs

  Usage: server [options]

  Options:

    -h, --help          output usage information
    -V, --version       output the version number
    -u --user []        Set the username for camera authentication
    -pw --password []   Set the password for camera authentication
    -l --url []         Set the url for the camera
    -p --port [8080]    Set the port for the http server to listen on
    -n --name [camera]  Set the name of the camera


$ cs -l http://204.248.124.202/mjpg/video.mjpg?camera=1 -n "Spring Grove" -p 12345
=== Spring Grove camera server listening on 12345 ===

// open up http://localhost:12345 in your browser to view the live video stream
```

Libary Example
------------------------
```javascript
var MjpegCamera = require('mjpeg-camera');
var FileOnWrite = require('file-on-write');
var fs = require('fs');

// Create a writable stream to generate files
var fileWriter = new FileOnWrite({
  path: './frames',
  ext: '.jpeg',
  filename: function(frame) {
    return frame.name + '-' + frame.time;
  },
  transform: function(frame) {
    return frame.data;
  }
});

// Create an MjpegCamera instance
var camera = new MjpegCamera({
  name: 'backdoor',
  user: 'admin',
  password: 'wordup',
  url: 'http://192.168.7.1/video',
  motion: true
});

// Pipe frames to our fileWriter so we gather jpeg frames into the /frames folder
camera.pipe(fileWriter);

// Start streaming
camera.start();

// Stop recording after an hour
setTimeout(function() {

  // Stahp
  camera.stop();

  // Get one last frame
  // Will open a connection long enough to get a single frame and then
  // immediately close the connection
  camera.getScreenshot(function(err, frame) {
    fs.writeFile('final.jpeg', frame, process.exit);
  });

}, 60*60*1000);
```

Options
-------

* **url** `String` - The url of the mjpeg camera.
* **name** `String` (optional) - The name of the camera. The `name` is used when passing along a frame as frames are objects of the format `{ name: <string>, time: <number>, data: <buffer> }`. Defaults to 'camera' and a random number between 0 and 1000.
* **motion** `Boolean` (optional) - A flag that tells the camera to only emit frames when motion is detected. mjpeg-camera uses the [motion-detect](https://github.com/mmaelzer/motion) library for motion detection. Defaults to `false`.
* **password** `String` (optional) - The password required for authenticating with the camera.
* **user** `String` (optional) - The username required for authenticating with the camera.
* **timeout** `Number` (optional) - The time in milliseconds that must elapse since last receiving data from the camera before trying to reconnect to the camera.


Methods
-------

### camera.start()
Calling `start` will open the connection to the mjpeg camera and begin streaming jpeg images.

### camera.stop()
Calling `stop` will close the connection the the mjpeg camera and unhook internal streams.

### camera.getScreenshot(callback)
If called before `start()` or after `stop()`, `getScreenshot` will open a connection long enough to get a single frame from the camera, then close the connection. If `getScreenshot` is called while there is a connection to the camera, it will pass the latest frame to the callback

#### Example
```javascript
var MjpegCamera = require('mjpeg-camera');
var fs = require('fs');

var camera = new MjpegCamera({ url: 'http://192.168.1.2/feed' });

camera.getScreenshot(function(err, frame) {
  fs.writeFileSync('camera-screenshot.jpg', frame);  
});
```

Streams
-------
**mjpeg-camera** is a [node.js Transform stream](http://nodejs.org/api/stream.html#stream_class_stream_transform). You can pipe it to a file writer file [file-on-write](https://github.com/mmaelzer/file-on-write) or addition frame analysis streams. When using the `motion` flag to only stream motion-detected frames.
  
The data format passed by the stream looks like this:  
```javascript
{
  name: 'camera-name',
  time: 1413063729650,
  data: Buffer < ... >
}
```


#### Example
```javascript
var MjpegCamera = require('mjpeg-camera');
var fs = require('fs');
var FileOnWrite = require('file-on-write');

var cameraName = 'front-door';

var camera = new MjpegCamera({
  name: cameraName,
  url: 'http://192.168.1.2/feed',
  motion: true
});

var motionWriter = new FileOnWrite({
  path: 'motion/',
  filename: function(frame) {
    return frame.name + '-' + frame.time;
  },
  // We need to pull the jpeg out of the frame object
  transform: function(frame) {
    return frame.data;
  },
  ext: '.jpg'
});

// Write frames with motion to the 'motion/'' folder
camera.pipe(motionWriter);

```


The MIT License
===============

Copyright (c) 2015 Michael Maelzer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
