mjpeg-camera
============

Sometimes you want a slim library that does one thing well, [mjpeg-consumer](https://github.com/mmaelzer/mjpeg-consumer).  
  
Other times, you want the pieces put together for you so that you can work on more important things.  
  
**mjpeg-camera** is for those "other" times.


Install
-------
```
npm install mjpeg-camera
```

------------------------

Stand-alone Server Example
-------------------------
```
$ echo '{ "name": "backdoor", "user": "admin", "password": "wordup", "url": "http://192.168.7.1/video", "serverport": 12345 }' > server/config.json
$ npm start
=== backdoor camera server listening on 12345 ===

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

**TODO**


Methods
-------

**TODO**


The MIT License
===============

Copyright (c) 2014 Michael Maelzer

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