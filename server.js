'use strict';
var express = require('express');
var bodyParser = require('body-parser');
var https = require('https');
var fs = require('fs');
var firebase = require('firebase');
var nodemailer = require('nodemailer');

var PORT = 80;
var LOG_FILE = './logs/main.log';

// LOG VALUES
// [0] = Server Started
// [1] = Transfer of coins has been requested
// [2] = Error while transferring coins
// [3] = Received request to get amount of coins
// [4] = Error while getting amount of coins
// [5] = Received request to get list of available gift cards
// [6] = RECEIVED REQUEST TO PURCHASE GIFT CARD
// [7] = Input value for video ad timing

firebase.initializeApp({
  serviceAccount: "./firebase/vantage.json",
  databaseURL: "https://vantage-e9003.firebaseio.com"
});
var db = firebase.database();

var lex = require('letsencrypt-express').create({
  server: 'staging'
, key: fs.readFileSync("/etc/letsencrypt/archive/secure.vantage.social/privkey1.pem")
, cert: fs.readFileSync("/etc/letsencrypt/archive/secure.vantage.social/fullchain1.pem")
, ca: fs.readFileSync("/etc/letsencrypt/archive/secure.vantage.social/chain1.pem")
, challenges: { 'http-01': require('le-challenge-fs').create({ webrootPath: '/tmp/acme-challenges' }) }
, store: require('le-store-certbot').create({ webrootPath: '/tmp/acme-challenges' })
, approveDomains: approveDomains
});

var app = require('express')();

require('http').createServer(lex.middleware(require('redirect-https')())).listen(80, function () {
  console.log("Listening for ACME http-01 challenges on", this.address());
});

require('https').createServer(lex.httpsOptions, lex.middleware(app)).listen(443, function () {
  console.log("Listening for ACME tls-sni-01 challenges and serve app on", this.address());
});

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

var success = "Successfully completed transfer of coins.";

app.post('/transfer_coins.php', function(request, response) {
  printLog("[1] Transfer of coins has been requested");

  var uidOne = request.body.uidOne;
  var uidTwo = request.body.uidTwo;
  var amount = request.body.amount;
  var inquiryID = request.body.inquiryID;

  var hasCallbackBeenCalled = false;
  verifyTransfer(uidOne, uidTwo, amount, inquiryID, function(result)  {
      if (hasCallbackBeenCalled == false) {
        response.write(result);
        response.end();
          hasCallbackBeenCalled = true;
      }
  });
});

app.post('/get_coins.php', function(request, response) {
  printLog("[2] Received request to get amount of coins");

  var uidQuery = request.body.uid;
  checkUID(uidQuery, function(result)  {
    response.send(result);
  });
});

app.post('/get_giftcard_list.php', function(request, response) {
    printLog("[5] Received request to get list of available gift cards");
    var ref = db.ref("/giftcards/");
    ref.once("value", function(snapshot) {
        //console.log(snapshot.val());
        var key = []
        var count = []
        var array = {};
        snapshot.forEach(function(item) {
            var itemKey = item.key
            var itemVal = item.val()
            if (itemVal == "") {
                // no gift cards available
                key.push(itemKey);
                count.push(0);
            } else {
                var partsOfString = itemVal.split(',');
                key.push(itemKey);
                count.push(partsOfString.length);
            }
        });
        var array = {};
        array.keys = key
        array.counts = count
        JSON.stringify(array);
        console.log(array);
        response.send(array);
    }, function(errorObject) {
       response.write("Error");
    });
    //response.end();
});

app.post('/purchase_giftcard.php', function(request, response) {
    printLog("[6] RECEIVED REQUEST TO PURCHASE GIFT CARD");
    var uidQuery = request.body.uid;
    var giftCardKey = request.body.giftCardKey;
    checkUID(uidQuery, function(result) {
       if (result >= 100) {
           // user has enough coins
           var ref = db.ref("/giftcards");
           ref.once("value", function(snapshot) {
               var giftCardString = "";
               var val = [];
               var foundGiftCard = false
              snapshot.forEach(function(item) {
                 if (item.key == giftCardKey) {
                     // found gift card key
                     if (foundGiftCard == false) {
                        var itemVal = item.val()
                        if (itemVal == "") {
                            // no gift cards available
                            response.send("Error");
                        } else {
                            giftCardString = itemVal;
                            var partsOfString = itemVal.split(',');
                            val.push(partsOfString[0]);
                            foundGiftCard = true;
                        }
                     }
                 }
              });
              if (foundGiftCard == true) {
                  // found gift card
                  console.log(val[0]);
                  var userRef = db.ref("/users/" + uidQuery);
                  userRef.once("value", function(snapshot) {
                     var email = snapshot.val()["email"];
                     var code = val[0];
                     emailCode(giftCardKey, code, email);
                      subtractCoins(100, uidQuery);

                      // remove gift card from string
                      var gcRef = db.ref("/giftcards/");
                      gcRef.once("value", function(snapshot) {
                      	var codes = snapshot.val()[giftCardKey];
                      	var partsOfCodes = codes.split(",");
                      	var newString = ""
                      	for (var i = 0; i < partsOfCodes.length; i++) {
                      		if (i == 0) {
                      			// ignore
                      		} else {
                      			if (i == 1) {
                      				newString += partsOfCodes[i];
                      			} else {
                      				newString += "," + partsOfCodes[i];
                      			}
                      		}
                      	}
                      	var obj = {};
                      	obj[giftCardKey] = newString;
	                      gcRef.update(obj);
	                      response.send("Success");
                      });
                  });
              } else {
                  response.send("Error");
              }
           });
       } else {
       		// not enough coins
       		response.send("Not enough coins");
       }
    });
});

app.get('/get.php', function(request, response) {
  response.setHeader(200, {"Content-Type": "text/html"});
  response.write("<html>Coins System Node.js Backend API</html>");
  response.end();
});

app.post('/put_video_ad_time.php', function(request, response) {
	var uid = request.body.uid;
	var time = request.body.time;
	var coinRef = db.ref("/coins/" + uid);
	coinRef.once("value", function(snapshot) {
		var coins = snapshot.val()["coins"];
		var obj = {};
		obj["coins"] = coins;
		obj["videoAdUnixEpochTime"] = time;
		coinRef.update(obj);
		response.send("Success");
	});
});

app.post('/get_video_ad_time.php', function(request, response) {
	var uid = request.body.uid;
	var coinRef = db.ref("/coins/" + uid);
	coinRef.once("value", function(snapshot) {
		var timestamp = snapshot.val()["videoAdUnixEpochTime"];
		response.send(timestamp);
	});
});

app.post('/request_five_coins.php', function(request, response) {
	var uid = request.body.uid;
	var time = request.body.time;
	var coinRef = db.ref("/coins/" + uid);
	coinRef.once("value", function(snapshot) {
		var timestamp = snapshot.val()["videoAdUnixEpochTime"];
		if (time == timestamp) {
			console.log("timestamps are the same");
			var coinRef = db.ref("/coins/" + uid);
			coinRef.once("value", function(snapshot) {
				var coins = snapshot.val()["coins"];
				var timestamp = snapshot.val()["videoAdUnixEpochTime"]
				var obj = {};
				obj["coins"] = coins + 5;
				obj["videoAdUnixEpochTime"] = timestamp;
				coinRef.update(obj);
				response.send("Success");
			});
		} else {
			console.log("timestamps are not the same, SERVER TIME: " + timestamp + ", SENT TIME: " + request.body.time);
			response.send("Error");
		}
	});
});

function emailCode(key, code, emailTo) {
    // create reusable transporter object using the default SMTP transport
var transporter = nodemailer.createTransport('smtps://ceo@socifyinc.com:ApachESc4pt3R6363@smtp.gmail.com');

// setup e-mail data with unicode symbols
var mailOptions = {
    from: '"Vantage Support" <ceo@socifyinc.com>', // sender address
    to: '"' + emailTo + '"' + ', <' + emailTo + '>', // list of receivers
    subject: 'Your Gift Card Code - Vantage', // Subject line
    html: '<!doctype html><html> <head> <meta name="viewport" content="width=device-width"> <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"> <title>Simple Transactional Email</title> <style> /* ------------------------------------- GLOBAL RESETS ------------------------------------- */ img { border: none; -ms-interpolation-mode: bicubic; max-width: 100%; } body { background-color: #f6f6f6; font-family: sans-serif; -webkit-font-smoothing: antialiased; font-size: 14px; line-height: 1.4; margin: 0; padding: 0; -ms-text-size-adjust: 100%; -webkit-text-size-adjust: 100%; } table { border-collapse: separate; mso-table-lspace: 0pt; mso-table-rspace: 0pt; width: 100%; } table td { font-family: sans-serif; font-size: 14px; vertical-align: top; } /* ------------------------------------- BODY & CONTAINER ------------------------------------- */ .body { background-color: #f6f6f6; width: 100%; } /* Set a max-width, and make it display as block so it will automatically stretch to that width, but will also shrink down on a phone or something */ .container { display: block; Margin: 0 auto !important; /* makes it centered */ max-width: 580px; padding: 10px; width: auto !important; width: 580px; } /* This should also be a block element, so that it will fill 100% of the .container */ .content { box-sizing: border-box; display: block; Margin: 0 auto; max-width: 580px; padding: 10px; } /* ------------------------------------- HEADER, FOOTER, MAIN ------------------------------------- */ .main { background: #fff; border-radius: 3px; width: 100%; } .wrapper { box-sizing: border-box; padding: 20px; } .footer { clear: both; padding-top: 10px; text-align: center; width: 100%; } .footer td, .footer p, .footer span, .footer a { color: #999999; font-size: 12px; text-align: center; } /* ------------------------------------- TYPOGRAPHY ------------------------------------- */ h1, h2, h3, h4 { color: #000000; font-family: sans-serif; font-weight: 400; line-height: 1.4; margin: 0; Margin-bottom: 30px; } h1 { font-size: 35px; font-weight: 300; text-align: center; text-transform: capitalize; } p, ul, ol { font-family: sans-serif; font-size: 14px; font-weight: normal; margin: 0; Margin-bottom: 15px; } p li, ul li, ol li { list-style-position: inside; margin-left: 5px; } a { color: #3498db; text-decoration: underline; } /* ------------------------------------- BUTTONS ------------------------------------- */ .btn { box-sizing: border-box; width: 100%; } .btn > tbody > tr > td { padding-bottom: 15px; } .btn table { width: auto; } .btn table td { background-color: #ffffff; border-radius: 5px; text-align: center; } .btn a { background-color: #ffffff; border: solid 1px #3498db; border-radius: 5px; box-sizing: border-box; color: #3498db; cursor: pointer; display: inline-block; font-size: 14px; font-weight: bold; margin: 0; padding: 12px 25px; text-decoration: none; text-transform: capitalize; } .btn-primary table td { background-color: #3498db; } .btn-primary a { background-color: #3498db; border-color: #3498db; color: #ffffff; } /* ------------------------------------- OTHER STYLES THAT MIGHT BE USEFUL ------------------------------------- */ .last { margin-bottom: 0; } .first { margin-top: 0; } .align-center { text-align: center; } .align-right { text-align: right; } .align-left { text-align: left; } .clear { clear: both; } .mt0 { margin-top: 0; } .mb0 { margin-bottom: 0; } .preheader { color: transparent; display: none; height: 0; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; mso-hide: all; visibility: hidden; width: 0; } .powered-by a { text-decoration: none; } hr { border: 0; border-bottom: 1px solid #f6f6f6; Margin: 20px 0; } /* ------------------------------------- RESPONSIVE AND MOBILE FRIENDLY STYLES ------------------------------------- */ @media only screen and (max-width: 620px) { table[class=body] h1 { font-size: 28px !important; margin-bottom: 10px !important; } table[class=body] p, table[class=body] ul, table[class=body] ol, table[class=body] td, table[class=body] span, table[class=body] a { font-size: 16px !important; } table[class=body] .wrapper, table[class=body] .article { padding: 10px !important; } table[class=body] .content { padding: 0 !important; } table[class=body] .container { padding: 0 !important; width: 100% !important; } table[class=body] .main { border-left-width: 0 !important; border-radius: 0 !important; border-right-width: 0 !important; } table[class=body] .btn table { width: 100% !important; } table[class=body] .btn a { width: 100% !important; } table[class=body] .img-responsive { height: auto !important; max-width: 100% !important; width: auto !important; }} /* ------------------------------------- PRESERVE THESE STYLES IN THE HEAD ------------------------------------- */ @media all { .ExternalClass { width: 100%; } .ExternalClass, .ExternalClass p, .ExternalClass span, .ExternalClass font, .ExternalClass td, .ExternalClass div { line-height: 100%; } .apple-link a { color: inherit !important; font-family: inherit !important; font-size: inherit !important; font-weight: inherit !important; line-height: inherit !important; text-decoration: none !important; } .btn-primary table td:hover { background-color: #34495e !important; } .btn-primary a:hover { background-color: #34495e !important; border-color: #34495e !important; } } </style> </head> <body class="" style="background-color: #f6f6f6;font-family: sans-serif;-webkit-font-smoothing: antialiased;font-size: 14px;line-height: 1.4;margin: 0;padding: 0;-ms-text-size-adjust: 100%;-webkit-text-size-adjust: 100%;"> <table border="0" cellpadding="0" cellspacing="0" class="body" style="border-collapse: separate;mso-table-lspace: 0pt;mso-table-rspace: 0pt;width: 100%;background-color: #f6f6f6;"> <tr> <td style="font-family: sans-serif;font-size: 16px !important;vertical-align: top;">&nbsp;</td> <td class="container" style="font-family: sans-serif;font-size: 16px !important;vertical-align: top;display: block;max-width: 580px;padding: 0 !important;width: 100% !important;margin: 0 auto !important;"> <div class="content" style="box-sizing: border-box;display: block;margin: 0 auto;max-width: 580px;padding: 0 !important;"><br> <!-- START CENTERED WHITE CONTAINER --> <span class="preheader" style="color: transparent;display: none;height: 0;max-height: 0;max-width: 0;opacity: 0;overflow: hidden;mso-hide: all;visibility: hidden;width: 0;font-size: 16px !important;">Vantage Gift Card Code</span> <table class="main" style="border-collapse: separate;mso-table-lspace: 0pt;mso-table-rspace: 0pt;width: 100%;background: #fff;border-radius: 0 !important;border-left-width: 0 !important;border-right-width: 0 !important;"> <!-- START MAIN CONTENT AREA --> <tr> <td class="wrapper" style="font-family: sans-serif;font-size: 16px !important;vertical-align: top;box-sizing: border-box;padding: 10px !important;"> <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate;mso-table-lspace: 0pt;mso-table-rspace: 0pt;width: 100%;"> <tr> <td style="font-family: sans-serif;font-size: 16px !important;vertical-align: top;"> <p style="font-family: sans-serif;font-size: 16px !important;font-weight: normal;margin: 0;margin-bottom: 15px;">Hello valued customer,</p> <p style="font-family: sans-serif;font-size: 16px !important;font-weight: normal;margin: 0;margin-bottom: 15px;">Your <b>' + key + '</b> gift card code is: <b>' + code + '</b>.</p> <p style="font-family: sans-serif;font-size: 16px !important;font-weight: normal;margin: 0;margin-bottom: 15px;">Thank you for using the Vantage service!</p> <p style="font-family: sans-serif;font-size: 16px !important;font-weight: normal;margin: 0;margin-bottom: 15px;">Thanks,<br>The Vantage Team</p> </td> </tr> </table> </td> </tr> <!-- END MAIN CONTENT AREA --> </table> <!-- START FOOTER --> <div class="footer" style="clear: both;padding-top: 10px;text-align: center;width: 100%;"> <table border="0" cellpadding="0" cellspacing="0" style="border-collapse: separate;mso-table-lspace: 0pt;mso-table-rspace: 0pt;width: 100%;"> <tr> <td class="content-block" style="font-family: sans-serif;font-size: 16px !important;vertical-align: top;color: #999999;text-align: center;"> <span class="apple-link" style="color: #999999;font-size: 12px !important;text-align: center;">© Socify LLC. All Rights Reserved 2016.</span></td> </tr> <tr> <td class="content-block powered-by" style="font-family: sans-serif;font-size: 16px !important;vertical-align: top;color: #999999;text-align: center;"> </td> </tr> </table> </div> <!-- END FOOTER --> <!-- END CENTERED WHITE CONTAINER --></div> </td> <td style="font-family: sans-serif;font-size: 16px !important;vertical-align: top;">&nbsp;</td> </tr> </table> </body></html>' // html body
};

// send mail with defined transport object
transporter.sendMail(mailOptions, function(error, info){
    if(error){
        return console.log(error);
    }
    console.log('Message sent: ' + info.response);
});
}

function approveDomains(opts, certs, cb) {
  if (certs) {
    opts.domains = certs.altnames;
  }
  else {
    opts.email = 'ceo@socifyinc.com';
    opts.agreeTos = true;
  }

  cb(null, { options: opts, certs: certs });
}

function checkUID(uid, cb) {
  var ref = db.ref("/coins/" + uid);
  ref.once("value", function(snapshot) {
    if (snapshot.val() == null) {
      console.log("null");
      // UID does not exist in coins database yet
      var userRef = db.ref("/users/" + uid);
      userRef.once('value', function(snapshot) {
        if (snapshot.val() == null) {
          // this was a fake user.
          //response.setHeader(200, {"Content-Type": "application/json"});
          //response.write("UID sent did not belong to any user in the Vantage database.");
          cb("UID sent did not belong to any user in the Vantage database.");
            console.log("uid not in database; uid: " + uid);
        } else {
          // user is legit but is not in the coins database yet
          //response.setHeader(200, {"Content-Type": "application/json"});
          //response.write("creating user in coins database.");
          cb("10");
          var coinRef = db.ref("coins").child(uid);
          coinRef.set({
            coins: "10"
          });
        }
      });
    } else {
    	var calledCallback = false
      snapshot.forEach(function(item) {
        var itemVal = item.val()
        if (calledCallback == false) {
        	calledCallback = true
        	cb(itemVal.toString());
        }
      });
    }
  }, function(errorObject) {
    printLog("[4] Error while getting amount of coins, error code: " + errorObject.code);
    console.log("Transfer invalid. could not retrieve amount of coins.");
    cb("Transfer invalid.");
  });
}

function verifyTransfer(uidOne, uidTwo, amount, inquiryID, cb) {
  checkUID(uidOne, function(resultOne)  {
    checkUID(uidTwo, function(resultTwo) {
      if (Number(resultOne) >= Number(amount)) {
        // transfer has been verified
        console.log("Coin amount verified");
          var answerRef = db.ref("/answers/").orderByChild("username").equalTo(uidTwo);
          answerRef.once('value', function(snapshot) {
            if (snapshot.val() == null) {
              // Transfer invalid
              console.log("Transfer invalid. snapshot.val() == null");
              cb("Transfer invalid.");
            } else {
              //console.log("Something went correct!");
              var doneScanning = false;
              var inquiryValid = false
              snapshot.forEach(function(item) {
                var itemVal = item.val();
                //console.log(item.val());
                //console.log("INQUIRY ID: " + item.val()["inquiryID"] + " ACCEPTED: " + item.val()["accepted"]);
                item.forEach(function(answerItem) {
                  if (item.val()["inquiryID"] == inquiryID && item.val()["accepted"] == "true") {
                    // inquiry has been fully verified
                    // initiate transfer of coins.
                    if (inquiryValid != true) {
                        console.log("Transfer fully verified, initiate transfer.");
                        cb("Initiating transfer");

                        //
                        var uidOneRef = db.ref('/coins/' + uidOne);
                        uidOneRef.once('value', function(snapshot) {
                            if (snapshot.val() == null) {
                                console.log("something serious just went wrong.");
                            } else {
                                let coins = parseInt(snapshot.val()["coins"]);
                                let newCoinsAmount = coins - parseInt(amount);
                                uidOneRef.update({coins: newCoinsAmount});

                                var uidTwoRef = db.ref('/coins/' + uidTwo);
                                uidTwoRef.once('value', function(snapshot) {
                                   if (snapshot.val() == null) {
                                       console.log("something serious just went wrong.");
                                   }  else {
                                       let coinsTwo = parseInt(snapshot.val()["coins"]);
                                       let newCoinsAmountTwo = coinsTwo + parseInt(amount);
                                       uidTwoRef.update({coins: newCoinsAmountTwo});
                                   }
                                });

                                console.log(snapshot.val()["coins"]);
                            }
                        });

                        inquiryValid = true;
                    }
                  }
                });
              });
                if (inquiryValid == false) {
                    // inquiry not validated
                    console.log("Transfer not validated");
                    cb("Transfer invalid");
                }
            }
          });
      } else {
        // user does not have anough coins to transfer
        console.log("Transfer invalid. Not enough coins. ResultOne:" + resultOne + " ResultTwo:" + resultTwo + " Amount:" + amount);
        cb("Transfer invalid.");
      }
    });
  });
}

function subtractCoins(amount, uid) {
    var ref = db.ref("/coins/" + uid);
    ref.once('value', function(snapshot) {
       var coins = parseInt(snapshot.val()["coins"]);
        var newCoinsAmount = coins - amount;
        ref.update({coins: newCoinsAmount});
    });
}

function printLog(text) {
  fs.appendFile(LOG_FILE, "\n" + text + "\n", function(error) {
  });
}

app.get("/.well-known/acme-challenge/XuS19HZ4SMqDIUJP9axW9OtrDir1ZSr72woiLq-LN-Y", function(req, res) {
  res.send("XuS19HZ4SMqDIUJP9axW9OtrDir1ZSr72woiLq-LN-Y.gxPLstBXQCvXp2A4j9VJDL-_kLlHHCZYDDjUG93iPGg");
})
