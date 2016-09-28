var gcm = require('node-gcm');
var apn = require('apn');

function send_gcm_push(token, message, title) {
  // Create a message 
  // ... with default values 
  var message = new gcm.Message();
   
  // ... or some given values 
  var message = new gcm.Message({
      collapseKey: 'demo',
      priority: 'high',
      contentAvailable: true,
      delayWhileIdle: true,
      timeToLive: 3,
      //restrictedPackageName: "somePackageName",
      //dryRun: true,
      data: {
          key1: 'message1',
          key2: 'message2'
      },
      notification: {
          title: title,
          icon: "ic_launcher",
          body: message
      }
  });
   
  // Change the message data 
  // ... as key-value 
  // message.addData('key1','message1');
  // message.addData('key2','message2');
   
  // // ... or as a data object (overwrites previous data object) 
  // message.addData({
  //     key1: 'message1',
  //     key2: 'message2'
  // });
   
  // Set up the sender with you API key 
  var sender = new gcm.Sender('push key');
   
  // Add the registration tokens of the devices you want to send to 
  var registrationTokens = [];
  registrationTokens.push(token);
  //registrationTokens.push('regToken2');
   
  // Send the message 
  // ... trying only once 
  sender.sendNoRetry(message, { registrationTokens: registrationTokens }, function(err, response) {
    if(err) console.error(err);
    else    console.log(response);
  });
   
  // ... or retrying 
  // sender.send(message, { registrationTokens: registrationTokens }, function (err, response) {
  //   if(err) console.error(err);
  //   else    console.log(response);
  // });
   
  // // ... or retrying a specific number of times (10) 
  // sender.send(message, { registrationTokens: registrationTokens }, 10, function (err, response) {
  //   if(err) console.error(err);
  //   else    console.log(response);
  // });
}

function send_apple_push(token, message, title) {
  // var options = {
  //   token: {
  //       key: "path/to/key.p8",
  //       keyId: "T0K3NK3Y1D",
  //       teamId: "T34M1D",
  //   },
  //   production: false,
  // };

  options = {}

  var apnProvider = new apn.Provider(options);

  var note = new apn.Notification();

  note.expiry = Math.floor(Date.now() / 1000) + 3600; // Expires 1 hour from now.
  note.badge = 3;
  note.sound = "ping.aiff";
  note.alert = title;
  note.payload = {'messageFrom': message};
  note.topic = "com.ryanharmuth.ryantestapp";

  apnProvider.send(note, token).then( (result) => {
      // see documentation for an explanation of result
      console.log('ios push sent')
  });
}

function send_push(token, platform, message, title) {
  if (platform == 'ios') {
    send_gcm_push(token, message, title);
  } else if (platform == 'android') {
    send_gcm_push(token, message, title);
  } else {
    console.log('unknown platform');
  }
}
 
module.exports = { send_push: send_push }




