var redis = require('redis');
// TODO: Remove express as a dependency? We are not really using it.
var app = require('express')();
var http = require('http').Server(app);
var io = require('socket.io')(http);

var clients = {}

// SOCKET IO Middleware

// We give a socket a user Id and username
io.use(function(socket, next) {
  var handshakeData = socket.request;
  clients[handshakeData._query['userId']] = {
    "userName": handshakeData._query['userName'],
    "socket": socket.id
  };
  socket.userId = handshakeData._query['userId'];
  socket.userName = handshakeData._query['userName'];
  next();
});

// REDIS Subscription

if (process.env.REDIS_URL) {
  var redisSub = redis.createClient(process.env.REDIS_URL);
  var redisPub = redis.createClient(process.env.REDIS_URL);
  var redisData = redis.createClient(process.env.REDIS_URL);
} else {
  var redisSub = redis.createClient();
  var redisPub = redis.createClient();
  var redisData = redis.createClient();
}
redisSub.subscribe('message');
redisSub.subscribe('onlineIndicators');
redisSub.subscribe('messageReceived');
redisSub.subscribe('typingIndicator');

// we should prob rename our channels so that 'message' as a channel name is not confused 
// with message as a redis event
redisSub.on('message', function (channel, data) {
  if (channel == 'typingIndicator') {
    var parsedData = JSON.parse(data);
    if (!clients[parsedData.receiverId]) { return; } 
    var receiverSocketId = clients[parsedData.receiverId].socket;
    if (receiverSocketId && io.sockets.connected[receiverSocketId]) {
      io.sockets.connected[receiverSocketId].emit('typingIndicator', parsedData)
    }
  }
  else if (channel == 'messageReceived') {
    var parsedData = JSON.parse(data);
    if (!clients[parsedData.senderId]) { return; }
    var senderSocketId = clients[parsedData.senderId].socket;
    if (senderSocketId && io.sockets.connected[senderSocketId]) {
      redisData.lrange("messageConfirmationQueue:" + parsedData.senderId, 0, -1, function(err, messageConfirmations) {
        if (err) return res.send(500, { error: err });
        var messageConfirmationsJSON = messageConfirmations.map((item) => JSON.parse(item));
        if (messageConfirmationsJSON.length > 0) {
          io.sockets.connected[senderSocketId].emit('messageReceived', messageConfirmationsJSON);
        }
        redisData.del("messageConfirmationQueue:" + parsedData.senderId);
      });
    }
  }
  else if (channel == 'onlineIndicators') {
    redisData.smembers('onlineUsers', function(err, data) {
      if (err) {
        return console.log('error getting online indicators from redis');
      } else {
        io.emit('onlineIndicators', {onlineUsers: data});
      }
        
    });
  }
  else if (channel == 'message'){
    parsedData = JSON.parse(data);
    if (parsedData.type == 'Channel') {
      var senderSocketId = clients[parsedData.senderId].socket;
      if (io.sockets.connected[senderSocketId]) {
        io.sockets.connected[senderSocketId].broadcast.emit('message', parsedData);
      } else {
        io.emit('message', parsedData);
      }
    }
    else if (parsedData.type == 'DirectMessage'){
      // TODO: do we need this double check?
      if (clients[parsedData.receiverId]) {
        var receiverSocketId = clients[parsedData.receiverId].socket;
        var senderSocketId = clients[parsedData.senderId].socket;
        // TODO: imrpve this!!!!
        if (io.sockets.connected[receiverSocketId]) {
          io.sockets.connected[receiverSocketId].emit(
            'message', parsedData);
        }
      }
    }
  }
});

// SOCKET IO events

io.on('connection', function(socket){

  redisData.sadd('onlineUsers', socket.userId);
  redisPub.publish('onlineIndicators', socket.userId);
  // TODO: Prob a bit hackey. We pretend as if a message has just been receied in realtime
  // perhaps should rename the channel?
  redisPub.publish('messageReceived', JSON.stringify({senderId: socket.userId}));

  socket.on('disconnect', function(){
    clients[socket.userId] = undefined;
    redisData.srem('onlineUsers', socket.userId);
    redisPub.publish('onlineIndicators', socket.userId);
  });

  socket.on('message', function(data) {
    data.senderId = socket.userId;
    data.senderName = socket.userName;
    data.timestamp = new Date();
    if (data.type == 'Channel') {
      redisData.lpush("channel:general", JSON.stringify(data));
      redisData.ltrim("channel:general", 0, 1000);
    } else {
      redisData.lpush("directMessages:" + socket.userId, JSON.stringify(data));
      redisData.ltrim("directMessages:" + socket.userId, 0, 1000);
      redisData.lpush("directMessages:" + data.receiverId, JSON.stringify(data));
      redisData.ltrim("directMessages:" + data.receiverId, 0, 1000);
    }
    socket.emit('messageConfirmation', data);
    redisPub.publish('message', JSON.stringify(data));
  });

  socket.on('messageReceived', function(data) {
    redisData.lpush("messageConfirmationQueue:" + data.senderId, JSON.stringify(data));
    redisData.ltrim("messageConfirmationQueue:" + data.senderId, 0, 1000);
    redisPub.publish('messageReceived', JSON.stringify(data));
  });

  socket.on('typingIndicator', function(data) {
    data.senderId = socket.userId;
    data.senderName = socket.userName;
    redisPub.publish('typingIndicator', JSON.stringify(data));
  });

});

var port = process.env.PORT || 5000;

http.listen(port, function(){
	console.log('socket server listening on *:' + port);
});