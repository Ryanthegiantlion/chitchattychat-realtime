var mongoose = require('mongoose');
var Schema = mongoose.Schema;

var userSchema = new Schema({
	userName: String,
	userNameNormalised: String,
	lastSync: Date,
	lastActive: Date,
	pushToken: String,
	platform: String
});

module.exports = mongoose.model('User', userSchema);