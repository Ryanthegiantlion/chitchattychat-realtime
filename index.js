var redis = require('redis');
var mongoose = require('mongoose')
// TODO: Remove express as a dependency? We are not really using it.
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var DirectMessage = require('./models/directMessage')
var GroupMessage = require('./models/groupMessage')
var RedisChannels = require('./constants/redisChannels')
var SocketEvents = require('./constants/socketEvents')

var clients = {}

var mongoUrl = process.env.MONGODB_URI || 'mongodb://localhost:27017/test'

// TODO: Should we be connecting here?
mongoose.connect(mongoUrl)

// SOCKET IO Middleware

// We give a socket a user Id and username
io.use(function(socket, next) {
  var handshakeData = socket.request;
  console.log('got a handshake going on!!!');
  console.log({
    "userName": handshakeData._query['userName'],
    "userId": handshakeData._query['userId'],
    "socket": socket.id
  });

  clients[handshakeData._query['userId']] = {
    "userName": handshakeData._query['userName'],
    "socket": socket.id
  };
  socket.userId = handshakeData._query['userId'];
  socket.userName = handshakeData._query['userName'];
  next();
});

if (process.env.REDIS_URL) {
  var redisSub = redis.createClient(process.env.REDIS_URL);
  var redisPub = redis.createClient(process.env.REDIS_URL);
  var redisData = redis.createClient(process.env.REDIS_URL);
} else {
  var redisSub = redis.createClient();
  var redisPub = redis.createClient();
  var redisData = redis.createClient();
}

// TODO: This also subsribe to the bot messages channel though 
// we don't have a handler for it!
for (var key in RedisChannels) {
  redisSub.subscribe(RedisChannels[key])
} 

// REDIS subscriptions

redisSub.on('message', function (channel, data) {
  // Handlers for the various REDIS CHANNELS
  if (channel == RedisChannels.Message){
    parsedData = JSON.parse(data);
    if (parsedData.type == 'Group') {
      var connectedClient = clients[parsedData.senderId];
        if (connectedClient) {
        var senderSocketId = connectedClient.socket;
        if (io.sockets.connected[senderSocketId]) {
          io.sockets.connected[senderSocketId].broadcast.emit(SocketEvents.Message, parsedData);
        } else {
          io.emit(SocketEvents.Message, parsedData);
        }
      } else {
        io.emit(SocketEvents.Message, parsedData);
      }
    }
    else if (parsedData.type == 'DirectMessage'){
      if (clients[parsedData.receiverId]) {
        var receiverSocketId = clients[parsedData.receiverId].socket;
        //var senderSocketId = clients[parsedData.senderId].socket;
        if (io.sockets.connected[receiverSocketId]) {
          io.sockets.connected[receiverSocketId].emit(SocketEvents.Message, parsedData);
        }
      }
    }
  } 
  else if (channel == RedisChannels.BotReply) {
    data = JSON.parse(data)

    //data.senderId = socket.userId;
    //data.senderName = socket.userName;
    data.timestamp = new Date();

    if (data.type == 'Group') {  
      var message = new GroupMessage(data);
      message.save(function (err) {
        if (!err) {
          redisData.lpush("group:general", JSON.stringify(data));
          redisData.ltrim("group:general", 0, 1000);

          //socket.emit(SocketEvents.MessageSentConfirmation, data);
          redisPub.publish(RedisChannels.Message, JSON.stringify(data));
          return console.log("created group messages");
        } else {
          //TODO: return page with errors
          return console.log(err);
        }
      });
    } else {
      var message = new DirectMessage(data);
      message.save(function (err) {
        if (!err) {
          redisData.lpush("directMessages:" + data.senderId, JSON.stringify(data));
          redisData.ltrim("directMessages:" + data.senderId, 0, 1000);

          redisData.lpush("directMessages:" + data.receiverId, JSON.stringify(data));
          redisData.ltrim("directMessages:" + data.receiverId, 0, 1000);

          //socket.emit(SocketEvents.MessageSentConfirmation, data);
          redisPub.publish(RedisChannels.Message, JSON.stringify(data));
          return console.log("created direct message 2");
        } else {
          //TODO: return page with errors
          return console.log(err);
        }
      }); 
    } 
  }
  else if (channel == RedisChannels.TypingStatus) {
    var parsedData = JSON.parse(data);
    if (!clients[parsedData.receiverId]) { return; } 
    var receiverSocketId = clients[parsedData.receiverId].socket;
    if (receiverSocketId && io.sockets.connected[receiverSocketId]) {
      io.sockets.connected[receiverSocketId].emit(SocketEvents.TypingStatus, parsedData)
    }
  }
  else if (channel == RedisChannels.MessageDeliveredConfirmation) {
    var parsedData = JSON.parse(data);
    if (!clients[parsedData.senderId]) { return; }
    var senderSocketId = clients[parsedData.senderId].socket;
    if (senderSocketId && io.sockets.connected[senderSocketId]) {
      redisData.lrange("messageDeliveredQueue:" + parsedData.senderId, 0, -1, function(err, messageConfirmations) {
        if (err) return res.send(500, { error: err });
        var messageConfirmationsJSON = messageConfirmations.map((item) => JSON.parse(item));
        if (messageConfirmationsJSON.length > 0) {
          io.sockets.connected[senderSocketId].emit(SocketEvents.MessageDeliveredConfirmation, messageConfirmationsJSON);
        }
        redisData.del("messageDeliveredQueue:" + parsedData.senderId);
      });
    }
  }
  else if (channel == RedisChannels.OnlineStatus) {
    redisData.smembers('onlineStatuses', function(err, data) {
      if (err) {
        return console.log('error getting online indicators from redis');
      } else {
        console.log('Online users:');
        console.log(data.map((id) => ({id: id, name: (clients[id] != undefined ? clients[id].userName : '')})));
        console.log(clients)
        // TODO: add bot id. very hacky trolololol!
        data.push('57be6070296ad1b878399281')
        console.log(data)
        io.emit(SocketEvents.OnlineStatus, {onlineUsers: data});
      }  
    });
  }
});

var getOfflineMessages = function(socket) {
  var lastMessageTimeStamp = socket.request._query['lastMessageTimeStamp'];
  var userId = socket.userId;

  //console.log('checking for offline messages for user ' + socket.userName +  ' and timestamp ' + lastMessageTimeStamp);

  redisData.lrange("directMessages:" + userId, 0, -1, function(err, data) {
    if (err) { 
      console.log('Error getting direct messages on connect') 
    };

    var newMessages = data.map((item) => JSON.parse(item));
    if (newMessages.length > 0 && lastMessageTimeStamp) {
      if (lastMessageTimeStamp) {
        newMessages = newMessages.filter((item) => item.timestamp > lastMessageTimeStamp);
      }
    }

    if (newMessages) {
      console.log('sending ' + newMessages.length + ' offline messages')
      // TODO: Maybe keep it in order in redis?
      newMessages = newMessages.reverse();
      newMessages.forEach((item) => socket.emit('message', item));
    }
  });
}

// SOCKET IO events

io.on('connection', function(socket){

  getOfflineMessages(socket);

  redisData.sadd('onlineStatuses', socket.userId);
  redisPub.publish(RedisChannels.OnlineStatus, socket.userId);
  // TODO: A hackey method to get delivery confirmations on reconnect
  redisPub.publish(RedisChannels.MessageDeliveredConfirmation, JSON.stringify({senderId: socket.userId}));

  socket.on('disconnect', function(){
    clients[socket.userId] = undefined;
    redisData.srem('onlineStatuses', socket.userId);
    redisPub.publish(RedisChannels.OnlineStatus, socket.userId);
  });

  socket.on(SocketEvents.Message, function(data) {
    data.senderId = socket.userId;
    data.senderName = socket.userName;
    data.timestamp = new Date();

    // console.log(data);
    // quick hack to pipe messages to the bot
    if (data.senderName != 'simplebot' && (data.type == 'Group' || data.receiverName == 'simplebot')) {
      redisPub.publish(RedisChannels.BotMessage, JSON.stringify(data));
    }

    if (data.type == 'Group') {  
      var message = new GroupMessage(data);
      message.save(function (err) {
        if (!err) {
          redisData.lpush("group:general", JSON.stringify(data));
          redisData.ltrim("group:general", 0, 1000);

          socket.emit(SocketEvents.MessageSentConfirmation, data);
          redisPub.publish(RedisChannels.Message, JSON.stringify(data));
          return console.log("created group messages");
        } else {
          //TODO: return page with errors
          return console.log(err);
        }
      });
    } else {
      var message = new DirectMessage(data);
      message.save(function (err) {
        if (!err) {
          redisData.lpush("directMessages:" + socket.userId, JSON.stringify(data));
          redisData.ltrim("directMessages:" + socket.userId, 0, 1000);

          redisData.lpush("directMessages:" + data.receiverId, JSON.stringify(data));
          redisData.ltrim("directMessages:" + data.receiverId, 0, 1000);

          socket.emit(SocketEvents.MessageSentConfirmation, data);
          redisPub.publish(RedisChannels.Message, JSON.stringify(data));
          return console.log("created direct message 2");
        } else {
          //TODO: return page with errors
          return console.log(err);
        }
      }); 
    }    
  });

  socket.on(SocketEvents.MessageDeliveredConfirmation, function(data) {
    redisData.lpush("messageDeliveredQueue:" + data.senderId, JSON.stringify(data));
    redisData.ltrim("messageDeliveredQueue:" + data.senderId, 0, 1000);
    redisPub.publish(RedisChannels.MessageDeliveredConfirmation, JSON.stringify(data));
  });

  socket.on(SocketEvents.TypingStatus, function(data) {
    data.senderId = socket.userId;
    data.senderName = socket.userName;
    redisPub.publish(RedisChannels.TypingStatus, JSON.stringify(data));
  });

  socket.on(SocketEvents.Hello, function(data) {
    //console.log('Hello from ' + socket.userName);
    socket.emit(SocketEvents.Hello, { message: 'hello human' });
  });

});

var port = process.env.PORT || 5000;

http.listen(port, function(){
	console.log('socket server listening on *:' + port);
});