var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var DirectMessageSchema = new Schema({
	chatId: String,
	type: String,
	senderId: Schema.Types.ObjectId,
	senderName: String,
	receiverId: Schema.Types.ObjectId,
	timeStamp: Date,
	clientMessageIdentifier: String,
	isSent: Boolean,
	isDelivered: Boolean,
	body: { type: Schema.Types.Mixed }
});

module.exports = mongoose.model('DirectMessage', DirectMessageSchema)