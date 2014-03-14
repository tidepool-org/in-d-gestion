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

var fs = require('fs');

function parse (args) {
  var optimist = require('optimist')
    ;
  var content = fs.readFileSync(__dirname + '/usage.txt').toString( );
  var usage = {
    help: {
      description: "Some more details about mmcsv"
    , required: true
    , alias: 'h' 
    }
  };
  var command = args.slice(0, 1).shift( );
  switch (command) {
    case 'fetch':
      content = fs.readFileSync(__dirname + '/fetch.txt').toString( );
      break;
    default:
      break;
  }
  var config = optimist(args)
      .usage(content, usage)
    ;
  config.$0 = 'mmcsv';
  var opts = config.argv;
  opts.help = config.help;

  opts.command = opts._.shift( );
  if (command == 'fetch') {
    opts.username = opts.username || process.env['CARELINK_USERNAME'];
    opts.password = opts.password || process.env['CARELINK_PASSWORD'];
  }

  return opts;
}

module.exports = parse;
