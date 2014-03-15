#!/usr/bin/env node

/*
 * == BSD2 LICENSE ==
 */

var ingestion = require('../..');
var fs = require('fs');

var argv = require('optimist');
argv = argv
  .usage("$0 [opts] <out.xls>")
  .options('u', {
             alias: 'username',
             describe: 'Diasend username (or environment $DIASEND_USERNAME)',
             default: process.env.DIASEND_USERNAME
           })
  .options('p', {
             alias: 'password',
             describe: 'Diasend password (or environment $DIASEND_PASSWORD)',
             default: process.env.DIASEND_PASSWORD
           })
  .options('d', {
             alias: 'days',
             describe: 'Number of recent days to fetch',
             default: 14
           });
var opts = argv.argv;
opts.name = opts._.shift();

if (!opts.name || !opts.username || !opts.password) {
  argv.showHelp();
  process.exit(1);
}

console.log('Downloading %s\'s Animas xls to include %s days of data.', opts.username, opts.days);
console.log('Saving xls in %s', opts.name);
var out = fs.createWriteStream(opts.name);
ingestion.diasend.fetch(opts, function (err, stream) {
  stream
    .pipe(out)
    .on('end', function () {
            console.log('Downloaded', opts.name);
          });
});


