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

var common = require('common');
var misc = require('../misc.js');
var moment = require('moment');
var Readable = require('stream').Readable;
var request = require('request');
var sax = require('sax');
var util = require('util');
var viewstate = require('ms-viewstate');
var zlib = require('zlib');

/* These are hard-coded values that appear to be the same for all users.  They "feel" like
   MD5 hashes, but I suspect the reality is that someone didn't "get" auth tokens and was
   phoning it in when they implemented this. */
var TNS_USER = '0x8a60f8b3ee03a8b4c26124af165cc912';
var TNS_PASSWORD = '0xd3082c35ee455112a13bb6786719b8fb';

var TCONNECT_URLS = {
  cookie: 'https://tconnect.tandemdiabetes.com/',
  login: 'https://tconnect.tandemdiabetes.com/Login.aspx',
  soap: 'http://tconnectws.tandemdiabetes.com/TMSSecureGraphData.asmx',
};

var SOAP_BODY = '<?xml version=\'1.0\' encoding=\'UTF-8\'?>\n' +
                 '<SOAP-ENV:Envelope xmlns:SOAP-ENV=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:s=\"http://www.w3.org/2001/XMLSchema\" ' +
                 'xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">' +
                   '<SOAP-ENV:Header>' +
                     '<tns:SecuredWebServiceHeader xmlns:tns=\"http://www.tandemdiabetes.com/\">' +
                       '<tns:username>' + TNS_USER + '</tns:username>' +
                       '<tns:password>' + TNS_PASSWORD + '</tns:password>' +
                       '<tns:authenticatedToken>%s</tns:authenticatedToken>' +
                     '</tns:SecuredWebServiceHeader>' +
                   '</SOAP-ENV:Header>' +
                   '<SOAP-ENV:Body>' +
                        '%s' +
                   '</SOAP-ENV:Body>' +
                 '</SOAP-ENV:Envelope>';
var AUTHENTICATE_USER_REQUEST = '<tns:AuthenticateUser xmlns:tns=\"http://www.tandemdiabetes.com/\"/>';
var GET_THERAPY_DATA_BY_USER_ID_REQUEST = '<tns:GetTherapyDataByUserID xmlns:tns=\"http://www.tandemdiabetes.com/\">' +
                                                 '<tns:userID>%s</tns:userID>' +
                                                 '<tns:fromDate>%s</tns:fromDate>' +
                                                 '<tns:toDate>%s</tns:toDate>' +
                                                 '<tns:returnFormat>%s</tns:returnFormat>' +
                                               '</tns:GetTherapyDataByUserID>';

// The GetProfileByUserID request returns a link to a web page that can be scraped for pump settings.
// I can go ahead and pull it, but it might be better to reach out to Tandem and see whether anything better
// can be done.
/*
var GET_PROFILE_BY_USER_ID_REQUEST = '<tns:GetProfileByUserID xmlns:tns=\"http://www.tandemdiabetes.com/\">' +
                                                                                      '<tns:userID>%s</tns:userID>' +
                                                                                    '</tns:GetProfileByUserID>';
*/
function defaultOptions(jar) {
  return  {
    jar: jar,
    followRedirect: false,
    headers: {
      'User-Agent':'curl/7.3.0',
      Accept: '*/*'}
  };
}

function conditionallyDecompress(response, next) {
        var encoding = response.headers['content-encoding'];

        if (encoding == 'gzip') {
            next(null, response.pipe(zlib.createGunzip()));
        } else {
            next(null, response);
        }
}

function extractField(response, fieldName) {
        // liberate result from SOAP encapsulation
        var saxStream = sax.createStream(false, response);
        var currentTag;
        var rs = new Readable();

        rs._read = function () {};
        saxStream.on('opentag', function(node) {
            currentTag = node.name;
        });
        saxStream.on('text', function(text) {
            if (currentTag == fieldName) {
                rs.push(text);
            }
        });
        saxStream.on('end', function(text) {
            rs.push(null);
        });

        response.pipe(saxStream);
        return rs;
}

module.exports = function (opts, cb) {

  if (opts.interval == null) {
    var m = moment();
    m.subtract('ms', misc.computeMillisInCurrentDay(m)).add('days', 1);
    opts.interval = util.format('%s/%s',
            m.clone().subtract('days', opts.daysAgo || 14).format('YYYY-MM-DD'),
            m.format('YYYY-MM-DD'));
  }

  var jar = request.jar();
  var UserGUID = null;
  var AuthToken = null;

  common.step(
    [
      function (next) {
        // first fetch to get viewstate and eventValidation fields
        request.get(TCONNECT_URLS.login, defaultOptions(jar), next);
      },

      function (response, next) {
        // actual login
        var viewState = viewstate.extractVs(response.body);
        var eventValidation = viewstate.extractEv(response.body);
        var reqOptions = defaultOptions(jar);
        var req = request.post(TCONNECT_URLS.login, reqOptions, next).form({
            __LASTFOCUS: '',
            __EVENTTARGET: 'ctl00$ContentBody$LoginControl$linkLogin',
            __EVENTARGUMENT:'',
            __VIEWSTATE: viewState,
            __EVENTVALIDATION: eventValidation,
            ctl00$ContentBody$LoginControl$txtLoginEmailAddress:opts.username,
            txtLoginEmailAddress_ClientState:util.format('{"enabled":true,"emptyMessage":"","validationText":"%s","valueAsString":"%s"}',opts.username,opts.username),
            ctl00$ContentBody$LoginControl$txtLoginPassword:opts.password,
            txtLoginPassword_ClientState:util.format('{"enabled":true,"emptyMessage":"","validationText":"%s","valueAsString":"%s"}',opts.password, opts.password)
        });
        req.setHeader('Accept-Encoding', 'gzip');
        req.setHeader('Content-Length', Buffer.byteLength(req.body, 'utf8')); // 403 if content-length is not set
      },

      function (response, next) {
        //  fetch auth token
        var guidString = jar.getCookieString('https://tconnect.tandemdiabetes.com/').match(/UserGUID=([^;]*)/);
        if(guidString) {
            UserGUID = guidString[1];
        } else
            next('Authentication Failed', null);

        var reqOptions = defaultOptions(jar);
        var req = request.post(TCONNECT_URLS.soap, reqOptions, next);

        req.body = util.format(SOAP_BODY, '', AUTHENTICATE_USER_REQUEST);
        req.setHeader('Content-Type', 'text/xml');
        req.setHeader('Content-Length', Buffer.byteLength(req.body, 'utf8'));
      },

      function (response, next) {
        // fetch actual data
        var authMatch = response.body.match(/<AuthenticateUserResult>([0-9a-f-]*)<\/AuthenticateUserResult>/);

        if (authMatch) {
            var intervalSplits = opts.interval.split('/');
            var startTime = moment(intervalSplits[0]).format('YYYY-MM-DD 00:00:00');
            var endTime =  moment(intervalSplits[1]).format('YYYY-MM-DD 23:59:59');
            var reqOptions = defaultOptions(jar);
            var req = request.post(TCONNECT_URLS.soap, reqOptions);

            AuthToken = authMatch[1];
            //req.body = util.format(SOAP_BODY, AuthToken, util.format(GET_PROFILE_BY_USER_ID_REQUEST, UserGUID));
            req.body = util.format(SOAP_BODY, AuthToken, util.format(GET_THERAPY_DATA_BY_USER_ID_REQUEST, UserGUID, startTime, endTime, 'XML'));
            req.setHeader('Content-Type', 'text/xml');
            req.setHeader('Accept-Encoding', 'gzip');
            req.setHeader('Content-Length', Buffer.byteLength(req.body, 'utf8'));
            req.on('response', function(res) {
                next(null,res);
            });
                req.on('error', function(res) {
                cb('Error fetching data', res);
            });
        } else {
            next('Unable to obtain session token', null);
        }
      },

      function (response, next) {
        conditionallyDecompress(response, next);
      },

      function (response, next) {
        cb(null, extractField(response, 'GETTHERAPYDATABYUSERIDRESULT'));
      }
    ],
    cb
  );
};
