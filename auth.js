var crypto = require('crypto');

/**
 * HTTP authentication for camera streams.
 *
 * This used to come free with the `request` package. `request` was deprecated
 * in 2020 and brought six transitive dependencies with it, several carrying
 * published advisories, so it is gone -- but plenty of IP cameras only speak
 * Digest, and dropping that would have broken them silently. Basic is a
 * one-liner; Digest is RFC 7616, which is a few hashes and a lot of quoting.
 */

// Digest algorithms worth supporting. auth-int is deliberately absent: it
// requires hashing the request body, and these requests have none.
var ALGORITHMS = {
  'md5': 'md5',
  'md5-sess': 'md5',
  'sha-256': 'sha256',
  'sha-256-sess': 'sha256'
};

var PARAM = /([a-z0-9_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/gi;

function quote(value) {
  return String(value).replace(/([\\"])/g, '\\$1');
}

/**
 *  @param {String} header - a WWW-Authenticate header value
 *  @param {String} scheme - the scheme to pull out, lowercased
 *  @return {Object|null} the challenge parameters, or null if not offered
 *
 *  A server may offer several schemes in one header, so the parameters have to
 *  be read from the right stretch of it rather than the whole string.
 */
function parseChallenge(header, scheme) {
  if (!header) return null;

  var at = header.search(new RegExp('(^|,)\\s*' + scheme + '\\s', 'i'));
  if (at === -1) return null;

  // Stop at the next scheme, if there is one. A scheme name is a bare token
  // followed by whitespace, which no parameter ever looks like.
  var rest = header.slice(at).replace(new RegExp('^\\s*,?\\s*' + scheme + '\\s+', 'i'), '');
  var nextScheme = rest.search(/,\s*[a-z0-9_-]+\s+[a-z0-9_-]+\s*=/i);
  if (nextScheme !== -1) rest = rest.slice(0, nextScheme);

  var params = {};
  var match;
  PARAM.lastIndex = 0;
  while ((match = PARAM.exec(rest)) !== null) {
    params[match[1].toLowerCase()] = match[2] !== undefined
      ? match[2].replace(/\\(.)/g, '$1')
      : match[3];
  }
  return params;
}

/**
 *  @param {String} username
 *  @param {String} password
 *  @return {String} an Authorization header value
 */
function basic(username, password) {
  return 'Basic ' + Buffer.from(username + ':' + password).toString('base64');
}

/**
 *  @param {Object} params - parsed Digest challenge parameters
 *  @param {Object} options
 *    @param {String} username
 *    @param {String} password
 *    @param {String} method - the request method
 *    @param {String} uri - the request target, exactly as sent on the request line
 *  @return {String|null} an Authorization header value, or null if the
 *    challenge asks for something unsupported
 */
function digest(params, options) {
  var algorithm = (params.algorithm || 'MD5').toLowerCase();
  var hash = ALGORITHMS[algorithm];
  if (!hash) return null;

  function H(input) {
    return crypto.createHash(hash).update(input).digest('hex');
  }

  var realm = params.realm || '';
  var nonce = params.nonce || '';
  var cnonce = crypto.randomBytes(16).toString('hex');
  // The connection is torn down and rebuilt on every reconnect, so a fresh
  // challenge arrives each time and the count never has to advance.
  var nc = '00000001';

  var ha1 = H(options.username + ':' + realm + ':' + options.password);
  if (/-sess$/.test(algorithm)) {
    ha1 = H(ha1 + ':' + nonce + ':' + cnonce);
  }

  var ha2 = H(options.method + ':' + options.uri);

  var qop = null;
  if (params.qop) {
    var offered = params.qop.split(',').map(function(value) { return value.trim(); });
    if (offered.indexOf('auth') === -1) return null;
    qop = 'auth';
  }

  var response = qop
    ? H([ha1, nonce, nc, cnonce, qop, ha2].join(':'))
    : H([ha1, nonce, ha2].join(':'));

  var parts = [
    'username="' + quote(options.username) + '"',
    'realm="' + quote(realm) + '"',
    'nonce="' + quote(nonce) + '"',
    'uri="' + quote(options.uri) + '"',
    'response="' + response + '"'
  ];

  if (params.algorithm) parts.push('algorithm=' + params.algorithm);
  if (qop) {
    parts.push('qop=' + qop);
    parts.push('nc=' + nc);
    parts.push('cnonce="' + cnonce + '"');
  }
  if (params.opaque) parts.push('opaque="' + quote(params.opaque) + '"');

  return 'Digest ' + parts.join(', ');
}

/**
 *  Answer a 401. Digest is preferred when the server offers both.
 *
 *  @param {String} header - the WWW-Authenticate header value
 *  @param {Object} options - as for `digest`
 *  @return {String|null} an Authorization header value, or null if nothing
 *    on offer can be answered
 */
function answer(header, options) {
  var challenge = parseChallenge(header, 'Digest');
  if (challenge) return digest(challenge, options);
  if (parseChallenge(header, 'Basic')) return basic(options.username, options.password);
  return null;
}

module.exports = {
  answer: answer,
  basic: basic,
  digest: digest,
  parseChallenge: parseChallenge
};
