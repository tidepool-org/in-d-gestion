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

var fs = require('fs');

var expect = require('salinity').expect;

var indigestion = require('../../lib');

function testParser(dir) {
  it('should parse as expected', function (done) {
    indigestion.carelink.parse(fs.createReadStream(dir + '/input.csv'), { timezone: 'Pacific/Honolulu' })
      .toArray()
      .subscribe(
      function(e) {
        var expectation = JSON.parse(fs.readFileSync(dir + '/output.json'));

        expect(e).deep.equals(expectation);

        done();
      },
      function(err) {
        done(err);
      }
    );
  });
}

describe('carelink/parse', function () {
  describe('staticBasal', function(){
    testParser(__dirname + '/../resources/carelink/parse/staticBasal');
  });

  describe('withSettingsChanges', function(){
    testParser(__dirname + '/../resources/carelink/parse/withSettingsChanges');
  });

  describe('withoutSettingsChanges', function(){
    testParser(__dirname + '/../resources/carelink/parse/withoutSettingsChanges');
  });
});
