/*
 * == BSD2 LICENSE ==
 * Copyright (c) 2014, Tidepool Project
 * 
 * This program is free software; you can redistribute it and/or modify it under
 * the terms of the associated License, which is identical to the BSD 2-Clause
 * License as published by the Open Source Initiative at opensource.org.
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
 * FOR A PARTICULAR PURPOSE. See the License for more details.
 * 
 * You should have received a copy of the License along with this program; if
 * not, you can obtain one from Tidepool Project at tidepool.org.
 * == BSD2 LICENSE ==
 */
'use strict';

var async = require('async');
var moment = require('moment');
var request = require('request');

var DIASEND_URLS = {
  login: 'https://international.diasend.com/diasend1/login.php',
  view: 'https://international.diasend.com/diasend1/view.php',
  xls: 'https://international.diasend.com/diasend1/excel.php'
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
            starttime: m.subtract('days', opts.daysAgo || 14).format('YYYY-MM-DD')
          }
        };
        request.get(o, function(err, res, body){ return done(err); });
      }
    ],
    function(err) {
      if (err != null) {
        return cb(err);
      }
      return cb(null, request.get({url: DIASEND_URLS.xls, jar: jar}));
    }
  );
};