in-d-gestion
============

Library for ingestion of data from various vendor-specific sources into the Tidepool.org platform for diabetes data 

## Looking at the code

Primary entry-point is `lib/index.js`.

Parsing and fetching code is broken down by vendor-specific objects on the thing returned from `lib/index.js`.

That is currently just carelink right now.

Easiest way to see how to use the parser is to look at `test/carelink/testParser.js`

### Libraries to be aware of

The code leverages the Rx library pretty extensively for stream processing.  There is a lot to this library.  You can read about its philosophy at http://reactive-extensions.github.io/RxJS/ or its documentation at https://github.com/Reactive-Extensions/RxJS/tree/master/doc

We implement a few extensions to it in the `lib/rx` directory.  These extensions are added to the `rx.Observable.prototype`, so the usage can appear the same as if we are using a native rx method.  If you are trying to figure out what a method does and you are unfamiliar with it/you cannot find the docs for it on the main RxJS page, make sure to check the various extensions under `lib/rx`.

## Command Line

### Fetch
You can fetch raw data from carelink with

```bash
./bin/mmcsv fetch -u <username> -p <password> -d <num_days> stdout
```

### Parse
You can parse raw data fetched from carelink with

``` bash
node bin/parse.js <csv_file_to_parse>
```

