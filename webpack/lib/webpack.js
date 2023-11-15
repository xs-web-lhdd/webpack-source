/*
	MIT License http://www.opensource.org/licenses/mit-license.php
	Author Tobias Koppers @sokra
*/

"use strict";

const util = require("util");
const webpackOptionsSchemaCheck = require("../schemas/WebpackOptions.check.js");
const webpackOptionsSchema = require("../schemas/WebpackOptions.json");
const Compiler = require("./Compiler");
const MultiCompiler = require("./MultiCompiler");
const WebpackOptionsApply = require("./WebpackOptionsApply");
const {
	applyWebpackOptionsDefaults,
	applyWebpackOptionsBaseDefaults
} = require("./config/defaults");
const { getNormalizedWebpackOptions } = require("./config/normalization");
const NodeEnvironmentPlugin = require("./node/NodeEnvironmentPlugin");
const memoize = require("./util/memoize");

/** @typedef {import("../declarations/WebpackOptions").WebpackOptions} WebpackOptions */
/** @typedef {import("./Compiler").WatchOptions} WatchOptions */
/** @typedef {import("./MultiCompiler").MultiCompilerOptions} MultiCompilerOptions */
/** @typedef {import("./MultiStats")} MultiStats */
/** @typedef {import("./Stats")} Stats */

const getValidateSchema = memoize(() => require("./validateSchema"));

/**
 * @template T
 * @callback Callback
 * @param {Error=} err
 * @param {T=} stats
 * @returns {void}
 */

/**
 * @param {ReadonlyArray<WebpackOptions>} childOptions options array
 * @param {MultiCompilerOptions} options options
 * @returns {MultiCompiler} a multi-compiler
 */
const createMultiCompiler = (childOptions, options) => {
	const compilers = childOptions.map(options => createCompiler(options));
	const compiler = new MultiCompiler(compilers, options);
	for (const childCompiler of compilers) {
		if (childCompiler.options.dependencies) {
			compiler.setDependencies(
				childCompiler,
				childCompiler.options.dependencies
			);
		}
	}
	return compiler;
};

/**
 * @param {WebpackOptions} rawOptions options object
 * @returns {Compiler} a compiler
 */
const createCompiler = rawOptions => {
	// 调用 getNormalizedWebpackOptions + applyWebpackOptionsBaseDefaults 合并出最终配置
	const options = getNormalizedWebpackOptions(rawOptions);
	// 1、如果 options 的 context 属性是 undefined, 那么把 process.cwd() 的值赋给 options 的 context 属性
	// 2、对 options 的 infrastructureLogging 进行一系列赋值操作
	applyWebpackOptionsBaseDefaults(options);
	// 3、创建 compiler 对象
	const compiler = new Compiler(
		/** @type {string} */ (options.context),
		options
	);
	// 4、让compiler可以读文件和写文件了
	new NodeEnvironmentPlugin({
		infrastructureLogging: options.infrastructureLogging
	}).apply(compiler);
	// 5、挂载配置文件里面的所有plugins
	// 遍历用户定义的 plugins 集合，执行插件的 apply 方法
	// 集中调用 webpack config 中的 plugins, 如果写入的 plugin 有 bug, 会直接挂掉后面流程就不会再走了
	if (Array.isArray(options.plugins)) {
		for (const plugin of options.plugins) {
			if (typeof plugin === "function") {
				plugin.call(compiler, compiler);
			} else if (plugin) {
				plugin.apply(compiler);
			}
		}
	}
	// 6、给 options 设置一堆默认属性，比如：performance、cache、devtools、watch ......
	applyWebpackOptionsDefaults(options);
	// 7、进行 environment 和 afterEnvironment 钩子函数的调用
	compiler.hooks.environment.call();
	compiler.hooks.afterEnvironment.call();
	// TODO: 8、调用 new WebpackOptionsApply().process 方法，加载各种内置插件 ！！！
	new WebpackOptionsApply().process(options, compiler);
	// 当编译器对象被初始化时调用。如果想在初始化完成后做一些操作，可以绑 initialize 这个钩子
	compiler.hooks.initialize.call();
	return compiler;
};

/**
 * @callback WebpackFunctionSingle
 * @param {WebpackOptions} options options object
 * @param {Callback<Stats>=} callback callback
 * @returns {Compiler} the compiler object
 */

/**
 * @callback WebpackFunctionMulti
 * @param {ReadonlyArray<WebpackOptions> & MultiCompilerOptions} options options objects
 * @param {Callback<MultiStats>=} callback callback
 * @returns {MultiCompiler} the multi compiler object
 */

/**
 * @template T
 * @param {Array<T> | T} options options
 * @returns {Array<T>} array of options
 */
const asArray = options =>
	Array.isArray(options) ? Array.from(options) : [options];

const webpack = /** @type {WebpackFunctionSingle & WebpackFunctionMulti} */ (
	/**
	 * @param {WebpackOptions | (ReadonlyArray<WebpackOptions> & MultiCompilerOptions)} options options
	 * @param {Callback<Stats> & Callback<MultiStats>=} callback callback
	 * @returns {Compiler | MultiCompiler} Compiler or MultiCompiler
	 */
	(options, callback) => {
		const create = () => {
			// 验证配置文件是否合法，如果不合法报错
			if (!asArray(options).every(webpackOptionsSchemaCheck)) {
				getValidateSchema()(webpackOptionsSchema, options);
				util.deprecate(
					() => {},
					"webpack bug: Pre-compiled schema reports error while real schema is happy. This has performance drawbacks.",
					"DEP_WEBPACK_PRE_COMPILED_SCHEMA_INVALID"
				)();
			}
			/** @type {MultiCompiler|Compiler} */
			let compiler;
			/** @type {boolean | undefined} */
			let watch = false;
			/** @type {WatchOptions|WatchOptions[]} */
			let watchOptions;
			if (Array.isArray(options)) {
				/** @type {MultiCompiler} */
				compiler = createMultiCompiler(
					options,
					/** @type {MultiCompilerOptions} */ (options)
				);
				watch = options.some(options => options.watch);
				watchOptions = options.map(options => options.watchOptions || {});
			} else {
				const webpackOptions = /** @type {WebpackOptions} */ (options);
				/** @type {Compiler} */
				// TODO: !!!
				// 调用createCompiler方法创建compiler对象
				compiler = createCompiler(webpackOptions);
				watch = webpackOptions.watch;
				watchOptions = webpackOptions.watchOptions || {};
			}
			return { compiler, watch, watchOptions };
		};
		if (callback) {
			try {
				const { compiler, watch, watchOptions } = create();
				if (watch) {
					compiler.watch(watchOptions, callback);
				} else {
					compiler.run((err, stats) => {
						compiler.close(err2 => {
							callback(err || err2, stats);
						});
					});
				}
				return compiler;
			} catch (err) {
				// 失败的时候把err传给callback
				process.nextTick(() => callback(err));
				return null;
			}
		} else {
			// 当传入watch的时候就需要有一个callback,否则会进行提示传入callback
			const { compiler, watch } = create();
			if (watch) {
				util.deprecate(
					() => {},
					"A 'callback' argument needs to be provided to the 'webpack(options, callback)' function when the 'watch' option is set. There is no way to handle the 'watch' option without a callback.",
					"DEP_WEBPACK_WATCH_WITHOUT_CALLBACK"
				)();
			}
			return compiler;
		}
	}
);

module.exports = webpack;
