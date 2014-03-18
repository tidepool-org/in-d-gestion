var parsing = require('../parsing.js');

function extractBgUnits(selector) {
  return parsing.map(selector, function (e) { return e === 'mg dl' ? 'mg dL' : e; });
}

var parserBuilder = parsing.parserBuilder();

parserBuilder
    .whenFieldIs('sheetName', 'Name and glucose')
    .applyConversion({
                       type: 'smbg',
                       deviceTime: parsing.extract('deviceTime'),
                       value: parsing.asNumber('value'),
                       units: extractBgUnits('units'),
                       deviceId: parsing.extract('deviceId')
                     })
    .done()
    .whenFieldIs('sheetName', 'CGM')
    .applyConversion({
                       type: 'cbg',
                       deviceTime: parsing.extract('deviceTime'),
                       value: parsing.asNumber('value'),
                       units: parsing.extract('units'),
                       deviceId: parsing.extract('deviceId')
                     })
    .done()
    .whenFieldIs('sheetName', 'Insulin use and carbs').newBuilder()
        .whenFieldIsDefined('Basal Amount (U/h)')
        .applyConversion({
                           type: 'basal-rate-change',
                           deviceTime: parsing.extract('deviceTime'),
                           value: parsing.asNumber('Basal Amount (U/h)'),
                           deviceId: parsing.extract('deviceId')
                         })
        .done()
        .whenFieldIsDefined('Carbs(g)')
        .applyConversion({
                           type: 'wizard',
                           deviceTime: parsing.extract('deviceTime'),
                           deviceId: parsing.extract('deviceId'),
                           payload: {
                             carbInput: parsing.asNumber('Carbs(g)'),
                             carbUnits: 'grams'
                           }
                         })
        .done()
        .whenFieldIs('Bolus Type', 'Normal')
        .applyConversion({
                           type: 'bolus',
                           subType: 'normal',
                           deviceTime: parsing.extract('deviceTime'),
                           value: parsing.asNumber('Bolus Volume (U)'),
                           deviceId: parsing.extract('deviceId')
                         })
        .done()
        .whenFieldIs('Bolus Type', 'Combination')
        .applyConversion({
                           type: 'bolus',
                           subType: 'square',
                           deviceTime: parsing.extract('deviceTime'),
                           value: parsing.asNumber('Bolus Volume (U)'),
                           immediate: parsing.asNumber('Immediate Volume (U)', 0),
                           extended: parsing.asNumber('Extended Volume (U)', 0),
                           duration: parsing.asNumber('Duration (min)'),
                           deviceId: parsing.extract('deviceId')
                         })
        .done()
        .build();

var parser = parserBuilder.build();

module.exports = function (e) {
  if (e.type == null) {
    return parser(e);
  }
  return e;
}

