/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";
// enhanced-resolve 提供异步 require.resolve 函数。它是高度可配置的。
// 特征: 插件系统 提供自定义文件系统 同步和异步节点.js包括文件系统
const CachedInputFileSystem = require("enhanced-resolve/lib/CachedInputFileSystem");
const fs = require("graceful-fs");
const createConsoleLogger = require("../logging/createConsoleLogger");
const NodeWatchFileSystem = require("./NodeWatchFileSystem");
const nodeConsole = require("./nodeConsole");

/** @typedef {import("../../declarations/WebpackOptions").InfrastructureLogging} InfrastructureLogging */
/** @typedef {import("../Compiler")} Compiler */

class NodeEnvironmentPlugin {
	/**
	 * @param {Object} options options
	 * @param {InfrastructureLogging} options.infrastructureLogging infrastructure logging options
	 */
	constructor(options) {
		this.options = options;
	}

	/**
	 * Apply the plugin
	 * @param {Compiler} compiler the compiler instance
	 * @returns {void}
	 */
	apply(compiler) {
		// 打印日志的。。。
		const { infrastructureLogging } = this.options;
		compiler.infrastructureLogger = createConsoleLogger({
			level: infrastructureLogging.level || "info",
			debug: infrastructureLogging.debug || false,
			console:
				infrastructureLogging.console ||
				nodeConsole({
					colors: infrastructureLogging.colors,
					appendOnly: infrastructureLogging.appendOnly,
					stream: infrastructureLogging.stream
				})
		});
		// 读文件的系统 --- fs增强 读文件用那个模块
		compiler.inputFileSystem = new CachedInputFileSystem(fs, 60000);
		const inputFileSystem = compiler.inputFileSystem;
		// 写文件系统  写文件用那个模块
		compiler.outputFileSystem = fs;
		compiler.intermediateFileSystem = fs;
		compiler.watchFileSystem = new NodeWatchFileSystem(
			compiler.inputFileSystem
		);
		compiler.hooks.beforeRun.tap("NodeEnvironmentPlugin", compiler => {
			// 在构建过程中把缓存给清掉，避免我们在构建过程中占用更多的内存
			if (compiler.inputFileSystem === inputFileSystem) {
				compiler.fsStartTime = Date.now();
				inputFileSystem.purge();
			}
		});
	}
}

module.exports = NodeEnvironmentPlugin;
