// const AsyncQueue = require('../lib/util/AsyncQueue')
const AsyncQueue = require('../liu-demo/myAsyncQueue')

const queue = new AsyncQueue({
	name: '调度器',
	// 处理函数
	processor: function(item, callback){
		setTimeout(() => {
			item.deal = item.key + "===>>> 被处理器处理过了"
			callback(null, item)
		}, 2000)
	},
	// 并发数量
	parallelism: 2,
	getKey: item => item.key
})

// 加入asyncQueue队列,第一个参数是加入的对象,第二个参数是经过AsyncQueue处理之后的回调函数
queue.add({key: 'item1'}, function(err, result){
	console.log(result);
})

queue.add({key: 'item2'}, function(err, result){
	console.log(result);
})

queue.add({key: 'item3'}, function(err, result){
	console.log(result);
})

queue.add({key: 'item1'}, function(err, result){
	console.log(result);
})