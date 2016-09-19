var RedisChannels = require('../constants/redisChannels')

var InsuranceBot = {
	id: '57df584e741f998795f33693',
	name: 'insurancebot',
	outChannel: RedisChannels.InsuranceBotMessage,
	inChannel: RedisChannels.InsuranceBotReply
}

var FlowerBot = {
	id: '57c6fcb4741f998795f322f5',
	name: 'flowerbot',
	outChannel: RedisChannels.FlowerBotMessage,
	inChannel: RedisChannels.FlowerBotReply
}

var SmartBot = {
	id: '57c002f7741f998795f31c95',
	name: 'smartbot',
	outChannel: RedisChannels.SmartBotMessage,
	inChannel: RedisChannels.SmartBotReply
}

var SimpleBot = {
	id: '57be9d4b741f998795f31b62',
	name: 'simplebot',
	outChannel: RedisChannels.BotMessage,
	inChannel: RedisChannels.BotReply
}

var Bots = [InsuranceBot, FlowerBot, SmartBot, SimpleBot]

module.exports = { Bots: Bots }