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

var es = require('event-stream');
function fetch (opts) {
  var mmcsv = require('../lib/index.js');
  var out = es.through( );
  if (!opts.username || !opts.password || !opts.days) {
    if (!opts.username) {
      console.error('Missing --username');
    }
    if (!opts.password) {
      console.error('Missing --password');
    }
    if (isNaN(opts.days)) {
      console.error('Set --days to the number of days to fetch');
    }
    console.error(opts.help( ));
    process.exit(1);
  }
  opts.daysAgo = opts.days;
  if (opts.json) {
    out = es.pipeline(out, mmcsv.parse.all( ), es.stringify( ));
  }
  mmcsv.carelink.fetch(opts).pipe(out).pipe(process.stdout);
}
module.exports = fetch;
