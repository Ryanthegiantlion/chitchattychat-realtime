var redis = require('redis');
// TODO: Remove express as a dependency? We are not really using it.
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var RedisChannels = require('./constants/redisChannels')
var SocketEvents = require('./constants/socketEvents')

var clients = {}

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

// REDIS Subscriptions

if (process.env.REDIS_URL) {
  var redisSub = redis.createClient(process.env.REDIS_URL);
  var redisPub = redis.createClient(process.env.REDIS_URL);
  var redisData = redis.createClient(process.env.REDIS_URL);
} else {
  var redisSub = redis.createClient();
  var redisPub = redis.createClient();
  var redisData = redis.createClient();
}

// PLEASE NOTE !!!
// The chat has a concept of messages and channels
// Unfortunetly redis also has these concepts - it has messages EVENTS
// for whenever data is published to a redis channel. :-0
// I will try and indicate what is what in the comments.
// TODO: perhaps we should think of better naming convetions.

// REDIS CHANNELS that we subscribe to

for (var key in RedisChannels) {
  redisSub.subscribe(RedisChannels[key])
} 

// REDIS MESSAGE events.
redisSub.on('message', function (channel, data) {
  // Handlers for the various REDIS CHANNELS
  if (channel == RedisChannels.TypingStatus) {
    var parsedData = JSON.parse(data);
    if (!clients[parsedData.receiverId]) { return; } 
    var receiverSocketId = clients[parsedData.receiverId].socket;
    if (receiverSocketId && io.sockets.connected[receiverSocketId]) {
      io.sockets.connected[receiverSocketId].emit(SocketEvents.TypingStatus, parsedData)
    }
  }
  else if (channel == RedisChannels.MessageDeliveredConfirmation) {
    console.log('d2');
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
        console.log('online users back from redis:');
        console.log(data.map((id) => ({id: id, name: (clients[id] != undefined ? clients[id].userName : '')})));
        console.log(clients)
        io.emit(SocketEvents.OnlineStatus, {onlineUsers: data});
      }
        
    });
  }
  else if (channel == RedisChannels.Message){
    console.log('redis handler')
    console.log(data)
    parsedData = JSON.parse(data);
    if (parsedData.type == 'Group') {
      console.log('G')
      var senderSocketId = clients[parsedData.senderId].socket;
      if (io.sockets.connected[senderSocketId]) {
        io.sockets.connected[senderSocketId].broadcast.emit(SocketEvents.Message, parsedData);
      } else {
        io.emit(SocketEvents.Message, parsedData);
      }
    }
    else if (parsedData.type == 'DirectMessage'){
      console.log('DM')
      // TODO: do we need this double check?
      if (clients[parsedData.receiverId]) {
        console.log('got client')
        var receiverSocketId = clients[parsedData.receiverId].socket;
        var senderSocketId = clients[parsedData.senderId].socket;
        // TODO: imrpve this!!!!
        if (io.sockets.connected[receiverSocketId]) {
          console.log('got socket')
          io.sockets.connected[receiverSocketId].emit(
            SocketEvents.Message, parsedData);
        }
      }
    }
  }
});

// SOCKET IO events

var getOfflineMessages = function(socket) {

  var lastMessageTimeStamp = socket.request._query['lastMessageTimeStamp'];
  var userId = socket.userId;

  console.log('checking for offline messages for user ' + socket.userName +  ' and timestamp ' + lastMessageTimeStamp);

  redisData.lrange("directMessages:" + userId, 0, -1, function(err, data) {
    if (err) { console.log('Error getting direct messages on connect') };
    console.log(data);

    var newMessages = data.map((item) => JSON.parse(item));
    console.log('fhgfhhhhhhhhhhhhhhhhhhhhhh')
    console.log(newMessages)
    if (newMessages.length > 0 && lastMessageTimeStamp) {
      console.log('fhgfhhhhhhhhhhhhhhhhhhhhhhsdsdfsdfsdfsfdsdfsdf')
      if (lastMessageTimeStamp) {
        console.log('fdfsdf')
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

io.on('connection', function(socket){

  getOfflineMessages(socket);

  redisData.sadd('onlineStatuses', socket.userId);
  redisPub.publish(RedisChannels.OnlineStatus, socket.userId);
  // TODO: Prob a bit hackey. We pretend as if a message has just been receied in realtime
  // perhaps should rename the channel?
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

    var receiverChatId = data.type == 'DirectMessage' ? data.senderId : 0;
    receiverMessage = Object.assign({}, data, {chatId: receiverChatId});
    if (data.type == 'Group') {
      redisData.lpush("group:general", JSON.stringify(data));
      redisData.ltrim("group:general", 0, 1000);
    } else {
      redisData.lpush("directMessages:" + socket.userId, JSON.stringify(data));
      redisData.ltrim("directMessages:" + socket.userId, 0, 1000);
      redisData.lpush("directMessages:" + data.receiverId, JSON.stringify(receiverMessage));
      redisData.ltrim("directMessages:" + data.receiverId, 0, 1000);
    }
    console.log(SocketEvents.MessageSentConfirmation);
    socket.emit(SocketEvents.MessageSentConfirmation, data);
    redisPub.publish(RedisChannels.Message, JSON.stringify(receiverMessage));
  });

  socket.on(SocketEvents.MessageDeliveredConfirmation, function(data) {
    //console.log('got delivery confirmation')
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