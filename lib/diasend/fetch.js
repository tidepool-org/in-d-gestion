/*
 * == BSD2 LICENSE ==
 */

var async = require('async');
var moment = require('moment');
var request = require('request');

var DIASEND_URLS = {
  login: "https://international.diasend.com/diasend1/login.php",
  view: "https://international.diasend.com/diasend1/view.php",
  xls: "https://international.diasend.com/diasend1/excel.php"
};

module.exports = function (opts, cb) {
  var jar = request.jar();

  async.series(
    [
      function(done) {
        var o = {
          jar: jar,
          url: DIASEND_URLS.login,
          form: {
            user: opts.username,
            passwd: opts.password
          }
        };

        request.post(o, function(err, res, body){ done(err); });
      },
      function(done) {
        var m = moment();
        var o = {
          url: DIASEND_URLS.view,
          jar: jar,
          qs: {
            period: 'arbitrary',
            endtime: m.format('YYYY-MM-DD'),
            starttime: m.subtract('days', opts.days || 14).format('YYYY-MM-DD')
          }
        };
        request.get(o, function(err, res, body){ return done(err); });
      }
    ],
    function(err) {
      if (err != null) {
        return cb(done);
      }
      return cb(null, request.get({url: DIASEND_URLS.xls, jar: jar}));
    }
  );
};