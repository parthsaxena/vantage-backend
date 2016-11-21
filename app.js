'use strict';

require('letsencrypt-express').create({

  server: 'https://acme-v01.api.letsencrypt.org/directory'

, email: 'ceo@socifyinc.com'

, agreeTos: true

, approveDomains: [ 'secure.vantage.social', 'www.secure.vantage.social' ]

, app: require('express')().use('/', function (req, res) {
    res.end('Hello, World!');
  })

}).listen(80, 443);
