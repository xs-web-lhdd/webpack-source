class ArrayQueue {
	constructor(items) {
		this._list = items ? Array.from(items) : [];
	}

	get length() {
		return this._list.length
	}

	clear() {
		this._list.length = 0;	}

	enqueue(item) {
		this._list.push(item);
	}

	dequeue() {
		return this._list.shift()
	}
}

class AsyncQueueEntry {
	constructor(item, callback) {
		this.item = item;
		this.callback = callback;

		// 用来处理重复:
		this.state = QUEUED_STATE
		this.error = undefined
		this.result = undefined
		this.callbacks = []

	}
}

const QUEUED_STATE = 0
const PROCESSING_STATE = 1
const DONE_STATE = 3

module.exports = class AsyncQueue {
	constructor(options) {
		this.name = options.name
		this.processor = options.processor
		this.parallelism = options.parallelism
		this.getKey = options.getKey

		// 任务队列
		this._queued = new ArrayQueue()
		// 所有执行过的任务都会存到这里来
		this._entries = new Map()
		this._activeTasks = 0
		// 是否开启任务执行:
		this._willEnsureProcessing = false
	}


	add(item, callback) {
		const key = this.getKey(item)
		const entry = this._entries.get(key)
		if (entry) {
			if(entry.state === DONE_STATE) {
				process.nextTick(callback(entry.error, entry.result))
			} else {
				entry.callbacks.push(callback)
			}
			return
		}
		// 将参数封装为一个任务
		let newEntry = new AsyncQueueEntry(item, callback)
		this._queued.enqueue(newEntry)
		this._entries.set(key, newEntry)
		if (!this._willEnsureProcessing) {
			// 开启任务执行(如果队列为空,然后被调用add,那么就应该开启任务执行...)
			this._willEnsureProcessing = true
			setImmediate(this._ensureProcessing.bind(this))
		}
	}

	_ensureProcessing() {
		// 并发限制: 这一批的任务
		while(this._activeTasks < this.parallelism) {
			// 取出任务
			const entry = this._queued.dequeue()
			// 队列里面没有任务时直接结束
			if (!entry) {
				break
			}
			// 正在处理的任务数+1
			this._activeTasks++
			// 开始处理任务
			this._startProcess(entry)
			entry.state = PROCESSING_STATE
		}
		this._willEnsureProcessing = false
	}

	_startProcess(entry) {
		// 调用用户传进来的 processor 来处理任务
		this.processor(entry.item, (err, result) => {
			this._handleResult(entry, err, result)
		})
	}

	_handleResult(entry, err, result) {
		// 取出用户传进来的回调进行执行
		const callback = entry.callback
		entry.state = DONE_STATE
		entry.error = err
		entry.result = result
		callback(err, result)
		// 正在处理的任务数-1
		this._activeTasks--
		if(entry.callbacks.length > 0) {
			for(const callback of entry.callbacks) {
				callback(err, result)
			}
		}
		// 开启任务
		if(!this._willEnsureProcessing) {
			this._willEnsureProcessing = true
			// 开启一轮新的任务:
			setImmediate(this._ensureProcessing.bind(this))
		}
	}
}