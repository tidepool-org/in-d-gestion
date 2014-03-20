/*
 * == BSD2 LICENSE ==
 */

var _ = require('lodash');
var except = require('amoeba').except;

module.exports = function (observable) {
  var currTemp = null;
  return observable.keep(
    function (e) {
      if (e.type === 'basal' && e.deliveryType === 'temp') {
        if (e.duration === 0) {
          if (currTemp == null) {
            return null;
          } else {
            var theTemp = currTemp;
            currTemp = null;
            return _.assign(
              _.pick(e, 'type', 'deviceTime', 'deviceId', 'source'),
              {
                deliveryType: 'temp-stop',
                tempId: theTemp.id
              }
            );
          }
        } else {
          currTemp = e;
          return e;
        }
      } else {
        return e;
      }
    }
  );
};