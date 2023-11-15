/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const EntryDependency = require("./dependencies/EntryDependency");

/** @typedef {import("./Compiler")} Compiler */
/** @typedef {import("./Entrypoint").EntryOptions} EntryOptions */

class EntryPlugin {
	/**
	 * An entry plugin which will handle
	 * creation of the EntryDependency
	 *
	 * @param {string} context context path
	 * @param {string} entry entry path
	 * @param {EntryOptions | string=} options entry options (passing a string is deprecated)
	 */
	constructor(context, entry, options) {
		this.context = context;
		this.entry = entry;
		this.options = options || "";
	}

	/**
	 * Apply the plugin
	 * @param {Compiler} compiler the compiler instance
	 * @returns {void}
	 */
	apply(compiler) {
		compiler.hooks.compilation.tap(
			"EntryPlugin",
			(compilation, { normalModuleFactory }) => {
				// TODO: 注意：
				compilation.dependencyFactories.set(
					EntryDependency,
					normalModuleFactory
				);
			}
		);

		const { entry, options, context } = this;
		// 使用createDependency()构建EntryDependency
		const dep = EntryPlugin.createDependency(entry, options);

		compiler.hooks.make.tapAsync("EntryPlugin", (compilation, callback) => {
			//TODO: 吹响编译的号角！！！ 从此入口开始编译,编译入口文件和它的依赖
			compilation.addEntry(context, dep, options, err => {
				callback(err); // 这个 callback 是执行 compiler.hooks.make 这个钩子函数时传入的函数,在 Compiler.js 的 compile 方法里面
			});
		});
	}

	/**
	 * @param {string} entry entry request
	 * @param {EntryOptions | string} options entry options (passing string is deprecated)
	 * @returns {EntryDependency} the dependency
	 */
	static createDependency(entry, options) {
		const dep = new EntryDependency(entry);
		// TODO webpack 6 remove string option
		dep.loc = { name: typeof options === "object" ? options.name : options };
		return dep;
	}
}

module.exports = EntryPlugin;
