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

var _ = require('lodash');
var expect = require('salinity').expect;

var indigestion = require('../../lib');

function testParser(dir) {
  it('should parse as expected', function (done) {
    indigestion.carelink.parse(fs.createReadStream(dir + '/input.csv'))
      .toArray()
      .subscribe(
      function(e) {
        var expectation = JSON.parse(fs.readFileSync(dir + '/output.json'));

        // Remove the _id field as it gets tedious to change as code changes happen
        var actualsNoId = e.map(function (element) { return _.omit(element, 'id'); });

        expect(actualsNoId).deep.equals(expectation);

        // Assert that we have a number of uniques ids equal to the number of elements
        // This is to make the removal of ids from our verification check a bit more safe
        expect(_.uniq(e, 'id')).length(e.length);

        done();
      },
      function(err) {
        done(err);
      }
    );
  });
}

describe('carelink/parse', function () {
  describe('withSettingsChanges', function(){
    testParser(__dirname + '/../resources/carelink/parse/withSettingsChanges');
  });

  describe('withoutSettingsChanges', function(){
    testParser(__dirname + '/../resources/carelink/parse/withoutSettingsChanges');
  });
});
