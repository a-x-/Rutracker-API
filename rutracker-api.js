var http = require('http'),
  querystring = require('querystring'),
  fs = require('fs'),
  cheerio = require('cheerio'),
  windows1251 = require('windows-1251'),
  sessionPath = '/tmp/Rutracker-API.json',
  EventEmitter = require('events');

function RutrackerApi(data) {
  this.host = 'rutracker.net';
  this.login_path = '/forum/login.php';
  this.search_path = '/forum/tracker.php';
  this.download_path = '/forum/dl.php';
  this.cookie = null;
  this.parseData = true;

  if (typeof data == 'object' && data.username && data.password) {
    this.username = data.username;
    this.password = data.password;
    this.login();
  }

  return this;
}

RutrackerApi.prototype = new EventEmitter();

RutrackerApi.prototype.login = function(username, password) {
  var postData = querystring.stringify({
    login_username: username || this.username,
    login_password: password || this.password,
    login: 'Вход'
  });

  var options = {
    hostname: this.host,
    port: 80,
    path: this.login_path,
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': postData.length
    }
  };
  
  do {
    if (fs.exists(sessionPath)) {
      if (var session = JSON.parse(fs.readFileSync(sessionPath))) {
        if (Date.now() - session.ts < 1000 * 60 * 60 * 12) { // less then 12 hours old
          this.cookie = session.cooke;
          this.emit('login');
          break;
        }
      }
    }

    var req = http.request(options, function(res) {
      if (res.statusCode == '302') {
        this.cookie = res.headers['set-cookie'][0];
        fs.writeFile(sessionPath, JSON.stringify({ cookie: this.cookie, ts: Date.now() }), ()=>{});
        this.emit('login');
      } else {
        this.emit('login-error');
      }
    }.bind(this));
  } while (false);

  req.on('error', function(err) { this.emit('error', err); }.bind(this));
  req.write(postData);
  req.end();
};

RutrackerApi.prototype.search = function(_query, _callback) {
  if (typeof this.cookie != 'string') {
    throw Error('Unauthorized: Use `login` method first');
  }
  else if (typeof _query == 'undefined') {
    throw TypeError('Expected at least one argument');
  }

  var callback = _callback || function() {},
      query = encodeURIComponent(_query),
      path = this.search_path + '?nm=' + query;

  var options = {
    hostname: this.host,
    port: 80,
    path: path,
    method: 'POST',
    headers: {
      'Cookie': this.cookie
    }
  };

  var that = this;
  var req = http.request(options, function(res) {
    if (res.statusCode == '200') {
      var data = '';
      res.setEncoding('binary');
      res.on('data', function(x) {
        data = data + windows1251.decode(x, {mode: 'html'});
      });
      res.on('end', function() {
        if (that.parseData === true) {
          that.parseSearch(data, callback);
        } else {
          callback(data);
        }
      });
    }
    else {
      throw Error('HTTP code is ' + res.statusCode);
    }
  });

  req.on('error', function(err) { that.emit('error', err); });
  req.end();
};

RutrackerApi.prototype.download = function(_id, _callback) {
  if (typeof this.cookie != 'string') {
    throw Error('Unauthorized: Use `login` method first');
  }
  else if (typeof _id == 'undefined') {
    throw TypeError('Expected at least one argument');
  }

  var callback = _callback || function() {},
      path = this.download_path + '?t=' + _id;

  var options = {
    hostname: this.host,
    port: 80,
    path: path,
    method: 'GET',
    headers: {
      'Cookie': this.cookie
    }
  };

  var that = this;
  var req = http.request(options, function(res) {
    if (res.statusCode == '200') {
          callback(res);
    }
    else {
      throw Error('HTTP code is ' + res.statusCode);
    }
  });

  req.on('error', function(err) { that.emit('error', err); });
  req.end();
};


RutrackerApi.prototype.parseSearch = function(rawHtml, callback) {
  var $ = cheerio.load(rawHtml, {decodeEntities: false}),
      tracks = $('#tor-tbl tbody').find('tr'),
      results = [],
      length = tracks.length,
      bytes_in_gigabyte = 1024 * 1024 * 1024;

  for (var i = 0; i < length; i++) {
    // Ah-m... Couldn't find any better method
    var document = tracks.find('td'),
        state    = document.next(),
        category = state.next(),
        title    = category.next(),
        author   = title.next(),
        size     = author.next(),
        seeds    = size.next(),
        leechs   = seeds.next();

    results.push({
      state    : state.attr('title'),
      id       : title.find('div a').attr('data-topic_id'),
      category : category.find('.f-name a').html(),
      title    : title.find('div a ').html(),
      author   : author.find('div a ').html(),
      size_h   : formatSize( size.find('*').html() ),
      size_b   : size.find('*').html(),
      seeds    : seeds.find('b').html(),
      leechs   : leechs.find('b').html(),
      url      : 'http://' + this.host + '/forum/' + title.find('div a').attr('href')
    });

    tracks = tracks.next();
  }

  // Handle case where search has no results
  results = results.filter(function(x) {
    return typeof x.id !== 'undefined';
  });

  if (callback) {
    callback(results);
  } else {
    return results;
  }

  function formatSize(size_in_bytes) {
    var size_in_megabytes = size_in_bytes / (1000 * 1000 * 1000);
    return ('' + size_in_megabytes).slice(0, 4) + ' GB';
  }
};

module.exports = RutrackerApi;
