#!/usr/bin/env node

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

var ingestion = require('../..');
var fs = require('fs');

var argv = require('optimist');
argv = argv
  .usage("$0 [opts] <out.xml>")
  .options('u', {
             alias: 'username',
             describe: 't:connect username (or environment $TCONNECT_USERNAME)',
             default: process.env.TCONNECT_USERNAME
           })
  .options('p', {
             alias: 'password',
             describe: 't:connect password (or environment $TCONNECT_PASSWORD)',
             default: process.env.TCONNECT_PASSWORD
           })
  .options('i', {
             alias: 'interval',
             describe: 'Interval to fetch, overrides daysAgo'
           })
  .options('d', {
             alias: 'days',
             describe: 'Number of recent days to fetch',
             default: 14
           })
  .options('f', {
            alias: 'format',
            describe: 'Retrieve XML or CSV data',
            default: 'XML'
    });
var opts = argv.argv;
opts.name = opts._.shift();
opts.daysAgo = opts.days;
opts.format = opts.format.toUpperCase();
if (!opts.name || !opts.username || !opts.password) {
  argv.showHelp();
  process.exit(1);
}
if (opts.interval != null) {
  console.log('Downloading %s\'s t:connect %s for dates[%s]', opts.username, opts.format, opts.interval);
} else {
  console.log('Downloading %s\'s t:connect %s to include %s days of data.', opts.username, opts.format, opts.days);
}
console.log('Saving %s in %s', opts.format opts.name);
var out = fs.createWriteStream(opts.name);
ingestion.tconnect.fetch(opts, function (err, stream) {
  if (err) {
	console.log('Error:',err);
  } else
  	stream
    	.pipe(out)
    	.on('end', function () {
            console.log('Downloaded', opts.name);
          });
});


