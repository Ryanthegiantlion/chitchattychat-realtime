var RedisChannels = require('../constants/redisChannels')

// TODO: Probably a bad way to do this
if (process.env.NODE_ENV && process.env.NODE_ENV == 'production') {
	Bots = require('./bots.production')
} else {
	Bots = require('./bots.development')
}

module.exports = Bots