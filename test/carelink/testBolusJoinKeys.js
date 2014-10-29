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

/* jshint expr: true */

var expect = require('salinity').expect;
var rx = require('rx');

var bolusJoiner = require('../../lib/carelink/bolusJoiner.js');

var expectSuccess = [
  [
    'joins normal bolus with wizard',
    [
      { type: 'bolus', subType: 'normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' }
    ],
    [
      { type: 'bolus', subType: 'normal', payload: 'something', deviceId: 'abc', joinKey: '9fhgr60koraej00e1knajr4vm07fl23r' },
      { type: 'wizard', payload: 'a_value', deviceId: 'abc', joinKey: '9fhgr60koraej00e1knajr4vm07fl23r' }
    ]
  ],
  [
    'buffers and returns events that don\'t match the current normal',
    [
      { type: 'bolus', subType: 'normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '2', uploadSeqNum: 24, deviceId: 'abc' }
    ],
    [
      { type: 'bolus', subType: 'normal', payload: 'something', deviceId: 'abc', joinKey: '9fhgr60koraej00e1knajr4vm07fl23r' },
      { type: 'wizard', payload: 'a_value', deviceId: 'abc', joinKey: '5h1f55ln8uek4pkmqc2c1e6prkbvs5q1' }
    ]
  ],
  [
    'joins square bolus with wizard',
    [
      { type: 'bolus', subType: 'square', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' }
    ],
    [
      { type: 'bolus', subType: 'square', payload: 'something', deviceId: 'abc', joinKey: '9fhgr60koraej00e1knajr4vm07fl23r' },
      { type: 'wizard', payload: 'a_value', deviceId: 'abc', joinKey: '9fhgr60koraej00e1knajr4vm07fl23r' }
    ]
  ],
  [
    'buffers and returns events that don\'t match the current square',
    [
      { type: 'bolus', subType: 'square', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '2', uploadSeqNum: 24, deviceId: 'abc' }
    ],
    [
      { type: 'bolus', subType: 'square', payload: 'something', deviceId: 'abc', joinKey: '9fhgr60koraej00e1knajr4vm07fl23r' },
      { type: 'wizard', payload: 'a_value', deviceId: 'abc', joinKey: '5h1f55ln8uek4pkmqc2c1e6prkbvs5q1' }
    ]
  ],
  [
    'joins dual/normal bolus with dual/square and wizard, normal -> square -> wizard',
    [
      { type: 'bolus', subType: 'dual/normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' },
      { type: 'bolus', subType: 'dual/square', payload: '1234', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 25, deviceId: 'abc' }
    ],
    [
      { type: 'bolus', subType: 'dual/square', payload: 'something', deviceId: 'abc', joinKey: '9fhgr60koraej00e1knajr4vm07fl23r' },
      { type: 'wizard', payload: 'a_value', deviceId: 'abc', joinKey: '9fhgr60koraej00e1knajr4vm07fl23r' }
    ]
  ],
  [
    'on just dual/square and wizard, fabricates dual/normal and joins them, bolus -> wizard',
    [
      { type: 'bolus', subType: 'dual/square', payload: '1234', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 25, deviceId: 'abc' }
    ],
    [
      { type: 'bolus', subType: 'dual/square', payload: '1234', deviceId: 'abc', joinKey: 'sk9lk5f1fd6ofgcugjlcdu0n98hqecc7', value: 0, programmed: 0 },
      { type: 'wizard', payload: 'a_value', deviceId: 'abc', joinKey: 'sk9lk5f1fd6ofgcugjlcdu0n98hqecc7' }
    ]
  ],
  [
    'on just dual/square and wizard, fabricates dual/normal and joins them, wizard -> bolus',
    [
      { type: 'bolus', subType: 'dual/square', payload: '1234', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 25, deviceId: 'abc' }
    ],
    [
      { type: 'bolus', subType: 'dual/square', payload: '1234', deviceId: 'abc', joinKey: 'sk9lk5f1fd6ofgcugjlcdu0n98hqecc7', value: 0, programmed: 0 },
      { type: 'wizard', payload: 'a_value', deviceId: 'abc', joinKey: 'sk9lk5f1fd6ofgcugjlcdu0n98hqecc7' }
    ]
  ]
];

var expectFailure = [
  [
    'joins normal bolus with wizard, wizard first',
    [
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' },
      { type: 'bolus', subType: 'normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' }
    ]
  ],
  [
    'joins square bolus with wizard, wizard first',
    [
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' },
      { type: 'bolus', subType: 'square', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' }
    ]
  ],
  [
    'joins dual/normal bolus with dual/square and wizard, normal -> wizard -> square',
    [
      { type: 'bolus', subType: 'dual/normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 25, deviceId: 'abc' },
      { type: 'bolus', subType: 'dual/square', payload: '1234', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' }
    ]
  ],
  [
    'joins dual/normal bolus with dual/square and wizard, square -> normal -> wizard',
    [
      { type: 'bolus', subType: 'dual/square', payload: '1234', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' },
      { type: 'bolus', subType: 'dual/normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 25, deviceId: 'abc' }
    ]
  ],
  [
    'joins dual/normal bolus with dual/square and wizard, square -> wizard -> normal',
    [
      { type: 'bolus', subType: 'dual/square', payload: '1234', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' },
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 25, deviceId: 'abc' },
      { type: 'bolus', subType: 'dual/normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' }
    ]
  ],
  [
    'joins dual/normal bolus with dual/square and wizard, wizard -> square -> normal',
    [
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 25, deviceId: 'abc' },
      { type: 'bolus', subType: 'dual/square', payload: '1234', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' },
      { type: 'bolus', subType: 'dual/normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' }
    ]
  ],
  [
    'joins dual/normal bolus with dual/square and wizard, wizard -> normal -> square',
    [
      { type: 'wizard', payload: 'a_value', uploadId: '1', uploadSeqNum: 25, deviceId: 'abc' },
      { type: 'bolus', subType: 'dual/normal', payload: 'something', uploadId: '1', uploadSeqNum: 23, deviceId: 'abc' },
      { type: 'bolus', subType: 'dual/square', payload: '1234', uploadId: '1', uploadSeqNum: 24, deviceId: 'abc' }
    ]
  ]
];

describe('carelink/bolusJoiner.js', function () {
  describe('success!?', function(){
    expectSuccess.forEach(function (test) {
      it(test[0], function (done) {
        function expectation(results) {
          expect(results).deep.equals(test[2]);
          done();
        }

        rx.Observable.fromArray(test[1])
          .apply(bolusJoiner)
          .toArray()
          .subscribe(expectation, done);
      });
    });
  });

  describe('it should fail, no really!', function(){
    expectFailure.forEach(function (test) {
      it(test[0], function (done) {


        rx.Observable.fromArray(test[1])
          .apply(bolusJoiner)
          .toArray()
          .subscribe(
            function(results) {
              done(new Error('Shouldn\'t have results on an expected fail test'));
            },
            function (err) {
              expect(err).to.exist;
              done();
            }
        );
      });
    });
  });
});