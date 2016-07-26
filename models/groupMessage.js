var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var GroupMessageSchema = new Schema({
	chatId: String,
	type: String,
	senderId: Schema.Types.ObjectId,
	senderName: String,
	timeStamp: Date,
	clientMessageIdentifier: String,
	isSent: Boolean,
	body: { type: Schema.Types.Mixed }
});

module.exports = mongoose.model('GroupMessage', GroupMessageSchema )